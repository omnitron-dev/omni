import { defineConfig } from 'vitest/config';
import { typescriptLibrariesVitePlugin } from './build/typescript-libraries.js';

export default defineConfig({
  plugins: [typescriptLibrariesVitePlugin()],
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.{test,spec}.ts', 'src/**/*.{test,spec}.ts'],
    exclude: ['node_modules', 'dist'],
    testTimeout: 30000,
    clearMocks: true,
  },
});
