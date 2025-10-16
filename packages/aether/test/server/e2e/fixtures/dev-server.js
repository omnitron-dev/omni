#!/usr/bin/env node
/**
 * Development Server Fixture for E2E Tests
 */

import { createServer } from '../../../../dist/server/index.js';

// Parse command line args
const args = process.argv.slice(2);
const portIndex = args.indexOf('--port');
const port = portIndex >= 0 ? parseInt(args[portIndex + 1]) : 50000;

// Define simple routes for testing
const routes = [
  {
    path: '/',
    component: () => '<h1>Development Server</h1><p>HMR enabled</p>',
  },
  {
    path: '/error-test',
    component: () => {
      throw new Error('Test error for error overlay');
    },
  },
];

// Create and start development server
const server = await createServer({
  dev: true,
  mode: 'ssr',
  port,
  host: 'localhost',
  routes,
  hmr: true,
  errorOverlay: true,
  cors: true,
});

await server.listen();

console.log(`Development server running on http://localhost:${port}`);

// Handle shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down development server...');
  await server.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('Shutting down development server...');
  await server.close();
  process.exit(0);
});
