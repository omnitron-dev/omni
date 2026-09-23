/**
 * A metric that counted its own questions.
 *
 * `omnitron metrics` showed REQUESTS for an app as the call count of its
 * process WRAPPER — the methods the supervisor itself calls for health and
 * metrics. Measured: `requests` for main rose by exactly one for every
 * `omnitron inspect --graph`, three real `GET /health` answered 200 were not
 * counted, priceverse read 1 and four apps 0; ERRORS never moved and MEAN /
 * P95 / P99 were never filled — the RPC dropped latency, and the latency the
 * runtime reported was the constant `{ last: 0 }`.
 *
 * Now the app's server process reports what its transports answered
 * (`reportTraffic`), the orchestrator sums only THAT across the app's
 * processes, and the report says `not-reported` rather than zero when no
 * process said anything.
 */

import { describe, it, expect } from 'vitest';
import 'reflect-metadata';

import BootstrapProcess from '../../src/orchestrator/bootstrap-process.js';
import { combineProcessTraffic } from '../../src/orchestrator/app-traffic.js';
import { OrchestratorService } from '../../src/orchestrator/orchestrator.service.js';
import { DaemonRpcService } from '../../src/daemon/daemon.rpc-service.js';

const window = (count: number, p95: number) => ({
  windowMs: 60_000,
  coveredMs: 60_000,
  count,
  mean: p95 / 2,
  p50: p95 / 3,
  p75: p95 / 2,
  p90: p95 * 0.9,
  p95,
  p99: p95 * 1.5,
  max: p95 * 2,
});

const traffic = (requests: number, serverErrors = 0, latency: ReturnType<typeof window> | null = window(requests, 40)) => ({
  requests,
  serverErrors,
  clientErrors: 1,
  probes: 7,
  active: 0,
  latency,
});

describe('an app\'s traffic is what its processes reported, and only that', () => {
  it('adds the counts and keeps the busiest process\'s latency', () => {
    const out = combineProcessTraffic([traffic(10, 1, window(10, 80)), undefined, traffic(90, 2, window(90, 30))]);
    expect(out).toMatchObject({ requests: 100, serverErrors: 3, clientErrors: 2, probes: 14 });
    expect(out!.latency!.p95).toBe(30);
  });

  it('is not reported when no process reported — not zero', () => {
    expect(combineProcessTraffic([undefined, undefined])).toBeUndefined();
  });
});

describe('the orchestrator sums the traffic, not the wrapper\'s call counters', () => {
  const orchestratorWith = (children: Record<string, { requests?: number; errors?: number; traffic?: ReturnType<typeof traffic> }>) => {
    const handle = {
      name: 'daos/dev/main',
      status: 'online',
      mode: 'bootstrap',
      pid: 100,
      lastMetrics: null,
      childMetrics: new Map(),
      topologyProcesses: [],
      topologyPools: new Map(),
      supervisor: {
        getChildNames: () => Object.keys(children),
        getChildProcessId: (child: string) => `pid-of-${child}`,
        getChildMetrics: async (child: string) => ({ cpu: 1, memory: 1, ...children[child] }),
      },
    };
    const self: Record<string, unknown> = {
      handles: new Map([['daos/dev/main', handle]]),
      pm: { getWorkerHandle: (id: string) => ({ pid: id.length }) },
      sampleProcessMetricsBatch: async (pids: number[]) => new Map(pids.map((p) => [p, { cpu: 2, memory: 1024 }])),
      resolveTopologyPids: () => [],
    };
    self['resolveAppName'] = (name: string) => OrchestratorService.prototype.resolveAppName.call(self as never, name);
    self['sampleAppMetrics'] = (h: unknown) => (OrchestratorService.prototype as any).sampleAppMetrics.call(self, h);
    return (name?: string) => OrchestratorService.prototype.getMetrics.call(self as never, name);
  };

  it('does not count the supervisor\'s own calls to a child as the app\'s requests', async () => {
    const getMetrics = orchestratorWith({
      http: { requests: 3, errors: 0, traffic: traffic(250, 4) },
      // An older runtime: `requests` here are calls to the wrapper.
      'captcha-generator': { requests: 57, errors: 0 },
    });

    const out = (await getMetrics())['daos/dev/main']!;

    expect(out.requests).toBe(250);
    expect(out.errors).toBe(4);
    expect(out.traffic).toBeDefined();
    expect(out.latency!.p95).toBe(40);
  });

  it('reports nothing, not zero, when no process reported traffic', async () => {
    const out = (await orchestratorWith({ http: { requests: 12, errors: 0 } })())['daos/dev/main']!;
    expect(out.traffic).toBeUndefined();
    expect(out.requests).toBeUndefined();
  });

  it('finds `main` as `daos/dev/main`, and answers nothing for a name it does not have', async () => {
    const getMetrics = orchestratorWith({ http: { traffic: traffic(1) } });
    expect(Object.keys(await getMetrics('main'))).toEqual(['daos/dev/main']);
    expect(await getMetrics('nope')).toEqual({});
  });
});

describe('the report carries the traffic and says when there is none', () => {
  const rpcWith = (raw: Record<string, unknown>) =>
    new DaemonRpcService(
      { getMetrics: async (name?: string) => (name && !raw[name] ? {} : raw) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

  it('passes requests, 5xx, 4xx, probes and the latency window through', async () => {
    const out = await rpcWith({ 'daos/dev/main': { cpu: 3, memory: 9, traffic: traffic(250, 4) } }).getMetrics({});
    expect(out.apps['daos/dev/main']).toMatchObject({
      traffic: 'measured',
      requests: 250,
      errors: 4,
      clientErrors: 1,
      probes: 7,
      latency: { p95: 40, count: 250, windowMs: 60_000 },
    });
  });

  it('marks an app whose processes reported nothing as not-reported, with no zeros', async () => {
    const out = await rpcWith({ 'daos/dev/geo': { cpu: 1, memory: 2 } }).getMetrics({});
    expect(out.apps['daos/dev/geo']).toEqual({ cpu: 1, memory: 2, traffic: 'not-reported' });
  });

  it('refuses an unknown name', async () => {
    await expect(rpcWith({ 'daos/dev/main': { cpu: 1, memory: 1 } }).getMetrics({ name: 'nope' })).rejects.toThrow(/nope/);
  });
});

describe('the app process reports what its transports answered', () => {
  const processWith = (servers: unknown[] | null) => {
    const p = new (BootstrapProcess as unknown as new () => { reportTraffic(): unknown })();
    Object.assign(p as object, {
      app: servers === null ? null : { netron: { transportServers: new Map(servers.map((s, i) => [`t${i}`, s])) } },
    });
    return p;
  };
  const http = (requests: number, count: number, p95: number) => ({ getTrafficSnapshot: () => traffic(requests, 1, window(count, p95)) });

  it('sums its HTTP servers and ignores transports that keep no traffic', () => {
    const out = processWith([http(10, 10, 80), { getMetrics: () => ({ activeConnections: 3 }) }, http(30, 30, 20)]).reportTraffic() as ReturnType<typeof traffic>;
    expect(out.requests).toBe(40);
    expect(out.latency!.p95).toBe(20);
  });

  it('has nothing to report without a server — null, not zero', () => {
    expect(processWith([{ getMetrics: () => ({}) }]).reportTraffic()).toBeNull();
    expect(processWith(null).reportTraffic()).toBeNull();
  });
});

describe('long polls are counted apart, and the count survives the trip', () => {
  // A long poll's wait is kept out of the latency window by the server; the
  // number of such requests is how the report says the window is not all of
  // REQUESTS.
  const held = (n: number | undefined) => ({ ...traffic(10), ...(n === undefined ? {} : { held: n }) });

  it('adds the held requests of every process', () => {
    expect(combineProcessTraffic([held(3), held(4)])!.held).toBe(7);
    // A process on a runtime that does not count them adds nothing — and
    // does not turn the others' count into «unknown».
    expect(combineProcessTraffic([held(undefined), held(4)])!.held).toBe(4);
    expect(combineProcessTraffic([held(undefined), held(undefined)])).not.toHaveProperty('held');
  });

  it('adds the held requests of every HTTP server in a process', () => {
    const p = new (BootstrapProcess as unknown as new () => { reportTraffic(): unknown })();
    const server = (h: number) => ({ getTrafficSnapshot: () => ({ ...traffic(5), held: h }) });
    Object.assign(p as object, { app: { netron: { transportServers: new Map([['a', server(2)], ['b', server(5)]]) } } });
    expect((p.reportTraffic() as { held: number }).held).toBe(7);
  });

  it('puts the count in the report, and leaves it out when nobody counted', async () => {
    const rpc = (t: unknown) =>
      new DaemonRpcService(
        { getMetrics: async () => ({ 'daos/dev/main': { cpu: 1, memory: 1, traffic: t } }) } as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      );
    expect((await rpc(held(12)).getMetrics({})).apps['daos/dev/main']).toMatchObject({ held: 12 });
    expect((await rpc(held(undefined)).getMetrics({})).apps['daos/dev/main']).not.toHaveProperty('held');
  });
});
