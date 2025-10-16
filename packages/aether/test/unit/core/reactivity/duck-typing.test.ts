/**
 * Duck Typing Tests - Tests for module duplication fix
 *
 * These tests verify that the reactivity system uses duck typing instead of
 * instanceof checks to avoid module duplication issues.
 *
 * Background:
 * When modules are loaded multiple times (different bundles, test environments),
 * instanceof checks fail because each module instance has its own class definitions.
 * The fix replaces instanceof with duck typing (checking for method existence).
 *
 * Changes tested:
 * - signal.ts: Changed instanceof ComputationImpl to duck typing
 * - computed.ts: Changed instanceof ComputationImpl to duck typing
 * - context.ts: Moved state to globalThis to prevent duplication
 */

import { describe, it, expect, vi } from 'vitest';
import { signal, computed, effect } from '../../../../src/core/reactivity/index.js';

describe('Duck Typing for Module Duplication', () => {
  describe('Signal duck typing', () => {
    it('should track dependencies using duck typing (not instanceof)', () => {
      const count = signal(0);
      let effectValue = 0;

      effect(() => {
        effectValue = count();
      });

      expect(effectValue).toBe(0);

      count.set(5);
      expect(effectValue).toBe(5);
    });

    it('should handle computation-like objects with addDependency method', () => {
      const count = signal(0);

      // Mock a computation-like object (simulating module from different bundle)
      const mockComputation = {
        addDependency: vi.fn(),
        dependencies: new Set(),
      };

      // Temporarily inject mock computation
      const prevComp = (globalThis as any).__AETHER_REACTIVE_STATE__.currentComputation;
      (globalThis as any).__AETHER_REACTIVE_STATE__.currentComputation = mockComputation;

      // Access signal - should call addDependency via duck typing
      count();

      expect(mockComputation.addDependency).toHaveBeenCalled();

      // Restore
      (globalThis as any).__AETHER_REACTIVE_STATE__.currentComputation = prevComp;
    });

    it('should gracefully handle objects without addDependency', () => {
      const count = signal(0);

      // Mock a broken computation without addDependency
      const brokenComputation = {
        // No addDependency method
        someOtherMethod: () => {},
      };

      const prevComp = (globalThis as any).__AETHER_REACTIVE_STATE__.currentComputation;
      (globalThis as any).__AETHER_REACTIVE_STATE__.currentComputation = brokenComputation;

      // Should not throw when accessing signal
      expect(() => count()).not.toThrow();
      expect(count()).toBe(0);

      // Restore
      (globalThis as any).__AETHER_REACTIVE_STATE__.currentComputation = prevComp;
    });

    it('should gracefully handle null computation', () => {
      const count = signal(0);

      const prevComp = (globalThis as any).__AETHER_REACTIVE_STATE__.currentComputation;
      (globalThis as any).__AETHER_REACTIVE_STATE__.currentComputation = null;

      expect(() => count()).not.toThrow();
      expect(count()).toBe(0);

      (globalThis as any).__AETHER_REACTIVE_STATE__.currentComputation = prevComp;
    });

    it('should gracefully handle undefined computation', () => {
      const count = signal(0);

      const prevComp = (globalThis as any).__AETHER_REACTIVE_STATE__.currentComputation;
      (globalThis as any).__AETHER_REACTIVE_STATE__.currentComputation = undefined;

      expect(() => count()).not.toThrow();
      expect(count()).toBe(0);

      (globalThis as any).__AETHER_REACTIVE_STATE__.currentComputation = prevComp;
    });

    it('should work correctly with real effect (integration)', () => {
      const a = signal(1);
      const b = signal(2);
      let sum = 0;

      effect(() => {
        sum = a() + b();
      });

      expect(sum).toBe(3);

      a.set(5);
      expect(sum).toBe(7);

      b.set(10);
      expect(sum).toBe(15);
    });
  });

  describe('Computed duck typing', () => {
    it('should track dependencies using duck typing (not instanceof)', () => {
      const count = signal(0);
      const doubled = computed(() => count() * 2);

      expect(doubled()).toBe(0);

      count.set(5);
      expect(doubled()).toBe(10);
    });

    it('should handle nested computed with duck typing', () => {
      const a = signal(1);
      const b = signal(2);
      const sum = computed(() => a() + b());
      const doubled = computed(() => sum() * 2);

      expect(doubled()).toBe(6);

      a.set(5);
      expect(doubled()).toBe(14);

      b.set(10);
      expect(doubled()).toBe(30);
    });

    it('should work with computed in effect using duck typing', () => {
      const count = signal(0);
      const doubled = computed(() => count() * 2);
      let effectValue = 0;

      effect(() => {
        effectValue = doubled();
      });

      expect(effectValue).toBe(0);

      count.set(5);
      expect(effectValue).toBe(10);
    });

    it('should handle computation-like objects in computed', () => {
      const count = signal(5);

      // Mock a computation-like object
      const mockComputation = {
        addDependency: vi.fn(),
        dependencies: new Set(),
      };

      const prevComp = (globalThis as any).__AETHER_REACTIVE_STATE__.currentComputation;
      (globalThis as any).__AETHER_REACTIVE_STATE__.currentComputation = mockComputation;

      // Create computed - should track using duck typing
      const doubled = computed(() => count() * 2);
      doubled(); // Access to trigger tracking

      // Both signal and computed should have called addDependency
      expect(mockComputation.addDependency).toHaveBeenCalled();

      (globalThis as any).__AETHER_REACTIVE_STATE__.currentComputation = prevComp;
    });

    it('should gracefully handle objects without addDependency in computed', () => {
      const count = signal(5);
      const brokenComputation = {
        someMethod: () => {},
      };

      const prevComp = (globalThis as any).__AETHER_REACTIVE_STATE__.currentComputation;
      (globalThis as any).__AETHER_REACTIVE_STATE__.currentComputation = brokenComputation;

      const doubled = computed(() => count() * 2);

      expect(() => doubled()).not.toThrow();
      expect(doubled()).toBe(10);

      (globalThis as any).__AETHER_REACTIVE_STATE__.currentComputation = prevComp;
    });
  });

  describe('GlobalThis state management', () => {
    it('should store reactive state in globalThis', () => {
      // Check that the global reactive state exists
      expect((globalThis as any).__AETHER_REACTIVE_STATE__).toBeDefined();
      expect((globalThis as any).__AETHER_REACTIVE_STATE__).toHaveProperty('currentComputation');
      expect((globalThis as any).__AETHER_REACTIVE_STATE__).toHaveProperty('currentOwner');
    });

    it('should use global signal ID counter', () => {
      expect((globalThis as any).__AETHER_SIGNAL_ID_COUNTER__).toBeDefined();

      const initialCount = (globalThis as any).__AETHER_SIGNAL_ID_COUNTER__;
      const signal1 = signal(1);
      const afterSignal1 = (globalThis as any).__AETHER_SIGNAL_ID_COUNTER__;

      expect(afterSignal1).toBeGreaterThan(initialCount);

      const signal2 = signal(2);
      const afterSignal2 = (globalThis as any).__AETHER_SIGNAL_ID_COUNTER__;

      expect(afterSignal2).toBeGreaterThan(afterSignal1);
    });

    it('should maintain global state across multiple signal creations', () => {
      const signals: Array<() => number> = [];

      for (let i = 0; i < 10; i++) {
        const s = signal(i);
        signals.push(s);
      }

      // All signals should work correctly
      for (let i = 0; i < 10; i++) {
        expect(signals[i]()).toBe(i);
      }
    });

    it('should track computations in global state', () => {
      const count = signal(0);
      let effectRan = false;

      effect(() => {
        count();
        effectRan = true;
      });

      expect(effectRan).toBe(true);

      // The effect should be registered in global state
      // and should re-run on signal change
      effectRan = false;
      count.set(1);
      expect(effectRan).toBe(true);
    });

    it('should share global state between nested effects', () => {
      const outer = signal(0);
      const inner = signal(0);
      let outerRuns = 0;
      let innerRuns = 0;

      effect(() => {
        outer();
        outerRuns++;

        effect(() => {
          inner();
          innerRuns++;
        });
      });

      expect(outerRuns).toBe(1);
      expect(innerRuns).toBe(1);

      inner.set(1);
      expect(innerRuns).toBe(2);
      expect(outerRuns).toBe(1); // Outer should not re-run

      outer.set(1);
      expect(outerRuns).toBe(2);
      expect(innerRuns).toBe(3); // Inner created again
    });
  });

  describe('Module duplication scenarios', () => {
    it('should work when computation has different prototype', () => {
      const count = signal(0);

      // Simulate a computation from a different module instance
      // It has the same methods but different prototype
      const foreignComputation = {
        addDependency: vi.fn((dep) => {
          foreignComputation.dependencies.add(dep);
        }),
        dependencies: new Set(),
        execute: vi.fn(),
        invalidate: vi.fn(),
      };

      const prevComp = (globalThis as any).__AETHER_REACTIVE_STATE__.currentComputation;
      (globalThis as any).__AETHER_REACTIVE_STATE__.currentComputation = foreignComputation;

      // Access signal
      const value = count();
      expect(value).toBe(0);

      // Should have called addDependency via duck typing
      expect(foreignComputation.addDependency).toHaveBeenCalled();
      expect(foreignComputation.dependencies.size).toBeGreaterThan(0);

      (globalThis as any).__AETHER_REACTIVE_STATE__.currentComputation = prevComp;
    });

    it('should handle mixed module sources in dependency chain', () => {
      const a = signal(1);
      const b = signal(2);

      // Create computed with normal module
      const sum = computed(() => a() + b());

      // Create effect with mock "foreign" computation
      const mockEffect = {
        addDependency: vi.fn(),
        dependencies: new Set(),
      };

      const prevComp = (globalThis as any).__AETHER_REACTIVE_STATE__.currentComputation;
      (globalThis as any).__AETHER_REACTIVE_STATE__.currentComputation = mockEffect;

      // Access computed from "foreign" effect
      const result = sum();
      expect(result).toBe(3);

      // Should have tracked via duck typing
      expect(mockEffect.addDependency).toHaveBeenCalled();

      (globalThis as any).__AETHER_REACTIVE_STATE__.currentComputation = prevComp;
    });

    it('should correctly dispose effects from different module instances', () => {
      const count = signal(0);
      let runs = 0;

      // Create effect normally
      const disposable = effect(() => {
        count();
        runs++;
      });

      expect(runs).toBe(1);

      count.set(1);
      expect(runs).toBe(2);

      // Dispose should work even if effect was from "different module"
      disposable.dispose();

      count.set(2);
      expect(runs).toBe(2); // Should not run after disposal
    });
  });

  describe('Performance with duck typing', () => {
    it('should be performant with many signals and duck typing', () => {
      const signals = Array.from({ length: 100 }, (_, i) => signal(i));
      const start = performance.now();

      // Access all signals many times
      for (let i = 0; i < 1000; i++) {
        signals.forEach((s) => s());
      }

      const duration = performance.now() - start;
      expect(duration).toBeLessThan(100); // Should be fast
    });

    it('should be performant with nested computeds using duck typing', () => {
      const base = signal(1);

      // Create chain of 50 computed values
      let current = computed(() => base());
      for (let i = 0; i < 49; i++) {
        const prev = current;
        current = computed(() => prev() + 1);
      }

      const start = performance.now();

      // Access the final computed 1000 times
      for (let i = 0; i < 1000; i++) {
        current();
      }

      const duration = performance.now() - start;
      expect(duration).toBeLessThan(100); // Should still be fast
    });

    it('should handle rapid effect creation/disposal with duck typing', () => {
      const count = signal(0);
      const start = performance.now();

      // Create and dispose 1000 effects
      for (let i = 0; i < 1000; i++) {
        const disposable = effect(() => {
          count();
        });
        disposable.dispose();
      }

      const duration = performance.now() - start;
      expect(duration).toBeLessThan(200); // Should be reasonably fast
    });
  });

  describe('Edge cases with duck typing', () => {
    it('should handle computation with addDependency that throws', () => {
      const count = signal(0);

      const brokenComputation = {
        addDependency: () => {
          throw new Error('addDependency failed');
        },
      };

      const prevComp = (globalThis as any).__AETHER_REACTIVE_STATE__.currentComputation;
      (globalThis as any).__AETHER_REACTIVE_STATE__.currentComputation = brokenComputation;

      // Should throw when trying to add dependency
      expect(() => count()).toThrow('addDependency failed');

      (globalThis as any).__AETHER_REACTIVE_STATE__.currentComputation = prevComp;
    });

    it('should handle computation with non-function addDependency', () => {
      const count = signal(0);

      const weirdComputation = {
        addDependency: 'not a function',
      };

      const prevComp = (globalThis as any).__AETHER_REACTIVE_STATE__.currentComputation;
      (globalThis as any).__AETHER_REACTIVE_STATE__.currentComputation = weirdComputation;

      // Should not treat it as a valid computation
      expect(() => count()).not.toThrow();

      (globalThis as any).__AETHER_REACTIVE_STATE__.currentComputation = prevComp;
    });

    it('should handle rapidly changing computation context', () => {
      const count = signal(0);

      const comp1 = { addDependency: vi.fn(), dependencies: new Set() };
      const comp2 = { addDependency: vi.fn(), dependencies: new Set() };

      const prevComp = (globalThis as any).__AETHER_REACTIVE_STATE__.currentComputation;

      // Rapidly switch contexts
      for (let i = 0; i < 10; i++) {
        (globalThis as any).__AETHER_REACTIVE_STATE__.currentComputation = i % 2 === 0 ? comp1 : comp2;
        count();
      }

      // Both should have been called
      expect(comp1.addDependency).toHaveBeenCalled();
      expect(comp2.addDependency).toHaveBeenCalled();

      (globalThis as any).__AETHER_REACTIVE_STATE__.currentComputation = prevComp;
    });
  });

  describe('Compatibility', () => {
    it('should work seamlessly with existing effect implementation', () => {
      const count = signal(0);
      const multiplier = signal(2);
      const results: number[] = [];

      effect(() => {
        results.push(count() * multiplier());
      });

      expect(results).toEqual([0]);

      count.set(5);
      expect(results).toEqual([0, 10]);

      multiplier.set(3);
      expect(results).toEqual([0, 10, 15]);
    });

    it('should work with existing computed implementation', () => {
      const a = signal(1);
      const b = signal(2);
      const sum = computed(() => a() + b());
      const product = computed(() => a() * b());
      const combined = computed(() => sum() + product());

      expect(combined()).toBe(5); // (1+2) + (1*2) = 3 + 2 = 5

      a.set(3);
      expect(combined()).toBe(11); // (3+2) + (3*2) = 5 + 6 = 11

      b.set(4);
      expect(combined()).toBe(19); // (3+4) + (3*4) = 7 + 12 = 19
    });

    it('should work with all existing reactivity patterns', () => {
      const count = signal(0);
      const doubled = computed(() => count() * 2);
      let effectValue = 0;

      // Pattern: signal -> computed -> effect
      effect(() => {
        effectValue = doubled();
      });

      expect(effectValue).toBe(0);

      count.set(5);
      expect(effectValue).toBe(10);

      // Pattern: direct signal in effect
      let directValue = 0;
      effect(() => {
        directValue = count();
      });

      expect(directValue).toBe(5);

      count.set(10);
      expect(effectValue).toBe(20);
      expect(directValue).toBe(10);
    });
  });
});
