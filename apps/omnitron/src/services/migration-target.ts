import fs from 'node:fs/promises';
import path from 'node:path';
import type { IEcosystemAppEntry } from '../config/types.js';
import type { IServiceRequirement } from '../infrastructure/types.js';
import { readInstalledReleaseReceipt } from '../release/installed-origin.js';
import { releaseOptionsForEnv } from '../release/target-runtime.js';

/** One compiled convention for local installations and remote deployments. */
export const COMPILED_MIGRATION_ENTRY = 'dist/database/migrate.js';
export type VerifyMigrationEntries = (apps: readonly string[]) => Promise<IEcosystemAppEntry[]>;

export function requestedMigrations(services: Readonly<Record<string, IServiceRequirement>>): string[] {
  const names = new Set<string>();
  for (const service of Object.values(services)) {
    if (service._preset !== 'postgres') continue;
    const databases = service._presetConfig?.['databases'];
    if (!databases || typeof databases !== 'object' || Array.isArray(databases)) continue;
    for (const [name, config] of Object.entries(databases)) {
      if (config && typeof config === 'object' && 'migrate' in config && config.migrate === true) names.add(name);
    }
  }
  return [...names];
}

/** The current standard migrator reads the app-prefixed connection fields. Refuse options
 * it cannot represent instead of silently dropping TLS, session settings or routing constraints. */
export function migrationDatabaseEnvironment(app: string, connectionString: string, expectedDatabase?: string) {
  let url: URL, database: string, user: string, password: string;
  try {
    url = new URL(connectionString);
    database = decodeURIComponent(url.pathname.slice(1));
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !database ||
        (expectedDatabase !== undefined && database !== expectedDatabase) || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(app)) throw Error();
    user = decodeURIComponent(url.username); password = decodeURIComponent(url.password);
  } catch { throw Error(`Migration for ${app} requires its resolved PostgreSQL DATABASE_URL${expectedDatabase ? ' targeting ' + expectedDatabase : ''}`); }
  if (url.search || url.hash) throw Error(`Migration for ${app} refuses DATABASE_URL options: the standard migration contract cannot guarantee their application. No migration was executed.`);
  const host = url.hostname.replace(/^\[|\]$/g, ''), port = url.port || '5432';
  const prefix = app.toUpperCase().replace(/-/g, '_');
  return { host, port: Number(port), database, user, password, connectionString, env: {
    DATABASE_URL: connectionString,
    [`${prefix}__DATABASE__HOST`]: host,
    [`${prefix}__DATABASE__PORT`]: port,
    [`${prefix}__DATABASE__DATABASE`]: database,
    [`${prefix}__DATABASE__USER`]: user,
    [`${prefix}__DATABASE__PASSWORD`]: password,
  } };
}

export interface LocalMigrationTarget {
  app: string;
  environmentApp: string;
  script: string;
  cwd: string;
  sealed: boolean;
  nodeOptions: string;
}

/** Admission is delegated to the same manifest/closure/owner verifier as app launch.
 * A receipt alone is never authority to execute a selected release. No DB or child is touched. */
export async function localMigrationTargets(names: readonly string[], entries: readonly IEcosystemAppEntry[],
  projectPath: string, verify?: VerifyMigrationEntries): Promise<LocalMigrationTarget[]> {
  const sealed = names.filter(name => entries.find(entry => entry.name === name)?.releaseRoot);
  if (sealed.length && !verify) throw Error('Requested release migrations require canonical installation verification');
  const verified = sealed.length ? await verify!(sealed) : [];
  const targets: LocalMigrationTarget[] = [];
  for (const app of names) {
    const entry = entries.find(candidate => candidate.name === app);
    if (!entry) throw Error(`Migration requested for ${app}, but this stack has no matching application`);
    let cwd: string, script: string, environmentApp = app, nodeOptions = '';
    if (entry.releaseRoot) {
      const checked = verified.find(candidate => candidate.name === app);
      if (!checked || checked.releaseRoot !== entry.releaseRoot || checked.bootstrap !== entry.bootstrap || checked.script !== entry.script)
        throw Error(`Migration installation changed for ${app}`);
      cwd = entry.releaseRoot;
      script = path.join(cwd, COMPILED_MIGRATION_ENTRY);
      // The verifier has just checked this exact private receipt against its admitted manifest.
      const receipt = await readInstalledReleaseReceipt(cwd);
      environmentApp = receipt.origin.runtimeOrigin?.producerApp ?? app;
      nodeOptions = releaseOptionsForEnv(checked.env);
    } else {
      cwd = path.join(projectPath, 'apps', app);
      script = path.join(cwd, 'src/database/migrate.ts');
    }
    try {
      const physicalCwd = await fs.realpath(cwd), physicalScript = await fs.realpath(script);
      if (entry.releaseRoot && (physicalCwd !== cwd || physicalScript !== script)) throw Error();
      // Developer checkouts may be registered through an intentional workspace alias.
      // Resolve it once; the caller compares the canonical target again after DB readiness.
      cwd = physicalCwd; script = physicalScript;
      if (!(await fs.lstat(script)).isFile()) throw Error();
    } catch { throw Error(`Migration requested for ${app}, but its migration script is unavailable or not a physical file`); }
    targets.push({ app, environmentApp, script, cwd, sealed: !!entry.releaseRoot, nodeOptions });
  }
  return targets;
}
