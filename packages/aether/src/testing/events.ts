/**
 * Event Simulation
 */
import type { FireEventOptions, ClickOptions } from './types.js';

export const fireEvent = Object.assign(
  (element: Element | null, event: Event) => element?.dispatchEvent(event) ?? false,
  {
    click: (element: Element | null, options?: ClickOptions) => {
      if (!element) return false;
      const evt = new MouseEvent('click', { bubbles: true, cancelable: true, ...options });
      return element.dispatchEvent(evt);
    },
    change: (element: Element, options?: FireEventOptions) => {
      // Set value on the element if provided
      if (options && 'target' in options && options.target && typeof options.target === 'object') {
        const targetOptions = options.target as any;
        if ('value' in targetOptions && element instanceof HTMLInputElement) {
          element.value = targetOptions.value;
        }
      }
      const evt = new Event('change', { bubbles: true });
      return element.dispatchEvent(evt);
    },
    input: (element: Element, options?: FireEventOptions) => {
      // Set value on the element if provided
      if (options && 'target' in options && options.target && typeof options.target === 'object') {
        const targetOptions = options.target as any;
        if ('value' in targetOptions && element instanceof HTMLInputElement) {
          element.value = targetOptions.value;
        }
        if ('checked' in targetOptions && (element instanceof HTMLInputElement)) {
          element.checked = targetOptions.checked;
        }
      }
      const evt = new Event('input', { bubbles: true });
      return element.dispatchEvent(evt);
    },
    submit: (element: Element) => {
      const evt = new Event('submit', { bubbles: true, cancelable: true });
      return element.dispatchEvent(evt);
    },
    focus: (element: HTMLElement) => element.focus(),
    blur: (element: HTMLElement) => element.blur(),
    keyDown: (element: Element, options?: KeyboardEventInit) => {
      const evt = new KeyboardEvent('keydown', { bubbles: true, ...options });
      return element.dispatchEvent(evt);
    },
    keyUp: (element: Element, options?: KeyboardEventInit) => {
      const evt = new KeyboardEvent('keyup', { bubbles: true, ...options });
      return element.dispatchEvent(evt);
    },
  }
);
