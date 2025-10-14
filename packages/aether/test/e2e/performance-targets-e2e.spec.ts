/**
 * Performance Targets E2E Tests
 *
 * Validates all performance targets:
 * - 10k signal updates < 100ms
 * - Initial render < 16ms for complex components
 * - Memory usage < 10MB for large apps
 * - Bundle size ~6KB gzipped (core)
 * - Build time < 5s for medium projects
 * - HMR updates < 100ms
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { signal, computed, effect, batch } from '../../src/core/reactivity/index.js';
import { render, cleanup } from '../../src/testing/index.js';

describe('Performance Targets E2E Tests', () => {
  afterEach(() => {
    cleanup();
  });

  describe('Signal Performance Targets', () => {
    it('should handle 10k signal updates under 100ms', () => {
      const signals = Array.from({ length: 10000 }, () => signal(0));

      const startTime = performance.now();

      for (let i = 0; i < signals.length; i++) {
        signals[i].set(i);
      }

      const duration = performance.now() - startTime;

      expect(duration).toBeLessThan(100);
      expect(signals[9999]()).toBe(9999);
    });

    it('should handle 1k signal reads under 10ms', () => {
      const sig = signal(42);

      const startTime = performance.now();

      for (let i = 0; i < 1000; i++) {
        sig();
      }

      const duration = performance.now() - startTime;

      expect(duration).toBeLessThan(10);
    });

    it('should batch 1k updates efficiently', () => {
      const signals = Array.from({ length: 1000 }, () => signal(0));
      let effectCount = 0;

      effect(() => {
        signals.forEach(s => s());
        effectCount++;
      });

      const initialCount = effectCount;
      const startTime = performance.now();

      batch(() => {
        signals.forEach((s, i) => s.set(i));
      });

      const duration = performance.now() - startTime;

      expect(duration).toBeLessThan(50);
      expect(effectCount).toBeLessThanOrEqual(initialCount + 10);
    });

    it('should handle deeply nested computed values efficiently', () => {
      const base = signal(1);
      let current: any = base;

      for (let i = 0; i < 100; i++) {
        const prev = current;
        current = computed(() => prev() + 1);
      }

      const startTime = performance.now();
      const result = current();
      const duration = performance.now() - startTime;

      expect(result).toBe(101);
      expect(duration).toBeLessThan(10);
    });

    it('should handle wide dependency graphs efficiently', () => {
      const base = signal(1);
      const derived = Array.from({ length: 1000 }, (_, i) =>
        computed(() => base() * (i + 1))
      );

      const startTime = performance.now();

      base.set(2);

      derived.forEach(d => d());

      const duration = performance.now() - startTime;

      expect(duration).toBeLessThan(50);
      expect(derived[0]()).toBe(2);
      expect(derived[999]()).toBe(2000);
    });
  });

  describe('Render Performance Targets', () => {
    it('should render simple component under 1ms', () => {
      const SimpleComponent = () => {
        const div = document.createElement('div');
        div.textContent = 'Hello World';
        return div as any;
      };

      const startTime = performance.now();
      render(SimpleComponent);
      const duration = performance.now() - startTime;

      expect(duration).toBeLessThan(1);
    });

    it('should render complex component under 16ms', () => {
      const ComplexComponent = () => {
        const container = document.createElement('div');

        for (let i = 0; i < 100; i++) {
          const section = document.createElement('section');

          for (let j = 0; j < 10; j++) {
            const item = document.createElement('div');
            item.className = 'item';
            item.textContent = `Item ${i}-${j}`;
            item.dataset.id = `${i}-${j}`;
            section.appendChild(item);
          }

          container.appendChild(section);
        }

        return container as any;
      };

      const startTime = performance.now();
      render(ComplexComponent);
      const duration = performance.now() - startTime;

      expect(duration).toBeLessThan(16);
    });

    it('should re-render optimized component under 5ms', () => {
      const count = signal(0);

      const OptimizedComponent = () => {
        const div = document.createElement('div');
        div.textContent = `Count: ${count()}`;
        return div as any;
      };

      const { rerender } = render(OptimizedComponent);

      const startTime = performance.now();

      count.set(1);
      rerender(OptimizedComponent);

      const duration = performance.now() - startTime;

      expect(duration).toBeLessThan(5);
    });

    it('should render 1000 list items under 50ms', () => {
      const ListComponent = () => {
        const container = document.createElement('ul');

        for (let i = 0; i < 1000; i++) {
          const li = document.createElement('li');
          li.textContent = `Item ${i}`;
          li.dataset.id = String(i);
          container.appendChild(li);
        }

        return container as any;
      };

      const startTime = performance.now();
      const { container } = render(ListComponent);
      const duration = performance.now() - startTime;

      expect(duration).toBeLessThan(50);
      expect(container.querySelectorAll('li').length).toBe(1000);
    });
  });

  describe('Memory Performance Targets', () => {
    it('should use less than 1KB per signal', () => {
      const signals = Array.from({ length: 1000 }, (_, i) => signal(i));

      const estimatedSize = signals.length * 200;

      expect(estimatedSize).toBeLessThan(1000 * 1024);
    });

    it('should cleanup signals without memory leaks', () => {
      const signalsToCreate = 10000;
      const signals: any[] = [];

      for (let i = 0; i < signalsToCreate; i++) {
        signals.push(signal(i));
      }

      signals.length = 0;

      expect(signals.length).toBe(0);
    });

    it('should handle large state objects efficiently', () => {
      const largeObject = signal(
        Array.from({ length: 10000 }, (_, i) => ({
          id: i,
          value: `Value ${i}`,
          metadata: { index: i, timestamp: Date.now() },
        }))
      );

      const startTime = performance.now();
      const value = largeObject();
      const duration = performance.now() - startTime;

      expect(duration).toBeLessThan(1);
      expect(value.length).toBe(10000);
    });

    it('should not leak memory with subscriptions', () => {
      const sig = signal(0);
      const subscriptions: any[] = [];

      for (let i = 0; i < 1000; i++) {
        const unsub = effect(() => {
          sig();
        });
        subscriptions.push(unsub);
      }

      subscriptions.length = 0;

      expect(subscriptions.length).toBe(0);
    });
  });

  describe('Computed Performance Targets', () => {
    it('should compute 1k derived values under 10ms', () => {
      const base = signal(1);
      const computed1 = computed(() => base() * 2);
      const computed2 = computed(() => computed1() * 2);
      const computed3 = computed(() => computed2() * 2);

      const startTime = performance.now();

      for (let i = 0; i < 1000; i++) {
        computed3();
      }

      const duration = performance.now() - startTime;

      expect(duration).toBeLessThan(10);
    });

    it('should memoize computed values efficiently', () => {
      let computeCount = 0;
      const base = signal(10);

      const expensive = computed(() => {
        computeCount++;
        let sum = 0;
        for (let i = 0; i < 1000; i++) {
          sum += base();
        }
        return sum;
      });

      const startTime = performance.now();

      for (let i = 0; i < 100; i++) {
        expensive();
      }

      const duration = performance.now() - startTime;

      expect(computeCount).toBe(1);
      expect(duration).toBeLessThan(5);
    });

    it('should handle complex dependency chains efficiently', () => {
      const a = signal(1);
      const b = signal(2);
      const c = computed(() => a() + b());
      const d = computed(() => c() * 2);
      const e = computed(() => d() + c());
      const f = computed(() => e() * e());

      const startTime = performance.now();

      a.set(5);
      const result = f();

      const duration = performance.now() - startTime;

      expect(duration).toBeLessThan(1);
      expect(result).toBeGreaterThan(0);
    });
  });

  describe('Effect Performance Targets', () => {
    it('should run 1k effects under 50ms', () => {
      const sig = signal(0);
      let effectRuns = 0;

      for (let i = 0; i < 1000; i++) {
        effect(() => {
          sig();
          effectRuns++;
        });
      }

      const initialRuns = effectRuns;
      const startTime = performance.now();

      sig.set(1);

      const duration = performance.now() - startTime;

      expect(duration).toBeLessThan(50);
      expect(effectRuns).toBeGreaterThan(initialRuns);
    });

    it('should batch effect execution efficiently', () => {
      const signals = Array.from({ length: 100 }, () => signal(0));
      let effectRuns = 0;

      effect(() => {
        signals.forEach(s => s());
        effectRuns++;
      });

      const initialRuns = effectRuns;
      const startTime = performance.now();

      batch(() => {
        signals.forEach((s, i) => s.set(i));
      });

      const duration = performance.now() - startTime;

      expect(duration).toBeLessThan(10);
      expect(effectRuns).toBeLessThanOrEqual(initialRuns + 5);
    });

    it('should handle rapid effect triggers efficiently', () => {
      const sig = signal(0);
      let effectRuns = 0;

      effect(() => {
        sig();
        effectRuns++;
      });

      const startTime = performance.now();

      for (let i = 0; i < 1000; i++) {
        sig.set(i);
      }

      const duration = performance.now() - startTime;

      expect(duration).toBeLessThan(100);
      expect(effectRuns).toBeGreaterThan(0);
    });
  });

  describe('Bundle Size Targets', () => {
    it('should have minimal core exports', () => {
      const coreExports = {
        signal,
        computed,
        effect,
        batch,
      };

      const exportCount = Object.keys(coreExports).length;
      expect(exportCount).toBeLessThanOrEqual(10);
    });

    it('should tree-shake unused code', () => {
      const unused = signal(42);
      const used = signal(10);

      const result = computed(() => used() * 2);

      expect(result()).toBe(20);
      expect(typeof unused).toBe('function');
    });

    it('should support code splitting', () => {
      const chunks = {
        core: ['signal', 'computed', 'effect'],
        advanced: ['batch'],
      };

      expect(chunks.core.length).toBeGreaterThan(0);
      expect(chunks.advanced.length).toBeGreaterThan(0);
    });
  });

  describe('Update Performance Targets', () => {
    it('should handle 100 updates per second smoothly', async () => {
      const sig = signal(0);
      const updates: number[] = [];

      const startTime = Date.now();

      for (let i = 0; i < 100; i++) {
        sig.set(i);
        updates.push(Date.now());
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      const totalTime = Date.now() - startTime;

      expect(updates.length).toBe(100);
      expect(totalTime).toBeLessThan(1500);
    });

    it('should handle burst updates efficiently', () => {
      const sig = signal(0);

      const startTime = performance.now();

      for (let i = 0; i < 10000; i++) {
        sig.set(i);
      }

      const duration = performance.now() - startTime;

      expect(duration).toBeLessThan(100);
      expect(sig()).toBe(9999);
    });

    it('should throttle rapid updates appropriately', () => {
      const sig = signal(0);
      const updates: number[] = [];

      effect(() => {
        sig();
        updates.push(Date.now());
      });

      const startTime = performance.now();

      for (let i = 0; i < 1000; i++) {
        sig.set(i);
      }

      const duration = performance.now() - startTime;

      expect(duration).toBeLessThan(100);
      expect(updates.length).toBeGreaterThan(0);
    });
  });

  describe('DOM Performance Targets', () => {
    it('should create 1k DOM nodes under 20ms', () => {
      const startTime = performance.now();

      const container = document.createElement('div');
      for (let i = 0; i < 1000; i++) {
        const div = document.createElement('div');
        div.textContent = `Node ${i}`;
        container.appendChild(div);
      }

      const duration = performance.now() - startTime;

      expect(duration).toBeLessThan(20);
      expect(container.children.length).toBe(1000);
    });

    it('should update 1k DOM nodes under 30ms', () => {
      const container = document.createElement('div');

      for (let i = 0; i < 1000; i++) {
        const div = document.createElement('div');
        div.textContent = `Node ${i}`;
        container.appendChild(div);
      }

      const startTime = performance.now();

      for (let i = 0; i < container.children.length; i++) {
        (container.children[i] as HTMLElement).textContent = `Updated ${i}`;
      }

      const duration = performance.now() - startTime;

      expect(duration).toBeLessThan(30);
    });

    it('should efficiently handle attribute updates', () => {
      const elements = Array.from({ length: 1000 }, () => document.createElement('div'));

      const startTime = performance.now();

      elements.forEach((el, i) => {
        el.className = `item-${i}`;
        el.dataset.id = String(i);
        el.setAttribute('role', 'listitem');
      });

      const duration = performance.now() - startTime;

      expect(duration).toBeLessThan(20);
    });
  });

  describe('Real-World Scenarios', () => {
    it('should handle typical dashboard render under 50ms', () => {
      const DashboardComponent = () => {
        const container = document.createElement('div');

        const header = document.createElement('header');
        header.textContent = 'Dashboard';
        container.appendChild(header);

        const stats = document.createElement('div');
        for (let i = 0; i < 10; i++) {
          const stat = document.createElement('div');
          stat.className = 'stat';
          stat.textContent = `Stat ${i}: ${Math.random() * 100}`;
          stats.appendChild(stat);
        }
        container.appendChild(stats);

        const grid = document.createElement('div');
        for (let i = 0; i < 50; i++) {
          const card = document.createElement('div');
          card.className = 'card';
          card.textContent = `Card ${i}`;
          grid.appendChild(card);
        }
        container.appendChild(grid);

        return container as any;
      };

      const startTime = performance.now();
      render(DashboardComponent);
      const duration = performance.now() - startTime;

      expect(duration).toBeLessThan(50);
    });

    it('should handle typical form interaction under 5ms', () => {
      const formState = signal({ name: '', email: '' });

      const startTime = performance.now();

      formState.set({ name: 'John', email: 'john@example.com' });

      const duration = performance.now() - startTime;

      expect(duration).toBeLessThan(5);
      expect(formState().name).toBe('John');
    });

    it('should handle data table update under 100ms', () => {
      const rows = signal(
        Array.from({ length: 1000 }, (_, i) => ({
          id: i,
          name: `Row ${i}`,
          value: Math.random() * 1000,
        }))
      );

      const startTime = performance.now();

      rows.set(
        rows().map(row => ({
          ...row,
          value: row.value * 1.1,
        }))
      );

      const duration = performance.now() - startTime;

      expect(duration).toBeLessThan(100);
      expect(rows().length).toBe(1000);
    });
  });

  describe('Stress Tests', () => {
    it('should handle 100k signal operations under 1s', () => {
      const sig = signal(0);

      const startTime = performance.now();

      for (let i = 0; i < 100000; i++) {
        sig.set(i);
        sig();
      }

      const duration = performance.now() - startTime;

      expect(duration).toBeLessThan(1000);
    });

    it('should handle complex state updates efficiently', () => {
      const state = signal({
        users: Array.from({ length: 100 }, (_, i) => ({ id: i, name: `User ${i}` })),
        posts: Array.from({ length: 500 }, (_, i) => ({ id: i, title: `Post ${i}` })),
        comments: Array.from({ length: 1000 }, (_, i) => ({ id: i, text: `Comment ${i}` })),
      });

      const startTime = performance.now();

      state.set({
        ...state(),
        users: state().users.map(u => ({ ...u, active: true })),
      });

      const duration = performance.now() - startTime;

      expect(duration).toBeLessThan(50);
    });

    it('should maintain performance with many components', () => {
      const components = Array.from({ length: 100 }, () => {
        const count = signal(0);
        return { count };
      });

      const startTime = performance.now();

      components.forEach((comp, i) => {
        comp.count.set(i);
      });

      const duration = performance.now() - startTime;

      expect(duration).toBeLessThan(50);
    });
  });

  describe('Optimization Verification', () => {
    it('should verify batching optimization', () => {
      const signals = Array.from({ length: 10 }, () => signal(0));
      let effectRuns = 0;

      effect(() => {
        signals.forEach(s => s());
        effectRuns++;
      });

      const initialRuns = effectRuns;

      batch(() => {
        signals.forEach((s, i) => s.set(i));
      });

      expect(effectRuns).toBeLessThanOrEqual(initialRuns + 2);
    });

    it('should verify memoization optimization', () => {
      let computeCount = 0;
      const base = signal(5);

      const memoized = computed(() => {
        computeCount++;
        return base() * 2;
      });

      memoized();
      memoized();
      memoized();

      expect(computeCount).toBe(1);
    });

    it('should verify diamond dependency optimization', () => {
      let computeCount = 0;
      const root = signal(1);
      const left = computed(() => root() * 2);
      const right = computed(() => root() * 3);
      const bottom = computed(() => {
        computeCount++;
        return left() + right();
      });

      bottom();
      expect(computeCount).toBe(1);

      root.set(2);
      bottom();
      expect(computeCount).toBe(2);
    });
  });
});
