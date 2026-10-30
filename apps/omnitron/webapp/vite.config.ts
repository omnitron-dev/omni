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
  build: {
    rolldownOptions: {
      output: {
        // MUI and Emotion contain order-sensitive module initialization.
        strictExecutionOrder: true,
        codeSplitting: {
          includeDependenciesRecursively: false,
          groups: [
            { name: 'react', test: /node_modules\/(react|react-dom|scheduler)\//, priority: 20 },
            { name: 'mui', test: /node_modules\/(?:@mui|@emotion)\//, maxSize: 350_000, priority: 10 },
            { name: 'charts', test: /node_modules\/apexcharts\/dist\//, maxSize: 300_000, priority: 10 },
          ],
        },
      },
    },
  },
  resolve: {
    dedupe: ['react', 'react-dom', 'react/jsx-runtime', '@emotion/react', '@emotion/styled'],
    alias: {
      src: path.resolve(here, 'src'),
      // react-apexcharts imports /client. Register the renderers and accessible
      // interactions this Console uses, while keeping chart loading lazy.
      'apexcharts/client': path.resolve(here, 'src/charts.ts'),
      // Prism subpath aliases BEFORE the root alias (Vite uses prefix matching)
      '@omnitron-dev/prism/auth': path.resolve(here, '../../../packages/prism/src/auth/index.ts'),
      '@omnitron-dev/prism/netron': path.resolve(here, '../../../packages/prism/src/netron/index.ts'),
      '@omnitron-dev/prism/components/admin-filters': path.resolve(here, '../../../packages/prism/src/components/admin-filters/index.ts'),
      '@omnitron-dev/prism/components/alert': path.resolve(here, '../../../packages/prism/src/components/alert/index.ts'),
      '@omnitron-dev/prism/components/animate': path.resolve(here, '../../../packages/prism/src/components/animate/index.ts'),
      '@omnitron-dev/prism/components/breadcrumbs': path.resolve(here, '../../../packages/prism/src/components/breadcrumbs/index.ts'),
      '@omnitron-dev/prism/components/card': path.resolve(here, '../../../packages/prism/src/components/card/index.ts'),
      '@omnitron-dev/prism/components/chart': path.resolve(here, '../../../packages/prism/src/components/chart/index.ts'),
      '@omnitron-dev/prism/components/command-palette': path.resolve(here, '../../../packages/prism/src/components/command-palette/index.ts'),
      '@omnitron-dev/prism/components/confirm-dialog': path.resolve(here, '../../../packages/prism/src/components/confirm-dialog/index.ts'),
      '@omnitron-dev/prism/components/empty-content': path.resolve(here, '../../../packages/prism/src/components/empty-content/index.ts'),
      '@omnitron-dev/prism/components/error-boundary': path.resolve(here, '../../../packages/prism/src/components/error-boundary/index.ts'),
      '@omnitron-dev/prism/components/label': path.resolve(here, '../../../packages/prism/src/components/label/index.ts'),
      '@omnitron-dev/prism/components/loading-screen': path.resolve(here, '../../../packages/prism/src/components/loading-screen/index.ts'),
      '@omnitron-dev/prism/components/navigation-progress': path.resolve(here, '../../../packages/prism/src/components/navigation-progress/index.ts'),
      '@omnitron-dev/prism/components/page-content': path.resolve(here, '../../../packages/prism/src/components/page-content/index.ts'),
      '@omnitron-dev/prism/components/popover': path.resolve(here, '../../../packages/prism/src/components/popover/index.ts'),
      '@omnitron-dev/prism/components/search-input': path.resolve(here, '../../../packages/prism/src/components/search-input/index.ts'),
      '@omnitron-dev/prism/components/scroll-to-top': path.resolve(here, '../../../packages/prism/src/components/scroll-to-top/index.ts'),
      '@omnitron-dev/prism/components/skeleton': path.resolve(here, '../../../packages/prism/src/components/skeleton/index.ts'),
      '@omnitron-dev/prism/components/snackbar': path.resolve(here, '../../../packages/prism/src/components/snackbar/index.ts'),
      '@omnitron-dev/prism/components/stepper': path.resolve(here, '../../../packages/prism/src/components/stepper/index.ts'),
      '@omnitron-dev/prism/components/table': path.resolve(here, '../../../packages/prism/src/components/table/index.ts'),
      '@omnitron-dev/prism/components/tabs': path.resolve(here, '../../../packages/prism/src/components/tabs/index.ts'),
      '@omnitron-dev/prism/icons': path.resolve(here, '../../../packages/prism/src/icons/index.ts'),
      '@omnitron-dev/prism/core': path.resolve(here, '../../../packages/prism/src/core/index.ts'),
      '@omnitron-dev/prism/layouts': path.resolve(here, '../../../packages/prism/src/layouts/index.ts'),
      '@omnitron-dev/prism/state': path.resolve(here, '../../../packages/prism/src/state/index.ts'),
      '@omnitron-dev/prism/theme': path.resolve(here, '../../../packages/prism/src/theme/index.ts'),
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
      // A value (`DAEMON_EVENT_TASK`), not only types: the package's `default`
      // for this subpath is the daemon's build, which lags the source.
      '@omnitron-dev/omnitron/dto/events': path.resolve(here, '../src/shared/events.ts'),
      // The alert grammar, shared so the form can reject an expression the
      // evaluator cannot read — before the rule exists.
      '@omnitron-dev/omnitron/alerts': path.resolve(here, '../src/shared/alert-expression.ts'),
      // How a release reads — its gates and which stacks run it — in the
      // same words as the CLI.
      '@omnitron-dev/omnitron/release-reading': path.resolve(here, '../src/shared/release-reading.ts'),
      // What one omnitron check found — the node dot and the uptime strip
      // read it alike.
      '@omnitron-dev/omnitron/node-check': path.resolve(here, '../src/shared/node-check.ts'),
      // How an audit row's action ended — the page and `omnitron audit` alike.
      '@omnitron-dev/omnitron/audit-outcome': path.resolve(here, '../src/shared/audit-outcome.ts'),
      // Whether a node's replication keeps up — the stack pages and `stack status` alike.
      '@omnitron-dev/omnitron/sync-reading': path.resolve(here, '../src/shared/sync-reading.ts'),
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
