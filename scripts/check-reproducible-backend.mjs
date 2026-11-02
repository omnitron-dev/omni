import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
if (args.length !== 0 && (args.length !== 2 || args[0] !== '--out' || !args[1]))
  throw Error('Usage: node scripts/check-reproducible-backend.mjs [--out <new-directory>]');
const destination = args.length ? path.resolve(args[1]) : null;
if (destination) {
  try { await fs.lstat(destination); throw Error('Qualification destination already exists'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const source = fileURLToPath(new URL('../', import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd: source, encoding: 'utf8' }).trim();
const revision = git('rev-parse', 'HEAD');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'omnitron-reproduce-'));
const env = { ...process.env, TZ: 'UTC', SOURCE_DATE_EPOCH: git('show', '-s', '--format=%ct', revision),
  npm_config_side_effects_cache: 'false', TURBO_TELEMETRY_DISABLED: '1' };
delete env.TURBO_TOKEN;
delete env.TURBO_TEAM;
async function build(round, retained) {
  const cwd = path.join(root, round);
  const output = retained ?? path.join(root, round + '-runtime');
  execFileSync('git', ['clone', '--quiet', '--no-checkout', '--local', source, cwd]);
  const buildEnv = { ...env, OMNITRON_HOME: path.join(root, round + '-home') };
  const run = (command, args) => execFileSync(command, args, { cwd, env: buildEnv, stdio: 'inherit' });
  run('git', ['checkout', '--quiet', '--detach', revision]);
  run('pnpm', ['install', '--frozen-lockfile']);
  run('pnpm', ['exec', 'turbo', 'run', 'build', '--force', '--concurrency=3']);
  run(process.execPath, ['apps/omnitron/scripts/freeze-backend.mjs', 'apps/omnitron', output]);
  const read = async filename => JSON.parse(await fs.readFile(path.join(output, filename), 'utf8'));
  const stamp = await read('packages/0/dist/BUILD.json');
  assert.equal(stamp.commit, revision);
  assert.equal(stamp.dirty, false, 'The build observed an uncommitted input');
  const runtime = await read('RUNTIME.json');
  const ui = await read('packages/0/webapp/dist/console-version.json');
  const result = { sha256: runtime.sha256, packages: runtime.packages, console: ui.version };
  // Only the measurements are needed for the comparison. Free the checkout and
  // frozen runtime before installing the second independent dependency tree.
  await fs.rm(cwd, { recursive: true });
  if (!retained) await fs.rm(output, { recursive: true });
  return result;
}
let staging;
try {
  const first = await build('first');
  // Stage the second verified tree on the requested filesystem. The caller
  // can import <destination>/runtime only after both measurements agree.
  if (destination) staging = await fs.mkdtemp(path.join(path.dirname(destination), '.omnitron-qualification-'));
  const retained = staging && path.join(staging, 'runtime');
  const second = await build('second', retained);
  assert.deepEqual(second, first, 'Independent backend or Console outputs differ');
  if (destination) {
    await fs.mkdir(destination, { mode: 0o700 }); // Exclusive even if a concurrent run won the race.
    try { await fs.rename(retained, path.join(destination, 'runtime')); }
    catch (error) { await fs.rmdir(destination); throw error; }
  }
  console.log(JSON.stringify({ revision, node: process.version, ...first, ...(destination && { runtime: path.join(destination, 'runtime') }) }));
} finally {
  if (staging) await fs.rm(staging, { recursive: true, force: true });
  await fs.rm(root, { recursive: true, force: true });
}
