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
 * **Definitions read by the daemon (`freshModuleGraph`):**
 *   In a short-lived process of its own, which answers with the definition as
 *   data. The `?t=` below makes Node import the definition FILE again, but not
 *   the packages it imports: those stay in the importing process's module graph
 *   as they were at their first import, for that process's life — the daemon's
 *   lasts until someone restarts it. Measured 2026-09-27 on the dev master:
 *   `@sample/auth-utils` gained `refuseOwedLegalAcceptance`, storage's definition
 *   began importing it, and dev storage would not start — «The requested module
 *   '@sample/auth-utils' does not provide an export named
 *   'refuseOwedLegalAcceptance'» — through a package rebuild and a `stack
 *   start`, until the daemon itself was restarted; the five apps importing only
 *   older exports had loaded against the stale module all along. `clearCache()`
 *   empties this file's map, never Node's.
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
import { readInFreshProcess, moduleReaderEntry } from '../shared/fresh-module-reader.js';
import type { IAppDefinition } from '../config/types.js';

// Module cache — cleared on dev-mode restarts via clearCache()
const cache = new Map<string, IAppDefinition>();

/** Read-only diagnostics must not import application code or compile its source. */
export function getCachedBootstrapDefinition(bootstrapPath: string): IAppDefinition | undefined {
  return cache.get(path.resolve(bootstrapPath));
}

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
  /**
   * Read the definition in a short-lived process of its own —
   * a module graph that is new on every read — and get it back as data.
   * Production keeps its compiled-file preference; development reads source.
   * Both modes avoid retaining an earlier package module graph in the daemon.
   *
   * For a long-lived READER of definitions, which is the daemon. What it reads
   * is data — the topology, `requires`, `config`, `omnitronConfig`,
   * `shutdown`, the `auth.jwt` flags — and it calls nothing a definition
   * holds. Functions (hooks, route handlers, `auth.rls`,
   * `auth.invocationWrapper`) do not come back, nor do class instances
   * (`auth.manager`, a client): see {@link definitionAsData}. A process that
   * RUNS the app — bootstrap-process, module-worker-process — needs exactly
   * those, and must not ask for this.
   *
   * `timeoutMs` bounds the read (default {@link FRESH_GRAPH_TIMEOUT_MS}); past
   * it the process is killed and the load fails.
   */
  freshModuleGraph?: boolean | { timeoutMs?: number };
}

/** The same input selected by the definition loader, for declaration provenance. */
export function bootstrapDefinitionSource(bootstrapPath: string, devMode = false): string {
  const resolved = path.resolve(bootstrapPath);
  if (devMode || canLoadTypeScript()) return resolved;
  const compiled = toCompiledPath(resolved);
  return compiled && fs.existsSync(compiled) ? compiled : resolved;
}

export async function loadBootstrapConfig(
  bootstrapPath: string,
  options?: LoadBootstrapOptions
): Promise<IAppDefinition> {
  const resolved = path.resolve(bootstrapPath);

  if (options?.freshModuleGraph) {
    const timeoutMs =
      (typeof options.freshModuleGraph === 'object' ? options.freshModuleGraph.timeoutMs : undefined) ??
      FRESH_GRAPH_TIMEOUT_MS;
    const definition = await readInFreshProcess({ entryPath: moduleReaderEntry(import.meta.url, 'bootstrap-loader-child'),
      args: [resolved, options.devMode ? 'development' : 'production'], timeoutMs, label: 'the definition' });
    assertDefinition(definition, bootstrapPath);
    // As every dev load has done: the cache is not read, and is left holding
    // the latest read for a production load of the same path.
    cache.set(resolved, definition);
    return definition;
  }

  // In production, use cache. In dev mode, skip cache for fresh topology.
  if (!options?.devMode) {
    const cached = cache.get(resolved);
    if (cached) return cached;
  }

  let importUrl: string;
  let tempOutputPath: string | undefined;
  /** The source already went through `compileTypeScript`; a failure then is not the tsconfig's. */
  let compiledHere = false;

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
      compiledHere = true;
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

  let mod: Record<string, unknown>;
  try {
    mod = await import(importUrl);
  } catch (err) {
    // A .ts source imported through the process's own TypeScript loader
    // (tsx) is transformed with the tsconfig of the process's WORKING
    // DIRECTORY. The daemon runs from apps/omnitron, whose tsconfig does not
    // include a project's files, so they were transformed without
    // `experimentalDecorators` — measured 2026-09-23 on the master: every
    // payments and messaging definition failed with «Parameter decorators only
    // work when experimental decorators are enabled» as soon as a bootstrap
    // imported a file with a constructor `@Inject`, and both apps fell into
    // single-process mode and crashed there. A child runs from its app's
    // directory and never saw it. The esbuild path below states the
    // decorator settings titan apps are written for, instead of inheriting
    // whichever tsconfig the importer happens to stand in.
    if (!resolved.endsWith('.ts') || compiledHere) throw err;
    const { compileTypeScript } = await import('./ts-compiler.js');
    const result = await compileTypeScript(resolved);
    mod = await import(`${result.outputUrl}?t=${Date.now()}`);
    if (!result.fromCache) tempOutputPath = result.outputPath;
  }

  // Clean up temp compiled file AFTER import completes (no more setTimeout race)
  if (tempOutputPath) {
    try { fs.unlinkSync(tempOutputPath); } catch { /* already deleted */ }
  }

  const definition = mod['default'] ?? mod;
  assertDefinition(definition, bootstrapPath);

  cache.set(resolved, definition);
  return definition;
}

function assertDefinition(definition: unknown, bootstrapPath: string): asserts definition is IAppDefinition {
  const candidate = definition as Partial<IAppDefinition> | null | undefined;
  if (!candidate || !candidate.name || !Array.isArray(candidate.processes) || candidate.processes.length === 0) {
    throw new Error(
      `Invalid bootstrap config at ${bootstrapPath}: must export defineSystem() result with name and processes`
    );
  }
}

// =============================================================================
// A definition read in a process of its own
// =============================================================================

/** How long a definition may take to load in a process of its own. */
export const FRESH_GRAPH_TIMEOUT_MS = 60_000;

/**
 * A definition as the daemon reads it: data.
 *
 * Arrays, plain objects and the primitives JSON carries are kept. A function
 * (a hook, a route handler, `auth.rls`, `auth.invocationWrapper`), a class
 * instance (`auth.manager`, a client, a Map, a Date), a symbol and a bigint are
 * left out — in an array they leave a `null`, as `JSON.stringify` does — and so
 * is a reference back to an object that is still being read, a cycle. An
 * object reached twice without a cycle (one `jwt` block shared by two
 * processes) is kept in both places.
 *
 * The definition itself is read as a record whatever constructed it: the
 * loader has found a name and processes on it, and the rule against class
 * instances is about what it holds.
 *
 * A walk rather than a `JSON.stringify` replacer: `stringify` calls an object's
 * `toJSON` before a replacer is asked about it, so a client that has one would
 * run code on its way out, and a getter that throws would end the whole read
 * rather than cost the one field.
 */
export function definitionAsData(definition: unknown): unknown {
  return toData(definition, new Set(), true);
}

function toData(value: unknown, reading: Set<object>, asRecord = false): unknown {
  if (value === null) return null;
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return value;
    case 'number':
      return Number.isFinite(value) ? value : null;
    case 'object':
      break;
    default:
      // function, symbol, bigint, undefined
      return undefined;
  }

  const object = value as object;
  if (reading.has(object)) return undefined;
  try {
    const isArray = Array.isArray(object);
    if (!isArray && !asRecord) {
      const proto = Object.getPrototypeOf(object);
      if (proto !== Object.prototype && proto !== null) return undefined;
    }
    reading.add(object);
    try {
      if (isArray) {
        const items = object as unknown[];
        const out: unknown[] = [];
        for (let i = 0; i < items.length; i++) {
          out.push(toData(fieldOf(items, i), reading) ?? null);
        }
        return out;
      }
      const entries: Array<[string, unknown]> = [];
      for (const key of Object.keys(object)) {
        const data = toData(fieldOf(object, key), reading);
        if (data !== undefined) entries.push([key, data]);
      }
      // `fromEntries` defines each key as an own property — `__proto__`
      // included, where an assignment would set the prototype.
      return Object.fromEntries(entries);
    } finally {
      reading.delete(object);
    }
  } catch {
    // A proxy whose traps throw, a revoked one: not data.
    return undefined;
  }
}

function fieldOf(holder: object, key: string | number): unknown {
  try {
    return (holder as Record<string | number, unknown>)[key];
  } catch {
    return undefined;
  }
}
