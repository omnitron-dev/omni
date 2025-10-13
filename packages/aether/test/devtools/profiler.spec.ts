/**
 * Profiler Tests - Performance Profiler Tests
 *
 * Comprehensive test coverage for the DevTools performance profiler,
 * including component render time, effect execution, and bottleneck identification.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createProfiler } from '../../src/devtools/profiler.js';
import type { Profiler, PerformanceProfile, PerformanceMeasurement } from '../../src/devtools/types.js';

describe('DevTools Profiler', () => {
  let profiler: Profiler;

  beforeEach(() => {
    profiler = createProfiler();
    vi.clearAllMocks();

    // Mock performance.now()
    vi.spyOn(performance, 'now');
  });

  afterEach(() => {
    profiler.clear();
    vi.restoreAllMocks();
  });

  describe('Profiling Session', () => {
    it('should start profiling', () => {
      profiler.startProfiling();

      const state = profiler.getState();
      expect(state.isProfiling).toBe(true);
      expect(state.currentProfile).toBeDefined();
    });

    it('should stop profiling', () => {
      profiler.startProfiling();
      const profile = profiler.stopProfiling();

      expect(profile).toBeDefined();
      expect(profile.startTime).toBeGreaterThan(0);
      expect(profile.endTime).toBeGreaterThan(0);
      expect(profile.duration).toBeGreaterThanOrEqual(0);

      const state = profiler.getState();
      expect(state.isProfiling).toBe(false);
    });

    it('should not double-start profiling', () => {
      profiler.startProfiling();
      const firstProfile = profiler.getState().currentProfile;

      profiler.startProfiling();
      const secondProfile = profiler.getState().currentProfile;

      expect(firstProfile?.id).toBe(secondProfile?.id);
    });

    it('should throw when stopping without starting', () => {
      expect(() => profiler.stopProfiling()).toThrow('Profiling not active');
    });

    it('should include measurements in profile', () => {
      profiler.startProfiling();

      (profiler as any).startMeasuringComponent('comp-1', 'TestComponent');
      (profiler as any).endMeasuringComponent('comp-1');

      const profile = profiler.stopProfiling();

      expect(profile.measurements.length).toBe(1);
      expect(profile.measurements[0].type).toBe('component');
    });
  });

  describe('Component Measurement', () => {
    it('should measure component render time', () => {
      profiler.startProfiling();

      // Mock performance.now to return consistent values
      let callCount = 0;
      vi.mocked(performance.now).mockImplementation(() => {
        callCount++;
        return 100 + callCount * 10; // Returns 110, 120, 130, etc.
      });

      (profiler as any).startMeasuringComponent('comp-1', 'TestComponent');
      (profiler as any).endMeasuringComponent('comp-1');

      const state = profiler.getState();
      expect(state.measurements.length).toBe(1);

      const measurement = state.measurements[0];
      expect(measurement.type).toBe('component');
      expect(measurement.targetId).toBe('comp-1');
      expect(measurement.name).toBe('TestComponent');
      expect(measurement.duration).toBeGreaterThanOrEqual(0);
    });

    it('should measure component using convenience wrapper', () => {
      profiler.startProfiling();

      const component = { id: 'comp-1', name: 'TestComponent' };
      const renderFn = vi.fn();

      profiler.measureComponent(component, renderFn);

      expect(renderFn).toHaveBeenCalled();

      const state = profiler.getState();
      expect(state.measurements.length).toBe(1);
    });

    it('should handle component measurement without profiling', () => {
      const component = { name: 'TestComponent' };
      const renderFn = vi.fn();

      // Should not throw and should call function
      profiler.measureComponent(component, renderFn);

      expect(renderFn).toHaveBeenCalled();

      const state = profiler.getState();
      expect(state.measurements.length).toBe(0);
    });

    it('should handle anonymous components', () => {
      profiler.startProfiling();

      const component = {};
      profiler.measureComponent(component, () => {});

      const state = profiler.getState();
      const measurement = state.measurements[0];
      expect(measurement.targetId).toBe('anonymous');
    });

    it('should measure multiple component renders', () => {
      profiler.startProfiling();

      (profiler as any).startMeasuringComponent('comp-1', 'Component1');
      (profiler as any).endMeasuringComponent('comp-1');

      (profiler as any).startMeasuringComponent('comp-2', 'Component2');
      (profiler as any).endMeasuringComponent('comp-2');

      const state = profiler.getState();
      expect(state.measurements.length).toBe(2);
    });

    it('should handle measurement errors gracefully', () => {
      profiler.startProfiling();

      const component = { name: 'ErrorComponent' };
      const errorFn = () => {
        throw new Error('Render error');
      };

      expect(() => profiler.measureComponent(component, errorFn)).toThrow('Render error');

      // Should still have measurement recorded
      const state = profiler.getState();
      expect(state.measurements.length).toBe(1);
    });
  });

  describe('Effect Measurement', () => {
    it('should measure effect execution time', () => {
      profiler.startProfiling();

      (profiler as any).startMeasuringEffect('effect-1', 'TestEffect');
      (profiler as any).endMeasuringEffect('effect-1');

      const state = profiler.getState();
      expect(state.measurements.length).toBe(1);

      const measurement = state.measurements[0];
      expect(measurement.type).toBe('effect');
      expect(measurement.targetId).toBe('effect-1');
      expect(measurement.name).toBe('TestEffect');
    });

    it('should measure effect using convenience wrapper', () => {
      profiler.startProfiling();

      const effect = { id: 'effect-1', name: 'TestEffect' };
      const effectFn = vi.fn();

      profiler.measureEffect(effect, effectFn);

      expect(effectFn).toHaveBeenCalled();

      const state = profiler.getState();
      expect(state.measurements.length).toBe(1);
    });

    it('should handle effect measurement without profiling', () => {
      const effect = { name: 'TestEffect' };
      const effectFn = vi.fn();

      profiler.measureEffect(effect, effectFn);

      expect(effectFn).toHaveBeenCalled();

      const state = profiler.getState();
      expect(state.measurements.length).toBe(0);
    });

    it('should track multiple effect executions', () => {
      profiler.startProfiling();

      const effect = { id: 'effect-1', name: 'TestEffect' };

      profiler.measureEffect(effect, () => {});
      profiler.measureEffect(effect, () => {});
      profiler.measureEffect(effect, () => {});

      const state = profiler.getState();
      expect(state.measurements.length).toBe(3);
    });
  });

  describe('Computed Measurement', () => {
    it('should measure computed execution', () => {
      profiler.startProfiling();

      (profiler as any).startMeasuringComputed('computed-1', 'TestComputed');
      (profiler as any).endMeasuringComputed('computed-1');

      const state = profiler.getState();
      expect(state.measurements.length).toBe(1);

      const measurement = state.measurements[0];
      expect(measurement.type).toBe('computed');
      expect(measurement.targetId).toBe('computed-1');
    });
  });

  describe('Memory Usage Tracking', () => {
    it('should track memory delta if available', () => {
      // Mock performance.memory
      const mockMemory = {
        usedJSHeapSize: 1000000,
      };

      Object.defineProperty(performance, 'memory', {
        value: mockMemory,
        configurable: true,
      });

      profiler.startProfiling();

      (profiler as any).startMeasuringComponent('comp-1', 'TestComponent');

      // Simulate memory increase
      mockMemory.usedJSHeapSize = 1100000;

      (profiler as any).endMeasuringComponent('comp-1');

      const state = profiler.getState();
      const measurement = state.measurements[0];

      expect(measurement.memoryDelta).toBeDefined();
      if (measurement.memoryDelta !== undefined) {
        expect(measurement.memoryDelta).toBeGreaterThan(0);
      }
    });

    it('should handle missing memory API', () => {
      // Ensure memory API is not available
      Object.defineProperty(performance, 'memory', {
        value: undefined,
        configurable: true,
      });

      profiler.startProfiling();

      (profiler as any).startMeasuringComponent('comp-1', 'TestComponent');
      (profiler as any).endMeasuringComponent('comp-1');

      const state = profiler.getState();
      const measurement = state.measurements[0];

      expect(measurement.memoryDelta).toBeUndefined();
    });
  });

  describe('Performance Report', () => {
    it('should generate performance report', () => {
      profiler.startProfiling();

      (profiler as any).startMeasuringComponent('comp-1', 'Component1');
      (profiler as any).endMeasuringComponent('comp-1');

      (profiler as any).startMeasuringEffect('effect-1', 'Effect1');
      (profiler as any).endMeasuringEffect('effect-1');

      const profile = profiler.stopProfiling();

      expect(profile.summary.totalComponents).toBe(1);
      expect(profile.summary.totalEffects).toBe(1);
      expect(profile.summary.totalComputed).toBe(0);
    });

    it('should identify slowest component', () => {
      profiler.startProfiling();

      // Fast component
      let callCount = 0;
      vi.mocked(performance.now).mockImplementation(() => {
        const times = [0, 5, 0, 50];
        return times[callCount++] || 0;
      });

      (profiler as any).startMeasuringComponent('comp-1', 'FastComponent');
      (profiler as any).endMeasuringComponent('comp-1');

      // Slow component
      (profiler as any).startMeasuringComponent('comp-2', 'SlowComponent');
      (profiler as any).endMeasuringComponent('comp-2');

      const profile = profiler.stopProfiling();

      expect(profile.summary.slowestComponent).toBeDefined();
      expect(profile.summary.slowestComponent?.name).toBe('SlowComponent');
    });

    it('should identify slowest effect', () => {
      profiler.startProfiling();

      let callCount = 0;
      vi.mocked(performance.now).mockImplementation(() => {
        const times = [0, 5, 0, 30];
        return times[callCount++] || 0;
      });

      (profiler as any).startMeasuringEffect('effect-1', 'FastEffect');
      (profiler as any).endMeasuringEffect('effect-1');

      (profiler as any).startMeasuringEffect('effect-2', 'SlowEffect');
      (profiler as any).endMeasuringEffect('effect-2');

      const profile = profiler.stopProfiling();

      expect(profile.summary.slowestEffect).toBeDefined();
      expect(profile.summary.slowestEffect?.name).toBe('SlowEffect');
    });

    it('should return undefined report when not profiling', () => {
      const report = profiler.getPerformanceReport();
      expect(report).toBeUndefined();
    });

    it('should return current report during profiling', () => {
      profiler.startProfiling();

      const report = profiler.getPerformanceReport();
      expect(report).toBeDefined();
    });
  });

  describe('Bottleneck Identification', () => {
    it('should identify bottlenecks above threshold', () => {
      profiler.startProfiling();

      // Fast operation (below threshold)
      let callCount = 0;
      vi.mocked(performance.now).mockImplementation(() => {
        const times = [0, 5, 0, 50];
        return times[callCount++] || 0;
      });

      (profiler as any).startMeasuringComponent('comp-1', 'Fast');
      (profiler as any).endMeasuringComponent('comp-1');

      // Slow operation (above threshold)
      (profiler as any).startMeasuringComponent('comp-2', 'Slow');
      (profiler as any).endMeasuringComponent('comp-2');

      const bottlenecks = profiler.identifyBottlenecks(16);

      expect(bottlenecks.length).toBe(1);
      expect(bottlenecks[0].name).toBe('Slow');
    });

    it('should use default threshold', () => {
      profiler.startProfiling();

      let callCount = 0;
      vi.mocked(performance.now).mockImplementation(() => {
        const times = [0, 20];
        return times[callCount++] || 0;
      });

      (profiler as any).startMeasuringComponent('comp-1', 'SlowComponent');
      (profiler as any).endMeasuringComponent('comp-1');

      const bottlenecks = profiler.identifyBottlenecks();

      expect(bottlenecks.length).toBe(1);
    });

    it('should sort bottlenecks by duration', () => {
      profiler.startProfiling();

      let callCount = 0;
      vi.mocked(performance.now).mockImplementation(() => {
        const times = [0, 20, 0, 50, 0, 30];
        return times[callCount++] || 0;
      });

      (profiler as any).startMeasuringComponent('comp-1', 'Medium');
      (profiler as any).endMeasuringComponent('comp-1');

      (profiler as any).startMeasuringComponent('comp-2', 'Slowest');
      (profiler as any).endMeasuringComponent('comp-2');

      (profiler as any).startMeasuringComponent('comp-3', 'Slow');
      (profiler as any).endMeasuringComponent('comp-3');

      const bottlenecks = profiler.identifyBottlenecks(16);

      expect(bottlenecks[0].name).toBe('Slowest');
      expect(bottlenecks[1].name).toBe('Slow');
      expect(bottlenecks[2].name).toBe('Medium');
    });

    it('should return empty array when no bottlenecks', () => {
      profiler.startProfiling();

      let callCount = 0;
      vi.mocked(performance.now).mockImplementation(() => {
        const times = [0, 5];
        return times[callCount++] || 0;
      });

      (profiler as any).startMeasuringComponent('comp-1', 'Fast');
      (profiler as any).endMeasuringComponent('comp-1');

      const bottlenecks = profiler.identifyBottlenecks(16);

      expect(bottlenecks.length).toBe(0);
    });
  });

  describe('Statistics', () => {
    it('should calculate average execution time', () => {
      profiler.startProfiling();

      // Measure same component 3 times
      let callCount = 0;
      vi.mocked(performance.now).mockImplementation(() => {
        const times = [0, 10, 0, 20, 0, 30];
        return times[callCount++] || 0;
      });

      (profiler as any).startMeasuringComponent('comp-1', 'Test');
      (profiler as any).endMeasuringComponent('comp-1');

      (profiler as any).startMeasuringComponent('comp-1', 'Test');
      (profiler as any).endMeasuringComponent('comp-1');

      (profiler as any).startMeasuringComponent('comp-1', 'Test');
      (profiler as any).endMeasuringComponent('comp-1');

      const avgTime = (profiler as any).getAverageTime('comp-1', 'component');

      expect(avgTime).toBeGreaterThan(0);
    });

    it('should return 0 for non-existent target', () => {
      profiler.startProfiling();

      const avgTime = (profiler as any).getAverageTime('non-existent', 'component');

      expect(avgTime).toBe(0);
    });

    it('should track statistics per type', () => {
      profiler.startProfiling();

      (profiler as any).startMeasuringComponent('comp-1', 'Component');
      (profiler as any).endMeasuringComponent('comp-1');

      (profiler as any).startMeasuringEffect('effect-1', 'Effect');
      (profiler as any).endMeasuringEffect('effect-1');

      (profiler as any).startMeasuringComputed('computed-1', 'Computed');
      (profiler as any).endMeasuringComputed('computed-1');

      const compAvg = (profiler as any).getAverageTime('comp-1', 'component');
      const effectAvg = (profiler as any).getAverageTime('effect-1', 'effect');
      const computedAvg = (profiler as any).getAverageTime('computed-1', 'computed');

      expect(compAvg).toBeGreaterThanOrEqual(0);
      expect(effectAvg).toBeGreaterThanOrEqual(0);
      expect(computedAvg).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Cleanup and Memory Management', () => {
    it('should clear measurements', () => {
      profiler.startProfiling();

      (profiler as any).startMeasuringComponent('comp-1', 'Test');
      (profiler as any).endMeasuringComponent('comp-1');

      profiler.clear();

      const state = profiler.getState();
      expect(state.measurements.length).toBe(0);
    });

    it('should clear active measurements', () => {
      profiler.startProfiling();

      (profiler as any).startMeasuringComponent('comp-1', 'Test');

      profiler.clear();

      // Should not throw when ending
      expect(() => {
        (profiler as any).endMeasuringComponent('comp-1');
      }).not.toThrow();
    });

    it('should clear statistics', () => {
      profiler.startProfiling();

      (profiler as any).startMeasuringComponent('comp-1', 'Test');
      (profiler as any).endMeasuringComponent('comp-1');

      profiler.clear();

      const avgTime = (profiler as any).getAverageTime('comp-1', 'component');
      expect(avgTime).toBe(0);
    });

    it('should handle large number of measurements', () => {
      profiler.startProfiling();

      for (let i = 0; i < 1000; i++) {
        (profiler as any).startMeasuringComponent(`comp-${i}`, `Component${i}`);
        (profiler as any).endMeasuringComponent(`comp-${i}`);
      }

      const state = profiler.getState();
      expect(state.measurements.length).toBe(1000);

      profiler.clear();

      const clearedState = profiler.getState();
      expect(clearedState.measurements.length).toBe(0);
    });
  });

  describe('State Management', () => {
    it('should return current profiler state', () => {
      const state = profiler.getState();

      expect(state).toBeDefined();
      expect(state.isProfiling).toBe(false);
      expect(state.measurements).toEqual([]);
      expect(state.bottlenecks).toEqual([]);
    });

    it('should include bottlenecks in state', () => {
      profiler.startProfiling();

      vi.mocked(performance.now).mockReturnValueOnce(0).mockReturnValueOnce(50);
      (profiler as any).startMeasuringComponent('comp-1', 'Slow');
      (profiler as any).endMeasuringComponent('comp-1');

      const state = profiler.getState();

      expect(state.bottlenecks.length).toBeGreaterThan(0);
    });

    it('should update current profile in state', () => {
      profiler.startProfiling();

      const state = profiler.getState();
      expect(state.currentProfile).toBeDefined();
      expect(state.currentProfile?.id).toBeDefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle missing measurement end', () => {
      profiler.startProfiling();

      (profiler as any).startMeasuringComponent('comp-1', 'Test');

      // End different component (typo scenario)
      (profiler as any).endMeasuringComponent('comp-2');

      const state = profiler.getState();
      // Should not have added measurement
      expect(state.measurements.length).toBe(0);
    });

    it('should handle stack trace in measurements', () => {
      profiler.startProfiling();

      (profiler as any).startMeasuringComponent('comp-1', 'Test');
      (profiler as any).endMeasuringComponent('comp-1');

      const state = profiler.getState();
      const measurement = state.measurements[0];

      expect(measurement.stack).toBeDefined();
      expect(typeof measurement.stack).toBe('string');
    });

    it('should handle zero duration measurements', () => {
      profiler.startProfiling();

      vi.mocked(performance.now).mockReturnValue(100);

      (profiler as any).startMeasuringComponent('comp-1', 'Instant');
      (profiler as any).endMeasuringComponent('comp-1');

      const state = profiler.getState();
      const measurement = state.measurements[0];

      expect(measurement.duration).toBe(0);
    });

    it('should handle concurrent measurements', () => {
      profiler.startProfiling();

      (profiler as any).startMeasuringComponent('comp-1', 'Component1');
      (profiler as any).startMeasuringEffect('effect-1', 'Effect1');

      (profiler as any).endMeasuringComponent('comp-1');
      (profiler as any).endMeasuringEffect('effect-1');

      const state = profiler.getState();
      expect(state.measurements.length).toBe(2);
    });
  });

  describe('Performance Overhead', () => {
    it('should have minimal overhead when not profiling', () => {
      const component = { name: 'Test' };
      const start = performance.now();

      for (let i = 0; i < 1000; i++) {
        profiler.measureComponent(component, () => {});
      }

      const duration = performance.now() - start;

      // Should be very fast (under 100ms for 1000 iterations)
      expect(duration).toBeLessThan(100);
    });
  });
});
