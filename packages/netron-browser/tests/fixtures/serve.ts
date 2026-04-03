/**
 * Static file server for E2E tests
 * Serves the test HTML page and Titan backend
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTestClient, startTestServer } from './build.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function startServer(port = 3000) {
  // Build the test client first
  await buildTestClient();

  // Start Titan server
  const titanServer = await startTestServer(port);

  // Create HTTP server to serve static files
  const server = createServer(async (req, res) => {
    try {
      // Handle different routes
      if (req.url === '/' || req.url === '/index.html') {
        // Serve test app HTML
        const html = await readFile(join(__dirname, 'test-app.html'), 'utf-8');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
      } else if (req.url?.startsWith('/dist/')) {
        // Serve built client bundle
        const filePath = join(__dirname, '../..', req.url);
        const content = await readFile(filePath, 'utf-8');
        const contentType = req.url.endsWith('.js')
          ? 'application/javascript'
          : req.url.endsWith('.map')
            ? 'application/json'
            : 'text/plain';
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
      } else if (req.url?.startsWith('/netron/')) {
        // Proxy to Titan server - but we don't need this because
        // the client connects directly to the server
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found - connect directly to server');
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
      }
    } catch (error: any) {
      console.error('Server error:', error);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(`Error: ${error.message}`);
    }
  });

  // Start HTTP server on same port
  await new Promise<void>((resolve, reject) => {
    server.listen(port, () => {
      console.log(`E2E test server running at http://localhost:${port}`);
      resolve();
    });
    server.on('error', reject);
  });

  // Handle shutdown
  const cleanup = async () => {
    console.log('\nShutting down servers...');
    server.close();
    await titanServer.cleanup();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  return {
    server,
    titanServer,
    cleanup,
  };
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  startServer(port).catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
}

export { startServer };
