#!/usr/bin/env node
/**
 * Creates a minimal browser bundle for E2E testing
 * Bundles only the browser-compatible parts of Aether Netron client
 */

import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

await build({
  entryPoints: [join(__dirname, '../src/netron/index.browser.ts')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  outfile: join(__dirname, 'pages/dist/netron-browser.js'),
  sourcemap: true,
  minify: false,
  treeShaking: true,
  logLevel: 'info',
  external: [],
});

console.log('✓ Browser bundle created at e2e/pages/dist/netron-browser.js');
