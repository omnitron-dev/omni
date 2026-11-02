import { defineConfig } from 'tsup';
import { reactClientEntries } from '../../scripts/react-client-entries.mjs';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'hooks/index': 'src/hooks/index.ts',
    'auth/index': 'src/auth/index.ts',
    'cache/index': 'src/cache/index.ts',
    'devtools/index': 'src/devtools/index.ts',
    'test/index': 'src/test/index.ts',
  },
  format: ['esm', 'cjs'],
  // Bundled declarations preserve separate ESM and CommonJS entry points.
  // tsup reads the TypeScript 6 Compiler API alias; tsc uses native TS 7.
  dts: true,
  splitting: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  minify: false,
  external: ['react', 'react-dom'],
  esbuildOptions(options) {
    options.jsx = 'automatic';
  },
  plugins: [reactClientEntries((entry: string) =>
    ['index', 'hooks/index', 'auth/index', 'test/index'].includes(entry))],
});
