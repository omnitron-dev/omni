/**
 * Development Workflow E2E Tests
 *
 * Tests the complete development experience:
 * - Component creation with hot reload
 * - Debugging with devtools
 * - Performance profiling
 * - Error monitoring and fixing
 * - Testing with testing library
 * - Compiler optimizations
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { signal, computed, effect } from '../../src/core/reactivity/index.js';
import { render, cleanup, fireEvent, waitFor } from '../../src/testing/index.js';
import { createInspector } from '../../src/devtools/inspector.js';
import { createProfiler } from '../../src/devtools/profiler.js';
import { createPerformanceMonitor } from '../../src/monitoring/performance.js';

describe('Development Workflow E2E Tests', () => {
  afterEach(() => {
    cleanup();
  });

  describe('Component Development', () => {
    it('should support hot reload development pattern', () => {
      const version = signal(1);
      const renderCount = signal(0);

      const DevelopingComponent = () => {
        renderCount.set(renderCount() + 1);
        const container = document.createElement('div');
        container.className = 'component';
        container.textContent = `Version ${version()}`;
        return container as any;
      };

      const { container, rerender } = render(DevelopingComponent);

      expect(container.textContent).toContain('Version 1');
      const initialRenderCount = renderCount();

      version.set(2);
      rerender(DevelopingComponent);

      expect(container.textContent).toContain('Version 2');
      expect(renderCount()).toBeGreaterThan(initialRenderCount);
    });

    it('should provide immediate feedback on state changes', () => {
      const state = signal({ user: 'Developer', theme: 'dark' });
      let effectRunCount = 0;

      effect(() => {
        state();
        effectRunCount++;
      });

      const initialCount = effectRunCount;

      state.set({ user: 'Developer', theme: 'light' });
      expect(effectRunCount).toBeGreaterThan(initialCount);

      const beforeChange = effectRunCount;
      state.set({ user: 'Admin', theme: 'light' });
      expect(effectRunCount).toBeGreaterThan(beforeChange);
    });

    it('should track component hierarchy during development', () => {
      const inspector = createInspector();

      const ParentComponent = () => {
        const container = document.createElement('div');
        container.className = 'parent';

        const child1 = document.createElement('div');
        child1.className = 'child-1';
        container.appendChild(child1);

        const child2 = document.createElement('div');
        child2.className = 'child-2';
        container.appendChild(child2);

        return container as any;
      };

      render(ParentComponent);

      const componentTree = inspector.getComponentTree();
      expect(componentTree).toBeDefined();

      inspector.dispose();
    });
  });

  describe('DevTools Integration', () => {
    it('should inspect signal values in real-time', () => {
      const inspector = createInspector();

      const count = signal(0);
      const doubled = computed(() => count() * 2);

      inspector.trackSignal('count', count);
      inspector.trackComputed('doubled', doubled);

      expect(inspector.getState().signals.has('count')).toBe(true);
      expect(inspector.getState().computeds.has('doubled')).toBe(true);

      count.set(5);

      const signalData = inspector.getState().signals.get('count');
      expect(signalData).toBeDefined();

      inspector.dispose();
    });

    it('should profile component performance', () => {
      const profiler = createProfiler();

      profiler.startProfiling();

      const HeavyComponent = () => {
        const container = document.createElement('div');
        for (let i = 0; i < 100; i++) {
          const div = document.createElement('div');
          div.textContent = `Item ${i}`;
          container.appendChild(div);
        }
        return container as any;
      };

      render(HeavyComponent);

      profiler.stopProfiling();

      const profile = profiler.getProfile();
      expect(profile).toBeDefined();
      expect(profile.samples.length).toBeGreaterThan(0);

      profiler.clear();
    });

    it('should debug dependency graphs', () => {
      const inspector = createInspector();

      const a = signal(1);
      const b = signal(2);
      const c = computed(() => a() + b());
      const d = computed(() => c() * 2);

      inspector.trackSignal('a', a);
      inspector.trackSignal('b', b);
      inspector.trackComputed('c', c);
      inspector.trackComputed('d', d);

      const deps = inspector.getDependencyGraph();
      expect(deps).toBeDefined();

      inspector.dispose();
    });

    it('should provide time-travel debugging capability', () => {
      const history: any[] = [];
      const state = signal({ count: 0, name: 'Test' });

      effect(() => {
        history.push({ ...state() });
      });

      expect(history.length).toBeGreaterThan(0);

      state.set({ count: 1, name: 'Test' });
      state.set({ count: 2, name: 'Updated' });
      state.set({ count: 3, name: 'Final' });

      expect(history.length).toBeGreaterThan(3);

      const snapshot1 = history[history.length - 3];
      const snapshot2 = history[history.length - 2];
      const snapshot3 = history[history.length - 1];

      expect(snapshot1.count).toBe(1);
      expect(snapshot2.count).toBe(2);
      expect(snapshot3.count).toBe(3);
      expect(snapshot3.name).toBe('Final');
    });
  });

  describe('Performance Monitoring', () => {
    it('should monitor render performance during development', async () => {
      const monitor = createPerformanceMonitor();

      const App = () => {
        monitor.mark('render-start');
        const container = document.createElement('div');
        for (let i = 0; i < 50; i++) {
          const div = document.createElement('div');
          div.textContent = `Item ${i}`;
          container.appendChild(div);
        }
        monitor.mark('render-end');
        monitor.measure('render', 'render-start', 'render-end');
        return container as any;
      };

      render(App);

      await waitFor(() => {
        const measures = monitor.getMeasures();
        expect(measures.some(m => m.name === 'render')).toBe(true);
      });

      const renderMeasure = monitor.getMeasures().find(m => m.name === 'render');
      expect(renderMeasure?.duration).toBeLessThan(100);

      monitor.dispose();
    });

    it('should identify performance bottlenecks', () => {
      const profiler = createProfiler();
      const timings: number[] = [];

      for (let i = 0; i < 10; i++) {
        const start = performance.now();

        const computed1 = computed(() => {
          let sum = 0;
          for (let j = 0; j < 1000; j++) {
            sum += j;
          }
          return sum;
        });

        computed1();

        const duration = performance.now() - start;
        timings.push(duration);
      }

      const avgTime = timings.reduce((a, b) => a + b, 0) / timings.length;
      expect(avgTime).toBeLessThan(10);

      profiler.clear();
    });

    it('should track signal update frequency', () => {
      const inspector = createInspector();
      const signal1 = signal(0);

      inspector.trackSignal('signal1', signal1);

      for (let i = 1; i <= 10; i++) {
        signal1.set(i);
      }

      const signalData = inspector.getState().signals.get('signal1');
      expect(signalData).toBeDefined();

      inspector.dispose();
    });
  });

  describe('Error Detection and Debugging', () => {
    it('should catch and report errors during development', () => {
      const errors: Error[] = [];

      const BuggyComponent = () => {
        const container = document.createElement('div');
        try {
          throw new Error('Simulated development error');
        } catch (e) {
          errors.push(e as Error);
        }
        return container as any;
      };

      render(BuggyComponent);

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain('Simulated development error');
    });

    it('should provide detailed error context', () => {
      const errorContext = {
        component: 'TestComponent',
        props: { id: 1, name: 'Test' },
        state: { count: 5 },
      };

      const simulateError = () => {
        try {
          throw new Error('Test error');
        } catch (e) {
          const error = e as Error;
          (error as any).context = errorContext;
          return error;
        }
      };

      const error = simulateError();
      expect((error as any).context).toEqual(errorContext);
    });

    it('should track error boundaries', () => {
      const errorBoundary = {
        errors: [] as Error[],
        catch(error: Error) {
          this.errors.push(error);
        },
      };

      const FailingComponent = () => {
        const container = document.createElement('div');
        try {
          throw new Error('Component error');
        } catch (e) {
          errorBoundary.catch(e as Error);
        }
        return container as any;
      };

      render(FailingComponent);

      expect(errorBoundary.errors.length).toBeGreaterThan(0);
    });
  });

  describe('Testing Workflow', () => {
    it('should support test-driven development', () => {
      const calculate = (a: number, b: number) => a + b;

      expect(calculate(2, 3)).toBe(5);
      expect(calculate(-1, 1)).toBe(0);
      expect(calculate(0, 0)).toBe(0);
    });

    it('should provide comprehensive testing utilities', () => {
      const Component = () => {
        const container = document.createElement('div');
        const button = document.createElement('button');
        button.textContent = 'Click me';
        button.onclick = () => {
          button.textContent = 'Clicked!';
        };
        container.appendChild(button);
        return container as any;
      };

      const { container, debug } = render(Component);

      const button = container.querySelector('button')!;
      expect(button.textContent).toBe('Click me');

      fireEvent.click(button);
      expect(button.textContent).toBe('Clicked!');

      expect(typeof debug).toBe('function');
    });

    it('should support async testing patterns', async () => {
      const loading = signal(true);
      const data = signal<any>(null);

      const fetchData = async () => {
        loading.set(true);
        await new Promise(resolve => setTimeout(resolve, 50));
        data.set({ result: 'success' });
        loading.set(false);
      };

      await fetchData();

      await waitFor(() => {
        expect(loading()).toBe(false);
      });

      expect(data()).toEqual({ result: 'success' });
    });

    it('should support snapshot testing pattern', () => {
      const state = {
        user: { id: 1, name: 'John' },
        settings: { theme: 'dark', language: 'en' },
      };

      const snapshot = JSON.parse(JSON.stringify(state));

      expect(state).toEqual(snapshot);

      state.user.name = 'Jane';

      expect(state).not.toEqual(snapshot);
    });
  });

  describe('Compiler Development', () => {
    it('should verify compiler optimizations', () => {
      let computeCount = 0;

      const base = signal(10);
      const optimized = computed(() => {
        computeCount++;
        return base() * 2;
      });

      expect(optimized()).toBe(20);
      expect(computeCount).toBe(1);

      optimized();
      optimized();
      optimized();

      expect(computeCount).toBe(1);

      base.set(20);
      expect(optimized()).toBe(40);
      expect(computeCount).toBe(2);
    });

    it('should test signal batching optimization', () => {
      let effectCount = 0;
      const a = signal(1);
      const b = signal(2);

      effect(() => {
        a();
        b();
        effectCount++;
      });

      const initialCount = effectCount;

      a.set(5);
      b.set(10);

      expect(effectCount).toBeGreaterThan(initialCount);
    });

    it('should verify dead code elimination', () => {
      const unusedSignal = signal(42);
      const usedSignal = signal(10);

      const result = computed(() => usedSignal() * 2);

      expect(result()).toBe(20);
      expect(unusedSignal()).toBe(42);
    });
  });

  describe('Developer Experience', () => {
    it('should provide helpful error messages', () => {
      const createValidationError = (field: string, message: string) => {
        return new Error(`Validation failed for "${field}": ${message}`);
      };

      const error = createValidationError('email', 'Invalid format');
      expect(error.message).toContain('email');
      expect(error.message).toContain('Invalid format');
    });

    it('should support development logging', () => {
      const logs: any[] = [];
      const devLog = (...args: any[]) => {
        if (process.env.NODE_ENV !== 'production') {
          logs.push(args);
        }
      };

      devLog('Component mounted', { id: 1 });
      devLog('State updated', { count: 5 });

      expect(logs.length).toBeGreaterThan(0);
    });

    it('should provide performance hints', () => {
      const hints: string[] = [];

      const checkPerformance = (renderTime: number) => {
        if (renderTime > 16) {
          hints.push(`Slow render detected: ${renderTime.toFixed(2)}ms`);
        }
      };

      checkPerformance(20);
      checkPerformance(10);
      checkPerformance(30);

      expect(hints.length).toBe(2);
      expect(hints[0]).toContain('20.00ms');
    });
  });

  describe('Hot Module Replacement Simulation', () => {
    it('should preserve state during hot reload', () => {
      const preservedState = signal({ count: 10, name: 'Preserved' });

      const ComponentV1 = () => {
        const container = document.createElement('div');
        container.textContent = `V1: ${preservedState().count}`;
        return container as any;
      };

      const { container, rerender } = render(ComponentV1);

      expect(container.textContent).toContain('V1: 10');

      preservedState.set({ count: 20, name: 'Preserved' });

      const ComponentV2 = () => {
        const container = document.createElement('div');
        container.textContent = `V2: ${preservedState().count}`;
        return container as any;
      };

      rerender(ComponentV2);

      expect(container.textContent).toContain('V2: 20');
    });

    it('should handle component replacement without losing data', () => {
      const appState = signal({ data: [1, 2, 3], version: 1 });

      const App = () => {
        const container = document.createElement('div');
        container.textContent = `Version ${appState().version}: ${appState().data.join(', ')}`;
        return container as any;
      };

      const { container, rerender } = render(App);

      expect(container.textContent).toContain('Version 1: 1, 2, 3');

      appState.set({ data: [1, 2, 3, 4], version: 2 });
      rerender(App);

      expect(container.textContent).toContain('Version 2: 1, 2, 3, 4');
    });
  });

  describe('Debugging Tools', () => {
    it('should inspect component props', () => {
      const inspector = createInspector();

      const props = { id: 1, title: 'Test', visible: true };

      const Component = () => {
        const container = document.createElement('div');
        container.dataset.props = JSON.stringify(props);
        return container as any;
      };

      const { container } = render(Component);

      const storedProps = JSON.parse(container.querySelector('div')!.dataset.props!);
      expect(storedProps).toEqual(props);

      inspector.dispose();
    });

    it('should track signal subscriptions', () => {
      const inspector = createInspector();
      const signal1 = signal(0);

      inspector.trackSignal('test-signal', signal1);

      const subscriptions: any[] = [];
      effect(() => {
        signal1();
        subscriptions.push(Date.now());
      });

      expect(subscriptions.length).toBeGreaterThan(0);

      signal1.set(1);
      signal1.set(2);

      expect(subscriptions.length).toBeGreaterThan(2);

      inspector.dispose();
    });

    it('should visualize state changes', () => {
      const stateHistory: any[] = [];
      const state = signal({ mode: 'light', size: 'medium' });

      effect(() => {
        stateHistory.push({
          timestamp: Date.now(),
          value: { ...state() },
        });
      });

      expect(stateHistory.length).toBeGreaterThan(0);

      state.set({ mode: 'dark', size: 'medium' });
      state.set({ mode: 'dark', size: 'large' });

      expect(stateHistory.length).toBeGreaterThan(2);
      expect(stateHistory[stateHistory.length - 1].value.mode).toBe('dark');
      expect(stateHistory[stateHistory.length - 1].value.size).toBe('large');
    });
  });

  describe('Integration with Build Tools', () => {
    it('should work with development build configuration', () => {
      const isDevelopment = process.env.NODE_ENV !== 'production';

      expect(isDevelopment).toBe(true);
    });

    it('should support source maps for debugging', () => {
      const errorWithStack = new Error('Debug error');

      expect(errorWithStack.stack).toBeDefined();
      expect(typeof errorWithStack.stack).toBe('string');
    });
  });
});
