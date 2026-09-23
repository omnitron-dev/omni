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

/**
 * A `traffic` field as it arrived over the wire, checked field by field —
 * the consumer is the last place that can tell a report from noise, the same
 * rule `classifyWorkerHealth` applies to health. `undefined` when it is not a
 * readable report.
 */
export function readTrafficField(value: unknown): IProcessTraffic | undefined {
  const t = value as Partial<IProcessTraffic> | null | undefined;
  const n = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  if (!t || typeof t !== 'object') return undefined;
  if (![t.requests, t.serverErrors, t.clientErrors, t.probes, t.active].every(n)) return undefined;
  const l = t.latency as Record<string, unknown> | null | undefined;
  const latency =
    l && typeof l === 'object' && ['windowMs', 'coveredMs', 'count', 'mean', 'p50', 'p75', 'p90', 'p95', 'p99', 'max'].every((k) => n(l[k]))
      ? (l as unknown as NonNullable<IProcessTraffic['latency']>)
      : null;
  return {
    requests: t.requests!,
    serverErrors: t.serverErrors!,
    clientErrors: t.clientErrors!,
    probes: t.probes!,
    // Optional: a runtime that does not count held requests still reports.
    ...(n(t.held) ? { held: t.held } : {}),
    active: t.active!,
    latency,
  };
}
