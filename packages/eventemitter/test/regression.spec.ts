import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { WildcardMatcher } from '../src/wildcard';
import { EnhancedEventEmitter } from '../src/enhanced-emitter';
import { EventScheduler } from '../src/scheduler';
import type { ScheduleOptions } from '../src/types';

describe('Regression Tests', () => {
  describe('WildcardMatcher - Consecutive Delimiters', () => {
    it('should match empty segments with single wildcard', () => {
      const matcher = new WildcardMatcher();

      // Single wildcard should match empty segment between consecutive delimiters
      expect(matcher.match('user..created', 'user.*.created')).toBe(true);
      expect(matcher.match('user..created', 'user..created')).toBe(true);

      // Should also work with multiple consecutive delimiters
      expect(matcher.match('app...module', 'app.*.*.module')).toBe(true);
    });

    it('should handle edge cases with wildcards', () => {
      const matcher = new WildcardMatcher();

      // Empty segments at different positions
      expect(matcher.match('.start', '*.start')).toBe(true);
      expect(matcher.match('end.', 'end.*')).toBe(true);
      // Note: '..' splits into ['', '', ''] (3 segments), so it should match '*.*.*', not '*.*'
      expect(matcher.match('..', '*.*.*')).toBe(true);
      // Or use globstar to match any number of segments
      expect(matcher.match('..', '**')).toBe(true);
    });
  });

  describe('EnhancedEventEmitter - Error Boundary', () => {
    let emitter: EnhancedEventEmitter;

    beforeEach(() => {
      emitter = new EnhancedEventEmitter();
    });

    afterEach(() => {
      emitter.dispose();
      emitter.removeAllListeners();
    });

    it('should not re-throw errors when error boundary is enabled', () => {
      const onError = jest.fn();
      const errorListener = jest.fn(() => {
        throw new Error('Test error');
      });

      emitter.onEnhanced('test-event', errorListener, {
        errorBoundary: true,
        onError
      });

      // Should not throw when error boundary is enabled
      expect(() => {
        emitter.emitEnhanced('test-event', { data: 'test' });
      }).not.toThrow();

      // Error handler should be called
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Test error' }),
        { data: 'test' },
        expect.any(Object)
      );
    });

    it('should handle timeout correctly with other listeners', async () => {
      // Create separate emitter to avoid interference
      const localEmitter = new EnhancedEventEmitter();

      // Add a normal listener
      const normalListener = jest.fn();
      localEmitter.on('normal-event', normalListener);

      // Add a timeout listener
      const timeoutListener = jest.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
      });
      localEmitter.onEnhanced('timeout-event', timeoutListener, { timeout: 10 });

      // Normal event should work
      localEmitter.emitEnhanced('normal-event', 'data');
      expect(normalListener).toHaveBeenCalled();

      // Timeout event should timeout
      let timeoutError: Error | undefined;
      try {
        await localEmitter.emitParallel('timeout-event', 'data');
      } catch (error) {
        timeoutError = error as Error;
      }
      expect(timeoutError).toBeDefined();
      expect(timeoutError?.message).toContain('Listener timeout');

      localEmitter.dispose();
    });
  });

  describe('EventScheduler - Error Handling', () => {
    let scheduler: EventScheduler;

    beforeEach(() => {
      jest.useFakeTimers();
      scheduler = new EventScheduler();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should handle errors without unhandled rejections', async () => {
      // Use real timers for this test since we're dealing with async operations
      jest.useRealTimers();
      
      const failingEmitFn = jest.fn<(event: string, data: any) => Promise<void>>(async () => {
        throw new Error('Scheduled error');
      });

      // Schedule event that will fail immediately
      scheduler.schedule('fail-event', { data: 'test' }, { delay: 0 }, failingEmitFn);

      // Wait a bit for the async operation to complete
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should have called the failing function
      expect(failingEmitFn).toHaveBeenCalled();

      // Event should be removed even if it failed
      const events = scheduler.getScheduledEvents();
      expect(events).toHaveLength(0);
      
      // Restore fake timers for other tests
      jest.useFakeTimers();
    });

    it('should respect max delay in exponential backoff retry', async () => {
      jest.useRealTimers();

      let attempts = 0;
      const retryEmitFn = jest.fn<(event: string, data: any) => Promise<void>>(async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Retry needed');
        }
      });

      const options: ScheduleOptions = {
        delay: 0,
        retry: {
          maxAttempts: 3,
          delay: 10,
          backoff: 'exponential',
          factor: 10,
          maxDelay: 50
        }
      };

      const startTime = Date.now();
      scheduler.schedule('retry-event', { data: 'test' }, options, retryEmitFn);

      // Wait for retries
      await new Promise(resolve => setTimeout(resolve, 200));

      const totalTime = Date.now() - startTime;

      // Should complete within reasonable time (not 1000+ms)
      expect(totalTime).toBeLessThan(500);
      expect(retryEmitFn).toHaveBeenCalledTimes(3);
    });
  });
});