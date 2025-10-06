import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from '../../../src/core/reactivity/batch';
import {
  createDirective,
  createUpdatableDirective,
  combineDirectives,
  autoFocus,
  clickOutside,
} from '../../../src/utils/directive';

describe('Directive Utilities', () => {
  let dispose: (() => void) | undefined;

  afterEach(() => {
    if (dispose) {
      dispose();
      dispose = undefined;
    }
  });

  describe('createDirective', () => {
    it('should create a directive function', () => {
      const directive = createDirective<string>((element, text) => {
        element.textContent = text;
      });

      expect(typeof directive).toBe('function');
    });

    it('should execute directive setup on element', () => {
      const directive = createDirective<string>((element, text) => {
        element.setAttribute('data-text', text);
      });

      const div = document.createElement('div');

      createRoot((d) => {
        dispose = d;
        const ref = directive('hello');
        ref(div);
      });

      expect(div.getAttribute('data-text')).toBe('hello');
    });

    it('should call cleanup function on dispose', () => {
      const cleanup = vi.fn();
      const directive = createDirective<void>(() => {
        return cleanup;
      });

      const div = document.createElement('div');

      createRoot((d) => {
        dispose = d;
        const ref = directive();
        ref(div);
      });

      expect(cleanup).not.toHaveBeenCalled();

      dispose?.();
      dispose = undefined;

      expect(cleanup).toHaveBeenCalledTimes(1);
    });

    it('should pass params to setup function', () => {
      const setup = vi.fn();
      const directive = createDirective<{ value: number }>(setup);

      const div = document.createElement('div');

      createRoot((d) => {
        dispose = d;
        const ref = directive({ value: 42 });
        ref(div);
      });

      expect(setup).toHaveBeenCalledWith(div, { value: 42 });
    });
  });

  describe('createUpdatableDirective', () => {
    it('should create updatable directive', () => {
      const directive = createUpdatableDirective<{ value: string }>(
        (element, params) => {
          const update = (newParams: { value: string }) => {
            element.textContent = newParams.value;
          };

          update(params);

          return {
            update,
            destroy: () => {
              element.textContent = '';
            },
          };
        }
      );

      const div = document.createElement('div');

      createRoot((d) => {
        dispose = d;
        const ref = directive({ value: 'initial' });
        ref(div);
      });

      expect(div.textContent).toBe('initial');
    });

    it('should call destroy on dispose', () => {
      const destroy = vi.fn();
      const directive = createUpdatableDirective<void>(() => {
        return { destroy };
      });

      const div = document.createElement('div');

      createRoot((d) => {
        dispose = d;
        const ref = directive();
        ref(div);
      });

      expect(destroy).not.toHaveBeenCalled();

      dispose?.();
      dispose = undefined;

      expect(destroy).toHaveBeenCalledTimes(1);
    });
  });

  describe('combineDirectives', () => {
    it('should combine multiple directives', () => {
      const calls: string[] = [];

      const directive1 = (el: HTMLElement) => {
        calls.push('directive1');
      };

      const directive2 = (el: HTMLElement) => {
        calls.push('directive2');
      };

      const combined = combineDirectives([directive1, directive2]);

      const div = document.createElement('div');
      combined(div);

      expect(calls).toEqual(['directive1', 'directive2']);
    });

    it('should execute directives in order', () => {
      const order: number[] = [];

      const directives = [
        (el: HTMLElement) => order.push(1),
        (el: HTMLElement) => order.push(2),
        (el: HTMLElement) => order.push(3),
      ];

      const combined = combineDirectives(directives);
      const div = document.createElement('div');

      combined(div);

      expect(order).toEqual([1, 2, 3]);
    });
  });

  describe('autoFocus', () => {
    it('should focus element when mounted', async () => {
      const input = document.createElement('input');
      document.body.appendChild(input);

      const focusSpy = vi.spyOn(input, 'focus');

      createRoot((d) => {
        dispose = d;
        const ref = autoFocus();
        ref(input);
      });

      // AutoFocus uses queueMicrotask - wait for it
      await new Promise((resolve) => queueMicrotask(resolve));

      expect(focusSpy).toHaveBeenCalled();
      document.body.removeChild(input);
    });
  });

  describe('clickOutside', () => {
    beforeEach(() => {
      document.body.innerHTML = '';
    });

    it('should call handler when clicking outside element', () => {
      const handler = vi.fn();
      const div = document.createElement('div');
      const outside = document.createElement('div');

      document.body.appendChild(div);
      document.body.appendChild(outside);

      createRoot((d) => {
        dispose = d;
        const ref = clickOutside(handler);
        ref(div);
      });

      // Click outside
      outside.click();

      expect(handler).toHaveBeenCalled();

      document.body.removeChild(div);
      document.body.removeChild(outside);
    });

    it('should not call handler when clicking inside element', () => {
      const handler = vi.fn();
      const div = document.createElement('div');
      const inside = document.createElement('button');

      div.appendChild(inside);
      document.body.appendChild(div);

      createRoot((d) => {
        dispose = d;
        const ref = clickOutside(handler);
        ref(div);
      });

      // Click inside
      inside.click();

      expect(handler).not.toHaveBeenCalled();

      document.body.removeChild(div);
    });

    it('should remove listener on cleanup', () => {
      const handler = vi.fn();
      const div = document.createElement('div');
      const outside = document.createElement('div');

      document.body.appendChild(div);
      document.body.appendChild(outside);

      createRoot((d) => {
        dispose = d;
        const ref = clickOutside(handler);
        ref(div);
      });

      // Verify it works before cleanup
      outside.click();
      expect(handler).toHaveBeenCalledTimes(1);

      handler.mockClear();

      dispose?.();
      dispose = undefined;

      // Click after cleanup
      outside.click();

      // Handler should not be called after cleanup
      expect(handler).not.toHaveBeenCalled();

      document.body.removeChild(div);
      document.body.removeChild(outside);
    });
  });

  describe('Integration with reactive context', () => {
    it('should work within reactive context', () => {
      const setup = vi.fn();
      const cleanup = vi.fn();

      const directive = createDirective<string>((element, text) => {
        setup(text);
        element.textContent = text;
        return cleanup;
      });

      const div = document.createElement('div');

      createRoot((d) => {
        dispose = d;
        const ref = directive('test');
        ref(div);
      });

      expect(setup).toHaveBeenCalledWith('test');
      expect(div.textContent).toBe('test');
      expect(cleanup).not.toHaveBeenCalled();

      dispose?.();
      dispose = undefined;

      expect(cleanup).toHaveBeenCalledTimes(1);
    });

    it('should handle multiple directives on same element', () => {
      const calls: string[] = [];

      const directive1 = createDirective<void>(() => {
        calls.push('setup1');
        return () => calls.push('cleanup1');
      });

      const directive2 = createDirective<void>(() => {
        calls.push('setup2');
        return () => calls.push('cleanup2');
      });

      const div = document.createElement('div');

      createRoot((d) => {
        dispose = d;
        const ref1 = directive1();
        const ref2 = directive2();

        ref1(div);
        ref2(div);
      });

      expect(calls).toEqual(['setup1', 'setup2']);

      dispose?.();
      dispose = undefined;

      // Cleanup functions are called
      // The order may vary depending on implementation
      expect(calls.length).toBe(4);
      expect(calls.slice(0, 2)).toEqual(['setup1', 'setup2']);
      expect(calls.slice(2)).toContain('cleanup1');
      expect(calls.slice(2)).toContain('cleanup2');
    });
  });

  describe('Error handling', () => {
    it('should handle errors in directive setup', () => {
      const directive = createDirective<void>(() => {
        throw new Error('Setup error');
      });

      const div = document.createElement('div');

      expect(() => {
        createRoot(() => {
          const ref = directive();
          ref(div);
        });
      }).toThrow('Setup error');
    });

    it('should handle errors in cleanup', () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      const directive = createDirective<void>(() => {
        return () => {
          throw new Error('Cleanup error');
        };
      });

      const div = document.createElement('div');

      createRoot((d) => {
        dispose = d;
        const ref = directive();
        ref(div);
      });

      // Cleanup errors should be caught
      expect(() => {
        dispose?.();
        dispose = undefined;
      }).not.toThrow();

      consoleError.mockRestore();
    });
  });
});
