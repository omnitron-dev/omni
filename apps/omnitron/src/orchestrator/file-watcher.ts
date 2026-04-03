/**
 * FileWatcher — Watches app source directories for file changes
 *
 * Uses Node.js native `fs.watch({ recursive: true })` (stable since Node 20+).
 * On file change → debounce → orchestrator.restartApp() which handles
 * any topology: single-process, multi-process (server + worker pools), classic fork.
 *
 * Design:
 *   - One recursive watcher per app directory
 *   - Debounce: 300ms per app (accumulates changes, then triggers single restart)
 *   - Ignore: node_modules, dist, .git, build, coverage, test fixtures
 *   - Restart-aware: won't trigger new restart while one is in progress
 *   - Topology-transparent: orchestrator.restartApp() handles full topology teardown/startup
 */

import fs from 'node:fs';
import path from 'node:path';
import type { ILogger } from '@omnitron-dev/titan/module/logger';
import type { IEcosystemConfig, IEcosystemAppEntry, IWatchConfig } from '../config/types.js';
import type { OrchestratorService } from './orchestrator.service.js';

/** Directories/patterns to always ignore */
const IGNORE_PATTERNS = [
  'node_modules',
  'dist',
  '.git',
  'build',
  'coverage',
  '.turbo',
  '.next',
  '.cache',
  '__pycache__',
  '.omnitron-build',
];

/** File extensions to watch */
const WATCH_EXTENSIONS = new Set([
  '.ts',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.yaml',
  '.yml',
  '.env',
  '.graphql',
  '.gql',
  '.sql',
]);

interface WatchedApp {
  entry: IEcosystemAppEntry;
  watchDir: string;
  watchers: fs.FSWatcher[];
  debounceTimer: NodeJS.Timeout | null;
  pendingFiles: Set<string>;
  restarting: boolean;
  extraIgnore: string[];
  debounceMs: number;
}

export class FileWatcher {
  private readonly apps = new Map<string, WatchedApp>();
  private running = false;

  constructor(
    private readonly logger: ILogger,
    private readonly orchestrator: OrchestratorService,
    private readonly config: IEcosystemConfig,
    private readonly cwd: string,
    private readonly debounceMs: number = 300
  ) {}

  /**
   * Start watching all (or specific) apps.
   * @param appNames - If provided, only watch these apps. Otherwise watch all.
   */
  start(appNames?: string[]): void {
    if (this.running) return;
    this.running = true;

    const entries = appNames
      ? this.config.apps.filter((a) => appNames.includes(a.name))
      : this.config.apps.filter((a) => a.enabled !== false);

    for (const entry of entries) {
      this.watchApp(entry);
    }
  }

  stop(): void {
    this.running = false;

    for (const [, app] of this.apps) {
      for (const w of app.watchers) w.close();
      app.watchers = [];
      if (app.debounceTimer) {
        clearTimeout(app.debounceTimer);
        app.debounceTimer = null;
      }
    }

    this.apps.clear();
    this.logger.info('File watcher stopped');
  }

  /** Dynamically add watch for a new app */
  addApp(entry: IEcosystemAppEntry): void {
    if (!this.running) return;
    if (this.apps.has(entry.name)) return;
    this.watchApp(entry);
  }

  /** Dynamically remove watch for an app */
  removeApp(name: string): void {
    const app = this.apps.get(name);
    if (!app) return;

    for (const w of app.watchers) w.close();
    if (app.debounceTimer) clearTimeout(app.debounceTimer);
    this.apps.delete(name);
    this.logger.debug({ app: name }, 'Stopped watching app');
  }

  /** Get list of watched apps and their directories */
  getWatchedApps(): Array<{ name: string; directory: string }> {
    return Array.from(this.apps.values()).map((a) => ({
      name: a.entry.name,
      directory: a.watchDir,
    }));
  }

  private watchApp(entry: IEcosystemAppEntry): void {
    // If explicitly disabled
    if (entry.watch === false) {
      this.logger.debug({ app: entry.name }, 'File watching disabled for this app');
      return;
    }

    // Resolve watch directories from config
    const { dirs, extraIgnore, debounce } = this.resolveWatchConfig(entry);

    if (dirs.length === 0) {
      this.logger.warn({ app: entry.name }, 'No watch directory resolved — skipping watch');
      return;
    }

    const watched: WatchedApp = {
      entry,
      watchDir: dirs[0]!, // primary directory for display
      watchers: [],
      debounceTimer: null,
      pendingFiles: new Set(),
      restarting: false,
      extraIgnore,
      debounceMs: debounce,
    };

    try {
      for (const dir of dirs) {
        if (!fs.existsSync(dir)) {
          this.logger.warn({ app: entry.name, directory: dir }, 'Watch directory does not exist — skipping');
          continue;
        }

        const w = fs.watch(dir, { recursive: true }, (eventType, filename) => {
          if (!filename) return;
          this.onFileChange(watched, filename, eventType);
        });

        w.on('error', (err) => {
          this.logger.warn({ app: entry.name, error: (err as Error).message }, 'File watcher error');
        });

        watched.watchers.push(w);
      }

      if (watched.watchers.length === 0) {
        this.logger.warn({ app: entry.name }, 'No valid watch directories — skipping');
        return;
      }

      this.apps.set(entry.name, watched);

      const allDirs = dirs.filter((d) => fs.existsSync(d));
      if (allDirs.length === 1) {
        this.logger.info({ app: entry.name, directory: allDirs[0] }, 'Watching for file changes');
      } else {
        this.logger.info({ app: entry.name, directories: allDirs }, 'Watching for file changes');
      }
    } catch (err) {
      this.logger.error({ app: entry.name, error: (err as Error).message }, 'Failed to start file watcher');
    }
  }

  private resolveWatchConfig(entry: IEcosystemAppEntry): {
    dirs: string[];
    extraIgnore: string[];
    debounce: number;
  } {
    const watchValue = entry.watch;

    // Explicit string — single directory
    if (typeof watchValue === 'string') {
      return {
        dirs: [path.resolve(this.cwd, watchValue)],
        extraIgnore: [],
        debounce: this.debounceMs,
      };
    }

    // Full IWatchConfig
    if (watchValue && typeof watchValue === 'object') {
      const cfg = watchValue as IWatchConfig;
      const dirs = [path.resolve(this.cwd, cfg.directory)];
      if (cfg.include) {
        for (const inc of cfg.include) {
          dirs.push(path.resolve(this.cwd, inc));
        }
      }
      return {
        dirs,
        extraIgnore: cfg.ignore ?? [],
        debounce: cfg.debounce ?? this.debounceMs,
      };
    }

    // Auto-detect from bootstrap/script path
    const entryFile = entry.bootstrap ?? entry.script;
    if (!entryFile) {
      return { dirs: [], extraIgnore: [], debounce: this.debounceMs };
    }

    const resolved = this.resolveAppRoot(entryFile);
    return {
      dirs: resolved ? [resolved] : [],
      extraIgnore: [],
      debounce: this.debounceMs,
    };
  }

  private onFileChange(app: WatchedApp, filename: string, _eventType: string): void {
    // Ignore irrelevant files
    if (this.shouldIgnore(filename, app.extraIgnore)) return;

    app.pendingFiles.add(filename);

    // Debounce: wait for rapid changes to settle
    if (app.debounceTimer) {
      clearTimeout(app.debounceTimer);
    }

    app.debounceTimer = setTimeout(() => {
      app.debounceTimer = null;
      this.triggerRestart(app);
    }, app.debounceMs);
  }

  private async triggerRestart(app: WatchedApp): Promise<void> {
    // Don't stack restarts
    if (app.restarting) {
      // Queue another restart after current finishes
      app.pendingFiles.clear();
      return;
    }

    const changedFiles = [...app.pendingFiles];
    app.pendingFiles.clear();
    app.restarting = true;

    const filesDisplay =
      changedFiles.length <= 3
        ? changedFiles.join(', ')
        : `${changedFiles.slice(0, 3).join(', ')} +${changedFiles.length - 3} more`;

    this.logger.info(
      { app: app.entry.name, files: filesDisplay, count: changedFiles.length },
      'File change detected — restarting'
    );

    // Clear bootstrap loader cache so daemon re-reads fresh topology
    try {
      const { clearCompileCache } = await import('./ts-compiler.js');
      clearCompileCache();
    } catch {
      // ts-compiler not available — non-critical
    }
    // Note: esbuild rebuilds are handled by BuildService watch mode
    // or by orchestrator.restartApp() which clears buildResults and rebuilds

    // Skip restart if the app hasn't been started yet (initial boot in progress)
    const appStatus = this.orchestrator.getAppStatus?.(app.entry.name);
    if (appStatus === 'stopped' || appStatus === 'starting') {
      this.logger.debug({ app: app.entry.name }, 'Skipping restart — app still starting');
      return;
    }

    this.logger.info({ app: app.entry.name, files: filesDisplay }, 'File change detected — restarting');

    // Resolve actual app handle name — in stack mode it's namespaced (e.g., 'omni/dev/main')
    const appName = this.orchestrator.resolveAppName?.(app.entry.name) ?? app.entry.name;

    try {
      await this.orchestrator.restartApp(appName);
      this.logger.info({ app: appName }, 'Restart complete');
    } catch (err) {
      this.logger.error({ app: appName, error: (err as Error).message }, 'Restart failed');
    } finally {
      app.restarting = false;

      // If more changes accumulated during restart, trigger again
      if (app.pendingFiles.size > 0) {
        this.triggerRestart(app);
      }
    }
  }

  private shouldIgnore(filename: string, extraIgnore: string[] = []): boolean {
    // Ignore directories/files matching ignore patterns
    const parts = filename.split(path.sep);
    for (const part of parts) {
      if (IGNORE_PATTERNS.includes(part)) return true;
      if (extraIgnore.includes(part)) return true;
      if (part.startsWith('.') && part !== '.env') return true;
    }

    // Only watch known extensions (files without extension are ignored too)
    const ext = path.extname(filename).toLowerCase();
    if (!WATCH_EXTENSIONS.has(ext)) return true;

    return false;
  }

  /**
   * Resolve the app's root directory from its bootstrap/script entry path.
   * Walks up from the entry file until a package.json is found.
   */
  private resolveAppRoot(entryPath: string): string | null {
    const absPath = path.resolve(this.cwd, entryPath);
    let dir = path.dirname(absPath);
    const root = path.parse(dir).root;

    while (dir !== root) {
      if (fs.existsSync(path.join(dir, 'package.json'))) {
        return dir;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }

    // Fallback: use the entry file's directory
    return path.dirname(absPath);
  }
}
