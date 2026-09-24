/**
 * The alerting loop, when the alerting loop is what breaks.
 *
 * Its job is to notice that something is wrong, which makes its own failure
 * the one failure it could not report: `this.evaluate().catch(() => {})`
 * meant an unreachable database stopped every alert on the platform and said
 * nothing — indistinguishable, from every surface an operator looks at, from
 * a platform with nothing to alert about.
 *
 * The second silence is narrower and just as quiet. An expression the
 * evaluator cannot parse returned `firing: false`, which is the same answer a
 * healthy platform gives, so a rule someone wrote to catch a condition sat in
 * the UI enabled, green, and permanently inert.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { AlertService } from '../../src/services/alert.service.js';
import { registerDaemonJobs } from '../../src/daemon/daemon-scheduler.js';

const logger = {
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  fatal: vi.fn(),
  child: vi.fn(() => logger),
};

/** A database whose first call throws, as an unreachable one does. */
function brokenDb() {
  return {
    selectFrom: () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:5480');
    },
  };
}

/**
 * A database that returns the given rules, no firing events, and accepts
 * every write.
 *
 * `evaluate` also stamps `lastEvaluatedAt` on each rule, so a fake that only
 * answers reads throws halfway through — and the throw would be caught by
 * the loop's own handler, turning this test into an assertion about the
 * fake.
 */
function dbWith(rules: Array<Record<string, unknown>>) {
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    selectAll: () => chain,
    set: () => chain,
    values: () => chain,
    where: () => chain,
    returningAll: () => chain,
    execute: async () => rules,
    executeTakeFirst: async () => undefined,
    executeTakeFirstOrThrow: async () => rules[0],
  });
  return {
    selectFrom: () => chain,
    updateTable: () => chain,
    insertInto: () => chain,
  };
}

const orchestrator = { list: () => [] };

function service(db: unknown) {
  // No project service: no stacks, so no containers.
  return new AlertService({ logger } as never, db as never, orchestrator as never);
}

beforeEach(() => {
  vi.useFakeTimers();
  logger.error.mockReset();
  logger.warn.mockReset();
});
afterEach(() => vi.useRealTimers());

describe('the evaluation loop', () => {
  // The loop is the scheduler's `alert-evaluation` job — the one that runs.
  // `AlertService.start()` was a second loop nothing started, and this court
  // used to guard it.
  const tick = async (evaluate: () => Promise<void>, times: number) => {
    let job: (() => Promise<void>) | undefined;
    const scheduler = {
      addInterval: (name: string, _ms: number, fn: () => Promise<void>) => {
        if (name === 'alert-evaluation') job = fn;
      },
    };
    registerDaemonJobs(scheduler as never, {
      logger: logger as never,
      orchestrator: orchestrator as never,
      authService: null,
      metricsService: { record: vi.fn() } as never,
      alertService: { evaluate } as never,
      fleetService: null,
      logManager: { checkRotation: vi.fn() } as never,
      infraService: null,
      syncService: null,
      metricsInterval: 1000,
      healthCheckInterval: 1000,
    });
    for (let i = 0; i < times; i++) await job!();
  };

  it('reports its own failure instead of swallowing it', async () => {
    await tick(() => service(brokenDb()).evaluate(), 1);

    const failures = logger.error.mock.calls.filter(([, message]) => /alert evaluation failed/i.test(String(message)));
    expect(failures).toHaveLength(1);
    // The cause travels with it: "evaluation failed" without the reason is
    // the same dead end one level up.
    expect((failures[0]![0] as { err?: Error }).err?.message).toContain('ECONNREFUSED');
  });

  it('keeps running after a failed cycle', async () => {
    // A loop that dies on the first bad cycle stops alerting for good, and
    // the log line above would be the only trace — once.
    await tick(() => service(brokenDb()).evaluate(), 3);

    const failures = logger.error.mock.calls.filter(([, message]) => /alert evaluation failed/i.test(String(message)));
    expect(failures).toHaveLength(3);
  });
});

describe('an expression the evaluator cannot read', () => {
  it('says so rather than reporting the rule as not firing', async () => {
    const alerts = service(
      dbWith([{ id: 'r1', name: 'Disk pressure', expression: 'disk.usage > 90', enabled: true }])
    );

    await alerts.evaluate();

    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [context, message] = logger.warn.mock.calls[0]!;
    expect(String(message)).toMatch(/will never fire/i);
    expect(context).toMatchObject({ ruleId: 'r1', expression: 'disk.usage > 90' });
  });

  it('stays quiet about a rule it understands', async () => {
    const alerts = service(
      dbWith([{ id: 'r2', name: 'App down', expression: 'app.*.status != online', enabled: true }])
    );

    await alerts.evaluate();

    expect(logger.warn).not.toHaveBeenCalled();
  });
});
