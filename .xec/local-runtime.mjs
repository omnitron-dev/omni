import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { withKernelFileLock } from '../apps/omnitron/src/shared/kernel-file-lock.ts';
import { verifyRuntimeArtifact } from '../apps/omnitron/src/shared/runtime-artifact.ts';
import { assertStandaloneNodeConfiguration } from '../apps/omnitron/scripts/standalone-node.js';

/** Prepare one native development runtime per committed revision and producer. */
export async function localRuntime(root, cache, run, progress) {
  assertStandaloneNodeConfiguration(process.config.variables);
  const revision = (await run(root, 'git', ['rev-parse', '--verify', 'HEAD^{commit}'])).trim();
  if (!/^[a-f0-9]{40}$/.test(revision)) throw Error('Cannot identify the local source commit');
  if ((await run(root, 'git', ['status', '--porcelain'])).trim())
    throw Error('Commit the local changes before preparing a runtime from HEAD');
  const base = path.resolve(cache ?? path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'omnitron', 'development'));
  await fs.mkdir(base, { recursive: true, mode: 0o700 });
  const key = [revision, process.platform, process.arch, process.version].join('-');
  const destination = path.join(base, key);
  const dist = path.join(destination, 'packages/0/dist');
  const verify = async directory => {
    const manifest = await verifyRuntimeArtifact(directory);
    if (manifest.nodeVersion !== process.version) throw Error('Cached runtime uses a different Node producer');
    for (const subpath of ['dist', 'webapp/dist']) {
      const stamp = JSON.parse(await fs.readFile(path.join(directory, 'packages/0', subpath, 'BUILD.json'), 'utf8'));
      if (stamp.commit !== revision || stamp.dirty !== false) throw Error('Runtime or Console has a different source revision');
    }
  };
  return withKernelFileLock(path.join(base, key + '.lock'), async () => {
    const saved = await fs.lstat(destination).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
    if (saved) {
      if (!saved.isDirectory() || saved.isSymbolicLink()) throw Error('Invalid local runtime cache entry');
      await verify(destination);
      progress('Using local runtime ' + revision);
      return dist;
    }
    const stage = await fs.mkdtemp(path.join(base, '.build-'));
    try {
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
      progress('Building backend, SDK dependencies and Console');
      await command('pnpm', ['run', 'build']);
      // Turbo can correctly reuse identical output across source commits. Bind both public entry points to this checkout.
      for (const outputDir of ['apps/omnitron/dist', 'apps/omnitron/webapp/dist'])
        await command(process.execPath, ['apps/omnitron/scripts/stamp-build.mjs', outputDir]);
      if ((await command('git', ['status', '--porcelain'])).trim()) throw Error('Local build changed its source checkout');
      progress('Sealing native runtime');
      await command(process.execPath, ['apps/omnitron/scripts/freeze-backend.mjs', 'apps/omnitron', output]);
      await verify(output);
      await fs.rename(output, destination);
      return dist;
    } finally { await fs.rm(stage, { recursive: true, force: true }); }
  });
}
