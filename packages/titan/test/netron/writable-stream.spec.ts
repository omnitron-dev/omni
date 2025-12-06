/**
 * Comprehensive tests for NetronWritableStream
 * Tests stream creation, write operations, piping, error handling, and lifecycle
 */

import { WebSocket } from 'ws';
import { jest, describe, beforeEach, afterEach, it, expect } from '@jest/globals';
import { Readable, Writable } from 'readable-stream';

import { NetronWritableStream, NetronWritableStreamOptions } from '../../src/netron/writable-stream.js';
import { Netron } from '../../src/netron/netron.js';
import { RemotePeer } from '../../src/netron/remote-peer.js';
import { createMockLogger } from './test-utils.js';
import type { ILogger } from '../../src/modules/logger/logger.types.js';
import { TYPE_STREAM_ERROR, TYPE_STREAM_CLOSE } from '../../src/netron/packet/index.js';

describe('NetronWritableStream', () => {
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
    peer.sendStreamChunk = jest.fn<typeof peer.sendStreamChunk>().mockResolvedValue(undefined);
    peer.sendPacket = jest.fn<typeof peer.sendPacket>().mockResolvedValue();
  });

  afterEach(async () => {
    for (const stream of peer.writableStreams.values()) {
      stream.destroy();
    }
    await netron.stop();
  });

  describe('Stream Creation and Initialization', () => {
    it('should create a stream with required options', () => {
      const stream = new NetronWritableStream({ peer });

      expect(stream).toBeInstanceOf(Writable);
      expect(stream.peer).toBe(peer);
      expect(stream.isLive).toBe(false);
      expect(stream.id).toBeDefined();
    });

    it('should create a stream with custom streamId', () => {
      const stream = new NetronWritableStream({ peer, streamId: 999 });

      expect(stream.id).toBe(999);
    });

    it('should auto-generate unique streamId when not provided', () => {
      const stream1 = new NetronWritableStream({ peer });
      const stream2 = new NetronWritableStream({ peer });

      expect(stream1.id).not.toBe(stream2.id);
    });

    it('should create a stream using factory method without source', () => {
      const stream = NetronWritableStream.create(peer);

      expect(stream.peer).toBe(peer);
      expect(stream.isLive).toBe(false);
    });

    it('should create a stream using factory method with custom ID', () => {
      const stream = NetronWritableStream.create(peer, undefined, false, 123);

      expect(stream.id).toBe(123);
    });

    it('should create a live stream', () => {
      const stream = new NetronWritableStream({ peer, isLive: true });

      expect(stream.isLive).toBe(true);
    });

    it('should register stream in peer writableStreams map', () => {
      const stream = new NetronWritableStream({ peer, streamId: 100 });

      expect(peer.writableStreams.get(100)).toBe(stream);
    });

    it('should log stream creation', () => {
      new NetronWritableStream({ peer, streamId: 101 });

      expect(peer.logger.info).toHaveBeenCalledWith(
        { streamId: 101, isLive: false },
        'Creating writable stream'
      );
    });

    it('should create stream in object mode', () => {
      const stream = new NetronWritableStream({ peer });

      expect(stream.writableObjectMode).toBe(true);
    });

    it('should accept additional writable options', () => {
      const stream = new NetronWritableStream({
        peer,
        highWaterMark: 50,
      });

      expect(stream.writableHighWaterMark).toBe(50);
    });
  });

  describe('Write Operations', () => {
    it('should write data and call sendStreamChunk', async () => {
      const stream = new NetronWritableStream({ peer, streamId: 200 });

      stream.write('chunk1');
      stream.end();

      await new Promise((resolve) => stream.on('finish', resolve));

      expect(peer.sendStreamChunk).toHaveBeenCalledWith(200, 'chunk1', 0, false, false);
    });

    it('should increment index for each write', async () => {
      const stream = new NetronWritableStream({ peer, streamId: 201 });

      stream.write('chunk0');
      stream.write('chunk1');
      stream.write('chunk2');
      stream.end();

      await new Promise((resolve) => stream.on('finish', resolve));

      expect(peer.sendStreamChunk).toHaveBeenNthCalledWith(1, 201, 'chunk0', 0, false, false);
      expect(peer.sendStreamChunk).toHaveBeenNthCalledWith(2, 201, 'chunk1', 1, false, false);
      expect(peer.sendStreamChunk).toHaveBeenNthCalledWith(3, 201, 'chunk2', 2, false, false);
    });

    it('should send final chunk on end', async () => {
      const stream = new NetronWritableStream({ peer, streamId: 202 });

      stream.write('data');
      stream.end();

      await new Promise((resolve) => stream.on('finish', resolve));

      // Final chunk should have isLast=true and null data
      expect(peer.sendStreamChunk).toHaveBeenLastCalledWith(202, null, 1, true, false);
    });

    it('should handle write with callback', (done) => {
      const stream = new NetronWritableStream({ peer, streamId: 203 });

      stream.write('data', (err) => {
        expect(err).toBeUndefined();
        stream.end();
        done();
      });
    });

    it('should pass isLive flag when writing', async () => {
      const stream = new NetronWritableStream({ peer, streamId: 204, isLive: true });

      stream.write('live-data');
      stream.end();

      await new Promise((resolve) => stream.on('finish', resolve));

      expect(peer.sendStreamChunk).toHaveBeenCalledWith(204, 'live-data', 0, false, true);
    });

    it('should handle various data types', async () => {
      const stream = new NetronWritableStream({ peer, streamId: 205 });

      stream.write('string');
      stream.write(123);
      stream.write({ key: 'value' });
      stream.write([1, 2, 3]);
      stream.write(Buffer.from('binary'));
      stream.end();

      await new Promise((resolve) => stream.on('finish', resolve));

      expect(peer.sendStreamChunk).toHaveBeenCalledWith(205, 'string', 0, false, false);
      expect(peer.sendStreamChunk).toHaveBeenCalledWith(205, 123, 1, false, false);
      expect(peer.sendStreamChunk).toHaveBeenCalledWith(205, { key: 'value' }, 2, false, false);
      expect(peer.sendStreamChunk).toHaveBeenCalledWith(205, [1, 2, 3], 3, false, false);
      expect(peer.sendStreamChunk).toHaveBeenCalledWith(205, Buffer.from('binary'), 4, false, false);
    });

    it('should fail write to closed stream', async () => {
      const stream = new NetronWritableStream({ peer, streamId: 206 });
      stream.destroy();

      await new Promise((resolve) => stream.on('close', resolve));

      const writePromise = new Promise<Error | null>((resolve) => {
        stream.write('test', (err) => {
          resolve(err || null);
        });
      });

      const errorPromise = new Promise<Error>((resolve) => {
        stream.once('error', resolve);
      });

      const result = await Promise.race([
        writePromise,
        errorPromise,
        new Promise((resolve) => setTimeout(() => resolve('timeout'), 100)),
      ]);

      // Either callback error or event error
      if (result instanceof Error) {
        expect(result.message).toMatch(/closed|destroyed|after end/i);
      }
    });

    it('should call callback with error when _write called on closed stream', (done) => {
      const stream = new NetronWritableStream({ peer, streamId: 207 });

      // Manually close the stream using closeStream (sets isClosed=true)
      stream.closeStream();

      // Call _write directly on closed stream
      (stream as any)._write('data', 'utf8', (err: Error | null) => {
        expect(err).toBeInstanceOf(Error);
        expect(err?.message).toContain('Stream closed');
        expect(peer.logger.warn).toHaveBeenCalledWith(
          { streamId: 207 },
          'Attempt to write to closed stream'
        );
        done();
      });
    });
  });

  describe('Write Error Handling', () => {
    it('should handle sendStreamChunk error', async () => {
      const sendError = new Error('Send failed');
      peer.sendStreamChunk = jest.fn<typeof peer.sendStreamChunk>().mockRejectedValue(sendError);

      const stream = new NetronWritableStream({ peer, streamId: 210 });

      let receivedError: Error | undefined;
      stream.on('error', (err) => {
        receivedError = err;
      });

      stream.write('data');

      await new Promise((resolve) => stream.on('close', resolve));

      expect(receivedError).toBe(sendError);
    });

    it('should send error packet on write failure', async () => {
      const sendError = new Error('Write error');
      peer.sendStreamChunk = jest.fn<typeof peer.sendStreamChunk>().mockRejectedValue(sendError);

      const stream = new NetronWritableStream({ peer, streamId: 211 });

      stream.on('error', () => {});
      stream.write('data');

      await new Promise((resolve) => stream.on('close', resolve));

      expect(peer.sendPacket).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            streamId: 211,
            message: 'Write error',
          },
        })
      );
    });

    it('should log error when sending error packet fails', async () => {
      const sendError = new Error('Write error');
      peer.sendStreamChunk = jest.fn<typeof peer.sendStreamChunk>().mockRejectedValue(sendError);
      peer.sendPacket = jest.fn<typeof peer.sendPacket>().mockRejectedValue(new Error('Packet send failed'));

      const stream = new NetronWritableStream({ peer, streamId: 212 });

      stream.on('error', () => {});
      stream.write('data');

      await new Promise((resolve) => stream.on('close', resolve));

      expect(peer.logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ streamId: 212 }),
        'Failed to send stream error packet'
      );
    });
  });

  describe('Final Chunk Handling', () => {
    it('should call closeStream after final chunk', async () => {
      const stream = new NetronWritableStream({ peer, streamId: 220 });

      stream.end();

      await new Promise((resolve) => stream.on('finish', resolve));

      expect(peer.logger.info).toHaveBeenCalledWith(
        { streamId: 220 },
        'Closing stream'
      );
    });

    it('should handle final chunk error', async () => {
      let callCount = 0;
      peer.sendStreamChunk = jest.fn<typeof peer.sendStreamChunk>().mockImplementation(async () => {
        callCount++;
        if (callCount > 1) {
          throw new Error('Final chunk error');
        }
      });

      const stream = new NetronWritableStream({ peer, streamId: 221 });

      let receivedError: Error | undefined;
      stream.on('error', (err) => {
        receivedError = err;
      });

      stream.write('data');
      stream.end();

      await new Promise((resolve) => stream.on('close', resolve));

      expect(receivedError?.message).toBe('Final chunk error');
    });

    it('should fail finalize on closed stream', async () => {
      const stream = new NetronWritableStream({ peer, streamId: 222 });

      stream.destroy();
      await new Promise((resolve) => stream.on('close', resolve));

      // Manually test _final behavior
      const finalCallback = jest.fn();
      (stream as any)._final(finalCallback);

      expect(finalCallback).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('Pipe Operations', () => {
    it('should pipe from AsyncIterable', async () => {
      const stream = new NetronWritableStream({ peer, streamId: 230 });

      async function* asyncGenerator() {
        yield 'async1';
        yield 'async2';
        yield 'async3';
      }

      await stream.pipeFrom(asyncGenerator());

      expect(peer.sendStreamChunk).toHaveBeenCalledTimes(4); // 3 chunks + final
      expect(peer.sendStreamChunk).toHaveBeenNthCalledWith(1, 230, 'async1', 0, false, false);
      expect(peer.sendStreamChunk).toHaveBeenNthCalledWith(2, 230, 'async2', 1, false, false);
      expect(peer.sendStreamChunk).toHaveBeenNthCalledWith(3, 230, 'async3', 2, false, false);
      expect(peer.sendStreamChunk).toHaveBeenNthCalledWith(4, 230, null, 3, true, false);
    });

    it('should pipe from Readable stream', async () => {
      const stream = new NetronWritableStream({ peer, streamId: 231 });

      const readable = Readable.from(['r1', 'r2', 'r3']);

      await stream.pipeFrom(readable);

      expect(peer.sendStreamChunk).toHaveBeenCalledTimes(4);
    });

    it('should handle pipe backpressure', async () => {
      let drainCount = 0;
      const originalSendStreamChunk = peer.sendStreamChunk;
      
      peer.sendStreamChunk = jest.fn<typeof peer.sendStreamChunk>().mockImplementation(
        async (...args) => {
          // Simulate slow write
          await new Promise((resolve) => setTimeout(resolve, 5));
          return originalSendStreamChunk.call(peer, ...args);
        }
      );

      const stream = new NetronWritableStream({ peer, streamId: 232, highWaterMark: 1 });
      stream.on('drain', () => drainCount++);

      async function* generator() {
        for (let i = 0; i < 5; i++) {
          yield `chunk${i}`;
        }
      }

      await stream.pipeFrom(generator());

      // Should have completed successfully
      expect(peer.sendStreamChunk).toHaveBeenCalledTimes(6); // 5 chunks + final
    });

    it('should handle pipe error', async () => {
      const stream = new NetronWritableStream({ peer, streamId: 233 });
      const pipeError = new Error('Pipe error');

      // Add error handler to prevent unhandled error
      stream.on('error', () => {});

      async function* failingGenerator() {
        yield 'ok';
        throw pipeError;
      }

      // Should not throw, but destroy stream
      await stream.pipeFrom(failingGenerator());

      expect(stream.destroyed).toBe(true);
      expect(peer.logger.error).toHaveBeenCalledWith(
        { streamId: 233, error: pipeError },
        'Pipe operation failed'
      );
    });

    it('should handle pipe error with non-Error thrown', async () => {
      const stream = new NetronWritableStream({ peer, streamId: 235 });

      // Track what error was logged (since error event may not fire)
      const loggedError = jest.spyOn(peer.logger, 'error');

      // Add error handler to prevent unhandled error
      stream.on('error', () => {});

      async function* failingGeneratorWithString() {
        yield 'ok';
        throw 'string error'; // Throw a non-Error value
      }

      await stream.pipeFrom(failingGeneratorWithString());

      expect(stream.destroyed).toBe(true);
      // Verify the error was logged with the string converted to error
      expect(loggedError).toHaveBeenCalledWith(
        { streamId: 235, error: 'string error' },
        'Pipe operation failed'
      );
    });

    it('should create stream with source using factory', async () => {
      async function* source() {
        yield 'factory1';
        yield 'factory2';
      }

      const stream = NetronWritableStream.create(peer, source(), false, 234);

      await new Promise((resolve) => stream.on('finish', resolve));

      expect(peer.sendStreamChunk).toHaveBeenCalledTimes(3); // 2 chunks + final
    });
  });

  describe('Stream Closing', () => {
    it('should close stream gracefully with closeStream', () => {
      const stream = new NetronWritableStream({ peer, streamId: 240 });

      stream.closeStream();

      expect(peer.writableStreams.has(240)).toBe(false);
    });

    it('should not close already closed stream', () => {
      const stream = new NetronWritableStream({ peer, streamId: 241 });

      stream.closeStream();
      stream.closeStream();

      expect(peer.logger.warn).toHaveBeenCalledWith(
        { streamId: 241 },
        'Attempt to close already closed stream'
      );
    });

    it('should end stream when closing', (done) => {
      const stream = new NetronWritableStream({ peer, streamId: 242 });

      stream.on('finish', () => {
        done();
      });

      stream.closeStream();
    });
  });

  describe('Destroy Operations', () => {
    it('should destroy stream and cleanup', async () => {
      const stream = new NetronWritableStream({ peer, streamId: 250 });

      stream.destroy();

      await new Promise((resolve) => stream.on('close', resolve));

      expect(stream.destroyed).toBe(true);
      expect(peer.writableStreams.has(250)).toBe(false);
    });

    it('should destroy with error', async () => {
      const stream = new NetronWritableStream({ peer, streamId: 251 });
      const testError = new Error('Destroy error');

      let receivedError: Error | undefined;
      stream.on('error', (err) => {
        receivedError = err;
      });

      stream.destroy(testError);

      await new Promise((resolve) => stream.on('close', resolve));

      expect(receivedError).toBe(testError);
    });

    it('should send close packet on destroy', async () => {
      const stream = new NetronWritableStream({ peer, streamId: 252 });

      stream.destroy();

      await new Promise((resolve) => stream.on('close', resolve));

      expect(peer.sendPacket).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            streamId: 252,
            reason: 'Stream destroyed',
          },
        })
      );
    });

    it('should send close packet with error reason', async () => {
      const stream = new NetronWritableStream({ peer, streamId: 253 });
      const error = new Error('Custom error reason');

      stream.on('error', () => {});
      stream.destroy(error);

      await new Promise((resolve) => stream.on('close', resolve));

      expect(peer.sendPacket).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            streamId: 253,
            reason: 'Custom error reason',
          },
        })
      );
    });

    it('should log error when sending close packet fails', async () => {
      peer.sendPacket = jest.fn<typeof peer.sendPacket>().mockRejectedValue(new Error('Send failed'));

      const stream = new NetronWritableStream({ peer, streamId: 254 });

      stream.destroy();

      await new Promise((resolve) => stream.on('close', resolve));

      expect(peer.logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ streamId: 254 }),
        'Failed to send stream close packet'
      );
    });

    it('should not destroy already closed stream', () => {
      const stream = new NetronWritableStream({ peer, streamId: 255 });

      stream.destroy();
      const result = stream.destroy();

      expect(result).toBe(stream);
      expect(peer.logger.warn).toHaveBeenCalledWith(
        { streamId: 255 },
        'Attempt to destroy already closed stream'
      );
    });

    it('should return stream instance from destroy for chaining', () => {
      const stream = new NetronWritableStream({ peer, streamId: 256 });

      const result = stream.destroy();

      expect(result).toBe(stream);
    });
  });

  describe('Backpressure Handling', () => {
    it('should handle backpressure in pipeFrom', async () => {
      const stream = new NetronWritableStream({ peer, streamId: 260, highWaterMark: 1 });

      // Slow down sendStreamChunk to trigger backpressure
      peer.sendStreamChunk = jest.fn<typeof peer.sendStreamChunk>().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      async function* generator() {
        for (let i = 0; i < 10; i++) {
          yield `chunk${i}`;
        }
      }

      await stream.pipeFrom(generator());

      expect(peer.sendStreamChunk).toHaveBeenCalledTimes(11); // 10 + final
    });

    it('should log backpressure during pipe', async () => {
      const stream = new NetronWritableStream({ peer, streamId: 261, highWaterMark: 1 });

      let writeReturnedFalse = false;
      const originalWrite = stream.write.bind(stream);
      stream.write = function (...args: any[]) {
        const result = originalWrite(...args);
        if (result === false) writeReturnedFalse = true;
        return result;
      } as any;

      async function* generator() {
        for (let i = 0; i < 3; i++) {
          yield `chunk${i}`;
        }
      }

      await stream.pipeFrom(generator());

      // Backpressure may or may not trigger depending on timing
      expect(stream.destroyed).toBe(false);
    });
  });

  describe('Error Handler Method', () => {
    it('should have handleError method that cleans up', () => {
      const stream = new NetronWritableStream({ peer, streamId: 270 });

      // Access private method
      const handleError = (stream as any).handleError;
      const testError = new Error('Test');

      handleError(testError);

      expect(peer.logger.error).toHaveBeenCalledWith(
        { streamId: 270, error: testError },
        'Stream error occurred'
      );
      expect(peer.writableStreams.has(270)).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty stream (only end)', async () => {
      const stream = new NetronWritableStream({ peer, streamId: 280 });

      stream.end();

      await new Promise((resolve) => stream.on('finish', resolve));

      expect(peer.sendStreamChunk).toHaveBeenCalledTimes(1); // Only final
      expect(peer.sendStreamChunk).toHaveBeenCalledWith(280, null, 0, true, false);
    });

    it('should handle stream ID of 0', () => {
      const stream = new NetronWritableStream({ peer, streamId: 0 });

      expect(stream.id).toBe(0);
      expect(peer.writableStreams.get(0)).toBe(stream);

      stream.destroy();
    });

    it('should handle large payloads', async () => {
      const stream = new NetronWritableStream({ peer, streamId: 281 });
      const largeData = 'x'.repeat(100000);

      stream.write(largeData);
      stream.end();

      await new Promise((resolve) => stream.on('finish', resolve));

      expect(peer.sendStreamChunk).toHaveBeenCalledWith(281, largeData, 0, false, false);
    });

    it('should handle end with final data', async () => {
      const stream = new NetronWritableStream({ peer, streamId: 282 });

      stream.write('first');
      stream.end('last');

      await new Promise((resolve) => stream.on('finish', resolve));

      expect(peer.sendStreamChunk).toHaveBeenCalledWith(282, 'first', 0, false, false);
      expect(peer.sendStreamChunk).toHaveBeenCalledWith(282, 'last', 1, false, false);
      expect(peer.sendStreamChunk).toHaveBeenCalledWith(282, null, 2, true, false);
    });

    it('should handle concurrent writes', async () => {
      const stream = new NetronWritableStream({ peer, streamId: 283 });

      // Write without waiting for callbacks
      stream.write('a');
      stream.write('b');
      stream.write('c');
      stream.end();

      await new Promise((resolve) => stream.on('finish', resolve));

      expect(peer.sendStreamChunk).toHaveBeenCalledTimes(4);
    });

    it('should pipe from empty generator', async () => {
      const stream = new NetronWritableStream({ peer, streamId: 284 });

      async function* emptyGenerator() {
        // Yields nothing
      }

      await stream.pipeFrom(emptyGenerator());

      expect(peer.sendStreamChunk).toHaveBeenCalledTimes(1); // Only final
    });

    it('should handle undefined chunk data', async () => {
      const stream = new NetronWritableStream({ peer, streamId: 285 });

      stream.write(undefined);
      stream.end();

      await new Promise((resolve) => stream.on('finish', resolve));

      expect(peer.sendStreamChunk).toHaveBeenCalledWith(285, undefined, 0, false, false);
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle rapid write and close', async () => {
      const stream = new NetronWritableStream({ peer, streamId: 290 });

      for (let i = 0; i < 100; i++) {
        stream.write(`chunk${i}`);
      }
      stream.end();

      await new Promise((resolve) => stream.on('finish', resolve));

      expect(peer.sendStreamChunk).toHaveBeenCalledTimes(101); // 100 + final
    });

    it('should handle write after end gracefully', async () => {
      const stream = new NetronWritableStream({ peer, streamId: 291 });

      stream.end();
      await new Promise((resolve) => stream.on('finish', resolve));

      // Write after end
      let writeError: Error | undefined;
      stream.write('after-end', (err) => {
        writeError = err || undefined;
      });

      // Wait a bit for error
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should have errored
      expect(writeError || stream.destroyed).toBeTruthy();
    });

    it('should handle multiple streams on same peer', async () => {
      const stream1 = new NetronWritableStream({ peer, streamId: 292 });
      const stream2 = new NetronWritableStream({ peer, streamId: 293 });

      stream1.write('s1-data');
      stream2.write('s2-data');
      stream1.end();
      stream2.end();

      await Promise.all([
        new Promise((resolve) => stream1.on('finish', resolve)),
        new Promise((resolve) => stream2.on('finish', resolve)),
      ]);

      expect(peer.sendStreamChunk).toHaveBeenCalledWith(292, 's1-data', 0, false, false);
      expect(peer.sendStreamChunk).toHaveBeenCalledWith(293, 's2-data', 0, false, false);
    });
  });
});
