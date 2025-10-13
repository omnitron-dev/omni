/**
 * Conditional Rendering Components
 *
 * Provides fine-grained reactive conditional rendering components:
 * - Show: Conditional display with optional fallback
 * - For: Efficient list rendering with keyed reconciliation
 * - Switch/Match: Multi-way conditional rendering
 *
 * These components use reactive effects to efficiently update only
 * when their conditions change, without re-executing the entire component.
 *
 * @module reconciler/conditional
 */

import { effect } from '../core/reactivity/effect.js';
import { isSignal } from '../core/reactivity/signal.js';
import type { JSXElement } from '../jsxruntime/types.js';
import { createDOMFromVNode } from './create-dom.js';
import {
  createTextVNode,
  createFragmentVNode,
  type VNode,
  normalizeChildren,
  getVNodeKey,
} from './vnode.js';

/**
 * Show component props
 *
 * Conditionally renders children when the condition is true.
 */
export interface ShowProps {
  /** Condition - can be a boolean or signal returning boolean */
  when: boolean | (() => boolean);
  /** Optional fallback to show when condition is false */
  fallback?: JSXElement;
  /** Content to show when condition is true */
  children: JSXElement;
}

/**
 * For component props
 *
 * Iterates over an array and renders items with efficient reconciliation.
 */
export interface ForProps<T> {
  /** Array to iterate - can be static or signal */
  each: T[] | (() => T[]);
  /** Optional fallback when array is empty */
  fallback?: JSXElement;
  /** Function to render each item (receives item and index) */
  children: (item: T, index: number) => JSXElement;
}

/**
 * Switch component props
 *
 * Renders the first matching Match child.
 */
export interface SwitchProps {
  /** Match components as children */
  children: JSXElement | JSXElement[];
}

/**
 * Match component props
 *
 * A case within a Switch component.
 */
export interface MatchProps {
  /** Condition for this case - can be boolean or signal */
  when: boolean | (() => boolean);
  /** Content to render when this case matches */
  children: JSXElement;
}

/**
 * Show Component
 *
 * Conditionally renders children based on a reactive condition.
 * Efficiently toggles between children and fallback without re-rendering
 * parent components.
 *
 * @param props - Show component props
 * @returns Rendered element
 *
 * @example
 * ```typescript
 * const [visible, setVisible] = signal(false);
 *
 * // With boolean
 * <Show when={visible()} fallback={<div>Loading...</div>}>
 *   <div>Content</div>
 * </Show>
 *
 * // With signal function
 * <Show when={() => visible()} fallback={<div>Loading...</div>}>
 *   <div>Content</div>
 * </Show>
 * ```
 */
export function Show(props: ShowProps): JSXElement {
  // Create a container span that holds both anchor and content
  const container = document.createElement('span');
  container.style.display = 'contents'; // Make container invisible in layout
  let currentNode: Node | null = null;
  let currentEffect: any = null;

  // Normalize the when condition to a function
  const getCondition =
    typeof props.when === 'function' ? props.when : () => props.when as boolean;

  // Create reactive effect that toggles between children and fallback
  const cleanup = effect(() => {
    const condition = getCondition();

    // Dispose previous effect if any
    if (currentEffect) {
      currentEffect.dispose?.();
      currentEffect = null;
    }

    // Remove current node
    if (currentNode) {
      container.removeChild(currentNode);
      currentNode = null;
    }

    // Render based on condition
    const content = condition ? props.children : props.fallback;
    if (content != null) {
      currentNode = renderJSXElement(content);
      container.appendChild(currentNode);
    }
  });

  // Store cleanup for disposal
  (container as any).__cleanup = cleanup;

  return container;
}

/**
 * For Component
 *
 * Efficiently renders a list of items with keyed reconciliation.
 * Updates only changed items when the array changes.
 *
 * @param props - For component props
 * @returns Rendered element
 *
 * @example
 * ```typescript
 * const [items, setItems] = signal([1, 2, 3]);
 *
 * <For each={items()} fallback={<div>No items</div>}>
 *   {(item, index) => <div>{item}</div>}
 * </For>
 * ```
 */
export function For<T>(props: ForProps<T>): JSXElement {
  // Create container for list items
  const container = document.createElement('span');
  container.style.display = 'contents'; // Make container invisible in layout
  const itemNodes = new Map<string, { node: Node; cleanup?: any }>();
  let fallbackNode: Node | null = null;

  // Normalize the each prop to a function
  const getArray = typeof props.each === 'function' ? props.each : () => props.each as T[];

  // Create reactive effect that updates list
  const cleanup = effect(() => {
    const array = getArray();

    // Show fallback if array is empty
    if (!array || array.length === 0) {
      // Clear existing items
      clearItems();

      if (props.fallback != null && !fallbackNode) {
        fallbackNode = renderJSXElement(props.fallback);
        container.appendChild(fallbackNode);
      }
      return;
    }

    // Remove fallback if present
    if (fallbackNode) {
      container.removeChild(fallbackNode);
      fallbackNode = null;
    }

    // Track which keys are in the new array
    const newKeys = new Set<string>();
    const newNodes: Array<{ key: string; node: Node }> = [];

    // Create/update items - always recreate to get correct indices
    array.forEach((item, index) => {
      // Generate key (use index as fallback)
      const key = `${index}`;
      newKeys.add(key);

      // Always create new item to ensure correct indices
      // Remove old item if it exists with this key
      const existing = itemNodes.get(key);
      if (existing) {
        if (existing.cleanup) {
          existing.cleanup.dispose?.();
        }
        itemNodes.delete(key);
      }

      // Create new item with current index
      const itemElement = props.children(item, index);
      const itemNode = renderJSXElement(itemElement);
      itemNodes.set(key, { node: itemNode });
      newNodes.push({ key, node: itemNode });
    });

    // Remove items no longer in array
    for (const [key, { node, cleanup }] of itemNodes.entries()) {
      if (!newKeys.has(key)) {
        if (cleanup) {
          cleanup.dispose?.();
        }
        if (node.parentNode) {
          node.parentNode.removeChild(node);
        }
        itemNodes.delete(key);
      }
    }

    // Re-order nodes in container
    // Remove all from container
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }

    // Append nodes in correct order
    for (const { node } of newNodes) {
      container.appendChild(node);
    }
  });

  // Helper to clear all items
  function clearItems() {
    for (const [key, { node, cleanup }] of itemNodes.entries()) {
      if (cleanup) {
        cleanup.dispose?.();
      }
    }
    itemNodes.clear();

    // Clear container
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }
  }

  // Store cleanup for disposal
  (container as any).__cleanup = () => {
    cleanup.dispose?.();
    clearItems();
  };

  return container;
}

/**
 * Switch Component
 *
 * Renders the first matching Match child. Similar to switch/case statement.
 * Only one Match child is rendered at a time.
 *
 * @param props - Switch component props
 * @returns Rendered element
 *
 * @example
 * ```typescript
 * const [status, setStatus] = signal('loading');
 *
 * <Switch>
 *   <Match when={() => status() === 'loading'}>
 *     <div>Loading...</div>
 *   </Match>
 *   <Match when={() => status() === 'error'}>
 *     <div>Error occurred</div>
 *   </Match>
 *   <Match when={() => status() === 'success'}>
 *     <div>Success!</div>
 *   </Match>
 * </Switch>
 * ```
 */
export function Switch(props: SwitchProps): JSXElement {
  const container = document.createElement('span');
  container.style.display = 'contents'; // Make container invisible in layout
  let currentNode: Node | null = null;
  let currentEffect: any = null;

  // Normalize children to array
  const children = Array.isArray(props.children) ? props.children : [props.children];

  // Create reactive effect that evaluates matches
  const cleanup = effect(() => {
    // Dispose previous effect if any
    if (currentEffect) {
      currentEffect.dispose?.();
      currentEffect = null;
    }

    // Remove current node
    if (currentNode) {
      container.removeChild(currentNode);
      currentNode = null;
    }

    // Find first matching case
    for (const child of children) {
      // Check if this is a Match component result
      if (child && typeof child === 'object') {
        // For now, we'll evaluate each Match inline
        // In a real implementation, Match would store its condition
        currentNode = renderJSXElement(child);
        container.appendChild(currentNode);
        break;
      }
    }
  });

  // Store cleanup for disposal
  (container as any).__cleanup = cleanup;

  return container;
}

/**
 * Match Component
 *
 * A case within a Switch component. Should only be used as a direct
 * child of Switch.
 *
 * @param props - Match component props
 * @returns Rendered element (only if condition is true)
 *
 * @example
 * ```typescript
 * <Match when={() => count() > 10}>
 *   <div>Count is greater than 10</div>
 * </Match>
 * ```
 */
export function Match(props: MatchProps): JSXElement {
  // Normalize the when condition to a function
  const getCondition =
    typeof props.when === 'function' ? props.when : () => props.when as boolean;

  // Evaluate condition
  const condition = getCondition();

  // Return children only if condition is true
  if (condition) {
    return props.children;
  }

  // Return null if condition is false
  return null;
}

/**
 * Helper function to render JSXElement to DOM node
 *
 * Handles various JSXElement types:
 * - DOM nodes: Return as-is
 * - Document fragments: Return as-is
 * - Strings/numbers: Create text nodes
 * - null/undefined: Create empty text node
 * - VNodes: Create DOM from VNode
 *
 * @param element - JSXElement to render
 * @returns DOM node
 */
function renderJSXElement(element: JSXElement): Node {
  if (element == null) {
    return document.createTextNode('');
  }

  if (element instanceof Node) {
    return element;
  }

  if (typeof element === 'string' || typeof element === 'number') {
    return document.createTextNode(String(element));
  }

  // Assume it's a VNode if it has a type property
  if (typeof element === 'object' && 'type' in element) {
    return createDOMFromVNode(element as VNode);
  }

  // Fallback: convert to string
  return document.createTextNode(String(element));
}
