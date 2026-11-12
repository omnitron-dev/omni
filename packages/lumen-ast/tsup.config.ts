import { defineConfig } from 'tsup';
import { typescriptLibrariesEsbuildPlugin } from './build/typescript-libraries.js';
import manifest from './package.json';

export default defineConfig({
  ...manifest.tsup,
  entry: [
    'src/index.ts',
    'src/execution/index.ts',
    'src/execution/limits.ts',
    'src/islands/index.ts',
    'src/typst/index.ts',
    'src/mcp/index.ts',
    'src/diagrams/index.ts',
  ],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  esbuildPlugins: [typescriptLibrariesEsbuildPlugin()],
});
