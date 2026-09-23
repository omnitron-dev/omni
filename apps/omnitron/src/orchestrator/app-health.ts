/**
 * One app's health, from what each of its processes answered.
 *
 * An app is as healthy as its least healthy process: `main` runs `http`,
 * `captcha-generator` and `notification-worker`, and the orchestrator asked
 * the first of them and nothing else, so the other two could answer
 * `unhealthy` for ever while the app read `healthy`.
 *
 * Every process is named in the checks, and so is every check it reported,
 * prefixed with the process — a verdict that is not `healthy` then says which
 * process, and what in it.
 */

import type { IHealthStatus, IHealthCheck, IPoolMetrics } from '@omnitron-dev/titan-pm';

type Verdict = IHealthStatus['status'];

const RANK: Record<Verdict, number> = { healthy: 0, degraded: 1, unhealthy: 2 };
const CHECK_OF: Record<Verdict, IHealthCheck['status']> = { healthy: 'pass', degraded: 'warn', unhealthy: 'fail' };

export function worstVerdict(verdicts: Iterable<Verdict>): Verdict {
  let worst: Verdict = 'healthy';
  for (const v of verdicts) if (RANK[v] > RANK[worst]) worst = v;
  return worst;
}

/**
 * @param answers each process's name and what it answered; `null` is a
 *   process the process manager has no health channel to — said as such,
 *   at `warn`, because nobody measured it, which is not the same as healthy.
 */
export function combineProcessHealth(
  answers: ReadonlyArray<readonly [process: string, answer: IHealthStatus | null]>,
  now: number = Date.now(),
): IHealthStatus {
  const checks: IHealthCheck[] = [];
  const verdicts: Verdict[] = [];

  for (const [process, answer] of answers) {
    if (!answer) {
      verdicts.push('degraded');
      checks.push({ name: process, status: 'warn', message: 'no health answer — the process manager has no channel to ask it' });
      continue;
    }
    verdicts.push(answer.status);
    if (answer.checks.length === 0) {
      checks.push({ name: process, status: CHECK_OF[answer.status] });
      continue;
    }
    for (const check of answer.checks) {
      checks.push({ ...check, name: `${process}: ${check.name}` });
    }
  }

  return { status: worstVerdict(verdicts), checks, timestamp: now };
}

/** An app that is not running has no processes to ask; that IS the answer. */
export function notRunningHealth(status: string, now: number = Date.now()): IHealthStatus {
  return {
    status: 'unhealthy',
    checks: [{ name: 'process', status: 'fail', message: `not running (${status})` }],
    timestamp: now,
  };
}

/**
 * A worker pool's health, from its own per-worker checks.
 *
 * Pool workers are not supervisor children, so the per-child question never
 * reached them; the pool already runs its own health checks on every worker
 * and counts the result.
 */
export function poolHealth(
  metrics: Pick<IPoolMetrics, 'totalWorkers' | 'healthyWorkers'> | undefined,
  now: number = Date.now(),
): IHealthStatus | null {
  if (!metrics) return null;
  const total = metrics.totalWorkers;
  const healthy = metrics.healthyWorkers ?? 0;
  const status: Verdict = total > 0 && healthy === total ? 'healthy' : healthy > 0 ? 'degraded' : 'unhealthy';
  return {
    status,
    checks: [{ name: 'workers', status: CHECK_OF[status], message: `${healthy} of ${total} worker(s) healthy` }],
    timestamp: now,
  };
}
