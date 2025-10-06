/**
 * JSX Runtime
 *
 * Core JSX transformation runtime for TypeScript's react-jsx mode
 */

import type { JSXElement, JSXElementType, JSXProps } from './types.js';
import { FragmentType, isComponent, normalizeChildren } from './types.js';

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
export function jsx(
  type: JSXElementType,
  props: JSXProps | null,
  key?: string | number
): JSXElement {
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
export function jsxs(
  type: JSXElementType,
  props: JSXProps | null,
  key?: string | number
): JSXElement {
  return createJSXElement(type, props, key);
}

/**
 * Core JSX element creation
 */
function createJSXElement(
  type: JSXElementType,
  props: JSXProps | null,
  key?: string | number
): JSXElement {
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
    return createDOMElement(type, props, key);
  }

  throw new Error(`Invalid JSX element type: ${String(type)}`);
}

/**
 * Create Fragment (DocumentFragment with children)
 */
function createFragment(children: any): DocumentFragment {
  const fragment = document.createDocumentFragment();

  const childArray = normalizeChildren(children);

  for (const child of childArray) {
    const node = renderChild(child);
    if (node) fragment.appendChild(node);
  }

  return fragment;
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

  // Call component with props
  const componentProps = {
    ...restProps,
    ...(children !== undefined && { children }),
    ...(key !== undefined && { key })
  };

  const result = Component(componentProps);

  // Assign ref if provided
  if (ref && result instanceof Node) {
    ref.current = result;
  }

  return result;
}

/**
 * Create DOM element
 */
function createDOMElement(
  tag: string,
  props: JSXProps | null,
  key?: string | number
): HTMLElement | SVGElement {
  // Create element (handle SVG)
  const isSVG = tag === 'svg' || tag === 'path' || tag === 'circle' || tag === 'rect';
  const element = isSVG
    ? document.createElementNS('http://www.w3.org/2000/svg', tag)
    : document.createElement(tag);

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
function applyProps(
  element: HTMLElement | SVGElement,
  props: JSXProps
): void {
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
    ref.current = element;
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
      const cssProperty = property.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`);
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
function appendChildren(
  element: HTMLElement | SVGElement,
  children: any
): void {
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

  // Unknown type
  console.warn('Unknown child type:', child);
  return null;
}
