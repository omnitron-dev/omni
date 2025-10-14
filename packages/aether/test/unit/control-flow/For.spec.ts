/**
 * Tests for For component
 */

import { describe, it, expect } from 'vitest';
import { For } from '../../../src/control-flow/For';
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

describe('For', () => {
  describe('Static lists', () => {
    it('should render items', () => {
      const result = For({
        each: [1, 2, 3],
        children: (item: number) => jsx('div', { children: String(item * 2) }),
      });
      const { container } = render(result);

      const list = container.querySelector('[data-for-list]') as HTMLElement;
      expect(list).toBeTruthy();
      expect(list.children.length).toBe(3);
      expect(list.children[0].textContent).toBe('2');
      expect(list.children[1].textContent).toBe('4');
      expect(list.children[2].textContent).toBe('6');
    });

    it('should pass index to children', () => {
      const result = For({
        each: ['a', 'b', 'c'],
        children: (item: string, index: number) => jsx('div', { children: `${index}: ${item}` }),
      });
      const { container } = render(result);

      const list = container.querySelector('[data-for-list]') as HTMLElement;
      expect(list.children[0].textContent).toBe('0: a');
      expect(list.children[1].textContent).toBe('1: b');
      expect(list.children[2].textContent).toBe('2: c');
    });

    it('should render fallback for empty array', () => {
      const result = For({
        each: [],
        fallback: 'No items',
        children: (item: number) => jsx('div', { children: String(item) }),
      });
      const { container } = render(result);

      const list = container.querySelector('[data-for-list]') as HTMLElement;
      const fallback = container.querySelector('[data-for-fallback]') as HTMLElement;

      expect(list.style.display).toBe('none');
      expect(fallback.style.display).toBe('contents');
      expect(fallback.textContent).toBe('No items');
    });

    it('should render fallback for undefined', () => {
      const result = For({
        each: undefined,
        fallback: 'No items',
        children: (item: number) => jsx('div', { children: String(item) }),
      });
      const { container } = render(result);

      const fallback = container.querySelector('[data-for-fallback]') as HTMLElement;
      expect(fallback.textContent).toBe('No items');
      expect(fallback.style.display).toBe('contents');
    });

    it('should render fallback for null', () => {
      const result = For({
        each: null,
        fallback: 'No items',
        children: (item: number) => jsx('div', { children: String(item) }),
      });
      const { container } = render(result);

      const fallback = container.querySelector('[data-for-fallback]') as HTMLElement;
      expect(fallback.textContent).toBe('No items');
      expect(fallback.style.display).toBe('contents');
    });

    it('should hide both when empty and no fallback', () => {
      const result = For({
        each: [],
        children: (item: number) => jsx('div', { children: String(item) }),
      });
      const { container } = render(result);

      const list = container.querySelector('[data-for-list]') as HTMLElement;
      const fallback = container.querySelector('[data-for-fallback]') as HTMLElement;

      expect(list.style.display).toBe('none');
      expect(fallback.style.display).toBe('none');
    });

    it('should handle complex objects', () => {
      interface Todo {
        id: number;
        text: string;
        done: boolean;
      }

      const todos: Todo[] = [
        { id: 1, text: 'Learn Aether', done: false },
        { id: 2, text: 'Build app', done: true },
      ];

      const result = For({
        each: todos,
        children: (todo: Todo) =>
          jsx('div', {
            'data-id': String(todo.id),
            children: todo.text,
          }),
      });
      const { container } = render(result);

      const list = container.querySelector('[data-for-list]') as HTMLElement;
      expect(list.children.length).toBe(2);

      const firstItem = list.children[0].querySelector('[data-id="1"]');
      expect(firstItem?.textContent).toBe('Learn Aether');

      const secondItem = list.children[1].querySelector('[data-id="2"]');
      expect(secondItem?.textContent).toBe('Build app');
    });
  });

  describe('Dynamic lists (signals)', () => {
    it('should update when items are added', () => {
      const items = signal<number[]>([1, 2]);
      const result = For({
        each: () => items(),
        children: (item: number) => jsx('div', { children: String(item) }),
      });
      const { container } = render(result);

      const forContainer = container.querySelector('[data-for-container]') as HTMLElement;
      const list = container.querySelector('[data-for-list]') as HTMLElement;

      // Initially 2 items
      expect(list.children.length).toBe(2);
      expect(forContainer.getAttribute('data-for-count')).toBe('2');

      // Add item
      items.set([1, 2, 3]);

      // Should now have 3 items
      expect(list.children.length).toBe(3);
      expect(list.children[2].textContent).toBe('3');
      expect(forContainer.getAttribute('data-for-count')).toBe('3');
    });

    it('should update when items are removed', () => {
      const items = signal<number[]>([1, 2, 3]);
      const result = For({
        each: () => items(),
        children: (item: number) => jsx('div', { children: String(item) }),
      });
      const { container } = render(result);

      const forContainer = container.querySelector('[data-for-container]') as HTMLElement;
      const list = container.querySelector('[data-for-list]') as HTMLElement;

      // Initially 3 items
      expect(list.children.length).toBe(3);

      // Remove last item
      items.set([1, 2]);

      // Should now have 2 items
      expect(list.children.length).toBe(2);
      expect(forContainer.getAttribute('data-for-count')).toBe('2');
    });

    it('should update when items are replaced', () => {
      const items = signal<string[]>(['a', 'b', 'c']);
      const result = For({
        each: () => items(),
        children: (item: string) => jsx('div', { children: item.toUpperCase() }),
      });
      const { container } = render(result);

      const list = container.querySelector('[data-for-list]') as HTMLElement;

      // Initially
      expect(list.children[0].textContent).toBe('A');
      expect(list.children[1].textContent).toBe('B');
      expect(list.children[2].textContent).toBe('C');

      // Replace items
      items.set(['x', 'y']);

      // Should update
      expect(list.children.length).toBe(2);
      expect(list.children[0].textContent).toBe('X');
      expect(list.children[1].textContent).toBe('Y');
    });

    it('should toggle between empty and non-empty', () => {
      const items = signal<number[]>([]);
      const result = For({
        each: () => items(),
        fallback: 'No items',
        children: (item: number) => jsx('div', { children: String(item) }),
      });
      const { container } = render(result);

      const list = container.querySelector('[data-for-list]') as HTMLElement;
      const fallback = container.querySelector('[data-for-fallback]') as HTMLElement;

      // Initially empty
      expect(list.style.display).toBe('none');
      expect(fallback.style.display).toBe('contents');
      expect(fallback.textContent).toBe('No items');

      // Add items
      items.set([1, 2, 3]);

      // Should show list
      expect(list.style.display).toBe('contents');
      expect(fallback.style.display).toBe('none');
      expect(list.children.length).toBe(3);

      // Clear items
      items.set([]);

      // Should show fallback again
      expect(list.style.display).toBe('none');
      expect(fallback.style.display).toBe('contents');
    });

    it('should handle null/undefined transitions', () => {
      const items = signal<number[] | null>(null);
      const result = For({
        each: () => items(),
        fallback: 'No items',
        children: (item: number) => jsx('div', { children: String(item) }),
      });
      const { container } = render(result);

      const list = container.querySelector('[data-for-list]') as HTMLElement;
      const fallback = container.querySelector('[data-for-fallback]') as HTMLElement;

      // Initially null
      expect(fallback.style.display).toBe('contents');

      // Set to array
      items.set([1, 2]);

      // Should show items
      expect(list.style.display).toBe('contents');
      expect(fallback.style.display).toBe('none');
      expect(list.children.length).toBe(2);

      // Set to null again
      items.set(null);

      // Should show fallback
      expect(list.style.display).toBe('none');
      expect(fallback.style.display).toBe('contents');
    });

    it('should maintain item order when reordering', () => {
      const items = signal(['a', 'b', 'c']);
      const result = For({
        each: () => items(),
        children: (item: string) => jsx('div', { 'data-value': item, children: item }),
      });
      const { container } = render(result);

      const list = container.querySelector('[data-for-list]') as HTMLElement;

      // Initial order
      expect(list.children[0].querySelector('[data-value]')?.getAttribute('data-value')).toBe('a');
      expect(list.children[1].querySelector('[data-value]')?.getAttribute('data-value')).toBe('b');
      expect(list.children[2].querySelector('[data-value]')?.getAttribute('data-value')).toBe('c');

      // Reorder
      items.set(['c', 'a', 'b']);

      // Should update order
      expect(list.children[0].querySelector('[data-value]')?.getAttribute('data-value')).toBe('c');
      expect(list.children[1].querySelector('[data-value]')?.getAttribute('data-value')).toBe('a');
      expect(list.children[2].querySelector('[data-value]')?.getAttribute('data-value')).toBe('b');
    });
  });

  describe('Nested For components', () => {
    it('should handle nested For loops', () => {
      const matrix = signal([
        [1, 2],
        [3, 4],
      ]);

      const result = For({
        each: () => matrix(),
        children: (row: number[]) =>
          For({
            each: row,
            children: (cell: number) => jsx('span', { children: String(cell) }),
          }),
      });
      const { container } = render(result);

      const outerList = container.querySelector('[data-for-list]') as HTMLElement;
      expect(outerList.children.length).toBe(2);

      // Check first row
      const firstRow = outerList.children[0].querySelector('[data-for-list]') as HTMLElement;
      expect(firstRow.children.length).toBe(2);
      expect(firstRow.children[0].textContent).toBe('1');
      expect(firstRow.children[1].textContent).toBe('2');

      // Check second row
      const secondRow = outerList.children[1].querySelector('[data-for-list]') as HTMLElement;
      expect(secondRow.children.length).toBe(2);
      expect(secondRow.children[0].textContent).toBe('3');
      expect(secondRow.children[1].textContent).toBe('4');

      // Update matrix
      matrix.set([[5]]);

      // Should update
      expect(outerList.children.length).toBe(1);
      const newRow = outerList.children[0].querySelector('[data-for-list]') as HTMLElement;
      expect(newRow.children.length).toBe(1);
      expect(newRow.children[0].textContent).toBe('5');
    });
  });

  describe('Edge cases', () => {
    it('should handle large lists', () => {
      const items = Array.from({ length: 1000 }, (_, i) => i);
      const result = For({
        each: items,
        children: (item: number) => jsx('div', { children: String(item) }),
      });
      const { container } = render(result);

      const forContainer = container.querySelector('[data-for-container]') as HTMLElement;
      const list = container.querySelector('[data-for-list]') as HTMLElement;
      expect(list.children.length).toBe(1000);
      expect(forContainer.getAttribute('data-for-count')).toBe('1000');
    });

    it('should handle items that render null', () => {
      const result = For({
        each: [1, 2, 3],
        children: (item: number) => (item === 2 ? null : jsx('div', { children: String(item) })),
      });
      const { container } = render(result);

      const list = container.querySelector('[data-for-list]') as HTMLElement;
      // All 3 wrappers exist but one is empty
      expect(list.children.length).toBe(3);
      expect(list.children[0].textContent).toBe('1');
      expect(list.children[1].textContent).toBe(''); // null rendered as empty
      expect(list.children[2].textContent).toBe('3');
    });

    it('should handle text node children', () => {
      const result = For({
        each: ['hello', 'world'],
        children: (item: string) => item, // Returns string directly
      });
      const { container } = render(result);

      const list = container.querySelector('[data-for-list]') as HTMLElement;
      expect(list.children.length).toBe(2);
      expect(list.children[0].textContent).toBe('hello');
      expect(list.children[1].textContent).toBe('world');
    });

    it('should handle DOM element fallback', () => {
      const fallbackEl = jsx('div', { className: 'empty', children: 'Empty list' });
      const result = For({
        each: [],
        fallback: fallbackEl,
        children: (item: number) => jsx('div', { children: String(item) }),
      });
      const { container } = render(result);

      const fallback = container.querySelector('[data-for-fallback]') as HTMLElement;
      expect(fallback.querySelector('.empty')?.textContent).toBe('Empty list');
    });
  });
});
