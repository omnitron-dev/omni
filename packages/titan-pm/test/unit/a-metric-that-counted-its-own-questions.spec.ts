/**
 * The traffic part of a worker's metrics answer (`worker-traffic.ts`).
 *
 * `__getProcessMetrics` answered `requests`/`errors` from the call counters
 * of the process wrapper — for an omnitron app, the supervisor's own health
 * and metrics calls — and `latency: { last: 0 }`, a constant. A process that
 * reports its traffic now supplies all three; one that does not keeps the
 * wrapper counters and reports no latency rather than a made-up one.
 */
import { describe, it, expect } from 'vitest';

import { readProcessTraffic, trafficFields } from '../../src/worker-traffic.js';

const traffic = {
  requests: 250,
  serverErrors: 4,
  clientErrors: 9,
  probes: 30,
  active: 1,
  latency: { windowMs: 60_000, coveredMs: 60_000, count: 250, mean: 21, p50: 12, p75: 20, p90: 33, p95: 40, p99: 90, max: 310 },
};

describe('trafficFields', () => {
  it('takes requests, errors and latency from the traffic the process reported', () => {
    expect(trafficFields(traffic, { requestCount: 3, errorCount: 0 })).toEqual({
      requests: 250,
      errors: 4,
      traffic,
      latency: { p50: 12, p75: 20, p90: 33, p95: 40, p99: 90, mean: 21 },
    });
  });

  it('without traffic keeps the wrapper counters and invents no latency', () => {
    const out = trafficFields(undefined, { requestCount: 3, errorCount: 1 });
    expect(out).toEqual({ requests: 3, errors: 1 });
    expect(out).not.toHaveProperty('latency');
  });

  it('an idle window is no latency, not zero latency', () => {
    expect(trafficFields({ ...traffic, latency: null }, { requestCount: 0, errorCount: 0 })).not.toHaveProperty('latency');
  });
});

describe('readProcessTraffic', () => {
  it('asks the instance, and a reporter that throws is «not reported», not a failed metrics call', async () => {
    expect(await readProcessTraffic({ reportTraffic: () => traffic })).toBe(traffic);
    expect(await readProcessTraffic({ reportTraffic: async () => null })).toBeUndefined();
    expect(await readProcessTraffic({ reportTraffic: () => { throw new Error('no'); } })).toBeUndefined();
    expect(await readProcessTraffic({})).toBeUndefined();
  });
});
