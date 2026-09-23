/**
 * A remote stack «started» when this master attached to it.
 *
 * `toStackInfo` took a stack's `startedAt` and `uptime` from this daemon's
 * memory of starting it. For a remote stack that memory is when THIS master
 * took charge — deployed it, or attached to it after its own restart — and
 * not when the applications on the node started. Measured 2026-09-23 on
 * `daos/test`, minutes after a master restart:
 *
 *     Started: 13:03:46   Uptime: 25m 05s
 *
 * beside six applications the node reported running since 12:20:48–52. The
 * console printed the same moment as the stack's start.
 *
 * The start is now the nodes' to say — the longest-running app they report
 * online — and this master's moment is reported beside it as what it is,
 * `attachedAt`. When no node can be asked, the start is unknown rather than
 * the attach time.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectService } from '../../src/services/project.service.js';

const MIN = 60_000;
const NOW = Date.parse('2026-09-23T13:28:51.000Z');
const ATTACHED = NOW - 25 * MIN;
const SIX = ['main', 'storage', 'priceverse', 'paysys', 'messaging', 'geo'];

const nodeApp = (name: string, uptime: number, status = 'online') => ({
  // The node's own name for it; the stack knows the bare one.
  name: `daos/deployed/${name}`,
  status,
  pid: 1000 + name.length,
  instances: 1,
  uptime,
  restarts: 0,
  cpu: 1,
  memory: 2,
  port: null,
  mode: 'bootstrap',
  critical: false,
});

function service(opts: {
  type: 'remote' | 'local';
  since?: number | null;
  invokeOnSlave?: (...args: unknown[]) => Promise<unknown>;
}) {
  const stackConfig = {
    type: opts.type,
    apps: 'all' as const,
    nodes: opts.type === 'remote' ? [{ host: '37.27.130.185', port: 9700 }] : [],
  };
  const asked: string[] = [];
  const svc: any = Object.create(ProjectService.prototype);
  Object.assign(svc, {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    stackStates: new Map(
      opts.since === undefined
        ? []
        : [['daos/test', { project: 'daos', stack: 'test', status: 'running', config: stackConfig, startedAt: opts.since, infraService: null }]],
    ),
    getLoadedConfig: () => ({ apps: SIX.map((name) => ({ name })) }),
    resolveStackApps: () => SIX.map((name) => ({ name })),
    orchestrator: { list: () => [] },
    infraManager: { getInstance: () => null },
    slaveConnector: {
      getConnections: () => [],
      invokeOnSlave: async (...args: unknown[]) => {
        asked.push(String(args[3]));
        return (opts.invokeOnSlave ?? (async () => ({ apps: [] })))(...args);
      },
    },
    remoteInfraStatus: vi.fn(async () => null),
  });
  return {
    asked,
    read: (): Promise<{ startedAt: string | null; uptime: number; attachedAt: string | null }> =>
      svc.withRemoteAppStatuses('daos', svc.toStackInfo('daos', 'test', stackConfig)),
  };
}

const iso = (ms: number) => new Date(ms).toISOString();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('a remote stack started when its applications did, as its node says', () => {
  it('takes the start from the longest-running app the node reports online', async () => {
    const out = await service({
      type: 'remote',
      since: ATTACHED,
      invokeOnSlave: async () => ({
        apps: [
          nodeApp('main', 68 * MIN),
          nodeApp('storage', 68 * MIN - 4_000),
          nodeApp('priceverse', 68 * MIN - 2_000),
          // Restarted by the node two minutes ago; the stack did not restart.
          nodeApp('paysys', 2 * MIN),
          nodeApp('messaging', 68 * MIN - 1_000),
          nodeApp('geo', 68 * MIN - 3_000),
        ],
      }),
    }).read();

    expect(out.startedAt).toBe(iso(NOW - 68 * MIN));
    expect(out.uptime).toBe(68 * MIN);
    // This master's moment, beside it and named for what it is.
    expect(out.attachedAt).toBe(iso(ATTACHED));
  });

  it('does not count an app that is not online, whatever uptime it carries', async () => {
    const out = await service({
      type: 'remote',
      since: ATTACHED,
      invokeOnSlave: async () => ({
        apps: [nodeApp('main', 90 * MIN, 'errored'), nodeApp('geo', 30 * MIN), nodeApp('paysys', 0, 'starting')],
      }),
    }).read();

    expect(out.startedAt).toBe(iso(NOW - 30 * MIN));
  });

  it('does not count what the node runs for another stack', async () => {
    const out = await service({
      type: 'remote',
      since: ATTACHED,
      invokeOnSlave: async () => ({
        apps: [nodeApp('main', 10 * MIN), { ...nodeApp('worker', 10 * 24 * 60 * MIN), name: 'acme/deployed/worker' }],
      }),
    }).read();

    expect(out.startedAt).toBe(iso(NOW - 10 * MIN));
  });

  it('says the start is unknown, not the attach time, when no node answers', async () => {
    const out = await service({
      type: 'remote',
      since: ATTACHED,
      invokeOnSlave: async () => {
        throw new Error('Socket closed during RPC');
      },
    }).read();

    expect(out.startedAt).toBeNull();
    expect(out.uptime).toBe(0);
    expect(out.attachedAt).toBe(iso(ATTACHED));
  });

  it('says it is unknown when the node runs none of its apps online', async () => {
    const out = await service({
      type: 'remote',
      since: ATTACHED,
      invokeOnSlave: async () => ({ apps: SIX.map((n) => nodeApp(n, 0, 'stopped')) }),
    }).read();

    expect(out.startedAt).toBeNull();
    expect(out.uptime).toBe(0);
  });

  it('reports the node\'s start for a stack this master has not attached yet, and no attach', async () => {
    // Between a master restart and its attach: the node runs the apps all
    // the same.
    const out = await service({
      type: 'remote',
      invokeOnSlave: async () => ({ apps: SIX.map((n) => nodeApp(n, 40 * MIN)) }),
    }).read();

    expect(out.startedAt).toBe(iso(NOW - 40 * MIN));
    expect(out.attachedAt).toBeNull();
  });
});

describe('a local stack is started by this daemon, and that is its start', () => {
  it('keeps this daemon\'s start, attaches nothing and asks no node', async () => {
    const started = NOW - 7 * MIN;
    const svc = service({ type: 'local', since: started });

    const out = await svc.read();

    expect(out.startedAt).toBe(iso(started));
    expect(out.uptime).toBe(7 * MIN);
    expect(out.attachedAt).toBeNull();
    expect(svc.asked).toEqual([]);
  });
});
