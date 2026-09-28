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
 * **Dev mode, read by the daemon (`freshModuleGraph`):**
 *   In a short-lived process of its own, which answers with the definition as
 *   data. The `?t=` below makes Node import the definition FILE again, but not
 *   the packages it imports: those stay in the importing process's module graph
 *   as they were at their first import, for that process's life — the daemon's
 *   lasts until someone restarts it. Measured 2026-09-27 on the dev master:
 *   `@daos/auth-utils` gained `refuseOwedLegalAcceptance`, storage's definition
 *   began importing it, and dev storage would not start — «The requested module
 *   '@daos/auth-utils' does not provide an export named
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
import { fork, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
  /**
   * With `devMode`: read the definition in a short-lived process of its own —
   * a module graph that is new on every read — and get it back as data.
   * Without `devMode` it changes nothing: a production load is cached for the
   * life of the process by design.
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

export async function loadBootstrapConfig(
  bootstrapPath: string,
  options?: LoadBootstrapOptions
): Promise<IAppDefinition> {
  const resolved = path.resolve(bootstrapPath);

  if (options?.devMode && options.freshModuleGraph) {
    const timeoutMs =
      (typeof options.freshModuleGraph === 'object' ? options.freshModuleGraph.timeoutMs : undefined) ??
      FRESH_GRAPH_TIMEOUT_MS;
    const definition = await readInFreshProcess(resolved, timeoutMs);
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
    // paysys and messaging definition failed with «Parameter decorators only
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

/** Tags the one message the reading process sends, among any a package might. */
export const FRESH_GRAPH_ANSWER = 'omnitron:bootstrap-loader:answer';

/** What the reading process (bootstrap-loader-child.ts) answers, once. */
export type FreshGraphAnswer =
  | { type: typeof FRESH_GRAPH_ANSWER; ok: true; definition: unknown }
  | { type: typeof FRESH_GRAPH_ANSWER; ok: false; message: string; name?: string | undefined; stack?: string | undefined };

/**
 * Set in the reading process's environment. A reading process loads in its own
 * graph, never through another one; if the parent's program ever reached it
 * (see `childExecArgv`), this stops the chain at one link.
 */
const READING_PROCESS_MARK = 'OMNITRON_BOOTSTRAP_LOADER_CHILD';

/** How much of the reading process's stderr an error carries. */
const STDERR_TAIL_CHARS = 4_000;

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

/** Flags `childExecArgv` drops that carry a value, inline or as the next argument. */
const DROPPED_WITH_VALUE = new Set([
  '-e', '--eval', '-p', '--print', '-pe', '--input-type', '--inspect-port', '--debug-port', '--watch-path',
]);

/**
 * This process's Node flags as the reading process should get them.
 *
 * Everything that shapes how modules resolve and load is kept, so the child
 * reads the definition exactly as this process would have — `--import
 * tsx/esm` first of all, which the daemon is started with (spawn-daemon.ts)
 * and `canLoadTypeScript` looks for. What goes is what would make the child a
 * different program than its entry: `-e`/`-p` and their code, which it would
 * run instead (node's own `fork` drops them for the same reason, but only
 * from an unmodified `process.execArgv`); `--input-type`, which node refuses
 * beside a file entry; an inspector flag, whose port is this process's and
 * whose `-brk` would wait for a debugger until the deadline; and watch mode,
 * which restarts where the child must exit.
 */
function childExecArgv(parentArgv: readonly string[]): string[] {
  const kept: string[] = [];
  for (let i = 0; i < parentArgv.length; i++) {
    const arg = parentArgv[i]!;
    const flag = arg.split('=', 1)[0]!;
    if (DROPPED_WITH_VALUE.has(flag)) {
      // `--flag value` takes the next argument with it; `--flag=value` does not.
      if (arg === flag) i++;
      continue;
    }
    if (flag.startsWith('--inspect') || flag.startsWith('--debug') || flag.startsWith('--watch')) continue;
    kept.push(arg);
  }
  return kept;
}

/**
 * The reading process's entry — `.ts` beside the source (tests, tsx), `.js`
 * beside the build — and the Node flags to start it with.
 */
function readingProcessCommand(): { entryPath: string; execArgv: string[] } {
  const here = fileURLToPath(import.meta.url);
  const extension = path.extname(here);
  const entryPath = path.join(path.dirname(here), `bootstrap-loader-child${extension}`);
  const execArgv = childExecArgv(process.execArgv ?? []);
  // A source entry needs a TypeScript loader to start at all. The daemon has
  // one and it was kept above; a test runner may have none of its own.
  if (extension === '.ts' && typeof (globalThis as any).Bun === 'undefined' && !execArgv.some((arg) => arg.includes('tsx'))) {
    execArgv.push('--import', pathToFileURL(createRequire(import.meta.url).resolve('tsx/esm')).href);
  }
  return { entryPath, execArgv };
}

function isAnswer(message: unknown): message is FreshGraphAnswer {
  if (!message || typeof message !== 'object') return false;
  const m = message as Record<string, unknown>;
  if (m['type'] !== FRESH_GRAPH_ANSWER) return false;
  return m['ok'] === true ? 'definition' in m : m['ok'] === false && typeof m['message'] === 'string';
}

/**
 * Read one definition in a process started for it, and wait until that
 * process is gone. Resolves with what it answered; rejects with its error's
 * message when it answered with one, and otherwise with how it ended and the
 * last of its stderr.
 */
function readInFreshProcess(resolved: string, timeoutMs: number): Promise<unknown> {
  if (process.env[READING_PROCESS_MARK]) {
    return Promise.reject(
      new Error(`a process reading a definition does not start another (asked for ${resolved})`),
    );
  }
  const { entryPath, execArgv } = readingProcessCommand();
  if (!fs.existsSync(entryPath)) {
    return Promise.reject(new Error(`the definition reader ${entryPath} is missing — is this build complete?`));
  }

  return new Promise<unknown>((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = fork(entryPath, [resolved], {
        execArgv,
        env: { ...process.env, [READING_PROCESS_MARK]: '1' },
        // Output goes where this process's goes, as an in-process import's
        // would have: stdout directly, stderr passed on below — with its tail
        // kept, for when it is the only explanation there is.
        stdio: ['ignore', 'inherit', 'pipe', 'ipc'],
      });
    } catch (err) {
      reject(new Error(`could not start a process to read the definition: ${(err as Error).message}`, { cause: err }));
      return;
    }

    let answer: FreshGraphAnswer | undefined;
    let exit: { code: number | null; signal: NodeJS.Signals | null } | undefined;
    let channelClosed = false;
    let timedOut = false;
    let concluding = false;
    let settled = false;
    let stderrTail = '';
    const timers: NodeJS.Timeout[] = [];

    const stderrClosed = new Promise<void>((done) => {
      if (!child.stderr) {
        done();
        return;
      }
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        stderrTail = (stderrTail + chunk).slice(-STDERR_TAIL_CHARS);
        process.stderr.write(chunk);
      });
      child.stderr.once('close', () => done());
    });

    const settle = (outcome: () => void): void => {
      if (settled) return;
      settled = true;
      for (const timer of timers) clearTimeout(timer);
      outcome();
    };

    // The answer, if one was sent, has been delivered once the process has
    // exited AND its channel has closed — `exit` alone can come first.
    const conclude = async (): Promise<void> => {
      if (concluding || settled || !exit || !channelClosed) return;
      concluding = true;
      if (answer?.ok) {
        const definition = answer.definition;
        settle(() => resolve(definition));
        return;
      }
      if (answer) {
        const failure = answer;
        settle(() => reject(errorFromAnswer(failure)));
        return;
      }
      // No answer: what the process said on its way out is the explanation,
      // and a moment lets the pipe deliver its last lines — never longer, as
      // something the definition started may hold the pipe open.
      const ended = exit;
      await Promise.race([stderrClosed, new Promise<void>((done) => timers.push(setTimeout(done, 500)))]);
      const how = timedOut
        ? `did not answer within ${timeoutMs / 1000} s and was killed`
        : ended.signal
          ? `was ended by ${ended.signal} before answering`
          : `exited with code ${ended.code} before answering`;
      const said = stderrTail.trim();
      settle(() => reject(new Error(`the process reading the definition ${how}${said ? `:\n${said}` : ''}`)));
    };

    child.on('message', (message: unknown) => {
      if (!answer && isAnswer(message)) answer = message;
    });
    child.once('disconnect', () => {
      channelClosed = true;
      void conclude();
    });
    child.once('exit', (code, signal) => {
      exit = { code, signal };
      // The channel closes right behind the process. Should it not, what
      // arrived by then is all there is.
      timers.push(setTimeout(() => {
        channelClosed = true;
        void conclude();
      }, 1_000));
      void conclude();
    });
    child.on('error', (err) => {
      // Only a process that never started has no exit to wait for.
      if (child.pid === undefined) {
        settle(() => reject(new Error(`could not start a process to read the definition: ${err.message}`, { cause: err })));
      }
    });

    timers.push(setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs));
  });
}

function errorFromAnswer(answer: Extract<FreshGraphAnswer, { ok: false }>): Error {
  // The message is the definition's own, word for word — the caller puts it
  // after «Could not load <app>'s definition from <path>:». The stack it was
  // thrown with, in the reading process, rides along as the cause.
  let cause: Error | undefined;
  if (answer.stack) {
    cause = new Error(answer.message);
    cause.name = answer.name ?? 'Error';
    cause.stack = answer.stack;
  }
  return new Error(answer.message, cause ? { cause } : undefined);
}
