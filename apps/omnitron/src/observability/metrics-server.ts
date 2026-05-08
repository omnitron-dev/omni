/**
 * Standalone HTTP server for Prometheus scraping.
 *
 * Bound to a dedicated port (default `httpPort + 3` ≈ 9803) so that
 * scraping is isolated from the main RPC port: a stuck Netron handler
 * can't starve `/metrics`, and scraping can't accidentally generate
 * RPC load. Two routes only:
 *
 *   GET /metrics  → text/plain Prometheus exposition (refreshes per-app
 *                   gauges via MetricsBridge.refreshAppGauges() before
 *                   formatting, so the snapshot is always current).
 *   GET /healthz  → 200 OK / "ok\n" — used by liveness checks.
 *
 * Anything else returns 404. We deliberately don't expose more — if
 * we ever need richer introspection, it goes through the daemon's RPC
 * surface, which has authentication.
 */

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { IMetricsService } from '@omnitron-dev/titan-metrics';
import type { ILogger } from '@omnitron-dev/titan/module/logger';
import type { MetricsBridge } from './metrics-bridge.js';

export interface MetricsServerOptions {
  /** Listen port. */
  port: number;
  /** Bind host. Default '0.0.0.0'. */
  host?: string;
  /** Metric service backing `/metrics`. */
  metrics: IMetricsService;
  /** Bridge for refreshing per-app gauges before formatting. */
  bridge: MetricsBridge;
  /** Logger. */
  logger: ILogger;
}

export class MetricsServer {
  private server: http.Server | null = null;
  private readonly opts: MetricsServerOptions;

  constructor(opts: MetricsServerOptions) {
    this.opts = opts;
  }

  async start(): Promise<{ port: number }> {
    if (this.server) {
      return { port: (this.server.address() as AddressInfo).port };
    }
    const server = http.createServer((req, res) => {
      void this.handle(req, res).catch((err) => {
        this.opts.logger.error({ err, url: req.url }, 'metrics server: handler crash');
        if (!res.headersSent) {
          res.statusCode = 500;
          res.end('internal error\n');
        }
      });
    });
    server.keepAliveTimeout = 5_000;
    server.headersTimeout = 6_000;

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.opts.port, this.opts.host ?? '0.0.0.0', () => {
        server.off('error', reject);
        resolve();
      });
    });
    this.server = server;
    const address = server.address() as AddressInfo;
    this.opts.logger.info(
      { port: address.port, host: address.address },
      'metrics server: listening on /metrics',
    );
    return { port: address.port };
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    const server = this.server;
    this.server = null;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      // close() rejects new connections but waits for in-flight ones to
      // finish naturally. Force close keep-alive connections so we
      // don't drag shutdown out — they hold sockets idle for keepAliveTimeout.
      server.closeIdleConnections?.();
    });
    this.opts.logger.info({}, 'metrics server: stopped');
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = req.url ?? '/';
    if (req.method !== 'GET') {
      res.statusCode = 405;
      res.setHeader('Allow', 'GET');
      res.end('method not allowed\n');
      return;
    }

    if (url === '/healthz' || url === '/health') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('ok\n');
      return;
    }

    if (url === '/metrics' || url.startsWith('/metrics?')) {
      try {
        this.opts.bridge.refreshAppGauges();
      } catch (err) {
        this.opts.logger.warn(
          { err },
          'metrics server: refreshAppGauges threw — emitting last-known values',
        );
      }
      const text = await this.opts.metrics.getPrometheusText();
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
      res.end(text);
      return;
    }

    res.statusCode = 404;
    res.end('not found\n');
  }
}
