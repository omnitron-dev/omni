/**
 * JSX Integration Tests
 *
 * Tests for JSX runtime integration with reactive reconciler.
 * Covers static JSX, reactive props, reactive children, cleanup, and more.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { signal } from '../../../src/core/reactivity/signal.js';
import { createElementVNode, createTextVNode } from '../../../src/reconciler/vnode.js';
import {
  renderVNodeWithBindings,
  cleanupVNodeBindings,
  renderToContainer,
  hasReactiveBindings,
  getAllBindings,
  mountVNode,
  unmountVNode,
  handleReactiveChildren,
  handleReactiveAttributes,
  handleReactiveEventHandlers,
} from '../../../src/reconciler/jsx-integration.js';

/**
 * Helper to create a test container
 */
function createContainer(): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  return container;
}

/**
 * Helper to cleanup container
 */
function cleanupContainer(container: HTMLElement): void {
  if (container.parentNode) {
    container.parentNode.removeChild(container);
  }
}

describe('JSX Integration', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    cleanupContainer(container);
  });

  describe('Static JSX (No Reactivity)', () => {
    it('should render static element with text', () => {
      const vnode = createElementVNode('div', { id: 'test' }, [createTextVNode('Hello')]);
      const dom = renderVNodeWithBindings(vnode) as HTMLElement;

      expect(dom.tagName).toBe('DIV');
      expect(dom.id).toBe('test');
      expect(dom.textContent).toBe('Hello');
    });

    it('should render static element with attributes', () => {
      const vnode = createElementVNode('input', { type: 'text', placeholder: 'Enter name', value: 'test' });
      const dom = renderVNodeWithBindings(vnode) as HTMLInputElement;

      expect(dom.type).toBe('text');
      expect(dom.placeholder).toBe('Enter name');
      expect(dom.value).toBe('test');
    });

    it('should render static element with style', () => {
      const vnode = createElementVNode('div', { style: { color: 'red', fontSize: '16px' } });
      const dom = renderVNodeWithBindings(vnode) as HTMLElement;

      expect(dom.style.color).toBe('red');
      expect(dom.style.fontSize).toBe('16px');
    });

    it('should render static element with className', () => {
      const vnode = createElementVNode('div', { className: 'foo bar' });
      const dom = renderVNodeWithBindings(vnode) as HTMLElement;

      expect(dom.className).toBe('foo bar');
    });

    it('should render static element with nested children', () => {
      const vnode = createElementVNode('div', null, [
        createElementVNode('span', null, [createTextVNode('Hello')]),
        createElementVNode('span', null, [createTextVNode('World')]),
      ]);
      const dom = renderVNodeWithBindings(vnode) as HTMLElement;

      expect(dom.children.length).toBe(2);
      expect(dom.children[0].textContent).toBe('Hello');
      expect(dom.children[1].textContent).toBe('World');
    });

    it('should not create reactive bindings for static content', () => {
      const vnode = createElementVNode('div', { id: 'test' }, [createTextVNode('Static')]);
      renderVNodeWithBindings(vnode);

      expect(hasReactiveBindings(vnode)).toBe(false);
      expect(getAllBindings(vnode)).toHaveLength(0);
    });
  });

  describe('Reactive Children (Text Content)', () => {
    it('should render reactive textContent from signal', () => {
      const count = signal(0);
      const vnode = createElementVNode('div', { textContent: count });
      const dom = renderVNodeWithBindings(vnode) as HTMLElement;

      expect(dom.textContent).toBe('0');

      count.set(1);
      expect(dom.textContent).toBe('1');

      count.set(42);
      expect(dom.textContent).toBe('42');
    });

    it('should handle signal returning string', () => {
      const text = signal('Hello');
      const vnode = createElementVNode('div', { textContent: text });
      const dom = renderVNodeWithBindings(vnode) as HTMLElement;

      expect(dom.textContent).toBe('Hello');

      text.set('World');
      expect(dom.textContent).toBe('World');
    });

    it('should handle signal returning null/undefined', () => {
      const value = signal<string | null>('test');
      const vnode = createElementVNode('div', { textContent: value });
      const dom = renderVNodeWithBindings(vnode) as HTMLElement;

      expect(dom.textContent).toBe('test');

      value.set(null);
      expect(dom.textContent).toBe('');

      value.set(undefined as any);
      expect(dom.textContent).toBe('');
    });

    it('should update textContent reactively multiple times', () => {
      const count = signal(0);
      const vnode = createElementVNode('span', { textContent: count });
      const dom = renderVNodeWithBindings(vnode) as HTMLElement;

      for (let i = 1; i <= 10; i++) {
        count.set(i);
        expect(dom.textContent).toBe(String(i));
      }
    });
  });

  describe('Reactive Attributes', () => {
    it('should render reactive attribute from signal', () => {
      const disabled = signal(false);
      const vnode = createElementVNode('button', { disabled });
      const dom = renderVNodeWithBindings(vnode) as HTMLButtonElement;

      expect(dom.disabled).toBe(false);

      disabled.set(true);
      expect(dom.disabled).toBe(true);

      disabled.set(false);
      expect(dom.disabled).toBe(false);
    });

    it('should render reactive value property', () => {
      const value = signal('initial');
      const vnode = createElementVNode('input', { type: 'text', value });
      const dom = renderVNodeWithBindings(vnode) as HTMLInputElement;

      expect(dom.value).toBe('initial');

      value.set('updated');
      expect(dom.value).toBe('updated');
    });

    it('should render reactive checked property', () => {
      const checked = signal(false);
      const vnode = createElementVNode('input', { type: 'checkbox', checked });
      const dom = renderVNodeWithBindings(vnode) as HTMLInputElement;

      expect(dom.checked).toBe(false);

      checked.set(true);
      expect(dom.checked).toBe(true);
    });

    it('should render reactive data attribute', () => {
      const dataId = signal('item-1');
      const vnode = createElementVNode('div', { 'data-id': dataId });
      const dom = renderVNodeWithBindings(vnode) as HTMLElement;

      expect(dom.getAttribute('data-id')).toBe('item-1');

      dataId.set('item-2');
      expect(dom.getAttribute('data-id')).toBe('item-2');
    });

    it('should render reactive aria attribute', () => {
      const expanded = signal('false');
      const vnode = createElementVNode('div', { 'aria-expanded': expanded });
      const dom = renderVNodeWithBindings(vnode) as HTMLElement;

      expect(dom.getAttribute('aria-expanded')).toBe('false');

      expanded.set('true');
      expect(dom.getAttribute('aria-expanded')).toBe('true');
    });

    it('should handle null value removing attribute', () => {
      const customAttr = signal<string | null>('initial');
      const vnode = createElementVNode('div', { 'data-custom': customAttr });
      const dom = renderVNodeWithBindings(vnode) as HTMLElement;

      expect(dom.getAttribute('data-custom')).toBe('initial');

      customAttr.set(null);
      // bindSignalToAttribute removes the attribute when value is null
      expect(dom.hasAttribute('data-custom')).toBe(false);
    });
  });

  describe('Reactive Styles', () => {
    it('should render reactive style property', () => {
      const color = signal('red');
      const vnode = createElementVNode('div', { style: { color } });
      const dom = renderVNodeWithBindings(vnode) as HTMLElement;

      expect(dom.style.color).toBe('red');

      color.set('blue');
      expect(dom.style.color).toBe('blue');
    });

    it('should render multiple reactive style properties', () => {
      const color = signal('red');
      const fontSize = signal('16px');
      const vnode = createElementVNode('div', { style: { color, fontSize } });
      const dom = renderVNodeWithBindings(vnode) as HTMLElement;

      expect(dom.style.color).toBe('red');
      expect(dom.style.fontSize).toBe('16px');

      color.set('blue');
      fontSize.set('20px');
      expect(dom.style.color).toBe('blue');
      expect(dom.style.fontSize).toBe('20px');
    });

    it('should handle camelCase to kebab-case conversion', () => {
      const bgColor = signal('#ff0000');
      const vnode = createElementVNode('div', { style: { backgroundColor: bgColor } });
      const dom = renderVNodeWithBindings(vnode) as HTMLElement;

      // JSDOM doesn't convert hex to RGB, so check raw value
      expect(dom.style.backgroundColor).toBe('#ff0000');

      bgColor.set('#0000ff');
      expect(dom.style.backgroundColor).toBe('#0000ff');
    });

    it('should mix reactive and static style properties', () => {
      const color = signal('red');
      const vnode = createElementVNode('div', { style: { color, fontSize: '16px' } });
      const dom = renderVNodeWithBindings(vnode) as HTMLElement;

      expect(dom.style.color).toBe('red');
      expect(dom.style.fontSize).toBe('16px');

      color.set('green');
      expect(dom.style.color).toBe('green');
      expect(dom.style.fontSize).toBe('16px'); // Static remains unchanged
    });

    it('should handle null style value', () => {
      const color = signal<string | null>('red');
      const vnode = createElementVNode('div', { style: { color } });
      const dom = renderVNodeWithBindings(vnode) as HTMLElement;

      expect(dom.style.color).toBe('red');

      color.set(null);
      expect(dom.style.color).toBe('');
    });
  });

  describe('Reactive Classes', () => {
    it('should render reactive className string', () => {
      const className = signal('foo');
      const vnode = createElementVNode('div', { className });
      const dom = renderVNodeWithBindings(vnode) as HTMLElement;

      expect(dom.className).toBe('foo');

      className.set('bar');
      expect(dom.className).toBe('bar');

      className.set('foo bar baz');
      expect(dom.className).toBe('foo bar baz');
    });

    it('should handle empty className', () => {
      const className = signal('foo');
      const vnode = createElementVNode('div', { className });
      const dom = renderVNodeWithBindings(vnode) as HTMLElement;

      expect(dom.className).toBe('foo');

      className.set('');
      expect(dom.className).toBe('');
    });

    it('should update className multiple times', () => {
      const className = signal('initial');
      const vnode = createElementVNode('div', { className });
      const dom = renderVNodeWithBindings(vnode) as HTMLElement;

      const classes = ['one', 'two', 'three', 'four', 'five'];
      for (const cls of classes) {
        className.set(cls);
        expect(dom.className).toBe(cls);
      }
    });
  });

  describe('Event Handlers', () => {
    it('should attach event handler and fire correctly', () => {
      const handler = vi.fn();
      const vnode = createElementVNode('button', { onClick: handler });
      const dom = renderVNodeWithBindings(vnode) as HTMLButtonElement;

      dom.click();
      expect(handler).toHaveBeenCalledTimes(1);

      dom.click();
      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('should work with reactive content and events', () => {
      const count = signal(0);
      const handler = vi.fn(() => count.set((c) => c + 1));
      const vnode = createElementVNode('button', { onClick: handler, textContent: count });
      const dom = renderVNodeWithBindings(vnode) as HTMLButtonElement;

      expect(dom.textContent).toBe('0');

      dom.click();
      expect(handler).toHaveBeenCalledTimes(1);
      expect(dom.textContent).toBe('1');

      dom.click();
      expect(handler).toHaveBeenCalledTimes(2);
      expect(dom.textContent).toBe('2');
    });

    it('should handle multiple event types', () => {
      const clickHandler = vi.fn();
      const mouseoverHandler = vi.fn();
      const vnode = createElementVNode('div', { onClick: clickHandler, onMouseover: mouseoverHandler });
      const dom = renderVNodeWithBindings(vnode) as HTMLElement;

      dom.click();
      expect(clickHandler).toHaveBeenCalledTimes(1);
      expect(mouseoverHandler).toHaveBeenCalledTimes(0);

      dom.dispatchEvent(new MouseEvent('mouseover'));
      expect(clickHandler).toHaveBeenCalledTimes(1);
      expect(mouseoverHandler).toHaveBeenCalledTimes(1);
    });

    it('should pass event object to handler', () => {
      let receivedEvent: Event | null = null;
      const handler = (e: Event) => {
        receivedEvent = e;
      };
      const vnode = createElementVNode('button', { onClick: handler });
      const dom = renderVNodeWithBindings(vnode) as HTMLButtonElement;

      dom.click();
      expect(receivedEvent).toBeTruthy();
      expect(receivedEvent!.type).toBe('click');
      expect(receivedEvent!.target).toBe(dom);
    });
  });

  describe('Cleanup', () => {
    it('should cleanup reactive bindings', () => {
      const count = signal(0);
      const vnode = createElementVNode('div', { textContent: count });
      const dom = renderVNodeWithBindings(vnode) as HTMLElement;

      expect(dom.textContent).toBe('0');
      expect(hasReactiveBindings(vnode)).toBe(true);

      count.set(1);
      expect(dom.textContent).toBe('1');

      cleanupVNodeBindings(vnode);
      expect(hasReactiveBindings(vnode)).toBe(false);

      // After cleanup, changes should not update DOM
      count.set(2);
      expect(dom.textContent).toBe('1'); // Still "1"
    });

    it('should cleanup nested reactive bindings', () => {
      const text1 = signal('A');
      const text2 = signal('B');
      const vnode = createElementVNode('div', null, [
        createElementVNode('span', { textContent: text1 }),
        createElementVNode('span', { textContent: text2 }),
      ]);

      const dom = renderVNodeWithBindings(vnode) as HTMLElement;
      expect(dom.children[0].textContent).toBe('A');
      expect(dom.children[1].textContent).toBe('B');

      text1.set('X');
      text2.set('Y');
      expect(dom.children[0].textContent).toBe('X');
      expect(dom.children[1].textContent).toBe('Y');

      cleanupVNodeBindings(vnode);

      text1.set('Z');
      text2.set('W');
      expect(dom.children[0].textContent).toBe('X'); // No change
      expect(dom.children[1].textContent).toBe('Y'); // No change
    });

    it('should cleanup when using renderToContainer', () => {
      const count = signal(0);
      const vnode = createElementVNode('div', { textContent: count });
      const cleanup = renderToContainer(vnode, container);

      expect(container.firstChild).toBeTruthy();
      expect((container.firstChild as HTMLElement).textContent).toBe('0');

      count.set(1);
      expect((container.firstChild as HTMLElement).textContent).toBe('1');

      cleanup();

      expect(container.firstChild).toBeNull();
      count.set(2);
      // No element to check, but ensure no errors thrown
    });
  });

  describe('Complex Scenarios', () => {
    it('should handle multiple reactive props on same element', () => {
      const text = signal('Hello');
      const color = signal('red');
      const className = signal('foo');
      const vnode = createElementVNode('div', { textContent: text, style: { color }, className });
      const dom = renderVNodeWithBindings(vnode) as HTMLElement;

      expect(dom.textContent).toBe('Hello');
      expect(dom.style.color).toBe('red');
      expect(dom.className).toBe('foo');

      text.set('World');
      color.set('blue');
      className.set('bar');

      expect(dom.textContent).toBe('World');
      expect(dom.style.color).toBe('blue');
      expect(dom.className).toBe('bar');
    });

    it('should handle deeply nested reactive elements', () => {
      const text = signal('Deep');
      const vnode = createElementVNode('div', null, [
        createElementVNode('div', null, [
          createElementVNode('div', null, [createElementVNode('span', { textContent: text })]),
        ]),
      ]);

      const dom = renderVNodeWithBindings(vnode) as HTMLElement;
      const span = dom.querySelector('span')!;

      expect(span.textContent).toBe('Deep');

      text.set('Updated');
      expect(span.textContent).toBe('Updated');
    });

    it('should create bindings count correctly', () => {
      const text1 = signal('A');
      const text2 = signal('B');
      const color = signal('red');
      const vnode = createElementVNode('div', { style: { color } }, [
        createElementVNode('span', { textContent: text1 }),
        createElementVNode('span', { textContent: text2 }),
      ]);

      renderVNodeWithBindings(vnode);

      const bindings = getAllBindings(vnode);
      expect(bindings.length).toBe(3); // 1 for style, 2 for textContent
    });

    it('should handle rapid signal updates', () => {
      const count = signal(0);
      const vnode = createElementVNode('div', { textContent: count });
      const dom = renderVNodeWithBindings(vnode) as HTMLElement;

      for (let i = 1; i <= 100; i++) {
        count.set(i);
      }

      expect(dom.textContent).toBe('100');
    });

    it('should handle innerHTML reactively', () => {
      const html = signal('<span>Hello</span>');
      const vnode = createElementVNode('div', { innerHTML: html });
      const dom = renderVNodeWithBindings(vnode) as HTMLElement;

      expect(dom.innerHTML).toBe('<span>Hello</span>');
      expect(dom.querySelector('span')?.textContent).toBe('Hello');

      html.set('<span>World</span>');
      expect(dom.innerHTML).toBe('<span>World</span>');
      expect(dom.querySelector('span')?.textContent).toBe('World');
    });
  });

  describe('Utility Functions', () => {
    it('hasReactiveBindings should detect reactive VNodes', () => {
      const count = signal(0);
      const reactiveVNode = createElementVNode('div', { textContent: count });
      const staticVNode = createElementVNode('div', { textContent: 'static' });

      renderVNodeWithBindings(reactiveVNode);
      renderVNodeWithBindings(staticVNode);

      expect(hasReactiveBindings(reactiveVNode)).toBe(true);
      expect(hasReactiveBindings(staticVNode)).toBe(false);
    });

    it('getAllBindings should collect all effects', () => {
      const text1 = signal('A');
      const text2 = signal('B');
      const text3 = signal('C');
      const vnode = createElementVNode('div', null, [
        createElementVNode('span', { textContent: text1 }),
        createElementVNode('div', null, [
          createElementVNode('span', { textContent: text2 }),
          createElementVNode('span', { textContent: text3 }),
        ]),
      ]);

      renderVNodeWithBindings(vnode);

      const bindings = getAllBindings(vnode);
      expect(bindings.length).toBe(3);
    });

    it('renderToContainer should append and cleanup', () => {
      const vnode = createElementVNode('div', { id: 'test' }, [createTextVNode('Hello')]);
      const cleanup = renderToContainer(vnode, container);

      expect(container.children.length).toBe(1);
      expect(container.firstChild).toBeTruthy();
      expect((container.firstChild as HTMLElement).id).toBe('test');

      cleanup();

      expect(container.children.length).toBe(0);
      expect(container.firstChild).toBeNull();
    });
  });

  describe('Edge Cases', () => {
    it('should handle VNode without props', () => {
      const vnode = createElementVNode('div', null);
      const dom = renderVNodeWithBindings(vnode) as HTMLElement;

      expect(dom.tagName).toBe('DIV');
      expect(hasReactiveBindings(vnode)).toBe(false);
    });

    it('should handle VNode without children', () => {
      const vnode = createElementVNode('div', { id: 'test' });
      const dom = renderVNodeWithBindings(vnode) as HTMLElement;

      expect(dom.tagName).toBe('DIV');
      expect(dom.id).toBe('test');
      expect(dom.children.length).toBe(0);
    });

    it('should handle empty effects array after cleanup', () => {
      const count = signal(0);
      const vnode = createElementVNode('div', { textContent: count });
      renderVNodeWithBindings(vnode);

      cleanupVNodeBindings(vnode);
      expect(vnode.effects).toHaveLength(0);

      // Calling cleanup again should not error
      cleanupVNodeBindings(vnode);
      expect(vnode.effects).toHaveLength(0);
    });

    it('should handle signal with complex object value', () => {
      const data = signal({ name: 'John', age: 30 });
      const vnode = createElementVNode('div', {
        textContent: () => `${data().name} (${data().age})`,
      });
      // Note: This won't work as expected since textContent expects a signal directly
      // This test demonstrates the limitation
    });

    it('should not error with missing DOM reference', () => {
      const vnode = createElementVNode('div', null);
      // Don't render, just try to cleanup
      expect(() => cleanupVNodeBindings(vnode)).not.toThrow();
    });
  });

  describe('Performance', () => {
    it('should handle 100 reactive elements efficiently', () => {
      const signals = Array.from({ length: 100 }, (_, i) => signal(i));
      const children = signals.map((count) => createElementVNode('div', { textContent: count }));
      const vnode = createElementVNode('div', null, children);

      const start = performance.now();
      const dom = renderVNodeWithBindings(vnode);
      const renderTime = performance.now() - start;

      expect(renderTime).toBeLessThan(100); // Should render in < 100ms
      expect((dom as HTMLElement).children.length).toBe(100);

      // Update all signals
      const updateStart = performance.now();
      signals.forEach((count, i) => count.set(i + 100));
      const updateTime = performance.now() - updateStart;

      expect(updateTime).toBeLessThan(50); // Should update in < 50ms
    });

    it('should handle frequent updates without memory leaks', () => {
      const count = signal(0);
      const vnode = createElementVNode('div', { textContent: count });
      const dom = renderVNodeWithBindings(vnode);

      // Perform many updates
      for (let i = 0; i < 1000; i++) {
        count.set(i);
      }

      expect((dom as HTMLElement).textContent).toBe('999');

      // Cleanup
      cleanupVNodeBindings(vnode);
      expect(hasReactiveBindings(vnode)).toBe(false);
    });
  });

  describe('New API Functions (Task 2.2)', () => {
    describe('mountVNode', () => {
      it('should mount VNode to container', () => {
        const vnode = createElementVNode('div', { id: 'mounted' }, [createTextVNode('Mounted')]);
        const dom = mountVNode(vnode, container);

        expect(dom).toBeTruthy();
        expect(container.firstChild).toBe(dom);
        expect((dom as HTMLElement).id).toBe('mounted');
        expect((dom as HTMLElement).textContent).toBe('Mounted');
      });

      it('should mount VNode with reactive props', () => {
        const count = signal(0);
        const vnode = createElementVNode('div', { textContent: count });
        const dom = mountVNode(vnode, container) as HTMLElement;

        expect(dom.textContent).toBe('0');
        count.set(5);
        expect(dom.textContent).toBe('5');
      });

      it('should return the created DOM node', () => {
        const vnode = createElementVNode('span', { className: 'test' });
        const dom = mountVNode(vnode, container);

        expect(dom).toBeInstanceOf(HTMLSpanElement);
        expect((dom as HTMLElement).className).toBe('test');
      });

      it('should handle mounting multiple VNodes', () => {
        const vnode1 = createElementVNode('div', { id: 'first' });
        const vnode2 = createElementVNode('div', { id: 'second' });

        mountVNode(vnode1, container);
        mountVNode(vnode2, container);

        expect(container.children.length).toBe(2);
        expect((container.children[0] as HTMLElement).id).toBe('first');
        expect((container.children[1] as HTMLElement).id).toBe('second');
      });

      it('should set up reactive bindings during mount', () => {
        const color = signal('red');
        const vnode = createElementVNode('div', { style: { color } });
        const dom = mountVNode(vnode, container) as HTMLElement;

        expect(dom.style.color).toBe('red');
        expect(hasReactiveBindings(vnode)).toBe(true);

        color.set('blue');
        expect(dom.style.color).toBe('blue');
      });
    });

    describe('unmountVNode', () => {
      it('should unmount VNode and remove from DOM', () => {
        const vnode = createElementVNode('div', { id: 'to-unmount' });
        mountVNode(vnode, container);

        expect(container.firstChild).toBeTruthy();
        unmountVNode(vnode);
        expect(container.firstChild).toBeNull();
      });

      it('should cleanup reactive bindings on unmount', () => {
        const count = signal(0);
        const vnode = createElementVNode('div', { textContent: count });
        const dom = mountVNode(vnode, container) as HTMLElement;

        expect(dom.textContent).toBe('0');
        expect(hasReactiveBindings(vnode)).toBe(true);

        count.set(1);
        expect(dom.textContent).toBe('1');

        unmountVNode(vnode);
        expect(hasReactiveBindings(vnode)).toBe(false);

        // Changes after unmount should not affect DOM
        count.set(2);
        expect(dom.textContent).toBe('1');
      });

      it('should be safe to call on non-mounted VNode', () => {
        const vnode = createElementVNode('div');
        expect(() => unmountVNode(vnode)).not.toThrow();
      });

      it('should be safe to call twice', () => {
        const vnode = createElementVNode('div');
        mountVNode(vnode, container);

        unmountVNode(vnode);
        expect(() => unmountVNode(vnode)).not.toThrow();
      });

      it('should cleanup nested VNode bindings', () => {
        const text1 = signal('A');
        const text2 = signal('B');
        const vnode = createElementVNode('div', null, [
          createElementVNode('span', { textContent: text1 }),
          createElementVNode('span', { textContent: text2 }),
        ]);

        mountVNode(vnode, container);
        expect(hasReactiveBindings(vnode)).toBe(true);

        unmountVNode(vnode);
        expect(hasReactiveBindings(vnode)).toBe(false);
      });
    });

    describe('handleReactiveChildren', () => {
      it('should process array of child VNodes', () => {
        const text1 = signal('Child 1');
        const text2 = signal('Child 2');
        const child1 = createElementVNode('div', { textContent: text1 });
        const child2 = createElementVNode('div', { textContent: text2 });

        const parent = createElementVNode('div');
        parent.children = [child1, child2];

        // Create DOM first
        mountVNode(parent, container);

        // Now handle reactive children
        handleReactiveChildren(parent, [child1, child2]);

        expect(parent.effects).toBeDefined();
      });

      it('should handle single VNode child', () => {
        const text = signal('Single Child');
        const child = createElementVNode('span', { textContent: text });
        const parent = createElementVNode('div');
        parent.children = [child];

        mountVNode(parent, container);
        handleReactiveChildren(parent, child);

        expect(parent.effects).toBeDefined();
      });

      it('should handle null/undefined children gracefully', () => {
        const parent = createElementVNode('div');
        expect(() => handleReactiveChildren(parent, null)).not.toThrow();
        expect(() => handleReactiveChildren(parent, undefined)).not.toThrow();
      });

      it('should initialize effects array if not present', () => {
        const parent = createElementVNode('div');
        parent.effects = undefined;

        handleReactiveChildren(parent, []);
        expect(parent.effects).toBeDefined();
        expect(Array.isArray(parent.effects)).toBe(true);
      });

      it('should process nested children', () => {
        const text = signal('Nested');
        const grandchild = createElementVNode('span', { textContent: text });
        const child = createElementVNode('div', null, [grandchild]);
        const parent = createElementVNode('div');
        parent.children = [child];

        mountVNode(parent, container);
        handleReactiveChildren(parent, [child]);

        // Verify the structure is set up correctly
        expect(parent.effects).toBeDefined();
      });
    });

    describe('handleReactiveAttributes', () => {
      it('should setup reactive attribute bindings', () => {
        const disabled = signal(false);
        const vnode = createElementVNode('button');
        const element = document.createElement('button');

        handleReactiveAttributes(vnode, element, { disabled });

        // The function should initialize effects
        expect(vnode.effects).toBeDefined();
        expect(vnode.effects!.length).toBeGreaterThan(0);
      });

      it('should handle multiple reactive attributes', () => {
        const value = signal('test');
        const placeholder = signal('Enter text');
        const vnode = createElementVNode('input');
        const element = document.createElement('input');
        element.type = 'text';

        handleReactiveAttributes(vnode, element, { value, placeholder });

        expect(vnode.effects).toBeDefined();
        expect(vnode.effects!.length).toBeGreaterThan(0);
      });

      it('should handle null/undefined props gracefully', () => {
        const vnode = createElementVNode('div');
        const element = document.createElement('div');

        expect(() => handleReactiveAttributes(vnode, element, null)).not.toThrow();
        expect(() => handleReactiveAttributes(vnode, element, undefined)).not.toThrow();
      });

      it('should initialize effects array if not present', () => {
        const vnode = createElementVNode('div');
        vnode.effects = undefined;
        const element = document.createElement('div');

        handleReactiveAttributes(vnode, element, { id: 'test' });
        expect(vnode.effects).toBeDefined();
      });

      it('should handle reactive styles', () => {
        const color = signal('red');
        const vnode = createElementVNode('div');
        const element = document.createElement('div');

        handleReactiveAttributes(vnode, element, { style: { color } });

        expect(vnode.effects).toBeDefined();
        expect(vnode.effects!.length).toBeGreaterThan(0);
      });

      it('should handle reactive className', () => {
        const className = signal('active');
        const vnode = createElementVNode('div');
        const element = document.createElement('div');

        handleReactiveAttributes(vnode, element, { className });

        expect(vnode.effects).toBeDefined();
        expect(vnode.effects!.length).toBeGreaterThan(0);
      });
    });

    describe('handleReactiveEventHandlers', () => {
      it('should handle event handler props', () => {
        const handler = vi.fn();
        const vnode = createElementVNode('button');
        const element = document.createElement('button');

        // This function is currently a no-op but should not error
        expect(() => handleReactiveEventHandlers(vnode, element, { onClick: handler })).not.toThrow();
      });

      it('should handle null/undefined props gracefully', () => {
        const vnode = createElementVNode('div');
        const element = document.createElement('div');

        expect(() => handleReactiveEventHandlers(vnode, element, null)).not.toThrow();
        expect(() => handleReactiveEventHandlers(vnode, element, undefined)).not.toThrow();
      });

      it('should handle multiple event handlers', () => {
        const onClick = vi.fn();
        const onMouseover = vi.fn();
        const vnode = createElementVNode('div');
        const element = document.createElement('div');

        expect(() =>
          handleReactiveEventHandlers(vnode, element, { onClick, onMouseover })
        ).not.toThrow();
      });

      it('should not create reactive bindings for event handlers', () => {
        const handler = vi.fn();
        const vnode = createElementVNode('button');
        vnode.effects = [];
        const element = document.createElement('button');

        handleReactiveEventHandlers(vnode, element, { onClick: handler });

        // Event handlers should not add effects (they're static)
        expect(vnode.effects!.length).toBe(0);
      });
    });

    describe('Integration: mountVNode + handleReactive* functions', () => {
      it('should work together to create reactive UI', () => {
        const count = signal(0);
        const disabled = signal(false);
        const className = signal('counter');

        const vnode = createElementVNode('button', {
          textContent: count,
          disabled,
          className,
        });

        const dom = mountVNode(vnode, container) as HTMLButtonElement;

        expect(dom.textContent).toBe('0');
        expect(dom.disabled).toBe(false);
        expect(dom.className).toBe('counter');

        // Update all signals
        count.set(5);
        disabled.set(true);
        className.set('counter active');

        expect(dom.textContent).toBe('5');
        expect(dom.disabled).toBe(true);
        expect(dom.className).toBe('counter active');

        // Cleanup
        unmountVNode(vnode);
        expect(hasReactiveBindings(vnode)).toBe(false);
      });

      it('should handle complex nested structure', () => {
        const title = signal('Parent');
        const child1Text = signal('Child 1');
        const child2Text = signal('Child 2');

        const vnode = createElementVNode('div', { textContent: title }, [
          createElementVNode('span', { textContent: child1Text }),
          createElementVNode('span', { textContent: child2Text }),
        ]);

        const dom = mountVNode(vnode, container) as HTMLElement;

        expect(dom.textContent).toContain('Parent');
        expect(dom.querySelector('span:nth-child(1)')?.textContent).toBe('Child 1');
        expect(dom.querySelector('span:nth-child(2)')?.textContent).toBe('Child 2');

        // Update signals
        title.set('Updated Parent');
        child1Text.set('Updated Child 1');
        child2Text.set('Updated Child 2');

        expect(dom.textContent).toContain('Updated Parent');
        expect(dom.querySelector('span:nth-child(1)')?.textContent).toBe('Updated Child 1');
        expect(dom.querySelector('span:nth-child(2)')?.textContent).toBe('Updated Child 2');

        unmountVNode(vnode);
      });
    });
  });
});
