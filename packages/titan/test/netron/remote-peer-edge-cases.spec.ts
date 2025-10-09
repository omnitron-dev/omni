/**
 * Edge case tests for RemotePeer
 */

import { WebSocket } from 'ws';
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { delay } from '@omnitron-dev/common';
import { Netron } from '../../src/netron/netron.js';
import { RemotePeer } from '../../src/netron/remote-peer.js';
import { createMockLogger, createNetronServer, createNetronClient } from './test-utils.js';
import { Packet, createPacket, TYPE_STREAM } from '../../src/netron/packet/index.js';

describe('RemotePeer Edge Cases', () => {
  let netron: Netron;

  beforeEach(async () => {
    netron = await createNetronServer({
      port: 8081,
      logger: createMockLogger()
    });
    await netron.start();
  });

  afterEach(async () => {
    await netron.stop();
  });

  describe('exposeService errors', () => {
    it('should throw error when exposing service without @Service decorator', async () => {
      const n2 = await createNetronClient();
      const peer = await n2.connect('ws://localhost:8081');

      class InvalidService {
        method() {
          return 'test';
        }
      }

      const service = new InvalidService();

      await expect(peer.exposeService(service)).rejects.toThrow('Invalid service');

      await peer.disconnect();
      await n2.stop();
    });

    // Note: Line 186 check for duplicate service names is hard to trigger via normal API
    // because it requires the remote peer's services map to already have the service,
    // which happens during init() from abilities, not from exposeService() calls.
    // The local peer's serviceInstances check handles duplicate instance exposure.
  });

  describe('get/set/call with invalid definition ID', () => {
    it('should throw error when calling get() with unknown definition ID', async () => {
      const n2 = await createNetronClient();
      const peer = await n2.connect('ws://localhost:8081');

      expect(() => peer.get('unknown-def-id', 'someProperty')).toThrow(/Definition.*not found/);

      await peer.disconnect();
      await n2.stop();
    });

    it('should throw error when calling set() with unknown definition ID', async () => {
      const n2 = await createNetronClient();
      const peer = await n2.connect('ws://localhost:8081');

      expect(() => peer.set('unknown-def-id', 'someProperty', 'value')).toThrow(/Definition.*not found/);

      await peer.disconnect();
      await n2.stop();
    });

    it('should throw error when calling call() with unknown definition ID', async () => {
      const n2 = await createNetronClient();
      const peer = await n2.connect('ws://localhost:8081');

      expect(() => peer.call('unknown-def-id', 'someMethod', [])).toThrow(/Definition.*not found/);

      await peer.disconnect();
      await n2.stop();
    });
  });

  describe('Packet handling errors', () => {
    it('should handle malformed binary packet gracefully', async () => {
      const mockSocket = {
        readyState: WebSocket.OPEN,
        send: jest.fn((data: any, opts: any, cb?: (err?: Error) => void) => {
          if (cb) cb();
        }),
        on: jest.fn(),
        close: jest.fn(),
      } as unknown as WebSocket;

      const remotePeer = new RemotePeer(mockSocket, netron, 'test-peer');

      // Initialize the peer to set up message handler
      await remotePeer.init(false);

      const messageHandler = (mockSocket.on as jest.Mock<any>).mock.calls.find(
        (call) => call[0] === 'message'
      )?.[1];

      expect(messageHandler).toBeDefined();

      // Send malformed binary data that will fail decoding
      const malformedData = new ArrayBuffer(5);
      const view = new Uint8Array(malformedData);
      view.set([0xff, 0xff, 0xff, 0xff, 0xff]);

      // Should not throw - error is logged internally
      messageHandler(malformedData, true);
    });

    it('should warn when receiving non-binary message', async () => {
      const mockSocket = {
        readyState: WebSocket.OPEN,
        send: jest.fn((data: any, opts: any, cb?: (err?: Error) => void) => {
          if (cb) cb();
        }),
        on: jest.fn(),
        close: jest.fn(),
      } as unknown as WebSocket;

      const remotePeer = new RemotePeer(mockSocket, netron, 'test-peer');

      // Initialize the peer to set up message handler
      await remotePeer.init(false);

      const messageHandler = (mockSocket.on as jest.Mock<any>).mock.calls.find(
        (call) => call[0] === 'message'
      )?.[1];

      expect(messageHandler).toBeDefined();

      // Send non-binary message
      messageHandler('text message', false);
    });

    it('should handle STREAM packet without streamId', async () => {
      const mockSocket = {
        readyState: WebSocket.OPEN,
        send: jest.fn((data: any, opts: any, cb?: (err?: Error) => void) => {
          if (cb) cb();
        }),
        on: jest.fn(),
        close: jest.fn(),
      } as unknown as WebSocket;

      const remotePeer = new RemotePeer(mockSocket, netron, 'test-peer');

      // Create a stream packet without streamId
      const packet = createPacket(Packet.nextId(), 1, TYPE_STREAM, { some: 'data' });
      packet.streamId = 0; // No streamId

      await remotePeer.handlePacket(packet);

      // Should not throw - warning is logged
    });

    it('should handle unknown packet type', async () => {
      const mockSocket = {
        readyState: WebSocket.OPEN,
        send: jest.fn((data: any, opts: any, cb?: (err?: Error) => void) => {
          if (cb) cb();
        }),
        on: jest.fn(),
        close: jest.fn(),
      } as unknown as WebSocket;

      const remotePeer = new RemotePeer(mockSocket, netron, 'test-peer');

      // Create packet with unknown type (255 is not a valid type)
      const packet = createPacket(Packet.nextId(), 1, 255 as any, {});

      await remotePeer.handlePacket(packet);

      // Should not throw - warning is logged
    });
  });

  describe('Unsubscribe edge cases', () => {
    it('should call unsubscribe task when last handler is removed', async () => {
      const n2 = await Netron.create(createMockLogger(), {
        allowServiceEvents: true,
      });
      const peer = await n2.connect('ws://localhost:8081');

      const handler1 = jest.fn();
      const handler2 = jest.fn();

      // Subscribe with two handlers
      await peer.subscribe('test-event', handler1);
      await peer.subscribe('test-event', handler2);

      expect(peer.eventSubscribers.get('test-event')).toHaveLength(2);

      // Unsubscribe first handler - should NOT call unsubscribe task
      await peer.unsubscribe('test-event', handler1);
      expect(peer.eventSubscribers.get('test-event')).toHaveLength(1);

      // Unsubscribe last handler - should call unsubscribe task
      await peer.unsubscribe('test-event', handler2);
      expect(peer.eventSubscribers.get('test-event')).toBeUndefined();

      await peer.disconnect();
      await n2.stop();
    });

    it('should handle unsubscribe for non-existent event', async () => {
      const n2 = await createNetronClient();
      const peer = await n2.connect('ws://localhost:8081');

      const handler = jest.fn();

      // Should not throw when unsubscribing from non-existent event
      await peer.unsubscribe('non-existent-event', handler);

      await peer.disconnect();
      await n2.stop();
    });

    it('should handle unsubscribe for non-existent handler', async () => {
      const n2 = await createNetronClient();
      const peer = await n2.connect('ws://localhost:8081');

      const handler1 = jest.fn();
      const handler2 = jest.fn();

      await peer.subscribe('test-event', handler1);

      // Should not throw when unsubscribing non-existent handler
      await peer.unsubscribe('test-event', handler2);

      expect(peer.eventSubscribers.get('test-event')).toHaveLength(1);

      await peer.disconnect();
      await n2.stop();
    });
  });

  // Lines 230-231 and 245-252 (unexposeService cleanup) are covered by existing remote-peer.spec.ts tests

  describe('disconnect edge cases', () => {
    it('should handle disconnect when socket is already closed', async () => {
      const mockSocket = {
        readyState: WebSocket.CLOSED, // Already closed
        send: jest.fn(),
        on: jest.fn(),
        close: jest.fn(),
      } as unknown as WebSocket;

      const remotePeer = new RemotePeer(mockSocket, netron, 'test-peer');

      // Should not throw
      await remotePeer.disconnect();

      expect(mockSocket.close).not.toHaveBeenCalled();
    });

    it('should await TransportAdapter close promise if available', async () => {
      let closeResolve: () => void;
      const closePromise = new Promise<void>((resolve) => {
        closeResolve = resolve;
      });

      const mockTransportAdapter = {
        readyState: 'OPEN',
        send: jest.fn(),
        on: jest.fn(),
        close: jest.fn(() => closePromise),
      };

      const remotePeer = new RemotePeer(mockTransportAdapter as any, netron, 'test-peer');

      const disconnectPromise = remotePeer.disconnect();

      // Should be waiting for close promise
      await delay(10);

      // Resolve close promise
      closeResolve!();

      // Should complete disconnect
      await disconnectPromise;

      expect(mockTransportAdapter.close).toHaveBeenCalled();
    });
  });

  describe('getDefinitionById errors', () => {
    it('should throw error when getting definition by unknown ID', async () => {
      const n2 = await createNetronClient();
      const peer = await n2.connect('ws://localhost:8081');

      expect(() => (peer as any).getDefinitionById('unknown-id')).toThrow(/Definition.*not found/);

      await peer.disconnect();
      await n2.stop();
    });

    it('should throw error when getting definition by unknown service name', async () => {
      const n2 = await createNetronClient();
      const peer = await n2.connect('ws://localhost:8081');

      expect(() => (peer as any).getDefinitionByServiceName('unknown-service')).toThrow(/Service.*not found/);

      await peer.disconnect();
      await n2.stop();
    });
  });

  describe('sendPacket errors', () => {
    it('should reject when socket is closed', async () => {
      const mockSocket = {
        readyState: WebSocket.CLOSED,
        send: jest.fn(),
        on: jest.fn(),
        close: jest.fn(),
      } as unknown as WebSocket;

      const remotePeer = new RemotePeer(mockSocket, netron, 'test-peer');

      const packet = createPacket(Packet.nextId(), 1, 1, {});

      await expect(remotePeer.sendPacket(packet)).rejects.toThrow('Socket closed');
    });

    it('should handle socket send callback error', async () => {
      const sendError = new Error('Send failed');
      const mockSocket = {
        readyState: WebSocket.OPEN,
        send: jest.fn((data: any, opts: any, cb?: (err?: Error) => void) => {
          if (cb) cb(sendError);
        }),
        on: jest.fn(),
        close: jest.fn(),
      } as unknown as WebSocket;

      const remotePeer = new RemotePeer(mockSocket, netron, 'test-peer');

      const packet = createPacket(Packet.nextId(), 1, 1, {});

      await expect(remotePeer.sendPacket(packet)).rejects.toThrow('Send failed');
    });
  });

  // Lines 621-628, 638-645, 659-662 (SET/GET/CALL packet error handling) are covered
  // by existing tests in remote-peer.spec.ts that test error scenarios
});
