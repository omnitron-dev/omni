/**
 * The health check reported latency it had not measured.
 *
 *     const startTime = Date.now();
 *     const result = await this.validateConnectionHealth(…);
 *     const latency = Date.now() - startTime;     // wall clock, both ends
 *     if (latency > 500) logger.warn({ latency }, '… high latency');
 *
 * `Date.now()` keeps running while the process does not: a sleeping machine,
 * a suspended container, an event loop held by synchronous work. The number
 * that reaches the log is the distance between two wall-clock readings, and
 * that distance answers three different questions with one value — how slow
 * the database was, how long the process was blocked, how long the machine
 * slept.
 *
 * Measured on the dev stand, both log formats (4 955 records):
 *
 *     geo         1 841   median 1 312   p95  6 763   max  20 533 ms
 *     storage     1 184   median   954   p95  3 468   max  20 377 ms
 *     priceverse  1 031   median   990   p95  3 413   max  10 651 ms
 *     paysys        395   median   891   p95  3 084   max  12 502 ms
 *     main          287   median 1 067   p95  3 423   max 126 914 ms
 *     messaging     217   median 1 060   p95  2 576   max   9 747 ms
 *
 * 227 of them exceed the check's OWN abort deadline, and that is the proof
 * the number is not a query time. `validateConnectionHealth` races the query
 * against `setTimeout(() => ac.abort(), 5000)` (sqlite: 10000). A query that
 * truly took 126 914 ms could not have returned `healthy` — the timer would
 * have rejected it 122 seconds earlier. The timer did not fire on time, so
 * the timers phase did not run, so the process was not executing. The check
 * measured the process, not the database, and called the process a database.
 *
 * That is also what makes the blocked case diagnosable rather than guessed:
 * a success arriving later than its own deadline proves the timers phase was
 * starved for at least `elapsed - deadline`.
 *
 * Two clocks separate the three questions. `Date.now()` advances through
 * sleep; `process.hrtime.bigint()` does not. Together they say which of the
 * three happened, and the threshold belongs on the monotonic one — otherwise
 * every wake-up of a laptop prints a burst of false latency.
 */

import { describe, it, expect, afterEach, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DatabaseManager } from '../src/database.manager.js';

const TMP = mkdtempSync(join(tmpdir(), 'titan-db-latency-'));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const recordingLogger = () => {
  const logger = {
    info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(),
    trace: vi.fn(), fatal: vi.fn(), child: vi.fn(),
  };
  logger.child.mockReturnValue(logger);
  return logger;
};

/** Messages a mocked logger level was called with, paired with their fields. */
const calls = (fn: ReturnType<typeof vi.fn>) =>
  fn.mock.calls.map(([fields, msg]) => ({ fields: fields as Record<string, unknown>, msg: String(msg) }));

describe('a latency that measured the process', () => {
  let manager: DatabaseManager | undefined;
  let logger: ReturnType<typeof recordingLogger>;

  afterEach(async () => {
    vi.restoreAllMocks();
    await manager?.closeAll().catch(() => {});
    manager = undefined;
  });

  /**
   * A manager on a real sqlite file, with `validateConnectionHealth` replaced
   * by an instant success and both clocks driven by the test. The health
   * check then measures exactly the interval the test dictates, and nothing
   * else — no query, no pool, no scheduler.
   */
  async function checkWithClocks(wallMs: number, monoMs: number) {
    logger = recordingLogger();
    const created = new DatabaseManager(
      { connection: { dialect: 'sqlite', connection: join(TMP, `latency-${wallMs}-${monoMs}.sqlite`) } },
      logger as never,
    );
    await created.init();
    manager = created;

    const internals = created as unknown as {
      validateConnectionHealth: () => Promise<{ healthy: true }>;
      runSingleHealthCheck: (name: string, info: unknown) => Promise<void>;
      connections: Map<string, unknown>;
    };
    internals.validateConnectionHealth = async () => ({ healthy: true });

    // Both clocks answer twice: once before the check, once after. Later
    // readings (anything else in the manager) get the real clock back.
    const wall = [1_000, 1_000 + wallMs];
    const mono = [0n, BigInt(Math.round(monoMs * 1e6))];
    const realNow = Date.now.bind(Date);
    const realHr = process.hrtime.bigint.bind(process.hrtime);
    vi.spyOn(Date, 'now').mockImplementation(() => wall.shift() ?? realNow());
    vi.spyOn(process.hrtime, 'bigint').mockImplementation(() => mono.shift() ?? realHr());

    const info = internals.connections.get('default');
    await internals.runSingleHealthCheck('default', info);
  }

  it('a success later than its own abort deadline is a blocked process, not a slow database', async () => {
    // 13 s elapsed on BOTH clocks — the process ran. These connections are
    // sqlite, so the abort timer was set to 10 s; it never fired, which is
    // only possible if the timers phase was starved.
    await checkWithClocks(13_000, 13_000);

    const warnings = calls(logger.warn);
    expect(warnings, 'a check that outran its own deadline must say so').toHaveLength(1);
    expect(warnings[0]!.msg).toMatch(/event loop|blocked/i);
    expect(warnings[0]!.msg).not.toMatch(/high latency/i);
    // The starvation is provable, not estimated: 13 000 returned under a
    // 10 000 ms deadline means at least 3 000 ms with no timers phase.
    expect(warnings[0]!.fields['deadlineMs']).toBe(10_000);
    expect(warnings[0]!.fields['stalledAtLeastMs']).toBe(3_000);
  });

  it('a wall clock that jumped while the monotonic one did not is a sleeping machine', async () => {
    // Two minutes of wall clock, 3 ms of monotonic: the machine slept.
    await checkWithClocks(120_000, 3);

    expect(calls(logger.warn), 'sleep is not an incident').toHaveLength(0);
    const debug = calls(logger.debug).filter((c) => /slept|wall clock/i.test(c.msg));
    expect(debug, 'but it must still be visible').toHaveLength(1);
    expect(debug[0]!.fields['wallMs']).toBe(120_000);
  });

  it('a genuinely slow query is still reported as high latency', async () => {
    // Both clocks agree on 800 ms: over the 500 ms threshold, under the
    // 5 000 ms deadline. This is the case the warning was written for, and
    // the control that the fix did not simply silence it.
    await checkWithClocks(800, 800);

    const warnings = calls(logger.warn);
    expect(warnings, 'a slow database must still be reported').toHaveLength(1);
    expect(warnings[0]!.msg).toMatch(/high latency/i);
    // Read under either name so this control holds across the fix: it guards
    // the behaviour that must not change, not the field that does.
    const reported = warnings[0]!.fields['monoMs'] ?? warnings[0]!.fields['latency'];
    expect(reported, 'and with the figure it measured').toBe(800);
  });

  it('a fast check says nothing at all', async () => {
    await checkWithClocks(4, 4);

    expect(calls(logger.warn), 'a healthy fast check is not news').toHaveLength(0);
    expect(calls(logger.debug).filter((c) => /slept|wall clock/i.test(c.msg))).toHaveLength(0);
  });
});
