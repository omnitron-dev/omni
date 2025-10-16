import { defineConfig } from 'vite';
import { aetherBuildPlugin } from '@omnitron-dev/aether/build/vite-plugin';
import path from 'path';

export default defineConfig({
  plugins: [
    aetherBuildPlugin({
      compiler: false, // Disable compiler optimizations for now
      performance: false,
      treeShaking: false,
      moduleOptimization: false,
      assets: false,
      criticalCSS: false,
      bundleOptimization: false,
      workerBundling: false,
      generateReport: false,
    }),
  ],
  root: './web',
  define: {
    // Polyfill Node.js globals for browser
    'process.env': {},
    'process.version': '"v22.0.0"',
    'process.versions': '{}',
    global: 'globalThis',
  },
  esbuild: {
    // Configure JSX to use Aether's runtime instead of React
    jsx: 'automatic',
    jsxImportSource: '@omnitron-dev/aether',
    jsxDev: false,
    // Enable decorators support in esbuild
    tsconfigRaw: {
      compilerOptions: {
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        useDefineForClassFields: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2022',
    minify: 'esbuild',
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'web/index.html'),
      },
    },
  },
  resolve: {
    alias: {
      '@omnitron/shared': path.resolve(__dirname, 'shared'),
      '@omnitron/web': path.resolve(__dirname, 'web/src'),
      '@': path.resolve(__dirname, 'web/src'),
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:8080',
        ws: true,
      },
    },
  },
});
