import { executionScopeKey, validateStackExecutionIntent, type ExecutionScope, type StackExecutionIntent } from '../shared/dto/stack-execution.js';
/**
 * State Store — Persist/recover process state across daemon restarts.
 *
 * T-7 migration (this file): backing storage switched from a single
 * atomically-renamed JSON file to a SQLite-backed `state_kv` row via
 * DaemonStateStore. The new path:
 *
 *   - Transactional writes (WAL mode) — no torn-write risk; the
 *     legacy fsync+rename recipe at T#55 is now SQLite's problem,
 *     not ours.
 *   - Co-located with the other 4 daemon-state surfaces (pid-lock,
 *     project registry, node registry, backup index) — one file to
 *     back up, one schema to evolve.
 *   - Same sync API the orchestrator has always used. The legacy
 *     `save/load/clear` signatures are preserved by buffering the
 *     SQLite calls onto a queued promise: writes are fire-and-forget
 *     from the caller's perspective; failure remains observable in status and flush().
 *
 * Back-compat path: when the legacy JSON file (`stateFile`) exists
 * on first `load()`, we one-shot migrate its contents into the SQLite
 * row and unlink the file. After the first migration boot, the JSON
 * file never reappears.
 */

import fs from 'node:fs';
import type { AppStatus } from '../config/types.js';
import type { DaemonStateStore } from './daemon-state-store.service.js';

export interface PersistedAppState {
  name: string;
  pid: number | null;
  status: AppStatus;
  mode: 'classic' | 'bootstrap';
  startedAt: number;
  restarts: number;
  port: number | null;
}

export interface PersistedState {
  version: string;
  updatedAt: number;
  apps: PersistedAppState[];
}

export interface StatePersistenceStatus {
  pending: number;
  failedWrites: number;
  error: string | null;
}

const STATE_KV_KEY = 'orchestrator:persisted-state';

export class StateStore {
  getStackIntent(scope: import('../shared/dto/stack-execution.js').StackExecutionScope): import('../shared/dto/stack-execution.js').StackExecutionIntent {
    return this.getExecutionIntent({ project: scope.project, stack: scope.stack });
  }

  updateStackIntent(scope: import('../shared/dto/stack-execution.js').StackExecutionScope,
    update: (current: import('../shared/dto/stack-execution.js').StackExecutionIntent) => import('../shared/dto/stack-execution.js').StackExecutionIntent,
  ): import('../shared/dto/stack-execution.js').StackExecutionIntent {
    return this.updateExecutionIntent({ project: scope.project, stack: scope.stack }, update);
  }

  getExecutionIntent(scope: ExecutionScope): StackExecutionIntent {
    const key = `execution:${scope.application === undefined ? 'stack' : 'application'}:${executionScopeKey(scope)}`;
    return validateStackExecutionIntent(this.store.kvGetSync(key, { strict: true }));
  }

  updateExecutionIntent(scope: ExecutionScope, update: (current: StackExecutionIntent) => StackExecutionIntent): StackExecutionIntent {
    const key = `execution:${scope.application === undefined ? 'stack' : 'application'}:${executionScopeKey(scope)}`;
    return this.store.kvUpdateSync(key,
      current => validateStackExecutionIntent(update(validateStackExecutionIntent(current))));
  }
  /** Cached snapshot for synchronous `load()` after `init()` ran. */
  private cached: PersistedState | null = null;
  /** True once `init()` has read from SQLite (or attempted the legacy JSON migration). */
  private initialized = false;
  /**
   * In-flight write so a back-to-back save+save serialises through
   * one SQLite transaction at a time. Callers don't see the queueing
   * — they call `save()` synchronously and the promise resolves in
   * the background. Failures remain visible until a later full snapshot or clear succeeds.
   */
  private writeChain: Promise<void> = Promise.resolve();
  private pending = 0;
  private failedWrites = 0;
  private failure: unknown = null;

  persistenceStatus(): StatePersistenceStatus {
    return { pending: this.pending, failedWrites: this.failedWrites,
      error: this.failure === null ? null : String(this.failure instanceof Error ? this.failure.message : this.failure).slice(0, 512) };
  }

  private enqueue(write: () => Promise<void>): void {
    this.pending++;
    // Observe each failure inside the queue, before Node can classify it as an
    // unhandled rejection. Keep the error separately: observing is not an ACK.
    this.writeChain = this.writeChain.then(async () => {
      try { await write(); this.failure = null; }
      catch (error) { this.failure = error ?? new Error('State persistence failed'); this.failedWrites++; }
      finally { this.pending--; }
    });
  }

  constructor(
    private readonly store: DaemonStateStore,
    /**
     * Legacy JSON path — only consulted ONCE during init() for the
     * pre-SQLite migration. Pass the same path the daemon used
     * historically so existing deployments don't lose their state
     * on the first boot of the new code.
     */
    private readonly legacyJsonPath?: string,
  ) {}

  /**
   * Read the persisted snapshot from SQLite. If the legacy JSON file
   * exists and the SQLite row doesn't, migrate it in-place and
   * unlink. Must be awaited at least once before the synchronous
   * `load()` returns useful data.
   */
  async init(): Promise<PersistedState | null> {
    if (this.initialized) return this.cached;
    this.initialized = true;
    try {
      const fromSqlite = await this.store.kvGet<PersistedState>(STATE_KV_KEY);
      if (fromSqlite) {
        this.cached = fromSqlite;
        return this.cached;
      }
      if (this.legacyJsonPath && fs.existsSync(this.legacyJsonPath)) {
        try {
          const raw = fs.readFileSync(this.legacyJsonPath, 'utf-8');
          const parsed = JSON.parse(raw) as PersistedState;
          await this.store.kvSet(STATE_KV_KEY, parsed);
          // Best-effort unlink — keep going even if it fails (perms,
          // file already gone). The kvSet is what matters.
          try { fs.unlinkSync(this.legacyJsonPath); } catch { /* */ }
          this.cached = parsed;
          return this.cached;
        } catch {
          /* legacy file unreadable / corrupt — caller starts from scratch */
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Persist a snapshot. Synchronous API for back-compat with callers
   * that don't await; the actual SQLite write is awaited on the
   * internal `writeChain` so back-to-back saves never interleave.
   */
  save(state: PersistedState): void {
    this.cached = state;
    this.enqueue(() => this.store.kvSet(STATE_KV_KEY, state));
  }

  /** Synchronous read of the snapshot loaded by the most recent `init()` / `save()`. */
  load(): PersistedState | null {
    return this.cached;
  }

  /** Drop the persisted snapshot. Used by crash-recovery acknowledgement. */
  clear(): void {
    this.cached = null;
    this.enqueue(() => this.store.kvDelete(STATE_KV_KEY));
  }

  /** Block until every queued write has reached disk. Called on shutdown. */
  async flush(): Promise<void> {
    let observed: Promise<void>;
    do { observed = this.writeChain; await observed; } while (observed !== this.writeChain);
    if (this.failure !== null) throw this.failure;
  }
}
