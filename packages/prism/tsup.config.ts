import { defineConfig } from 'tsup';

export default defineConfig([
  // Main library build (React components)
  {
    entry: {
      index: 'src/index.ts',
      'theme/index': 'src/theme/index.ts',
      'core/index': 'src/core/index.ts',
      'ui/index': 'src/ui/index.ts',
      'icons/index': 'src/icons/index.ts',
      'registry/index': 'src/registry/index.ts',
      'layouts/index': 'src/layouts/index.ts',
      'blocks/index': 'src/blocks/index.ts',
      'auth/index': 'src/auth/index.ts',
      'types/index': 'src/types/index.ts',
      'state/index': 'src/state/index.ts',
      'hooks/index': 'src/hooks/index.ts',
      'netron/index': 'src/netron/index.ts',
      'forms/index': 'src/forms/index.ts',
      'accessibility/index': 'src/accessibility/index.ts',
      'http/index': 'src/http/index.ts',
      // Every public component subpath has a matching JS build entry and declaration.
      'components/admin-filters/index': 'src/components/admin-filters/index.ts',
      'components/alert/index': 'src/components/alert/index.ts',
      'components/animate/index': 'src/components/animate/index.ts',
      'components/breadcrumbs/index': 'src/components/breadcrumbs/index.ts',
      'components/card/index': 'src/components/card/index.ts',
      'components/command-palette/index': 'src/components/command-palette/index.ts',
      'components/confirm-dialog/index': 'src/components/confirm-dialog/index.ts',
      'components/empty-content/index': 'src/components/empty-content/index.ts',
      'components/error-boundary/index': 'src/components/error-boundary/index.ts',
      'components/label/index': 'src/components/label/index.ts',
      'components/loading-screen/index': 'src/components/loading-screen/index.ts',
      'components/navigation-progress/index': 'src/components/navigation-progress/index.ts',
      'components/page-content/index': 'src/components/page-content/index.ts',
      'components/popover/index': 'src/components/popover/index.ts',
      'components/scroll-to-top/index': 'src/components/scroll-to-top/index.ts',
      'components/skeleton/index': 'src/components/skeleton/index.ts',
      'components/snackbar/index': 'src/components/snackbar/index.ts',
      'components/stepper/index': 'src/components/stepper/index.ts',
      'components/table/index': 'src/components/table/index.ts',
      'components/tabs/index': 'src/components/tabs/index.ts',
      'components/index': 'src/components/index.ts',
      'components/map/index': 'src/components/map/index.ts',
      'components/doc-layout/index': 'src/components/doc-layout/index.ts',
      'components/research/index': 'src/components/research/index.ts',
      'components/research-editor/index': 'src/components/research-editor/index.ts',
      'components/knowledge-graph/index': 'src/components/knowledge-graph/index.ts',
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
      '.woff2': 'file',
      '.woff': 'file',
      '.ttf': 'file',
    },
    format: ['esm'],
    // Declarations come from `tsc -p tsconfig.build.json` — see that file.
    dts: false,
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
    // Declarations come from `tsc -p tsconfig.build.json` — see that file.
    dts: false,
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
