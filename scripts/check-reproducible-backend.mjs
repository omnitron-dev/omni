import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { out: { type: 'string' }, revision: { type: 'string' } } });
if (values.revision && !/^[a-f0-9]{40}$/.test(values.revision)) throw Error('--revision requires a full Git commit');
const destination = values.out ? path.resolve(values.out) : null;
if (destination) {
  try { await fs.lstat(destination); throw Error('Qualification destination already exists'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const source = fileURLToPath(new URL('../', import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd: source, encoding: 'utf8' }).trim();
const revision = git('rev-parse', '--verify', `${values.revision ?? 'HEAD'}^{commit}`);
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'omnitron-reproduce-'));
const env = { ...process.env, TZ: 'UTC', SOURCE_DATE_EPOCH: git('show', '-s', '--format=%ct', revision),
  npm_config_side_effects_cache: 'false', TURBO_TELEMETRY_DISABLED: '1', TURBO_FORCE: 'true', TURBO_CONCURRENCY: '3' };
delete env.TURBO_TOKEN;
delete env.TURBO_TEAM;

/** Export only from the independent checkout, never from served Console output. */
async function packSdk(cwd, output, buildEnv) {
  const load = file => import(pathToFileURL(path.join(cwd, 'apps/omnitron/dist', file)).href);
  const { normalizePackedWorkspace } = await load('release/portable-archive.js');
  const { inspectFrameworkArchive } = await load('release/registry-framework.js');
  const { readWorkspace, directoryOf } = await load('services/bundle-builder.js');
  const packages = [...readWorkspace(cwd).values()]
    .filter(pkg => !pkg.private && pkg.name.startsWith('@omnitron-dev/'))
    .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  assert.ok(packages.some(pkg => pkg.name === '@omnitron-dev/omnitron'));
  await fs.mkdir(output, { mode: 0o700 });
  const records = [];
  let files = 0;
  for (const pkg of packages) {
    const archive = path.join(output, 'workspace.tgz');
    execFileSync('pnpm', ['pack', '--out', archive], {
      cwd: directoryOf(pkg), env: buildEnv, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    });
    await normalizePackedWorkspace(archive);
    const bytes = await fs.readFile(archive);
    const metadata = JSON.parse(execFileSync('tar', ['-xOf', archive, 'package/package.json'], {
      encoding: 'utf8', maxBuffer: 1024 * 1024,
    }));
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64');
    const inspected = await inspectFrameworkArchive({ name: pkg.name, version: pkg.version, integrity },
      createReadStream(archive), undefined, revision);
    files += inspected.files.size;
    const filename = `${pkg.name.slice(1).replace('/', '-')}-${pkg.version}-${sha256.slice(0, 12)}.tgz`;
    await fs.rename(archive, path.join(output, filename));
    records.push({ name: pkg.name, version: pkg.version, filename, sha256, integrity,
      sourceRevision: revision, sourceDirty: false, dependencies: metadata.dependencies ?? {},
      optionalDependencies: metadata.optionalDependencies ?? {}, peerDependencies: metadata.peerDependencies ?? {} });
  }
  const manifest = JSON.stringify(records, null, 2) + '\n';
  await fs.writeFile(path.join(output, 'framework-manifest.json'), manifest, { flag: 'wx' });
  return { packages: records.length, files, manifestSha256: createHash('sha256').update(manifest).digest('hex') };
}

async function build(round, retained, retainedSdk) {
  const cwd = path.join(root, round);
  const output = retained ?? path.join(root, round + '-runtime');
  const sdkOutput = retainedSdk ?? path.join(root, round + '-sdk');
  await fs.mkdir(cwd);
  const buildEnv = { ...env, OMNITRON_HOME: path.join(root, round + '-home') };
  const run = (command, args) => execFileSync(command, args, { cwd, env: buildEnv, stdio: 'inherit' });
  run('git', ['init', '--quiet']);
  run('git', ['fetch', '--quiet', '--depth=1', '--no-tags', '--', source, revision]);
  run('git', ['checkout', '--quiet', '--detach', revision]);
  run('pnpm', ['install', '--frozen-lockfile']);
  run('pnpm', ['run', 'build']);
  run(process.execPath, ['apps/omnitron/scripts/freeze-backend.mjs', 'apps/omnitron', output]);
  const read = async filename => JSON.parse(await fs.readFile(path.join(output, filename), 'utf8'));
  const stamp = await read('packages/0/dist/BUILD.json');
  assert.equal(stamp.commit, revision);
  assert.equal(stamp.dirty, false, 'The build observed an uncommitted input');
  const runtime = await read('RUNTIME.json');
  const ui = await read('packages/0/webapp/dist/console-version.json');
  const sdk = await packSdk(cwd, sdkOutput, buildEnv);
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' }).trim(), '',
    'The independent checkout changed during build or packing');
  const result = { sha256: runtime.sha256, packages: runtime.packages, console: ui.version, sdk };
  // Only the measurements are needed for the comparison. Free the checkout and
  // frozen runtime before installing the second independent dependency tree.
  await fs.rm(cwd, { recursive: true });
  if (!retained) await fs.rm(output, { recursive: true });
  if (!retainedSdk) await fs.rm(sdkOutput, { recursive: true });
  return result;
}
let staging;
try {
  const first = await build('first');
  // Stage the second verified tree on the requested filesystem. The caller
  // can import <destination>/runtime only after both measurements agree.
  if (destination) staging = await fs.mkdtemp(path.join(path.dirname(destination), '.omnitron-qualification-'));
  const retained = staging && path.join(staging, 'runtime');
  const retainedSdk = staging && path.join(staging, 'sdk');
  const second = await build('second', retained, retainedSdk);
  assert.deepEqual(second, first, 'Independent backend, Console or normalized npm archives differ');
  if (destination) {
    await fs.mkdir(destination, { mode: 0o700 }); // Exclusive even if a concurrent run won the race.
    await fs.rename(retained, path.join(destination, 'runtime'));
    await fs.rename(retainedSdk, path.join(destination, 'sdk'));
    // This receipt is the completion marker; a partially moved directory is
    // never a qualified export and remains available for failure diagnosis.
    await fs.writeFile(path.join(destination, 'QUALIFICATION.json'), JSON.stringify({
      revision, node: process.version, independentBuilds: 2, ...second,
    }, null, 2) + '\n', { flag: 'wx' });
  }
  console.log(JSON.stringify({ revision, node: process.version, ...first,
    ...(destination && { runtime: path.join(destination, 'runtime'), sdkDirectory: path.join(destination, 'sdk') }) }));
} finally {
  if (staging) await fs.rm(staging, { recursive: true, force: true });
  await fs.rm(root, { recursive: true, force: true });
}
