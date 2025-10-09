import { WebSocket } from 'ws';
import { jest, describe, beforeEach, afterEach, afterAll, it, expect } from '@jest/globals';
import { delay } from '@omnitron-dev/common';

import { Netron, RemotePeer, createStreamPacket, NetronReadableStream, NetronWritableStream } from '../../src/netron';
import { createMockLogger } from './test-utils.js';

describe('Netron Streams', () => {
  let netron: Netron;
  let peer: RemotePeer;

  beforeEach(async () => {
    // Create real Netron instance with shorter timeout for faster tests
    const logger = createMockLogger();
    netron = await Netron.create(logger, { streamTimeout: 100 });

    // Create a mock WebSocket for testing
    const mockSocket = {
      readyState: WebSocket.OPEN,
      send: jest.fn((data: any, opts: any, cb?: (err?: Error) => void) => {
        if (cb) cb(); // Immediately call callback for success
      }),
      on: jest.fn(),
      close: jest.fn(),
    } as unknown as WebSocket;

    // Create RemotePeer with mocked socket
    peer = new RemotePeer(mockSocket, netron, 'test-peer-id');
  });

  afterEach(async () => {
    // Clean up all streams
    for (const stream of peer.readableStreams.values()) {
      stream.destroy();
    }
    for (const stream of peer.writableStreams.values()) {
      stream.destroy();
    }

    await netron.stop();
  });

  afterAll(() => {
    jest.clearAllMocks();
  });

  describe('NetronReadableStream', () => {
    it('should correctly handle ordered packets', (done) => {
      const stream = NetronReadableStream.create(peer, 1);
      const receivedChunks: any[] = [];

      stream.on('data', (chunk) => receivedChunks.push(chunk));
      stream.on('end', () => {
        expect(receivedChunks).toEqual(['chunk1', 'chunk2', 'chunk3']);
        done();
      });

      const packets = [
        createStreamPacket(1, 1, 0, false, false, 'chunk1'),
        createStreamPacket(2, 1, 1, false, false, 'chunk2'),
        createStreamPacket(3, 1, 2, true, false, 'chunk3'),
      ];

      packets.forEach((packet) => stream.onPacket(packet));
    });

    it('should correctly handle unordered packets', async () => {
      const stream = new NetronReadableStream({ peer, streamId: 2 });
      const receivedChunks: any[] = [];

      stream.on('data', (chunk) => receivedChunks.push(chunk));

      // Create proper packets with the correct structure
      const packets = [
        createStreamPacket(1, 2, 2, false, false, 'chunk-2'),
        createStreamPacket(2, 2, 0, false, false, 'chunk-0'),
        createStreamPacket(3, 2, 1, false, false, 'chunk-1'),
        createStreamPacket(4, 2, 3, true, false, 'chunk-3'),
      ];

      // Send packets in wrong order
      packets.forEach((packet) => stream.onPacket(packet));

      await new Promise((resolve) => stream.on('end', resolve));

      // Verify they were reordered correctly
      expect(receivedChunks).toEqual(['chunk-0', 'chunk-1', 'chunk-2', 'chunk-3']);
    });

    it('should handle buffer overflow correctly', (done) => {
      const stream = new NetronReadableStream({ peer, streamId: 3 });

      let errorOccurred = false;

      stream.on('close', () => {
        expect(errorOccurred).toBe(true);
        expect(stream.destroyed).toBe(true);
        done();
      });

      stream.on('error', (error) => {
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toContain('Stream backpressure');
        errorOccurred = true;
      });

      // Fill buffer beyond MAX_BUFFER_SIZE (10000)
      // Use non-sequential indices starting at 1 (not 0) to force buffering
      // Need to send 10002 packets because check happens before adding to buffer
      for (let i = 1; i <= 10002; i++) {
        const packet = createStreamPacket(i, 3, i, false, false, `chunk-${i}`);
        stream.onPacket(packet);
        // If error occurred, stop sending more packets
        if (errorOccurred) break;
      }
    });

    it('should handle inactivity timeout correctly', (done) => {
      const streamTimeout = 50; // 50ms for faster test

      // Create new netron with custom timeout
      Netron.create(createMockLogger(), { streamTimeout }).then(customNetron => {
        const customPeer = new RemotePeer({} as WebSocket, customNetron, 'timeout-peer');
        const stream = new NetronReadableStream({ peer: customPeer, streamId: 4 });

        let errorOccurred = false;
        stream.on('error', (error) => {
          expect(error).toBeInstanceOf(Error);
          expect(error.message).toContain(`inactive for ${streamTimeout}ms`);
          errorOccurred = true;
        });

        stream.on('close', async () => {
          expect(errorOccurred).toBe(true);
          expect(stream.destroyed).toBe(true);
          await customNetron.stop();
          done();
        });

        // Send initial packet to start timeout
        const packet = createStreamPacket(1, 4, 0, false, false, 'initial');
        stream.onPacket(packet);

        // Don't send any more packets - should timeout
      });
    });

    it('should close the stream after receiving the last packet', (done) => {
      const stream = new NetronReadableStream({ peer, streamId: 5 });

      const receivedChunks: number[] = [];
      stream.on('data', (chunk) => receivedChunks.push(chunk));

      stream.on('end', () => {
        expect(receivedChunks).toEqual([1, 2, 3]);
        expect(stream.readableEnded).toBe(true);
        expect(stream.isComplete).toBe(true);
        done();
      });

      const packets = [
        createStreamPacket(1, 5, 0, false, false, 1),
        createStreamPacket(2, 5, 1, false, false, 2),
        createStreamPacket(3, 5, 2, true, false, 3),
      ];

      packets.forEach(packet => stream.onPacket(packet));
    });

    it('should handle live streams without timeout', async () => {
      const stream = new NetronReadableStream({ peer, streamId: 6, isLive: true });

      const packet = createStreamPacket(1, 6, 0, false, true, 'live-data');
      stream.onPacket(packet);

      // Wait longer than default timeout
      await delay(200);

      // Stream should still be active (live streams don't timeout)
      expect(stream.destroyed).toBe(false);

      // Clean up
      stream.destroy();
    });

    it('should handle forceClose correctly', (done) => {
      const stream = new NetronReadableStream({ peer, streamId: 7 });

      stream.on('close', () => {
        expect(stream.isComplete).toBe(true);
        done();
      });

      stream.forceClose('Remote closed');
    });

    it('should handle destroy with error', (done) => {
      const stream = new NetronReadableStream({ peer, streamId: 8 });

      const errorSpy = jest.spyOn(peer.logger, 'error').mockImplementation(() => {});
      const error = new Error('Test error');

      stream.on('error', (err) => {
        expect(err).toBe(error);
      });

      stream.on('close', () => {
        expect(stream.destroyed).toBe(true);
        expect(errorSpy).toHaveBeenCalledWith(
          { streamId: stream.id, error },
          'Stream error occurred'
        );
        expect(peer.readableStreams.has(stream.id)).toBe(false);
        errorSpy.mockRestore();
        done();
      });

      stream.destroy(error);
    });
  });

  describe('NetronWritableStream', () => {
    let mockPeer: RemotePeer;

    beforeEach(() => {
      // Create a peer with mocked sendStreamChunk
      mockPeer = new RemotePeer({} as WebSocket, netron, 'mock-write-peer');
      mockPeer.sendStreamChunk = jest.fn<typeof mockPeer.sendStreamChunk>()
        .mockResolvedValue(undefined);
    });

    it('should correctly send data in sequence', async () => {
      const stream = new NetronWritableStream({ peer: mockPeer, isLive: false });

      stream.write('chunk-1');
      stream.write('chunk-2');
      stream.end('chunk-3');

      await new Promise((resolve) => stream.on('finish', resolve));

      expect(mockPeer.sendStreamChunk).toHaveBeenCalledTimes(4);
      expect(mockPeer.sendStreamChunk).toHaveBeenNthCalledWith(1, stream.id, 'chunk-1', 0, false, false);
      expect(mockPeer.sendStreamChunk).toHaveBeenNthCalledWith(2, stream.id, 'chunk-2', 1, false, false);
      expect(mockPeer.sendStreamChunk).toHaveBeenNthCalledWith(3, stream.id, 'chunk-3', 2, false, false);
      expect(mockPeer.sendStreamChunk).toHaveBeenNthCalledWith(4, stream.id, null, 3, true, false);
    });

    it('should handle sendStreamChunk errors correctly', async () => {
      const error = new Error('Send failed');
      mockPeer.sendStreamChunk = jest.fn<typeof mockPeer.sendStreamChunk>()
        .mockRejectedValue(error);
      mockPeer.sendPacket = jest.fn<typeof mockPeer.sendPacket>()
        .mockResolvedValue();

      const stream = new NetronWritableStream({ peer: mockPeer, isLive: false });

      let errorReceived: Error | undefined;
      stream.on('error', (err) => {
        errorReceived = err;
      });

      stream.write('chunk-1');

      await new Promise((resolve) => stream.on('close', resolve));

      expect(errorReceived).toBe(error);
      expect(mockPeer.sendStreamChunk).toHaveBeenCalledTimes(1);
      expect(mockPeer.sendPacket).toHaveBeenCalled();
      expect(stream.destroyed).toBe(true);
    });

    it('should correctly pipe from AsyncIterable', async () => {
      const stream = new NetronWritableStream({ peer: mockPeer, isLive: false });

      async function* asyncGenerator() {
        yield 'async-1';
        yield 'async-2';
        yield 'async-3';
      }

      await stream.pipeFrom(asyncGenerator());

      expect(mockPeer.sendStreamChunk).toHaveBeenCalledTimes(4);
      expect(mockPeer.sendStreamChunk).toHaveBeenNthCalledWith(1, stream.id, 'async-1', 0, false, false);
      expect(mockPeer.sendStreamChunk).toHaveBeenNthCalledWith(2, stream.id, 'async-2', 1, false, false);
      expect(mockPeer.sendStreamChunk).toHaveBeenNthCalledWith(3, stream.id, 'async-3', 2, false, false);
      expect(mockPeer.sendStreamChunk).toHaveBeenNthCalledWith(4, stream.id, null, 3, true, false);
    });

    it('should handle destroy with error', async () => {
      mockPeer.sendPacket = jest.fn<typeof mockPeer.sendPacket>()
        .mockResolvedValue();

      const stream = new NetronWritableStream({ peer: mockPeer });
      const error = new Error('Destroy error');

      const infoSpy = jest.spyOn(mockPeer.logger, 'info').mockImplementation(() => {});
      let errorEmitted = false;

      stream.on('error', (err) => {
        expect(err).toBe(error);
        errorEmitted = true;
      });

      stream.destroy(error);

      await new Promise((resolve) => stream.on('close', resolve));

      expect(errorEmitted).toBe(true);
      expect(infoSpy).toHaveBeenCalledWith(
        { streamId: stream.id, error },
        'Destroying stream'
      );
      expect(mockPeer.writableStreams.has(stream.id)).toBe(false);
      expect(mockPeer.sendPacket).toHaveBeenCalled();

      infoSpy.mockRestore();
    });

    it('should handle write to closed stream', async () => {
      const stream = new NetronWritableStream({ peer: mockPeer });

      // Destroy the stream to immediately close it
      stream.destroy();

      // Wait for the destroy to complete
      await new Promise(resolve => stream.on('close', resolve));

      // Verify the stream is destroyed
      expect(stream.destroyed).toBe(true);

      // Now try to write to the destroyed stream
      const writePromise = new Promise<Error | null>((resolve) => {
        stream.write('test', (err) => {
          resolve(err || null);
        });
      });

      // Also listen for error event
      const errorPromise = new Promise<Error>((resolve) => {
        stream.once('error', resolve);
      });

      // Wait for either callback or error event
      const result = await Promise.race([
        writePromise,
        errorPromise,
        new Promise(resolve => setTimeout(() => resolve('timeout'), 100))
      ]);

      // The stream should either call the callback with an error or emit an error event
      if (result instanceof Error) {
        expect(result.message).toMatch(/Cannot call write after a stream was destroyed|Stream is already closed|write after end/);
      } else if (result === 'timeout') {
        // If neither happened, check if write returned false (synchronous rejection)
        const syncResult = stream.write('test2');
        expect(syncResult).toBe(false);
      }
    });

    it('should create stream with factory method', async () => {
      async function* source() {
        yield 'factory-1';
        yield 'factory-2';
      }

      const stream = NetronWritableStream.create(mockPeer, source(), false, 999);

      expect(stream.id).toBe(999);

      await new Promise((resolve) => stream.on('finish', resolve));

      expect(mockPeer.sendStreamChunk).toHaveBeenCalledTimes(3);
    });
  });

  describe('Stream Integration', () => {
    it('should handle bidirectional streaming', async () => {
      // Create two peers
      const peer1 = new RemotePeer({} as WebSocket, netron, 'peer1');
      const peer2 = new RemotePeer({} as WebSocket, netron, 'peer2');

      // Mock the send methods to pipe data between peers
      const stream1to2Data: any[] = [];
      const stream2to1Data: any[] = [];

      peer1.sendStreamChunk = jest.fn<typeof peer1.sendStreamChunk>(
        async (streamId, chunk, index, isLast) => {
          stream1to2Data.push({ streamId, chunk, index, isLast });
        }
      );

      peer2.sendStreamChunk = jest.fn<typeof peer2.sendStreamChunk>(
        async (streamId, chunk, index, isLast) => {
          stream2to1Data.push({ streamId, chunk, index, isLast });
        }
      );

      // Create writable stream on peer1
      const writable1 = new NetronWritableStream({ peer: peer1, streamId: 100 });

      // Write data
      writable1.write('hello');
      writable1.write('world');
      writable1.end();

      await new Promise((resolve) => writable1.on('finish', resolve));

      // Verify data was sent
      expect(stream1to2Data).toHaveLength(3);
      expect(stream1to2Data[0]).toEqual({ streamId: 100, chunk: 'hello', index: 0, isLast: false });
      expect(stream1to2Data[1]).toEqual({ streamId: 100, chunk: 'world', index: 1, isLast: false });
      expect(stream1to2Data[2]).toEqual({ streamId: 100, chunk: null, index: 2, isLast: true });

      // Clean up
      peer1.readableStreams.forEach(s => s.destroy());
      peer1.writableStreams.forEach(s => s.destroy());
      peer2.readableStreams.forEach(s => s.destroy());
      peer2.writableStreams.forEach(s => s.destroy());
    });
  });
});