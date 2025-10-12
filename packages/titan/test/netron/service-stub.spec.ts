/**
 * Tests for ServiceStub
 */

import { WebSocket } from 'ws';
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { Netron } from '../../src/netron/netron.js';
import { RemotePeer } from '../../src/netron/remote-peer.js';
import { createMockLogger } from './test-utils.js';
import { Service, Public } from '../../src/decorators/core.js';

describe('ServiceStub', () => {
  let netron: Netron;
  let remotePeer: RemotePeer;

  beforeEach(async () => {
    netron = await Netron.create(createMockLogger(), { id: 'test-netron-stub' });

    const mockSocket = {
      readyState: WebSocket.OPEN,
      send: jest.fn((data: any, opts: any, cb?: (err?: Error) => void) => {
        if (cb) cb();
      }),
      on: jest.fn(),
      close: jest.fn(),
    } as unknown as WebSocket;

    remotePeer = new RemotePeer(mockSocket, netron, 'remote-peer-id');
  });

  afterEach(async () => {
    if (netron) {
      await netron.stop();
    }
  });

  describe('AsyncGenerator handling', () => {
    it('should handle AsyncGenerator with no callerPeer by finding first remote peer', async () => {
      @Service('AsyncGenService@1.0.0')
      class AsyncGenService {
        @Public()
        async *generateData() {
          yield 1;
          yield 2;
          yield 3;
        }
      }

      const service = new AsyncGenService();
      await netron.peer.exposeService(service);

      // Add remote peer to netron.peers
      netron.peers.set(remotePeer.id, remotePeer);

      const stub = netron.services.get('AsyncGenService@1.0.0');
      expect(stub).toBeDefined();

      // Call method without callerPeer - should find remotePeer automatically
      const result = await stub!.call('generateData', [], undefined);

      // Should return a StreamReference since it found a remote peer
      expect(result).toBeDefined();
      expect(result).toHaveProperty('streamId');
    });

    it('should return AsyncGenerator as-is when no remote peer exists', async () => {
      @Service('AsyncGenNoRemote@1.0.0')
      class AsyncGenNoRemote {
        @Public()
        async *generateData() {
          yield 'a';
          yield 'b';
        }
      }

      const service = new AsyncGenNoRemote();
      await netron.peer.exposeService(service);

      const stub = netron.services.get('AsyncGenNoRemote@1.0.0');
      expect(stub).toBeDefined();

      // Call without callerPeer and no remote peers available
      const result = await stub!.call('generateData', [], undefined);

      // Should return the generator as-is
      expect(result).toBeDefined();
      expect(typeof result[Symbol.asyncIterator]).toBe('function');
    });

    it('should create stream for AsyncGenerator when remote peer exists', async () => {
      @Service('AsyncGenStream@1.0.0')
      class AsyncGenStream {
        @Public()
        async *streamData() {
          yield 1;
          yield 2;
        }
      }

      const service = new AsyncGenStream();
      await netron.peer.exposeService(service);

      netron.peers.set(remotePeer.id, remotePeer);

      const stub = netron.services.get('AsyncGenStream@1.0.0');

      const result = await stub!.call('streamData', [], undefined);

      // Should create a StreamReference since remote peer is available
      expect(result).toBeDefined();
      expect(result).toHaveProperty('streamId');
      expect(result).toHaveProperty('peerId');
    });
  });

  describe('Result processing', () => {
    it('should convert NetronStream results to StreamReference', async () => {
      // Create a mock NetronStream-like object
      const mockStream = {
        _isNetronStream: true,
        streamId: 'test-stream-123',
        peerId: 'test-peer',
        pipe: jest.fn(),
      };

      @Service('StreamService@1.0.0')
      class StreamService {
        @Public()
        getStream() {
          return mockStream;
        }
      }

      const service = new StreamService();
      await netron.peer.exposeService(service);

      const stub = netron.services.get('StreamService@1.0.0');
      const result = await stub!.call('getStream', [], remotePeer);

      // Should convert stream to StreamReference
      expect(result).toHaveProperty('streamId');
      expect(result).toHaveProperty('peerId');
    });
  });

  describe('Argument processing', () => {
    it('should convert StreamReference arguments to NetronStream', async () => {
      const streamRef = {
        _isNetronStreamReference: true,
        streamId: 'ref-stream-123',
        peerId: remotePeer.id,
      };

      @Service('StreamConsumer@1.0.0')
      class StreamConsumer {
        @Public()
        consumeStream(stream: any) {
          return { received: stream !== undefined };
        }
      }

      const service = new StreamConsumer();
      await netron.peer.exposeService(service);

      // Add remote peer to netron.peers so StreamReference.to can find it
      netron.peers.set(remotePeer.id, remotePeer);

      const stub = netron.services.get('StreamConsumer@1.0.0');
      const result = await stub!.call('consumeStream', [streamRef], remotePeer);

      expect(result).toEqual({ received: true });
    });
  });
});
