import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../', import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd: source, encoding: 'utf8' }).trim();
const revision = git('rev-parse', 'HEAD');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'omnitron-reproduce-'));
const env = { ...process.env, TZ: 'UTC', SOURCE_DATE_EPOCH: git('show', '-s', '--format=%ct', revision),
  npm_config_side_effects_cache: 'false', TURBO_TELEMETRY_DISABLED: '1' };
delete env.TURBO_TOKEN;
delete env.TURBO_TEAM;
async function build(round) {
  const cwd = path.join(root, round);
  const output = path.join(root, round + '-runtime');
  execFileSync('git', ['clone', '--quiet', '--no-checkout', '--local', source, cwd]);
  const run = (command, args) => execFileSync(command, args, { cwd, env, stdio: 'inherit' });
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
  return { sha256: runtime.sha256, packages: runtime.packages, console: ui.version };
}
try {
  const first = await build('first'), second = await build('second');
  assert.deepEqual(second, first, 'Independent backend or Console outputs differ');
  console.log(JSON.stringify({ revision, node: process.version, ...first }));
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
