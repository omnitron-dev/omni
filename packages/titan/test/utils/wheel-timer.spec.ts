/**
 * Tests for WheelTimer - high-performance timer wheel implementation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WheelTimer } from '../../src/utils/wheel-timer.js';

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
    }, 1000);

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
    }, 1000);

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
    }, 2000);
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

    it('should prevent callback from firing', () => new Promise<void>((done) => {
      const callback = vi.fn();
      timer.schedule(1, 50, callback);
      timer.cancel(1);

      setTimeout(() => {
        expect(callback).not.toHaveBeenCalled();
        done();
      }, 100);
    }));

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

    it('should return false after callback fires', () => new Promise<void>((done) => {
      timer.schedule(1, 20, () => {
        // Check after a small delay to ensure cleanup is complete
        setTimeout(() => {
          expect(timer.has(1)).toBe(false);
          done();
        }, 10);
      });
    }, 1000);
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

    it('should return accurate statistics', () => new Promise<void>((done) => {
      timer.schedule(1, 20, () => {});
      timer.schedule(2, 100, () => {});
      timer.cancel(2);

      setTimeout(() => {
        const stats = timer.getStats();
        expect(stats.totalFired).toBe(1);
        expect(stats.totalCancelled).toBe(1);
        done();
      }, 100);
    }));
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

    it('should prevent callbacks from firing after destroy', () => new Promise<void>((done) => {
      const callback = vi.fn();
      timer.schedule(1, 50, callback);
      timer.destroy();

      setTimeout(() => {
        expect(callback).not.toHaveBeenCalled();
        done();
      }, 100);
    }));
  });

  describe('error handling', () => {
    beforeEach(() => {
      timer = new WheelTimer({ resolution: 10, wheelSize: 100 });
    });

    it('should continue processing after callback error', () => new Promise<void>((done) => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const successCallback = vi.fn(() => {
        expect(successCallback).toHaveBeenCalled();
        consoleError.mockRestore();
        done();
      });

      timer.schedule(1, 20, () => {
        throw new Error('Test error');
      });
      timer.schedule(2, 40, successCallback);
    }, 1000);

    it('should log callback errors', () => new Promise<void>((done) => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      timer.schedule(1, 20, () => {
        throw new Error('Test error');
      });

      setTimeout(() => {
        expect(consoleError).toHaveBeenCalled();
        consoleError.mockRestore();
        done();
      }, 100);
    }));
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
    }, 500);

    it('should handle negative delay as minimum 1 tick', () => new Promise<void>((done) => {
      const callback = vi.fn(() => {
        expect(callback).toHaveBeenCalled();
        done();
      });

      timer.schedule(1, -100, callback);
    }, 500);

    it('should handle very small resolution', () => new Promise<void>((done) => {
      timer = new WheelTimer({ resolution: 1, wheelSize: 100 });

      const callback = vi.fn(() => {
        expect(callback).toHaveBeenCalled();
        done();
      });

      timer.schedule(1, 10, callback);
    }, 500);

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
    }, 1000);
  });
});
