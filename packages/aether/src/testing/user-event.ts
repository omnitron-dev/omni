/**
 * User Event Simulation
 */
import type { TypeOptions, ClickOptions } from './types.js';
import { fireEvent } from './events.js';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const userEvent = {
  async type(element: Element, text: string, options: TypeOptions = {}) {
    const delayMs = options.delay || 0;
    for (const char of text) {
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        const input = element;
        input.value += char;
        fireEvent.input(input);
      }
      if (delayMs) await delay(delayMs);
    }
  },

  async click(element: Element, options?: ClickOptions) {
    fireEvent.click(element, options);
  },

  async dblClick(element: Element) {
    fireEvent.click(element);
    fireEvent.click(element);
  },

  async clear(element: Element) {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      const input = element;
      input.value = '';
      fireEvent.input(input);
    }
  },

  async selectOptions(element: Element, values: string | string[]) {
    if (element instanceof HTMLSelectElement) {
      const vals = Array.isArray(values) ? values : [values];
      Array.from(element.options).forEach((option) => {
        option.selected = vals.includes(option.value);
      });
      fireEvent.change(element);
    }
  },

  async upload(element: Element, files: File | File[]) {
    if (element instanceof HTMLInputElement && element.type === 'file') {
      const fileList = Array.isArray(files) ? files : [files];
      Object.defineProperty(element, 'files', { value: fileList, writable: false });
      fireEvent.change(element);
    }
  },

  async hover(element: Element) {
    const evt = new MouseEvent('mouseenter', { bubbles: true });
    element.dispatchEvent(evt);
  },

  async unhover(element: Element) {
    const evt = new MouseEvent('mouseleave', { bubbles: true });
    element.dispatchEvent(evt);
  },
};
