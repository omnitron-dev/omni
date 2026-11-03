import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { IEcosystemAppEntry } from '../config/types.js';
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

/** Standalone CLI uses the same explicit stack bindings as managed startup.
 * null retains the older, explicitly invoked package-script command only when no
 * database migration policy exists. It is never a missing-config fallback. */
export async function planDeclaredWorkspaceMigrations(root: string, config: import('../config/types.js').IEcosystemConfig,
  options: { app?: string; stack?: string } = {}) {
  const { normalizeInfraConfig } = await import('../infrastructure/config-normalizer.js');
  const { createDefaultRegistry } = await import('../infrastructure/presets/index.js');
  const { mergeInfrastructure } = await import('../infrastructure/merge-config.js');
  const { ownsStackInfrastructure } = await import('../project/infrastructure-ownership.js');
  const { resolveStackEnv } = await import('../project/stack-env.js');
  const { hasMigrationDeclarations, requestedMigrations, localMigrationTargets, migrationDatabaseEnvironment, validateMigrationDestinations } = await import('../services/migration-target.js');
  const stacks = Object.entries(config.stacks ?? {});
  const policies = stacks.map(([name, stack]) => ({ name, stack,
    services: normalizeInfraConfig(mergeInfrastructure(config, stack) ?? {}, createDefaultRegistry()) }));
  const declared = policies.filter(policy => hasMigrationDeclarations(policy.services));
  const rootServices = normalizeInfraConfig(config.infrastructure ?? {}, createDefaultRegistry());
  if (!options.stack && !declared.length && !hasMigrationDeclarations(rootServices)) return null;
  if (!options.stack && declared.length > 1) throw Error('Choose --stack: multiple stacks declare migration ownership');
  const policy = options.stack ? policies.find(candidate => candidate.name === options.stack) : declared[0];
  if (options.stack && !policy) throw Error(`Unknown migration stack ${options.stack}`);
  if (policy && (policy.stack.type !== 'local' || !ownsStackInfrastructure(policy.stack)))
    throw Error('Standalone migrations require a local infrastructure-owning stack; use the elected controller for remote or delegated stacks');
  const apps = config.apps.filter(app => app.enabled !== false &&
    (!Array.isArray(policy?.stack.apps) || policy.stack.apps.includes(app.name)));
  const requests = requestedMigrations(policy?.services ?? rootServices);
  if (options.app && !apps.some(app => app.name === options.app)) throw Error(`No unique declared application '${options.app}'`);
  const targets = await localMigrationTargets(requests.filter(request => !options.app || request.app === options.app), apps, root);
  if (options.app && !targets.length) throw Error(`Application '${options.app}' has no declared migration ownership`);
  const stackEnv = await resolveStackEnv({ settings: policy?.stack.settings, apps: apps.map(app => app.name),
    getSecret: undefined, where: `standalone/${policy?.name ?? 'project'}` });
  const plan = targets.map(target => {
    const entry = apps.find(app => app.name === target.app)!;
    const env = { ...process.env, ...entry.env, ...stackEnv[target.app] };
    const database = migrationDatabaseEnvironment(target.environmentApp, env['DATABASE_URL'] ?? '', target.database, target.mode);
    return { target, env: { ...env, ...database.env }, database };
  });
  validateMigrationDestinations(plan.map(({ target, database }) => ({ app: target.app, database })));
  return plan;
}
