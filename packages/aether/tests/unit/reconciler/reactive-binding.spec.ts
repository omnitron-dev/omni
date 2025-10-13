/**
 * Reactive Binding System Unit Tests
 *
 * Comprehensive tests for reactive bindings between signals and DOM nodes,
 * including text nodes, attributes, properties, styles, and classes.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { signal } from '../../../src/core/reactivity/signal.js';
import {
  bindSignalToTextNode,
  bindSignalToAttribute,
  bindSignalToProperty,
  bindSignalToStyle,
  bindSignalToClass,
  type ReactiveBinding,
} from '../../../src/reconciler/reactive-binding.js';

describe('Reactive Binding System', () => {
  describe('bindSignalToTextNode', () => {
    test('sets initial text content from signal', () => {
      const count = signal(42);
      const node = document.createTextNode('');

      bindSignalToTextNode(node, () => count());

      expect(node.textContent).toBe('42');
    });

    test('updates text when signal changes', () => {
      const count = signal(0);
      const node = document.createTextNode('');

      bindSignalToTextNode(node, () => count());
      expect(node.textContent).toBe('0');

      count.set(1);
      expect(node.textContent).toBe('1');

      count.set(42);
      expect(node.textContent).toBe('42');
    });

    test('converts null to empty string', () => {
      const value = signal<string | null>(null);
      const node = document.createTextNode('');

      bindSignalToTextNode(node, () => value());

      expect(node.textContent).toBe('');
    });

    test('converts undefined to empty string', () => {
      const value = signal<string | undefined>(undefined);
      const node = document.createTextNode('');

      bindSignalToTextNode(node, () => value());

      expect(node.textContent).toBe('');
    });

    test('converts number to string', () => {
      const num = signal(123);
      const node = document.createTextNode('');

      bindSignalToTextNode(node, () => num());

      expect(node.textContent).toBe('123');
    });

    test('converts boolean to string', () => {
      const bool = signal(true);
      const node = document.createTextNode('');

      bindSignalToTextNode(node, () => bool());

      expect(node.textContent).toBe('true');

      bool.set(false);
      expect(node.textContent).toBe('false');
    });

    test('handles string concatenation with multiple signals', () => {
      const firstName = signal('John');
      const lastName = signal('Doe');
      const node = document.createTextNode('');

      bindSignalToTextNode(node, () => `${firstName()} ${lastName()}`);

      expect(node.textContent).toBe('John Doe');

      firstName.set('Jane');
      expect(node.textContent).toBe('Jane Doe');
    });

    test('returns ReactiveBinding with cleanup function', () => {
      const count = signal(0);
      const node = document.createTextNode('');

      const binding = bindSignalToTextNode(node, () => count());

      expect(binding).toBeDefined();
      expect(binding.node).toBe(node);
      expect(binding.effect).toBeDefined();
      expect(binding.cleanup).toBeTypeOf('function');
    });

    test('cleanup disposes effect and stops updates', () => {
      const count = signal(0);
      const node = document.createTextNode('');

      const binding = bindSignalToTextNode(node, () => count());
      expect(node.textContent).toBe('0');

      binding.cleanup?.();

      count.set(42);
      // After cleanup, text should not update
      expect(node.textContent).toBe('0');
    });
  });

  describe('bindSignalToAttribute', () => {
    let element: HTMLElement;

    beforeEach(() => {
      element = document.createElement('div');
    });

    test('sets attribute from signal initially', () => {
      const id = signal('main');

      bindSignalToAttribute(element, 'id', () => id());

      expect(element.getAttribute('id')).toBe('main');
    });

    test('updates attribute when signal changes', () => {
      const id = signal('initial');

      bindSignalToAttribute(element, 'id', () => id());
      expect(element.getAttribute('id')).toBe('initial');

      id.set('updated');
      expect(element.getAttribute('id')).toBe('updated');

      id.set('final');
      expect(element.getAttribute('id')).toBe('final');
    });

    test('removes attribute when value is null', () => {
      const value = signal<string | null>('present');

      bindSignalToAttribute(element, 'data-test', () => value());
      expect(element.getAttribute('data-test')).toBe('present');

      value.set(null);
      expect(element.getAttribute('data-test')).toBe(null);
    });

    test('removes attribute when value is undefined', () => {
      const value = signal<string | undefined>('present');

      bindSignalToAttribute(element, 'data-test', () => value());
      expect(element.getAttribute('data-test')).toBe('present');

      value.set(undefined);
      expect(element.getAttribute('data-test')).toBe(null);
    });

    test('converts number to string for attribute', () => {
      const num = signal(42);

      bindSignalToAttribute(element, 'data-count', () => num());

      expect(element.getAttribute('data-count')).toBe('42');
    });

    test('handles multiple attributes on same element', () => {
      const id = signal('main');
      const cls = signal('container');

      bindSignalToAttribute(element, 'id', () => id());
      bindSignalToAttribute(element, 'class', () => cls());

      expect(element.getAttribute('id')).toBe('main');
      expect(element.getAttribute('class')).toBe('container');

      id.set('content');
      cls.set('wrapper');

      expect(element.getAttribute('id')).toBe('content');
      expect(element.getAttribute('class')).toBe('wrapper');
    });

    test('handles data attributes', () => {
      const value = signal('test-value');

      bindSignalToAttribute(element, 'data-test', () => value());

      expect(element.getAttribute('data-test')).toBe('test-value');
    });

    test('handles aria attributes', () => {
      const label = signal('Submit form');

      bindSignalToAttribute(element, 'aria-label', () => label());

      expect(element.getAttribute('aria-label')).toBe('Submit form');
    });

    test('returns ReactiveBinding with cleanup function', () => {
      const id = signal('main');

      const binding = bindSignalToAttribute(element, 'id', () => id());

      expect(binding).toBeDefined();
      expect(binding.node).toBe(element);
      expect(binding.effect).toBeDefined();
      expect(binding.cleanup).toBeTypeOf('function');
    });

    test('cleanup disposes effect and stops updates', () => {
      const id = signal('initial');

      const binding = bindSignalToAttribute(element, 'id', () => id());
      expect(element.getAttribute('id')).toBe('initial');

      binding.cleanup?.();

      id.set('updated');
      // After cleanup, attribute should not update
      expect(element.getAttribute('id')).toBe('initial');
    });
  });

  describe('bindSignalToProperty', () => {
    test('sets property from signal initially', () => {
      const input = document.createElement('input');
      const value = signal('hello');

      bindSignalToProperty(input, 'value', () => value());

      expect(input.value).toBe('hello');
    });

    test('updates property when signal changes', () => {
      const input = document.createElement('input');
      const value = signal('initial');

      bindSignalToProperty(input, 'value', () => value());
      expect(input.value).toBe('initial');

      value.set('updated');
      expect(input.value).toBe('updated');
    });

    test('binds to checked property for checkbox', () => {
      const input = document.createElement('input');
      input.type = 'checkbox';
      const checked = signal(false);

      bindSignalToProperty(input, 'checked', () => checked());

      expect(input.checked).toBe(false);

      checked.set(true);
      expect(input.checked).toBe(true);
    });

    test('binds to disabled property', () => {
      const button = document.createElement('button');
      const disabled = signal(false);

      bindSignalToProperty(button, 'disabled', () => disabled());

      expect(button.disabled).toBe(false);

      disabled.set(true);
      expect(button.disabled).toBe(true);
    });

    test('binds to className property', () => {
      const div = document.createElement('div');
      const className = signal('container');

      bindSignalToProperty(div, 'className', () => className());

      expect(div.className).toBe('container');

      className.set('wrapper');
      expect(div.className).toBe('wrapper');
    });

    test('binds to textContent property', () => {
      const div = document.createElement('div');
      const text = signal('Hello');

      bindSignalToProperty(div, 'textContent', () => text());

      expect(div.textContent).toBe('Hello');

      text.set('World');
      expect(div.textContent).toBe('World');
    });

    test('handles different property types', () => {
      const input = document.createElement('input');
      const maxLength = signal(10);

      bindSignalToProperty(input, 'maxLength', () => maxLength());

      expect(input.maxLength).toBe(10);

      maxLength.set(20);
      expect(input.maxLength).toBe(20);
    });

    test('returns ReactiveBinding with cleanup function', () => {
      const input = document.createElement('input');
      const value = signal('test');

      const binding = bindSignalToProperty(input, 'value', () => value());

      expect(binding).toBeDefined();
      expect(binding.node).toBe(input);
      expect(binding.effect).toBeDefined();
      expect(binding.cleanup).toBeTypeOf('function');
    });

    test('cleanup disposes effect and stops updates', () => {
      const input = document.createElement('input');
      const value = signal('initial');

      const binding = bindSignalToProperty(input, 'value', () => value());
      expect(input.value).toBe('initial');

      binding.cleanup?.();

      value.set('updated');
      // After cleanup, property should not update
      expect(input.value).toBe('initial');
    });
  });

  describe('bindSignalToStyle', () => {
    let element: HTMLElement;

    beforeEach(() => {
      element = document.createElement('div');
    });

    test('applies style object from signal', () => {
      const styles = signal({ color: 'red', fontSize: '16px' });

      bindSignalToStyle(element, () => styles());

      expect(element.style.color).toBe('red');
      expect(element.style.fontSize).toBe('16px');
    });

    test('updates styles when signal changes', () => {
      const styles = signal({ color: 'red' });

      bindSignalToStyle(element, () => styles());
      expect(element.style.color).toBe('red');

      styles.set({ color: 'blue' });
      expect(element.style.color).toBe('blue');
    });

    test('converts camelCase to kebab-case', () => {
      const styles = signal({ backgroundColor: 'blue' });

      bindSignalToStyle(element, () => styles());

      expect(element.style.backgroundColor).toBe('blue');
      // Also check via getPropertyValue
      expect(element.style.getPropertyValue('background-color')).toBe('blue');
    });

    test('handles multiple style properties', () => {
      const styles = signal({
        color: 'red',
        backgroundColor: 'blue',
        fontSize: '14px',
        fontWeight: 'bold',
      });

      bindSignalToStyle(element, () => styles());

      expect(element.style.color).toBe('red');
      expect(element.style.backgroundColor).toBe('blue');
      expect(element.style.fontSize).toBe('14px');
      expect(element.style.fontWeight).toBe('bold');
    });

    test('removes style property when value is null', () => {
      const styles = signal<Record<string, string | null>>({ color: 'red' });

      bindSignalToStyle(element, () => styles());
      expect(element.style.color).toBe('red');

      styles.set({ color: null });
      expect(element.style.color).toBe('');
    });

    test('removes style property when value is undefined', () => {
      const styles = signal<Record<string, string | undefined>>({ color: 'red' });

      bindSignalToStyle(element, () => styles());
      expect(element.style.color).toBe('red');

      styles.set({ color: undefined });
      expect(element.style.color).toBe('');
    });

    test('handles complex camelCase conversion', () => {
      const styles = signal({
        borderTopLeftRadius: '5px',
        WebkitTransform: 'rotate(45deg)',
      });

      bindSignalToStyle(element, () => styles());

      expect(element.style.borderTopLeftRadius).toBe('5px');
    });

    test('handles dynamic style changes', () => {
      const color = signal('red');
      const size = signal(16);

      bindSignalToStyle(element, () => ({
        color: color(),
        fontSize: `${size()}px`,
      }));

      expect(element.style.color).toBe('red');
      expect(element.style.fontSize).toBe('16px');

      color.set('blue');
      size.set(20);

      expect(element.style.color).toBe('blue');
      expect(element.style.fontSize).toBe('20px');
    });

    test('returns ReactiveBinding with cleanup function', () => {
      const styles = signal({ color: 'red' });

      const binding = bindSignalToStyle(element, () => styles());

      expect(binding).toBeDefined();
      expect(binding.node).toBe(element);
      expect(binding.effect).toBeDefined();
      expect(binding.cleanup).toBeTypeOf('function');
    });

    test('cleanup disposes effect and stops updates', () => {
      const styles = signal({ color: 'red' });

      const binding = bindSignalToStyle(element, () => styles());
      expect(element.style.color).toBe('red');

      binding.cleanup?.();

      styles.set({ color: 'blue' });
      // After cleanup, styles should not update
      expect(element.style.color).toBe('red');
    });
  });

  describe('bindSignalToClass', () => {
    let element: HTMLElement;

    beforeEach(() => {
      element = document.createElement('div');
    });

    test('applies string class from signal', () => {
      const classes = signal('foo bar');

      bindSignalToClass(element, () => classes());

      expect(element.className).toBe('foo bar');
    });

    test('updates class when signal changes', () => {
      const classes = signal('initial');

      bindSignalToClass(element, () => classes());
      expect(element.className).toBe('initial');

      classes.set('updated');
      expect(element.className).toBe('updated');
    });

    test('handles array class format', () => {
      const classes = signal(['foo', 'bar', 'baz']);

      bindSignalToClass(element, () => classes());

      expect(element.className).toBe('foo bar baz');
    });

    test('filters falsy values from array', () => {
      const classes = signal(['foo', null, 'bar', undefined, '', 'baz', false]);

      bindSignalToClass(element, () => classes());

      expect(element.className).toBe('foo bar baz');
    });

    test('handles object class format with truthy keys', () => {
      const classes = signal({
        active: true,
        disabled: false,
        visible: true,
      });

      bindSignalToClass(element, () => classes());

      expect(element.className).toBe('active visible');
    });

    test('updates object classes when signal changes', () => {
      const isActive = signal(true);
      const isDisabled = signal(false);

      bindSignalToClass(element, () => ({
        active: isActive(),
        disabled: isDisabled(),
      }));

      expect(element.className).toBe('active');

      isDisabled.set(true);
      expect(element.className).toBe('active disabled');

      isActive.set(false);
      expect(element.className).toBe('disabled');
    });

    test('handles null class value', () => {
      const classes = signal<string | null>(null);

      bindSignalToClass(element, () => classes());

      expect(element.className).toBe('');
    });

    test('handles undefined class value', () => {
      const classes = signal<string | undefined>(undefined);

      bindSignalToClass(element, () => classes());

      expect(element.className).toBe('');
    });

    test('handles empty array', () => {
      const classes = signal([]);

      bindSignalToClass(element, () => classes());

      expect(element.className).toBe('');
    });

    test('handles empty object', () => {
      const classes = signal({});

      bindSignalToClass(element, () => classes());

      expect(element.className).toBe('');
    });

    test('handles mixed truthy and falsy object values', () => {
      const classes = signal({
        foo: 1,
        bar: 'yes',
        baz: 0,
        qux: '',
        quux: null,
        corge: undefined,
        grault: true,
      });

      bindSignalToClass(element, () => classes());

      expect(element.className).toBe('foo bar grault');
    });

    test('converts non-standard types to string', () => {
      const classes = signal(123);

      bindSignalToClass(element, () => classes());

      expect(element.className).toBe('123');
    });

    test('returns ReactiveBinding with cleanup function', () => {
      const classes = signal('test');

      const binding = bindSignalToClass(element, () => classes());

      expect(binding).toBeDefined();
      expect(binding.node).toBe(element);
      expect(binding.effect).toBeDefined();
      expect(binding.cleanup).toBeTypeOf('function');
    });

    test('cleanup disposes effect and stops updates', () => {
      const classes = signal('initial');

      const binding = bindSignalToClass(element, () => classes());
      expect(element.className).toBe('initial');

      binding.cleanup?.();

      classes.set('updated');
      // After cleanup, classes should not update
      expect(element.className).toBe('initial');
    });
  });

  describe('Cleanup and Lifecycle', () => {
    test('all binding functions return cleanup function', () => {
      const textNode = document.createTextNode('');
      const element = document.createElement('div');
      const s = signal('test');

      const bindings: ReactiveBinding[] = [
        bindSignalToTextNode(textNode, () => s()),
        bindSignalToAttribute(element, 'id', () => s()),
        bindSignalToProperty(element, 'textContent', () => s()),
        bindSignalToStyle(element, () => ({ color: s() })),
        bindSignalToClass(element, () => s()),
      ];

      for (const binding of bindings) {
        expect(binding.cleanup).toBeTypeOf('function');
        expect(binding.effect).toBeDefined();
        expect(binding.node).toBeDefined();
      }
    });

    test('cleanup prevents further updates across all binding types', () => {
      const s = signal('initial');
      const textNode = document.createTextNode('');
      const element = document.createElement('div');

      const textBinding = bindSignalToTextNode(textNode, () => s());
      const attrBinding = bindSignalToAttribute(element, 'data-test', () => s());
      const styleBinding = bindSignalToStyle(element, () => ({ color: s() }));

      // Initial values
      expect(textNode.textContent).toBe('initial');
      expect(element.getAttribute('data-test')).toBe('initial');
      expect(element.style.color).toBe('initial');

      // Cleanup all bindings
      textBinding.cleanup?.();
      attrBinding.cleanup?.();
      styleBinding.cleanup?.();

      // Update signal
      s.set('updated');

      // Values should remain unchanged after cleanup
      expect(textNode.textContent).toBe('initial');
      expect(element.getAttribute('data-test')).toBe('initial');
      expect(element.style.color).toBe('initial');
    });

    test('effect can be disposed multiple times safely', () => {
      const s = signal('test');
      const textNode = document.createTextNode('');

      const binding = bindSignalToTextNode(textNode, () => s());

      expect(() => {
        binding.cleanup?.();
        binding.cleanup?.();
        binding.cleanup?.();
      }).not.toThrow();
    });

    test('bindings work independently', () => {
      const s1 = signal('first');
      const s2 = signal('second');
      const node1 = document.createTextNode('');
      const node2 = document.createTextNode('');

      const binding1 = bindSignalToTextNode(node1, () => s1());
      const binding2 = bindSignalToTextNode(node2, () => s2());

      expect(node1.textContent).toBe('first');
      expect(node2.textContent).toBe('second');

      // Cleanup first binding
      binding1.cleanup?.();

      // Update both signals
      s1.set('updated-first');
      s2.set('updated-second');

      // First should not update, second should
      expect(node1.textContent).toBe('first');
      expect(node2.textContent).toBe('updated-second');
    });
  });
});
