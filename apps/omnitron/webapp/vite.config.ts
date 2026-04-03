import path from 'path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react-swc';

const fsStubPath = path.resolve(process.cwd(), 'src/stubs/fs.ts');
const pathStubPath = path.resolve(process.cwd(), 'src/stubs/path.ts');

/** Stub Node.js built-in modules pulled in via Prism's registry/installer */
function nodeBuiltinsStub(): Plugin {
  return {
    name: 'node-builtins-stub',
    enforce: 'pre',
    resolveId(source) {
      if (/^(node:)?fs(\/promises)?$/.test(source)) return fsStubPath;
      if (/^(node:)?path$/.test(source)) return pathStubPath;
      return null;
    },
  };
}

export default defineConfig({
  define: {
    'process.platform': JSON.stringify('browser'),
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production'),
  },
  plugins: [nodeBuiltinsStub(), react()],
  resolve: {
    dedupe: ['react', 'react-dom', 'react/jsx-runtime', '@emotion/react', '@emotion/styled'],
    alias: {
      src: path.resolve(process.cwd(), 'src'),
      // Prism subpath aliases BEFORE the root alias (Vite uses prefix matching)
      '@omnitron-dev/prism/netron': path.resolve(__dirname, '../../../packages/prism/src/netron/index.ts'),
      '@omnitron-dev/prism': path.resolve(__dirname, '../../../packages/prism/src/index.ts'),
      // Netron browser — resolve from dist (compiled, no Node.js deps)
      '@omnitron-dev/netron-browser': path.resolve(__dirname, '../../../packages/netron-browser/dist/index.js'),
      // Omnitron DTO
      '@omnitron-dev/omnitron/dto/services': path.resolve(__dirname, '../src/shared/dto/services.ts'),
      // Config types (imported by DTO)
      '@omnitron-dev/omnitron/config': path.resolve(__dirname, '../src/config/index.ts'),
    },
  },
  server: {
    port: 9802, // Dev server for HMR
    proxy: {
      // Proxy Netron RPC to daemon internal HTTP port
      '/netron/': {
        target: 'http://localhost:9801',
        changeOrigin: true,
      },
      '/api/health': {
        target: 'http://localhost:9801',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/api/, ''),
      },
      '/api/metrics': {
        target: 'http://localhost:9801',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/api/, ''),
      },
      // WebSocket proxy for real-time event push
      '/ws': {
        target: 'ws://localhost:9802',
        ws: true,
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/ws/, ''),
      },
    },
  },
});
