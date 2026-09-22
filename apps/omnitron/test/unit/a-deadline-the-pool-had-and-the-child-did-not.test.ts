/**
 * A pool's worker gets a stated deadline. A single child gets whatever
 * netron defaults to.
 *
 *     pool         orchestrator.service.ts:1918   requestTimeout: 120_000
 *     single 1     orchestrator.service.ts:2083   startupTimeout, env — no deadline
 *     single 2     orchestrator.service.ts:2278   the same
 *     passthrough  process-spawner.ts:1000        ...(options.requestTimeout !== undefined && {…})
 *
 * The last line is where the omission goes quiet: no key means nothing is
 * passed, which means `NetronClient` is built without one, which means 5000 —
 * netron's `REQUEST_TIMEOUT`, a deadline sized for a wire request.
 *
 * `callExposedService` (`bootstrap-process.ts:624`) is a method ON the
 * application, called by the daemon through the child's proxy
 * (`service-router.ts:264`). Single child processes are exactly where it
 * lives, and exactly where the deadline was missing.
 *
 * Counted before changing anything, two ways. In the daemon log, of every
 * deadline appearing in a timeout message — 10 000, 60 000, 90 000, 120 000,
 * 180 000, 300 000, 600 000 — each traces to a place that chose it; 5000
 * belongs to none, and appears 94 times, all on `callExposedService` (09-20:
 * 71, 09-21: 82, 09-22: 19). In the application logs, «timed out after
 * 5000ms» appears 345 times across all five apps, while 60 000, 30 000,
 * 300 000, 90 000 and 120 000 each sit with the single app that picked them.
 *
 * Whose number belongs here matters, and it is not the library's. The pool
 * looks like it names its own, but 120 000 comes from the CALLER; the pool's
 * own default is `options.requestTimeout ?? 30000`
 * (`process-pool.ts:212`). The orchestrator knows what kind of work crosses
 * this connection, so the orchestrator states it — the same reason a
 * shutdown window belongs to whoever holds SIGKILL. (omni-03's correction;
 * my first phrasing credited the pool with a choice its caller had made.)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const orchestrator = () =>
  readFileSync(fileURLToPath(new URL('../../src/orchestrator/orchestrator.service.ts', import.meta.url)), 'utf8');

/** Every `const spawnOpts = { … }` literal in the orchestrator. */
function spawnOptionLiterals(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(/const spawnOpts\s*=\s*\{/g)) {
    let depth = 0;
    let i = source.indexOf('{', m.index!);
    const start = i;
    for (; i < source.length; i++) {
      if (source[i] === '{') depth += 1;
      else if (source[i] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    out.push(source.slice(start, i + 1));
  }
  return out;
}

describe('a deadline the pool had and the child did not', () => {
  it('every single-child spawn states a request deadline', () => {
    const literals = spawnOptionLiterals(orchestrator());

    expect(literals.length, 'no spawnOpts literal found — re-point this test').toBeGreaterThan(0);
    for (const [i, literal] of literals.entries()) {
      expect(
        literal,
        `spawnOpts #${i + 1} leaves the child's client on netron's 5000 ms default`,
      ).toMatch(/requestTimeout/);
    }
  });

  it('every deadline stated here resolves to the same number', () => {
    // Two numbers for one kind of connection is the defect this repository
    // has now paid for three times — the shutdown ladder, the topology call,
    // the daemon socket. The pool's and the children's must be one value,
    // whatever it is called; a second literal creeping in is what this
    // catches.
    const source = orchestrator();

    const stated = [...source.matchAll(/requestTimeout:\s*([A-Za-z0-9_]+)/g)].map((m) => m[1]!);
    expect(stated.length, 'nothing states a deadline at all').toBeGreaterThanOrEqual(3);

    const resolved = stated.map((token) =>
      /^[0-9_]+$/.test(token)
        ? token.replace(/_/g, '')
        : new RegExp(`${token}\\s*=\\s*([0-9_]+)`).exec(source)?.[1]?.replace(/_/g, ''),
    );

    for (const [i, value] of resolved.entries()) {
      expect(value, `${stated[i]} resolves to no number in this file`).toBeTruthy();
    }
    expect(new Set(resolved).size, `disagreeing deadlines: ${stated.join(', ')}`).toBe(1);
  });

  it('the passthrough still omits an option nobody stated', () => {
    // Control: the conditional spread in `process-spawner` is correct — a
    // caller that states nothing should not have a number invented for it by
    // the spawner. What was wrong is that the orchestrator stated nothing;
    // this keeps the library's side honest so the value has exactly one
    // owner.
    const spawner = readFileSync(
      fileURLToPath(new URL('../../../../packages/titan-pm/src/process-spawner.ts', import.meta.url)),
      'utf8',
    );

    expect(spawner).toMatch(/options\.requestTimeout !== undefined && \{\s*requestTimeout/);
  });
});
