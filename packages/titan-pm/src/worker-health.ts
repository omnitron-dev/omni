/**
 * Classification of a worker service's `checkHealth()` answer.
 *
 * Extracted from `worker-runtime.ts` so it can be tested: that module calls
 * `initialize()` at import and starts a worker, so nothing can import it. The
 * test that covered this previously re-implemented the function inline and
 * asserted against its own copy — which is how it went unnoticed that a
 * `checkHealth()` returning nothing was reported as healthy.
 */
import type { IHealthStatus, IHealthCheck } from './types.js';

const VALID: ReadonlySet<string> = new Set(['healthy', 'degraded', 'unhealthy']);

/**
 * Turn whatever `checkHealth()` returned into an `IHealthStatus`.
 *
 * A result we cannot read is reported as UNHEALTHY, with a check saying so.
 * The wrapper already classifies a THROWING `checkHealth()` that way, and the
 * two are the same event from the caller's side: no answer was obtained. The
 * previous `result?.status ?? 'healthy'` classified them oppositely and put
 * the silent one on the reassuring side.
 *
 * A status outside the contract is rejected rather than passed through:
 * `IHealthStatus.status` is a union of three values, and forwarding a fourth
 * would place something in it that its own type says cannot be there.
 */
export function classifyWorkerHealth(result: unknown): IHealthStatus {
  const timestamp = Date.now();
  const record = result as { status?: unknown; checks?: unknown } | null | undefined;
  const status = record && typeof record === 'object' ? record.status : undefined;

  if (typeof status === 'string' && VALID.has(status)) {
    const checks = Array.isArray(record?.checks) ? (record.checks as IHealthCheck[]) : [];
    return { status: status as IHealthStatus['status'], checks, timestamp };
  }

  const seen =
    result === undefined || result === null
      ? String(result)
      : typeof result === 'object'
        ? `status=${JSON.stringify(status)}`
        : `${typeof result}`;

  return {
    status: 'unhealthy',
    checks: [
      {
        name: 'checkHealth',
        status: 'fail',
        message: `checkHealth() returned an unreadable result (${seen}) — treated as unhealthy, since no health answer was obtained`,
      },
    ],
    timestamp,
  };
}
