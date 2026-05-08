/**
 * HardenedMigrationRunner unit tests.
 *
 * SQLite (better-sqlite3, in-memory) covers the core logic:
 *   - schema setup (migrations + migration_checksums tables)
 *   - up applies pending migrations in order, records names + checksums
 *   - re-running skips applied
 *   - down rolls back the last N (with bookkeeping cleanup)
 *   - failures inside a migration roll back the bookkeeping write
 *   - checksum drift halts up()
 *   - status() reports pending / executed / drift / missing files
 *   - backfill behavior on legacy DBs (already-applied rows without checksums)
 *
 * Postgres advisory-lock behavior is exercised by a fake-Kysely test —
 * we don't need a real postgres for that path because the runner only
 * issues `SELECT pg_try_advisory_lock(...)` and reads the boolean.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { Kysely, SqliteDialect, sql, type Kysely as KyselyType } from 'kysely';
import {
  HardenedMigrationRunner,
  MigrationLockError,
  MigrationChecksumError,
  type HardenedMigration,
} from '../../src/migration/index.js';

interface AnyDB {
  // Just enough to satisfy Kysely's generic.
  [key: string]: { [col: string]: unknown };
}

function makeDb(): Kysely<AnyDB> {
  return new Kysely<AnyDB>({
    dialect: new SqliteDialect({ database: new Database(':memory:') }),
  });
}

const m1: HardenedMigration = {
  name: '001_create_widgets',
  up: async (db) => {
    await sql`CREATE TABLE widgets (id integer primary key, name text not null)`.execute(
      db as unknown as Kysely<unknown>,
    );
  },
  down: async (db) => {
    await sql`DROP TABLE widgets`.execute(db as unknown as Kysely<unknown>);
  },
};

const m2: HardenedMigration = {
  name: '002_widget_color',
  up: async (db) => {
    await sql`ALTER TABLE widgets ADD COLUMN color text`.execute(
      db as unknown as Kysely<unknown>,
    );
  },
  down: async (db) => {
    // SQLite drop column requires recreate; skip in test
  },
};

const m3Failing: HardenedMigration = {
  name: '003_will_fail',
  up: async (db) => {
    await sql`CREATE TABLE widgets_v2 (id integer primary key)`.execute(
      db as unknown as Kysely<unknown>,
    );
    await sql`SELECT * FROM does_not_exist`.execute(db as unknown as Kysely<unknown>);
  },
  down: async () => {},
};

describe('HardenedMigrationRunner — core', () => {
  let db: Kysely<AnyDB>;
  beforeEach(() => {
    db = makeDb();
  });

  it('up applies migrations in order and records names + checksums', async () => {
    const runner = new HardenedMigrationRunner(db, [m1, m2], { dialect: 'other' });
    const r = await runner.up();
    expect(r.executed).toEqual(['001_create_widgets', '002_widget_color']);
    expect(r.skipped).toEqual([]);

    const recorded = (await sql<{ name: string }>`SELECT name FROM migrations ORDER BY name`.execute(
      db as unknown as KyselyType<unknown>,
    )) as { rows: { name: string }[] };
    expect(recorded.rows.map((r) => r.name)).toEqual(['001_create_widgets', '002_widget_color']);

    const checksums = (await sql<{
      name: string;
      checksum: string;
    }>`SELECT name, checksum FROM migration_checksums ORDER BY name`.execute(
      db as unknown as KyselyType<unknown>,
    )) as { rows: { name: string; checksum: string }[] };
    expect(checksums.rows).toHaveLength(2);
    expect(checksums.rows[0]!.checksum).toBe(HardenedMigrationRunner.computeChecksum(m1));
    expect(checksums.rows[1]!.checksum).toBe(HardenedMigrationRunner.computeChecksum(m2));
  });

  it('re-running up skips applied migrations', async () => {
    const runner = new HardenedMigrationRunner(db, [m1, m2], { dialect: 'other' });
    await runner.up();
    const r2 = await runner.up();
    expect(r2.executed).toEqual([]);
    expect(r2.skipped).toEqual(['001_create_widgets', '002_widget_color']);
  });

  it('down rolls back the last migration and cleans bookkeeping', async () => {
    const runner = new HardenedMigrationRunner(db, [m1], { dialect: 'other' });
    await runner.up();
    const r = await runner.down(1);
    expect(r.rolledBack).toEqual(['001_create_widgets']);

    const recorded = (await sql<{
      n: number;
    }>`SELECT COUNT(*) as n FROM migrations`.execute(
      db as unknown as KyselyType<unknown>,
    )) as { rows: { n: number }[] };
    expect(Number(recorded.rows[0]!.n)).toBe(0);

    const checksums = (await sql<{
      n: number;
    }>`SELECT COUNT(*) as n FROM migration_checksums`.execute(
      db as unknown as KyselyType<unknown>,
    )) as { rows: { n: number }[] };
    expect(Number(checksums.rows[0]!.n)).toBe(0);
  });

  it('failure inside a migration rolls back BOTH schema and bookkeeping (atomic)', async () => {
    const runner = new HardenedMigrationRunner(db, [m1, m3Failing], { dialect: 'other' });
    await expect(runner.up()).rejects.toThrow();

    // m1 was committed; m3 failed and left no bookkeeping row.
    const recorded = (await sql<{ name: string }>`SELECT name FROM migrations ORDER BY name`.execute(
      db as unknown as KyselyType<unknown>,
    )) as { rows: { name: string }[] };
    expect(recorded.rows.map((r) => r.name)).toEqual(['001_create_widgets']);

    // The half-applied table widgets_v2 must NOT exist (transaction rolled back).
    const tables = (await sql<{
      name: string;
    }>`SELECT name FROM sqlite_master WHERE type='table'`.execute(
      db as unknown as KyselyType<unknown>,
    )) as { rows: { name: string }[] };
    const tableNames = tables.rows.map((r) => r.name);
    expect(tableNames).toContain('widgets');
    expect(tableNames).not.toContain('widgets_v2');
  });

  it('checksum drift halts up() with MigrationChecksumError', async () => {
    const runner = new HardenedMigrationRunner(db, [m1], { dialect: 'other' });
    await runner.up();

    // Edit the source: a different m1 with same name but different body.
    const m1Edited: HardenedMigration = {
      name: '001_create_widgets',
      up: async (innerDb) => {
        await sql`CREATE TABLE widgets (id integer primary key, name text, extra text)`.execute(
          innerDb as unknown as Kysely<unknown>,
        );
      },
      down: m1.down,
    };

    const runner2 = new HardenedMigrationRunner(db, [m1Edited], { dialect: 'other' });
    await expect(runner2.up()).rejects.toThrow(MigrationChecksumError);
  });

  it('enforceChecksums:false bypasses drift check', async () => {
    const runner = new HardenedMigrationRunner(db, [m1], { dialect: 'other' });
    await runner.up();
    const m1Edited: HardenedMigration = { ...m1, up: async () => {} };
    const runner2 = new HardenedMigrationRunner(db, [m1Edited], {
      dialect: 'other',
      enforceChecksums: false,
    });
    // Should not throw — migration is already applied so it's just skipped.
    const r = await runner2.up();
    expect(r.skipped).toEqual(['001_create_widgets']);
  });

  it('status reports executed / pending / drift / missing files', async () => {
    const runner = new HardenedMigrationRunner(db, [m1, m2], { dialect: 'other' });
    await runner.up();

    // Now the files only have m1 (m2 file got deleted) and m1 was edited.
    const m1Edited: HardenedMigration = {
      name: '001_create_widgets',
      up: async () => {},
      down: m1.down,
    };
    const runner2 = new HardenedMigrationRunner(db, [m1Edited], { dialect: 'other' });
    const s = await runner2.status();
    expect(s.executed.map((e) => e.name)).toEqual(['001_create_widgets', '002_widget_color']);
    expect(s.pending).toEqual([]);
    expect(s.drift.map((d) => d.name)).toEqual(['001_create_widgets']);
    expect(s.missingFiles).toEqual(['002_widget_color']);
  });

  it('backfills missing checksums from legacy executions', async () => {
    // Simulate legacy: kysera-style runs without checksum sidecar.
    const { setupMigrations: kyseraSetup } = await import('@kysera/migrations');
    await kyseraSetup(db as unknown as KyselyType<unknown>);
    await m1.up(db);
    await sql`INSERT INTO migrations (name) VALUES ('001_create_widgets')`.execute(
      db as unknown as KyselyType<unknown>,
    );

    const runner = new HardenedMigrationRunner(db, [m1], { dialect: 'other' });
    await runner.up();

    const checksums = (await sql<{
      name: string;
    }>`SELECT name FROM migration_checksums`.execute(
      db as unknown as KyselyType<unknown>,
    )) as { rows: { name: string }[] };
    expect(checksums.rows.map((r) => r.name)).toEqual(['001_create_widgets']);
  });

  it('backfillMissingChecksums:false leaves legacy rows alone', async () => {
    const { setupMigrations: kyseraSetup } = await import('@kysera/migrations');
    await kyseraSetup(db as unknown as KyselyType<unknown>);
    await m1.up(db);
    await sql`INSERT INTO migrations (name) VALUES ('001_create_widgets')`.execute(
      db as unknown as KyselyType<unknown>,
    );

    const runner = new HardenedMigrationRunner(db, [m1], {
      dialect: 'other',
      backfillMissingChecksums: false,
    });
    await runner.up();

    const checksums = (await sql<{ name: string }>`SELECT name FROM migration_checksums`.execute(
      db as unknown as KyselyType<unknown>,
    )) as { rows: { name: string }[] };
    expect(checksums.rows).toEqual([]);
  });

  it('down does NOT throw on checksum drift — only warns', async () => {
    const runner = new HardenedMigrationRunner(db, [m1], { dialect: 'other' });
    await runner.up();
    const warnings: string[] = [];
    const m1Edited: HardenedMigration = {
      name: m1.name,
      up: async () => {},
      down: m1.down,
    };
    const runner2 = new HardenedMigrationRunner(db, [m1Edited], {
      dialect: 'other',
      logger: {
        info: () => {},
        warn: (s) => warnings.push(s),
        error: () => {},
      },
    });
    const r = await runner2.down(1);
    expect(r.rolledBack).toEqual(['001_create_widgets']);
    expect(warnings.find((w) => w.includes('checksum drift'))).toBeTruthy();
  });
});

describe('HardenedMigrationRunner — advisory lock', () => {
  it('refuses to run when the lock provider returns false', async () => {
    const db = makeDb();
    const provider = {
      acquire: async () => false,
      release: async () => {},
    };
    const runner = new HardenedMigrationRunner(db, [m1], {
      dialect: 'postgres',
      lockProvider: provider,
    });
    await expect(runner.up()).rejects.toThrow(MigrationLockError);
  });

  it('acquires and releases the lock around up()', async () => {
    const db = makeDb();
    let acquireCalls = 0;
    let releaseCalls = 0;
    const seen: bigint[] = [];
    const provider = {
      acquire: async (key: bigint) => {
        acquireCalls++;
        seen.push(key);
        return true;
      },
      release: async (_key: bigint) => {
        releaseCalls++;
      },
    };
    const runner = new HardenedMigrationRunner(db, [m1], {
      dialect: 'postgres',
      lockProvider: provider,
      advisoryLockKey: 0xdeadbeefn,
    });
    const r = await runner.up();
    expect(r.executed).toEqual(['001_create_widgets']);
    expect(acquireCalls).toBe(1);
    expect(releaseCalls).toBe(1);
    expect(seen).toEqual([0xdeadbeefn]);
  });

  it('releases the lock even when up() throws', async () => {
    const db = makeDb();
    let releaseCalls = 0;
    const provider = {
      acquire: async () => true,
      release: async () => {
        releaseCalls++;
      },
    };
    const runner = new HardenedMigrationRunner(db, [m1, m3Failing], {
      dialect: 'postgres',
      lockProvider: provider,
    });
    await expect(runner.up()).rejects.toThrow();
    expect(releaseCalls).toBe(1);
  });

  it('skips the lock when dialect=other', async () => {
    const db = makeDb();
    let acquireCalls = 0;
    const provider = {
      acquire: async () => {
        acquireCalls++;
        return false;
      },
      release: async () => {},
    };
    const runner = new HardenedMigrationRunner(db, [m1], {
      dialect: 'other',
      lockProvider: provider,
    });
    const r = await runner.up();
    expect(r.executed).toEqual(['001_create_widgets']);
    expect(acquireCalls).toBe(0);
  });
});
