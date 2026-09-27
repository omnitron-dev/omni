/**
 * A budget that shrank what the config already allowed.
 *
 * `vitest.config.ts` gives this package `testTimeout: 120_000` and
 * `hookTimeout: 120_000`. Three cases overrode that DOWNWARD, and one of them said in
 * its comment that it was doing the opposite:
 *
 *     repository.spec.ts        `}, 60000);`  on the beforeAll that starts a Postgres
 *     docker-integration.spec  `}, 60000); // Increase timeout for Docker container
 *                              startup` — 60 s is HALF of what the config allows. The
 *                              comment was true when vitest's own default was 5 s, and
 *                              became a lie the day the config said 120 s.
 *     docker-integration.spec  `}, 90000); // Increased timeout for MySQL 8.0 …`
 *
 * What that cost, measured 2026-09-27: `repository.spec.ts` needs 64.45 s to start its
 * container ALONE on a quiet machine (load 16) — past its own 60 s — and one
 * `docker run --rm alpine echo ok` on that machine under load took 118.63 s. Both
 * Docker files timed out at 60 s that day, in different runs of the same suite.
 *
 * Four more overrides said `}, 120000)`, exactly what the config already says: harmless
 * today and a trap tomorrow, because a number written twice drifts.
 *
 * So the rule held here: a per-case budget may only RAISE what the config allows, unless
 * it is listed below with its reason. Writing the rule strictly was wrong and a run of
 * this court said so: it found four more overrides my own grep had missed (they spell the
 * number with underscores — `40_000` — which my pattern did not accept), and ONE of them
 * shrinks on purpose. `a-retry-that-could-not-help` measures how long a permanent
 * failure takes to be refused and asserts `ms < PROMPT_MS || ms > 25_000`; its 40 s is a
 * ceiling over that second branch, and letting the config's 120 s apply would let the
 * case it exists to catch pass by taking two minutes. There the budget IS the assertion.
 *
 * A comment is not enough to tell the two apart — the 60 s that shrank the Docker hook
 * carried one, and it said «Increase timeout». So the exceptions are listed here, by file,
 * where adding one is a decision somebody makes rather than a sentence they type.
 *
 * This is a check on source text, which is the only place the rule lives — vitest tells
 * a test nothing about the config's defaults at runtime.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const PKG = join(__dirname, '..');

/** The defaults every case inherits, read from the config rather than repeated here. */
function configuredDefaults(): { testTimeout: number; hookTimeout: number } {
  const src = readFileSync(join(PKG, 'vitest.config.ts'), 'utf8');
  const read = (name: string): number => {
    const m = new RegExp(`${name}\\s*:\\s*([0-9_]+)`).exec(src);
    expect(m, `${name} is set in vitest.config.ts`).not.toBeNull();
    return Number(m![1]!.replace(/_/g, ''));
  };
  return { testTimeout: read('testTimeout'), hookTimeout: read('hookTimeout') };
}

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(spec|test)\.ts$/.test(name) ? [path] : [];
  });
}

/**
 * Every trailing timeout argument: the `}, N)` that closes an `it`, a `test` or a hook.
 * Anything under 1000 is not a millisecond budget — a `toBe(0)` or a slice index does not
 * appear in this shape, but the floor keeps the reader honest about what is being matched.
 */
const budgets = sources(join(PKG, 'test'))
  .filter((path) => path !== __filename)
  .flatMap((path) => {
    const code = readFileSync(path, 'utf8');
    return [...code.matchAll(/^\s*\}, ([0-9_]{4,9})\);/gm)].map((m) => ({
      file: relative(PKG, path),
      line: code.slice(0, m.index!).split('\n').length,
      ms: Number(m[1]!.replace(/_/g, '')),
    }));
  });

/**
 * Budgets at or below the config's default that are deliberate, with the reason.
 *
 * `a-retry-that-could-not-help` asserts the TIME a permanent failure takes to be
 * refused; its budget is the ceiling of that assertion, not a wait.
 */
const DELIBERATE: ReadonlyArray<{ file: string; ms: number }> = [
  { file: 'test/a-retry-that-could-not-help.test.ts', ms: 40_000 },
];

describe('a per-case budget, against the config that already allows one', () => {
  it('found the config and the overrides — a reader that found neither would pass anything', () => {
    const { testTimeout, hookTimeout } = configuredDefaults();
    expect(testTimeout).toBeGreaterThan(0);
    expect(hookTimeout).toBeGreaterThan(0);
    // If every override goes, this court is measuring an empty set and should say so
    // rather than pass. The listed exception must still be there too: a deliberate short
    // budget deleted is an assertion lost, and the list would then excuse nothing.
    expect(budgets.length).toBeGreaterThanOrEqual(1 + DELIBERATE.length);
    expect(
      DELIBERATE.filter((d) => !budgets.some((b) => b.file === d.file && b.ms === d.ms)),
      'a listed exception that no longer exists — remove it from DELIBERATE'
    ).toEqual([]);
  });

  it('never shrinks it, and never repeats it', () => {
    const { testTimeout, hookTimeout } = configuredDefaults();
    const allowed = Math.max(testTimeout, hookTimeout);
    const offenders = budgets
      .filter((b) => b.ms <= allowed)
      .filter((b) => !DELIBERATE.some((d) => d.file === b.file && d.ms === b.ms))
      .map((b) => `${b.file}:${b.line} → ${b.ms} ms, against the config's ${allowed}`);
    expect(offenders).toEqual([]);
  });
});
