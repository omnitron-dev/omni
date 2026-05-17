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
      // Component subpath entries — kept tight on purpose. The
      // `./components/*` glob in package.json makes every component
      // directory addressable, but we only ship the ones a downstream
      // app actually imports as a separate entry, since each one bloats
      // the build matrix. Add entries here when a downstream file
      // uses `from '@omnitron-dev/prism/components/<name>'`.
      'components/index': 'src/components/index.ts',
      'components/editor/index': 'src/components/editor/index.ts',
      // EmojiPicker — independent subpath entry so apps can lazy-load
      // it as its own chunk (the dataset adds ~260 KiB raw / ~80 KiB
      // gzipped that we never want on the critical path).
      'components/emoji-picker/index': 'src/components/emoji-picker/index.ts',
    },
    loader: {
      // Bundle the bundled emoji-data JSON as a code-split asset so it
      // ships with the emoji-picker chunk rather than every dep tree.
      '.json': 'json',
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
      'react-router',
      'react-router-dom',
      '@mui/material',
      '@mui/icons-material',
      '@mui/system',
      '@mui/x-data-grid',
      '@mui/x-date-pickers',
      '@emotion/react',
      '@emotion/styled',
      '@emotion/cache',
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
