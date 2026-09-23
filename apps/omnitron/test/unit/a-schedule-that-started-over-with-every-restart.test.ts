/**
 * Interval schedules restarted from zero at every daemon start.
 *
 * `armSchedule` was `setInterval(run, intervalMs)`, armed when the daemon
 * started — whatever had run before. Measured on the master, 2026-09-23:
 *
 *   - 83 daemon starts since 09-20 07:23Z, the longest uptime 10 h 51 min.
 *     The daily `full` pass needs 24 h of uninterrupted uptime, so it never
 *     fired: the newest `tor-keys`, `storage-objects` and `daemon-state`
 *     copies were from 2026-09-19T17:18:04Z, 3 d 15 h old.
 *   - The hourly `all` pass: 48 copies of `main` in 74.0 h, 13 gaps over two
 *     hours, the longest 5 h 43 min with 18 restarts inside it.
 *
 * Now the first run is due one interval after the target's newest backup in
 * the index — right away when that is already past — never sooner than a
 * minute after start, one more minute per further overdue schedule, and the
 * passes run one at a time.
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
const { backupSchedulesCommand } = await import('../../src/commands/backup.js');

function quietLogger(): { module: never; logger: never } {
  const logger: Record<string, unknown> = {};
  for (const level of ['info', 'warn', 'error', 'debug', 'trace', 'fatal']) logger[level] = () => undefined;
  logger['child'] = () => logger;
  return { module: { logger } as never, logger: logger as never };
}

const NOW = new Date('2026-09-23T09:20:00.000Z');
const MIN = 60_000;
const HOUR = 60 * MIN;

let dir: string;
let backups: string;
let store: InstanceType<typeof DaemonStateStore>;
let service: InstanceType<typeof BackupService>;

/** A backup as the index holds it, with a real file behind it. */
function indexed(app: string, createdAt: string, type?: string): void {
  const name = `${app}_${createdAt.replace(/[:.]/g, '-')}.bak`;
  const file = path.join(backups, name);
  fs.writeFileSync(file, 'x');
  store.insertBackupSync({
    id: `${app}-${createdAt}`,
    app,
    path: file,
    size_bytes: 1,
    created_at: createdAt,
    metadata: { filename: name, ...(type ? { type } : {}) },
  });
}

const OK_FULL = [
  { target: 'storage-objects', ok: true },
  { target: 'tor-keys', ok: true },
  { target: 'daemon-state', ok: true },
];
const OK_ALL = ['main', 'storage', 'priceverse', 'paysys', 'messaging', 'geo'].map((database) => ({ database, ok: true }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(NOW);
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-sched-'));
  env.home = dir;
  backups = path.join(dir, '.omnitron', 'backups');
  fs.mkdirSync(backups, { recursive: true });
  store = new DaemonStateStore(quietLogger().logger, path.join(dir, '.omnitron', 'data', 'daemon-state.db'));
  service = new BackupService(quietLogger().module, store);
  printed.length = 0;
  for (const k of Object.keys(rpc)) delete rpc[k];
});

afterEach(async () => {
  service.dispose();
  vi.useRealTimers();
  vi.restoreAllMocks();
  await store.dispose();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('a schedule starts from its last run, not from the daemon start', () => {
  it('a daily pass three days overdue runs minutes after start, not a day later', async () => {
    // The master's index: the full-only artefacts last written 09-19 17:18Z.
    for (const app of ['storage-objects', 'tor-keys', 'daemon-state']) {
      indexed(app, '2026-09-19T17:18:04.620Z', app);
    }
    indexed('main', '2026-09-23T08:19:00.187Z');
    store.kvSetSync('backup:schedules', { all: 'hourly', full: 'daily' });
    const full = vi.spyOn(service, 'createFullBackup').mockResolvedValue(OK_FULL);
    const all = vi.spyOn(service, 'createAllBackups').mockResolvedValue(OK_ALL);

    await service.restoreSchedules();
    await vi.advanceTimersByTimeAsync(3 * MIN);

    expect(full, 'the overdue daily pass did not run').toHaveBeenCalledTimes(1);
    expect(full).toHaveBeenCalledWith('schedule');
    // `all` last ran 61 minutes before the start: overdue too.
    expect(all).toHaveBeenCalledTimes(1);
  });

  it('a pass that ran 20 minutes ago runs again in 40, not in 60', async () => {
    indexed('main', new Date(NOW.getTime() - 20 * MIN).toISOString());
    store.kvSetSync('backup:schedules', { all: 'hourly' });
    const all = vi.spyOn(service, 'createAllBackups').mockResolvedValue(OK_ALL);

    await service.restoreSchedules();
    const status = await service.getStatus();
    expect(status.schedules[0]!.nextRunAt).toBe(new Date(NOW.getTime() + 40 * MIN).toISOString());

    await vi.advanceTimersByTimeAsync(39 * MIN);
    expect(all, 'ran before its interval was up').not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2 * MIN);
    expect(all).toHaveBeenCalledTimes(1);
  });

  it('what restarts cannot do any more: postpone the pass for ever', async () => {
    // Ten restarts, 50 minutes apart — the master's pattern, compressed.
    indexed('main', new Date(NOW.getTime() - 3 * HOUR).toISOString());
    store.kvSetSync('backup:schedules', { all: 'hourly' });
    let runs = 0;

    for (let restart = 0; restart < 10; restart++) {
      const daemon = new BackupService(quietLogger().module, store);
      vi.spyOn(daemon, 'createAllBackups').mockImplementation(async () => {
        runs++;
        indexed('main', new Date().toISOString());
        return OK_ALL;
      });
      await daemon.restoreSchedules();
      await vi.advanceTimersByTimeAsync(50 * MIN);
      daemon.dispose();
    }

    // 500 minutes of daemon time, hourly, never 60 minutes of uptime in a row.
    expect(runs).toBeGreaterThanOrEqual(7);
  });
});

describe('a start with several overdue schedules does not begin them together', () => {
  it('staggers their first runs and never runs two passes at once', async () => {
    store.kvSetSync('backup:schedules', { all: 'hourly', full: 'daily', main: 'hourly' });
    let running = 0;
    let most = 0;
    const slowPass = <T>(result: T) => async (): Promise<T> => {
      running++;
      most = Math.max(most, running);
      await new Promise((r) => setTimeout(r, 5 * MIN));
      running--;
      return result;
    };
    vi.spyOn(service, 'createAllBackups').mockImplementation(slowPass(OK_ALL));
    vi.spyOn(service, 'createFullBackup').mockImplementation(slowPass(OK_FULL));
    vi.spyOn(service, 'createBackup').mockImplementation(
      slowPass({ id: 'x', database: 'main', filename: 'x', size: 1, createdAt: NOW.toISOString(), compressed: true }),
    );

    await service.restoreSchedules();
    const first = (await service.getStatus()).schedules.map((s) => Date.parse(s.nextRunAt!) - NOW.getTime());
    expect(first).toEqual([1 * MIN, 2 * MIN, 3 * MIN]);

    await vi.advanceTimersByTimeAsync(30 * MIN);
    expect(most, 'two passes ran at the same time').toBe(1);
    expect(service.createFullBackup).toHaveBeenCalledTimes(1);
    expect(service.createAllBackups).toHaveBeenCalledTimes(1);
    expect(service.createBackup).toHaveBeenCalledTimes(1);
  });
});

describe('after a run', () => {
  it('the next is measured from when the last one started', async () => {
    store.kvSetSync('backup:schedules', { all: 'hourly' });
    vi.spyOn(service, 'createAllBackups').mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 12 * MIN)); // the 06:04Z pass took 12 minutes
      return OK_ALL;
    });

    await service.restoreSchedules();
    await vi.advanceTimersByTimeAsync(1 * MIN + 12 * MIN + 1);

    const next = (await service.getStatus()).schedules[0]!.nextRunAt!;
    expect(next).toBe(new Date(NOW.getTime() + 1 * MIN + HOUR).toISOString());
  });

  it('a pass that backed up nothing is retried in 15 minutes, not a day', async () => {
    store.kvSetSync('backup:schedules', { full: 'daily' });
    const full = vi.spyOn(service, 'createFullBackup').mockResolvedValue([]);

    await service.restoreSchedules();
    await vi.advanceTimersByTimeAsync(1 * MIN);
    expect(full).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(15 * MIN);
    expect(full).toHaveBeenCalledTimes(2);
  });
});

describe('backup schedules', () => {
  it('prints when a schedule next runs, and its newest backup when no pass is recorded', async () => {
    rpc['getBackupStatus'] = async () => ({
      schedules: [
        {
          target: 'full',
          spec: 'daily',
          schedule: 'every 1d',
          armed: true,
          lastPass: null,
          lastBackupAt: '2026-09-19T17:18:04.620Z',
          nextRunAt: '2026-09-23T09:22:00.000Z',
        },
      ],
    });

    await backupSchedulesCommand();

    const out = printed.map((p) => p.text).join('\n');
    expect(out).toContain('newest backup 2026-09-19T17:18:04Z, 3 d 16 h ago');
    expect(out).toMatch(/next run\s+2026-09-23T09:22:00Z \(in 2 min\)/);
  });
});
