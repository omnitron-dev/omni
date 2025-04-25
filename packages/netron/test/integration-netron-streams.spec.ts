import { delay } from '@devgrid/common';

import { Netron, RemotePeer, PeerConnectEvent, NetronReadableStream, NetronWritableStream, NETRON_EVENT_PEER_CONNECT } from '../dist';

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

    // Отправляем данные
    writableStream.write('chunk-1');
    writableStream.write('chunk-2');
    writableStream.write('chunk-3');
    writableStream.end();


    // Ожидаем завершения
    await new Promise((resolve) => writableStream.on('finish', resolve));

    // Даем небольшое время для передачи данных
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
    writableStream.write('chunk-2'); // Ошибка здесь (index === 1)
    writableStream.write('chunk-3');
    writableStream.end();

    await new Promise((resolve) => {
      writableStream.on('error', () => {
        writableErrored = true;
        resolve(null);
      });

      writableStream.on('finish', resolve);
    });

    // Небольшая задержка для завершения всех асинхронных операций
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

    // Даем время на обработку последнего пакета и события end
    await delay(100);

    expect(receivedChunks).toEqual(['chunk-1', 'chunk-2', 'chunk-3']);
    expect(readableEnded).toBe(true);
  });

  it('should correctly send and receive a large amount of data', async () => {
    const receivedChunks: string[] = [];
    const chunkCount = 100000;  // большое количество пакетов

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
    await delay(500);  // увеличиваем задержку из-за большего количества данных

    expect(receivedChunks.length).toBe(chunkCount);
    expect(receivedChunks[0]).toBe('chunk-0');
    expect(receivedChunks[chunkCount - 1]).toBe(`chunk-${chunkCount - 1}`);
  }, 10000);

  it('should correctly handle a live stream with delayed sending', async () => {
    const receivedChunks: string[] = [];
    const sendIntervals = [500, 1000, 2000]; // задержки между отправкой пакетов

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
    await delay(200); // дополнительное время на обработку данных

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

    // Явно уничтожаем live-поток
    writableStream.destroy();

    await delay(500); // Ждём обработку события закрытия на удалённом пире

    expect(writableStream.destroyed).toBe(true);
    expect(readableClosed).toBe(true);
    expect(peerB.writableStreams.size).toBe(0);
  });
});
