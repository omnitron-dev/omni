/**
 * TypeScript Compiler — On-the-fly TS→JS compilation for dev mode
 *
 * @deprecated Superseded by BuildService (build-service.ts) which pre-bundles
 * all entry points via esbuild before spawning child processes. This module
 * is retained for bootstrap-loader fallback and classic-launcher compatibility.
 * New code should use BuildService instead.
 *
 * When daemon runs in dev mode, it needs to read bootstrap.ts files
 * from source (not dist/) to get fresh topology and requires declarations.
 * But the daemon process itself runs from compiled JS and can't import .ts.
 *
 * Solution: Use esbuild to compile individual .ts files on-the-fly.
 * esbuild is ~100x faster than tsc (< 10ms per file) and produces
 * standard ES module output that Node.js can import directly.
 *
 * Pipeline:
 *   1. Daemon detects dev mode
 *   2. loadBootstrapConfig requests src/bootstrap.ts
 *   3. ts-compiler compiles it to a temp .mjs file via esbuild
 *   4. Daemon imports the compiled .mjs
 *   5. Temp file is cached until source changes (file mtime check)
 *
 * This approach is:
 *   - Fast: esbuild < 10ms per file
 *   - Reliable: no tsx registration needed in daemon process
 *   - Isolated: temp files don't pollute source or dist
 *   - Cache-aware: recompiles only when source changes
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
// os import removed — cache dir is inside monorepo for package resolution

// =============================================================================
// Types
// =============================================================================

interface CompileResult {
  outputPath: string;
  outputUrl: string;
  fromCache: boolean;
}

interface CacheEntry {
  outputPath: string;
  sourceMtime: number;
}

// =============================================================================
// Compiler
// =============================================================================

const compileCache = new Map<string, CacheEntry>();
// No global cache dir — each compiled file goes next to its source
// so Node.js ESM resolves workspace packages from the correct context.

// (No global cache dir — see getOutputPath below)

/**
 * Compile a TypeScript file to JavaScript using esbuild.
 * Returns the path to the compiled .mjs file.
 *
 * Caching: the compiled output is cached by source file mtime.
 * If the source hasn't changed since last compilation, the cached
 * output is returned instantly (< 1ms).
 *
 * @deprecated Use BuildService.buildApp() instead for full entry point bundling.
 */
export async function compileTypeScript(sourcePath: string): Promise<CompileResult> {
  const absSource = path.resolve(sourcePath);

  // Check source mtime
  let sourceMtime: number;
  try {
    sourceMtime = fs.statSync(absSource).mtimeMs;
  } catch {
    throw new Error(`Source file not found: ${absSource}`);
  }

  // Check cache
  const cached = compileCache.get(absSource);
  if (cached && cached.sourceMtime === sourceMtime && fs.existsSync(cached.outputPath)) {
    return {
      outputPath: cached.outputPath,
      outputUrl: pathToFileURL(cached.outputPath).href,
      fromCache: true,
    };
  }

  // Compile with esbuild
  const esbuild = await loadEsbuild();
  if (!esbuild) {
    throw new Error(
      'esbuild is required for dev mode TypeScript compilation. ' +
      'Install it: pnpm add -D esbuild'
    );
  }

  // Place compiled file next to source — required for correct relative import
  // resolution (e.g., createRequire('../package.json'), import('./app.module.js')).
  // The file is named with .omnitron-compiled.mjs suffix and gitignored via *.omnitron-compiled.mjs
  const sourceDir = path.dirname(absSource);
  const baseName = path.basename(absSource, path.extname(absSource));
  const outputPath = path.join(sourceDir, `${baseName}.omnitron-compiled.mjs`);

  const result = await esbuild.build({
    entryPoints: [absSource],
    outfile: outputPath,
    bundle: true, // Bundle to resolve relative imports
    format: 'esm',
    platform: 'node',
    target: 'node22',
    sourcemap: false,
    // External: all non-relative imports (workspace packages, npm deps)
    // This prevents bundling the entire DI tree — we only need the
    // static defineSystem() return value (name, requires, transports, processes)
    // Mark ALL non-relative imports as external.
    // We only need to transpile TS→JS and resolve relative imports
    // within the app directory. Everything else (npm, workspace) stays as import().
    plugins: [{
      name: 'externalize-non-relative',
      setup(build: any) {
        // Mark all non-relative, non-absolute imports as external
        build.onResolve({ filter: /^[^./]/ }, (args: any) => ({
          path: args.path,
          external: true,
        }));
      },
    }],
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
    throw new Error(`TypeScript compilation failed for ${absSource}:\n${errorMsg}`);
  }

  // Update cache
  compileCache.set(absSource, { outputPath, sourceMtime });

  return {
    outputPath,
    outputUrl: pathToFileURL(outputPath).href,
    fromCache: false,
  };
}

/**
 * Clear the compilation cache (for explicit invalidation).
 */
export function clearCompileCache(): void {
  compileCache.clear();
}

/**
 * Check if esbuild is available.
 */
export async function isEsbuildAvailable(): Promise<boolean> {
  return (await loadEsbuild()) !== null;
}

// =============================================================================
// Private
// =============================================================================

let _esbuild: any = null;

async function loadEsbuild(): Promise<any> {
  if (_esbuild !== null) return _esbuild;
  try {
    _esbuild = await import('esbuild');
    return _esbuild;
  } catch {
    _esbuild = false; // Mark as unavailable
    return null;
  }
}

// Hash helper available if needed for cache key generation
/*
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}
*/
