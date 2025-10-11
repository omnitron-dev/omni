/**
 * JSX Runtime Types
 *
 * Type definitions for JSX transformation and runtime
 */

/**
 * JSX element type - can be a tag name, component, or fragment
 */
export type JSXElementType = string | symbol | ((props: any) => JSXElement);

/**
 * JSX element - DOM node or component result
 */
export type JSXElement = Node | DocumentFragment | string | number | null | undefined;

/**
 * JSX children - various types that can be rendered
 */
export type JSXChild = JSXElement | any[];

/**
 * JSX props - properties passed to elements/components
 */
export interface JSXProps {
  children?: JSXChild;
  key?: string | number;
  ref?: { current: any } | ((element: any) => void);
  [key: string]: any;
}

/**
 * JSX attributes for intrinsic elements
 */
export interface JSXIntrinsicElements {
  [elemName: string]: any;
}

/**
 * Fragment component type
 */
export const FragmentType = Symbol('Fragment');

/**
 * Check if value is a component (function)
 */
export function isComponent(type: JSXElementType): type is (props: any) => JSXElement {
  return typeof type === 'function';
}

/**
 * Check if value is renderable
 */
export function isRenderable(value: any): boolean {
  return (
    value instanceof Node ||
    value instanceof DocumentFragment ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    value === null ||
    value === undefined
  );
}

/**
 * Normalize children array
 */
export function normalizeChildren(children: JSXChild): JSXChild[] {
  if (Array.isArray(children)) {
    return children.flat(Infinity).filter(child => child != null);
  }
  return children != null ? [children] : [];
}
