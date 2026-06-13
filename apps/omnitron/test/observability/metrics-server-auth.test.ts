/**
 * Regression tests for T#65 — Metrics HTTP endpoint
 * unauthenticated + bound to `0.0.0.0` by default.
 *
 * Old behaviour: `MetricsServer` defaulted `host` to `'0.0.0.0'`,
 * exposing `/metrics` on every network interface; no `authToken`
 * surface existed; anyone with network access read internal
 * traffic counters, per-app health, infrastructure topology.
 *
 * Fix:
 *   - default `host` is `127.0.0.1` (loopback);
 *   - optional `authToken`; when set, `/metrics` requires
 *     `Authorization: Bearer <token>`, `/healthz` stays public;
 *   - server logs a `T#65` warning when bound non-loopback
 *     WITHOUT a token.
 */

import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import { MetricsServer } from '../../src/observability/metrics-server.js';

const noopLogger: any = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  trace: () => undefined,
  fatal: () => undefined,
  child: () => noopLogger,
};

function mkStubs() {
  const metrics: any = { getPrometheusText: async () => 'omnitron_up 1\n' };
  const bridge: any = { refreshAppGauges: () => undefined };
  return { metrics, bridge };
}

// Bind an OS-assigned ephemeral port (0) — every server then reports its real
// port via start(). The previous worker-id + random-offset scheme collided when
// vitest ran files in parallel (JEST_WORKER_ID is unset under vitest, so every
// file drew from the same 25_000-25_180 range), making the suite flaky.
function basePort() {
  return 0;
}

async function get(port: number, path: string, headers?: Record<string, string>): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: 'GET', headers }, (res) => {
      let body = '';
      res.setEncoding('utf-8');
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.once('error', reject);
    req.end();
  });
}

describe('MetricsServer — T#65 auth + bind defaults', () => {
  const servers: MetricsServer[] = [];

  afterEach(async () => {
    for (const s of servers) await s.stop();
    servers.length = 0;
  });

  it('defaults to loopback (127.0.0.1) — listenable on localhost', async () => {
    const port = basePort();
    const { metrics, bridge } = mkStubs();
    const srv = new MetricsServer({ port, metrics, bridge, logger: noopLogger });
    servers.push(srv);
    const info = await srv.start();
    const r = await get(info.port, '/metrics');
    expect(r.status).toBe(200);
    expect(r.body).toContain('omnitron_up 1');
  });

  it('returns 401 on /metrics without bearer token when authToken is set', async () => {
    const port = basePort();
    const { metrics, bridge } = mkStubs();
    const srv = new MetricsServer({ port, metrics, bridge, logger: noopLogger, authToken: 's3cret' });
    servers.push(srv);
    const info = await srv.start();
    const r = await get(info.port, '/metrics');
    expect(r.status).toBe(401);
  });

  it('serves /metrics when a matching bearer token is supplied', async () => {
    const port = basePort();
    const { metrics, bridge } = mkStubs();
    const srv = new MetricsServer({ port, metrics, bridge, logger: noopLogger, authToken: 's3cret' });
    servers.push(srv);
    const info = await srv.start();
    const r = await get(info.port, '/metrics', { authorization: 'Bearer s3cret' });
    expect(r.status).toBe(200);
    expect(r.body).toContain('omnitron_up 1');
  });

  it('rejects a token that differs by one character (constant-time compare)', async () => {
    const port = basePort();
    const { metrics, bridge } = mkStubs();
    const srv = new MetricsServer({ port, metrics, bridge, logger: noopLogger, authToken: 's3cret' });
    servers.push(srv);
    const info = await srv.start();
    const r = await get(info.port, '/metrics', { authorization: 'Bearer s3cre7' });
    expect(r.status).toBe(401);
  });

  it('keeps /healthz public even when authToken is set', async () => {
    const port = basePort();
    const { metrics, bridge } = mkStubs();
    const srv = new MetricsServer({ port, metrics, bridge, logger: noopLogger, authToken: 's3cret' });
    servers.push(srv);
    const info = await srv.start();
    const r = await get(info.port, '/healthz');
    expect(r.status).toBe(200);
    expect(r.body).toBe('ok\n');
  });

  it('warns when binding non-loopback without a token (T#65 advisory)', async () => {
    const port = basePort();
    const { metrics, bridge } = mkStubs();
    const warnings: any[] = [];
    const captureLogger = { ...noopLogger, warn: (obj: any, msg: string) => warnings.push({ obj, msg }) };
    const srv = new MetricsServer({
      port,
      host: '0.0.0.0',
      metrics,
      bridge,
      logger: captureLogger,
    });
    servers.push(srv);
    await srv.start();
    expect(warnings.some((w) => /T#65/.test(w.msg))).toBe(true);
  });
});
