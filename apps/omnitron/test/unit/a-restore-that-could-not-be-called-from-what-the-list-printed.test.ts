/**
 * `backup restore <id>` could not be called from anything the CLI printed.
 *
 * `restoreBackup` compared its argument with `===` against a full UUID. What
 * the operator could see, measured on the master:
 *
 *   - `backup list` printed Database, Filename cut to 24 characters, Size and
 *     Created. The id is in the filename — after the cut:
 *     `geo_2026-09-23T08-19-04-` is what showed of
 *     `geo_2026-09-23T08-19-04-290Z_a63dbcf4.sql.gz`.
 *   - `backup create` printed `[a63dbcf4]`, eight characters, which restore
 *     then answered with "Backup 'a63dbcf4' not found".
 *
 * So the one command whose whole purpose is to be reached for in a hurry had
 * no input the tool itself would give you. Now the list prints the id first,
 * and restore takes any unambiguous prefix of it — refusing, with every
 * candidate named, a prefix that matches more than one.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
const { backupListCommand, backupRestoreCommand } = await import('../../src/commands/backup.js');

function quietLogger(): { module: never; logger: never } {
  const logger: Record<string, unknown> = {};
  for (const level of ['info', 'warn', 'error', 'debug', 'trace', 'fatal']) logger[level] = () => undefined;
  logger['child'] = () => logger;
  return { module: { logger } as never, logger: logger as never };
}

/** Three rows as the master lists them. */
const LISTED = [
  {
    id: 'a63dbcf4-8f0e-4b8e-9d7c-2a1b3c4d5e6f',
    database: 'geo',
    filename: 'geo_2026-09-23T08-19-04-290Z_a63dbcf4.sql.gz',
    size: 2_294,
    createdAt: '2026-09-23T08:19:04.742Z',
    compressed: true,
  },
  {
    id: 'c3ae4755-1d2c-4f3e-8a9b-0c1d2e3f4a5b',
    database: 'messaging',
    filename: 'messaging_2026-09-23T08-19-03-932Z_c3ae4755.sql.gz',
    size: 130_257,
    createdAt: '2026-09-23T08:19:04.289Z',
    compressed: true,
  },
  {
    id: 'a63d1111-2222-4333-8444-555566667777',
    database: 'main',
    filename: 'main_2026-09-23T08-18-17-763Z_a63d1111.sql.gz',
    size: 100_765_511,
    createdAt: '2026-09-23T08:19:00.187Z',
    compressed: true,
  },
];

const restored: unknown[] = [];

beforeEach(() => {
  printed.length = 0;
  restored.length = 0;
  for (const k of Object.keys(rpc)) delete rpc[k];
  rpc['listBackups'] = async () => LISTED;
  rpc['restoreBackup'] = async (arg) => {
    restored.push(arg);
    return { success: true };
  };
});

describe('the CLI restores from what it prints', () => {
  it('the ID that backup list prints is one that backup restore takes', async () => {
    await backupListCommand();
    const row = printed.map((p) => p.text).find((t) => t.includes('messaging_2026'));
    expect(row, 'the messaging backup is not in the list').toBeDefined();
    const token = row!.trim().split(/\s+/)[0]!;

    expect(LISTED[1]!.id.startsWith(token), `the first column (${token}) is not the id`).toBe(true);
    expect(token.length).toBeGreaterThanOrEqual(8);

    printed.length = 0;
    await backupRestoreCommand(token);

    expect(restored).toEqual([{ backupId: LISTED[1]!.id }]);
    expect(printed.some((p) => p.level === 'success')).toBe(true);
  });

  it('the eight characters backup create prints are enough', async () => {
    await backupRestoreCommand('c3ae4755');

    expect(restored).toEqual([{ backupId: 'c3ae4755-1d2c-4f3e-8a9b-0c1d2e3f4a5b' }]);
    // And the operator is told which backup that was before it happened.
    expect(printed.map((p) => p.text).join('\n')).toContain('messaging');
  });

  it('prints the whole filename, not the first 24 characters of it', async () => {
    await backupListCommand();
    expect(printed.map((p) => p.text).join('\n')).toContain('geo_2026-09-23T08-19-04-290Z_a63dbcf4.sql.gz');
  });

  it('refuses an ambiguous prefix, naming every match, and restores nothing', async () => {
    await backupRestoreCommand('a63d');

    expect(restored).toEqual([]);
    const said = printed.filter((p) => p.level === 'error').map((p) => p.text).join('\n');
    expect(said).toContain('a63dbcf4-8f0e-4b8e-9d7c-2a1b3c4d5e6f');
    expect(said).toContain('a63d1111-2222-4333-8444-555566667777');
  });
});

describe('the daemon takes a prefix too', () => {
  let dir: string;
  let store: InstanceType<typeof DaemonStateStore>;
  let service: InstanceType<typeof BackupService>;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-prefix-'));
    env.home = dir;
    fs.mkdirSync(path.join(dir, '.omnitron', 'backups'), { recursive: true });
    store = new DaemonStateStore(quietLogger().logger, path.join(dir, '.omnitron', 'data', 'daemon-state.db'));
    service = new BackupService(quietLogger().module, store);
    for (const [id, name] of [
      ['0dcf9f7a-aaaa-4bbb-8ccc-dddddddddddd', 'daemon-state_2026-09-19T17-18-04-620Z_0dcf9f7a.db'],
      ['0dcf1234-aaaa-4bbb-8ccc-eeeeeeeeeeee', 'daemon-state_2026-09-18T17-18-04-282Z_0dcf1234.db'],
    ] as const) {
      const file = path.join(dir, '.omnitron', 'backups', name);
      fs.writeFileSync(file, 'SQLite format 3\0');
      store.insertBackupSync({
        id,
        app: 'daemon-state',
        path: file,
        size_bytes: 16,
        metadata: { filename: name, type: 'daemon-state' },
      });
    }
  });

  afterEach(async () => {
    await store.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('resolves a unique prefix to its backup', async () => {
    // A daemon-state backup is the one restore that refuses on purpose, AFTER
    // the row is found — so its refusal is proof the prefix resolved.
    await expect(service.restoreBackup('0dcf9f7a')).rejects.toThrow(/Refusing to restore daemon-state/);
  });

  it('refuses an ambiguous prefix and names both candidates', async () => {
    const attempt = service.restoreBackup('0dcf');
    await expect(attempt).rejects.toThrow(/matches 2 backups/);
    await expect(attempt).rejects.toThrow(/0dcf9f7a-aaaa-4bbb-8ccc-dddddddddddd/);
    await expect(attempt).rejects.toThrow(/0dcf1234-aaaa-4bbb-8ccc-eeeeeeeeeeee/);
  });

  it('refuses a prefix too short to mean one backup on purpose', async () => {
    await expect(service.restoreBackup('0d')).rejects.toThrow(/at least 4 characters/);
  });

  it('still takes the full id', async () => {
    await expect(service.restoreBackup('0dcf1234-aaaa-4bbb-8ccc-eeeeeeeeeeee')).rejects.toThrow(
      /Refusing to restore daemon-state/,
    );
  });
});
