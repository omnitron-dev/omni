/**
 * Data Streaming and CDC Tests
 *
 * Comprehensive tests for:
 * - Stream processing with backpressure handling
 * - Windowing operations (tumbling, sliding, session windows)
 * - Stream transformations (map, filter, reduce, aggregate)
 * - Stream joins (inner, left, right)
 * - Exactly-once/at-least-once delivery semantics
 */

import 'reflect-metadata';
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { Readable, Writable } from 'stream';
import {
  StreamProcessor,
  WindowManager,
  BackpressureHandler,
  StreamJoiner,
  StreamPipeline,
  CDCConnector,
  EnrichmentProcessor,
  DeduplicationProcessor,
  Aggregations,
  createDataPipeline,
  type ChangeEvent,
  type ProcessContext,
  type WindowConfig,
  type BackpressureConfig,
  type StreamJoinConfig,
  type WindowResult,
  type JoinResult,
  type StreamSource,
  type StreamSink,
  type DeliverySemantics,
  type AggregateFunction,
} from '../../../../src/modules/pm/enterprise/data-streaming.js';

// Mock logger
const mockLogger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
};

// Test stream processor
class TestProcessor extends StreamProcessor<{ id: string; value: number }, { id: string; result: number }> {
  async process(
    element: { id: string; value: number },
    context: ProcessContext
  ): Promise<{ id: string; result: number }> {
    this.updateWatermark(context.timestamp);
    return { id: element.id, result: element.value * 2 };
  }
}

// Test stream source
class TestStreamSource implements StreamSource<{ id: string; value: number }> {
  private data: Array<{ id: string; value: number }>;
  private index = 0;

  constructor(data: Array<{ id: string; value: number }>) {
    this.data = data;
  }

  createStream(): Readable {
    const data = this.data;
    let index = 0;
    return new Readable({
      objectMode: true,
      read() {
        if (index < data.length) {
          this.push(data[index++]);
        } else {
          this.push(null);
        }
      },
    });
  }
}

// Test stream sink
class TestStreamSink<T> implements StreamSink<T> {
  public collected: T[] = [];

  createStream(): Writable {
    const collected = this.collected;
    return new Writable({
      objectMode: true,
      write(chunk: T, encoding, callback) {
        collected.push(chunk);
        callback();
      },
    });
  }
}

describe('Data Streaming', () => {
  describe('StreamProcessor', () => {
    let processor: TestProcessor;

    beforeEach(() => {
      processor = new TestProcessor();
    });

    it('should process elements correctly', async () => {
      const element = { id: '1', value: 10 };
      const context: ProcessContext = {
        streamId: 'test-stream',
        timestamp: Date.now(),
        watermark: 0,
        offset: 1,
      };

      const result = await processor.process(element, context);

      expect(result).toEqual({ id: '1', result: 20 });
    });

    it('should track watermark', async () => {
      const context: ProcessContext = {
        streamId: 'test-stream',
        timestamp: 1000,
        watermark: 0,
      };

      await processor.process({ id: '1', value: 5 }, context);

      expect(processor.getWatermark()).toBe(1000);
    });

    describe('Exactly-once semantics', () => {
      it('should prevent duplicate processing', async () => {
        processor.setDeliverySemantics('exactly-once');

        const element = { id: 'unique-1', value: 10 };
        const context: ProcessContext = {
          streamId: 'test-stream',
          timestamp: Date.now(),
          watermark: 0,
          offset: 1,
        };

        const result1 = await processor.processExactlyOnce(element, context);
        const result2 = await processor.processExactlyOnce(element, context);

        expect(result1).toEqual({ id: 'unique-1', result: 20 });
        expect(result2).toBeNull(); // Duplicate, filtered out
      });

      it('should checkpoint after processing', async () => {
        processor.setDeliverySemantics('exactly-once');

        const context: ProcessContext = {
          streamId: 'test-stream',
          timestamp: Date.now(),
          watermark: 0,
          offset: 5,
        };

        await processor.processExactlyOnce({ id: '1', value: 10 }, context);

        const checkpoints = processor.getCheckpoints();
        expect(checkpoints.has('test-stream')).toBe(true);
        expect(checkpoints.get('test-stream')?.offset).toBe(5);
      });

      it('should skip already processed offsets', async () => {
        processor.setDeliverySemantics('exactly-once');

        const context1: ProcessContext = {
          streamId: 'test-stream',
          timestamp: Date.now(),
          watermark: 0,
          offset: 10,
        };

        await processor.processExactlyOnce({ id: '1', value: 10 }, context1);

        // Try to process an older offset
        const context2: ProcessContext = {
          streamId: 'test-stream',
          timestamp: Date.now(),
          watermark: 0,
          offset: 5,
        };

        const result = await processor.processExactlyOnce({ id: '2', value: 20 }, context2);
        expect(result).toBeNull();
      });
    });

    describe('At-least-once semantics', () => {
      it('should allow reprocessing of same element', async () => {
        processor.setDeliverySemantics('at-least-once');

        const element = { id: 'repeat-1', value: 10 };
        const context: ProcessContext = {
          streamId: 'test-stream',
          timestamp: Date.now(),
          watermark: 0,
          offset: 1,
        };

        const result1 = await processor.processAtLeastOnce(element, context);
        const result2 = await processor.processAtLeastOnce(element, context);

        expect(result1).toEqual({ id: 'repeat-1', result: 20 });
        expect(result2).toEqual({ id: 'repeat-1', result: 20 });
      });
    });

    describe('Process with semantics', () => {
      it('should route to correct processing method based on semantics', async () => {
        const element = { id: 'test-1', value: 10 };
        const context: ProcessContext = {
          streamId: 'test-stream',
          timestamp: Date.now(),
          watermark: 0,
          offset: 1,
        };

        // Test exactly-once
        processor.setDeliverySemantics('exactly-once');
        const result1 = await processor.processWithSemantics(element, context);
        expect(result1).toEqual({ id: 'test-1', result: 20 });

        // Should be filtered as duplicate
        const result2 = await processor.processWithSemantics(element, context);
        expect(result2).toBeNull();
      });
    });

    it('should restore from checkpoint', async () => {
      const checkpoint = {
        streamId: 'restored-stream',
        position: 'pos-100',
        timestamp: Date.now(),
        offset: 100,
      };

      processor.restoreFromCheckpoint(checkpoint);

      const checkpoints = processor.getCheckpoints();
      expect(checkpoints.get('restored-stream')?.offset).toBe(100);
    });
  });

  describe('WindowManager', () => {
    describe('Tumbling Windows', () => {
      it('should group elements into non-overlapping windows', () => {
        const config: WindowConfig = {
          type: 'tumbling',
          size: 1000, // 1 second windows
        };

        const windowManager = new WindowManager<number>(config);
        const baseTime = Math.floor(Date.now() / 1000) * 1000; // Round to second

        // Add elements within the same window
        windowManager.add(1, baseTime + 100);
        windowManager.add(2, baseTime + 200);
        windowManager.add(3, baseTime + 300);

        // Force close all windows to get results
        const results = windowManager.closeAll();

        expect(results.length).toBe(1);
        expect(results[0].elements).toEqual([1, 2, 3]);
      });

      it('should create separate windows for different time ranges', () => {
        const config: WindowConfig = {
          type: 'tumbling',
          size: 1000,
        };

        const windowManager = new WindowManager<number>(config);
        const baseTime = Math.floor(Date.now() / 1000) * 1000;

        // Add elements to different windows
        windowManager.add(1, baseTime);
        windowManager.add(2, baseTime + 1500); // Different window

        const results = windowManager.closeAll();

        expect(results.length).toBe(2);
      });

      it('should key elements by custom key extractor', () => {
        const config: WindowConfig = {
          type: 'tumbling',
          size: 1000,
        };

        type KeyedElement = { key: string; value: number };
        const windowManager = new WindowManager<KeyedElement>(config, (e) => e.key);
        const baseTime = Math.floor(Date.now() / 1000) * 1000;

        windowManager.add({ key: 'A', value: 1 }, baseTime);
        windowManager.add({ key: 'B', value: 2 }, baseTime);
        windowManager.add({ key: 'A', value: 3 }, baseTime);

        const results = windowManager.closeAll();

        expect(results.length).toBe(2);
        const keyAWindow = results.find((r) => r.window.key === 'A');
        const keyBWindow = results.find((r) => r.window.key === 'B');

        expect(keyAWindow?.elements).toHaveLength(2);
        expect(keyBWindow?.elements).toHaveLength(1);
      });
    });

    describe('Sliding Windows', () => {
      it('should create overlapping windows', () => {
        const config: WindowConfig = {
          type: 'sliding',
          size: 1000,
          slide: 500, // 50% overlap
        };

        const windowManager = new WindowManager<number>(config);
        const baseTime = Math.floor(Date.now() / 500) * 500;

        // Add element - should be in 2 windows
        windowManager.add(1, baseTime + 250);

        const stats = windowManager.getStats();
        expect(stats.slidingWindows).toBeGreaterThanOrEqual(1);
      });

      it('should properly calculate window boundaries', () => {
        const config: WindowConfig = {
          type: 'sliding',
          size: 1000,
          slide: 500,
        };

        const windowManager = new WindowManager<number>(config);
        const baseTime = 1000; // Use fixed time for deterministic test

        windowManager.add(1, baseTime);

        const results = windowManager.closeAll();

        // Each result should have correct window boundaries
        for (const result of results) {
          expect(result.window.end - result.window.start).toBe(1000);
        }
      });
    });

    describe('Session Windows', () => {
      it('should group elements within session gap', () => {
        const config: WindowConfig = {
          type: 'session',
          size: 0, // Not used for session
          gap: 500, // 500ms gap
        };

        const windowManager = new WindowManager<number>(config);
        const baseTime = Date.now();

        // Add elements within session gap
        windowManager.add(1, baseTime);
        windowManager.add(2, baseTime + 100);
        windowManager.add(3, baseTime + 200);

        const results = windowManager.closeAll();

        expect(results.length).toBe(1);
        expect(results[0].elements).toEqual([1, 2, 3]);
      });

      it('should create new session after gap timeout', () => {
        const config: WindowConfig = {
          type: 'session',
          size: 0,
          gap: 100,
        };

        const windowManager = new WindowManager<number>(config);
        const baseTime = Date.now();

        // First session
        windowManager.add(1, baseTime);

        // After gap - new session
        const results = windowManager.add(2, baseTime + 200);

        // The first session should have been closed
        expect(results.length).toBe(1);
        expect(results[0].elements).toEqual([1]);

        // Close remaining
        const remaining = windowManager.closeAll();
        expect(remaining.length).toBe(1);
        expect(remaining[0].elements).toEqual([2]);
      });

      it('should extend session window on activity', () => {
        const config: WindowConfig = {
          type: 'session',
          size: 0,
          gap: 500,
        };

        const windowManager = new WindowManager<number>(config);
        const baseTime = Date.now();

        windowManager.add(1, baseTime);
        windowManager.add(2, baseTime + 400); // Within gap, extends session

        const results = windowManager.closeAll();

        expect(results.length).toBe(1);
        expect(results[0].elements).toEqual([1, 2]);
        expect(results[0].window.end).toBe(baseTime + 400 + 500);
      });
    });

    describe('Window Statistics', () => {
      it('should track active windows', () => {
        const config: WindowConfig = {
          type: 'tumbling',
          size: 10000,
        };

        const windowManager = new WindowManager<number>(config);

        windowManager.add(1);
        windowManager.add(2);

        const stats = windowManager.getStats();
        expect(stats.activeWindows).toBeGreaterThanOrEqual(1);
        expect(stats.watermark).toBeGreaterThan(0);
      });
    });

    describe('Window Events', () => {
      it('should emit window:closed event', (done) => {
        const config: WindowConfig = {
          type: 'tumbling',
          size: 50, // Very short window for testing
        };

        const windowManager = new WindowManager<number>(config);

        windowManager.on('window:closed', (result: WindowResult<number>) => {
          expect(result.elements.length).toBeGreaterThan(0);
          done();
        });

        windowManager.add(1);

        // Wait for window to close
        setTimeout(() => {
          windowManager.closeAll();
        }, 100);
      });
    });
  });

  describe('BackpressureHandler', () => {
    describe('Drop Strategy', () => {
      it('should drop elements when buffer is full', async () => {
        const config: BackpressureConfig = {
          strategy: 'drop',
          bufferSize: 3,
          highWaterMark: 2,
          lowWaterMark: 1,
        };

        const handler = new BackpressureHandler<number>(config);

        await handler.push(1);
        await handler.push(2);
        await handler.push(3);

        // Buffer is full, should drop
        const pushed = await handler.push(4);

        expect(pushed).toBe(false);
        expect(handler.getDroppedCount()).toBe(1);
        expect(handler.size()).toBe(3);
      });

      it('should emit dropped event', async () => {
        const config: BackpressureConfig = {
          strategy: 'drop',
          bufferSize: 1,
        };

        const handler = new BackpressureHandler<number>(config);
        let droppedEvent: unknown = null;

        handler.on('dropped', (event) => {
          droppedEvent = event;
        });

        await handler.push(1);
        await handler.push(2); // Should be dropped

        expect(droppedEvent).not.toBeNull();
      });
    });

    describe('Latest Strategy', () => {
      it('should drop oldest element when buffer is full', async () => {
        const config: BackpressureConfig = {
          strategy: 'latest',
          bufferSize: 2,
        };

        const handler = new BackpressureHandler<number>(config);

        await handler.push(1);
        await handler.push(2);
        await handler.push(3); // Should drop 1, keep 2 and 3

        expect(handler.size()).toBe(2);
        expect(handler.pull()).toBe(2);
        expect(handler.pull()).toBe(3);
      });
    });

    describe('Block Strategy', () => {
      it('should wait for buffer to drain', async () => {
        const config: BackpressureConfig = {
          strategy: 'block',
          bufferSize: 2,
          highWaterMark: 2,
          lowWaterMark: 1,
          timeout: 1000,
        };

        const handler = new BackpressureHandler<number>(config);

        await handler.push(1);
        await handler.push(2);

        // Start draining in background
        setTimeout(() => {
          handler.pull();
        }, 50);

        // Should wait and eventually succeed
        const pushed = await handler.push(3);
        expect(pushed).toBe(true);
      });

      it('should timeout if buffer does not drain', async () => {
        const config: BackpressureConfig = {
          strategy: 'block',
          bufferSize: 2,
          highWaterMark: 2,
          timeout: 100, // Short timeout
        };

        const handler = new BackpressureHandler<number>(config);

        await handler.push(1);
        await handler.push(2);

        // Don't drain - should timeout
        const pushed = await handler.push(3);
        expect(pushed).toBe(false);
      });
    });

    describe('Pause/Resume', () => {
      it('should pause when high water mark is reached', async () => {
        const config: BackpressureConfig = {
          strategy: 'buffer',
          highWaterMark: 2,
          lowWaterMark: 1,
          bufferSize: 100,
        };

        const handler = new BackpressureHandler<number>(config);
        let pauseEmitted = false;

        handler.on('pause', () => {
          pauseEmitted = true;
        });

        await handler.push(1);
        expect(handler.isPaused()).toBe(false);

        await handler.push(2);
        expect(handler.isPaused()).toBe(true);
        expect(pauseEmitted).toBe(true);
      });

      it('should resume when low water mark is reached', async () => {
        const config: BackpressureConfig = {
          strategy: 'buffer',
          highWaterMark: 2,
          lowWaterMark: 1,
          bufferSize: 100,
        };

        const handler = new BackpressureHandler<number>(config);
        let resumeEmitted = false;

        handler.on('resume', () => {
          resumeEmitted = true;
        });

        await handler.push(1);
        await handler.push(2);

        expect(handler.isPaused()).toBe(true);

        handler.pull();
        expect(handler.isPaused()).toBe(false);
        expect(resumeEmitted).toBe(true);
      });
    });

    describe('Batch Operations', () => {
      it('should pull multiple elements', async () => {
        const config: BackpressureConfig = {
          strategy: 'buffer',
          bufferSize: 100,
        };

        const handler = new BackpressureHandler<number>(config);

        await handler.push(1);
        await handler.push(2);
        await handler.push(3);
        await handler.push(4);

        const batch = handler.pullBatch(3);
        expect(batch).toEqual([1, 2, 3]);
        expect(handler.size()).toBe(1);
      });
    });

    describe('Statistics', () => {
      it('should provide accurate statistics', async () => {
        const config: BackpressureConfig = {
          strategy: 'drop',
          bufferSize: 5,
          highWaterMark: 3,
          lowWaterMark: 1,
        };

        const handler = new BackpressureHandler<number>(config);

        await handler.push(1);
        await handler.push(2);

        const stats = handler.getStats();

        expect(stats.bufferSize).toBe(2);
        expect(stats.paused).toBe(false);
        expect(stats.dropped).toBe(0);
        expect(stats.highWaterMark).toBe(3);
        expect(stats.lowWaterMark).toBe(1);
      });
    });

    describe('Clear', () => {
      it('should clear buffer and resume', async () => {
        const config: BackpressureConfig = {
          strategy: 'buffer',
          highWaterMark: 2,
          lowWaterMark: 1,
          bufferSize: 100,
        };

        const handler = new BackpressureHandler<number>(config);

        await handler.push(1);
        await handler.push(2);
        await handler.push(3);

        expect(handler.isPaused()).toBe(true);

        handler.clear();

        expect(handler.size()).toBe(0);
        expect(handler.isPaused()).toBe(false);
      });
    });
  });

  describe('StreamJoiner', () => {
    describe('Inner Join', () => {
      it('should join matching elements', () => {
        type LeftElement = { id: string; leftValue: number };
        type RightElement = { id: string; rightValue: string };

        const config: StreamJoinConfig<LeftElement, RightElement> = {
          type: 'inner',
          leftKeyExtractor: (e) => e.id,
          rightKeyExtractor: (e) => e.id,
          windowSize: 10000,
        };

        const joiner = new StreamJoiner<LeftElement, RightElement>(config);

        // Add left element
        joiner.addLeft({ id: 'a', leftValue: 1 });

        // Add matching right element
        const results = joiner.addRight({ id: 'a', rightValue: 'one' });

        expect(results.length).toBe(1);
        expect(results[0].left?.leftValue).toBe(1);
        expect(results[0].right?.rightValue).toBe('one');
      });

      it('should not emit for non-matching elements', () => {
        type Elem = { id: string; value: number };

        const config: StreamJoinConfig<Elem, Elem> = {
          type: 'inner',
          leftKeyExtractor: (e) => e.id,
          rightKeyExtractor: (e) => e.id,
        };

        const joiner = new StreamJoiner<Elem, Elem>(config);

        joiner.addLeft({ id: 'a', value: 1 });
        const results = joiner.addRight({ id: 'b', value: 2 });

        expect(results.length).toBe(0);
      });
    });

    describe('Left Join', () => {
      it('should emit left element with null right when no match', () => {
        type Elem = { id: string; value: number };

        const config: StreamJoinConfig<Elem, Elem> = {
          type: 'left',
          leftKeyExtractor: (e) => e.id,
          rightKeyExtractor: (e) => e.id,
        };

        const joiner = new StreamJoiner<Elem, Elem>(config);

        const results = joiner.addLeft({ id: 'a', value: 1 });

        expect(results.length).toBe(1);
        expect(results[0].left?.value).toBe(1);
        expect(results[0].right).toBeNull();
      });
    });

    describe('Right Join', () => {
      it('should emit right element with null left when no match', () => {
        type Elem = { id: string; value: number };

        const config: StreamJoinConfig<Elem, Elem> = {
          type: 'right',
          leftKeyExtractor: (e) => e.id,
          rightKeyExtractor: (e) => e.id,
        };

        const joiner = new StreamJoiner<Elem, Elem>(config);

        const results = joiner.addRight({ id: 'b', value: 2 });

        expect(results.length).toBe(1);
        expect(results[0].right?.value).toBe(2);
        expect(results[0].left).toBeNull();
      });
    });

    describe('Full Outer Join', () => {
      it('should emit unmatched elements from both sides', () => {
        type Elem = { id: string; value: number };

        const config: StreamJoinConfig<Elem, Elem> = {
          type: 'full',
          leftKeyExtractor: (e) => e.id,
          rightKeyExtractor: (e) => e.id,
        };

        const joiner = new StreamJoiner<Elem, Elem>(config);

        const leftResults = joiner.addLeft({ id: 'a', value: 1 });
        const rightResults = joiner.addRight({ id: 'b', value: 2 });

        expect(leftResults.length).toBe(1);
        expect(leftResults[0].right).toBeNull();

        expect(rightResults.length).toBe(1);
        expect(rightResults[0].left).toBeNull();
      });
    });

    describe('Window Expiration', () => {
      it('should clean expired entries from buffers', () => {
        type Elem = { id: string; value: number };

        const config: StreamJoinConfig<Elem, Elem> = {
          type: 'inner',
          leftKeyExtractor: (e) => e.id,
          rightKeyExtractor: (e) => e.id,
          windowSize: 100, // 100ms window
        };

        const joiner = new StreamJoiner<Elem, Elem>(config);
        const baseTime = Date.now();

        // Add element at baseTime
        joiner.addLeft({ id: 'a', value: 1 }, baseTime);

        // Add element after window expires
        const results = joiner.addRight({ id: 'a', value: 2 }, baseTime + 200);

        // Left element should have expired, no join
        expect(results.length).toBe(0);
      });
    });

    describe('Multiple Matches', () => {
      it('should emit multiple results for multiple matches', () => {
        type Elem = { id: string; value: number };

        const config: StreamJoinConfig<Elem, Elem> = {
          type: 'inner',
          leftKeyExtractor: (e) => e.id,
          rightKeyExtractor: (e) => e.id,
        };

        const joiner = new StreamJoiner<Elem, Elem>(config);

        joiner.addLeft({ id: 'a', value: 1 });
        joiner.addLeft({ id: 'a', value: 2 });

        const results = joiner.addRight({ id: 'a', value: 100 });

        expect(results.length).toBe(2);
      });
    });

    describe('Statistics', () => {
      it('should track buffer sizes and keys', () => {
        type Elem = { id: string; value: number };

        const config: StreamJoinConfig<Elem, Elem> = {
          type: 'inner',
          leftKeyExtractor: (e) => e.id,
          rightKeyExtractor: (e) => e.id,
        };

        const joiner = new StreamJoiner<Elem, Elem>(config);

        joiner.addLeft({ id: 'a', value: 1 });
        joiner.addLeft({ id: 'b', value: 2 });
        joiner.addRight({ id: 'c', value: 3 });

        const stats = joiner.getStats();

        expect(stats.leftBufferSize).toBe(2);
        expect(stats.leftKeys).toBe(2);
        expect(stats.rightBufferSize).toBe(1);
        expect(stats.rightKeys).toBe(1);
      });
    });

    describe('Events', () => {
      it('should emit joined event', () => {
        type Elem = { id: string; value: number };

        const config: StreamJoinConfig<Elem, Elem> = {
          type: 'inner',
          leftKeyExtractor: (e) => e.id,
          rightKeyExtractor: (e) => e.id,
        };

        const joiner = new StreamJoiner<Elem, Elem>(config);
        let joinedEvent: JoinResult<Elem, Elem> | null = null;

        joiner.on('joined', (event: JoinResult<Elem, Elem>) => {
          joinedEvent = event;
        });

        joiner.addLeft({ id: 'a', value: 1 });
        joiner.addRight({ id: 'a', value: 2 });

        expect(joinedEvent).not.toBeNull();
        expect(joinedEvent?.key).toBe('a');
      });
    });

    describe('Clear', () => {
      it('should clear all buffers', () => {
        type Elem = { id: string; value: number };

        const config: StreamJoinConfig<Elem, Elem> = {
          type: 'inner',
          leftKeyExtractor: (e) => e.id,
          rightKeyExtractor: (e) => e.id,
        };

        const joiner = new StreamJoiner<Elem, Elem>(config);

        joiner.addLeft({ id: 'a', value: 1 });
        joiner.addRight({ id: 'b', value: 2 });

        joiner.clear();

        const stats = joiner.getStats();
        expect(stats.leftBufferSize).toBe(0);
        expect(stats.rightBufferSize).toBe(0);
      });
    });
  });

  describe('Aggregations', () => {
    describe('count', () => {
      it('should count elements', () => {
        const counter = Aggregations.count<string>();

        let acc = counter.init();
        acc = counter.add(acc, 'a');
        acc = counter.add(acc, 'b');
        acc = counter.add(acc, 'c');

        expect(counter.getResult(acc)).toBe(3);
      });

      it('should merge counts', () => {
        const counter = Aggregations.count<string>();

        const acc1 = counter.add(counter.add(counter.init(), 'a'), 'b');
        const acc2 = counter.add(counter.init(), 'c');

        const merged = counter.merge!(acc1, acc2);
        expect(merged).toBe(3);
      });
    });

    describe('sum', () => {
      it('should sum numbers', () => {
        const summer = Aggregations.sum();

        let acc = summer.init();
        acc = summer.add(acc, 10);
        acc = summer.add(acc, 20);
        acc = summer.add(acc, 30);

        expect(summer.getResult(acc)).toBe(60);
      });

      it('should merge sums', () => {
        const summer = Aggregations.sum();

        const acc1 = summer.add(summer.add(summer.init(), 10), 20);
        const acc2 = summer.add(summer.init(), 30);

        const merged = summer.merge!(acc1, acc2);
        expect(merged).toBe(60);
      });
    });

    describe('avg', () => {
      it('should compute average components', () => {
        const averager = Aggregations.avg();

        let acc = averager.init();
        acc = averager.add(acc, 10);
        acc = averager.add(acc, 20);
        acc = averager.add(acc, 30);

        const result = averager.getResult(acc);
        expect(result.sum).toBe(60);
        expect(result.count).toBe(3);
        expect(result.sum / result.count).toBe(20);
      });
    });

    describe('min', () => {
      it('should find minimum', () => {
        const minner = Aggregations.min();

        let acc = minner.init();
        acc = minner.add(acc, 50);
        acc = minner.add(acc, 10);
        acc = minner.add(acc, 30);

        expect(minner.getResult(acc)).toBe(10);
      });
    });

    describe('max', () => {
      it('should find maximum', () => {
        const maxxer = Aggregations.max();

        let acc = maxxer.init();
        acc = maxxer.add(acc, 10);
        acc = maxxer.add(acc, 50);
        acc = maxxer.add(acc, 30);

        expect(maxxer.getResult(acc)).toBe(50);
      });
    });

    describe('collect', () => {
      it('should collect elements into array', () => {
        const collector = Aggregations.collect<string>();

        let acc = collector.init();
        acc = collector.add(acc, 'a');
        acc = collector.add(acc, 'b');
        acc = collector.add(acc, 'c');

        expect(collector.getResult(acc)).toEqual(['a', 'b', 'c']);
      });

      it('should merge collections', () => {
        const collector = Aggregations.collect<string>();

        const acc1 = collector.add(collector.add(collector.init(), 'a'), 'b');
        const acc2 = collector.add(collector.init(), 'c');

        const merged = collector.merge!(acc1, acc2);
        expect(merged).toEqual(['a', 'b', 'c']);
      });
    });
  });

  describe('StreamPipeline', () => {
    describe('Basic Operations', () => {
      it('should map elements', async () => {
        const source = new TestStreamSource([
          { id: '1', value: 10 },
          { id: '2', value: 20 },
        ]);
        const sink = new TestStreamSink<{ id: string; doubled: number }>();

        const pipeline = createDataPipeline<{ id: string; value: number }>()
          .from(source)
          .map((e) => ({ id: e.id, doubled: e.value * 2 }))
          .to(sink);

        await pipeline.execute();

        expect(sink.collected).toEqual([
          { id: '1', doubled: 20 },
          { id: '2', doubled: 40 },
        ]);
      });

      it('should filter elements', async () => {
        const source = new TestStreamSource([
          { id: '1', value: 10 },
          { id: '2', value: 25 },
          { id: '3', value: 5 },
        ]);
        const sink = new TestStreamSink<{ id: string; value: number }>();

        const pipeline = createDataPipeline<{ id: string; value: number }>()
          .from(source)
          .filter((e) => e.value > 15)
          .to(sink);

        await pipeline.execute();

        expect(sink.collected).toEqual([{ id: '2', value: 25 }]);
      });

      it('should transform elements', async () => {
        const source = new TestStreamSource([{ id: '1', value: 10 }]);
        const sink = new TestStreamSink<string>();

        const pipeline = createDataPipeline<{ id: string; value: number }>()
          .from(source)
          .transform((e) => `${e.id}:${e.value}`)
          .to(sink);

        await pipeline.execute();

        expect(sink.collected).toEqual(['1:10']);
      });

      it('should reduce elements', async () => {
        const source = new TestStreamSource([
          { id: '1', value: 10 },
          { id: '2', value: 20 },
          { id: '3', value: 30 },
        ]);
        const sink = new TestStreamSink<number>();

        const pipeline = createDataPipeline<{ id: string; value: number }>()
          .from(source)
          .reduce((acc, e) => acc + e.value, 0)
          .to(sink);

        await pipeline.execute();

        // Reduce emits running total
        expect(sink.collected).toEqual([10, 30, 60]);
      });

      it('should flatMap elements', async () => {
        const source = new TestStreamSource([
          { id: '1', value: 2 },
          { id: '2', value: 3 },
        ]);
        const sink = new TestStreamSink<number>();

        const pipeline = createDataPipeline<{ id: string; value: number }>()
          .from(source)
          .flatMap((e) => Array(e.value).fill(e.value))
          .to(sink);

        await pipeline.execute();

        expect(sink.collected).toEqual([2, 2, 3, 3, 3]);
      });
    });

    describe('Aggregate Operation', () => {
      it('should aggregate with custom function', async () => {
        const source = new TestStreamSource([
          { id: '1', value: 10 },
          { id: '2', value: 20 },
          { id: '3', value: 30 },
        ]);
        const sink = new TestStreamSink<{ key: string; value: number }>();

        // Create a custom aggregation that extracts value from objects
        const sumValues: AggregateFunction<{ id: string; value: number }, number> = {
          init: () => 0,
          add: (acc, item) => acc + item.value,
          getResult: (acc) => acc,
          merge: (acc1, acc2) => acc1 + acc2,
        };

        const pipeline = createDataPipeline<{ id: string; value: number }>()
          .from(source)
          .aggregate(sumValues, () => '__all__')
          .to(sink);

        await pipeline.execute();

        expect(sink.collected[sink.collected.length - 1]).toEqual({
          key: '__all__',
          value: 60,
        });
      });

      it('should aggregate by key', async () => {
        const source = new TestStreamSource([
          { id: 'A', value: 10 },
          { id: 'B', value: 20 },
          { id: 'A', value: 30 },
        ]);
        const sink = new TestStreamSink<{ key: string; value: number }>();

        // Create a custom aggregation that extracts value from objects
        const sumValues: AggregateFunction<{ id: string; value: number }, number> = {
          init: () => 0,
          add: (acc, item) => acc + item.value,
          getResult: (acc) => acc,
          merge: (acc1, acc2) => acc1 + acc2,
        };

        const pipeline = createDataPipeline<{ id: string; value: number }>()
          .from(source)
          .aggregate(sumValues, (e) => e.id)
          .to(sink);

        await pipeline.execute();

        // Find final values for each key
        const lastByKey = new Map<string, number>();
        for (const item of sink.collected) {
          lastByKey.set(item.key, item.value);
        }

        expect(lastByKey.get('A')).toBe(40);
        expect(lastByKey.get('B')).toBe(20);
      });

      it('should use built-in count aggregation', async () => {
        const source = new TestStreamSource([
          { id: '1', value: 10 },
          { id: '2', value: 20 },
          { id: '3', value: 30 },
        ]);
        const sink = new TestStreamSink<{ key: string; value: number }>();

        const pipeline = createDataPipeline<{ id: string; value: number }>()
          .from(source)
          .aggregate(Aggregations.count(), () => '__all__')
          .to(sink);

        await pipeline.execute();

        expect(sink.collected[sink.collected.length - 1]).toEqual({
          key: '__all__',
          value: 3,
        });
      });
    });

    describe('Pipeline Chaining', () => {
      it('should chain multiple operations', async () => {
        const source = new TestStreamSource([
          { id: '1', value: 5 },
          { id: '2', value: 15 },
          { id: '3', value: 25 },
          { id: '4', value: 35 },
        ]);
        const sink = new TestStreamSink<string>();

        const pipeline = createDataPipeline<{ id: string; value: number }>()
          .from(source)
          .filter((e) => e.value > 10)
          .map((e) => ({ ...e, value: e.value * 2 }))
          .transform((e) => `${e.id}=${e.value}`)
          .to(sink);

        await pipeline.execute();

        expect(sink.collected).toEqual(['2=30', '3=50', '4=70']);
      });
    });

    describe('Error Handling', () => {
      it('should throw when no source configured', async () => {
        const sink = new TestStreamSink();
        const pipeline = createDataPipeline().to(sink);

        await expect(pipeline.execute()).rejects.toThrow('No source configured');
      });

      it('should throw when no sink configured', async () => {
        const source = new TestStreamSource([{ id: '1', value: 10 }]);
        const pipeline = createDataPipeline().from(source);

        await expect(pipeline.execute()).rejects.toThrow('No sink configured');
      });
    });
  });

  describe('CDCConnector', () => {
    let connector: CDCConnector;

    afterEach(async () => {
      if (connector) {
        await connector.stop();
      }
    });

    describe('Lifecycle', () => {
      it('should start and emit started event', (done) => {
        connector = new CDCConnector({
          source: {
            type: 'postgres',
            connection: 'postgresql://localhost:5432/test',
          },
        });

        connector.on('cdc:started', (event) => {
          expect(event.source).toBe('postgres');
          done();
        });

        connector.start();
      });

      it('should stop and emit stopped event', (done) => {
        connector = new CDCConnector({
          source: {
            type: 'postgres',
            connection: 'postgresql://localhost:5432/test',
          },
        });

        connector.on('cdc:stopped', () => {
          done();
        });

        connector.start().then(() => {
          connector.stop();
        });
      });
    });

    describe('Snapshot', () => {
      it('should perform initial snapshot', (done) => {
        connector = new CDCConnector({
          source: {
            type: 'postgres',
            connection: 'postgresql://localhost:5432/test',
          },
          tables: ['users'],
          snapshotMode: 'initial',
        });

        const events: ChangeEvent[] = [];

        connector.on('snapshot:started', () => {
          // Snapshot started
        });

        connector.on('snapshot:completed', () => {
          expect(events.length).toBeGreaterThan(0);
          expect(events.every((e) => e.op === 'SNAPSHOT')).toBe(true);
          done();
        });

        connector.on('change', (event: ChangeEvent) => {
          events.push(event);
        });

        connector.start();
      });
    });

    describe('Position Management', () => {
      it('should track current position', async () => {
        connector = new CDCConnector({
          source: {
            type: 'postgres',
            connection: 'postgresql://localhost:5432/test',
          },
        });

        // Position is undefined before start
        expect(connector.getPosition()).toBeUndefined();
      });

      it('should seek to position', async () => {
        connector = new CDCConnector({
          source: {
            type: 'postgres',
            connection: 'postgresql://localhost:5432/test',
          },
        });

        let seekEvent: { position: string } | null = null;

        connector.on('seek', (event: { position: string }) => {
          seekEvent = event;
        });

        await connector.seek('1234567890');

        expect(connector.getPosition()).toBe('1234567890');
        expect(seekEvent?.position).toBe('1234567890');
      });
    });

    describe('Change Buffer', () => {
      it('should buffer changes', async () => {
        connector = new CDCConnector({
          source: {
            type: 'postgres',
            connection: 'postgresql://localhost:5432/test',
          },
          tables: ['users'],
          snapshotMode: 'initial',
        });

        await new Promise<void>((resolve) => {
          connector.on('snapshot:completed', () => {
            resolve();
          });
          connector.start();
        });

        const changes = connector.getChanges();
        expect(changes.length).toBeGreaterThan(0);
      });
    });
  });

  describe('EnrichmentProcessor', () => {
    it('should enrich change events', async () => {
      const processor = new EnrichmentProcessor();

      const event: ChangeEvent = {
        id: 'evt-1',
        source: 'postgres',
        table: 'users',
        op: 'INSERT',
        timestamp: Date.now(),
        after: { id: 1, name: 'Test' },
      };

      const context: ProcessContext = {
        streamId: 'test-stream',
        timestamp: Date.now(),
        watermark: 0,
      };

      const result = await processor.process(event, context);

      expect(result.enrichedAt).toBeDefined();
      expect(result.context.streamId).toBe('test-stream');
      expect(result.additionalData).toBeDefined();
    });
  });

  describe('DeduplicationProcessor', () => {
    it('should filter duplicate elements', async () => {
      const processor = new DeduplicationProcessor();

      const context: ProcessContext = {
        streamId: 'test-stream',
        timestamp: Date.now(),
        watermark: 0,
      };

      const element = { id: 'unique-1', value: 100 };

      const result1 = await processor.process(element, context);
      const result2 = await processor.process(element, context);

      expect(result1).toEqual(element);
      expect(result2).toBeNull();
    });

    it('should allow different elements', async () => {
      const processor = new DeduplicationProcessor();

      const context: ProcessContext = {
        streamId: 'test-stream',
        timestamp: Date.now(),
        watermark: 0,
      };

      const result1 = await processor.process({ id: 'a', value: 1 }, context);
      const result2 = await processor.process({ id: 'b', value: 2 }, context);

      expect(result1).toBeDefined();
      expect(result2).toBeDefined();
    });
  });
});
