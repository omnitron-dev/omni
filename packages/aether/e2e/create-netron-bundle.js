/**
 * Create unified Netron browser bundle for E2E tests
 */

import esbuild from 'esbuild';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const result = await esbuild.build({
  entryPoints: [join(__dirname, '../src/netron/client.ts')],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  platform: 'browser',
  outfile: join(__dirname, 'pages/netron-unified.js'),
  sourcemap: true,
  external: [],
  minify: false,
  keepNames: true,
  logLevel: 'info',
  inject: [join(__dirname, './stubs/process-shim.js')],
  define: {
    'process.env.NODE_ENV': '"production"',
    'global': 'globalThis',
    'Buffer': 'globalThis.Buffer'
  },
  alias: {
    'stream': join(__dirname, './stubs/stream.js'),
    'events': join(__dirname, './stubs/events.js'),
    'buffer': 'buffer/'
  }
});

if (result.errors.length > 0) {
  console.error('Build failed:', result.errors);
  process.exit(1);
}

console.log('✓ Netron unified bundle created successfully');
