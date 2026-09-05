/**
 * WebSocket Transport Tests
 *
 * Basic tests to verify WebSocket connection and peer functionality
 */

import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { WebSocketConnection, WebSocketPeer, ConnectionState } from '../../src/transport/ws/index.js';
import { Packet, TYPE_CALL } from '../../src/packet/index.js';

// Mock WebSocket for testing

/**
 * Every deferred dispatch these mocks make goes through here.
 *
 * A `setTimeout` that survives its test file outlives the happy-dom
 * environment too: the callback then constructs a `CloseEvent` from a
 * torn-down realm, and `EventTarget.dispatchEvent` rejects it with
 * "parameter 1 is not of type 'Event'" — an unhandled error that vitest
 * reports alongside "This might cause false positive tests", because it can
 * abort a test before its assertions run. Observed under a full monorepo run,
 * where files finish faster than the 10ms these timers wait.
 *
 * The delays themselves are not decoration: `WebSocketConnection` attaches its
 * listeners after constructing the socket, so an `open` dispatched
 * synchronously from the constructor would arrive before anyone is listening.
 * The remedy is therefore to cancel what is still pending, not to remove the
 * asynchrony.
 */
const pendingMockTimers = new Set<ReturnType<typeof setTimeout>>();

function deferMockEvent(fn: () => void, delayMs: number): void {
  const timer = setTimeout(() => {
    pendingMockTimers.delete(timer);
    fn();
  }, delayMs);
  pendingMockTimers.add(timer);
}

function clearPendingMockTimers(): void {
  for (const timer of pendingMockTimers) clearTimeout(timer);
  pendingMockTimers.clear();
}

// The defect itself cannot be reproduced on demand — it needs this file to
// finish while another is still running, so that the environment is disposed
// with a timer in flight. What CAN be checked deterministically is its
// precondition: nothing this file scheduled is still pending when it ends.
// Removing any of the `clearPendingMockTimers()` calls below fails this.
afterAll(() => {
  expect(pendingMockTimers.size).toBe(0);
});

class MockWebSocket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  url: string;
  protocol: string | string[];
  binaryType: 'blob' | 'arraybuffer' = 'arraybuffer';

  constructor(url: string, protocols?: string | string[]) {
    super();
    this.url = url;
    this.protocol = protocols || '';

    // Simulate connection opening
    deferMockEvent(() => {
      this.readyState = MockWebSocket.OPEN;
      this.dispatchEvent(new Event('open'));
    }, 10);
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    // Store sent data for verification
    (this as any)._sentData = data;
  }

  close(code?: number, reason?: string): void {
    this.readyState = MockWebSocket.CLOSING;
    deferMockEvent(() => {
      this.readyState = MockWebSocket.CLOSED;
      this.dispatchEvent(new CloseEvent('close', { code: code || 1000, reason: reason || '' }));
    }, 10);
  }
}

// Replace global WebSocket with mock
(globalThis as any).WebSocket = MockWebSocket;

describe('WebSocketConnection', () => {
  let connection: WebSocketConnection;
  const testUrl = 'ws://localhost:8080/netron';

  beforeEach(() => {
    connection = new WebSocketConnection(testUrl, {
      reconnect: false, // Disable reconnection for tests
      keepAliveInterval: 0, // Disable keep-alive for tests
    });
  });

  afterEach(async () => {
    if (connection) {
      await connection.close();
    }
    // Last, so the timer `close()` just scheduled is cancelled too.
    clearPendingMockTimers();
  });

  it('should create connection with correct URL', () => {
    expect(connection.url).toBe(testUrl);
    expect(connection.state).toBe(ConnectionState.DISCONNECTED);
  });

  it('should connect to WebSocket server', async () => {
    const connectPromise = connection.connect();

    expect(connection.state).toBe(ConnectionState.CONNECTING);

    await connectPromise;

    expect(connection.state).toBe(ConnectionState.CONNECTED);
    expect(connection.isConnected).toBe(true);
  });

  it('should emit connect event', async () => {
    const connectHandler = vi.fn();
    connection.on('connect', connectHandler);

    await connection.connect();

    expect(connectHandler).toHaveBeenCalledTimes(1);
  });

  it('should send packets', async () => {
    await connection.connect();

    const packet = new Packet(123);
    packet.setImpulse(1);
    packet.setType(TYPE_CALL);
    packet.data = { method: 'test', args: [] };

    await connection.send(packet);

    // Verify packet was sent (mock WebSocket stores it)
    const ws = (connection as any).ws;
    expect(ws._sentData).toBeDefined();
  });

  it('should close connection', async () => {
    await connection.connect();

    const disconnectHandler = vi.fn();
    connection.on('disconnect', disconnectHandler);

    await connection.close();

    expect(connection.state).toBe(ConnectionState.DISCONNECTED);
    expect(connection.isConnected).toBe(false);
    expect(disconnectHandler).toHaveBeenCalledTimes(1);
  });

  it('should get connection metrics', async () => {
    await connection.connect();

    const metrics = connection.getMetrics();

    expect(metrics).toBeDefined();
    expect(metrics.id).toBeDefined();
    expect(metrics.url).toBe(testUrl);
    expect(metrics.state).toBe(ConnectionState.CONNECTED);
  });
});

describe('WebSocketPeer', () => {
  let peer: WebSocketPeer;
  const testUrl = 'ws://localhost:8080/netron';

  beforeEach(() => {
    peer = new WebSocketPeer(testUrl, {
      reconnect: false, // Disable reconnection for tests
      keepAliveInterval: 0, // Disable keep-alive for tests
    });
  });

  afterEach(async () => {
    if (peer) {
      await peer.close();
    }
    // Last, so the timer `close()` just scheduled is cancelled too.
    clearPendingMockTimers();
  });

  it('should create peer with correct ID', () => {
    expect(peer.id).toContain('ws-peer-');
    expect(peer.isConnected).toBe(false);
  });

  it('should connect to server', async () => {
    await peer.connect();

    expect(peer.isConnected).toBe(true);
    expect(peer.connectionState).toBe(ConnectionState.CONNECTED);
  });

  it('should initialize peer', async () => {
    await peer.init();

    expect(peer.isConnected).toBe(true);
  });

  it('should close peer connection', async () => {
    await peer.connect();

    await peer.close();

    expect(peer.isConnected).toBe(false);
  });

  it('should get connection metrics', async () => {
    await peer.connect();

    const metrics = peer.getMetrics();

    expect(metrics).toBeDefined();
    expect(metrics.url).toBe(testUrl);
    expect(metrics.state).toBe(ConnectionState.CONNECTED);
  });
});

describe('WebSocket Reconnection', () => {
  it('should queue messages during disconnection', async () => {
    const connection = new WebSocketConnection('ws://localhost:8080/netron', {
      queueMessages: true,
      maxQueueSize: 10,
      reconnect: false,
    });

    const packet = new Packet(123);
    packet.setImpulse(1);
    packet.setType(TYPE_CALL);
    packet.data = { method: 'test' };

    // Send packet before connection is established
    await connection.send(packet);

    // Message should be queued
    const metrics = connection.getMetrics();
    expect(metrics.queuedMessages).toBeGreaterThan(0);

    await connection.close();
  });

  it('should respect connection timeout', async () => {
    // Create a mock that never opens
    const originalWebSocket = (globalThis as any).WebSocket;
    (globalThis as any).WebSocket = class extends EventTarget {
      readyState = 0;
      url: string;
      binaryType: 'blob' | 'arraybuffer' = 'arraybuffer';

      constructor(url: string) {
        super();
        this.url = url;
        // Never emit 'open' event
      }

      send() {}
      close() {
        this.readyState = 3; // CLOSED
        deferMockEvent(() => {
          this.dispatchEvent(new CloseEvent('close', { code: 1000, reason: 'timeout' }));
        }, 10);
      }
    };

    const connection = new WebSocketConnection('ws://localhost:8080/netron', {
      connectTimeout: 100, // Short timeout
    });

    await expect(connection.connect()).rejects.toThrow();

    // Restore original WebSocket
    (globalThis as any).WebSocket = originalWebSocket;

    await connection.close();
    // This test builds its own mock rather than using MockWebSocket, and it is
    // the one whose close-timer was seen firing after the environment was gone.
    clearPendingMockTimers();
  }, 1000); // Set test timeout to 1 second
});
