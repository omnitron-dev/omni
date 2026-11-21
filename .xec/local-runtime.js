import fs from 'node:fs/promises';
import path from 'node:path';
import { getExecutionSignal } from '@xec-sh/core';
import { buildInWorkspace, cleanWorkspace, physicalCache, scheduleLocalCleanup, syncDirectory } from './local-runtime-cleanup.js';
import { developmentCacheDirectory } from '../apps/omnitron/bin/sdk-transition.js';
import { locateQualifiedLocalRuntime } from './qualification.mjs';

/** The trusted checkout verifies bytes before any cached interpreter runs. */
export async function verifyLocalRuntime(root, directory, run) {
  return JSON.parse(await run(root, process.execPath, [
    '--conditions=omnitron-source', '--import=tsx/esm', '--input-type=module', '--eval',
    "import { verifyRuntimeArtifact } from '@omnitron-dev/omnitron/runtime-artifact'; process.stdout.write(JSON.stringify(await verifyRuntimeArtifact(process.argv[1])));",
    directory,
  ], { timeoutMs: 120_000 }));
}

/** Prepare one native development runtime per committed revision and producer. */
export async function withLocalRuntime(root, cache, run, progress, use, { deferCleanup = false, schedule = scheduleLocalCleanup } = {}) {
  const { withKernelFileLock } = await import('@xec-sh/ops/utils/file-lock');
  const revision = (await run(root, 'git', ['rev-parse', '--verify', 'HEAD^{commit}'])).trim();
  if (!/^[a-f0-9]{40}$/.test(revision)) throw Error('Cannot identify the local source commit');
  if ((await run(root, 'git', ['status', '--porcelain'])).trim())
    throw Error('Commit the local changes before preparing a runtime from HEAD');
  const base = await physicalCache(developmentCacheDirectory(cache), true);
  const key = [revision, process.platform, process.arch, process.version].join('-');
  const destination = path.join(base, key);
  const dist = path.join(destination, 'packages/0/dist');
  const verify = async (directory, expectedDigest) => {
    const manifest = await verifyLocalRuntime(root, directory, run);
    if (manifest.nodeVersion !== process.version || manifest.platform !== process.platform || manifest.arch !== process.arch)
      throw Error('Cached runtime uses a different native producer');
    if (expectedDigest && manifest.sha256 !== expectedDigest) throw Error('Qualified runtime digest changed');
    for (const subpath of ['dist', 'webapp/dist']) {
      const stamp = JSON.parse(await fs.readFile(path.join(directory, 'packages/0', subpath, 'BUILD.json'), 'utf8'));
      if (stamp.commit !== revision || stamp.dirty !== false) throw Error('Runtime or Console has a different source revision');
    }
  };
  let job, candidate, failure;
  const prepare = () => withKernelFileLock(path.join(base, key + '.lock'), async () => {
    const saved = await fs.lstat(destination).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
    if (saved) {
      if (!saved.isDirectory() || saved.isSymbolicLink()) throw Error('Invalid local runtime cache entry');
      await verify(destination);
      progress('Using local runtime ' + revision);
      return dist;
    }
    const qualified = await locateQualifiedLocalRuntime(root, revision, {
      nodeVersion: process.version, platform: process.platform, arch: process.arch,
    });
    if (qualified) {
      await verify(qualified.directory, qualified.sha256);
      progress('Using qualified local runtime ' + revision);
      return path.join(qualified.directory, 'packages/0/dist');
    }
    await run(root, process.execPath, ['--input-type=module', '--eval',
      "import { assertStandaloneNodeConfiguration } from './apps/omnitron/scripts/standalone-node.js'; assertStandaloneNodeConfiguration(process.config.variables);"]);
    return buildInWorkspace(base, revision, id => { job = id; }, async stage => {
      const source = path.join(stage, 'source'), output = path.join(stage, 'runtime');
      await fs.mkdir(source);
      const env = { ...process.env, OMNITRON_HOME: path.join(stage, 'home'), TZ: 'UTC',
        PATH: path.dirname(process.execPath) + path.delimiter + process.env.PATH,
        TURBO_CACHE_DIR: process.env.TURBO_CACHE_DIR || path.join(base, 'turbo') };
      const command = (exe, args) => run(source, exe, args, { env, timeoutMs: 30 * 60_000 });
      progress('Preparing local runtime ' + revision);
      await command('git', ['init', '--quiet']);
      await command('git', ['fetch', '--quiet', '--no-tags', '--depth=1', '--', root, revision]);
      await command('git', ['checkout', '--quiet', '--detach', revision]);
      progress('Installing locked dependencies');
      await command('pnpm', ['install', '--frozen-lockfile']);
      await command(process.execPath, ['--input-type=module', '--eval',
        "import { assertBuildDependencies } from './.xec/release-policy.mjs'; await assertBuildDependencies(process.cwd());"]);
      progress('Building backend, Console and their dependencies');
      await command('pnpm', ['exec', 'turbo', 'run', 'build',
        '--filter=@omnitron-dev/omnitron', '--filter=@omnitron/console']);
      // Turbo can correctly reuse identical output across source commits. Bind both public entry points to this checkout.
      for (const outputDir of ['apps/omnitron/dist', 'apps/omnitron/webapp/dist'])
        await command(process.execPath, ['apps/omnitron/scripts/stamp-build.mjs', outputDir]);
      if ((await command('git', ['status', '--porcelain'])).trim()) throw Error('Local build changed its source checkout');
      progress('Sealing native runtime');
      await command(process.execPath, ['apps/omnitron/scripts/freeze-backend.mjs', 'apps/omnitron', output]);
      await verify(output);
      await fs.rename(output, destination);
      await syncDirectory(base);
      return dist;
    }, progress);
  });

  const signal = getExecutionSignal() ?? new AbortController().signal;
  try { candidate = await prepare(); }
  catch (error) { failure = error; }
  if (deferCleanup) {
    if (job) progress('Build workspace ' + job + ' is registered for cleanup in ' + base + '. Inspect it with xec update local-cleanup --status using the same cache.');
    try { await schedule(base, job); }
    catch (error) { progress('Workspace cleanup was not scheduled: ' + error.message + '. Retry with xec update local-cleanup using the same cache.'); }
  } else if (job) {
    const cleanup = await cleanWorkspace(base, job, run, 360, signal);
    if (cleanup?.state !== 'cleaned') {
      const cause = Error(cleanup?.error ?? 'Workspace cleanup is unconfirmed');
      if (failure) throw new AggregateError([failure, cause], 'Local build and workspace cleanup failed');
      throw cause;
    }
  }
  if (failure) throw failure;
  signal?.throwIfAborted();
  const result = await use(candidate, signal);
  signal?.throwIfAborted();
  return result;
}
