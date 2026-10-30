import { sql, type Kysely } from 'kysely';

/** Additive: old daemons may still acknowledge, but those receipts remain unverified. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE sync_buffer ADD COLUMN syncOutcome TEXT
    CHECK (syncOutcome IS NULL OR syncOutcome IN ('committed', 'discarded', 'unverified'))`.execute(db);
  await sql`ALTER TABLE sync_buffer_stats ADD COLUMN pendingBytes INTEGER NOT NULL DEFAULT 0`.execute(db);
  await sql`CREATE INDEX idx_sync_pending_id ON sync_buffer (syncedAt, id)`.execute(db);
  await sql`CREATE TABLE sync_replication_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    epoch TEXT NOT NULL,
    startedAt TEXT NOT NULL,
    firstTrackedId INTEGER NOT NULL,
    namespaceFrom INTEGER NOT NULL,
    producedThrough INTEGER NOT NULL,
    firstUncommittedId INTEGER,
    committedRows INTEGER NOT NULL DEFAULT 0,
    discardedRows INTEGER NOT NULL DEFAULT 0,
    unverifiedRows INTEGER NOT NULL DEFAULT 0,
    evictedRows INTEGER NOT NULL DEFAULT 0,
    lastReleasedAt TEXT,
    lastCommittedAt TEXT,
    lastLossAt TEXT
  )`.execute(db);
  // History before this point cannot be reconstructed after retention. A new
  // epoch states that limit; pending rows already present are included.
  await sql`INSERT INTO sync_replication_state (id, epoch, startedAt, firstTrackedId, namespaceFrom, producedThrough,
      firstUncommittedId, unverifiedRows, lastReleasedAt)
    SELECT 1, lower(hex(randomblob(16))), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      coalesce((SELECT min(id) FROM sync_buffer WHERE syncedAt IS NULL), coalesce((SELECT seq FROM sqlite_sequence WHERE name = 'sync_buffer'), 0) + 1),
      coalesce((SELECT seq FROM sqlite_sequence WHERE name = 'sync_buffer'), 0) + 1,
      coalesce((SELECT seq FROM sqlite_sequence WHERE name = 'sync_buffer'), 0),
      (SELECT min(id) FROM sync_buffer WHERE syncedAt IS NOT NULL AND id >= coalesce((SELECT min(id) FROM sync_buffer WHERE syncedAt IS NULL), 9223372036854775807)),
      (SELECT count(*) FROM sync_buffer WHERE syncedAt IS NOT NULL AND id >= coalesce((SELECT min(id) FROM sync_buffer WHERE syncedAt IS NULL), 9223372036854775807)),
      (SELECT max(syncedAt) FROM sync_buffer)`.execute(db);

  // Replace the existing triggers, retaining their names for older runtimes.
  for (const name of ['insert', 'delete', 'update']) await sql.raw(`DROP TRIGGER IF EXISTS sync_buffer_stats_${name}`).execute(db);
  await sql`CREATE TRIGGER sync_buffer_stats_insert AFTER INSERT ON sync_buffer BEGIN
    UPDATE sync_buffer_stats SET
      totalBytes = totalBytes + octet_length(NEW.payload), totalRows = totalRows + 1,
      syncedRows = syncedRows + (NEW.syncedAt IS NOT NULL),
      pendingBytes = pendingBytes + CASE WHEN NEW.syncedAt IS NULL THEN octet_length(NEW.payload) ELSE 0 END
      WHERE id = 1;
    UPDATE sync_replication_state SET producedThrough = max(producedThrough, NEW.id),
      unverifiedRows = unverifiedRows + (NEW.syncedAt IS NOT NULL),
      firstUncommittedId = CASE WHEN NEW.syncedAt IS NOT NULL THEN min(coalesce(firstUncommittedId, NEW.id), NEW.id) ELSE firstUncommittedId END
      WHERE id = 1;
  END`.execute(db);
  await sql`CREATE TRIGGER sync_buffer_stats_delete AFTER DELETE ON sync_buffer BEGIN
    UPDATE sync_buffer_stats SET
      totalBytes = totalBytes - octet_length(OLD.payload), totalRows = totalRows - 1,
      syncedRows = syncedRows - (OLD.syncedAt IS NOT NULL),
      pendingBytes = pendingBytes - CASE WHEN OLD.syncedAt IS NULL THEN octet_length(OLD.payload) ELSE 0 END
      WHERE id = 1;
    UPDATE sync_replication_state SET evictedRows = evictedRows + 1,
      firstUncommittedId = min(coalesce(firstUncommittedId, OLD.id), OLD.id),
      lastLossAt = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = 1 AND OLD.syncedAt IS NULL;
  END`.execute(db);
  await sql`CREATE TRIGGER sync_buffer_stats_update AFTER UPDATE OF payload, syncedAt ON sync_buffer BEGIN
    UPDATE sync_buffer_stats SET
      totalBytes = totalBytes - octet_length(OLD.payload) + octet_length(NEW.payload),
      syncedRows = syncedRows - (OLD.syncedAt IS NOT NULL) + (NEW.syncedAt IS NOT NULL),
      pendingBytes = pendingBytes - CASE WHEN OLD.syncedAt IS NULL THEN octet_length(OLD.payload) ELSE 0 END
        + CASE WHEN NEW.syncedAt IS NULL THEN octet_length(NEW.payload) ELSE 0 END
      WHERE id = 1;
    UPDATE sync_replication_state SET
      committedRows = committedRows + (coalesce(NEW.syncOutcome, 'unverified') = 'committed'),
      discardedRows = discardedRows + (coalesce(NEW.syncOutcome, 'unverified') = 'discarded'),
      unverifiedRows = unverifiedRows + (coalesce(NEW.syncOutcome, 'unverified') = 'unverified'),
      firstUncommittedId = CASE WHEN coalesce(NEW.syncOutcome, 'unverified') != 'committed'
        THEN min(coalesce(firstUncommittedId, NEW.id), NEW.id) ELSE firstUncommittedId END,
      lastReleasedAt = NEW.syncedAt,
      lastCommittedAt = CASE WHEN NEW.syncOutcome = 'committed' THEN NEW.syncedAt ELSE lastCommittedAt END,
      lastLossAt = CASE WHEN NEW.syncOutcome = 'discarded' THEN NEW.syncedAt ELSE lastLossAt END
      WHERE id = 1 AND OLD.syncedAt IS NULL AND NEW.syncedAt IS NOT NULL;
  END`.execute(db);
  // An older storage opener replaces this singleton using the original four
  // columns. Restore pending bytes there too, once at boot, never per poll.
  await sql`CREATE TRIGGER sync_buffer_stats_seed AFTER INSERT ON sync_buffer_stats BEGIN
    UPDATE sync_buffer_stats SET pendingBytes = (SELECT coalesce(sum(octet_length(payload)), 0) FROM sync_buffer WHERE syncedAt IS NULL) WHERE id = 1;
  END`.execute(db);
  await sql`UPDATE sync_buffer_stats SET pendingBytes = (SELECT coalesce(sum(octet_length(payload)), 0) FROM sync_buffer WHERE syncedAt IS NULL) WHERE id = 1`.execute(db);
  await sql`CREATE TRIGGER sync_buffer_immutable BEFORE UPDATE ON sync_buffer
    WHEN NEW.id != OLD.id OR NEW.category != OLD.category OR NEW.payload != OLD.payload
      OR (OLD.syncedAt IS NOT NULL AND (NEW.syncedAt IS NULL OR NEW.syncOutcome IS NOT OLD.syncOutcome))
    BEGIN SELECT raise(ABORT, 'Replication entries and released outcomes are immutable'); END`.execute(db);
}
