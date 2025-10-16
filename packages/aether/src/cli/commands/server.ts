/**
 * Server Command
 *
 * Unified CLI command for starting Aether server in development or production mode
 */

import { createServer } from '../../server/server.js';
import type { ServerConfig, DevServerConfig } from '../../server/types.js';

/**
 * Server command options
 */
export interface ServerCommandOptions {
  /**
   * Server mode
   * @default 'development'
   */
  mode?: 'development' | 'production';

  /**
   * SSR mode
   * @default 'ssr'
   */
  ssrMode?: 'ssr' | 'ssg' | 'isr' | 'islands';

  /**
   * Server port
   * @default 3000
   */
  port?: number;

  /**
   * Server host
   * @default '0.0.0.0'
   */
  host?: string;

  /**
   * Routes directory
   * @default './src/pages'
   */
  routesDir?: string;

  /**
   * Public directory for static files
   * @default './public'
   */
  publicDir?: string;

  /**
   * Build output directory (production)
   * @default './dist'
   */
  outDir?: string;

  // Development options
  /**
   * Enable HMR (dev only)
   * @default true
   */
  hmr?: boolean;

  /**
   * Enable error overlay (dev only)
   * @default true
   */
  errorOverlay?: boolean;

  /**
   * Enable DevTools (dev only)
   * @default true
   */
  devtools?: boolean;

  /**
   * Open browser (dev only)
   * @default false
   */
  open?: boolean;

  /**
   * Clear screen (dev only)
   * @default true
   */
  clearScreen?: boolean;

  // Production options
  /**
   * Enable compression
   * @default true in production
   */
  compression?: boolean;

  /**
   * Enable caching
   * @default true in production
   */
  cache?: boolean;

  /**
   * Cache max age in seconds
   * @default 3600
   */
  cacheMaxAge?: number;

  /**
   * Enable etag generation
   * @default true
   */
  etag?: boolean;

  // Common options
  /**
   * Enable CORS
   * @default true in dev, false in production
   */
  cors?: boolean;

  /**
   * CORS origin
   * @default '*' in dev, undefined in production
   */
  corsOrigin?: string | string[] | boolean;

  /**
   * Enable Islands architecture
   * @default false
   */
  islands?: boolean;

  /**
   * Islands strategy
   * @default 'lazy'
   */
  islandsStrategy?: 'idle' | 'lazy' | 'visible' | 'eager';

  /**
   * Enable metrics collection
   * @default false
   */
  metrics?: boolean;

  /**
   * Metrics endpoint
   * @default '/_metrics'
   */
  metricsEndpoint?: string;

  /**
   * SSL/TLS options
   */
  https?: boolean;
  key?: string;
  cert?: string;

  /**
   * Proxy configuration
   */
  proxy?: Record<string, string | ProxyConfig>;

  /**
   * Verbose output
   * @default false
   */
  verbose?: boolean;

  /**
   * Silent mode (no output)
   * @default false
   */
  silent?: boolean;

  /**
   * Environment variables file
   * @default '.env'
   */
  env?: string;

  /**
   * Cluster mode (production)
   * @default false
   */
  cluster?: boolean;

  /**
   * Number of worker processes in cluster
   * @default CPU count
   */
  workers?: number;

  /**
   * Graceful shutdown timeout (ms)
   * @default 5000
   */
  shutdownTimeout?: number;

  /**
   * Health check endpoint
   * @default '/_health'
   */
  healthEndpoint?: string;

  /**
   * Ready check endpoint
   * @default '/_ready'
   */
  readyEndpoint?: string;
}

interface ProxyConfig {
  target: string;
  changeOrigin?: boolean;
  secure?: boolean;
  ws?: boolean;
  pathRewrite?: Record<string, string>;
}

/**
 * Execute server command
 *
 * Starts the Aether server in development or production mode with appropriate features
 *
 * @param options - Server options
 *
 * @example
 * ```typescript
 * // Development mode with HMR
 * await serverCommand({ mode: 'development', port: 3000 });
 *
 * // Production mode with compression and caching
 * await serverCommand({ mode: 'production', port: 8080, compression: true });
 *
 * // SSG mode with islands
 * await serverCommand({ ssrMode: 'ssg', islands: true });
 * ```
 */
export async function serverCommand(options: ServerCommandOptions = {}): Promise<void> {
  const isDev = options.mode !== 'production';

  // Clear screen in dev mode if enabled
  if (isDev && options.clearScreen !== false && !options.silent) {
    console.clear();
  }

  // Display startup message
  if (!options.silent) {
    console.log(`⚡ Starting Aether ${isDev ? 'development' : 'production'} server...\n`);
  }

  try {
    // Load environment variables
    if (options.env) {
      await loadEnvFile(options.env);
    }

    // Build server config based on mode
    const config: ServerConfig | DevServerConfig = isDev
      ? buildDevConfig(options)
      : buildProductionConfig(options);

    // Log configuration if verbose
    if (options.verbose && !options.silent) {
      logConfiguration(config, isDev);
    }

    // Handle cluster mode in production
    if (!isDev && options.cluster) {
      await startCluster(config, options);
      return;
    }

    // Create and start server
    const server = await createServer(config);
    await server.listen();

    // Display server info
    if (!options.silent) {
      displayServerInfo(config, isDev, options);
    }

    // Open browser in dev mode
    if (isDev && options.open) {
      await openBrowser(`http://localhost:${config.port}`);
    }

    // Setup health and ready endpoints
    if (options.healthEndpoint || options.readyEndpoint) {
      setupHealthChecks(server, options);
    }

    // Setup metrics endpoint
    if (options.metrics) {
      setupMetrics(server, options);
    }

    // Handle graceful shutdown
    setupGracefulShutdown(server, options);
  } catch (error) {
    if (!options.silent) {
      console.error('\n❌ Failed to start server:', error);
    }
    process.exit(1);
  }
}

/**
 * Build development config
 */
function buildDevConfig(options: ServerCommandOptions): DevServerConfig {
  return {
    dev: true,
    mode: options.ssrMode || 'ssr',
    port: options.port ?? 3000,
    host: options.host ?? '0.0.0.0',
    routesDir: options.routesDir ?? './src/pages',
    publicDir: options.publicDir ?? './public',
    hmr: options.hmr !== false,
    errorOverlay: options.errorOverlay !== false,
    cors: options.cors !== false,
    islands: options.islands ?? false,
    islandsStrategy: options.islandsStrategy,
    open: options.open ?? false,
    clearScreen: options.clearScreen !== false,
    proxy: options.proxy,
    routes: [], // Will be auto-discovered
  };
}

/**
 * Build production config
 */
function buildProductionConfig(options: ServerCommandOptions): ServerConfig {
  return {
    mode: options.ssrMode || 'ssr',
    port: options.port ?? process.env.PORT ? parseInt(process.env.PORT) : 3000,
    host: options.host ?? '0.0.0.0',
    routesDir: options.routesDir ?? './dist/pages',
    publicDir: options.publicDir ?? './dist/public',
    compression: options.compression !== false,
    cache: options.cache !== false,
    cacheMaxAge: options.cacheMaxAge ?? 3600,
    etag: options.etag !== false,
    cors: options.cors === true,
    corsOrigin: options.corsOrigin,
    islands: options.islands ?? false,
    islandsStrategy: options.islandsStrategy,
    https: options.https,
    key: options.key,
    cert: options.cert,
    proxy: options.proxy,
    routes: [], // Will be loaded from build
  };
}

/**
 * Log configuration
 */
function logConfiguration(config: any, isDev: boolean): void {
  console.log('📋 Configuration:');
  console.log(`  Mode: ${isDev ? 'development' : 'production'}`);
  console.log(`  SSR Mode: ${config.mode}`);
  console.log(`  Port: ${config.port}`);
  console.log(`  Host: ${config.host}`);

  if (isDev) {
    console.log(`  Routes: ${config.routesDir}`);
    console.log(`  Public: ${config.publicDir}`);
    console.log(`  HMR: ${config.hmr ? 'enabled' : 'disabled'}`);
    console.log(`  Error Overlay: ${config.errorOverlay ? 'enabled' : 'disabled'}`);
  } else {
    console.log(`  Compression: ${config.compression ? 'enabled' : 'disabled'}`);
    console.log(`  Caching: ${config.cache ? 'enabled' : 'disabled'}`);
    console.log(`  Cache Max Age: ${config.cacheMaxAge}s`);
    console.log(`  ETag: ${config.etag ? 'enabled' : 'disabled'}`);
  }

  if (config.islands) {
    console.log(`  Islands: enabled (${config.islandsStrategy || 'lazy'})`);
  }

  if (config.cors) {
    console.log(`  CORS: enabled`);
  }

  console.log('');
}

/**
 * Display server info
 */
function displayServerInfo(config: any, isDev: boolean, options: ServerCommandOptions): void {
  const protocol = config.https ? 'https' : 'http';
  const urls = [
    `  ➜ Local:   ${protocol}://localhost:${config.port}`,
    `  ➜ Network: ${protocol}://${config.host}:${config.port}`,
  ];

  console.log('');
  console.log(`  🎉 Server ready! (${isDev ? 'development' : 'production'} mode)`);
  console.log('');
  urls.forEach((url) => console.log(url));
  console.log('');

  // Show features
  const features = [];

  if (isDev) {
    if (config.hmr) features.push('⚡ HMR');
    if (config.errorOverlay) features.push('🎨 Error Overlay');
    if (options.devtools) features.push('🔧 DevTools');
  } else {
    if (config.compression) features.push('📦 Compression');
    if (config.cache) features.push('💾 Caching');
    if (options.cluster) features.push('🔄 Cluster');
  }

  if (config.islands) features.push('🏝️  Islands');
  if (options.metrics) features.push('📊 Metrics');

  if (features.length > 0) {
    console.log('  Features: ' + features.join(', '));
    console.log('');
  }

  // Show endpoints
  if (options.healthEndpoint || options.readyEndpoint || options.metrics) {
    console.log('  Endpoints:');
    if (options.healthEndpoint) console.log(`    Health: ${options.healthEndpoint}`);
    if (options.readyEndpoint) console.log(`    Ready: ${options.readyEndpoint}`);
    if (options.metrics) console.log(`    Metrics: ${options.metricsEndpoint || '/_metrics'}`);
    console.log('');
  }

  console.log('  Press Ctrl+C to stop\n');
}

/**
 * Start cluster mode
 */
async function startCluster(config: ServerConfig, options: ServerCommandOptions): Promise<void> {
  const cluster = await import('cluster');
  const os = await import('os');

  const numWorkers = options.workers ?? os.cpus().length;

  if (cluster.default.isPrimary) {
    console.log(`🔄 Starting cluster with ${numWorkers} workers...\n`);

    // Fork workers
    for (let i = 0; i < numWorkers; i++) {
      cluster.default.fork();
    }

    // Handle worker exit
    cluster.default.on('exit', (worker, code, signal) => {
      console.log(`Worker ${worker.process.pid} died (${signal || code}). Restarting...`);
      cluster.default.fork();
    });
  } else {
    // Worker process - start server
    const server = await createServer(config);
    await server.listen();

    if (!options.silent) {
      console.log(`  Worker ${process.pid} started`);
    }
  }
}

/**
 * Setup health checks
 */
function setupHealthChecks(server: any, options: ServerCommandOptions): void {
  const healthEndpoint = options.healthEndpoint || '/_health';
  const readyEndpoint = options.readyEndpoint || '/_ready';

  // Add health check middleware
  if (server.use) {
    server.use({
      name: 'health-checks',
      async handle(req: Request, next: () => Promise<Response>) {
        const url = new URL(req.url);

        if (url.pathname === healthEndpoint) {
          return new Response('OK', { status: 200 });
        }

        if (url.pathname === readyEndpoint) {
          // Check if server is ready
          const ready = true; // Add actual ready check logic
          return new Response(ready ? 'Ready' : 'Not Ready', {
            status: ready ? 200 : 503,
          });
        }

        return next();
      },
    });
  }
}

/**
 * Setup metrics endpoint
 */
function setupMetrics(server: any, options: ServerCommandOptions): void {
  const endpoint = options.metricsEndpoint || '/_metrics';

  if (server.use && server.getMetrics) {
    server.use({
      name: 'metrics',
      async handle(req: Request, next: () => Promise<Response>) {
        const url = new URL(req.url);

        if (url.pathname === endpoint) {
          const metrics = server.getMetrics();

          // Format metrics as Prometheus format
          const output = formatMetrics(metrics);

          return new Response(output, {
            status: 200,
            headers: {
              'Content-Type': 'text/plain; version=0.0.4',
            },
          });
        }

        return next();
      },
    });
  }
}

/**
 * Format metrics for Prometheus
 */
function formatMetrics(metrics: any): string {
  const lines = [
    '# HELP aether_uptime Server uptime in milliseconds',
    '# TYPE aether_uptime gauge',
    `aether_uptime ${metrics.uptime}`,
    '',
    '# HELP aether_requests_total Total number of requests',
    '# TYPE aether_requests_total counter',
    `aether_requests_total ${metrics.requests}`,
    '',
    '# HELP aether_response_time_avg Average response time in milliseconds',
    '# TYPE aether_response_time_avg gauge',
    `aether_response_time_avg ${metrics.avgResponseTime}`,
    '',
    '# HELP aether_memory_heap_used Heap memory used in bytes',
    '# TYPE aether_memory_heap_used gauge',
    `aether_memory_heap_used ${metrics.heapUsed}`,
    '',
    '# HELP aether_memory_heap_total Total heap memory in bytes',
    '# TYPE aether_memory_heap_total gauge',
    `aether_memory_heap_total ${metrics.heapTotal}`,
    '',
    '# HELP aether_memory_rss RSS memory in bytes',
    '# TYPE aether_memory_rss gauge',
    `aether_memory_rss ${metrics.rss}`,
  ];

  if (metrics.updates !== undefined) {
    lines.push(
      '',
      '# HELP aether_hmr_updates_total Total HMR updates',
      '# TYPE aether_hmr_updates_total counter',
      `aether_hmr_updates_total ${metrics.updates}`,
      '',
      '# HELP aether_hmr_full_reloads_total Total full reloads',
      '# TYPE aether_hmr_full_reloads_total counter',
      `aether_hmr_full_reloads_total ${metrics.fullReloads}`,
    );
  }

  return lines.join('\n');
}

/**
 * Setup graceful shutdown
 */
function setupGracefulShutdown(server: any, options: ServerCommandOptions): void {
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  const timeout = options.shutdownTimeout ?? 5000;

  for (const signal of signals) {
    process.on(signal, async () => {
      if (!options.silent) {
        console.log('\n\n  Shutting down server gracefully...');
      }

      // Set timeout for forceful shutdown
      const forceShutdown = setTimeout(() => {
        console.error('  ⚠️  Forceful shutdown after timeout');
        process.exit(1);
      }, timeout);

      try {
        await server.close();
        clearTimeout(forceShutdown);

        if (!options.silent) {
          console.log('  ✓ Server stopped\n');
        }

        process.exit(0);
      } catch (error) {
        clearTimeout(forceShutdown);
        console.error('  ❌ Error during shutdown:', error);
        process.exit(1);
      }
    });
  }

  // Handle uncaught errors
  process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
  });
}

/**
 * Load environment variables from file
 */
async function loadEnvFile(path: string): Promise<void> {
  try {
    const { readFileSync } = await import('fs');
    const content = readFileSync(path, 'utf-8');

    content.split('\n').forEach((line) => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...values] = trimmed.split('=');
        process.env[key] = values.join('=');
      }
    });
  } catch (_error) {
    console.warn(`⚠️  Could not load env file: ${path}`);
  }
}

/**
 * Open URL in browser
 */
async function openBrowser(url: string): Promise<void> {
  try {
    const { default: open } = await import('open');
    await open(url);
  } catch (error) {
    console.warn('⚠️  Could not open browser:', error);
  }
}

/**
 * CLI handler
 */
export function createServerCommand() {
  return {
    name: 'server',
    description: 'Start Aether server in development or production mode',
    options: {
      // Mode options
      '--mode': 'Server mode: development or production (default: development)',
      '--ssr-mode': 'SSR mode: ssr, ssg, isr, or islands (default: ssr)',

      // Server options
      '--port': 'Server port (default: 3000)',
      '--host': 'Server host (default: 0.0.0.0)',
      '--routesDir': 'Routes directory',
      '--publicDir': 'Public directory',
      '--outDir': 'Build output directory',

      // Dev options
      '--no-hmr': 'Disable HMR (dev)',
      '--no-errorOverlay': 'Disable error overlay (dev)',
      '--devtools': 'Enable DevTools (dev)',
      '--open': 'Open browser (dev)',
      '--no-clearScreen': 'Do not clear screen (dev)',

      // Production options
      '--no-compression': 'Disable compression (prod)',
      '--no-cache': 'Disable caching (prod)',
      '--cache-max-age': 'Cache max age in seconds',
      '--no-etag': 'Disable etag generation',

      // Common options
      '--cors': 'Enable CORS',
      '--cors-origin': 'CORS origin',
      '--islands': 'Enable Islands architecture',
      '--islands-strategy': 'Islands strategy: idle, lazy, visible, eager',
      '--metrics': 'Enable metrics collection',
      '--metrics-endpoint': 'Metrics endpoint',

      // SSL/TLS
      '--https': 'Enable HTTPS',
      '--key': 'SSL key file',
      '--cert': 'SSL certificate file',

      // Advanced
      '--proxy': 'Proxy configuration (JSON)',
      '--cluster': 'Enable cluster mode (prod)',
      '--workers': 'Number of cluster workers',
      '--shutdown-timeout': 'Graceful shutdown timeout (ms)',
      '--health-endpoint': 'Health check endpoint',
      '--ready-endpoint': 'Ready check endpoint',

      // Output
      '--verbose': 'Verbose output',
      '--silent': 'Silent mode',

      // Environment
      '--env': 'Environment variables file',
    },
    aliases: {
      'dev': { mode: 'development' },
      'prod': { mode: 'production' },
      'start': { mode: 'production' },
    },
    async action(options: ServerCommandOptions) {
      await serverCommand(options);
    },
  };
}

/**
 * Convenience exports for specific modes
 */
export async function devCommand(options: Omit<ServerCommandOptions, 'mode'>) {
  return serverCommand({ ...options, mode: 'development' });
}

export async function prodCommand(options: Omit<ServerCommandOptions, 'mode'>) {
  return serverCommand({ ...options, mode: 'production' });
}

export async function startCommand(options: Omit<ServerCommandOptions, 'mode'>) {
  return serverCommand({ ...options, mode: 'production' });
}