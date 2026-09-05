/**
 * What a worker's health RPC says when `checkHealth()` answers badly.
 *
 * The wrapper read `result?.status ?? 'healthy'`. A `checkHealth()` that
 * returned `undefined`, `null`, or an object without a `status` was therefore
 * reported as HEALTHY — a service saying nothing read as a service saying it
 * is fine. The same wrapper already treats a THROWING `checkHealth()` as
 * unhealthy, so the two ways of failing to get an answer were classified
 * oppositely, and the silent one was the dangerous direction.
 *
 * `__getProcessHealth` lives in `worker-runtime.ts`, which calls `initialize()`
 * at import and so can never be imported by a test — which is why the test
 * that existed for it re-implemented the function inline and asserted against
 * its own copy. The classification now lives in its own module.
 */
import { describe, it, expect } from 'vitest';

import { classifyWorkerHealth } from '../../src/worker-health.js';

describe('classifyWorkerHealth', () => {
  it('passes through a well-formed result', () => {
    const health = classifyWorkerHealth({
      status: 'degraded',
      checks: [{ name: 'db', status: 'warn', message: 'slow' }],
    });
    expect(health.status).toBe('degraded');
    expect(health.checks).toEqual([{ name: 'db', status: 'warn', message: 'slow' }]);
    expect(health.timestamp).toBeGreaterThan(0);
  });

  it.each([undefined, null, {}, { status: undefined }, 'healthy', 42])(
    'reports an unreadable result (%p) as unhealthy, not healthy',
    (bad) => {
      const health = classifyWorkerHealth(bad);
      expect(health.status).toBe('unhealthy');
      // And says why, so the operator is not left comparing two "unhealthy"s.
      expect(health.checks[0]?.name).toBe('checkHealth');
      expect(health.checks[0]?.status).toBe('fail');
      expect(String(health.checks[0]?.message)).toMatch(/unreadable|no status|returned/i);
    },
  );

  it('rejects a status outside the contract rather than trusting it', () => {
    // 'ok' is not one of healthy | degraded | unhealthy. Passing it through
    // would put a value into IHealthStatus that its own type forbids.
    const health = classifyWorkerHealth({ status: 'ok' });
    expect(health.status).toBe('unhealthy');
  });

  it('keeps checks absent-but-valid as an empty list', () => {
    const health = classifyWorkerHealth({ status: 'healthy' });
    expect(health.status).toBe('healthy');
    expect(health.checks).toEqual([]);
  });
});
