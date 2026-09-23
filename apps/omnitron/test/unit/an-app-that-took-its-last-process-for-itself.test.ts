/**
 * An app that took its last process for itself, and its first for all of it.
 *
 * Every supervisor child's `child:started` called `handle.markOnline(childPid)`.
 * So a bootstrap app was `online` from its FIRST child, and its pid was that of
 * its LAST. Measured on daos/dev/main (2026-09-23): `list` gave pid 58130, the
 * notification-worker, while `lsof` showed port 3001 held by the http process,
 * 57952 — priceverse, paysys and messaging the same way, four apps of six.
 * `inspect` answered `online` with two of three processes up, and measured the
 * notification-worker as «the app»: 181.9 MB of 661.8 MB.
 *
 * That pid is also what the ghost check asks the OS about, so an app whose
 * http process died stayed `online` for as long as its last child lived.
 *
 * These drive the real `launchTopology` / `launchSingleProcess` with a
 * supervisor that starts nothing on its own: the test says which child came
 * up, and when.
 */

import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import 'reflect-metadata';

import { OrchestratorService } from '../../src/orchestrator/orchestrator.service.js';
import { AppHandle } from '../../src/orchestrator/app-handle.js';
import type { IEcosystemAppEntry, IEcosystemConfig, IProcessEntry } from '../../src/config/types.js';

/** A pid no process has: macOS stops at 99998, Linux at 4194304. */
const DEAD_PID = 4_194_303;

class ScriptedSupervisor extends EventEmitter {
  private readonly ids = new Map<string, unknown>();
  constructor(readonly config: { children: Array<{ name: string }> }) {
    super();
  }
  async start(): Promise<void> {}
  getChildNames(): string[] {
    return [...this.ids.keys()];
  }
  getChildProcessId(name: string): unknown {
    return this.ids.get(name) ?? null;
  }
  getRestartCount(): number {
    return 0;
  }
  /** What titan-pm does when a child's spawn resolves. */
  started(name: string, processId: unknown): void {
    this.ids.set(name, processId);
    this.emit('child:started', name);
  }
  crashed(name: string): void {
    this.emit('child:crash', name, new Error(`${name} exited with code 1`));
  }
}

const config = {
  supervision: {
    strategy: 'one_for_one',
    maxRestarts: 3,
    window: 60_000,
    backoff: { type: 'exponential', initial: 300, max: 30_000, factor: 2 },
  },
  monitoring: { healthCheck: { interval: 30_000, timeout: 5_000 } },
} as unknown as IEcosystemConfig;

function orchestratorWith(workers: Record<string, number>) {
  let supervisor: ScriptedSupervisor | null = null;
  const self = Object.create(OrchestratorService.prototype) as Record<string, unknown>;
  const emitted: string[] = [];
  Object.assign(self, {
    pm: {
      createSupervisor: (cfg: { children: Array<{ name: string }> }) => (supervisor = new ScriptedSupervisor(cfg)),
      getWorkerHandle: (id: string) => (id in workers ? { pid: workers[id] } : undefined),
      getProcess: (id: string) => (id in workers ? { pid: workers[id], startTime: Date.now() - 1_000 } : undefined),
    },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    daemonNetron: {},
    daemonSocketPath: '/nonexistent/daemon.sock',
    ensureDaemonNetronReady: async () => {},
    exposeChildTopologyServices: async () => {},
    persistState: vi.fn(),
    persistChildFailure: vi.fn(),
    persistChildOutput: vi.fn(),
    startPostOnlineCooldown: vi.fn(),
    emit: (event: string) => {
      emitted.push(event);
      return true;
    },
  });
  return { self, emitted, supervisor: () => supervisor! };
}

const mainEntry: IEcosystemAppEntry = { name: 'daos/dev/main', bootstrap: './bootstrap.ts', critical: true };
const mainTopology: IProcessEntry[] = [
  { name: 'http', module: './http.module.js', transports: { http: { port: 3001 } } as IProcessEntry['transports'] },
  { name: 'captcha-generator', module: './captcha.module.js' },
  { name: 'notification-worker', module: './notification.module.js' },
];

async function launchMain(workers: Record<string, number>) {
  const o = orchestratorWith(workers);
  const handle = new AppHandle(mainEntry, 'bootstrap');
  handle.markStarting();
  const launch = (OrchestratorService.prototype as unknown as Record<string, (...a: unknown[]) => Promise<void>>)[
    'launchTopology'
  ]!;
  await launch.call(o.self, mainEntry, handle, config, '/app/bootstrap.ts', mainTopology);
  return { ...o, handle, sup: o.supervisor() };
}

const HTTP = 'daos/dev/main/http';
const CAPTCHA = 'daos/dev/main/captcha-generator';
const NOTIFY = 'daos/dev/main/notification-worker';

describe('an app is online when all its processes are, and not before', () => {
  it('stays starting while two of three processes are up', async () => {
    const { handle, sup } = await launchMain({ 'p-http': 57952, 'p-captcha': 58001, 'p-notify': 58130 });

    sup.started(HTTP, 'p-http');
    expect(handle.status).toBe('starting');
    sup.started(CAPTCHA, 'p-captcha');
    expect(handle.status).toBe('starting');

    sup.started(NOTIFY, 'p-notify');
    expect(handle.status).toBe('online');
  });

  it('announces itself online once, when the last process is up', async () => {
    const { sup, emitted } = await launchMain({ 'p-http': 57952, 'p-captcha': 58001, 'p-notify': 58130 });

    sup.started(HTTP, 'p-http');
    sup.started(CAPTCHA, 'p-captcha');
    expect(emitted.filter((e) => e === 'app:online')).toHaveLength(0);

    sup.started(NOTIFY, 'p-notify');
    expect(emitted.filter((e) => e === 'app:online')).toHaveLength(1);
  });

  it('a declared process that failed to start leaves the app errored, not online and not starting', async () => {
    const { handle, sup } = await launchMain({ 'p-http': 57952, 'p-notify': 58130 });

    sup.started(HTTP, 'p-http');
    sup.emit('child:start-failed', CAPTCHA, new Error('startup timed out'));
    sup.started(NOTIFY, 'p-notify');

    expect(handle.status).toBe('errored');
  });
});

describe("the app's pid is its server's", () => {
  it('is the http process, whichever child started last', async () => {
    const { handle, sup } = await launchMain({ 'p-http': 57952, 'p-captcha': 58001, 'p-notify': 58130 });

    sup.started(HTTP, 'p-http');
    sup.started(CAPTCHA, 'p-captcha');
    sup.started(NOTIFY, 'p-notify');

    expect(handle.pid).toBe(57952);
  });

  it('follows the server across its restart, and is nobody while it is down', async () => {
    const { handle, sup } = await launchMain({ 'p-http': 57952, 'p-http-2': 60001, 'p-captcha': 58001, 'p-notify': 58130 });
    sup.started(HTTP, 'p-http');
    sup.started(CAPTCHA, 'p-captcha');
    sup.started(NOTIFY, 'p-notify');

    sup.crashed(HTTP);
    expect(handle.status).toBe('crashed');
    expect(handle.pid).toBeNull();

    sup.started(HTTP, 'p-http-2');
    expect(handle.status).toBe('online');
    expect(handle.pid).toBe(60001);
  });

  it("a sibling's restart does not bring the app online around a process that is still down", async () => {
    const { handle, sup } = await launchMain({ 'p-http': 57952, 'p-captcha': 58001, 'p-captcha-2': 60002, 'p-notify': 58130 });
    sup.started(HTTP, 'p-http');
    sup.started(CAPTCHA, 'p-captcha');
    sup.started(NOTIFY, 'p-notify');

    // The notification-worker is over its budget and not restarted; the
    // captcha-generator crashes after it and is.
    sup.crashed(NOTIFY);
    sup.crashed(CAPTCHA);
    sup.started(CAPTCHA, 'p-captcha-2');

    expect(handle.status).toBe('crashed');
  });

  it("an app whose server is dead does not read online while its last child lives", async () => {
    // The http process is gone without its crash having arrived yet; the
    // notification-worker is this very process, so it is alive.
    const { self, handle, sup } = await launchMain({ 'p-http': DEAD_PID, 'p-captcha': process.pid, 'p-notify': process.pid });
    handle.topologyProcesses = mainTopology;
    sup.started(HTTP, 'p-http');
    sup.started(CAPTCHA, 'p-captcha');
    sup.started(NOTIFY, 'p-notify');

    const toProcessInfo = (OrchestratorService.prototype as unknown as Record<string, (h: AppHandle) => { status: string; pid: number | null }>)[
      'toProcessInfo'
    ]!;
    const info = toProcessInfo.call(self, handle);

    expect(info.pid).toBe(DEAD_PID);
    expect(info.status).toBe('crashed');
  });
});

describe('an app of one process', () => {
  const geo: IEcosystemAppEntry = { name: 'daos/dev/geo', bootstrap: './bootstrap.ts' };

  async function launchSingle(workers: Record<string, number>, instances = 1) {
    const o = orchestratorWith(workers);
    const handle = new AppHandle({ ...geo, instances }, 'bootstrap');
    handle.markStarting();
    const launch = (OrchestratorService.prototype as unknown as Record<string, (...a: unknown[]) => Promise<void>>)[
      'launchSingleProcess'
    ]!;
    await launch.call(o.self, { ...geo, instances }, handle, config, '/app/bootstrap.ts');
    return { handle, sup: o.supervisor() };
  }

  it('is online with its one process, under that process\'s pid', async () => {
    const { handle, sup } = await launchSingle({ 'p-geo': 31504 });

    sup.started('daos/dev/geo', 'p-geo');

    expect(handle.status).toBe('online');
    expect(handle.pid).toBe(31504);
  });

  it('has no pid when that process is a pool, rather than the daemon\'s', async () => {
    const { handle, sup } = await launchSingle({}, 2);

    // A pool proxy answers `__processId` with a function, like any property.
    sup.started('daos/dev/geo', async () => undefined);

    expect(handle.status).toBe('online');
    expect(handle.pid).not.toBe(process.pid);
    expect(handle.pid).toBeNull();
  });
});
