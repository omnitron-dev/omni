/**
 * SSR Renderer with Islands Support
 *
 * Enhanced SSR renderer that supports islands architecture
 */

import { renderToStringWithIslands } from '../islands/renderer.js';
import { generatePreloadHints, generateIslandLoader } from '../islands/manifest.js';
import { setServerContext, clearServerContext, createServerContextFromRequest } from '../islands/server-components.js';
import type { IslandManifest, IslandBoundary } from '../islands/types.js';
import type { RenderContext, RenderResult, ServerConfig } from './types.js';
import { findBestMatch } from '../router/route-matcher.js';
import { executeLoader, setLoaderData } from '../router/data.js';

/**
 * Render to string with islands support
 *
 * @param config - Server configuration
 * @param context - Render context
 * @param manifest - Island manifest
 * @returns Render result with islands
 */
export async function renderToStringWithIslandsSSR(
  config: ServerConfig,
  context: RenderContext,
  manifest?: IslandManifest
): Promise<Omit<RenderResult, 'islands'> & { islands: IslandBoundary[] }> {
  const { routes, base = '/' } = config;
  const { url, method, headers = {} } = context;

  try {
    // Find matching route
    const pathname = url.pathname.replace(base, '/').replace(/\/+/g, '/');
    const match = findBestMatch(pathname, routes);

    if (!match) {
      return {
        html: renderErrorPage(404, 'Not Found'),
        status: 404,
        islands: [],
      };
    }

    // Create server context for server components
    const request = new Request(url.href, {
      method,
      headers: new Headers(headers as Record<string, string>),
    });

    const serverContext = createServerContextFromRequest(request);
    setServerContext(serverContext);

    try {
      // Execute loader if defined
      let loaderData: any = undefined;
      if (match.route.loader && method === 'GET') {
        try {
          loaderData = await executeLoader(match.route.loader, {
            params: match.params,
            url,
            request,
          });
          setLoaderData(pathname, loaderData);
        } catch (error) {
          console.error('Loader error:', error);
          return {
            html: renderErrorPage(500, 'Server Error'),
            status: 500,
            islands: [],
          };
        }
      }

      // Render component tree with islands
      const Component = match.route.component;
      if (!Component) {
        return {
          html: renderErrorPage(500, 'No component defined for route'),
          status: 500,
          islands: [],
        };
      }

      const result = renderToStringWithIslands(Component, match.params, {
        routePath: pathname,
        manifest,
      });

      // Prepare hydration data
      const hydrationData: Record<string, any> = {};
      if (loaderData !== undefined) {
        hydrationData[pathname] = loaderData;
      }

      // Build result
      const renderResult: Omit<RenderResult, 'islands'> & { islands: IslandBoundary[] } = {
        html: result.html,
        data: hydrationData,
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
        },
        islands: result.islands,
      };

      // Extract meta tags from component if available
      if (match.route.meta) {
        renderResult.meta = {
          title: match.route.meta.title,
          description: match.route.meta.description,
        };
      }

      return renderResult;
    } finally {
      // Clear server context
      clearServerContext();
    }
  } catch (error) {
    console.error('SSR error:', error);
    clearServerContext(); // Make sure to clear on error
    return {
      html: renderErrorPage(500, 'Internal Server Error'),
      status: 500,
      islands: [],
    };
  }
}

/**
 * Generate complete document for SSR with islands
 *
 * @param html - Rendered HTML
 * @param result - Render result
 * @param options - Document options
 * @returns Complete HTML document
 */
export function generateDocumentForSSR(
  html: string,
  result: Omit<RenderResult, 'islands'> & { islands: IslandBoundary[] },
  options: {
    title?: string;
    description?: string;
    meta?: Record<string, string>;
    manifest?: IslandManifest;
    scripts?: string[];
    styles?: string[];
    base?: string;
  } = {}
): string {
  const {
    title = 'Aether App',
    description = '',
    meta = {},
    manifest,
    scripts = [],
    styles = [],
    base = '/',
  } = options;

  // Generate island preload hints
  const preloadHints = manifest && result.islands.length > 0 ? generatePreloadHints(manifest, '/') : '';

  // Generate island loader
  const islandLoader = manifest && result.islands.length > 0 ? generateIslandLoader(manifest, '/') : '';

  // Build meta tags
  const metaTags = Object.entries(meta)
    .map(([key, value]) => `<meta property="${escapeHTML(key)}" content="${escapeHTML(value)}">`)
    .join('\n  ');

  // Build hydration data script
  const hydrationData = {
    data: result.data,
    islands: result.islands.map((island) => ({
      id: island.id,
      name: island.name,
      strategy: island.strategy,
      props: island.props,
    })),
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHTML(title)}</title>
  ${description ? `<meta name="description" content="${escapeHTML(description)}">` : ''}
  ${base !== '/' ? `<base href="${escapeHTML(base)}">` : ''}
  ${metaTags}
  ${preloadHints}
  ${styles.map((style) => `<link rel="stylesheet" href="${escapeHTML(style)}">`).join('\n  ')}
</head>
<body>
  <div id="app">${html}</div>
  <script>window.__AETHER_DATA__ = ${JSON.stringify(hydrationData)}</script>
  ${islandLoader ? `<script type="module">${islandLoader}</script>` : ''}
  ${scripts.map((script) => `<script type="module" src="${escapeHTML(script)}"></script>`).join('\n  ')}
</body>
</html>`;
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
 * Stream SSR with islands
 *
 * Streams the response with incremental hydration
 *
 * @param config - Server configuration
 * @param context - Render context
 * @param manifest - Island manifest
 * @returns Async iterable of HTML chunks
 */
export async function* streamSSRWithIslands(
  config: ServerConfig,
  context: RenderContext,
  manifest?: IslandManifest
): AsyncIterable<string> {
  const result = await renderToStringWithIslandsSSR(config, context, manifest);

  // Yield document head
  yield `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHTML(result.meta?.title || 'Aether App')}</title>
</head>
<body>
  <div id="app">`;

  // Yield main content
  yield result.html;

  // Yield hydration script
  yield `</div>
  <script>window.__AETHER_DATA__ = ${JSON.stringify({
    data: result.data,
    islands: result.islands.map((island) => ({
      id: island.id,
      name: island.name,
      strategy: island.strategy,
      props: island.props,
    })),
  })}</script>`;

  // Yield island loader
  if (manifest && result.islands.length > 0) {
    const loader = generateIslandLoader(manifest, '/');
    yield `<script type="module">${loader}</script>`;
  }

  yield `</body>
</html>`;
}
