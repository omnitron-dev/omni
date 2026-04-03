/**
 * Unit tests for pathPrefix support across transport layers
 *
 * Tests that HTTP and WebSocket connections correctly handle path prefixes
 * for routing requests through API gateways to specific backends.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HttpConnection } from '../../../src/transport/http/connection.js';
import { HttpRemotePeer } from '../../../src/transport/http/peer.js';
import { WebSocketConnection } from '../../../src/transport/ws/connection.js';

// Mock fetch for HTTP tests
const mockFetch = vi.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve({ services: [] }),
  headers: new Map(),
});
global.fetch = mockFetch;

// Mock WebSocket for WebSocket tests
class MockWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  binaryType = 'arraybuffer';
  url: string;

  constructor(url: string, _protocols?: string | string[]) {
    this.url = url;
  }

  addEventListener = vi.fn();
  removeEventListener = vi.fn();
  close = vi.fn();
  send = vi.fn();
}

(global as any).WebSocket = MockWebSocket;

describe('pathPrefix support', () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  describe('HTTP Connection path prefix', () => {
    it('should construct URLs with path prefix', () => {
      const connection = new HttpConnection('https://api.example.com', {
        pathPrefix: '/core',
      });

      expect(connection.getPathPrefix()).toBe('/core');
    });

    it('should handle empty prefix (backward compatible)', () => {
      const connection = new HttpConnection('https://api.example.com');

      expect(connection.getPathPrefix()).toBe('');
    });

    it('should normalize prefixes by removing trailing slashes', () => {
      const connection = new HttpConnection('https://api.example.com', {
        pathPrefix: '/api/v1/',
      });

      expect(connection.getPathPrefix()).toBe('/api/v1');
    });

    it('should handle multiple trailing slashes', () => {
      const connection = new HttpConnection('https://api.example.com', {
        pathPrefix: '/core///',
      });

      expect(connection.getPathPrefix()).toBe('/core');
    });

    it('should handle undefined pathPrefix', () => {
      const connection = new HttpConnection('https://api.example.com', {
        timeout: 5000,
        // pathPrefix not provided
      });

      expect(connection.getPathPrefix()).toBe('');
    });

    it('should handle empty string pathPrefix', () => {
      const connection = new HttpConnection('https://api.example.com', {
        pathPrefix: '',
      });

      expect(connection.getPathPrefix()).toBe('');
    });

    it('should include pathPrefix in metrics', () => {
      const connection = new HttpConnection('https://api.example.com', {
        pathPrefix: '/storage',
      });

      const metrics = connection.getMetrics();

      expect(metrics.pathPrefix).toBe('/storage');
    });

    it('should normalize base URL by removing trailing slash', () => {
      const connection = new HttpConnection('https://api.example.com/', {
        pathPrefix: '/core',
      });

      expect(connection.remoteAddress).toBe('https://api.example.com');
    });

    it('should preserve leading slash', () => {
      const connection = new HttpConnection('https://api.example.com', {
        pathPrefix: '/api/v2/backend',
      });

      expect(connection.getPathPrefix()).toBe('/api/v2/backend');
    });

    it('should handle complex path structure', () => {
      const connection = new HttpConnection('https://api.example.com', {
        pathPrefix: '/api/v1/core/rpc',
      });

      expect(connection.getPathPrefix()).toBe('/api/v1/core/rpc');
    });
  });

  describe('HTTP Peer path prefix', () => {
    it('should construct URLs with path prefix', () => {
      const peer = new HttpRemotePeer('https://api.example.com', {
        pathPrefix: '/core',
      });

      expect(peer.getPathPrefix()).toBe('/core');
    });

    it('should handle empty prefix (backward compatible)', () => {
      const peer = new HttpRemotePeer('https://api.example.com');

      expect(peer.getPathPrefix()).toBe('');
    });

    it('should normalize prefixes by removing trailing slashes', () => {
      const peer = new HttpRemotePeer('https://api.example.com', {
        pathPrefix: '/api/v1/',
      });

      expect(peer.getPathPrefix()).toBe('/api/v1');
    });
  });

  describe('WebSocket Connection path prefix', () => {
    it('should construct URLs with path prefix', () => {
      const connection = new WebSocketConnection('wss://api.example.com', {
        pathPrefix: '/chat',
      });

      expect(connection.getPathPrefix()).toBe('/chat');
      expect(connection.url).toBe('wss://api.example.com/chat');
    });

    it('should handle empty prefix (backward compatible)', () => {
      const connection = new WebSocketConnection('wss://api.example.com');

      expect(connection.getPathPrefix()).toBe('');
      expect(connection.url).toBe('wss://api.example.com');
    });

    it('should normalize prefixes by removing trailing slashes', () => {
      const connection = new WebSocketConnection('wss://api.example.com', {
        pathPrefix: '/realtime/',
      });

      expect(connection.getPathPrefix()).toBe('/realtime');
      expect(connection.url).toBe('wss://api.example.com/realtime');
    });

    it('should convert HTTP URL to WebSocket URL with prefix', () => {
      const connection = new WebSocketConnection('https://api.example.com', {
        pathPrefix: '/ws',
      });

      expect(connection.url).toBe('wss://api.example.com/ws');
    });

    it('should convert http:// to ws://', () => {
      const connection = new WebSocketConnection('http://localhost:3000', {
        pathPrefix: '/socket',
      });

      expect(connection.url).toBe('ws://localhost:3000/socket');
    });

    it('should include pathPrefix in metrics', () => {
      const connection = new WebSocketConnection('wss://api.example.com', {
        pathPrefix: '/chat',
      });

      const metrics = connection.getMetrics();

      expect(metrics.pathPrefix).toBe('/chat');
      expect(metrics.url).toBe('wss://api.example.com/chat');
    });

    it('should handle double slashes correctly', () => {
      const connection = new WebSocketConnection('wss://api.example.com/', {
        pathPrefix: '/chat',
      });

      // Should not have double slashes
      expect(connection.url).toBe('wss://api.example.com/chat');
      expect(connection.url).not.toContain('//chat');
    });

    it('should handle URL with existing path', () => {
      const connection = new WebSocketConnection('wss://api.example.com/base', {
        pathPrefix: '/chat',
      });

      // pathPrefix is appended to the URL including any existing path
      expect(connection.url).toBe('wss://api.example.com/base/chat');
    });

    it('should handle complex URLs with port', () => {
      const connection = new WebSocketConnection('wss://api.example.com:8080', {
        pathPrefix: '/ws',
      });

      expect(connection.url).toBe('wss://api.example.com:8080/ws');
    });
  });

  describe('path prefix normalization edge cases', () => {
    it('should handle prefix with only slashes for HTTP', () => {
      const connection = new HttpConnection('https://api.example.com', {
        pathPrefix: '///',
      });

      expect(connection.getPathPrefix()).toBe('');
    });

    it('should handle prefix with only slashes for WebSocket', () => {
      const connection = new WebSocketConnection('wss://api.example.com', {
        pathPrefix: '///',
      });

      // Empty after normalization, so URL should be unchanged
      expect(connection.url).toBe('wss://api.example.com');
    });
  });

  describe('backward compatibility', () => {
    it('should work without pathPrefix option for HTTP', () => {
      const connection = new HttpConnection('https://api.example.com', {
        timeout: 5000,
      });

      expect(connection.getPathPrefix()).toBe('');
    });

    it('should work without pathPrefix option for HTTP Peer', () => {
      const peer = new HttpRemotePeer('https://api.example.com', {
        requestTimeout: 5000,
      });

      expect(peer.getPathPrefix()).toBe('');
    });

    it('should work without pathPrefix option for WebSocket', () => {
      const connection = new WebSocketConnection('wss://api.example.com');

      expect(connection.url).toBe('wss://api.example.com');
      expect(connection.getPathPrefix()).toBe('');
    });
  });

  describe('integration with multi-backend routing', () => {
    it('should support different path prefixes for different backends', () => {
      const coreConnection = new HttpConnection('https://api.example.com', {
        pathPrefix: '/core',
      });

      const storageConnection = new HttpConnection('https://api.example.com', {
        pathPrefix: '/storage',
      });

      const analyticsConnection = new HttpConnection('https://api.example.com', {
        pathPrefix: '/analytics',
      });

      expect(coreConnection.getPathPrefix()).toBe('/core');
      expect(storageConnection.getPathPrefix()).toBe('/storage');
      expect(analyticsConnection.getPathPrefix()).toBe('/analytics');
    });

    it('should support mixed transport types with path prefixes', () => {
      const httpConnection = new HttpConnection('https://api.example.com', {
        pathPrefix: '/core',
      });

      const wsConnection = new WebSocketConnection('https://api.example.com', {
        pathPrefix: '/chat',
      });

      expect(httpConnection.getPathPrefix()).toBe('/core');
      expect(wsConnection.getPathPrefix()).toBe('/chat');
      expect(wsConnection.url).toBe('wss://api.example.com/chat');
    });
  });
});
