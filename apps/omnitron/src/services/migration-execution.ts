import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { IEcosystemAppEntry } from '../config/types.js';
import { releaseTreeDigest } from '../release/runtime-provenance.js';
import { installedGraph } from '../release/installed-graph.js';
import { resolveInstalledDependency } from '../release/package-resolution.js';
import { localMigrationTargets, migrationDatabaseEnvironment, validateMigrationDestinations,
  type MigrationRequest, type VerifyMigrationEntries } from './migration-target.js';
import { executeLocalMigration } from './migration-process.js';
import { waitForPostgres } from './wait-for-postgres.js';

/** Startup and management consume the same owner-resolved entries. Source
 * fingerprints include untracked migration files, not just their thin CLI entry. */
export async function planLocalMigrations(requests: readonly MigrationRequest[], entries: IEcosystemAppEntry[],
  root: string, resolveEntry: (entry: IEcosystemAppEntry) => IEcosystemAppEntry, verify?: VerifyMigrationEntries) {
  const targets = await localMigrationTargets(requests, entries, root, verify);
  const trees = new Map<string, Promise<string>>();
  const plan = await Promise.all(targets.map(async target => {
    const env = resolveEntry(entries.find(entry => entry.name === target.app)!).env ?? {};
    const database = migrationDatabaseEnvironment(target.environmentApp, env['DATABASE_URL'] ?? '', target.database, target.mode);
    if (!target.sealed && target.source.split('/').some(part => ['.git', '.omnitron', 'node_modules'].includes(part)))
      throw Error('A source migration must belong to application sources, outside Git, operation state and dependency directories');
    if (!trees.has(target.cwd)) trees.set(target.cwd, releaseTreeDigest(target.cwd, !target.sealed, !target.sealed,
      target.sealed ? [] : ['.git', '.omnitron']));
    return { target, env: { ...env, ...database.env }, database, program: await trees.get(target.cwd)! };
  }));
  validateMigrationDestinations(plan.map(({ target, database }) => ({ app: target.app, database })));
  return plan;
}
export type LocalMigrationPlan = Awaited<ReturnType<typeof planLocalMigrations>>;

/** Fingerprint the actual production dependency graph, including the loader
 * and operation adapter resolved from the same cwd as the migration child. */
export async function inspectMigrationDependencies(plan: LocalMigrationPlan, sdk: { root: string; source: string | null }): Promise<string> {
  const roots = new Set(plan.map(item => item.target.cwd));
  const content = new Map<string, Promise<string>>();
  for (const { target, program } of plan) {
    // This inspection's source plan already measured this physical package
    // with the same portable digest and exclusions. Sealed trees use a different digest.
    if (!target.sealed) content.set(target.cwd, Promise.resolve(program));
    for (const name of [...(!target.sealed ? ['tsx'] : []), ...(target.mode === 'config' ? ['@omnitron-dev/omnitron'] : [])]) {
      const dependency = await resolveInstalledDependency(target.cwd, name);
      if (!dependency) throw Error('Migration dependency is unavailable: ' + name);
      roots.add(dependency);
    }
  }
  const frameworkRoots = [sdk.root, ...(sdk.source ? [sdk.source] : []), ...plan.filter(item => item.target.sealed).map(item => item.target.cwd)];
  const evidence = [];
  for (const root of roots) {
    const graph = await installedGraph(root);
    const packages = await Promise.all(graph.map(async item => {
      if (item.metadata.name.startsWith('@omnitron-dev/') && !frameworkRoots.some(root => item.root === root || item.root.startsWith(root + path.sep)))
        throw Error('Migration framework dependency has no declared SDK workspace owner: ' + item.metadata.name);
      if (!content.has(item.root)) content.set(item.root, releaseTreeDigest(item.root, true, true, ['.git', '.omnitron']));
      return { root: item.root, name: item.metadata.name, version: item.metadata.version,
        dependencies: [...item.dependencies], sha256: await content.get(item.root)! };
    }));
    evidence.push(packages);
  }
  return createHash('sha256').update(JSON.stringify(evidence)).digest('hex');
}

/** No retries after execution: a missing response can already have committed. */
export async function executeMigrationPlan(plan: LocalMigrationPlan, options: {
  inspect(): Promise<LocalMigrationPlan>;
  beforeExecution?(): void;
  output?(target: LocalMigrationPlan[number]['target'], stdout: string): void;
}) {
  const verify = async () => {
    if (!isDeepStrictEqual(plan, await options.inspect()))
      throw Error('Migration declarations, program or resolved connection changed; inspect the plan again');
  };
  for (const { target, env } of plan) if (target.mode === 'config') {
    await verify();
    try { await executeLocalMigration(target, env, { validate: true }); }
    catch (error) {
      throw new Error(`Migration config refused for ${target.service}/${target.database} (${target.app}); no migrations executed`, { cause: error });
    }
  }
  for (const { target, env, database } of plan) {
    await verify();
    await waitForPostgres(database.host, database.port, database.user, database.password, 180_000, database.connectionString);
    await verify();
    options.beforeExecution?.();
    const { stdout } = await executeLocalMigration(target, env);
    options.output?.(target, stdout);
  }
}
