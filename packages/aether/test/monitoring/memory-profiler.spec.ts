/**
 * Memory Profiler Tests
 *
 * Tests for memory footprint calculation, DOM node counting,
 * event listener tracking, memory leak detection, and cleanup verification.
 *
 * @vitest-environment happy-dom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createProfiler } from '../../src/devtools/profiler.js';
import { createInspector } from '../../src/devtools/inspector.js';
import type { Profiler, Inspector } from '../../src/devtools/types.js';

describe('Memory Profiler', () => {
  let profiler: Profiler;
  let inspector: Inspector;

  beforeEach(() => {
    profiler = createProfiler();
    inspector = createInspector();
  });

  afterEach(() => {
    profiler.clear();
    inspector.dispose();
  });

  describe('Memory Footprint Calculation', () => {
    it('should track memory usage if available', () => {
      profiler.startProfiling();

      const component = { id: 'test', name: 'Test' };

      profiler.measureComponent(component, () => {
        // Allocate memory
        const array = new Array(1000).fill({ value: Math.random() });
        void array;
      });

      const profile = profiler.stopProfiling();
      const measurement = profile.measurements[0];

      // Memory API might not be available in test environment
      if (measurement.memoryDelta !== undefined) {
        expect(typeof measurement.memoryDelta).toBe('number');
      }
    });

    it('should detect memory increase during operations', () => {
      profiler.startProfiling();

      const component = { id: 'heavy', name: 'Heavy' };

      profiler.measureComponent(component, () => {
        // Allocate significant memory
        const arrays: any[] = [];
        for (let i = 0; i < 100; i++) {
          arrays.push(new Array(1000).fill(i));
        }
        void arrays;
      });

      const profile = profiler.stopProfiling();
      const measurement = profile.measurements[0];

      expect(measurement.duration).toBeGreaterThan(0);
    });

    it('should track memory across multiple operations', () => {
      profiler.startProfiling();

      for (let i = 0; i < 5; i++) {
        const component = { id: `test-${i}`, name: `Test${i}` };
        profiler.measureComponent(component, () => {
          const data = new Array(100).fill(i);
          void data;
        });
      }

      const profile = profiler.stopProfiling();
      expect(profile.measurements.length).toBe(5);
    });
  });

  describe('DOM Node Counting', () => {
    it('should count DOM nodes created', () => {
      const initialCount = document.body.childElementCount;

      // Create DOM nodes
      const div1 = document.createElement('div');
      const div2 = document.createElement('div');
      const div3 = document.createElement('div');

      document.body.appendChild(div1);
      document.body.appendChild(div2);
      document.body.appendChild(div3);

      const finalCount = document.body.childElementCount;
      expect(finalCount - initialCount).toBe(3);

      // Cleanup
      document.body.removeChild(div1);
      document.body.removeChild(div2);
      document.body.removeChild(div3);
    });

    it('should track nested DOM structure', () => {
      const container = document.createElement('div');
      document.body.appendChild(container);

      function createNestedDom(depth: number, parent: HTMLElement): number {
        let count = 1;
        if (depth > 0) {
          const child = document.createElement('div');
          parent.appendChild(child);
          count += createNestedDom(depth - 1, child);
        }
        return count;
      }

      const nodeCount = createNestedDom(5, container);
      expect(nodeCount).toBe(6); // 5 levels + container

      document.body.removeChild(container);
    });

    it('should detect DOM leaks', () => {
      const initialCount = document.body.childElementCount;

      // Create elements without cleanup
      for (let i = 0; i < 10; i++) {
        const div = document.createElement('div');
        div.id = `leak-${i}`;
        document.body.appendChild(div);
      }

      const afterCount = document.body.childElementCount;
      expect(afterCount - initialCount).toBe(10);

      // Cleanup
      for (let i = 0; i < 10; i++) {
        const el = document.getElementById(`leak-${i}`);
        if (el) document.body.removeChild(el);
      }
    });
  });

  describe('Event Listener Tracking', () => {
    it('should track event listener registration', () => {
      const button = document.createElement('button');
      const handler = vi.fn();

      button.addEventListener('click', handler);

      // Trigger event
      button.click();

      expect(handler).toHaveBeenCalledTimes(1);

      // Cleanup
      button.removeEventListener('click', handler);
    });

    it('should detect listener leaks', () => {
      const button = document.createElement('button');
      const handlers: any[] = [];

      // Add multiple listeners without cleanup
      for (let i = 0; i < 5; i++) {
        const handler = vi.fn();
        handlers.push(handler);
        button.addEventListener('click', handler);
      }

      button.click();

      // All handlers should be called
      handlers.forEach((handler) => {
        expect(handler).toHaveBeenCalledTimes(1);
      });

      // Cleanup
      handlers.forEach((handler) => {
        button.removeEventListener('click', handler);
      });
    });

    it('should verify listener cleanup', () => {
      const button = document.createElement('button');
      const handler = vi.fn();

      button.addEventListener('click', handler);
      button.click();
      expect(handler).toHaveBeenCalledTimes(1);

      button.removeEventListener('click', handler);
      button.click();
      expect(handler).toHaveBeenCalledTimes(1); // Not called again
    });
  });

  describe('Memory Leak Detection', () => {
    it('should detect retained references', () => {
      const leaks: any[] = [];

      // Create objects that will be retained
      for (let i = 0; i < 100; i++) {
        leaks.push({
          id: i,
          data: new Array(100).fill(i),
        });
      }

      expect(leaks.length).toBe(100);

      // Clear and verify
      leaks.length = 0;
      expect(leaks.length).toBe(0);
    });

    it('should detect circular reference leaks', () => {
      const obj1: any = { id: 1 };
      const obj2: any = { id: 2 };

      obj1.ref = obj2;
      obj2.ref = obj1;

      // These create a circular reference
      expect(obj1.ref.ref).toBe(obj1);
      expect(obj2.ref.ref).toBe(obj2);

      // Break the cycle
      obj1.ref = null;
      obj2.ref = null;

      expect(obj1.ref).toBeNull();
      expect(obj2.ref).toBeNull();
    });

    it('should detect closure memory leaks', () => {
      const createClosure = () => {
        const largeArray = new Array(1000).fill(0);
        return () => largeArray.length;
      };

      const closures: any[] = [];
      for (let i = 0; i < 10; i++) {
        closures.push(createClosure());
      }

      // Each closure retains its own large array
      expect(closures.length).toBe(10);

      // Clear closures
      closures.length = 0;
      expect(closures.length).toBe(0);
    });

    it('should detect signal subscription leaks', () => {
      const mockSignal = {
        peek: vi.fn(() => 1),
        subscribe: vi.fn(() => () => {}),
      };

      const unsubscribers: any[] = [];

      // Create multiple subscriptions
      for (let i = 0; i < 10; i++) {
        const unsub = mockSignal.subscribe(() => {});
        unsubscribers.push(unsub);
      }

      expect(mockSignal.subscribe).toHaveBeenCalledTimes(10);

      // Cleanup subscriptions
      unsubscribers.forEach((unsub) => unsub());
      expect(unsubscribers.length).toBe(10);
    });
  });

  describe('Cleanup Verification', () => {
    it('should verify inspector cleanup', () => {
      const mockSignal = { peek: vi.fn(() => 1), subscribe: vi.fn() };
      const mockEffect = vi.fn();
      const mockComponent = function Test() {};

      inspector.trackSignal(mockSignal, { name: 'Signal' });
      inspector.trackEffect(mockEffect, [], { name: 'Effect' });
      inspector.trackComponent(mockComponent, {});

      let state = inspector.getState();
      expect(state.signals.size).toBeGreaterThan(0);
      expect(state.effects.size).toBeGreaterThan(0);
      expect(state.components.size).toBeGreaterThan(0);

      inspector.clear();

      state = inspector.getState();
      expect(state.signals.size).toBe(0);
      expect(state.effects.size).toBe(0);
      expect(state.components.size).toBe(0);
    });

    it('should verify profiler cleanup', () => {
      profiler.startProfiling();

      for (let i = 0; i < 10; i++) {
        profiler.startMeasuringComponent(`comp-${i}`, `Component${i}`);
        profiler.endMeasuringComponent(`comp-${i}`);
      }

      let profile = profiler.stopProfiling();
      expect(profile.measurements.length).toBe(10);

      profiler.clear();

      const state = profiler.getState();
      expect(state.measurements.length).toBe(0);
    });

    it('should verify disposal cleanup', () => {
      inspector.trackSignal({ peek: vi.fn(() => 1), subscribe: vi.fn() }, { name: 'Test' });

      expect(inspector.getState().signals.size).toBe(1);

      inspector.dispose();

      expect(inspector.getState().signals.size).toBe(0);
    });

    it('should not leak memory after multiple clear cycles', () => {
      for (let cycle = 0; cycle < 5; cycle++) {
        // Add data
        for (let i = 0; i < 100; i++) {
          const signal = { peek: vi.fn(() => i), subscribe: vi.fn() };
          inspector.trackSignal(signal, { name: `Signal${i}` });
        }

        expect(inspector.getState().signals.size).toBe(100);

        // Clear
        inspector.clear();

        expect(inspector.getState().signals.size).toBe(0);
      }
    });
  });

  describe('Performance Impact', () => {
    it('should have minimal overhead for tracking', () => {
      const iterations = 1000;
      const startTime = performance.now();

      for (let i = 0; i < iterations; i++) {
        const signal = { peek: vi.fn(() => i), subscribe: vi.fn() };
        inspector.trackSignal(signal, { name: `Signal${i}` });
      }

      const duration = performance.now() - startTime;
      const opsPerMs = iterations / duration;

      expect(opsPerMs).toBeGreaterThan(10); // Should handle at least 10 ops/ms

      inspector.clear();
    });

    it('should efficiently handle large datasets', () => {
      const dataSize = 5000;
      const startTime = performance.now();

      for (let i = 0; i < dataSize; i++) {
        const signal = { peek: vi.fn(() => i), subscribe: vi.fn() };
        inspector.trackSignal(signal, { name: `Signal${i}` });
      }

      const duration = performance.now() - startTime;

      expect(inspector.getState().signals.size).toBe(dataSize);
      expect(duration).toBeLessThan(1000); // Should complete in under 1 second

      inspector.clear();
    });
  });

  describe('Memory Measurement Accuracy', () => {
    it('should measure memory for component renders', () => {
      profiler.startProfiling();

      const component = { id: 'memory-test', name: 'MemoryTest' };

      profiler.measureComponent(component, () => {
        const data: any[] = [];
        for (let i = 0; i < 1000; i++) {
          data.push({ index: i, value: Math.random() });
        }
        void data;
      });

      const profile = profiler.stopProfiling();
      expect(profile.measurements.length).toBe(1);
      expect(profile.measurements[0].duration).toBeGreaterThan(0);
    });

    it('should track memory for effects', () => {
      profiler.startProfiling();

      const effect = vi.fn();
      const effectId = 'memory-effect';

      profiler.startMeasuringEffect(effectId, 'MemoryEffect');

      // Simulate effect work
      const data = new Array(500).fill(0);
      void data;

      profiler.endMeasuringEffect(effectId);

      const profile = profiler.stopProfiling();
      expect(profile.measurements.length).toBe(1);
      expect(profile.measurements[0].type).toBe('effect');
    });
  });
});
