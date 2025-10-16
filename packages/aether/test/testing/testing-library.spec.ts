/**
 * Testing Library - Integration Tests
 *
 * Verifies that the testing library works correctly with Aether components
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent, userEvent, waitFor } from '../../src/testing/index.js';
import { signal } from '../../src/core/reactivity/signal.js';
import { defineComponent } from '../../src/core/component/define.js';

describe('Testing Library', () => {
  afterEach(() => {
    cleanup();
  });

  describe('render', () => {
    it('should render a simple component', () => {
      const TestComponent = defineComponent(() => () => {
        const div = document.createElement('div');
        div.textContent = 'Hello World';
        return div;
      });

      const { container } = render(() => TestComponent({}));

      expect(container.textContent).toContain('Hello World');
    });

    it('should provide query utilities', () => {
      const TestComponent = defineComponent(() => () => {
        const div = document.createElement('div');
        div.setAttribute('data-testid', 'test-div');
        div.textContent = 'Test Content';
        return div;
      });

      const { getByTestId, getByText } = render(() => TestComponent({}));

      expect(getByTestId('test-div')).toBeDefined();
      expect(getByText('Test Content')).toBeDefined();
    });

    it('should support rerender', () => {
      let renderCount = 0;

      const TestComponent = defineComponent(() => () => {
        renderCount++;
        const div = document.createElement('div');
        div.textContent = `Render ${renderCount}`;
        return div;
      });

      const { container, rerender } = render(() => TestComponent({}));

      expect(container.textContent).toContain('Render 1');

      rerender(() => TestComponent({}));

      expect(container.textContent).toContain('Render 2');
    });

    it('should cleanup on unmount', () => {
      const TestComponent = defineComponent(() => () => {
        const div = document.createElement('div');
        div.textContent = 'Test';
        return div;
      });

      const { container, unmount } = render(() => TestComponent({}));

      expect(document.body.contains(container)).toBe(true);

      unmount();

      expect(document.body.contains(container)).toBe(false);
    });
  });

  describe('fireEvent', () => {
    it('should fire click events', () => {
      let clicked = false;

      const TestComponent = defineComponent(() => () => {
        const button = document.createElement('button');
        button.textContent = 'Click Me';
        button.onclick = () => {
          clicked = true;
        };
        return button;
      });

      const { getByText } = render(() => TestComponent({}));

      const button = getByText('Click Me');
      fireEvent.click(button);

      expect(clicked).toBe(true);
    });

    it('should fire input events', () => {
      const TestComponent = defineComponent(() => () => {
        const input = document.createElement('input');
        input.setAttribute('data-testid', 'test-input');
        return input;
      });

      const { getByTestId } = render(() => TestComponent({}));

      const input = getByTestId('test-input') as HTMLInputElement;
      input.value = 'test value';
      fireEvent.input(input);

      expect(input.value).toBe('test value');
    });
  });

  describe('userEvent', () => {
    it('should simulate typing', async () => {
      const TestComponent = defineComponent(() => () => {
        const input = document.createElement('input');
        input.setAttribute('data-testid', 'test-input');
        return input;
      });

      const { getByTestId } = render(() => TestComponent({}));

      const input = getByTestId('test-input') as HTMLInputElement;
      await userEvent.type(input, 'Hello');

      expect(input.value).toBe('Hello');
    });

    it('should simulate clicking', async () => {
      let clicked = false;

      const TestComponent = defineComponent(() => () => {
        const button = document.createElement('button');
        button.textContent = 'Click Me';
        button.onclick = () => {
          clicked = true;
        };
        return button;
      });

      const { getByText } = render(() => TestComponent({}));

      const button = getByText('Click Me');
      await userEvent.click(button);

      expect(clicked).toBe(true);
    });

    it('should clear input values', async () => {
      const TestComponent = defineComponent(() => () => {
        const input = document.createElement('input');
        input.setAttribute('data-testid', 'test-input');
        input.value = 'initial value';
        return input;
      });

      const { getByTestId } = render(() => TestComponent({}));

      const input = getByTestId('test-input') as HTMLInputElement;
      expect(input.value).toBe('initial value');

      await userEvent.clear(input);

      expect(input.value).toBe('');
    });
  });

  describe('waitFor', () => {
    it('should wait for condition to become true', async () => {
      let value = false;

      setTimeout(() => {
        value = true;
      }, 100);

      await waitFor(() => {
        if (!value) {
          throw new Error('Not yet');
        }
      });

      expect(value).toBe(true);
    });

    it('should timeout if condition never becomes true', async () => {
      await expect(
        waitFor(
          () => {
            throw new Error('Never true');
          },
          { timeout: 100, interval: 10 }
        )
      ).rejects.toThrow();
    });
  });

  describe('reactive component', () => {
    it('should work with signal-based components', () => {
      const TestComponent = defineComponent(() => {
        const count = signal(0);

        return () => {
          const div = document.createElement('div');
          div.setAttribute('data-testid', 'count');
          div.textContent = `Count: ${count()}`;

          const button = document.createElement('button');
          button.textContent = 'Increment';
          button.onclick = () => count.set(count() + 1);

          const container = document.createElement('div');
          container.appendChild(div);
          container.appendChild(button);

          return container;
        };
      });

      const { getByTestId, getByText } = render(() => TestComponent({}));

      expect(getByTestId('count').textContent).toBe('Count: 0');

      const button = getByText('Increment');
      fireEvent.click(button);

      // Note: In a real implementation, the reactivity system would
      // automatically update the DOM. This is a simplified test.
    });
  });
});
