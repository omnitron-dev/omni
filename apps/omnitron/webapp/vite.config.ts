import path from 'path';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { defineConfig, type Plugin, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { withPrismSourceAliases } from '../scripts/console-source-aliases.js';

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

// Match the production gateway even if the daemon trusts this dev proxy.
const forwardClientAddress: NonNullable<ProxyOptions['configure']> = proxy => {
  const overwrite = (outgoing: ClientRequest, incoming: IncomingMessage) => {
    const ip = incoming.socket.remoteAddress;
    for (const header of ['x-forwarded-for', 'x-real-ip']) {
      if (ip) outgoing.setHeader(header, ip);
      else outgoing.removeHeader(header);
    }
  };
  proxy.on('proxyReq', overwrite);
  proxy.on('proxyReqWs', overwrite);
};

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
    alias: withPrismSourceAliases({
      src: path.resolve(here, 'src'),
      // react-apexcharts imports /client. Register the renderers and accessible
      // interactions this Console uses, while keeping chart loading lazy.
      'apexcharts/client': path.resolve(here, 'src/charts.ts'),
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
      '@omnitron-dev/omnitron/release-source': path.resolve(here, '../src/shared/framework-source.ts'),
      // What one omnitron check found — the node dot and the uptime strip
      // read it alike.
      '@omnitron-dev/omnitron/node-check': path.resolve(here, '../src/shared/node-check.ts'),
      // How an audit row's action ended — the page and `omnitron audit` alike.
      '@omnitron-dev/omnitron/audit-outcome': path.resolve(here, '../src/shared/audit-outcome.ts'),
      // Whether a node's replication keeps up — the stack pages and `stack status` alike.
      '@omnitron-dev/omnitron/metrics-storage-reading': path.resolve(here, '../src/shared/metrics-storage-reading.ts'),
      '@omnitron-dev/omnitron/relay-reading': path.resolve(here, '../src/shared/relay-reading.ts'),
      '@omnitron-dev/omnitron/stack-reading': path.resolve(here, '../src/shared/stack-reading.ts'),
      '@omnitron-dev/omnitron/sync-reading': path.resolve(here, '../src/shared/sync-reading.ts'),
      // Config types (imported by DTO)
      '@omnitron-dev/omnitron/config': path.resolve(here, '../src/config/index.ts'),
    }),
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
        configure: forwardClientAddress,
        changeOrigin: true,
      },
      '/api/health': {
        target: 'http://localhost:9801',
        configure: forwardClientAddress,
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/api/, ''),
      },
      '/api/metrics': {
        target: 'http://localhost:9801',
        configure: forwardClientAddress,
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/api/, ''),
      },
      // WebSocket proxy for real-time event push. Mirrors what nginx does
      // in front of the built console, so the client asks for `/ws` on its
      // own origin either way and never needs to know this port.
      '/ws': {
        target: 'ws://localhost:9802',
        ws: true,
        configure: forwardClientAddress,
        changeOrigin: false,
        rewrite: (path: string) => path.replace(/^\/ws/, ''),
      },
    },
  },
});
