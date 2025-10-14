/**
 * Render Utility Tests
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '../../src/testing/index.js';
import { signal } from '../../src/core/reactivity/index.js';

describe('render', () => {
  afterEach(() => {
    cleanup();
  });

  describe('Basic rendering', () => {
    it('should render a simple component', () => {
      const { container } = render(() => {
        const div = document.createElement('div');
        div.textContent = 'Hello World';
        return div as any;
      });

      expect(container.textContent).toContain('Hello World');
    });

    it('should render with reactive signals', () => {
      const count = signal(0);

      const { container } = render(() => {
        const div = document.createElement('div');
        div.textContent = String(count());
        return div as any;
      });

      expect(container.textContent).toContain('0');
    });
  });

  describe('Render with options', () => {
    it('should render into custom container', () => {
      const customContainer = document.createElement('div');
      customContainer.id = 'custom';
      document.body.appendChild(customContainer);

      const { container } = render(
        () => {
          const div = document.createElement('div');
          div.textContent = 'Custom';
          return div as any;
        },
        { container: customContainer }
      );

      expect(container.id).toBe('custom');
      expect(container.textContent).toContain('Custom');

      document.body.removeChild(customContainer);
    });

    it('should support wrapper components', () => {
      const wrapper = ({ children }: { children: any }) => {
        const div = document.createElement('div');
        div.className = 'wrapper';
        if (children instanceof Node) {
          div.appendChild(children);
        }
        return div as any;
      };

      const { container } = render(
        () => {
          const span = document.createElement('span');
          span.textContent = 'Wrapped';
          return span as any;
        },
        { wrapper }
      );

      const wrapperEl = container.querySelector('.wrapper');
      expect(wrapperEl).toBeTruthy();
    });
  });

  describe('Cleanup functionality', () => {
    it('should cleanup on unmount', () => {
      const { container, unmount } = render(() => {
        const div = document.createElement('div');
        div.textContent = 'Test';
        return div as any;
      });

      expect(container.textContent).toContain('Test');
      unmount();
      expect(container.textContent).toBe('');
    });

    it('should cleanup all mounted components', () => {
      const result1 = render(() => {
        const div = document.createElement('div');
        div.textContent = 'Component 1';
        return div as any;
      });

      const result2 = render(() => {
        const div = document.createElement('div');
        div.textContent = 'Component 2';
        return div as any;
      });

      expect(result1.container.textContent).toContain('Component 1');
      expect(result2.container.textContent).toContain('Component 2');

      cleanup();

      expect(result1.container.textContent).toBe('');
      expect(result2.container.textContent).toBe('');
    });
  });

  describe('Rerender functionality', () => {
    it('should rerender with new component', () => {
      const { container, rerender } = render(() => {
        const div = document.createElement('div');
        div.textContent = 'Initial';
        return div as any;
      });

      expect(container.textContent).toContain('Initial');

      rerender(() => {
        const div = document.createElement('div');
        div.textContent = 'Updated';
        return div as any;
      });

      expect(container.textContent).toContain('Updated');
      expect(container.textContent).not.toContain('Initial');
    });
  });

  describe('Debug functionality', () => {
    it('should provide debug method', () => {
      const { debug } = render(() => {
        const div = document.createElement('div');
        div.textContent = 'Debug test';
        return div as any;
      });

      expect(typeof debug).toBe('function');
      expect(() => debug()).not.toThrow();
    });
  });

  describe('Hydration support', () => {
    it('should accept hydrate option', () => {
      const container = document.createElement('div');
      container.innerHTML = '<div>Existing content</div>';
      document.body.appendChild(container);

      expect(() => {
        render(
          () => {
            const div = document.createElement('div');
            div.textContent = 'Hydrated';
            return div as any;
          },
          { container, hydrate: true }
        );
      }).not.toThrow();

      document.body.removeChild(container);
    });

    it('should warn about unimplemented hydration', () => {
      const container = document.createElement('div');
      container.innerHTML = '<div>Existing</div>';
      document.body.appendChild(container);

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      render(
        () => {
          const div = document.createElement('div');
          return div as any;
        },
        { container, hydrate: true }
      );

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Hydration'));

      consoleSpy.mockRestore();
      document.body.removeChild(container);
    });
  });

  describe('Query methods', () => {
    it('should provide query methods in result', () => {
      const { getByText, getByRole, queryByText, findByText } = render(() => {
        const div = document.createElement('div');
        div.textContent = 'Query test';
        return div as any;
      });

      expect(typeof getByText).toBe('function');
      expect(typeof getByRole).toBe('function');
      expect(typeof queryByText).toBe('function');
      expect(typeof findByText).toBe('function');
    });

    it('should query rendered content', () => {
      const { getByText } = render(() => {
        const div = document.createElement('div');
        const button = document.createElement('button');
        button.textContent = 'Click me';
        div.appendChild(button);
        return div as any;
      });

      const button = getByText('Click me');
      expect(button).toBeTruthy();
      expect(button.tagName).toBe('BUTTON');
    });
  });
});
