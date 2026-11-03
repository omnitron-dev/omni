import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import type { withRegistryArchive } from '../../src/release/registry-transport.js';

/** Native subprocess tests use the actual compiled worker and declared package
 * dependencies. No source-loader fallback is added to the production path. */
export async function compileRegistryTransportFixture(): Promise<{
  directory: string; worker: string; download: typeof withRegistryArchive;
}> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'registry-transport-code-'));
  await build({ entryPoints: ['registry-transport.ts', 'registry-download.ts'].map(file =>
    fileURLToPath(new URL('../../src/release/' + file, import.meta.url))), outdir: directory,
  format: 'esm', platform: 'node', target: 'node22', bundle: false });
  await fs.writeFile(path.join(directory, 'package.json'), '{"type":"module"}');
  for (const dependency of ['@xec-sh/core', '@pnpm/config.reader', '@pnpm/config.pick-registry-for-package', '@pnpm/network.auth-header', '@pnpm/network.fetch']) {
    let root = path.dirname(fileURLToPath(import.meta.resolve(dependency)));
    while (JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8').catch(() => '{}')).name !== dependency) {
      if (path.dirname(root) === root) throw Error('Cannot locate declared dependency ' + dependency);
      root = path.dirname(root);
    }
    const dest = path.join(directory, 'node_modules', dependency);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.symlink(root, dest, 'dir');
  }
  const loaded = await import(pathToFileURL(path.join(directory, 'registry-transport.js')).href);
  return { directory, worker: path.join(directory, 'registry-download.js'), download: loaded.withRegistryArchive as typeof withRegistryArchive };
}
