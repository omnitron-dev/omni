/**
 * Static File Server — Serves the Omnitron Console webapp
 *
 * Implements a custom route handler for Titan's HTTP transport that
 * serves the bundled SPA (Single Page Application) from webapp/dist/.
 *
 * Routing:
 * - /netron/invoke, /netron/batch, etc. → handled by Netron (RPC)
 * - /health, /metrics → handled by Netron (built-in)
 * - Everything else → static files from webapp/dist/
 * - 404 for static → falls back to index.html (SPA client-side routing)
 *
 * This means the daemon's HTTP port (9800) serves BOTH:
 * - Netron RPC (for webapp API calls)
 * - Static files (for the webapp itself)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** MIME type map for common web assets */
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.webmanifest': 'application/manifest+json',
};

/** Paths that should NOT be served as static files (handled by Netron) */
const NETRON_PATHS = new Set([
  '/netron/invoke',
  '/netron/batch',
  '/netron/authenticate',
  '/health',
  '/metrics',
  '/openapi.json',
]);

/**
 * Resolve the webapp dist directory.
 * In compiled mode: apps/omnitron/dist/webapp/ → apps/omnitron/webapp/dist/
 * In dev mode: apps/omnitron/src/webapp/ → apps/omnitron/webapp/dist/
 */
function resolveWebappDir(): string {
  // Walk up from current file to find the webapp/dist directory
  const candidates = [
    path.resolve(__dirname, '../../webapp/dist'),      // from dist/webapp/
    path.resolve(__dirname, '../../../webapp/dist'),    // from dist/src/webapp/
    path.resolve(__dirname, '../../webapp/dist'),       // from src/webapp/
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  // Fallback: relative to process.cwd()
  const cwdCandidate = path.resolve(process.cwd(), 'apps/omnitron/webapp/dist');
  if (fs.existsSync(cwdCandidate)) return cwdCandidate;

  // Not built yet — return a non-existent path (will serve 404 gracefully)
  return candidates[0]!;
}

/**
 * Create a static file serving handler for Titan HTTP transport's customRoutes.
 *
 * @param webappDir - Override for the webapp dist directory (for testing)
 * @returns Custom route handler: (Request) => Response | null
 */
export function createStaticFileHandler(webappDir?: string): (request: Request) => Promise<Response | null> {
  const distDir = webappDir ?? resolveWebappDir();
  const indexHtml = path.join(distDir, 'index.html');

  // Pre-read index.html into memory for fast SPA fallback
  let cachedIndexHtml: Uint8Array | null = null;
  if (fs.existsSync(indexHtml)) {
    cachedIndexHtml = fs.readFileSync(indexHtml);
  }

  return async (request: Request): Promise<Response | null> => {
    const url = new URL(request.url, 'http://localhost');
    const pathname = url.pathname;

    // Skip Netron-handled paths — return null to let Netron handle them
    if (NETRON_PATHS.has(pathname)) return null;

    // Skip OPTIONS (CORS preflight) — let Netron handle
    if (request.method === 'OPTIONS') return null;

    // Only serve GET/HEAD for static files
    if (request.method !== 'GET' && request.method !== 'HEAD') return null;

    // Try to serve static file
    const filePath = path.join(distDir, pathname);

    // Security: prevent directory traversal
    if (!filePath.startsWith(distDir)) {
      return new Response('Forbidden', { status: 403 });
    }

    // Check if file exists
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      return serveFile(filePath, request.method === 'HEAD');
    }

    // SPA fallback: serve index.html for all non-file routes
    // (React Router handles client-side routing)
    if (!pathname.includes('.') && cachedIndexHtml) {
      return new Response(request.method === 'HEAD' ? null : cachedIndexHtml, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache',
        },
      });
    }

    // Static file not found — return null to let Netron return its 404
    return null;
  };
}

/**
 * Serve a single file with appropriate headers.
 */
function serveFile(filePath: string, headOnly: boolean): Response {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
  const stat = fs.statSync(filePath);

  // Aggressive caching for hashed assets (Vite adds hash to filenames)
  const isHashedAsset = /\.[a-f0-9]{8,}\.(js|css|woff2?|ttf|png|jpg|svg)$/i.test(filePath);
  const cacheControl = isHashedAsset
    ? 'public, max-age=31536000, immutable'  // 1 year for hashed assets
    : 'no-cache';                              // Always revalidate for index.html etc.

  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'Content-Length': String(stat.size),
    'Cache-Control': cacheControl,
    'Last-Modified': stat.mtime.toUTCString(),
  };

  if (headOnly) {
    return new Response(null, { status: 200, headers });
  }

  const body = fs.readFileSync(filePath);
  return new Response(body, { status: 200, headers });
}
