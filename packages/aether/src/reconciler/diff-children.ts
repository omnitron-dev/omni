/**
 * Children Diffing Algorithms
 *
 * Implements two strategies for diffing children:
 * 1. Key-based reconciliation: Efficient for keyed lists (preserves DOM nodes)
 * 2. Index-based reconciliation: Simple fallback for unkeyed lists
 *
 * Part of the reconciliation engine - Phase 3 Diffing & Patching.
 */

import type { VNode } from './vnode.js';
import { getVNodeKey } from './vnode.js';
import { PatchType, type Patch } from './diff.js';
import { diff } from './diff.js';

/**
 * Diff children with key-based reconciliation
 *
 * Uses keys to match old and new children, preserving DOM nodes
 * where possible and minimizing operations.
 *
 * Algorithm:
 * 1. Build key maps for O(1) lookups
 * 2. Process new children, matching with old by key
 * 3. Track moves, creates, and updates
 * 4. Remove old children not in new list
 *
 * @param oldChildren - Old children array
 * @param newChildren - New children array
 * @returns Array of patches
 *
 * @example
 * ```typescript
 * const old = [
 *   createElementVNode('li', null, undefined, 'a'),
 *   createElementVNode('li', null, undefined, 'b')
 * ];
 * const new = [
 *   createElementVNode('li', null, undefined, 'b'),
 *   createElementVNode('li', null, undefined, 'a')
 * ];
 * const patches = diffChildrenWithKeys(old, new);
 * // Generates REORDER patch instead of REPLACE
 * ```
 */
export function diffChildrenWithKeys(oldChildren: VNode[], newChildren: VNode[]): Patch[] {
  const patches: Patch[] = [];

  // Build key maps for fast lookup
  const oldKeyMap = new Map<string, { vnode: VNode; index: number }>();
  const newKeyMap = new Map<string, { vnode: VNode; index: number }>();

  // Populate old key map
  for (let i = 0; i < oldChildren.length; i++) {
    const child = oldChildren[i];
    if (!child) continue;
    const key = getVNodeKey(child, i);
    oldKeyMap.set(key, { vnode: child, index: i });
  }

  // Populate new key map
  for (let i = 0; i < newChildren.length; i++) {
    const child = newChildren[i];
    if (!child) continue;
    const key = getVNodeKey(child, i);
    newKeyMap.set(key, { vnode: child, index: i });
  }

  // Track which old children are still used
  const usedOldIndices = new Set<number>();

  // Process new children
  for (let newIndex = 0; newIndex < newChildren.length; newIndex++) {
    const newChild = newChildren[newIndex];
    if (!newChild) continue;

    const key = getVNodeKey(newChild, newIndex);
    const oldEntry = oldKeyMap.get(key);

    if (!oldEntry) {
      // New child doesn't exist in old - CREATE
      patches.push({
        type: PatchType.CREATE,
        newVNode: newChild,
        index: newIndex,
      });
    } else {
      // Child exists in old - mark as used and diff recursively
      usedOldIndices.add(oldEntry.index);

      // Check if node moved
      if (oldEntry.index !== newIndex) {
        patches.push({
          type: PatchType.REORDER,
          vnode: oldEntry.vnode,
          newVNode: newChild,
          index: oldEntry.index,
          newIndex,
        });
      }

      // Diff the node itself for updates
      const childPatches = diff(oldEntry.vnode, newChild);
      patches.push(...childPatches);
    }
  }

  // Find removed children (in old but not in new)
  for (let oldIndex = 0; oldIndex < oldChildren.length; oldIndex++) {
    if (!usedOldIndices.has(oldIndex)) {
      const oldChild = oldChildren[oldIndex];
      if (oldChild) {
        patches.push({
          type: PatchType.REMOVE,
          vnode: oldChild,
          index: oldIndex,
        });
      }
    }
  }

  return patches;
}

/**
 * Diff children by index (no keys)
 *
 * Simple index-based comparison. Less efficient for lists that reorder,
 * but works for static lists or when keys aren't provided.
 *
 * Algorithm:
 * 1. Diff each index position
 * 2. If lengths differ, create/remove at the end
 *
 * @param oldChildren - Old children array
 * @param newChildren - New children array
 * @returns Array of patches
 *
 * @example
 * ```typescript
 * const old = [createTextVNode('a'), createTextVNode('b')];
 * const new = [createTextVNode('a'), createTextVNode('c')];
 * const patches = diffChildrenByIndex(old, new);
 * // Generates UPDATE for index 1
 * ```
 */
export function diffChildrenByIndex(oldChildren: VNode[], newChildren: VNode[]): Patch[] {
  const patches: Patch[] = [];
  const minLength = Math.min(oldChildren.length, newChildren.length);

  // Diff existing children at each index
  for (let i = 0; i < minLength; i++) {
    const oldChild = oldChildren[i];
    const newChild = newChildren[i];

    // Skip if either child is undefined
    if (!oldChild || !newChild) continue;

    // Recursively diff each child
    const childPatches = diff(oldChild, newChild);
    patches.push(...childPatches);
  }

  // Handle length differences
  if (newChildren.length > oldChildren.length) {
    // New children added at end - CREATE
    for (let i = oldChildren.length; i < newChildren.length; i++) {
      const newChild = newChildren[i];
      if (newChild) {
        patches.push({
          type: PatchType.CREATE,
          newVNode: newChild,
          index: i,
        });
      }
    }
  } else if (oldChildren.length > newChildren.length) {
    // Old children removed from end - REMOVE
    for (let i = newChildren.length; i < oldChildren.length; i++) {
      const oldChild = oldChildren[i];
      if (oldChild) {
        patches.push({
          type: PatchType.REMOVE,
          vnode: oldChild,
          index: i,
        });
      }
    }
  }

  return patches;
}

/**
 * Calculate Longest Increasing Subsequence (LIS)
 *
 * Used for optimizing reorder operations. Finds the longest subsequence
 * of indices that are already in order, minimizing moves needed.
 *
 * @param arr - Array of numbers
 * @returns Indices of LIS elements
 *
 * @example
 * ```typescript
 * longestIncreasingSubsequence([0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15]);
 * // Returns indices of longest increasing subsequence
 * ```
 */
export function longestIncreasingSubsequence(arr: number[]): number[] {
  const n = arr.length;
  if (n === 0) return [];

  // Track sequence info
  const lengths = new Array(n).fill(1);
  const predecessors = new Array(n).fill(-1);

  // Build LIS
  for (let i = 1; i < n; i++) {
    for (let j = 0; j < i; j++) {
      const arrJ = arr[j];
      const arrI = arr[i];
      const lengthsJ = lengths[j];
      const lengthsI = lengths[i];
      if (arrJ !== undefined && arrI !== undefined && lengthsJ !== undefined && lengthsI !== undefined && arrJ < arrI && lengthsJ + 1 > lengthsI) {
        lengths[i] = lengthsJ + 1;
        predecessors[i] = j;
      }
    }
  }

  // Find max length and its index
  let maxLength = 0;
  let maxIndex = 0;
  for (let i = 0; i < n; i++) {
    if (lengths[i] > maxLength) {
      maxLength = lengths[i];
      maxIndex = i;
    }
  }

  // Reconstruct sequence
  const result: number[] = [];
  let current = maxIndex;
  while (current !== -1) {
    result.unshift(current);
    current = predecessors[current];
  }

  return result;
}

/**
 * Detect list change pattern for optimization
 *
 * Identifies common list modification patterns to optimize diffing:
 * - no-change: Lists are identical
 * - append: Items added to end
 * - prepend: Items added to beginning
 * - remove-end: Items removed from end
 * - remove-start: Items removed from beginning
 * - reverse: List reversed
 * - null: Complex pattern requiring full diff
 *
 * @param oldChildren - Old children array
 * @param newChildren - New children array
 * @returns Pattern name or null if complex
 *
 * @example
 * ```typescript
 * const old = [createElementVNode('li', null, undefined, 'a')];
 * const new = [createElementVNode('li', null, undefined, 'a'), createElementVNode('li', null, undefined, 'b')];
 * detectListPattern(old, new); // Returns 'append'
 * ```
 */
export function detectListPattern(
  oldChildren: VNode[],
  newChildren: VNode[]
): 'no-change' | 'append' | 'prepend' | 'remove-end' | 'remove-start' | 'reverse' | null {
  // No change - same reference or both empty
  if (oldChildren === newChildren) {
    return 'no-change';
  }

  if (oldChildren.length === 0 && newChildren.length === 0) {
    return 'no-change';
  }

  // Build key arrays for comparison
  const oldKeys = oldChildren.map((child, i) => getVNodeKey(child, i));
  const newKeys = newChildren.map((child, i) => getVNodeKey(child, i));

  // Check if all keys match (no structural change)
  if (oldKeys.length === newKeys.length && oldKeys.every((key, i) => key === newKeys[i])) {
    return 'no-change';
  }

  // Check for append (old is prefix of new)
  if (newKeys.length > oldKeys.length) {
    const isAppend = oldKeys.every((key, i) => key === newKeys[i]);
    if (isAppend) {
      return 'append';
    }
  }

  // Check for prepend (old is suffix of new)
  if (newKeys.length > oldKeys.length) {
    const offset = newKeys.length - oldKeys.length;
    const isPrepend = oldKeys.every((key, i) => key === newKeys[i + offset]);
    if (isPrepend) {
      return 'prepend';
    }
  }

  // Check for remove-end (new is prefix of old)
  if (oldKeys.length > newKeys.length) {
    const isRemoveEnd = newKeys.every((key, i) => key === oldKeys[i]);
    if (isRemoveEnd) {
      return 'remove-end';
    }
  }

  // Check for remove-start (new is suffix of old)
  if (oldKeys.length > newKeys.length) {
    const offset = oldKeys.length - newKeys.length;
    const isRemoveStart = newKeys.every((key, i) => key === oldKeys[i + offset]);
    if (isRemoveStart) {
      return 'remove-start';
    }
  }

  // Check for reverse
  if (oldKeys.length === newKeys.length) {
    const isReverse = oldKeys.every((key, i) => key === newKeys[newKeys.length - 1 - i]);
    if (isReverse) {
      return 'reverse';
    }
  }

  // Complex pattern - full diff needed
  return null;
}
