/**
 * A health report that never asked an app.
 *
 * Three breaks, one behind the other, each enough on its own:
 *
 *   1. `DaemonRpcService.getHealth` returned the daemon's own titan-health
 *      indicators under `apps` — memory, docker, apps, event-loop-stalls, one
 *      «app» each — and ignored `name`. `omnitron health` printed «Apps: 5
 *      healthy» beside six apps, and `omnitron health main` printed the
 *      daemon's memory for a question about main.
 *   2. The orchestrator, which the RPC did not call, asked the FIRST child of
 *      an app and nothing else — main runs three — and compared the name
 *      verbatim, so `main` never found `daos/dev/main`.
 *   3. The bootstrap process called `hooks.onHealthCheck()` with no
 *      arguments, so the hook had nothing to ask; every daos app answered a
 *      literal `{ status: 'healthy' }` while its titan-health indicators
 *      (database, redis, …) measured and went unread.
 *
 * This court holds all three: the hook is handed the application, the app is
 * as healthy as its least healthy process (pools included), and the report
 * keeps the daemon's indicators apart from the apps.
 */

import { describe, it, expect, vi } from 'vitest';
import 'reflect-metadata';

import BootstrapProcess from '../../src/orchestrator/bootstrap-process.js';
import { combineProcessHealth, poolHealth, notRunningHealth, worstVerdict } from '../../src/orchestrator/app-health.js';
import { OrchestratorService } from '../../src/orchestrator/orchestrator.service.js';
import { DaemonRpcService } from '../../src/daemon/daemon.rpc-service.js';

type Verdict = 'healthy' | 'degraded' | 'unhealthy';
const answer = (status: Verdict, checks: Array<{ name: string; status: 'pass' | 'warn' | 'fail'; message?: string }> = []) => ({
  status,
  checks,
  timestamp: 1,
});

describe('the hook is handed the application it is asked about', () => {
  const processWith = (app: unknown, onHealthCheck?: (app: unknown) => Promise<unknown>) => {
    const p = new (BootstrapProcess as unknown as new () => { checkHealth(): Promise<unknown> })();
    Object.assign(p as object, { app, entry: { hooks: onHealthCheck ? { onHealthCheck } : {} } });
    return p;
  };

  it('passes the running Application, and returns the hook\'s checks unchanged', async () => {
    const app = { name: 'the-application' };
    const hook = vi.fn(async (_app: unknown) => ({
      status: 'degraded' as const,
      checks: [{ name: 'database', status: 'warn' as const, message: 'SELECT 1 took 900 ms' }],
    }));

    const out = await processWith(app, hook).checkHealth();

    expect(hook).toHaveBeenCalledWith(app);
    expect(out).toEqual({
      status: 'degraded',
      checks: [{ name: 'database', status: 'warn', message: 'SELECT 1 took 900 ms' }],
    });
  });

  it('does not call the hook without an application, and says why', async () => {
    const hook = vi.fn(async () => ({ status: 'healthy' as const }));

    const out = (await processWith(null, hook).checkHealth()) as { status: string; checks: Array<{ name: string }> };

    expect(hook).not.toHaveBeenCalled();
    expect(out.status).toBe('unhealthy');
    expect(out.checks[0]!.name).toBe('application');
  });
});

describe('an app is as healthy as its least healthy process', () => {
  it('names every process, and every check under the process that made it', () => {
    const out = combineProcessHealth([
      ['http', answer('healthy', [{ name: 'database', status: 'pass' }])],
      ['captcha-generator', answer('unhealthy', [{ name: 'redis', status: 'fail', message: 'ECONNREFUSED' }])],
      ['notification-worker', answer('healthy')],
    ]);

    expect(out.status).toBe('unhealthy');
    expect(out.checks).toEqual([
      { name: 'http: database', status: 'pass' },
      { name: 'captcha-generator: redis', status: 'fail', message: 'ECONNREFUSED' },
      { name: 'notification-worker', status: 'pass' },
    ]);
  });

  it('a process nobody could ask is not healthy — it is unmeasured, said at warn', () => {
    const out = combineProcessHealth([
      ['http', answer('healthy')],
      ['collector', null],
    ]);
    expect(out.status).toBe('degraded');
    expect(out.checks[1]).toMatchObject({ name: 'collector', status: 'warn' });
  });

  it('a pool is healthy only when every worker is', () => {
    expect(poolHealth({ totalWorkers: 2, healthyWorkers: 2 })!.status).toBe('healthy');
    expect(poolHealth({ totalWorkers: 2, healthyWorkers: 1 })!.status).toBe('degraded');
    expect(poolHealth({ totalWorkers: 2, healthyWorkers: 0 })!.status).toBe('unhealthy');
    expect(poolHealth({ totalWorkers: 0, healthyWorkers: 0 })!.status).toBe('unhealthy');
    expect(poolHealth(undefined)).toBeNull();
  });

  it('the worst verdict wins', () => {
    expect(worstVerdict([])).toBe('healthy');
    expect(worstVerdict(['healthy', 'degraded'])).toBe('degraded');
    expect(worstVerdict(['degraded', 'unhealthy', 'healthy'])).toBe('unhealthy');
  });
});

describe('the orchestrator asks every process of the app, by the name the operator used', () => {
  const orchestratorWith = (children: Record<string, ReturnType<typeof answer>>, pools: Record<string, { totalWorkers: number; healthyWorkers: number }> = {}, status = 'online') => {
    const asked: string[] = [];
    const handle = {
      status,
      mode: 'bootstrap',
      lastHealth: null,
      topologyPools: new Map(Object.entries(pools).map(([name, metrics]) => [name, { metrics }])),
      supervisor: {
        getChildNames: () => Object.keys(children),
        getChildHealth: async (child: string) => {
          asked.push(child);
          return children[child] ?? null;
        },
      },
    };
    const self = {
      handles: new Map([['daos/dev/main', handle]]),
      resolveAppName: (name: string) => OrchestratorService.prototype.resolveAppName.call(self as never, name),
    };
    const getHealth = (name?: string) => OrchestratorService.prototype.getHealth.call(self as never, name);
    return { getHealth, asked };
  };

  it('asks all three of main\'s processes, not the first', async () => {
    const o = orchestratorWith({
      http: answer('healthy'),
      'captcha-generator': answer('healthy'),
      'notification-worker': answer('unhealthy', [{ name: 'redis', status: 'fail' }]),
    });

    const out = await o.getHealth();

    expect(o.asked.sort()).toEqual(['captcha-generator', 'http', 'notification-worker']);
    expect(out['daos/dev/main']!.status).toBe('unhealthy');
  });

  it('includes the worker pools, which are not supervisor children', async () => {
    const o = orchestratorWith({ http: answer('healthy') }, { transform: { totalWorkers: 2, healthyWorkers: 1 } });

    const out = await o.getHealth();

    expect(out['daos/dev/main']!.status).toBe('degraded');
    expect(out['daos/dev/main']!.checks.map((c) => c.name)).toContain('transform: workers');
  });

  it('finds `main` as `daos/dev/main`, and answers nothing for a name it does not have', async () => {
    const o = orchestratorWith({ http: answer('healthy') });

    expect(Object.keys(await o.getHealth('main'))).toEqual(['daos/dev/main']);
    expect(await o.getHealth('nope')).toEqual({});
  });

  it('an app that is not running is unhealthy, and says so', async () => {
    const o = orchestratorWith({ http: answer('healthy') }, {}, 'crashed');

    const out = await o.getHealth();

    expect(out['daos/dev/main']).toEqual(notRunningHealth('crashed', out['daos/dev/main']!.timestamp));
    expect(out['daos/dev/main']!.checks[0]!.message).toMatch(/crashed/);
    expect(o.asked).toEqual([]);
  });
});

describe('the report keeps the daemon apart from the apps', () => {
  const rpcWith = (apps: Record<string, ReturnType<typeof answer> | null>) => {
    const orchestrator = {
      getHealth: async (name?: string) => {
        if (name === undefined) return apps;
        const key = Object.keys(apps).find((k) => k === name || k.endsWith(`/${name}`));
        return key ? { [key]: apps[key]! } : {};
      },
    };
    const titanHealth = {
      check: async () => ({
        status: 'healthy',
        indicators: {
          memory: { status: 'healthy', message: 'within limits' },
          docker: { status: 'healthy' },
          apps: { status: 'healthy', message: 'All 6 apps online' },
          'event-loop-stalls': { status: 'healthy' },
        },
      }),
    };
    return new DaemonRpcService(orchestrator as never, titanHealth as never, {} as never, {} as never, {} as never);
  };

  it('puts the daemon\'s indicators under `daemon`, and only apps under `apps`', async () => {
    const out = await rpcWith({
      'daos/dev/main': answer('healthy'),
      'daos/dev/geo': answer('degraded', [{ name: 'http: nominatim', status: 'warn' }]),
    }).getHealth({});

    expect(Object.keys(out.apps).sort()).toEqual(['daos/dev/geo', 'daos/dev/main']);
    expect(out.daemon!.indicators.map((i) => i.name)).toEqual(['memory', 'docker', 'apps', 'event-loop-stalls']);
    // The app's verdict reaches the overall one; the daemon alone was healthy.
    expect(out.overall).toBe('degraded');
  });

  it('answers a question about one app with that app, not with the daemon', async () => {
    const out = await rpcWith({ 'daos/dev/main': answer('unhealthy', [{ name: 'http: database', status: 'fail' }]) }).getHealth({
      name: 'main',
    });

    expect(out.daemon).toBeUndefined();
    expect(Object.keys(out.apps)).toEqual(['daos/dev/main']);
    expect(out.overall).toBe('unhealthy');
  });

  it('refuses a name it does not have, instead of answering healthy about nothing', async () => {
    await expect(rpcWith({ 'daos/dev/main': answer('healthy') }).getHealth({ name: 'nope' })).rejects.toThrow(/nope/);
  });
});
