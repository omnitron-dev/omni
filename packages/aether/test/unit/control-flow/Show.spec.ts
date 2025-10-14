/**
 * Tests for Show component
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Show } from '../../../src/control-flow/Show';
import { signal } from '../../../src/core/reactivity/signal';
import { jsx } from '../../../src/jsx-runtime';

// Test helper to render components
function render(element: any): { container: HTMLElement } {
  const container = document.createElement('div');
  if (element) {
    if (Array.isArray(element)) {
      element.forEach((el) => container.appendChild(el));
    } else {
      container.appendChild(element);
    }
  }
  return { container };
}

describe('Show', () => {
  describe('Static conditions', () => {
    it('should render children when condition is truthy', () => {
      const result = Show({ when: true, children: 'Content' });
      const { container } = render(result);

      const content = container.querySelector('[data-show-content]') as HTMLElement;
      expect(content).toBeTruthy();
      expect(content.textContent).toBe('Content');
      expect(content.style.display).toBe('contents');

      const fallback = container.querySelector('[data-show-fallback]') as HTMLElement;
      expect(fallback.style.display).toBe('none');
    });

    it('should render fallback when condition is falsy', () => {
      const result = Show({ when: false, fallback: 'Fallback', children: 'Content' });
      const { container } = render(result);

      const content = container.querySelector('[data-show-content]') as HTMLElement;
      expect(content.style.display).toBe('none');

      const fallback = container.querySelector('[data-show-fallback]') as HTMLElement;
      expect(fallback).toBeTruthy();
      expect(fallback.textContent).toBe('Fallback');
      expect(fallback.style.display).toBe('contents');
    });

    it('should hide both when no fallback and condition is falsy', () => {
      const result = Show({ when: false, children: 'Content' });
      const { container } = render(result);

      const content = container.querySelector('[data-show-content]') as HTMLElement;
      expect(content.style.display).toBe('none');

      const fallback = container.querySelector('[data-show-fallback]') as HTMLElement;
      expect(fallback.style.display).toBe('none');
    });

    it('should handle function children', () => {
      const user = { name: 'John' };
      const result = Show({
        when: user,
        children: (u: any) => `Hello ${u.name}`,
      });
      const { container } = render(result);

      const content = container.querySelector('[data-show-content]') as HTMLElement;
      expect(content.textContent).toBe('Hello John');
      expect(content.style.display).toBe('contents');
    });

    it('should handle undefined/null conditions as falsy', () => {
      const resultUndefined = Show({ when: undefined, children: 'Content', fallback: 'Fallback' });
      const { container: containerUndefined } = render(resultUndefined);
      const fallbackUndefined = containerUndefined.querySelector('[data-show-fallback]') as HTMLElement;
      expect(fallbackUndefined.textContent).toBe('Fallback');
      expect(fallbackUndefined.style.display).toBe('contents');

      const resultNull = Show({ when: null, children: 'Content', fallback: 'Fallback' });
      const { container: containerNull } = render(resultNull);
      const fallbackNull = containerNull.querySelector('[data-show-fallback]') as HTMLElement;
      expect(fallbackNull.textContent).toBe('Fallback');
      expect(fallbackNull.style.display).toBe('contents');
    });

    it('should handle zero as falsy', () => {
      const result = Show({ when: 0, children: 'Content', fallback: 'Fallback' });
      const { container } = render(result);

      const fallback = container.querySelector('[data-show-fallback]') as HTMLElement;
      expect(fallback.textContent).toBe('Fallback');
      expect(fallback.style.display).toBe('contents');
    });

    it('should handle empty string as falsy', () => {
      const result = Show({ when: '', children: 'Content', fallback: 'Fallback' });
      const { container } = render(result);

      const fallback = container.querySelector('[data-show-fallback]') as HTMLElement;
      expect(fallback.textContent).toBe('Fallback');
      expect(fallback.style.display).toBe('contents');
    });

    it('should handle non-empty values as truthy', () => {
      const tests = [
        { when: 'text', expected: 'Content' },
        { when: 1, expected: 'Content' },
        { when: {}, expected: 'Content' },
        { when: [], expected: 'Content' },
      ];

      tests.forEach(({ when, expected }) => {
        const result = Show({ when, children: expected });
        const { container } = render(result);
        const content = container.querySelector('[data-show-content]') as HTMLElement;
        expect(content.textContent).toBe(expected);
        expect(content.style.display).toBe('contents');
      });
    });
  });

  describe('Dynamic conditions (signals)', () => {
    it('should update visibility when signal changes from false to true', () => {
      const isVisible = signal(false);
      const result = Show({
        when: () => isVisible(),
        children: 'Content',
        fallback: 'Fallback',
      });
      const { container } = render(result);

      // Initially should show fallback
      let content = container.querySelector('[data-show-content]') as HTMLElement;
      let fallback = container.querySelector('[data-show-fallback]') as HTMLElement;
      expect(content.style.display).toBe('none');
      expect(fallback.style.display).toBe('contents');
      expect(container.querySelector('[data-show-container]')?.getAttribute('data-show-state')).toBe('false');

      // Change signal to true
      isVisible.set(true);

      // Should now show content
      expect(content.style.display).toBe('contents');
      expect(fallback.style.display).toBe('none');
      expect(container.querySelector('[data-show-container]')?.getAttribute('data-show-state')).toBe('true');
    });

    it('should update visibility when signal changes from true to false', () => {
      const isVisible = signal(true);
      const result = Show({
        when: () => isVisible(),
        children: 'Content',
        fallback: 'Fallback',
      });
      const { container } = render(result);

      // Initially should show content
      let content = container.querySelector('[data-show-content]') as HTMLElement;
      let fallback = container.querySelector('[data-show-fallback]') as HTMLElement;
      expect(content.style.display).toBe('contents');
      expect(fallback.style.display).toBe('none');

      // Change signal to false
      isVisible.set(false);

      // Should now show fallback
      expect(content.style.display).toBe('none');
      expect(fallback.style.display).toBe('contents');
    });

    it('should handle multiple signal changes', () => {
      const isVisible = signal(false);
      const result = Show({
        when: () => isVisible(),
        children: 'Content',
      });
      const { container } = render(result);

      const content = container.querySelector('[data-show-content]') as HTMLElement;

      // Initial state - hidden
      expect(content.style.display).toBe('none');

      // Toggle multiple times
      isVisible.set(true);
      expect(content.style.display).toBe('contents');

      isVisible.set(false);
      expect(content.style.display).toBe('none');

      isVisible.set(true);
      expect(content.style.display).toBe('contents');
    });

    it('should update with computed signal conditions', () => {
      const count = signal(0);
      const result = Show({
        when: () => count() > 5,
        children: 'Count is greater than 5',
        fallback: 'Count is 5 or less',
      });
      const { container } = render(result);

      const content = container.querySelector('[data-show-content]') as HTMLElement;
      const fallback = container.querySelector('[data-show-fallback]') as HTMLElement;

      // Initially count is 0, should show fallback
      expect(content.style.display).toBe('none');
      expect(fallback.style.display).toBe('contents');

      // Increase count to 3, still show fallback
      count.set(3);
      expect(content.style.display).toBe('none');
      expect(fallback.style.display).toBe('contents');

      // Increase count to 6, should show content
      count.set(6);
      expect(content.style.display).toBe('contents');
      expect(fallback.style.display).toBe('none');

      // Decrease count to 5, should show fallback again
      count.set(5);
      expect(content.style.display).toBe('none');
      expect(fallback.style.display).toBe('contents');
    });

    it('should work with nested Show components', () => {
      const outer = signal(true);
      const inner = signal(true);

      const result = Show({
        when: () => outer(),
        children: Show({
          when: () => inner(),
          children: 'Inner content',
          fallback: 'Inner fallback',
        }),
        fallback: 'Outer fallback',
      });

      const { container } = render(result);

      // Initially both true, should show inner content
      let outerContent = container.querySelector('[data-show-content]') as HTMLElement;
      expect(outerContent.style.display).toBe('contents');

      let innerContainers = outerContent.querySelectorAll('[data-show-content]');
      let innerContent = innerContainers[0] as HTMLElement;
      expect(innerContent.textContent).toBe('Inner content');
      expect(innerContent.style.display).toBe('contents');

      // Hide inner
      inner.set(false);
      let innerFallback = outerContent.querySelector('[data-show-fallback]') as HTMLElement;
      expect(innerFallback.textContent).toBe('Inner fallback');
      expect(innerFallback.style.display).toBe('contents');

      // Hide outer
      outer.set(false);
      expect(outerContent.style.display).toBe('none');
      // Get the outer fallback - need to select from the outer container, not search all descendants
      let outerContainer = container.querySelector('[data-show-container]') as HTMLElement;
      let outerFallback = outerContainer.querySelector(':scope > [data-show-fallback]') as HTMLElement;
      expect(outerFallback.textContent).toBe('Outer fallback');
      expect(outerFallback.style.display).toBe('contents');
    });
  });

  describe('DOM elements handling', () => {
    it('should handle DOM element children', () => {
      const div = jsx('div', { children: 'Hello World' });
      const result = Show({ when: true, children: div });
      const { container } = render(result);

      const content = container.querySelector('[data-show-content]') as HTMLElement;
      expect(content.querySelector('div')?.textContent).toBe('Hello World');
    });

    it('should handle array of DOM elements', () => {
      const elements = [jsx('div', { children: 'First' }), jsx('span', { children: 'Second' })];
      const result = Show({ when: true, children: elements });
      const { container } = render(result);

      const content = container.querySelector('[data-show-content]') as HTMLElement;
      expect(content.querySelector('div')?.textContent).toBe('First');
      expect(content.querySelector('span')?.textContent).toBe('Second');
    });

    it('should handle DOM element fallback', () => {
      const fallbackEl = jsx('div', { children: 'Fallback content' });
      const result = Show({ when: false, children: 'Content', fallback: fallbackEl });
      const { container } = render(result);

      const fallback = container.querySelector('[data-show-fallback]') as HTMLElement;
      expect(fallback.querySelector('div')?.textContent).toBe('Fallback content');
      expect(fallback.style.display).toBe('contents');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty children gracefully', () => {
      const result = Show({ when: true, children: null });
      const { container } = render(result);

      const content = container.querySelector('[data-show-content]') as HTMLElement;
      expect(content).toBeTruthy();
      expect(content.textContent).toBe('');
    });

    it('should handle undefined children gracefully', () => {
      const result = Show({ when: true, children: undefined });
      const { container } = render(result);

      const content = container.querySelector('[data-show-content]') as HTMLElement;
      expect(content).toBeTruthy();
      expect(content.textContent).toBe('');
    });

    it('should always create container even with no content', () => {
      const result = Show({ when: false });
      const { container } = render(result);

      expect(container.querySelector('[data-show-container]')).toBeTruthy();
      expect(container.querySelector('[data-show-content]')).toBeTruthy();
      expect(container.querySelector('[data-show-fallback]')).toBeTruthy();
    });

    it('should preserve display:contents for layout neutrality', () => {
      const result = Show({ when: true, children: 'Content' });
      const { container } = render(result);

      const showContainer = container.querySelector('[data-show-container]') as HTMLElement;
      // Container should always use display:contents when visible
      expect(showContainer.style.display).toBe('contents');
    });
  });
});
