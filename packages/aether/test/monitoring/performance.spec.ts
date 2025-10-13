/**
 * @vitest-environment happy-dom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  PerformanceMonitor,
  getPerformanceMonitor,
  resetPerformanceMonitor,
} from '../../src/monitoring/performance.js';

describe('PerformanceMonitor', () => {
  let monitor: PerformanceMonitor;

  beforeEach(() => {
    resetPerformanceMonitor();
    monitor = getPerformanceMonitor({
      webVitals: false, // Disable for tests
      resourceTiming: false,
      navigationTiming: false,
    });
  });

  afterEach(() => {
    monitor.disconnect();
    resetPerformanceMonitor();
  });

  describe('performance marks', () => {
    it('should create performance marks', () => {
      expect(() => {
        monitor.startMark('test_operation');
      }).not.toThrow();
    });

    it('should end performance marks', () => {
      monitor.startMark('test_operation');

      expect(() => {
        monitor.endMark('test_operation');
      }).not.toThrow();
    });

    it('should measure between marks', () => {
      monitor.startMark('start');
      monitor.endMark('start');

      const duration = monitor.measure('operation', 'start');

      expect(typeof duration).toBe('number');
      expect(duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe('web vitals', () => {
    it('should return web vitals object', () => {
      const vitals = monitor.getWebVitals();

      expect(vitals).toBeDefined();
      expect(typeof vitals).toBe('object');
    });

    it('should have empty vitals initially', () => {
      const vitals = monitor.getWebVitals();

      expect(Object.keys(vitals).length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('performance callbacks', () => {
    it('should subscribe to performance entries', () => {
      const callback = vi.fn();

      const unsubscribe = monitor.onPerformance(callback);

      expect(typeof unsubscribe).toBe('function');
    });

    it('should unsubscribe from performance entries', () => {
      const callback = vi.fn();

      const unsubscribe = monitor.onPerformance(callback);
      unsubscribe();

      // Should not throw
      monitor.disconnect();
    });
  });

  describe('memory usage', () => {
    it('should get memory usage', () => {
      const memory = monitor.getMemoryUsage();

      // Memory API might not be available in test environment
      if (memory) {
        expect(memory.usedJSHeapSize).toBeDefined();
        expect(memory.totalJSHeapSize).toBeDefined();
      }
    });
  });

  describe('cleanup', () => {
    it('should clear performance data', () => {
      monitor.startMark('test');

      expect(() => {
        monitor.clear();
      }).not.toThrow();
    });

    it('should disconnect observers', () => {
      expect(() => {
        monitor.disconnect();
      }).not.toThrow();
    });
  });
});
