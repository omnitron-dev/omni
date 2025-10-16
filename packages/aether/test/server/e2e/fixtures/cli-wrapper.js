#!/usr/bin/env node
/**
 * CLI Wrapper for E2E tests
 * Simulates 'npx aether server' command
 */

import { fileURLToPath } from 'url';
import path from 'path';
import { createServer } from '../../../../dist/server/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Parse command line arguments
const args = process.argv.slice(2);

// Parse options
const options = {
  port: 3000,
  host: 'localhost',
  mode: 'development',
  ssrMode: 'ssr',
  cors: false,
  compression: false,
  cache: false,
  metrics: false,
  healthEndpoint: null,
  readyEndpoint: null,
};

for (let i = 0; i < args.length; i++) {
  const arg = args[i];

  switch (arg) {
    case '--port':
      options.port = parseInt(args[++i]);
      break;
    case '--host':
      options.host = args[++i];
      break;
    case '--mode':
      options.mode = args[++i];
      break;
    case '--ssr-mode':
      options.ssrMode = args[++i];
      break;
    case '--cors':
      options.cors = true;
      break;
    case '--compression':
      options.compression = true;
      break;
    case '--cache':
      options.cache = true;
      break;
    case '--metrics':
      options.metrics = true;
      break;
    case '--health-endpoint':
      options.healthEndpoint = args[++i];
      break;
    case '--ready-endpoint':
      options.readyEndpoint = args[++i];
      break;
  }
}

// Create routes
const routes = [
  {
    path: '/',
    component: () => '<h1>CLI Server</h1><p>Running via CLI</p>',
  },
];

// Create server (always use dev mode to support middleware for metrics endpoints)
const serverConfig = {
  dev: true, // Always dev mode to support server.use()
  mode: options.ssrMode,
  port: options.port,
  host: options.host,
  routes,
  cors: options.cors,
  compression: false, // Disable to avoid test issues
};

const server = await createServer(serverConfig);

// Add health/ready/metrics endpoints if metrics enabled
if (options.metrics) {
  server.use({
    name: 'metrics-endpoints',
    async handle(request, next) {
      const url = new URL(request.url);

      if (options.healthEndpoint && url.pathname === options.healthEndpoint) {
        return new Response(JSON.stringify({ status: 'healthy' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (options.readyEndpoint && url.pathname === options.readyEndpoint) {
        return new Response(JSON.stringify({ ready: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.pathname === '/_metrics') {
        const metrics = server.getMetrics();
        return new Response(
          `# Aether Metrics
aether_uptime ${metrics.uptime}
aether_requests ${metrics.requests}
aether_avg_response_time ${metrics.avgResponseTime}
`,
          {
            status: 200,
            headers: { 'Content-Type': 'text/plain' },
          }
        );
      }

      return next();
    },
  });
}

await server.listen();

console.log(`CLI server running on http://${options.host}:${options.port}`);

// Handle graceful shutdown
const shutdown = async () => {
  await server.close();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
