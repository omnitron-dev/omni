/**
 * SSG HTML Renderer
 *
 * Renders components to static HTML for SSG
 */

import type { GeneratedPage, StaticPageMeta, SSGRoute } from './types.js';

/**
 * Render a route to static HTML
 *
 * @param route - Route to render
 * @param props - Props to pass to component
 * @param options - Rendering options
 * @returns Generated page
 */
export async function renderRoute(
  route: SSGRoute,
  props: any,
  options: {
    path: string;
    revalidate?: number | false;
    staleWhileRevalidate?: number;
    tags?: string[];
    meta?: StaticPageMeta;
    jsonLd?: Record<string, any>;
  },
): Promise<GeneratedPage> {
  const { path, revalidate, staleWhileRevalidate, tags, meta, jsonLd } = options;

  try {
    // Render component
    const html = await renderComponent(route.component, props);

    return {
      path,
      html,
      props,
      revalidate,
      staleWhileRevalidate,
      tags,
      meta,
      jsonLd,
      generatedAt: new Date(),
    };
  } catch (error) {
    throw new Error(`Error rendering route ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Render component to HTML
 *
 * @param Component - Component to render
 * @param props - Component props
 * @returns HTML string
 */
export async function renderComponent(Component: any, props: any = {}): Promise<string> {
  if (!Component) {
    throw new Error('Component is required');
  }

  try {
    // Execute component function to get render function
    const instance = Component(props);

    // If it's a function, execute it to get JSX
    if (typeof instance === 'function') {
      const jsx = instance();
      return renderJSX(jsx);
    }

    // If it's already JSX, render it
    return renderJSX(instance);
  } catch (error) {
    throw new Error(`Error rendering component: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Render JSX to HTML
 *
 * @param jsx - JSX element
 * @returns HTML string
 */
export function renderJSX(jsx: any): string {
  // Handle null/undefined
  if (jsx == null) {
    return '';
  }

  // Handle primitives
  if (typeof jsx !== 'object') {
    return escapeHTML(String(jsx));
  }

  // Handle arrays (fragments)
  if (Array.isArray(jsx)) {
    return jsx.map((child) => renderJSX(child)).join('');
  }

  // Handle JSX elements
  if (jsx.type) {
    const { type, props } = jsx;

    // Handle component functions
    if (typeof type === 'function') {
      const result = type(props || {});
      // If result is a function (render function), execute it
      if (typeof result === 'function') {
        return renderJSX(result());
      }
      return renderJSX(result);
    }

    // Handle HTML elements
    if (typeof type === 'string') {
      return renderHTMLElement(type, props);
    }
  }

  // Fallback
  return '';
}

/**
 * Render HTML element
 *
 * @param tag - HTML tag name
 * @param props - Element props
 * @returns HTML string
 */
export function renderHTMLElement(tag: string, props: any = {}): string {
  const { children, innerHTML, ...attributes } = props;

  // Build attributes string
  const attrs = buildAttributes(attributes);

  // Self-closing tags
  if (isSelfClosing(tag)) {
    return `<${tag}${attrs ? ' ' + attrs : ''} />`;
  }

  // Handle innerHTML
  if (innerHTML !== undefined) {
    return `<${tag}${attrs ? ' ' + attrs : ''}>${innerHTML}</${tag}>`;
  }

  // Regular tags with children
  const childrenHTML = Array.isArray(children)
    ? children.map((child) => renderJSX(child)).join('')
    : children != null
      ? renderJSX(children)
      : '';

  return `<${tag}${attrs ? ' ' + attrs : ''}>${childrenHTML}</${tag}>`;
}

/**
 * Build HTML attributes string
 *
 * @param attributes - Attributes object
 * @returns Attributes string
 */
export function buildAttributes(attributes: Record<string, any>): string {
  return Object.entries(attributes)
    .filter(([key]) => !key.startsWith('on') && key !== 'ref' && key !== 'innerHTML')
    .map(([key, value]) => {
      if (value === true) return key;
      if (value === false || value == null) return '';

      // Handle special attributes
      const attrName = getAttributeName(key);

      // Handle style object
      if (key === 'style' && typeof value === 'object') {
        return `style="${buildStyleString(value)}"`;
      }

      // Handle class array
      if ((key === 'className' || key === 'class') && Array.isArray(value)) {
        return `class="${value.filter(Boolean).join(' ')}"`;
      }

      return `${attrName}="${escapeHTML(String(value))}"`;
    })
    .filter(Boolean)
    .join(' ');
}

/**
 * Get HTML attribute name from JSX prop name
 *
 * @param propName - JSX prop name
 * @returns HTML attribute name
 */
export function getAttributeName(propName: string): string {
  const map: Record<string, string> = {
    className: 'class',
    htmlFor: 'for',
    tabIndex: 'tabindex',
    readOnly: 'readonly',
    maxLength: 'maxlength',
    minLength: 'minlength',
    autoComplete: 'autocomplete',
    autoFocus: 'autofocus',
    autoPlay: 'autoplay',
  };

  return map[propName] || propName.toLowerCase();
}

/**
 * Build style string from style object
 *
 * @param style - Style object
 * @returns Style string
 */
export function buildStyleString(style: Record<string, any>): string {
  return Object.entries(style)
    .map(([key, value]) => {
      const cssKey = key.replace(/([A-Z])/g, '-$1').toLowerCase();
      return `${cssKey}:${value}`;
    })
    .join(';');
}

/**
 * Check if HTML tag is self-closing
 *
 * @param tag - Tag name
 * @returns True if self-closing
 */
export function isSelfClosing(tag: string): boolean {
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
 *
 * @param str - String to escape
 * @returns Escaped string
 */
export function escapeHTML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Generate complete HTML document
 *
 * @param page - Generated page
 * @param options - Document options
 * @returns Complete HTML document
 */
export function generateDocument(
  page: GeneratedPage,
  options: {
    base?: string;
    scripts?: string[];
    styles?: string[];
    hydrate?: boolean;
  } = {},
): string {
  const { base = '/', scripts = [], styles = [], hydrate = true } = options;

  const title = page.meta?.title || 'Aether App';
  const description = page.meta?.description || '';

  // Build meta tags
  const metaTags = buildMetaTags(page.meta);

  // Build JSON-LD
  const jsonLdScript = page.jsonLd
    ? `<script type="application/ld+json">${JSON.stringify(page.jsonLd, null, 2)}</script>`
    : '';

  // Build hydration script
  const hydrationScript = hydrate
    ? `<script>window.__AETHER_SSG__=${JSON.stringify({
        path: page.path,
        props: page.props,
        generatedAt: page.generatedAt.toISOString(),
      })}</script>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHTML(title)}</title>
  ${description ? `<meta name="description" content="${escapeHTML(description)}">` : ''}
  ${base !== '/' ? `<base href="${escapeHTML(base)}">` : ''}
  ${metaTags}
  ${styles.map((style) => `<link rel="stylesheet" href="${escapeHTML(style)}">`).join('\n  ')}
  ${jsonLdScript}
</head>
<body>
  <div id="app">${page.html}</div>
  ${hydrationScript}
  ${scripts.map((script) => `<script type="module" src="${escapeHTML(script)}"></script>`).join('\n  ')}
</body>
</html>`;
}

/**
 * Build meta tags from meta object
 *
 * @param meta - Meta object
 * @returns Meta tags HTML
 */
export function buildMetaTags(meta?: StaticPageMeta): string {
  if (!meta) {
    return '';
  }

  const tags: string[] = [];

  // Canonical URL
  if (meta.canonical) {
    tags.push(`<link rel="canonical" href="${escapeHTML(meta.canonical)}">`);
  }

  // OpenGraph
  if (meta.ogTitle) {
    tags.push(`<meta property="og:title" content="${escapeHTML(meta.ogTitle)}">`);
  }
  if (meta.ogDescription) {
    tags.push(`<meta property="og:description" content="${escapeHTML(meta.ogDescription)}">`);
  }
  if (meta.ogImage) {
    tags.push(`<meta property="og:image" content="${escapeHTML(meta.ogImage)}">`);
  }
  if (meta.ogType) {
    tags.push(`<meta property="og:type" content="${escapeHTML(meta.ogType)}">`);
  }

  // Twitter Card
  if (meta.twitterCard) {
    tags.push(`<meta name="twitter:card" content="${escapeHTML(meta.twitterCard)}">`);
  }

  // Additional meta tags
  for (const [key, value] of Object.entries(meta)) {
    if (
      !['title', 'description', 'canonical', 'ogTitle', 'ogDescription', 'ogImage', 'ogType', 'twitterCard'].includes(
        key,
      )
    ) {
      tags.push(`<meta name="${escapeHTML(key)}" content="${escapeHTML(String(value))}">`);
    }
  }

  return tags.join('\n  ');
}

/**
 * Generate 404 page
 *
 * @param options - Options
 * @returns HTML string
 */
export function generate404Page(
  options: {
    base?: string;
    message?: string;
  } = {},
): string {
  const { base = '/', message = 'Page Not Found' } = options;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>404 - ${escapeHTML(message)}</title>
  ${base !== '/' ? `<base href="${escapeHTML(base)}">` : ''}
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      background: #f5f5f5;
    }
    .error {
      text-align: center;
      padding: 2rem;
    }
    .error h1 {
      font-size: 6rem;
      margin: 0;
      color: #333;
    }
    .error p {
      font-size: 1.5rem;
      color: #666;
    }
    .error a {
      display: inline-block;
      margin-top: 1rem;
      padding: 0.5rem 1rem;
      background: #007bff;
      color: white;
      text-decoration: none;
      border-radius: 4px;
    }
  </style>
</head>
<body>
  <div class="error">
    <h1>404</h1>
    <p>${escapeHTML(message)}</p>
    <a href="/">Go Home</a>
  </div>
</body>
</html>`;
}

/**
 * Optimize HTML
 *
 * Minifies and optimizes HTML
 *
 * @param html - HTML to optimize
 * @param options - Optimization options
 * @returns Optimized HTML
 */
export function optimizeHTML(
  html: string,
  options: {
    minify?: boolean;
    removeComments?: boolean;
    collapseWhitespace?: boolean;
  } = {},
): string {
  let optimized = html;

  // Remove comments
  if (options.removeComments) {
    optimized = optimized.replace(/<!--[\s\S]*?-->/g, '');
  }

  // Collapse whitespace
  if (options.collapseWhitespace) {
    optimized = optimized
      .replace(/\s+/g, ' ')
      .replace(/>\s+</g, '><')
      .trim();
  }

  return optimized;
}
