/**
 * Dev Middleware
 *
 * Middleware stack for Aether dev server
 */

import type { Middleware, MiddlewareStack as IMiddlewareStack, DevServerConfig } from '../types.js';

/**
 * Middleware Stack Implementation
 */
export class MiddlewareStack implements IMiddlewareStack {
  private middlewares: Middleware[] = [];

  /**
   * Add middleware to stack
   */
  use(middleware: Middleware): void {
    this.middlewares.push(middleware);
  }

  /**
   * Handle request through middleware chain
   */
  async handle(req: Request): Promise<Response> {
    let index = 0;

    const next = async (): Promise<Response> => {
      if (index >= this.middlewares.length) {
        return new Response('Not Found', { status: 404 });
      }

      const middleware = this.middlewares[index++];

      try {
        return await middleware.handle(req, next);
      } catch (error) {
        console.error(`[Middleware:${middleware.name}] Error:`, error);
        throw error;
      }
    };

    return next();
  }

  /**
   * Get all middleware names
   */
  getNames(): string[] {
    return this.middlewares.map((m) => m.name);
  }

  /**
   * Clear all middleware
   */
  clear(): void {
    this.middlewares = [];
  }
}

/**
 * Create dev middleware stack
 */
export function createDevMiddleware(config: DevServerConfig): MiddlewareStack {
  const stack = new MiddlewareStack();

  // Logger middleware (first to log all requests)
  stack.use(createLoggerMiddleware());

  // CORS middleware
  if (config.cors !== false) {
    stack.use(createCorsMiddleware(config.cors || {}));
  }

  // Compression middleware
  if (config.compression !== false) {
    stack.use(createCompressionMiddleware(config.compression || {}));
  }

  // Static files middleware
  if (config.publicDir) {
    stack.use(createStaticMiddleware(config.publicDir));
  }

  // HMR WebSocket upgrade
  stack.use(createHMRMiddleware());

  return stack;
}

/**
 * Logger Middleware
 */
function createLoggerMiddleware(): Middleware {
  return {
    name: 'logger',
    async handle(req, next) {
      const start = Date.now();
      const url = new URL(req.url);

      try {
        const response = await next();
        const duration = Date.now() - start;

        console.log(`${req.method} ${url.pathname} ${response.status} ${duration}ms`);

        return response;
      } catch (error) {
        const duration = Date.now() - start;
        console.error(`${req.method} ${url.pathname} ERROR ${duration}ms`, error);
        throw error;
      }
    },
  };
}

/**
 * CORS Middleware
 */
function createCorsMiddleware(config: any): Middleware {
  const {
    origin = '*',
    methods = ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders = ['Content-Type', 'Authorization'],
    exposedHeaders = [],
    credentials = true,
    maxAge = 86400,
  } = config;

  return {
    name: 'cors',
    async handle(req, next) {
      // Handle preflight
      if (req.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': origin,
            'Access-Control-Allow-Methods': methods.join(', '),
            'Access-Control-Allow-Headers': allowedHeaders.join(', '),
            'Access-Control-Expose-Headers': exposedHeaders.join(', '),
            'Access-Control-Allow-Credentials': credentials ? 'true' : 'false',
            'Access-Control-Max-Age': String(maxAge),
          },
        });
      }

      // Get response from next middleware
      const response = await next();

      // Add CORS headers
      const headers = new Headers(response.headers);
      headers.set('Access-Control-Allow-Origin', origin);
      headers.set('Access-Control-Allow-Credentials', credentials ? 'true' : 'false');

      if (exposedHeaders.length > 0) {
        headers.set('Access-Control-Expose-Headers', exposedHeaders.join(', '));
      }

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    },
  };
}

/**
 * Compression Middleware
 */
function createCompressionMiddleware(config: any): Middleware {
  const { threshold = 1024, _level = 6, filter } = config;

  return {
    name: 'compression',
    async handle(req, next) {
      const response = await next();

      // Check if compression should be applied
      if (filter && !filter(req)) {
        return response;
      }

      // Skip if already compressed
      if (response.headers.get('Content-Encoding')) {
        return response;
      }

      // Skip small responses
      const contentLength = response.headers.get('Content-Length');
      if (contentLength && parseInt(contentLength) < threshold) {
        return response;
      }

      // Check if client accepts compression
      const acceptEncoding = req.headers.get('Accept-Encoding') || '';

      // Try Brotli first (better compression)
      if (acceptEncoding.includes('br') && typeof CompressionStream !== 'undefined') {
        const stream = response.body?.pipeThrough(
          new CompressionStream('gzip') // Note: Brotli not yet in CompressionStream
        );

        const headers = new Headers(response.headers);
        headers.set('Content-Encoding', 'gzip');
        headers.delete('Content-Length');

        return new Response(stream, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      }

      // Fallback to gzip
      if (acceptEncoding.includes('gzip') && typeof CompressionStream !== 'undefined') {
        const stream = response.body?.pipeThrough(new CompressionStream('gzip'));

        const headers = new Headers(response.headers);
        headers.set('Content-Encoding', 'gzip');
        headers.delete('Content-Length');

        return new Response(stream, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      }

      // No compression support
      return response;
    },
  };
}

/**
 * Static Files Middleware
 */
function createStaticMiddleware(publicDir: string): Middleware {
  return {
    name: 'static',
    async handle(req, next) {
      const url = new URL(req.url);

      // Only handle GET requests
      if (req.method !== 'GET') {
        return next();
      }

      // Check if path looks like a static file
      const ext = url.pathname.split('.').pop();
      const isStatic =
        ext && ['js', 'css', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'woff', 'woff2', 'ttf', 'eot'].includes(ext);

      if (!isStatic) {
        return next();
      }

      try {
        // Try to read file (Node.js specific)
        if (typeof process !== 'undefined') {
          const fs = await import('node:fs/promises');
          const path = await import('node:path');

          const filePath = path.join(publicDir, url.pathname);
          const file = await fs.readFile(filePath);

          // Determine content type
          const contentType = getContentType(ext);

          return new Response(file, {
            status: 200,
            headers: {
              'Content-Type': contentType,
              'Cache-Control': 'public, max-age=31536000',
            },
          });
        }
      } catch (_error) {
        // File not found, pass to next middleware
      }

      return next();
    },
  };
}

/**
 * HMR Middleware (WebSocket upgrade)
 */
function createHMRMiddleware(): Middleware {
  return {
    name: 'hmr',
    async handle(req, next) {
      const url = new URL(req.url);

      // Check if this is an HMR WebSocket upgrade request
      if (url.pathname === '/__aether_hmr') {
        // This will be handled by the WebSocket server
        // For now, just return a marker response
        return new Response('WebSocket Upgrade', {
          status: 101,
          headers: {
            'X-Aether-HMR': 'true',
          },
        });
      }

      return next();
    },
  };
}

/**
 * Get content type for file extension
 */
function getContentType(ext: string): string {
  const types: Record<string, string> = {
    html: 'text/html',
    css: 'text/css',
    js: 'application/javascript',
    json: 'application/json',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    ico: 'image/x-icon',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
    eot: 'application/vnd.ms-fontobject',
  };

  return types[ext] || 'application/octet-stream';
}

export {
  createLoggerMiddleware,
  createCorsMiddleware,
  createCompressionMiddleware,
  createStaticMiddleware,
  createHMRMiddleware,
};
