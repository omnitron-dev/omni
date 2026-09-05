/**
 * FileWatcher — Watches app source directories for file changes
 *
 * Uses Node.js native `fs.watch({ recursive: true })` (stable since Node 20+).
 * On file change → debounce → orchestrator.restartApp() which handles
 * any topology: single-process, multi-process (server + worker pools), classic fork.
 *
 * Platform note (macOS): `{ recursive: true }` is backed by FSEvents, which
 * behaves materially differently from inotify. The stream takes a few hundred
 * milliseconds to arm after `fs.watch()` returns, and writes in that window
 * are dropped outright — not delivered late. Steady-state delivery then lags
 * by roughly a second. In practice this means an edit made in the first
 * moments after the daemon starts watching may not trigger a restart, and
 * every restart is ~1s behind the save. Node exposes no readiness signal for
 * `fs.watch`, so this is a property of the platform rather than something the
 * watcher can correct; `test/unit/file-watcher.test.ts` documents the
 * measurements and works around it by waiting for observed delivery.
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
    private config: IEcosystemConfig,
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

  /**
   * Bring the watch set in line with a reloaded config.
   *
   * `addApp` and `removeApp` existed for exactly this and had no caller
   * outside their test, so a config reload — `omnitron reload`, or SIGHUP —
   * updated the orchestrator and the daemon's RPC snapshot and left the
   * watcher on the old set. An app added to the config was never watched
   * until the next daemon restart, and an app removed from it kept its
   * watchers: edits to a file under a deleted app went on restarting
   * something the config no longer describes.
   *
   * Renaming counts as both, which is the case that makes doing this by hand
   * at the call site error-prone.
   */
  applyConfig(config: IEcosystemConfig): void {
    this.config = config;
    if (!this.running) return;

    const desired = new Map(
      config.apps.filter((a) => a.enabled !== false).map((a) => [a.name, a] as const)
    );

    for (const name of [...this.apps.keys()]) {
      if (!desired.has(name)) this.removeApp(name);
    }
    for (const [name, entry] of desired) {
      if (!this.apps.has(name)) this.addApp(entry);
    }
  }

  /** Get list of watched apps and their directories */
  getWatchedApps(): Array<{ name: string; directory: string }> {
    return Array.from(this.apps.values()).map((a) => ({
      name: a.entry.name,
      directory: a.watchDir,
    }));
  }

  /**
   * The single call into the platform watcher.
   *
   * Exists as an overridable seam because the behaviour worth testing here —
   * ignore rules, debouncing, the restart queue — is this class's, while
   * `fs.watch` on macOS is FSEvents: it drops writes issued before the stream
   * arms and then delivers with a delay measured in seconds (3.6s under load
   * in one measured run). Driving the tests through real file writes made
   * them slow, flaky, and — before they were rewritten — silently vacuous.
   * Tests substitute a deterministic emitter through this method; one
   * end-to-end case still exercises the real thing.
   *
   * Production callers must not override it.
   */
  protected watchDirectory(dir: string, onEvent: (eventType: string, filename: string | null) => void): fs.FSWatcher {
    return fs.watch(dir, { recursive: true }, onEvent);
  }

  private watchApp(entry: IEcosystemAppEntry): void {
    // If explicitly disabled
    if (entry.watch === false) {
      this.logger.debug({ app: entry.name }, 'File watching disabled for this app');
      return;
    }

    // Bootstrap-mode apps get their import graph watched precisely by
    // BuildService (esbuild context.watch) — running fs.watch on the same
    // tree on top of that would deliver duplicate restart triggers (often
    // staggered, often within the same debounce window) and was a primary
    // contributor to the dev-mode restart storms. esbuild watch knows
    // EXACTLY which files contribute to the bundle; fs.watch is a
    // strictly less-precise superset that includes generated files,
    // editor scratch artefacts, and unrelated paths.
    if (entry.bootstrap) {
      this.logger.debug(
        { app: entry.name },
        'Bootstrap-mode app — using esbuild import-graph watcher only (fs.watch skipped)'
      );
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
          // ERROR — not WARN — because a missing watch directory means
          // dev-mode hot reload is silently broken for this app. Misconfig
          // (relative path resolved against the wrong base) used to slip
          // through unnoticed; surface it loudly.
          this.logger.error(
            { app: entry.name, directory: dir, base: entry.cwd ?? this.cwd },
            'Watch directory does not exist — file watching disabled for this path'
          );
          continue;
        }

        const w = this.watchDirectory(dir, (eventType, filename) => {
          if (!filename) return;
          this.onFileChange(watched, filename, eventType);
        });

        w.on('error', (err) => {
          this.logger.error({ app: entry.name, error: (err as Error).message }, 'File watcher error');
        });

        watched.watchers.push(w);
      }

      if (watched.watchers.length === 0) {
        this.logger.error(
          { app: entry.name, attempted: dirs },
          'No valid watch directories — dev-mode hot reload is DISABLED for this app',
        );
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

    // Resolve relative paths against the entry's PROJECT root, not the
    // daemon's cwd. The daemon may have been launched from anywhere; only
    // the entry knows where its config came from. Stamped by the config
    // loader; falls back to daemon cwd only when the entry pre-dates that
    // stamping (e.g., synthetic / test configs).
    const resolveBase = entry.cwd ?? this.cwd;

    // Explicit string — single directory
    if (typeof watchValue === 'string') {
      return {
        dirs: [path.resolve(resolveBase, watchValue)],
        extraIgnore: [],
        debounce: this.debounceMs,
      };
    }

    // Full IWatchConfig
    if (watchValue && typeof watchValue === 'object') {
      const cfg = watchValue as IWatchConfig;
      const dirs = [path.resolve(resolveBase, cfg.directory)];
      if (cfg.include) {
        for (const inc of cfg.include) {
          dirs.push(path.resolve(resolveBase, inc));
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

    const resolved = this.resolveAppRoot(entryFile, resolveBase);
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
    // Don't stack restarts — but don't discard the work either.
    //
    // This branch used to `clear()` the pending set before returning, which
    // is the opposite of what its own comment promised. The `finally` below
    // re-triggers only `if (app.pendingFiles.size > 0)`, so wiping the set
    // here guaranteed that follow-up never happened: every edit made while a
    // restart was in flight was dropped, and the app kept running the code
    // from before those edits with no indication anything had been missed.
    //
    // Leaving the set intact is what makes the existing `finally` hand-off
    // work: the in-flight restart picks the changes up when it completes.
    if (app.restarting) {
      return;
    }

    const changedFiles = [...app.pendingFiles];
    app.pendingFiles.clear();
    app.restarting = true;

    // app.restarting MUST be reset on every exit path — use try-finally from here.
    try {
      const filesDisplay =
        changedFiles.length <= 3
          ? changedFiles.join(', ')
          : `${changedFiles.slice(0, 3).join(', ')} +${changedFiles.length - 3} more`;

      // Clear bootstrap loader cache so daemon re-reads fresh topology
      try {
        const { clearCompileCache } = await import('./ts-compiler.js');
        clearCompileCache();
      } catch {
        // ts-compiler not available — non-critical
      }

      // Skip restart if the app hasn't been started yet (initial boot in progress)
      const appStatus = this.orchestrator.getAppStatus?.(app.entry.name);
      if (appStatus === 'stopped' || appStatus === 'starting') {
        this.logger.debug({ app: app.entry.name }, 'Skipping restart — app still starting');
        return;
      }

      this.logger.info({ app: app.entry.name, files: filesDisplay, count: changedFiles.length }, 'File change detected — restarting');

      // Resolve actual app handle name — in stack mode it's namespaced (e.g., 'omni/dev/main')
      const appName = this.orchestrator.resolveAppName?.(app.entry.name) ?? app.entry.name;

      // …and check it is the same app.
      //
      // `resolveAppName` matches on the short name, which is what makes
      // stack namespacing work: a config entry `main` finds the running
      // `daos/dev/main`. It also makes a DIFFERENT app named `main` find it,
      // and an ecosystem config left in the daemon's working directory —
      // `omnitron init` writes one — declares exactly those names. A change
      // under that config's tree then restarts an app it has nothing to do
      // with.
      //
      // Comparing the entry point settles it: the same app has the same one.
      const handle = this.orchestrator.getHandle?.(appName);
      const runningEntry = handle?.entry?.bootstrap ?? handle?.entry?.script;
      const watchedEntry = app.entry.bootstrap ?? app.entry.script;
      if (handle && runningEntry && watchedEntry && runningEntry !== watchedEntry) {
        this.logger.error(
          { watchedApp: app.entry.name, resolvedTo: appName, watchedEntry, runningEntry },
          'Refusing to restart — the watched config and the running app share a name but not an entry point'
        );
        return;
      }

      try {
        await this.orchestrator.restartApp(appName);
        this.logger.info({ app: appName }, 'Restart complete');
      } catch (err) {
        this.logger.error({ app: appName, error: (err as Error).message }, 'Restart failed');
      }
    } finally {
      app.restarting = false;

      // If more changes accumulated during restart, trigger again
      if (app.pendingFiles.size > 0) {
        void this.triggerRestart(app);
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
  /**
   * The directory to watch for an app, from its entry file.
   *
   * Returns null when the entry file is not where the base says it is,
   * rather than walking up from a path that does not exist.
   *
   * That walk was the defect. `watch: { directory: './apps/storage' }` and
   * `bootstrap: './apps/storage/src/bootstrap.ts'` are relative to the
   * PROJECT root; when `entry.cwd` is unset the base falls back to the
   * daemon's cwd, which here is `apps/omnitron`. Resolving gives
   * `apps/omnitron/apps/storage/src/bootstrap.ts` — nothing — and the walk
   * up from it finds the first `package.json` on the way to the filesystem
   * root, which is `apps/omnitron` itself.
   *
   * So every DAOS app was watching the daemon's own source tree. Editing one
   * file in `src/commands/` restarted all six of them, and editing their own
   * sources restarted nothing: hot reload was broken in both directions and
   * looked like it worked, because restarts kept happening.
   *
   * Measured on this host: `Watching for changes` named
   * `/…/apps/omnitron` for paysys, messaging, storage and priceverse, and
   * one edit to `src/commands/doctor.ts` produced four restarts in the same
   * millisecond.
   */
  private resolveAppRoot(entryPath: string, base: string = this.cwd): string | null {
    const absPath = path.resolve(base, entryPath);

    if (!fs.existsSync(absPath)) {
      this.logger.error(
        { entry: entryPath, base, resolved: absPath },
        'Entry file does not exist at the resolved path — cannot determine a watch directory. ' +
          'A relative entry is resolved against the project root; if the daemon was started elsewhere ' +
          'and the entry carries no cwd, this is where that goes wrong.'
      );
      return null;
    }

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

    // No package.json above it — the entry file's own directory is the best
    // answer available, and it is at least a directory the entry lives in.
    return path.dirname(absPath);
  }
}
