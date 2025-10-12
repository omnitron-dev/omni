/**
 * SSR Renderer
 *
 * Server-side rendering for Aether components
 */

import { createRouter } from '../router/router.js';
import { executeLoader, setLoaderData } from '../router/data.js';
import { findBestMatch } from '../router/route-matcher.js';
import type { RenderContext, RenderResult, ServerConfig } from './types.js';

/**
 * Render a route on the server
 *
 * Executes loaders, renders component tree, and returns HTML with hydration data
 *
 * @param config - Server configuration
 * @param context - Render context
 * @returns Render result with HTML and hydration data
 */
export async function renderToString(config: ServerConfig, context: RenderContext): Promise<RenderResult> {
  const { routes, base = '/' } = config;
  const { url, method } = context;

  try {
    // Find matching route
    const pathname = url.pathname.replace(base, '/').replace(/\/+/g, '/');
    const match = findBestMatch(pathname, routes);

    if (!match) {
      return {
        html: renderErrorPage(404, 'Not Found'),
        status: 404,
      };
    }

    // Execute loader if defined
    let loaderData: any = undefined;
    if (match.route.loader && method === 'GET') {
      try {
        loaderData = await executeLoader(match.route.loader, {
          params: match.params,
          url,
          request: new Request(url.href, {
            method,
            headers: context.headers,
          }),
        });
        setLoaderData(pathname, loaderData);
      } catch (error) {
        console.error('Loader error:', error);
        return {
          html: renderErrorPage(500, 'Server Error'),
          status: 500,
        };
      }
    }

    // Render component tree
    const Component = match.route.component;
    if (!Component) {
      return {
        html: renderErrorPage(500, 'No component defined for route'),
        status: 500,
      };
    }

    // Create router instance for SSR
    const router = createRouter({
      mode: 'memory',
      base,
      routes,
    });

    // Wait for router to initialize
    await router.ready();

    // Render component with props
    let html: string;
    try {
      // In a real implementation, this would use a proper SSR rendering context
      // For now, we'll return a basic HTML structure
      const componentHTML = renderComponentToHTML(Component, match.params);
      html = componentHTML;
    } catch (error) {
      console.error('Render error:', error);
      return {
        html: renderErrorPage(500, 'Render Error'),
        status: 500,
      };
    }

    // Prepare hydration data
    const hydrationData: Record<string, any> = {};
    if (loaderData !== undefined) {
      hydrationData[pathname] = loaderData;
    }

    // Build result
    const result: RenderResult = {
      html,
      data: hydrationData,
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
      },
    };

    // Extract meta tags from component if available
    if (match.route.meta) {
      result.meta = {
        title: match.route.meta.title,
        description: match.route.meta.description,
      };
    }

    return result;
  } catch (error) {
    console.error('SSR error:', error);
    return {
      html: renderErrorPage(500, 'Internal Server Error'),
      status: 500,
    };
  }
}

/**
 * Render component to HTML string
 *
 * This is a simplified version. Full implementation would traverse the component tree.
 *
 * @param Component - Component to render
 * @param props - Component props
 * @returns HTML string
 */
function renderComponentToHTML(Component: any, props: any): string {
  // Execute component function to get render function
  const instance = Component(props);

  // If it's a function, execute it to get JSX
  if (typeof instance === 'function') {
    const jsx = instance();
    return renderJSXToHTML(jsx);
  }

  // If it's already JSX, render it
  return renderJSXToHTML(instance);
}

/**
 * Render JSX to HTML string
 *
 * Recursively traverses JSX tree and converts to HTML
 *
 * @param jsx - JSX element
 * @returns HTML string
 */
function renderJSXToHTML(jsx: any): string {
  // Handle null/undefined
  if (jsx == null) {
    return '';
  }

  // Handle primitives (string, number, boolean)
  if (typeof jsx !== 'object') {
    return String(jsx);
  }

  // Handle arrays (fragments)
  if (Array.isArray(jsx)) {
    return jsx.map((child) => renderJSXToHTML(child)).join('');
  }

  // Handle JSX elements
  if (jsx.type) {
    const { type, props } = jsx;

    // Handle component functions
    if (typeof type === 'function') {
      const result = type(props || {});
      // If result is a function (render function), execute it
      if (typeof result === 'function') {
        return renderJSXToHTML(result());
      }
      return renderJSXToHTML(result);
    }

    // Handle HTML elements
    if (typeof type === 'string') {
      return renderHTMLElement(type, props);
    }
  }

  // Fallback - try to stringify
  return String(jsx);
}

/**
 * Render HTML element with props and children
 *
 * @param tag - HTML tag name
 * @param props - Element props
 * @returns HTML string
 */
function renderHTMLElement(tag: string, props: any = {}): string {
  const { children, ...attributes } = props;

  // Build attributes string
  const attrs = Object.entries(attributes)
    .filter(([key]) => !key.startsWith('on') && key !== 'ref') // Skip event handlers and refs
    .map(([key, value]) => {
      if (value === true) return key;
      if (value === false || value == null) return '';
      // Handle className -> class
      const attrName = key === 'className' ? 'class' : key;
      return `${attrName}="${escapeHTML(String(value))}"`;
    })
    .filter(Boolean)
    .join(' ');

  // Self-closing tags
  if (isSelfClosing(tag)) {
    return `<${tag}${attrs ? ' ' + attrs : ''} />`;
  }

  // Regular tags
  const childrenHTML = Array.isArray(children)
    ? children.map((child) => renderJSXToHTML(child)).join('')
    : children != null
      ? renderJSXToHTML(children)
      : '';

  return `<${tag}${attrs ? ' ' + attrs : ''}>${childrenHTML}</${tag}>`;
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
 * Render error page
 */
function renderErrorPage(status: number, message: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${status} - ${message}</title>
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
  </style>
</head>
<body>
  <div class="error">
    <h1>${status}</h1>
    <p>${message}</p>
  </div>
</body>
</html>
  `.trim();
}

/**
 * Generate HTML document with hydration script
 *
 * @param html - Rendered HTML content
 * @param data - Hydration data
 * @param meta - Meta tags
 * @returns Complete HTML document
 */
export function renderDocument(html: string, data?: Record<string, any>, meta?: Record<string, string>): string {
  const title = meta?.title || 'Aether App';
  const description = meta?.description || '';

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHTML(title)}</title>
  ${description ? `<meta name="description" content="${escapeHTML(description)}">` : ''}
  ${meta?.canonical ? `<link rel="canonical" href="${escapeHTML(meta.canonical)}">` : ''}
  ${meta?.ogTitle ? `<meta property="og:title" content="${escapeHTML(meta.ogTitle)}">` : ''}
  ${meta?.ogDescription ? `<meta property="og:description" content="${escapeHTML(meta.ogDescription)}">` : ''}
  ${meta?.ogImage ? `<meta property="og:image" content="${escapeHTML(meta.ogImage)}">` : ''}
</head>
<body>
  <div id="app">${html}</div>
  ${data ? `<script>window.__AETHER_DATA__=${JSON.stringify(data)}</script>` : ''}
  <script type="module" src="/app.js"></script>
</body>
</html>
  `.trim();
}
