/**
 * Tests for WheelTimer - high-performance timer wheel implementation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WheelTimer } from '../../src/utils/wheel-timer.js';

import { after, eventually } from '../async-assert.js';

describe('WheelTimer', () => {
  let timer: WheelTimer<number>;

  afterEach(() => {
    timer?.destroy();
  });

  describe('constructor', () => {
    it('should create with default options', () => {
      timer = new WheelTimer();
      const stats = timer.getStats();

      expect(stats.resolution).toBe(100);
      expect(stats.wheelSize).toBe(512);
      expect(stats.size).toBe(0);
      expect(stats.isRunning).toBe(false);
    });

    it('should create with custom options', () => {
      timer = new WheelTimer({ resolution: 50, wheelSize: 256 });
      const stats = timer.getStats();

      expect(stats.resolution).toBe(50);
      expect(stats.wheelSize).toBe(256);
    });
  });

  describe('schedule()', () => {
    beforeEach(() => {
      timer = new WheelTimer({ resolution: 10, wheelSize: 100 });
    });

    it('should schedule a callback', () => {
      const callback = vi.fn();
      timer.schedule(1, 100, callback);

      expect(timer.has(1)).toBe(true);
      expect(timer.size).toBe(1);
    });

    it('should start the internal timer when first item is scheduled', () => {
      const callback = vi.fn();
      expect(timer.getStats().isRunning).toBe(false);

      timer.schedule(1, 100, callback);

      expect(timer.getStats().isRunning).toBe(true);
    });

    it('should reschedule existing key', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      timer.schedule(1, 100, callback1);
      timer.schedule(1, 200, callback2);

      expect(timer.size).toBe(1);
      expect(timer.has(1)).toBe(true);
    });

    it('should fire callback after delay', () => new Promise<void>((done) => {
      const callback = vi.fn(() => {
        expect(callback).toHaveBeenCalledTimes(1);
        done();
      });

      timer.schedule(1, 50, callback);
    }), 1000);

    it('should fire multiple callbacks independently', () => new Promise<void>((done) => {
      const results: number[] = [];
      let completed = 0;

      const checkDone = () => {
        completed++;
        if (completed === 3) {
          // Callbacks should fire in order of their delays
          expect(results).toEqual([1, 2, 3]);
          done();
        }
      };

      timer.schedule(2, 40, () => {
        results.push(2);
        checkDone();
      });
      timer.schedule(1, 20, () => {
        results.push(1);
        checkDone();
      });
      timer.schedule(3, 60, () => {
        results.push(3);
        checkDone();
      });
    }), 1000);

    it('should handle delays longer than single wheel rotation', () => new Promise<void>((done) => {
      // With resolution=10 and wheelSize=100, one rotation = 1000ms
      // Test with delay that requires rounds
      timer = new WheelTimer({ resolution: 10, wheelSize: 10 }); // 100ms per rotation

      const callback = vi.fn(() => {
        expect(callback).toHaveBeenCalledTimes(1);
        done();
      });

      // 150ms delay requires more than one rotation (100ms)
      timer.schedule(1, 150, callback);
    }), 2000);
  });

  describe('cancel()', () => {
    beforeEach(() => {
      timer = new WheelTimer({ resolution: 10, wheelSize: 100 });
    });

    it('should cancel a scheduled callback', () => {
      const callback = vi.fn();
      timer.schedule(1, 100, callback);

      expect(timer.cancel(1)).toBe(true);
      expect(timer.has(1)).toBe(false);
      expect(timer.size).toBe(0);
    });

    it('should return false for non-existent key', () => {
      expect(timer.cancel(999)).toBe(false);
    });

    it('should prevent callback from firing', () => {
      const callback = vi.fn();
      timer.schedule(1, 50, callback);
      timer.cancel(1);

      // A negative needs a fixed window, not a poll: waiting for "still not
      // called" would succeed on the first tick and prove nothing.
      return after(100, () => {
        expect(callback).not.toHaveBeenCalled();
      });
    });

    it('should stop internal timer when last item is cancelled', () => {
      const callback = vi.fn();
      timer.schedule(1, 100, callback);
      expect(timer.getStats().isRunning).toBe(true);

      timer.cancel(1);
      expect(timer.getStats().isRunning).toBe(false);
    });

    it('should update statistics', () => {
      const callback = vi.fn();
      timer.schedule(1, 100, callback);
      timer.cancel(1);

      expect(timer.getStats().totalCancelled).toBe(1);
    });
  });

  describe('has()', () => {
    beforeEach(() => {
      timer = new WheelTimer({ resolution: 10, wheelSize: 100 });
    });

    it('should return true for scheduled item', () => {
      timer.schedule(1, 100, () => {});
      expect(timer.has(1)).toBe(true);
    });

    it('should return false for non-scheduled item', () => {
      expect(timer.has(999)).toBe(false);
    });

    it('should return false after callback fires', () => {
      timer.schedule(1, 20, () => {});

      return eventually(() => {
        expect(timer.has(1)).toBe(false);
      });
    });
  });

  describe('size', () => {
    beforeEach(() => {
      timer = new WheelTimer({ resolution: 10, wheelSize: 100 });
    });

    it('should track number of scheduled items', () => {
      expect(timer.size).toBe(0);

      timer.schedule(1, 100, () => {});
      expect(timer.size).toBe(1);

      timer.schedule(2, 100, () => {});
      expect(timer.size).toBe(2);

      timer.cancel(1);
      expect(timer.size).toBe(1);
    });
  });

  describe('getStats()', () => {
    beforeEach(() => {
      timer = new WheelTimer({ resolution: 10, wheelSize: 100 });
    });

    it('should return accurate statistics', () => {
      timer.schedule(1, 20, () => {});
      timer.schedule(2, 100, () => {});
      timer.cancel(2);

      return eventually(() => {
        const stats = timer.getStats();
        expect(stats.totalFired).toBe(1);
        expect(stats.totalCancelled).toBe(1);
      });
    });
  });

  describe('destroy()', () => {
    beforeEach(() => {
      timer = new WheelTimer({ resolution: 10, wheelSize: 100 });
    });

    it('should stop internal timer', () => {
      timer.schedule(1, 100, () => {});
      expect(timer.getStats().isRunning).toBe(true);

      timer.destroy();
      expect(timer.getStats().isRunning).toBe(false);
    });

    it('should clear all scheduled items', () => {
      timer.schedule(1, 100, () => {});
      timer.schedule(2, 100, () => {});
      timer.schedule(3, 100, () => {});

      timer.destroy();
      expect(timer.size).toBe(0);
    });

    it('should prevent callbacks from firing after destroy', () => {
      const callback = vi.fn();
      timer.schedule(1, 50, callback);
      timer.destroy();

      return after(100, () => {
        expect(callback).not.toHaveBeenCalled();
      });
    });
  });

  describe('error handling', () => {
    beforeEach(() => {
      timer = new WheelTimer({ resolution: 10, wheelSize: 100 });
    });

    it('should continue processing after callback error', async () => {
      // The old version asserted `expect(successCallback).toHaveBeenCalled()`
      // from inside successCallback — true by construction, and a throw there
      // would have been swallowed by the timer's own error handling, leaving
      // done() uncalled. Assert from outside that both ran.
      let threw = false;
      const successCallback = vi.fn();

      timer.schedule(1, 20, () => {
        threw = true;
        throw new Error('Test error');
      });
      timer.schedule(2, 40, successCallback);

      await eventually(() => {
        expect(threw).toBe(true);
        expect(successCallback).toHaveBeenCalled();
      });
    });

    it('should log callback errors', () => {
      // WheelTimer reports through the injected ILogger (a null logger by
      // default), not console.error. Spying on the console meant this test
      // waited for a call that could never come and sat until the 120s timeout.
      const logger = {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn(),
        fatal: vi.fn(),
      };
      const loggingTimer = new WheelTimer<number>({ resolution: 10, wheelSize: 100, logger: logger as never });

      loggingTimer.schedule(1, 20, () => {
        throw new Error('Test error');
      });

      return eventually(() => {
        expect(logger.error).toHaveBeenCalledWith(
          expect.objectContaining({ err: expect.any(Error) }),
          'WheelTimer callback error'
        );
      }).finally(() => {
        loggingTimer.stop?.();
      });
    });
  });

  describe('string keys', () => {
    let stringTimer: WheelTimer<string>;

    beforeEach(() => {
      stringTimer = new WheelTimer<string>({ resolution: 10, wheelSize: 100 });
    });

    afterEach(() => {
      stringTimer.destroy();
    });

    it('should work with string keys', () => new Promise<void>((done) => {
      const callback = vi.fn(() => {
        expect(callback).toHaveBeenCalled();
        done();
      });

      stringTimer.schedule('packet-123', 30, callback);
      expect(stringTimer.has('packet-123')).toBe(true);
    }));
  });

  describe('performance characteristics', () => {
    it('should handle many items efficiently', () => {
      timer = new WheelTimer({ resolution: 100, wheelSize: 512 });

      const start = Date.now();

      // Schedule 10,000 items
      for (let i = 0; i < 10000; i++) {
        timer.schedule(i, Math.random() * 5000 + 100, () => {});
      }

      const scheduleTime = Date.now() - start;

      // Cancel half of them
      const cancelStart = Date.now();
      for (let i = 0; i < 5000; i++) {
        timer.cancel(i);
      }
      const cancelTime = Date.now() - cancelStart;

      expect(timer.size).toBe(5000);

      // Should be very fast - less than 100ms for 10k operations each
      expect(scheduleTime).toBeLessThan(100);
      expect(cancelTime).toBeLessThan(100);
    });

    it('should use single timer for all items', () => {
      timer = new WheelTimer({ resolution: 100 });

      // Schedule multiple items
      for (let i = 0; i < 100; i++) {
        timer.schedule(i, 1000 + i * 10, () => {});
      }

      // All items share a single timer
      expect(timer.getStats().isRunning).toBe(true);
      expect(timer.size).toBe(100);
    });
  });

  describe('edge cases', () => {
    beforeEach(() => {
      timer = new WheelTimer({ resolution: 10, wheelSize: 100 });
    });

    it('should handle zero delay as minimum 1 tick', () => new Promise<void>((done) => {
      const callback = vi.fn(() => {
        expect(callback).toHaveBeenCalled();
        done();
      });

      timer.schedule(1, 0, callback);
    }), 500);

    it('should handle negative delay as minimum 1 tick', () => new Promise<void>((done) => {
      const callback = vi.fn(() => {
        expect(callback).toHaveBeenCalled();
        done();
      });

      timer.schedule(1, -100, callback);
    }), 500);

    it('should handle very small resolution', () => new Promise<void>((done) => {
      timer = new WheelTimer({ resolution: 1, wheelSize: 100 });

      const callback = vi.fn(() => {
        expect(callback).toHaveBeenCalled();
        done();
      });

      timer.schedule(1, 10, callback);
    }), 500);

    it('should handle scheduling during callback', () => new Promise<void>((done) => {
      let phase = 1;

      timer.schedule(1, 20, () => {
        expect(phase).toBe(1);
        phase = 2;

        // Schedule another item during callback
        timer.schedule(2, 20, () => {
          expect(phase).toBe(2);
          done();
        });
      });
    }), 1000);
  });

  describe('slot arithmetic', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    /**
     * `schedule()` puts an entry `ceil(delayMs / resolution)` slots ahead of the
     * CURRENT slot but measures `expiresAt` from the calling instant. With `d`
     * the milliseconds since the last tick, the slot is reached at
     * `ticks * resolution` while the entry expires at `d + delayMs`, so it fires
     * on time only when `d <= ticks * resolution - delayMs` — which is zero for
     * every delay that is an exact multiple of the resolution.
     *
     * Missing that window used to cost a whole revolution, because `tick()` left
     * the unexpired entry in a slot the wheel would not read again until
     * `wheelSize * resolution` ms later.
     */
    it('fires an entry scheduled between ticks without waiting a whole revolution', () => {
      vi.useFakeTimers();
      timer = new WheelTimer<number>({ resolution: 10, wheelSize: 100 });

      const firedAt: Record<string, number> = {};
      // Keeps the wheel running, so the entry below inherits tick boundaries
      // instead of starting the interval itself (which would make d = 0).
      timer.schedule(1, 1000, () => {
        firedAt['keepalive'] = Date.now();
      });

      // 5 ms past the last tick: a schedule() issued from inside a callback on
      // a machine under load, which is how this first showed up — as a 1000 ms
      // timeout in 'should handle scheduling during callback', with no
      // assertion error, on a test whose own work is about 40 ms.
      vi.advanceTimersByTime(5);
      const scheduledAt = Date.now();
      timer.schedule(2, 20, () => {
        firedAt['late'] = Date.now();
      });

      vi.advanceTimersByTime(200);

      // Before the fix this was still empty here and the entry fired at
      // +1015 ms — one full wheel revolution for a 20 ms timer.
      expect(firedAt['late']).toBeDefined();
      expect(firedAt['late']! - scheduledAt).toBeLessThan(100);
    });

    it('never fires an entry before its expiry', () => {
      vi.useFakeTimers();
      timer = new WheelTimer<number>({ resolution: 10, wheelSize: 100 });

      timer.schedule(1, 1000, () => {});

      vi.advanceTimersByTime(5);
      const scheduledAt = Date.now();
      let firedAt = -1;
      timer.schedule(2, 20, () => {
        firedAt = Date.now();
      });

      vi.advanceTimersByTime(200);

      // Deferring by one slot must not become "fire early": the entry is moved
      // forward, not released ahead of `expiresAt`.
      expect(firedAt).toBeGreaterThanOrEqual(scheduledAt + 20);
    });

    it('re-slots at most once, so a wheel of size 1 still fires', () => {
      vi.useFakeTimers();
      timer = new WheelTimer<number>({ resolution: 10, wheelSize: 1 });

      let fired = false;
      timer.schedule(1, 1000, () => {});
      vi.advanceTimersByTime(5);
      timer.schedule(2, 20, () => {
        fired = true;
      });

      // wheelSize 1 makes "the next slot" the same slot; the deferral is applied
      // after the iteration precisely so this cannot revisit the entry forever.
      vi.advanceTimersByTime(200);

      expect(fired).toBe(true);
    });
  });
});
