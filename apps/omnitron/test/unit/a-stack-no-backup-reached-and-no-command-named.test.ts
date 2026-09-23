/**
 * A stack no backup reached, and no command said so.
 *
 * Measured on the master, 2026-09-23: `omnitron backup list` printed «Found
 * 380 backup(s)» and `backup schedules` «all hourly», «full daily». Every
 * `all` pass was `createAllBackups complete {"total":6}` — the six databases
 * of daos/dev, from the local `daos-dev-postgres`. The test stack's database
 * container runs on the node 37.27.130.185, not on the master, and
 * `buildStackDbMap` skipped it with `if (!infra) continue`: a remote stack has
 * no InfrastructureService here. The index row held id, database, filename,
 * size, createdAt, compressed — no stack — so no listing could have shown it.
 *
 * Two more defects of the same map:
 *   - `if (!map.has(db))` — «first stack wins». `createAllBackups` iterated
 *     bare names, so a second local stack's `main` was never dumped, and a
 *     restore of `main` went into whichever stack came first.
 *   - `createFullBackup` did not include the control-plane database
 *     `omnitron` (the audit log): its one copy, 2026-09-05T07:39Z, was made
 *     by hand.
 *
 * Remote backups are NOT implemented here — the gap is made visible and the
 * rest made honest.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const env = vi.hoisted(() => ({ home: '' }));
vi.mock('../../src/shared/paths.js', () => ({
  expandPath: (p: string) => (p === '~' || p.startsWith('~/') ? env.home + p.slice(1) : p),
}));

/** Dumps and restores are recorded, not run: the subject is what they are pointed at. */
const calls = vi.hoisted(() => ({
  dumps: [] as Array<{ command: string; args: string[]; out: string }>,
  restores: [] as Array<{ command: string; args: string[]; file: string }>,
}));
vi.mock('../../src/services/backup-pipeline.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/services/backup-pipeline.js')>();
  const nodeFs = await import('node:fs');
  return {
    ...real,
    dumpToFile: async (command: string, args: string[], out: string) => {
      calls.dumps.push({ command, args, out });
      nodeFs.writeFileSync(out, 'dump');
    },
    restoreFromFile: async (command: string, args: string[], file: string) => {
      calls.restores.push({ command, args, file });
    },
  };
});

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
const { resetEnvCache } = await import('../../src/shared/env-config.js');
const { backupListCommand, backupSchedulesCommand, backupCreateCommand } = await import('../../src/commands/backup.js');

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

type StackSpec = { project: string; stack: string; type: 'local' | 'remote'; hosts?: string[]; databases?: string[] };

/** ProjectService as the backup service reads it: running stacks, and the infrastructure here. */
function fakeProjects(specs: StackSpec[]): never {
  const find = (p: string, s: string) => specs.find((x) => x.project === p && x.stack === s);
  return {
    listProjects: () => [...new Set(specs.map((s) => s.project))].map((name) => ({ name })),
    getRunningStacks: (p: string) => specs.filter((s) => s.project === p).map((s) => s.stack),
    getInfraManager: () => ({
      getInstance: (p: string, s: string) => {
        const spec = find(p, s);
        if (!spec || spec.type !== 'local') return null;
        return {
          getConnectionInfo: (svc: string) =>
            svc === 'postgres' ? { host: 'localhost', port: 5432, user: 'postgres', password: 'pw' } : null,
          getResolvedContainerName: (svc: string) => `${p}-${s}-${svc}`,
          getPostgresDatabases: () => spec.databases ?? [],
        };
      },
    }),
    getStack: (p: string, s: string) => {
      const spec = find(p, s)!;
      const nodes = spec.type === 'local' ? [{ host: 'localhost' }] : (spec.hosts ?? []).map((host) => ({ host }));
      return { name: s, type: spec.type, nodes, config: { type: spec.type } };
    },
  } as never;
}

const SIX = ['main', 'storage', 'priceverse', 'paysys', 'messaging', 'geo'];
/** The master: daos/dev here, daos/test on the node. */
const MASTER: StackSpec[] = [
  { project: 'daos', stack: 'dev', type: 'local', databases: SIX },
  { project: 'daos', stack: 'test', type: 'remote', hosts: ['37.27.130.185'] },
];
/** Two local stacks that both have a `main` — `shop` iterated first. */
const TWO_MAINS: StackSpec[] = [
  { project: 'shop', stack: 'dev', type: 'local', databases: ['main'] },
  { project: 'daos', stack: 'dev', type: 'local', databases: ['main', 'geo'] },
];

let dir: string;
let backups: string;
let store: InstanceType<typeof DaemonStateStore>;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-stacks-'));
  env.home = dir;
  backups = path.join(dir, '.omnitron', 'backups');
  fs.mkdirSync(backups, { recursive: true });
  store = new DaemonStateStore(fakeLogger().logger, path.join(dir, '.omnitron', 'data', 'daemon-state.db'));
  calls.dumps.length = 0;
  calls.restores.length = 0;
  printed.length = 0;
  for (const k of Object.keys(rpc)) delete rpc[k];
  delete process.env['OMNITRON_DATABASE_URL'];
  resetEnvCache();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await store.dispose();
  fs.rmSync(dir, { recursive: true, force: true });
});

const dumpedFrom = (): string[] => calls.dumps.map((d) => `${d.args[1]}:${d.args[d.args.length - 1]}`);

describe('a stack whose databases are not here is named, not skipped', () => {
  it('the status says daos/test is not backed up, and where its databases are', async () => {
    const service = new BackupService(fakeLogger().module, store, fakeProjects(MASTER));

    const { stacks } = await service.getStatus();

    expect(stacks).toEqual([
      { project: 'daos', stack: 'dev', databases: SIX },
      { project: 'daos', stack: 'test', databases: [], notBackedUp: 'its databases are on 37.27.130.185' },
    ]);
  });

  it('every all pass reports the stack it could not reach, and still counts only what it dumped', async () => {
    const log = fakeLogger();
    const service = new BackupService(log.module, store, fakeProjects(MASTER));

    const results = await service.createAllBackups();

    expect(results.filter((r) => r.ok)).toHaveLength(6);
    expect(results).toContainEqual(
      expect.objectContaining({ database: 'daos/test', ok: false, skipped: true, error: 'not backed up — its databases are on 37.27.130.185' }),
    );
    const gap = log.lines.find((l) => l.level === 'warn' && /could not back up/.test(l.msg));
    expect(gap?.msg).toContain('daos/test');
    // A known gap is not a failed dump: the pass itself is whole.
    const summary = log.lines.find((l) => /createAllBackups complete/.test(l.msg));
    expect(summary?.obj['outcome']).toBe('ok');
    expect(summary?.obj['total']).toBe(6);
  });
});

describe('each backup records the stack it came from', () => {
  it('the index row and the listing carry project and stack', async () => {
    const service = new BackupService(fakeLogger().module, store, fakeProjects(MASTER));

    await service.createAllBackups();
    const listed = await service.listBackups();

    expect(listed).toHaveLength(6);
    for (const b of listed) {
      expect(b).toMatchObject({ project: 'daos', stack: 'dev', scope: 'stack' });
    }
    expect(dumpedFrom()).toEqual(SIX.map((db) => `daos-dev-postgres:${db}`));
  });

  it('a second stack with a database of the same name is dumped too', async () => {
    const service = new BackupService(fakeLogger().module, store, fakeProjects(TWO_MAINS));

    await service.createAllBackups();

    // «first stack wins» dumped one `main`, from whichever stack came first.
    expect(dumpedFrom().sort()).toEqual(['daos-dev-postgres:geo', 'daos-dev-postgres:main', 'shop-dev-postgres:main']);
    // And the files are named for the database, not for a key with slashes.
    expect(fs.readdirSync(backups).every((n) => !n.includes('/') && /^(main|geo)_/.test(n))).toBe(true);
  });

  it('a bare name two stacks share is refused, naming both', async () => {
    const service = new BackupService(fakeLogger().module, store, fakeProjects(TWO_MAINS));

    await expect(service.createBackup('main')).rejects.toThrow(/shop\/dev\/main.*daos\/dev\/main|daos\/dev\/main.*shop\/dev\/main/);
    expect(calls.dumps).toEqual([]);
  });
});

describe('a restore goes where the backup came from', () => {
  it('a daos/dev backup of main is restored into daos/dev, even when another stack is first', async () => {
    const service = new BackupService(fakeLogger().module, store, fakeProjects(TWO_MAINS));
    const file = path.join(backups, 'main_2026-09-23T08-18-17-763Z_a66402d0.sql.gz');
    fs.writeFileSync(file, 'dump');
    store.insertBackupSync({
      id: 'a66402d0-0000-4000-8000-000000000000',
      app: 'main',
      path: file,
      size_bytes: 4,
      metadata: { filename: path.basename(file), compressed: true, type: 'postgres', project: 'daos', stack: 'dev', scope: 'stack' },
    });

    await service.restoreBackup('a66402d0');

    expect(calls.restores.map((r) => r.args[2])).toEqual(['daos-dev-postgres']);
  });
});

describe('full includes the control plane', () => {
  it('dumps the omnitron database through omnitron-pg and records it as the control plane', async () => {
    const service = new BackupService(fakeLogger().module, store, fakeProjects(MASTER));

    const results = await service.createFullBackup();

    expect(results).toContainEqual(expect.objectContaining({ target: 'omnitron', ok: true }));
    expect(calls.dumps.map((d) => d.args)).toContainEqual(['exec', 'omnitron-pg', 'pg_dump', '-U', 'omnitron', '-d', 'omnitron']);
    const row = (await service.listBackups('omnitron'))[0];
    expect(row).toMatchObject({ database: 'omnitron', scope: 'control-plane' });
  });
});

describe('retention keeps each stack its own history', () => {
  /** Rows of `main`, one a minute back from 2026-09-23T08:00Z, with files behind them. */
  function rows(n: number, origin: Record<string, string>, tag: string): void {
    for (let i = 0; i < n; i++) {
      const at = new Date(Date.parse('2026-09-23T08:00:00Z') - i * 60_000).toISOString();
      const file = path.join(backups, `main_${tag}_${i}.sql.gz`);
      fs.writeFileSync(file, 'dump');
      store.insertBackupSync({
        id: `${tag}-${i}`,
        app: 'main',
        path: file,
        size_bytes: 4,
        created_at: at,
        metadata: { filename: path.basename(file), compressed: true, ...origin },
      });
    }
  }
  const prune = (service: InstanceType<typeof BackupService>): Promise<void> =>
    (service as unknown as { pruneOldBackups(t: string): Promise<void> }).pruneOldBackups('all');

  it('48 per stack, not 48 shared between two stacks', async () => {
    const service = new BackupService(fakeLogger().module, store, fakeProjects(TWO_MAINS));
    rows(50, { type: 'postgres', project: 'daos', stack: 'dev' }, 'daos');
    rows(50, { type: 'postgres', project: 'shop', stack: 'dev' }, 'shop');

    await prune(service);

    const left = await service.listBackups('main');
    expect(left.filter((b) => b.project === 'daos')).toHaveLength(48);
    expect(left.filter((b) => b.project === 'shop')).toHaveLength(48);
  });

  it('rows from before the stack was recorded are bounded as they always were', async () => {
    const service = new BackupService(fakeLogger().module, store, fakeProjects(MASTER));
    rows(48, {}, 'legacy');
    // Two newer passes, recorded with their stack.
    for (let i = 0; i < 2; i++) {
      const file = path.join(backups, `main_new_${i}.sql.gz`);
      fs.writeFileSync(file, 'dump');
      store.insertBackupSync({
        id: `new-${i}`,
        app: 'main',
        path: file,
        size_bytes: 4,
        created_at: new Date(Date.parse('2026-09-23T09:00:00Z') + i * 60_000).toISOString(),
        metadata: { filename: path.basename(file), type: 'postgres', project: 'daos', stack: 'dev' },
      });
    }

    await prune(service);

    const left = await service.listBackups('main');
    expect(left).toHaveLength(48);
    expect(left.filter((b) => b.project === 'daos')).toHaveLength(2);
  });
});

/** What the daemon reports once it serves the status. */
const STATUS = {
  schedules: [{ target: 'all', spec: 'hourly', schedule: 'every 1h', armed: true, lastPass: null, lastBackupAt: null, nextRunAt: null }],
  stacks: [
    { project: 'daos', stack: 'dev', databases: SIX },
    { project: 'daos', stack: 'test', databases: [], notBackedUp: 'its databases are on 37.27.130.185' },
  ],
};

describe('the commands say which stacks are not backed up', () => {
  it('backup list shows each backup\'s stack, and names daos/test as not backed up', async () => {
    rpc['getBackupStatus'] = async () => STATUS;
    rpc['listBackups'] = async () => [
      {
        id: 'a63dbcf4-8f0e-4b8e-9d7c-2a1b3c4d5e6f',
        database: 'geo',
        filename: 'geo_2026-09-23T08-19-04-290Z_a63dbcf4.sql.gz',
        size: 2_294,
        createdAt: '2026-09-23T08:19:04.742Z',
        compressed: true,
        project: 'daos',
        stack: 'dev',
        scope: 'stack',
      },
    ];

    await backupListCommand();

    const out = printed.map((p) => p.text).join('\n');
    expect(out).toMatch(/Stack/);
    expect(out).toMatch(/a63dbcf4\s+daos\/dev\s+geo/);
    const warned = printed.filter((p) => p.level === 'warn').map((p) => p.text).join('\n');
    expect(warned).toContain('daos/test: not backed up — its databases are on 37.27.130.185');
  });

  it('backup schedules names it too', async () => {
    rpc['getBackupStatus'] = async () => STATUS;

    await backupSchedulesCommand();

    const warned = printed.filter((p) => p.level === 'warn').map((p) => p.text).join('\n');
    expect(warned).toContain('daos/test: not backed up — its databases are on 37.27.130.185');
  });

  it('backup create does not count the stack it skipped as done', async () => {
    rpc['createAllBackups'] = async () => [
      { database: 'main', project: 'daos', stack: 'dev', ok: true, id: 'a66402d0-x', size: 100_765_511 },
      { database: 'daos/test', project: 'daos', stack: 'test', ok: false, skipped: true, error: 'not backed up — its databases are on 37.27.130.185' },
    ];

    await backupCreateCommand();

    const out = printed.map((p) => p.text).join('\n');
    expect(out).toContain('daos/dev/main');
    expect(out).toContain('Done: 1/1 database(s) backed up');
    expect(printed.filter((p) => p.level === 'warn').map((p) => p.text).join('\n')).toContain('Not backed up: daos/test');
  });
});
