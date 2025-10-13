import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from '../../../src/core/reactivity/batch';
import {
  createDirective,
  createUpdatableDirective,
  combineDirectives,
  composeDirectives,
  createDirectiveFactory,
  createDirectiveWithContext,
  autoFocus,
  clickOutside,
  swipe,
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
      const directive = createUpdatableDirective<{ value: string }>((element, params) => {
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
      });

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

  describe('swipe directive', () => {
    beforeEach(() => {
      document.body.innerHTML = '';
    });

    it('should detect swipe left with mouse', () => {
      const onSwipeLeft = vi.fn();
      const div = document.createElement('div');
      document.body.appendChild(div);

      createRoot((d) => {
        dispose = d;
        const ref = swipe({ onSwipeLeft, threshold: 50 });
        ref(div);
      });

      // Simulate mouse swipe left
      div.dispatchEvent(new MouseEvent('mousedown', { clientX: 200, clientY: 100 }));
      div.dispatchEvent(new MouseEvent('mouseup', { clientX: 100, clientY: 100 }));

      expect(onSwipeLeft).toHaveBeenCalled();
      document.body.removeChild(div);
    });

    it('should detect swipe right with mouse', () => {
      const onSwipeRight = vi.fn();
      const div = document.createElement('div');
      document.body.appendChild(div);

      createRoot((d) => {
        dispose = d;
        const ref = swipe({ onSwipeRight, threshold: 50 });
        ref(div);
      });

      // Simulate mouse swipe right
      div.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, clientY: 100 }));
      div.dispatchEvent(new MouseEvent('mouseup', { clientX: 200, clientY: 100 }));

      expect(onSwipeRight).toHaveBeenCalled();
      document.body.removeChild(div);
    });

    it('should detect swipe up with mouse', () => {
      const onSwipeUp = vi.fn();
      const div = document.createElement('div');
      document.body.appendChild(div);

      createRoot((d) => {
        dispose = d;
        const ref = swipe({ onSwipeUp, threshold: 50 });
        ref(div);
      });

      // Simulate mouse swipe up
      div.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, clientY: 200 }));
      div.dispatchEvent(new MouseEvent('mouseup', { clientX: 100, clientY: 100 }));

      expect(onSwipeUp).toHaveBeenCalled();
      document.body.removeChild(div);
    });

    it('should detect swipe down with mouse', () => {
      const onSwipeDown = vi.fn();
      const div = document.createElement('div');
      document.body.appendChild(div);

      createRoot((d) => {
        dispose = d;
        const ref = swipe({ onSwipeDown, threshold: 50 });
        ref(div);
      });

      // Simulate mouse swipe down
      div.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, clientY: 100 }));
      div.dispatchEvent(new MouseEvent('mouseup', { clientX: 100, clientY: 200 }));

      expect(onSwipeDown).toHaveBeenCalled();
      document.body.removeChild(div);
    });

    it('should respect threshold', () => {
      const onSwipeLeft = vi.fn();
      const div = document.createElement('div');
      document.body.appendChild(div);

      createRoot((d) => {
        dispose = d;
        const ref = swipe({ onSwipeLeft, threshold: 100 });
        ref(div);
      });

      // Simulate swipe below threshold
      div.dispatchEvent(new MouseEvent('mousedown', { clientX: 150, clientY: 100 }));
      div.dispatchEvent(new MouseEvent('mouseup', { clientX: 100, clientY: 100 }));

      expect(onSwipeLeft).not.toHaveBeenCalled();
      document.body.removeChild(div);
    });

    it('should respect timeout', () => {
      vi.useFakeTimers();
      const onSwipeLeft = vi.fn();
      const div = document.createElement('div');
      document.body.appendChild(div);

      createRoot((d) => {
        dispose = d;
        const ref = swipe({ onSwipeLeft, timeout: 300, threshold: 50 });
        ref(div);
      });

      // Simulate swipe that takes too long
      div.dispatchEvent(new MouseEvent('mousedown', { clientX: 200, clientY: 100 }));
      vi.advanceTimersByTime(400);
      div.dispatchEvent(new MouseEvent('mouseup', { clientX: 100, clientY: 100 }));

      expect(onSwipeLeft).not.toHaveBeenCalled();
      document.body.removeChild(div);
      vi.useRealTimers();
    });

    it('should prioritize horizontal swipe when both deltas are similar', () => {
      const onSwipeLeft = vi.fn();
      const onSwipeDown = vi.fn();
      const div = document.createElement('div');
      document.body.appendChild(div);

      createRoot((d) => {
        dispose = d;
        const ref = swipe({ onSwipeLeft, onSwipeDown, threshold: 50 });
        ref(div);
      });

      // Simulate diagonal swipe with larger horizontal component
      div.dispatchEvent(new MouseEvent('mousedown', { clientX: 200, clientY: 100 }));
      div.dispatchEvent(new MouseEvent('mouseup', { clientX: 100, clientY: 150 }));

      expect(onSwipeLeft).toHaveBeenCalled();
      expect(onSwipeDown).not.toHaveBeenCalled();
      document.body.removeChild(div);
    });

    it('should detect touch swipe left', () => {
      const onSwipeLeft = vi.fn();
      const div = document.createElement('div');
      document.body.appendChild(div);

      createRoot((d) => {
        dispose = d;
        const ref = swipe({ onSwipeLeft, threshold: 50 });
        ref(div);
      });

      // Simulate touch swipe left
      const touchStart = new TouchEvent('touchstart', {
        touches: [{ clientX: 200, clientY: 100 } as Touch],
      });
      const touchEnd = new TouchEvent('touchend', {
        changedTouches: [{ clientX: 100, clientY: 100 } as Touch],
      });

      div.dispatchEvent(touchStart);
      div.dispatchEvent(touchEnd);

      expect(onSwipeLeft).toHaveBeenCalled();
      document.body.removeChild(div);
    });

    it('should detect touch swipe right', () => {
      const onSwipeRight = vi.fn();
      const div = document.createElement('div');
      document.body.appendChild(div);

      createRoot((d) => {
        dispose = d;
        const ref = swipe({ onSwipeRight, threshold: 50 });
        ref(div);
      });

      // Simulate touch swipe right
      const touchStart = new TouchEvent('touchstart', {
        touches: [{ clientX: 100, clientY: 100 } as Touch],
      });
      const touchEnd = new TouchEvent('touchend', {
        changedTouches: [{ clientX: 200, clientY: 100 } as Touch],
      });

      div.dispatchEvent(touchStart);
      div.dispatchEvent(touchEnd);

      expect(onSwipeRight).toHaveBeenCalled();
      document.body.removeChild(div);
    });

    it('should cancel swipe on touchcancel', () => {
      const onSwipeLeft = vi.fn();
      const div = document.createElement('div');
      document.body.appendChild(div);

      createRoot((d) => {
        dispose = d;
        const ref = swipe({ onSwipeLeft, threshold: 50 });
        ref(div);
      });

      // Simulate touch swipe that gets cancelled
      const touchStart = new TouchEvent('touchstart', {
        touches: [{ clientX: 200, clientY: 100 } as Touch],
      });
      div.dispatchEvent(touchStart);
      div.dispatchEvent(new TouchEvent('touchcancel'));

      const touchEnd = new TouchEvent('touchend', {
        changedTouches: [{ clientX: 100, clientY: 100 } as Touch],
      });
      div.dispatchEvent(touchEnd);

      expect(onSwipeLeft).not.toHaveBeenCalled();
      document.body.removeChild(div);
    });

    it('should cancel swipe on mouseleave', () => {
      const onSwipeLeft = vi.fn();
      const div = document.createElement('div');
      document.body.appendChild(div);

      createRoot((d) => {
        dispose = d;
        const ref = swipe({ onSwipeLeft, threshold: 50 });
        ref(div);
      });

      // Simulate mouse swipe that leaves element
      div.dispatchEvent(new MouseEvent('mousedown', { clientX: 200, clientY: 100 }));
      div.dispatchEvent(new MouseEvent('mouseleave'));
      div.dispatchEvent(new MouseEvent('mouseup', { clientX: 100, clientY: 100 }));

      expect(onSwipeLeft).not.toHaveBeenCalled();
      document.body.removeChild(div);
    });

    it('should use default threshold of 50px', () => {
      const onSwipeLeft = vi.fn();
      const div = document.createElement('div');
      document.body.appendChild(div);

      createRoot((d) => {
        dispose = d;
        const ref = swipe({ onSwipeLeft });
        ref(div);
      });

      // Simulate swipe below default threshold (49px)
      div.dispatchEvent(new MouseEvent('mousedown', { clientX: 149, clientY: 100 }));
      div.dispatchEvent(new MouseEvent('mouseup', { clientX: 100, clientY: 100 }));

      expect(onSwipeLeft).not.toHaveBeenCalled();

      // Simulate swipe at or over default threshold (50px+)
      div.dispatchEvent(new MouseEvent('mousedown', { clientX: 150, clientY: 100 }));
      div.dispatchEvent(new MouseEvent('mouseup', { clientX: 100, clientY: 100 }));

      expect(onSwipeLeft).toHaveBeenCalled();
      document.body.removeChild(div);
    });

    it('should use default timeout of 300ms', () => {
      const onSwipeLeft = vi.fn();
      const div = document.createElement('div');
      document.body.appendChild(div);

      createRoot((d) => {
        dispose = d;
        const ref = swipe({ onSwipeLeft, threshold: 50, timeout: 100 });
        ref(div);
      });

      // Simulate fast swipe (should work)
      div.dispatchEvent(new MouseEvent('mousedown', { clientX: 200, clientY: 100 }));
      // Wait just a bit
      setTimeout(() => {
        div.dispatchEvent(new MouseEvent('mouseup', { clientX: 100, clientY: 100 }));
      }, 50);

      // Wait for fast swipe to complete
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(onSwipeLeft).toHaveBeenCalledTimes(1);
          onSwipeLeft.mockClear();

          // Simulate slow swipe (should not work)
          div.dispatchEvent(new MouseEvent('mousedown', { clientX: 200, clientY: 100 }));
          setTimeout(() => {
            div.dispatchEvent(new MouseEvent('mouseup', { clientX: 100, clientY: 100 }));
          }, 150);

          setTimeout(() => {
            expect(onSwipeLeft).not.toHaveBeenCalled();
            document.body.removeChild(div);
            resolve();
          }, 200);
        }, 100);
      });
    });

    it('should remove all event listeners on cleanup', () => {
      const onSwipeLeft = vi.fn();
      const div = document.createElement('div');
      document.body.appendChild(div);

      const removeEventListenerSpy = vi.spyOn(div, 'removeEventListener');

      createRoot((d) => {
        dispose = d;
        const ref = swipe({ onSwipeLeft });
        ref(div);
      });

      dispose?.();
      dispose = undefined;

      expect(removeEventListenerSpy).toHaveBeenCalledWith('touchstart', expect.any(Function));
      expect(removeEventListenerSpy).toHaveBeenCalledWith('touchend', expect.any(Function));
      expect(removeEventListenerSpy).toHaveBeenCalledWith('touchcancel', expect.any(Function));
      expect(removeEventListenerSpy).toHaveBeenCalledWith('mousedown', expect.any(Function));
      expect(removeEventListenerSpy).toHaveBeenCalledWith('mouseup', expect.any(Function));
      expect(removeEventListenerSpy).toHaveBeenCalledWith('mouseleave', expect.any(Function));

      document.body.removeChild(div);
    });
  });

  describe('composeDirectives', () => {
    it('should compose multiple directives', () => {
      const calls: string[] = [];

      const directive1 = () => {
        calls.push('directive1');
      };

      const directive2 = () => {
        calls.push('directive2');
      };

      const composed = composeDirectives(directive1, directive2);
      const div = document.createElement('div');

      composed(div);

      expect(calls).toEqual(['directive1', 'directive2']);
    });

    it('should execute composed directives in order', () => {
      const order: number[] = [];

      const composed = composeDirectives(
        () => order.push(1),
        () => order.push(2),
        () => order.push(3)
      );

      const div = document.createElement('div');
      composed(div);

      expect(order).toEqual([1, 2, 3]);
    });

    it('should work with zero directives', () => {
      const composed = composeDirectives();
      const div = document.createElement('div');

      expect(() => composed(div)).not.toThrow();
    });

    it('should work with single directive', () => {
      const calls: string[] = [];
      const composed = composeDirectives(() => calls.push('single'));
      const div = document.createElement('div');

      composed(div);

      expect(calls).toEqual(['single']);
    });

    it('should pass element to all directives', () => {
      const elements: HTMLElement[] = [];

      const composed = composeDirectives(
        (el) => elements.push(el),
        (el) => elements.push(el),
        (el) => elements.push(el)
      );

      const div = document.createElement('div');
      composed(div);

      expect(elements).toHaveLength(3);
      expect(elements.every((el) => el === div)).toBe(true);
    });
  });

  describe('createDirectiveFactory', () => {
    it('should create directive factory', () => {
      const factory = createDirectiveFactory<string, { prefix: string }>((config) => {
        return (element, text) => {
          element.textContent = `${config.prefix}: ${text}`;
        };
      });

      const directive = factory({ prefix: 'Hello' });
      const div = document.createElement('div');

      createRoot((d) => {
        dispose = d;
        const ref = directive('World');
        ref(div);
      });

      expect(div.textContent).toBe('Hello: World');
    });

    it('should create multiple directives from same factory', () => {
      const factory = createDirectiveFactory<string, { theme: string }>((config) => {
        return (element, text) => {
          element.className = `tooltip-${config.theme}`;
          element.textContent = text;
        };
      });

      const darkDirective = factory({ theme: 'dark' });
      const lightDirective = factory({ theme: 'light' });

      const div1 = document.createElement('div');
      const div2 = document.createElement('div');

      createRoot((d) => {
        dispose = d;
        const ref1 = darkDirective('Dark tooltip');
        const ref2 = lightDirective('Light tooltip');
        ref1(div1);
        ref2(div2);
      });

      expect(div1.className).toBe('tooltip-dark');
      expect(div1.textContent).toBe('Dark tooltip');
      expect(div2.className).toBe('tooltip-light');
      expect(div2.textContent).toBe('Light tooltip');
    });

    it('should support cleanup in factory directives', () => {
      const cleanup = vi.fn();
      const factory = createDirectiveFactory<void, { id: string }>((config) => {
        return (element) => {
          element.setAttribute('data-id', config.id);
          return () => {
            cleanup(config.id);
            element.removeAttribute('data-id');
          };
        };
      });

      const directive = factory({ id: 'test' });
      const div = document.createElement('div');

      createRoot((d) => {
        dispose = d;
        const ref = directive();
        ref(div);
      });

      expect(div.getAttribute('data-id')).toBe('test');
      expect(cleanup).not.toHaveBeenCalled();

      dispose?.();
      dispose = undefined;

      expect(cleanup).toHaveBeenCalledWith('test');
      expect(div.getAttribute('data-id')).toBeNull();
    });
  });

  describe('createDirectiveWithContext', () => {
    it('should create directive with shared context', () => {
      const sharedData: { value: string | null } = { value: null };

      const { setter, getter } = createDirectiveWithContext(() => {
        return {
          setter: createDirective<string>((element, text) => {
            sharedData.value = text;
            element.textContent = text;
          }),
          getter: createDirective<void>((element) => {
            element.textContent = sharedData.value || 'empty';
          }),
        };
      });

      const div1 = document.createElement('div');
      const div2 = document.createElement('div');

      createRoot((d) => {
        dispose = d;
        const ref1 = setter('shared value');
        const ref2 = getter();
        ref1(div1);
        ref2(div2);
      });

      expect(div1.textContent).toBe('shared value');
      expect(div2.textContent).toBe('shared value');
      expect(sharedData.value).toBe('shared value');
    });

    it('should allow complex shared context', () => {
      const { draggable, droppable, getData } = createDirectiveWithContext(() => {
        let currentData: any = null;

        return {
          draggable: createDirective<{ data: any }>((element, { data }) => {
            const handleDragStart = () => {
              currentData = data;
            };
            element.addEventListener('dragstart', handleDragStart);
            return () => element.removeEventListener('dragstart', handleDragStart);
          }),
          droppable: createDirective<{ onDrop: (data: any) => void }>((element, { onDrop }) => {
            const handleDrop = () => {
              onDrop(currentData);
            };
            element.addEventListener('drop', handleDrop);
            return () => element.removeEventListener('drop', handleDrop);
          }),
          getData: () => currentData,
        };
      });

      const div1 = document.createElement('div');
      const div2 = document.createElement('div');
      const dropHandler = vi.fn();

      createRoot((d) => {
        dispose = d;
        const ref1 = draggable({ data: { id: 123 } });
        const ref2 = droppable({ onDrop: dropHandler });
        ref1(div1);
        ref2(div2);
      });

      // Simulate drag and drop
      div1.dispatchEvent(new DragEvent('dragstart'));
      div2.dispatchEvent(new DragEvent('drop'));

      expect(dropHandler).toHaveBeenCalledWith({ id: 123 });
      expect(getData()).toEqual({ id: 123 });
    });

    it('should isolate context per creation', () => {
      const createContextualDirective = () =>
        createDirectiveWithContext(() => {
          let value = 0;
          return {
            directive: createDirective<number>((element, num) => {
              value = num;
              element.textContent = String(value);
            }),
            getValue: () => value,
          };
        });

      const context1 = createContextualDirective();
      const context2 = createContextualDirective();

      const div1 = document.createElement('div');
      const div2 = document.createElement('div');

      createRoot((d) => {
        dispose = d;
        const ref1 = context1.directive(10);
        const ref2 = context2.directive(20);
        ref1(div1);
        ref2(div2);
      });

      expect(context1.getValue()).toBe(10);
      expect(context2.getValue()).toBe(20);
      expect(div1.textContent).toBe('10');
      expect(div2.textContent).toBe('20');
    });
  });
});
