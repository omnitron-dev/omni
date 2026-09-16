#!/usr/bin/env node
/**
 * Run the standing checks in this directory.
 *
 * Twelve scanners live here, each written to answer one question about the
 * whole monorepo — a question no single file can be asked, because the defect
 * is the relation between places. Nothing ran any of them. No `package.json`
 * script, no turbo task, no workflow. Measured 2026-09-16: eleven of the
 * twelve exit zero today and would catch a regression the moment one appeared;
 * they simply were never asked.
 *
 * A check nobody runs is a check that does not exist. It is the same shape as
 * the retention sweeps in this codebase that had no caller, and the same shape
 * as what `tests-nothing-runs` was written to find: work that is complete,
 * correct, and unreachable.
 *
 * daos has run its sixty-odd this way since 2026-09-15 and the design is
 * copied from there deliberately rather than improved on, so that a person who
 * knows one run knows the other.
 *
 * So: everything in `scripts/*.mjs` is a GATE and must exit zero, unless it is
 * named below with a reason. A new scanner is a gate by default, which is the
 * safe direction — an author who wants a worklist has to say so here, and
 * cannot forget their way out of the run.
 *
 * **What this deliberately does NOT do.** It does not decide whether a hit is a
 * bug. The worklists below exit non-zero by design, carry their own triage
 * blocks, and reading them is a person's job; wiring them in would turn every
 * run red and teach everyone to ignore it. What it does is notice CHANGE: a
 * scanner that exits zero today and non-zero tomorrow has found something new.
 *
 * Usage: pnpm check:scans
 */

import { readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolved from this file, not from the working directory: the scanners here
// read the repository they live in, and a runner invoked from a subdirectory
// must not quietly measure a different tree. `tests-nothing-runs` was found
// doing exactly that when it was run from another repo.
const DIR = dirname(fileURLToPath(import.meta.url));

/** Exit non-zero by design: a standing backlog with a triage block on top. */
const WORKLISTS = new Map([
  [
    'destructive-sites',
    'every place omnitron deletes or overwrites, listed so the bound on each target is read by a person',
  ],
]);

/** Cannot run unattended. */
const EXCLUDED = new Map([['run-checks', 'this runner']]);

/**
 * Scanners that need longer than the default, each with the reason.
 *
 * A flat timeout generous enough for the slowest one lets a genuinely wedged
 * scanner sit for that long, so the exception is named rather than the rule
 * relaxed.
 */
const SLOW = new Map([
  [
    'tests-nothing-runs',
    { ms: 900_000, why: 'starts vitest once per config in 21 packages; ~12s warm, minutes cold' },
  ],
]);

const DEFAULT_TIMEOUT_MS = 180_000;

const all = readdirSync(DIR)
  .filter((f) => f.endsWith('.mjs'))
  .map((f) => f.replace(/\.mjs$/, ''))
  .sort();

// A manifest that names a file which no longer exists is a scanner silently
// dropped from the run — the rename would take it out without a word.
const known = [...WORKLISTS.keys(), ...EXCLUDED.keys(), ...SLOW.keys()];
const missing = known.filter((n) => !existsSync(join(DIR, `${n}.mjs`)));
if (missing.length > 0) {
  console.error(`manifest names scanners that do not exist: ${missing.join(', ')}`);
  console.error('a rename must not take a check out of the run silently');
  process.exit(2);
}

const gates = all.filter((n) => !WORKLISTS.has(n) && !EXCLUDED.has(n));
console.log(`${gates.length} gates, ${WORKLISTS.size} worklists, ${EXCLUDED.size} excluded\n`);

const failed = [];
for (const name of gates) {
  const timeout = SLOW.get(name)?.ms ?? DEFAULT_TIMEOUT_MS;
  const r = spawnSync('node', [join(DIR, `${name}.mjs`)], { encoding: 'utf8', timeout });
  if (r.status === 0) {
    process.stdout.write('.');
    continue;
  }
  process.stdout.write('F');
  failed.push({ name, code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() });
}
console.log('\n');

if (failed.length === 0) {
  console.log(`all ${gates.length} gates pass`);
  process.exit(0);
}

for (const f of failed) {
  console.log(`--- ${f.name} (exit ${f.code === null ? 'timeout' : f.code}) ---`);
  console.log(
    f.out
      .split('\n')
      .slice(0, 12)
      .map((l) => `  ${l}`)
      .join('\n'),
  );
  console.log('');
}
console.error(`${failed.length} of ${gates.length} gates failed`);
process.exit(1);
