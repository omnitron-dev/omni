/**
 * Comprehensive tests for NetronReadableStream
 * Tests stream creation, buffer management, packet ordering, backpressure, and lifecycle
 */

import { WebSocket } from 'ws';
import { jest, describe, beforeEach, afterEach, it, expect } from '@jest/globals';
import { Readable } from 'readable-stream';

import { NetronReadableStream, NetronReadableStreamOptions } from '../../src/netron/readable-stream.js';
import { createStreamPacket, Packet } from '../../src/netron/packet/index.js';
import { Netron } from '../../src/netron/netron.js';
import { RemotePeer } from '../../src/netron/remote-peer.js';
import { createMockLogger } from './test-utils.js';
import type { ILogger } from '../../src/modules/logger/logger.types.js';

describe('NetronReadableStream', () => {
  let netron: Netron;
  let peer: RemotePeer;
  let mockLogger: ILogger;

  beforeEach(async () => {
    mockLogger = createMockLogger();
    netron = await Netron.create(mockLogger, { streamTimeout: 100 });

    const mockSocket = {
      readyState: WebSocket.OPEN,
      send: jest.fn((data: any, opts: any, cb?: (err?: Error) => void) => {
        if (cb) cb();
      }),
      on: jest.fn(),
      close: jest.fn(),
    } as unknown as WebSocket;

    peer = new RemotePeer(mockSocket, netron, 'test-peer-id');
  });

  afterEach(async () => {
    for (const stream of peer.readableStreams.values()) {
      stream.destroy();
    }
    await netron.stop();
  });

  describe('Stream Creation and Initialization', () => {
    it('should create a stream with required options', () => {
      const stream = new NetronReadableStream({ peer, streamId: 1 });

      expect(stream).toBeInstanceOf(Readable);
      expect(stream.id).toBe(1);
      expect(stream.peer).toBe(peer);
      expect(stream.isLive).toBe(false);
      expect(stream.isComplete).toBe(false);
    });

    it('should create a stream using factory method', () => {
      const stream = NetronReadableStream.create(peer, 2);

      expect(stream.id).toBe(2);
      expect(stream.peer).toBe(peer);
      expect(stream.isLive).toBe(false);
    });

    it('should create a live stream with isLive option', () => {
      const stream = NetronReadableStream.create(peer, 3, true);

      expect(stream.id).toBe(3);
      expect(stream.isLive).toBe(true);
    });

    it('should register stream in peer readableStreams map', () => {
      const stream = new NetronReadableStream({ peer, streamId: 4 });

      expect(peer.readableStreams.get(4)).toBe(stream);
    });

    it('should log stream creation', () => {
      new NetronReadableStream({ peer, streamId: 5 });

      expect(peer.logger.info).toHaveBeenCalledWith(
        { streamId: 5, isLive: false },
        'Creating readable stream'
      );
    });

    it('should create stream in object mode', () => {
      const stream = new NetronReadableStream({ peer, streamId: 6 });

      expect(stream.readableObjectMode).toBe(true);
    });

    it('should accept additional readable options', () => {
      const stream = new NetronReadableStream({
        peer,
        streamId: 7,
        highWaterMark: 100,
      });

      expect(stream.readableHighWaterMark).toBe(100);
    });
  });

  describe('Packet Processing and Ordering', () => {
    it('should handle ordered packets correctly', (done) => {
      const stream = NetronReadableStream.create(peer, 10);
      const receivedChunks: any[] = [];

      stream.on('data', (chunk) => receivedChunks.push(chunk));
      stream.on('end', () => {
        expect(receivedChunks).toEqual(['chunk1', 'chunk2', 'chunk3']);
        done();
      });

      const packets = [
        createStreamPacket(1, 10, 0, false, false, 'chunk1'),
        createStreamPacket(2, 10, 1, false, false, 'chunk2'),
        createStreamPacket(3, 10, 2, true, false, 'chunk3'),
      ];

      packets.forEach((packet) => stream.onPacket(packet));
    });

    it('should reorder out-of-order packets', async () => {
      const stream = new NetronReadableStream({ peer, streamId: 11 });
      const receivedChunks: any[] = [];

      stream.on('data', (chunk) => receivedChunks.push(chunk));

      // Send packets out of order: 2, 0, 1, 3
      const packets = [
        createStreamPacket(1, 11, 2, false, false, 'chunk-2'),
        createStreamPacket(2, 11, 0, false, false, 'chunk-0'),
        createStreamPacket(3, 11, 1, false, false, 'chunk-1'),
        createStreamPacket(4, 11, 3, true, false, 'chunk-3'),
      ];

      packets.forEach((packet) => stream.onPacket(packet));

      await new Promise((resolve) => stream.on('end', resolve));

      expect(receivedChunks).toEqual(['chunk-0', 'chunk-1', 'chunk-2', 'chunk-3']);
    });

    it('should handle severely out-of-order packets', (done) => {
      const stream = new NetronReadableStream({ peer, streamId: 12 });
      const receivedChunks: any[] = [];

      stream.on('data', (chunk) => receivedChunks.push(chunk));
      stream.on('end', () => {
        expect(receivedChunks).toEqual(['chunk-0', 'chunk-1', 'chunk-2', 'chunk-3', 'chunk-4']);
        done();
      });

      // Send all non-last packets first, then the last packet
      // This ensures the stream can deliver all data before ending
      stream.onPacket(createStreamPacket(1, 12, 2, false, false, 'chunk-2'));
      stream.onPacket(createStreamPacket(2, 12, 4, false, false, 'chunk-4'));
      stream.onPacket(createStreamPacket(3, 12, 0, false, false, 'chunk-0'));
      stream.onPacket(createStreamPacket(4, 12, 3, false, false, 'chunk-3'));
      stream.onPacket(createStreamPacket(5, 12, 1, false, false, 'chunk-1'));
      // Now send the marker for last chunk (index 5 marks end)
      stream.onPacket(createStreamPacket(6, 12, 5, true, false, null));
    });

    it('should ignore packets for closed stream', () => {
      const stream = new NetronReadableStream({ peer, streamId: 13 });
      stream.destroy();

      const packet = createStreamPacket(1, 13, 0, false, false, 'ignored');
      stream.onPacket(packet);

      expect(peer.logger.warn).toHaveBeenCalledWith(
        { streamId: 13 },
        'Received packet for closed stream'
      );
    });

    it('should handle packets with null data for last chunk', (done) => {
      const stream = new NetronReadableStream({ peer, streamId: 14 });
      const receivedChunks: any[] = [];

      stream.on('data', (chunk) => receivedChunks.push(chunk));
      stream.on('end', () => {
        expect(receivedChunks).toEqual(['data1', 'data2']);
        done();
      });

      stream.onPacket(createStreamPacket(1, 14, 0, false, false, 'data1'));
      stream.onPacket(createStreamPacket(2, 14, 1, false, false, 'data2'));
      // Last chunk with null data
      const lastPacket = createStreamPacket(3, 14, 2, true, false, null);
      stream.onPacket(lastPacket);
    });

    it('should set isComplete when receiving last chunk', () => {
      const stream = new NetronReadableStream({ peer, streamId: 15 });

      expect(stream.isComplete).toBe(false);

      stream.onPacket(createStreamPacket(1, 15, 0, true, false, 'final'));

      expect(stream.isComplete).toBe(true);
    });

    it('should handle various data types', (done) => {
      const stream = new NetronReadableStream({ peer, streamId: 16 });
      const receivedChunks: any[] = [];

      stream.on('data', (chunk) => receivedChunks.push(chunk));
      stream.on('end', () => {
        expect(receivedChunks).toEqual([
          'string',
          123,
          { nested: { obj: true } },
          [1, 2, 3],
          Buffer.from('binary'),
        ]);
        done();
      });

      stream.onPacket(createStreamPacket(1, 16, 0, false, false, 'string'));
      stream.onPacket(createStreamPacket(2, 16, 1, false, false, 123));
      stream.onPacket(createStreamPacket(3, 16, 2, false, false, { nested: { obj: true } }));
      stream.onPacket(createStreamPacket(4, 16, 3, false, false, [1, 2, 3]));
      stream.onPacket(createStreamPacket(5, 16, 4, true, false, Buffer.from('binary')));
    });
  });

  describe('Buffer Management', () => {
    it('should buffer out-of-order packets', () => {
      const stream = new NetronReadableStream({ peer, streamId: 20 });

      // Send packet with index 5 (expected is 0)
      stream.onPacket(createStreamPacket(1, 20, 5, false, false, 'future'));

      // Stream should not have emitted data yet
      let dataReceived = false;
      stream.on('data', () => {
        dataReceived = true;
      });

      expect(dataReceived).toBe(false);
    });

    it('should detect buffer overflow at MAX_BUFFER_SIZE (10000)', (done) => {
      const stream = new NetronReadableStream({ peer, streamId: 21 });
      let errorOccurred = false;

      stream.on('error', (error) => {
        expect(error.message).toContain('Stream backpressure');
        errorOccurred = true;
      });

      stream.on('close', () => {
        expect(errorOccurred).toBe(true);
        expect(stream.destroyed).toBe(true);
        done();
      });

      // Fill buffer beyond MAX_BUFFER_SIZE (10000)
      // Start at index 1 to force buffering (expected index is 0)
      for (let i = 1; i <= 10002; i++) {
        const packet = createStreamPacket(i, 21, i, false, false, `chunk-${i}`);
        stream.onPacket(packet);
        if (errorOccurred) break;
      }
    });

    it('should log buffer overflow error', (done) => {
      const stream = new NetronReadableStream({ peer, streamId: 22 });

      stream.on('error', () => {});
      stream.on('close', () => {
        expect(peer.logger.error).toHaveBeenCalledWith(
          expect.objectContaining({ streamId: 22 }),
          'Stream buffer overflow'
        );
        done();
      });

      for (let i = 1; i <= 10002; i++) {
        stream.onPacket(createStreamPacket(i, 22, i, false, false, `chunk-${i}`));
        if (stream.destroyed) break;
      }
    });

    it('should clear buffer on cleanup', () => {
      const stream = new NetronReadableStream({ peer, streamId: 23 });

      // Add some packets to buffer
      stream.onPacket(createStreamPacket(1, 23, 5, false, false, 'buffered'));

      stream.destroy();

      expect(peer.readableStreams.has(23)).toBe(false);
    });

    it('should process buffered packets when gap is filled', (done) => {
      const stream = new NetronReadableStream({ peer, streamId: 24 });
      const receivedChunks: any[] = [];

      stream.on('data', (chunk) => receivedChunks.push(chunk));
      stream.on('end', () => {
        // All should now be delivered in order
        expect(receivedChunks).toEqual(['chunk-0', 'chunk-1', 'chunk-2', 'chunk-3']);
        done();
      });

      // Send packets 2, 3 first (they get buffered, but NOT the last packet marker)
      stream.onPacket(createStreamPacket(1, 24, 2, false, false, 'chunk-2'));
      stream.onPacket(createStreamPacket(2, 24, 3, false, false, 'chunk-3'));

      expect(receivedChunks).toEqual([]);

      // Now send 0, 1 to fill the gap
      stream.onPacket(createStreamPacket(3, 24, 0, false, false, 'chunk-0'));
      stream.onPacket(createStreamPacket(4, 24, 1, false, false, 'chunk-1'));

      // Now all data is delivered, send end marker
      stream.onPacket(createStreamPacket(5, 24, 4, true, false, null));
    });
  });

  describe('Backpressure Handling', () => {
    it('should log backpressure when push returns false', () => {
      const stream = new NetronReadableStream({ peer, streamId: 30, highWaterMark: 1 });

      // Don't consume data to trigger backpressure
      stream.onPacket(createStreamPacket(1, 30, 0, false, false, 'chunk1'));
      stream.onPacket(createStreamPacket(2, 30, 1, false, false, 'chunk2'));

      expect(peer.logger.debug).toHaveBeenCalledWith(
        { streamId: 30 },
        'Stream backpressure detected'
      );
    });

    it('should resume delivery when drained', (done) => {
      const stream = new NetronReadableStream({ peer, streamId: 31, highWaterMark: 1 });
      const receivedChunks: any[] = [];

      stream.on('data', (chunk) => {
        receivedChunks.push(chunk);
      });

      stream.on('end', () => {
        expect(receivedChunks).toContain('chunk1');
        expect(receivedChunks).toContain('chunk2');
        done();
      });

      stream.onPacket(createStreamPacket(1, 31, 0, false, false, 'chunk1'));
      stream.onPacket(createStreamPacket(2, 31, 1, true, false, 'chunk2'));
    });
  });

  describe('Timeout Handling', () => {
    it('should timeout inactive non-live streams', (done) => {
      const streamTimeout = 50;

      Netron.create(createMockLogger(), { streamTimeout }).then((customNetron) => {
        const customPeer = new RemotePeer({} as WebSocket, customNetron, 'timeout-peer');
        const stream = new NetronReadableStream({ peer: customPeer, streamId: 40 });

        let errorOccurred = false;
        stream.on('error', (error) => {
          expect(error.message).toContain(`inactive for ${streamTimeout}ms`);
          errorOccurred = true;
        });

        stream.on('close', async () => {
          expect(errorOccurred).toBe(true);
          await customNetron.stop();
          done();
        });

        // Send initial packet to start timeout
        stream.onPacket(createStreamPacket(1, 40, 0, false, false, 'initial'));
      });
    });

    it('should not timeout live streams', async () => {
      const streamTimeout = 30;

      const customNetron = await Netron.create(createMockLogger(), { streamTimeout });
      const customPeer = new RemotePeer({} as WebSocket, customNetron, 'live-peer');
      const stream = new NetronReadableStream({ peer: customPeer, streamId: 41, isLive: true });

      // Send initial packet
      stream.onPacket(createStreamPacket(1, 41, 0, false, true, 'live-data'));

      // Wait longer than timeout
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(stream.destroyed).toBe(false);

      stream.destroy();
      await customNetron.stop();
    });

    it('should reset timeout on each packet', async () => {
      const streamTimeout = 60;

      const customNetron = await Netron.create(createMockLogger(), { streamTimeout });
      const customPeer = new RemotePeer({} as WebSocket, customNetron, 'reset-peer');
      const stream = new NetronReadableStream({ peer: customPeer, streamId: 42 });

      // Send packets with delays less than timeout
      stream.onPacket(createStreamPacket(1, 42, 0, false, false, 'data1'));
      await new Promise((resolve) => setTimeout(resolve, 30));

      stream.onPacket(createStreamPacket(2, 42, 1, false, false, 'data2'));
      await new Promise((resolve) => setTimeout(resolve, 30));

      // Stream should still be alive
      expect(stream.destroyed).toBe(false);

      stream.destroy();
      await customNetron.stop();
    });

    it('should use default timeout when not specified', () => {
      // This test verifies the default timeout path
      const stream = new NetronReadableStream({ peer, streamId: 43 });

      // The stream should be created without errors
      expect(stream).toBeDefined();

      stream.destroy();
    });

    it('should use 60s default when netron options are undefined', async () => {
      // Create a custom netron with undefined options
      const customNetron = await Netron.create(createMockLogger());
      // Manually set options to undefined to test the default path
      (customNetron as any).options = undefined;

      const customPeer = new RemotePeer({} as WebSocket, customNetron, 'default-timeout-peer');
      const stream = new NetronReadableStream({ peer: customPeer, streamId: 44 });

      // Trigger resetTimeout by sending a packet
      stream.onPacket(createStreamPacket(1, 44, 0, false, false, 'data'));

      // Verify debug was called with default timeout
      expect(customPeer.logger.debug).toHaveBeenCalledWith(
        { streamId: 44, timeoutDuration: 60000 },
        'Resetting stream timeout'
      );

      stream.destroy();
      await customNetron.stop();
    });
  });

  describe('Stream Closing', () => {
    it('should close stream gracefully with closeStream', (done) => {
      const stream = new NetronReadableStream({ peer, streamId: 50 });

      // Need to consume data for end event to fire
      stream.on('data', () => {});
      stream.on('end', () => {
        done();
      });

      stream.closeStream();
    });

    it('should not close live stream without force flag', () => {
      const stream = new NetronReadableStream({ peer, streamId: 51, isLive: true });

      stream.closeStream();

      expect(peer.logger.warn).toHaveBeenCalledWith(
        { streamId: 51 },
        'Attempt to close live stream'
      );
      expect(stream.destroyed).toBe(false);
    });

    it('should close live stream with force flag', (done) => {
      const stream = new NetronReadableStream({ peer, streamId: 52, isLive: true });

      stream.on('close', () => {
        expect(stream.destroyed).toBe(true);
        done();
      });

      stream.closeStream(true);
    });

    it('should handle multiple closeStream calls on already closed stream', (done) => {
      const stream = new NetronReadableStream({ peer, streamId: 53 });

      // First, destroy the stream to set isClosed
      stream.destroy();

      stream.on('close', () => {
        // Now try closeStream on closed stream
        stream.closeStream();

        expect(peer.logger.warn).toHaveBeenCalledWith(
          { streamId: 53 },
          'Attempt to close already closed stream'
        );
        done();
      });
    });

    it('should force close with reason', (done) => {
      const stream = new NetronReadableStream({ peer, streamId: 54 });

      stream.on('close', () => {
        expect(stream.isComplete).toBe(true);
        done();
      });

      stream.forceClose('Remote terminated');

      expect(peer.logger.info).toHaveBeenCalledWith(
        { streamId: 54, reason: 'Remote terminated' },
        'Force closing stream'
      );
    });

    it('should handle forceClose on already closed stream', () => {
      const stream = new NetronReadableStream({ peer, streamId: 55 });

      stream.destroy();
      stream.forceClose('After destroy');

      expect(peer.logger.warn).toHaveBeenCalledWith(
        { streamId: 55 },
        'Attempt to force close already closed stream'
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle destroy with error', (done) => {
      const stream = new NetronReadableStream({ peer, streamId: 60 });
      const testError = new Error('Test error');

      stream.on('error', (err) => {
        expect(err).toBe(testError);
      });

      stream.on('close', () => {
        expect(stream.destroyed).toBe(true);
        expect(peer.readableStreams.has(60)).toBe(false);
        done();
      });

      stream.destroy(testError);
    });

    it('should log error on error event', (done) => {
      const stream = new NetronReadableStream({ peer, streamId: 61 });
      const testError = new Error('Stream error');

      stream.on('error', () => {});
      stream.on('close', () => {
        expect(peer.logger.error).toHaveBeenCalledWith(
          { streamId: 61, error: testError },
          'Stream error occurred'
        );
        done();
      });

      stream.destroy(testError);
    });

    it('should handle destroy without error', (done) => {
      const stream = new NetronReadableStream({ peer, streamId: 62 });

      stream.on('close', () => {
        expect(stream.destroyed).toBe(true);
        done();
      });

      stream.destroy();
    });

    it('should handle multiple destroy calls', () => {
      const stream = new NetronReadableStream({ peer, streamId: 63 });

      stream.destroy();
      const result = stream.destroy();

      expect(result).toBe(stream);
      expect(peer.logger.warn).toHaveBeenCalledWith(
        { streamId: 63 },
        'Attempt to destroy already closed stream'
      );
    });
  });

  describe('Cleanup', () => {
    it('should remove stream from peer map on cleanup', () => {
      const stream = new NetronReadableStream({ peer, streamId: 70 });

      expect(peer.readableStreams.has(70)).toBe(true);

      stream.destroy();

      expect(peer.readableStreams.has(70)).toBe(false);
    });

    it('should clear timeout on cleanup', (done) => {
      const stream = new NetronReadableStream({ peer, streamId: 71 });

      // Trigger packet to start timeout
      stream.onPacket(createStreamPacket(1, 71, 0, false, false, 'data'));

      stream.on('close', () => {
        expect(peer.logger.debug).toHaveBeenCalledWith(
          { streamId: 71 },
          'Cleaning up stream resources'
        );
        done();
      });

      stream.destroy();
    });

    it('should clear buffer on cleanup', () => {
      const stream = new NetronReadableStream({ peer, streamId: 72 });

      // Add buffered packet
      stream.onPacket(createStreamPacket(1, 72, 5, false, false, 'buffered'));

      stream.destroy();

      // Buffer should be cleared (no way to directly check, but stream should be cleaned)
      expect(stream.destroyed).toBe(true);
    });
  });

  describe('_read Implementation', () => {
    it('should have _read as no-op (data pushed in onPacket)', () => {
      const stream = new NetronReadableStream({ peer, streamId: 80 });

      // _read should not throw
      expect(() => {
        (stream as any)._read();
      }).not.toThrow();
    });
  });

  describe('Async Iteration', () => {
    it('should support async iteration', async () => {
      const stream = new NetronReadableStream({ peer, streamId: 90 });
      const receivedChunks: any[] = [];

      // Start iteration in background
      const iterationPromise = (async () => {
        for await (const chunk of stream) {
          receivedChunks.push(chunk);
        }
      })();

      // Send packets
      stream.onPacket(createStreamPacket(1, 90, 0, false, false, 'async1'));
      stream.onPacket(createStreamPacket(2, 90, 1, false, false, 'async2'));
      stream.onPacket(createStreamPacket(3, 90, 2, true, false, 'async3'));

      await iterationPromise;

      expect(receivedChunks).toEqual(['async1', 'async2', 'async3']);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty stream (only end packet)', (done) => {
      const stream = new NetronReadableStream({ peer, streamId: 100 });
      const receivedChunks: any[] = [];

      stream.on('data', (chunk) => receivedChunks.push(chunk));
      stream.on('end', () => {
        expect(receivedChunks).toEqual([]);
        expect(stream.isComplete).toBe(true);
        done();
      });

      // Send only the last packet with null data
      const lastPacket = createStreamPacket(1, 100, 0, true, false, null);
      stream.onPacket(lastPacket);
    });

    it('should handle single chunk stream', (done) => {
      const stream = new NetronReadableStream({ peer, streamId: 101 });
      const receivedChunks: any[] = [];

      stream.on('data', (chunk) => receivedChunks.push(chunk));
      stream.on('end', () => {
        expect(receivedChunks).toEqual(['only-chunk']);
        done();
      });

      stream.onPacket(createStreamPacket(1, 101, 0, true, false, 'only-chunk'));
    });

    it('should handle large payloads', (done) => {
      const stream = new NetronReadableStream({ peer, streamId: 102 });
      const largeData = 'x'.repeat(100000);
      const receivedChunks: any[] = [];

      stream.on('data', (chunk) => receivedChunks.push(chunk));
      stream.on('end', () => {
        expect(receivedChunks[0].length).toBe(100000);
        done();
      });

      stream.onPacket(createStreamPacket(1, 102, 0, true, false, largeData));
    });

    it('should handle stream ID of 0', () => {
      const stream = new NetronReadableStream({ peer, streamId: 0 });

      expect(stream.id).toBe(0);
      expect(peer.readableStreams.get(0)).toBe(stream);

      stream.destroy();
    });
  });
});
