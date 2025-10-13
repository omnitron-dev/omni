/**
 * VNode Diffing Algorithm
 *
 * Implements a diffing algorithm to detect changes between old and new VNodes
 * and generates patches to be applied to the DOM. Supports key-based list
 * reconciliation, prop diffing, and optimized children diffing.
 */

import type { VNode } from './vnode.js';
import { VNodeType } from './vnode.js';
import { diffChildrenWithKeys, diffChildrenByIndex } from './diff-children.js';

/**
 * Patch type enumeration
 *
 * Defines the types of patches that can be applied to the DOM.
 */
export enum PatchType {
  /** Create a new node */
  CREATE = 'CREATE',
  /** Remove an existing node */
  REMOVE = 'REMOVE',
  /** Replace a node with a different one */
  REPLACE = 'REPLACE',
  /** Update node properties/attributes */
  UPDATE = 'UPDATE',
  /** Reorder children (move operations) */
  REORDER = 'REORDER',
  /** Update text content */
  TEXT = 'TEXT',
}

/**
 * Prop patch - describes changes to props
 */
export interface PropPatch {
  /** Props that were added or changed */
  set?: Record<string, any>;
  /** Props that were removed */
  remove?: string[];
}

/**
 * Patch - describes a change to be applied
 */
export interface Patch {
  /** Type of patch operation */
  type: PatchType;
  /** Old VNode (for REMOVE, REPLACE, UPDATE) */
  vnode?: VNode;
  /** New VNode (for CREATE, REPLACE, UPDATE) */
  newVNode?: VNode;
  /** Property changes (for UPDATE) */
  props?: PropPatch;
  /** Children patches (for UPDATE) */
  children?: Patch[];
  /** Index for insertion/removal (for CREATE, REMOVE, REORDER) */
  index?: number;
  /** New index for moves (for REORDER) */
  newIndex?: number;
  /** New text content (for TEXT) */
  text?: string;
}

/**
 * Main diff function
 *
 * Compares old and new VNodes and generates an array of patches
 * to transform the old VNode tree into the new one.
 *
 * @param oldVNode - Previous VNode (or null if creating)
 * @param newVNode - New VNode (or null if removing)
 * @returns Array of patches to apply
 *
 * @example
 * ```typescript
 * const oldVNode = createElementVNode('div', { class: 'old' });
 * const newVNode = createElementVNode('div', { class: 'new' });
 * const patches = diff(oldVNode, newVNode);
 * // patches = [{ type: PatchType.UPDATE, props: { set: { class: 'new' } } }]
 * ```
 */
export function diff(oldVNode: VNode | null, newVNode: VNode | null): Patch[] {
  // Case 1: Both null - no changes
  if (oldVNode === null && newVNode === null) {
    return [];
  }

  // Case 2: Old is null - create new node
  if (oldVNode === null && newVNode !== null) {
    return [
      {
        type: PatchType.CREATE,
        newVNode,
      },
    ];
  }

  // Case 3: New is null - remove old node
  if (oldVNode !== null && newVNode === null) {
    return [
      {
        type: PatchType.REMOVE,
        vnode: oldVNode,
      },
    ];
  }

  // Both nodes exist - check for differences
  // TypeScript knows both are non-null here
  const old = oldVNode as VNode;
  const newNode = newVNode as VNode;

  // Case 4: Different types - replace entire node
  if (old.type !== newNode.type) {
    return [
      {
        type: PatchType.REPLACE,
        vnode: old,
        newVNode: newNode,
      },
    ];
  }

  // Case 5: Different tags (element type or component function) - replace
  if (old.tag !== newNode.tag) {
    return [
      {
        type: PatchType.REPLACE,
        vnode: old,
        newVNode: newNode,
      },
    ];
  }

  // Case 6: Same type and tag - check for updates
  const patches: Patch[] = [];

  // Handle text nodes
  if (old.type === VNodeType.TEXT && newNode.type === VNodeType.TEXT) {
    if (old.text !== newNode.text) {
      patches.push({
        type: PatchType.TEXT,
        vnode: old,
        newVNode: newNode,
        text: newNode.text,
      });
    }
    return patches;
  }

  // Handle element/component/fragment nodes
  // Check for prop changes
  const propPatch = diffProps(old.props, newNode.props);
  const childrenPatches = diffChildren(
    old.children || [],
    newNode.children || [],
    hasKeys(newNode.children || [])
  );

  // Only create UPDATE patch if there are actual changes
  if (
    (propPatch.set && Object.keys(propPatch.set).length > 0) ||
    (propPatch.remove && propPatch.remove.length > 0) ||
    childrenPatches.length > 0
  ) {
    patches.push({
      type: PatchType.UPDATE,
      vnode: old,
      newVNode: newNode,
      props: propPatch,
      children: childrenPatches,
    });
  }

  return patches;
}

/**
 * Diff props between old and new VNodes
 *
 * Detects added, removed, and changed properties.
 *
 * @param oldProps - Old props object
 * @param newProps - New props object
 * @returns Prop patch object with set/remove operations
 *
 * @example
 * ```typescript
 * const oldProps = { class: 'old', id: 'test' };
 * const newProps = { class: 'new', title: 'Test' };
 * const patch = diffProps(oldProps, newProps);
 * // patch = {
 * //   set: { class: 'new', title: 'Test' },
 * //   remove: ['id']
 * // }
 * ```
 */
export function diffProps(
  oldProps?: Record<string, any>,
  newProps?: Record<string, any>
): PropPatch {
  const patch: PropPatch = {};
  const set: Record<string, any> = {};
  const remove: string[] = [];

  const old = oldProps || {};
  const newP = newProps || {};

  // Find added or changed props
  for (const key in newP) {
    if (old[key] !== newP[key]) {
      set[key] = newP[key];
    }
  }

  // Find removed props
  for (const key in old) {
    if (!(key in newP)) {
      remove.push(key);
    }
  }

  if (Object.keys(set).length > 0) {
    patch.set = set;
  }

  if (remove.length > 0) {
    patch.remove = remove;
  }

  return patch;
}

/**
 * Diff children arrays
 *
 * Compares old and new children arrays and generates patches.
 * Uses key-based reconciliation if keys are present, otherwise
 * falls back to index-based diffing.
 *
 * @param oldChildren - Old children array
 * @param newChildren - New children array
 * @param useKeys - Whether to use key-based reconciliation
 * @returns Array of patches for children
 *
 * @example
 * ```typescript
 * const oldChildren = [
 *   createElementVNode('li', null, undefined, '1'),
 *   createElementVNode('li', null, undefined, '2')
 * ];
 * const newChildren = [
 *   createElementVNode('li', null, undefined, '2'),
 *   createElementVNode('li', null, undefined, '3')
 * ];
 * const patches = diffChildren(oldChildren, newChildren, true);
 * ```
 */
export function diffChildren(
  oldChildren: VNode[],
  newChildren: VNode[],
  useKeys: boolean
): Patch[] {
  // Early exit for same reference
  if (oldChildren === newChildren) {
    return [];
  }

  // Handle empty cases
  if (oldChildren.length === 0 && newChildren.length === 0) {
    return [];
  }

  if (oldChildren.length === 0) {
    // All children are new
    return newChildren.map((child, index) => ({
      type: PatchType.CREATE,
      newVNode: child,
      index,
    }));
  }

  if (newChildren.length === 0) {
    // All children removed
    return oldChildren.map((child, index) => ({
      type: PatchType.REMOVE,
      vnode: child,
      index,
    }));
  }

  // Use appropriate diffing strategy
  if (useKeys) {
    return diffChildrenWithKeys(oldChildren, newChildren);
  } else {
    return diffChildrenByIndex(oldChildren, newChildren);
  }
}

/**
 * Check if children array has keys
 *
 * @param children - Children array
 * @returns True if at least one child has a key
 */
function hasKeys(children: VNode[]): boolean {
  return children.some((child) => child.key !== undefined);
}

/**
 * Helper: Check if two values are equal
 *
 * Performs shallow equality check for objects and arrays.
 *
 * @param a - First value
 * @param b - Second value
 * @returns True if values are equal
 */
export function shallowEqual(a: any, b: any): boolean {
  // Same reference
  if (a === b) {
    return true;
  }

  // Different types
  if (typeof a !== typeof b) {
    return false;
  }

  // Null checks
  if (a === null || b === null) {
    return a === b;
  }

  // Array check - must check BEFORE object check since arrays are objects
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return false;
    }
    return a.every((item, index) => item === b[index]);
  }

  // Array vs non-array object
  if (Array.isArray(a) !== Array.isArray(b)) {
    return false;
  }

  // Object check
  if (typeof a === 'object' && typeof b === 'object') {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);

    if (keysA.length !== keysB.length) {
      return false;
    }

    return keysA.every((key) => a[key] === b[key]);
  }

  // Primitive comparison
  return a === b;
}
