import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  prevent,
  stop,
  stopImmediate,
  preventStop,
  self,
  trusted,
  debounce,
  throttle,
  compose,
} from '../../../src/utils/events';

describe('Event Utilities', () => {
  describe('prevent', () => {
    it('should call preventDefault on event', () => {
      const handler = vi.fn();
      const event = new Event('click') as MouseEvent;
      const spy = vi.spyOn(event, 'preventDefault');

      const wrapped = prevent(handler);
      wrapped(event);

      expect(spy).toHaveBeenCalled();
      expect(handler).toHaveBeenCalledWith(event);
    });

    it('should pass event to handler', () => {
      const handler = vi.fn();
      const event = new MouseEvent('click');

      prevent(handler)(event);

      expect(handler).toHaveBeenCalledWith(event);
    });
  });

  describe('stop', () => {
    it('should call stopPropagation on event', () => {
      const handler = vi.fn();
      const event = new Event('click');
      const spy = vi.spyOn(event, 'stopPropagation');

      const wrapped = stop(handler);
      wrapped(event);

      expect(spy).toHaveBeenCalled();
      expect(handler).toHaveBeenCalledWith(event);
    });
  });

  describe('stopImmediate', () => {
    it('should call stopImmediatePropagation on event', () => {
      const handler = vi.fn();
      const event = new Event('click');
      const spy = vi.spyOn(event, 'stopImmediatePropagation');

      const wrapped = stopImmediate(handler);
      wrapped(event);

      expect(spy).toHaveBeenCalled();
      expect(handler).toHaveBeenCalledWith(event);
    });
  });

  describe('preventStop', () => {
    it('should call both preventDefault and stopPropagation', () => {
      const handler = vi.fn();
      const event = new Event('click');
      const preventSpy = vi.spyOn(event, 'preventDefault');
      const stopSpy = vi.spyOn(event, 'stopPropagation');

      const wrapped = preventStop(handler);
      wrapped(event);

      expect(preventSpy).toHaveBeenCalled();
      expect(stopSpy).toHaveBeenCalled();
      expect(handler).toHaveBeenCalledWith(event);
    });
  });

  describe('self', () => {
    it('should call handler only if target matches selector', () => {
      const handler = vi.fn();
      const button = document.createElement('button');
      button.className = 'test-btn';

      const event = new MouseEvent('click', { bubbles: true });
      Object.defineProperty(event, 'target', { value: button, enumerable: true });

      const wrapped = self('.test-btn', handler);
      wrapped(event);

      expect(handler).toHaveBeenCalledWith(event);
    });

    it('should not call handler if target does not match selector', () => {
      const handler = vi.fn();
      const div = document.createElement('div');

      const event = new MouseEvent('click', { bubbles: true });
      Object.defineProperty(event, 'target', { value: div, enumerable: true });

      const wrapped = self('.test-btn', handler);
      wrapped(event);

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('trusted', () => {
    it('should call handler only for trusted events', () => {
      const handler = vi.fn();
      const event = new MouseEvent('click');
      Object.defineProperty(event, 'isTrusted', { value: true, enumerable: true });

      const wrapped = trusted(handler);
      wrapped(event);

      expect(handler).toHaveBeenCalledWith(event);
    });

    it('should not call handler for untrusted events', () => {
      const handler = vi.fn();
      const event = new MouseEvent('click'); // Synthetic events are not trusted

      const wrapped = trusted(handler);
      wrapped(event);

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('debounce', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('should debounce handler calls', () => {
      const handler = vi.fn();
      const wrapped = debounce(handler, 100);

      const event1 = new MouseEvent('click');
      const event2 = new MouseEvent('click');
      const event3 = new MouseEvent('click');

      wrapped(event1);
      wrapped(event2);
      wrapped(event3);

      expect(handler).not.toHaveBeenCalled();

      vi.advanceTimersByTime(100);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(event3);

      vi.useRealTimers();
    });

    it('should reset timer on subsequent calls', () => {
      const handler = vi.fn();
      const wrapped = debounce(handler, 100);

      const event = new MouseEvent('click');

      wrapped(event);
      vi.advanceTimersByTime(50);
      wrapped(event);
      vi.advanceTimersByTime(50);

      expect(handler).not.toHaveBeenCalled();

      vi.advanceTimersByTime(50);

      expect(handler).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });
  });

  describe('throttle', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('should throttle handler calls', () => {
      const handler = vi.fn();
      const wrapped = throttle(handler, 100);

      const event1 = new MouseEvent('click');
      const event2 = new MouseEvent('click');

      wrapped(event1);
      expect(handler).toHaveBeenCalledTimes(1);

      wrapped(event2);
      expect(handler).toHaveBeenCalledTimes(1); // Throttled

      vi.advanceTimersByTime(100);

      wrapped(event2);
      expect(handler).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it('should call handler immediately on first call', () => {
      const handler = vi.fn();
      const wrapped = throttle(handler, 100);

      const event = new MouseEvent('click');
      wrapped(event);

      expect(handler).toHaveBeenCalledWith(event);

      vi.useRealTimers();
    });
  });

  describe('compose', () => {
    it('should compose multiple modifiers', () => {
      const handler = vi.fn();
      const event = new Event('click');
      const preventSpy = vi.spyOn(event, 'preventDefault');
      const stopSpy = vi.spyOn(event, 'stopPropagation');

      const composed = compose([prevent, stop]);
      const wrapped = composed(handler);

      wrapped(event);

      expect(preventSpy).toHaveBeenCalled();
      expect(stopSpy).toHaveBeenCalled();
      expect(handler).toHaveBeenCalledWith(event);
    });

    it('should apply modifiers in right-to-left order', () => {
      const calls: string[] = [];
      const modifier1 = <T extends Event>(h: (e: T) => void) => (e: T) => {
        calls.push('modifier1');
        h(e);
      };
      const modifier2 = <T extends Event>(h: (e: T) => void) => (e: T) => {
        calls.push('modifier2');
        h(e);
      };

      const handler = vi.fn(() => calls.push('handler'));
      const event = new Event('click');

      const composed = compose([modifier1, modifier2]);
      composed(handler)(event);

      expect(calls).toEqual(['modifier1', 'modifier2', 'handler']);
    });
  });
});
