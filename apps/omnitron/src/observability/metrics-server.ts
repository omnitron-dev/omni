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
  /**
   * Bind host. **Default `127.0.0.1` (loopback)** as of T#65. The
   * historical default of `0.0.0.0` exposed `/metrics` on every
   * network interface — internal aggregated traffic counters,
   * per-app health, infrastructure topology — to anyone on the same
   * network. Production scraping by a co-located Prometheus on
   * loopback is unaffected. Remote scraping must opt in by
   * setting host = '0.0.0.0' AND configuring a bearer token via
   * `authToken`.
   */
  host?: string;
  /**
   * Optional bearer token required on `Authorization` header
   * (T#65). When set, requests without `Authorization: Bearer
   * <token>` get 401. `/healthz` is always public so external
   * health probes work; only `/metrics` is gated. Without an
   * `authToken` set, the endpoint is unauthenticated — which is
   * safe ONLY while bound to loopback. The server logs a warning
   * at start when host is non-loopback AND no token is set.
   */
  authToken?: string;
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

    // T#65: default bind to loopback so the metrics endpoint isn't
    // reachable from outside the host without an explicit opt-in.
    const host = this.opts.host ?? '127.0.0.1';

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.opts.port, host, () => {
        server.off('error', reject);
        resolve();
      });
    });
    this.server = server;
    const address = server.address() as AddressInfo;
    this.opts.logger.info(
      { port: address.port, host: address.address, authenticated: Boolean(this.opts.authToken) },
      'metrics server: listening on /metrics',
    );

    // T#65: warn loudly if the operator bound to a non-loopback
    // address WITHOUT setting an auth token. That combination
    // hands `/metrics` to anyone on the network — usually not
    // intended, especially in cloud deploys where the daemon's
    // host is reachable from peer workloads.
    const isLoopback =
      host === '127.0.0.1' || host === '::1' || host === 'localhost' || host === '127.1';
    if (!isLoopback && !this.opts.authToken) {
      this.opts.logger.warn(
        { host, port: address.port },
        'metrics server: bound to non-loopback WITHOUT authToken — `/metrics` is publicly readable (T#65)',
      );
    }
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
      // T#65: gate on bearer token when configured. `/healthz`
      // remains public so external health probes still work; only
      // `/metrics` carries the sensitive aggregate data.
      if (this.opts.authToken && !this.authorized(req)) {
        res.statusCode = 401;
        res.setHeader('WWW-Authenticate', 'Bearer realm="omnitron-metrics"');
        res.end('unauthorized\n');
        return;
      }
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

  /**
   * T#65: constant-time compare against the configured bearer
   * token. Accepts `Authorization: Bearer <token>` only. Returns
   * `true` if the request carries a matching token.
   */
  private authorized(req: http.IncomingMessage): boolean {
    const expected = this.opts.authToken;
    if (!expected) return true; // no auth configured → public
    const header = req.headers['authorization'];
    if (typeof header !== 'string') return false;
    const m = header.match(/^Bearer\s+(.+)$/);
    if (!m) return false;
    return timingSafeEqual(m[1]!, expected);
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  // Constant-time string compare. Returns false fast on differing
  // length (the length itself isn't a secret in this protocol), and
  // OR-accumulates byte differences across the shorter length.
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
