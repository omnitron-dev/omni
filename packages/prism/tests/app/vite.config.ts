import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'node:path';

/**
 * Vite configuration for Prism E2E Test Application
 *
 * This runs a minimal dev server for Playwright E2E tests.
 */
export default defineConfig({
  plugins: [react()],
  root: __dirname,
  server: {
    port: 5173,
    strictPort: true,
  },
  resolve: {
    alias: {
      '@prism': path.resolve(__dirname, '../../src'),
    },
  },
});
