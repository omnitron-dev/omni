/**
 * JSX Dev Runtime
 *
 * Development mode runtime with additional debugging information
 */

import { jsx as prodJsx, jsxs as prodJsxs, Fragment } from './runtime.js';
import type { JSXElement, JSXElementType, JSXProps } from './types.js';

/**
 * Development source location
 */
export interface Source {
  fileName: string;
  lineNumber: number;
  columnNumber: number;
}

/**
 * Create JSX element in development mode
 *
 * @param type - Element type
 * @param props - Element props
 * @param key - Optional key
 * @param isStaticChildren - Whether children are static
 * @param source - Source location info
 * @param self - Component instance
 * @returns JSX element
 */
export function jsxDEV(
  type: JSXElementType,
  props: JSXProps | null,
  key?: string | number,
  isStaticChildren?: boolean,
  source?: Source,
  self?: any
): JSXElement {
  // In development, add debugging info
  if (props && typeof props === 'object') {
    // Store source info for better error messages
    if (source) {
      (props as any).__source = source;
    }
    if (self !== undefined) {
      (props as any).__self = self;
    }
  }

  // Use production implementation
  const result = isStaticChildren
    ? prodJsxs(type, props, key)
    : prodJsx(type, props, key);

  // Attach debugging metadata to DOM elements
  if (result instanceof Element && source) {
    const debugInfo = `${source.fileName}:${source.lineNumber}:${source.columnNumber}`;
    result.setAttribute('data-source', debugInfo);
  }

  return result;
}

// Re-export Fragment
export { Fragment };
