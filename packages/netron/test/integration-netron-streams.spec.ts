import { delay } from '@omnitron-dev/common';

import {
  Netron,
  RemotePeer,
  PeerConnectEvent,
  NetronReadableStream,
  NetronWritableStream,
  NETRON_EVENT_PEER_CONNECT,
} from '../dist';

describe('Netron Streams Integration Tests', () => {
  let netronA: Netron;
  let netronB: Netron;
  let peerB: RemotePeer;

  beforeEach(async () => {
    netronA = await Netron.create({ allowServiceEvents: true });
    netronB = await Netron.create({ listenHost: 'localhost', listenPort: 3002, allowServiceEvents: true });
  });

  afterEach(async () => {
    await peerB.disconnect();
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

    peerB = await netronA.connect('ws://localhost:3002');
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

    peerB = await netronA.connect('ws://localhost:3002');
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

    peerB = await netronA.connect('ws://localhost:3002');

    const writableStream = new NetronWritableStream({ peer: peerB });

    const originalSendStreamChunk = peerB.sendStreamChunk.bind(peerB);

    peerB.sendStreamChunk = jest.fn((streamId, chunk, index, isLast, isLive) => {
      if (index === 1) {
        return Promise.reject(new Error('Test stream error'));
      }
      return originalSendStreamChunk(streamId, chunk, index, isLast, isLive);
    });

    writableStream.write('chunk-1');
    writableStream.write('chunk-2'); // Error occurs here (index === 1)
    writableStream.write('chunk-3');
    writableStream.end();

    await new Promise((resolve) => {
      writableStream.on('error', () => {
        writableErrored = true;
        resolve(null);
      });

      writableStream.on('finish', resolve);
    });

    // Small delay for completion of all async operations
    await delay(100);

    expect(writableErrored).toBe(true);
    expect(readableEnded).toBe(true);
    expect(receivedChunks).toEqual(['chunk-1']);
  });

  it('should correctly emit end event on readable stream after receiving all chunks', async () => {
    const receivedChunks: string[] = [];
    let readableEnded = false;

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
        });
      }
    });

    peerB = await netronA.connect('ws://localhost:3002');

    const writableStream = new NetronWritableStream({ peer: peerB });

    writableStream.write('chunk-1');
    writableStream.write('chunk-2');
    writableStream.write('chunk-3');
    writableStream.end();

    await new Promise((resolve) => writableStream.on('finish', resolve));

    // Give time for processing the last packet and end event
    await delay(100);

    expect(receivedChunks).toEqual(['chunk-1', 'chunk-2', 'chunk-3']);
    expect(readableEnded).toBe(true);
  });

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

    peerB = await netronA.connect('ws://localhost:3002');
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

    peerB = await netronA.connect('ws://localhost:3002');
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

    netronB.once(NETRON_EVENT_PEER_CONNECT, (data: PeerConnectEvent) => {
      const remotePeerA = netronB.peers.get(data.peerId);
      if (remotePeerA) {
        remotePeerA.once('stream', (readableStream: NetronReadableStream) => {
          readableStream.on('close', () => {
            readableClosed = true;
          });
        });
      }
    });

    peerB = await netronA.connect('ws://localhost:3002');
    const writableStream = new NetronWritableStream({ peer: peerB, isLive: true });

    writableStream.write('live-chunk-1');
    writableStream.write('live-chunk-2');

    await delay(300);

    // Explicitly destroy live stream
    writableStream.destroy();

    await delay(500); // Wait for close event processing on remote peer

    expect(writableStream.destroyed).toBe(true);
    expect(readableClosed).toBe(true);
    expect(peerB.writableStreams.size).toBe(0);
  });
});
