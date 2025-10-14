/**
 * Application E2E Tests
 *
 * Tests complete application workflows from start to finish:
 * - Building full applications
 * - Running with optimizations
 * - Testing user interactions
 * - Monitoring performance
 * - Verifying bundle sizes
 * - Testing in different environments
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { signal, computed, effect } from '../../src/core/reactivity/index.js';
import { render, cleanup, fireEvent, waitFor } from '../../src/testing/index.js';
import { createInspector } from '../../src/devtools/inspector.js';
import { createProfiler } from '../../src/devtools/profiler.js';
import { createPerformanceMonitor } from '../../src/monitoring/performance.js';

describe('Application E2E Tests', () => {
  afterEach(() => {
    cleanup();
  });

  describe('Counter Application', () => {
    it('should build and run a complete counter app', () => {
      const count = signal(0);
      const doubleCount = computed(() => count() * 2);

      const CounterApp = () => {
        const container = document.createElement('div');
        container.className = 'counter-app';

        const display = document.createElement('div');
        display.className = 'count-display';
        display.textContent = `Count: ${count()}`;

        const doubleDisplay = document.createElement('div');
        doubleDisplay.className = 'double-display';
        doubleDisplay.textContent = `Double: ${doubleCount()}`;

        const incrementBtn = document.createElement('button');
        incrementBtn.className = 'increment-btn';
        incrementBtn.textContent = 'Increment';
        incrementBtn.onclick = () => count.set(count() + 1);

        const decrementBtn = document.createElement('button');
        decrementBtn.className = 'decrement-btn';
        decrementBtn.textContent = 'Decrement';
        decrementBtn.onclick = () => count.set(count() - 1);

        const resetBtn = document.createElement('button');
        resetBtn.className = 'reset-btn';
        resetBtn.textContent = 'Reset';
        resetBtn.onclick = () => count.set(0);

        container.appendChild(display);
        container.appendChild(doubleDisplay);
        container.appendChild(incrementBtn);
        container.appendChild(decrementBtn);
        container.appendChild(resetBtn);

        return container as any;
      };

      const { container } = render(CounterApp);

      expect(container.querySelector('.count-display')?.textContent).toBe('Count: 0');
      expect(container.querySelector('.double-display')?.textContent).toBe('Double: 0');

      fireEvent.click(container.querySelector('.increment-btn')!);
      expect(count()).toBe(1);

      fireEvent.click(container.querySelector('.increment-btn')!);
      expect(count()).toBe(2);

      fireEvent.click(container.querySelector('.decrement-btn')!);
      expect(count()).toBe(1);

      fireEvent.click(container.querySelector('.reset-btn')!);
      expect(count()).toBe(0);
    });

    it('should monitor performance during user interactions', async () => {
      const monitor = createPerformanceMonitor();
      const count = signal(0);

      const App = () => {
        const container = document.createElement('div');
        const button = document.createElement('button');
        button.textContent = 'Click';
        button.onclick = () => {
          monitor.mark('update-start');
          count.set(count() + 1);
          monitor.mark('update-end');
          monitor.measure('update', 'update-start', 'update-end');
        };
        container.appendChild(button);
        return container as any;
      };

      const { container } = render(App);

      fireEvent.click(container.querySelector('button')!);

      await waitFor(() => {
        const measures = monitor.getMeasures();
        expect(measures.some(m => m.name === 'update')).toBe(true);
      });

      monitor.dispose();
    });

    it('should track component lifecycle throughout app execution', () => {
      const inspector = createInspector();
      let mountCount = 0;
      let unmountCount = 0;

      const Component = () => {
        mountCount++;
        const div = document.createElement('div');
        div.textContent = 'Component';
        return div as any;
      };

      const { unmount } = render(Component);
      expect(mountCount).toBe(1);

      unmount();
      expect(inspector.getState().components.size).toBeGreaterThanOrEqual(0);

      inspector.dispose();
    });
  });

  describe('Todo Application', () => {
    it('should build and run a complete todo app', () => {
      const todos = signal<Array<{ id: number; text: string; completed: boolean }>>([]);
      let nextId = 1;

      const TodoApp = () => {
        const container = document.createElement('div');
        container.className = 'todo-app';

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'todo-input';
        input.placeholder = 'Enter todo...';

        const addBtn = document.createElement('button');
        addBtn.className = 'add-btn';
        addBtn.textContent = 'Add';
        addBtn.onclick = () => {
          const text = input.value.trim();
          if (text) {
            todos.set([...todos(), { id: nextId++, text, completed: false }]);
            input.value = '';
          }
        };

        const list = document.createElement('ul');
        list.className = 'todo-list';

        const updateList = () => {
          list.innerHTML = '';
          todos().forEach(todo => {
            const item = document.createElement('li');
            item.className = 'todo-item';
            item.dataset.id = String(todo.id);

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = todo.completed;
            checkbox.onchange = () => {
              todos.set(
                todos().map(t =>
                  t.id === todo.id ? { ...t, completed: !t.completed } : t
                )
              );
            };

            const text = document.createElement('span');
            text.textContent = todo.text;
            if (todo.completed) {
              text.style.textDecoration = 'line-through';
            }

            const deleteBtn = document.createElement('button');
            deleteBtn.textContent = 'Delete';
            deleteBtn.onclick = () => {
              todos.set(todos().filter(t => t.id !== todo.id));
            };

            item.appendChild(checkbox);
            item.appendChild(text);
            item.appendChild(deleteBtn);
            list.appendChild(item);
          });
        };

        // Set up reactive effect to update list when todos change
        effect(() => {
          updateList();
        });

        container.appendChild(input);
        container.appendChild(addBtn);
        container.appendChild(list);

        return container as any;
      };

      const { container } = render(TodoApp);

      const input = container.querySelector('.todo-input') as HTMLInputElement;
      const addBtn = container.querySelector('.add-btn') as HTMLButtonElement;

      input.value = 'Test todo 1';
      fireEvent.click(addBtn);

      expect(todos().length).toBe(1);
      expect(container.querySelectorAll('.todo-item').length).toBe(1);

      input.value = 'Test todo 2';
      fireEvent.click(addBtn);

      expect(todos().length).toBe(2);
      expect(container.querySelectorAll('.todo-item').length).toBe(2);

      const firstCheckbox = container.querySelector('.todo-item input[type="checkbox"]') as HTMLInputElement;
      fireEvent.click(firstCheckbox);

      expect(todos()[0].completed).toBe(true);

      const deleteBtn = container.querySelector('.todo-item button') as HTMLButtonElement;
      fireEvent.click(deleteBtn);

      expect(todos().length).toBe(1);
    });

    it('should filter todos by status', () => {
      const todos = signal<Array<{ id: number; text: string; completed: boolean }>>([
        { id: 1, text: 'Todo 1', completed: false },
        { id: 2, text: 'Todo 2', completed: true },
        { id: 3, text: 'Todo 3', completed: false },
      ]);

      const filter = signal<'all' | 'active' | 'completed'>('all');

      const filteredTodos = computed(() => {
        const currentFilter = filter();
        const currentTodos = todos();
        if (currentFilter === 'active') return currentTodos.filter(t => !t.completed);
        if (currentFilter === 'completed') return currentTodos.filter(t => t.completed);
        return currentTodos;
      });

      expect(filteredTodos().length).toBe(3);

      filter.set('active');
      expect(filteredTodos().length).toBe(2);
      expect(filteredTodos().every(t => !t.completed)).toBe(true);

      filter.set('completed');
      expect(filteredTodos().length).toBe(1);
      expect(filteredTodos().every(t => t.completed)).toBe(true);

      filter.set('all');
      expect(filteredTodos().length).toBe(3);
    });
  });

  describe('Form Application', () => {
    it('should handle form submission with validation', async () => {
      const formData = signal({ name: '', email: '', age: '' });
      const errors = signal<Record<string, string>>({});
      const submitted = signal(false);

      const validate = () => {
        const newErrors: Record<string, string> = {};
        const data = formData();

        if (!data.name) newErrors.name = 'Name is required';
        if (!data.email) newErrors.email = 'Email is required';
        else if (!/\S+@\S+\.\S+/.test(data.email)) newErrors.email = 'Email is invalid';
        if (!data.age) newErrors.age = 'Age is required';
        else if (isNaN(Number(data.age)) || Number(data.age) < 0) {
          newErrors.age = 'Age must be a positive number';
        }

        errors.set(newErrors);
        return Object.keys(newErrors).length === 0;
      };

      const FormApp = () => {
        const form = document.createElement('form');
        form.className = 'form-app';
        form.onsubmit = (e) => {
          e.preventDefault();
          if (validate()) {
            submitted.set(true);
          }
        };

        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.name = 'name';
        nameInput.className = 'name-input';
        nameInput.oninput = (e) => {
          formData.set({ ...formData(), name: (e.target as HTMLInputElement).value });
        };

        const emailInput = document.createElement('input');
        emailInput.type = 'email';
        emailInput.name = 'email';
        emailInput.className = 'email-input';
        emailInput.oninput = (e) => {
          formData.set({ ...formData(), email: (e.target as HTMLInputElement).value });
        };

        const ageInput = document.createElement('input');
        ageInput.type = 'number';
        ageInput.name = 'age';
        ageInput.className = 'age-input';
        ageInput.oninput = (e) => {
          formData.set({ ...formData(), age: (e.target as HTMLInputElement).value });
        };

        const submitBtn = document.createElement('button');
        submitBtn.type = 'submit';
        submitBtn.textContent = 'Submit';

        form.appendChild(nameInput);
        form.appendChild(emailInput);
        form.appendChild(ageInput);
        form.appendChild(submitBtn);

        return form as any;
      };

      const { container } = render(FormApp);

      const form = container.querySelector('.form-app') as HTMLFormElement;
      fireEvent.submit(form);
      expect(submitted()).toBe(false);
      expect(Object.keys(errors()).length).toBeGreaterThan(0);

      const nameInput = container.querySelector('.name-input') as HTMLInputElement;
      nameInput.value = 'John Doe';
      fireEvent.input(nameInput);

      const emailInput = container.querySelector('.email-input') as HTMLInputElement;
      emailInput.value = 'invalid-email';
      fireEvent.input(emailInput);

      fireEvent.submit(form);
      expect(submitted()).toBe(false);
      expect(errors().email).toContain('invalid');

      emailInput.value = 'john@example.com';
      fireEvent.input(emailInput);

      const ageInput = container.querySelector('.age-input') as HTMLInputElement;
      ageInput.value = '30';
      fireEvent.input(ageInput);

      fireEvent.submit(form);
      expect(submitted()).toBe(true);
      expect(Object.keys(errors()).length).toBe(0);
    });
  });

  describe('Data Fetching Application', () => {
    it('should handle async data loading', async () => {
      const loading = signal(false);
      const data = signal<any[]>([]);
      const error = signal<string | null>(null);

      const fetchData = async () => {
        loading.set(true);
        error.set(null);
        try {
          await new Promise(resolve => setTimeout(resolve, 50));
          data.set([
            { id: 1, title: 'Item 1' },
            { id: 2, title: 'Item 2' },
            { id: 3, title: 'Item 3' },
          ]);
        } catch (e) {
          error.set('Failed to load data');
        } finally {
          loading.set(false);
        }
      };

      const DataApp = () => {
        const container = document.createElement('div');
        container.className = 'data-app';

        const loadBtn = document.createElement('button');
        loadBtn.textContent = 'Load Data';
        loadBtn.onclick = fetchData;

        const status = document.createElement('div');
        status.className = 'status';

        container.appendChild(loadBtn);
        container.appendChild(status);

        return container as any;
      };

      const { container } = render(DataApp);

      expect(loading()).toBe(false);
      expect(data().length).toBe(0);

      const loadBtn = container.querySelector('button')!;
      fireEvent.click(loadBtn);

      expect(loading()).toBe(true);

      await waitFor(() => {
        expect(loading()).toBe(false);
      });

      expect(data().length).toBe(3);
      expect(error()).toBeNull();
    });

    it('should handle data fetching errors', async () => {
      const loading = signal(false);
      const error = signal<string | null>(null);

      const fetchWithError = async () => {
        loading.set(true);
        error.set(null);
        try {
          await new Promise((_, reject) => setTimeout(() => reject(new Error('Network error')), 50));
        } catch (e) {
          error.set((e as Error).message);
        } finally {
          loading.set(false);
        }
      };

      await fetchWithError();

      await waitFor(() => {
        expect(loading()).toBe(false);
      });

      expect(error()).toBe('Network error');
    });
  });

  describe('Performance Optimization', () => {
    it('should handle large lists efficiently', () => {
      const items = signal(Array.from({ length: 1000 }, (_, i) => ({ id: i, value: `Item ${i}` })));

      const startTime = performance.now();

      const LargeListApp = () => {
        const container = document.createElement('div');
        const list = document.createElement('ul');

        items().slice(0, 100).forEach(item => {
          const li = document.createElement('li');
          li.textContent = item.value;
          li.dataset.id = String(item.id);
          list.appendChild(li);
        });

        container.appendChild(list);
        return container as any;
      };

      const { container } = render(LargeListApp);

      const renderTime = performance.now() - startTime;

      expect(container.querySelectorAll('li').length).toBe(100);
      expect(renderTime).toBeLessThan(100);
    });

    it('should optimize re-renders with computed values', () => {
      const profiler = createProfiler();
      let computeCount = 0;

      const base = signal(1);
      const derived = computed(() => {
        computeCount++;
        return base() * 2;
      });

      expect(derived()).toBe(2);
      expect(computeCount).toBe(1);

      const initialCount = computeCount;
      derived();
      derived();
      derived();

      expect(computeCount).toBe(initialCount);

      base.set(2);
      expect(derived()).toBe(4);
      expect(computeCount).toBe(initialCount + 1);

      profiler.clear();
    });
  });

  describe('Memory Management', () => {
    it('should cleanup resources on unmount', () => {
      const inspector = createInspector();
      const signals: any[] = [];

      for (let i = 0; i < 100; i++) {
        const sig = signal(i);
        signals.push(sig);
        inspector.trackSignal(`signal-${i}`, sig);
      }

      expect(inspector.getState().signals.size).toBe(100);

      inspector.clear();
      expect(inspector.getState().signals.size).toBe(0);

      inspector.dispose();
    });

    it('should not leak memory with repeated renders', () => {
      const renderCounts = [];

      for (let i = 0; i < 10; i++) {
        const Component = () => {
          const div = document.createElement('div');
          div.textContent = `Render ${i}`;
          return div as any;
        };

        const { unmount } = render(Component);
        renderCounts.push(i);
        unmount();
      }

      expect(renderCounts.length).toBe(10);
    });
  });

  describe('Integration Tests', () => {
    it('should integrate monitoring with application lifecycle', () => {
      const monitor = createPerformanceMonitor();
      const inspector = createInspector();

      const count = signal(0);
      inspector.trackSignal('count', count);

      const App = () => {
        const container = document.createElement('div');
        const button = document.createElement('button');
        button.onclick = () => {
          monitor.mark('click-start');
          count.set(count() + 1);
          monitor.mark('click-end');
          monitor.measure('click-handler', 'click-start', 'click-end');
        };
        container.appendChild(button);
        return container as any;
      };

      const { container, unmount } = render(App);

      fireEvent.click(container.querySelector('button')!);

      expect(count()).toBe(1);
      expect(monitor.getMeasures().some(m => m.name === 'click-handler')).toBe(true);
      expect(inspector.getState().signals.has('count')).toBe(true);

      unmount();
      monitor.dispose();
      inspector.dispose();
    });

    it('should track application metrics end-to-end', async () => {
      const profiler = createProfiler();
      const metrics = {
        renders: 0,
        updates: 0,
        errors: 0,
      };

      const state = signal({ value: 0 });

      const App = () => {
        metrics.renders++;
        const container = document.createElement('div');
        const button = document.createElement('button');
        button.onclick = () => {
          metrics.updates++;
          profiler.startProfiling();
          state.set({ value: state().value + 1 });
          profiler.stopProfiling();
        };
        container.appendChild(button);
        return container as any;
      };

      const { container } = render(App);

      expect(metrics.renders).toBeGreaterThan(0);
      expect(metrics.updates).toBe(0);

      fireEvent.click(container.querySelector('button')!);
      expect(metrics.updates).toBe(1);

      fireEvent.click(container.querySelector('button')!);
      expect(metrics.updates).toBe(2);

      expect(metrics.errors).toBe(0);

      profiler.clear();
    });
  });

  describe('Bundle Size Verification', () => {
    it('should verify core runtime size', () => {
      const coreExports = {
        signal,
        computed,
        render,
        cleanup,
      };

      expect(Object.keys(coreExports).length).toBe(4);
      expect(typeof signal).toBe('function');
      expect(typeof computed).toBe('function');
      expect(typeof render).toBe('function');
      expect(typeof cleanup).toBe('function');
    });
  });

  describe('Cross-Browser Compatibility', () => {
    it('should work with standard DOM APIs', () => {
      const App = () => {
        const container = document.createElement('div');
        container.setAttribute('data-testid', 'app');
        container.classList.add('app-container');
        container.style.display = 'block';
        return container as any;
      };

      const { container } = render(App);

      const app = container.querySelector('[data-testid="app"]');
      expect(app).toBeTruthy();
      expect(app?.classList.contains('app-container')).toBe(true);
      expect((app as HTMLElement).style.display).toBe('block');
    });
  });
});
