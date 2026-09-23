/**
 * The traffic part of a worker's metrics answer.
 *
 * Extracted from `worker-runtime.ts` for the same reason as `worker-health.ts`:
 * that module calls `initialize()` at import and cannot be loaded by a test.
 *
 * `__getProcessMetrics` answered `requests` and `errors` from the counters of
 * the process WRAPPER's own methods and `latency: { last: 0 }`, a constant.
 * For an omnitron app the wrapper's methods are what the supervisor calls —
 * health checks, metrics polls — so `omnitron metrics` counted its own
 * questions as the app's traffic: `requests` rose by exactly one for every
 * `omnitron inspect --graph`, and three real `GET /health` answered 200 were
 * not counted at all.
 */
import type { IProcessMetrics, IProcessTraffic } from './types.js';

/** Ask the instance for its traffic; any failure is «not reported», never a throw into the metrics call. */
export async function readProcessTraffic(instance: unknown): Promise<IProcessTraffic | undefined> {
  const reporter = (instance as { reportTraffic?: unknown } | null | undefined)?.reportTraffic;
  if (typeof reporter !== 'function') return undefined;
  try {
    const traffic = (await reporter.call(instance)) as IProcessTraffic | null | undefined;
    return traffic ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * The request, error and latency fields of a metrics answer.
 *
 * With traffic: taken from it. Without: the wrapper's call counters, as
 * before, and no latency at all rather than a constant.
 */
export function trafficFields(
  traffic: IProcessTraffic | undefined,
  wrapperCalls: { requestCount: number; errorCount: number },
): Pick<IProcessMetrics, 'requests' | 'errors' | 'latency' | 'traffic'> {
  if (!traffic) return { requests: wrapperCalls.requestCount, errors: wrapperCalls.errorCount };
  const { latency } = traffic;
  return {
    requests: traffic.requests,
    errors: traffic.serverErrors,
    traffic,
    ...(latency
      ? {
          latency: {
            p50: latency.p50,
            p75: latency.p75,
            p90: latency.p90,
            p95: latency.p95,
            p99: latency.p99,
            mean: latency.mean,
          },
        }
      : {}),
  };
}
