#!/usr/bin/env node
/**
 * Production Server Fixture for E2E Tests
 */

import { createServer } from '../../../../dist/server/index.js';

// Parse command line args
const args = process.argv.slice(2);
const portIndex = args.indexOf('--port');
const port = portIndex >= 0 ? parseInt(args[portIndex + 1]) : 40000;

// Define simple routes for testing
const routes = [
  {
    path: '/',
    component: () => '<h1>Production Server</h1><p>Welcome to Aether</p>',
  },
  {
    path: '/about',
    component: () => '<h1>About</h1><p>About page</p>',
  },
  {
    path: '/contact',
    component: () => '<h1>Contact</h1><p>Contact page</p>',
  },
  {
    path: '/products',
    component: () => '<h1>Products</h1><p>Products page</p>',
  },
];

// Create and start production server
const server = await createServer({
  dev: false,
  mode: 'ssr',
  port,
  host: 'localhost',
  routes,
  compression: true,
  cache: true,
});

await server.listen();

console.log(`Production server running on http://localhost:${port}`);

// Handle shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down production server...');
  await server.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('Shutting down production server...');
  await server.close();
  process.exit(0);
});
