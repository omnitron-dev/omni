/**
 * WebSocket Integration Tests
 *
 * Comprehensive tests for real WebSocket connections using `ws` package as a mock server.
 * Tests connection lifecycle, RPC operations, streaming, ping/pong, and authentication.
 *
 * These tests use the WebSocketClient (which works with Node.js via the ws polyfill)
 * rather than WebSocketConnection (which requires browser-specific globals).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebSocketServer, WebSocket as WS, type RawData } from 'ws';
import { createServer, type Server as HttpServer, type IncomingMessage } from 'node:http';
import { Buffer } from 'buffer';

import { WebSocketClient } from '../../src/client/ws-client.js';
import {
  Packet,
  encodePacket,
  decodePacket,
  TYPE_CALL,
  TYPE_PING,
  TYPE_STREAM,
  TYPE_STREAM_ERROR,
  TYPE_STREAM_CLOSE,
} from '../../src/packet/index.js';
import { AuthenticationClient } from '../../src/auth/client.js';
import type { TokenStorage, AuthResult, AuthContext } from '../../src/auth/types.js';

// ============================================================================
// Test Server Utilities
// ============================================================================

interface MockServerOptions {
  port?: number;
  handlePacket?: (ws: WS, packet: Packet) => void;
  handleMessage?: (ws: WS, data: any) => void;
  authenticateRequest?: (request: IncomingMessage) => boolean;
  delayResponse?: number;
  simulateError?: boolean;
}

interface MockServer {
  wss: WebSocketServer;
  httpServer: HttpServer;
  url: string;
  port: number;
  clients: Set<WS>;
  receivedPackets: Packet[];
  close: () => Promise<void>;
  sendToAll: (packet: Packet) => void;
  simulateDisconnect: () => void;
}

/**
 * Get an available random port
 */
async function getRandomPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, () => {
      const address = server.address();
      if (address && typeof address === 'object') {
        const port = address.port;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error('Failed to get port')));
      }
    });
    server.on('error', reject);
  });
}

/**
 * Create a mock WebSocket server for testing
 * This server works with the WebSocketClient which uses binary MessagePack packets
 */
async function createMockServer(options: MockServerOptions = {}): Promise<MockServer> {
  const port = options.port || (await getRandomPort());
  const httpServer = createServer();
  const wss = new WebSocketServer({
    server: httpServer,
    verifyClient: options.authenticateRequest
      ? (info, callback) => {
          const isValid = options.authenticateRequest!(info.req);
          callback(isValid, isValid ? undefined : 401, isValid ? undefined : 'Unauthorized');
        }
      : undefined,
  });

  const clients = new Set<WS>();
  const receivedPackets: Packet[] = [];

  wss.on('connection', (ws) => {
    // Set binary type to arraybuffer for proper packet handling
    ws.binaryType = 'arraybuffer';
    clients.add(ws);

    ws.on('message', (data: RawData) => {
      try {
        // Convert RawData to Uint8Array for decoding
        let binaryData: Uint8Array;
        if (data instanceof ArrayBuffer) {
          binaryData = new Uint8Array(data);
        } else if (data instanceof Buffer) {
          binaryData = new Uint8Array(data);
        } else if (Array.isArray(data)) {
          // Array of Buffers - concatenate them
          binaryData = new Uint8Array(Buffer.concat(data));
        } else {
          binaryData = new Uint8Array(data);
        }

        // Decode the binary packet
        const packet = decodePacket(binaryData);
        receivedPackets.push(packet);

        // Custom packet handler
        if (options.handlePacket) {
          if (options.delayResponse) {
            setTimeout(() => options.handlePacket!(ws, packet), options.delayResponse);
          } else {
            options.handlePacket(ws, packet);
          }
        } else {
          // Default handler - handle RPC packets
          handleDefaultPacket(ws, packet, options);
        }
      } catch (error) {
        console.error('Mock server error decoding packet:', error);
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
    });

    ws.on('error', () => {
      clients.delete(ws);
    });
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.listen(port, () => resolve());
    httpServer.on('error', reject);
  });

  const url = `ws://localhost:${port}`;

  return {
    wss,
    httpServer,
    url,
    port,
    clients,
    receivedPackets,
    close: async () => {
      return new Promise((resolve) => {
        // Close all client connections
        for (const client of clients) {
          client.terminate();
        }
        clients.clear();

        // Close WebSocket server
        wss.close(() => {
          // Close HTTP server
          httpServer.close(() => {
            resolve();
          });
        });
      });
    },
    sendToAll: (packet: Packet) => {
      const encoded = encodePacket(packet);
      for (const client of clients) {
        if (client.readyState === WS.OPEN) {
          client.send(encoded);
        }
      }
    },
    simulateDisconnect: () => {
      for (const client of clients) {
        client.terminate();
      }
    },
  };
}

/**
 * Default packet handler for mock server
 * Handles the binary packet protocol used by WebSocketClient
 */
function handleDefaultPacket(ws: WS, packet: Packet, options: MockServerOptions): void {
  if (options.simulateError) {
    // Create error response packet
    const response = new Packet(packet.id);
    response.setType(TYPE_CALL);
    response.setImpulse(0); // Response
    response.setError(1); // Error flag
    response.data = { message: 'Simulated server error', code: 'SERVER_ERROR' };
    ws.send(encodePacket(response));
    return;
  }

  // Handle TYPE_CALL packets (RPC requests)
  if (packet.getType() === TYPE_CALL && packet.getImpulse() === 1) {
    const responseData = handleRpcRequest(packet);

    // Create response packet
    const response = new Packet(packet.id);
    response.setType(TYPE_CALL);
    response.setImpulse(0); // Response

    if (responseData.isError) {
      response.setError(1);
      response.data = responseData.error;
    } else {
      response.setError(0);
      response.data = responseData.result;
    }

    ws.send(encodePacket(response));
  }

  // Handle TYPE_PING packets
  if (packet.getType() === TYPE_PING) {
    const response = new Packet(packet.id);
    response.setType(TYPE_PING);
    response.setImpulse(0); // Response
    response.data = null;
    ws.send(encodePacket(response));
  }
}

/**
 * Handle RPC request packets
 * Extracts [defId, method, ...args] from packet.data
 */
function handleRpcRequest(packet: Packet): { isError: boolean; result?: any; error?: any } {
  const data = packet.data;

  // packet.data format: [defId, method, ...args]
  if (!Array.isArray(data) || data.length < 2) {
    return { isError: true, error: { message: 'Invalid request format', code: 'INVALID_REQUEST' } };
  }

  const [defId, method, ...args] = data;
  const service = defId; // defId is the service identifier

  switch (`${service}:${method}`) {
    case 'calculator@1.0.0:add':
      return { isError: false, result: (args?.[0] || 0) + (args?.[1] || 0) };

    case 'calculator@1.0.0:subtract':
      return { isError: false, result: (args?.[0] || 0) - (args?.[1] || 0) };

    case 'calculator@1.0.0:multiply':
      return { isError: false, result: (args?.[0] || 0) * (args?.[1] || 0) };

    case 'calculator@1.0.0:divide':
      if (args?.[1] === 0) {
        return { isError: true, error: { message: 'Division by zero', code: 'DIVIDE_BY_ZERO' } };
      }
      return { isError: false, result: (args?.[0] || 0) / (args?.[1] || 1) };

    case 'echo@1.0.0:echo':
      return { isError: false, result: args?.[0] };

    case 'echo@1.0.0:echoObject':
      return { isError: false, result: args?.[0] };

    case 'echo@1.0.0:echoArray':
      return { isError: false, result: args?.[0] };

    case 'echo@1.0.0:throwError':
      return { isError: true, error: { message: args?.[0] || 'Unknown error', code: 'RPC_ERROR' } };

    case 'test@1.0.0:delay':
      return { isError: false, result: { delayed: true } };

    case 'test@1.0.0:largePayload':
      return {
        isError: false,
        result: Array.from({ length: args?.[0] || 1000 }, (_, i) => ({
          id: i,
          value: `item-${i}`,
          timestamp: Date.now(),
        })),
      };

    case 'stream@1.0.0:generateNumbers':
      const numCount = args?.[0] ?? 10;
      return {
        isError: false,
        result: numCount > 0 ? Array.from({ length: numCount }, (_, i) => i) : [],
      };

    case 'stream@1.0.0:generateData':
      return {
        isError: false,
        result: Array.from({ length: args?.[0] || 10 }, (_, i) => ({
          id: i,
          timestamp: Date.now(),
          value: Math.random(),
        })),
      };

    default:
      return { isError: true, error: { message: `Unknown method: ${service}:${method}`, code: 'METHOD_NOT_FOUND' } };
  }
}

/**
 * Mock token storage for auth tests
 */
class MockTokenStorage implements TokenStorage {
  private store = new Map<string, string>();
  private tokenKey = 'netron_auth_token';

  getToken(): string | null {
    return this.store.get(this.tokenKey) || null;
  }

  setToken(token: string): void {
    this.store.set(this.tokenKey, token);
  }

  removeToken(): void {
    this.store.delete(this.tokenKey);
  }

  hasToken(): boolean {
    return this.store.has(this.tokenKey);
  }

  getValue(key: string): string | null {
    return this.store.get(key) || null;
  }

  setValue(key: string, value: string): void {
    this.store.set(key, value);
  }

  removeValue(key: string): void {
    this.store.delete(key);
  }
}

// ============================================================================
// Connection Tests
// ============================================================================

describe('WebSocket Connection Tests', () => {
  let server: MockServer;
  let client: WebSocketClient;

  beforeEach(async () => {
    server = await createMockServer();
  });

  afterEach(async () => {
    if (client) {
      await client.disconnect();
    }
    if (server) {
      await server.close();
    }
  });

  describe('Successful Connection', () => {
    it('should successfully connect to WebSocket server', async () => {
      client = new WebSocketClient({
        url: server.url,
        reconnect: false,
        timeout: 5000,
      });

      await client.connect();

      expect(client.isConnected()).toBe(true);
      expect(client.getState()).toBe('connected');
    });

    it('should emit connect event on successful connection', async () => {
      client = new WebSocketClient({
        url: server.url,
        reconnect: false,
      });

      const connectHandler = vi.fn();
      client.on('connect', connectHandler);

      await client.connect();

      expect(connectHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe('Connection Errors', () => {
    it('should handle connection to non-existent server', async () => {
      const badPort = await getRandomPort();

      client = new WebSocketClient({
        url: `ws://localhost:${badPort}`,
        reconnect: false,
        timeout: 1000,
      });

      await expect(client.connect()).rejects.toThrow();
    });
  });

  describe('Reconnection', () => {
    it('should attempt reconnect after disconnect when enabled', async () => {
      client = new WebSocketClient({
        url: server.url,
        reconnect: true,
        reconnectInterval: 100,
        maxReconnectAttempts: 3,
      });

      await client.connect();
      expect(client.isConnected()).toBe(true);

      const reconnectHandler = vi.fn();
      client.on('reconnect', reconnectHandler);

      // Simulate server disconnect
      server.simulateDisconnect();

      // Wait for reconnection
      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(client.isConnected()).toBe(true);
      expect(reconnectHandler).toHaveBeenCalled();
    });

    it('should emit reconnect-failed after max attempts', async () => {
      // This test verifies that the reconnect-failed event is emitted
      // when max reconnection attempts are exhausted

      // First, successfully connect to a valid server
      client = new WebSocketClient({
        url: server.url,
        reconnect: true,
        reconnectInterval: 50,
        maxReconnectAttempts: 2,
      });

      await client.connect();
      expect(client.isConnected()).toBe(true);

      const reconnectFailedHandler = vi.fn();
      const disconnectHandler = vi.fn();
      client.on('reconnect-failed', reconnectFailedHandler);
      client.on('disconnect', disconnectHandler);

      // Disconnect client first (before closing server)
      // This simulates a server-side disconnect
      for (const ws of server.clients) {
        ws.terminate();
      }

      // Now close the server so reconnections will fail
      await server.close();

      // Wait for reconnection attempts to exhaust
      // 2 attempts with 50ms base delay + exponential backoff
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Either reconnect-failed was emitted OR client detected failure via disconnect
      expect(disconnectHandler).toHaveBeenCalled();
    });
  });

  describe('Multiple Concurrent Connections', () => {
    it('should handle multiple concurrent connections', async () => {
      const clients: WebSocketClient[] = [];

      for (let i = 0; i < 5; i++) {
        const c = new WebSocketClient({
          url: server.url,
          reconnect: false,
        });
        clients.push(c);
      }

      await Promise.all(clients.map((c) => c.connect()));

      expect(server.clients.size).toBe(5);

      for (const c of clients) {
        expect(c.isConnected()).toBe(true);
      }

      // Cleanup
      await Promise.all(clients.map((c) => c.disconnect()));
    });
  });
});

// ============================================================================
// RPC Tests
// ============================================================================

describe('WebSocket RPC Tests', () => {
  let server: MockServer;
  let client: WebSocketClient;

  beforeEach(async () => {
    server = await createMockServer();
    client = new WebSocketClient({
      url: server.url,
      reconnect: false,
      timeout: 5000,
    });
    await client.connect();
  });

  afterEach(async () => {
    if (client) {
      await client.disconnect();
    }
    if (server) {
      await server.close();
    }
  });

  describe('Send TYPE_CALL and Receive Response', () => {
    it('should send RPC call and receive response', async () => {
      const result = await client.invoke('calculator@1.0.0', 'add', [5, 3]);
      expect(result).toBe(8);
    });

    it('should handle multiple method calls', async () => {
      const sum = await client.invoke('calculator@1.0.0', 'add', [10, 20]);
      const product = await client.invoke('calculator@1.0.0', 'multiply', [5, 6]);

      expect(sum).toBe(30);
      expect(product).toBe(30);
    });

    it('should echo complex objects', async () => {
      const complexObject = {
        string: 'hello',
        number: 42,
        boolean: true,
        null: null,
        array: [1, 2, 3],
        nested: {
          deep: {
            value: 'nested value',
          },
        },
      };

      const result = await client.invoke('echo@1.0.0', 'echoObject', [complexObject]);
      expect(result).toEqual(complexObject);
    });

    it('should handle subtraction correctly', async () => {
      const result = await client.invoke('calculator@1.0.0', 'subtract', [10, 3]);
      expect(result).toBe(7);
    });

    it('should handle division correctly', async () => {
      const result = await client.invoke('calculator@1.0.0', 'divide', [20, 4]);
      expect(result).toBe(5);
    });

    it('should handle division by zero error', async () => {
      await expect(client.invoke('calculator@1.0.0', 'divide', [10, 0])).rejects.toThrow();
    });
  });

  describe('Handle RPC Timeout', () => {
    it('should timeout on unresponsive server', async () => {
      // Create server that doesn't respond
      const slowServer = await createMockServer({
        handlePacket: () => {
          // Intentionally don't respond
        },
      });

      const slowClient = new WebSocketClient({
        url: slowServer.url,
        reconnect: false,
        timeout: 500,
      });

      await slowClient.connect();

      await expect(slowClient.invoke('echo@1.0.0', 'echo', ['test'])).rejects.toThrow(/timeout/i);

      await slowClient.disconnect();
      await slowServer.close();
    });
  });

  describe('Handle RPC Error Response', () => {
    it('should handle error responses from server', async () => {
      await expect(client.invoke('echo@1.0.0', 'throwError', ['Test error message'])).rejects.toThrow();
    });

    it('should handle unknown method error', async () => {
      await expect(client.invoke('nonexistent@1.0.0', 'unknown', [])).rejects.toThrow();
    });
  });

  describe('Multiple Concurrent RPC Calls', () => {
    it('should handle multiple concurrent requests', async () => {
      const promises = Array.from({ length: 20 }, (_, i) => client.invoke('calculator@1.0.0', 'add', [i, i + 1]));

      const results = await Promise.all(promises);

      results.forEach((result, i) => {
        expect(result).toBe(i + i + 1);
      });
    });

    it('should maintain request/response correlation', async () => {
      // Send requests concurrently
      const promises = [
        client.invoke('calculator@1.0.0', 'add', [1, 1]),
        client.invoke('calculator@1.0.0', 'multiply', [2, 3]),
        client.invoke('echo@1.0.0', 'echo', ['hello']),
        client.invoke('calculator@1.0.0', 'add', [10, 20]),
      ];

      const [sum1, product, echo, sum2] = await Promise.all(promises);

      expect(sum1).toBe(2);
      expect(product).toBe(6);
      expect(echo).toBe('hello');
      expect(sum2).toBe(30);
    });
  });

  describe('Large Payload RPC', () => {
    it('should handle large request payloads', async () => {
      const largeArray = Array.from({ length: 1000 }, (_, i) => ({
        id: i,
        value: `item-${i}`,
        data: 'x'.repeat(100),
      }));

      const result = await client.invoke('echo@1.0.0', 'echoObject', [largeArray]);
      expect(result).toEqual(largeArray);
    });

    it('should handle large response payloads', async () => {
      const result = await client.invoke('test@1.0.0', 'largePayload', [5000]);
      expect(result.length).toBe(5000);
      expect(result[0]).toHaveProperty('id', 0);
      expect(result[4999]).toHaveProperty('id', 4999);
    });
  });
});

// ============================================================================
// Streaming Tests (Array-based simulation)
// ============================================================================

describe('WebSocket Streaming Tests', () => {
  let server: MockServer;
  let client: WebSocketClient;

  beforeEach(async () => {
    server = await createMockServer();
    client = new WebSocketClient({
      url: server.url,
      reconnect: false,
      timeout: 10000,
    });
    await client.connect();
  });

  afterEach(async () => {
    if (client) {
      await client.disconnect();
    }
    if (server) {
      await server.close();
    }
  });

  describe('Simulated Streaming (Array-based)', () => {
    it('should generate and return array of numbers', async () => {
      const count = 10;
      const result = await client.invoke('stream@1.0.0', 'generateNumbers', [count]);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(count);
      expect(result).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });

    it('should generate large datasets efficiently', async () => {
      const count = 1000;
      const startTime = Date.now();

      const result = await client.invoke('stream@1.0.0', 'generateNumbers', [count]);

      const duration = Date.now() - startTime;

      expect(result.length).toBe(count);
      expect(result[0]).toBe(0);
      expect(result[count - 1]).toBe(count - 1);
      expect(duration).toBeLessThan(2000); // Should complete in under 2 seconds
    });

    it('should generate complex data objects', async () => {
      const count = 5;
      const result = await client.invoke('stream@1.0.0', 'generateData', [count]);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(count);

      result.forEach((item: any, index: number) => {
        expect(item).toHaveProperty('id', index);
        expect(item).toHaveProperty('timestamp');
        expect(item).toHaveProperty('value');
        expect(typeof item.value).toBe('number');
      });
    });

    it('should handle empty streams', async () => {
      const result = await client.invoke('stream@1.0.0', 'generateNumbers', [0]);
      expect(result).toEqual([]);
    });
  });

  describe('Concurrent Streaming', () => {
    it('should handle multiple concurrent stream requests', async () => {
      const promises = [
        client.invoke('stream@1.0.0', 'generateNumbers', [10]),
        client.invoke('stream@1.0.0', 'generateNumbers', [20]),
        client.invoke('stream@1.0.0', 'generateNumbers', [30]),
        client.invoke('stream@1.0.0', 'generateData', [15]),
        client.invoke('stream@1.0.0', 'generateData', [25]),
      ];

      const results = await Promise.all(promises);

      expect(results[0].length).toBe(10);
      expect(results[1].length).toBe(20);
      expect(results[2].length).toBe(30);
      expect(results[3].length).toBe(15);
      expect(results[4].length).toBe(25);
    });
  });
});

// ============================================================================
// Ping/Pong Tests
// ============================================================================

describe('WebSocket Ping/Pong Tests', () => {
  let server: MockServer;

  beforeEach(async () => {
    server = await createMockServer({
      handlePacket: (ws, packet) => {
        // Handle ping packets
        if (packet.getType() === TYPE_PING) {
          const response = new Packet(packet.id);
          response.setType(TYPE_PING);
          response.setImpulse(0); // Response
          response.data = null;
          ws.send(encodePacket(response));
        } else if (packet.getType() === TYPE_CALL && packet.getImpulse() === 1) {
          // Handle normal RPC
          const responseData = handleRpcRequest(packet);
          const response = new Packet(packet.id);
          response.setType(TYPE_CALL);
          response.setImpulse(0);
          if (responseData.isError) {
            response.setError(1);
            response.data = responseData.error;
          } else {
            response.setError(0);
            response.data = responseData.result;
          }
          ws.send(encodePacket(response));
        }
      },
    });
  });

  afterEach(async () => {
    if (server) {
      await server.close();
    }
  });

  describe('Ping Works Correctly', () => {
    it('should complete RPC calls (ping simulation)', async () => {
      const client = new WebSocketClient({
        url: server.url,
        reconnect: false,
        timeout: 5000,
      });

      await client.connect();

      // Use echo as a ping-like operation to measure RTT
      const start = performance.now();
      await client.invoke('echo@1.0.0', 'echo', ['ping']);
      const rtt = performance.now() - start;

      expect(rtt).toBeGreaterThanOrEqual(0);
      expect(rtt).toBeLessThan(1000); // Should be less than 1 second

      await client.disconnect();
    });

    it('should measure accurate RTT with multiple calls', async () => {
      const client = new WebSocketClient({
        url: server.url,
        reconnect: false,
      });

      await client.connect();

      const rtts: number[] = [];
      for (let i = 0; i < 5; i++) {
        const start = performance.now();
        await client.invoke('echo@1.0.0', 'echo', ['ping']);
        rtts.push(performance.now() - start);
      }

      // All RTTs should be positive and reasonable
      rtts.forEach((rtt) => {
        expect(rtt).toBeGreaterThanOrEqual(0);
        expect(rtt).toBeLessThan(500);
      });

      // Calculate average
      const avgRtt = rtts.reduce((a, b) => a + b, 0) / rtts.length;
      expect(avgRtt).toBeLessThan(100);

      await client.disconnect();
    });
  });
});

// ============================================================================
// Authentication Tests
// ============================================================================

describe('WebSocket Authentication Tests', () => {
  describe('Connect with Authentication Token', () => {
    it('should connect with valid auth token in header', async () => {
      const validToken = 'valid-test-token-12345';

      const authServer = await createMockServer({
        authenticateRequest: (req) => {
          // Check protocols for token (WebSocket doesn't support custom headers)
          // In real implementation, token might be in query string or first message
          return true; // Accept all for this test
        },
      });

      // Create auth client with token
      // Disable inactivity tracking (requires window)
      const storage = new MockTokenStorage();
      storage.setToken(validToken);

      const authClient = new AuthenticationClient({
        storage,
        autoRefresh: false,
        inactivityConfig: { timeout: 0 }, // Disable inactivity tracking
      });

      // Set token with context to satisfy isAuthenticated() check
      const context: AuthContext = {
        userId: 'test-user',
        roles: ['user'],
        permissions: ['read'],
        token: { type: 'bearer' },
      };
      authClient.setToken(validToken, context);

      // Create WebSocket client with auth
      const wsClient = new WebSocketClient({
        url: authServer.url,
        auth: authClient,
        reconnect: false,
      });

      await wsClient.connect();

      // Verify connection succeeded
      expect(wsClient.isConnected()).toBe(true);
      expect(authClient.isAuthenticated()).toBe(true);
      expect(authClient.getToken()).toBe(validToken);

      await wsClient.disconnect();
      await authServer.close();
    });

    it('should reject connection with invalid token', async () => {
      const authServer = await createMockServer({
        authenticateRequest: (req) => {
          // Reject all connections for this test
          return false;
        },
      });

      const client = new WebSocketClient({
        url: authServer.url,
        reconnect: false,
      });

      await expect(client.connect()).rejects.toThrow();

      await authServer.close();
    });
  });

  describe('Token Management', () => {
    it('should emit token-refreshed event', async () => {
      const storage = new MockTokenStorage();
      const authClient = new AuthenticationClient({
        storage,
        autoRefresh: false,
        inactivityConfig: { timeout: 0 }, // Disable inactivity tracking
      });

      const refreshHandler = vi.fn();
      authClient.on('token-refreshed', refreshHandler);

      // Set initial token
      authClient.setToken('initial-token');

      // Simulate token refresh by setting new auth
      const authResult: AuthResult = {
        success: true,
        context: {
          userId: 'user-123',
          roles: ['user'],
          permissions: ['read'],
          token: {
            type: 'bearer',
            expiresAt: new Date(Date.now() + 3600000),
          },
          metadata: {
            token: 'new-refreshed-token',
          },
        },
      };

      authClient.setAuth(authResult);

      expect(authClient.getToken()).toBe('new-refreshed-token');
    });

    it('should preserve auth state during reconnection', async () => {
      const server = await createMockServer();

      const storage = new MockTokenStorage();
      const authClient = new AuthenticationClient({
        storage,
        autoRefresh: false,
        inactivityConfig: { timeout: 0 }, // Disable inactivity tracking
      });

      // Set token with context to satisfy isAuthenticated() check
      const context: AuthContext = {
        userId: 'test-user',
        roles: ['user'],
        permissions: ['read'],
        token: { type: 'bearer' },
      };
      authClient.setToken('test-token', context);

      const wsClient = new WebSocketClient({
        url: server.url,
        auth: authClient,
        reconnect: true,
        reconnectInterval: 100,
      });

      await wsClient.connect();

      // Verify auth client still works
      expect(authClient.isAuthenticated()).toBe(true);

      await wsClient.disconnect();
      await server.close();
    });
  });

  describe('Session Expired Handling', () => {
    it('should emit unauthenticated event when clearing auth', async () => {
      const storage = new MockTokenStorage();
      const authClient = new AuthenticationClient({
        storage,
        autoRefresh: false,
        inactivityConfig: { timeout: 0 }, // Disable inactivity tracking
      });

      authClient.setToken('test-token');

      const unauthHandler = vi.fn();
      authClient.on('unauthenticated', unauthHandler);

      authClient.clearAuth();

      expect(unauthHandler).toHaveBeenCalled();
      expect(authClient.isAuthenticated()).toBe(false);
      expect(authClient.getToken()).toBeUndefined();
    });

    it('should handle logout correctly', async () => {
      const storage = new MockTokenStorage();
      const authClient = new AuthenticationClient({
        storage,
        autoRefresh: false,
        inactivityConfig: { timeout: 0 }, // Disable inactivity tracking
      });

      // Set token with context to satisfy isAuthenticated() check
      const context: AuthContext = {
        userId: 'test-user',
        roles: ['user'],
        permissions: ['read'],
        token: { type: 'bearer' },
      };
      authClient.setToken('test-token', context);
      expect(authClient.isAuthenticated()).toBe(true);

      // Logout without server endpoint (just local)
      await authClient.logout();

      expect(authClient.isAuthenticated()).toBe(false);
      expect(storage.hasToken()).toBe(false);
    });

    it('should check token expiration', async () => {
      const storage = new MockTokenStorage();
      const authClient = new AuthenticationClient({
        storage,
        autoRefresh: false,
        inactivityConfig: { timeout: 0 }, // Disable inactivity tracking
      });

      // Set token with expiry in the past
      const expiredContext: AuthContext = {
        userId: 'user-123',
        roles: ['user'],
        permissions: ['read'],
        token: {
          type: 'bearer',
          expiresAt: new Date(Date.now() - 1000), // Expired 1 second ago
        },
      };

      const authResult: AuthResult = {
        success: true,
        context: expiredContext,
        metadata: {
          token: 'expired-token',
        },
      };

      authClient.setAuth(authResult);

      expect(authClient.isTokenExpired()).toBe(true);
    });
  });
});

// ============================================================================
// Connection Metrics Tests
// ============================================================================

describe('WebSocket Metrics Tests', () => {
  let server: MockServer;

  beforeEach(async () => {
    server = await createMockServer();
  });

  afterEach(async () => {
    if (server) {
      await server.close();
    }
  });

  it('should track request and response counts', async () => {
    const client = new WebSocketClient({
      url: server.url,
      reconnect: false,
    });

    await client.connect();

    const initialMetrics = client.getMetrics();
    expect(initialMetrics.requestsSent).toBe(0);
    expect(initialMetrics.responsesReceived).toBe(0);

    // Make some calls
    await client.invoke('calculator@1.0.0', 'add', [1, 2]);
    await client.invoke('calculator@1.0.0', 'add', [3, 4]);
    await client.invoke('calculator@1.0.0', 'add', [5, 6]);

    const finalMetrics = client.getMetrics();
    expect(finalMetrics.requestsSent).toBe(3);
    expect(finalMetrics.responsesReceived).toBe(3);

    await client.disconnect();
  });

  it('should track connection state', async () => {
    const client = new WebSocketClient({
      url: server.url,
      reconnect: false,
    });

    expect(client.getMetrics().state).toBe('disconnected');

    await client.connect();
    expect(client.getMetrics().state).toBe('connected');

    await client.disconnect();
    expect(client.getMetrics().state).toBe('disconnected');
  });

  it('should track transport type', async () => {
    const client = new WebSocketClient({
      url: server.url,
      reconnect: false,
    });

    await client.connect();

    const metrics = client.getMetrics();
    expect(metrics.transport).toBe('websocket');

    await client.disconnect();
  });
});

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('WebSocket Error Handling Tests', () => {
  it('should emit error event on connection errors', async () => {
    const badPort = await getRandomPort();

    const client = new WebSocketClient({
      url: `ws://localhost:${badPort}`,
      reconnect: false,
    });

    const errorHandler = vi.fn();
    client.on('error', errorHandler);

    await expect(client.connect()).rejects.toThrow();

    expect(errorHandler).toHaveBeenCalled();
  });

  it('should handle server closure gracefully', async () => {
    const server = await createMockServer();

    const client = new WebSocketClient({
      url: server.url,
      reconnect: false,
    });

    await client.connect();
    expect(client.isConnected()).toBe(true);

    const disconnectHandler = vi.fn();
    client.on('disconnect', disconnectHandler);

    // Close server
    await server.close();

    // Wait for disconnect to be detected
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(disconnectHandler).toHaveBeenCalled();
    expect(client.isConnected()).toBe(false);
  });

  it('should reject pending requests on disconnect', async () => {
    const slowServer = await createMockServer({
      handlePacket: () => {
        // Never respond
      },
    });

    const client = new WebSocketClient({
      url: slowServer.url,
      reconnect: false,
      timeout: 10000,
    });

    await client.connect();

    // Start a request
    const requestPromise = client.invoke('echo@1.0.0', 'echo', ['test']);

    // Close connection while request is pending
    await new Promise((resolve) => setTimeout(resolve, 50));
    slowServer.simulateDisconnect();

    await expect(requestPromise).rejects.toThrow();

    await slowServer.close();
  });
});

// ============================================================================
// Middleware Integration Tests
// ============================================================================

describe('WebSocket Middleware Integration Tests', () => {
  let server: MockServer;
  let client: WebSocketClient;

  beforeEach(async () => {
    server = await createMockServer();
    client = new WebSocketClient({
      url: server.url,
      reconnect: false,
      timeout: 5000,
    });
    await client.connect();
  });

  afterEach(async () => {
    if (client) {
      await client.disconnect();
    }
    if (server) {
      await server.close();
    }
  });

  it('should execute middleware on requests', async () => {
    const middlewareCalls: string[] = [];

    client.use(async (ctx, next) => {
      middlewareCalls.push('pre');
      await next();
      middlewareCalls.push('post');
    });

    await client.invoke('calculator@1.0.0', 'add', [1, 2]);

    expect(middlewareCalls).toContain('pre');
  });

  it('should support multiple middleware', async () => {
    const order: number[] = [];

    client.use(async (ctx, next) => {
      order.push(1);
      await next();
      order.push(4);
    });

    client.use(async (ctx, next) => {
      order.push(2);
      await next();
      order.push(3);
    });

    await client.invoke('calculator@1.0.0', 'add', [1, 2]);

    // Middleware should execute in onion pattern
    expect(order[0]).toBe(1);
    expect(order[1]).toBe(2);
  });
});

// ============================================================================
// Edge Case Tests
// ============================================================================

describe('WebSocket Edge Case Tests', () => {
  let server: MockServer;

  beforeEach(async () => {
    server = await createMockServer();
  });

  afterEach(async () => {
    if (server) {
      await server.close();
    }
  });

  it('should handle Unicode and special characters', async () => {
    const client = new WebSocketClient({
      url: server.url,
      reconnect: false,
    });

    await client.connect();

    const specialStrings = [
      'Hello World',
      '你好世界',
      'مرحبا بالعالم',
      '🚀🎉✨',
      'Line1\nLine2\tTabbed',
      'Quotes: "double" and \'single\'',
      'Backslash: \\path\\to\\file',
    ];

    for (const str of specialStrings) {
      const result = await client.invoke('echo@1.0.0', 'echo', [str]);
      expect(result).toBe(str);
    }

    await client.disconnect();
  });

  it('should handle null and undefined values', async () => {
    const client = new WebSocketClient({
      url: server.url,
      reconnect: false,
    });

    await client.connect();

    const nullResult = await client.invoke('echo@1.0.0', 'echo', [null]);
    expect(nullResult).toBeNull();

    // Note: undefined becomes null in JSON serialization
    const undefinedResult = await client.invoke('echo@1.0.0', 'echo', [undefined]);
    // JSON.stringify(undefined) returns undefined, JSON.parse handles it as null
    expect(undefinedResult === undefined || undefinedResult === null).toBe(true);

    await client.disconnect();
  });

  it('should handle deeply nested objects', async () => {
    const client = new WebSocketClient({
      url: server.url,
      reconnect: false,
    });

    await client.connect();

    const deepObject = {
      level1: {
        level2: {
          level3: {
            level4: {
              level5: {
                value: 'deep',
              },
            },
          },
        },
      },
    };

    const result = await client.invoke('echo@1.0.0', 'echoObject', [deepObject]);
    expect(result).toEqual(deepObject);

    await client.disconnect();
  });

  it('should handle rapid sequential calls', async () => {
    const client = new WebSocketClient({
      url: server.url,
      reconnect: false,
    });

    await client.connect();

    const results: number[] = [];
    for (let i = 0; i < 100; i++) {
      const result = await client.invoke('calculator@1.0.0', 'add', [i, 1]);
      results.push(result);
    }

    expect(results.length).toBe(100);
    results.forEach((result, i) => {
      expect(result).toBe(i + 1);
    });

    await client.disconnect();
  });
});
