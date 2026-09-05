/**
 * What the proxy does with a health or metrics answer it cannot read.
 *
 * `getHealth()` returned `result as IHealthStatus` — whatever came back over
 * RPC, asserted into the type without a check. The catch branch beside it
 * already reports `unhealthy` when the CALL fails, so a call that succeeded
 * and returned nonsense was the one case treated as good news.
 *
 * This is the same defect as the worker's `result?.status ?? 'healthy'`, from
 * the other end, and it matters after that fix too: a worker running an older
 * build, or one whose service is not this framework's, still answers whatever
 * it likes. The consumer is the last place that can tell.
 */
import { describe, it, expect, vi } from 'vitest';

import { ServiceProxyHandler } from '../../src/service-proxy.js';

const logger = () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), child: vi.fn().mockReturnThis() });

function proxyReturning(response: unknown) {
  const client = { call: vi.fn(async () => response) };
  const handler = new ServiceProxyHandler<Record<string, never>>(
    'p-1',
    client as any,
    'TestService',
    logger() as any,
    { requestTimeout: 500, streamTimeout: 500 },
  );
  return handler.createProxy() as any;
}

describe('proxy health from a remote answer', () => {
  it('passes a well-formed status through', async () => {
    const health = await proxyReturning({ status: 'degraded', checks: [], timestamp: 1 }).__getHealth();
    expect(health.status).toBe('degraded');
  });

  it.each([undefined, null, {}, { status: 'ok' }, 'healthy'])(
    'reports an unreadable answer (%p) as unhealthy',
    async (bad) => {
      const health = await proxyReturning(bad).__getHealth();
      expect(health.status).toBe('unhealthy');
      expect(health.checks.length).toBeGreaterThan(0);
    },
  );
});

describe('proxy metrics from a remote answer', () => {
  it('passes well-formed metrics through', async () => {
    const m = await proxyReturning({ cpu: 1, memory: 2, requests: 3, errors: 4 }).__getMetrics();
    expect(m).toMatchObject({ cpu: 1, memory: 2, requests: 3, errors: 4 });
  });

  it.each([undefined, null, {}, { cpu: 'lots' }])(
    'reports an unreadable answer (%p) with the -1 sentinels the caller already knows',
    async (bad) => {
      // The catch branch uses -1 for "collection failed" and says so in a
      // comment. A malformed answer is the same event and must not arrive as
      // numbers that look real.
      const m = await proxyReturning(bad).__getMetrics();
      expect(m).toMatchObject({ cpu: -1, memory: -1, requests: -1, errors: -1 });
    },
  );
});
