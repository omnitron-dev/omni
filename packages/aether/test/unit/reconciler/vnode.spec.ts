/**
 * VNode System Unit Tests
 *
 * Comprehensive tests for VNode creation, cloning, type guards,
 * children normalization, and utility functions.
 */

import { describe, test, expect } from 'vitest';
import {
  createElementVNode,
  createTextVNode,
  createComponentVNode,
  createFragmentVNode,
  cloneVNode,
  isElementVNode,
  isTextVNode,
  isComponentVNode,
  isFragmentVNode,
  normalizeChildren,
  createVNodeFromValue,
  getVNodeKey,
  VNodeType,
  type VNode,
  type ComponentFunction,
} from '../../../src/reconciler/vnode.js';

describe('VNode System', () => {
  describe('VNode Creation', () => {
    describe('createElementVNode', () => {
      test('creates element VNode with correct type and tag', () => {
        const vnode = createElementVNode('div');

        expect(vnode.type).toBe(VNodeType.ELEMENT);
        expect(vnode.tag).toBe('div');
      });

      test('initializes dom property as null', () => {
        const vnode = createElementVNode('span');

        expect(vnode.dom).toBe(null);
      });

      test('initializes effects as empty array', () => {
        const vnode = createElementVNode('div');

        expect(vnode.effects).toEqual([]);
      });

      test('creates element VNode with props', () => {
        const props = { class: 'container', id: 'main' };
        const vnode = createElementVNode('div', props);

        expect(vnode.props).toEqual(props);
      });

      test('handles null props by setting undefined', () => {
        const vnode = createElementVNode('div', null);

        expect(vnode.props).toBeUndefined();
      });

      test('creates element VNode with children', () => {
        const children = [createTextVNode('Hello'), createTextVNode('World')];
        const vnode = createElementVNode('div', null, children);

        expect(vnode.children).toEqual(children);
        expect(vnode.children).toHaveLength(2);
      });

      test('creates element VNode with key', () => {
        const vnode = createElementVNode('li', null, undefined, 'item-1');

        expect(vnode.key).toBe('item-1');
      });

      test('creates element VNode with numeric key', () => {
        const vnode = createElementVNode('li', null, undefined, 42);

        expect(vnode.key).toBe(42);
      });

      test('creates element VNode with all parameters', () => {
        const props = { class: 'item' };
        const children = [createTextVNode('Content')];
        const vnode = createElementVNode('div', props, children, 'item-1');

        expect(vnode.type).toBe(VNodeType.ELEMENT);
        expect(vnode.tag).toBe('div');
        expect(vnode.props).toEqual(props);
        expect(vnode.children).toEqual(children);
        expect(vnode.key).toBe('item-1');
        expect(vnode.dom).toBe(null);
        expect(vnode.effects).toEqual([]);
      });
    });

    describe('createTextVNode', () => {
      test('creates text VNode with correct type', () => {
        const vnode = createTextVNode('Hello');

        expect(vnode.type).toBe(VNodeType.TEXT);
      });

      test('stores text content', () => {
        const vnode = createTextVNode('Hello World');

        expect(vnode.text).toBe('Hello World');
      });

      test('initializes dom property as null', () => {
        const vnode = createTextVNode('Test');

        expect(vnode.dom).toBe(null);
      });

      test('initializes effects as empty array', () => {
        const vnode = createTextVNode('Test');

        expect(vnode.effects).toEqual([]);
      });

      test('creates text VNode with key', () => {
        const vnode = createTextVNode('Hello', 'text-1');

        expect(vnode.key).toBe('text-1');
        expect(vnode.text).toBe('Hello');
      });

      test('creates text VNode with numeric key', () => {
        const vnode = createTextVNode('Hello', 123);

        expect(vnode.key).toBe(123);
      });

      test('handles empty string', () => {
        const vnode = createTextVNode('');

        expect(vnode.text).toBe('');
        expect(vnode.type).toBe(VNodeType.TEXT);
      });
    });

    describe('createComponentVNode', () => {
      const TestComponent: ComponentFunction = (props: any) => createElementVNode('div', props);

      test('creates component VNode with correct type', () => {
        const vnode = createComponentVNode(TestComponent);

        expect(vnode.type).toBe(VNodeType.COMPONENT);
      });

      test('stores component function as tag', () => {
        const vnode = createComponentVNode(TestComponent);

        expect(vnode.tag).toBe(TestComponent);
      });

      test('initializes dom property as null', () => {
        const vnode = createComponentVNode(TestComponent);

        expect(vnode.dom).toBe(null);
      });

      test('initializes effects as empty array', () => {
        const vnode = createComponentVNode(TestComponent);

        expect(vnode.effects).toEqual([]);
      });

      test('creates component VNode with props', () => {
        const props = { name: 'World', count: 42 };
        const vnode = createComponentVNode(TestComponent, props);

        expect(vnode.props).toEqual(props);
      });

      test('handles null props by setting undefined', () => {
        const vnode = createComponentVNode(TestComponent, null);

        expect(vnode.props).toBeUndefined();
      });

      test('creates component VNode with key', () => {
        const vnode = createComponentVNode(TestComponent, null, 'comp-1');

        expect(vnode.key).toBe('comp-1');
      });

      test('creates component VNode with all parameters', () => {
        const props = { name: 'Test' };
        const vnode = createComponentVNode(TestComponent, props, 'comp-1');

        expect(vnode.type).toBe(VNodeType.COMPONENT);
        expect(vnode.tag).toBe(TestComponent);
        expect(vnode.props).toEqual(props);
        expect(vnode.key).toBe('comp-1');
        expect(vnode.dom).toBe(null);
        expect(vnode.effects).toEqual([]);
      });
    });

    describe('createFragmentVNode', () => {
      test('creates fragment VNode with correct type', () => {
        const vnode = createFragmentVNode();

        expect(vnode.type).toBe(VNodeType.FRAGMENT);
      });

      test('initializes empty children array when no children provided', () => {
        const vnode = createFragmentVNode();

        expect(vnode.children).toEqual([]);
      });

      test('initializes dom property as null', () => {
        const vnode = createFragmentVNode();

        expect(vnode.dom).toBe(null);
      });

      test('initializes effects as empty array', () => {
        const vnode = createFragmentVNode();

        expect(vnode.effects).toEqual([]);
      });

      test('creates fragment VNode with children', () => {
        const children = [createElementVNode('div'), createElementVNode('span')];
        const vnode = createFragmentVNode(children);

        expect(vnode.children).toEqual(children);
        expect(vnode.children).toHaveLength(2);
      });

      test('creates fragment VNode with key', () => {
        const vnode = createFragmentVNode(undefined, 'frag-1');

        expect(vnode.key).toBe('frag-1');
      });

      test('creates fragment VNode with children and key', () => {
        const children = [createTextVNode('Hello')];
        const vnode = createFragmentVNode(children, 'frag-1');

        expect(vnode.type).toBe(VNodeType.FRAGMENT);
        expect(vnode.children).toEqual(children);
        expect(vnode.key).toBe('frag-1');
        expect(vnode.dom).toBe(null);
        expect(vnode.effects).toEqual([]);
      });
    });
  });

  describe('VNode Cloning', () => {
    describe('cloneVNode', () => {
      test('creates shallow copy of element VNode', () => {
        const original = createElementVNode('div', { class: 'test' });
        const cloned = cloneVNode(original);

        expect(cloned).not.toBe(original);
        expect(cloned.type).toBe(original.type);
        expect(cloned.tag).toBe(original.tag);
        expect(cloned.props).toBe(original.props); // Shallow copy
      });

      test('resets dom property to null', () => {
        const original = createElementVNode('div');
        original.dom = document.createElement('div');

        const cloned = cloneVNode(original);

        expect(cloned.dom).toBe(null);
      });

      test('resets effects to empty array', () => {
        const original = createElementVNode('div');
        (original.effects as any[]).push({ id: 'test-effect' });

        const cloned = cloneVNode(original);

        expect(cloned.effects).toEqual([]);
        expect(cloned.effects).not.toBe(original.effects);
      });

      test('copies children array (not same reference)', () => {
        const children = [createTextVNode('Hello'), createTextVNode('World')];
        const original = createElementVNode('div', null, children);

        const cloned = cloneVNode(original);

        expect(cloned.children).toEqual(original.children);
        expect(cloned.children).not.toBe(original.children);
      });

      test('handles VNode without children', () => {
        const original = createElementVNode('div');

        const cloned = cloneVNode(original);

        expect(cloned.children).toBeUndefined();
      });

      test('preserves key', () => {
        const original = createElementVNode('div', null, undefined, 'test-key');

        const cloned = cloneVNode(original);

        expect(cloned.key).toBe('test-key');
      });

      test('clones text VNode correctly', () => {
        const original = createTextVNode('Hello', 'text-1');

        const cloned = cloneVNode(original);

        expect(cloned.type).toBe(VNodeType.TEXT);
        expect(cloned.text).toBe('Hello');
        expect(cloned.key).toBe('text-1');
        expect(cloned.dom).toBe(null);
        expect(cloned.effects).toEqual([]);
      });

      test('clones component VNode correctly', () => {
        const Component: ComponentFunction = () => createElementVNode('div');
        const original = createComponentVNode(Component, { name: 'Test' });

        const cloned = cloneVNode(original);

        expect(cloned.type).toBe(VNodeType.COMPONENT);
        expect(cloned.tag).toBe(Component);
        expect(cloned.props).toBe(original.props);
        expect(cloned.dom).toBe(null);
      });

      test('clones fragment VNode correctly', () => {
        const children = [createElementVNode('div')];
        const original = createFragmentVNode(children, 'frag-1');

        const cloned = cloneVNode(original);

        expect(cloned.type).toBe(VNodeType.FRAGMENT);
        expect(cloned.children).toEqual(children);
        expect(cloned.children).not.toBe(children);
        expect(cloned.key).toBe('frag-1');
      });
    });
  });

  describe('Type Guards', () => {
    describe('isElementVNode', () => {
      test('returns true for element VNode', () => {
        const vnode = createElementVNode('div');

        expect(isElementVNode(vnode)).toBe(true);
      });

      test('returns false for text VNode', () => {
        const vnode = createTextVNode('Hello');

        expect(isElementVNode(vnode)).toBe(false);
      });

      test('returns false for component VNode', () => {
        const Component: ComponentFunction = () => createElementVNode('div');
        const vnode = createComponentVNode(Component);

        expect(isElementVNode(vnode)).toBe(false);
      });

      test('returns false for fragment VNode', () => {
        const vnode = createFragmentVNode();

        expect(isElementVNode(vnode)).toBe(false);
      });
    });

    describe('isTextVNode', () => {
      test('returns true for text VNode', () => {
        const vnode = createTextVNode('Hello');

        expect(isTextVNode(vnode)).toBe(true);
      });

      test('returns false for element VNode', () => {
        const vnode = createElementVNode('div');

        expect(isTextVNode(vnode)).toBe(false);
      });

      test('returns false for component VNode', () => {
        const Component: ComponentFunction = () => createElementVNode('div');
        const vnode = createComponentVNode(Component);

        expect(isTextVNode(vnode)).toBe(false);
      });

      test('returns false for fragment VNode', () => {
        const vnode = createFragmentVNode();

        expect(isTextVNode(vnode)).toBe(false);
      });
    });

    describe('isComponentVNode', () => {
      test('returns true for component VNode', () => {
        const Component: ComponentFunction = () => createElementVNode('div');
        const vnode = createComponentVNode(Component);

        expect(isComponentVNode(vnode)).toBe(true);
      });

      test('returns false for element VNode', () => {
        const vnode = createElementVNode('div');

        expect(isComponentVNode(vnode)).toBe(false);
      });

      test('returns false for text VNode', () => {
        const vnode = createTextVNode('Hello');

        expect(isComponentVNode(vnode)).toBe(false);
      });

      test('returns false for fragment VNode', () => {
        const vnode = createFragmentVNode();

        expect(isComponentVNode(vnode)).toBe(false);
      });
    });

    describe('isFragmentVNode', () => {
      test('returns true for fragment VNode', () => {
        const vnode = createFragmentVNode();

        expect(isFragmentVNode(vnode)).toBe(true);
      });

      test('returns false for element VNode', () => {
        const vnode = createElementVNode('div');

        expect(isFragmentVNode(vnode)).toBe(false);
      });

      test('returns false for text VNode', () => {
        const vnode = createTextVNode('Hello');

        expect(isFragmentVNode(vnode)).toBe(false);
      });

      test('returns false for component VNode', () => {
        const Component: ComponentFunction = () => createElementVNode('div');
        const vnode = createComponentVNode(Component);

        expect(isFragmentVNode(vnode)).toBe(false);
      });
    });
  });

  describe('Children Normalization', () => {
    describe('normalizeChildren', () => {
      test('returns empty array for null', () => {
        const result = normalizeChildren(null);

        expect(result).toEqual([]);
      });

      test('returns empty array for undefined', () => {
        const result = normalizeChildren(undefined);

        expect(result).toEqual([]);
      });

      test('creates text VNode from string', () => {
        const result = normalizeChildren('Hello');

        expect(result).toHaveLength(1);
        expect(result[0].type).toBe(VNodeType.TEXT);
        expect(result[0].text).toBe('Hello');
      });

      test('creates text VNode from number', () => {
        const result = normalizeChildren(42);

        expect(result).toHaveLength(1);
        expect(result[0].type).toBe(VNodeType.TEXT);
        expect(result[0].text).toBe('42');
      });

      test('returns empty array for boolean true', () => {
        const result = normalizeChildren(true);

        expect(result).toEqual([]);
      });

      test('returns empty array for boolean false', () => {
        const result = normalizeChildren(false);

        expect(result).toEqual([]);
      });

      test('returns array with VNode for single VNode', () => {
        const vnode = createElementVNode('div');
        const result = normalizeChildren(vnode);

        expect(result).toEqual([vnode]);
      });

      test('flattens and normalizes array of strings', () => {
        const result = normalizeChildren(['Hello', 'World']);

        expect(result).toHaveLength(2);
        expect(result[0].type).toBe(VNodeType.TEXT);
        expect(result[0].text).toBe('Hello');
        expect(result[1].type).toBe(VNodeType.TEXT);
        expect(result[1].text).toBe('World');
      });

      test('flattens and normalizes array of numbers', () => {
        const result = normalizeChildren([1, 2, 3]);

        expect(result).toHaveLength(3);
        expect(result[0].text).toBe('1');
        expect(result[1].text).toBe('2');
        expect(result[2].text).toBe('3');
      });

      test('preserves VNodes in array', () => {
        const vnode1 = createElementVNode('div');
        const vnode2 = createTextVNode('Hello');
        const result = normalizeChildren([vnode1, vnode2]);

        expect(result).toEqual([vnode1, vnode2]);
      });

      test('flattens nested arrays', () => {
        const result = normalizeChildren(['Hello', ['World', ['!']]]);

        expect(result).toHaveLength(3);
        expect(result[0].text).toBe('Hello');
        expect(result[1].text).toBe('World');
        expect(result[2].text).toBe('!');
      });

      test('filters out null and undefined in array', () => {
        const result = normalizeChildren(['Hello', null, 'World', undefined]);

        expect(result).toHaveLength(2);
        expect(result[0].text).toBe('Hello');
        expect(result[1].text).toBe('World');
      });

      test('filters out booleans in array', () => {
        const result = normalizeChildren(['Hello', true, 'World', false]);

        expect(result).toHaveLength(2);
        expect(result[0].text).toBe('Hello');
        expect(result[1].text).toBe('World');
      });

      test('handles mixed array with strings, numbers, and VNodes', () => {
        const vnode = createElementVNode('div');
        const result = normalizeChildren(['Hello', 42, vnode, 'World']);

        expect(result).toHaveLength(4);
        expect(result[0].text).toBe('Hello');
        expect(result[1].text).toBe('42');
        expect(result[2]).toBe(vnode);
        expect(result[3].text).toBe('World');
      });

      test('handles empty array', () => {
        const result = normalizeChildren([]);

        expect(result).toEqual([]);
      });

      test('handles deeply nested arrays', () => {
        const result = normalizeChildren(['A', ['B', ['C', ['D']]]]);

        expect(result).toHaveLength(4);
        expect(result[0].text).toBe('A');
        expect(result[1].text).toBe('B');
        expect(result[2].text).toBe('C');
        expect(result[3].text).toBe('D');
      });
    });
  });

  describe('Utility Functions', () => {
    describe('createVNodeFromValue', () => {
      test('returns VNode as-is if already a VNode', () => {
        const vnode = createElementVNode('div');
        const result = createVNodeFromValue(vnode);

        expect(result).toBe(vnode);
      });

      test('creates text VNode from string', () => {
        const result = createVNodeFromValue('Hello');

        expect(result.type).toBe(VNodeType.TEXT);
        expect(result.text).toBe('Hello');
      });

      test('creates text VNode from number', () => {
        const result = createVNodeFromValue(42);

        expect(result.type).toBe(VNodeType.TEXT);
        expect(result.text).toBe('42');
      });

      test('creates empty text VNode from null', () => {
        const result = createVNodeFromValue(null);

        expect(result.type).toBe(VNodeType.TEXT);
        expect(result.text).toBe('');
      });

      test('creates empty text VNode from undefined', () => {
        const result = createVNodeFromValue(undefined);

        expect(result.type).toBe(VNodeType.TEXT);
        expect(result.text).toBe('');
      });

      test('creates empty text VNode from boolean', () => {
        const result = createVNodeFromValue(true);

        expect(result.type).toBe(VNodeType.TEXT);
        expect(result.text).toBe('');
      });

      test('handles zero', () => {
        const result = createVNodeFromValue(0);

        expect(result.type).toBe(VNodeType.TEXT);
        expect(result.text).toBe('0');
      });

      test('handles empty string', () => {
        const result = createVNodeFromValue('');

        expect(result.type).toBe(VNodeType.TEXT);
        expect(result.text).toBe('');
      });
    });

    describe('getVNodeKey', () => {
      test('returns explicit string key', () => {
        const vnode = createElementVNode('div', null, undefined, 'my-key');
        const result = getVNodeKey(vnode, 0);

        expect(result).toBe('my-key');
      });

      test('returns explicit numeric key as string', () => {
        const vnode = createElementVNode('div', null, undefined, 42);
        const result = getVNodeKey(vnode, 0);

        expect(result).toBe('42');
      });

      test('returns index fallback when no key', () => {
        const vnode = createElementVNode('div');
        const result = getVNodeKey(vnode, 5);

        expect(result).toBe('__index_5');
      });

      test('prefers explicit key over index', () => {
        const vnode = createElementVNode('div', null, undefined, 'key-1');
        const result = getVNodeKey(vnode, 999);

        expect(result).toBe('key-1');
      });

      test('handles zero as valid key', () => {
        const vnode = createElementVNode('div', null, undefined, 0);
        const result = getVNodeKey(vnode, 5);

        expect(result).toBe('0');
      });

      test('handles zero index fallback', () => {
        const vnode = createElementVNode('div');
        const result = getVNodeKey(vnode, 0);

        expect(result).toBe('__index_0');
      });
    });
  });

  describe('Edge Cases', () => {
    test('creates element VNode with empty string tag', () => {
      const vnode = createElementVNode('');

      expect(vnode.type).toBe(VNodeType.ELEMENT);
      expect(vnode.tag).toBe('');
    });

    test('creates element VNode with empty children array', () => {
      const vnode = createElementVNode('div', null, []);

      expect(vnode.children).toEqual([]);
    });

    test('creates element VNode with nested empty arrays', () => {
      const vnode = createElementVNode('div', null, []);
      const normalized = normalizeChildren(vnode.children);

      expect(normalized).toEqual([]);
    });

    test('handles VNode with all optional properties set', () => {
      const props = { class: 'test' };
      const children = [createTextVNode('Hello')];
      const vnode = createElementVNode('div', props, children, 'key-1');

      vnode.dom = document.createElement('div');
      vnode.parent = null;
      (vnode.effects as any[]).push({ id: 'effect-1' });

      expect(vnode.type).toBe(VNodeType.ELEMENT);
      expect(vnode.tag).toBe('div');
      expect(vnode.props).toEqual(props);
      expect(vnode.children).toEqual(children);
      expect(vnode.key).toBe('key-1');
      expect(vnode.dom).toBeTruthy();
      expect(vnode.parent).toBe(null);
      expect(vnode.effects).toHaveLength(1);
    });

    test('normalizeChildren handles object without type property', () => {
      const result = normalizeChildren({ foo: 'bar' });

      expect(result).toEqual([]);
    });

    test('cloneVNode preserves all primitive properties', () => {
      const original = createElementVNode('div', { id: 'test' }, [], 'key-1');

      const cloned = cloneVNode(original);

      expect(cloned.type).toBe(original.type);
      expect(cloned.tag).toBe(original.tag);
      expect(cloned.props).toBe(original.props);
      expect(cloned.key).toBe(original.key);
    });

    test('type guards work with modified VNode', () => {
      const vnode = createElementVNode('div');
      vnode.dom = document.createElement('div');
      vnode.parent = null;

      expect(isElementVNode(vnode)).toBe(true);
      expect(isTextVNode(vnode)).toBe(false);
      expect(isComponentVNode(vnode)).toBe(false);
      expect(isFragmentVNode(vnode)).toBe(false);
    });
  });
});
