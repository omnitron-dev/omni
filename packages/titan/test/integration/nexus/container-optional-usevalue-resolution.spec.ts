/**
 * Nexus Container - @Optional + useValue + Module Hierarchy Resolution Tests
 *
 * Reproduces the scenario where:
 * 1. A module registers a service (TransformService) with @Optional @Inject dependency
 * 2. The optional token (topology:transform) is registered with useValue on the ROOT container
 *    AFTER module loading (simulating how Omnitron injects topology proxies)
 * 3. resolveAsync is called on the service — this should NOT hang
 *
 * Bug: resolveAsync hangs indefinitely when resolving @Optional dependencies
 * registered via useValue on a parent container.
 *
 * @since 0.5.0
 */

import 'reflect-metadata';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Container, createToken } from '@nexus';
import { Injectable, Inject, Optional, Module } from '../../../src/decorators/index.js';

// ─── Tokens ───────────────────────────────────────────────────────────────────

const CONFIG_TOKEN = createToken<{ value: string }>('Config');
const OPTIONAL_POOL_TOKEN = createToken<any>('topology:transform');
const SERVICE_TOKEN = createToken<TestService>('TestService');
const RPC_SERVICE_TOKEN = createToken<TestRpcService>('TestRpcService');

// ─── Test services ────────────────────────────────────────────────────────────

@Injectable()
class TestService {
  public pool: any;
  public config: { value: string };

  constructor(@Inject(CONFIG_TOKEN) config: { value: string }, @Optional() @Inject(OPTIONAL_POOL_TOKEN) pool?: any) {
    this.config = config;
    this.pool = pool ?? null;
  }
}

@Injectable()
class TestRpcService {
  constructor(@Inject(SERVICE_TOKEN) public readonly service: TestService) {}
}

// ─── Module ───────────────────────────────────────────────────────────────────

@Module({
  providers: [
    { provide: CONFIG_TOKEN, useValue: { value: 'test-config' } },
    { provide: SERVICE_TOKEN, useClass: TestService },
    TestRpcService,
  ],
  exports: [SERVICE_TOKEN, TestRpcService],
})
class TestModule {}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Container: @Optional useValue on parent with module hierarchy', () => {
  let container: Container;

  beforeEach(() => {
    container = new Container();
  });

  afterEach(async () => {
    await container.dispose();
  });

  describe('Flat container (no modules)', () => {
    it('should resolve @Optional dependency registered with useValue', async () => {
      const proxyValue = { type: 'topology-proxy', name: 'transform' };

      container.register(CONFIG_TOKEN, { useValue: { value: 'cfg' } });
      container.register(OPTIONAL_POOL_TOKEN, { useValue: proxyValue });
      container.register(SERVICE_TOKEN, { useClass: TestService });

      const service = await container.resolveAsync(SERVICE_TOKEN);

      expect(service).toBeInstanceOf(TestService);
      expect(service.config).toEqual({ value: 'cfg' });
      expect(service.pool).toBe(proxyValue);
    });

    it('should resolve @Optional dependency as undefined when not registered', async () => {
      container.register(CONFIG_TOKEN, { useValue: { value: 'cfg' } });
      container.register(SERVICE_TOKEN, { useClass: TestService });

      const service = await container.resolveAsync(SERVICE_TOKEN);

      expect(service).toBeInstanceOf(TestService);
      expect(service.config).toEqual({ value: 'cfg' });
      expect(service.pool).toBeNull(); // constructor defaults to null
    });

    it('should resolve RPC service depending on @Optional service', async () => {
      const proxyValue = { type: 'topology-proxy' };

      container.register(CONFIG_TOKEN, { useValue: { value: 'cfg' } });
      container.register(OPTIONAL_POOL_TOKEN, { useValue: proxyValue });
      container.register(SERVICE_TOKEN, { useClass: TestService });
      container.register(RPC_SERVICE_TOKEN, { useClass: TestRpcService });

      const rpc = await container.resolveAsync(RPC_SERVICE_TOKEN);

      expect(rpc).toBeInstanceOf(TestRpcService);
      expect(rpc.service.pool).toBe(proxyValue);
    });
  });

  describe('Parent-child container (simulates module hierarchy)', () => {
    it('should resolve @Optional useValue from parent container', async () => {
      const proxyValue = { type: 'topology-proxy', name: 'transform' };

      // Parent (root) has the topology token
      container.register(OPTIONAL_POOL_TOKEN, { useValue: proxyValue });

      // Child (module container) has the service
      const child = container.createScope() as Container;
      child.register(CONFIG_TOKEN, { useValue: { value: 'child-cfg' } });
      child.register(SERVICE_TOKEN, { useClass: TestService });

      const service = await child.resolveAsync(SERVICE_TOKEN);

      expect(service).toBeInstanceOf(TestService);
      expect(service.pool).toBe(proxyValue);
    });

    it('should NOT hang when @Optional token is on parent and resolved from child', async () => {
      const proxyValue = { type: 'topology-proxy' };

      // Root container
      container.register(OPTIONAL_POOL_TOKEN, { useValue: proxyValue });

      // Module-level child container
      const child = container.createScope() as Container;
      child.register(CONFIG_TOKEN, { useValue: { value: 'cfg' } });
      child.register(SERVICE_TOKEN, { useClass: TestService });
      child.register(RPC_SERVICE_TOKEN, { useClass: TestRpcService });

      // This must complete within 5s (should be instant)
      const rpc = await Promise.race([
        child.resolveAsync(RPC_SERVICE_TOKEN),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('TIMEOUT: resolveAsync hung for 5 seconds')), 5000)
        ),
      ]);

      expect(rpc).toBeInstanceOf(TestRpcService);
      expect(rpc.service.pool).toBe(proxyValue);
    });

    it('should resolve @Optional as undefined when parent does NOT have the token', async () => {
      // Root container — NO topology token registered
      const child = container.createScope() as Container;
      child.register(CONFIG_TOKEN, { useValue: { value: 'cfg' } });
      child.register(SERVICE_TOKEN, { useClass: TestService });

      // This must complete, not hang
      const service = await Promise.race([
        child.resolveAsync(SERVICE_TOKEN),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('TIMEOUT: resolveAsync hung for 5 seconds')), 5000)
        ),
      ]);

      expect(service).toBeInstanceOf(TestService);
      expect(service.pool).toBeNull();
    });
  });

  describe('useValue with real lifecycle methods (ConfigService scenario)', () => {
    /**
     * Reproduces the ConfigService bug:
     *
     * ConfigModule.forRoot() registers ConfigService as useValue.
     * ConfigService.onInit() loads file-based config sources.
     * The blanket isUseValue skip prevented onInit from being called,
     * causing config.get('database') to return undefined.
     *
     * The fix: prototype-based lifecycle detection (hasPrototypeMethod) correctly
     * identifies real methods on the prototype chain while ignoring Proxy traps.
     */
    class MockConfigService {
      initialized = false;
      config: Record<string, any> = {};

      async onInit(): Promise<void> {
        this.initialized = true;
        this.config = { database: { host: 'localhost', port: 5432 } };
      }

      get(path: string): any {
        return this.config[path];
      }

      disposed = false;
      async onDestroy(): Promise<void> {
        this.disposed = true;
      }
    }

    const MOCK_CONFIG_TOKEN = createToken<MockConfigService>('MockConfigService');

    it('should call onInit on useValue with real prototype method', async () => {
      const configService = new MockConfigService();
      container.register(MOCK_CONFIG_TOKEN, { useValue: configService });

      const resolved = await container.resolveAsync(MOCK_CONFIG_TOKEN);

      expect(resolved).toBe(configService);
      expect(resolved.initialized).toBe(true);
      expect(resolved.get('database')).toEqual({ host: 'localhost', port: 5432 });
    });

    it('should call onDestroy on useValue with real prototype method during disposal', async () => {
      const configService = new MockConfigService();
      container.register(MOCK_CONFIG_TOKEN, { useValue: configService });

      const resolved = await container.resolveAsync(MOCK_CONFIG_TOKEN);
      expect(resolved.initialized).toBe(true);

      await container.dispose();
      expect(configService.disposed).toBe(true);
    });

    it('should distinguish real methods from Proxy traps on the same container', async () => {
      // Register a real service with lifecycle methods
      const configService = new MockConfigService();
      container.register(MOCK_CONFIG_TOKEN, { useValue: configService });

      // Register a Proxy value (no real lifecycle methods)
      const proxyCallLog: string[] = [];
      const proxyValue = new Proxy(
        {},
        {
          get(_target, property: string | symbol) {
            if (typeof property === 'symbol') return undefined;
            if (property === 'then' || property === 'catch' || property === 'finally') return undefined;
            return (...args: unknown[]) => {
              proxyCallLog.push(String(property));
              return Promise.resolve();
            };
          },
        }
      );
      container.register(OPTIONAL_POOL_TOKEN, { useValue: proxyValue });
      container.register(CONFIG_TOKEN, { useValue: { value: 'cfg' } });
      container.register(SERVICE_TOKEN, { useClass: TestService });

      const [config, service] = await Promise.all([
        container.resolveAsync(MOCK_CONFIG_TOKEN),
        container.resolveAsync(SERVICE_TOKEN),
      ]);

      // ConfigService's onInit was called
      expect(config.initialized).toBe(true);
      expect(config.get('database')).toBeTruthy();

      // Proxy's lifecycle methods were NOT called
      const lifecycleCalls = proxyCallLog.filter((m) => ['onInit', 'initialize', 'onDestroy', 'dispose'].includes(m));
      expect(lifecycleCalls).toEqual([]);

      // Service got the proxy value correctly
      expect(service.pool).toBe(proxyValue);
    });
  });

  describe('JS Proxy as useValue (topology proxy scenario)', () => {
    /**
     * Reproduces the real production bug:
     *
     * TopologyProxy uses a JS Proxy with a catch-all `get` trap that returns
     * a function for ANY property access. The DI container's lifecycle service
     * checks `typeof instance.onInit === 'function'` and `typeof instance.initialize === 'function'`.
     * For a catch-all Proxy, these return true, causing the container to call
     * `await instance.onInit()` — which dispatches an IPC call to a non-existent
     * method, hanging until the 120s timeout.
     */
    it('should NOT call lifecycle methods on a JS Proxy registered via useValue', async () => {
      const methodsCalled: string[] = [];

      // Simulate TopologyProxy: a Proxy with catch-all get trap
      const rawTarget = { __name: 'transform-proxy' };
      const proxyValue = new Proxy(rawTarget, {
        get(_target, property: string | symbol) {
          if (typeof property === 'symbol') return undefined;
          if (property === 'then' || property === 'catch' || property === 'finally') return undefined;
          if (property === '__name') return 'transform-proxy';

          // Catch-all: return a function for ANY property
          // This is what makes lifecycle detection report false positives
          return (...args: unknown[]) => {
            methodsCalled.push(property);
            return new Promise((_resolve, reject) => {
              // Simulate timeout — real TopologyProxy waits 120s
              setTimeout(() => reject(new Error(`Timeout calling ${property}`)), 500);
            });
          };
        },
      });

      container.register(CONFIG_TOKEN, { useValue: { value: 'cfg' } });
      container.register(OPTIONAL_POOL_TOKEN, { useValue: proxyValue });
      container.register(SERVICE_TOKEN, { useClass: TestService });

      // This must complete within 2s — without the fix, it hangs for 120s
      const service = await Promise.race([
        container.resolveAsync(SERVICE_TOKEN),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('TIMEOUT: resolveAsync hung — lifecycle methods called on Proxy')), 2000)
        ),
      ]);

      expect(service).toBeInstanceOf(TestService);
      expect(service.pool).toBe(proxyValue);

      // Verify NO lifecycle methods were called on the proxy
      // The container should NOT have called onInit, initialize, etc.
      const lifecycleMethods = methodsCalled.filter((m) =>
        ['onInit', 'initialize', 'onDestroy', 'dispose'].includes(m)
      );
      expect(lifecycleMethods).toEqual([]);
    });

    it('should resolve quickly when Proxy useValue has lifecycle-like methods', async () => {
      // A proxy that makes ALL property accesses look like functions
      const proxyValue = new Proxy(
        {},
        {
          get(_target, property: string | symbol) {
            if (typeof property === 'symbol') return undefined;
            if (property === 'then' || property === 'catch' || property === 'finally') return undefined;
            // Every property returns a function — this is the core issue
            return () =>
              new Promise(() => {
                /* never resolves */
              });
          },
        }
      );

      container.register(CONFIG_TOKEN, { useValue: { value: 'cfg' } });
      container.register(OPTIONAL_POOL_TOKEN, { useValue: proxyValue });
      container.register(SERVICE_TOKEN, { useClass: TestService });

      const start = performance.now();
      const service = await Promise.race([
        container.resolveAsync(SERVICE_TOKEN),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 3000)),
      ]);
      const elapsed = performance.now() - start;

      expect(service).toBeInstanceOf(TestService);
      // Should complete in <100ms, not 120s
      expect(elapsed).toBeLessThan(1000);
    });
  });
});
