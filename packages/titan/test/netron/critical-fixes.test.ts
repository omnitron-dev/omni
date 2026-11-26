/**
 * Tests for critical bug fixes in Netron RPC module
 * @see https://github.com/omnitron-dev/omni/issues/netron-critical-fixes
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Netron } from '../../src/netron/netron.js';
import { ServiceStub } from '../../src/netron/service-stub.js';
import { RateLimiter } from '../../src/netron/auth/rate-limiter.js';
import { MAX_EVENT_QUEUE_SIZE } from '../../src/netron/constants.js';
import { StreamReference } from '../../src/netron/streams/stream-reference.js';
import type { ILogger } from '../../src/modules/logger/logger.types.js';

// Mock logger
const mockLogger: ILogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  child: () => mockLogger,
  level: 'info',
} as any;

describe('Critical Netron Fixes', () => {
  describe('ServiceStub.processValue - Peer null check', () => {
    it('should throw error when peer not found for stream reference', () => {
      const netron = new Netron(mockLogger, { id: 'test-netron' });
      const stub = new ServiceStub(netron.peer, {}, { name: 'test', version: '1.0.0' });

      // Create a proper StreamReference instance (not a plain object)
      // The isNetronStreamReference predicate uses instanceof check
      const streamRef = new StreamReference(
        123, // streamId (number)
        'readable', // type
        true, // isLive
        'non-existent-peer' // peerId
      );

      // Access private method via type assertion
      const processValue = (stub as any).processValue.bind(stub);

      expect(() => {
        processValue(streamRef);
      }).toThrow('Peer not found for stream reference: non-existent-peer');
    });
  });

  describe('Netron.emitSpecial - Timer leak fix', () => {
    let netron: Netron;

    beforeEach(() => {
      netron = new Netron(mockLogger, { id: 'test-netron' });
    });

    afterEach(async () => {
      await netron.stop();
    });

    it('should clear timeout even when emit fails', async () => {
      const errorHandler = vi.fn();
      netron.on('test-event', () => {
        throw new Error('Test error');
      });

      // Capture error logs
      const originalError = mockLogger.error;
      mockLogger.error = errorHandler;

      await netron.emitSpecial('test-event', 'test-id', { data: 'test' });

      // Restore
      mockLogger.error = originalError;

      // Verify error was logged
      expect(errorHandler).toHaveBeenCalled();
    });
  });

  describe('Netron.emitSpecial - Event queue DoS protection', () => {
    let netron: Netron;

    beforeEach(() => {
      netron = new Netron(mockLogger, { id: 'test-netron' });
    });

    afterEach(async () => {
      await netron.stop();
    });

    it('should drop oldest events when queue exceeds MAX_EVENT_QUEUE_SIZE', async () => {
      const errorHandler = vi.fn();
      const originalError = mockLogger.error;
      mockLogger.error = errorHandler;

      // Fill the queue beyond the limit
      // We need to fill faster than processing, so block the first event
      let blockFirstEvent = true;
      netron.on('test-event', async () => {
        if (blockFirstEvent) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      });

      // Queue up MAX_EVENT_QUEUE_SIZE + 10 events
      const promises: Promise<void>[] = [];
      for (let i = 0; i < MAX_EVENT_QUEUE_SIZE + 10; i++) {
        promises.push(netron.emitSpecial('test-event', 'test-id', { index: i }));
      }

      // Unblock and wait
      blockFirstEvent = false;
      await Promise.all(promises);

      // Restore
      mockLogger.error = originalError;

      // Verify queue limit was enforced (error logged when dropping)
      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'test-event',
          id: 'test-id',
          queueSize: MAX_EVENT_QUEUE_SIZE,
        }),
        expect.stringContaining('Event queue limit exceeded')
      );
    });
  });

  describe('RateLimiter - Queue timeout protection', () => {
    let limiter: RateLimiter;

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(0);
      limiter = new RateLimiter(mockLogger, {
        queue: true,
        maxQueueSize: 10,
        defaultTier: { name: 'test', limit: 1 },
        window: 60_000,
      });
    });

    afterEach(() => {
      limiter.destroy();
      vi.useRealTimers();
    });

    it('should timeout queued requests after 30 seconds', async () => {
      await limiter.consume('test-key', 'test');
      const timed = expect(limiter.consume('test-key', 'test')).rejects.toMatchObject({
        details: { queued: true, retryAfter: 30_000 },
      });
      await vi.advanceTimersByTimeAsync(29_999);
      expect(limiter.getStats().currentQueueSize).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      await timed;
      expect(limiter.getStats().currentQueueSize).toBe(0);
    });

    it('should clear timeout when request is processed', async () => {
      await limiter.consume('test-key', 'test');
      const queued = limiter.consume('test-key', 'test');
      limiter.reset('test-key');
      await vi.advanceTimersByTimeAsync(1);
      await expect(queued).resolves.toBeUndefined();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(limiter.getStats('test-key').currentQueueSize).toBe(0);
      expect(await limiter.check('test-key', 'test')).toMatchObject({ allowed: false, remaining: 0 });
    });
  });
});
