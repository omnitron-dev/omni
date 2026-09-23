#!/usr/bin/env node
/**
 * Write what a build was built from into the build: `<dir>/BUILD.json`.
 *
 * A daemon runs `dist`, and nothing in `dist` said which commit it was
 * compiled from. The master reported `Version: 0.2.0` whatever it ran, and a
 * node bundle took its version from the working tree's HEAD while copying
 * whatever `dist` and `webapp/dist` happened to be on disk — measured
 * 2026-09-23: a node installed as `0.2.0+local.f1715106…` received a console
 * build older than f1715106, the very commit its version named.
 *
 * The build now says it itself, at the moment it is made; readers compare
 * that, not the tree.
 *
 * Usage:
 *   node scripts/stamp-build.mjs <dir>                   stamp from the repository around <dir>
 *   node scripts/stamp-build.mjs <dir> --commit <sha>     stamp a build made from an exported commit (no .git)
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const [dir, flag, value] = process.argv.slice(2);
if (!dir || (flag !== undefined && (flag !== '--commit' || !value))) {
  process.stderr.write('usage: stamp-build.mjs <dir> [--commit <sha>]\n');
  process.exit(2);
}
if (!existsSync(dir)) {
  process.stderr.write(`stamp-build: ${dir} does not exist — nothing was built to stamp\n`);
  process.exit(1);
}

let commit;
let dirty;
if (flag === '--commit') {
  // An export of one commit: clean by construction.
  commit = value;
  dirty = false;
} else {
  const cwd = path.resolve(dir);
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  try {
    commit = git('rev-parse', 'HEAD');
    // The whole repository, as the bundle builder reads it: a change in a
    // package this app compiles against is as much a change as one in `src`.
    dirty = git('status', '--porcelain').length > 0;
  } catch {
    process.stderr.write(`stamp-build: ${dir} is not inside a git repository — the build is left unstamped\n`);
    process.exit(1);
  }
}

const stamp = { commit, dirty, builtAt: new Date().toISOString() };
writeFileSync(path.join(dir, 'BUILD.json'), `${JSON.stringify(stamp, null, 2)}\n`);
process.stdout.write(`stamp-build: ${dir} — ${commit.slice(0, 12)}${dirty ? ' (dirty tree)' : ''}\n`);
