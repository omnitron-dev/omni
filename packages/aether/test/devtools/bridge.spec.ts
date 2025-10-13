/**
 * Bridge Tests - DevTools Bridge Tests
 *
 * Comprehensive test coverage for the DevTools bridge communication,
 * including connection, message sending/receiving, and heartbeat mechanism.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createBridge, isDevToolsAvailable } from '../../src/devtools/bridge.js';
import type { Bridge, DevToolsMessage } from '../../src/devtools/types.js';

// Mock window.postMessage and addEventListener
const mockPostMessage = vi.fn();
const mockAddEventListener = vi.fn();
const mockRemoveEventListener = vi.fn();

describe('DevTools Bridge', () => {
  let bridge: Bridge;

  beforeEach(() => {
    // Setup window mock
    global.window = {
      postMessage: mockPostMessage,
      addEventListener: mockAddEventListener,
      removeEventListener: mockRemoveEventListener,
    } as any;

    bridge = createBridge();
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    bridge.disconnect();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('Connection', () => {
    it('should send handshake on connect', async () => {
      const connectPromise = bridge.connect();

      // Verify handshake was sent
      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          source: '__AETHER_DEVTOOLS_HANDSHAKE__',
          type: 'app-ready',
        }),
        '*'
      );

      // Simulate handshake response
      const handshakeHandler = mockAddEventListener.mock.calls.find(
        call => call[0] === 'message'
      )?.[1];

      handshakeHandler?.({
        data: {
          source: '__AETHER_DEVTOOLS_HANDSHAKE__',
          type: 'extension-ready',
        },
      });

      await connectPromise;

      expect(bridge.isConnected()).toBe(true);
    });

    it('should timeout if handshake not received', async () => {
      const connectPromise = bridge.connect();

      // Fast-forward past timeout
      vi.advanceTimersByTime(5000);

      await expect(connectPromise).rejects.toThrow('Handshake timeout');
    });

    it('should setup message listener after connection', async () => {
      const connectPromise = bridge.connect();

      // Simulate handshake response
      const handshakeHandler = mockAddEventListener.mock.calls.find(
        call => call[0] === 'message'
      )?.[1];

      handshakeHandler?.({
        data: {
          source: '__AETHER_DEVTOOLS_HANDSHAKE__',
          type: 'extension-ready',
        },
      });

      await connectPromise;

      // Should have message listener registered
      const messageListeners = mockAddEventListener.mock.calls.filter(
        call => call[0] === 'message'
      );
      expect(messageListeners.length).toBeGreaterThan(0);
    });

    it('should start heartbeat after connection', async () => {
      const connectPromise = bridge.connect();

      // Simulate handshake response
      const handshakeHandler = mockAddEventListener.mock.calls.find(
        call => call[0] === 'message'
      )?.[1];

      handshakeHandler?.({
        data: {
          source: '__AETHER_DEVTOOLS_HANDSHAKE__',
          type: 'extension-ready',
        },
      });

      await connectPromise;

      mockPostMessage.mockClear();

      // Fast-forward to heartbeat interval
      vi.advanceTimersByTime(10000);

      // Should have sent ping
      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.objectContaining({
            type: 'ping',
          }),
        }),
        '*'
      );
    });

    it('should not double-connect', async () => {
      const connectPromise1 = bridge.connect();

      const handshakeHandler = mockAddEventListener.mock.calls.find(
        call => call[0] === 'message'
      )?.[1];

      handshakeHandler?.({
        data: {
          source: '__AETHER_DEVTOOLS_HANDSHAKE__',
          type: 'extension-ready',
        },
      });

      await connectPromise1;

      mockPostMessage.mockClear();

      // Try to connect again
      await bridge.connect();

      // Should not send another handshake
      expect(mockPostMessage).not.toHaveBeenCalled();
    });

    it('should throw when connecting without window', async () => {
      (global as any).window = undefined;

      const newBridge = createBridge();

      await expect(newBridge.connect()).rejects.toThrow('browser environment');
    });
  });

  describe('Disconnection', () => {
    it('should disconnect from extension', async () => {
      const connectPromise = bridge.connect();

      const handshakeHandler = mockAddEventListener.mock.calls.find(
        call => call[0] === 'message'
      )?.[1];

      handshakeHandler?.({
        data: {
          source: '__AETHER_DEVTOOLS_HANDSHAKE__',
          type: 'extension-ready',
        },
      });

      await connectPromise;

      bridge.disconnect();

      expect(bridge.isConnected()).toBe(false);
    });

    it('should stop heartbeat on disconnect', async () => {
      const connectPromise = bridge.connect();

      const handshakeHandler = mockAddEventListener.mock.calls.find(
        call => call[0] === 'message'
      )?.[1];

      handshakeHandler?.({
        data: {
          source: '__AETHER_DEVTOOLS_HANDSHAKE__',
          type: 'extension-ready',
        },
      });

      await connectPromise;

      bridge.disconnect();

      mockPostMessage.mockClear();

      // Advance time - should not send heartbeat
      vi.advanceTimersByTime(10000);

      expect(mockPostMessage).not.toHaveBeenCalled();
    });

    it('should remove message listener on disconnect', async () => {
      const connectPromise = bridge.connect();

      const handshakeHandler = mockAddEventListener.mock.calls.find(
        call => call[0] === 'message'
      )?.[1];

      handshakeHandler?.({
        data: {
          source: '__AETHER_DEVTOOLS_HANDSHAKE__',
          type: 'extension-ready',
        },
      });

      await connectPromise;

      bridge.disconnect();

      expect(mockRemoveEventListener).toHaveBeenCalledWith(
        'message',
        expect.any(Function)
      );
    });

    it('should handle disconnect when not connected', () => {
      expect(() => bridge.disconnect()).not.toThrow();
    });
  });

  describe('Message Sending', () => {
    it('should send message when connected', async () => {
      const connectPromise = bridge.connect();

      const handshakeHandler = mockAddEventListener.mock.calls.find(
        call => call[0] === 'message'
      )?.[1];

      handshakeHandler?.({
        data: {
          source: '__AETHER_DEVTOOLS_HANDSHAKE__',
          type: 'extension-ready',
        },
      });

      await connectPromise;

      mockPostMessage.mockClear();

      const message: DevToolsMessage = {
        type: 'state-update',
        timestamp: Date.now(),
        payload: { test: 'data' },
      };

      bridge.send(message);

      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          source: '__AETHER_DEVTOOLS__',
          message: expect.objectContaining({
            type: 'state-update',
          }),
        }),
        '*'
      );
    });

    it('should queue messages when not connected', () => {
      const message: DevToolsMessage = {
        type: 'state-update',
        timestamp: Date.now(),
        payload: { test: 'data' },
      };

      bridge.send(message);

      // Should not throw
      expect(mockPostMessage).not.toHaveBeenCalled();
    });

    it('should flush queued messages on connect', async () => {
      const message1: DevToolsMessage = {
        type: 'state-update',
        timestamp: Date.now(),
        payload: { test: '1' },
      };

      const message2: DevToolsMessage = {
        type: 'state-update',
        timestamp: Date.now(),
        payload: { test: '2' },
      };

      bridge.send(message1);
      bridge.send(message2);

      mockPostMessage.mockClear();

      const connectPromise = bridge.connect();

      const handshakeHandler = mockAddEventListener.mock.calls.find(
        call => call[0] === 'message'
      )?.[1];

      handshakeHandler?.({
        data: {
          source: '__AETHER_DEVTOOLS_HANDSHAKE__',
          type: 'extension-ready',
        },
      });

      await connectPromise;

      // Should have sent both queued messages
      const messageCalls = mockPostMessage.mock.calls.filter(
        call => call[0].source === '__AETHER_DEVTOOLS__'
      );

      expect(messageCalls.length).toBe(2);
    });

    it('should serialize messages safely', async () => {
      const connectPromise = bridge.connect();

      const handshakeHandler = mockAddEventListener.mock.calls.find(
        call => call[0] === 'message'
      )?.[1];

      handshakeHandler?.({
        data: {
          source: '__AETHER_DEVTOOLS_HANDSHAKE__',
          type: 'extension-ready',
        },
      });

      await connectPromise;

      mockPostMessage.mockClear();

      const circular: any = { a: 1 };
      circular.self = circular;

      const message: DevToolsMessage = {
        type: 'state-update',
        timestamp: Date.now(),
        payload: circular,
      };

      // Should not throw
      expect(() => bridge.send(message)).not.toThrow();
    });

    it('should handle serialization errors', async () => {
      const connectPromise = bridge.connect();

      const handshakeHandler = mockAddEventListener.mock.calls.find(
        call => call[0] === 'message'
      )?.[1];

      handshakeHandler?.({
        data: {
          source: '__AETHER_DEVTOOLS_HANDSHAKE__',
          type: 'extension-ready',
        },
      });

      await connectPromise;

      mockPostMessage.mockClear();

      const unserializable: any = {};
      Object.defineProperty(unserializable, 'bad', {
        get() {
          throw new Error('Cannot serialize');
        },
      });

      const message: DevToolsMessage = {
        type: 'state-update',
        timestamp: Date.now(),
        payload: unserializable,
      };

      // Should send error message instead
      bridge.send(message);

      expect(mockPostMessage).toHaveBeenCalled();
    });
  });

  describe('Message Receiving', () => {
    it('should receive messages from extension', async () => {
      const connectPromise = bridge.connect();

      const handshakeHandler = mockAddEventListener.mock.calls.find(
        call => call[0] === 'message'
      )?.[1];

      handshakeHandler?.({
        data: {
          source: '__AETHER_DEVTOOLS_HANDSHAKE__',
          type: 'extension-ready',
        },
      });

      await connectPromise;

      const handler = vi.fn();
      bridge.receive(handler);

      // Get the message listener
      const messageListeners = mockAddEventListener.mock.calls.filter(
        call => call[0] === 'message'
      );
      const messageHandler = messageListeners[messageListeners.length - 1]?.[1];

      // Simulate incoming message
      const incomingMessage: DevToolsMessage = {
        type: 'time-travel',
        timestamp: Date.now(),
        payload: { action: 'undo' },
      };

      messageHandler?.({
        data: {
          source: '__AETHER_DEVTOOLS__',
          message: incomingMessage,
        },
      });

      expect(handler).toHaveBeenCalledWith(incomingMessage);
    });

    it('should respond to ping messages', async () => {
      const connectPromise = bridge.connect();

      const handshakeHandler = mockAddEventListener.mock.calls.find(
        call => call[0] === 'message'
      )?.[1];

      handshakeHandler?.({
        data: {
          source: '__AETHER_DEVTOOLS_HANDSHAKE__',
          type: 'extension-ready',
        },
      });

      await connectPromise;

      const messageListeners = mockAddEventListener.mock.calls.filter(
        call => call[0] === 'message'
      );
      const messageHandler = messageListeners[messageListeners.length - 1]?.[1];

      mockPostMessage.mockClear();

      // Send ping
      messageHandler?.({
        data: {
          source: '__AETHER_DEVTOOLS__',
          message: {
            type: 'ping',
            timestamp: Date.now(),
          },
        },
      });

      // Should respond with pong
      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.objectContaining({
            type: 'pong',
          }),
        }),
        '*'
      );
    });

    it('should ignore messages from wrong source', async () => {
      const connectPromise = bridge.connect();

      const handshakeHandler = mockAddEventListener.mock.calls.find(
        call => call[0] === 'message'
      )?.[1];

      handshakeHandler?.({
        data: {
          source: '__AETHER_DEVTOOLS_HANDSHAKE__',
          type: 'extension-ready',
        },
      });

      await connectPromise;

      const handler = vi.fn();
      bridge.receive(handler);

      const messageListeners = mockAddEventListener.mock.calls.filter(
        call => call[0] === 'message'
      );
      const messageHandler = messageListeners[messageListeners.length - 1]?.[1];

      // Send message from wrong source
      messageHandler?.({
        data: {
          source: 'WRONG_SOURCE',
          message: { type: 'test', timestamp: Date.now() },
        },
      });

      expect(handler).not.toHaveBeenCalled();
    });

    it('should unsubscribe handler', async () => {
      const connectPromise = bridge.connect();

      const handshakeHandler = mockAddEventListener.mock.calls.find(
        call => call[0] === 'message'
      )?.[1];

      handshakeHandler?.({
        data: {
          source: '__AETHER_DEVTOOLS_HANDSHAKE__',
          type: 'extension-ready',
        },
      });

      await connectPromise;

      const handler = vi.fn();
      const unsubscribe = bridge.receive(handler);

      unsubscribe();

      const messageListeners = mockAddEventListener.mock.calls.filter(
        call => call[0] === 'message'
      );
      const messageHandler = messageListeners[messageListeners.length - 1]?.[1];

      messageHandler?.({
        data: {
          source: '__AETHER_DEVTOOLS__',
          message: { type: 'test', timestamp: Date.now() },
        },
      });

      expect(handler).not.toHaveBeenCalled();
    });

    it('should handle multiple handlers', async () => {
      const connectPromise = bridge.connect();

      const handshakeHandler = mockAddEventListener.mock.calls.find(
        call => call[0] === 'message'
      )?.[1];

      handshakeHandler?.({
        data: {
          source: '__AETHER_DEVTOOLS_HANDSHAKE__',
          type: 'extension-ready',
        },
      });

      await connectPromise;

      const handler1 = vi.fn();
      const handler2 = vi.fn();

      bridge.receive(handler1);
      bridge.receive(handler2);

      const messageListeners = mockAddEventListener.mock.calls.filter(
        call => call[0] === 'message'
      );
      const messageHandler = messageListeners[messageListeners.length - 1]?.[1];

      const message: DevToolsMessage = {
        type: 'state-update',
        timestamp: Date.now(),
      };

      messageHandler?.({
        data: {
          source: '__AETHER_DEVTOOLS__',
          message,
        },
      });

      expect(handler1).toHaveBeenCalledWith(message);
      expect(handler2).toHaveBeenCalledWith(message);
    });

    it('should handle handler errors gracefully', async () => {
      const connectPromise = bridge.connect();

      const handshakeHandler = mockAddEventListener.mock.calls.find(
        call => call[0] === 'message'
      )?.[1];

      handshakeHandler?.({
        data: {
          source: '__AETHER_DEVTOOLS_HANDSHAKE__',
          type: 'extension-ready',
        },
      });

      await connectPromise;

      const errorHandler = vi.fn(() => {
        throw new Error('Handler error');
      });
      const goodHandler = vi.fn();

      bridge.receive(errorHandler);
      bridge.receive(goodHandler);

      const messageListeners = mockAddEventListener.mock.calls.filter(
        call => call[0] === 'message'
      );
      const messageHandler = messageListeners[messageListeners.length - 1]?.[1];

      const message: DevToolsMessage = {
        type: 'state-update',
        timestamp: Date.now(),
      };

      // Should not throw
      expect(() => {
        messageHandler?.({
          data: {
            source: '__AETHER_DEVTOOLS__',
            message,
          },
        });
      }).not.toThrow();

      // Good handler should still be called
      expect(goodHandler).toHaveBeenCalled();
    });
  });

  describe('Connection Status', () => {
    it('should return false when not connected', () => {
      expect(bridge.isConnected()).toBe(false);
    });

    it('should return true when connected', async () => {
      const connectPromise = bridge.connect();

      const handshakeHandler = mockAddEventListener.mock.calls.find(
        call => call[0] === 'message'
      )?.[1];

      handshakeHandler?.({
        data: {
          source: '__AETHER_DEVTOOLS_HANDSHAKE__',
          type: 'extension-ready',
        },
      });

      await connectPromise;

      expect(bridge.isConnected()).toBe(true);
    });

    it('should return false after disconnect', async () => {
      const connectPromise = bridge.connect();

      const handshakeHandler = mockAddEventListener.mock.calls.find(
        call => call[0] === 'message'
      )?.[1];

      handshakeHandler?.({
        data: {
          source: '__AETHER_DEVTOOLS_HANDSHAKE__',
          type: 'extension-ready',
        },
      });

      await connectPromise;

      bridge.disconnect();

      expect(bridge.isConnected()).toBe(false);
    });
  });

  describe('DevTools Availability Check', () => {
    it('should detect DevTools extension', () => {
      (global.window as any).__AETHER_DEVTOOLS_EXTENSION__ = true;

      expect(isDevToolsAvailable()).toBe(true);
    });

    it('should return false when extension not available', () => {
      delete (global.window as any).__AETHER_DEVTOOLS_EXTENSION__;

      expect(isDevToolsAvailable()).toBe(false);
    });

    it('should return false when window is undefined', () => {
      (global as any).window = undefined;

      expect(isDevToolsAvailable()).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle malformed messages', async () => {
      const connectPromise = bridge.connect();

      const handshakeHandler = mockAddEventListener.mock.calls.find(
        call => call[0] === 'message'
      )?.[1];

      handshakeHandler?.({
        data: {
          source: '__AETHER_DEVTOOLS_HANDSHAKE__',
          type: 'extension-ready',
        },
      });

      await connectPromise;

      const handler = vi.fn();
      bridge.receive(handler);

      const messageListeners = mockAddEventListener.mock.calls.filter(
        call => call[0] === 'message'
      );
      const messageHandler = messageListeners[messageListeners.length - 1]?.[1];

      // Send malformed message
      messageHandler?.({
        data: {
          source: '__AETHER_DEVTOOLS__',
          message: null,
        },
      });

      expect(handler).not.toHaveBeenCalled();
    });

    it('should handle messages without type', async () => {
      const connectPromise = bridge.connect();

      const handshakeHandler = mockAddEventListener.mock.calls.find(
        call => call[0] === 'message'
      )?.[1];

      handshakeHandler?.({
        data: {
          source: '__AETHER_DEVTOOLS_HANDSHAKE__',
          type: 'extension-ready',
        },
      });

      await connectPromise;

      const handler = vi.fn();
      bridge.receive(handler);

      const messageListeners = mockAddEventListener.mock.calls.filter(
        call => call[0] === 'message'
      );
      const messageHandler = messageListeners[messageListeners.length - 1]?.[1];

      messageHandler?.({
        data: {
          source: '__AETHER_DEVTOOLS__',
          message: { timestamp: Date.now() },
        },
      });

      expect(handler).not.toHaveBeenCalled();
    });

    it('should handle cleanup with queued messages', () => {
      bridge.send({ type: 'state-update', timestamp: Date.now() });
      bridge.send({ type: 'state-update', timestamp: Date.now() });

      expect(() => bridge.disconnect()).not.toThrow();
    });
  });
});
