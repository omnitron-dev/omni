/**
 * Custom Matchers for Vitest
 */
import { expect } from 'vitest';

expect.extend({
  toBeInTheDocument(received: HTMLElement) {
    const pass = document.body.contains(received);
    return {
      pass,
      message: () => (pass ? 'expected element not to be in the document' : 'expected element to be in the document'),
    };
  },

  toHaveTextContent(received: HTMLElement, expected: string) {
    const textContent = received.textContent || '';
    const pass = textContent.includes(expected);
    return {
      pass,
      message: () => (pass ? `expected element not to have text content` : `expected element to have text content`),
    };
  },

  toHaveAttribute(received: HTMLElement, attr: string, val?: string) {
    const hasAttr = received.hasAttribute(attr);
    const attrValue = received.getAttribute(attr);
    const pass = val !== undefined ? attrValue === val : hasAttr;
    return {
      pass,
      message: () => (pass ? `expected element not to have attribute` : `expected element to have attribute`),
    };
  },

  toHaveClass(received: HTMLElement, className: string) {
    const pass = received.classList.contains(className);
    return {
      pass,
      message: () => (pass ? 'expected element not to have class' : 'expected element to have class'),
    };
  },

  toBeVisible(received: HTMLElement) {
    const pass = received.offsetParent !== null;
    return {
      pass,
      message: () => (pass ? 'expected element not to be visible' : 'expected element to be visible'),
    };
  },

  toBeDisabled(received: HTMLElement) {
    const el = received as any;
    const pass = el.disabled === true;
    return {
      pass,
      message: () => (pass ? 'expected element not to be disabled' : 'expected element to be disabled'),
    };
  },

  toHaveValue(received: HTMLInputElement, expected: string) {
    const pass = received.value === expected;
    return {
      pass,
      message: () => (pass ? 'expected input not to have given value' : 'expected input to have given value'),
    };
  },

  toBeChecked(received: HTMLInputElement) {
    const pass = received.checked === true;
    return {
      pass,
      message: () => (pass ? 'expected checkbox/radio not to be checked' : 'expected checkbox/radio to be checked'),
    };
  },
});
