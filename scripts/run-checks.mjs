#!/usr/bin/env node
/**
 * Run the reviewed source gates. Every top-level script needs a classification
 * before the runner may execute anything. Release and build entry points have
 * dedicated invocations and inputs.
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
  [
    'a-build-older-than-its-source',
    'a repository mid-change legitimately has sources ahead of artefacts; the list is what changes how other measurements read',
  ],
]);

/** Entrypoints executed separately by CI, and the scanner dispatcher itself. */
const EXCLUDED = new Map([
  ['run-checks', 'this runner'],
  ['build-release', 'builds from a sealed source export and commit'],
  ['release', 'maintainer release entry point with its own qualification suite'],
  ['check-package-exports', 'CI checks packed exports after building all packages'],
  ['react-client-entries', 'tsup plugin used by the Prism and Netron React builds; verified in the packed exports'],
  ['check-reproducible-backend', 'a dedicated CI job builds and compares independent backend and Console artifacts'],
]);

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

const gates = [
  'a-package-that-needs-itself-built', 'a-port-the-network-could-reach', 'a-private-project-in-public-source',
  'a-temp-dir-the-test-runner-never-removed', 'doc-imports-resolve', 'duplicate-implementations', 'fail-open',
  'logged-secrets', 'metadata-nobody-reads', 'module-root-drift', 'prism-public-types-reachable',
  'stub-that-reports-success', 'tests-nothing-runs', 'uncalled-janitors', 'undeclared-dependencies',
];

const all = readdirSync(DIR)
  .filter((f) => f.endsWith('.mjs'))
  .map((f) => f.replace(/\.mjs$/, ''))
  .sort();

// A manifest that names a file which no longer exists is a scanner silently
// dropped from the run — the rename would take it out without a word.
const known = [...gates, ...WORKLISTS.keys(), ...EXCLUDED.keys()];
const missing = known.filter((n) => !existsSync(join(DIR, `${n}.mjs`)));
if (missing.length > 0) {
  console.error(`manifest names scanners that do not exist: ${missing.join(', ')}`);
  console.error('a rename must not take a check out of the run silently');
  process.exit(2);
}

const unknown = all.filter(name => !known.includes(name));
if (unknown.length || [...SLOW.keys()].some(name => !gates.includes(name))) {
  console.error(`Classify new scripts and check slow-gate names before running source checks: ${unknown.join(', ')}`);
  process.exit(2);
}
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
