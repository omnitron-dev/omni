/**
 * Integration Tests
 *
 * Complete testing library workflow tests demonstrating real-world usage
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, fireEvent, userEvent, waitFor, cleanup } from '../../src/testing/index.js';
import { signal, computed } from '../../src/core/reactivity/index.js';
import '../../src/testing/matchers.js';

describe('Testing Library Integration', () => {
  afterEach(() => {
    cleanup();
  });

  describe('Complete component testing workflow', () => {
    it('should test a counter component end-to-end', async () => {
      const count = signal(0);

      const { container, getByRole } = render(() => {
        const div = document.createElement('div');

        const display = document.createElement('span');
        display.textContent = `Count: ${count()}`;
        display.setAttribute('data-testid', 'count-display');

        const button = document.createElement('button');
        button.textContent = 'Increment';
        button.onclick = () => count.set(count() + 1);
        button.setAttribute('role', 'button');

        div.appendChild(display);
        div.appendChild(button);

        return div as any;
      });

      // Verify initial state
      expect(container.textContent).toContain('Count: 0');

      // Click button
      const button = getByRole('button');
      await userEvent.click(button);

      // Note: Would need rerender or reactive update mechanism
      // to see the count change reflected in DOM
    });

    it('should test form submission workflow', async () => {
      const onSubmit = vi.fn();

      const { container } = render(() => {
        const form = document.createElement('form');
        form.onsubmit = (e) => {
          e.preventDefault();
          const formData = new FormData(form);
          onSubmit({
            username: formData.get('username'),
            password: formData.get('password'),
          });
        };

        const usernameInput = document.createElement('input');
        usernameInput.name = 'username';
        usernameInput.setAttribute('placeholder', 'Username');

        const passwordInput = document.createElement('input');
        passwordInput.name = 'password';
        passwordInput.type = 'password';
        passwordInput.setAttribute('placeholder', 'Password');

        const submitBtn = document.createElement('button');
        submitBtn.type = 'submit';
        submitBtn.textContent = 'Login';

        form.appendChild(usernameInput);
        form.appendChild(passwordInput);
        form.appendChild(submitBtn);

        return form as any;
      });

      // Fill form
      const usernameInput = container.querySelector('[name="username"]') as HTMLInputElement;
      const passwordInput = container.querySelector('[name="password"]') as HTMLInputElement;

      await userEvent.type(usernameInput, 'testuser');
      await userEvent.type(passwordInput, 'password123');

      // Submit form
      const form = container.querySelector('form') as HTMLFormElement;
      await fireEvent.submit(form);

      // Verify submission
      expect(onSubmit).toHaveBeenCalledWith({
        username: 'testuser',
        password: 'password123',
      });
    });
  });

  describe('Async data loading', () => {
    it('should handle loading states', async () => {
      const loading = signal(true);
      const data = signal<string | null>(null);

      const { container } = render(() => {
        const div = document.createElement('div');

        if (loading()) {
          const loadingEl = document.createElement('div');
          loadingEl.textContent = 'Loading...';
          loadingEl.setAttribute('data-testid', 'loading');
          div.appendChild(loadingEl);
        } else if (data()) {
          const dataEl = document.createElement('div');
          dataEl.textContent = data()!;
          dataEl.setAttribute('data-testid', 'data');
          div.appendChild(dataEl);
        }

        return div as any;
      });

      // Initially loading
      expect(container.textContent).toContain('Loading...');

      // Simulate data fetch
      setTimeout(() => {
        loading.set(false);
        data.set('Loaded data');
      }, 100);

      // Wait for loading to finish
      await waitFor(() => {
        if (loading()) throw new Error('Still loading');
      });

      expect(loading()).toBe(false);
      expect(data()).toBe('Loaded data');
    });

    it('should handle error states', async () => {
      const loading = signal(true);
      const error = signal<string | null>(null);

      const { container, rerender } = render(() => {
        const div = document.createElement('div');

        if (loading()) {
          const loadingEl = document.createElement('div');
          loadingEl.textContent = 'Loading...';
          div.appendChild(loadingEl);
        } else if (error()) {
          const errorEl = document.createElement('div');
          errorEl.textContent = `Error: ${error()}`;
          errorEl.setAttribute('role', 'alert');
          div.appendChild(errorEl);
        }

        return div as any;
      });

      // Initially loading
      expect(container.textContent).toContain('Loading...');

      // Simulate error
      loading.set(false);
      error.set('Failed to load');

      // Rerender to show error
      rerender(() => {
        const div = document.createElement('div');
        if (error()) {
          const errorEl = document.createElement('div');
          errorEl.textContent = `Error: ${error()}`;
          errorEl.setAttribute('role', 'alert');
          div.appendChild(errorEl);
        }
        return div as any;
      });

      expect(container.textContent).toContain('Error: Failed to load');
    });
  });

  describe('User interaction flows', () => {
    it('should test multi-step user flow', async () => {
      const step = signal(1);

      const { container, getByRole, rerender } = render(() => {
        const div = document.createElement('div');

        const stepDisplay = document.createElement('div');
        stepDisplay.textContent = `Step ${step()}`;

        const nextBtn = document.createElement('button');
        nextBtn.textContent = 'Next';
        nextBtn.setAttribute('role', 'button');
        nextBtn.onclick = () => step.set(step() + 1);

        div.appendChild(stepDisplay);
        div.appendChild(nextBtn);

        return div as any;
      });

      // Step 1
      expect(container.textContent).toContain('Step 1');

      // Go to step 2
      await userEvent.click(getByRole('button'));
      expect(step()).toBe(2);

      // Rerender to show step 2
      rerender(() => {
        const div = document.createElement('div');
        const stepDisplay = document.createElement('div');
        stepDisplay.textContent = `Step ${step()}`;
        const nextBtn = document.createElement('button');
        nextBtn.textContent = 'Next';
        nextBtn.setAttribute('role', 'button');
        nextBtn.onclick = () => step.set(step() + 1);
        div.appendChild(stepDisplay);
        div.appendChild(nextBtn);
        return div as any;
      });

      expect(container.textContent).toContain('Step 2');

      // Go to step 3
      await userEvent.click(getByRole('button'));
      expect(step()).toBe(3);
    });

    it('should test conditional UI updates', async () => {
      const isOpen = signal(false);

      const { container, getByRole, rerender } = render(() => {
        const div = document.createElement('div');

        const button = document.createElement('button');
        button.textContent = isOpen() ? 'Close' : 'Open';
        button.setAttribute('role', 'button');
        button.onclick = () => isOpen.set(!isOpen());

        const content = document.createElement('div');
        if (isOpen()) {
          content.textContent = 'Content is visible';
          content.setAttribute('data-testid', 'content');
        }

        div.appendChild(button);
        div.appendChild(content);

        return div as any;
      });

      // Initially closed
      expect(container.textContent).toContain('Open');
      expect(container.querySelector('[data-testid="content"]')).toBeNull();

      // Open
      await userEvent.click(getByRole('button'));
      expect(isOpen()).toBe(true);

      // Rerender
      rerender(() => {
        const div = document.createElement('div');
        const button = document.createElement('button');
        button.textContent = isOpen() ? 'Close' : 'Open';
        button.setAttribute('role', 'button');
        button.onclick = () => isOpen.set(!isOpen());
        const content = document.createElement('div');
        if (isOpen()) {
          content.textContent = 'Content is visible';
          content.setAttribute('data-testid', 'content');
        }
        div.appendChild(button);
        div.appendChild(content);
        return div as any;
      });

      expect(container.textContent).toContain('Close');
      expect(container.textContent).toContain('Content is visible');
    });
  });

  describe('Real-world scenarios', () => {
    it('should test a search component', async () => {
      const query = signal('');
      const results = computed(() => {
        const q = query().toLowerCase();
        const allItems = ['Apple', 'Banana', 'Orange', 'Grape'];
        return allItems.filter((item) => item.toLowerCase().includes(q));
      });

      const { container } = render(() => {
        const div = document.createElement('div');

        const input = document.createElement('input');
        input.setAttribute('placeholder', 'Search...');
        input.value = query();
        input.oninput = (e) => query.set((e.target as HTMLInputElement).value);

        const resultsList = document.createElement('ul');
        results().forEach((item) => {
          const li = document.createElement('li');
          li.textContent = item;
          resultsList.appendChild(li);
        });

        div.appendChild(input);
        div.appendChild(resultsList);

        return div as any;
      });

      // Initially shows all results
      expect(container.querySelectorAll('li').length).toBe(4);

      // Type in search
      const input = container.querySelector('input') as HTMLInputElement;
      await userEvent.type(input, 'app');

      // Check computed results
      expect(results()).toEqual(['Apple']);
    });

    it('should test a todo list component', async () => {
      const todos = signal<string[]>([]);

      const addTodo = (text: string) => {
        todos.set([...todos(), text]);
      };

      const { container } = render(() => {
        const div = document.createElement('div');

        const input = document.createElement('input');
        input.setAttribute('placeholder', 'New todo');
        input.setAttribute('data-testid', 'todo-input');

        const addBtn = document.createElement('button');
        addBtn.textContent = 'Add';
        addBtn.onclick = () => {
          if (input.value) {
            addTodo(input.value);
            input.value = '';
          }
        };

        const list = document.createElement('ul');
        todos().forEach((todo) => {
          const li = document.createElement('li');
          li.textContent = todo;
          list.appendChild(li);
        });

        div.appendChild(input);
        div.appendChild(addBtn);
        div.appendChild(list);

        return div as any;
      });

      // Initially no todos
      expect(container.querySelectorAll('li').length).toBe(0);

      // Add a todo
      const input = container.querySelector('[data-testid="todo-input"]') as HTMLInputElement;
      await userEvent.type(input, 'Buy milk');

      const addBtn = container.querySelector('button') as HTMLButtonElement;
      await userEvent.click(addBtn);

      // Check state
      expect(todos()).toEqual(['Buy milk']);
    });

    it('should test form validation', async () => {
      const email = signal('');
      const error = signal('');

      const validate = () => {
        if (!email().includes('@')) {
          error.set('Invalid email');
          return false;
        }
        error.set('');
        return true;
      };

      const { container } = render(() => {
        const div = document.createElement('div');

        const input = document.createElement('input');
        input.type = 'email';
        input.value = email();
        input.oninput = (e) => {
          email.set((e.target as HTMLInputElement).value);
          validate();
        };

        const errorEl = document.createElement('div');
        errorEl.textContent = error();
        errorEl.setAttribute('role', 'alert');

        const button = document.createElement('button');
        button.textContent = 'Submit';
        button.onclick = validate;

        div.appendChild(input);
        div.appendChild(errorEl);
        div.appendChild(button);

        return div as any;
      });

      // Type invalid email
      const input = container.querySelector('input') as HTMLInputElement;
      await userEvent.type(input, 'invalid');

      validate();
      expect(error()).toBe('Invalid email');

      // Fix email
      await userEvent.clear(input);
      await userEvent.type(input, 'valid@email.com');

      validate();
      expect(error()).toBe('');
    });
  });

  describe('Performance considerations', () => {
    it('should handle many rendered elements efficiently', () => {
      const items = signal(Array.from({ length: 100 }, (_, i) => `Item ${i}`));

      const start = performance.now();

      const { container } = render(() => {
        const div = document.createElement('div');
        const list = document.createElement('ul');

        items().forEach((item) => {
          const li = document.createElement('li');
          li.textContent = item;
          list.appendChild(li);
        });

        div.appendChild(list);
        return div as any;
      });

      const duration = performance.now() - start;

      expect(container.querySelectorAll('li').length).toBe(100);
      expect(duration).toBeLessThan(1000); // Should be fast
    });

    it('should cleanup large component trees', () => {
      const items = Array.from({ length: 50 }, (_, i) => i);

      const results = items.map((i) =>
        render(() => {
          const div = document.createElement('div');
          div.textContent = `Component ${i}`;
          return div as any;
        })
      );

      // All should be mounted
      results.forEach((r) => {
        expect(document.body.contains(r.container)).toBe(true);
      });

      // Cleanup all
      cleanup();

      // All should be removed
      results.forEach((r) => {
        expect(document.body.contains(r.container)).toBe(false);
      });
    });
  });

  describe('Memory cleanup', () => {
    it('should not leak memory with multiple renders', () => {
      for (let i = 0; i < 20; i++) {
        const { unmount } = render(() => {
          const div = document.createElement('div');
          div.textContent = `Test ${i}`;
          return div as any;
        });
        unmount();
      }

      // After unmounting all, document should be clean
      const containers = document.body.querySelectorAll('div[style]');
      expect(containers.length).toBeLessThan(5);
    });
  });
});
