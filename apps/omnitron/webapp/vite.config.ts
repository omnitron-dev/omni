import path from 'path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react-swc';

/**
 * This directory, not the caller's.
 *
 * Every path below used to mix `process.cwd()` and `__dirname`, which agree
 * only while vite is launched from `webapp/`. Run it with an explicit `-c`
 * from the repo root — as any wrapper script eventually does — and the
 * cwd-based ones resolve against the root instead, so the Node stubs and the
 * `src` alias point at directories that do not exist. `__dirname` was on
 * notice anyway: vite 8 shims it in an ESM config and warns that it will
 * stop.
 */
const here = import.meta.dirname;

const fsStubPath = path.resolve(here, 'src/stubs/fs.ts');
const pathStubPath = path.resolve(here, 'src/stubs/path.ts');

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
      src: path.resolve(here, 'src'),
      // Prism subpath aliases BEFORE the root alias (Vite uses prefix matching)
      '@omnitron-dev/prism/netron': path.resolve(here, '../../../packages/prism/src/netron/index.ts'),
      '@omnitron-dev/prism': path.resolve(here, '../../../packages/prism/src/index.ts'),
      // Netron browser — resolve from dist (compiled, no Node.js deps).
      // Subpath first: Vite matches aliases by prefix, so the bare entry would
      // otherwise swallow `/middleware` and try to load
      // `dist/index.js/middleware` ("Not a directory").
      '@omnitron-dev/netron-browser/middleware': path.resolve(
        here,
        '../../../packages/netron-browser/dist/middleware/index.js',
      ),
      '@omnitron-dev/netron-browser': path.resolve(here, '../../../packages/netron-browser/dist/index.js'),
      // Omnitron DTO
      '@omnitron-dev/omnitron/dto/services': path.resolve(here, '../src/shared/dto/services.ts'),
      // The alert grammar, shared so the form can reject an expression the
      // evaluator cannot read — before the rule exists.
      '@omnitron-dev/omnitron/alerts': path.resolve(here, '../src/shared/alert-expression.ts'),
      // Config types (imported by DTO)
      '@omnitron-dev/omnitron/config': path.resolve(here, '../src/config/index.ts'),
    },
  },
  server: {
    // NOT 9802. The daemon's Netron WebSocket transport binds that port
    // (`httpPort + 2`), so a dev server asking for it collides with the very
    // daemon this console exists to talk to — and the `/ws` proxy below,
    // which pointed at `ws://localhost:9802`, was then aimed at the dev
    // server itself. Whichever process started second lost, and the failure
    // reads as "the console will not start" rather than "two things want one
    // port". 9800-9803 all belong to the daemon (console, HTTP, WS, metrics).
    port: 9810,
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
      // WebSocket proxy for real-time event push. Mirrors what nginx does
      // in front of the built console, so the client asks for `/ws` on its
      // own origin either way and never needs to know this port.
      '/ws': {
        target: 'ws://localhost:9802',
        ws: true,
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/ws/, ''),
      },
    },
  },
});
