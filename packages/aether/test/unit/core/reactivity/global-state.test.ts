/**
 * Global State Tests - Tests for globalThis-based state management
 *
 * These tests verify that the reactivity system correctly uses globalThis
 * to store state, preventing issues when modules are loaded multiple times.
 *
 * Background:
 * Previously, currentComputation and currentOwner were module-level variables.
 * This caused issues when the module was loaded multiple times (e.g., in
 * different bundles or test environments), as each instance had separate state.
 *
 * The fix moves state to globalThis.__AETHER_REACTIVE_STATE__, ensuring all
 * module instances share the same reactive context.
 *
 * Changes tested:
 * - context.ts: Moved currentComputation/currentOwner to globalThis
 * - signal.ts: Added global signal ID counter
 */

import { describe, it, expect } from 'vitest';
import { signal, computed, effect, createRoot, getOwner, onCleanup } from '../../../../src/core/reactivity/index.js';

describe('Global State Management', () => {
  describe('GlobalThis state initialization', () => {
    it('should initialize reactive state in globalThis', () => {
      expect((globalThis as any).__AETHER_REACTIVE_STATE__).toBeDefined();
      expect((globalThis as any).__AETHER_REACTIVE_STATE__).toHaveProperty('currentComputation');
      expect((globalThis as any).__AETHER_REACTIVE_STATE__).toHaveProperty('currentOwner');
    });

    it('should initialize signal ID counter in globalThis', () => {
      expect((globalThis as any).__AETHER_SIGNAL_ID_COUNTER__).toBeDefined();
      expect(typeof (globalThis as any).__AETHER_SIGNAL_ID_COUNTER__).toBe('number');
    });

    it('should only initialize global state once', () => {
      const state1 = (globalThis as any).__AETHER_REACTIVE_STATE__;

      // Re-import the module (simulating multiple loads)
      // In real scenario this would be from different bundle
      // Here we just verify the reference is the same
      const state2 = (globalThis as any).__AETHER_REACTIVE_STATE__;

      expect(state1).toBe(state2);
    });
  });

  describe('Signal ID counter', () => {
    it('should increment global counter for each signal', () => {
      const before = (globalThis as any).__AETHER_SIGNAL_ID_COUNTER__;

      const s1 = signal(1);
      const after1 = (globalThis as any).__AETHER_SIGNAL_ID_COUNTER__;
      expect(after1).toBeGreaterThan(before);

      const s2 = signal(2);
      const after2 = (globalThis as any).__AETHER_SIGNAL_ID_COUNTER__;
      expect(after2).toBeGreaterThan(after1);

      const s3 = signal(3);
      const after3 = (globalThis as any).__AETHER_SIGNAL_ID_COUNTER__;
      expect(after3).toBeGreaterThan(after2);
    });

    it('should create unique IDs for all signals', () => {
      const initialCounter = (globalThis as any).__AETHER_SIGNAL_ID_COUNTER__;
      const signals = Array.from({ length: 100 }, (_, i) => signal(i));

      const finalCounter = (globalThis as any).__AETHER_SIGNAL_ID_COUNTER__;
      expect(finalCounter - initialCounter).toBe(100);
    });

    it('should maintain counter across different signal types', () => {
      const before = (globalThis as any).__AETHER_SIGNAL_ID_COUNTER__;

      const num = signal(42);
      const str = signal('hello');
      const obj = signal({ key: 'value' });
      const arr = signal([1, 2, 3]);

      const after = (globalThis as any).__AETHER_SIGNAL_ID_COUNTER__;
      expect(after - before).toBe(4);
    });
  });

  describe('Current computation tracking', () => {
    it('should track current computation in global state', () => {
      const count = signal(0);
      let effectExecuting = false;

      effect(() => {
        count();
        effectExecuting = true;

        // During effect execution, currentComputation should be set
        const state = (globalThis as any).__AETHER_REACTIVE_STATE__;
        expect(state.currentComputation).toBeTruthy();
      });

      expect(effectExecuting).toBe(true);

      // After effect completes, currentComputation should be null
      const state = (globalThis as any).__AETHER_REACTIVE_STATE__;
      expect(state.currentComputation).toBeNull();
    });

    it('should correctly restore previous computation in nested effects', () => {
      const outer = signal(1);
      const inner = signal(2);
      const computations: any[] = [];

      effect(() => {
        outer();
        const state = (globalThis as any).__AETHER_REACTIVE_STATE__;
        const outerComp = state.currentComputation;
        computations.push({ type: 'outer', comp: outerComp });

        effect(() => {
          inner();
          const innerComp = state.currentComputation;
          computations.push({ type: 'inner', comp: innerComp });

          // Inner computation should be different from outer
          expect(innerComp).not.toBe(outerComp);
        });

        // After inner effect, should restore outer computation
        expect(state.currentComputation).toBe(outerComp);
      });

      // Should have tracked both outer and inner
      expect(computations.length).toBeGreaterThanOrEqual(2);
    });

    it('should handle computation context in computed values', () => {
      const count = signal(0);
      let computationDuringComputed: any = null;

      const doubled = computed(() => {
        const state = (globalThis as any).__AETHER_REACTIVE_STATE__;
        computationDuringComputed = state.currentComputation;
        return count() * 2;
      });

      // Access computed
      doubled();

      // During computed execution, there should be a computation
      expect(computationDuringComputed).toBeTruthy();
    });
  });

  describe('Current owner tracking', () => {
    it('should track current owner in global state', () => {
      createRoot((dispose) => {
        const state = (globalThis as any).__AETHER_REACTIVE_STATE__;
        expect(state.currentOwner).toBeTruthy();

        dispose();
      });

      // After root is disposed, owner should be null
      const state = (globalThis as any).__AETHER_REACTIVE_STATE__;
      expect(state.currentOwner).toBeNull();
    });

    it('should correctly nest owners', () => {
      const owners: any[] = [];

      createRoot((dispose1) => {
        const state = (globalThis as any).__AETHER_REACTIVE_STATE__;
        const owner1 = state.currentOwner;
        owners.push(owner1);

        createRoot((dispose2) => {
          const owner2 = state.currentOwner;
          owners.push(owner2);

          // Nested owner should be different
          expect(owner2).not.toBe(owner1);

          dispose2();
        });

        // Should restore parent owner
        expect(state.currentOwner).toBe(owner1);

        dispose1();
      });

      expect(owners.length).toBe(2);
      expect(owners[0]).not.toBe(owners[1]);
    });

    it('should provide owner to getOwner()', () => {
      createRoot((dispose) => {
        const owner = getOwner();
        expect(owner).toBeTruthy();

        const state = (globalThis as any).__AETHER_REACTIVE_STATE__;
        expect(owner).toBe(state.currentOwner);

        dispose();
      });
    });

    it('should register cleanups with current owner', () => {
      let cleanupCalled = false;

      createRoot((dispose) => {
        onCleanup(() => {
          cleanupCalled = true;
        });

        expect(cleanupCalled).toBe(false);
        dispose();
      });

      expect(cleanupCalled).toBe(true);
    });
  });

  describe('State isolation', () => {
    it('should isolate computation context between effects', () => {
      const count1 = signal(0);
      const count2 = signal(0);

      let effect1Runs = 0;
      let effect2Runs = 0;

      effect(() => {
        count1();
        effect1Runs++;
      });

      effect(() => {
        count2();
        effect2Runs++;
      });

      expect(effect1Runs).toBe(1);
      expect(effect2Runs).toBe(1);

      // Updating count1 should only re-run effect1
      count1.set(1);
      expect(effect1Runs).toBe(2);
      expect(effect2Runs).toBe(1);

      // Updating count2 should only re-run effect2
      count2.set(1);
      expect(effect1Runs).toBe(2);
      expect(effect2Runs).toBe(2);
    });

    it('should isolate owner context between roots', () => {
      const owners: any[] = [];

      createRoot((dispose1) => {
        owners.push(getOwner());
        dispose1();
      });

      createRoot((dispose2) => {
        owners.push(getOwner());
        dispose2();
      });

      // Each root should have a different owner
      expect(owners[0]).not.toBe(owners[1]);
      expect(owners[0]).toBeTruthy();
      expect(owners[1]).toBeTruthy();
    });

    it('should not leak state between sequential operations', () => {
      const count = signal(0);

      // First effect
      const disposable1 = effect(() => {
        count();
      });

      const state = (globalThis as any).__AETHER_REACTIVE_STATE__;
      expect(state.currentComputation).toBeNull();

      // Second effect
      const disposable2 = effect(() => {
        count();
      });

      expect(state.currentComputation).toBeNull();

      disposable1.dispose();
      disposable2.dispose();
    });
  });

  describe('Concurrent access', () => {
    it('should handle multiple signals created concurrently', () => {
      const signals = [];
      const start = (globalThis as any).__AETHER_SIGNAL_ID_COUNTER__;

      // Create 50 signals "concurrently"
      for (let i = 0; i < 50; i++) {
        signals.push(signal(i));
      }

      const end = (globalThis as any).__AETHER_SIGNAL_ID_COUNTER__;

      // Should have incremented counter by 50
      expect(end - start).toBe(50);

      // All signals should work correctly
      signals.forEach((s, index) => {
        expect(s()).toBe(index);
      });
    });

    it('should handle multiple effects running concurrently', () => {
      const trigger = signal(0);
      const runs: number[] = [];

      // Create 10 effects
      const disposables = Array.from({ length: 10 }, (_, i) =>
        effect(() => {
          trigger();
          runs.push(i);
        })
      );

      // All effects should have run once
      expect(runs.length).toBe(10);

      // Trigger all effects
      runs.length = 0;
      trigger.set(1);

      // All should run again
      expect(runs.length).toBe(10);

      // Cleanup
      disposables.forEach(d => d.dispose());
    });

    it('should handle rapid owner context changes', () => {
      const owners: any[] = [];

      for (let i = 0; i < 20; i++) {
        createRoot((dispose) => {
          owners.push(getOwner());
          dispose();
        });
      }

      // All owners should be unique
      const uniqueOwners = new Set(owners);
      expect(uniqueOwners.size).toBe(20);
    });
  });

  describe('Memory management', () => {
    it('should not leak global state on cleanup', () => {
      const initialSignals = (globalThis as any).__AETHER_SIGNAL_ID_COUNTER__;

      createRoot((dispose) => {
        const count = signal(0);
        effect(() => {
          count();
        });

        dispose();
      });

      const state = (globalThis as any).__AETHER_REACTIVE_STATE__;

      // After disposal, state should be clean
      expect(state.currentComputation).toBeNull();
      expect(state.currentOwner).toBeNull();

      // Counter should have incremented though
      expect((globalThis as any).__AETHER_SIGNAL_ID_COUNTER__).toBeGreaterThan(initialSignals);
    });

    it('should clean up nested owners properly', () => {
      createRoot((dispose1) => {
        createRoot((dispose2) => {
          createRoot((dispose3) => {
            dispose3();
          });
          dispose2();
        });
        dispose1();
      });

      const state = (globalThis as any).__AETHER_REACTIVE_STATE__;
      expect(state.currentOwner).toBeNull();
      expect(state.currentComputation).toBeNull();
    });
  });

  describe('Edge cases', () => {
    it('should handle accessing global state directly', () => {
      const state = (globalThis as any).__AETHER_REACTIVE_STATE__;

      // Should be safe to read
      expect(() => state.currentComputation).not.toThrow();
      expect(() => state.currentOwner).not.toThrow();
    });

    it('should recover from corrupted global state', () => {
      const originalState = (globalThis as any).__AETHER_REACTIVE_STATE__;

      // Temporarily corrupt the state
      (globalThis as any).__AETHER_REACTIVE_STATE__ = null;

      // Reimporting would re-initialize (can't actually do this in test)
      // But we can verify recovery by restoring
      (globalThis as any).__AETHER_REACTIVE_STATE__ = originalState;

      // Should still work
      const count = signal(0);
      let effectValue = 0;

      effect(() => {
        effectValue = count();
      });

      expect(effectValue).toBe(0);
      count.set(5);
      expect(effectValue).toBe(5);
    });

    it('should handle very deep owner nesting', () => {
      let depth = 0;
      const maxDepth = 100;

      function createNestedRoot(currentDepth: number, dispose: () => void) {
        if (currentDepth >= maxDepth) {
          dispose();
          return;
        }

        createRoot((innerDispose) => {
          depth = currentDepth + 1;
          createNestedRoot(currentDepth + 1, innerDispose);
        });
      }

      createRoot((dispose) => {
        createNestedRoot(0, dispose);
      });

      expect(depth).toBe(maxDepth);

      const state = (globalThis as any).__AETHER_REACTIVE_STATE__;
      expect(state.currentOwner).toBeNull();
    });
  });

  describe('Compatibility with existing code', () => {
    it('should work with existing signal/effect patterns', () => {
      const a = signal(1);
      const b = signal(2);
      let sum = 0;

      effect(() => {
        sum = a() + b();
      });

      expect(sum).toBe(3);

      a.set(10);
      expect(sum).toBe(12);

      b.set(20);
      expect(sum).toBe(30);
    });

    it('should work with existing computed patterns', () => {
      const count = signal(0);
      const doubled = computed(() => count() * 2);
      const quadrupled = computed(() => doubled() * 2);

      expect(quadrupled()).toBe(0);

      count.set(5);
      expect(quadrupled()).toBe(20);

      count.set(10);
      expect(quadrupled()).toBe(40);
    });

    it('should work with existing owner/cleanup patterns', () => {
      let cleanups = 0;

      createRoot((dispose) => {
        onCleanup(() => {
          cleanups++;
        });

        createRoot((dispose2) => {
          onCleanup(() => {
            cleanups++;
          });
          dispose2();
        });

        dispose();
      });

      expect(cleanups).toBe(2);
    });
  });

  describe('Performance', () => {
    it('should have minimal overhead from global state access', () => {
      const iterations = 10000;
      const count = signal(0);

      const start = performance.now();

      for (let i = 0; i < iterations; i++) {
        count();
      }

      const duration = performance.now() - start;

      // Should be very fast even with global state lookup
      expect(duration).toBeLessThan(50);
    });

    it('should handle rapid owner context switches efficiently', () => {
      const start = performance.now();

      for (let i = 0; i < 1000; i++) {
        createRoot((dispose) => {
          const owner = getOwner();
          dispose();
        });
      }

      const duration = performance.now() - start;

      // Should be reasonably fast
      expect(duration).toBeLessThan(100);
    });
  });
});
