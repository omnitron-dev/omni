import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import 'reflect-metadata';
import { ServiceRouter } from '../../src/orchestrator/service-router.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const createMockLogger = (): any => ({
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
  child: vi.fn(() => createMockLogger()),
  time: vi.fn(() => vi.fn()),
  isLevelEnabled: vi.fn(() => true),
  setLevel: vi.fn(),
  getLevel: vi.fn(() => 'info'),
});

const createMockPool = () => ({
  execute: vi.fn().mockResolvedValue('pool-result'),
  getWorkerIds: vi.fn(() => []),
  getWorkerHandle: vi.fn(),
  metrics: null,
});

/**
 * Lightweight Netron stand-in that satisfies the subset of the Netron API
 * used by ServiceRouter (services map, peer.exposeService / peer.unexposeService).
 */
const createMockNetron = () => {
  const services = new Map<string, unknown>();

  return {
    services,
    peer: {
      exposeService: vi.fn(async (instance: any) => {
        const meta = Reflect.getMetadata('netron:service', instance.constructor);
        if (!meta) throw new Error('No service metadata on instance');
        const qualifiedName = meta.version
          ? `${meta.name}@${meta.version}`
          : meta.name;
        services.set(qualifiedName, instance);
      }),
      unexposeService: vi.fn(async (qualifiedName: string) => {
        services.delete(qualifiedName);
      }),
    },
  };
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ServiceRouter', () => {
  let router: ServiceRouter;
  let netron: ReturnType<typeof createMockNetron>;
  let logger: ReturnType<typeof createMockLogger>;
  let pool: ReturnType<typeof createMockPool>;

  beforeEach(() => {
    netron = createMockNetron();
    logger = createMockLogger();
    pool = createMockPool();
    router = new ServiceRouter(netron as any, logger);
  });

  // -----------------------------------------------------------------------
  // 1. exposePoolService registers service on Netron
  // -----------------------------------------------------------------------
  describe('exposePoolService', () => {
    it('registers the service on Netron and in the router', async () => {
      await router.exposePoolService(
        'aggregator-proc',
        'Aggregator',
        '1.0.0',
        pool as any,
        ['process', 'transform'],
      );

      // Netron side: peer.exposeService was called and services map populated
      expect(netron.peer.exposeService).toHaveBeenCalledTimes(1);
      expect(netron.services.has('Aggregator@1.0.0')).toBe(true);

      // Router side: service name tracked
      expect(router.getServiceNames()).toContain('Aggregator@1.0.0');
    });

    it('handles services without a version string', async () => {
      await router.exposePoolService(
        'simple-proc',
        'Simple',
        '',
        pool as any,
        ['run'],
      );

      expect(netron.services.has('Simple')).toBe(true);
      expect(router.getServiceNames()).toContain('Simple');
    });
  });

  // -----------------------------------------------------------------------
  // 2. Pool proxy delegates to pool.execute()
  // -----------------------------------------------------------------------
  describe('pool proxy delegation', () => {
    it('delegates method calls to pool.execute() with correct arguments', async () => {
      await router.exposePoolService(
        'worker-proc',
        'Worker',
        '2.0.0',
        pool as any,
        ['process', 'transform'],
      );

      const stub = netron.services.get('Worker@2.0.0') as any;
      expect(stub).toBeDefined();

      // Call the proxied method
      const result = await stub.process('arg1', 42);

      expect(pool.execute).toHaveBeenCalledWith('callExposedService', 'Worker', 'process', ['arg1', 42]);
      expect(result).toBe('pool-result');
    });

    it('delegates different methods independently', async () => {
      pool.execute
        .mockResolvedValueOnce('process-result')
        .mockResolvedValueOnce('transform-result');

      await router.exposePoolService(
        'worker-proc',
        'Worker',
        '1.0.0',
        pool as any,
        ['process', 'transform'],
      );

      const stub = netron.services.get('Worker@1.0.0') as any;

      const r1 = await stub.process('data');
      const r2 = await stub.transform('input');

      expect(pool.execute).toHaveBeenNthCalledWith(1, 'callExposedService', 'Worker', 'process', ['data']);
      expect(pool.execute).toHaveBeenNthCalledWith(2, 'callExposedService', 'Worker', 'transform', ['input']);
      expect(r1).toBe('process-result');
      expect(r2).toBe('transform-result');
    });

    it('propagates errors from pool.execute()', async () => {
      pool.execute.mockRejectedValueOnce(new Error('worker crashed'));

      await router.exposePoolService(
        'crash-proc',
        'Crasher',
        '1.0.0',
        pool as any,
        ['run'],
      );

      const stub = netron.services.get('Crasher@1.0.0') as any;
      await expect(stub.run()).rejects.toThrow('worker crashed');
    });
  });

  // -----------------------------------------------------------------------
  // 3. unexposeService removes from Netron and router
  // -----------------------------------------------------------------------
  describe('unexposeService', () => {
    it('removes the service from both Netron and the router', async () => {
      await router.exposePoolService(
        'proc-a',
        'Alpha',
        '1.0.0',
        pool as any,
        ['run'],
      );

      expect(router.getServiceNames()).toContain('Alpha@1.0.0');

      await router.unexposeService('Alpha', '1.0.0');

      expect(netron.peer.unexposeService).toHaveBeenCalledWith('Alpha@1.0.0');
      expect(netron.services.has('Alpha@1.0.0')).toBe(false);
      expect(router.getServiceNames()).not.toContain('Alpha@1.0.0');
    });

    it('is a no-op when the service does not exist', async () => {
      await router.unexposeService('NonExistent', '1.0.0');

      expect(netron.peer.unexposeService).not.toHaveBeenCalled();
      expect(router.getServiceNames()).toHaveLength(0);
    });

    it('handles unexpose without version', async () => {
      await router.exposePoolService(
        'proc-b',
        'Beta',
        '',
        pool as any,
        ['compute'],
      );

      await router.unexposeService('Beta');

      expect(netron.services.has('Beta')).toBe(false);
      expect(router.getServiceNames()).not.toContain('Beta');
    });
  });

  // -----------------------------------------------------------------------
  // 4. releaseAll gives back everything this router registered
  //
  // This section asserted `cleanupProcess(processName)`, which `20ae24e5`
  // removed, and its own docblock says why: one child of a pool crashing does
  // not mean the service is gone — the other workers still serve it — so
  // per-process granularity would have deregistered a service that still
  // works. The router is built fresh per app launch and torn down whole, so
  // the unit that is released is the router.
  //
  // The tests were left behind by that commit and by `377d84e6` below, which
  // is how three of them sat red pinning behaviour that had been deliberately
  // replaced.
  // -----------------------------------------------------------------------
  describe('releaseAll', () => {
    it('gives back every name it registered', async () => {
      for (const [proc, name] of [['multi-proc', 'ServiceA'], ['multi-proc', 'ServiceB'], ['other-proc', 'ServiceC']]) {
        await router.exposePoolService(proc!, name!, '1.0.0', pool as any, ['run']);
      }
      expect(router.getServiceNames()).toHaveLength(3);

      await router.releaseAll();

      expect(router.getServiceNames()).toEqual([]);
      for (const name of ['ServiceA@1.0.0', 'ServiceB@1.0.0', 'ServiceC@1.0.0']) {
        expect(netron.services.has(name)).toBe(false);
      }
    });

    it('is a no-op on a router that registered nothing', async () => {
      await expect(router.releaseAll()).resolves.toBeUndefined();
      expect(router.getServiceNames()).toEqual([]);
    });

    it('keeps going when one name is already gone from the daemon', async () => {
      // Best-effort by design: a name that has already gone is the outcome
      // this wanted, and one failure must not stop an app from being stopped
      // with its other registrations still advertised.
      await router.exposePoolService('proc-a', 'Alpha', '1.0.0', pool as any, ['run']);
      await router.exposePoolService('proc-b', 'Beta', '1.0.0', pool as any, ['run']);

      const real = netron.peer.unexposeService;
      let first = true;
      netron.peer.unexposeService = vi.fn(async (name: string) => {
        if (first) {
          first = false;
          throw new Error('Service not found');
        }
        return real(name);
      });

      await router.releaseAll();

      expect(router.getServiceNames()).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // 5. A second registration of a name TAKES OVER — it does not return early
  //
  // Returning early is what this asserted, and `377d84e6` replaced it with
  // the opposite for a measured reason: `launchTopology` builds a fresh
  // ServiceRouter on every launch, so after a restart the map is empty while
  // the daemon still holds the previous registration, bound to a pool whose
  // workers are gone. Skipping the re-registration kept the DEAD one, and
  // every call through the name failed `Socket closed during RPC` for the
  // life of the daemon — pricing's OHLCV aggregation stopped for forty
  // minutes across three restarts and did not recover.
  // -----------------------------------------------------------------------
  describe('re-registration', () => {
    it('replaces the existing registration rather than skipping', async () => {
      await router.exposePoolService('proc-dup', 'DupService', '1.0.0', pool as any, ['run']);
      await router.exposePoolService('proc-dup', 'DupService', '1.0.0', pool as any, ['run', 'extra']);

      // Twice: the point is that the SECOND pool is the one now serving.
      expect(netron.peer.exposeService).toHaveBeenCalledTimes(2);
      expect(router.getServiceNames()).toEqual(['DupService@1.0.0']);
    });

    it('unexposes the old name before exposing the new one', async () => {
      await router.exposePoolService('proc-dup', 'DupService', '1.0.0', pool as any, ['run']);
      const before = (netron.peer.unexposeService as ReturnType<typeof vi.fn>).mock.calls.length;

      await router.exposePoolService('proc-dup', 'DupService', '1.0.0', pool as any, ['run']);

      expect((netron.peer.unexposeService as ReturnType<typeof vi.fn>).mock.calls.length).toBe(before + 1);
    });

    it('says so, with whether this router knew about the name', async () => {
      // `knownToThisRouter: false` is the restart case — the daemon held a
      // registration this router never made. Worth distinguishing in the log,
      // because the two arrive by different routes.
      await router.exposePoolService('proc-dup', 'DupService', '1.0.0', pool as any, ['run']);
      await router.exposePoolService('proc-dup', 'DupService', '1.0.0', pool as any, ['run']);

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ qualifiedName: 'DupService@1.0.0', knownToThisRouter: true }),
        expect.stringContaining('Replaced an existing registration'),
      );
    });
  });

  // -----------------------------------------------------------------------
  // 6. getService returns registration info
  // -----------------------------------------------------------------------
  describe('getService', () => {
    it('returns registration details for an exposed service', async () => {
      await router.exposePoolService(
        'info-proc',
        'InfoSvc',
        '1.0.0',
        pool as any,
        ['query'],
      );

      const reg = router.getService('InfoSvc@1.0.0');

      expect(reg).toBeDefined();
      expect(reg!.type).toBe('pool');
      expect(reg!.processName).toBe('info-proc');
      expect(reg!.serviceName).toBe('InfoSvc');
      expect(reg!.serviceVersion).toBe('1.0.0');
      expect(reg!.instance).toBeDefined();
    });

    it('returns undefined for an unknown service', () => {
      expect(router.getService('Unknown@1.0.0')).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // 7. Proxy metadata correctness
  // -----------------------------------------------------------------------
  describe('proxy metadata', () => {
    it('attaches netron:service metadata with correct name, version, and methods', async () => {
      await router.exposePoolService(
        'meta-proc',
        'MetaSvc',
        '3.0.0',
        pool as any,
        ['alpha', 'beta', 'gamma'],
      );

      const stub = netron.services.get('MetaSvc@3.0.0') as any;
      const meta = Reflect.getMetadata('netron:service', stub.constructor);

      expect(meta).toBeDefined();
      expect(meta.name).toBe('MetaSvc');
      expect(meta.version).toBe('3.0.0');
      // Plain-object index, keyed by member name — the shape Titan's own
      // @Service builds and the one `Interface` reads. This used to assert a
      // Map, which is what the router built and what made every call through
      // it fail with "Unknown member".
      expect(Object.keys(meta.methods).sort()).toEqual(['alpha', 'beta', 'gamma']);
      for (const methodMeta of Object.values<any>(meta.methods)) {
        expect(methodMeta.arguments, 'Netron reads an argument list off each member').toEqual([]);
      }
    });
  });
});

/**
 * The metadata a router proxy carries has to be the shape Netron reads.
 *
 * `Interface` resolves every remote call through `$def.meta.methods[prop]` —
 * a plain-object index, built that way by Titan's own `@Service` decorator.
 * These were `Map`s, which index to `undefined` for every name. The effect was
 * a service that registered cleanly, a `queryInterface` that succeeded, a
 * proxy that looked healthy, and a first call that answered "Unknown member:
 * 'x' is not defined in the service interface". The daemon's own log said it
 * had exposed five methods, because it counted the names it was handed rather
 * than the definition it produced.
 *
 * Live consequence: pricing's OHLCV aggregation reached this point and
 * failed on every tick, and every other pool service exposed through this
 * router was unreachable the same way.
 */
describe('ServiceRouter proxy metadata', () => {
  it('indexes methods by name the way Netron reads them', async () => {
    const netron = createMockNetron();
    const router = new ServiceRouter(netron as any, createMockLogger());
    const pool = createMockPool();

    await router.exposePoolService('ohlcv-aggregator', 'OhlcvAggregatorWorker', '1.0.0', pool as any, [
      'aggregate5Min',
      'aggregate1Hour',
    ]);

    const instance: any = netron.services.get('OhlcvAggregatorWorker@1.0.0');
    const meta = Reflect.getMetadata('netron:service', instance.constructor);

    expect(meta.methods['aggregate5Min'], 'the member Netron looks up is missing').toBeDefined();
    expect(meta.methods['aggregate1Hour']).toBeDefined();
    expect(meta.properties, 'properties is indexed the same way').toEqual({});
  });

  it('still routes a call through the pool', async () => {
    const netron = createMockNetron();
    const router = new ServiceRouter(netron as any, createMockLogger());
    const pool = createMockPool();

    await router.exposePoolService('ohlcv-aggregator', 'OhlcvAggregatorWorker', '1.0.0', pool as any, [
      'aggregate5Min',
    ]);

    const instance: any = netron.services.get('OhlcvAggregatorWorker@1.0.0');
    await instance.aggregate5Min('arg');

    // Through the bootstrap process's forwarding hop, not straight at the
    // pool: the pool's own PM service is `BootstrapApp`, which has no
    // `aggregate5Min` and answers "Unknown member" naming a service the caller
    // never asked for.
    expect(pool.execute).toHaveBeenCalledWith(
      'callExposedService',
      'OhlcvAggregatorWorker',
      'aggregate5Min',
      ['arg']
    );
  });
});
