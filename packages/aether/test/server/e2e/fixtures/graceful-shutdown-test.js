#!/usr/bin/env node
/**
 * Graceful Shutdown Test Fixture for E2E Tests
 */

import { createServer } from '../../../../dist/server/index.js';

// Parse command line args
const args = process.argv.slice(2);
const portIndex = args.indexOf('--port');
const port = portIndex >= 0 ? parseInt(args[portIndex + 1]) : 66000;

// Define routes for testing
const routes = [
  {
    path: '/',
    component: () => '<h1>Graceful Shutdown Test</h1><p>Server ready</p>',
  },
];

// Create dev server (supports middleware)
const server = await createServer({
  dev: true,
  mode: 'ssr',
  port,
  host: 'localhost',
  routes,
  compression: false,
});

// Add custom middleware for /slow endpoint to test graceful shutdown
server.use({
  name: 'slow-endpoint',
  async handle(request, next) {
    const url = new URL(request.url);

    if (url.pathname === '/slow') {
      // Simulate slow request (2 seconds)
      await new Promise((resolve) => setTimeout(resolve, 2000));

      return new Response(
        JSON.stringify({
          message: 'Slow request completed',
          duration: 2000,
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );
    }

    return next();
  },
});

await server.listen();

console.log(`Graceful shutdown test server running on http://localhost:${port}`);

// Handle graceful shutdown
let isShuttingDown = false;
const activeRequests = new Set();

const shutdown = async (signal) => {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  console.log(`\nReceived ${signal}, gracefully shutting down...`);

  // Wait for active requests to complete (with timeout)
  const shutdownTimeout = setTimeout(() => {
    console.log('Shutdown timeout, forcing exit');
    process.exit(1);
  }, 5000);

  // Wait for active requests
  while (activeRequests.size > 0) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  clearTimeout(shutdownTimeout);

  await server.close();
  console.log('Server closed gracefully');
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
