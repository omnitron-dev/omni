/**
 * A scheduled backup of one database failed, and nothing said so.
 *
 * Measured on the master, 2026-09-23. The hourly `all` pass that ran
 * 06:04–06:16Z holds five databases; `main` is simply missing. The log:
 *
 *     06:04:08Z  Creating backup {"database":"main"}
 *     06:14:11Z  Creating backup {"database":"storage"}          ← 603 s later
 *     06:16:17Z  createAllBackups complete {"total":6,"ok":5}   ← INFO
 *
 * No line with a reason. The dump timeout is 600 s: the timer killed the
 * dump, `dumpToFile` reported "docker exited with code null", and
 * `createAllBackups` put that into its results array without logging it.
 * `runScheduledBackup` then discarded the array; its `logger.error` fires
 * only on a throw, which the per-database catch never lets happen. And
 * `backup schedules` printed «all  hourly» — the configuration, not what it
 * did.
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
const { dumpToFile } = await import('../../src/services/backup-pipeline.js');
const { backupSchedulesCommand, backupListCommand } = await import('../../src/commands/backup.js');

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

/** daos/dev as the master runs it: local infrastructure, six databases. */
const SIX = ['main', 'storage', 'priceverse', 'paysys', 'messaging', 'geo'];
function daosDev(): never {
  const infra = {
    getConnectionInfo: (svc: string) =>
      svc === 'postgres' ? { host: 'localhost', port: 5432, user: 'postgres', password: 'pw' } : null,
    getResolvedContainerName: (svc: string) => `daos-dev-${svc}`,
    getPostgresDatabases: () => SIX,
    getState: () => ({}),
  };
  return {
    listProjects: () => [{ name: 'daos' }],
    getRunningStacks: () => ['dev'],
    getInfraManager: () => ({ getInstance: () => infra }),
    getStack: () => ({ name: 'dev', type: 'local', nodes: [], config: { type: 'local' } }),
  } as never;
}

const TIMEOUT = "Backup failed for 'main': docker did not finish within 600 s and was killed";

let dir: string;
let store: InstanceType<typeof DaemonStateStore>;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-silent-'));
  env.home = dir;
  fs.mkdirSync(path.join(dir, '.omnitron', 'backups'), { recursive: true });
  store = new DaemonStateStore(fakeLogger().logger, path.join(dir, '.omnitron', 'data', 'daemon-state.db'));
  printed.length = 0;
  for (const k of Object.keys(rpc)) delete rpc[k];
});

afterEach(async () => {
  vi.restoreAllMocks();
  await store.dispose();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** A service whose dumps succeed except `main`'s, which times out as it did at 06:04Z. */
function withMainTimingOut(lines?: ReturnType<typeof fakeLogger>): InstanceType<typeof BackupService> {
  const service = new BackupService((lines ?? fakeLogger()).module, store, daosDev());
  vi.spyOn(service, 'createBackup').mockImplementation(async (database: string) => {
    if (database === 'main' || database.endsWith('/main')) {
      throw new Error(TIMEOUT, { cause: new Error('docker did not finish within 600 s and was killed') });
    }
    return {
      id: `${database}-0000-4000-8000-000000000000`,
      database,
      filename: `${database}.sql.gz`,
      size: 1_000,
      createdAt: new Date().toISOString(),
      compressed: true,
    };
  });
  return service;
}

describe('the failure is written down where it happens', () => {
  it('logs the database and its reason at error', async () => {
    const log = fakeLogger();
    await withMainTimingOut(log).createAllBackups();

    const failed = log.lines.filter((l) => l.level === 'error' && l.obj['database'] === 'main');
    expect(failed, 'no error line names main').toHaveLength(1);
    expect(String(failed[0]!.obj['error'])).toContain('did not finish within 600 s');
  });

  it('a pass that lost a database does not close at info', async () => {
    const log = fakeLogger();
    await withMainTimingOut(log).createAllBackups();

    const summary = log.lines.find((l) => /createAllBackups complete/.test(l.msg));
    expect(summary, 'the pass summary is gone').toBeDefined();
    expect(summary!.level).toBe('error');
    expect(summary!.obj['ok']).toBe(5);
    expect(summary!.obj['total']).toBe(6);
    expect(summary!.msg).toContain('main');
  });

  it('a scheduled pass is recorded, and the record outlives a restart', async () => {
    store.kvSetSync('backup:schedules', { all: 'hourly' });
    const service = withMainTimingOut();
    await (service as unknown as { runScheduledBackup(t: string): Promise<void> }).runScheduledBackup('all');
    service.dispose();

    // A new daemon on the same state.
    const after = new BackupService(fakeLogger().module, store, daosDev());
    const status = await after.getStatus();
    const all = status.schedules.find((s) => s.target === 'all');

    expect(all?.lastPass?.outcome).toBe('partial');
    expect(all?.lastPass?.trigger).toBe('schedule');
    expect(all?.lastPass?.ok).toBe(5);
    expect(all?.lastPass?.failures).toEqual([
      { target: 'main', error: expect.stringContaining('did not finish within 600 s') },
    ]);
    after.dispose();
  });

  it('a scheduled single database that fails is logged and recorded, not thrown away', async () => {
    const log = fakeLogger();
    store.kvSetSync('backup:schedules', { main: 'hourly' });
    const service = withMainTimingOut(log);
    await (service as unknown as { runScheduledBackup(t: string): Promise<void> }).runScheduledBackup('main');

    expect(log.lines.some((l) => l.level === 'error' && l.obj['database'] === 'main')).toBe(true);
    const main = (await service.getStatus()).schedules.find((s) => s.target === 'main');
    expect(main?.lastPass?.outcome).toBe('failed');
    service.dispose();
  });

  it('a pass that found nothing is not called a success', async () => {
    const log = fakeLogger();
    const service = new BackupService(log.module, store);
    await service.createAllBackups();
    const summary = log.lines.find((l) => /createAllBackups complete/.test(l.msg));
    expect(summary?.level).toBe('warn');
    expect(summary?.obj['outcome']).toBe('empty');
  });
});

describe('the dump says why it was killed', () => {
  it('a dump our timer killed reports the timeout, not "exited with code null"', async () => {
    const out = path.join(dir, 'slow.sql.gz');
    await expect(
      dumpToFile('/bin/sh', ['-c', 'printf HEADER; sleep 5'], out, true, { timeoutMs: 300 }),
    ).rejects.toThrow('/bin/sh did not finish within 300 ms and was killed');
  });
});

/** What the daemon reports once it records passes — the 06:04Z pass. */
const STATUS = {
  schedules: [
    {
      target: 'all',
      spec: 'hourly',
      schedule: 'every 1h',
      armed: true,
      lastPass: {
        target: 'all',
        trigger: 'schedule',
        startedAt: '2026-09-23T06:04:08.155Z',
        finishedAt: '2026-09-23T06:16:17.077Z',
        outcome: 'partial',
        ok: 5,
        total: 6,
        failures: [{ target: 'main', error: 'docker did not finish within 600 s and was killed' }],
      },
    },
    { target: 'full', spec: 'daily', schedule: 'every 1d', armed: true, lastPass: null },
  ],
};

describe('backup schedules says what each schedule last did', () => {
  it('prints the last pass in UTC, with its outcome and the reason for what failed', async () => {
    rpc['getBackupStatus'] = async () => STATUS;

    await backupSchedulesCommand();

    const warned = printed.filter((p) => p.level === 'warn').map((p) => p.text).join('\n');
    expect(warned).toContain('2026-09-23T06:04:08Z');
    expect(warned).toContain('PARTIAL');
    expect(warned).toContain('5 of 6');
    expect(warned).toContain('main (docker did not finish within 600 s and was killed)');
    // And a schedule that has not run says so, rather than nothing.
    expect(printed.map((p) => p.text).join('\n')).toContain('none recorded yet');
  });

  it('backup list carries the warning too', async () => {
    rpc['getBackupStatus'] = async () => STATUS;
    rpc['listBackups'] = async () => [
      {
        id: 'a63dbcf4-8f0e-4b8e-9d7c-2a1b3c4d5e6f',
        database: 'geo',
        filename: 'geo_2026-09-23T06-16-13-503Z_a63dbcf4.sql.gz',
        size: 2_294,
        createdAt: '2026-09-23T06:16:17.076Z',
        compressed: true,
      },
    ];

    await backupListCommand();

    const warned = printed.filter((p) => p.level === 'warn').map((p) => p.text).join('\n');
    expect(warned).toMatch(/Last 'all' pass: 2026-09-23T06:04:08Z\s+PARTIAL/);
  });

  it('an older daemon still lists its schedules, and says what it cannot tell', async () => {
    rpc['listSchedules'] = async () => ({ all: 'hourly', full: 'daily' });

    await backupSchedulesCommand();

    const out = printed.map((p) => p.text).join('\n');
    expect(out).toMatch(/all\s+hourly/);
    expect(printed.some((p) => p.level === 'error')).toBe(false);
    expect(printed.filter((p) => p.level === 'warn').map((p) => p.text).join('\n')).toMatch(/unknown/);
  });
});
