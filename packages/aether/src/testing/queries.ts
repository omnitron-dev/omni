/**
 * DOM Query Utilities
 */

import type { Matcher, MatcherOptions } from './types.js';

export function createQueries(container: HTMLElement) {
  const matchText = (text: Matcher, content: string, element: Element): boolean => {
    if (typeof text === 'string') return content.includes(text);
    if (text instanceof RegExp) return text.test(content);
    if (typeof text === 'function') return text(content, element);
    return false;
  };

  const getByText = (text: Matcher, options?: MatcherOptions): HTMLElement => {
    const elements = Array.from(container.querySelectorAll('*'));
    const element = elements.find(el => matchText(text, el.textContent || '', el));
    if (!element) throw new Error(`Unable to find element with text: ${text}`);
    return element as HTMLElement;
  };

  const getByRole = (role: string): HTMLElement => {
    const element = container.querySelector(`[role="${role}"]`);
    if (!element) throw new Error(`Unable to find element with role: ${role}`);
    return element as HTMLElement;
  };

  const getByLabelText = (text: Matcher): HTMLElement => {
    const labels = Array.from(container.querySelectorAll('label'));
    const label = labels.find(l => matchText(text, l.textContent || '', l));
    if (!label) throw new Error(`Unable to find label with text: ${text}`);
    const forId = label.getAttribute('for');
    if (forId) {
      const element = container.querySelector(`#${forId}`);
      if (element) return element as HTMLElement;
    }
    throw new Error('Label found but no associated input');
  };

  const getByTestId = (id: Matcher): HTMLElement => {
    const selector = typeof id === 'string' ? `[data-testid="${id}"]` : '[data-testid]';
    const element = container.querySelector(selector);
    if (!element) throw new Error(`Unable to find element with testId: ${id}`);
    return element as HTMLElement;
  };

  return {
    getByText,
    getByRole,
    getByLabelText,
    getByTestId,
    queryByText: (text: Matcher) => {
      try { return getByText(text); } catch { return null; }
    },
    queryByRole: (role: string) => {
      try { return getByRole(role); } catch { return null; }
    },
    findByText: async (text: Matcher) => new Promise<HTMLElement>((resolve, reject) => {
        const element = getByText(text);
        if (element) resolve(element);
        else reject(new Error(`Unable to find element with text: ${text}`));
      }),
    findByRole: async (role: string) => new Promise<HTMLElement>((resolve, reject) => {
        const element = getByRole(role);
        if (element) resolve(element);
        else reject(new Error(`Unable to find element with role: ${role}`));
      }),
  };
}
