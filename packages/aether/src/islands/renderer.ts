/**
 * SSR Renderer with Islands
 *
 * Server-side rendering that generates islands and selective hydration
 */

import type { Component } from '../core/component/types.js';
import type { IslandComponent, IslandBoundary, IslandRenderResult, IslandManifest } from './types.js';
import { isIslandComponent, isServerComponent, isClientComponent } from './detector.js';
import { serializeData, isSSR } from './server-components.js';
import { registerRouteIsland } from './manifest.js';

/**
 * Island ID counter for unique IDs
 */
let islandIdCounter = 0;

/**
 * Reset island ID counter (for testing)
 */
export function resetIslandIdCounter(): void {
  islandIdCounter = 0;
}

/**
 * Generate unique island ID
 */
function generateIslandId(): string {
  return `island-${Date.now()}-${islandIdCounter++}`;
}

/**
 * Render component tree to HTML with islands
 *
 * Identifies islands during rendering and generates appropriate boundaries
 *
 * @param component - Root component
 * @param props - Component props
 * @param options - Render options
 * @returns Render result with islands
 */
export function renderToStringWithIslands(
  component: Component,
  props: any = {},
  options: {
    routePath?: string;
    manifest?: IslandManifest;
  } = {},
): IslandRenderResult {
  if (!isSSR()) {
    throw new Error('[Aether Islands] renderToStringWithIslands can only be called during SSR');
  }

  const islands: IslandBoundary[] = [];
  const routePath = options.routePath || '/';

  /**
   * Render a component or island
   */
  function renderComponent(comp: any, compProps: any = {}): string {
    // Handle null/undefined
    if (comp == null) {
      return '';
    }

    // Handle primitives
    if (typeof comp !== 'object' && typeof comp !== 'function') {
      return escapeHTML(String(comp));
    }

    // Handle arrays
    if (Array.isArray(comp)) {
      return comp.map((child) => renderComponent(child, {})).join('');
    }

    // Server-only component - render without JavaScript
    if (isServerComponent(comp)) {
      const result = comp(compProps);
      if (typeof result === 'function') {
        return renderJSX(result());
      }
      return renderJSX(result);
    }

    // Client-only component - use fallback for SSR
    if (isClientComponent(comp)) {
      const fallback = comp.__fallback;
      if (fallback) {
        return renderComponent(fallback, {});
      }
      return '<!-- client-only component -->';
    }

    // Island component - render with boundaries
    if (isIslandComponent(comp)) {
      return renderIsland(comp, compProps);
    }

    // Regular component - render normally
    if (typeof comp === 'function') {
      const result = comp(compProps);
      if (typeof result === 'function') {
        return renderJSX(result());
      }
      return renderJSX(result);
    }

    // JSX object
    if (comp.type) {
      return renderJSX(comp);
    }

    return '';
  }

  /**
   * Render an island with boundaries
   */
  function renderIsland(island: IslandComponent, islandProps: any): string {
    const islandId = generateIslandId();
    const islandOpts = island.__islandOptions;
    const strategy = islandOpts.hydrate || 'immediate';

    // Render island content
    const result = island(islandProps);
    const content = typeof result === 'function' ? renderJSX(result()) : renderJSX(result);

    // Serialize props for hydration
    const serializedProps = serializeData(islandProps);

    // Create island boundary
    const boundary: IslandBoundary = {
      id: islandId,
      name: islandOpts.name || island.displayName || island.name,
      strategy,
      props: serializedProps,
      startMarker: `<!--island-start:${islandId}-->`,
      endMarker: `<!--island-end:${islandId}-->`,
    };

    islands.push(boundary);

    // Register island usage in route
    registerRouteIsland(routePath, island.__islandId);

    // Generate island container with data attributes
    const dataAttrs = [
      `data-island-id="${islandId}"`,
      `data-island-name="${boundary.name}"`,
      `data-island-strategy="${strategy}"`,
      `data-island-props="${escapeHTML(serializedProps)}"`,
    ].join(' ');

    return `${boundary.startMarker}<div ${dataAttrs}>${content}</div>${boundary.endMarker}`;
  }

  /**
   * Render JSX to HTML
   */
  function renderJSX(jsx: any): string {
    // Handle null/undefined
    if (jsx == null) {
      return '';
    }

    // Handle primitives
    if (typeof jsx !== 'object') {
      return escapeHTML(String(jsx));
    }

    // Handle arrays
    if (Array.isArray(jsx)) {
      return jsx.map((child) => renderJSX(child)).join('');
    }

    // Handle JSX elements
    if (jsx.type) {
      const { type, props: elemProps } = jsx;

      // Component
      if (typeof type === 'function') {
        return renderComponent(type, elemProps || {});
      }

      // HTML element
      if (typeof type === 'string') {
        return renderHTMLElement(type, elemProps || {});
      }
    }

    return '';
  }

  /**
   * Render HTML element
   */
  function renderHTMLElement(tag: string, elemProps: any): string {
    const { children, innerHTML, ...attributes } = elemProps;

    // Build attributes
    const attrs = Object.entries(attributes)
      .filter(([key]) => !key.startsWith('on') && key !== 'ref')
      .map(([key, value]) => {
        if (value === true) return key;
        if (value === false || value == null) return '';
        const attrName = key === 'className' ? 'class' : key;
        return `${attrName}="${escapeHTML(String(value))}"`;
      })
      .filter(Boolean)
      .join(' ');

    // Self-closing tags
    if (isSelfClosing(tag)) {
      return `<${tag}${attrs ? ' ' + attrs : ''} />`;
    }

    // innerHTML
    if (innerHTML) {
      return `<${tag}${attrs ? ' ' + attrs : ''}>${innerHTML}</${tag}>`;
    }

    // Children
    const childrenHTML = Array.isArray(children)
      ? children.map((child) => renderJSX(child)).join('')
      : children != null
        ? renderJSX(children)
        : '';

    return `<${tag}${attrs ? ' ' + attrs : ''}>${childrenHTML}</${tag}>`;
  }

  // Render root component
  const html = renderComponent(component, props);

  // Generate hydration script
  const hydrationScript = generateHydrationScript(islands, options.manifest);

  return {
    html,
    islands,
    hydrationScript,
  };
}

/**
 * Generate hydration script for islands
 */
function generateHydrationScript(islands: IslandBoundary[], manifest?: IslandManifest): string {
  if (islands.length === 0) {
    return '';
  }

  const islandsData = islands.map((island) => ({
    id: island.id,
    name: island.name,
    strategy: island.strategy,
    props: island.props,
  }));

  return `
<script type="module">
  window.__AETHER_ISLANDS__ = ${JSON.stringify(islandsData)};

  // Load hydration runtime
  import('/islands/client.js').then(({ hydrateIslands }) => {
    hydrateIslands(window.__AETHER_ISLANDS__);
  }).catch(err => {
    console.error('[Aether Islands] Failed to load hydration runtime:', err);
  });
</script>
  `.trim();
}

/**
 * Wrap HTML in complete document with islands
 */
export function renderDocumentWithIslands(
  html: string,
  result: IslandRenderResult,
  options: {
    title?: string;
    description?: string;
    meta?: Record<string, string>;
    manifest?: IslandManifest;
  } = {},
): string {
  const title = options.title || 'Aether App';
  const description = options.description || '';

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHTML(title)}</title>
  ${description ? `<meta name="description" content="${escapeHTML(description)}">` : ''}
  ${Object.entries(options.meta || {})
    .map(([key, value]) => `<meta property="${escapeHTML(key)}" content="${escapeHTML(value)}">`)
    .join('\n  ')}
</head>
<body>
  <div id="app">${html}</div>
  ${result.hydrationScript}
</body>
</html>
  `.trim();
}

/**
 * Check if HTML tag is self-closing
 */
function isSelfClosing(tag: string): boolean {
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

/**
 * Extract islands from rendered HTML
 *
 * Parses HTML to find island boundaries and metadata
 *
 * @param html - Rendered HTML
 * @returns Island boundaries
 */
export function extractIslandsFromHTML(html: string): IslandBoundary[] {
  const islands: IslandBoundary[] = [];

  // Find all island start markers
  const startPattern = /<!--island-start:([^>]+)-->/g;

  let startMatch;
  while ((startMatch = startPattern.exec(html)) !== null) {
    const islandId = startMatch[1];
    const startIndex = startMatch.index;

    // Find corresponding end marker
    const endRegex = new RegExp(`<!--island-end:${islandId}-->`);
    const endMatch = endRegex.exec(html.slice(startIndex));

    if (endMatch) {
      // Extract island content
      const content = html.slice(startIndex + startMatch[0].length, startIndex + endMatch.index);

      // Parse data attributes
      const dataAttrPattern = /data-island-(\w+)="([^"]+)"/g;
      const attrs: Record<string, string> = {};

      let attrMatch;
      while ((attrMatch = dataAttrPattern.exec(content)) !== null) {
        if (attrMatch[1] && attrMatch[2]) {
          attrs[attrMatch[1]] = attrMatch[2];
        }
      }

      islands.push({
        id: islandId ?? '',
        name: attrs.name || '',
        strategy: (attrs.strategy as any) || 'immediate',
        props: attrs.props || '{}',
        startMarker: startMatch[0],
        endMarker: `<!--island-end:${islandId}-->`,
      });
    }
  }

  return islands;
}
