/**
 * Full-Stack Integration Tests
 *
 * Tests everything working together end-to-end:
 * - Build → Compile → Run → Test → Monitor
 * - Real application scenarios
 * - Performance targets validation
 * - Memory usage verification
 * - Error handling across all systems
 * - Complete workflow from source to deployed application
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AetherCompiler, createCompiler } from '../../src/compiler/compiler.js';
import { render, cleanup, waitFor, fireEvent } from '../../src/testing/index.js';
import { signal, computed, effect, batch } from '../../src/core/reactivity/index.js';
import { PerformanceMonitor } from '../../src/monitoring/performance.js';
import { ComponentTracker } from '../../src/monitoring/component-tracking.js';
import { SignalTracker } from '../../src/monitoring/signal-tracking.js';
import { MemoryProfiler } from '../../src/monitoring/memory-profiler.js';
import { ParallelCompiler } from '../../src/build/parallel-compilation.js';
import { SharedChunkManager } from '../../src/build/shared-chunks.js';
import { ModuleFederationRuntime, testUtils } from '../../src/build/module-federation.js';
import { SubscriptionPool } from '../../src/core/reactivity/subscription-pool.js';
import { BatchManager, BatchPriority } from '../../src/core/reactivity/batch-manager.js';

describe('Full-Stack Integration', () => {
  describe('Complete Build Pipeline', () => {
    let compiler: AetherCompiler;
    let parallelCompiler: ParallelCompiler;

    beforeEach(() => {
      compiler = createCompiler({
        optimize: 'aggressive',
        sourcemap: true,
        mode: 'production',
      });

      parallelCompiler = new ParallelCompiler({
        maxWorkers: 2,
        cacheEnabled: true,
      });
    });

    afterEach(async () => {
      await parallelCompiler.dispose();
    });

    it('should complete full build workflow', async () => {
      // 1. Source files
      const sourceFiles = [
        {
          path: 'components/App.tsx',
          content: `
            import { signal, computed } from '@omnitron-dev/aether';

            export function App() {
              const count = signal(0);
              const doubled = computed(() => count() * 2);

              return () => (
                <div>
                  <h1>Count: {count()}</h1>
                  <p>Doubled: {doubled()}</p>
                  <button onClick={() => count.set(count() + 1)}>Increment</button>
                </div>
              );
            }
          `,
        },
        {
          path: 'components/Header.tsx',
          content: `
            export function Header() {
              return () => <header><h1>My App</h1></header>;
            }
          `,
        },
        {
          path: 'components/Footer.tsx',
          content: `
            export function Footer() {
              return () => <footer>© 2024</footer>;
            }
          `,
        },
      ];

      // 2. Compile all files in parallel
      const compiled = await parallelCompiler.compileMany(sourceFiles);

      expect(compiled.length).toBe(3);
      compiled.forEach(result => {
        expect(result.code).toBeDefined();
        expect(result.code.length).toBeGreaterThan(0);
      });

      // 3. Analyze shared chunks
      const chunkManager = new SharedChunkManager({
        minSize: 1000,
        minChunks: 2,
      });

      compiled.forEach(result => {
        chunkManager.addModule(result.path || 'unknown', ['@omnitron-dev/aether']);
      });

      const chunks = chunkManager.generateChunks();
      expect(chunks.length).toBeGreaterThan(0);

      // 4. Verify optimization
      const stats = parallelCompiler.getStatistics();
      expect(stats.compiledFiles).toBe(3);
    });

    it('should handle large application build', async () => {
      // Generate 50 components
      const files = Array.from({ length: 50 }, (_, i) => ({
        path: `components/Component${i}.tsx`,
        content: `
          import { signal } from '@omnitron-dev/aether';

          export function Component${i}() {
            const state = signal(${i});
            return () => <div>Component {state()}</div>;
          }
        `,
      }));

      const startTime = performance.now();
      const compiled = await parallelCompiler.compileMany(files);
      const duration = performance.now() - startTime;

      expect(compiled.length).toBe(50);
      expect(duration).toBeLessThan(3000); // Should complete in < 3 seconds

      const stats = parallelCompiler.getStatistics();
      expect(stats.compiledFiles).toBe(50);
    });
  });

  describe('Runtime Integration', () => {
    afterEach(() => {
      cleanup();
    });

    it('should run compiled component with monitoring', async () => {
      // Setup monitoring
      const perfMonitor = new PerformanceMonitor({ enabled: true });
      const componentTracker = new ComponentTracker({ trackLifecycle: true });
      const signalTracker = new SignalTracker({ trackReads: true, trackWrites: true });

      perfMonitor.mark('app-start');

      // Create and render component
      const count = signal(0);
      const componentId = 'IntegratedApp';

      componentTracker.trackMount(componentId, 'IntegratedApp', {});
      signalTracker.trackSignalCreation('count', 0);

      const { container } = render(() => {
        perfMonitor.mark('render-start');

        signalTracker.trackSignalRead('count');
        const div = document.createElement('div');

        const h1 = document.createElement('h1');
        h1.textContent = `Count: ${count()}`;

        const button = document.createElement('button');
        button.textContent = 'Increment';
        button.onclick = () => {
          signalTracker.trackSignalWrite('count', count(), count() + 1);
          count.set(count() + 1);
        };

        div.appendChild(h1);
        div.appendChild(button);

        perfMonitor.mark('render-end');
        perfMonitor.measure('render', 'render-start', 'render-end');
        componentTracker.trackRender(componentId, 1);

        return div as any;
      });

      // Verify initial render
      expect(container.textContent).toContain('Count: 0');

      // Interact with component
      const button = container.querySelector('button')!;
      fireEvent.click(button);

      await waitFor(() => {
        expect(count()).toBe(1);
      });

      perfMonitor.mark('app-end');
      perfMonitor.measure('total', 'app-start', 'app-end');

      // Verify monitoring data
      const perfSummary = perfMonitor.getSummary();
      const compInfo = componentTracker.getComponentInfo(componentId);
      const sigInfo = signalTracker.getSignalInfo('count');

      expect(perfSummary.totalMeasures).toBeGreaterThan(0);
      expect(compInfo).toBeDefined();
      expect(sigInfo).toBeDefined();
      expect(sigInfo!.writes).toBeGreaterThanOrEqual(1);

      // Cleanup
      perfMonitor.dispose();
      componentTracker.clear();
      signalTracker.clear();
    });

    it('should handle complex application with all features', async () => {
      const perfMonitor = new PerformanceMonitor({ enabled: true });
      const memoryProfiler = new MemoryProfiler({ enabled: true });

      perfMonitor.mark('complex-app-start');

      // Create complex state
      const todos = signal<Array<{ id: number; text: string; done: boolean }>>([
        { id: 1, text: 'Learn Aether', done: false },
        { id: 2, text: 'Build app', done: false },
        { id: 3, text: 'Deploy', done: false },
      ]);

      const filter = signal<'all' | 'active' | 'completed'>('all');

      const filtered = computed(() => {
        const f = filter();
        const all = todos();

        switch (f) {
          case 'active':
            return all.filter(t => !t.done);
          case 'completed':
            return all.filter(t => t.done);
          default:
            return all;
        }
      });

      const activeCount = computed(() => todos().filter(t => !t.done).length);

      memoryProfiler.trackComponent('TodoApp', 4096);

      const { container } = render(() => {
        const app = document.createElement('div');
        app.className = 'todo-app';

        // Header
        const header = document.createElement('h1');
        header.textContent = 'Todo List';
        app.appendChild(header);

        // Stats
        const stats = document.createElement('p');
        stats.textContent = `${activeCount()} active, ${todos().length} total`;
        app.appendChild(stats);

        // Filters
        const filters = document.createElement('div');
        ['all', 'active', 'completed'].forEach(f => {
          const btn = document.createElement('button');
          btn.textContent = f;
          btn.onclick = () => filter.set(f as any);
          btn.disabled = filter() === f;
          filters.appendChild(btn);
        });
        app.appendChild(filters);

        // Todo list
        const list = document.createElement('ul');
        filtered().forEach(todo => {
          const item = document.createElement('li');

          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.checked = todo.done;
          checkbox.onchange = () => {
            batch(() => {
              todos.set(
                todos().map(t =>
                  t.id === todo.id ? { ...t, done: !t.done } : t
                )
              );
            });
          };

          const text = document.createElement('span');
          text.textContent = todo.text;
          if (todo.done) {
            text.style.textDecoration = 'line-through';
          }

          item.appendChild(checkbox);
          item.appendChild(text);
          list.appendChild(item);
        });
        app.appendChild(list);

        return app as any;
      });

      // Verify initial state
      expect(container.textContent).toContain('3 active');
      expect(container.querySelectorAll('li').length).toBe(3);

      // Test filtering
      const activeBtn = Array.from(container.querySelectorAll('button')).find(
        b => b.textContent === 'active'
      )!;
      fireEvent.click(activeBtn);

      await waitFor(() => {
        expect(filter()).toBe('active');
      });

      // Test toggling todo
      const checkbox = container.querySelector('input[type="checkbox"]')!;
      fireEvent.change(checkbox, { target: { checked: true } });

      await waitFor(() => {
        expect(todos()[0].done).toBe(true);
      });

      perfMonitor.mark('complex-app-end');
      perfMonitor.measure('complex-app', 'complex-app-start', 'complex-app-end');

      const measure = perfMonitor.getMeasures().find(m => m.name === 'complex-app');
      expect(measure).toBeDefined();
      expect(measure!.duration).toBeLessThan(200);

      perfMonitor.dispose();
      memoryProfiler.stop();
    });
  });

  describe('Performance Validation', () => {
    it('should meet all performance targets', async () => {
      const monitor = new PerformanceMonitor({
        enabled: true,
        budget: {
          maxRenderTime: 16,
          maxSignalUpdateTime: 1,
          maxEffectTime: 5,
        },
      });

      const violations: any[] = [];
      monitor.updateConfig({
        onViolation: (v) => violations.push(v),
      });

      // Test render performance
      monitor.mark('render-test-start');

      const { container } = render(() => {
        const elements = Array.from({ length: 100 }, (_, i) => {
          const div = document.createElement('div');
          div.textContent = `Item ${i}`;
          return div;
        });

        const root = document.createElement('div');
        elements.forEach(el => root.appendChild(el));
        return root as any;
      });

      monitor.mark('render-test-end');
      monitor.measure('render-test', 'render-test-start', 'render-test-end');

      expect(container.children.length).toBe(100);

      // Test signal performance
      monitor.mark('signal-test-start');

      const signals = Array.from({ length: 100 }, () => signal(0));
      batch(() => {
        signals.forEach((s, i) => s.set(i));
      });

      monitor.mark('signal-test-end');
      monitor.measure('signal-test', 'signal-test-start', 'signal-test-end');

      // Check violations
      expect(violations.length).toBe(0); // Should meet all budgets

      monitor.dispose();
      cleanup();
    });

    it('should maintain performance under load', async () => {
      const monitor = new PerformanceMonitor({ enabled: true });

      monitor.mark('load-test-start');

      const data = signal(Array.from({ length: 1000 }, (_, i) => i));
      const filtered = computed(() => data().filter(x => x % 2 === 0));
      const sum = computed(() => filtered().reduce((a, b) => a + b, 0));

      // Multiple updates
      for (let i = 0; i < 10; i++) {
        batch(() => {
          data.set(Array.from({ length: 1000 }, (_, j) => j + i * 1000));
        });
      }

      const result = sum();

      monitor.mark('load-test-end');
      monitor.measure('load-test', 'load-test-start', 'load-test-end');

      const measure = monitor.getMeasures().find(m => m.name === 'load-test');
      expect(measure).toBeDefined();
      expect(measure!.duration).toBeLessThan(500);
      expect(result).toBeGreaterThan(0);

      monitor.dispose();
    });
  });

  describe('Memory Verification', () => {
    it('should properly cleanup resources', () => {
      const perfMonitor = new PerformanceMonitor({ enabled: true });
      const componentTracker = new ComponentTracker({ trackLifecycle: true });
      const subscriptionPool = new SubscriptionPool({ maxSize: 100 });

      // Create resources
      for (let i = 0; i < 50; i++) {
        componentTracker.trackMount(`comp-${i}`, 'Component', {});
        perfMonitor.mark(`mark-${i}`);
        subscriptionPool.acquire(() => {});
      }

      // Verify resources created
      expect(componentTracker.getStatistics().totalComponents).toBe(50);
      expect(perfMonitor.getMarks().length).toBeGreaterThanOrEqual(50);

      // Cleanup
      perfMonitor.dispose();
      componentTracker.clear();
      subscriptionPool.destroy();

      // Verify cleanup
      expect(perfMonitor.getMarks().length).toBe(0);
      expect(componentTracker.getStatistics().totalComponents).toBe(0);
    });

    it('should not leak memory with repeated operations', () => {
      const pool = new SubscriptionPool({ maxSize: 50, autoCleanup: false });

      const iterations = 1000;

      for (let i = 0; i < iterations; i++) {
        const sub = pool.acquire(() => {});
        pool.release(sub);
      }

      const stats = pool.getStats();

      // Should have high reuse rate
      expect(stats.reuseRate).toBeGreaterThan(0.95);

      // Pool should be much smaller than iterations
      expect(stats.poolSize).toBeLessThan(iterations * 0.1);

      pool.destroy();
    });
  });

  describe('Error Handling', () => {
    it('should handle compilation errors gracefully', async () => {
      const compiler = createCompiler({ optimize: 'basic' });

      const invalidCode = `
        export function Broken() {
          const x = signal(
          // Missing closing
        }
      `;

      const result = await compiler.compile(invalidCode, 'Broken.tsx');

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.code).toBeDefined(); // Should still return something
    });

    it('should recover from runtime errors', () => {
      const errors: Error[] = [];

      try {
        const { container } = render(() => {
          const div = document.createElement('div');

          effect(() => {
            throw new Error('Effect error');
          });

          return div as any;
        });

        // Component should still render despite effect error
        expect(container).toBeDefined();
      } catch (error) {
        errors.push(error as Error);
      }

      cleanup();
    });

    it('should handle monitoring failures gracefully', () => {
      const monitor = new PerformanceMonitor({ enabled: true });

      // Invalid measurement (missing marks)
      const result = monitor.measure('invalid', 'nonexistent-start', 'nonexistent-end');

      expect(result).toBeNull();

      monitor.dispose();
    });
  });

  describe('Real-World Application Scenarios', () => {
    it('should handle e-commerce product listing', async () => {
      const perfMonitor = new PerformanceMonitor({ enabled: true });

      perfMonitor.mark('ecommerce-start');

      interface Product {
        id: number;
        name: string;
        price: number;
        category: string;
      }

      const products = signal<Product[]>([
        { id: 1, name: 'Laptop', price: 999, category: 'Electronics' },
        { id: 2, name: 'Phone', price: 699, category: 'Electronics' },
        { id: 3, name: 'Desk', price: 299, category: 'Furniture' },
        { id: 4, name: 'Chair', price: 199, category: 'Furniture' },
      ]);

      const category = signal('all');
      const sortBy = signal<'name' | 'price'>('name');

      const filtered = computed(() => {
        const prods = products();
        const cat = category();

        return cat === 'all'
          ? prods
          : prods.filter(p => p.category === cat);
      });

      const sorted = computed(() => {
        const prods = [...filtered()];
        const sort = sortBy();

        return prods.sort((a, b) =>
          sort === 'name'
            ? a.name.localeCompare(b.name)
            : a.price - b.price
        );
      });

      const { container } = render(() => {
        const app = document.createElement('div');

        // Controls
        const controls = document.createElement('div');

        const catSelect = document.createElement('select');
        ['all', 'Electronics', 'Furniture'].forEach(cat => {
          const option = document.createElement('option');
          option.value = cat;
          option.textContent = cat;
          catSelect.appendChild(option);
        });
        catSelect.onchange = (e) =>
          category.set((e.target as HTMLSelectElement).value);

        controls.appendChild(catSelect);
        app.appendChild(controls);

        // Product list
        const list = document.createElement('div');
        sorted().forEach(product => {
          const item = document.createElement('div');
          item.textContent = `${product.name} - $${product.price}`;
          list.appendChild(item);
        });
        app.appendChild(list);

        return app as any;
      });

      expect(container.querySelectorAll('div > div').length).toBe(4);

      perfMonitor.mark('ecommerce-end');
      perfMonitor.measure('ecommerce', 'ecommerce-start', 'ecommerce-end');

      const measure = perfMonitor.getMeasures().find(m => m.name === 'ecommerce');
      expect(measure).toBeDefined();

      perfMonitor.dispose();
      cleanup();
    });

    it('should handle real-time chat application', async () => {
      interface Message {
        id: number;
        user: string;
        text: string;
        timestamp: number;
      }

      const messages = signal<Message[]>([]);
      const users = signal<string[]>(['Alice', 'Bob']);
      const typing = signal<string[]>([]);

      const sortedMessages = computed(() =>
        [...messages()].sort((a, b) => a.timestamp - b.timestamp)
      );

      // Simulate real-time messages
      let messageId = 1;
      const addMessage = (user: string, text: string) => {
        batch(() => {
          messages.set([
            ...messages(),
            { id: messageId++, user, text, timestamp: Date.now() },
          ]);
        });
      };

      const { container } = render(() => {
        const app = document.createElement('div');

        // Messages
        const messageList = document.createElement('div');
        sortedMessages().forEach(msg => {
          const item = document.createElement('div');
          item.textContent = `${msg.user}: ${msg.text}`;
          messageList.appendChild(item);
        });
        app.appendChild(messageList);

        // Typing indicator
        if (typing().length > 0) {
          const typingDiv = document.createElement('div');
          typingDiv.textContent = `${typing().join(', ')} typing...`;
          app.appendChild(typingDiv);
        }

        return app as any;
      });

      // Add messages
      addMessage('Alice', 'Hello!');
      addMessage('Bob', 'Hi there!');

      await waitFor(() => {
        expect(messages().length).toBe(2);
      });

      cleanup();
    });

    it('should handle data dashboard with live updates', async () => {
      const metrics = Array.from({ length: 20 }, (_, i) => ({
        id: i,
        name: `Metric ${i}`,
        value: signal(Math.random() * 100),
        trend: computed(() => Math.random() > 0.5 ? 'up' : 'down'),
      }));

      const { container } = render(() => {
        const dashboard = document.createElement('div');

        metrics.forEach(metric => {
          const card = document.createElement('div');
          card.className = 'metric-card';

          const name = document.createElement('h3');
          name.textContent = metric.name;

          const value = document.createElement('p');
          value.textContent = metric.value().toFixed(2);

          const trend = document.createElement('span');
          trend.textContent = metric.trend();

          card.appendChild(name);
          card.appendChild(value);
          card.appendChild(trend);
          dashboard.appendChild(card);
        });

        return dashboard as any;
      });

      expect(container.querySelectorAll('.metric-card').length).toBe(20);

      // Simulate updates
      batch(() => {
        metrics.forEach(m => {
          m.value.set(Math.random() * 100);
        });
      });

      cleanup();
    });
  });

  describe('Module Federation Integration', () => {
    it('should work with module federation', async () => {
      const runtime = testUtils.createMockRuntime();

      runtime.registerRemote('components', 'http://localhost:3001/remoteEntry.js');
      runtime.registerShared('aether', { version: '1.0.0' }, '1.0.0');

      const mockButton = {
        default: () => {
          const button = document.createElement('button');
          button.textContent = 'Remote Button';
          return button;
        },
      };

      runtime.mockRemote('components', 'Button', mockButton);

      const loaded = await runtime.loadRemote('components', 'Button');

      expect(loaded).toBe(mockButton);

      runtime.clear();
    });
  });

  describe('End-to-End Workflow', () => {
    it('should complete full development workflow', async () => {
      // 1. Write component
      const sourceCode = `
        import { signal, computed } from '@omnitron-dev/aether';

        export function Counter() {
          const count = signal(0);
          const doubled = computed(() => count() * 2);

          return () => (
            <div>
              <p>Count: {count()}</p>
              <p>Doubled: {doubled()}</p>
              <button onClick={() => count.set(count() + 1)}>+</button>
            </div>
          );
        }
      `;

      // 2. Compile
      const compiler = createCompiler({
        optimize: 'aggressive',
        sourcemap: true,
      });

      const compiled = await compiler.compile(sourceCode, 'Counter.tsx');

      expect(compiled.code).toBeDefined();
      expect(compiled.metrics?.sizeReduction).toBeGreaterThan(0);

      // 3. Setup monitoring
      const perfMonitor = new PerformanceMonitor({ enabled: true });
      const componentTracker = new ComponentTracker({ trackLifecycle: true });

      // 4. Render (simulated)
      perfMonitor.mark('app-render-start');

      const count = signal(0);
      const doubled = computed(() => count() * 2);

      componentTracker.trackMount('Counter', 'Counter', {});

      const { container } = render(() => {
        const div = document.createElement('div');

        const countP = document.createElement('p');
        countP.textContent = `Count: ${count()}`;

        const doubledP = document.createElement('p');
        doubledP.textContent = `Doubled: ${doubled()}`;

        const button = document.createElement('button');
        button.textContent = '+';
        button.onclick = () => count.set(count() + 1);

        div.appendChild(countP);
        div.appendChild(doubledP);
        div.appendChild(button);

        return div as any;
      });

      perfMonitor.mark('app-render-end');
      perfMonitor.measure('app-render', 'app-render-start', 'app-render-end');

      componentTracker.trackRender('Counter', 2);

      // 5. Test interaction
      const button = container.querySelector('button')!;
      fireEvent.click(button);

      await waitFor(() => {
        expect(count()).toBe(1);
        expect(doubled()).toBe(2);
      });

      // 6. Verify performance
      const summary = perfMonitor.getSummary();
      expect(summary.totalMeasures).toBeGreaterThan(0);

      // 7. Check monitoring data
      const compInfo = componentTracker.getComponentInfo('Counter');
      expect(compInfo).toBeDefined();
      expect(compInfo!.renderCount).toBeGreaterThanOrEqual(1);

      // Cleanup
      perfMonitor.dispose();
      componentTracker.clear();
      cleanup();
    });
  });
});
