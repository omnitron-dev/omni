import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'core/index': 'src/core/index.ts',
    'core/reactivity/index': 'src/core/reactivity/index.ts',
    'core/component/index': 'src/core/component/index.ts',
    'jsx-runtime': 'src/jsx-runtime.ts',
    'jsx-dev-runtime': 'src/jsx-dev-runtime.ts',
    'di/index': 'src/di/index.ts',
    'modules/index': 'src/modules/index.ts',
    'router/index': 'src/router/index.ts',
    'forms/index': 'src/forms/index.ts',
    'control-flow/index': 'src/control-flow/index.ts',
    'primitives/index': 'src/primitives/index.ts',
    'server/index': 'src/server/index.ts',
    'netron/index': 'src/netron/index.ts',
    'store/index': 'src/store/index.ts',
    'data/index': 'src/data/index.ts',
    'suspense/index': 'src/suspense/index.ts',
    'i18n/index': 'src/i18n/index.ts',
    'styling/index': 'src/styling/index.ts',
    'theming/index': 'src/theming/index.ts',
    'compiler/index': 'src/compiler/index.ts',
    'testing/index': 'src/testing/index.ts',
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
  external: [
    '@omnitron-dev/netron-browser',
    '@omnitron-dev/aether/jsx-runtime',
    '@omnitron-dev/aether/jsx-dev-runtime',
  ],
  esbuildOptions(options) {
    // Allow jsx-runtime imports to be resolved after build
    options.alias = {
      '@omnitron-dev/aether/jsx-runtime': './jsx-runtime.js',
      '@omnitron-dev/aether/jsx-dev-runtime': './jsx-dev-runtime.js',
    };
  },
});
