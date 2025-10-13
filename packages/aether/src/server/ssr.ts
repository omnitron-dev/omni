/**
 * Server-Side Rendering (SSR) Engine
 *
 * Production-ready SSR implementation with:
 * - Component tree rendering to HTML strings
 * - Reactive state collection and serialization
 * - Async component and data loading support
 * - Critical CSS extraction
 * - Island markers for partial hydration
 * - Error boundary handling
 */

import type { VNode } from '../reconciler/vnode.js';
import { VNodeType } from '../reconciler/vnode.js';
import type {
  SSRContext,
  RenderToStringOptions,
  RenderToStaticMarkupOptions,
  IslandMarker,
} from './types.js';

/**
 * Global SSR context - used during rendering to collect data
 */
let currentSSRContext: SSRContext | null = null;

/**
 * Get current SSR context
 */
export function getSSRContext(): SSRContext | null {
  return currentSSRContext;
}

/**
 * Set SSR context
 */
export function setSSRContext(context: SSRContext | null): void {
  currentSSRContext = context;
}

/**
 * Render component to HTML string with hydration data
 *
 * Main SSR entry point. Renders a component tree to HTML, collects
 * reactive state, handles async operations, and prepares hydration data.
 *
 * @param component - Component function to render
 * @param options - Rendering options
 * @returns Object with HTML string and hydration data
 *
 * @example
 * ```typescript
 * const result = await renderToString(App, {
 *   url: '/users/123',
 *   initialState: { user: userData },
 *   netron: netronClient,
 *   collectStyles: true
 * });
 *
 * console.log(result.html); // <div>...</div>
 * console.log(result.data); // { user: {...} }
 * console.log(result.styles); // ['body { ... }']
 * ```
 */
export async function renderToString(
  component: any,
  options: Partial<RenderToStringOptions> = {}
): Promise<{
  html: string;
  data?: Record<string, any>;
  styles?: string[];
  islands?: IslandMarker[];
  meta?: Record<string, string>;
}> {
  const { props = {}, initialState = {}, url, netron, islands = false, collectStyles = false, timeout = 5000 } = options;

  // Create SSR context
  const context: SSRContext = {
    data: new Map(Object.entries(initialState)),
    styles: new Set(),
    islands: [],
    url: url ? (typeof url === 'string' ? new URL(url) : url) : undefined,
    netron,
    async: {
      pending: new Set(),
      completed: false,
    },
  };

  // Set global context
  const previousContext = currentSSRContext;
  setSSRContext(context);

  try {
    // Render component with timeout
    const renderPromise = renderComponentToHTML(component, props, context, islands);
    const html = await Promise.race([
      renderPromise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('SSR render timeout')), timeout)
      ),
    ]);

    // Wait for async operations to complete
    if (context.async.pending.size > 0) {
      await Promise.race([
        Promise.all(Array.from(context.async.pending)),
        new Promise<void>((resolve) => setTimeout(resolve, timeout)),
      ]);
    }
    context.async.completed = true;

    // Prepare result
    const result: {
      html: string;
      data?: Record<string, any>;
      styles?: string[];
      islands?: IslandMarker[];
      meta?: Record<string, string>;
    } = { html };

    // Serialize collected data
    if (context.data.size > 0) {
      result.data = Object.fromEntries(context.data);
    }

    // Add collected styles
    if (collectStyles && context.styles.size > 0) {
      result.styles = Array.from(context.styles);
    }

    // Add island markers
    if (islands && context.islands.length > 0) {
      result.islands = context.islands;
    }

    return result;
  } catch (error) {
    console.error('SSR rendering error:', error);
    throw error;
  } finally {
    // Restore previous context
    setSSRContext(previousContext);
  }
}

/**
 * Render component to static HTML without hydration markers
 *
 * Used for static pages that don't need client-side interactivity.
 * More efficient than full SSR as it skips hydration data collection.
 *
 * @param component - Component to render
 * @param options - Rendering options
 * @returns Object with HTML string and optional styles
 *
 * @example
 * ```typescript
 * const result = await renderToStaticMarkup(StaticPage, {
 *   props: { title: 'About Us' },
 *   collectStyles: true
 * });
 * ```
 */
export async function renderToStaticMarkup(
  component: any,
  options: Partial<RenderToStaticMarkupOptions> = {}
): Promise<{ html: string; styles?: string[] }> {
  const { props = {}, collectStyles = false } = options;

  // Create minimal context for static rendering
  const context: SSRContext = {
    data: new Map(),
    styles: new Set(),
    islands: [],
    async: {
      pending: new Set(),
      completed: true, // No hydration needed
    },
  };

  const previousContext = currentSSRContext;
  setSSRContext(context);

  try {
    const html = await renderComponentToHTML(component, props, context, false);

    const result: { html: string; styles?: string[] } = { html };

    if (collectStyles && context.styles.size > 0) {
      result.styles = Array.from(context.styles);
    }

    return result;
  } finally {
    setSSRContext(previousContext);
  }
}

/**
 * Collect loader data during SSR
 *
 * Stores data in the SSR context for serialization and hydration.
 *
 * @param key - Data key
 * @param data - Data to store
 *
 * @example
 * ```typescript
 * collectData('user', { id: 1, name: 'Alice' });
 * ```
 */
export function collectData(key: string, data: any): void {
  if (currentSSRContext) {
    currentSSRContext.data.set(key, data);
  }
}

/**
 * Extract and collect CSS styles during SSR
 *
 * Collects CSS for critical path rendering. Styles can be inlined
 * in the document head to prevent FOUC.
 *
 * @param css - CSS string to collect
 *
 * @example
 * ```typescript
 * extractStyles('body { margin: 0; }');
 * ```
 */
export function extractStyles(css: string): void {
  if (currentSSRContext) {
    currentSSRContext.styles.add(css);
  }
}

/**
 * Render component to HTML string (internal)
 */
async function renderComponentToHTML(
  component: any,
  props: any,
  context: SSRContext,
  enableIslands: boolean
): Promise<string> {
  // Handle null/undefined
  if (component == null) {
    return '';
  }

  // Handle primitives
  if (typeof component === 'string') {
    // Check if it looks like safe HTML from component concatenation
    // Only trust strings that look like complete HTML elements
    const trimmed = component.trim();
    if (trimmed.startsWith('<') && trimmed.endsWith('>') && !trimmed.includes('<script')) {
      // This looks like component-generated HTML, return as-is
      return component;
    }
    // Otherwise escape it as user content
    return escapeHTML(component);
  }

  if (typeof component === 'number' || typeof component === 'boolean') {
    return escapeHTML(String(component));
  }

  // Handle component functions
  if (typeof component === 'function') {
    // Check if component should be an island BEFORE executing
    if (enableIslands && (component as any).__island === true) {
      return renderIsland(component, props, context);
    }

    // Execute component
    const result = component(props);

    // Handle async components
    if (result instanceof Promise) {
      context.async.pending.add(result);
      const resolved = await result;
      context.async.pending.delete(result);
      return renderComponentToHTML(resolved, props, context, enableIslands);
    }

    // Handle render functions (from defineComponent)
    if (typeof result === 'function') {
      const rendered = result();
      if (rendered instanceof Promise) {
        context.async.pending.add(rendered);
        const resolved = await rendered;
        context.async.pending.delete(rendered);
        return renderComponentToHTML(resolved, props, context, enableIslands);
      }
      return renderComponentToHTML(rendered, props, context, enableIslands);
    }

    // Recursively render result
    return renderComponentToHTML(result, props, context, enableIslands);
  }

  // Handle VNodes
  if (isVNode(component)) {
    return renderVNodeToHTML(component, context, enableIslands);
  }

  // Handle arrays (fragments)
  if (Array.isArray(component)) {
    const parts = await Promise.all(
      component.map((child) => renderComponentToHTML(child, {}, context, enableIslands))
    );
    return parts.join('');
  }

  // Handle DOM nodes (shouldn't happen in SSR but handle gracefully)
  if (typeof component === 'object' && 'nodeType' in component) {
    console.warn('DOM node encountered during SSR - skipping');
    return '';
  }

  // Unknown type
  return '';
}

/**
 * Render VNode to HTML
 */
async function renderVNodeToHTML(vnode: VNode, context: SSRContext, enableIslands: boolean): Promise<string> {
  switch (vnode.type) {
    case VNodeType.TEXT:
      return escapeHTML(vnode.text || '');

    case VNodeType.ELEMENT:
      return renderElementVNode(vnode, context, enableIslands);

    case VNodeType.COMPONENT:
      if (typeof vnode.tag === 'function') {
        return renderComponentToHTML(vnode.tag, vnode.props || {}, context, enableIslands);
      }
      return '';

    case VNodeType.FRAGMENT:
      if (vnode.children && vnode.children.length > 0) {
        const parts = await Promise.all(
          vnode.children.map((child) => renderVNodeToHTML(child, context, enableIslands))
        );
        return parts.join('');
      }
      return '';

    default:
      return '';
  }
}

/**
 * Render element VNode to HTML
 */
async function renderElementVNode(vnode: VNode, context: SSRContext, enableIslands: boolean): Promise<string> {
  const tag = vnode.tag as string;
  const props = vnode.props || {};
  const children = vnode.children || [];

  // Build attributes
  const attrs = buildAttributes(props);
  const attrString = attrs.length > 0 ? ' ' + attrs.join(' ') : '';

  // Self-closing tags
  if (isSelfClosingTag(tag)) {
    return `<${tag}${attrString} />`;
  }

  // Render children
  const childrenHTML = await Promise.all(
    children.map((child) => renderVNodeToHTML(child, context, enableIslands))
  );

  return `<${tag}${attrString}>${childrenHTML.join('')}</${tag}>`;
}

/**
 * Build HTML attributes from props
 */
function buildAttributes(props: Record<string, any>): string[] {
  const attrs: string[] = [];

  for (const [key, value] of Object.entries(props)) {
    // Skip special props
    if (key === 'children' || key === 'ref' || key === 'key') {
      continue;
    }

    // Skip event handlers
    if (key.startsWith('on') && typeof value === 'function') {
      continue;
    }

    // Handle className
    if (key === 'className' || key === 'class') {
      const className = normalizeClassName(value);
      if (className) {
        attrs.push(`class="${escapeHTML(className)}"`);
      }
      continue;
    }

    // Handle style
    if (key === 'style' && typeof value === 'object') {
      const styleStr = buildStyleString(value);
      if (styleStr) {
        attrs.push(`style="${escapeHTML(styleStr)}"`);
      }
      continue;
    }

    // Handle boolean attributes
    if (typeof value === 'boolean') {
      if (value) {
        attrs.push(key);
      }
      continue;
    }

    // Handle reactive values (signals)
    if (typeof value === 'function' && typeof (value as any).peek === 'function') {
      const actualValue = (value as any).peek();
      if (actualValue != null) {
        attrs.push(`${key}="${escapeHTML(String(actualValue))}"`);
      }
      continue;
    }

    // Regular attributes
    if (value != null) {
      attrs.push(`${key}="${escapeHTML(String(value))}"`);
    }
  }

  return attrs;
}

/**
 * Build style string from object
 */
function buildStyleString(style: Record<string, any>): string {
  return Object.entries(style)
    .filter(([, value]) => value != null)
    .map(([key, value]) => {
      // Convert camelCase to kebab-case
      const cssKey = key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
      // Handle reactive values
      const actualValue = typeof value === 'function' && typeof (value as any).peek === 'function'
        ? (value as any).peek()
        : value;
      return `${cssKey}:${actualValue}`;
    })
    .join(';');
}

/**
 * Normalize className value
 */
function normalizeClassName(value: any): string {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.filter(Boolean).join(' ');
  }

  if (typeof value === 'object') {
    return Object.entries(value)
      .filter(([, condition]) => condition)
      .map(([className]) => className)
      .join(' ');
  }

  return '';
}

/**
 * Render island component with hydration markers
 */
function renderIsland(component: any, props: any, context: SSRContext): string {
  const islandId = generateIslandId();

  // Add island marker
  const marker: IslandMarker = {
    id: islandId,
    component: component.name || 'Anonymous',
    props: serializeProps(props),
    strategy: 'idle', // Default strategy
  };

  context.islands.push(marker);

  // Render component HTML
  const html = `<div data-island="${islandId}" data-component="${marker.component}">
    <!-- Island will hydrate on client -->
  </div>`;

  return html;
}

/**
 * Check if component needs interactivity (island)
 * This function can be used for automatic island detection based on props
 * @internal
 */
export function isInteractiveComponent(component: any, props: any): boolean {
  // Check if component has __island marker
  if ((component as any).__island === true) {
    return true;
  }

  // Check if props contain event handlers
  for (const key of Object.keys(props || {})) {
    if (key.startsWith('on') && typeof props[key] === 'function') {
      return true;
    }
  }

  return false;
}

/**
 * Generate unique island ID
 */
let islandCounter = 0;
function generateIslandId(): string {
  return `island-${++islandCounter}`;
}

/**
 * Serialize props for hydration
 */
function serializeProps(props: any): Record<string, any> {
  const serialized: Record<string, any> = {};

  for (const [key, value] of Object.entries(props)) {
    // Skip functions and DOM nodes
    if (typeof value === 'function' || (value && typeof value === 'object' && 'nodeType' in value)) {
      continue;
    }

    // Handle reactive values
    if (typeof value === 'function' && typeof (value as any).peek === 'function') {
      serialized[key] = (value as any).peek();
      continue;
    }

    serialized[key] = value;
  }

  return serialized;
}

/**
 * Check if value is a VNode
 */
function isVNode(value: any): value is VNode {
  return value && typeof value === 'object' && 'type' in value && typeof value.type === 'string';
}

/**
 * Check if tag is self-closing
 */
function isSelfClosingTag(tag: string): boolean {
  return [
    'area',
    'base',
    'br',
    'col',
    'embed',
    'hr',
    'img',
    'input',
    'link',
    'meta',
    'param',
    'source',
    'track',
    'wbr',
  ].includes(tag.toLowerCase());
}

/**
 * Escape HTML special characters
 */
function escapeHTML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
