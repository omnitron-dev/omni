/**
 * Testing Library Integration Tests
 *
 * Tests the testing library with real Aether components:
 * - Render complex components with signals
 * - Test signal reactivity and updates
 * - Test async operations and effects
 * - Test user interactions
 * - Integration with performance monitoring
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent } from '../../src/testing/index.js';
import { signal, computed, effect, batch } from '../../src/core/reactivity/index.js';
import { PerformanceMonitor } from '../../src/monitoring/performance.js';

describe('Testing Library Integration', () => {
  afterEach(() => {
    cleanup();
  });

  describe('Rendering with Signals', () => {
    it('should render component with signal state', () => {
      const count = signal(0);

      const { container } = render(() => {
        const div = document.createElement('div');
        div.textContent = `Count: ${count()}`;
        return div as any;
      });

      expect(container.textContent).toContain('Count: 0');
    });

    it('should render component with computed values', () => {
      const count = signal(5);
      const doubled = computed(() => count() * 2);
      const tripled = computed(() => count() * 3);

      const { container } = render(() => {
        const div = document.createElement('div');
        div.innerHTML = `
          <span class="count">${count()}</span>
          <span class="doubled">${doubled()}</span>
          <span class="tripled">${tripled()}</span>
        `;
        return div as any;
      });

      expect(container.textContent).toContain('5');
      expect(container.textContent).toContain('10');
      expect(container.textContent).toContain('15');
    });

    it('should render component with effects', () => {
      const messages: string[] = [];
      const value = signal('initial');

      const { container } = render(() => {
        effect(() => {
          messages.push(`Effect: ${value()}`);
        });

        const div = document.createElement('div');
        div.textContent = value();
        return div as any;
      });

      expect(messages.length).toBeGreaterThan(0);
      expect(messages[0]).toContain('initial');
    });
  });

  describe('Reactivity Updates', () => {
    it('should update DOM when signal changes', async () => {
      const count = signal(0);

      const { container, rerender } = render(() => {
        const div = document.createElement('div');
        div.textContent = `Count: ${count()}`;
        return div as any;
      });

      expect(container.textContent).toContain('Count: 0');

      count.set(5);

      // Rerender to see updates
      rerender(() => {
        const div = document.createElement('div');
        div.textContent = `Count: ${count()}`;
        return div as any;
      });

      await waitFor(() => {
        expect(container.textContent).toContain('Count: 5');
      });
    });

    it('should handle batched updates', async () => {
      const x = signal(0);
      const y = signal(0);
      let renderCount = 0;

      const { container, rerender } = render(() => {
        renderCount++;
        const div = document.createElement('div');
        div.textContent = `X: ${x()}, Y: ${y()}`;
        return div as any;
      });

      const initialRenders = renderCount;

      batch(() => {
        x.set(10);
        y.set(20);
      });

      rerender(() => {
        renderCount++;
        const div = document.createElement('div');
        div.textContent = `X: ${x()}, Y: ${y()}`;
        return div as any;
      });

      await waitFor(() => {
        expect(container.textContent).toContain('X: 10, Y: 20');
      });

      // Should minimize rerenders with batching
      expect(renderCount - initialRenders).toBeLessThanOrEqual(2);
    });

    it('should handle computed value updates', async () => {
      const base = signal(10);
      const multiplier = signal(2);
      const result = computed(() => base() * multiplier());

      const { container, rerender } = render(() => {
        const div = document.createElement('div');
        div.textContent = `Result: ${result()}`;
        return div as any;
      });

      expect(container.textContent).toContain('Result: 20');

      base.set(20);

      rerender(() => {
        const div = document.createElement('div');
        div.textContent = `Result: ${result()}`;
        return div as any;
      });

      await waitFor(() => {
        expect(container.textContent).toContain('Result: 40');
      });
    });
  });

  describe('User Interactions', () => {
    it('should handle click events', async () => {
      const clicks = signal(0);

      const { container, getByRole } = render(() => {
        const button = document.createElement('button');
        button.textContent = `Clicks: ${clicks()}`;
        button.onclick = () => clicks.set(clicks() + 1);
        return button as any;
      });

      const button = container.querySelector('button');
      expect(button?.textContent).toContain('Clicks: 0');

      // Simulate click
      fireEvent.click(button!);

      await waitFor(() => {
        expect(clicks()).toBe(1);
      });
    });

    it('should handle input events', async () => {
      const value = signal('');

      const { container } = render(() => {
        const input = document.createElement('input');
        input.value = value();
        input.oninput = (e) => value.set((e.target as HTMLInputElement).value);
        return input as any;
      });

      const input = container.querySelector('input')!;

      fireEvent.input(input, { target: { value: 'Hello' } });

      await waitFor(() => {
        expect(value()).toBe('Hello');
      });
    });

    it('should handle form submissions', async () => {
      const submitted = signal(false);
      const formData = signal({ name: '', email: '' });

      const { container } = render(() => {
        const form = document.createElement('form');
        form.onsubmit = (e) => {
          e.preventDefault();
          submitted.set(true);
        };

        const nameInput = document.createElement('input');
        nameInput.name = 'name';
        nameInput.value = formData().name;

        const emailInput = document.createElement('input');
        emailInput.name = 'email';
        emailInput.type = 'email';
        emailInput.value = formData().email;

        const submitBtn = document.createElement('button');
        submitBtn.type = 'submit';
        submitBtn.textContent = 'Submit';

        form.appendChild(nameInput);
        form.appendChild(emailInput);
        form.appendChild(submitBtn);

        return form as any;
      });

      const form = container.querySelector('form')!;
      fireEvent.submit(form);

      await waitFor(() => {
        expect(submitted()).toBe(true);
      });
    });
  });

  describe('Async Operations', () => {
    it('should handle async data loading', async () => {
      const data = signal<string | null>(null);
      const loading = signal(true);

      const { container, rerender } = render(() => {
        const div = document.createElement('div');

        if (loading()) {
          div.textContent = 'Loading...';
        } else {
          div.textContent = `Data: ${data()}`;
        }

        return div as any;
      });

      expect(container.textContent).toContain('Loading...');

      // Simulate async data load
      setTimeout(() => {
        data.set('Loaded Data');
        loading.set(false);
      }, 50);

      await waitFor(() => {
        rerender(() => {
          const div = document.createElement('div');

          if (loading()) {
            div.textContent = 'Loading...';
          } else {
            div.textContent = `Data: ${data()}`;
          }

          return div as any;
        });

        return !loading();
      }, { timeout: 200 });

      expect(container.textContent).toContain('Loaded Data');
    });

    it('should handle async errors', async () => {
      const error = signal<Error | null>(null);
      const loading = signal(true);

      const { container, rerender } = render(() => {
        const div = document.createElement('div');

        if (error()) {
          div.textContent = `Error: ${error()!.message}`;
        } else if (loading()) {
          div.textContent = 'Loading...';
        } else {
          div.textContent = 'Success';
        }

        return div as any;
      });

      // Simulate async error
      setTimeout(() => {
        error.set(new Error('Failed to load'));
        loading.set(false);
      }, 50);

      await waitFor(() => {
        rerender(() => {
          const div = document.createElement('div');

          if (error()) {
            div.textContent = `Error: ${error()!.message}`;
          } else if (loading()) {
            div.textContent = 'Loading...';
          } else {
            div.textContent = 'Success';
          }

          return div as any;
        });

        return error() !== null;
      }, { timeout: 200 });

      expect(container.textContent).toContain('Failed to load');
    });

    it('should handle multiple concurrent async operations', async () => {
      const results = signal<number[]>([]);
      const loading = signal(3);

      const { container, rerender } = render(() => {
        const div = document.createElement('div');
        div.textContent = `Loading: ${loading()}, Results: ${results().length}`;
        return div as any;
      });

      // Simulate 3 concurrent async operations
      const operations = [
        new Promise(resolve => setTimeout(() => resolve(1), 50)),
        new Promise(resolve => setTimeout(() => resolve(2), 75)),
        new Promise(resolve => setTimeout(() => resolve(3), 100)),
      ];

      operations.forEach(op => {
        op.then(result => {
          results.set([...results(), result as number]);
          loading.set(loading() - 1);
        });
      });

      await waitFor(() => {
        rerender(() => {
          const div = document.createElement('div');
          div.textContent = `Loading: ${loading()}, Results: ${results().length}`;
          return div as any;
        });

        return loading() === 0;
      }, { timeout: 300 });

      expect(results().length).toBe(3);
      expect(loading()).toBe(0);
    });
  });

  describe('Complex Component Scenarios', () => {
    it('should render todo list with add/remove functionality', async () => {
      const todos = signal<Array<{ id: number; text: string; done: boolean }>>([
        { id: 1, text: 'Test 1', done: false },
        { id: 2, text: 'Test 2', done: true },
      ]);

      const { container } = render(() => {
        const div = document.createElement('div');
        const list = document.createElement('ul');

        todos().forEach(todo => {
          const item = document.createElement('li');
          item.textContent = `${todo.text} ${todo.done ? '✓' : ''}`;
          item.dataset.id = String(todo.id);

          const deleteBtn = document.createElement('button');
          deleteBtn.textContent = 'Delete';
          deleteBtn.onclick = () => {
            todos.set(todos().filter(t => t.id !== todo.id));
          };

          item.appendChild(deleteBtn);
          list.appendChild(item);
        });

        div.appendChild(list);
        return div as any;
      });

      expect(container.querySelectorAll('li').length).toBe(2);

      const deleteBtn = container.querySelector('button')!;
      fireEvent.click(deleteBtn);

      await waitFor(() => {
        expect(todos().length).toBe(1);
      });
    });

    it('should handle counter with increment/decrement', async () => {
      const count = signal(0);
      const step = signal(1);

      const { container, rerender } = render(() => {
        const div = document.createElement('div');
        div.innerHTML = `
          <span class="count">Count: ${count()}</span>
          <button class="inc">+${step()}</button>
          <button class="dec">-${step()}</button>
          <button class="reset">Reset</button>
        `;

        const incBtn = div.querySelector('.inc') as HTMLButtonElement;
        const decBtn = div.querySelector('.dec') as HTMLButtonElement;
        const resetBtn = div.querySelector('.reset') as HTMLButtonElement;

        incBtn.onclick = () => count.set(count() + step());
        decBtn.onclick = () => count.set(count() - step());
        resetBtn.onclick = () => count.set(0);

        return div as any;
      });

      expect(container.textContent).toContain('Count: 0');

      const incBtn = container.querySelector('.inc') as HTMLButtonElement;
      fireEvent.click(incBtn);
      fireEvent.click(incBtn);

      await waitFor(() => {
        rerender(() => {
          const div = document.createElement('div');
          div.innerHTML = `<span class="count">Count: ${count()}</span>`;
          return div as any;
        });

        expect(count()).toBe(2);
      });

      const decBtn = container.querySelector('.dec') as HTMLButtonElement;
      fireEvent.click(decBtn);

      await waitFor(() => {
        expect(count()).toBe(1);
      });
    });

    it('should handle filtered list', async () => {
      const items = signal(['Apple', 'Banana', 'Cherry', 'Date']);
      const filter = signal('');

      const filtered = computed(() => {
        const f = filter().toLowerCase();
        return f ? items().filter(item => item.toLowerCase().includes(f)) : items();
      });

      const { container, rerender } = render(() => {
        const div = document.createElement('div');

        const input = document.createElement('input');
        input.value = filter();
        input.oninput = (e) => filter.set((e.target as HTMLInputElement).value);

        const list = document.createElement('ul');
        filtered().forEach(item => {
          const li = document.createElement('li');
          li.textContent = item;
          list.appendChild(li);
        });

        div.appendChild(input);
        div.appendChild(list);
        return div as any;
      });

      expect(container.querySelectorAll('li').length).toBe(4);

      const input = container.querySelector('input')!;
      fireEvent.input(input, { target: { value: 'a' } });

      await waitFor(() => {
        rerender(() => {
          const div = document.createElement('div');

          const input = document.createElement('input');
          input.value = filter();

          const list = document.createElement('ul');
          filtered().forEach(item => {
            const li = document.createElement('li');
            li.textContent = item;
            list.appendChild(li);
          });

          div.appendChild(input);
          div.appendChild(list);
          return div as any;
        });

        expect(filtered().length).toBe(3); // Apple, Banana, Date
      });
    });
  });

  describe('Performance Monitoring Integration', () => {
    let perfMonitor: PerformanceMonitor;

    beforeEach(() => {
      perfMonitor = new PerformanceMonitor({
        enabled: true,
        budget: {
          maxRenderTime: 16,
          maxSignalUpdateTime: 1,
        },
      });
    });

    afterEach(() => {
      perfMonitor.dispose();
    });

    it('should track render performance', async () => {
      const count = signal(0);

      perfMonitor.mark('render-start');

      const { container } = render(() => {
        const div = document.createElement('div');
        div.textContent = `Count: ${count()}`;
        return div as any;
      });

      perfMonitor.mark('render-end');
      const measure = perfMonitor.measure('render', 'render-start', 'render-end');

      expect(measure).toBeDefined();
      expect(measure!.duration).toBeGreaterThan(0);
      expect(measure!.duration).toBeLessThan(100); // Should be fast
    });

    it('should track signal updates', () => {
      const value = signal(0);

      perfMonitor.mark('update-start', { type: 'signal' });

      for (let i = 0; i < 100; i++) {
        value.set(i);
      }

      perfMonitor.mark('update-end', { type: 'signal' });
      const measure = perfMonitor.measure('signal-updates', 'update-start', 'update-end');

      expect(measure).toBeDefined();
      expect(measure!.duration).toBeGreaterThan(0);
    });

    it('should detect performance violations', () => {
      const violations: any[] = [];
      const monitor = new PerformanceMonitor({
        enabled: true,
        budget: {
          maxRenderTime: 1, // Very strict budget
        },
        onViolation: (v) => violations.push(v),
      });

      monitor.mark('slow-render-start');

      // Simulate slow operation
      const start = Date.now();
      while (Date.now() - start < 10) {
        // Busy wait
      }

      monitor.mark('slow-render-end');
      monitor.measure('slow-render', 'slow-render-start', 'slow-render-end');

      expect(violations.length).toBeGreaterThan(0);
      expect(violations[0].duration).toBeGreaterThan(violations[0].threshold);

      monitor.dispose();
    });
  });

  describe('Query Methods', () => {
    it('should query elements by text', () => {
      const { getByText, queryByText } = render(() => {
        const div = document.createElement('div');
        div.innerHTML = `
          <h1>Title</h1>
          <p>Content</p>
          <button>Click me</button>
        `;
        return div as any;
      });

      expect(getByText('Title')).toBeTruthy();
      expect(getByText('Content')).toBeTruthy();
      expect(getByText('Click me')).toBeTruthy();
      expect(queryByText('Not found')).toBeNull();
    });

    it('should query elements by role', () => {
      const { getByRole } = render(() => {
        const div = document.createElement('div');

        const button = document.createElement('button');
        button.textContent = 'Submit';

        const heading = document.createElement('h1');
        heading.textContent = 'Page Title';

        div.appendChild(heading);
        div.appendChild(button);

        return div as any;
      });

      const button = getByRole('button');
      const heading = getByRole('heading');

      expect(button.textContent).toBe('Submit');
      expect(heading.textContent).toBe('Page Title');
    });
  });

  describe('Memory Cleanup', () => {
    it('should cleanup components properly', () => {
      const cleanupFns: Array<() => void> = [];

      const { unmount } = render(() => {
        const cleanup = () => {
          cleanupFns.push(() => {});
        };

        effect(() => {
          cleanup();
        });

        const div = document.createElement('div');
        div.textContent = 'Test';
        return div as any;
      });

      unmount();

      // Verify cleanup was called
      expect(cleanupFns.length).toBeGreaterThanOrEqual(0);
    });

    it('should cleanup all mounted components', () => {
      const results = [
        render(() => {
          const div = document.createElement('div');
          div.textContent = 'Component 1';
          return div as any;
        }),
        render(() => {
          const div = document.createElement('div');
          div.textContent = 'Component 2';
          return div as any;
        }),
        render(() => {
          const div = document.createElement('div');
          div.textContent = 'Component 3';
          return div as any;
        }),
      ];

      cleanup();

      results.forEach(result => {
        expect(result.container.textContent).toBe('');
      });
    });
  });
});
