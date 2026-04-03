/**
 * Build script for E2E test fixtures
 * Bundles the test client for browser usage
 */

import { build } from 'tsup';
import { createTitanServer } from './titan-server.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Build the test client bundle
 */
export async function buildTestClient() {
  console.log('Building test client bundle...');

  await build({
    entry: {
      'test-client': path.join(__dirname, 'test-client.ts'),
    },
    outDir: path.join(__dirname, '../../dist'),
    format: ['iife'],
    globalName: 'NetronBrowserApp',
    platform: 'browser',
    target: 'es2020',
    bundle: true,
    splitting: false,
    sourcemap: true,
    clean: false,
    external: [],
    noExternal: [/(.*)/],
    treeshake: true,
    minify: false,
    dts: false,
  });

  console.log('Test client bundle created at dist/test-client.js');
}

/**
 * Start test server for E2E tests
 */
export async function startTestServer(port?: number) {
  console.log('Starting Titan test server...');

  const server = await createTitanServer({
    port,
    enableHttp: true,
    enableWebSocket: true,
    logLevel: process.env.DEBUG ? 'debug' : 'silent',
  });

  console.log(`Test server started:`);
  console.log(`  HTTP: ${server.httpUrl}`);
  console.log(`  WebSocket: ${server.wsUrl}`);
  console.log(`  Port: ${server.port}`);

  return server;
}

/**
 * Main build and serve function
 */
export async function buildAndServe(port?: number) {
  await buildTestClient();
  const server = await startTestServer(port);

  // Handle graceful shutdown
  const cleanup = async () => {
    console.log('\nShutting down test server...');
    await server.cleanup();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  return server;
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  buildAndServe(port).catch((error) => {
    console.error('Failed to build and serve:', error);
    process.exit(1);
  });
}
