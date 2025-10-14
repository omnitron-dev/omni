/**
 * Diffing Algorithm Unit Tests
 *
 * Comprehensive tests for VNode diffing, prop diffing, and children diffing.
 * Tests cover simple changes, complex scenarios, edge cases, and performance.
 */

import { describe, test, expect } from 'vitest';
import {
  diff,
  diffProps,
  diffChildren,
  PatchType,
  shallowEqual,
} from '../../../src/reconciler/diff.js';
import { diffChildrenWithKeys, diffChildrenByIndex, detectListPattern } from '../../../src/reconciler/diff-children.js';
import {
  createElementVNode,
  createTextVNode,
  createComponentVNode,
  createFragmentVNode,
  type ComponentFunction,
} from '../../../src/reconciler/vnode.js';

describe('Diffing Algorithm', () => {
  describe('diff() - Main Diffing Function', () => {
    describe('Null Cases', () => {
      test('both null returns empty patches', () => {
        const patches = diff(null, null);

        expect(patches).toEqual([]);
      });

      test('old null, new VNode returns CREATE patch', () => {
        const newVNode = createElementVNode('div');
        const patches = diff(null, newVNode);

        expect(patches).toHaveLength(1);
        expect(patches[0].type).toBe(PatchType.CREATE);
        expect(patches[0].newVNode).toBe(newVNode);
      });

      test('old VNode, new null returns REMOVE patch', () => {
        const oldVNode = createElementVNode('div');
        const patches = diff(oldVNode, null);

        expect(patches).toHaveLength(1);
        expect(patches[0].type).toBe(PatchType.REMOVE);
        expect(patches[0].vnode).toBe(oldVNode);
      });
    });

    describe('Type Changes', () => {
      test('different VNode types returns REPLACE patch', () => {
        const oldVNode = createElementVNode('div');
        const newVNode = createTextVNode('Hello');
        const patches = diff(oldVNode, newVNode);

        expect(patches).toHaveLength(1);
        expect(patches[0].type).toBe(PatchType.REPLACE);
        expect(patches[0].vnode).toBe(oldVNode);
        expect(patches[0].newVNode).toBe(newVNode);
      });

      test('element to text returns REPLACE', () => {
        const oldVNode = createElementVNode('span');
        const newVNode = createTextVNode('Text');
        const patches = diff(oldVNode, newVNode);

        expect(patches[0].type).toBe(PatchType.REPLACE);
      });

      test('text to component returns REPLACE', () => {
        const Component: ComponentFunction = () => createElementVNode('div');
        const oldVNode = createTextVNode('Hello');
        const newVNode = createComponentVNode(Component);
        const patches = diff(oldVNode, newVNode);

        expect(patches[0].type).toBe(PatchType.REPLACE);
      });

      test('component to fragment returns REPLACE', () => {
        const Component: ComponentFunction = () => createElementVNode('div');
        const oldVNode = createComponentVNode(Component);
        const newVNode = createFragmentVNode();
        const patches = diff(oldVNode, newVNode);

        expect(patches[0].type).toBe(PatchType.REPLACE);
      });
    });

    describe('Tag Changes', () => {
      test('different element tags returns REPLACE patch', () => {
        const oldVNode = createElementVNode('div');
        const newVNode = createElementVNode('span');
        const patches = diff(oldVNode, newVNode);

        expect(patches).toHaveLength(1);
        expect(patches[0].type).toBe(PatchType.REPLACE);
      });

      test('different component functions returns REPLACE patch', () => {
        const Component1: ComponentFunction = () => createElementVNode('div');
        const Component2: ComponentFunction = () => createElementVNode('span');
        const oldVNode = createComponentVNode(Component1);
        const newVNode = createComponentVNode(Component2);
        const patches = diff(oldVNode, newVNode);

        expect(patches[0].type).toBe(PatchType.REPLACE);
      });

      test('same element tag, different case returns REPLACE', () => {
        // In reality, tags should be normalized, but test the behavior
        const oldVNode = createElementVNode('DIV');
        const newVNode = createElementVNode('div');
        const patches = diff(oldVNode, newVNode);

        expect(patches[0].type).toBe(PatchType.REPLACE);
      });
    });

    describe('Text Node Changes', () => {
      test('same text returns no patches', () => {
        const oldVNode = createTextVNode('Hello');
        const newVNode = createTextVNode('Hello');
        const patches = diff(oldVNode, newVNode);

        expect(patches).toEqual([]);
      });

      test('different text returns TEXT patch', () => {
        const oldVNode = createTextVNode('Hello');
        const newVNode = createTextVNode('World');
        const patches = diff(oldVNode, newVNode);

        expect(patches).toHaveLength(1);
        expect(patches[0].type).toBe(PatchType.TEXT);
        expect(patches[0].text).toBe('World');
        expect(patches[0].vnode).toBe(oldVNode);
        expect(patches[0].newVNode).toBe(newVNode);
      });

      test('empty string to text returns TEXT patch', () => {
        const oldVNode = createTextVNode('');
        const newVNode = createTextVNode('Hello');
        const patches = diff(oldVNode, newVNode);

        expect(patches[0].type).toBe(PatchType.TEXT);
        expect(patches[0].text).toBe('Hello');
      });

      test('text to empty string returns TEXT patch', () => {
        const oldVNode = createTextVNode('Hello');
        const newVNode = createTextVNode('');
        const patches = diff(oldVNode, newVNode);

        expect(patches[0].type).toBe(PatchType.TEXT);
        expect(patches[0].text).toBe('');
      });
    });

    describe('Element Node Updates', () => {
      test('same element, no changes returns empty patches', () => {
        const oldVNode = createElementVNode('div', { class: 'test' });
        const newVNode = createElementVNode('div', { class: 'test' });
        const patches = diff(oldVNode, newVNode);

        expect(patches).toEqual([]);
      });

      test('changed attribute returns UPDATE patch', () => {
        const oldVNode = createElementVNode('div', { class: 'old' });
        const newVNode = createElementVNode('div', { class: 'new' });
        const patches = diff(oldVNode, newVNode);

        expect(patches).toHaveLength(1);
        expect(patches[0].type).toBe(PatchType.UPDATE);
        expect(patches[0].props?.set).toEqual({ class: 'new' });
      });

      test('added attribute returns UPDATE patch', () => {
        const oldVNode = createElementVNode('div');
        const newVNode = createElementVNode('div', { class: 'test' });
        const patches = diff(oldVNode, newVNode);

        expect(patches[0].type).toBe(PatchType.UPDATE);
        expect(patches[0].props?.set).toEqual({ class: 'test' });
      });

      test('removed attribute returns UPDATE patch', () => {
        const oldVNode = createElementVNode('div', { class: 'test' });
        const newVNode = createElementVNode('div');
        const patches = diff(oldVNode, newVNode);

        expect(patches[0].type).toBe(PatchType.UPDATE);
        expect(patches[0].props?.remove).toEqual(['class']);
      });

      test('changed children returns UPDATE patch', () => {
        const oldVNode = createElementVNode('div', null, [createTextVNode('Old')]);
        const newVNode = createElementVNode('div', null, [createTextVNode('New')]);
        const patches = diff(oldVNode, newVNode);

        expect(patches[0].type).toBe(PatchType.UPDATE);
        expect(patches[0].children).toBeDefined();
        expect(patches[0].children!.length).toBeGreaterThan(0);
      });
    });
  });

  describe('diffProps() - Property Diffing', () => {
    test('no props returns empty patch', () => {
      const patch = diffProps(undefined, undefined);

      expect(patch).toEqual({});
    });

    test('identical props returns empty patch', () => {
      const props = { class: 'test', id: 'main' };
      const patch = diffProps(props, props);

      expect(patch).toEqual({});
    });

    test('added prop returns set operation', () => {
      const oldProps = { class: 'test' };
      const newProps = { class: 'test', id: 'main' };
      const patch = diffProps(oldProps, newProps);

      expect(patch.set).toEqual({ id: 'main' });
      expect(patch.remove).toBeUndefined();
    });

    test('removed prop returns remove operation', () => {
      const oldProps = { class: 'test', id: 'main' };
      const newProps = { class: 'test' };
      const patch = diffProps(oldProps, newProps);

      expect(patch.remove).toEqual(['id']);
      expect(patch.set).toBeUndefined();
    });

    test('changed prop returns set operation', () => {
      const oldProps = { class: 'old' };
      const newProps = { class: 'new' };
      const patch = diffProps(oldProps, newProps);

      expect(patch.set).toEqual({ class: 'new' });
    });

    test('multiple added props', () => {
      const oldProps = {};
      const newProps = { class: 'test', id: 'main', title: 'Test' };
      const patch = diffProps(oldProps, newProps);

      expect(patch.set).toEqual({ class: 'test', id: 'main', title: 'Test' });
    });

    test('multiple removed props', () => {
      const oldProps = { class: 'test', id: 'main', title: 'Test' };
      const newProps = {};
      const patch = diffProps(oldProps, newProps);

      expect(patch.remove).toEqual(['class', 'id', 'title']);
    });

    test('mixed add, remove, and change', () => {
      const oldProps = { class: 'old', id: 'main', title: 'Test' };
      const newProps = { class: 'new', role: 'button' };
      const patch = diffProps(oldProps, newProps);

      expect(patch.set).toEqual({ class: 'new', role: 'button' });
      expect(patch.remove).toEqual(['id', 'title']);
    });

    test('null to props', () => {
      const patch = diffProps(undefined, { class: 'test' });

      expect(patch.set).toEqual({ class: 'test' });
    });

    test('props to null', () => {
      const patch = diffProps({ class: 'test' }, undefined);

      expect(patch.remove).toEqual(['class']);
    });

    test('prop value change from string to number', () => {
      const oldProps = { value: '42' };
      const newProps = { value: 42 };
      const patch = diffProps(oldProps, newProps);

      expect(patch.set).toEqual({ value: 42 });
    });

    test('prop value change from truthy to falsy', () => {
      const oldProps = { disabled: true };
      const newProps = { disabled: false };
      const patch = diffProps(oldProps, newProps);

      expect(patch.set).toEqual({ disabled: false });
    });
  });

  describe('diffChildren() - Children Diffing', () => {
    describe('Empty Cases', () => {
      test('both empty returns no patches', () => {
        const patches = diffChildren([], [], false);

        expect(patches).toEqual([]);
      });

      test('old empty, new has children returns CREATE patches', () => {
        const newChildren = [createTextVNode('A'), createTextVNode('B')];
        const patches = diffChildren([], newChildren, false);

        expect(patches).toHaveLength(2);
        expect(patches[0].type).toBe(PatchType.CREATE);
        expect(patches[1].type).toBe(PatchType.CREATE);
      });

      test('old has children, new empty returns REMOVE patches', () => {
        const oldChildren = [createTextVNode('A'), createTextVNode('B')];
        const patches = diffChildren(oldChildren, [], false);

        expect(patches).toHaveLength(2);
        expect(patches[0].type).toBe(PatchType.REMOVE);
        expect(patches[1].type).toBe(PatchType.REMOVE);
      });
    });

    describe('Index-Based Diffing', () => {
      test('same children returns no patches', () => {
        const oldChildren = [createTextVNode('A')];
        const newChildren = [createTextVNode('A')];
        const patches = diffChildren(oldChildren, newChildren, false);

        expect(patches).toEqual([]);
      });

      test('changed child returns TEXT patch', () => {
        const oldChildren = [createTextVNode('A')];
        const newChildren = [createTextVNode('B')];
        const patches = diffChildren(oldChildren, newChildren, false);

        expect(patches[0].type).toBe(PatchType.TEXT);
      });

      test('added child at end', () => {
        const oldChildren = [createTextVNode('A')];
        const newChildren = [createTextVNode('A'), createTextVNode('B')];
        const patches = diffChildren(oldChildren, newChildren, false);

        expect(patches).toHaveLength(1);
        expect(patches[0].type).toBe(PatchType.CREATE);
        expect(patches[0].index).toBe(1);
      });

      test('removed child from end', () => {
        const oldChildren = [createTextVNode('A'), createTextVNode('B')];
        const newChildren = [createTextVNode('A')];
        const patches = diffChildren(oldChildren, newChildren, false);

        expect(patches).toHaveLength(1);
        expect(patches[0].type).toBe(PatchType.REMOVE);
        expect(patches[0].index).toBe(1);
      });

      test('replaced child at index', () => {
        const oldChildren = [createElementVNode('div')];
        const newChildren = [createElementVNode('span')];
        const patches = diffChildren(oldChildren, newChildren, false);

        expect(patches[0].type).toBe(PatchType.REPLACE);
      });
    });

    describe('Key-Based Diffing', () => {
      test('same keyed children in same order returns no CREATE/REMOVE patches', () => {
        const oldChildren = [
          createElementVNode('li', null, undefined, 'a'),
          createElementVNode('li', null, undefined, 'b'),
        ];
        const newChildren = [
          createElementVNode('li', null, undefined, 'a'),
          createElementVNode('li', null, undefined, 'b'),
        ];
        const patches = diffChildren(oldChildren, newChildren, true);

        // Should only have patches if content changed, not for structure
        const structuralPatches = patches.filter(
          (p) => p.type === PatchType.CREATE || p.type === PatchType.REMOVE || p.type === PatchType.REORDER
        );
        expect(structuralPatches).toHaveLength(0);
      });

      test('new key added returns CREATE patch', () => {
        const oldChildren = [createElementVNode('li', null, undefined, 'a')];
        const newChildren = [
          createElementVNode('li', null, undefined, 'a'),
          createElementVNode('li', null, undefined, 'b'),
        ];
        const patches = diffChildren(oldChildren, newChildren, true);

        const createPatches = patches.filter((p) => p.type === PatchType.CREATE);
        expect(createPatches).toHaveLength(1);
        expect(createPatches[0].index).toBe(1);
      });

      test('key removed returns REMOVE patch', () => {
        const oldChildren = [
          createElementVNode('li', null, undefined, 'a'),
          createElementVNode('li', null, undefined, 'b'),
        ];
        const newChildren = [createElementVNode('li', null, undefined, 'a')];
        const patches = diffChildren(oldChildren, newChildren, true);

        const removePatches = patches.filter((p) => p.type === PatchType.REMOVE);
        expect(removePatches).toHaveLength(1);
      });

      test('keys reordered returns REORDER patches', () => {
        const oldChildren = [
          createElementVNode('li', null, undefined, 'a'),
          createElementVNode('li', null, undefined, 'b'),
        ];
        const newChildren = [
          createElementVNode('li', null, undefined, 'b'),
          createElementVNode('li', null, undefined, 'a'),
        ];
        const patches = diffChildren(oldChildren, newChildren, true);

        const reorderPatches = patches.filter((p) => p.type === PatchType.REORDER);
        expect(reorderPatches.length).toBeGreaterThan(0);
      });
    });
  });

  describe('diffChildrenWithKeys() - Key-Based Reconciliation', () => {
    test('identical children returns no structural patches', () => {
      const children = [createElementVNode('li', null, undefined, 'a'), createElementVNode('li', null, undefined, 'b')];
      const patches = diffChildrenWithKeys(children, children);

      expect(patches).toEqual([]);
    });

    test('all same keys, same order, no content changes', () => {
      const oldChildren = [
        createElementVNode('li', { class: 'item' }, undefined, 'a'),
        createElementVNode('li', { class: 'item' }, undefined, 'b'),
      ];
      const newChildren = [
        createElementVNode('li', { class: 'item' }, undefined, 'a'),
        createElementVNode('li', { class: 'item' }, undefined, 'b'),
      ];
      const patches = diffChildrenWithKeys(oldChildren, newChildren);

      expect(patches).toEqual([]);
    });

    test('insert at beginning', () => {
      const oldChildren = [createElementVNode('li', null, undefined, 'b')];
      const newChildren = [
        createElementVNode('li', null, undefined, 'a'),
        createElementVNode('li', null, undefined, 'b'),
      ];
      const patches = diffChildrenWithKeys(oldChildren, newChildren);

      const createPatches = patches.filter((p) => p.type === PatchType.CREATE);
      expect(createPatches).toHaveLength(1);
      expect(createPatches[0].index).toBe(0);
    });

    test('insert at end', () => {
      const oldChildren = [createElementVNode('li', null, undefined, 'a')];
      const newChildren = [
        createElementVNode('li', null, undefined, 'a'),
        createElementVNode('li', null, undefined, 'b'),
      ];
      const patches = diffChildrenWithKeys(oldChildren, newChildren);

      const createPatches = patches.filter((p) => p.type === PatchType.CREATE);
      expect(createPatches).toHaveLength(1);
      expect(createPatches[0].index).toBe(1);
    });

    test('insert in middle', () => {
      const oldChildren = [
        createElementVNode('li', null, undefined, 'a'),
        createElementVNode('li', null, undefined, 'c'),
      ];
      const newChildren = [
        createElementVNode('li', null, undefined, 'a'),
        createElementVNode('li', null, undefined, 'b'),
        createElementVNode('li', null, undefined, 'c'),
      ];
      const patches = diffChildrenWithKeys(oldChildren, newChildren);

      const createPatches = patches.filter((p) => p.type === PatchType.CREATE);
      expect(createPatches).toHaveLength(1);
      expect(createPatches[0].index).toBe(1);
    });

    test('delete from beginning', () => {
      const oldChildren = [
        createElementVNode('li', null, undefined, 'a'),
        createElementVNode('li', null, undefined, 'b'),
      ];
      const newChildren = [createElementVNode('li', null, undefined, 'b')];
      const patches = diffChildrenWithKeys(oldChildren, newChildren);

      const removePatches = patches.filter((p) => p.type === PatchType.REMOVE);
      expect(removePatches).toHaveLength(1);
    });

    test('delete from end', () => {
      const oldChildren = [
        createElementVNode('li', null, undefined, 'a'),
        createElementVNode('li', null, undefined, 'b'),
      ];
      const newChildren = [createElementVNode('li', null, undefined, 'a')];
      const patches = diffChildrenWithKeys(oldChildren, newChildren);

      const removePatches = patches.filter((p) => p.type === PatchType.REMOVE);
      expect(removePatches).toHaveLength(1);
    });

    test('delete from middle', () => {
      const oldChildren = [
        createElementVNode('li', null, undefined, 'a'),
        createElementVNode('li', null, undefined, 'b'),
        createElementVNode('li', null, undefined, 'c'),
      ];
      const newChildren = [
        createElementVNode('li', null, undefined, 'a'),
        createElementVNode('li', null, undefined, 'c'),
      ];
      const patches = diffChildrenWithKeys(oldChildren, newChildren);

      const removePatches = patches.filter((p) => p.type === PatchType.REMOVE);
      expect(removePatches).toHaveLength(1);
    });

    test('swap two items', () => {
      const oldChildren = [
        createElementVNode('li', null, undefined, 'a'),
        createElementVNode('li', null, undefined, 'b'),
      ];
      const newChildren = [
        createElementVNode('li', null, undefined, 'b'),
        createElementVNode('li', null, undefined, 'a'),
      ];
      const patches = diffChildrenWithKeys(oldChildren, newChildren);

      const reorderPatches = patches.filter((p) => p.type === PatchType.REORDER);
      expect(reorderPatches.length).toBeGreaterThan(0);
    });

    test('reverse array', () => {
      const oldChildren = [
        createElementVNode('li', null, undefined, 'a'),
        createElementVNode('li', null, undefined, 'b'),
        createElementVNode('li', null, undefined, 'c'),
      ];
      const newChildren = [
        createElementVNode('li', null, undefined, 'c'),
        createElementVNode('li', null, undefined, 'b'),
        createElementVNode('li', null, undefined, 'a'),
      ];
      const patches = diffChildrenWithKeys(oldChildren, newChildren);

      const reorderPatches = patches.filter((p) => p.type === PatchType.REORDER);
      expect(reorderPatches.length).toBeGreaterThan(0);
    });

    test('move item from end to beginning', () => {
      const oldChildren = [
        createElementVNode('li', null, undefined, 'a'),
        createElementVNode('li', null, undefined, 'b'),
        createElementVNode('li', null, undefined, 'c'),
      ];
      const newChildren = [
        createElementVNode('li', null, undefined, 'c'),
        createElementVNode('li', null, undefined, 'a'),
        createElementVNode('li', null, undefined, 'b'),
      ];
      const patches = diffChildrenWithKeys(oldChildren, newChildren);

      const reorderPatches = patches.filter((p) => p.type === PatchType.REORDER);
      expect(reorderPatches.length).toBeGreaterThan(0);
    });

    test('complex reorder with adds and removes', () => {
      const oldChildren = [
        createElementVNode('li', null, undefined, 'a'),
        createElementVNode('li', null, undefined, 'b'),
        createElementVNode('li', null, undefined, 'c'),
      ];
      const newChildren = [
        createElementVNode('li', null, undefined, 'd'),
        createElementVNode('li', null, undefined, 'b'),
        createElementVNode('li', null, undefined, 'a'),
      ];
      const patches = diffChildrenWithKeys(oldChildren, newChildren);

      const createPatches = patches.filter((p) => p.type === PatchType.CREATE);
      const removePatches = patches.filter((p) => p.type === PatchType.REMOVE);
      const reorderPatches = patches.filter((p) => p.type === PatchType.REORDER);

      expect(createPatches).toHaveLength(1); // 'd' added
      expect(removePatches).toHaveLength(1); // 'c' removed
      expect(reorderPatches.length).toBeGreaterThan(0); // 'a' and 'b' reordered
    });
  });

  describe('diffChildrenByIndex() - Index-Based Diffing', () => {
    test('same children returns no patches', () => {
      const oldChildren = [createTextVNode('A'), createTextVNode('B')];
      const newChildren = [createTextVNode('A'), createTextVNode('B')];
      const patches = diffChildrenByIndex(oldChildren, newChildren);

      expect(patches).toEqual([]);
    });

    test('longer new array creates patches', () => {
      const oldChildren = [createTextVNode('A')];
      const newChildren = [createTextVNode('A'), createTextVNode('B'), createTextVNode('C')];
      const patches = diffChildrenByIndex(oldChildren, newChildren);

      const createPatches = patches.filter((p) => p.type === PatchType.CREATE);
      expect(createPatches).toHaveLength(2);
    });

    test('longer old array removes patches', () => {
      const oldChildren = [createTextVNode('A'), createTextVNode('B'), createTextVNode('C')];
      const newChildren = [createTextVNode('A')];
      const patches = diffChildrenByIndex(oldChildren, newChildren);

      const removePatches = patches.filter((p) => p.type === PatchType.REMOVE);
      expect(removePatches).toHaveLength(2);
    });

    test('changed items at indices', () => {
      const oldChildren = [createTextVNode('A'), createTextVNode('B')];
      const newChildren = [createTextVNode('X'), createTextVNode('Y')];
      const patches = diffChildrenByIndex(oldChildren, newChildren);

      expect(patches).toHaveLength(2);
      expect(patches.every((p) => p.type === PatchType.TEXT)).toBe(true);
    });
  });

  describe('detectListPattern() - Pattern Detection', () => {
    test('detects no-change pattern', () => {
      const children = [createElementVNode('li', null, undefined, 'a'), createElementVNode('li', null, undefined, 'b')];
      const pattern = detectListPattern(children, children);

      expect(pattern).toBe('no-change');
    });

    test('detects append pattern', () => {
      const oldChildren = [createElementVNode('li', null, undefined, 'a')];
      const newChildren = [
        createElementVNode('li', null, undefined, 'a'),
        createElementVNode('li', null, undefined, 'b'),
      ];
      const pattern = detectListPattern(oldChildren, newChildren);

      expect(pattern).toBe('append');
    });

    test('detects prepend pattern', () => {
      const oldChildren = [createElementVNode('li', null, undefined, 'b')];
      const newChildren = [
        createElementVNode('li', null, undefined, 'a'),
        createElementVNode('li', null, undefined, 'b'),
      ];
      const pattern = detectListPattern(oldChildren, newChildren);

      expect(pattern).toBe('prepend');
    });

    test('detects remove-end pattern', () => {
      const oldChildren = [
        createElementVNode('li', null, undefined, 'a'),
        createElementVNode('li', null, undefined, 'b'),
      ];
      const newChildren = [createElementVNode('li', null, undefined, 'a')];
      const pattern = detectListPattern(oldChildren, newChildren);

      expect(pattern).toBe('remove-end');
    });

    test('detects remove-start pattern', () => {
      const oldChildren = [
        createElementVNode('li', null, undefined, 'a'),
        createElementVNode('li', null, undefined, 'b'),
      ];
      const newChildren = [createElementVNode('li', null, undefined, 'b')];
      const pattern = detectListPattern(oldChildren, newChildren);

      expect(pattern).toBe('remove-start');
    });

    test('detects reverse pattern', () => {
      const oldChildren = [
        createElementVNode('li', null, undefined, 'a'),
        createElementVNode('li', null, undefined, 'b'),
        createElementVNode('li', null, undefined, 'c'),
      ];
      const newChildren = [
        createElementVNode('li', null, undefined, 'c'),
        createElementVNode('li', null, undefined, 'b'),
        createElementVNode('li', null, undefined, 'a'),
      ];
      const pattern = detectListPattern(oldChildren, newChildren);

      expect(pattern).toBe('reverse');
    });

    test('returns null for complex pattern', () => {
      const oldChildren = [
        createElementVNode('li', null, undefined, 'a'),
        createElementVNode('li', null, undefined, 'b'),
      ];
      const newChildren = [
        createElementVNode('li', null, undefined, 'c'),
        createElementVNode('li', null, undefined, 'd'),
      ];
      const pattern = detectListPattern(oldChildren, newChildren);

      expect(pattern).toBeNull();
    });
  });

  describe('shallowEqual() - Equality Helper', () => {
    test('same reference returns true', () => {
      const obj = { a: 1 };
      expect(shallowEqual(obj, obj)).toBe(true);
    });

    test('primitives equal', () => {
      expect(shallowEqual(42, 42)).toBe(true);
      expect(shallowEqual('hello', 'hello')).toBe(true);
      expect(shallowEqual(true, true)).toBe(true);
    });

    test('primitives not equal', () => {
      expect(shallowEqual(42, 43)).toBe(false);
      expect(shallowEqual('hello', 'world')).toBe(false);
    });

    test('null equality', () => {
      expect(shallowEqual(null, null)).toBe(true);
      expect(shallowEqual(null, undefined)).toBe(false);
    });

    test('arrays shallow equal', () => {
      expect(shallowEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    });

    test('arrays not equal', () => {
      expect(shallowEqual([1, 2, 3], [1, 2, 4])).toBe(false);
      expect(shallowEqual([1, 2], [1, 2, 3])).toBe(false);
    });

    test('objects shallow equal', () => {
      expect(shallowEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
    });

    test('objects not equal', () => {
      expect(shallowEqual({ a: 1 }, { a: 2 })).toBe(false);
      expect(shallowEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    });

    test('different types not equal', () => {
      expect(shallowEqual('42', 42)).toBe(false);
      expect(shallowEqual([], {})).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    test('diff handles fragment nodes', () => {
      const oldVNode = createFragmentVNode([createTextVNode('A')]);
      const newVNode = createFragmentVNode([createTextVNode('B')]);
      const patches = diff(oldVNode, newVNode);

      expect(patches[0].type).toBe(PatchType.UPDATE);
    });

    test('diff handles component nodes', () => {
      const Component: ComponentFunction = () => createElementVNode('div');
      const oldVNode = createComponentVNode(Component, { name: 'Old' });
      const newVNode = createComponentVNode(Component, { name: 'New' });
      const patches = diff(oldVNode, newVNode);

      expect(patches[0].type).toBe(PatchType.UPDATE);
      expect(patches[0].props?.set).toEqual({ name: 'New' });
    });

    test('deeply nested children changes', () => {
      const oldVNode = createElementVNode('div', null, [
        createElementVNode('ul', null, [createElementVNode('li', null, [createTextVNode('A')])]),
      ]);
      const newVNode = createElementVNode('div', null, [
        createElementVNode('ul', null, [createElementVNode('li', null, [createTextVNode('B')])]),
      ]);
      const patches = diff(oldVNode, newVNode);

      expect(patches.length).toBeGreaterThan(0);
    });

    test('undefined vs null props treated differently', () => {
      const patch1 = diffProps(undefined, null);
      const patch2 = diffProps(null, undefined);

      expect(patch1).toEqual({});
      expect(patch2).toEqual({});
    });

    test('empty children array vs undefined children', () => {
      const oldVNode = createElementVNode('div', null, []);
      const newVNode = createElementVNode('div', null, undefined);
      const patches = diff(oldVNode, newVNode);

      expect(patches).toEqual([]);
    });

    test('numeric keys treated as strings', () => {
      const oldChildren = [createElementVNode('li', null, undefined, 1)];
      const newChildren = [createElementVNode('li', null, undefined, 1)];
      const patches = diffChildrenWithKeys(oldChildren, newChildren);

      expect(patches).toEqual([]);
    });

    test('very large list performance', () => {
      const oldChildren = Array.from({ length: 1000 }, (_, i) =>
        createElementVNode('li', null, undefined, `item-${i}`)
      );
      const newChildren = Array.from({ length: 1000 }, (_, i) =>
        createElementVNode('li', null, undefined, `item-${i}`)
      );

      const start = performance.now();
      const patches = diffChildrenWithKeys(oldChildren, newChildren);
      const end = performance.now();

      expect(patches).toEqual([]);
      expect(end - start).toBeLessThan(100); // Should be fast
    });

    test('handles mixed keyed and non-keyed children gracefully', () => {
      const oldChildren = [createElementVNode('li', null, undefined, 'keyed'), createElementVNode('li')];
      const newChildren = [createElementVNode('li'), createElementVNode('li', null, undefined, 'keyed')];

      // Should not throw
      expect(() => diffChildren(oldChildren, newChildren, true)).not.toThrow();
    });
  });

  describe('Complex Scenarios', () => {
    test('multiple simultaneous changes', () => {
      const oldVNode = createElementVNode('div', { class: 'old', id: 'test' }, [
        createTextVNode('A'),
        createTextVNode('B'),
      ]);
      const newVNode = createElementVNode('div', { class: 'new', title: 'Test' }, [
        createTextVNode('A'),
        createTextVNode('C'),
        createTextVNode('D'),
      ]);
      const patches = diff(oldVNode, newVNode);

      expect(patches[0].type).toBe(PatchType.UPDATE);
      expect(patches[0].props?.set).toBeDefined();
      expect(patches[0].props?.remove).toBeDefined();
      expect(patches[0].children).toBeDefined();
      expect(patches[0].children!.length).toBeGreaterThan(0);
    });

    test('nested list with key changes', () => {
      const oldVNode = createElementVNode('ul', null, [
        createElementVNode('li', null, [createTextVNode('A')], 'a'),
        createElementVNode('li', null, [createTextVNode('B')], 'b'),
      ]);
      const newVNode = createElementVNode('ul', null, [
        createElementVNode('li', null, [createTextVNode('B')], 'b'),
        createElementVNode('li', null, [createTextVNode('C')], 'c'),
      ]);
      const patches = diff(oldVNode, newVNode);

      expect(patches.length).toBeGreaterThan(0);
    });

    test('prop change combined with children reorder', () => {
      const oldVNode = createElementVNode('div', { class: 'container' }, [
        createElementVNode('span', null, undefined, 'a'),
        createElementVNode('span', null, undefined, 'b'),
      ]);
      const newVNode = createElementVNode('div', { class: 'wrapper' }, [
        createElementVNode('span', null, undefined, 'b'),
        createElementVNode('span', null, undefined, 'a'),
      ]);
      const patches = diff(oldVNode, newVNode);

      expect(patches[0].type).toBe(PatchType.UPDATE);
      expect(patches[0].props?.set).toEqual({ class: 'wrapper' });
      expect(patches[0].children!.length).toBeGreaterThan(0);
    });
  });
});
