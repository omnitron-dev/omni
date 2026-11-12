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
 *     and wrote down that it should not run. Reported as a count, independently
 *     of which tests a particular package currently excludes.
 *   - a file matched by no include anywhere is NOBODY'S decision. It is the
 *     product of a directory named `test` next to one named `tests`, or a
 *     rename, or a file dropped a level too high. That is the finding.
 *
 * Coverage is asked of the runners themselves — `vitest list` per config and
 * `playwright test --list` for configs and direct package scripts — rather than re-implementing their glob
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
import { createRequire } from 'node:module';
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

/** Direct argv commands only: shell programs are not safe collection requests. */
function playwrightCommands(pkg, configs) {
  const commands = configs.map(config => ({ label: config, args: ['--config', config] }));
  const manifest = JSON.parse(readFileSync(join(ROOT, pkg, 'package.json'), 'utf8'));
  for (const [name, command] of Object.entries(manifest.scripts ?? {})) {
    if (typeof command !== 'string' || !/\bplaywright\s+test(?:\s|$)/.test(command)) continue;
    const label = `package.json#scripts.${name}`;
    if (!/^\s*playwright\s+test(?:\s|$)/.test(command) || /[;&|$<>`'"~*?\[\]{}\\\r\n]/.test(command)) {
      commands.push({ label, error: 'Use a direct Playwright command for collection; shell syntax is unsupported' });
      continue;
    }
    const args = command.trim().split(/\s+/).slice(2);
    // Interactive variants do not define another collection surface.
    if (args.some(arg => /^--(?:ui|debug)(?:=|$)/.test(arg))) continue;
    commands.push({ label, args });
  }
  return commands;
}

/** --list imports declarations but starts neither tests nor browser fixtures. */
function playwrightCollects(pkg, command) {
  if (command.error) return { error: command.error };
  try {
    const cwd = join(ROOT, pkg);
    const cli = createRequire(join(cwd, 'package.json')).resolve('@playwright/test/cli');
    const out = execFileSync(process.execPath, [cli, 'test', ...command.args, '--list', '--reporter=json'], {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 300_000, maxBuffer: 16 * 1024 * 1024,
    });
    const report = JSON.parse(out);
    if (!Array.isArray(report.suites) || report.errors?.length) throw new Error('Playwright did not return a successful collection');
    const files = new Set();
    const visit = suites => {
      for (const suite of suites) {
        for (const spec of suite.specs ?? []) {
          if (typeof spec.file !== 'string') throw new Error('Playwright returned a test without a source file');
          files.add(relative(ROOT, resolve(report.config.rootDir, spec.file)));
        }
        visit(suite.suites ?? []);
      }
    };
    visit(report.suites);
    return { files: [...files] };
  } catch (error) {
    return { error: String(error.stderr || error.message).trim().slice(0, 1000) };
  }
}

/** Paths a config names in `exclude` — a decision, read through the stripper. */
function excludedPatterns(source) {
  const blocks = stripComments(source).match(/exclude\s*:\s*\[([\s\S]*?)\]/g) ?? [];
  return blocks.flatMap(block => [...block.matchAll(/['"`]([^'"`]+)['"`]/g)].map(match => match[1]));
}

function excludedBy(pkg, configs) {
  return configs.flatMap(config => excludedPatterns(readFileSync(join(ROOT, pkg, config), 'utf8')));
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
{
  // Exercise the parser independently of a package's changing test inventory.
  // Removing an obsolete exclusion must improve coverage, not fail this scan.
  const excludeFixture = `
    // exclude: ['commented.test.ts'],
    test: { exclude: ['test/runtime/**', "test/integration/manual.spec.ts"] },
    /* exclude: ['also-commented.test.ts'] */
    coverage: { exclude: [\`src/generated/**\`] }
  `;
  const expected = ['test/runtime/**', 'test/integration/manual.spec.ts', 'src/generated/**'];
  if (JSON.stringify(excludedPatterns(excludeFixture)) !== JSON.stringify(expected)
    || excludedPatterns('test: { include: ["test/**/*.ts"], exclude: [] }').length !== 0) {
    selfCheck.push('the exclude reader confuses active, commented or empty exclusions');
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

const orphans = [];
const excluded = [];
const collectionFailures = [];
const noConfig = [];
let packagesAsked = 0;

for (const [pkg, files] of [...byPackage].sort()) {
  const vitestConfigs = configsIn(pkg, /^vitest.*\.config\.(ts|js|mts|mjs)$/);
  const pwConfigs = configsIn(pkg, /^playwright.*\.config\.(ts|js|mts|mjs)$/);
  const pwCommands = playwrightCommands(pkg, pwConfigs);
  const runnerNames = [...vitestConfigs, ...pwCommands.map(command => command.label)];
  if (runnerNames.length === 0) {
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
  let playwrightFailed = false;
  for (const command of pwCommands) {
    const got = playwrightCollects(pkg, command);
    if (got.error) {
      playwrightFailed = true;
      collectionFailures.push({ pkg, files: files.length, configs: [command.label], error: got.error });
      continue;
    }
    anyAnswered = true;
    for (const f of got.files) covered.add(f);
  }

  if (!anyAnswered || (covered.size === 0 && files.length > 0)) {
    if (!playwrightFailed) collectionFailures.push({ pkg, files: files.length, configs: runnerNames });
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
    orphans.push({ pkg, file: f, configs: runnerNames });
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
      if (c.error) console.log(`    ${c.error.replace(/\n/g, '\n    ')}`);
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
