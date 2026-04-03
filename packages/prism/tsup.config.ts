import { defineConfig } from 'tsup';

export default defineConfig([
  // Main library build (React components)
  {
    entry: {
      index: 'src/index.ts',
      'theme/index': 'src/theme/index.ts',
      'core/index': 'src/core/index.ts',
      'registry/index': 'src/registry/index.ts',
      'layouts/index': 'src/layouts/index.ts',
      'blocks/index': 'src/blocks/index.ts',
      'types/index': 'src/types/index.ts',
      'state/index': 'src/state/index.ts',
      'hooks/index': 'src/hooks/index.ts',
      'netron/index': 'src/netron/index.ts',
      'forms/index': 'src/forms/index.ts',
      'accessibility/index': 'src/accessibility/index.ts',
      'http/index': 'src/http/index.ts',
    },
    format: ['esm'],
    dts: true,
    splitting: true,
    sourcemap: true,
    clean: true,
    treeshake: true,
    minify: false,
    external: [
      'react',
      'react-dom',
      '@mui/material',
      '@mui/icons-material',
      '@mui/x-data-grid',
      '@mui/x-date-pickers',
      '@emotion/react',
      '@emotion/styled',
      'zustand',
      'zustand/middleware',
      'zustand/middleware/immer',
      'immer',
      'zod',
      'react-hook-form',
    ],
    esbuildOptions(options) {
      options.jsx = 'automatic';
    },
    banner: {
      js: '"use client";',
    },
  },
  // CLI build (Node.js)
  {
    entry: {
      'cli/index': 'src/cli/index.ts',
    },
    format: ['esm'],
    dts: true,
    splitting: false,
    sourcemap: true,
    clean: false, // Don't clean on second build
    treeshake: true,
    minify: false,
    platform: 'node',
    target: 'node22',
    // CLI needs these bundled or available at runtime
    external: ['commander'],
    noExternal: [
      // Bundle internal modules
    ],
  },
]);
