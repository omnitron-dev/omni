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
 * esbuild plugin that marks all non-relative, non-absolute imports as external.
 * Workspace packages (@omnitron-dev/*) and npm deps stay as runtime imports.
 * Only relative imports within the app are bundled (TS→JS transpilation).
 */
function externalizeNonRelativePlugin() {
  return {
    name: 'externalize-non-relative',
    setup(build: any) {
      build.onResolve({ filter: /^[^./]/ }, (args: any) => ({
        path: args.path,
        external: true,
      }));
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
  private esbuild: any = null;
  private readonly isDev: boolean;

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
    const esbuild = await this.loadEsbuild();
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
    const esbuild = await this.loadEsbuild();
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
    onRebuild: () => void
  ): Promise<WatchHandle> {
    const ctx = await esbuild.context({
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
          setup(build: any) {
            // Skip the initial build notification — only fire on subsequent rebuilds.
            // esbuild watch triggers onEnd for the initial build too, which would
            // cause a premature restart before the app finishes starting.
            let isInitialBuild = true;
            build.onEnd((result: any) => {
              if (result.errors.length === 0) {
                // Post-process each rebuild output
                patchCreateRequireInOutput(outPath, entryPath);
              }
              if (isInitialBuild) {
                isInitialBuild = false;
                return;
              }
              if (result.errors.length === 0) {
                onRebuild();
              }
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

    await ctx.watch();

    return {
      ctx,
      dispose: async () => {
        await ctx.dispose();
      },
    };
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

  private async loadEsbuild(): Promise<any> {
    if (this.esbuild) return this.esbuild;
    try {
      this.esbuild = await import('esbuild');
      return this.esbuild;
    } catch {
      throw new Error(
        'esbuild is required for the build pipeline. Install it: pnpm add -D esbuild'
      );
    }
  }
}
