import { WebSocket } from 'ws';
import { jest } from '@jest/globals';
import { delay } from '@devgrid/common';

import { createStreamPacket } from '../src/packet';
import { Netron, Packet, RemotePeer, NetronReadableStream, NetronWritableStream } from '../dist';

jest.mock('ws', () => ({
  WebSocket: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    send: jest.fn((data: any, opts: any, cb?: (err?: Error) => void) => cb && cb()),
    close: jest.fn(),
    readyState: 1, // OPEN
  })),
  WebSocketServer: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    close: jest.fn(),
  })),
}));

function createMockRemotePeer(): RemotePeer {
  const mockNetron = {
    logger: {
      child: jest.fn().mockReturnValue({
        error: jest.fn(),
        warn: jest.fn(),
        info: jest.fn(),
        debug: jest.fn(),
      }),
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
    },
  } as unknown as Netron;

  const mockSocket = {
    readyState: WebSocket.OPEN,
    send: jest.fn((data: any, opts: any, cb?: (err?: Error) => void) => cb && cb()),
    on: jest.fn(),
    close: jest.fn(),
  } as unknown as WebSocket;

  const peer = new RemotePeer(mockSocket, mockNetron, 'mock-peer-id');

  peer.sendStreamChunk = jest.fn<
    (streamId: number, chunk: any, offset: number, isLast: boolean, isLive: boolean) => Promise<void>
  >().mockResolvedValue(undefined);

  return peer;
}

describe('Netron Streams', () => {
  let netron: Netron;
  let peer: RemotePeer;

  beforeEach(async () => {
    netron = await Netron.create({ streamTimeout: 100 }); // таймаут поменьше для скорости тестов
    peer = new RemotePeer(new WebSocket('ws://localhost'), netron);
    peer.sendStreamChunk = jest.fn<(streamId: number, chunk: any, offset: number, isLast: boolean, isError: boolean) => Promise<void>>().mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await netron.stop();
    jest.restoreAllMocks();
  });

  afterAll(() => {
    jest.resetAllMocks();
  });

  it('NetronReadableStream - should correctly handle ordered packets', (done) => {
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

    packets.forEach(packet => stream.onPacket(packet));
  });

  it('should correctly handle unordered packets', async () => {
    const stream = new NetronReadableStream({ peer, streamId: 2 });

    const dataHandler = jest.fn();
    stream.on('data', dataHandler);

    // Отправляем пакеты в неправильном порядке
    stream.onPacket({ streamIndex: 2, data: 'chunk-2', isLastChunk: () => false } as any);
    stream.onPacket({ streamIndex: 0, data: 'chunk-0', isLastChunk: () => false } as any);
    stream.onPacket({ streamIndex: 1, data: 'chunk-1', isLastChunk: () => false } as any);
    stream.onPacket({ streamIndex: 3, data: 'chunk-3', isLastChunk: () => true } as any);

    await new Promise(resolve => stream.on('end', resolve));

    expect(dataHandler).toHaveBeenNthCalledWith(1, 'chunk-0');
    expect(dataHandler).toHaveBeenNthCalledWith(2, 'chunk-1');
    expect(dataHandler).toHaveBeenNthCalledWith(3, 'chunk-2');
    expect(dataHandler).toHaveBeenNthCalledWith(4, 'chunk-3');
  });

  it('should handle buffer overflow correctly', (done) => {
    const stream = new NetronReadableStream({ peer, streamId: 3 });

    const errorHandler = jest.fn();
    stream.on('error', errorHandler);

    // Заполняем буфер сверх MAX_BUFFER_SIZE
    for (let i = 0; i <= 10_001; i++) {
      stream.onPacket({ streamIndex: i + 1, data: `chunk-${i}`, isLastChunk: () => false } as any);
    }

    stream.on('close', () => {
      expect(errorHandler).toHaveBeenCalled();
      const error = errorHandler.mock.calls[0]?.[0] as Error | undefined;

      expect(error).toBeDefined();
      expect(error).toEqual(expect.any(Error));
      expect(error!.message).toMatch(/Buffer overflow/);

      done();
    });
  });

  it('should handle inactivity timeout correctly', (done) => {
    const streamTimeout = 50; // 50 ms для ускорения теста
    const peerWithTimeout = new RemotePeer({} as WebSocket, netron, 'test-peer');
    peerWithTimeout.netron.options = { streamTimeout };

    const stream = new NetronReadableStream({ peer: peerWithTimeout, streamId: 4 });

    const errorHandler = jest.fn();
    stream.on('error', errorHandler);

    stream.on('close', () => {
      expect(errorHandler).toHaveBeenCalled();
      const error = errorHandler.mock.calls[0]?.[0] as Error | undefined;

      expect(error).toBeDefined();
      expect(error!.message).toMatch(new RegExp(`inactive for ${streamTimeout}ms`));

      done();
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

    stream.onPacket({ streamIndex: 0, data: 1, isLastChunk: () => false } as Packet);
    stream.onPacket({ streamIndex: 1, data: 2, isLastChunk: () => false } as Packet);
    stream.onPacket({ streamIndex: 2, data: 3, isLastChunk: () => true } as Packet);
  }, 10000);

  it('should close stream after inactivity timeout', async () => {
    const streamTimeout = 5000; // 5 секунд
    peer.netron.options = { streamTimeout };

    const stream = new NetronReadableStream({ peer, streamId: 6 });
    const errorHandler = jest.fn();

    stream.on('error', errorHandler);

    stream.onPacket({ streamIndex: 0, data: 'initial', isLastChunk: () => false } as Packet);

    expect(stream.destroyed).toBe(false);

    await delay(streamTimeout + 1000);

    expect(errorHandler).toHaveBeenCalledTimes(1);

    const error = errorHandler.mock.calls[0]?.[0] as Error;
    expect(error).toEqual(expect.any(Error));
    expect(error.message).toMatch(/inactive/);
    expect(stream.destroyed).toBe(true);
  }, 10000);

  it('should handle errors correctly', async () => {
    const stream = new NetronReadableStream({ peer, streamId: 7 });
    const errorHandler = jest.spyOn(stream.peer.logger, 'error').mockImplementation(() => { });

    expect(stream.destroyed).toBe(false);

    const error = new Error('Test error');
    stream.destroy(error);

    await delay(100);

    expect(stream.destroyed).toBe(true);
    expect(errorHandler).toHaveBeenCalledWith(`NetronReadableStream (id: ${stream.id}) error:`, error.message);
    expect(peer.readableStreams.has(stream.id)).toBe(false);

    errorHandler.mockRestore();
  });

  it('NetronWritableStream should correctly send data in sequence', async () => {
    const peer1 = createMockRemotePeer();
    peer1.sendStreamChunk = jest.fn<
      (streamId: number, chunk: any, offset: number, isLast: boolean, isLive: boolean) => Promise<void>
    >().mockResolvedValue(undefined);

    const writableStream = new NetronWritableStream({ peer: peer1, isLive: false });

    writableStream.write('chunk-1');
    writableStream.write('chunk-2');
    writableStream.end('chunk-3');

    await new Promise((resolve) => writableStream.on('finish', resolve));

    expect(peer1.sendStreamChunk).toHaveBeenCalledTimes(4);

    expect(peer1.sendStreamChunk).toHaveBeenNthCalledWith(1, writableStream.id, 'chunk-1', 0, false, false);
    expect(peer1.sendStreamChunk).toHaveBeenNthCalledWith(2, writableStream.id, 'chunk-2', 1, false, false);
    expect(peer1.sendStreamChunk).toHaveBeenNthCalledWith(3, writableStream.id, 'chunk-3', 2, false, false);
    expect(peer1.sendStreamChunk).toHaveBeenNthCalledWith(4, writableStream.id, null, 3, true, false); // последний вызов с null и isLast=true
  });

  it('should handle error from sendStreamChunk correctly', async () => {
    const peer1 = createMockRemotePeer();
    const error = new Error('Failed to send chunk');

    peer1.sendStreamChunk = jest.fn<
      (streamId: number, chunk: any, index: number, isLast: boolean, isLive: boolean) => Promise<void>
    >()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(undefined);

    const writableStream = new NetronWritableStream({ peer: peer1, isLive: false });

    const errorHandler = jest.fn();
    writableStream.on('error', errorHandler);

    writableStream.write('chunk-1');

    await new Promise((resolve) => writableStream.on('close', resolve));

    expect(peer1.sendStreamChunk).toHaveBeenCalledTimes(2);
    expect(peer1.sendStreamChunk).toHaveBeenNthCalledWith(1, writableStream.id, 'chunk-1', 0, false, false);
    expect(peer1.sendStreamChunk).toHaveBeenNthCalledWith(2, writableStream.id, null, 1, true, false);

    expect(errorHandler).toHaveBeenCalledTimes(1);
    expect(errorHandler).toHaveBeenCalledWith(error);
  });

  it('should correctly handle errors on stream destroy', async () => {
    const peer1 = createMockRemotePeer();
    const stream = new NetronWritableStream({ peer: peer1 });

    const error = new Error('Destroy error');
    const errorHandler = jest.spyOn(stream.peer.logger, 'error').mockImplementation(() => { });

    stream.destroy(error);

    await new Promise((resolve) => stream.on('close', resolve));

    expect(errorHandler).toHaveBeenCalledWith(
      expect.stringContaining(`NetronWritableStream (id: ${stream.id}) error:`),
      'Destroy error'
    );

    expect(peer1.writableStreams.has(stream.id)).toBeFalsy();

    errorHandler.mockRestore();
  });

  it('should correctly pipe data from AsyncIterable source', async () => {
    const peer1 = createMockRemotePeer();
    const writableStream = new NetronWritableStream({ peer: peer1 });

    const asyncIterable = {
      async *[Symbol.asyncIterator]() {
        yield 'chunk-async-1';
        yield 'chunk-async-2';
        yield 'chunk-async-3';
      },
    };

    peer.sendStreamChunk = jest.fn<
      (streamId: number, chunk: any, index: number, isLast: boolean, isLive: boolean) => Promise<void>
    >().mockResolvedValue(undefined);

    await writableStream.pipeFrom(asyncIterable);

    expect(peer1.sendStreamChunk).toHaveBeenCalledTimes(4);

    expect(peer1.sendStreamChunk).toHaveBeenNthCalledWith(1, writableStream.id, 'chunk-async-1', 0, false, false);
    expect(peer1.sendStreamChunk).toHaveBeenNthCalledWith(2, writableStream.id, 'chunk-async-2', 1, false, false);
    expect(peer1.sendStreamChunk).toHaveBeenNthCalledWith(3, writableStream.id, 'chunk-async-3', 2, false, false);
    expect(peer1.sendStreamChunk).toHaveBeenNthCalledWith(4, writableStream.id, null, 3, true, false);
  });
});
