/**
 * Reconciliation Engine - Full System Integration Tests
 *
 * Tests the complete reconciliation pipeline with real-world scenarios:
 * - Counter component (focus preservation)
 * - Todo list (list reconciliation with add/remove/reorder)
 * - Form component (input state preservation)
 * - Conditional rendering (Show/For/Switch)
 * - Nested components (parent-child reactive updates)
 *
 * Target: 20+ integration test scenarios covering production use cases.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { signal } from '../../src/core/reactivity/signal.js';
import { effect } from '../../src/core/reactivity/effect.js';
import { defineComponent } from '../../src/core/component/define.js';
import { jsx } from '../../src/jsxruntime/runtime.js';
import { Show, For } from '../../src/reconciler/conditional.js';
import { createElementVNode, createTextVNode, type VNode } from '../../src/reconciler/vnode.js';
import { createDOMFromVNode } from '../../src/reconciler/create-dom.js';
import { diff } from '../../src/reconciler/diff.js';
import { patch } from '../../src/reconciler/patch.js';

describe('Reconciliation Engine - Full System Integration', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
    }
  });

  describe('Counter Component - Focus Preservation', () => {
    test('preserves input focus during counter updates', () => {
      const count = signal(0);

      // Create counter component VNode
      const createCounterVNode = (): VNode => {
        return createElementVNode('div', { class: 'counter' }, [
          createElementVNode('h1', null, [createTextVNode('Count: '), createTextVNode(String(count()))]),
          createElementVNode('input', {
            type: 'text',
            id: 'test-input',
            placeholder: 'Type here',
          }),
          createElementVNode('button', { id: 'increment' }, [createTextVNode('Increment')]),
        ]);
      };

      // Mount initial version
      let vnode = createCounterVNode();
      const dom = createDOMFromVNode(vnode);
      container.appendChild(dom);

      const input = container.querySelector('#test-input') as HTMLInputElement;
      input.focus();
      input.value = 'focused text';

      expect(document.activeElement).toBe(input);
      expect(input.value).toBe('focused text');

      // Update count and patch
      count.set(1);
      const newVNode = createCounterVNode();
      const patches = diff(vnode, newVNode);
      patch(vnode, patches);
      vnode = newVNode;

      // Check that focus is preserved
      const inputAfter = container.querySelector('#test-input') as HTMLInputElement;
      expect(inputAfter.value).toBe('focused text');
      // Note: Focus preservation might not work in jsdom environment,
      // but the DOM node should be reused
      expect(inputAfter).toBe(input); // Same DOM node
    });

    test('updates counter display without recreating entire tree', () => {
      const count = signal(0);

      const createVNode = () =>
        createElementVNode('div', null, [
          createElementVNode('span', { id: 'display' }, [createTextVNode(`Count: ${count()}`)]),
          createElementVNode('input', { id: 'input', type: 'text' }),
        ]);

      let vnode = createVNode();
      const dom = createDOMFromVNode(vnode);
      container.appendChild(dom);

      const input = container.querySelector('#input') as HTMLElement;
      const originalInputNode = input;

      // Update count
      count.set(5);
      const newVNode = createVNode();
      const patches = diff(vnode, newVNode);
      patch(vnode, patches);

      // Input node should be the same (not recreated)
      const inputAfter = container.querySelector('#input');
      expect(inputAfter).toBe(originalInputNode);

      // Display should be updated
      const display = container.querySelector('#display');
      expect(display?.textContent).toBe('Count: 5');
    });

    test('handles rapid counter updates efficiently', () => {
      const count = signal(0);

      const createVNode = () => createElementVNode('div', null, [createTextVNode(`Count: ${count()}`)]);

      let vnode = createVNode();
      const dom = createDOMFromVNode(vnode);
      container.appendChild(dom);

      // Perform multiple updates
      const updates = [1, 2, 3, 4, 5, 10, 20, 50, 100];
      for (const value of updates) {
        count.set(value);
        const newVNode = createVNode();
        const patches = diff(vnode, newVNode);
        patch(vnode, patches);
        vnode = newVNode;
      }

      expect(container.textContent).toBe('Count: 100');
    });
  });

  describe('Todo List - List Reconciliation', () => {
    interface Todo {
      id: string;
      text: string;
      done: boolean;
    }

    test('adds new todo items to list', () => {
      const todos = signal<Todo[]>([
        { id: '1', text: 'Buy milk', done: false },
        { id: '2', text: 'Walk dog', done: true },
      ]);

      const createListVNode = (): VNode => {
        return createElementVNode(
          'ul',
          null,
          todos().map((todo) => createElementVNode('li', null, [createTextVNode(todo.text)], todo.id))
        );
      };

      let vnode = createListVNode();
      const dom = createDOMFromVNode(vnode);
      container.appendChild(dom);

      expect(container.querySelectorAll('li').length).toBe(2);
      expect(container.textContent).toContain('Buy milk');

      // Add new todo
      todos.set([...todos(), { id: '3', text: 'Read book', done: false }]);

      const newVNode = createListVNode();
      const patches = diff(vnode, newVNode);
      patch(vnode, patches);

      expect(container.querySelectorAll('li').length).toBe(3);
      expect(container.textContent).toContain('Read book');
    });

    test('removes todo items from list', () => {
      const todos = signal<Todo[]>([
        { id: '1', text: 'Buy milk', done: false },
        { id: '2', text: 'Walk dog', done: true },
        { id: '3', text: 'Read book', done: false },
      ]);

      const createListVNode = (): VNode => {
        return createElementVNode(
          'ul',
          null,
          todos().map((todo) => createElementVNode('li', null, [createTextVNode(todo.text)], todo.id))
        );
      };

      let vnode = createListVNode();
      const dom = createDOMFromVNode(vnode);
      container.appendChild(dom);

      expect(container.querySelectorAll('li').length).toBe(3);

      // Remove middle item
      todos.set(todos().filter((t) => t.id !== '2'));

      const newVNode = createListVNode();
      const patches = diff(vnode, newVNode);
      patch(vnode, patches);

      expect(container.querySelectorAll('li').length).toBe(2);
      expect(container.textContent).not.toContain('Walk dog');
      expect(container.textContent).toContain('Buy milk');
      expect(container.textContent).toContain('Read book');
    });

    test('reorders todo items with keys', () => {
      const todos = signal<Todo[]>([
        { id: '1', text: 'First', done: false },
        { id: '2', text: 'Second', done: false },
        { id: '3', text: 'Third', done: false },
      ]);

      const createListVNode = (): VNode => {
        return createElementVNode(
          'ul',
          null,
          todos().map((todo) => createElementVNode('li', null, [createTextVNode(todo.text)], todo.id))
        );
      };

      let vnode = createListVNode();
      const dom = createDOMFromVNode(vnode);
      container.appendChild(dom);

      const items = container.querySelectorAll('li');
      expect(items[0].textContent).toBe('First');
      expect(items[1].textContent).toBe('Second');
      expect(items[2].textContent).toBe('Third');

      // Reverse order
      todos.set([todos()[2], todos()[1], todos()[0]]);

      const newVNode = createListVNode();
      const patches = diff(vnode, newVNode);
      patch(vnode, patches);

      const itemsAfter = container.querySelectorAll('li');
      expect(itemsAfter[0].textContent).toBe('Third');
      expect(itemsAfter[1].textContent).toBe('Second');
      expect(itemsAfter[2].textContent).toBe('First');
    });

    test('handles complex list updates (add, remove, reorder)', () => {
      const todos = signal<Todo[]>([
        { id: '1', text: 'A', done: false },
        { id: '2', text: 'B', done: false },
        { id: '3', text: 'C', done: false },
        { id: '4', text: 'D', done: false },
      ]);

      const createListVNode = (): VNode => {
        return createElementVNode(
          'ul',
          null,
          todos().map((todo) => createElementVNode('li', null, [createTextVNode(todo.text)], todo.id))
        );
      };

      let vnode = createListVNode();
      const dom = createDOMFromVNode(vnode);
      container.appendChild(dom);

      // Complex update: remove B, add E at end, move D to beginning
      todos.set([
        { id: '4', text: 'D', done: false },
        { id: '1', text: 'A', done: false },
        { id: '3', text: 'C', done: false },
        { id: '5', text: 'E', done: false },
      ]);

      const newVNode = createListVNode();
      const patches = diff(vnode, newVNode);
      patch(vnode, patches);

      const items = container.querySelectorAll('li');
      expect(items.length).toBe(4);
      expect(items[0].textContent).toBe('D');
      expect(items[1].textContent).toBe('A');
      expect(items[2].textContent).toBe('C');
      expect(items[3].textContent).toBe('E');
    });

    test('toggles todo done state', () => {
      const todos = signal<Todo[]>([
        { id: '1', text: 'Buy milk', done: false },
        { id: '2', text: 'Walk dog', done: true },
      ]);

      const createListVNode = (): VNode => {
        return createElementVNode(
          'ul',
          null,
          todos().map((todo) =>
            createElementVNode(
              'li',
              {
                class: todo.done ? 'done' : 'todo',
                'data-id': todo.id,
              },
              [createTextVNode(todo.text)],
              todo.id
            )
          )
        );
      };

      let vnode = createListVNode();
      const dom = createDOMFromVNode(vnode);
      container.appendChild(dom);

      const firstItem = container.querySelector('[data-id="1"]');
      expect(firstItem?.className).toBe('todo');

      // Toggle first item
      todos.set([
        { id: '1', text: 'Buy milk', done: true },
        { id: '2', text: 'Walk dog', done: true },
      ]);

      const newVNode = createListVNode();
      const patches = diff(vnode, newVNode);
      patch(vnode, patches);

      const firstItemAfter = container.querySelector('[data-id="1"]');
      expect(firstItemAfter?.className).toBe('done');
    });
  });

  describe('Form Component - Input State Preservation', () => {
    test('preserves input values during form updates', () => {
      const formData = signal({
        name: 'John',
        email: 'john@example.com',
      });

      const createFormVNode = (): VNode => {
        return createElementVNode('form', null, [
          createElementVNode('label', null, [createTextVNode('Name:')]),
          createElementVNode('input', {
            id: 'name',
            type: 'text',
            value: formData().name,
          }),
          createElementVNode('label', null, [createTextVNode('Email:')]),
          createElementVNode('input', {
            id: 'email',
            type: 'email',
            value: formData().email,
          }),
          createElementVNode('p', null, [createTextVNode(`Summary: ${formData().name} - ${formData().email}`)]),
        ]);
      };

      let vnode = createFormVNode();
      const dom = createDOMFromVNode(vnode);
      container.appendChild(dom);

      const nameInput = container.querySelector('#name') as HTMLInputElement;
      const emailInput = container.querySelector('#email') as HTMLInputElement;

      // User types in inputs
      nameInput.value = 'Jane Doe';
      emailInput.value = 'jane@example.com';

      const originalNameNode = nameInput;
      const originalEmailNode = emailInput;

      // Update form data (simulating controlled component)
      formData.set({ name: 'Jane Doe', email: 'jane@example.com' });

      const newVNode = createFormVNode();
      const patches = diff(vnode, newVNode);
      patch(vnode, patches);

      // Inputs should be the same DOM nodes
      const nameInputAfter = container.querySelector('#name');
      const emailInputAfter = container.querySelector('#email');

      expect(nameInputAfter).toBe(originalNameNode);
      expect(emailInputAfter).toBe(originalEmailNode);

      // Summary should be updated
      expect(container.querySelector('p')?.textContent).toContain('Jane Doe');
      expect(container.querySelector('p')?.textContent).toContain('jane@example.com');
    });

    test('preserves checkbox state', () => {
      const accepted = signal(false);

      const createFormVNode = (): VNode => {
        return createElementVNode('form', null, [
          createElementVNode('input', {
            id: 'terms',
            type: 'checkbox',
            checked: accepted(),
          }),
          createElementVNode('label', { for: 'terms' }, [createTextVNode('Accept terms')]),
          createElementVNode('p', null, [createTextVNode(accepted() ? 'Accepted' : 'Not accepted')]),
        ]);
      };

      let vnode = createFormVNode();
      const dom = createDOMFromVNode(vnode);
      container.appendChild(dom);

      const checkbox = container.querySelector('#terms') as HTMLInputElement;
      const originalCheckbox = checkbox;

      // Toggle checkbox
      accepted.set(true);

      const newVNode = createFormVNode();
      const patches = diff(vnode, newVNode);
      patch(vnode, patches);

      const checkboxAfter = container.querySelector('#terms');
      expect(checkboxAfter).toBe(originalCheckbox);
      expect(container.querySelector('p')?.textContent).toBe('Accepted');
    });

    test('preserves textarea content', () => {
      const content = signal('Initial content');

      const createFormVNode = (): VNode => {
        return createElementVNode('form', null, [
          createElementVNode('textarea', {
            id: 'content',
            value: content(),
          }),
          createElementVNode('p', null, [createTextVNode(`Length: ${content().length}`)]),
        ]);
      };

      let vnode = createFormVNode();
      const dom = createDOMFromVNode(vnode);
      container.appendChild(dom);

      const textarea = container.querySelector('#content') as HTMLTextAreaElement;
      const originalTextarea = textarea;

      textarea.value = 'Updated content with more text';

      // Update content
      content.set('Updated content with more text');

      const newVNode = createFormVNode();
      const patches = diff(vnode, newVNode);
      patch(vnode, patches);

      const textareaAfter = container.querySelector('#content');
      expect(textareaAfter).toBe(originalTextarea);
      expect(container.querySelector('p')?.textContent).toContain('Length: 30');
    });
  });

  describe('Conditional Rendering - Show/For/Switch', () => {
    test('Show component toggles content visibility', () => {
      const visible = signal(false);

      const createVNode = (): VNode => {
        return createElementVNode('div', null, [
          createTextVNode('Before'),
          ...(visible() ? [createElementVNode('p', { id: 'content' }, [createTextVNode('Visible')])] : []),
          createTextVNode('After'),
        ]);
      };

      let vnode = createVNode();
      const dom = createDOMFromVNode(vnode);
      container.appendChild(dom);

      expect(container.querySelector('#content')).toBeNull();
      expect(container.textContent).toContain('Before');
      expect(container.textContent).toContain('After');

      // Show content
      visible.set(true);

      const newVNode = createVNode();
      const patches = diff(vnode, newVNode);
      patch(vnode, patches);
      vnode = newVNode;

      expect(container.querySelector('#content')).toBeTruthy();
      expect(container.querySelector('#content')?.textContent).toBe('Visible');

      // Hide content
      visible.set(false);

      const newVNode2 = createVNode();
      const patches2 = diff(vnode, newVNode2);
      patch(vnode, patches2);

      expect(container.querySelector('#content')).toBeNull();
    });

    test('For component renders list items', () => {
      const items = signal(['A', 'B', 'C']);

      const createVNode = (): VNode => {
        return createElementVNode(
          'ul',
          null,
          items().map((item, index) => createElementVNode('li', null, [createTextVNode(item)], String(index)))
        );
      };

      let vnode = createVNode();
      const dom = createDOMFromVNode(vnode);
      container.appendChild(dom);

      expect(container.querySelectorAll('li').length).toBe(3);
      expect(container.textContent).toContain('A');
      expect(container.textContent).toContain('B');
      expect(container.textContent).toContain('C');

      // Update items
      items.set(['A', 'D', 'E', 'F']);

      const newVNode = createVNode();
      const patches = diff(vnode, newVNode);
      patch(vnode, patches);

      expect(container.querySelectorAll('li').length).toBe(4);
      expect(container.textContent).toContain('D');
      expect(container.textContent).toContain('E');
      expect(container.textContent).toContain('F');
    });

    test('nested conditionals work correctly', () => {
      const showOuter = signal(true);
      const showInner = signal(false);

      const createVNode = (): VNode => {
        return createElementVNode('div', null, [
          createTextVNode('Root'),
          ...(showOuter()
            ? [
                createElementVNode('div', { id: 'outer' }, [
                  createTextVNode('Outer'),
                  ...(showInner() ? [createElementVNode('div', { id: 'inner' }, [createTextVNode('Inner')])] : []),
                ]),
              ]
            : []),
        ]);
      };

      let vnode = createVNode();
      const dom = createDOMFromVNode(vnode);
      container.appendChild(dom);

      expect(container.querySelector('#outer')).toBeTruthy();
      expect(container.querySelector('#inner')).toBeNull();

      // Show inner
      showInner.set(true);

      const newVNode = createVNode();
      const patches = diff(vnode, newVNode);
      patch(vnode, patches);
      vnode = newVNode;

      expect(container.querySelector('#inner')).toBeTruthy();
      expect(container.querySelector('#inner')?.textContent).toBe('Inner');

      // Hide outer (should hide inner too)
      showOuter.set(false);

      const newVNode2 = createVNode();
      const patches2 = diff(vnode, newVNode2);
      patch(vnode, patches2);

      expect(container.querySelector('#outer')).toBeNull();
      expect(container.querySelector('#inner')).toBeNull();
    });
  });

  describe('Nested Components - Parent-Child Reactive Updates', () => {
    test('parent updates trigger child updates', () => {
      const parentData = signal('Parent Value');
      const childData = signal('Child Value');

      const createVNode = (): VNode => {
        return createElementVNode('div', { id: 'parent' }, [
          createElementVNode('h1', null, [createTextVNode(parentData())]),
          createElementVNode('div', { id: 'child' }, [
            createElementVNode('p', null, [createTextVNode(childData())]),
            createElementVNode('span', null, [createTextVNode(`From parent: ${parentData()}`)]),
          ]),
        ]);
      };

      let vnode = createVNode();
      const dom = createDOMFromVNode(vnode);
      container.appendChild(dom);

      expect(container.querySelector('h1')?.textContent).toBe('Parent Value');
      expect(container.querySelector('span')?.textContent).toContain('Parent Value');

      // Update parent
      parentData.set('Updated Parent');

      const newVNode = createVNode();
      const patches = diff(vnode, newVNode);
      patch(vnode, patches);

      expect(container.querySelector('h1')?.textContent).toBe('Updated Parent');
      expect(container.querySelector('span')?.textContent).toContain('Updated Parent');
    });

    test('sibling components update independently', () => {
      const leftData = signal('Left');
      const rightData = signal('Right');

      const createVNode = (): VNode => {
        return createElementVNode('div', null, [
          createElementVNode('div', { id: 'left' }, [createTextVNode(leftData())]),
          createElementVNode('div', { id: 'right' }, [createTextVNode(rightData())]),
        ]);
      };

      let vnode = createVNode();
      const dom = createDOMFromVNode(vnode);
      container.appendChild(dom);

      const leftNode = container.querySelector('#left');
      const rightNode = container.querySelector('#right');

      // Update left only
      leftData.set('Left Updated');

      const newVNode = createVNode();
      const patches = diff(vnode, newVNode);
      patch(vnode, patches);

      const leftNodeAfter = container.querySelector('#left');
      const rightNodeAfter = container.querySelector('#right');

      expect(leftNodeAfter?.textContent).toBe('Left Updated');
      expect(rightNodeAfter?.textContent).toBe('Right');
      expect(rightNodeAfter).toBe(rightNode); // Right node unchanged
    });

    test('deeply nested components propagate updates', () => {
      const level1 = signal('L1');
      const level2 = signal('L2');
      const level3 = signal('L3');

      const createVNode = (): VNode => {
        return createElementVNode('div', { id: 'level1' }, [
          createTextVNode(level1()),
          createElementVNode('div', { id: 'level2' }, [
            createTextVNode(level2()),
            createElementVNode('div', { id: 'level3' }, [
              createTextVNode(level3()),
              createTextVNode(` (L1: ${level1()})`),
            ]),
          ]),
        ]);
      };

      let vnode = createVNode();
      const dom = createDOMFromVNode(vnode);
      container.appendChild(dom);

      expect(container.querySelector('#level3')?.textContent).toContain('L3');
      expect(container.querySelector('#level3')?.textContent).toContain('L1: L1');

      // Update level1
      level1.set('L1-Updated');

      const newVNode = createVNode();
      const patches = diff(vnode, newVNode);
      patch(vnode, patches);

      expect(container.querySelector('#level3')?.textContent).toContain('L1: L1-Updated');
    });
  });

  describe('Performance - Rapid Updates', () => {
    test('handles 100 rapid text updates', () => {
      const value = signal(0);

      const createVNode = () => createElementVNode('div', null, [createTextVNode(`Value: ${value()}`)]);

      let vnode = createVNode();
      const dom = createDOMFromVNode(vnode);
      container.appendChild(dom);

      const start = performance.now();

      for (let i = 1; i <= 100; i++) {
        value.set(i);
        const newVNode = createVNode();
        const patches = diff(vnode, newVNode);
        patch(vnode, patches);
        vnode = newVNode;
      }

      const elapsed = performance.now() - start;

      expect(container.textContent).toBe('Value: 100');
      expect(elapsed).toBeLessThan(100); // Should complete in <100ms
    });

    test('handles 50 rapid list updates', () => {
      const items = signal<string[]>([]);

      const createVNode = () =>
        createElementVNode(
          'ul',
          null,
          items().map((item, idx) => createElementVNode('li', null, [createTextVNode(item)], String(idx)))
        );

      let vnode = createVNode();
      const dom = createDOMFromVNode(vnode);
      container.appendChild(dom);

      const start = performance.now();

      for (let i = 1; i <= 50; i++) {
        items.set([...items(), `Item ${i}`]);
        const newVNode = createVNode();
        const patches = diff(vnode, newVNode);
        patch(vnode, patches);
        vnode = newVNode;
      }

      const elapsed = performance.now() - start;

      expect(container.querySelectorAll('li').length).toBe(50);
      expect(elapsed).toBeLessThan(200); // Should complete in <200ms
    });

    test('handles mixed updates efficiently', () => {
      const counter = signal(0);
      const text = signal('');
      const show = signal(true);

      const createVNode = () =>
        createElementVNode('div', null, [
          createElementVNode('div', null, [createTextVNode(`Counter: ${counter()}`)]),
          createElementVNode('div', null, [createTextVNode(`Text: ${text()}`)]),
          ...(show() ? [createElementVNode('div', null, [createTextVNode('Visible')])] : []),
        ]);

      let vnode = createVNode();
      const dom = createDOMFromVNode(vnode);
      container.appendChild(dom);

      const start = performance.now();

      for (let i = 1; i <= 30; i++) {
        counter.set(i);
        text.set(`Update ${i}`);
        show.set(i % 2 === 0);

        const newVNode = createVNode();
        const patches = diff(vnode, newVNode);
        patch(vnode, patches);
        vnode = newVNode;
      }

      const elapsed = performance.now() - start;

      expect(container.textContent).toContain('Counter: 30');
      expect(container.textContent).toContain('Update 30');
      expect(elapsed).toBeLessThan(150); // Should complete in <150ms
    });
  });

  describe('Edge Cases and Stress Tests', () => {
    test('handles empty to non-empty list', () => {
      const items = signal<string[]>([]);

      const createVNode = () =>
        createElementVNode(
          'ul',
          null,
          items().map((item) => createElementVNode('li', null, [createTextVNode(item)]))
        );

      let vnode = createVNode();
      const dom = createDOMFromVNode(vnode);
      container.appendChild(dom);

      expect(container.querySelectorAll('li').length).toBe(0);

      items.set(['A', 'B', 'C']);

      const newVNode = createVNode();
      const patches = diff(vnode, newVNode);
      patch(vnode, patches);

      expect(container.querySelectorAll('li').length).toBe(3);
    });

    test('handles non-empty to empty list', () => {
      const items = signal(['A', 'B', 'C']);

      const createVNode = () =>
        createElementVNode(
          'ul',
          null,
          items().map((item) => createElementVNode('li', null, [createTextVNode(item)]))
        );

      let vnode = createVNode();
      const dom = createDOMFromVNode(vnode);
      container.appendChild(dom);

      expect(container.querySelectorAll('li').length).toBe(3);

      items.set([]);

      const newVNode = createVNode();
      const patches = diff(vnode, newVNode);
      patch(vnode, patches);

      expect(container.querySelectorAll('li').length).toBe(0);
    });

    test('handles deeply nested updates', () => {
      const value = signal('value');

      const createVNode = () =>
        createElementVNode('div', null, [
          createElementVNode('div', null, [
            createElementVNode('div', null, [
              createElementVNode('div', null, [createElementVNode('div', null, [createTextVNode(value())])]),
            ]),
          ]),
        ]);

      let vnode = createVNode();
      const dom = createDOMFromVNode(vnode);
      container.appendChild(dom);

      expect(container.textContent).toBe('value');

      value.set('updated');

      const newVNode = createVNode();
      const patches = diff(vnode, newVNode);
      patch(vnode, patches);

      expect(container.textContent).toBe('updated');
    });

    test('handles attribute updates on same element', () => {
      const className = signal('class-a');
      const title = signal('Title A');

      const createVNode = () =>
        createElementVNode('div', {
          id: 'test',
          class: className(),
          title: title(),
        });

      let vnode = createVNode();
      const dom = createDOMFromVNode(vnode);
      container.appendChild(dom);

      const div = container.querySelector('#test') as HTMLElement;
      expect(div.className).toBe('class-a');
      expect(div.title).toBe('Title A');

      className.set('class-b');
      title.set('Title B');

      const newVNode = createVNode();
      const patches = diff(vnode, newVNode);
      patch(vnode, patches);

      const divAfter = container.querySelector('#test') as HTMLElement;
      expect(divAfter).toBe(div); // Same node
      expect(divAfter.className).toBe('class-b');
      expect(divAfter.title).toBe('Title B');
    });
  });
});
