/**
 * The backup directory kept 75.6 MiB that no listing could see.
 *
 * Measured on the master, 2026-09-23: 28 files, 79 300 253 bytes, in
 * `~/.omnitron/backups` and in no index row — so `backup list` never showed
 * them and retention never pruned them:
 *
 *     23 zero-byte files        22 `tor-keys`, 1 `storage`
 *      2 `main_…sql.gz.partial`  7 150 144 B and 70 477 299 B — the daemon
 *                                restarted mid-dump at 13:15:43Z and 21:15:47Z
 *                                on 09-21; no catch runs in a process that is
 *                                gone, so nothing ever removed them
 *      3 truncated archives      98 304 B, 1 574 384 B, 122 B
 *
 * plus 102 SQLite sidecars (51 `-shm` of 32 768 B, 51 `-wal` of 0 B). Their
 * source was reproduced with `/usr/bin/sqlite3` 3.51.0: `.backup` copies the
 * live store's WAL flag into the copy's header, and Apple's build keeps both
 * files after it closes a WAL database. So the integrity check on
 * `<name>.db.partial` left `<name>.db.partial-shm/-wal` behind the rename
 * (3 pairs, one per `full` pass since staging landed), and `deleteBackup`
 * removed a pruned `.db` without the pair beside it (4 pairs).
 *
 * And `backup list` printed `new Date(createdAt).toLocaleString()` — local
 * time with no zone — next to filenames that carry UTC.
 *
 * These run against a real directory and a real SQLite index, because the
 * subject is what is left on disk.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const env = vi.hoisted(() => ({ home: '' }));
vi.mock('../../src/shared/paths.js', () => ({
  expandPath: (p: string) => (p === '~' || p.startsWith('~/') ? env.home + p.slice(1) : p),
}));

const printed: Array<{ level: string; text: string }> = [];
vi.mock('@xec-sh/kit', () => ({
  log: {
    info: (t: string) => printed.push({ level: 'info', text: t }),
    success: (t: string) => printed.push({ level: 'success', text: t }),
    warn: (t: string) => printed.push({ level: 'warn', text: t }),
    error: (t: string) => printed.push({ level: 'error', text: t }),
  },
}));

const rpc: Record<string, (arg?: unknown) => unknown> = {};
vi.mock('../../src/daemon/daemon-client.js', () => ({
  createDaemonClient: () => ({
    isReachable: async () => true,
    disconnect: async () => undefined,
    service: async () =>
      new Proxy(
        {},
        {
          get: (_t, prop: string) => {
            if (prop === 'then') return undefined;
            if (!(prop in rpc)) throw new Error(`Unknown member: '${prop}' is not defined in the service interface`);
            return rpc[prop];
          },
        },
      ),
  }),
}));

const { BackupService } = await import('../../src/services/backup.service.js');
const { DaemonStateStore } = await import('../../src/daemon/daemon-state-store.service.js');
const { backupListCommand } = await import('../../src/commands/backup.js');

type Line = { level: string; obj: Record<string, unknown>; msg: string };

function fakeLogger(): { module: never; logger: never; lines: Line[] } {
  const lines: Line[] = [];
  const at = (level: string) => (obj: Record<string, unknown>, msg?: string) =>
    lines.push({ level, obj: obj ?? {}, msg: msg ?? '' });
  const logger: Record<string, unknown> = {
    info: at('info'),
    warn: at('warn'),
    error: at('error'),
    debug: at('debug'),
    trace: at('trace'),
    fatal: at('fatal'),
  };
  logger['child'] = () => logger;
  return { module: { logger } as never, logger: logger as never, lines };
}

let dir: string;
let backups: string;
let store: InstanceType<typeof DaemonStateStore>;

function put(name: string, bytes: number): string {
  const file = path.join(backups, name);
  fs.writeFileSync(file, Buffer.alloc(bytes, 7));
  return file;
}
const there = (name: string): boolean => fs.existsSync(path.join(backups, name));

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-leftovers-'));
  env.home = dir;
  backups = path.join(dir, '.omnitron', 'backups');
  fs.mkdirSync(backups, { recursive: true });
  store = new DaemonStateStore(fakeLogger().logger, path.join(dir, '.omnitron', 'data', 'daemon-state.db'));
  printed.length = 0;
  for (const k of Object.keys(rpc)) delete rpc[k];
});

afterEach(async () => {
  await store.dispose();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('what an interrupted pass leaves is removed when the daemon starts', () => {
  it('removes interrupted dumps, empty files and orphaned sidecars — and counts them', () => {
    // The shapes measured on the master, by name and size.
    put('main_2026-09-21T13-13-05-468Z_b10c629e.sql.gz.partial', 7_150);
    put('main_2026-09-21T21-08-43-854Z_411e1fd4.sql.gz.partial', 70_477);
    put('tor-keys_2026-07-15T07-52-05-437Z_e2cc2a45.tar.gz', 0);
    put('storage_2026-09-05T12-11-53-404Z_fa80b412.sql.gz', 0);
    // Our own integrity check's pair, named after a staging file renamed away.
    put('daemon-state_2026-09-19T17-18-04-620Z_0dcf9f7a.db.partial-shm', 32_768);
    put('daemon-state_2026-09-19T17-18-04-620Z_0dcf9f7a.db.partial-wal', 0);
    // A pair whose `.db` retention pruned.
    put('daemon-state_2026-07-19T14-36-36-110Z_8a4a8529.db-shm', 32_768);
    put('daemon-state_2026-07-19T14-36-36-110Z_8a4a8529.db-wal', 0);
    // What an interrupted storage pass leaves: its scratch directory.
    fs.mkdirSync(path.join(backups, '.storage-stage-0a1b2c3d', '_bk_storage'), { recursive: true });
    fs.writeFileSync(path.join(backups, '.storage-stage-0a1b2c3d', '_bk_storage', 'object'), Buffer.alloc(500));

    const { module, lines } = fakeLogger();
    new BackupService(module, store);

    for (const gone of [
      'main_2026-09-21T13-13-05-468Z_b10c629e.sql.gz.partial',
      'main_2026-09-21T21-08-43-854Z_411e1fd4.sql.gz.partial',
      'tor-keys_2026-07-15T07-52-05-437Z_e2cc2a45.tar.gz',
      'storage_2026-09-05T12-11-53-404Z_fa80b412.sql.gz',
      'daemon-state_2026-09-19T17-18-04-620Z_0dcf9f7a.db.partial-shm',
      'daemon-state_2026-09-19T17-18-04-620Z_0dcf9f7a.db.partial-wal',
      'daemon-state_2026-07-19T14-36-36-110Z_8a4a8529.db-shm',
      'daemon-state_2026-07-19T14-36-36-110Z_8a4a8529.db-wal',
      '.storage-stage-0a1b2c3d',
    ]) {
      expect(there(gone), `${gone} survived the start`).toBe(false);
    }

    const said = lines.find((l) => l.level === 'warn' && /Removed 9 leftover file/.test(l.msg));
    expect(said, 'the removal must be logged with its count').toBeDefined();
    expect(said!.obj['files']).toBe(9);
    expect(said!.obj['bytes']).toBe(7_150 + 70_477 + 32_768 + 32_768 + 500);
  });

  it('keeps what is not provably garbage, and names what no index holds', () => {
    // A good backup, indexed.
    const good = put('geo_2026-09-23T08-19-04-290Z_a63dbcf4.sql.gz', 2_294);
    store.insertBackupSync({ id: 'a63dbcf4-0000-4000-8000-000000000001', app: 'geo', path: good, size_bytes: 2_294 });
    // A sidecar pair beside a backup that still exists: something may hold it.
    put('daemon-state_2026-09-01T14-45-27-942Z_5ed46a02.db', 192_512);
    put('daemon-state_2026-09-01T14-45-27-942Z_5ed46a02.db-shm', 32_768);
    put('daemon-state_2026-09-01T14-45-27-942Z_5ed46a02.db-wal', 0);
    // An orphaned pair whose WAL still holds frames: kept, and said.
    put('daemon-state_2026-07-21T11-47-55-830Z_ac32c3cd.db-shm', 32_768);
    put('daemon-state_2026-07-21T11-47-55-830Z_ac32c3cd.db-wal', 4_096);
    // One of the three truncated archives: content, and no row.
    put('main_2026-09-14T07-51-04-542Z_a50d8328.sql.gz', 98_304);

    const { module, lines } = fakeLogger();
    new BackupService(module, store);

    for (const kept of [
      'geo_2026-09-23T08-19-04-290Z_a63dbcf4.sql.gz',
      'daemon-state_2026-09-01T14-45-27-942Z_5ed46a02.db-shm',
      'daemon-state_2026-09-01T14-45-27-942Z_5ed46a02.db-wal',
      'daemon-state_2026-07-21T11-47-55-830Z_ac32c3cd.db-shm',
      'daemon-state_2026-07-21T11-47-55-830Z_ac32c3cd.db-wal',
      'main_2026-09-14T07-51-04-542Z_a50d8328.sql.gz',
    ]) {
      expect(there(kept), `${kept} was removed`).toBe(true);
    }

    const stray = lines.find((l) => l.level === 'warn' && /in no index/.test(l.msg));
    expect(stray, 'files outside the index must be named').toBeDefined();
    const names = (stray!.obj['names'] as string[]).join(' ');
    expect(names).toContain('main_2026-09-14T07-51-04-542Z_a50d8328.sql.gz');
    // The unindexed `.db` beside its sidecars is a file too — named, not hidden.
    expect(names).toContain('daemon-state_2026-09-01T14-45-27-942Z_5ed46a02.db');
    expect(names, 'an indexed backup is not a stray').not.toContain('geo_');
    expect(names, 'a sidecar is not a backup').not.toContain('-shm');
    expect(lines.some((l) => l.level === 'warn' && /still hold WAL frames/.test(l.msg))).toBe(true);
  });

  it('a start with nothing to remove says nothing about removing', () => {
    const { module, lines } = fakeLogger();
    new BackupService(module, store);
    expect(lines.filter((l) => l.level === 'warn')).toEqual([]);
  });
});

describe('retention takes the sidecars with the database', () => {
  it('deleteBackup removes the -shm and -wal beside the file it deletes', async () => {
    const service = new BackupService(fakeLogger().module, store);
    const db = put('daemon-state_2026-07-23T11-35-18-957Z_0bd59213.db', 192_512);
    put('daemon-state_2026-07-23T11-35-18-957Z_0bd59213.db-shm', 32_768);
    put('daemon-state_2026-07-23T11-35-18-957Z_0bd59213.db-wal', 0);
    store.insertBackupSync({
      id: '0bd59213-0000-4000-8000-000000000002',
      app: 'daemon-state',
      path: db,
      size_bytes: 192_512,
      metadata: { filename: path.basename(db), type: 'daemon-state' },
    });

    await service.deleteBackup('0bd59213-0000-4000-8000-000000000002');

    expect(fs.readdirSync(backups).filter((n) => n.includes('0bd59213'))).toEqual([]);
  });
});

const hasSqlite3 = (() => {
  try {
    execFileSync('sqlite3', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

/**
 * The persistence of `-shm`/`-wal` after close is Apple's build; a stock
 * Linux `sqlite3` deletes them, and there this passes with or without the fix.
 * On macOS — where the daemon runs and the pairs were measured — it does not.
 */
describe.runIf(hasSqlite3)('a daemon-state backup is one file', () => {
  it('leaves no sidecar under any name, and opening it later leaves none either', async () => {
    // The live store is WAL-mode, as the daemon's is; its path is the one
    // `createSecretsBackup` copies.
    store.kvSetSync('probe', { rows: 1 });
    const service = new BackupService(fakeLogger().module, store);

    const info = await service.createSecretsBackup();

    const beside = fs.readdirSync(backups).filter((n) => n.startsWith('daemon-state_'));
    expect(beside, 'the check left files beside the backup').toEqual([info.filename]);

    const backup = path.join(backups, info.filename);
    const mode = execFileSync('sqlite3', [backup, 'PRAGMA journal_mode;'], { encoding: 'utf8' }).trim();
    expect(mode, 'a WAL-mode backup grows a sidecar pair every time it is opened').toBe('delete');
    expect(fs.readdirSync(backups).filter((n) => n.startsWith('daemon-state_'))).toEqual([info.filename]);
    expect(execFileSync('sqlite3', [backup, "SELECT value FROM state_kv WHERE key = 'probe';"], { encoding: 'utf8' }).trim())
      .toBe('{"rows":1}');
  });
});

describe('backup list', () => {
  it('prints when a backup was taken in UTC, as its filename does', async () => {
    rpc['listBackups'] = async () => [
      {
        id: 'a63dbcf4-8f0e-4b8e-9d7c-2a1b3c4d5e6f',
        database: 'geo',
        filename: 'geo_2026-09-23T08-19-04-290Z_a63dbcf4.sql.gz',
        size: 2_294,
        createdAt: '2026-09-23T08:19:04.742Z',
        compressed: true,
      },
    ];

    await backupListCommand();

    const out = printed.map((p) => p.text).join('\n');
    expect(out).toContain('2026-09-23T08:19:04Z');
    expect(out).toMatch(/UTC/);
  });
});
