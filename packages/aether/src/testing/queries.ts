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
    // Find the most specific element (deepest in tree) that matches
    // Filter out elements that have child elements with the same text (to get leaf nodes)
    const element = elements.find(el => {
      if (!matchText(text, el.textContent || '', el)) return false;

      // Check if any child also has the same text (means this is a parent wrapper)
      const children = Array.from(el.children);
      const hasChildWithSameText = children.some(child =>
        matchText(text, child.textContent || '', child)
      );

      // Prefer elements without children that also match (leaf nodes)
      return !hasChildWithSameText;
    });
    if (!element) throw new Error(`Unable to find element with text: ${text}`);
    return element as HTMLElement;
  };

  const getByRole = (role: string): HTMLElement => {
    // First try explicit role attribute
    let element = container.querySelector(`[role="${role}"]`);

    // If not found, try implicit ARIA roles
    if (!element) {
      const implicitRoleSelectors: Record<string, string> = {
        button: 'button, [role="button"]',
        heading: 'h1, h2, h3, h4, h5, h6, [role="heading"]',
        link: 'a[href], [role="link"]',
        textbox: 'input[type="text"], input:not([type]), textarea, [role="textbox"]',
        checkbox: 'input[type="checkbox"], [role="checkbox"]',
        radio: 'input[type="radio"], [role="radio"]',
        list: 'ul, ol, [role="list"]',
        listitem: 'li, [role="listitem"]',
        img: 'img, [role="img"]',
        form: 'form, [role="form"]',
        navigation: 'nav, [role="navigation"]',
        main: 'main, [role="main"]',
        article: 'article, [role="article"]',
        region: 'section, [role="region"]',
      };

      const selector = implicitRoleSelectors[role];
      if (selector) {
        element = container.querySelector(selector);
      }
    }

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
