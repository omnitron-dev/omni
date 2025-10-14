/**
 * Server-Side Rendering for SVG Components
 *
 * Render SVG components to string for SSR
 */

import type { Component } from '../../core/component/types.js';
import {
  minifySVG,
  serializeStyles,
  escapeHtml,
  wrapWithHydrationMarker,
  serializeProps,
  generateHydrationHints,
  extractCriticalCSS,
} from './utils.js';

export interface SSRConfig {
  /** Render to HTML string (default: true) */
  renderToString?: boolean;

  /** Inline styles in style attribute (default: false) */
  inlineStyles?: boolean;

  /** Inline data URIs for images (default: false) */
  inlineData?: boolean;

  /** Minify output (default: false) */
  minify?: boolean;

  /** Preload sprite sheets (default: false) */
  preloadSprites?: boolean;

  /** Add hydration markers (default: true) */
  addHydrationMarkers?: boolean;

  /** Component name for hydration (required if addHydrationMarkers is true) */
  componentName?: string;

  /** Pretty print output (default: false) */
  pretty?: boolean;
}

/**
 * Render an SVG component to HTML string for server-side rendering
 */
export function renderSVGToString(
  component: Component<any>,
  props: any = {},
  config: SSRConfig = {}
): string {
  const {
    renderToString = true,
    inlineStyles = false,
    minify = false,
    addHydrationMarkers = true,
    componentName,
    pretty = false,
  } = config;

  if (!renderToString) {
    return '';
  }

  try {
    // Execute component to get render function
    const renderFn = component(props);

    // Execute render function to get JSX/string result
    let result: any;
    if (typeof renderFn === 'function') {
      result = renderFn();
    } else {
      result = renderFn;
    }

    // Convert result to string
    let svgString = convertToString(result, props, inlineStyles);

    // Add hydration markers if needed
    if (addHydrationMarkers && componentName) {
      const propsJson = JSON.stringify(props);
      svgString = wrapWithHydrationMarker(svgString, componentName, propsJson);
    }

    // Minify if requested
    if (minify) {
      svgString = minifySVG(svgString);
    }

    // Pretty print if requested
    if (pretty && !minify) {
      svgString = prettifySVG(svgString);
    }

    return svgString;
  } catch (error) {
    console.error('Error rendering SVG to string:', error);
    return `<!-- SVG render error: ${error instanceof Error ? error.message : String(error)} -->`;
  }
}

/**
 * Convert JSX element or value to HTML string
 */
function convertToString(
  element: any,
  props: any = {},
  inlineStyles: boolean = false
): string {
  // Handle null/undefined
  if (element == null) {
    return '';
  }

  // Handle primitives
  if (typeof element === 'string' || typeof element === 'number' || typeof element === 'boolean') {
    return String(element);
  }

  // Handle arrays
  if (Array.isArray(element)) {
    return element.map(el => convertToString(el, props, inlineStyles)).join('');
  }

  // Handle functions (execute them first, then convert)
  if (typeof element === 'function') {
    // This might be a component - call it with empty props and convert the result
    try {
      const result = element(props);
      return convertToString(result, props, inlineStyles);
    } catch {
      // If calling fails, it might be a render function - just call it
      const result = element();
      return convertToString(result, props, inlineStyles);
    }
  }

  // Handle JSX elements (objects with type and props)
  if (element && typeof element === 'object') {
    // Check if it's a JSX element
    if (element.type !== undefined) {
      return renderElement(element, inlineStyles);
    }

    // Check if it has a render function
    if (typeof element.render === 'function') {
      return convertToString(element.render(), props, inlineStyles);
    }

    // Handle objects with toString
    if (element.toString && element.toString !== Object.prototype.toString) {
      return String(element);
    }
  }

  return '';
}

/**
 * Render a JSX element to HTML string
 */
function renderElement(element: any, inlineStyles: boolean): string {
  const { type, props = {} } = element;

  // Handle component types (functions)
  if (typeof type === 'function') {
    try {
      const result = type(props);
      return convertToString(result, props, inlineStyles);
    } catch (error) {
      console.error('Error rendering component:', error);
      return '';
    }
  }

  // Handle built-in SVG elements (string type names)
  if (typeof type === 'string') {
    if (isSVGElement(type)) {
      return renderSVGElement(type, props, inlineStyles);
    }
    // For non-SVG strings, just escape and return
    return escapeHtml(type);
  }

  return '';
}

/**
 * Render an SVG element to HTML string
 */
function renderSVGElement(tagName: string, props: any, inlineStyles: boolean): string {
  const attributes: string[] = [];
  const children: any[] = [];

  // Process props
  Object.entries(props).forEach(([key, value]) => {
    if (key === 'children') {
      const childArray = Array.isArray(value) ? value : [value];
      children.push(...childArray);
      return;
    }

    if (key === 'style' && typeof value === 'object' && value !== null) {
      if (inlineStyles) {
        attributes.push(`style="${serializeStyles(value as Record<string, any>)}"`);
      }
      return;
    }

    if (key === 'className') {
      attributes.push(`class="${escapeHtml(String(value))}"`);
      return;
    }

    // Handle data attributes
    if (key.startsWith('data-')) {
      attributes.push(`${key}="${escapeHtml(String(value))}"`);
      return;
    }

    // Handle aria attributes
    if (key.startsWith('aria-')) {
      attributes.push(`${key}="${escapeHtml(String(value))}"`);
      return;
    }

    // Handle boolean attributes
    if (typeof value === 'boolean') {
      if (value) {
        attributes.push(key);
      }
      return;
    }

    // Handle other attributes
    if (value != null && value !== false) {
      // Resolve signals
      const resolvedValue = typeof value === 'function' ? value() : value;
      attributes.push(`${key}="${escapeHtml(String(resolvedValue))}"`);
    }
  });

  // Build opening tag
  const openTag = `<${tagName}${attributes.length > 0 ? ' ' + attributes.join(' ') : ''}>`;

  // Build children
  const childrenString = children.map(child => convertToString(child, {}, inlineStyles)).join('');

  // Build closing tag
  const closeTag = `</${tagName}>`;

  return openTag + childrenString + closeTag;
}

/**
 * Check if a tag name is a valid SVG element
 */
function isSVGElement(tagName: string): boolean {
  const svgElements = [
    'svg',
    'path',
    'circle',
    'rect',
    'ellipse',
    'line',
    'polyline',
    'polygon',
    'g',
    'text',
    'tspan',
    'textPath',
    'defs',
    'use',
    'symbol',
    'marker',
    'clipPath',
    'mask',
    'pattern',
    'linearGradient',
    'radialGradient',
    'stop',
    'filter',
    'feBlend',
    'feColorMatrix',
    'feComponentTransfer',
    'feComposite',
    'feConvolveMatrix',
    'feDiffuseLighting',
    'feDisplacementMap',
    'feDistantLight',
    'feFlood',
    'feFuncA',
    'feFuncB',
    'feFuncG',
    'feFuncR',
    'feGaussianBlur',
    'feImage',
    'feMerge',
    'feMergeNode',
    'feMorphology',
    'feOffset',
    'fePointLight',
    'feSpecularLighting',
    'feSpotLight',
    'feTile',
    'feTurbulence',
    'animate',
    'animateMotion',
    'animateTransform',
    'title',
    'desc',
  ];

  return svgElements.includes(tagName);
}

/**
 * Pretty print SVG string with indentation
 */
function prettifySVG(svgString: string, indent: string = '  '): string {
  let formatted = '';
  let level = 0;

  svgString.split(/(<[^>]+>)/g).forEach(part => {
    if (!part.trim()) return;

    if (part.startsWith('</')) {
      level--;
      formatted += indent.repeat(level) + part + '\n';
    } else if (part.startsWith('<') && !part.endsWith('/>')) {
      formatted += indent.repeat(level) + part + '\n';
      if (!part.startsWith('<!')) {
        level++;
      }
    } else if (part.startsWith('<') && part.endsWith('/>')) {
      formatted += indent.repeat(level) + part + '\n';
    } else {
      formatted += indent.repeat(level) + part.trim() + '\n';
    }
  });

  return formatted.trim();
}

/**
 * Render multiple SVG components and concatenate results
 */
export function renderSVGBatch(
  components: Array<{ component: Component<any>; props?: any }>,
  config: SSRConfig = {}
): string {
  return components
    .map(({ component, props }) => renderSVGToString(component, props, config))
    .join('\n');
}

/**
 * Create a server-safe version of a component that always renders on server
 */
export function createServerSVG<P = any>(
  component: Component<P>
): Component<P & { ssrConfig?: SSRConfig }> {
  return (props: P & { ssrConfig?: SSRConfig }) => {
    const { ssrConfig, ...componentProps } = props as any;
    return () => renderSVGToString(component, componentProps, ssrConfig);
  };
}

/**
 * Streaming render configuration
 */
export interface StreamConfig extends SSRConfig {
  /** Chunk size for streaming (default: 1024) */
  chunkSize?: number;

  /** Callback when chunk is ready */
  onChunk?: (chunk: string) => void;

  /** Callback when streaming is complete */
  onComplete?: () => void;

  /** Callback on error */
  onError?: (error: Error) => void;
}

/**
 * Render SVG component to stream for progressive rendering
 * This is useful for large SVGs or multiple SVGs
 */
export async function* renderSVGToStream(
  component: Component<any>,
  props: any = {},
  config: StreamConfig = {}
): AsyncGenerator<string, void, unknown> {
  const {
    chunkSize = 1024,
    onChunk,
    onError,
  } = config;

  try {
    // Render the full component
    const fullString = renderSVGToString(component, props, config);

    // Stream in chunks
    let offset = 0;
    while (offset < fullString.length) {
      const chunk = fullString.slice(offset, offset + chunkSize);
      offset += chunkSize;

      if (onChunk) {
        onChunk(chunk);
      }

      yield chunk;
    }
  } catch (error) {
    if (onError) {
      onError(error instanceof Error ? error : new Error(String(error)));
    }
    throw error;
  }
}

/**
 * Render multiple SVGs as a stream
 */
export async function* renderSVGBatchStream(
  components: Array<{ component: Component<any>; props?: any }>,
  config: StreamConfig = {}
): AsyncGenerator<string, void, unknown> {
  for (const { component, props } of components) {
    yield* renderSVGToStream(component, props, config);
    yield '\n'; // Separator between SVGs
  }
}

/**
 * Enhanced rendering with critical CSS extraction
 */
export function renderSVGWithCriticalCSS(
  component: Component<any>,
  props: any = {},
  config: SSRConfig = {}
): { html: string; css: string } {
  const html = renderSVGToString(component, props, config);
  const css = extractCriticalCSS(html);

  return { html, css };
}

/**
 * Render SVG with optimized signal handling
 * Signals are resolved to their static values on the server
 */
export function renderSVGWithSignals(
  component: Component<any>,
  props: any = {},
  config: SSRConfig = {}
): string {
  // Serialize props to resolve signals
  const serializedProps = serializeProps(props);

  // Render with serialized props
  return renderSVGToString(component, serializedProps, config);
}

/**
 * Render SVG with hydration hints for optimal client-side hydration
 */
export function renderSVGWithHydration(
  component: Component<any>,
  props: any = {},
  config: SSRConfig & {
    hasAnimations?: boolean;
    hasInteractivity?: boolean;
    isAboveFold?: boolean;
    priority?: 'high' | 'medium' | 'low';
  } = {}
): string {
  const {
    hasAnimations,
    hasInteractivity,
    isAboveFold,
    priority,
    ...ssrConfig
  } = config;

  // Generate hydration hints
  const hints = generateHydrationHints({
    hasAnimations,
    hasInteractivity,
    isAboveFold,
    priority,
  });

  // Render with hydration markers
  let html = renderSVGToString(component, props, {
    ...ssrConfig,
    addHydrationMarkers: true,
  });

  // Add hints to the output
  if (hints) {
    html = html.replace('<svg', `<svg ${hints}`);
  }

  return html;
}

/**
 * Render SVG for client-side islands architecture
 * Only includes hydration markers for interactive components
 */
export function renderSVGIsland(
  component: Component<any>,
  props: any = {},
  config: SSRConfig & {
    islandId?: string;
    interactive?: boolean;
  } = {}
): string {
  const { islandId, interactive = true, ...ssrConfig } = config;

  if (!interactive) {
    // Render static HTML without hydration markers
    return renderSVGToString(component, props, {
      ...ssrConfig,
      addHydrationMarkers: false,
    });
  }

  // Render with island-specific markers
  const html = renderSVGToString(component, props, {
    ...ssrConfig,
    addHydrationMarkers: true,
  });

  if (islandId) {
    return html.replace('<svg', `<svg data-island-id="${escapeHtml(islandId)}"`);
  }

  return html;
}

/**
 * Collect all SVG styles for inline CSS injection
 */
export function collectSVGStyles(
  components: Array<{ component: Component<any>; props?: any }>,
  config: SSRConfig = {}
): string {
  const allCSS = components
    .map(({ component, props }) => {
      const html = renderSVGToString(component, props, config);
      return extractCriticalCSS(html);
    })
    .filter(Boolean)
    .join('\n');

  return allCSS;
}
