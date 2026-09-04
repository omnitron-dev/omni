import { defineConfig } from 'tsup';

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
  // Declarations are emitted by `tsc` (see the build script), not by tsup.
  // tsup's `dts: true` runs a rollup-plugin-dts compiled INTO tsup — so
  // pnpm.overrides cannot raise it — and that copy reads TypeScript internals
  // removed in TS 7, failing at load with
  // "Cannot read properties of undefined (reading 'useCaseSensitiveFileNames')".
  dts: false,
  splitting: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  minify: false,
  external: ['react', 'react-dom'],
  esbuildOptions(options) {
    options.jsx = 'automatic';
  },
  banner: {
    js: '"use client";',
  },
});
