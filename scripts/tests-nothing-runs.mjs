#!/usr/bin/env node
/**
 * A test file no runner collects.
 *
 * `packages/netron-browser/test/auth/` holds three spec files — 28 tests over
 * the browser client's token storage, its auth context and its bearer headers.
 * The package's vitest config includes `tests/unit` — plural `tests`, and only
 * `unit`. The integration config includes `tests/integration`. The playwright
 * config's testDir is `./tests/e2e`. `test/auth/` is matched by none of the
 * three, so those 28 tests have never run. Four of them fail.
 *
 * Nothing said so, and nothing could: `pnpm test` in that package collects 46
 * files, passes, and exits 0. Even `vitest run test/auth` — naming the
 * directory outright — prints "No test files found", because a positional
 * filter narrows the config's include rather than replacing it. The suite is
 * green for the same reason it is silent: what would have noticed is the thing
 * that is missing.
 *
 * The distinction this scan is built on:
 *
 *   - a file named by a config's exclude is a DECISION. Someone saw the file
 *     and wrote down that it should not run. `apps/omnitron`'s excluded
 *     integration test carries fifteen lines of reason. Reported as a count.
 *   - a file matched by no include anywhere is NOBODY'S decision. It is the
 *     product of a directory named `test` next to one named `tests`, or a
 *     rename, or a file dropped a level too high. That is the finding.
 *
 * Coverage is asked of the runners themselves — `vitest list` per config, and
 * playwright's testDir/testMatch — rather than by re-implementing their glob
 * semantics, because a scan that models a runner eventually disagrees with it,
 * and then it is measuring its own model.
 *
 * The exclude arrays ARE read textually from the config source, since the
 * resolved value lives inside a TS module this scan does not execute. They are
 * read through the shared comment stripper, so a commented-out exclude does
 * not count as one.
 *
 * FAIL-SAFE: a package whose collection comes back EMPTY while it has test
 * files and a config is reported as a COLLECTION FAILURE, not as a package
 * full of orphans. A scan that reports everything is as useless as one that
 * reports nothing, and a runner that stops answering must not look like a
 * discovery.
 *
 * Usage: node scripts/tests-nothing-runs.mjs [--json] [--root <dir>]
 * Takes a few minutes: it starts each runner once per config.
 *
 * `--root` points it at another repository. Without it the root is THIS
 * script's repository, not the working directory — which is the right default
 * for a scan invoked from anywhere inside its own tree, and a trap when the
 * question is about a different monorepo: run it from there and it silently
 * measures this one, reporting a clean result for a tree it never read.
 */

import { execSync, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import { stripComments } from './lib/strip-comments.mjs';

const rootArg = process.argv.indexOf('--root');
const ROOT = resolve(
  rootArg !== -1 && process.argv[rootArg + 1]
    ? process.argv[rootArg + 1]
    : new URL('..', import.meta.url).pathname,
);
const JSON_OUT = process.argv.includes('--json');

if (!existsSync(join(ROOT, '.git'))) {
  console.error(`not a repository: ${ROOT}`);
  process.exit(2);
}

/**
 * Deliberate absences, each with the reason it is deliberate. An entry here
 * must name WHY, not merely silence a path — a list of paths with no reasons
 * is how a scan stops being read.
 */
const ANSWERED = [
  {
    match: (f) => /\/(test|tests)\/runtime\//.test(f) || /\/test\/nexus\/(bun|runtime)\//.test(f),
    why: 'targets the Bun or Deno test runner, not vitest; excluded in the config on purpose',
  },
];

const sh = (cmd, cwd) => execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

// ---------------------------------------------------------------------------
// every tracked test file, grouped by the workspace package that owns it
// ---------------------------------------------------------------------------

const tracked = sh(
  "git ls-files '*.test.ts' '*.spec.ts' '*.test.tsx' '*.spec.tsx' '*.test.js' '*.spec.js'",
  ROOT,
)
  .split('\n')
  .filter(Boolean)
  .filter((f) => !f.includes('node_modules/'));

/** The nearest package.json at or above a file is the package that owns it. */
function ownerOf(file) {
  let dir = dirname(join(ROOT, file));
  while (dir.startsWith(ROOT) && dir !== ROOT) {
    if (existsSync(join(dir, 'package.json'))) return relative(ROOT, dir);
    dir = dirname(dir);
  }
  return null;
}

const byPackage = new Map();
const unowned = [];
for (const f of tracked) {
  const pkg = ownerOf(f);
  if (!pkg) {
    unowned.push(f);
    continue;
  }
  if (!byPackage.has(pkg)) byPackage.set(pkg, []);
  byPackage.get(pkg).push(f);
}

// ---------------------------------------------------------------------------
// ask each runner what it collects
// ---------------------------------------------------------------------------

const configsIn = (pkgDir, re) => {
  try {
    return readdirSync(join(ROOT, pkgDir)).filter((n) => re.test(n));
  } catch {
    return [];
  }
};

/** `vitest list --filesOnly` is the runner's own answer to "what would you run". */
function vitestCollects(pkg, config) {
  try {
    const out = execFileSync('npx', ['vitest', 'list', '--filesOnly', '--config', config], {
      cwd: join(ROOT, pkg),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 300_000,
    });
    return out
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => /\.(test|spec)\.(ts|tsx|js)$/.test(l))
      .map((l) => join(pkg, l.replace(/^\.\//, '')));
  } catch {
    return null; // a runner that refused to answer is not an empty answer
  }
}

/** Playwright is asked by its own two fields rather than by starting a browser. */
function playwrightCollects(pkg, config) {
  const src = stripComments(readFileSync(join(ROOT, pkg, config), 'utf8'));
  const dir = src.match(/testDir\s*:\s*['"`]([^'"`]+)['"`]/)?.[1];
  if (!dir) return null;
  const match = src.match(/testMatch\s*:\s*['"`]([^'"`]+)['"`]/)?.[1] ?? '**/*.spec.ts';
  const base = join(pkg, dir.replace(/^\.\//, ''));
  const tail = match.replace(/^\*\*\//, '');
  const re = new RegExp(
    '^' + tail.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '.') + '$',
  );
  return (byPackage.get(pkg) ?? []).filter(
    (f) => f.startsWith(base + '/') && re.test(f.split('/').pop()),
  );
}

/** Paths a config names in `exclude` — a decision, read through the stripper. */
function excludedBy(pkg, configs) {
  const out = [];
  for (const c of configs) {
    const src = stripComments(readFileSync(join(ROOT, pkg, c), 'utf8'));
    const blocks = src.match(/exclude\s*:\s*\[([\s\S]*?)\]/g) ?? [];
    for (const b of blocks) for (const m of b.matchAll(/['"`]([^'"`]+)['"`]/g)) out.push(m[1]);
  }
  return out;
}

const globToRe = (g) =>
  new RegExp(
    '^' +
      g
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*\//g, ' ')
        .replace(/\*/g, '[^/]*')
        .replace(/ /g, '(?:.*/)?') +
      '$',
  );

// ---------------------------------------------------------------------------

// A scan that silently skips is the thing this scan is about. Both ways of
// not being checked are counted and printed.
const selfCheck = [];
const notAnchored = [];
{
  // The exclude reader must see a real one. `apps/omnitron` excludes exactly
  // one file and writes down why; if this stops matching, every deliberate
  // exclusion starts reading as a finding.
  //
  // Two anchors below name files in THIS repository. Under `--root` they may
  // not exist, and an anchor whose subject is absent has not been violated —
  // it has not been evaluated. The first version treated the two the same and
  // exited 2 on a healthy tree, which is the shape this scan exists to catch
  // pointed at itself: a check that cannot run, reported as a verdict.
  if (existsSync(join(ROOT, 'apps/omnitron/vitest.config.ts'))) {
    const omni = excludedBy('apps/omnitron', ['vitest.config.ts']);
    if (!omni.some((g) => g.includes('orchestrator'))) {
      selfCheck.push('the exclude reader no longer sees apps/omnitron’s one written-down exclusion');
    }
  } else {
    notAnchored.push('the exclude reader (no apps/omnitron/vitest.config.ts under this root)');
  }
  // The playwright reader must find a testDir. prism runs its e2e and its
  // accessibility suites from one; if this returns nothing, 56 prism files
  // become orphans at once.
  if (existsSync(join(ROOT, 'packages/prism/playwright.config.ts'))) {
    const got = playwrightCollects('packages/prism', 'playwright.config.ts');
    if (!got || got.length === 0) selfCheck.push('the playwright reader found no tests under prism’s testDir');
  } else {
    notAnchored.push('the playwright reader (no packages/prism/playwright.config.ts under this root)');
  }
  // The glob translation must actually match what it is given. This one needs
  // no repository and so always runs.
  if (!globToRe('test/runtime/**/*.ts').test('test/runtime/a/b.ts') || globToRe('test/*.ts').test('test/a/b.ts')) {
    selfCheck.push('glob translation is wrong in one direction or the other');
  }
}
if (selfCheck.length) {
  console.error(`SELF-CHECK FAILED: ${selfCheck.join('; ')}`);
  process.exit(2);
}
if (notAnchored.length && !JSON_OUT) {
  console.error(
    `note: ${notAnchored.length} self-check(s) had nothing to anchor on here — ${notAnchored.join('; ')}`,
  );
}

const orphans = [];
const excluded = [];
const collectionFailures = [];
const noConfig = [];
let packagesAsked = 0;

for (const [pkg, files] of [...byPackage].sort()) {
  const vitestConfigs = configsIn(pkg, /^vitest.*\.config\.(ts|js|mts|mjs)$/);
  const pwConfigs = configsIn(pkg, /^playwright.*\.config\.(ts|js|mts|mjs)$/);
  if (vitestConfigs.length === 0 && pwConfigs.length === 0) {
    // No config of its own: vitest's default include collects every
    // `*.{test,spec}.*` under the package, so nothing can hide. Counted
    // rather than skipped in silence — if a config appears later with a
    // narrow include, this is where those files stop being collected.
    noConfig.push({ pkg, files: files.length });
    continue;
  }
  packagesAsked++;

  const covered = new Set();
  let anyAnswered = false;
  for (const c of vitestConfigs) {
    const got = vitestCollects(pkg, c);
    if (got === null) continue;
    anyAnswered = true;
    for (const f of got) covered.add(f);
  }
  for (const c of pwConfigs) {
    const got = playwrightCollects(pkg, c);
    if (got === null) continue;
    anyAnswered = true;
    for (const f of got) covered.add(f);
  }

  if (!anyAnswered || (covered.size === 0 && files.length > 0)) {
    collectionFailures.push({
      pkg,
      files: files.length,
      configs: [...vitestConfigs, ...pwConfigs],
    });
    continue;
  }

  const excludes = excludedBy(pkg, vitestConfigs).map(globToRe);
  for (const f of files) {
    if (covered.has(f)) continue;
    const rel = relative(pkg, f);
    if (excludes.some((re) => re.test(rel) || re.test(f))) {
      excluded.push(f);
      continue;
    }
    if (ANSWERED.find((a) => a.match('/' + f))) {
      excluded.push(f);
      continue;
    }
    orphans.push({ pkg, file: f, configs: [...vitestConfigs, ...pwConfigs] });
  }
}

if (JSON_OUT) {
  console.log(JSON.stringify({ orphans, excluded: excluded.length, collectionFailures }, null, 2));
} else {
  console.log(`${tracked.length} tracked test files across ${packagesAsked} packages with a runner config`);
  console.log(`  ${excluded.length} not collected but named by an exclude, or answered — a decision someone made`);
  console.log(`  ${orphans.length} matched by no include anywhere — nobody's decision\n`);

  if (collectionFailures.length) {
    console.log('=== COLLECTION FAILED — the runner did not answer, so this package was NOT checked ===');
    for (const c of collectionFailures) {
      console.log(`  ${c.pkg}  (${c.files} test files, configs: ${c.configs.join(', ')})`);
    }
    console.log('');
  }

  console.log('=== COLLECTED BY NOTHING ===');
  for (const o of orphans) {
    console.log(`  ${o.file}`);
    console.log(`      configs that miss it: ${o.configs.join(', ')}`);
  }
  if (orphans.length === 0) console.log('  (none)');

  if (noConfig.length) {
    const n = noConfig.reduce((a, b) => a + b.files, 0);
    console.log(`\n${n} test file(s) in ${noConfig.length} package(s) with no runner config of their own —`);
    console.log("vitest's default include collects every test file under the package, so none can hide:");
    console.log(`  ${noConfig.map((c) => `${c.pkg} (${c.files})`).join(', ')}`);
  }

  if (unowned.length) {
    console.log(`\n${unowned.length} test file(s) outside any package: ${unowned.join(', ')}`);
  }
}

process.exit(orphans.length > 0 || collectionFailures.length > 0 ? 1 : 0);
