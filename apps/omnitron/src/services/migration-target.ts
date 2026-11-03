import fs from 'node:fs/promises';
import path from 'node:path';
import type { IEcosystemAppEntry } from '../config/types.js';
import { resolveAppPath } from '../config/app-path.js';
import type { IServiceRequirement, MigrationBinding } from '../infrastructure/types.js';
import { readInstalledReleaseReceipt } from '../release/installed-origin.js';
import { releaseOptionsForEnv } from '../release/target-runtime.js';

/** Compatibility entries; explicit bindings name their own config modules. */
export const COMPILED_MIGRATION_ENTRY = 'dist/database/migrate.js';
export interface MigrationRequest {
  service: string;
  database: string;
  app: string;
  mode: 'script' | 'config';
  source: string;
  release: string;
}
export type MigrationRequiredFiles = Readonly<Record<string, readonly string[]>>;
export type VerifyMigrationEntries = (apps: readonly string[], files: MigrationRequiredFiles) => Promise<IEcosystemAppEntry[]>;

function member(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0') ||
      path.posix.isAbsolute(value) || value.split('/').some(part => !part || part === '.' || part === '..') ||
      /^[A-Za-z]:/.test(value)) throw Error(`Migration ${field} must be a package-relative physical file`);
  return value;
}

function legacy(database: string, service = 'postgres'): MigrationRequest {
  return { service, database, app: database, mode: 'script', source: 'src/database/migrate.ts', release: COMPILED_MIGRATION_ENTRY };
}

/** false is also a declaration: it must not fall through to script discovery. */
export function hasMigrationDeclarations(services: Readonly<Record<string, IServiceRequirement>>): boolean {
  for (const service of Object.values(services)) {
    if (service._preset !== 'postgres') continue;
    const databases = service._presetConfig?.['databases'];
    if (databases === undefined) continue;
    if (!databases || typeof databases !== 'object' || Array.isArray(databases)) throw Error('Invalid PostgreSQL database declarations');
    for (const config of Object.values(databases)) {
      if (!config || typeof config !== 'object' || Array.isArray(config)) throw Error('Invalid PostgreSQL database declaration');
      if (Object.hasOwn(config, 'migrate') || Object.hasOwn(config, 'migrationDir')) return true;
    }
  }
  return false;
}

/** One opt-in policy for diagnosis, source launch, installed releases and remote deployments.
 * Keep database/service identity independent of the application's alias and package path. */
export function requestedMigrations(services: Readonly<Record<string, IServiceRequirement>>): MigrationRequest[] {
  const requests: MigrationRequest[] = [];
  const programs = new Map<string, string>();
  for (const [service, requirement] of Object.entries(services)) {
    if (requirement._preset !== 'postgres') continue;
    const databases = requirement._presetConfig?.['databases'];
    if (databases === undefined) continue;
    if (!databases || typeof databases !== 'object' || Array.isArray(databases)) throw Error(`Invalid PostgreSQL databases for ${service}`);
    for (const [database, config] of Object.entries(databases)) {
      if (!config || typeof config !== 'object' || Array.isArray(config)) throw Error(`Invalid migration declaration for ${service}/${database}`);
      if (Object.hasOwn(config, 'migrationDir')) throw Error(`migrationDir is not an executable migration binding for ${service}/${database}; declare migrate.config and migrate.releaseConfig`);
      const value = (config as { migrate?: unknown }).migrate;
      if (value === undefined || value === false) continue;
      const identity = `${service}/${database}`;
      const bindings = value === true ? [legacy(database, service)] : (Array.isArray(value) ? value : [value]).map(input => {
        if (!input || typeof input !== 'object' || Array.isArray(input) ||
            Object.keys(input).some(key => !['app', 'config', 'releaseConfig'].includes(key))) throw Error(`Invalid migration binding for ${identity}`);
        const binding = input as MigrationBinding;
        if (typeof binding.app !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(binding.app)) throw Error(`Invalid migration owner for ${identity}`);
        const source = member(binding.config, 'config'), release = member(binding.releaseConfig, 'releaseConfig');
        if (!/\.[cm]?js$/.test(release)) throw Error(`Migration releaseConfig for ${identity} must name a compiled JavaScript module`);
        return { service, database, app: binding.app, mode: 'config' as const, source, release };
      });
      if (!bindings.length) throw Error(`Migration binding list is empty for ${identity}`);
      if (new Set(bindings.map(binding => binding.app)).size !== 1) throw Error(`Database ${identity} must have one migration owner`);
      for (const binding of bindings) {
        const key = JSON.stringify([binding.app, binding.source, binding.release]);
        const previous = programs.get(key);
        if (previous) throw Error(`Migration program for ${binding.app} is declared more than once (${previous}, ${identity})`);
        programs.set(key, identity);
        requests.push(binding);
      }
    }
  }
  return requests;
}

/** Validate every owner before executing any part of the migration plan. */
export function validateMigrationOwners(requests: readonly MigrationRequest[], entries: readonly IEcosystemAppEntry[]): void {
  for (const request of requests) {
    if (!request || !['script', 'config'].includes(request.mode) || typeof request.database !== 'string' || !request.database ||
        typeof request.service !== 'string' || !request.service) throw Error('Invalid normalized migration request');
    member(request.source, 'source'); member(request.release, 'release');
    if (!/\.[cm]?js$/.test(request.release)) throw Error('A released migration must name a compiled JavaScript module');
    const owners = entries.filter(entry => entry.name === request.app);
    if (owners.length !== 1 || owners[0]!.enabled === false)
      throw Error(`Migration requested for ${request.service}/${request.database}, but this stack has no unique application ${request.app}`);
  }
}

/** Existing deployments activate one node at a time. An explicit shared-database
 * owner must therefore have one placement, visited before its consumers. Multiple
 * owning nodes need a global migration barrier; refuse rather than choosing a replica. */
export function orderMigrationPlacements<T extends { apps: readonly IEcosystemAppEntry[] }>(requests: readonly MigrationRequest[], placements: readonly T[]): T[] {
  const owners = new Set<number>();
  for (const request of requests.filter(candidate => candidate.mode === 'config')) {
    const matches = placements.flatMap((placement, index) => placement.apps.some(app => app.name === request.app) ? [index] : []);
    if (matches.length !== 1) throw Error(`Migration owner ${request.app} requires exactly one node placement; configure an unambiguous owner before deployment`);
    owners.add(matches[0]!);
  }
  if (owners.size > 1) throw Error('Migration owners on different nodes require a global migration barrier; place the explicit owners on one node before deployment');
  const first = [...owners][0];
  return first === undefined ? [...placements] : [placements[first]!, ...placements.filter((_, index) => index !== first)];
}

export function requiredMigrationFiles(requests: readonly MigrationRequest[]): MigrationRequiredFiles {
  const result: Record<string, string[]> = Object.create(null) as Record<string, string[]>;
  for (const request of requests) (result[request.app] ??= []).push(request.release);
  return result;
}

/** Legacy scripts consume app-prefixed connection fields and cannot preserve URL options.
 * Config modules receive the complete resolved URL; validation never rewrites their connection. */
export function migrationDatabaseEnvironment(app: string, connectionString: string, expectedDatabase?: string, mode: 'script' | 'config' = 'script') {
  let url: URL, database: string, user: string, password: string;
  try {
    url = new URL(connectionString);
    database = decodeURIComponent(url.pathname.slice(1));
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !database ||
        (expectedDatabase !== undefined && database !== expectedDatabase) || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(app)) throw Error();
    user = decodeURIComponent(url.username); password = decodeURIComponent(url.password);
  } catch { throw Error(`Migration for ${app} requires its resolved PostgreSQL DATABASE_URL${expectedDatabase ? ' targeting ' + expectedDatabase : ''}`); }
  if (url.hash || (mode === 'script' && url.search)) throw Error(`Migration for ${app} refuses DATABASE_URL options: the standard migration contract cannot guarantee their application. No migration was executed.`);
  if (mode === 'config' && [...url.searchParams.keys()].some(key => ['host', 'hostaddr', 'port', 'database', 'dbname', 'user', 'password'].includes(key.toLowerCase())))
    throw Error(`Migration for ${app} refuses connection destination overrides in DATABASE_URL options; declare the destination in the URL authority and path`);
  const host = url.hostname.replace(/^\[|\]$/g, ''), port = url.port || '5432';
  const prefix = app.toUpperCase().replace(/-/g, '_');
  const env: Record<string, string> = { DATABASE_URL: connectionString };
  if (mode === 'script') Object.assign(env, {
    [`${prefix}__DATABASE__HOST`]: host,
    [`${prefix}__DATABASE__PORT`]: port,
    [`${prefix}__DATABASE__DATABASE`]: database,
    [`${prefix}__DATABASE__USER`]: user,
    [`${prefix}__DATABASE__PASSWORD`]: password,
  });
  return { host, port: Number(port), database, user, password, connectionString, env };
}

/** Two named infrastructure services must not silently assign different owners
 * to the same resolved database. Several registries under one owner are valid. */
export function validateMigrationDestinations(targets: readonly { app: string; database: ReturnType<typeof migrationDatabaseEnvironment> }[]): void {
  const owners = new Map<string, string>();
  for (const { app, database } of targets) {
    const identity = JSON.stringify([database.host, database.port, database.database]);
    const owner = owners.get(identity);
    if (owner && owner !== app) throw Error(`Resolved migration database ${database.database} has conflicting owners ${owner} and ${app}`);
    owners.set(identity, app);
  }
}

export interface LocalMigrationTarget extends MigrationRequest {
  environmentApp: string;
  script: string;
  cwd: string;
  sealed: boolean;
  nodeOptions: string;
}

function contained(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

/** Admission is delegated to the same manifest/closure/owner verifier as app launch.
 * A receipt alone is never authority to execute a selected release. No DB or child is touched. */
export async function localMigrationTargets(requests: readonly MigrationRequest[], entries: readonly IEcosystemAppEntry[],
  projectPath: string, verify?: VerifyMigrationEntries): Promise<LocalMigrationTarget[]> {
  const plan = requests;
  validateMigrationOwners(plan, entries);
  const sealed = plan.filter(request => entries.find(entry => entry.name === request.app)?.releaseRoot);
  if (sealed.length && !verify) throw Error('Requested release migrations require canonical installation verification');
  const verified = sealed.length ? await verify!([...new Set(sealed.map(request => request.app))], requiredMigrationFiles(sealed)) : [];
  const targets: LocalMigrationTarget[] = [];
  for (const request of plan) {
    const app = request.app, entry = entries.find(candidate => candidate.name === app)!;
    let cwd: string, script: string, environmentApp = app, nodeOptions = '';
    if (entry.releaseRoot) {
      const checked = verified.find(candidate => candidate.name === app);
      if (!checked || checked.releaseRoot !== entry.releaseRoot || checked.bootstrap !== entry.bootstrap || checked.script !== entry.script)
        throw Error(`Migration installation changed for ${app}`);
      cwd = entry.releaseRoot;
      script = path.join(cwd, request.release);
      const receipt = await readInstalledReleaseReceipt(cwd);
      environmentApp = receipt.origin.runtimeOrigin?.producerApp ?? app;
      nodeOptions = releaseOptionsForEnv(checked.env);
    } else {
      cwd = resolveAppPath(projectPath, entry);
      // true historically names apps/<database>; the config loader stamps an omitted cwd
      // to the project root. Preserve that spelling, without a missing-file fallback.
      if (request.mode === 'script' && cwd === path.resolve(projectPath)) cwd = path.join(projectPath, 'apps', app);
      script = path.join(cwd, request.source);
    }
    try {
      const physicalCwd = await fs.realpath(cwd), physicalScript = await fs.realpath(script);
      if (!contained(physicalCwd, physicalScript)) throw Error();
      if (entry.releaseRoot && (physicalCwd !== cwd || physicalScript !== script)) throw Error();
      if (!(await fs.lstat(script)).isFile()) throw Error();
      cwd = physicalCwd; script = physicalScript;
    } catch { throw Error(`Migration requested for ${app}, but its migration script is unavailable or not a physical file within its package`); }
    targets.push({ ...request, environmentApp, script, cwd, sealed: !!entry.releaseRoot, nodeOptions });
  }
  return targets;
}
