/**
 * MetricsServer smoke test — boots the http server on an ephemeral port,
 * issues a real GET /metrics, and checks the response is well-formed
 * Prometheus text. Also verifies /healthz and 404 for unknown paths.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { MetricsRegistry } from '@omnitron-dev/titan-metrics';
import type { IMetricsService } from '@omnitron-dev/titan-metrics';
import { MetricsServer } from '../../src/observability/metrics-server.js';
import { MetricsBridge } from '../../src/observability/metrics-bridge.js';

function makeMetricsService(registry: MetricsRegistry): IMetricsService {
  return {
    record: () => {},
    recordBatch: () => {},
    getSnapshot: async () => ({ apps: [] }) as never,
    querySeries: async () => [],
    getPrometheusText: async () => registry.toPrometheusText(),
    start: () => {},
    stop: async () => {},
    flush: async () => {},
    cleanup: async () => {},
    getRegistry: () => registry,
  };
}

const noopLogger = {
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  child: function () {
    return this;
  },
} as unknown as Parameters<typeof MetricsServer['prototype']['constructor']>[0]['logger'];

async function pickPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = http.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => (port ? resolve(port) : reject(new Error('no port'))));
    });
  });
}

async function fetchText(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.setTimeout(2000, () => req.destroy(new Error('timeout')));
  });
}

describe('MetricsServer', () => {
  let server: MetricsServer;
  let port: number;
  let registry: MetricsRegistry;

  beforeAll(async () => {
    registry = new MetricsRegistry();
    const metrics = makeMetricsService(registry);
    const bridge = new MetricsBridge(metrics);
    bridge.recordJanitorSweep({
      scannedAt: new Date(),
      forkWorkersAlive: 7,
      ownedPids: 7,
      orphansFound: 0,
      orphansKilled: 0,
      killErrors: 0,
    });
    port = await pickPort();
    server = new MetricsServer({
      port,
      host: '127.0.0.1',
      metrics,
      bridge,
      logger: noopLogger,
    });
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  it('GET /metrics returns Prometheus text', async () => {
    const r = await fetchText(`http://127.0.0.1:${port}/metrics`);
    expect(r.status).toBe(200);
    expect(r.body).toContain('omnitron_workers_alive 7');
    expect(r.body).toContain('# HELP omnitron_workers_alive');
  });

  it('GET /healthz returns ok', async () => {
    const r = await fetchText(`http://127.0.0.1:${port}/healthz`);
    expect(r.status).toBe(200);
    expect(r.body.trim()).toBe('ok');
  });

  it('GET /unknown returns 404', async () => {
    const r = await fetchText(`http://127.0.0.1:${port}/unknown`);
    expect(r.status).toBe(404);
  });
});
