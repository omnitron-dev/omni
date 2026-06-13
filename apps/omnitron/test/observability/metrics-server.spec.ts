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
    // T#74: bridge writes via recordTyped — delegate to the registry like the real service.
    recordTyped: (type, name, labels, value) => {
      if (type === 'counter') registry.counter(name, labels, value);
      else if (type === 'histogram') registry.histogram(name, labels, value);
      else registry.gauge(name, labels, value);
    },
    evictApp: async () => {},
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
    // Bind ephemeral (port 0) and use the port the server actually got. The
    // old pickPort()→close→reuse dance raced other test files for the same
    // freed port and made this suite intermittently flaky.
    server = new MetricsServer({
      port: 0,
      host: '127.0.0.1',
      metrics,
      bridge,
      logger: noopLogger,
    });
    ({ port } = await server.start());
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
