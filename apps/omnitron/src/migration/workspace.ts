import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { resolveProjectStacks } from '../config/project-stacks.js';
import type { IEcosystemAppEntry, IEcosystemConfig } from '../config/types.js';
import { resolveStartupOrder } from '../orchestrator/dependency-resolver.js';

/** Plan every target before the first package script can change a database. */
export async function planWorkspaceMigrations(rootPath: string, apps: IEcosystemAppEntry[], requested?: string) {
  const root = await realpath(rootPath);
  const entries = resolveStartupOrder(apps).flat().filter(app => requested ? app.name === requested : app.enabled !== false);
  if (requested && entries.length !== 1) throw new Error(`No unique declared application '${requested}'`);
  const planned = new Map<string, { app: string; directory: string }>();
  for (const app of entries) {
    const file = app.bootstrap ?? app.script;
    if (!file) throw new Error(`Application '${app.name}' has no entry point`);
    const entry = await realpath(path.resolve(root, app.cwd ?? '.', file));
    const relative = path.relative(root, entry);
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative) || relative.split(path.sep).includes('node_modules')) {
      throw new Error(`Migration entry for '${app.name}' must belong to this workspace`);
    }
    let directory = path.dirname(entry);
    for (;;) {
      const manifest = path.join(directory, 'package.json');
      try {
        if (await realpath(manifest) !== manifest) throw new Error(`Migration package manifest is a symlink: ${manifest}`);
        const pkg = JSON.parse(await readFile(manifest, 'utf8')) as { scripts?: { migrate?: string } };
        if (typeof pkg.scripts?.migrate === 'string' && pkg.scripts.migrate.trim()) {
          if (!planned.has(directory)) planned.set(directory, { app: app.name, directory });
        } else if (requested) throw new Error(`Application '${app.name}' declares no migrate script in ${manifest}`);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        if (directory === root) throw new Error(`No workspace package manifest for '${app.name}'`, { cause: error });
        directory = path.dirname(directory);
      }
    }
  }
  if (!planned.size) throw new Error('No selected application declares a migrate script');
  return [...planned.values()];
}

/** A stack or explicit database policy must be executed by its registered
 * owner. Absence of such a declaration is the only legacy script admission. */
export async function assertLegacyMigrationWorkspace(root: string,
  config: Pick<IEcosystemConfig, 'project' | 'apps' | 'stacks' | 'infrastructure'>) {
  const { expandServiceDeclarations } = await import('../infrastructure/config-normalizer.js');
  const { createDefaultRegistry } = await import('../infrastructure/presets/index.js');
  const { hasMigrationDeclarations } = await import('../services/migration-target.js');
  if (Object.keys(resolveProjectStacks(config, root, config.project)).length ||
      hasMigrationDeclarations(expandServiceDeclarations(config.infrastructure ?? {}, createDefaultRegistry())))
    throw Error('Declared stack/database migration ownership requires --stack <project>/<stack>; no local package script was run');
}
