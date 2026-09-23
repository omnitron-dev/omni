/**
 * An inspection that measured one process and called it the app.
 *
 * `omnitron inspect`, measured 2026-09-23 against the live daemon:
 *
 *   - «Memory RSS 157.2MB» for priceverse, whose processes `list` sums to
 *     ~508 MB: the RPC ran `ps` on the single pid the handle held, which was
 *     the app's last-started child;
 *   - processes up 1 h 7 m and 1 h 30 m printed «up 4s» and «up 5s»: the RPC
 *     reports seconds and the CLI handed them to `formatUptime`, which takes
 *     milliseconds;
 *   - storage's two transform pool workers appeared nowhere, because only
 *     supervisor children were walked;
 *   - `config: {}` for `main` and for `daos/dev/main`: the entry was looked up
 *     in the daemon's own config, which holds no project's apps.
 *
 * The numbers below are shaped like the live priceverse (synthetic, not read
 * from the system).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'reflect-metadata';

const boxes: string[] = [];
const identity = (s: unknown) => String(s);
const prism = new Proxy({}, { get: () => identity });
vi.mock('@xec-sh/kit', () => ({
  box: (text: string, title?: string) => boxes.push(`${title ?? ''}\n${text}`),
  prism,
  log: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), step: vi.fn(), success: vi.fn() },
  table: vi.fn(),
}));

let diagnostics: unknown = null;
vi.mock('../../src/daemon/daemon-client.js', () => ({
  createDaemonClient: () => ({
    whyUnreachable: async () => null,
    inspect: async () => diagnostics,
    getEnv: async () => ({}),
    disconnect: async () => {},
  }),
}));

const { DaemonRpcService } = await import('../../src/daemon/daemon.rpc-service.js');
const { AppHandle } = await import('../../src/orchestrator/app-handle.js');
const { inspectCommand } = await import('../../src/commands/inspect.js');

const MB = 1024 * 1024;
const PER_ENTRY = {
  http: 92_028_928,
  collector: 133_070_848,
  'stream-aggregator': 131_809_280,
  'ohlcv-aggregator': 141_705_216,
};
const APP_RSS = Object.values(PER_ENTRY).reduce((a, b) => a + b, 0); // 498_614_272

function priceverse(status: 'online' | 'stopped' = 'online') {
  const handle = new AppHandle(
    { name: 'daos/dev/priceverse', bootstrap: './apps/priceverse/src/bootstrap.ts', critical: false },
    'bootstrap',
  );
  handle.markStarting();
  handle.status = status;
  // A live process, so the old path's `ps -p` had something real to measure.
  handle.pid = process.pid;
  handle.topologyProcesses = [
    { name: 'http', module: './http.js', transports: { http: { port: 3003 } } as never },
    { name: 'collector', module: './collector.js' },
    { name: 'stream-aggregator', module: './stream.js' },
    { name: 'ohlcv-aggregator', module: './ohlcv.js', instances: 2 },
  ];
  const ids: Record<string, string> = {
    'daos/dev/priceverse/http': 'p-http',
    'daos/dev/priceverse/collector': 'p-collector',
    'daos/dev/priceverse/stream-aggregator': 'p-stream',
  };
  handle.supervisor = {
    getChildNames: () => Object.keys(ids),
    getChildProcessId: (name: string) => ids[name] ?? null,
  } as never;
  handle.topologyPools.set('ohlcv-aggregator', { getWorkerIds: () => ['w-1', 'w-2'], size: 2 } as never);
  // What the poller left behind before a stop.
  handle.lastMetrics = { cpu: 3, memory: APP_RSS };

  const pids: Record<string, number> = { 'p-http': 31544, 'p-collector': 31708, 'p-stream': 31931, 'w-1': 80295, 'w-2': 80296 };
  const upSeconds: Record<string, number> = { 'p-http': 5_400, 'p-collector': 5_395, 'p-stream': 4_020, 'w-1': 1_498, 'w-2': 1_497 };
  const now = Date.now();

  const orchestrator = {
    getHandle: (name: string) => (name === 'priceverse' || name === handle.name ? handle : undefined),
    // Resolves like the real one: any name of the app answers under the
    // canonical key, and sampling leaves each entry's share on the handle.
    getMetrics: async (name?: string) => {
      if (name !== undefined && name !== 'priceverse' && name !== handle.name) return {};
      handle.childMetrics = new Map(Object.entries(PER_ENTRY).map(([k, memory]) => [k, { cpu: 0.5, memory }]));
      return { [handle.name]: { cpu: 3, memory: APP_RSS } };
    },
    getWorkerHandle: (id: string) =>
      id in pids ? { pid: pids[id], serviceName: 'BootstrapApp', serviceVersion: '1.0.0' } : undefined,
    getChildProcessInfo: (id: string) => (id in upSeconds ? { startTime: now - upSeconds[id]! * 1000 } : undefined),
  };
  const logManager = { getLogFilePath: (name: string, kind: string) => `/logs/${name}/${kind}.log` };
  const rpc = new DaemonRpcService(orchestrator as never, {} as never, logManager as never, { apps: [] } as never, {} as never);
  return { rpc, handle };
}

describe('inspect answers for the whole app', () => {
  it("measures every process — children and pool workers — not the one pid on the handle", async () => {
    const out = await priceverse().rpc.inspect({ name: 'priceverse' });

    expect(out.memory.rss).toBe(APP_RSS);
    expect(out.children.find((c) => c.name.endsWith('/http'))?.rss).toBe(PER_ENTRY.http);
  });

  it('lists the pool and its workers', async () => {
    const out = await priceverse().rpc.inspect({ name: 'priceverse' });

    expect(out.pools).toEqual([
      {
        name: 'ohlcv-aggregator',
        declaredInstances: 2,
        rss: PER_ENTRY['ohlcv-aggregator'],
        workers: [
          { pid: 80295, processId: 'w-1', uptimeSeconds: 1_498 },
          { pid: 80296, processId: 'w-2', uptimeSeconds: 1_497 },
        ],
      },
    ]);
  });

  it("reads the config off the app's own entry, which the daemon's config does not hold", async () => {
    const out = await priceverse().rpc.inspect({ name: 'daos/dev/priceverse' });

    expect(out.config).toEqual({
      mode: 'bootstrap',
      instances: 1,
      critical: false,
      port: 3003,
      bootstrap: './apps/priceverse/src/bootstrap.ts',
    });
  });

  it('a stopped app has no resident memory, whatever the last sample said', async () => {
    const out = await priceverse('stopped').rpc.inspect({ name: 'priceverse' });

    expect(out.memory.rss).toBe(0);
  });
});

describe('omnitron inspect prints what the daemon measured', () => {
  beforeEach(() => {
    boxes.length = 0;
  });

  it('prints uptimes in hours, not the seconds read as milliseconds', async () => {
    diagnostics = await priceverse().rpc.inspect({ name: 'priceverse' });

    await inspectCommand('priceverse');
    const printed = boxes.join('\n');

    expect(printed).toMatch(/http\b.*up 1h 30m/);
    expect(printed).toMatch(/stream-aggregator\b.*up 1h 7m/);
    expect(printed).not.toMatch(/up [45]s\b/);
  });

  it('prints the pool with its workers, and the app total as the sum of all of them', async () => {
    diagnostics = await priceverse().rpc.inspect({ name: 'priceverse' });

    await inspectCommand('priceverse');
    const printed = boxes.join('\n');

    expect(printed).toMatch(/ohlcv-aggregator\s+2\/2 workers/);
    expect(printed).toMatch(/pid=80295 up 24m 58s/);
    expect(printed).toContain(`RSS:          ${(APP_RSS / MB).toFixed(1)}MB`);
    expect(printed).toMatch(/all 5 processes/);
  });
});
