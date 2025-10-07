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
    'router/index': 'src/router/index.ts',
    'forms/index': 'src/forms/index.ts',
    'control-flow/index': 'src/control-flow/index.ts',
    'primitives/index': 'src/primitives/index.ts',
    'server/index': 'src/server/index.ts',
    'netron/index': 'src/netron/index.ts',
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
});
