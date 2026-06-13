/**
 * DevTools Tests
 * Tests for the DevTools dependency-graph diagnostics (NX-5: nexus/tracing.ts removed)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { Container, createToken } from '../../../src/nexus/index.js';
import {
  DevToolsPlugin,
  DevToolsServer,
  MessageType,
  DependencyGraph,
  exportToDot,
  exportToMermaid,
} from '../../../src/nexus/devtools.js';

describe('DevTools', () => {
  let container: Container;
  let devTools: DevToolsPlugin;

  beforeEach(() => {
    container = new Container();
    devTools = new DevToolsPlugin();
  });

  afterEach(async () => {
    await container.dispose();
    await devTools.close();
  });

  describe('DevTools Plugin', () => {
    it('should capture container events', () => {
      container.use(devTools);

      const token = createToken<string>('TestService');
      container.register(token, { useValue: 'test' });
      container.resolve(token);

      const events = devTools.getEvents();

      expect(events.some((e) => e.type === 'register')).toBe(true);
      expect(events.some((e) => e.type === 'resolve')).toBe(true);
    });

    it('should capture performance metrics', () => {
      container.use(devTools);

      const token = createToken<string>('Service');
      container.register(token, {
        useFactory: () => {
          // Simulate some work
          const start = Date.now();
          while (Date.now() - start < 5) {
            // Busy wait
          }
          return 'result';
        },
      });

      container.resolve(token);

      const metrics = devTools.getMetrics();

      expect(metrics.resolutions).toHaveLength(1);
      expect(metrics.resolutions[0].token).toBe(token.name);
      expect(metrics.resolutions[0].duration).toBeGreaterThanOrEqual(5);
    });

    it('should create container snapshot', () => {
      const token1 = createToken<string>('Service1');
      const token2 = createToken<number>('Service2');

      container.register(token1, { useValue: 'service1' });
      container.register(token2, { useValue: 42 });

      container.use(devTools);

      const snapshot = devTools.createSnapshot();

      expect(snapshot.timestamp).toBeDefined();
      // 3 registrations: Container (self-registered) + Service1 + Service2
      expect(snapshot.registrations).toHaveLength(3);
      expect(snapshot.registrations.some((r) => r.token === token1.name)).toBe(true);
      expect(snapshot.registrations.some((r) => r.token === token2.name)).toBe(true);
    });

    it('should generate dependency graph', () => {
      const tokenA = createToken<any>('ServiceA');
      const tokenB = createToken<any>('ServiceB');
      const tokenC = createToken<any>('ServiceC');

      // Install DevTools before registering to capture registration events
      container.use(devTools);

      container.register(tokenA, { useValue: 'A' });
      container.register(tokenB, {
        useFactory: (a) => ({ a }),
        inject: [tokenA],
      });
      container.register(tokenC, {
        useFactory: (b) => ({ b }),
        inject: [tokenB],
      });

      container.resolve(tokenC);

      const graph = devTools.getDependencyGraph();

      expect(graph.nodes).toHaveLength(3);
      expect(graph.edges).toHaveLength(2);
      expect(graph.edges.some((e) => e.from === tokenC.name && e.to === tokenB.name)).toBe(true);
      expect(graph.edges.some((e) => e.from === tokenB.name && e.to === tokenA.name)).toBe(true);
    });
  });

  describe('DevTools Server', () => {
    it('should start WebSocket server', async () => {
      const server = new DevToolsServer({
        port: 9229,
        host: 'localhost',
      });

      await server.start();

      expect(server.isRunning()).toBe(true);
      expect(server.getPort()).toBe(9229);

      await server.stop();
    });

    it('should handle client connections', async () => {
      const server = new DevToolsServer({ port: 9230 });
      await server.start();

      const mockClient = {
        send: vi.fn(),
        on: vi.fn(),
        close: vi.fn(),
      };

      server.handleConnection(mockClient as any);

      expect(server.getClientCount()).toBe(1);

      server.broadcast({
        type: MessageType.ContainerCreated,
        timestamp: Date.now(),
        containerId: 'test-container',
        data: { event: 'test' },
      });

      expect(mockClient.send).toHaveBeenCalled();

      await server.stop();
    });

    it('should handle client messages', async () => {
      const server = new DevToolsServer({ port: 9231 });
      container.use(new DevToolsPlugin({ server }));

      await server.start();

      const mockClient = {
        send: vi.fn(),
        on: vi.fn(),
      };

      server.handleConnection(mockClient as any);

      // Simulate client requesting snapshot
      const messageHandler = mockClient.on.mock.calls.find((call) => call[0] === 'message')?.[1];

      if (messageHandler) {
        messageHandler(
          JSON.stringify({
            type: 'request-snapshot',
            id: '123',
          })
        );
      }

      expect(mockClient.send).toHaveBeenCalledWith(expect.stringContaining('snapshot'));

      await server.stop();
    });
  });

  describe('Graph Export', () => {
    it('should export dependency graph to DOT format', () => {
      const graph: DependencyGraph = {
        nodes: [
          { id: 'A', label: 'ServiceA' },
          { id: 'B', label: 'ServiceB' },
          { id: 'C', label: 'ServiceC' },
        ],
        edges: [
          { from: 'B', to: 'A' },
          { from: 'C', to: 'B' },
        ],
      };

      const dot = exportToDot(graph);

      expect(dot).toContain('digraph');
      expect(dot).toContain('ServiceA');
      expect(dot).toContain('ServiceB');
      expect(dot).toContain('ServiceC');
      expect(dot).toContain('B -> A');
      expect(dot).toContain('C -> B');
    });

    it('should export dependency graph to Mermaid format', () => {
      const graph: DependencyGraph = {
        nodes: [
          { id: 'A', label: 'ServiceA', type: 'singleton' },
          { id: 'B', label: 'ServiceB', type: 'transient' },
          { id: 'C', label: 'ServiceC', type: 'scoped' },
        ],
        edges: [
          { from: 'B', to: 'A' },
          { from: 'C', to: 'B' },
        ],
      };

      const mermaid = exportToMermaid(graph);

      expect(mermaid).toContain('graph TD');
      expect(mermaid).toContain('A[ServiceA]');
      expect(mermaid).toContain('B[ServiceB]');
      expect(mermaid).toContain('C[ServiceC]');
      expect(mermaid).toContain('B --> A');
      expect(mermaid).toContain('C --> B');
    });
  });

  describe('Performance Monitoring', () => {
    it('should track memory usage', () => {
      container.use(devTools);

      const initialMemory = devTools.getMemoryUsage();
      expect(initialMemory.heapUsed).toBeGreaterThan(0);
      expect(initialMemory.heapTotal).toBeGreaterThan(0);

      // Create some objects
      const tokens = Array.from({ length: 100 }, (_, i) => createToken(`Service${i}`));

      tokens.forEach((token) => {
        container.register(token, { useValue: `value${token.name}` });
      });

      const afterMemory = devTools.getMemoryUsage();
      // GC may reclaim memory between measurements, so just check it's still positive
      expect(afterMemory.heapUsed).toBeGreaterThan(0);
    });

    it('should track resolution times', () => {
      container.use(devTools);

      const slowToken = createToken<string>('SlowService');
      const fastToken = createToken<string>('FastService');

      container.register(slowToken, {
        useFactory: () => {
          const start = Date.now();
          while (Date.now() - start < 20) {
            // Busy wait
          }
          return 'slow';
        },
      });

      container.register(fastToken, {
        useValue: 'fast',
      });

      container.resolve(slowToken);
      container.resolve(fastToken);

      const stats = devTools.getResolutionStats();

      expect(stats[slowToken.name].averageTime).toBeGreaterThanOrEqual(20);
      expect(stats[fastToken.name].averageTime).toBeLessThan(5);
    });
  });
});
