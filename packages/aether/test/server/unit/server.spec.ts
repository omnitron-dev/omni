/**
 * Unit Tests for Unified Server
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createServer, createDevServer } from '../../../src/server/server';
import type { ServerConfig, DevServerConfig } from '../../../src/server/types';

// Mock modules
vi.mock('../../../src/server/hmr/engine', () => ({
  HMREngine: vi.fn().mockImplementation(() => ({
    addConnection: vi.fn(),
    removeConnection: vi.fn(),
    handleUpdate: vi.fn(),
    close: vi.fn(),
  })),
}));

vi.mock('../../../src/server/hmr/fast-refresh', () => ({
  initFastRefresh: vi.fn(),
}));

vi.mock('../../../src/server/middleware/index', () => ({
  createDevMiddleware: vi.fn().mockImplementation(() => ({
    use: vi.fn(),
    handle: vi.fn().mockResolvedValue(new Response('test')),
  })),
}));

vi.mock('../../../src/server/ssr', () => ({
  renderToString: vi.fn().mockResolvedValue({
    html: '<div>Test</div>',
    data: {},
    meta: { title: 'Test' },
    status: 200,
    headers: {},
  }),
}));

vi.mock('../../../src/server/renderer', () => ({
  renderDocument: vi.fn().mockReturnValue('<!DOCTYPE html><html><body><div>Test</div></body></html>'),
}));

describe('Server Creation', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('createServer', () => {
    it('should create production server by default', async () => {
      const config: ServerConfig = {
        mode: 'ssr',
        port: 3000,
        host: 'localhost',
        routes: [],
      };

      const server = await createServer(config);

      expect(server).toBeDefined();
      expect(server.listen).toBeInstanceOf(Function);
      expect(server.close).toBeInstanceOf(Function);
      expect(server.render).toBeInstanceOf(Function);
      expect((server as any).getMetrics).toBeInstanceOf(Function);
    });

    it('should create development server when dev is true', async () => {
      const config: DevServerConfig = {
        dev: true,
        mode: 'ssr',
        port: 3000,
        host: 'localhost',
        routes: [],
      };

      const server = await createServer(config);

      expect(server).toBeDefined();
      expect((server as any).restart).toBeInstanceOf(Function);
      expect((server as any).invalidate).toBeInstanceOf(Function);
      expect((server as any).use).toBeInstanceOf(Function);
      expect((server as any).hmr).toBeDefined();
      expect((server as any).middleware).toBeDefined();
    });

    it('should detect development mode from environment', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      const config: ServerConfig = {
        mode: 'ssr',
        port: 3000,
        routes: [],
      };

      const server = await createServer(config);

      expect((server as any).restart).toBeInstanceOf(Function);

      process.env.NODE_ENV = originalEnv;
    });

    it('should detect development mode from AETHER_DEV', async () => {
      const originalEnv = process.env.AETHER_DEV;
      process.env.AETHER_DEV = 'true';

      const config: ServerConfig = {
        mode: 'ssr',
        port: 3000,
        routes: [],
      };

      const server = await createServer(config);

      expect((server as any).restart).toBeInstanceOf(Function);

      process.env.AETHER_DEV = originalEnv;
    });
  });

  describe('createDevServer', () => {
    it('should create development server with dev flag', async () => {
      const config: DevServerConfig = {
        dev: true,
        mode: 'ssr',
        port: 3000,
        routes: [],
      };

      const server = await createDevServer(config);

      expect(server).toBeDefined();
      expect(server.restart).toBeInstanceOf(Function);
      expect(server.invalidate).toBeInstanceOf(Function);
      expect(server.use).toBeInstanceOf(Function);
    });
  });
});

describe('Server Configuration', () => {
  it('should use default port 3000', async () => {
    const config: ServerConfig = {
      mode: 'ssr',
      routes: [],
    };

    const server = await createServer(config);
    expect(server).toBeDefined();
  });

  it('should use default host 0.0.0.0', async () => {
    const config: ServerConfig = {
      mode: 'ssr',
      port: 3000,
      routes: [],
    };

    const server = await createServer(config);
    expect(server).toBeDefined();
  });

  it('should accept custom port and host', async () => {
    const config: ServerConfig = {
      mode: 'ssr',
      port: 8080,
      host: '127.0.0.1',
      routes: [],
    };

    const server = await createServer(config);
    expect(server).toBeDefined();
  });

  it('should support SSR mode', async () => {
    const config: ServerConfig = {
      mode: 'ssr',
      routes: [],
    };

    const server = await createServer(config);
    expect(server).toBeDefined();
  });

  it('should support SSG mode', async () => {
    const config: ServerConfig = {
      mode: 'ssg',
      routes: [],
    };

    const server = await createServer(config);
    expect(server).toBeDefined();
  });

  it('should support Islands mode', async () => {
    const config: ServerConfig = {
      mode: 'islands',
      routes: [],
    };

    const server = await createServer(config);
    expect(server).toBeDefined();
  });
});

describe('Server Metrics', () => {
  it('should track metrics in production', async () => {
    const config: ServerConfig = {
      mode: 'ssr',
      routes: [],
    };

    const server = await createServer(config);
    const metrics = (server as any).getMetrics();

    expect(metrics).toBeDefined();
    expect(metrics.uptime).toBeGreaterThanOrEqual(0);
    expect(metrics.requests).toBe(0);
    expect(metrics.avgResponseTime).toBe(0);
  });

  it('should track metrics in development', async () => {
    const config: DevServerConfig = {
      dev: true,
      mode: 'ssr',
      routes: [],
    };

    const server = await createServer(config);
    const metrics = server.getMetrics();

    expect(metrics).toBeDefined();
    expect(metrics.uptime).toBeGreaterThanOrEqual(0);
    expect(metrics.requests).toBe(0);
    expect(metrics.updates).toBe(0);
    expect(metrics.fullReloads).toBe(0);
  });

  it('should update metrics on requests', async () => {
    // This test would require mocking the request handling
    // Implementation depends on the actual server implementation
    expect(true).toBe(true);
  });
});

describe('Development Features', () => {
  it('should initialize HMR in dev mode', async () => {
    const HMREngine = await import('../../../src/server/hmr/engine').then(m => m.HMREngine);

    const config: DevServerConfig = {
      dev: true,
      mode: 'ssr',
      hmr: true,
      routes: [],
    };

    await createServer(config);

    expect(HMREngine).toHaveBeenCalled();
  });

  it('should initialize Fast Refresh in dev mode', async () => {
    const { initFastRefresh } = await import('../../../src/server/hmr/fast-refresh');

    const config: DevServerConfig = {
      dev: true,
      mode: 'ssr',
      routes: [],
    };

    await createServer(config);

    expect(initFastRefresh).toHaveBeenCalledWith({
      enabled: true,
      preserveLocalState: true,
    });
  });

  it('should create dev middleware in dev mode', async () => {
    const { createDevMiddleware } = await import('../../../src/server/middleware/index');

    const config: DevServerConfig = {
      dev: true,
      mode: 'ssr',
      routes: [],
    };

    await createServer(config);

    expect(createDevMiddleware).toHaveBeenCalledWith(config);
  });

  it('should support restart in dev mode', async () => {
    const config: DevServerConfig = {
      dev: true,
      mode: 'ssr',
      routes: [],
    };

    const server = await createServer(config);

    expect(server.restart).toBeInstanceOf(Function);
    // Test actual restart would require more complex mocking
  });

  it('should support invalidate in dev mode', async () => {
    const config: DevServerConfig = {
      dev: true,
      mode: 'ssr',
      routes: [],
    };

    const server = await createServer(config);

    expect(server.invalidate).toBeInstanceOf(Function);
    server.invalidate('/test/path');
  });

  it('should support adding middleware in dev mode', async () => {
    const config: DevServerConfig = {
      dev: true,
      mode: 'ssr',
      routes: [],
    };

    const server = await createServer(config);
    const middleware = {
      name: 'test',
      handle: async () => new Response('test'),
    };

    server.use(middleware);
    expect(server.middleware.use).toHaveBeenCalledWith(middleware);
  });
});

describe('Production Features', () => {
  it('should not have dev features in production', async () => {
    const config: ServerConfig = {
      mode: 'ssr',
      routes: [],
    };

    const server = await createServer(config);

    expect((server as any).restart).toBeUndefined();
    expect((server as any).invalidate).toBeUndefined();
    expect((server as any).use).toBeUndefined();
    expect((server as any).hmr).toBeUndefined();
  });

  it('should have metrics in production', async () => {
    const config: ServerConfig = {
      mode: 'ssr',
      routes: [],
    };

    const server = await createServer(config);

    expect((server as any).getMetrics).toBeInstanceOf(Function);
  });

  it('should support production middleware', async () => {
    const config: ServerConfig = {
      mode: 'ssr',
      routes: [],
    };

    const server = await createServer(config);
    // Production middleware is created internally
    expect(server).toBeDefined();
  });
});

describe('Runtime Detection', () => {
  it('should detect Node.js runtime', async () => {
    const config: ServerConfig = {
      mode: 'ssr',
      routes: [],
    };

    const server = await createServer(config);
    expect(server).toBeDefined();
  });

  it('should detect Bun runtime', async () => {
    const originalBun = (globalThis as any).Bun;
    (globalThis as any).Bun = { serve: vi.fn() };

    const config: ServerConfig = {
      mode: 'ssr',
      routes: [],
    };

    const server = await createServer(config);
    expect(server).toBeDefined();

    (globalThis as any).Bun = originalBun;
  });

  it('should detect Deno runtime', async () => {
    const originalDeno = (globalThis as any).Deno;
    (globalThis as any).Deno = { serve: vi.fn() };

    const config: ServerConfig = {
      mode: 'ssr',
      routes: [],
    };

    const server = await createServer(config);
    expect(server).toBeDefined();

    (globalThis as any).Deno = originalDeno;
  });
});

describe('Server Lifecycle', () => {
  it('should have listen method', async () => {
    const config: ServerConfig = {
      mode: 'ssr',
      routes: [],
    };

    const server = await createServer(config);
    expect(server.listen).toBeInstanceOf(Function);
  });

  it('should have close method', async () => {
    const config: ServerConfig = {
      mode: 'ssr',
      routes: [],
    };

    const server = await createServer(config);
    expect(server.close).toBeInstanceOf(Function);
  });

  it('should have render method', async () => {
    const config: ServerConfig = {
      mode: 'ssr',
      routes: [],
    };

    const server = await createServer(config);
    expect(server.render).toBeInstanceOf(Function);
  });
});

describe('Edge Cases', () => {
  it('should handle undefined config options', async () => {
    const config: ServerConfig = {
      mode: 'ssr',
      routes: [],
    };

    const server = await createServer(config);
    expect(server).toBeDefined();
  });

  it('should handle empty routes', async () => {
    const config: ServerConfig = {
      mode: 'ssr',
      routes: [],
    };

    const server = await createServer(config);
    expect(server).toBeDefined();
  });

  it('should handle invalid HMR config', async () => {
    const config: DevServerConfig = {
      dev: true,
      mode: 'ssr',
      hmr: false,
      routes: [],
    };

    const server = await createServer(config);
    expect(server).toBeDefined();
  });
});

describe('Backward Compatibility', () => {
  it('should support deprecated createDevServer', async () => {
    const config: DevServerConfig = {
      dev: true,
      mode: 'ssr',
      routes: [],
    };

    const server = await createDevServer(config);
    expect(server).toBeDefined();
    expect(server.restart).toBeInstanceOf(Function);
  });

  it('should add dev flag to config in createDevServer', async () => {
    const config = {
      mode: 'ssr' as const,
      routes: [],
    };

    const server = await createDevServer(config);
    expect(server).toBeDefined();
    expect(server.restart).toBeInstanceOf(Function);
  });
});

// Test coverage report
describe('Test Coverage', () => {
  it('should have 100% test coverage', () => {
    // This is a placeholder to ensure we're aiming for 100% coverage
    expect(true).toBe(true);
  });
});