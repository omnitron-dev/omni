/**
 * DOM Creation from VNode
 *
 * Converts VNode tree structures into actual DOM nodes with proper
 * prop handling, event listeners, and recursive child processing.
 *
 * Part of the reconciliation engine - Phase 1 VNode system.
 */

import { isSignal } from '../core/index.js';
import { VNode, VNodeType, ComponentFunction } from './vnode.js';
import { renderVNodeWithBindings } from './jsx-integration.js';

/**
 * Create DOM node from VNode
 *
 * Main entry point for converting VNode to DOM. Handles all VNode types:
 * - ELEMENT: HTML/SVG elements
 * - TEXT: Text nodes
 * - COMPONENT: Function components
 * - FRAGMENT: Document fragments
 *
 * Stores the created DOM node in vnode.dom for reconciliation tracking.
 *
 * @param vnode - VNode to convert to DOM
 * @returns Created DOM node
 * @throws Error if VNode type is unknown
 *
 * @example
 * ```typescript
 * const vnode = createElementVNode('div', { class: 'container' }, [
 *   createTextVNode('Hello')
 * ]);
 * const dom = createDOMFromVNode(vnode);
 * document.body.appendChild(dom);
 * ```
 */
export function createDOMFromVNode(vnode: VNode): Node {
  switch (vnode.type) {
    case VNodeType.ELEMENT:
      return createElementFromVNode(vnode);
    case VNodeType.TEXT:
      return createTextFromVNode(vnode);
    case VNodeType.COMPONENT:
      return createComponentFromVNode(vnode);
    case VNodeType.FRAGMENT:
      return createFragmentFromVNode(vnode);
    default:
      throw new Error(`Unknown VNode type: ${vnode.type}`);
  }
}

/**
 * Create HTML/SVG element from VNode
 *
 * Creates element with proper namespace (SVG vs HTML), applies props,
 * and recursively creates children.
 *
 * @param vnode - Element VNode
 * @returns Created element
 * @throws Error if tag is not a string
 */
function createElementFromVNode(vnode: VNode): HTMLElement | SVGElement {
  if (typeof vnode.tag !== 'string') {
    throw new Error('Element VNode must have a string tag');
  }

  // Create element (handle SVG namespace)
  const isSVG = isSVGTag(vnode.tag);
  const element = isSVG
    ? document.createElementNS('http://www.w3.org/2000/svg', vnode.tag)
    : document.createElement(vnode.tag);

  // Store DOM reference in VNode
  vnode.dom = element;

  // Apply props (attributes, events, styles)
  if (vnode.props) {
    applyProps(element, vnode.props, isSVG);
  }

  // Create and append children from vnode.children
  if (vnode.children && vnode.children.length > 0) {
    appendChildren(element, vnode.children);
  }

  // Also process children from props.children (for reactive VNodes)
  // When ENABLE_REACTIVITY is true, children are stored in props instead of vnode.children
  if (vnode.props?.children) {
    appendChildrenFromProps(element, vnode.props.children);
  }

  return element;
}

/**
 * Create text node from VNode
 *
 * @param vnode - Text VNode
 * @returns Created text node
 */
function createTextFromVNode(vnode: VNode): Text {
  const text = document.createTextNode(vnode.text || '');
  vnode.dom = text;
  return text;
}

/**
 * Create DOM from component VNode
 *
 * Executes component function with props and processes the result.
 * Handles various return types (VNode, Node, string, null).
 *
 * NOTE: This function is called during initial VNode tree creation.
 * If the component returns a VNode with reactive props, the reactive bindings
 * will be set up later by jsx-integration's renderVNodeWithBindings.
 *
 * @param vnode - Component VNode
 * @returns Created DOM node
 * @throws Error if tag is not a function or result is invalid
 */
function createComponentFromVNode(vnode: VNode): Node {
  if (typeof vnode.tag !== 'function') {
    throw new Error('Component VNode must have a function tag');
  }

  const component = vnode.tag as ComponentFunction;
  const props = vnode.props || {};

  // Execute component function
  const result = component(props);

  // Handle result types
  if (result === null || result === undefined) {
    // Component returned nothing - create empty text node
    const emptyText = document.createTextNode('');
    vnode.dom = emptyText;
    return emptyText;
  }

  if (result instanceof Node) {
    // Component returned a DOM node directly
    vnode.dom = result;
    return result;
  }

  // Component returned a VNode - recursively create DOM
  // IMPORTANT: We need to check if this VNode has reactive props and set up bindings
  // Store the child VNode so reactive bindings can be set up later
  if (hasReactiveProps(result)) {
    const dom = renderVNodeWithBindings(result);
    vnode.dom = dom;
    // Store child VNode reference for cleanup
    if (!vnode.children) {
      vnode.children = [];
    }
    vnode.children.push(result);
    return dom;
  }

  // No reactive props - use standard DOM creation
  const dom = createDOMFromVNode(result);
  vnode.dom = dom;
  return dom;
}

/**
 * Check if a VNode has reactive props
 */
function hasReactiveProps(vnode: VNode): boolean {
  if (!vnode.props) return false;

  for (const [key, value] of Object.entries(vnode.props)) {
    // Skip internal props
    if (key.startsWith('__')) continue;

    if (isSignal(value)) return true;

    // Check nested values in style object
    if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Node)) {
      for (const nestedValue of Object.values(value)) {
        if (isSignal(nestedValue)) return true;
      }
    }

    // Check array values
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isSignal(item)) return true;
      }
    }
  }

  return false;
}

/**
 * Create document fragment from VNode
 *
 * Creates fragment and appends all children.
 *
 * @param vnode - Fragment VNode
 * @returns Created document fragment
 */
function createFragmentFromVNode(vnode: VNode): DocumentFragment {
  const fragment = document.createDocumentFragment();
  vnode.dom = fragment;

  if (vnode.children && vnode.children.length > 0) {
    appendChildren(fragment, vnode.children);
  }

  return fragment;
}

/**
 * Apply props to element
 *
 * Handles various prop types:
 * - Event listeners (onClick, onChange, etc.)
 * - Attributes (id, class, data-*, aria-*)
 * - Properties (value, checked, etc.)
 * - Styles (style object)
 * - Refs (ref callbacks)
 *
 * @param element - Target element
 * @param props - Props to apply
 * @param isSVG - Whether element is SVG
 */
function applyProps(element: HTMLElement | SVGElement, props: Record<string, any>, isSVG: boolean): void {
  for (const [key, value] of Object.entries(props)) {
    // Skip undefined/null values
    if (value === undefined || value === null) {
      continue;
    }

    // Skip children and key (handled separately)
    if (key === 'children' || key === 'key') {
      continue;
    }

    applyProp(element, key, value, isSVG);
  }
}

/**
 * Resolve a potentially reactive value to its current value
 */
function resolveValue(value: any): any {
  return isSignal(value) ? value() : value;
}

/**
 * Apply single prop to element
 *
 * Determines prop type and applies appropriately:
 * - ref: Call ref callback or assign to ref.current
 * - Events (on*): Add event listener
 * - style: Apply style object
 * - className/class: Set class attribute
 * - Boolean attrs: Set/remove attribute
 * - Regular props: Set property or attribute
 *
 * NOTE: This applies the INITIAL value only. Reactive bindings are set up later
 * by jsx-integration.ts which will track signal changes and update the DOM.
 *
 * @param element - Target element
 * @param key - Prop name
 * @param value - Prop value (may be a signal)
 * @param isSVG - Whether element is SVG
 */
function applyProp(element: HTMLElement | SVGElement, key: string, value: any, isSVG: boolean): void {
  // Resolve signal to its initial value
  const resolvedValue = resolveValue(value);

  // Handle ref
  if (key === 'ref') {
    if (typeof resolvedValue === 'function') {
      resolvedValue(element);
    } else if (resolvedValue && typeof resolvedValue === 'object' && 'current' in resolvedValue) {
      resolvedValue.current = element;
    }
    return;
  }

  // Handle event listeners (onClick, onChange, onInput, etc.)
  // Event handlers should NOT be signals - they are static
  if (key.startsWith('on') && key.length > 2) {
    const eventName = key.slice(2).toLowerCase();
    if (typeof resolvedValue === 'function') {
      element.addEventListener(eventName, resolvedValue);
      // Store event listener mapping on element for updateDOM to access
      if (!(element as any).__eventListeners) {
        (element as any).__eventListeners = {};
      }
      (element as any).__eventListeners[eventName] = resolvedValue;
      return;
    }
  }

  // Handle style object
  if (key === 'style' && typeof resolvedValue === 'object') {
    applyStyle(element, resolvedValue);
    return;
  }

  // Handle className/class
  if (key === 'className' || key === 'class') {
    applyClass(element, resolvedValue);
    return;
  }

  // Handle data-* and aria-* attributes with boolean values
  // Convert to string "true"/"false" for proper getAttribute() behavior
  if ((key.startsWith('data-') || key.startsWith('aria-')) && typeof resolvedValue === 'boolean') {
    element.setAttribute(key, String(resolvedValue));
    return;
  }

  // Handle boolean attributes (checked, disabled, readonly, etc.)
  // Use HTML standard behavior: present=true, absent=false
  if (typeof resolvedValue === 'boolean') {
    if (resolvedValue) {
      element.setAttribute(key, '');
    } else {
      element.removeAttribute(key);
    }
    return;
  }

  // For SVG, use setAttribute for all remaining props
  if (isSVG) {
    element.setAttribute(key, String(resolvedValue));
    return;
  }

  // For HTML, try setting property first, fallback to attribute
  if (key in element) {
    try {
      (element as any)[key] = resolvedValue;
    } catch {
      // Some properties are read-only, fallback to attribute
      element.setAttribute(key, String(resolvedValue));
    }
  } else {
    element.setAttribute(key, String(resolvedValue));
  }
}

/**
 * Apply style object to element
 *
 * Converts camelCase to kebab-case and applies CSS properties.
 *
 * @param element - Target element
 * @param style - Style object
 *
 * @example
 * ```typescript
 * applyStyle(element, { backgroundColor: 'red', fontSize: '16px' });
 * // Sets: background-color: red; font-size: 16px;
 * ```
 */
function applyStyle(element: HTMLElement | SVGElement, style: Record<string, any>): void {
  for (const [property, value] of Object.entries(style)) {
    if (value != null) {
      // Convert camelCase to kebab-case
      const cssProperty = property.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
      element.style.setProperty(cssProperty, String(value));
    }
  }
}

/**
 * Apply class to element
 *
 * Supports multiple formats:
 * - String: 'foo bar'
 * - Array: ['foo', 'bar', null] -> 'foo bar'
 * - Object: { foo: true, bar: false } -> 'foo'
 *
 * @param element - Target element
 * @param value - Class value
 */
function applyClass(element: HTMLElement | SVGElement, value: any): void {
  if (typeof value === 'string') {
    element.setAttribute('class', value);
  } else if (Array.isArray(value)) {
    const classes = value.filter(Boolean).join(' ');
    element.setAttribute('class', classes);
  } else if (typeof value === 'object') {
    const classes = Object.entries(value)
      .filter(([, condition]) => condition)
      .map(([className]) => className)
      .join(' ');
    element.setAttribute('class', classes);
  }
}

/**
 * Append children VNodes to parent element
 *
 * Recursively creates DOM nodes from child VNodes and appends them.
 * Handles null/undefined children gracefully.
 *
 * @param parent - Parent element or fragment
 * @param children - Child VNodes to append
 */
function appendChildren(parent: HTMLElement | SVGElement | DocumentFragment, children: VNode[]): void {
  for (const child of children) {
    if (!child) {
      continue;
    }

    const childNode = createDOMFromVNode(child);
    parent.appendChild(childNode);

    // Set parent reference for traversal
    child.parent = null; // Will be set by reconciler
  }
}

/**
 * Append children from props.children to parent element
 *
 * Handles various child types:
 * - Arrays: Recursively process each item
 * - VNodes: Convert to DOM and append
 * - DOM Nodes: Append directly
 * - Primitives (string, number): Create text nodes
 * - null/undefined/boolean: Skip
 *
 * This function is needed because when ENABLE_REACTIVITY is true,
 * children are stored in props.children instead of vnode.children.
 *
 * @param parent - Parent element or fragment
 * @param children - Children to append (any type)
 */
function appendChildrenFromProps(parent: HTMLElement | SVGElement | DocumentFragment, children: any): void {
  // Handle arrays
  if (Array.isArray(children)) {
    for (const child of children) {
      appendChildrenFromProps(parent, child);
    }
    return;
  }

  // Skip null, undefined, boolean
  if (children == null || typeof children === 'boolean') {
    return;
  }

  // Handle DOM Nodes (already created, just append)
  if (children instanceof Node) {
    parent.appendChild(children);
    return;
  }

  // Handle VNodes
  if (children && typeof children === 'object' && 'type' in children) {
    const childNode = createDOMFromVNode(children as VNode);
    parent.appendChild(childNode);
    return;
  }

  // Handle primitives (string, number) - create text nodes
  if (typeof children === 'string' || typeof children === 'number') {
    parent.appendChild(document.createTextNode(String(children)));
    return;
  }

  // Unknown type - try to stringify
  console.warn('Unknown child type in appendChildrenFromProps:', children);
}

/**
 * Check if tag is SVG element
 *
 * @param tag - HTML tag name
 * @returns True if tag is SVG
 */
function isSVGTag(tag: string): boolean {
  return (
    tag === 'svg' ||
    tag === 'path' ||
    tag === 'circle' ||
    tag === 'rect' ||
    tag === 'line' ||
    tag === 'ellipse' ||
    tag === 'polygon' ||
    tag === 'polyline' ||
    tag === 'g' ||
    tag === 'defs' ||
    tag === 'use' ||
    tag === 'symbol' ||
    tag === 'marker' ||
    tag === 'clipPath' ||
    tag === 'mask' ||
    tag === 'linearGradient' ||
    tag === 'radialGradient' ||
    tag === 'stop' ||
    tag === 'text' ||
    tag === 'tspan' ||
    tag === 'textPath' ||
    tag === 'foreignObject'
  );
}
