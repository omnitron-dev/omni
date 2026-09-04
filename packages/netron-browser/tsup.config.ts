import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'client/index': 'src/client/index.ts',
    'client/http-client': 'src/client/http-client.ts',
    'client/ws-client': 'src/client/ws-client.ts',
    'types/index': 'src/types/index.ts',
    'errors/index': 'src/errors/index.ts',
    'utils/index': 'src/utils/index.ts',
    'packet/index': 'src/packet/index.ts',
    'middleware/index': 'src/middleware/index.ts',
  },
  format: ['esm'],
  // Declarations are emitted by `tsc` (see the build script), not by tsup.
  // tsup's `dts: true` runs a rollup-plugin-dts compiled INTO tsup — so
  // pnpm.overrides cannot raise it — and that copy reads TypeScript internals
  // removed in TS 7, failing at load with
  // "Cannot read properties of undefined (reading 'useCaseSensitiveFileNames')".
  dts: false,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  minify: false,
  target: 'es2022',
  outDir: 'dist',
  tsconfig: './tsconfig.json',
  platform: 'browser',
  // External dependencies that should not be bundled
  external: [
    '@omnitron-dev/common',
    '@omnitron-dev/cuid',
    '@omnitron-dev/eventemitter',
    '@omnitron-dev/msgpack',
    'buffer',
  ],
  // Ensure browser-compatible code
  esbuildOptions(options) {
    options.platform = 'browser';
    options.conditions = ['browser', 'module', 'import'];
  },
});
