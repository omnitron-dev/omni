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

      expect(pool.execute).toHaveBeenCalledWith('process', 'arg1', 42);
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

      expect(pool.execute).toHaveBeenNthCalledWith(1, 'process', 'data');
      expect(pool.execute).toHaveBeenNthCalledWith(2, 'transform', 'input');
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
  // 4. cleanupProcess removes all services for that process
  // -----------------------------------------------------------------------
  describe('cleanupProcess', () => {
    it('removes all services registered under the given process name', async () => {
      await router.exposePoolService(
        'multi-proc',
        'ServiceA',
        '1.0.0',
        pool as any,
        ['methodA'],
      );

      await router.exposePoolService(
        'multi-proc',
        'ServiceB',
        '1.0.0',
        pool as any,
        ['methodB'],
      );

      // A service under a different process should survive
      await router.exposePoolService(
        'other-proc',
        'ServiceC',
        '1.0.0',
        pool as any,
        ['methodC'],
      );

      expect(router.getServiceNames()).toHaveLength(3);

      await router.cleanupProcess('multi-proc');

      expect(router.getServiceNames()).toEqual(['ServiceC@1.0.0']);
      expect(netron.services.has('ServiceA@1.0.0')).toBe(false);
      expect(netron.services.has('ServiceB@1.0.0')).toBe(false);
      expect(netron.services.has('ServiceC@1.0.0')).toBe(true);
    });

    it('is a no-op when no services match the process name', async () => {
      await router.exposePoolService(
        'proc-x',
        'SvcX',
        '1.0.0',
        pool as any,
        ['run'],
      );

      await router.cleanupProcess('proc-y');

      expect(router.getServiceNames()).toEqual(['SvcX@1.0.0']);
    });
  });

  // -----------------------------------------------------------------------
  // 5. Duplicate service name returns early (no error)
  // -----------------------------------------------------------------------
  describe('duplicate registration', () => {
    it('returns early without error when exposing the same service twice', async () => {
      await router.exposePoolService(
        'proc-dup',
        'DupService',
        '1.0.0',
        pool as any,
        ['run'],
      );

      // Second call with the same qualified name
      await router.exposePoolService(
        'proc-dup',
        'DupService',
        '1.0.0',
        pool as any,
        ['run', 'extra'],
      );

      // exposeService should only have been called once
      expect(netron.peer.exposeService).toHaveBeenCalledTimes(1);
      // Warn log emitted on duplicate
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ qualifiedName: 'DupService@1.0.0' }),
        expect.stringContaining('already registered'),
      );
      // Still exactly one service
      expect(router.getServiceNames()).toEqual(['DupService@1.0.0']);
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
      expect(meta.methods.size).toBe(3);
      expect(meta.methods.has('alpha')).toBe(true);
      expect(meta.methods.has('beta')).toBe(true);
      expect(meta.methods.has('gamma')).toBe(true);

      // Each method marked public
      for (const [, methodMeta] of meta.methods) {
        expect(methodMeta.public).toBe(true);
      }
    });
  });
});
