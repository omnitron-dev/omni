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
import { createRequire } from 'node:module';
import { ResilientHandle } from '@omnitron-dev/titan/utils';
import type { IAppDefinition } from '../config/types.js';

// =============================================================================
// Types
// =============================================================================

export interface BuildResult {
  /** Bundled bootstrap path for daemon import (.omnitron-build/bootstrap.js) */
  bootstrapPath: string;
  /** processName → bundled .js path for child processes */
  modulePaths: Map<string, string>;
}

interface WatchHandle {
  ctx: any; // esbuild.BuildContext
  dispose: () => Promise<void>;
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
 * Fix: Find all `require("RELATIVE_PATH/package.json")` patterns in the output and
 * replace them with `require("ABSOLUTE_PATH/package.json")`, resolved from the
 * entry source's app root. Also replace `createRequire(import.meta.url)` with
 * `createRequire(import.meta.url)` (left as-is since require args are now absolute).
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

  // Replace all relative require calls to package.json with absolute paths.
  // Matches: require2("../package.json"), require3('../../package.json'), etc.
  // Preserves the variable name (e.g., require2) since esbuild renames `require`.
  const patched = content.replace(
    /(require\d*)\(["'](\.\.\/)+package\.json["']\)/g,
    `$1("${pkgJsonPath}")`
  );

  if (patched !== content) {
    fs.writeFileSync(outPath, patched, 'utf8');
  }
}

// =============================================================================
// BuildService
// =============================================================================

export class BuildService {
  private readonly watchHandles = new Map<string, WatchHandle[]>();
  private readonly isDev: boolean;
  /**
   * esbuild's Go sidecar can exit out from under us when the last
   * build/watch context is disposed; subsequent calls through the
   * cached module fail with "service is no longer running".
   * ResilientHandle (titan utility) drops the cached module on a
   * fatal error, re-imports, and retries the call once.
   */
  private readonly esbuildHandle = new ResilientHandle<typeof import('esbuild')>({
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
  });

  constructor(isDev = false) {
    this.isDev = isDev;
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
    return this.esbuildHandle.use(async (esbuild) => {
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

      return { bootstrapPath: bootstrapOutPath, modulePaths };
    });
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
    return this.esbuildHandle.use(async (esbuild) => {
      const appDir = this.resolveAppDir(bootstrapAbsPath);
      const outDir = path.join(appDir, '.omnitron-build');

      fs.mkdirSync(outDir, { recursive: true });

      const handles: WatchHandle[] = [];

      // Debounce onChange to coalesce rapid rebuilds
      let debounceTimer: NodeJS.Timeout | null = null;
      const debouncedOnChange = () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(onChange, 300);
      };

      // Watch bootstrap
      const bootstrapCtx = await this.createWatchContext(
        esbuild,
        bootstrapAbsPath,
        path.join(outDir, 'bootstrap.js'),
        debouncedOnChange
      );
      handles.push(bootstrapCtx);

      // Watch each process module
      for (const proc of definition.processes) {
        const moduleSourcePath = this.resolveModuleSource(bootstrapAbsPath, proc.module);
        const outPath = path.join(outDir, `${proc.name}.js`);
        const ctx = await this.createWatchContext(esbuild, moduleSourcePath, outPath, debouncedOnChange);
        handles.push(ctx);
      }

      // Store handles for cleanup
      this.watchHandles.set(appName, handles);
    });
  }

  /**
   * Stop watching a specific app.
   */
  async unwatchApp(appName: string): Promise<void> {
    const handles = this.watchHandles.get(appName);
    if (!handles) return;

    await Promise.all(handles.map((h) => h.dispose()));
    this.watchHandles.delete(appName);
  }

  /**
   * Dispose all watch contexts and clean up.
   */
  async dispose(): Promise<void> {
    const allDispose: Promise<void>[] = [];
    for (const [, handles] of this.watchHandles) {
      for (const h of handles) {
        allDispose.push(h.dispose());
      }
    }
    await Promise.all(allDispose);
    this.watchHandles.clear();
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
    let recreating = false;

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
              if (result.errors.length === 0) {
                patchCreateRequireInOutput(outPath, entryPath);
                consecutiveStaleErrors = 0;
              } else if (this.looksLikeStaleMetafile(result.errors, entryPath)) {
                consecutiveStaleErrors += 1;
                // Schedule context recreation outside the onEnd handler
                // (don't dispose the context that's currently calling us).
                if (!recreating && consecutiveStaleErrors >= 1) {
                  recreating = true;
                  setImmediate(() => {
                    void this.recreateWatchContextSafely(
                      currentCtx,
                      esbuild,
                      buildOptions,
                      (next) => {
                        currentCtx = next;
                        recreating = false;
                        consecutiveStaleErrors = 0;
                      },
                    );
                  });
                }
              }
              if (isInitialBuild) {
                isInitialBuild = false;
                return;
              }
              if (result.errors.length === 0) onRebuild();
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
    await currentCtx.watch();

    return {
      ctx: currentCtx,
      dispose: async () => {
        // currentCtx swaps when we self-heal; always tear down the
        // freshest one.
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
  ): Promise<void> {
    try {
      if (oldCtx) await oldCtx.dispose();
    } catch {
      // Ignore — old ctx is dying anyway
    }
    try {
      const fresh = await esbuild.context(buildOptions());
      await fresh.watch();
      onNewCtx(fresh);
    } catch (err) {
      // Recreate failed — log via this.logger if available; the next
      // rebuild attempt will retry.
      console.error('[BuildService] failed to recreate watch context:', (err as Error).message);
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
