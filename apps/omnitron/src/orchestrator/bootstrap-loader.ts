/**
 * Bootstrap Loader — Load defineSystem() config from a bootstrap file
 *
 * Resolution strategy depends on context:
 *
 * **Production / daemon process:**
 *   1. Prefer compiled dist/bootstrap.js (no tsx/decorator issues, faster import)
 *   2. Fall back to source .ts if dist/ doesn't exist (Bun, or tsx loaded)
 *
 * **Dev mode (child processes with tsx):**
 *   Always load from source .ts so that code changes are picked up immediately
 *   without requiring a separate build step. tsx handles transpilation on the fly.
 *
 * **Cache:**
 *   Topology definitions are cached in the daemon process since they don't change
 *   at runtime. The cache is explicitly cleared before each dev-mode restart via
 *   `clearCache()` so that topology changes (adding processes, etc.) are picked up.
 *   Child processes always get a fresh Node.js module graph (separate fork).
 */

import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { IAppDefinition } from '../config/types.js';

// Module cache — cleared on dev-mode restarts via clearCache()
const cache = new Map<string, IAppDefinition>();

/**
 * Clear all cached bootstrap definitions.
 * Called by orchestrator before restarting apps in dev mode so that
 * topology changes (new processes, removed workers, etc.) are detected.
 */
export function clearCache(): void {
  cache.clear();
}

/**
 * Clear cached bootstrap definition for a specific app.
 */
export function clearCacheFor(bootstrapPath: string): void {
  cache.delete(path.resolve(bootstrapPath));
}

/**
 * Derive compiled dist/ path from source src/ path.
 * Handles: src/bootstrap.ts → dist/bootstrap.js
 */
function toCompiledPath(sourcePath: string): string | null {
  const srcIdx = sourcePath.lastIndexOf('/src/');
  if (srcIdx === -1) return null;

  const appRoot = sourcePath.substring(0, srcIdx);
  const relativePath = sourcePath.substring(srcIdx + 5); // after "/src/"

  return path.join(appRoot, 'dist', relativePath.replace(/\.ts$/, '.js'));
}

/**
 * Detect whether the current process can load TypeScript natively.
 * True when tsx is registered via --import or when running on Bun.
 */
function canLoadTypeScript(): boolean {
  // Bun handles .ts natively
  if (typeof (globalThis as any).Bun !== 'undefined') return true;

  // Check if tsx/esm is loaded via --import
  const execArgv = process.execArgv ?? [];
  return execArgv.some((arg) => arg.includes('tsx'));
}

export interface LoadBootstrapOptions {
  /** Skip cache and prefer source .ts over compiled dist/ */
  devMode?: boolean;
}

export async function loadBootstrapConfig(
  bootstrapPath: string,
  options?: LoadBootstrapOptions
): Promise<IAppDefinition> {
  const resolved = path.resolve(bootstrapPath);

  // In production, use cache. In dev mode, skip cache for fresh topology.
  if (!options?.devMode) {
    const cached = cache.get(resolved);
    if (cached) return cached;
  }

  let importUrl: string;
  let tempOutputPath: string | undefined;

  if (canLoadTypeScript()) {
    // Child process with tsx or Bun: load source directly
    importUrl = options?.devMode
      ? `${pathToFileURL(resolved).href}?t=${Date.now()}`
      : pathToFileURL(resolved).href;
  } else if (options?.devMode && resolved.endsWith('.ts')) {
    // Daemon process in dev mode: compile TS → JS via esbuild on-the-fly (<10ms)
    // This ensures daemon reads FRESH topology from src/ — not stale dist/
    try {
      const { compileTypeScript } = await import('./ts-compiler.js');
      const result = await compileTypeScript(resolved);
      importUrl = `${result.outputUrl}?t=${Date.now()}`;
      if (!result.fromCache) {
        tempOutputPath = result.outputPath;
      }
    } catch {
      // esbuild not available — fall back to dist/
      const compiledPath = toCompiledPath(resolved);
      const fallbackPath = compiledPath && fs.existsSync(compiledPath) ? compiledPath : resolved;
      importUrl = `${pathToFileURL(fallbackPath).href}?t=${Date.now()}`;
    }
  } else {
    // Production: prefer compiled dist/ (fast, no compilation needed)
    const compiledPath = toCompiledPath(resolved);
    const importPath = compiledPath && fs.existsSync(compiledPath) ? compiledPath : resolved;
    importUrl = pathToFileURL(importPath).href;
  }

  const mod = await import(importUrl);

  // Clean up temp compiled file AFTER import completes (no more setTimeout race)
  if (tempOutputPath) {
    try { fs.unlinkSync(tempOutputPath); } catch { /* already deleted */ }
  }

  const definition: IAppDefinition = mod['default'] ?? mod;

  if (!definition || !definition.name || !Array.isArray(definition.processes) || definition.processes.length === 0) {
    throw new Error(
      `Invalid bootstrap config at ${bootstrapPath}: must export defineSystem() result with name and processes`
    );
  }

  cache.set(resolved, definition);
  return definition;
}
