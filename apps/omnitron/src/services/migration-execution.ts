import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import { pLimit } from '@omnitron-dev/common';
import { redactDiagnosticText } from '@omnitron-dev/titan/diagnostics';
import path from 'node:path';
import type { IEcosystemAppEntry } from '../config/types.js';
import { releaseTreeDigest } from '../release/runtime-provenance.js';
import { installedGraph } from '../release/installed-graph.js';
import { resolveInstalledDependency } from '../release/package-resolution.js';
import { localMigrationTargets, migrationDatabaseEnvironment, validateMigrationDestinations,
  type MigrationRequest, type VerifyMigrationEntries } from './migration-target.js';
import { executeLocalMigration } from './migration-process.js';
import { migrationWorkspaceBindings } from './migration-workspace-bindings.js';
import { waitForPostgres } from './wait-for-postgres.js';
import type { MigrationSdkInspection } from '../../bin/sdk.js';

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
      target.sealed ? [] : ['.git', '.omnitron'], undefined, !target.sealed));
    return { target, env: { ...env, ...database.env }, database, program: await trees.get(target.cwd)! };
  }));
  validateMigrationDestinations(plan.map(({ target, database }) => ({ app: target.app, database })));
  return plan;
}
export type LocalMigrationPlan = Awaited<ReturnType<typeof planLocalMigrations>>;

/** Fingerprint the actual production dependency graph, including the loader
 * and operation adapter resolved from the same cwd as the migration child. */
export async function inspectMigrationDependencies(plan: LocalMigrationPlan, sdk: Pick<MigrationSdkInspection, 'root' | 'source' | 'bindings'>): Promise<string> {
  const roots = new Set(plan.map(item => item.target.cwd));
  const sealed = new Set(plan.filter(item => item.target.sealed).map(item => item.target.cwd));
  const covered = new Set<string>();
  const bindings = migrationWorkspaceBindings(sdk, directory => { if (!covered.has(directory)) roots.add(directory); });
  const content = new Map<string, Promise<string>>();
  const sealedContent = new Map<string, Promise<string>>();
  const measure = pLimit(4);
  let failure: Error | undefined;
  for (const { target, program } of plan) {
    // This inspection's source plan already measured this physical package
    // with the same portable digest and exclusions. Sealed trees use a different digest.
    if (!target.sealed) content.set(target.cwd, Promise.resolve(program));
    for (const name of [...(!target.sealed ? ['tsx'] : []), ...(target.mode === 'config' ? ['@omnitron-dev/omnitron'] : [])]) {
      const dependency = await resolveInstalledDependency(target.cwd, name);
      if (!dependency) throw Error('Migration dependency is unavailable: ' + name);
      roots.add(dependency);
      if (target.sealed) sealed.add(dependency);
    }
  }
  const frameworkRoots = [sdk.root, ...(sdk.source ? [sdk.source] : []), ...plan.filter(item => item.target.sealed).map(item => item.target.cwd)];
  const evidence = [];
  for (const root of roots) {
    const graph = await installedGraph(root);
    const cache = sealed.has(root) ? sealedContent : content;
    const inspect = sealed.has(root) || !sdk.source ? undefined : bindings.inspect;
    if (inspect) for (const item of graph) covered.add(item.root);
    for (const item of graph) {
      if (item.metadata.name.startsWith('@omnitron-dev/') && !frameworkRoots.some(directory => item.root === directory || item.root.startsWith(directory + path.sep)))
        throw Error('Migration framework dependency has no declared SDK workspace owner: ' + item.metadata.name);
    }
    const results = await Promise.allSettled(graph.map(async item => {
      if (!cache.has(item.root)) cache.set(item.root, measure(async () => {
        if (failure) throw failure;
        try { return await releaseTreeDigest(item.root, true, true, ['.git', '.omnitron'], inspect, !sealed.has(root)); }
        catch (cause) {
          failure ??= new Error(`Migration dependency ${item.metadata.name} at ${item.root}: ${(cause as Error).message}`, { cause });
          throw failure;
        }
      }));
      return { root: item.root, name: item.metadata.name, version: item.metadata.version,
        dependencies: [...item.dependencies], sha256: await cache.get(item.root)! };
    }));
    const packages = results.map(result => {
      if (result.status === 'rejected') throw result.reason;
      return result.value;
    });
    evidence.push({ root, packages });
  }
  await bindings.verify();
  // Package digests run concurrently, so discovery of additional graph roots can finish in any order.
  evidence.sort((a, b) => a.root < b.root ? -1 : a.root > b.root ? 1 : 0);
  return createHash('sha256').update(JSON.stringify(evidence)).digest('hex');
}

/** No retries after execution: a missing response can already have committed. */
export async function executeMigrationPlan(plan: LocalMigrationPlan, options: {
  inspect(): Promise<LocalMigrationPlan>;
  beforeExecution?(): void;
  output?(target: LocalMigrationPlan[number]['target'], stdout: string): void;
  failed?(target: LocalMigrationPlan[number]['target'], diagnostic: string): void;
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
    let result: Awaited<ReturnType<typeof executeLocalMigration>>;
    try { result = await executeLocalMigration(target, env); }
    catch (error) {
      const diagnostic = redactDiagnosticText(error instanceof Error ? error.message : String(error));
      options.failed?.(target, diagnostic);
      throw new Error(`Migration ${target.service}/${target.database} (${target.app}); stack startup refused: ${diagnostic}. Inspect the migration ledger before retrying.`, { cause: error });
    }
    options.output?.(target, result.stdout);
  }
}
