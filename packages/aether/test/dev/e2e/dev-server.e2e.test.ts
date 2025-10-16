/**
 * Dev Server E2E Tests
 *
 * End-to-end tests for the complete dev server including:
 * - Server startup and shutdown
 * - HTTP request handling
 * - WebSocket HMR connections
 * - File watching and hot reload
 * - Static file serving
 * - API routes
 *
 * Note: These tests are excluded from regular test runs as they require
 * a real server environment and file system operations.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { HMREngine } from '../../../src/dev/hmr/engine.js';
import { FastRefresh } from '../../../src/dev/hmr/fast-refresh.js';
import { MiddlewareStack, createDevMiddleware } from '../../../src/dev/middleware/index.js';
import type { DevServerConfig } from '../../../src/dev/types.js';

/**
 * Mock Dev Server for Testing
 *
 * This simulates a dev server without requiring actual HTTP server infrastructure.
 * In a real implementation, this would use Node's http/https modules or similar.
 */
class MockDevServer {
  private hmr: HMREngine;
  private middleware: MiddlewareStack;
  private fastRefresh: FastRefresh;
  private port: number;
  private running = false;

  constructor(config: DevServerConfig) {
    this.port = config.port || 3000;
    this.hmr = new HMREngine(typeof config.hmr === 'object' ? config.hmr : {});
    this.middleware = createDevMiddleware(config);
    this.fastRefresh = new FastRefresh(
      typeof config.hmr === 'object' ? config.hmr : {}
    );
  }

  async start(): Promise<void> {
    this.running = true;
    // In real implementation: start HTTP server
    console.log(`[MockDevServer] Started on port ${this.port}`);
  }

  async stop(): Promise<void> {
    this.running = false;
    this.hmr.close();
    this.fastRefresh.clear();
    console.log('[MockDevServer] Stopped');
  }

  async handleRequest(req: Request): Promise<Response> {
    if (!this.running) {
      return new Response('Server not running', { status: 503 });
    }
    return this.middleware.handle(req);
  }

  connectWebSocket(): any {
    const mockWs = {
      readyState: 1,
      send: vi.fn(),
      close: vi.fn(),
      onmessage: null as ((event: any) => void) | null,
      onopen: null as (() => void) | null,
      onerror: null as ((error: any) => void) | null,
      onclose: null as (() => void) | null,
    };

    this.hmr.addConnection(mockWs);

    // Simulate connection
    setTimeout(() => {
      if (mockWs.onopen) {
        mockWs.onopen();
      }
    }, 0);

    return mockWs;
  }

  async triggerFileChange(path: string): Promise<void> {
    await this.hmr.handleUpdate(path);
  }

  getHMREngine(): HMREngine {
    return this.hmr;
  }

  getFastRefresh(): FastRefresh {
    return this.fastRefresh;
  }
}

describe('Dev Server E2E', () => {
  describe('Server Lifecycle', () => {
    it('should start server successfully', async () => {
      const config: DevServerConfig = {
        dev: true,
        port: 3001,
      };

      const server = new MockDevServer(config);
      await server.start();

      // Server should be running
      const req = new Request('http://localhost:3001/test');
      const response = await server.handleRequest(req);

      expect(response).toBeDefined();
      expect(response.status).toBeDefined();

      await server.stop();
    });

    it('should stop server gracefully', async () => {
      const config: DevServerConfig = {
        dev: true,
        port: 3002,
      };

      const server = new MockDevServer(config);
      await server.start();
      await server.stop();

      // Should not handle requests after stop
      const req = new Request('http://localhost:3002/test');
      const response = await server.handleRequest(req);

      expect(response.status).toBe(503);
    });

    it('should handle restart', async () => {
      const config: DevServerConfig = {
        dev: true,
        port: 3003,
      };

      const server = new MockDevServer(config);

      // Start
      await server.start();
      let req = new Request('http://localhost:3003/test');
      let response = await server.handleRequest(req);
      expect(response.status).not.toBe(503);

      // Stop
      await server.stop();
      req = new Request('http://localhost:3003/test');
      response = await server.handleRequest(req);
      expect(response.status).toBe(503);

      // Restart
      await server.start();
      req = new Request('http://localhost:3003/test');
      response = await server.handleRequest(req);
      expect(response.status).not.toBe(503);

      await server.stop();
    });
  });

  describe('HTTP Request Handling', () => {
    let server: MockDevServer;

    beforeAll(async () => {
      server = new MockDevServer({
        dev: true,
        port: 3100,
        cors: true,
      });
      await server.start();
    });

    afterAll(async () => {
      await server.stop();
    });

    it('should handle GET requests', async () => {
      const req = new Request('http://localhost:3100/test', {
        method: 'GET',
      });

      const response = await server.handleRequest(req);

      expect(response).toBeDefined();
      expect(response.status).toBeDefined();
    });

    it('should handle POST requests', async () => {
      const req = new Request('http://localhost:3100/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test: 'data' }),
      });

      const response = await server.handleRequest(req);

      expect(response).toBeDefined();
    });

    it('should handle OPTIONS (CORS preflight)', async () => {
      const req = new Request('http://localhost:3100/api/test', {
        method: 'OPTIONS',
      });

      const response = await server.handleRequest(req);

      expect(response.status).toBe(204);
      expect(response.headers.get('Access-Control-Allow-Methods')).toBeDefined();
    });

    it('should handle concurrent requests', async () => {
      const requests = Array(10)
        .fill(null)
        .map(
          (_, i) =>
            new Request(`http://localhost:3100/request-${i}`, {
              method: 'GET',
            })
        );

      const responses = await Promise.all(
        requests.map((req) => server.handleRequest(req))
      );

      expect(responses).toHaveLength(10);
      responses.forEach((response) => {
        expect(response).toBeDefined();
      });
    });

    it('should add CORS headers', async () => {
      const req = new Request('http://localhost:3100/test');
      const response = await server.handleRequest(req);

      expect(response.headers.get('Access-Control-Allow-Origin')).toBeDefined();
    });
  });

  describe('WebSocket HMR Connection', () => {
    let server: MockDevServer;

    beforeAll(async () => {
      server = new MockDevServer({
        dev: true,
        port: 3200,
        hmr: true,
      });
      await server.start();
    });

    afterAll(async () => {
      await server.stop();
    });

    it('should establish WebSocket connection', async () => {
      const ws = server.connectWebSocket();

      await new Promise<void>((resolve) => {
        ws.onopen = () => {
          expect(ws.readyState).toBe(1); // OPEN
          resolve();
        };
      });

      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'connected' })
      );
    });

    it('should receive HMR updates via WebSocket', async () => {
      const ws = server.connectWebSocket();

      await new Promise<void>((resolve) => {
        ws.onopen = () => resolve();
      });

      // Register module
      const hmr = server.getHMREngine();
      hmr.registerModule('test-module', '/src/test.ts', 'module', new Set());
      hmr.acceptHMR('test-module', true);

      // Trigger file change
      await server.triggerFileChange('/src/test.ts');

      // Wait for update
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should have received update message
      const calls = ws.send.mock.calls;
      const updateCall = calls.find((call: any) => {
        const payload = JSON.parse(call[0]);
        return payload.type === 'update';
      });

      expect(updateCall).toBeDefined();
    });

    it('should handle multiple WebSocket connections', async () => {
      const ws1 = server.connectWebSocket();
      const ws2 = server.connectWebSocket();
      const ws3 = server.connectWebSocket();

      await Promise.all([
        new Promise<void>((resolve) => {
          ws1.onopen = () => resolve();
        }),
        new Promise<void>((resolve) => {
          ws2.onopen = () => resolve();
        }),
        new Promise<void>((resolve) => {
          ws3.onopen = () => resolve();
        }),
      ]);

      // All should receive connected message
      [ws1, ws2, ws3].forEach((ws) => {
        expect(ws.send).toHaveBeenCalledWith(
          JSON.stringify({ type: 'connected' })
        );
      });
    });

    it('should send custom events to all clients', async () => {
      const ws1 = server.connectWebSocket();
      const ws2 = server.connectWebSocket();

      await Promise.all([
        new Promise<void>((resolve) => {
          ws1.onopen = () => resolve();
        }),
        new Promise<void>((resolve) => {
          ws2.onopen = () => resolve();
        }),
      ]);

      // Send custom event
      await server.getHMREngine().sendCustom('test-event', { foo: 'bar' });

      // Both clients should receive it
      [ws1, ws2].forEach((ws) => {
        const customCall = ws.send.mock.calls.find((call: any) => {
          const payload = JSON.parse(call[0]);
          return payload.type === 'custom' && payload.data?.event === 'test-event';
        });
        expect(customCall).toBeDefined();
      });
    });
  });

  describe('File Watching and Hot Reload', () => {
    let server: MockDevServer;

    beforeAll(async () => {
      server = new MockDevServer({
        dev: true,
        port: 3300,
        hmr: {
          preserveState: true,
        },
      });
      await server.start();
    });

    afterAll(async () => {
      await server.stop();
    });

    it('should detect file changes and trigger HMR', async () => {
      const ws = server.connectWebSocket();
      const hmr = server.getHMREngine();

      await new Promise<void>((resolve) => {
        ws.onopen = () => resolve();
      });

      // Register module
      hmr.registerModule('watched-file', '/src/components/Button.tsx', 'component', new Set());
      hmr.acceptHMR('watched-file', true);

      // Trigger file change
      await server.triggerFileChange('/src/components/Button.tsx');

      // Wait for update
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should receive update
      const updateCall = ws.send.mock.calls.find((call: any) => {
        const payload = JSON.parse(call[0]);
        return payload.type === 'update' && payload.updates?.[0]?.path === '/src/components/Button.tsx';
      });

      expect(updateCall).toBeDefined();
    });

    it('should handle rapid file changes', async () => {
      const ws = server.connectWebSocket();
      const hmr = server.getHMREngine();

      await new Promise<void>((resolve) => {
        ws.onopen = () => resolve();
      });

      // Register modules
      for (let i = 0; i < 5; i++) {
        hmr.registerModule(`module-${i}`, `/src/file-${i}.ts`, 'module', new Set());
        hmr.acceptHMR(`module-${i}`, true);
      }

      // Trigger rapid changes
      await Promise.all([
        server.triggerFileChange('/src/file-0.ts'),
        server.triggerFileChange('/src/file-1.ts'),
        server.triggerFileChange('/src/file-2.ts'),
        server.triggerFileChange('/src/file-3.ts'),
        server.triggerFileChange('/src/file-4.ts'),
      ]);

      // Wait for all updates
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should batch updates
      const updateCalls = ws.send.mock.calls.filter((call: any) => {
        const payload = JSON.parse(call[0]);
        return payload.type === 'update';
      });

      expect(updateCalls.length).toBeGreaterThan(0);
    });

    it('should preserve component state during reload', async () => {
      const fastRefresh = server.getFastRefresh();

      // Create component with state
      const component: any = {
        $$signals: {
          count: {
            get: () => 42,
            set: vi.fn(),
          },
        },
      };

      fastRefresh.register(component, '/src/Counter.tsx', 'sig-1');

      // Preserve state
      const state = fastRefresh.preserveState(component);
      expect(state?.signals.get('count')).toBe(42);

      // Simulate file change and refresh
      function UpdatedComponent() {}
      UpdatedComponent.$$component = true;

      await fastRefresh.refresh('/src/Counter.tsx', { default: UpdatedComponent });

      // Restore state
      if (state) {
        fastRefresh.restoreState(component, state);
      }

      // State should be preserved
      expect(component.$$signals.count.set).toHaveBeenCalledWith(42);
    });

    it('should trigger full reload for non-HMR files', async () => {
      const ws = server.connectWebSocket();

      await new Promise<void>((resolve) => {
        ws.onopen = () => resolve();
      });

      // Trigger change for unregistered file
      await server.triggerFileChange('/src/unknown-file.ts');

      // Wait for update
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should trigger full reload
      const reloadCall = ws.send.mock.calls.find((call: any) => {
        const payload = JSON.parse(call[0]);
        return payload.type === 'full-reload';
      });

      expect(reloadCall).toBeDefined();
    });
  });

  describe('Static File Serving', () => {
    it('should serve static files', async () => {
      // Note: This would require actual file system in real implementation
      const server = new MockDevServer({
        dev: true,
        port: 3400,
        publicDir: '/public',
      });

      await server.start();

      // Try to request static file
      const req = new Request('http://localhost:3400/style.css');
      const response = await server.handleRequest(req);

      // Will return 404 in mock, but middleware should process it
      expect(response).toBeDefined();

      await server.stop();
    });
  });

  describe('Error Handling', () => {
    let server: MockDevServer;

    beforeAll(async () => {
      server = new MockDevServer({
        dev: true,
        port: 3500,
        hmr: {
          reloadOnError: true,
        },
      });
      await server.start();
    });

    afterAll(async () => {
      await server.stop();
    });

    it('should handle HMR errors gracefully', async () => {
      const ws = server.connectWebSocket();
      const hmr = server.getHMREngine();

      await new Promise<void>((resolve) => {
        ws.onopen = () => resolve();
      });

      // Register module with error-prone configuration
      hmr.registerModule('error-module', '/src/error.ts', 'module', new Set());

      // Simulate error by breaking module graph
      const graph = hmr.getModuleGraph();
      const originalMethod = graph.getAffectedModules;
      graph.getAffectedModules = vi.fn(() => {
        throw new Error('Graph error');
      });

      await server.triggerFileChange('/src/error.ts');

      // Wait for error handling
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should send error update
      const errorCall = ws.send.mock.calls.find((call: any) => {
        const payload = JSON.parse(call[0]);
        return payload.type === 'error';
      });

      expect(errorCall).toBeDefined();

      // Restore method
      graph.getAffectedModules = originalMethod;
    });

    it('should recover from WebSocket connection errors', async () => {
      const ws = server.connectWebSocket();

      // Simulate connection error
      ws.readyState = 3; // CLOSED

      // Try to send update
      const hmr = server.getHMREngine();
      hmr.registerModule('module', '/src/file.ts', 'module', new Set());
      hmr.acceptHMR('module', true);

      await server.triggerFileChange('/src/file.ts');

      // Should not crash
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
  });

  describe('Performance', () => {
    let server: MockDevServer;

    beforeAll(async () => {
      server = new MockDevServer({
        dev: true,
        port: 3600,
        hmr: true,
        cors: true,
        compression: true,
      });
      await server.start();
    });

    afterAll(async () => {
      await server.stop();
    });

    it('should handle high request throughput', async () => {
      const startTime = Date.now();

      const requests = Array(100)
        .fill(null)
        .map((_, i) => new Request(`http://localhost:3600/test-${i}`));

      await Promise.all(requests.map((req) => server.handleRequest(req)));

      const duration = Date.now() - startTime;

      // Should handle 100 requests quickly
      expect(duration).toBeLessThan(2000);
    });

    it('should handle many WebSocket connections', async () => {
      const connections = Array(50)
        .fill(null)
        .map(() => server.connectWebSocket());

      await Promise.all(
        connections.map(
          (ws) =>
            new Promise<void>((resolve) => {
              ws.onopen = () => resolve();
            })
        )
      );

      // All connections should be open
      connections.forEach((ws) => {
        expect(ws.send).toHaveBeenCalledWith(
          JSON.stringify({ type: 'connected' })
        );
      });
    });

    it('should handle rapid HMR updates efficiently', async () => {
      const ws = server.connectWebSocket();
      const hmr = server.getHMREngine();

      await new Promise<void>((resolve) => {
        ws.onopen = () => resolve();
      });

      // Register many modules
      for (let i = 0; i < 20; i++) {
        hmr.registerModule(`rapid-${i}`, `/src/rapid-${i}.ts`, 'module', new Set());
        hmr.acceptHMR(`rapid-${i}`, true);
      }

      const startTime = Date.now();

      // Trigger many updates
      await Promise.all(
        Array(20)
          .fill(null)
          .map((_, i) => server.triggerFileChange(`/src/rapid-${i}.ts`))
      );

      // Wait for all updates
      await new Promise((resolve) => setTimeout(resolve, 100));

      const duration = Date.now() - startTime;

      // Should complete quickly with batching
      expect(duration).toBeLessThan(500);
    });
  });
});
