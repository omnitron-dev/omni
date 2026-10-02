#!/usr/bin/env node
/**
 * A temp dir the test runner never removed.
 *
 * vitest copies every module it transforms for the forks pool into
 * `$TMPDIR/<dir>/<environment>/<sha1>`. TMPDIR on the development Mac is
 * `~/.tmp`, which nothing cleans. Measured 2026-09-29: 16 443 such
 * directories, 112 GB, from 2026-09-11 on — every suite, every scanner that
 * starts vitest, every release gate. The disk reached 99 % and the Docker
 * engine stopped with every database in it.
 *
 * Two ways a run left its copies behind:
 *   - A run that CLOSED. vitest 5.0.0 never removed the core's `_tmpDir`, where
 *     the default project's copies go. Patched here on 2026-09-29; fixed
 *     upstream in 5.0.3 (vitest-dev/vitest#11248), so that patch is gone.
 *   - A run that did NOT close. SIGINT and SIGTERM end vitest from the logger's
 *     handler with `process.exit()`, past `close()`; SIGKILL, a crash or a lost
 *     terminal run no code at all. 5.0.3 leaves one directory for each, measured
 *     on this fixture: SIGINT 1, SIGTERM 1, SIGKILL 1. `patches/vitest@5.0.3.patch`
 *     names the directory after the process that owns it
 *     (`vitest-<pid>-<nanoid>`), removes the process's own directories
 *     synchronously in that handler, and on every start removes those whose
 *     owner is no longer alive. Liveness, not age: a live run is never touched.
 *
 * This check runs this repository's own vitest on a project it writes into a
 * fresh TMPDIR, one run per way of ending, and asks:
 *   - passed: DURING the run a copies directory existed (the test looks for
 *     itself — without this half the check would pass on a vitest that copied
 *     nothing), and TMPDIR is empty after;
 *   - failed (a red test, exit 1): TMPDIR is empty after;
 *   - SIGINT, SIGTERM (sent to vitest itself once its copies exist): empty after;
 *   - SIGKILL: what it left names the killed process, and the next run in the
 *     same TMPDIR leaves it empty.
 * It removes everything it made however it ends.
 *
 * Exit 0 when all hold; 1 with what was found; 2 when it could not ask.
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The packages whose tests this repository runs, in the order asked. */
const RUNNERS = ['packages/testing', 'packages/titan', 'apps/omnitron'];

/** How long one run may take before the check gives up on asking. */
const RUN_MS = 60_000;

function vitestOf(pkg) {
  try {
    const manifest = createRequire(join(ROOT, pkg, 'package.json')).resolve('vitest/package.json');
    const bin = join(dirname(manifest), 'vitest.mjs');
    return existsSync(bin) ? { pkg, bin, version: JSON.parse(readFileSync(manifest, 'utf8')).version } : null;
  } catch {
    return null;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** What TMPDIR holds: every entry, each directory with its children. */
function contents(tmp) {
  return readdirSync(tmp, { withFileTypes: true }).map((e) =>
    e.isDirectory() ? `${e.name}/{${readdirSync(join(tmp, e.name)).join(',')}}` : e.name,
  );
}

/** A copies directory that already holds a copy: the run is past its first transform. */
function hasCopies(tmp) {
  return readdirSync(tmp, { withFileTypes: true }).some(
    (e) =>
      e.isDirectory() &&
      readdirSync(join(tmp, e.name), { withFileTypes: true }).some(
        (env) => env.isDirectory() && readdirSync(join(tmp, e.name, env.name)).length > 0,
      ),
  );
}

/**
 * One run of vitest on `project` with TMPDIR `tmp`. With `signal`, the signal
 * is sent to vitest itself (not its workers) once its copies exist.
 */
async function run(vitest, project, tmp, signal) {
  const child = spawn(process.execPath, [vitest.bin, 'run', '--root', project], {
    cwd: project,
    env: { ...process.env, TMPDIR: tmp, CI: '1', NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (b) => (output += b));
  child.stderr.on('data', (b) => (output += b));
  const exited = new Promise((r) => child.on('close', (code, sig) => r(code ?? sig)));
  const deadline = setTimeout(() => child.kill('SIGKILL'), RUN_MS);
  let signalled = false;
  if (signal) {
    const t0 = Date.now();
    while (Date.now() - t0 < RUN_MS && child.exitCode === null && !hasCopies(tmp)) await sleep(50);
    if (child.exitCode === null && hasCopies(tmp)) {
      child.kill(signal);
      signalled = true;
    }
  }
  const exit = await exited;
  clearTimeout(deadline);
  return { exit, output, pid: child.pid, signalled };
}

/** The test file: `mode` passed, failed, or blocked until its vitest is gone. */
function writeTest(project, mode) {
  const body = {
    passed: [
      "  const tmp = process.env.TMPDIR;",
      "  const copies = readdirSync(tmp).filter((n) => statSync(join(tmp, n)).isDirectory());",
      "  writeFileSync(new URL('./seen.json', import.meta.url), JSON.stringify({ copies }));",
      '  expect(two()).toBe(2);',
    ],
    failed: ['  expect(two()).toBe(3);'],
    // Blocks until the vitest that started this worker is gone, so a killed run
    // leaves no worker of its own behind; capped in case it never goes.
    blocked: [
      '  const parent = process.ppid;',
      '  const t0 = Date.now();',
      '  while (process.ppid === parent && Date.now() - t0 < 50_000) await new Promise((r) => setTimeout(r, 50));',
      '  expect(two()).toBe(2);',
    ],
  }[mode];
  writeFileSync(
    join(project, 'sample.test.mjs'),
    [
      "import { readdirSync, statSync, writeFileSync } from 'node:fs';",
      "import { join } from 'node:path';",
      "import { two } from './two.mjs';",
      "test('the copies of this run', async () => {",
      ...body,
      '}, 60_000);',
      '',
    ].join('\n'),
  );
}

async function main() {
  const vitest = RUNNERS.map(vitestOf).find(Boolean);
  if (!vitest) {
    console.error(`could not ask: no vitest resolves from ${RUNNERS.join(', ')} — install first`);
    return 2;
  }
  const of = `vitest ${vitest.version} (from ${vitest.pkg})`;

  const base = mkdtempSync(join(tmpdir(), 'a-temp-dir-court-'));
  try {
    const found = [];
    const asked = [];
    const fresh = (name) => {
      const tmp = join(base, name, 'tmp');
      const project = join(base, name, 'project');
      mkdirSync(tmp, { recursive: true });
      mkdirSync(project, { recursive: true });
      // A module to transform besides the test file. `globals` so nothing here
      // has to resolve vitest.
      writeFileSync(join(project, 'two.mjs'), 'export const two = () => 2;\n');
      writeFileSync(
        join(project, 'vitest.config.mjs'),
        "export default { test: { include: ['sample.test.mjs'], globals: true, pool: 'forks', watch: false } };\n",
      );
      return { tmp, project };
    };
    const couldNot = (what, r) => {
      console.error(`could not ask: ${of}, ${what}: exited ${r.exit}`);
      console.error(r.output.split('\n').slice(-15).join('\n'));
      return 2;
    };

    // passed
    {
      const { tmp, project } = fresh('passed');
      writeTest(project, 'passed');
      const r = await run(vitest, project, tmp);
      const seen = join(project, 'seen.json');
      const during = existsSync(seen) ? JSON.parse(readFileSync(seen, 'utf8')).copies : null;
      if (r.exit !== 0 || !/1 passed/.test(r.output) || during === null) return couldNot('a passing run', r);
      if (during.length === 0) {
        console.error(`${of} made no copies during the run — this check measures nothing on it; rewrite it for the runner in use`);
        return 1;
      }
      const after = contents(tmp);
      if (after.length > 0) found.push(`a passing run left ${after.join(', ')}`);
      asked.push(`passed: ${during.length} during, ${after.length} after`);
    }

    // failed
    {
      const { tmp, project } = fresh('failed');
      writeTest(project, 'failed');
      const r = await run(vitest, project, tmp);
      if (r.exit !== 1 || !/1 failed/.test(r.output)) return couldNot('a failing run', r);
      const after = contents(tmp);
      if (after.length > 0) found.push(`a failing run left ${after.join(', ')}`);
      asked.push(`failed: ${after.length} after`);
    }

    // SIGINT, SIGTERM
    for (const signal of ['SIGINT', 'SIGTERM']) {
      const { tmp, project } = fresh(signal);
      writeTest(project, 'blocked');
      const r = await run(vitest, project, tmp, signal);
      if (!r.signalled) return couldNot(`a run to send ${signal} to (no copies appeared)`, r);
      await sleep(300);
      const after = contents(tmp);
      if (after.length > 0) found.push(`a run ended by ${signal} left ${after.join(', ')}`);
      asked.push(`${signal}: ${after.length} after`);
    }

    // SIGKILL, then the next run in the same TMPDIR
    {
      const { tmp, project } = fresh('SIGKILL');
      writeTest(project, 'blocked');
      const r = await run(vitest, project, tmp, 'SIGKILL');
      if (!r.signalled) return couldNot('a run to send SIGKILL to (no copies appeared)', r);
      const left = contents(tmp);
      const owned = readdirSync(tmp).filter((n) => n.startsWith(`vitest-${r.pid}-`));
      if (owned.length === 0) {
        found.push(
          `a killed run left ${left.join(', ') || 'nothing'}, none of it named after the killed process (${r.pid}): ` +
            'the next run cannot tell it from the copies of a live one',
        );
      }
      writeTest(project, 'passed');
      const next = await run(vitest, project, tmp);
      if (next.exit !== 0) return couldNot('the run after a killed one', next);
      const after = contents(tmp);
      if (after.length > 0) found.push(`the run after a killed one left ${after.join(', ')}`);
      asked.push(`SIGKILL: ${left.length} left by the killed run, ${after.length} after the next`);
    }

    if (found.length > 0) {
      console.error(`${of} left its module copies in TMPDIR:`);
      for (const f of found) console.error(`  - ${f}`);
      console.error('  Is patches/vitest@<version>.patch applied (pnpm install), or did vitest change version?');
      return 1;
    }
    console.log(`${of}: ${asked.join('; ')}`);
    return 0;
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

/**
 * The verdict as an exit code. The process ends by running out of work:
 * `process.exit` disposes the platform without draining it, and under load it
 * deadlocks against a V8 worker that waits for a collection (a scan that hung
 * on its way out, 2026-09-23).
 */
process.exitCode = await main();
