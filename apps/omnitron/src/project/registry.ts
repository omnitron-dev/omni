import { isControlPlaneWorkspace } from './workspace-kind.js';
import { OMNITRON_HOME } from '../config/defaults.js';
/**
 * Project Registry — Manages seed projects registered with omnitron.
 *
 * A seed project is a monorepo with `omnitron.config.ts` at the root.
 * Omnitron can manage multiple projects simultaneously.
 *
 * T-7 migration (this file): persistence moved from
 * `~/.omnitron/projects/registry.json` (single fs.writeFileSync per
 * mutation) onto the SQLite-backed `projects` table in
 * DaemonStateStore. Same crash-safe + transactional guarantees as
 * the unified daemon state, no torn-write risk on kill -9
 * mid-flush. One-shot migration: if the legacy JSON file exists on
 * first construction, its rows are imported into the table and
 * the file is unlinked.
 *
 * API is unchanged — synchronous CRUD via better-sqlite3 prepared
 * statements (the `..Sync` helpers on DaemonStateStore). Callers
 * that did `new ProjectRegistry()` keep working; the only contract
 * change is the constructor now requires the store handle.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import type { ISeedProject, IProjectRegistry } from '../config/types.js';
import type { DaemonStateStore } from '../daemon/daemon-state-store.service.js';
import { CONFIG_FILE_NAMES } from '../config/loader.js';
import { validateConfigurationNames, type ConfigurationImport, type RuntimeStackScope } from './configuration-catalog.js';

// CJS-style require for the open() factory's lazy DaemonStateStore
// load. The module shape is ESM but we need a synchronous import
// inside a static method that callers can't `await`.
const requireCjs = createRequire(import.meta.url);

const PROJECTS_DIR = path.join(OMNITRON_HOME, 'projects');
const LEGACY_REGISTRY_FILE = path.join(PROJECTS_DIR, 'registry.json');
const ENABLED_STACKS_KV_KEY = (name: string) => `project:${name}:enabled-stacks`;
const CONFIGURATIONS_KEY = (name: string) => `project:${name}:configurations`;
interface ConfigurationState { version: 1; sources: ISeedProject[] }

function configurationState(value: ConfigurationState | null): ConfigurationState {
  if (!value) return { version: 1, sources: [] };
  if (value.version !== 1 || !Array.isArray(value.sources)) throw new Error('Unsupported project configuration catalogue');
  for (const source of value.sources) {
    if (!source.configuration || typeof source.name !== 'string' || typeof source.path !== 'string')
      throw new Error('Corrupt project configuration catalogue');
    validateConfigurationNames(source.configuration.name, source.configuration.stacks);
  }
  return value;
}

function isWithin(parent: string, child: string): boolean {
  const relative = path.relative(fs.realpathSync(parent), fs.realpathSync(child));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

/**
 * The config file a project directory must have, whichever spelling.
 *
 * The registry accepted `omnitron.config.ts` and nothing else, while the
 * LOADER has always read `.ts`, `.js` and `.mjs` — so a project the daemon can
 * run could not be registered, and the message named the one extension it
 * wanted as though the others did not exist.
 *
 * Found on a deployed node, where the generated config is `.mjs` precisely
 * because a node should not need a TypeScript loader to know what to start:
 * `No omnitron.config.ts found at /opt/omnitron/projects/sample`, in a directory
 * whose `omnitron.config.mjs` was sitting right there.
 *
 * One list, imported from the loader, so the two cannot disagree again.
 */
function findProjectConfig(dir: string): string | null {
  for (const name of CONFIG_FILE_NAMES) {
    const candidate = path.join(dir, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export class ProjectRegistry {
  /**
   * In-memory cache mirroring the persisted state. Reads (list/get)
   * serve from here so legacy callers don't pay an SQLite round-
   * trip per call; mutations write through to SQLite synchronously
   * and update the cache on success.
   */
  private projects = new Map<string, ISeedProject>();
  private cachedRevision = "";

  constructor(private readonly store: DaemonStateStore) {
    fs.mkdirSync(PROJECTS_DIR, { recursive: true });
    this.loadFromStore();
    this.migrateLegacyJsonIfPresent();
  }

  /**
   * Stand-alone factory for CLI commands that don't have a running
   * daemon's DI container (e.g. `omnitron project add` invoked
   * before `omnitron up`). Constructs a DaemonStateStore inline
   * with a no-op logger and opens the registry against it. The
   * SQLite file is shared with the daemon — both writers use
   * WAL-mode locking so concurrent access is safe.
   */
  static open(): ProjectRegistry {
    // We can't do dynamic ESM `import()` synchronously, and the
    // entry-point code path can't be `async`. Use createRequire to
    // get a CJS-style require inside ESM and load the store
    // synchronously. Same module the daemon's DI resolves; the
    // SQLite handle is opened against the same path (WAL-mode
    // locking makes concurrent access safe).
    const { DaemonStateStore } = requireCjs('../daemon/daemon-state-store.service.js') as {
      DaemonStateStore: new (logger: unknown) => DaemonStateStore;
    };
    const noopLogger = {
      trace: () => undefined,
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      fatal: () => undefined,
      child: () => noopLogger,
       
    } as any;
    const store = new DaemonStateStore(noopLogger);
    return new ProjectRegistry(store);
  }

  // ===========================================================================
  // CRUD — synchronous through-write
  // ===========================================================================

  private assertFresh(): void {
    if (this.cachedRevision !== this.catalogRevision()) throw new Error('Project catalogue changed outside this controller; reload before editing');
  }

  add(name: string, projectPath: string): ISeedProject {
    this.assertFresh();
    const absPath = path.resolve(projectPath);
    if (isControlPlaneWorkspace(absPath)) throw new Error('The Omnitron control plane is already the system workspace; register an application project instead');

    if (!findProjectConfig(absPath)) {
      throw new Error(`No ${CONFIG_FILE_NAMES.join(' / ')} found at ${absPath}`);
    }

    if (this.projects.has(name)) {
      throw new Error(`Project '${name}' already registered. Use 'omnitron project remove ${name}' first.`);
    }

    const owner = this.list().find(project => fs.existsSync(project.path) && isWithin(project.path, absPath));
    if (owner) throw new Error(`This directory belongs to project '${owner.name}'. Import its stack configuration with 'omnitron project configuration import'; do not register another project.`);

    const project: ISeedProject = {
      name,
      path: absPath,
      registeredAt: new Date().toISOString(),
    };

    this.store.upsertProjectSync({
      name: project.name,
      path: project.path,
      added_at: project.registeredAt,
      last_seen: project.registeredAt,
    });
    this.projects.set(name, project);
    this.cachedRevision = this.catalogRevision();

    const projectDir = path.join(PROJECTS_DIR, name);
    fs.mkdirSync(projectDir, { recursive: true });

    return project;
  }

  remove(name: string): void {
    this.assertFresh();    if (!this.projects.has(name)) throw new Error(`Project '${name}' not found`);
    if (this.get(name)?.configuration) throw new Error('This is a stack configuration, not a separate project');
    if (this.registrations(name).length > 1) throw new Error(`Project '${name}' has imported stack configurations; detach them before removing the project`);
    this.store.deleteProjectSync(name);
    this.store.kvDeleteSync?.(ENABLED_STACKS_KV_KEY(name));
    this.projects.delete(name);
    this.cachedRevision = this.catalogRevision();
  }

  updatePath(name: string, newPath: string): ISeedProject {
    this.assertFresh();    if (isControlPlaneWorkspace(newPath)) throw new Error('The Omnitron control plane is already the system workspace');
    const project = this.projects.get(name);
    if (!project) throw new Error(`Project '${name}' not found`);

    const absPath = path.resolve(newPath);
    if (!project.configuration && this.registrations(name).length > 1 &&
        fs.realpathSync(project.path) !== fs.realpathSync(absPath))
      throw new Error('Relocate imported configurations explicitly before moving the project root');
    if (!findProjectConfig(absPath)) {
      throw new Error(`No ${CONFIG_FILE_NAMES.join(' / ')} found at ${absPath}`);
    }

    // A release directory is a location, never a new project identity.
    // Keep workspace, enabled-stack and secret namespaces under the existing name.
    const updated: ISeedProject = {
      ...project,
      path: absPath,
    };
    if (project.configuration) {
      this.store.kvUpdateSync<ConfigurationState>(CONFIGURATIONS_KEY(project.configuration.project), current => {
        const state = configurationState(current);
        return { ...state, sources: state.sources.map(source => source.name === name ? { ...source, path: absPath } : source) };
      });
    } else this.store.upsertProjectSync({
      name: updated.name,
      path: updated.path,
      added_at: updated.registeredAt,
      last_seen: new Date().toISOString(),
    });
    this.projects.set(name, updated);
    this.cachedRevision = this.catalogRevision();
    return updated;
  }

  get(name: string): ISeedProject | null {
    const project = this.projects.get(name);
    return project ? this.refreshResumeIntent(project) : null;
  }

  list(): ISeedProject[] {
    return this.listRegistrations().filter(project => !project.configuration);
  }

  /** Execution/recovery inventory, including imported configurations with their original identities. */
  listRegistrations(): ISeedProject[] {
    return Array.from(this.projects.values(), project => this.refreshResumeIntent(project));
  }

  private refreshResumeIntent(project: ISeedProject): ISeedProject {
    const value = this.store.kvGetSync<string[]>(ENABLED_STACKS_KV_KEY(project.name), { strict: true });
    if (value !== null && (!Array.isArray(value) || value.some(stack => typeof stack !== 'string'))) {
      throw new Error('Corrupt enabled-stack intent');
    }
    if (value === null) delete project.enabledStacks;
    else project.enabledStacks = value;
    return project;
  }

  registrations(project: string): ISeedProject[] {
    const root = this.get(project);
    if (!root) throw new Error(`Project '${project}' not found`);
    // Legacy namespace calls stay valid, but do not become separate catalogue projects.
    if (root.configuration) return [root];
    return this.listRegistrations().filter(record => record.name === project || record.configuration?.project === project);
  }

  resolveStack(scope: RuntimeStackScope): RuntimeStackScope {
    const registration = this.get(scope.project);
    if (!registration) throw new Error(`Project '${scope.project}' not found`);
    if (registration.configuration) return { ...scope };
    for (const source of this.registrations(scope.project)) {
      const match = Object.entries(source.configuration?.stacks ?? {}).find(([, name]) => name === scope.stack);
      if (match) return { project: source.name, stack: match[0] };
    }
    return { ...scope };
  }

  catalogRevision(): string {
    const rows = this.store.selectProjectsSync().map(row => ({
      name: row.name, path: row.path, registeredAt: row.added_at,
      configurations: configurationState(this.store.kvGetSync<ConfigurationState>(CONFIGURATIONS_KEY(row.name), { strict: true })),
    })).sort((a, b) => a.name.localeCompare(b.name));
    return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  }

  /** Atomic ownership migration. No process, secret, enabled-stack or telemetry namespace is renamed. */
  prepareConfiguration(input: ConfigurationImport): ISeedProject {
    validateConfigurationNames(input.name, input.stacks);
    if (this.cachedRevision !== input.expectedRevision) throw new Error('Project catalogue changed; reload this controller before importing');
    const owner = this.get(input.project);
    if (!owner || owner.configuration) throw new Error('Configuration owner must be a registered project');
    const location = path.resolve(input.path);
    if (!findProjectConfig(location)) throw new Error(`No ecosystem configuration found at ${location}`);
    if (!isWithin(owner.path, location)) throw new Error('A stack configuration must belong to its project repository. Use an explicit service binding for another project.');
    const runtimeId = input.registration ?? `${input.project}--${input.name}`;
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(runtimeId)) throw new Error('Invalid runtime namespace');
    if (runtimeId === input.project) throw new Error('The default project configuration cannot be imported into itself');
    const existing = this.get(runtimeId);
    if (existing && !isWithin(existing.path, location)) throw new Error('The runtime namespace belongs to another configuration path');
    if (existing && fs.realpathSync(existing.path) !== fs.realpathSync(location)) throw new Error('Configuration path does not match the existing registration');
    if (existing?.configuration && existing.configuration.project !== input.project) throw new Error('Configuration already belongs to another project');
    if (existing && !existing.configuration && this.registrations(runtimeId).length > 1) throw new Error('Cannot import a project that owns other configurations');
    const occupied = this.listRegistrations().find(record => record.name !== runtimeId && fs.existsSync(record.path) && fs.realpathSync(record.path) === fs.realpathSync(location));
    if (occupied) throw new Error(`This configuration is already registered as '${occupied.name}'; use its existing runtime namespace`);
    const record: ISeedProject = {
      name: runtimeId, path: location, registeredAt: existing?.registeredAt ?? new Date().toISOString(),
      configuration: { project: input.project, name: input.name, stacks: { ...input.stacks } },
    };
    return record;
  }

  importConfiguration(input: ConfigurationImport): ISeedProject {
    const record = this.prepareConfiguration(input);
    const runtimeId = record.name;
    this.store.kvUpdateSync<ConfigurationState>(CONFIGURATIONS_KEY(input.project), current => {
      if (this.catalogRevision() !== input.expectedRevision) throw new Error('Project catalogue changed; refresh before importing');
      const state = configurationState(current);
      const others = state.sources.filter(source => source.name !== runtimeId);
      if (others.some(source => source.configuration!.name === input.name)) throw new Error('Configuration name already exists in this project');
      const names = new Set(others.flatMap(source => Object.values(source.configuration!.stacks)));
      if (Object.values(input.stacks).some(name => names.has(name))) throw new Error('Project stack name is already assigned to another configuration');
      this.store.deleteProjectSync(runtimeId);
      return { version: 1, sources: [...others, record] };
    });
    this.loadFromStore();
    return this.get(runtimeId)!;
  }

  /** Metadata-only inverse used for rollback; execution namespaces and their state remain intact. */
  detachConfiguration(project: string, name: string, expectedRevision: string): void {
    if (this.cachedRevision !== expectedRevision) throw new Error('Project catalogue changed; reload this controller before detaching');
    this.store.kvUpdateSync<ConfigurationState>(CONFIGURATIONS_KEY(project), current => {
      if (this.catalogRevision() !== expectedRevision) throw new Error('Project catalogue changed; refresh before detaching');
      const state = configurationState(current);
      const source = state.sources.find(record => record.configuration?.name === name);
      if (!source) throw new Error('Project configuration not found');
      if (this.store.selectProjectsSync().some(row => row.name === source.name))
        throw new Error('Runtime namespace is already registered as a project; detach refused');
      this.store.upsertProjectSync({ name: source.name, path: source.path, added_at: source.registeredAt, last_seen: new Date().toISOString() });
      return { version: 1, sources: state.sources.filter(record => record !== source) };
    });
    this.loadFromStore();
  }

  /** Detect external registry edits instead of certifying a stale in-memory cache. */
  recoveryDigest(): string {
    const normalize = (projects: ISeedProject[]) => JSON.stringify(projects.map(project => ({
      name: project.name, path: project.path, registeredAt: project.registeredAt,
      enabledStacks: [...(project.enabledStacks ?? [])].sort(),
      ...(project.configuration ? { configuration: project.configuration } : {}),
    })).sort((a, b) => a.name.localeCompare(b.name)));
    const stored = this.store.selectProjectsSync().flatMap(row => [{ name: row.name, path: row.path, registeredAt: row.added_at,
      enabledStacks: this.store.kvGetSync<string[]>(ENABLED_STACKS_KV_KEY(row.name)) ?? [],
    }, ...configurationState(this.store.kvGetSync<ConfigurationState>(CONFIGURATIONS_KEY(row.name), { strict: true })).sources.map(source => ({ ...source,
      enabledStacks: this.store.kvGetSync<string[]>(ENABLED_STACKS_KV_KEY(source.name)) ?? [],
    }))]);
    const durable = normalize(stored);
    if (normalize(this.listRegistrations()) !== durable) throw new Error('Project registry changed outside this controller; refresh it before certifying recovery');
    return createHash('sha256').update(durable).digest('hex');
  }

  getConfigPath(name: string): string | null {
    const project = this.get(name);
    if (!project) return null;
    return findProjectConfig(project.path);
  }

  getWorkspaceDir(name: string): string {
    return path.join(PROJECTS_DIR, name);
  }

  /** Persist one stack's resume intent before acknowledging or changing runtime. */
  setStackEnabled(projectName: string, stackName: string, enabled: boolean): void {
    const project = this.get(projectName);
    if (!project) throw new Error(`Project '${projectName}' not found`);
    const next = this.store.kvUpdateSync<string[]>(ENABLED_STACKS_KV_KEY(projectName), current => {
      if (this.cachedRevision !== this.catalogRevision()) throw new Error('Project catalogue changed; reload before changing stack intent');
      if (current !== null && (!Array.isArray(current) || current.some(value => typeof value !== 'string'))) {
        throw new Error('Corrupt enabled-stack intent');
      }
      const stacks = new Set(current ?? []);
      if (enabled) stacks.add(stackName); else stacks.delete(stackName);
      return [...stacks].sort();
    });
    project.enabledStacks = next;
  }

  persist(): void {
    if (this.cachedRevision !== this.catalogRevision()) throw new Error('Project catalogue changed; reload before persisting runtime state');
    // Mutations to name/path already wrote through; touch last_seen on
    // every project so an external "I'm still here" ping is cheap to
    // record without restructuring callers.
    // Resume intent has its own atomic write-through API. An older cache
    // must never resurrect a stack another controller has already stopped.
    for (const project of this.projects.values()) {
      if (!project.configuration) this.store.upsertProjectSync({
        name: project.name,
        path: project.path,
        added_at: project.registeredAt,
        last_seen: new Date().toISOString(),
      });
    }
  }

  // ===========================================================================
  // Auto-detect: if CWD has omnitron.config.ts, register it
  // ===========================================================================

  autoDetect(cwd: string = process.cwd()): ISeedProject | null {
    if (isControlPlaneWorkspace(cwd)) return null;
    const configPath = path.join(cwd, 'omnitron.config.ts');
    if (!fs.existsSync(configPath)) return null;

    const existing = Array.from(this.projects.values()).find((p) => p.path === cwd);
    if (existing) return existing;

    const name = path.basename(cwd);
    try {
      return this.add(name, cwd);
    } catch {
      return null;
    }
  }

  // ===========================================================================
  // Private
  // ===========================================================================

  private loadFromStore(): void {
    const projects = new Map<string, ISeedProject>();
    const roots = this.store.selectProjectsSync();
    const rootNames = new Set(roots.map(row => row.name));
    for (const row of roots) {
      const sources = configurationState(this.store.kvGetSync<ConfigurationState>(CONFIGURATIONS_KEY(row.name), { strict: true })).sources;
      for (const record of [{ name: row.name, path: row.path, registeredAt: row.added_at }, ...sources] as ISeedProject[]) {
        if (projects.has(record.name) || (record.configuration && (record.configuration.project !== row.name || rootNames.has(record.name))))
          throw new Error(`Conflicting project configuration identity '${record.name}'`);
        const enabledStacks = this.store.kvGetSync<string[]>(ENABLED_STACKS_KV_KEY(record.name), { strict: true }) ?? undefined;
        projects.set(record.name, { ...record, ...(enabledStacks ? { enabledStacks } : {}) });
      }
    }
    this.projects = projects;
    this.cachedRevision = this.catalogRevision();
  }

  /**
   * One-shot migration: if the legacy JSON registry exists, import
   * it into the SQLite store and unlink. Idempotent — running the
   * new code against an already-migrated host is a no-op.
   */
  private migrateLegacyJsonIfPresent(): void {
    if (!fs.existsSync(LEGACY_REGISTRY_FILE)) return;
    try {
      const raw = JSON.parse(fs.readFileSync(LEGACY_REGISTRY_FILE, 'utf-8')) as IProjectRegistry;
      for (const p of raw.projects ?? []) {
        if (!p?.name || !p?.path) continue;
        if (!this.projects.has(p.name)) {
          this.store.upsertProjectSync({
            name: p.name,
            path: p.path,
            added_at: p.registeredAt ?? new Date().toISOString(),
            last_seen: new Date().toISOString(),
          });
          this.projects.set(p.name, {
            name: p.name,
            path: p.path,
            registeredAt: p.registeredAt ?? new Date().toISOString(),
            ...(p.enabledStacks && { enabledStacks: p.enabledStacks }),
          });
          if (p.enabledStacks) {
            this.store.kvSetSync(ENABLED_STACKS_KV_KEY(p.name), p.enabledStacks);
          }
        }
      }
      this.loadFromStore();
      // Done — drop the file so subsequent boots skip this branch.
      try { fs.unlinkSync(LEGACY_REGISTRY_FILE); } catch { /* best-effort */ }
    } catch (err) {
      // Corrupted legacy file — leave it in place. There is no logger at
      // this point (the constructor caller has none), but silence is the
      // wrong reading of that: the visible effect is every pre-migration
      // project missing from `omnitron project list`, with the file that
      // still holds them sitting on disk unmentioned. stderr is always
      // available, and on the daemon it lands in the daemon log.
      process.stderr.write(
        `[omnitron] legacy project registry at ${LEGACY_REGISTRY_FILE} could not be imported ` +
          `(${(err as Error).message}) — it has been left in place, and projects recorded only ` +
          `there will not be listed\n`
      );
    }
  }
}
