#!/usr/bin/env node
/**
 * Runtime Test Fixture for E2E Tests
 * Tests server compatibility with Node.js, Bun, and Deno
 */

import { createServer } from '../../../../dist/server/index.js';

// Error handling
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception in runtime test:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection in runtime test:', reason);
  process.exit(1);
});

// Detect runtime
function detectRuntime() {
  if (typeof Bun !== 'undefined') {
    return 'bun';
  } else if (typeof Deno !== 'undefined') {
    return 'deno';
  } else {
    return 'node';
  }
}

const runtime = detectRuntime();
console.log(`Detected runtime: ${runtime}`);

// Parse command line args
const args = process.argv.slice(2);
const portIndex = args.indexOf('--port');
const port = portIndex >= 0 ? parseInt(args[portIndex + 1]) : 62000;

// Define routes for testing
const routes = [
  {
    path: '/',
    component: () => `<h1>Runtime: ${runtime}</h1><p>Server is running</p>`,
  },
];

// Create server with custom middleware for /_info endpoint
const server = await createServer({
  dev: false,
  mode: 'ssr',
  port,
  host: 'localhost',
  routes,
});

// Add custom middleware for /_info endpoint
server.use({
  name: 'info-endpoint',
  async handle(request, next) {
    const url = new URL(request.url);

    if (url.pathname === '/_info') {
      return new Response(
        JSON.stringify({
          runtime,
          version: runtime === 'node' ? process.version : 'unknown',
          platform: runtime === 'node' ? process.platform : 'unknown',
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

console.log(`Runtime test server (${runtime}) running on http://localhost:${port}`);

// Handle shutdown
const shutdown = async () => {
  console.log(`Shutting down ${runtime} server...`);
  await server.close();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
