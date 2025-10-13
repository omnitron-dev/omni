/**
 * Patching Engine Unit Tests
 *
 * Comprehensive tests for applying patches to DOM from VNode diffs.
 * Tests cover all patch types, edge cases, performance, and integration with diff.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { Patcher, patch, batchPatches } from '../../../src/reconciler/patch.js';
import { diff, PatchType, type Patch } from '../../../src/reconciler/diff.js';
import {
  createElementVNode,
  createTextVNode,
  createFragmentVNode,
  VNodeType,
  type VNode,
} from '../../../src/reconciler/vnode.js';
import { createDOMFromVNode } from '../../../src/reconciler/create-dom.js';

describe('Patching Engine', () => {
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

  describe('Patcher Class', () => {
    describe('patchCreate() - Create Operations', () => {
      test('creates element and stores DOM reference', () => {
        const patcher = new Patcher();
        const vnode = createElementVNode('div', { class: 'test' });
        const createPatch: Patch = {
          type: PatchType.CREATE,
          newVNode: vnode,
        };

        patcher.applyPatch(createPatch);

        expect(vnode.dom).toBeTruthy();
        expect((vnode.dom as HTMLElement).tagName).toBe('DIV');
        expect((vnode.dom as HTMLElement).className).toBe('test');
      });

      test('creates text node', () => {
        const patcher = new Patcher();
        const vnode = createTextVNode('Hello World');
        const createPatch: Patch = {
          type: PatchType.CREATE,
          newVNode: vnode,
        };

        patcher.applyPatch(createPatch);

        expect(vnode.dom).toBeTruthy();
        expect((vnode.dom as Text).textContent).toBe('Hello World');
      });

      test('creates element with children', () => {
        const patcher = new Patcher();
        const vnode = createElementVNode('div', null, [createTextVNode('Child')]);
        const createPatch: Patch = {
          type: PatchType.CREATE,
          newVNode: vnode,
        };

        patcher.applyPatch(createPatch);

        expect(vnode.dom).toBeTruthy();
        expect((vnode.dom as HTMLElement).childNodes.length).toBe(1);
      });

      test('handles missing newVNode gracefully', () => {
        const patcher = new Patcher();
        const createPatch: Patch = {
          type: PatchType.CREATE,
        };

        expect(() => patcher.applyPatch(createPatch)).not.toThrow();
      });
    });

    describe('patchRemove() - Remove Operations', () => {
      test('removes element from parent', () => {
        const patcher = new Patcher();
        const vnode = createElementVNode('div');
        const dom = createDOMFromVNode(vnode);
        container.appendChild(dom);

        expect(container.childNodes.length).toBe(1);

        const removePatch: Patch = {
          type: PatchType.REMOVE,
          vnode,
        };

        patcher.applyPatch(removePatch);

        expect(container.childNodes.length).toBe(0);
        expect(vnode.dom).toBeNull();
      });

      test('cleans up effects on remove', () => {
        const patcher = new Patcher();
        const vnode = createElementVNode('div');
        const dom = createDOMFromVNode(vnode);
        container.appendChild(dom);

        // Add mock effect
        let cleanupCalled = false;
        vnode.effects = [
          {
            fn: () => {},
            deps: [],
            cleanup: () => {
              cleanupCalled = true;
            },
          } as any,
        ];

        const removePatch: Patch = {
          type: PatchType.REMOVE,
          vnode,
        };

        patcher.applyPatch(removePatch);

        expect(cleanupCalled).toBe(true);
        expect(vnode.effects).toEqual([]);
      });

      test('handles node without parent', () => {
        const patcher = new Patcher();
        const vnode = createElementVNode('div');
        createDOMFromVNode(vnode); // Create DOM but don't append

        const removePatch: Patch = {
          type: PatchType.REMOVE,
          vnode,
        };

        expect(() => patcher.applyPatch(removePatch)).not.toThrow();
      });

      test('handles missing vnode gracefully', () => {
        const patcher = new Patcher();
        const removePatch: Patch = {
          type: PatchType.REMOVE,
        };

        expect(() => patcher.applyPatch(removePatch)).not.toThrow();
      });
    });

    describe('patchReplace() - Replace Operations', () => {
      test('replaces element with new element', () => {
        const patcher = new Patcher();
        const oldVNode = createElementVNode('div', { class: 'old' });
        const oldDom = createDOMFromVNode(oldVNode);
        container.appendChild(oldDom);

        const newVNode = createElementVNode('span', { class: 'new' });

        const replacePatch: Patch = {
          type: PatchType.REPLACE,
          vnode: oldVNode,
          newVNode,
        };

        patcher.applyPatch(replacePatch);

        expect(container.childNodes.length).toBe(1);
        expect((container.firstChild as HTMLElement).tagName).toBe('SPAN');
        expect((container.firstChild as HTMLElement).className).toBe('new');
        expect(newVNode.dom).toBe(container.firstChild);
        expect(oldVNode.dom).toBeNull();
      });

      test('replaces text with element', () => {
        const patcher = new Patcher();
        const oldVNode = createTextVNode('old text');
        const oldDom = createDOMFromVNode(oldVNode);
        container.appendChild(oldDom);

        const newVNode = createElementVNode('div', { class: 'new' });

        const replacePatch: Patch = {
          type: PatchType.REPLACE,
          vnode: oldVNode,
          newVNode,
        };

        patcher.applyPatch(replacePatch);

        expect((container.firstChild as HTMLElement).tagName).toBe('DIV');
      });

      test('cleans up effects on replace', () => {
        const patcher = new Patcher();
        const oldVNode = createElementVNode('div');
        const oldDom = createDOMFromVNode(oldVNode);
        container.appendChild(oldDom);

        let cleanupCalled = false;
        oldVNode.effects = [
          {
            fn: () => {},
            deps: [],
            cleanup: () => {
              cleanupCalled = true;
            },
          } as any,
        ];

        const newVNode = createElementVNode('span');

        const replacePatch: Patch = {
          type: PatchType.REPLACE,
          vnode: oldVNode,
          newVNode,
        };

        patcher.applyPatch(replacePatch);

        expect(cleanupCalled).toBe(true);
      });
    });

    describe('patchUpdate() - Update Operations', () => {
      test('updates element props', () => {
        const patcher = new Patcher();
        const oldVNode = createElementVNode('div', { class: 'old', id: 'test' });
        const oldDom = createDOMFromVNode(oldVNode);
        container.appendChild(oldDom);

        const newVNode = createElementVNode('div', { class: 'new', title: 'Test' });
        newVNode.dom = oldDom;

        const updatePatch: Patch = {
          type: PatchType.UPDATE,
          vnode: oldVNode,
          newVNode,
          props: {
            set: { class: 'new', title: 'Test' },
            remove: ['id'],
          },
        };

        patcher.applyPatch(updatePatch);

        expect((oldDom as HTMLElement).className).toBe('new');
        expect((oldDom as HTMLElement).getAttribute('title')).toBe('Test');
        expect((oldDom as HTMLElement).hasAttribute('id')).toBe(false);
      });

      test('updates event handlers', () => {
        const patcher = new Patcher();
        const oldVNode = createElementVNode('button');
        const oldDom = createDOMFromVNode(oldVNode);
        container.appendChild(oldDom);

        let clicked = false;
        const newVNode = createElementVNode('button', {
          onClick: () => {
            clicked = true;
          },
        });

        const updatePatch: Patch = {
          type: PatchType.UPDATE,
          vnode: oldVNode,
          newVNode,
          props: {
            set: {
              onClick: () => {
                clicked = true;
              },
            },
          },
        };

        patcher.applyPatch(updatePatch);

        (oldDom as HTMLElement).click();
        expect(clicked).toBe(true);
      });

      test('updates style object', () => {
        const patcher = new Patcher();
        const oldVNode = createElementVNode('div');
        const oldDom = createDOMFromVNode(oldVNode);
        container.appendChild(oldDom);

        const newVNode = createElementVNode('div', {
          style: { color: 'red', fontSize: '16px' },
        });

        const updatePatch: Patch = {
          type: PatchType.UPDATE,
          vnode: oldVNode,
          newVNode,
          props: {
            set: { style: { color: 'red', fontSize: '16px' } },
          },
        };

        patcher.applyPatch(updatePatch);

        expect((oldDom as HTMLElement).style.color).toBe('red');
        expect((oldDom as HTMLElement).style.fontSize).toBe('16px');
      });

      test('updates class names', () => {
        const patcher = new Patcher();
        const oldVNode = createElementVNode('div', { class: 'old' });
        const oldDom = createDOMFromVNode(oldVNode);
        container.appendChild(oldDom);

        const newVNode = createElementVNode('div', { class: 'new active' });

        const updatePatch: Patch = {
          type: PatchType.UPDATE,
          vnode: oldVNode,
          newVNode,
          props: {
            set: { class: 'new active' },
          },
        };

        patcher.applyPatch(updatePatch);

        expect((oldDom as HTMLElement).className).toBe('new active');
      });

      test('handles boolean attributes', () => {
        const patcher = new Patcher();
        const oldVNode = createElementVNode('input');
        const oldDom = createDOMFromVNode(oldVNode);
        container.appendChild(oldDom);

        const newVNode = createElementVNode('input', { disabled: true, checked: true });

        const updatePatch: Patch = {
          type: PatchType.UPDATE,
          vnode: oldVNode,
          newVNode,
          props: {
            set: { disabled: true, checked: true },
          },
        };

        patcher.applyPatch(updatePatch);

        expect((oldDom as HTMLInputElement).hasAttribute('disabled')).toBe(true);
        expect((oldDom as HTMLInputElement).hasAttribute('checked')).toBe(true);
      });

      test('removes props', () => {
        const patcher = new Patcher();
        const oldVNode = createElementVNode('div', { class: 'test', id: 'main' });
        const oldDom = createDOMFromVNode(oldVNode);
        container.appendChild(oldDom);

        const newVNode = createElementVNode('div');

        const updatePatch: Patch = {
          type: PatchType.UPDATE,
          vnode: oldVNode,
          newVNode,
          props: {
            remove: ['class', 'id'],
          },
        };

        patcher.applyPatch(updatePatch);

        expect((oldDom as HTMLElement).hasAttribute('class')).toBe(false);
        expect((oldDom as HTMLElement).hasAttribute('id')).toBe(false);
      });
    });

    describe('patchText() - Text Updates', () => {
      test('updates text content', () => {
        const patcher = new Patcher();
        const oldVNode = createTextVNode('old text');
        const oldDom = createDOMFromVNode(oldVNode);
        container.appendChild(oldDom);

        const newVNode = createTextVNode('new text');
        newVNode.dom = oldDom;

        const textPatch: Patch = {
          type: PatchType.TEXT,
          vnode: oldVNode,
          newVNode,
          text: 'new text',
        };

        patcher.applyPatch(textPatch);

        expect((oldDom as Text).textContent).toBe('new text');
        expect(newVNode.dom).toBe(oldDom);
      });

      test('updates to empty string', () => {
        const patcher = new Patcher();
        const oldVNode = createTextVNode('text');
        const oldDom = createDOMFromVNode(oldVNode);
        container.appendChild(oldDom);

        const textPatch: Patch = {
          type: PatchType.TEXT,
          vnode: oldVNode,
          text: '',
        };

        patcher.applyPatch(textPatch);

        expect((oldDom as Text).textContent).toBe('');
      });
    });

    describe('patchReorder() - Reorder Operations', () => {
      test('reorders children', () => {
        const patcher = new Patcher();
        const parent = createElementVNode('ul');
        const parentDom = createDOMFromVNode(parent);
        container.appendChild(parentDom);

        const child1 = createElementVNode('li', null, [createTextVNode('A')]);
        const child1Dom = createDOMFromVNode(child1);
        parentDom.appendChild(child1Dom);

        const child2 = createElementVNode('li', null, [createTextVNode('B')]);
        const child2Dom = createDOMFromVNode(child2);
        parentDom.appendChild(child2Dom);

        expect((parentDom.childNodes[0] as HTMLElement).textContent).toBe('A');
        expect((parentDom.childNodes[1] as HTMLElement).textContent).toBe('B');

        // Move child2 to index 0
        const reorderPatch: Patch = {
          type: PatchType.REORDER,
          vnode: child2,
          newVNode: child2,
          index: 1,
          newIndex: 0,
        };

        patcher.applyPatch(reorderPatch);

        expect((parentDom.childNodes[0] as HTMLElement).textContent).toBe('B');
        expect((parentDom.childNodes[1] as HTMLElement).textContent).toBe('A');
      });

      test('moves to end when newIndex out of bounds', () => {
        const patcher = new Patcher();
        const parent = createElementVNode('ul');
        const parentDom = createDOMFromVNode(parent);
        container.appendChild(parentDom);

        const child1 = createElementVNode('li', null, [createTextVNode('A')]);
        const child1Dom = createDOMFromVNode(child1);
        parentDom.appendChild(child1Dom);

        const child2 = createElementVNode('li', null, [createTextVNode('B')]);
        const child2Dom = createDOMFromVNode(child2);
        parentDom.appendChild(child2Dom);

        const reorderPatch: Patch = {
          type: PatchType.REORDER,
          vnode: child1,
          newVNode: child1,
          index: 0,
          newIndex: 999, // Out of bounds
        };

        patcher.applyPatch(reorderPatch);

        expect((parentDom.childNodes[0] as HTMLElement).textContent).toBe('B');
        expect((parentDom.childNodes[1] as HTMLElement).textContent).toBe('A');
      });
    });
  });

  describe('patch() - Main Patch Function', () => {
    test('applies empty patches returns original vnode', () => {
      const vnode = createElementVNode('div');
      const result = patch(vnode, []);

      expect(result).toBe(vnode);
    });

    test('applies CREATE patch', () => {
      const newVNode = createElementVNode('div', { class: 'test' });
      const patches: Patch[] = [
        {
          type: PatchType.CREATE,
          newVNode,
        },
      ];

      const result = patch(null, patches);

      expect(result).toBe(newVNode);
      expect(newVNode.dom).toBeTruthy();
    });

    test('applies REMOVE patch', () => {
      const oldVNode = createElementVNode('div');
      const oldDom = createDOMFromVNode(oldVNode);
      container.appendChild(oldDom);

      const patches: Patch[] = [
        {
          type: PatchType.REMOVE,
          vnode: oldVNode,
        },
      ];

      patch(oldVNode, patches);

      expect(container.childNodes.length).toBe(0);
    });

    test('applies REPLACE patch', () => {
      const oldVNode = createElementVNode('div');
      const oldDom = createDOMFromVNode(oldVNode);
      container.appendChild(oldDom);

      const newVNode = createElementVNode('span');

      const patches: Patch[] = [
        {
          type: PatchType.REPLACE,
          vnode: oldVNode,
          newVNode,
        },
      ];

      const result = patch(oldVNode, patches);

      expect(result).toBe(newVNode);
      expect((container.firstChild as HTMLElement).tagName).toBe('SPAN');
    });

    test('applies UPDATE patch', () => {
      const oldVNode = createElementVNode('div', { class: 'old' });
      const oldDom = createDOMFromVNode(oldVNode);
      container.appendChild(oldDom);

      const newVNode = createElementVNode('div', { class: 'new' });

      const patches: Patch[] = [
        {
          type: PatchType.UPDATE,
          vnode: oldVNode,
          newVNode,
          props: {
            set: { class: 'new' },
          },
        },
      ];

      patch(oldVNode, patches);

      expect((oldDom as HTMLElement).className).toBe('new');
    });

    test('applies multiple patches in order', () => {
      const parent = createElementVNode('div');
      const parentDom = createDOMFromVNode(parent);
      container.appendChild(parentDom);

      const child1 = createElementVNode('span', { class: 'first' });
      const child2 = createElementVNode('span', { class: 'second' });

      const patches: Patch[] = [
        {
          type: PatchType.CREATE,
          newVNode: child1,
          index: 0,
        },
        {
          type: PatchType.CREATE,
          newVNode: child2,
          index: 1,
        },
      ];

      patch(parent, patches);

      expect(child1.dom).toBeTruthy();
      expect(child2.dom).toBeTruthy();
    });
  });

  describe('Integration with diff()', () => {
    test('diff + patch updates text content', () => {
      const oldVNode = createTextVNode('old');
      const oldDom = createDOMFromVNode(oldVNode);
      container.appendChild(oldDom);

      const newVNode = createTextVNode('new');
      const patches = diff(oldVNode, newVNode);

      patch(oldVNode, patches);

      expect((oldDom as Text).textContent).toBe('new');
    });

    test('diff + patch updates element props', () => {
      const oldVNode = createElementVNode('div', { class: 'old', id: 'test' });
      const oldDom = createDOMFromVNode(oldVNode);
      container.appendChild(oldDom);

      const newVNode = createElementVNode('div', { class: 'new', title: 'Test' });
      const patches = diff(oldVNode, newVNode);

      patch(oldVNode, patches);

      expect((oldDom as HTMLElement).className).toBe('new');
      expect((oldDom as HTMLElement).getAttribute('title')).toBe('Test');
      expect((oldDom as HTMLElement).hasAttribute('id')).toBe(false);
    });

    test('diff + patch replaces different elements', () => {
      const oldVNode = createElementVNode('div');
      const oldDom = createDOMFromVNode(oldVNode);
      container.appendChild(oldDom);

      const newVNode = createElementVNode('span');
      const patches = diff(oldVNode, newVNode);

      patch(oldVNode, patches);

      expect((container.firstChild as HTMLElement).tagName).toBe('SPAN');
    });

    test('diff + patch handles children changes', () => {
      const oldVNode = createElementVNode('ul', null, [
        createElementVNode('li', null, [createTextVNode('A')]),
        createElementVNode('li', null, [createTextVNode('B')]),
      ]);
      const oldDom = createDOMFromVNode(oldVNode);
      container.appendChild(oldDom);

      const newVNode = createElementVNode('ul', null, [
        createElementVNode('li', null, [createTextVNode('A')]),
        createElementVNode('li', null, [createTextVNode('C')]),
        createElementVNode('li', null, [createTextVNode('D')]),
      ]);

      const patches = diff(oldVNode, newVNode);
      patch(oldVNode, patches);

      expect(oldDom.childNodes.length).toBe(3);
    });

    test('diff + patch with keyed list reordering', () => {
      const oldVNode = createElementVNode('ul', null, [
        createElementVNode('li', null, [createTextVNode('A')], 'a'),
        createElementVNode('li', null, [createTextVNode('B')], 'b'),
        createElementVNode('li', null, [createTextVNode('C')], 'c'),
      ]);
      const oldDom = createDOMFromVNode(oldVNode);
      container.appendChild(oldDom);

      const newVNode = createElementVNode('ul', null, [
        createElementVNode('li', null, [createTextVNode('C')], 'c'),
        createElementVNode('li', null, [createTextVNode('A')], 'a'),
        createElementVNode('li', null, [createTextVNode('B')], 'b'),
      ]);

      const patches = diff(oldVNode, newVNode);
      patch(oldVNode, patches);

      // Check that children are reordered
      expect((oldDom.childNodes[0] as HTMLElement).textContent).toBe('C');
      expect((oldDom.childNodes[1] as HTMLElement).textContent).toBe('A');
      expect((oldDom.childNodes[2] as HTMLElement).textContent).toBe('B');
    });
  });

  describe('Edge Cases', () => {
    test('handles null oldVNode', () => {
      const newVNode = createElementVNode('div');
      const patches = diff(null, newVNode);

      expect(() => patch(null, patches)).not.toThrow();
    });

    test('handles null newVNode', () => {
      const oldVNode = createElementVNode('div');
      const oldDom = createDOMFromVNode(oldVNode);
      container.appendChild(oldDom);

      const patches = diff(oldVNode, null);
      patch(oldVNode, patches);

      expect(container.childNodes.length).toBe(0);
    });

    test('handles fragment nodes', () => {
      const oldVNode = createFragmentVNode([createTextVNode('A')]);
      const oldDom = createDOMFromVNode(oldVNode);

      const newVNode = createFragmentVNode([createTextVNode('B')]);
      const patches = diff(oldVNode, newVNode);

      expect(() => patch(oldVNode, patches)).not.toThrow();
    });

    test('handles deeply nested updates', () => {
      const oldVNode = createElementVNode('div', null, [
        createElementVNode('ul', null, [
          createElementVNode('li', null, [
            createElementVNode('span', null, [createTextVNode('Deep')]),
          ]),
        ]),
      ]);
      const oldDom = createDOMFromVNode(oldVNode);
      container.appendChild(oldDom);

      const newVNode = createElementVNode('div', null, [
        createElementVNode('ul', null, [
          createElementVNode('li', null, [
            createElementVNode('span', null, [createTextVNode('Updated')]),
          ]),
        ]),
      ]);

      const patches = diff(oldVNode, newVNode);
      patch(oldVNode, patches);

      const span = oldDom.querySelector('span');
      expect(span?.textContent).toBe('Updated');
    });

    test('handles empty props', () => {
      const patcher = new Patcher();
      const oldVNode = createElementVNode('div');
      const oldDom = createDOMFromVNode(oldVNode);

      const updatePatch: Patch = {
        type: PatchType.UPDATE,
        vnode: oldVNode,
        newVNode: oldVNode,
        props: {},
      };

      expect(() => patcher.applyPatch(updatePatch)).not.toThrow();
    });

    test('handles undefined text in TEXT patch', () => {
      const patcher = new Patcher();
      const oldVNode = createTextVNode('text');
      const oldDom = createDOMFromVNode(oldVNode);

      const textPatch: Patch = {
        type: PatchType.TEXT,
        vnode: oldVNode,
        text: undefined,
      };

      expect(() => patcher.applyPatch(textPatch)).not.toThrow();
    });
  });

  describe('Performance', () => {
    test('1000 patches apply quickly', () => {
      const parent = createElementVNode('div');
      const parentDom = createDOMFromVNode(parent);
      container.appendChild(parentDom);

      const patches: Patch[] = [];
      for (let i = 0; i < 1000; i++) {
        patches.push({
          type: PatchType.CREATE,
          newVNode: createElementVNode('span', { class: `item-${i}` }),
          index: i,
        });
      }

      const start = performance.now();
      patch(parent, patches);
      const end = performance.now();

      expect(end - start).toBeLessThan(100); // Should be fast
      expect(patches.every((p) => p.newVNode?.dom)).toBe(true);
    });

    test('batch updates efficiently', () => {
      const patches: Patch[] = [
        { type: PatchType.CREATE, newVNode: createElementVNode('div'), index: 0 },
        { type: PatchType.CREATE, newVNode: createElementVNode('div'), index: 1 },
        { type: PatchType.CREATE, newVNode: createElementVNode('div'), index: 2 },
      ];

      const batched = batchPatches(patches);
      expect(batched).toBeDefined();
      expect(batched.length).toBeGreaterThan(0);
    });
  });

  describe('batchPatches()', () => {
    test('returns patches as-is for now', () => {
      const patches: Patch[] = [
        { type: PatchType.CREATE, newVNode: createElementVNode('div') },
      ];

      const batched = batchPatches(patches);
      expect(batched).toEqual(patches);
    });

    test('handles empty patches', () => {
      const batched = batchPatches([]);
      expect(batched).toEqual([]);
    });
  });

  describe('Special Prop Handling', () => {
    test('handles array class names', () => {
      const patcher = new Patcher();
      const oldVNode = createElementVNode('div');
      const oldDom = createDOMFromVNode(oldVNode);
      container.appendChild(oldDom);

      const updatePatch: Patch = {
        type: PatchType.UPDATE,
        vnode: oldVNode,
        newVNode: oldVNode,
        props: {
          set: { class: ['foo', 'bar', null, 'baz'] },
        },
      };

      patcher.applyPatch(updatePatch);

      expect((oldDom as HTMLElement).className).toBe('foo bar baz');
    });

    test('handles object class names', () => {
      const patcher = new Patcher();
      const oldVNode = createElementVNode('div');
      const oldDom = createDOMFromVNode(oldVNode);
      container.appendChild(oldDom);

      const updatePatch: Patch = {
        type: PatchType.UPDATE,
        vnode: oldVNode,
        newVNode: oldVNode,
        props: {
          set: { class: { foo: true, bar: false, baz: true } },
        },
      };

      patcher.applyPatch(updatePatch);

      expect((oldDom as HTMLElement).className).toBe('foo baz');
    });

    test('removes event listeners', () => {
      const patcher = new Patcher();
      const oldVNode = createElementVNode('button');
      const oldDom = createDOMFromVNode(oldVNode);
      container.appendChild(oldDom);

      // Add event listener
      let clickCount = 0;
      (oldDom as any).__onClick = () => {
        clickCount++;
      };
      oldDom.addEventListener('click', (oldDom as any).__onClick);

      // Remove event listener
      const updatePatch: Patch = {
        type: PatchType.UPDATE,
        vnode: oldVNode,
        newVNode: oldVNode,
        props: {
          remove: ['onClick'],
        },
      };

      patcher.applyPatch(updatePatch);

      (oldDom as HTMLElement).click();
      expect(clickCount).toBe(0);
    });

    test('skips internal props', () => {
      const patcher = new Patcher();
      const oldVNode = createElementVNode('div');
      const oldDom = createDOMFromVNode(oldVNode);
      container.appendChild(oldDom);

      const updatePatch: Patch = {
        type: PatchType.UPDATE,
        vnode: oldVNode,
        newVNode: oldVNode,
        props: {
          set: { key: 'test', children: [], ref: () => {} },
        },
      };

      expect(() => patcher.applyPatch(updatePatch)).not.toThrow();
    });
  });
});
