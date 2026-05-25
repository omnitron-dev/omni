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
import { expandPath } from '../shared/paths.js';
import type { ISeedProject, IProjectRegistry } from '../config/types.js';
import type { DaemonStateStore } from '../daemon/daemon-state-store.service.js';

// CJS-style require for the open() factory's lazy DaemonStateStore
// load. The module shape is ESM but we need a synchronous import
// inside a static method that callers can't `await`.
const requireCjs = createRequire(import.meta.url);

const PROJECTS_DIR = expandPath('~/.omnitron/projects');
const LEGACY_REGISTRY_FILE = path.join(PROJECTS_DIR, 'registry.json');
const ENABLED_STACKS_KV_KEY = (name: string) => `project:${name}:enabled-stacks`;

export class ProjectRegistry {
  /**
   * In-memory cache mirroring the persisted state. Reads (list/get)
   * serve from here so legacy callers don't pay an SQLite round-
   * trip per call; mutations write through to SQLite synchronously
   * and update the cache on success.
   */
  private projects = new Map<string, ISeedProject>();

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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const store = new DaemonStateStore(noopLogger);
    return new ProjectRegistry(store);
  }

  // ===========================================================================
  // CRUD — synchronous through-write
  // ===========================================================================

  add(name: string, projectPath: string): ISeedProject {
    const absPath = path.resolve(projectPath);

    const configPath = path.join(absPath, 'omnitron.config.ts');
    if (!fs.existsSync(configPath)) {
      throw new Error(`No omnitron.config.ts found at ${absPath}`);
    }

    if (this.projects.has(name)) {
      throw new Error(`Project '${name}' already registered. Use 'omnitron project remove ${name}' first.`);
    }

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

    const projectDir = path.join(PROJECTS_DIR, name);
    fs.mkdirSync(projectDir, { recursive: true });

    return project;
  }

  remove(name: string): void {
    if (!this.projects.has(name)) throw new Error(`Project '${name}' not found`);
    this.store.deleteProjectSync(name);
    this.store.kvDeleteSync?.(ENABLED_STACKS_KV_KEY(name));
    this.projects.delete(name);
  }

  updatePath(name: string, newPath: string): ISeedProject {
    const project = this.projects.get(name);
    if (!project) throw new Error(`Project '${name}' not found`);

    const absPath = path.resolve(newPath);
    const configPath = path.join(absPath, 'omnitron.config.ts');
    if (!fs.existsSync(configPath)) {
      throw new Error(`No omnitron.config.ts found at ${absPath}`);
    }

    // Derive new registry name from directory basename
    const newName = path.basename(absPath);
    if (newName !== name && this.projects.has(newName)) {
      throw new Error(`Project '${newName}' already registered`);
    }

    // Rename workspace directory if it exists
    if (newName !== name) {
      const oldDir = this.getWorkspaceDir(name);
      const newDir = this.getWorkspaceDir(newName);
      if (fs.existsSync(oldDir)) {
        fs.renameSync(oldDir, newDir);
      } else {
        fs.mkdirSync(newDir, { recursive: true });
      }
      // Rewrite under the new key — drop the old row, insert the new.
      this.store.deleteProjectSync(name);
      this.projects.delete(name);
    }

    const updated: ISeedProject = {
      ...project,
      name: newName,
      path: absPath,
    };
    this.store.upsertProjectSync({
      name: updated.name,
      path: updated.path,
      added_at: updated.registeredAt,
      last_seen: new Date().toISOString(),
    });
    this.projects.set(newName, updated);
    return updated;
  }

  get(name: string): ISeedProject | null {
    return this.projects.get(name) ?? null;
  }

  list(): ISeedProject[] {
    return Array.from(this.projects.values());
  }

  getConfigPath(name: string): string | null {
    const project = this.get(name);
    if (!project) return null;
    return path.join(project.path, 'omnitron.config.ts');
  }

  getWorkspaceDir(name: string): string {
    return path.join(PROJECTS_DIR, name);
  }

  /**
   * Persist the cache to SQLite. Pre-fix this serialised the entire
   * registry to JSON and overwrote the file; now it's a no-op
   * because each mutation already writes through. Kept on the API
   * so external callers (ProjectService.updateProject) compile
   * unchanged.
   */
  persist(): void {
    // Mutations already wrote through. Touch last_seen on every
    // project so an external "I'm still here" ping is cheap to
    // record without restructuring callers.
    for (const project of this.projects.values()) {
      this.store.upsertProjectSync({
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
    try {
      const rows = this.store.selectProjectsSync();
      for (const row of rows) {
        // Rebuild ISeedProject from the row. enabledStacks lives in
        // state_kv (not the projects table) so each project's
        // optional list is fetched separately.
        const enabledStacks = this.store.kvGetSync<string[]>(ENABLED_STACKS_KV_KEY(row.name)) ?? undefined;
        const project: ISeedProject = {
          name: row.name,
          path: row.path,
          registeredAt: row.added_at,
          ...(enabledStacks && { enabledStacks }),
        };
        this.projects.set(row.name, project);
      }
    } catch {
      // First boot — table empty.
    }
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
      // Done — drop the file so subsequent boots skip this branch.
      try { fs.unlinkSync(LEGACY_REGISTRY_FILE); } catch { /* best-effort */ }
    } catch {
      // Corrupted legacy file — leave it in place, log nothing here
      // (the constructor caller has no logger handle).
    }
  }
}
