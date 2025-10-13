/**
 * VNode - Virtual Node representation for reconciliation
 *
 * Core data structure for fine-grained reactivity reconciliation engine.
 * VNodes represent DOM elements, text, components, and fragments with
 * references to actual DOM nodes and reactive effects.
 */

import type { EffectImpl } from '../core/reactivity/effect.js';

/**
 * VNode type enumeration
 */
export enum VNodeType {
  ELEMENT = 'element',
  TEXT = 'text',
  COMPONENT = 'component',
  FRAGMENT = 'fragment',
}

/**
 * Component function type
 */
export type ComponentFunction = (props: any) => VNode | Node | null;

/**
 * VNode - Virtual representation of a DOM node
 *
 * Stores all information needed for reconciliation:
 * - Type and tag/component reference
 * - Props and children
 * - Key for list reconciliation
 * - Reference to actual DOM node
 * - Reactive effects attached to this node
 */
export interface VNode {
  /** Type of VNode */
  type: VNodeType;

  /** Tag name for elements, component function for components */
  tag?: string | ComponentFunction;

  /** Props/attributes for this node */
  props?: Record<string, any>;

  /** Children VNodes */
  children?: VNode[];

  /** Key for list reconciliation (optional) */
  key?: string | number;

  /** Reference to actual DOM node (null before mounting) */
  dom?: Node | null;

  /** Reactive effects attached to this node */
  effects?: EffectImpl[];

  /** Parent VNode reference (for traversal) */
  parent?: VNode | null;

  /** Text content for text nodes */
  text?: string;
}

/**
 * Create element VNode
 *
 * @param tag - HTML tag name
 * @param props - Element props
 * @param children - Child VNodes
 * @param key - Optional key for list reconciliation
 * @returns VNode representing an element
 *
 * @example
 * ```typescript
 * const vnode = createElementVNode('div', { class: 'container' }, [
 *   createTextVNode('Hello')
 * ]);
 * ```
 */
export function createElementVNode(
  tag: string,
  props?: Record<string, any> | null,
  children?: VNode[],
  key?: string | number
): VNode {
  return {
    type: VNodeType.ELEMENT,
    tag,
    props: props || undefined,
    children: children || undefined,
    key,
    dom: null,
    effects: [],
  };
}

/**
 * Create text VNode
 *
 * @param text - Text content
 * @param key - Optional key
 * @returns VNode representing a text node
 *
 * @example
 * ```typescript
 * const vnode = createTextVNode('Hello World');
 * ```
 */
export function createTextVNode(text: string, key?: string | number): VNode {
  return {
    type: VNodeType.TEXT,
    text,
    key,
    dom: null,
    effects: [],
  };
}

/**
 * Create component VNode
 *
 * @param component - Component function
 * @param props - Component props
 * @param key - Optional key
 * @returns VNode representing a component
 *
 * @example
 * ```typescript
 * const vnode = createComponentVNode(MyComponent, { name: 'World' });
 * ```
 */
export function createComponentVNode(
  component: ComponentFunction,
  props?: Record<string, any> | null,
  key?: string | number
): VNode {
  return {
    type: VNodeType.COMPONENT,
    tag: component,
    props: props || undefined,
    key,
    dom: null,
    effects: [],
  };
}

/**
 * Create fragment VNode
 *
 * @param children - Child VNodes
 * @param key - Optional key
 * @returns VNode representing a fragment
 *
 * @example
 * ```typescript
 * const vnode = createFragmentVNode([
 *   createElementVNode('div'),
 *   createElementVNode('span')
 * ]);
 * ```
 */
export function createFragmentVNode(children?: VNode[], key?: string | number): VNode {
  return {
    type: VNodeType.FRAGMENT,
    children: children || [],
    key,
    dom: null,
    effects: [],
  };
}

/**
 * Clone VNode (shallow copy)
 *
 * Creates a shallow copy of a VNode. DOM reference and effects
 * are NOT copied (reset to initial state).
 *
 * @param vnode - VNode to clone
 * @returns Cloned VNode
 *
 * @example
 * ```typescript
 * const original = createElementVNode('div');
 * const cloned = cloneVNode(original);
 * ```
 */
export function cloneVNode(vnode: VNode): VNode {
  return {
    ...vnode,
    dom: null,
    effects: [],
    children: vnode.children ? [...vnode.children] : undefined,
  };
}

/**
 * Check if VNode is an element
 */
export function isElementVNode(vnode: VNode): boolean {
  return vnode.type === VNodeType.ELEMENT;
}

/**
 * Check if VNode is a text node
 */
export function isTextVNode(vnode: VNode): boolean {
  return vnode.type === VNodeType.TEXT;
}

/**
 * Check if VNode is a component
 */
export function isComponentVNode(vnode: VNode): boolean {
  return vnode.type === VNodeType.COMPONENT;
}

/**
 * Check if VNode is a fragment
 */
export function isFragmentVNode(vnode: VNode): boolean {
  return vnode.type === VNodeType.FRAGMENT;
}

/**
 * Normalize children to VNode array
 *
 * Converts various child types to normalized VNode array:
 * - Strings/numbers → text VNodes
 * - null/undefined → filtered out
 * - Arrays → flattened
 * - VNodes → kept as-is
 *
 * @param children - Children to normalize
 * @returns Normalized VNode array
 */
export function normalizeChildren(children: any): VNode[] {
  if (children == null) {
    return [];
  }

  if (Array.isArray(children)) {
    return children.flat(Infinity).flatMap((child) => normalizeChildren(child));
  }

  // Already a VNode
  if (typeof children === 'object' && 'type' in children) {
    return [children];
  }

  // String or number - create text VNode
  if (typeof children === 'string' || typeof children === 'number') {
    return [createTextVNode(String(children))];
  }

  // Boolean - render nothing
  if (typeof children === 'boolean') {
    return [];
  }

  // Unknown type - skip
  return [];
}

/**
 * Create VNode from JSX-like value
 *
 * Converts various value types to VNodes for consistency.
 *
 * @param value - Value to convert
 * @returns VNode representation
 */
export function createVNodeFromValue(value: any): VNode {
  // Already a VNode
  if (value && typeof value === 'object' && 'type' in value) {
    return value;
  }

  // Primitive - create text node
  if (typeof value === 'string' || typeof value === 'number') {
    return createTextVNode(String(value));
  }

  // Null/undefined/boolean - empty text node
  return createTextVNode('');
}

/**
 * Get VNode key for list reconciliation
 *
 * @param vnode - VNode to get key from
 * @param index - Fallback index if no key
 * @returns Key string
 */
export function getVNodeKey(vnode: VNode, index: number): string {
  return vnode.key !== undefined ? String(vnode.key) : `__index_${index}`;
}
