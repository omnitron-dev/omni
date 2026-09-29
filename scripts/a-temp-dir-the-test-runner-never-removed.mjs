#!/usr/bin/env node
/**
 * A temp dir the test runner never removed.
 *
 * vitest 5.0.0 copies every module it transforms for the forks pool into
 * `$TMPDIR/<nanoid>/<environment>/<sha1>`. A project removes its directory in
 * `clearTmpDir()`. But the default project, the only one a config without
 * `projects` has, is made by `TestProject._createBasicProject`, which hands it
 * the core's fetcher: the copies go under the CORE's `_tmpDir`, while the
 * project's `clearTmpDir()` removes a `tmpDir` of its own that nothing ever
 * wrote to. Nothing removed the core's. Every run, graceful or not, left one
 * directory behind.
 *
 * TMPDIR on the development Mac is `~/.tmp`, which nothing cleans. Measured
 * 2026-09-29: 16 443 such directories, 112 GB, from 2026-09-11 on — every
 * suite, every scanner that starts vitest, every release gate. The disk reached
 * 99 % and the Docker engine stopped with every database in it. A graceful
 * one-file run with TMPDIR of its own left `hqLP_2YcZs8cypI1cXdwO/ssr`.
 * vitest 5.0.2, the latest then, has the same code.
 *
 * `patches/vitest@5.0.0.patch` removes `_tmpDir` at the very end of
 * `Vitest.close()`, when the pool, every project and every server are closed.
 *
 * This check runs this repository's own vitest on a one-test project it writes
 * into a fresh TMPDIR, and asks two things:
 *   - DURING the run a copies directory existed: the test looks for itself.
 *     Without this half the check would pass on a vitest that copied nothing,
 *     which is the same verdict as one that cleaned up;
 *   - AFTER the run none is left.
 * It removes everything it made however it ends.
 *
 * Exit 0 when both hold; 1 with what was found; 2 when it could not ask.
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The packages whose tests this repository runs, in the order asked. */
const RUNNERS = ['packages/testing', 'packages/titan', 'apps/omnitron'];

/** A copies directory: `nanoid()`'s 21 characters. */
const COPIES = /^[A-Za-z0-9_-]{21}$/;

function vitestOf(pkg) {
  try {
    const manifest = createRequire(join(ROOT, pkg, 'package.json')).resolve('vitest/package.json');
    const bin = join(dirname(manifest), 'vitest.mjs');
    return existsSync(bin) ? { pkg, bin, version: JSON.parse(readFileSync(manifest, 'utf8')).version } : null;
  } catch {
    return null;
  }
}

/**
 * The verdict as an exit code. The caller sets `process.exitCode` and lets the
 * process end by running out of work: `process.exit` disposes the platform
 * without draining it, and under load it deadlocks against a V8 worker that
 * waits for a collection (daos `scripts/a-scan-that-hung-on-its-way-out.mjs`).
 */
function main() {
  const vitest = RUNNERS.map(vitestOf).find(Boolean);
  if (!vitest) {
    console.error(`could not ask: no vitest resolves from ${RUNNERS.join(', ')} — install first`);
    return 2;
  }

  const base = mkdtempSync(join(tmpdir(), 'a-temp-dir-court-'));
  let code = 2;
  try {
    const tmp = join(base, 'tmp');
    const project = join(base, 'project');
    mkdirSync(tmp);
    mkdirSync(project);
    // A module to transform besides the test file, and a test that records what
    // TMPDIR held while it ran. `globals` so nothing here has to resolve vitest.
    writeFileSync(join(project, 'two.mjs'), 'export const two = () => 2;\n');
    writeFileSync(
      join(project, 'sample.test.mjs'),
      [
        "import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';",
        "import { join } from 'node:path';",
        "import { two } from './two.mjs';",
        "test('the copies exist while the run lives', () => {",
        '  const tmp = process.env.TMPDIR;',
        "  const copies = readdirSync(tmp).filter((n) => /^[A-Za-z0-9_-]{21}$/.test(n) && statSync(join(tmp, n)).isDirectory());",
        "  writeFileSync(new URL('./seen.json', import.meta.url), JSON.stringify({ copies }));",
        '  expect(two()).toBe(2);',
        '});',
        '',
      ].join('\n'),
    );
    writeFileSync(
      join(project, 'vitest.config.mjs'),
      "export default { test: { include: ['sample.test.mjs'], globals: true, pool: 'forks', watch: false } };\n",
    );

    const run = spawnSync(process.execPath, [vitest.bin, 'run', '--root', project], {
      cwd: project,
      env: { ...process.env, TMPDIR: tmp, CI: '1', NO_COLOR: '1' },
      encoding: 'utf8',
      timeout: 150_000,
    });
    const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
    const seenFile = join(project, 'seen.json');
    const during = existsSync(seenFile) ? JSON.parse(readFileSync(seenFile, 'utf8')).copies : null;
    const after = readdirSync(tmp).filter((n) => COPIES.test(n));

    if (run.status !== 0 || !/1 passed/.test(output) || during === null) {
      console.error(`could not ask: vitest ${vitest.version} (from ${vitest.pkg}) exited ${run.status ?? run.signal} without running the one test`);
      console.error(output.split('\n').slice(-15).join('\n'));
      code = 2;
    } else if (during.length === 0) {
      console.error(`vitest ${vitest.version} made no copies during the run — this check measures nothing on it; rewrite it for the runner in use`);
      code = 1;
    } else if (after.length > 0) {
      console.error(
        `vitest ${vitest.version} (from ${vitest.pkg}) left ${after.length} copies director${after.length === 1 ? 'y' : 'ies'} in TMPDIR: ${after.join(', ')}.\n` +
          '  Each run of every suite leaves one. Is patches/vitest@5.0.0.patch applied (pnpm install), or did vitest change version?',
      );
      code = 1;
    } else {
      console.log(`vitest ${vitest.version} (from ${vitest.pkg}): ${during.length} copies director${during.length === 1 ? 'y' : 'ies'} during the run, none after`);
      code = 0;
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
  return code;
}

process.exitCode = main();
