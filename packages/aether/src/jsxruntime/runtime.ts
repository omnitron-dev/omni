/**
 * JSX Runtime
 *
 * Core JSX transformation runtime for TypeScript's react-jsx mode
 */

import type { JSXElement, JSXElementType, JSXProps } from './types.js';
import { FragmentType, isComponent, normalizeChildren } from './types.js';
import { createElementVNode } from '../reconciler/vnode.js';
import type { VNode } from '../reconciler/vnode.js';
import { renderVNodeWithBindings } from '../reconciler/jsx-integration.js';

/**
 * Feature flag to enable reactive VNode creation when signals are detected
 *
 * @default true - Enabled for reactive prop handling
 *
 * **Note:** When enabled, JSX with reactive props will create VNodes instead of DOM nodes.
 * VNodes are then rendered with reactive bindings via jsx-integration.
 *
 * **Implementation Status:**
 * - ✅ VNode creation and reactive binding system complete
 * - ✅ Integration tests passing with reactivity enabled
 * - ✅ Signal detection and reactive prop handling working
 */
export const ENABLE_REACTIVITY = true;

/**
 * Fragment symbol for grouping elements without wrapper
 */
export const Fragment = FragmentType;

/**
 * Create JSX element (single child or static children)
 *
 * @param type - Element type (tag name or component)
 * @param props - Element props
 * @param key - Optional key for lists
 * @returns DOM node or component result
 */
export function jsx(type: JSXElementType, props: JSXProps | null, key?: string | number): JSXElement {
  return createJSXElement(type, props, key);
}

/**
 * Create JSX element with multiple children
 *
 * @param type - Element type (tag name or component)
 * @param props - Element props
 * @param key - Optional key for lists
 * @returns DOM node or component result
 */
export function jsxs(type: JSXElementType, props: JSXProps | null, key?: string | number): JSXElement {
  return createJSXElement(type, props, key);
}

/**
 * Core JSX element creation
 */
function createJSXElement(type: JSXElementType, props: JSXProps | null, key?: string | number): JSXElement {
  // Handle Fragment
  if (type === Fragment) {
    return createFragment(props?.children);
  }

  // Handle Component
  if (isComponent(type)) {
    return createComponentElement(type, props, key);
  }

  // Handle DOM element
  if (typeof type === 'string') {
    // SSR Mode: Always return VNode for string elements
    if (isSSRMode()) {
      return createReactiveVNode(type, props, key) as any as JSXElement;
    }

    // Client Mode: Check if reactivity is enabled and props contain signals
    const hasReactiveProps = detectReactiveProps(props);
    if (ENABLE_REACTIVITY && hasReactiveProps) {
      // Return VNode for reactive rendering
      // Type assertion needed until VNode-JSXElement integration is complete
      return createReactiveVNode(type, props, key) as any as JSXElement;
    }
    // Use existing DOM creation (backward compatible)
    return createDOMElement(type, props, key);
  }

  throw new Error(`Invalid JSX element type: ${String(type)}`);
}

/**
 * Create Fragment (DocumentFragment with children)
 */
function createFragment(children: any): DocumentFragment | any {
  // SSR Mode: Return VNode for fragment
  if (isSSRMode()) {
    return {
      type: Fragment,
      props: { children },
      key: undefined,
      children: normalizeChildren(children)
    };
  }

  // Client Mode: Create actual DocumentFragment
  const fragment = document.createDocumentFragment();

  const childArray = normalizeChildren(children);

  for (const child of childArray) {
    const node = renderChild(child);
    if (node) fragment.appendChild(node);
  }

  return fragment;
}

/**
 * Check if running in SSR mode
 */
function isSSRMode(): boolean {
  return typeof window === 'undefined';
}

/**
 * Create component element
 */
function createComponentElement(
  Component: (props: any) => JSXElement,
  props: JSXProps | null,
  key?: string | number
): JSXElement {
  // Extract ref from props
  const { ref, children, ...restProps } = props || {};

  // Prepare component props
  const componentProps = {
    ...restProps,
    ...(children !== undefined && { children }),
    ...(key !== undefined && { key }),
  };

  // SSR Mode: Return VNode with component type instead of executing component
  // This allows SSR renderer to traverse component tree and detect islands
  if (isSSRMode()) {
    // Return a VNode-like object with the component as type
    // The SSR renderer will handle executing components
    return {
      type: Component,
      props: componentProps,
      key,
      children: []
    } as any;
  }

  // Client Mode: Execute component immediately
  const result = Component(componentProps);

  // Handle VNode results with reactive props
  if (isVNode(result)) {
    // Check if the VNode has reactive props
    const hasReactive = hasReactivePropsInVNode(result);
    if (hasReactive) {
      const dom = renderVNodeWithBindings(result as any);

      // Assign ref if provided
      if (ref && dom instanceof Node) {
        if (typeof ref === 'function') {
          ref(dom);
        } else {
          ref.current = dom;
        }
      }

      return dom as any;
    }
  }

  // Assign ref if provided
  if (ref && result instanceof Node) {
    if (typeof ref === 'function') {
      ref(result);
    } else {
      ref.current = result;
    }
  }

  return result;
}

/**
 * Check if a VNode has reactive props (signals)
 */
function hasReactivePropsInVNode(vnode: any): boolean {
  if (!vnode || !vnode.props) return false;

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
 * SVG element tags that need special namespace handling
 */
const SVG_TAGS = new Set([
  'svg', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse',
  'g', 'text', 'tspan', 'textPath', 'defs', 'use', 'symbol',
  'linearGradient', 'radialGradient', 'stop', 'pattern', 'mask', 'clipPath',
  'title', 'desc', 'image', 'foreignObject', 'marker', 'animate', 'animateMotion',
  'animateTransform', 'animateColor', 'set', 'filter', 'feBlend', 'feColorMatrix',
  'feComponentTransfer', 'feComposite', 'feConvolveMatrix', 'feDiffuseLighting',
  'feDisplacementMap', 'feFlood', 'feGaussianBlur', 'feImage', 'feMerge',
  'feMorphology', 'feOffset', 'feSpecularLighting', 'feTile', 'feTurbulence'
]);

/**
 * Create DOM element
 */
function createDOMElement(tag: string, props: JSXProps | null, key?: string | number): HTMLElement | SVGElement {
  // Create element (handle SVG)
  const isSVG = SVG_TAGS.has(tag);
  const element = isSVG ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);

  // Apply props
  if (props) {
    applyProps(element, props);
  }

  // Store key if provided
  if (key !== undefined) {
    (element as any).__key = key;
  }

  return element;
}

/**
 * Apply props to DOM element
 */
function applyProps(element: HTMLElement | SVGElement, props: JSXProps): void {
  const { children, ref, ...restProps } = props;

  // Apply attributes and properties
  for (const [key, value] of Object.entries(restProps)) {
    applyProp(element, key, value);
  }

  // Handle children
  if (children !== undefined) {
    appendChildren(element, children);
  }

  // Assign ref if provided
  if (ref) {
    if (typeof ref === 'function') {
      ref(element);
    } else {
      ref.current = element;
    }
  }
}

/**
 * Apply single prop to element
 */
function applyProp(element: HTMLElement | SVGElement, key: string, value: any): void {
  // Handle event listeners (onClick, onChange, etc.)
  if (key.startsWith('on') && key.length > 2) {
    const eventName = key.slice(2).toLowerCase();

    if (typeof value === 'function') {
      element.addEventListener(eventName, value);
      // Store event listener mapping on element for updateDOM to access
      if (!(element as any).__eventListeners) {
        (element as any).__eventListeners = {};
      }
      (element as any).__eventListeners[eventName] = value;
    }
    return;
  }

  // Handle style
  if (key === 'style' && typeof value === 'object') {
    applyStyle(element, value);
    return;
  }

  // Handle className
  if (key === 'className' || key === 'class') {
    applyClass(element, value);
    return;
  }

  // Handle ref (should be handled in applyProps but just in case)
  if (key === 'ref') {
    return;
  }

  // Handle boolean attributes
  if (typeof value === 'boolean') {
    if (value) {
      element.setAttribute(key, '');
    } else {
      element.removeAttribute(key);
    }
    return;
  }

  // Handle regular attributes/properties
  if (value != null) {
    // Try property first (for value, checked, etc.)
    if (key in element) {
      try {
        (element as any)[key] = value;
      } catch {
        // Fallback to attribute
        element.setAttribute(key, String(value));
      }
    } else {
      element.setAttribute(key, String(value));
    }
  }
}

/**
 * Apply style object to element
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
 * Apply class to element (supports string, array, object)
 */
function applyClass(element: HTMLElement | SVGElement, value: any): void {
  if (typeof value === 'string') {
    element.setAttribute('class', value);
  } else if (Array.isArray(value)) {
    element.setAttribute('class', value.filter(Boolean).join(' '));
  } else if (typeof value === 'object') {
    const classes = Object.entries(value)
      .filter(([, condition]) => condition)
      .map(([className]) => className);
    element.setAttribute('class', classes.join(' '));
  }
}

/**
 * Append children to element
 */
function appendChildren(element: HTMLElement | SVGElement, children: any): void {
  const childArray = normalizeChildren(children);

  for (const child of childArray) {
    const node = renderChild(child);
    if (node) element.appendChild(node);
  }
}

/**
 * Render individual child to DOM node
 */
function renderChild(child: any): Node | null {
  // Already a node
  if (child instanceof Node) {
    return child;
  }

  // Null/undefined
  if (child == null) {
    return null;
  }

  // Boolean (don't render)
  if (typeof child === 'boolean') {
    return null;
  }

  // String or number
  if (typeof child === 'string' || typeof child === 'number') {
    return document.createTextNode(String(child));
  }

  // Array (shouldn't happen after normalization, but handle it)
  if (Array.isArray(child)) {
    const fragment = document.createDocumentFragment();
    for (const item of child) {
      const node = renderChild(item);
      if (node) fragment.appendChild(node);
    }
    return fragment;
  }

  // VNode - render with reactive bindings
  if (isVNode(child)) {
    const dom = renderVNodeWithBindings(child);
    return dom;
  }

  // Unknown type
  console.warn('Unknown child type:', child);
  return null;
}

/**
 * Check if value is a VNode
 */
function isVNode(value: any): boolean {
  return value != null && typeof value === 'object' && 'type' in value;
}

/**
 * Detect if props contain reactive signals
 *
 * Checks if any prop values are signals (have a .peek() method).
 * This allows us to create VNodes for reactive rendering when needed.
 *
 * @param props - Props to check for reactivity
 * @returns True if any prop is a signal
 *
 * @example
 * ```typescript
 * const [count] = createSignal(0);
 * detectReactiveProps({ count }); // true
 * detectReactiveProps({ count: 5 }); // false
 * ```
 */
function detectReactiveProps(props: JSXProps | null): boolean {
  if (!props) {
    return false;
  }

  // Check each prop value
  for (const [key, value] of Object.entries(props)) {
    // Skip internal props
    if (key.startsWith('__')) continue;

    // Check if value is a signal (has peek method)
    if (isSignal(value)) {
      return true;
    }

    // Check nested values in style object
    if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Node)) {
      for (const nestedValue of Object.values(value)) {
        if (isSignal(nestedValue)) {
          return true;
        }
      }
    }

    // Check array values (className, etc.)
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isSignal(item)) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Check if a value is a signal
 *
 * Signals have a .peek() method that allows reading without tracking.
 *
 * @param value - Value to check
 * @returns True if value is a signal
 */
function isSignal(value: any): boolean {
  return value != null && typeof value === 'function' && typeof value.peek === 'function';
}

/**
 * Create reactive VNode from JSX props
 *
 * Creates a VNode instead of direct DOM when reactive props are detected.
 * The VNode will be rendered with reactive bindings by jsx-integration.
 *
 * @param type - Element tag name
 * @param props - Element props (may contain signals)
 * @param key - Optional key for list reconciliation
 * @returns VNode that will be rendered reactively
 *
 * @example
 * ```typescript
 * const [count] = createSignal(0);
 * const vnode = createReactiveVNode('div', { textContent: count }, undefined);
 * // VNode will be rendered with reactive binding for textContent
 * ```
 */
function createReactiveVNode(type: string, props: JSXProps | null, key?: string | number): VNode {
  // Separate children from other props
  const { children, ...restProps } = props || {};

  // For reactive VNodes, children should be stored in props, not as VNode children
  // The VNode system is for describing DOM structure, not for holding actual DOM nodes
  // Children will be processed by the reconciler when rendering
  const propsWithChildren = children !== undefined ? { ...restProps, children } : restProps;

  // Create element VNode with props (including children in props, not as VNode children)
  return createElementVNode(type, propsWithChildren, undefined, key);
}
