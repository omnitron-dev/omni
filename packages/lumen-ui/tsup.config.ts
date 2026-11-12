import { defineConfig } from 'tsup';
import { reactClientEntries } from '../../scripts/react-client-entries.mjs';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'hydration/index': 'src/hydration/index.ts',
    'navigation/index': 'src/navigation/index.ts',
    'blocks/index': 'src/blocks/index.ts',
    'interactive/index': 'src/interactive/index.ts',
    'search/index': 'src/search/index.ts',
    // Keep the worker beside the shared chunks containing its new URL() caller.
    'playground-worker': 'src/interactive/playground-worker.ts',
  },
  format: ['esm'],
  dts: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
  external: [
    'react',
    'react-dom',
    'react/jsx-runtime',
    '@emotion/react',
    '@emotion/styled',
    '@emotion/cache',
    '@mui/material',
    '@omnitron-dev/prism',
    '@omnitron-dev/kb',
    '@omnitron-dev/lumen-ast',
    'katex',
    'zod',
    'clsx',
  ],
  esbuildOptions(options) {
    options.jsx = 'automatic';
  },
  plugins: [reactClientEntries(entry => entry !== 'playground-worker')],
});
