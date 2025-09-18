import { WebSocket } from 'ws';
import { jest, describe, beforeEach, afterEach, afterAll, it, expect } from '@jest/globals';

import { Netron, RemotePeer, createStreamPacket, NetronReadableStream, NetronWritableStream } from '../src';

describe('Netron Streams Simple Tests', () => {
  jest.setTimeout(10000); // Set test timeout to 10 seconds

  let netron: Netron;
  let peer: RemotePeer;

  beforeEach(async () => {
    // Create real Netron instance with shorter timeout for faster tests
    netron = await Netron.create({ streamTimeout: 100 });

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

  describe('NetronReadableStream Basic', () => {
    it('should handle simple ordered packets', (done) => {
      const stream = NetronReadableStream.create(peer, 1);
      const receivedChunks: any[] = [];

      stream.on('data', (chunk) => receivedChunks.push(chunk));
      stream.on('end', () => {
        expect(receivedChunks).toEqual(['chunk1', 'chunk2', 'chunk3']);
        done();
      });

      // Send packets in order
      const packets = [
        createStreamPacket(1, 1, 0, false, false, 'chunk1'),
        createStreamPacket(2, 1, 1, false, false, 'chunk2'),
        createStreamPacket(3, 1, 2, true, false, 'chunk3'),
      ];

      packets.forEach((packet) => stream.onPacket(packet));
    });

    it('should handle basic timeout', (done) => {
      const stream = NetronReadableStream.create(peer, 2);

      let errorOccurred = false;
      stream.on('error', (error) => {
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toContain('inactive');
        errorOccurred = true;
      });

      stream.on('close', () => {
        expect(errorOccurred).toBe(true);
        expect(stream.destroyed).toBe(true);
        done();
      });

      // Send initial packet to start timeout
      const packet = createStreamPacket(1, 2, 0, false, false, 'initial');
      stream.onPacket(packet);
      // Don't send any more packets - should timeout after 100ms
    }, 500); // Give enough time for timeout to trigger
  });

  describe('NetronWritableStream Basic', () => {
    let mockPeer: RemotePeer;

    beforeEach(() => {
      // Create a peer with mocked sendStreamChunk
      mockPeer = new RemotePeer({} as WebSocket, netron, 'mock-write-peer');
      mockPeer.sendStreamChunk = jest.fn<typeof mockPeer.sendStreamChunk>()
        .mockResolvedValue(undefined);
    });

    it('should send data correctly', async () => {
      const stream = new NetronWritableStream({ peer: mockPeer, isLive: false });

      stream.write('chunk-1');
      stream.write('chunk-2');
      stream.end();

      await new Promise((resolve) => stream.on('finish', resolve));

      expect(mockPeer.sendStreamChunk).toHaveBeenCalledTimes(3);
      expect(mockPeer.sendStreamChunk).toHaveBeenNthCalledWith(1, stream.id, 'chunk-1', 0, false, false);
      expect(mockPeer.sendStreamChunk).toHaveBeenNthCalledWith(2, stream.id, 'chunk-2', 1, false, false);
      expect(mockPeer.sendStreamChunk).toHaveBeenNthCalledWith(3, stream.id, null, 2, true, false);
    });
  });

  describe('Advanced Stream Features', () => {
    it('should handle unordered packets correctly', async () => {
      const stream = new NetronReadableStream({ peer, streamId: 3 });
      const receivedChunks: any[] = [];

      stream.on('data', (chunk) => receivedChunks.push(chunk));

      // Send packets out of order
      const packets = [
        createStreamPacket(1, 3, 2, false, false, 'chunk-2'),
        createStreamPacket(2, 3, 0, false, false, 'chunk-0'),
        createStreamPacket(3, 3, 1, false, false, 'chunk-1'),
        createStreamPacket(4, 3, 3, true, false, 'chunk-3'),
      ];

      packets.forEach((packet) => stream.onPacket(packet));

      await new Promise((resolve) => stream.on('end', resolve));

      // Should be reordered correctly
      expect(receivedChunks).toEqual(['chunk-0', 'chunk-1', 'chunk-2', 'chunk-3']);
    });

    it('should handle live streams without timeout', async () => {
      const stream = new NetronReadableStream({ peer, streamId: 4, isLive: true });

      const packet = createStreamPacket(1, 4, 0, false, true, 'live-data');
      stream.onPacket(packet);

      // Wait longer than default timeout
      await new Promise(resolve => setTimeout(resolve, 200));

      // Stream should still be active (live streams don't timeout)
      expect(stream.destroyed).toBe(false);

      // Clean up
      stream.destroy();
    });

    it('should handle forceClose correctly', (done) => {
      const stream = new NetronReadableStream({ peer, streamId: 5 });

      stream.on('close', () => {
        expect(stream.isComplete).toBe(true);
        done();
      });

      stream.forceClose('Test force close');
    });

    it('should handle async generator piping', async () => {
      const mockPeer = new RemotePeer({} as WebSocket, netron, 'async-peer');
      mockPeer.sendStreamChunk = jest.fn<typeof mockPeer.sendStreamChunk>()
        .mockResolvedValue(undefined);

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
  });
});