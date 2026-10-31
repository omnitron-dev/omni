import { createHash } from 'node:crypto';
import path from 'node:path';
import Database from 'better-sqlite3';
import { ensurePrivateDir, sealFile } from '../shared/private-files.js';

export interface JournalItem<T> { id: string; digest: string; value: T }
export interface LogFileIntent { offset: number; inode: number; prefix: string }
export interface LogJournalStats { pending: number; assembling: number; bytes: number; error: string | null }

/** Private, restart-safe delivery journal. Unacknowledged records are never evicted. */
export class LogJournal<T> {
  private readonly db: InstanceType<typeof Database>;
  private error: string | null = null;

  constructor(readonly filename: string, private readonly requireMirror = false) {
    if (filename !== ':memory:') ensurePrivateDir(path.dirname(filename));
    this.db = new Database(filename);
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = FULL');
    this.db.exec(`CREATE TABLE IF NOT EXISTS records (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
      payload TEXT NOT NULL, digest TEXT NOT NULL, writer INTEGER NOT NULL, delivered INTEGER NOT NULL DEFAULT 0, mirrored INTEGER NOT NULL DEFAULT 1, ready INTEGER NOT NULL CHECK(ready IN (0,1))
    ); CREATE INDEX IF NOT EXISTS records_ready ON records(ready, sequence);`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS file_intents (
      id TEXT NOT NULL, file TEXT NOT NULL, offset INTEGER NOT NULL, inode INTEGER NOT NULL, prefix TEXT NOT NULL,
      PRIMARY KEY(id,file)
    );`);
    this.db.exec('CREATE TABLE IF NOT EXISTS imported_files (name TEXT PRIMARY KEY, digest TEXT NOT NULL)');
    // A previous capture died while assembling these records. Their bytes and
    // original identities survive; further output belongs to a new process.
    for (const row of this.db.prepare('SELECT DISTINCT writer FROM records WHERE ready = 0').all() as Array<{ writer: number }>) {
      let alive = true;
      try { process.kill(row.writer, 0); } catch (error) { alive = (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
      if (!alive) this.db.prepare('UPDATE records SET ready = 1 WHERE ready = 0 AND writer = ?').run(row.writer);
    }
    this.db.exec(`CREATE TABLE IF NOT EXISTS totals (singleton INTEGER PRIMARY KEY CHECK(singleton=1), pending INTEGER NOT NULL, assembling INTEGER NOT NULL, bytes INTEGER NOT NULL);
      INSERT OR IGNORE INTO totals SELECT 1, COUNT(*), COALESCE(SUM(1-ready),0), COALESCE(SUM(LENGTH(CAST(payload AS BLOB))),0) FROM records;
      CREATE TRIGGER IF NOT EXISTS log_added AFTER INSERT ON records BEGIN
        UPDATE totals SET pending=pending+1, assembling=assembling+1-new.ready, bytes=bytes+LENGTH(CAST(new.payload AS BLOB)); END;
      CREATE TRIGGER IF NOT EXISTS log_changed AFTER UPDATE ON records BEGIN
        UPDATE totals SET assembling=assembling+old.ready-new.ready, bytes=bytes-LENGTH(CAST(old.payload AS BLOB))+LENGTH(CAST(new.payload AS BLOB)); END;
      CREATE TRIGGER IF NOT EXISTS log_removed AFTER DELETE ON records BEGIN
        UPDATE totals SET pending=pending-1, assembling=assembling-1+old.ready, bytes=bytes-LENGTH(CAST(old.payload AS BLOB)); END;`);
    if (filename !== ':memory:') sealFile(filename);
  }

  put(id: string, value: T, ready = true): void {
    const payload = JSON.stringify(value);
    const digest = createHash('sha256').update(payload).digest('hex');
    try {
      this.db.transaction(() => {
        const old = this.db.prepare('SELECT ready, digest FROM records WHERE id = ?').get(id) as { ready: number; digest: string } | undefined;
        if (old?.ready && old.digest !== digest) throw new Error(`Immutable log identity conflict: ${id}`);
        this.db.prepare(`INSERT INTO records(id, payload, digest, ready, writer, mirrored) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, digest=excluded.digest, ready=MAX(records.ready,excluded.ready)`)
          .run(id, payload, digest, ready ? 1 : 0, process.pid, this.requireMirror ? 0 : 1);
      })();
      this.error = null;
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  peek(limit = 500, maxBytes = 2 * 1024 * 1024, consumer: 'database' | 'file' = 'database'): JournalItem<T>[] {
    const result: JournalItem<T>[] = [];
    let bytes = 0;
    for (const row of this.db.prepare(`SELECT id, payload, digest FROM records WHERE ready = 1 AND ${consumer === 'file' ? 'mirrored' : 'delivered'} = 0 ORDER BY sequence LIMIT ?`).iterate(limit)) {
      const item = row as { id: string; payload: string; digest: string };
      if (createHash('sha256').update(item.payload).digest('hex') !== item.digest) {
        this.error = `Captured log checksum mismatch: ${item.id}`;
        throw new Error(this.error);
      }
      if (result.length && bytes + Buffer.byteLength(item.payload) > maxBytes) break;
      bytes += Buffer.byteLength(item.payload);
      result.push({ id: item.id, digest: item.digest, value: JSON.parse(item.payload) as T });
    }
    return result;
  }

  /** A lost acknowledgment may be retried. A changed or unfinished record cannot be acknowledged. */
  acknowledge(items: Array<Pick<JournalItem<T>, 'id' | 'digest'>>, consumer: 'database' | 'file' = 'database'): void {
    this.db.transaction(() => {
      for (const item of items) {
        const old = this.db.prepare('SELECT ready, digest FROM records WHERE id = ?').get(item.id) as { ready: number; digest: string } | undefined;
        if (!old) continue;
        if (!old.ready || old.digest !== item.digest) throw new Error(`Log acknowledgment does not match captured bytes: ${item.id}`);
        this.db.prepare(`UPDATE records SET ${consumer === 'file' ? 'mirrored' : 'delivered'} = 1 WHERE id = ?`).run(item.id);
        this.db.prepare('DELETE FROM records WHERE id = ? AND mirrored = 1 AND delivered = 1').run(item.id);
        if (consumer === 'file') this.db.prepare('DELETE FROM file_intents WHERE id = ?').run(item.id);
      }
    })();
  }

  fileIntent(id: string, file: string): LogFileIntent | undefined {
    return this.db.prepare('SELECT offset, inode, prefix FROM file_intents WHERE id = ? AND file = ?').get(id, file) as LogFileIntent | undefined;
  }

  prepareFile(id: string, file: string, intent: LogFileIntent): void {
    this.db.prepare('INSERT INTO file_intents(id,file,offset,inode,prefix) VALUES(?,?,?,?,?)')
      .run(id, file, intent.offset, intent.inode, intent.prefix);
  }

  hasFileIntent(file: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM file_intents WHERE file = ? LIMIT 1').get(file);
  }

  importedFile(name: string): string | undefined {
    return (this.db.prepare('SELECT digest FROM imported_files WHERE name = ?').get(name) as { digest: string } | undefined)?.digest;
  }

  importFile(name: string, digest: string, id: string, value: T): void {
    this.db.transaction(() => {
      const previous = this.importedFile(name);
      if (previous) {
        if (previous !== digest) throw new Error(`Imported startup evidence changed: ${name}`);
        return;
      }
      this.put(id, value);
      this.db.prepare('INSERT INTO imported_files(name,digest) VALUES(?,?)').run(name, digest);
    })();
  }

  stats(): LogJournalStats {
    const row = this.db.prepare('SELECT pending, assembling, bytes FROM totals WHERE singleton=1')
      .get() as Omit<LogJournalStats, 'error'>;
    return { ...row, error: this.error };
  }

  close(): void { this.db.close(); }
}
