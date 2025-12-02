import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { delay } from '@omnitron-dev/common';

import {
  Netron,
  RemotePeer,
  PeerConnectEvent,
  NetronReadableStream,
  NetronWritableStream,
  NETRON_EVENT_PEER_CONNECT,
} from '../../src/netron/index';
import { createMockLogger, createNetronServer, createNetronClient } from './test-utils.js';

const skipTests = process.env.USE_MOCK_REDIS === 'true' || process.env.CI === 'true';
if (skipTests) {
  console.log('⏭️  Skipping integration-netron-streams.spec.ts - integration test');
}
const describeOrSkip = skipTests ? describe.skip : describe;

describeOrSkip('Netron Streams Integration Tests', () => {
  let netronA: Netron;
  let netronB: Netron;
  let peerB: RemotePeer;
  let testPort: number;

  beforeEach(async () => {
    // Use random port to avoid conflicts during parallel test execution
    testPort = 9000 + Math.floor(Math.random() * 1000);

    const loggerA = createMockLogger();
    netronA = await createNetronClient({ logger: loggerA });

    const loggerB = createMockLogger();
    netronB = await createNetronServer({ port: testPort, logger: loggerB });
    await netronB.start();
  });

  afterEach(async () => {
    if (peerB) {
      await peerB.disconnect();
    }
    await netronA.stop();
    await netronB.stop();
  });

  it('should correctly send and receive a simple stream', async () => {
    const receivedChunks: string[] = [];

    netronB.once(NETRON_EVENT_PEER_CONNECT, (data: PeerConnectEvent) => {
      const remotePeerA = netronB.peers.get(data.peerId);
      if (remotePeerA) {
        remotePeerA.once('stream', (readableStream: NetronReadableStream) => {
          readableStream.on('data', (chunk) => {
            receivedChunks.push(chunk);
          });
        });
      }
    });

    peerB = await netronA.connect(`ws://localhost:${testPort}`);
    const writableStream = new NetronWritableStream({ peer: peerB });

    // Send data
    writableStream.write('chunk-1');
    writableStream.write('chunk-2');
    writableStream.write('chunk-3');
    writableStream.end();

    // Wait for completion
    await new Promise((resolve) => writableStream.on('finish', resolve));

    // Give some time for data transmission
    await delay(100);

    expect(receivedChunks).toEqual(['chunk-1', 'chunk-2', 'chunk-3']);
  });

  it('should correctly emit end event on readable stream after receiving all chunks', async () => {
    const receivedChunks: string[] = [];
    let streamEnded = false;

    netronB.once(NETRON_EVENT_PEER_CONNECT, (data: PeerConnectEvent) => {
      const remotePeerA = netronB.peers.get(data.peerId);
      if (remotePeerA) {
        remotePeerA.once('stream', (readableStream: NetronReadableStream) => {
          readableStream.on('data', (chunk) => {
            receivedChunks.push(chunk);
          });

          readableStream.once('end', () => {
            streamEnded = true;
          });
        });
      }
    });

    peerB = await netronA.connect(`ws://localhost:${testPort}`);
    const writableStream = new NetronWritableStream({ peer: peerB });

    writableStream.write('chunk-1');
    writableStream.write('chunk-2');
    writableStream.write('chunk-3');
    writableStream.end();

    await new Promise((resolve) => writableStream.on('finish', resolve));

    await delay(300);

    expect(receivedChunks).toEqual(['chunk-1', 'chunk-2', 'chunk-3']);
    expect(streamEnded).toBe(true);
  });

  it('should handle error during stream sending after initial chunk and close both streams', async () => {
    const receivedChunks: string[] = [];
    let readableEnded = false;
    let writableErrored = false;

    netronB.once(NETRON_EVENT_PEER_CONNECT, (data: PeerConnectEvent) => {
      const remotePeerA = netronB.peers.get(data.peerId);
      if (remotePeerA) {
        remotePeerA.once('stream', (readableStream: NetronReadableStream) => {
          readableStream.on('data', (chunk) => {
            receivedChunks.push(chunk);
          });

          readableStream.on('end', () => {
            readableEnded = true;
          });

          readableStream.on('error', () => {
            readableEnded = true;
          });
        });
      }
    });

    peerB = await netronA.connect(`ws://localhost:${testPort}`);

    const writableStream = new NetronWritableStream({ peer: peerB });

    const originalSendStreamChunk = peerB.sendStreamChunk.bind(peerB);

    peerB.sendStreamChunk = jest.fn((streamId, chunk, index, isLast, isLive) => {
      if (index === 1) {
        return Promise.reject(new Error('Test stream error'));
      }
      return originalSendStreamChunk(streamId, chunk, index, isLast, isLive);
    }) as any;

    // Set up error listener before writing
    const errorPromise = new Promise<void>((resolve) => {
      writableStream.on('error', () => {
        writableErrored = true;
        resolve();
      });
    });

    writableStream.write('chunk-1');
    writableStream.write('chunk-2'); // Error occurs here (index === 1)
    writableStream.write('chunk-3');
    writableStream.end();

    // Wait for error event with timeout
    await Promise.race([
      errorPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Error event timeout')), 5000)),
    ]);

    // Small delay for completion of all async operations
    await delay(100);

    expect(writableErrored).toBe(true);
    expect(readableEnded).toBe(true);
    expect(receivedChunks).toEqual(['chunk-1']);
  }, 40000);

  it('should correctly send and receive a large amount of data', async () => {
    const receivedChunks: string[] = [];
    const chunkCount = 100000; // large number of packets

    netronB.once(NETRON_EVENT_PEER_CONNECT, (data: PeerConnectEvent) => {
      const remotePeerA = netronB.peers.get(data.peerId);
      if (remotePeerA) {
        remotePeerA.once('stream', (readableStream: NetronReadableStream) => {
          readableStream.on('data', (chunk) => {
            receivedChunks.push(chunk);
          });
        });
      }
    });

    peerB = await netronA.connect(`ws://localhost:${testPort}`);
    const writableStream = new NetronWritableStream({ peer: peerB });

    for (let i = 0; i < chunkCount; i++) {
      writableStream.write(`chunk-${i}`);
    }
    writableStream.end();

    await new Promise((resolve) => writableStream.on('finish', resolve));
    await delay(500); // increase delay due to larger amount of data

    expect(receivedChunks.length).toBe(chunkCount);
    expect(receivedChunks[0]).toBe('chunk-0');
    expect(receivedChunks[chunkCount - 1]).toBe(`chunk-${chunkCount - 1}`);
  }, 10000);

  it('should correctly handle a live stream with delayed sending', async () => {
    const receivedChunks: string[] = [];
    const sendIntervals = [500, 1000, 2000]; // delays between packet sending

    netronB.once(NETRON_EVENT_PEER_CONNECT, (data: PeerConnectEvent) => {
      const remotePeerA = netronB.peers.get(data.peerId);
      if (remotePeerA) {
        remotePeerA.once('stream', (readableStream: NetronReadableStream) => {
          readableStream.on('data', (chunk) => {
            receivedChunks.push(chunk);
          });
        });
      }
    });

    peerB = await netronA.connect(`ws://localhost:${testPort}`);
    const writableStream = new NetronWritableStream({ peer: peerB, isLive: true });

    writableStream.write('chunk-1');
    await delay(sendIntervals[0]!);
    writableStream.write('chunk-2');
    await delay(sendIntervals[1]!);
    writableStream.write('chunk-3');
    await delay(sendIntervals[2]!);

    writableStream.end();

    await new Promise((resolve) => writableStream.on('finish', resolve));
    await delay(200); // additional time for data processing

    expect(receivedChunks).toEqual(['chunk-1', 'chunk-2', 'chunk-3']);
  }, 10000);

  it('should properly close live stream manually and handle resources cleanup', async () => {
    let readableClosed = false;
    let readableEnded = false;
    let streamReceived = false;

    netronB.once(NETRON_EVENT_PEER_CONNECT, (data: PeerConnectEvent) => {
      const remotePeerA = netronB.peers.get(data.peerId);
      if (remotePeerA) {
        remotePeerA.once('stream', (readableStream: NetronReadableStream) => {
          streamReceived = true;
          // Listen for both close and end events
          readableStream.on('close', () => {
            readableClosed = true;
          });

          readableStream.on('end', () => {
            readableEnded = true;
          });

          // Also listen for error event
          readableStream.on('error', () => {
            readableClosed = true;
          });
        });
      }
    });

    peerB = await netronA.connect(`ws://localhost:${testPort}`);
    const writableStream = new NetronWritableStream({ peer: peerB, isLive: true });

    writableStream.write('live-chunk-1');
    writableStream.write('live-chunk-2');

    await delay(300);

    // Explicitly destroy live stream
    writableStream.destroy();

    await delay(1000); // Increase delay to ensure event processing

    expect(writableStream.destroyed).toBe(true);
    expect(streamReceived).toBe(true);
    // The readable stream should receive either end or close event
    expect(readableEnded || readableClosed).toBe(true);
    expect(peerB.writableStreams.size).toBe(0);
  });
});
