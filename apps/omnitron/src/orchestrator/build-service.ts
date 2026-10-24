/**
 * BuildService — Pre-bundle TypeScript entry points via esbuild
 *
 * Replaces tsx runtime in child processes with pre-bundled JS files.
 * Each process entry point is bundled separately into .omnitron-build/.
 *
 * Pipeline:
 *   bootstrap.ts → BuildService.buildApp() → .omnitron-build/
 *     ├── bootstrap.js       (topology config — for daemon import)
 *     ├── http.js             (app.module bundled — for child process)
 *     ├── worker.js           (worker.module bundled — for child process)
 *     └── *.js.map            (sourcemaps in dev)
 *
 * All packages use "type": "module" — .js is ESM by default.
 * Child processes spawn with plain node (no tsx, no execArgv).
 * esbuild watch mode for dev, fs.watch on dist/ for prod.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { ResilientHandle, type ResetInfo } from '@omnitron-dev/titan/utils';
import type { IAppDefinition } from '../config/types.js';

// =============================================================================
// Types
// =============================================================================

export interface BuildResult {
  /** Bundled bootstrap path for daemon import (.omnitron-build/bootstrap.js) */
  bootstrapPath: string;
  /** processName → bundled .js path for child processes */
  modulePaths: Map<string, string>;
  /** Inputs that determine the process entry graph, independent of bundle bytes. */
  sourceSignature?: string;
}

interface WatchHandle {
  dispose: () => Promise<void>;
}

interface WatchSession {
  closed: boolean;
  handles: WatchHandle[];
  ready: Promise<void>;
  timer: NodeJS.Timeout | null;
  firstChangeAt: number;
}

// =============================================================================
// Plugin: externalize non-relative imports
// =============================================================================

/**
 * esbuild plugin that marks non-relative imports as external — with one
 * important refinement: if a non-relative specifier resolves to a workspace
 * package whose `main`/`exports` points at a TypeScript source file (no
 * compiled `dist/` yet), we BUNDLE it instead of leaving it external.
 *
 * Without this fallback, `await import('@my-org/foo')` at runtime tries to
 * load `foo/src/index.ts` directly, which Node cannot execute (no transpiler
 * in the spawned child) → confusing ERR_UNKNOWN_FILE_EXTENSION at runtime.
 * Bundling untranspiled sources transparently produces a working artifact
 * while keeping all genuine npm deps external (so they get installed
 * normally and benefit from native deduplication).
 *
 * The check is conservative: only specifiers that resolve to `.ts`, `.tsx`,
 * or `.mts` files get bundled. Anything resolving to compiled `.js`/`.cjs`/
 * `.mjs` stays external as before.
 */
function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * SHA-1 of a file's bytes, or `null` on any I/O error. SHA-1 is fine here —
 * we use it only as a fast content-fingerprint to detect "the bundle didn't
 * actually change" and skip a needless restart, not for security.
 */
function hashFileSafe(filePath: string): string | null {
  try {
    return createHash('sha1').update(fs.readFileSync(filePath)).digest('hex');
  } catch {
    return null;
  }
}

function externalizeNonRelativePlugin() {
  // Cache resolution results across onResolve invocations within a single
  // build to keep watch-mode rebuilds snappy.
  const decisionCache = new Map<string, { external: boolean; resolvedPath?: string }>();

  return {
    name: 'externalize-non-relative',
    setup(build: any) {
      build.onResolve({ filter: /^[^./]/ }, (args: any) => {
        // Cache key combines specifier + resolveDir to handle the (rare)
        // case where the same specifier resolves to different files in
        // different parts of the dep tree.
        const cacheKey = `${args.resolveDir}::${args.path}`;
        const cached = decisionCache.get(cacheKey);
        if (cached) {
          return cached.external
            ? { path: args.path, external: true }
            : { path: cached.resolvedPath };
        }

        // Try to resolve from disk as if Node would.
        try {
          const req = createRequire(args.resolveDir + path.sep);
          const resolved = req.resolve(args.path);
          const ext = path.extname(resolved).toLowerCase();
          const isUntranspiledSource = ext === '.ts' || ext === '.tsx' || ext === '.mts';
          if (isUntranspiledSource) {
            decisionCache.set(cacheKey, { external: false, resolvedPath: resolved });
            return { path: resolved };
          }
        } catch {
          // Resolution failed → assume genuine npm dep that will be present
          // in the runtime environment.
        }

        decisionCache.set(cacheKey, { external: true });
        return { path: args.path, external: true };
      });
    },
  };
}

/**
 * Post-process bundled output to fix `createRequire` + relative `require()` calls.
 *
 * Problem: After bundling, multiple source files with `createRequire(import.meta.url)`
 * and different relative paths (e.g., `require('../package.json')` from `src/`,
 * `require('../../package.json')` from `src/config/`) are flattened into one bundle.
 * `import.meta.url` now points to `.omnitron-build/foo.js`, breaking all relative paths.
 *
 * Earlier the patcher rewrote those calls to ABSOLUTE paths
 * (`require("/Users/me/.../package.json")`). The bundles ran on the
 * developer's machine but were non-portable: shipping the artifact to
 * staging/CI surfaced cryptic ENOENT errors against a path that never
 * existed there.
 *
 * Fix (C12): inline the parsed package.json content directly into the
 * bundle. After patching, the runtime never touches the filesystem to
 * read package.json — it reads a JS object literal that captures the
 * fields at build time. The bundle becomes environment-independent and
 * a downstream `verify-bundle-portability.sh` CI gate can refuse to
 * ship anything still containing `/Users/`, `/home/`, or `C:\\`.
 */
function patchCreateRequireInOutput(outPath: string, entrySourcePath: string): void {
  let content: string;
  try {
    content = fs.readFileSync(outPath, 'utf8');
  } catch {
    return;
  }

  if (!content.includes('createRequire')) return;

  // Find the app root (where package.json lives) from the entry source path
  let appRoot = path.dirname(entrySourcePath);
  const fsRoot = path.parse(appRoot).root;
  while (appRoot !== fsRoot) {
    if (fs.existsSync(path.join(appRoot, 'package.json'))) break;
    const parent = path.dirname(appRoot);
    if (parent === appRoot) break;
    appRoot = parent;
  }

  const pkgJsonPath = path.join(appRoot, 'package.json');
  let pkgInline: string;
  try {
    // Inlining the FULL package.json would bake workspace `link:` paths
    // into the bundle (`"@omnitron-dev/foo":"link:/Users/me/..."`), which
    // is exactly the dev-path leakage C12 set out to fix. We project a
    // small allowlist of public-facing string fields — these are what
    // application code actually reads from package.json (version checks,
    // service identification, license/author display). Anything else
    // (dependencies, scripts, exports, devDependencies) is config that
    // belongs in the build environment, not the runtime bundle.
    const parsed = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8')) as Record<string, unknown>;
    const safeFields: ReadonlyArray<keyof typeof parsed> = [
      'name',
      'version',
      'description',
      'keywords',
      'author',
      'license',
      'homepage',
      'bugs',
      'repository',
    ];
    const projection: Record<string, unknown> = {};
    for (const k of safeFields) {
      if (k in parsed) projection[k as string] = parsed[k];
    }
    pkgInline = `(${JSON.stringify(projection)})`;
  } catch {
    // If we can't read package.json (deleted? unreadable?), skip
    // patching — better to leave the relative require in place and
    // let it fail at runtime with a recognizable error than to bake
    // a malformed literal into the bundle.
    return;
  }

  // Replace every relative require to package.json with the inlined
  // object literal. esbuild renames `require` → `require2`/`require3`
  // (digit suffix) AND `createRequire(import.meta.url)` results are
  // commonly assigned to `_require`, `__require`, etc. We must match
  // the WHOLE identifier so the replacement consumes it entirely —
  // otherwise leftover prefix characters end up referencing an
  // undefined identifier (`_({"name": …})` blows up at runtime with
  // `ReferenceError: _ is not defined`).
  //
  // Pattern: identifier ([A-Za-z_$][\w$]*) at a non-identifier
  // boundary, immediately followed by the call.
  let patched = content.replace(
    /(?<![A-Za-z0-9_$])[A-Za-z_$][\w$]*\(["'](?:\.\.\/)+package\.json["']\)/g,
    pkgInline,
  );
  patched = patched.replace(
    new RegExp(
      `(?<![A-Za-z0-9_$])[A-Za-z_$][\\w$]*\\(["']${escapeForRegex(pkgJsonPath)}["']\\)`,
      'g',
    ),
    pkgInline,
  );

  if (patched !== content) {
    fs.writeFileSync(outPath, patched, 'utf8');
  }
}

// =============================================================================
// BuildService
// =============================================================================

export interface BuildServiceTelemetry {
  /** Forwarded from the internal ResilientHandle whenever esbuild resets. */
  onEsbuildReset?: (info: ResetInfo) => void;
  /**
   * Called once per terminal build attempt (not per recovery retry).
   * `kind` is `'build'` for the initial bundle and `'rebuild'` for
   * watch-mode rebuilds. `durationMs` is wall-clock time spent in
   * esbuild; `ok` reflects whether the build produced output.
   */
  onBuildResult?: (info: {
    app: string;
    kind: 'build' | 'rebuild';
    durationMs: number;
    ok: boolean;
  }) => void;
}

export class BuildService {
  private readonly watchHandles = new Map<string, WatchSession>();
  private readonly isDev: boolean;
  private readonly telemetry: BuildServiceTelemetry;
  /**
   * esbuild's Go sidecar can exit out from under us when the last
   * build/watch context is disposed; subsequent calls through the
   * cached module fail with "service is no longer running".
   * ResilientHandle (titan utility) drops the cached module on a
   * fatal error, re-imports, and retries the call once.
   */
  private readonly esbuildHandle: ResilientHandle<typeof import('esbuild')>;

  constructor(isDev = false, telemetry: BuildServiceTelemetry = {}) {
    this.isDev = isDev;
    this.telemetry = telemetry;
    this.esbuildHandle = new ResilientHandle<typeof import('esbuild')>({
      name: 'esbuild',
      factory: async () => {
        try {
          return (await import('esbuild')) as unknown as typeof import('esbuild');
        } catch {
          throw new Error(
            'esbuild is required for the build pipeline. Install it: pnpm add -D esbuild',
          );
        }
      },
      isFatal: (err) => {
        const msg = (err as Error)?.message ?? '';
        return msg.includes('service is no longer running');
      },
      resetCooldownMs: 1000,
      onReset: (info) => this.telemetry.onEsbuildReset?.(info),
    });
  }

  /** Emit a build-result telemetry event. */
  private recordBuildResult(app: string, kind: 'build' | 'rebuild', durationMs: number, ok: boolean): void {
    try {
      this.telemetry.onBuildResult?.({ app, kind, durationMs, ok });
    } catch {
      // Telemetry must never break the build pipeline.
    }
  }

  /**
   * Build all entry points for an app.
   *
   * 1. Bundles the bootstrap.ts file (for daemon topology import)
   * 2. Bundles each process entry module (for child process spawning)
   *
   * Output goes to: apps/<appName>/.omnitron-build/
   */
  async buildApp(
    _appName: string,
    bootstrapAbsPath: string,
    definition: IAppDefinition
  ): Promise<BuildResult> {
    const startedAt = Date.now();
    let ok = false;
    try {
      const result = await this.esbuildHandle.use(async (esbuild) => {
        const appDir = this.resolveAppDir(bootstrapAbsPath);
        const outDir = path.join(appDir, '.omnitron-build');

        // Ensure output directory exists
        fs.mkdirSync(outDir, { recursive: true });

        const modulePaths = new Map<string, string>();

        // Build bootstrap file (for daemon to import topology config)
        const bootstrapOutPath = path.join(outDir, 'bootstrap.js');
        await this.buildEntry(esbuild, bootstrapAbsPath, bootstrapOutPath);

        // Build each process module entry point
        const buildPromises = definition.processes.map(async (proc) => {
          const moduleSourcePath = this.resolveModuleSource(bootstrapAbsPath, proc.module);
          const outPath = path.join(outDir, `${proc.name}.js`);

          await this.buildEntry(esbuild, moduleSourcePath, outPath);
          modulePaths.set(proc.name, outPath);
        });

        await Promise.all(buildPromises);

        return {
          bootstrapPath: bootstrapOutPath,
          modulePaths,
          sourceSignature: this.sourceSignature(bootstrapAbsPath, definition),
        };
      });
      ok = true;
      return result;
    } finally {
      this.recordBuildResult(_appName, 'build', Date.now() - startedAt, ok);
    }
  }

  /**
   * Watch app source files for changes and rebuild on change.
   * Uses esbuild's built-in incremental watch mode for fast rebuilds.
   *
   * @param onChange - Called after successful rebuild (trigger process restart)
   */
  async watchApp(
    appName: string,
    bootstrapAbsPath: string,
    definition: IAppDefinition,
    onChange: () => void
  ): Promise<void> {
    // Publish ownership before the first await: unwatch must also cancel a
    // context that is still being created, not just one already watching.
    const previous = this.unwatchApp(appName);
    const session: WatchSession = {
      closed: false, handles: [], ready: Promise.resolve(), timer: null, firstChangeAt: 0,
    };
    this.watchHandles.set(appName, session);
    const debouncedOnChange = () => {
      if (session.closed) return;
      if (session.firstChangeAt === 0) session.firstChangeAt = Date.now();
      if (session.timer) clearTimeout(session.timer);
      const wait = Math.min(750, Math.max(0, 5_000 - (Date.now() - session.firstChangeAt)));
      session.timer = setTimeout(() => {
        session.firstChangeAt = 0;
        session.timer = null;
        if (!session.closed) onChange();
      }, wait);
    };
    session.ready = (async () => {
      await previous;
      if (session.closed) return;
      await this.esbuildHandle.use(async (esbuild) => {
        const outDir = path.join(this.resolveAppDir(bootstrapAbsPath), '.omnitron-build');
        fs.mkdirSync(outDir, { recursive: true });
        const entries = [
          [bootstrapAbsPath, path.join(outDir, 'bootstrap.js')],
          ...definition.processes.map((proc) => [
            this.resolveModuleSource(bootstrapAbsPath, proc.module), path.join(outDir, `${proc.name}.js`),
          ]),
        ];
        for (const [source, output] of entries) {
          if (session.closed) break;
          session.handles.push(await this.createWatchContext(esbuild, source!, output!, debouncedOnChange));
        }
      });
    })();
    try {
      await session.ready;
    } catch (error) {
      if (this.watchHandles.get(appName) === session) this.watchHandles.delete(appName);
      session.closed = true;
      if (session.timer) clearTimeout(session.timer);
      await Promise.all(session.handles.map((handle) => handle.dispose()));
      throw error;
    }
  }

  /** Revokes callbacks synchronously, then waits for all contexts to stop writing. */
  async unwatchApp(appName: string): Promise<void> {
    const session = this.watchHandles.get(appName);
    if (!session) return;
    this.watchHandles.delete(appName);
    session.closed = true;
    if (session.timer) clearTimeout(session.timer);
    await session.ready.catch(() => {});
    await Promise.all(session.handles.map((handle) => handle.dispose()));
  }

  isWatching(appName: string): boolean {
    return this.watchHandles.has(appName);
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.watchHandles.keys()].map((name) => this.unwatchApp(name)));
  }

  // ===========================================================================
  // Private
  // ===========================================================================

  private async buildEntry(esbuild: any, entryPath: string, outPath: string): Promise<void> {
    const result = await esbuild.build({
      entryPoints: [entryPath],
      outfile: outPath,
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'node22',
      sourcemap: this.isDev,
      plugins: [externalizeNonRelativePlugin()],
      tsconfigRaw: JSON.stringify({
        compilerOptions: {
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          verbatimModuleSyntax: false,
        },
      }),
      logLevel: 'silent',
    });

    if (result.errors.length > 0) {
      const errorMsg = result.errors.map((e: any) => e.text).join('\n');
      throw new Error(`esbuild failed for ${entryPath}:\n${errorMsg}`);
    }

    // Post-process: fix createRequire(import.meta.url) to use original source path
    patchCreateRequireInOutput(outPath, entryPath);
  }

  private async createWatchContext(
    esbuild: any,
    entryPath: string,
    outPath: string,
    onRebuild: () => void,
  ): Promise<WatchHandle> {
    // Self-healing wrapper: when esbuild reports build errors that
    // reference lines past the current source's EOF, the watch
    // context's metafile has gone stale (a file was edited+saved
    // mid-rebuild, or a partial write produced a torn read). Recreating
    // the context with a fresh metafile fixes it. This is rare in
    // practice — every error path triggers a recreate, but errors
    // themselves are operator-typos and equally rare.
    //
    // We track the current ctx in a closure so dispose() always hits
    // the latest one (recreations swap the reference out from under
    // the caller's handle).
    let currentCtx: any = null;
    let consecutiveStaleErrors = 0;
    let disposed = false;
    let recreation: Promise<void> | null = null;
    let recreationTimer: NodeJS.Immediate | null = null;
    // SHA-1 of the previous successful bundle output. If a rebuild produces
    // byte-identical bytes (input mtime touched without an actual content
    // change — common with atime updates, IDE re-saves, formatter idempotency,
    // and concurrent workspace-package rebuilds that emit the same bytes), we
    // skip onRebuild() entirely. Eliminates the dominant source of phantom
    // restart storms.
    let lastBundleHash: string | null = null;

    const buildOptions = (): unknown => ({
      entryPoints: [entryPath],
      outfile: outPath,
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'node22',
      sourcemap: this.isDev,
      plugins: [
        externalizeNonRelativePlugin(),
        {
          name: 'rebuild-notify',
          setup: (build: any) => {
            let isInitialBuild = true;
            build.onEnd((result: any) => {
              if (disposed) return;
              if (result.errors.length === 0) {
                patchCreateRequireInOutput(outPath, entryPath);
                consecutiveStaleErrors = 0;
              } else if (this.looksLikeStaleMetafile(result.errors, entryPath)) {
                consecutiveStaleErrors += 1;
                // Schedule context recreation outside the onEnd handler
                // (don't dispose the context that's currently calling us).
                if (!recreation && !recreationTimer && consecutiveStaleErrors >= 1) {
                  recreationTimer = setImmediate(() => {
                    recreationTimer = null;
                    if (disposed) return;
                    recreation = this.recreateWatchContextSafely(
                      currentCtx, esbuild, buildOptions,
                      (next) => { currentCtx = next; consecutiveStaleErrors = 0; },
                      () => disposed,
                    ).finally(() => { recreation = null; });
                  });
                }
              }
              if (isInitialBuild) {
                // Seed the hash from the initial build so the first
                // legitimate change actually triggers a restart.
                if (result.errors.length === 0) {
                  lastBundleHash = hashFileSafe(outPath);
                }
                isInitialBuild = false;
                return;
              }
              if (result.errors.length > 0) return;
              // Content-equality gate. If esbuild fired onEnd but the output
              // bytes are unchanged, this rebuild was a no-op (some upstream
              // file's mtime moved without altering the bundle) — suppress
              // the restart entirely.
              const nextHash = hashFileSafe(outPath);
              if (nextHash && nextHash === lastBundleHash) return;
              lastBundleHash = nextHash;
              onRebuild();
            });
          },
        },
      ],
      tsconfigRaw: JSON.stringify({
        compilerOptions: {
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          verbatimModuleSyntax: false,
        },
      }),
      logLevel: 'silent',
    });

    currentCtx = await esbuild.context(buildOptions());
    try { await currentCtx.watch(); }
    catch (error) { disposed = true; await currentCtx.dispose(); throw error; }

    return {
      dispose: async () => {
        disposed = true;
        if (recreationTimer) clearImmediate(recreationTimer);
        await recreation;
        if (currentCtx) await currentCtx.dispose();
      },
    };
  }

  /**
   * Detect "build error references a source line past the file's
   * actual length" — the canonical sign that esbuild's metafile is
   * out of sync with disk. Yesterday's bug surfaced exactly this:
   * an error at `apps/main/src/database/repositories/index.ts:299:39`
   * for a file that on disk was 297 lines.
   */
  private looksLikeStaleMetafile(errors: readonly any[], entryPath: string): boolean {
    for (const err of errors) {
      const loc = err?.location;
      if (!loc?.file || typeof loc.line !== 'number') continue;
      try {
        const fullPath = path.isAbsolute(loc.file) ? loc.file : path.resolve(path.dirname(entryPath), loc.file);
        if (!fs.existsSync(fullPath)) continue;
        const fileLines = fs.readFileSync(fullPath, 'utf8').split('\n').length;
        if (loc.line > fileLines + 1) return true; // +1 forgives off-by-one for trailing newlines
      } catch {
        // Ignore — best-effort detection
      }
    }
    return false;
  }

  /**
   * Tear down the current watch context and create a fresh one.
   * Errors during teardown are swallowed — the old ctx is being
   * discarded anyway.
   */
  private async recreateWatchContextSafely(
    oldCtx: any,
    esbuild: any,
    buildOptions: () => unknown,
    onNewCtx: (ctx: any) => void,
    isDisposed: () => boolean,
  ): Promise<void> {
    try {
      if (oldCtx) await oldCtx.dispose();
    } catch {
      // Ignore — old ctx is dying anyway
    }
    let fresh: any = null;
    try {
      if (isDisposed()) { onNewCtx(null); return; }
      fresh = await esbuild.context(buildOptions());
      onNewCtx(fresh);
      if (isDisposed()) return; // dispose() awaits recreation and closes fresh.
      await fresh.watch();
    } catch (err) {
      // Recreate failed — log via this.logger if available; the next
      // rebuild attempt will retry.
      console.error('[BuildService] failed to recreate watch context:', (err as Error).message);
      if (fresh) await fresh.dispose().catch(() => {});
      onNewCtx(null);
    }
  }

  /**
   * Resolve the module source .ts path from a bootstrap-relative module reference.
   *
   * Bootstrap declares `module: './app.module.js'` (relative, .js extension).
   * We resolve to the .ts source file for bundling.
   */
  private resolveModuleSource(bootstrapAbsPath: string, moduleRef: string): string {
    const bootstrapDir = path.dirname(bootstrapAbsPath);
    const resolved = path.resolve(bootstrapDir, moduleRef);

    // Try .ts version first (source), fall back to original
    const tsPath = resolved.replace(/\.js$/, '.ts');
    if (fs.existsSync(tsPath)) {
      return tsPath;
    }

    // Try without extension + .ts
    const withoutExt = resolved.replace(/\.(js|mjs|cjs)$/, '');
    const tsPath2 = withoutExt + '.ts';
    if (fs.existsSync(tsPath2)) {
      return tsPath2;
    }

    // Fall back to original path
    if (fs.existsSync(resolved)) {
      return resolved;
    }

    throw new Error(
      `Cannot resolve module source for '${moduleRef}' from ${bootstrapAbsPath}. ` +
      `Tried: ${tsPath}, ${resolved}`
    );
  }

  /** A watch recompiles existing entry points; it cannot add/remove or retarget them. */
  canReuseBuild(result: BuildResult, bootstrapPath: string, definition: IAppDefinition): boolean {
    return result.sourceSignature === this.sourceSignature(bootstrapPath, definition)
      && result.modulePaths.size === definition.processes.length
      && fs.existsSync(result.bootstrapPath)
      && definition.processes.every((process) => {
        const output = result.modulePaths.get(process.name);
        return output !== undefined && fs.existsSync(output);
      });
  }

  private sourceSignature(bootstrapPath: string, definition: IAppDefinition): string {
    return JSON.stringify({
      bootstrap: path.resolve(bootstrapPath),
      root: this.resolveAppDir(bootstrapPath),
      processes: definition.processes.map(({ name, module }) => [name, path.resolve(path.dirname(bootstrapPath), module)]),
    });
  }

  /**
   * Resolve the app root directory from a bootstrap path.
   * Goes up from src/ to the app root (where package.json lives).
   */
  private resolveAppDir(bootstrapAbsPath: string): string {
    let dir = path.dirname(bootstrapAbsPath);
    const root = path.parse(dir).root;

    while (dir !== root) {
      if (fs.existsSync(path.join(dir, 'package.json'))) {
        return dir;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }

    // Fallback: two levels up from bootstrap (apps/main/src/bootstrap.ts → apps/main/)
    return path.resolve(path.dirname(bootstrapAbsPath), '..');
  }

}
