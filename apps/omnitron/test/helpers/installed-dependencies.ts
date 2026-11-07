import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveInstalledDependency } from '../../src/release/package-resolution.js';

/** Give a detached fixture the package's actual dependencies in either pnpm layout. */
export async function linkFixtureDependencies(directory: string, names?: readonly string[]): Promise<void> {
  const source = path.resolve(import.meta.dirname, '../..');
  const dependencies = names ?? Object.keys(JSON.parse(await fs.readFile(path.join(source, 'package.json'), 'utf8')).dependencies);
  for (const name of dependencies) {
    const installed = await resolveInstalledDependency(source, name);
    if (!installed) throw Error('Missing fixture dependency: ' + name);
    const link = path.join(directory, 'node_modules', name);
    await fs.mkdir(path.dirname(link), { recursive: true });
    await fs.symlink(await fs.realpath(installed), link, 'dir');
  }
}
