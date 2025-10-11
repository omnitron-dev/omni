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
  dts: true,
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
    '@omnitron-dev/eventemitter',
    '@omnitron-dev/messagepack',
    '@omnitron-dev/smartbuffer'
  ],
  // Ensure browser-compatible code
  esbuildOptions(options) {
    options.platform = 'browser';
    options.conditions = ['browser', 'module', 'import'];
  },
});
