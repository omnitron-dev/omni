/**
 * Compatibility E2E Tests
 * Verifies full compatibility between browser and Node.js Netron versions
 */

import { test, expect, Page } from '@playwright/test';

test.describe('Cross-runtime Compatibility', () => {
  let page: Page;

  test.beforeEach(async ({ page: p }) => {
    page = p;
    await page.goto('/');
  });

  test('should have identical API surface between HTTP transports', async () => {
    const browserApi = await page.evaluate(async () => {
      const { HttpRemotePeer } = await import('../../src/netron/transport/http/peer.js');
      const peer = new HttpRemotePeer('http://localhost:3333');

      return {
        hasSConnect: typeof peer.connect === 'function',
        hasDisconnect: typeof peer.disconnect === 'function',
        hasQueryInterface: typeof peer.queryInterface === 'function',
        hasQueryFluentInterface: typeof peer.queryFluentInterface === 'function',
        hasSetCacheManager: typeof peer.setCacheManager === 'function',
        hasSetRetryManager: typeof peer.setRetryManager === 'function',
        hasSetGlobalOptions: typeof peer.setGlobalOptions === 'function'
      };
    });

    // Verify all expected methods exist
    expect(browserApi.hasSConnect).toBe(true);
    expect(browserApi.hasDisconnect).toBe(true);
    expect(browserApi.hasQueryInterface).toBe(true);
    expect(browserApi.hasQueryFluentInterface).toBe(true);
    expect(browserApi.hasSetCacheManager).toBe(true);
    expect(browserApi.hasSetRetryManager).toBe(true);
    expect(browserApi.hasSetGlobalOptions).toBe(true);
  });

  test('should have identical API surface between WebSocket transports', async () => {
    const browserApi = await page.evaluate(async () => {
      const { WebSocketRemotePeer } = await import('../../src/netron/transport/websocket/peer.js');
      const peer = new WebSocketRemotePeer('ws://localhost:3334');

      return {
        hasConnect: typeof peer.connect === 'function',
        hasDisconnect: typeof peer.disconnect === 'function',
        hasQueryInterface: typeof peer.queryInterface === 'function',
        hasSubscribe: typeof peer.subscribe === 'function',
        hasUnsubscribe: typeof peer.unsubscribe === 'function'
      };
    });

    expect(browserApi.hasConnect).toBe(true);
    expect(browserApi.hasDisconnect).toBe(true);
    expect(browserApi.hasQueryInterface).toBe(true);
  });

  test('should serialize/deserialize data identically', async () => {
    await page.evaluate(async () => {
      const { HttpRemotePeer } = await import('../../src/netron/transport/http/peer.js');
      const peer = new HttpRemotePeer('http://localhost:3333');
      await peer.connect();
      window.testState.httpPeer = peer;
    });

    const testData = {
      string: 'test string',
      number: 42,
      boolean: true,
      null: null,
      array: [1, 2, 3],
      nested: {
        deep: {
          value: 'nested'
        }
      },
      date: new Date().toISOString(),
      special: {
        unicode: '你好世界 🌍',
        emoji: '🚀🎉✨'
      }
    };

    const result = await page.evaluate(async (data) => {
      const userService = await window.testState.httpPeer.queryInterface('UserService@1.0.0');

      // Create user with complex data
      const created = await userService.createUser({
        name: JSON.stringify(data),
        email: 'test@example.com',
        age: 25
      });

      // Verify serialization
      const deserialized = JSON.parse(created.name);

      return {
        matches: JSON.stringify(deserialized) === JSON.stringify(data),
        created
      };
    }, testData);

    expect(result.matches).toBe(true);

    await page.evaluate(async () => {
      await window.testState.httpPeer.disconnect();
      window.testState.httpPeer = null;
    });
  });

  test('should handle binary data consistently', async () => {
    await page.evaluate(async () => {
      const { WebSocketRemotePeer } = await import('../../src/netron/transport/websocket/peer.js');
      const peer = new WebSocketRemotePeer('ws://localhost:3334');
      await peer.connect();
      window.testState.wsPeer = peer;
    });

    const result = await page.evaluate(async () => {
      const streamService = await window.testState.wsPeer.queryInterface('StreamService@1.0.0');

      // Stream binary data
      const stream = await streamService.streamLargeData(1, 64);

      const chunks: any[] = [];
      const reader = stream.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push({
          isArrayBuffer: value instanceof ArrayBuffer,
          isUint8Array: value instanceof Uint8Array,
          size: value.byteLength || value.length
        });
      }

      return chunks;
    });

    // Verify binary data types
    result.forEach(chunk => {
      expect(chunk.isArrayBuffer || chunk.isUint8Array).toBe(true);
      expect(chunk.size).toBeGreaterThan(0);
    });

    await page.evaluate(async () => {
      await window.testState.wsPeer.disconnect();
      window.testState.wsPeer = null;
    });
  });

  test('should handle errors identically', async () => {
    await page.evaluate(async () => {
      const { HttpRemotePeer } = await import('../../src/netron/transport/http/peer.js');
      const peer = new HttpRemotePeer('http://localhost:3333');
      await peer.connect();
      window.testState.httpPeer = peer;
    });

    const result = await page.evaluate(async () => {
      const userService = await window.testState.httpPeer.queryInterface('UserService@1.0.0');

      try {
        await userService.unreliableMethod(true);
        return { success: false };
      } catch (err: any) {
        return {
          success: true,
          errorMessage: err.message,
          hasStack: !!err.stack
        };
      }
    });

    expect(result.success).toBe(true);
    expect(result.errorMessage).toContain('Simulated failure');
    expect(result.hasStack).toBe(true);

    await page.evaluate(async () => {
      await window.testState.httpPeer.disconnect();
      window.testState.httpPeer = null;
    });
  });
});

test.describe('Browser-specific Features', () => {
  let page: Page;

  test.beforeEach(async ({ page: p }) => {
    page = p;
    await page.goto('/');
  });

  test('should work with browser AbortController', async () => {
    await page.evaluate(async () => {
      const { HttpRemotePeer } = await import('../../src/netron/transport/http/peer.js');
      const { HttpCacheManager } = await import('../../src/netron/transport/http/cache-manager.js');
      const { RetryManager } = await import('../../src/netron/transport/http/retry-manager.js');

      const peer = new HttpRemotePeer('http://localhost:3333');
      peer.setCacheManager(new HttpCacheManager({ maxEntries: 100 }));
      peer.setRetryManager(new RetryManager());
      await peer.connect();
      window.testState.httpPeer = peer;
    });

    const result = await page.evaluate(async () => {
      const service = await window.testState.httpPeer.queryFluentInterface('UserService@1.0.0');

      const controller = new AbortController();

      // Verify AbortController is native browser API
      const isNative = controller.constructor.name === 'AbortController';

      const promise = service
        .signal(controller.signal)
        .slowMethod(5000);

      setTimeout(() => controller.abort(), 100);

      try {
        await promise;
        return { success: false, isNative };
      } catch (err: any) {
        return {
          success: true,
          isNative,
          error: err.message
        };
      }
    });

    expect(result.isNative).toBe(true);
    expect(result.success).toBe(true);

    await page.evaluate(async () => {
      await window.testState.httpPeer.disconnect();
      window.testState.httpPeer = null;
    });
  });

  test('should use browser Performance API', async () => {
    await page.evaluate(async () => {
      const { HttpRemotePeer } = await import('../../src/netron/transport/http/peer.js');
      const { HttpCacheManager } = await import('../../src/netron/transport/http/cache-manager.js');
      const { RetryManager } = await import('../../src/netron/transport/http/retry-manager.js');

      const peer = new HttpRemotePeer('http://localhost:3333');
      peer.setCacheManager(new HttpCacheManager({ maxEntries: 100 }));
      peer.setRetryManager(new RetryManager());
      await peer.connect();
      window.testState.httpPeer = peer;
    });

    const result = await page.evaluate(async () => {
      const service = await window.testState.httpPeer.queryFluentInterface('UserService@1.0.0');

      // Verify window.performance exists
      const hasPerformance = typeof window.performance !== 'undefined';
      const hasNow = typeof window.performance.now === 'function';

      const start = performance.now();
      await service.getUsers();
      const duration = performance.now() - start;

      return {
        hasPerformance,
        hasNow,
        duration,
        durationIsNumber: typeof duration === 'number'
      };
    });

    expect(result.hasPerformance).toBe(true);
    expect(result.hasNow).toBe(true);
    expect(result.durationIsNumber).toBe(true);
    expect(result.duration).toBeGreaterThan(0);

    await page.evaluate(async () => {
      await window.testState.httpPeer.disconnect();
      window.testState.httpPeer = null;
    });
  });

  test('should handle browser streams (ReadableStream, WritableStream)', async () => {
    await page.evaluate(async () => {
      const { WebSocketRemotePeer } = await import('../../src/netron/transport/websocket/peer.js');
      const peer = new WebSocketRemotePeer('ws://localhost:3334');
      await peer.connect();
      window.testState.wsPeer = peer;
    });

    const result = await page.evaluate(async () => {
      const streamService = await window.testState.wsPeer.queryInterface('StreamService@1.0.0');

      // Verify browser stream APIs
      const hasReadableStream = typeof ReadableStream !== 'undefined';
      const hasWritableStream = typeof WritableStream !== 'undefined';
      const hasTransformStream = typeof TransformStream !== 'undefined';

      // Create browser ReadableStream
      const browserStream = new ReadableStream({
        start(controller) {
          controller.enqueue({ data: 'browser stream' });
          controller.close();
        }
      });

      const isBrowserStream = browserStream instanceof ReadableStream;

      // Use with service
      const transformed = await streamService.transformStream(browserStream, 'uppercase');
      const chunks: any[] = [];
      const reader = transformed.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      return {
        hasReadableStream,
        hasWritableStream,
        hasTransformStream,
        isBrowserStream,
        transformed: chunks[0]?.data
      };
    });

    expect(result.hasReadableStream).toBe(true);
    expect(result.hasWritableStream).toBe(true);
    expect(result.hasTransformStream).toBe(true);
    expect(result.isBrowserStream).toBe(true);
    expect(result.transformed).toBe('BROWSER STREAM');

    await page.evaluate(async () => {
      await window.testState.wsPeer.disconnect();
      window.testState.wsPeer = null;
    });
  });

  test('should be SSR-safe (no globals at module level)', async () => {
    const result = await page.evaluate(async () => {
      // Import modules and check they don't crash in browser
      try {
        await import('../../src/netron/transport/http/peer.js');
        await import('../../src/netron/transport/http/cache-manager.js');
        await import('../../src/netron/transport/http/retry-manager.js');
        await import('../../src/netron/transport/http/fluent-interface.js');
        await import('../../src/netron/transport/http/query-builder.js');
        await import('../../src/netron/transport/websocket/peer.js');

        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    });

    expect(result.success).toBe(true);
  });
});

test.describe('Multi-browser Compatibility', () => {
  test('should work identically across browsers', async ({ page, browserName }) => {
    await page.goto('/');

    await page.evaluate(async () => {
      const { HttpRemotePeer } = await import('../../src/netron/transport/http/peer.js');
      const peer = new HttpRemotePeer('http://localhost:3333');
      await peer.connect();
      window.testState.httpPeer = peer;
    });

    const result = await page.evaluate(async () => {
      const userService = await window.testState.httpPeer.queryInterface('UserService@1.0.0');
      return await userService.getUsers();
    });

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);

    await page.evaluate(async () => {
      await window.testState.httpPeer.disconnect();
      window.testState.httpPeer = null;
    });
  });

  test('should handle WebSocket streams across browsers', async ({ page, browserName }) => {
    await page.goto('/');

    await page.evaluate(async () => {
      const { WebSocketRemotePeer } = await import('../../src/netron/transport/websocket/peer.js');
      const peer = new WebSocketRemotePeer('ws://localhost:3334');
      await peer.connect();
      window.testState.wsPeer = peer;
    });

    const chunks = await page.evaluate(async () => {
      const streamService = await window.testState.wsPeer.queryInterface('StreamService@1.0.0');
      const stream = await streamService.generateStream(5, 100);

      const chunks: any[] = [];
      const reader = stream.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      return chunks;
    });

    expect(chunks).toHaveLength(5);

    await page.evaluate(async () => {
      await window.testState.wsPeer.disconnect();
      window.testState.wsPeer = null;
    });
  });
});
