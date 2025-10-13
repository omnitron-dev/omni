/**
 * Tests for Worker Bundling System
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  WorkerBundler,
  TypedWorker,
  WorkerPool,
  WorkerPerformanceMonitor,
  MockWorker,
  HMRWorkerManager,
  type WorkerBundlingConfig,
  type WorkerDetectionResult,
  type WorkerBundleResult,
} from '../../src/build/worker-bundling.js';

describe('WorkerBundler', () => {
  let bundler: WorkerBundler;

  beforeEach(() => {
    bundler = new WorkerBundler({
      inline: true,
      inlineThreshold: 50000,
      minify: true,
      sourcemap: true,
    });
  });

  describe('Worker Detection', () => {
    it('should detect Web Worker instantiation', () => {
      const code = `
        const worker = new Worker('./worker.js');
        const worker2 = new Worker("./worker2.js");
      `;

      const workers = bundler.detectWorkers(code);

      expect(workers).toHaveLength(2);
      expect(workers[0]?.source).toBe('./worker.js');
      expect(workers[0]?.type).toBe('web-worker');
      expect(workers[1]?.source).toBe('./worker2.js');
    });

    it('should detect Module Worker instantiation', () => {
      const code = `
        const worker = new Worker('./worker.js', { type: 'module' });
      `;

      const workers = bundler.detectWorkers(code);

      expect(workers).toHaveLength(1);
      expect(workers[0]?.source).toBe('./worker.js');
      expect(workers[0]?.type).toBe('module-worker');
      expect(workers[0]?.options?.type).toBe('module');
    });

    it('should detect Service Worker registration', () => {
      const code = `
        navigator.serviceWorker.register('/sw.js');
      `;

      const workers = bundler.detectWorkers(code);

      expect(workers).toHaveLength(1);
      expect(workers[0]?.source).toBe('/sw.js');
      expect(workers[0]?.type).toBe('service-worker');
    });

    it('should detect Shared Worker instantiation', () => {
      const code = `
        const shared = new SharedWorker('./shared.js', 'shared-worker');
      `;

      const workers = bundler.detectWorkers(code);

      expect(workers).toHaveLength(1);
      expect(workers[0]?.source).toBe('./shared.js');
      expect(workers[0]?.type).toBe('shared-worker');
      expect(workers[0]?.options?.name).toBe('shared-worker');
    });

    it('should detect multiple worker types in one file', () => {
      const code = `
        const worker = new Worker('./worker.js');
        navigator.serviceWorker.register('/sw.js');
        const shared = new SharedWorker('./shared.js');
      `;

      const workers = bundler.detectWorkers(code);

      expect(workers).toHaveLength(3);
      expect(workers.map((w) => w.type)).toContain('web-worker');
      expect(workers.map((w) => w.type)).toContain('service-worker');
      expect(workers.map((w) => w.type)).toContain('shared-worker');
    });

    it('should capture worker position in source', () => {
      const code = `const worker = new Worker('./worker.js');`;

      const workers = bundler.detectWorkers(code);

      expect(workers[0]?.position).toBeDefined();
      expect(workers[0]?.position.start).toBeGreaterThanOrEqual(0);
      expect(workers[0]?.position.end).toBeGreaterThan(workers[0]!.position.start);
    });

    it('should detect workers with different quote styles', () => {
      const code = `
        new Worker('./worker1.js');
        new Worker("./worker2.js");
        new Worker(\`./worker3.js\`);
      `;

      const workers = bundler.detectWorkers(code);

      expect(workers).toHaveLength(3);
    });
  });

  describe('Worker Bundling', () => {
    it('should bundle a simple worker', async () => {
      const code = `
        self.onmessage = (event) => {
          const result = event.data * 2;
          self.postMessage(result);
        };
      `;

      const result = await bundler.bundleWorker('./worker.js', code, 'web-worker');

      expect(result.id).toBeDefined();
      expect(result.type).toBe('web-worker');
      expect(result.size).toBeGreaterThan(0);
      expect(result.hash).toBeDefined();
      expect(result.dependencies).toEqual([]);
    });

    it('should inline small workers', async () => {
      const code = `self.postMessage('hello');`;

      const result = await bundler.bundleWorker('./worker.js', code, 'web-worker');

      expect(result.inlined).toBe(true);
      expect(result.code).toBeDefined();
      expect(result.path).toBeUndefined();
    });

    it('should not inline large workers', async () => {
      const largeBundler = new WorkerBundler({
        inline: true,
        inlineThreshold: 10,
      });

      const code = `self.postMessage('${'x'.repeat(1000)}');`;

      const result = await largeBundler.bundleWorker('./worker.js', code, 'web-worker');

      expect(result.inlined).toBe(false);
      expect(result.code).toBeUndefined();
      expect(result.path).toBeDefined();
    });

    it('should minify worker code', async () => {
      const code = `
        // This is a comment
        const variable = 42;
        console.log(variable);
      `;

      const result = await bundler.bundleWorker('./worker.js', code, 'web-worker');

      expect(result.code).not.toContain('// This is a comment');
      expect(result.size).toBeLessThan(code.length);
    });

    it('should extract dependencies', async () => {
      const code = `
        import { helper } from './helper.js';
        import utils from './utils.js';

        self.onmessage = () => {};
      `;

      const result = await bundler.bundleWorker('./worker.js', code, 'web-worker');

      expect(result.dependencies).toContain('./helper.js');
      expect(result.dependencies).toContain('./utils.js');
    });

    it('should generate source maps when enabled', async () => {
      const code = `self.postMessage('test');`;

      const result = await bundler.bundleWorker('./worker.js', code, 'web-worker');

      expect(result.map).toBeDefined();
      const sourceMap = JSON.parse(result.map!);
      expect(sourceMap.version).toBe(3);
      expect(sourceMap.file).toBe('./worker.js');
    });

    it('should not generate source maps when disabled', async () => {
      const noMapBundler = new WorkerBundler({
        sourcemap: false,
      });

      const code = `self.postMessage('test');`;

      const result = await noMapBundler.bundleWorker('./worker.js', code, 'web-worker');

      expect(result.map).toBeUndefined();
    });

    it('should cache bundle results', async () => {
      const code = `self.postMessage('test');`;

      const result1 = await bundler.bundleWorker('./worker.js', code, 'web-worker');
      const result2 = await bundler.bundleWorker('./worker.js', code, 'web-worker');

      expect(result1.hash).toBe(result2.hash);
      expect(result1.id).toBe(result2.id);
    });

    it('should handle different worker types', async () => {
      const code = `self.postMessage('test');`;

      const webWorker = await bundler.bundleWorker('./worker.js', code, 'web-worker');
      const moduleWorker = await bundler.bundleWorker('./worker.js', code, 'module-worker');
      const serviceWorker = await bundler.bundleWorker('./sw.js', code, 'service-worker');
      const sharedWorker = await bundler.bundleWorker('./shared.js', code, 'shared-worker');

      expect(webWorker.type).toBe('web-worker');
      expect(moduleWorker.type).toBe('module-worker');
      expect(serviceWorker.type).toBe('service-worker');
      expect(sharedWorker.type).toBe('shared-worker');
    });

    it('should tree shake worker code', async () => {
      const treeShakingBundler = new WorkerBundler({
        treeShaking: true,
        minify: true,
      });

      const code = `
        import { used } from './helper.js';
        console.log('debug');
        self.postMessage(used);
      `;

      const result = await treeShakingBundler.bundleWorker('./worker.js', code, 'web-worker');

      // Console.log should be removed
      expect(result.code).not.toContain('console.log');
    });
  });

  describe('Worker Code Generation', () => {
    it('should generate inline Web Worker code', async () => {
      const code = `self.postMessage('test');`;
      const bundle = await bundler.bundleWorker('./worker.js', code, 'web-worker');

      const generatedCode = bundler.generateWorkerCode(bundle);

      expect(generatedCode).toContain('new Worker');
      expect(generatedCode).toContain('Blob');
      expect(generatedCode).toContain('URL.createObjectURL');
    });

    it('should generate file-based Web Worker code', async () => {
      const noInlineBundler = new WorkerBundler({ inline: false });
      const code = `self.postMessage('test');`;
      const bundle = await noInlineBundler.bundleWorker('./worker.js', code, 'web-worker');

      const generatedCode = noInlineBundler.generateWorkerCode(bundle);

      expect(generatedCode).toContain('new Worker');
      expect(generatedCode).toContain('.worker.js');
    });

    it('should generate Module Worker code with type option', async () => {
      const code = `self.postMessage('test');`;
      const bundle = await bundler.bundleWorker('./worker.js', code, 'module-worker');

      const generatedCode = bundler.generateWorkerCode(bundle);

      expect(generatedCode).toContain('type');
      expect(generatedCode).toContain('module');
    });

    it('should generate Service Worker registration code', async () => {
      const code = `self.postMessage('test');`;
      const bundle = await bundler.bundleWorker('./sw.js', code, 'service-worker');

      const generatedCode = bundler.generateWorkerCode(bundle);

      expect(generatedCode).toContain('navigator.serviceWorker.register');
    });

    it('should generate Shared Worker code with name', async () => {
      const code = `self.postMessage('test');`;
      const bundle = await bundler.bundleWorker('./shared.js', code, 'shared-worker');

      const generatedCode = bundler.generateWorkerCode(bundle, { name: 'my-worker' });

      expect(generatedCode).toContain('new SharedWorker');
      expect(generatedCode).toContain('my-worker');
    });
  });

  describe('Service Worker Generation', () => {
    it('should generate service worker with cache-first strategy', () => {
      const swBundler = new WorkerBundler({
        serviceWorker: {
          strategy: 'cache-first',
          precache: ['/index.html', '/app.js'],
        },
      });

      const code = swBundler.generateServiceWorkerCode();

      expect(code).toContain('cache-first');
      expect(code).toContain('/index.html');
      expect(code).toContain('/app.js');
      expect(code).toContain('caches.open');
      expect(code).toContain('cache.match');
    });

    it('should generate service worker with network-first strategy', () => {
      const swBundler = new WorkerBundler({
        serviceWorker: {
          strategy: 'network-first',
        },
      });

      const code = swBundler.generateServiceWorkerCode();

      expect(code).toContain('network-first');
      expect(code).toContain('fetch(request)');
    });

    it('should generate service worker with background sync', () => {
      const swBundler = new WorkerBundler({
        serviceWorker: {
          strategy: 'cache-first',
          backgroundSync: true,
        },
      });

      const code = swBundler.generateServiceWorkerCode();

      expect(code).toContain('sync');
      expect(code).toContain('syncData');
    });

    it('should generate service worker with push notifications', () => {
      const swBundler = new WorkerBundler({
        serviceWorker: {
          strategy: 'cache-first',
          pushNotifications: true,
        },
      });

      const code = swBundler.generateServiceWorkerCode();

      expect(code).toContain('push');
      expect(code).toContain('showNotification');
      expect(code).toContain('notificationclick');
    });

    it('should include all cache strategies', () => {
      const strategies = [
        'cache-first',
        'network-first',
        'cache-only',
        'network-only',
        'stale-while-revalidate',
      ] as const;

      for (const strategy of strategies) {
        const swBundler = new WorkerBundler({
          serviceWorker: { strategy },
        });

        const code = swBundler.generateServiceWorkerCode();
        expect(code).toBeDefined();
        expect(code.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Cache Management', () => {
    it('should cache worker bundles', async () => {
      const cacheBundler = new WorkerBundler({ cache: true });
      const code = `self.postMessage('test');`;

      const result1 = await cacheBundler.bundleWorker('./worker.js', code, 'web-worker');
      const result2 = await cacheBundler.bundleWorker('./worker.js', code, 'web-worker');

      expect(result1).toEqual(result2);
    });

    it('should clear cache', async () => {
      const code = `self.postMessage('test');`;
      await bundler.bundleWorker('./worker.js', code, 'web-worker');

      bundler.clearCache();

      // Should work after clearing cache
      const result = await bundler.bundleWorker('./worker.js', code, 'web-worker');
      expect(result).toBeDefined();
    });

    it('should get all workers', async () => {
      const code1 = `self.postMessage('worker1');`;
      const code2 = `self.postMessage('worker2');`;

      await bundler.bundleWorker('./worker1.js', code1, 'web-worker');
      await bundler.bundleWorker('./worker2.js', code2, 'web-worker');

      const workers = bundler.getWorkers();

      expect(workers.size).toBe(2);
    });
  });
});

describe('TypedWorker', () => {
  let mockWorker: MockWorker;
  let typedWorker: TypedWorker<{ value: number }, { result: number }>;

  beforeEach(() => {
    mockWorker = new MockWorker();
    typedWorker = new TypedWorker(mockWorker as unknown as Worker);
  });

  afterEach(() => {
    typedWorker.terminate();
  });

  it('should send messages to worker', () => {
    const sendSpy = vi.spyOn(mockWorker, 'postMessage');

    typedWorker.send('calculate', { value: 42 });

    expect(sendSpy).toHaveBeenCalled();
    const message = sendSpy.mock.calls[0]?.[0];
    expect(message.type).toBe('calculate');
    expect(message.payload).toEqual({ value: 42 });
  });

  it('should receive messages from worker', async () => {
    const handler = vi.fn();
    typedWorker.on('result', handler);

    // Simulate worker response
    const event = new MessageEvent('message', {
      data: { type: 'result', payload: { result: 84 } },
    });
    mockWorker.onmessage?.(event);

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(handler).toHaveBeenCalledWith({ result: 84 });
  });

  it('should send and wait for response', async () => {
    // Setup mock to respond
    const originalPostMessage = mockWorker.postMessage.bind(mockWorker);
    mockWorker.postMessage = (message: any) => {
      originalPostMessage(message);
      setTimeout(() => {
        if (mockWorker.onmessage) {
          mockWorker.onmessage(
            new MessageEvent('message', {
              data: { type: `${message.type}:response`, payload: { result: message.payload.value * 2 } },
            })
          );
        }
      }, 10);
    };

    const result = await typedWorker.sendAndWait('calculate', { value: 21 });

    expect(result).toEqual({ result: 42 });
  });

  it('should timeout on no response', async () => {
    await expect(typedWorker.sendAndWait('calculate', { value: 42 }, 100)).rejects.toThrow('timeout');
  });

  it('should unregister message handler', () => {
    const handler = vi.fn();
    typedWorker.on('result', handler);
    typedWorker.off('result');

    const event = new MessageEvent('message', {
      data: { type: 'result', payload: { result: 84 } },
    });
    mockWorker.onmessage?.(event);

    expect(handler).not.toHaveBeenCalled();
  });

  it('should terminate worker', () => {
    const terminateSpy = vi.spyOn(mockWorker, 'terminate');

    typedWorker.terminate();

    expect(terminateSpy).toHaveBeenCalled();
  });
});

describe('WorkerPool', () => {
  let pool: WorkerPool<{ value: number }, { result: number }>;
  let workerCount = 0;

  beforeEach(() => {
    workerCount = 0;
    pool = new WorkerPool(
      () => {
        workerCount++;
        return new MockWorker() as unknown as Worker;
      },
      { maxWorkers: 3, minWorkers: 1 }
    );
  });

  afterEach(() => {
    pool.terminate();
  });

  it('should initialize with minimum workers', () => {
    expect(workerCount).toBe(1);
  });

  it('should execute task on worker', async () => {
    // Mock worker to respond
    const mockResponse = { result: 42 };
    const originalFactory = pool['workerFactory'];
    pool['workerFactory'] = () => {
      const worker = new MockWorker();
      worker.postMessage = (message: any) => {
        setTimeout(() => {
          if (worker.onmessage) {
            worker.onmessage(
              new MessageEvent('message', {
                data: { type: `${message.type}:response`, payload: mockResponse },
              })
            );
          }
        }, 10);
      };
      return worker as unknown as Worker;
    };

    // Create new pool with mock factory
    pool.terminate();
    pool = new WorkerPool(pool['workerFactory'], { maxWorkers: 3, minWorkers: 1 });

    const result = await pool.execute('calculate', { value: 21 });

    expect(result).toEqual(mockResponse);
  });

  it('should broadcast to all workers', () => {
    // Get all workers and spy on them
    const workers = pool['workers'];
    const spies = workers.map((w) => vi.spyOn(w, 'send'));

    pool.broadcast('update', { value: 42 });

    for (const spy of spies) {
      expect(spy).toHaveBeenCalledWith('update', { value: 42 });
    }
  });

  it('should terminate all workers', () => {
    const workers = pool['workers'];
    const spies = workers.map((w) => vi.spyOn(w, 'terminate'));

    pool.terminate();

    for (const spy of spies) {
      expect(spy).toHaveBeenCalled();
    }
  });

  it('should respect max workers limit', () => {
    const maxWorkers = 3;
    const limitedPool = new WorkerPool(() => new MockWorker() as unknown as Worker, {
      maxWorkers,
      minWorkers: 0,
    });

    // Try to create more workers than max
    for (let i = 0; i < maxWorkers + 2; i++) {
      try {
        limitedPool['createWorker']();
      } catch {
        // Expected to throw when exceeding max
      }
    }

    expect(limitedPool['workers'].length).toBeLessThanOrEqual(maxWorkers);

    limitedPool.terminate();
  });
});

describe('WorkerPerformanceMonitor', () => {
  let monitor: WorkerPerformanceMonitor;

  beforeEach(() => {
    monitor = new WorkerPerformanceMonitor();
  });

  it('should track sent messages', () => {
    monitor.trackMessage('worker-1', true);
    monitor.trackMessage('worker-1', true);

    const metrics = monitor.getMetrics('worker-1');

    expect(metrics?.messagesSent).toBe(2);
  });

  it('should track received messages', () => {
    monitor.trackMessage('worker-1', false);
    monitor.trackMessage('worker-1', false);
    monitor.trackMessage('worker-1', false);

    const metrics = monitor.getMetrics('worker-1');

    expect(metrics?.messagesReceived).toBe(3);
  });

  it('should track message latency', () => {
    monitor.trackLatency('worker-1', 10);
    monitor.trackLatency('worker-1', 20);
    monitor.trackLatency('worker-1', 30);

    const metrics = monitor.getMetrics('worker-1');

    expect(metrics?.averageLatency).toBeGreaterThan(0);
  });

  it('should get all metrics', () => {
    monitor.trackMessage('worker-1', true);
    monitor.trackMessage('worker-2', true);

    const allMetrics = monitor.getAllMetrics();

    expect(allMetrics.size).toBe(2);
    expect(allMetrics.has('worker-1')).toBe(true);
    expect(allMetrics.has('worker-2')).toBe(true);
  });

  it('should clear metrics', () => {
    monitor.trackMessage('worker-1', true);
    monitor.clear();

    const metrics = monitor.getMetrics('worker-1');

    expect(metrics).toBeUndefined();
  });

  it('should create metrics for new workers', () => {
    const metrics = monitor['getOrCreateMetric']('worker-1');

    expect(metrics.workerId).toBe('worker-1');
    expect(metrics.messagesSent).toBe(0);
    expect(metrics.messagesReceived).toBe(0);
    expect(metrics.uptime).toBeGreaterThan(0);
  });
});

describe('MockWorker', () => {
  let worker: MockWorker;

  beforeEach(() => {
    worker = new MockWorker();
  });

  it('should post messages', () => {
    const handler = vi.fn();
    worker.onmessage = handler;

    worker.postMessage({ type: 'test' });

    // Wait for async message handling
    setTimeout(() => {
      expect(handler).toHaveBeenCalled();
    }, 10);
  });

  it('should terminate', () => {
    worker.postMessage({ type: 'test' });
    worker.terminate();

    expect(worker['messageQueue']).toHaveLength(0);
  });

  it('should add event listeners', () => {
    const handler = vi.fn();
    worker.addEventListener('message', handler);

    expect(worker.onmessage).toBe(handler);
  });

  it('should remove event listeners', () => {
    const handler = vi.fn();
    worker.addEventListener('message', handler);
    worker.removeEventListener('message', handler);

    expect(worker.onmessage).toBeNull();
  });
});

describe('HMRWorkerManager', () => {
  let manager: HMRWorkerManager;

  beforeEach(() => {
    manager = new HMRWorkerManager();
  });

  it('should register workers', () => {
    const worker = new MockWorker() as unknown as Worker;
    manager.register('worker-1', worker);

    expect(manager['workers'].has('worker-1')).toBe(true);
  });

  it('should unregister workers', () => {
    const worker = new MockWorker() as unknown as Worker;
    const terminateSpy = vi.spyOn(worker, 'terminate');

    manager.register('worker-1', worker);
    manager.unregister('worker-1');

    expect(terminateSpy).toHaveBeenCalled();
    expect(manager['workers'].has('worker-1')).toBe(false);
  });

  it('should reload workers', () => {
    const oldWorker = new MockWorker() as unknown as Worker;
    const newWorker = new MockWorker() as unknown as Worker;
    const terminateSpy = vi.spyOn(oldWorker, 'terminate');

    manager.register('worker-1', oldWorker);
    const result = manager.reload('worker-1', () => newWorker);

    expect(terminateSpy).toHaveBeenCalled();
    expect(result).toBe(newWorker);
    expect(manager['workers'].get('worker-1')).toBe(newWorker);
  });

  it('should terminate all workers', () => {
    const worker1 = new MockWorker() as unknown as Worker;
    const worker2 = new MockWorker() as unknown as Worker;
    const spy1 = vi.spyOn(worker1, 'terminate');
    const spy2 = vi.spyOn(worker2, 'terminate');

    manager.register('worker-1', worker1);
    manager.register('worker-2', worker2);
    manager.terminateAll();

    expect(spy1).toHaveBeenCalled();
    expect(spy2).toHaveBeenCalled();
    expect(manager['workers'].size).toBe(0);
  });
});

describe('Integration Tests', () => {
  it('should handle complete worker bundling workflow', async () => {
    const bundler = new WorkerBundler({
      inline: true,
      minify: true,
      sourcemap: true,
    });

    // Detect workers
    const sourceCode = `
      const worker = new Worker('./compute.js', { type: 'module' });
      worker.postMessage({ value: 42 });
    `;

    const detected = bundler.detectWorkers(sourceCode);
    expect(detected).toHaveLength(1);

    // Bundle worker
    const workerCode = `
      self.onmessage = (event) => {
        const result = event.data.value * 2;
        self.postMessage({ result });
      };
    `;

    const bundle = await bundler.bundleWorker(detected[0]!.source, workerCode, detected[0]!.type, detected[0]!.options);

    expect(bundle.inlined).toBe(true);
    expect(bundle.code).toBeDefined();
    expect(bundle.map).toBeDefined();

    // Generate instantiation code
    const instantiationCode = bundler.generateWorkerCode(bundle, detected[0]?.options);
    expect(instantiationCode).toContain('new Worker');
  });

  it('should handle service worker with full configuration', async () => {
    const bundler = new WorkerBundler({
      serviceWorker: {
        strategy: 'cache-first',
        precache: ['/index.html', '/app.js', '/style.css'],
        backgroundSync: true,
        pushNotifications: true,
        cacheName: 'my-app-cache',
      },
    });

    const swCode = bundler.generateServiceWorkerCode();

    expect(swCode).toContain('my-app-cache');
    expect(swCode).toContain('/index.html');
    expect(swCode).toContain('sync');
    expect(swCode).toContain('push');
  });

  it('should manage worker pool lifecycle', async () => {
    let workerCount = 0;
    const pool = new WorkerPool(
      () => {
        workerCount++;
        const worker = new MockWorker();
        worker.postMessage = (message: any) => {
          setTimeout(() => {
            if (worker.onmessage) {
              worker.onmessage(
                new MessageEvent('message', {
                  data: { type: `${message.type}:response`, payload: { result: 42 } },
                })
              );
            }
          }, 10);
        };
        return worker as unknown as Worker;
      },
      { maxWorkers: 2, minWorkers: 1 }
    );

    expect(workerCount).toBe(1);

    // Execute tasks
    const result = await pool.execute('task', { value: 21 });
    expect(result).toEqual({ result: 42 });

    // Cleanup
    pool.terminate();
  });
});
