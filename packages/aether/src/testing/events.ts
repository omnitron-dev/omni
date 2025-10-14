/**
 * Event Simulation
 */
import type { FireEventOptions, ClickOptions } from './types.js';

export const fireEvent = Object.assign(
  (element: Element, event: Event) => element.dispatchEvent(event),
  {
    click: (element: Element, options?: ClickOptions) => {
      const evt = new MouseEvent('click', { bubbles: true, cancelable: true, ...options });
      return element.dispatchEvent(evt);
    },
    change: (element: Element, options?: FireEventOptions) => {
      const evt = new Event('change', { bubbles: true, ...options });
      return element.dispatchEvent(evt);
    },
    input: (element: Element, options?: FireEventOptions) => {
      const evt = new Event('input', { bubbles: true, ...options });
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
