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
 *
 * The timestamp is stamped HERE and any value the worker reported is dropped,
 * for the same reason the status is validated: nothing in the payload is
 * trusted. It therefore reads "when this answer was classified", not "when the
 * worker measured" — which is the quantity a caller deciding whether a process
 * is responding can act on, and the one a stalled worker cannot forge.
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

const RANK: Record<IHealthStatus['status'], number> = { healthy: 0, degraded: 1, unhealthy: 2 };
const CHECK_OF: Record<IHealthStatus['status'], IHealthCheck['status']> = {
  healthy: 'pass',
  degraded: 'warn',
  unhealthy: 'fail',
};

/**
 * One health answer from every `@HealthCheck` method of a class worker.
 *
 * The class-worker wrapper turned each method's answer into ONE check named
 * after the method and kept only its verdict and `message`: the `checks` the
 * method returned — database, redis, the dependencies it actually measured —
 * were dropped on the way to the daemon. Every omnitron app runs as such a
 * worker (`BootstrapProcess.checkHealth`), so an app that knew its database
 * was down could say «unhealthy» and nothing about why.
 *
 * It also skipped a method that returned nothing (`if (result)`), which left
 * the verdict at `healthy` — the silent answer read as the reassuring one, the
 * defect `classifyWorkerHealth` was written to close on the module path.
 *
 * Each answer is classified by `classifyWorkerHealth`; its checks are kept,
 * prefixed with the method name only when there is more than one method to
 * tell apart. A method that reported no checks is one check under its own
 * name. A method that threw is a failed check with the error.
 */
export function combineHealthMethods(
  answers: ReadonlyArray<readonly [method: string, outcome: { value: unknown } | { error: unknown }]>,
): IHealthStatus {
  const timestamp = Date.now();
  const checks: IHealthCheck[] = [];
  let status: IHealthStatus['status'] = 'healthy';
  const prefix = answers.length > 1;

  for (const [method, outcome] of answers) {
    if ('error' in outcome) {
      status = 'unhealthy';
      const message = outcome.error instanceof Error ? outcome.error.message : String(outcome.error);
      checks.push({ name: method, status: 'fail', message });
      continue;
    }

    const answer = classifyWorkerHealth(outcome.value);
    if (RANK[answer.status] > RANK[status]) status = answer.status;

    if (answer.checks.length === 0) {
      const message = (outcome.value as { message?: unknown } | null | undefined)?.message;
      checks.push({
        name: method,
        status: CHECK_OF[answer.status],
        ...(typeof message === 'string' ? { message } : {}),
      });
      continue;
    }
    for (const check of answer.checks) {
      checks.push(prefix ? { ...check, name: `${method}: ${check.name}` } : check);
    }
  }

  return { status, checks, timestamp };
}
