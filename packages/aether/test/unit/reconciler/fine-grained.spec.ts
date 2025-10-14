/**
 * Fine-Grained Reactivity Tests
 *
 * Comprehensive test suite for optimized fine-grained reactivity system.
 * Tests reactive node creators, effect lifecycle, performance benchmarks,
 * and edge cases.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createReactiveTextNode,
  createReactiveAttribute,
  createReactiveProperty,
  createReactiveStyle,
  attachReactivity,
  cleanupReactivity,
  batchEffects,
  clearEffectPool,
  type StyleValue,
} from '../../../src/reconciler/fine-grained.js';
import { signal } from '../../../src/core/reactivity/signal.js';
import { createElementVNode, createTextVNode, type VNode } from '../../../src/reconciler/vnode.js';

describe('Fine-Grained Reactivity', () => {
  beforeEach(() => {
    clearEffectPool();
  });

  afterEach(() => {
    clearEffectPool();
  });

  describe('createReactiveTextNode', () => {
    it('should create text node with initial value', () => {
      const count = signal(0);
      const textNode = createReactiveTextNode(() => `Count: ${count()}`);

      expect(textNode.textContent).toBe('Count: 0');
    });

    it('should update text node when signal changes', () => {
      const count = signal(0);
      const textNode = createReactiveTextNode(() => `Count: ${count()}`);

      expect(textNode.textContent).toBe('Count: 0');
      count.set(1);
      expect(textNode.textContent).toBe('Count: 1');
    });

    it('should handle multiple signals', () => {
      const first = signal('Hello');
      const second = signal('World');
      const textNode = createReactiveTextNode(() => `${first()} ${second()}`);

      expect(textNode.textContent).toBe('Hello World');
      first.set('Hi');
      expect(textNode.textContent).toBe('Hi World');
      second.set('There');
      expect(textNode.textContent).toBe('Hi There');
    });

    it('should handle null and undefined values', () => {
      const value = signal<any>(null);
      const textNode = createReactiveTextNode(() => value());

      expect(textNode.textContent).toBe('');
      value.set(undefined);
      expect(textNode.textContent).toBe('');
      value.set('text');
      expect(textNode.textContent).toBe('text');
    });

    it('should convert non-string values to strings', () => {
      const value = signal<any>(123);
      const textNode = createReactiveTextNode(() => value());

      expect(textNode.textContent).toBe('123');
      value.set(true);
      expect(textNode.textContent).toBe('true');
      value.set({ toString: () => 'object' });
      expect(textNode.textContent).toBe('object');
    });

    it('should store effect reference on node', () => {
      const count = signal(0);
      const textNode = createReactiveTextNode(() => count());

      expect((textNode as any).__effect).toBeDefined();
      expect(typeof (textNode as any).__effect.dispose).toBe('function');
    });

    it('should handle rapid updates', () => {
      const count = signal(0);
      const textNode = createReactiveTextNode(() => `Count: ${count()}`);

      for (let i = 1; i <= 10; i++) {
        count.set(i);
        expect(textNode.textContent).toBe(`Count: ${i}`);
      }
    });
  });

  describe('createReactiveAttribute', () => {
    it('should set attribute with initial value', () => {
      const title = signal('Hello');
      const div = document.createElement('div');
      createReactiveAttribute(div, 'title', () => title());

      expect(div.getAttribute('title')).toBe('Hello');
    });

    it('should update attribute when signal changes', () => {
      const title = signal('Hello');
      const div = document.createElement('div');
      createReactiveAttribute(div, 'title', () => title());

      expect(div.getAttribute('title')).toBe('Hello');
      title.set('World');
      expect(div.getAttribute('title')).toBe('World');
    });

    it('should remove attribute when value is null', () => {
      const title = signal<string | null>('Hello');
      const div = document.createElement('div');
      createReactiveAttribute(div, 'title', () => title());

      expect(div.hasAttribute('title')).toBe(true);
      title.set(null);
      expect(div.hasAttribute('title')).toBe(false);
    });

    it('should remove attribute when value is undefined', () => {
      const title = signal<string | undefined>('Hello');
      const div = document.createElement('div');
      createReactiveAttribute(div, 'title', () => title());

      expect(div.hasAttribute('title')).toBe(true);
      title.set(undefined);
      expect(div.hasAttribute('title')).toBe(false);
    });

    it('should handle boolean attributes', () => {
      const disabled = signal(false);
      const button = document.createElement('button');
      createReactiveAttribute(button, 'disabled', () => (disabled() ? '' : null));

      expect(button.hasAttribute('disabled')).toBe(false);
      disabled.set(true);
      expect(button.hasAttribute('disabled')).toBe(true);
    });

    it('should store effect in element effects array', () => {
      const title = signal('Hello');
      const div = document.createElement('div');
      createReactiveAttribute(div, 'title', () => title());

      expect((div as any).__effects).toBeDefined();
      expect(Array.isArray((div as any).__effects)).toBe(true);
      expect((div as any).__effects.length).toBe(1);
    });

    it('should handle multiple reactive attributes', () => {
      const title = signal('Title');
      const id = signal('my-id');
      const div = document.createElement('div');
      createReactiveAttribute(div, 'title', () => title());
      createReactiveAttribute(div, 'id', () => id());

      expect(div.getAttribute('title')).toBe('Title');
      expect(div.getAttribute('id')).toBe('my-id');
      title.set('New Title');
      id.set('new-id');
      expect(div.getAttribute('title')).toBe('New Title');
      expect(div.getAttribute('id')).toBe('new-id');
    });
  });

  describe('createReactiveProperty', () => {
    it('should set property with initial value', () => {
      const checked = signal(false);
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      createReactiveProperty(checkbox, 'checked', () => checked());

      expect(checkbox.checked).toBe(false);
    });

    it('should update property when signal changes', () => {
      const checked = signal(false);
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      createReactiveProperty(checkbox, 'checked', () => checked());

      expect(checkbox.checked).toBe(false);
      checked.set(true);
      expect(checkbox.checked).toBe(true);
    });

    it('should handle input value property', () => {
      const value = signal('hello');
      const input = document.createElement('input');
      createReactiveProperty(input, 'value', () => value());

      expect(input.value).toBe('hello');
      value.set('world');
      expect(input.value).toBe('world');
    });

    it('should store effect in element effects array', () => {
      const checked = signal(false);
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      createReactiveProperty(checkbox, 'checked', () => checked());

      expect((checkbox as any).__effects).toBeDefined();
      expect(Array.isArray((checkbox as any).__effects)).toBe(true);
      expect((checkbox as any).__effects.length).toBe(1);
    });

    it('should handle multiple reactive properties', () => {
      const value = signal('text');
      const disabled = signal(false);
      const input = document.createElement('input');
      createReactiveProperty(input, 'value', () => value());
      createReactiveProperty(input, 'disabled', () => disabled());

      expect(input.value).toBe('text');
      expect(input.disabled).toBe(false);
      value.set('new text');
      disabled.set(true);
      expect(input.value).toBe('new text');
      expect(input.disabled).toBe(true);
    });
  });

  describe('createReactiveStyle', () => {
    it('should set styles with initial values', () => {
      const color = signal('red');
      const div = document.createElement('div');
      createReactiveStyle(div, () => ({ color: color() }));

      expect(div.style.color).toBe('red');
    });

    it('should update styles when signal changes', () => {
      const color = signal('red');
      const div = document.createElement('div');
      createReactiveStyle(div, () => ({ color: color() }));

      expect(div.style.color).toBe('red');
      color.set('blue');
      expect(div.style.color).toBe('blue');
    });

    it('should handle multiple style properties', () => {
      const color = signal('red');
      const size = signal(16);
      const div = document.createElement('div');
      createReactiveStyle(div, () => ({
        color: color(),
        fontSize: `${size()}px`,
      }));

      expect(div.style.color).toBe('red');
      expect(div.style.fontSize).toBe('16px');
      color.set('blue');
      size.set(20);
      expect(div.style.color).toBe('blue');
      expect(div.style.fontSize).toBe('20px');
    });

    it('should handle camelCase to kebab-case conversion', () => {
      const color = signal('red');
      const div = document.createElement('div');
      createReactiveStyle(div, () => ({
        backgroundColor: color(),
        fontSize: '16px',
      }));

      expect(div.style.backgroundColor).toBe('red');
      expect(div.style.fontSize).toBe('16px');
    });

    it('should remove style property when value is null', () => {
      const color = signal<string | null>('red');
      const div = document.createElement('div');
      createReactiveStyle(div, () => ({ color: color() }));

      expect(div.style.color).toBe('red');
      color.set(null);
      expect(div.style.color).toBe('');
    });

    it('should remove style property when value is undefined', () => {
      const color = signal<string | undefined>('red');
      const div = document.createElement('div');
      createReactiveStyle(div, () => ({ color: color() }));

      expect(div.style.color).toBe('red');
      color.set(undefined);
      expect(div.style.color).toBe('');
    });

    it('should handle string style (cssText)', () => {
      const css = signal('color: red; font-size: 16px;');
      const div = document.createElement('div');
      createReactiveStyle(div, () => css());

      expect(div.style.color).toBe('red');
      expect(div.style.fontSize).toBe('16px');
      css.set('color: blue; font-size: 20px;');
      expect(div.style.color).toBe('blue');
      expect(div.style.fontSize).toBe('20px');
    });

    it('should clear all styles when value is null', () => {
      const styles = signal<StyleValue>({ color: 'red', fontSize: '16px' });
      const div = document.createElement('div');
      createReactiveStyle(div, () => styles());

      expect(div.style.color).toBe('red');
      expect(div.style.fontSize).toBe('16px');
      styles.set(null);
      expect(div.style.cssText).toBe('');
    });

    it('should remove previous styles not in new style object', () => {
      const styles = signal<any>({ color: 'red', fontSize: '16px' });
      const div = document.createElement('div');
      createReactiveStyle(div, () => styles());

      expect(div.style.color).toBe('red');
      expect(div.style.fontSize).toBe('16px');
      styles.set({ color: 'blue' }); // fontSize should be removed
      expect(div.style.color).toBe('blue');
      expect(div.style.fontSize).toBe('');
    });

    it('should store effect in element effects array', () => {
      const color = signal('red');
      const div = document.createElement('div');
      createReactiveStyle(div, () => ({ color: color() }));

      expect((div as any).__effects).toBeDefined();
      expect(Array.isArray((div as any).__effects)).toBe(true);
      expect((div as any).__effects.length).toBe(1);
    });
  });

  describe('attachReactivity', () => {
    it('should attach reactivity to element with reactive props', () => {
      const title = signal('Hello');
      const vnode = createElementVNode('div', { title: () => title() });
      const dom = document.createElement('div');
      vnode.dom = dom;

      attachReactivity(vnode, dom);

      expect((dom as HTMLElement).getAttribute('title')).toBe('Hello');
      title.set('World');
      expect((dom as HTMLElement).getAttribute('title')).toBe('World');
    });

    it('should attach reactivity to reactive style', () => {
      const color = signal('red');
      const vnode = createElementVNode('div', { style: () => ({ color: color() }) });
      const dom = document.createElement('div');
      vnode.dom = dom;

      attachReactivity(vnode, dom);

      expect((dom as HTMLElement).style.color).toBe('red');
      color.set('blue');
      expect((dom as HTMLElement).style.color).toBe('blue');
    });

    it('should attach reactivity to class attribute', () => {
      const className = signal('foo');
      const vnode = createElementVNode('div', { class: () => className() });
      const dom = document.createElement('div');
      vnode.dom = dom;

      attachReactivity(vnode, dom);

      expect((dom as HTMLElement).getAttribute('class')).toBe('foo');
      className.set('bar');
      expect((dom as HTMLElement).getAttribute('class')).toBe('bar');
    });

    it('should store effects on vnode', () => {
      const title = signal('Hello');
      const vnode = createElementVNode('div', { title: () => title() });
      const dom = document.createElement('div');
      vnode.dom = dom;

      attachReactivity(vnode, dom);

      expect(vnode.effects).toBeDefined();
      expect(Array.isArray(vnode.effects)).toBe(true);
      expect(vnode.effects!.length).toBeGreaterThan(0);
    });

    it('should handle multiple reactive props', () => {
      const title = signal('Title');
      const id = signal('my-id');
      const vnode = createElementVNode('div', {
        title: () => title(),
        id: () => id(),
      });
      const dom = document.createElement('div');
      vnode.dom = dom;

      attachReactivity(vnode, dom);

      expect((dom as HTMLElement).getAttribute('title')).toBe('Title');
      expect((dom as HTMLElement).getAttribute('id')).toBe('my-id');
      title.set('New Title');
      id.set('new-id');
      expect((dom as HTMLElement).getAttribute('title')).toBe('New Title');
      expect((dom as HTMLElement).getAttribute('id')).toBe('new-id');
    });

    it('should handle reactive properties (value, checked)', () => {
      const value = signal('hello');
      const vnode = createElementVNode('input', { value: () => value() });
      const dom = document.createElement('input');
      vnode.dom = dom;

      attachReactivity(vnode, dom);

      expect((dom as HTMLInputElement).value).toBe('hello');
      value.set('world');
      expect((dom as HTMLInputElement).value).toBe('world');
    });

    it('should recursively attach reactivity to children', () => {
      const title = signal('Title');
      const childText = signal('Child');

      const childVNode = createElementVNode('span', { title: () => childText() });
      const childDom = document.createElement('span');
      childVNode.dom = childDom;

      const vnode = createElementVNode('div', { title: () => title() }, [childVNode]);
      const dom = document.createElement('div');
      vnode.dom = dom;
      dom.appendChild(childDom);

      attachReactivity(vnode, dom);

      expect((dom as HTMLElement).getAttribute('title')).toBe('Title');
      expect(childDom.getAttribute('title')).toBe('Child');
      title.set('New Title');
      childText.set('New Child');
      expect((dom as HTMLElement).getAttribute('title')).toBe('New Title');
      expect(childDom.getAttribute('title')).toBe('New Child');
    });

    it('should skip event handlers', () => {
      const onClick = vi.fn();
      const vnode = createElementVNode('button', { onClick });
      const dom = document.createElement('button');
      vnode.dom = dom;

      attachReactivity(vnode, dom);

      // Should not create effects for event handlers
      expect(vnode.effects).toBeDefined();
      expect(vnode.effects!.length).toBe(0);
    });

    it('should skip key prop', () => {
      const vnode = createElementVNode('div', { key: 'test-key' });
      const dom = document.createElement('div');
      vnode.dom = dom;

      attachReactivity(vnode, dom);

      // Should not create effects for key
      expect(vnode.effects).toBeDefined();
      expect(vnode.effects!.length).toBe(0);
    });

    it('should handle null vnode gracefully', () => {
      expect(() => attachReactivity(null as any, document.createElement('div'))).not.toThrow();
    });

    it('should handle null dom gracefully', () => {
      const vnode = createElementVNode('div');
      expect(() => attachReactivity(vnode, null as any)).not.toThrow();
    });
  });

  describe('cleanupReactivity', () => {
    it('should dispose all effects on vnode', () => {
      const title = signal('Hello');
      const vnode = createElementVNode('div', { title: () => title() });
      const dom = document.createElement('div');
      vnode.dom = dom;

      attachReactivity(vnode, dom);
      expect(vnode.effects!.length).toBeGreaterThan(0);

      cleanupReactivity(vnode);

      // Effects should be cleared
      expect(vnode.effects!.length).toBe(0);

      // Updating signal should not affect DOM anymore
      const oldTitle = (dom as HTMLElement).getAttribute('title');
      title.set('World');
      expect((dom as HTMLElement).getAttribute('title')).toBe(oldTitle);
    });

    it('should recursively clean up children', () => {
      const title = signal('Title');
      const childText = signal('Child');

      const childVNode = createElementVNode('span', { title: () => childText() });
      const childDom = document.createElement('span');
      childVNode.dom = childDom;

      const vnode = createElementVNode('div', { title: () => title() }, [childVNode]);
      const dom = document.createElement('div');
      vnode.dom = dom;
      dom.appendChild(childDom);

      attachReactivity(vnode, dom);

      expect(vnode.effects!.length).toBeGreaterThan(0);
      expect(childVNode.effects!.length).toBeGreaterThan(0);

      cleanupReactivity(vnode);

      expect(vnode.effects!.length).toBe(0);
      expect(childVNode.effects!.length).toBe(0);
    });

    it('should clean up DOM node effects', () => {
      const count = signal(0);
      const textNode = createReactiveTextNode(() => count());

      expect((textNode as any).__effect).toBeDefined();

      const vnode = createTextVNode('dummy');
      vnode.dom = textNode;
      vnode.effects = [(textNode as any).__effect];

      cleanupReactivity(vnode);

      expect((textNode as any).__effect).toBeUndefined();
    });

    it('should handle null vnode gracefully', () => {
      expect(() => cleanupReactivity(null as any)).not.toThrow();
    });

    it('should handle vnode without effects gracefully', () => {
      const vnode = createElementVNode('div');
      expect(() => cleanupReactivity(vnode)).not.toThrow();
    });
  });

  describe('batchEffects', () => {
    it('should execute function and return result', () => {
      const result = batchEffects(() => {
        return 42;
      });

      expect(result).toBe(42);
    });

    it('should batch multiple reactive node creations', () => {
      const count1 = signal(1);
      const count2 = signal(2);
      const count3 = signal(3);

      const nodes = batchEffects(() => {
        return [
          createReactiveTextNode(() => count1()),
          createReactiveTextNode(() => count2()),
          createReactiveTextNode(() => count3()),
        ];
      });

      expect(nodes.length).toBe(3);
      expect(nodes[0].textContent).toBe('1');
      expect(nodes[1].textContent).toBe('2');
      expect(nodes[2].textContent).toBe('3');
    });

    it('should handle errors in batched function', () => {
      expect(() => {
        batchEffects(() => {
          throw new Error('Test error');
        });
      }).toThrow('Test error');
    });
  });

  describe('Performance', () => {
    it('should update single text node in <1ms', () => {
      const count = signal(0);
      const textNode = createReactiveTextNode(() => count());

      const start = performance.now();
      count.set(1);
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(1);
      expect(textNode.textContent).toBe('1');
    });

    it('should handle 1000 simultaneous updates in <10ms', () => {
      const signals = Array.from({ length: 1000 }, (_, i) => signal(i));
      const nodes = signals.map((sig) => createReactiveTextNode(() => sig()));

      const start = performance.now();
      signals.forEach((sig, i) => sig.set(i + 1));
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(10);
      nodes.forEach((node, i) => {
        expect(node.textContent).toBe(String(i + 1));
      });
    });

    it('should handle 10000 updates in <50ms', () => {
      const count = signal(0);
      const textNode = createReactiveTextNode(() => count());

      const start = performance.now();
      for (let i = 1; i <= 10000; i++) {
        count.set(i);
      }
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(50);
      expect(textNode.textContent).toBe('10000');
    });

    it('should efficiently handle multiple effects on same node', () => {
      const title = signal('Title');
      const id = signal('id1');
      const color = signal('red');

      const div = document.createElement('div');
      createReactiveAttribute(div, 'title', () => title());
      createReactiveAttribute(div, 'id', () => id());
      createReactiveStyle(div, () => ({ color: color() }));

      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        title.set(`Title${i}`);
        id.set(`id${i}`);
        color.set(i % 2 === 0 ? 'red' : 'blue');
      }
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(50);
      expect(div.getAttribute('title')).toBe('Title999');
      expect(div.getAttribute('id')).toBe('id999');
      expect(div.style.color).toBe('blue');
    });
  });

  describe('Effect Lifecycle', () => {
    it('should properly initialize effect on creation', () => {
      const count = signal(0);
      const textNode = createReactiveTextNode(() => count());

      expect((textNode as any).__effect).toBeDefined();
      expect((textNode as any).__effect.dispose).toBeTypeOf('function');
    });

    it('should dispose effect and prevent further updates', () => {
      const count = signal(0);
      const textNode = createReactiveTextNode(() => count());

      const effect = (textNode as any).__effect;
      effect.dispose();

      const oldText = textNode.textContent;
      count.set(1);
      expect(textNode.textContent).toBe(oldText); // Should not update
    });

    it('should handle effect disposal via cleanupReactivity', () => {
      const count = signal(0);
      const vnode = createTextVNode('');
      const textNode = createReactiveTextNode(() => count());
      vnode.dom = textNode;
      vnode.effects = [(textNode as any).__effect];

      cleanupReactivity(vnode);

      const oldText = textNode.textContent;
      count.set(1);
      expect(textNode.textContent).toBe(oldText);
    });

    it('should not leak effects on cleanup', () => {
      const count = signal(0);
      const textNode = createReactiveTextNode(() => count());

      const vnode = createTextVNode('');
      vnode.dom = textNode;
      vnode.effects = [(textNode as any).__effect];

      cleanupReactivity(vnode);

      expect((textNode as any).__effect).toBeUndefined();
      expect(vnode.effects!.length).toBe(0);
    });
  });

  describe('Multiple Signals', () => {
    it('should track multiple signals in single effect', () => {
      const first = signal('Hello');
      const second = signal('World');
      const textNode = createReactiveTextNode(() => `${first()} ${second()}`);

      expect(textNode.textContent).toBe('Hello World');
      first.set('Hi');
      expect(textNode.textContent).toBe('Hi World');
      second.set('There');
      expect(textNode.textContent).toBe('Hi There');
    });

    it('should track multiple signals in style', () => {
      const color = signal('red');
      const size = signal(16);
      const div = document.createElement('div');
      createReactiveStyle(div, () => ({
        color: color(),
        fontSize: `${size()}px`,
      }));

      expect(div.style.color).toBe('red');
      expect(div.style.fontSize).toBe('16px');
      color.set('blue');
      expect(div.style.color).toBe('blue');
      expect(div.style.fontSize).toBe('16px');
      size.set(20);
      expect(div.style.color).toBe('blue');
      expect(div.style.fontSize).toBe('20px');
    });
  });

  describe('Nested Reactivity', () => {
    it('should handle nested components with reactivity', () => {
      const parentText = signal('Parent');
      const childText = signal('Child');

      const parentVNode = createElementVNode('div', { title: () => parentText() });
      const childVNode = createElementVNode('span', { title: () => childText() });
      parentVNode.children = [childVNode];

      const parentDom = document.createElement('div');
      const childDom = document.createElement('span');
      parentVNode.dom = parentDom;
      childVNode.dom = childDom;
      parentDom.appendChild(childDom);

      attachReactivity(parentVNode, parentDom);

      expect(parentDom.getAttribute('title')).toBe('Parent');
      expect(childDom.getAttribute('title')).toBe('Child');

      parentText.set('New Parent');
      childText.set('New Child');

      expect(parentDom.getAttribute('title')).toBe('New Parent');
      expect(childDom.getAttribute('title')).toBe('New Child');
    });

    it('should cleanup nested reactivity correctly', () => {
      const parentText = signal('Parent');
      const childText = signal('Child');

      const parentVNode = createElementVNode('div', { title: () => parentText() });
      const childVNode = createElementVNode('span', { title: () => childText() });
      parentVNode.children = [childVNode];

      const parentDom = document.createElement('div');
      const childDom = document.createElement('span');
      parentVNode.dom = parentDom;
      childVNode.dom = childDom;
      parentDom.appendChild(childDom);

      attachReactivity(parentVNode, parentDom);
      cleanupReactivity(parentVNode);

      const oldParentTitle = parentDom.getAttribute('title');
      const oldChildTitle = childDom.getAttribute('title');

      parentText.set('New Parent');
      childText.set('New Child');

      // Titles should not update after cleanup
      expect(parentDom.getAttribute('title')).toBe(oldParentTitle);
      expect(childDom.getAttribute('title')).toBe(oldChildTitle);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty style object', () => {
      const styles = signal<any>({});
      const div = document.createElement('div');
      createReactiveStyle(div, () => styles());

      expect(div.style.cssText).toBe('');
      styles.set({ color: 'red' });
      expect(div.style.color).toBe('red');
    });

    it('should handle style object with null values', () => {
      const div = document.createElement('div');
      createReactiveStyle(div, () => ({ color: null, fontSize: '16px' }));

      expect(div.style.color).toBe('');
      expect(div.style.fontSize).toBe('16px');
    });

    it('should handle reactive attribute with empty string', () => {
      const value = signal('');
      const div = document.createElement('div');
      createReactiveAttribute(div, 'data-value', () => value());

      expect(div.getAttribute('data-value')).toBe('');
      value.set('test');
      expect(div.getAttribute('data-value')).toBe('test');
    });

    it('should handle reactive property with falsy values', () => {
      const value = signal<any>('initial');
      const input = document.createElement('input');
      createReactiveProperty(input, 'value', () => value());

      expect(input.value).toBe('initial');
      value.set(0);
      expect(input.value).toBe('0'); // 0 is converted to string
      value.set('');
      expect(input.value).toBe('');
      value.set(false);
      expect(input.value).toBe('false'); // false is converted to string
      value.set(null);
      expect(input.value).toBe(''); // null becomes empty string for input.value
    });

    it('should handle vnode without props', () => {
      const vnode = createElementVNode('div');
      const dom = document.createElement('div');
      vnode.dom = dom;

      expect(() => attachReactivity(vnode, dom)).not.toThrow();
      expect(vnode.effects!.length).toBe(0);
    });

    it('should handle vnode without children', () => {
      const title = signal('Title');
      const vnode = createElementVNode('div', { title: () => title() });
      const dom = document.createElement('div');
      vnode.dom = dom;

      expect(() => attachReactivity(vnode, dom)).not.toThrow();
      expect((dom as HTMLElement).getAttribute('title')).toBe('Title');
    });
  });
});
