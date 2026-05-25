/**
 * ProcessLifecycleQueue — per-key async mutex with operation
 * classification.
 *
 * The orchestrator runs start / stop / restart / crash-restart-timer
 * against the same app key from many independent code paths (CLI
 * RPCs, file-watcher rebuilds, supervisor crash handlers, the janitor's
 * sweep, deploy hooks). Pre-this-queue each path invented its own
 * locking primitive:
 *
 *   - `startingApps: Map<name, Promise<AppHandle>>` — coalesced same-name
 *     start attempts but did NOT synchronise with `stopApp`.
 *   - `restartCoalescer: Map<name, {inFlight, triggerSerial, ...}>` — fixed
 *     the build-watcher restart storm but lived independently of the
 *     above. A restart racing a stop saw two parallel state machines
 *     and dropped the stop on the floor (audit P0-E).
 *   - `crashRestartTimer` in `AppHandle` — a raw `setTimeout` that
 *     fired during the `await stopChild(...)` window, calling
 *     `startApp` against an app currently being stopped (audit P0-I).
 *
 * The queue collapses these into one primitive: every lifecycle
 * action `{op, run}` is enqueued under the app's name. The queue
 * runs them serially per name, in arrival order. Operations of
 * different types DO observe each other — a stop that arrives while
 * a start is in-flight waits for the start to finish, then runs the
 * stop. The start cannot finish writing "online" after the stop has
 * marked the handle stopped, because both writes happen sequentially
 * on the queue.
 *
 * Cross-key concurrency is unbounded: stop(A) and start(B) run in
 * parallel; only same-key operations serialise.
 *
 * The queue also supports cancellation hooks: `enqueue` accepts an
 * optional `onPreempt` callback fired when a higher-priority op
 * arrives during this op's wait — e.g., the orchestrator's
 * crash-restart timer registers a `restart` op with `onPreempt` that
 * clears the timer when an explicit stop arrives, so the timer
 * doesn't fire after the operator pressed stop. Without preempt,
 * everything runs FIFO.
 */

export type LifecycleOp = 'start' | 'stop' | 'restart' | 'crash-restart';

interface QueueItem<T> {
  op: LifecycleOp;
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
  onPreempt?: () => void;
  preempted: boolean;
}

interface PerKeyQueue {
  /** Items waiting for the head to finish. Head is at [0]. */
  items: QueueItem<unknown>[];
  /** True while the head is executing. */
  running: boolean;
}

export class ProcessLifecycleQueue {
  private readonly queues = new Map<string, PerKeyQueue>();

  /**
   * Enqueue an op against `key`. Resolves with `run()`'s result.
   *
   * If the queue already has a higher-priority op waiting (e.g. an
   * explicit `stop` arrives while a `crash-restart` is queued), the
   * lower-priority op is preempted: `onPreempt` runs, `run()` is
   * never invoked, and the promise rejects with a `LifecyclePreempted`
   * error so the caller can distinguish "the op didn't happen" from
   * "the op happened and failed".
   *
   * Priority (high → low): stop > restart > start > crash-restart.
   * A stop ALWAYS wins over a pending crash-restart timer, because
   * the operator's intent is "this app is going down now, stay down".
   */
  enqueue<T>(key: string, op: LifecycleOp, run: () => Promise<T>, onPreempt?: () => void): Promise<T> {
    const queue = this.getOrCreate(key);
    return new Promise<T>((resolve, reject) => {
      const item: QueueItem<T> = { op, run, resolve, reject, ...(onPreempt && { onPreempt }), preempted: false };

      // Preempt strictly-lower-priority waiting items.
      const incomingPriority = this.priority(op);
      for (let i = queue.items.length - 1; i >= 0; i--) {
        const existing = queue.items[i];
        if (!existing) continue;
        if (i === 0 && queue.running) continue; // running head can't be preempted mid-flight
        if (this.priority(existing.op) >= incomingPriority) continue;
        existing.preempted = true;
        try { existing.onPreempt?.(); } catch { /* best-effort */ }
        queue.items.splice(i, 1);
        existing.reject(new LifecyclePreempted(key, existing.op, op));
      }

      queue.items.push(item as QueueItem<unknown>);
      void this.drain(key);
    });
  }

  /**
   * Cancel every queued op for `key` that hasn't started yet. Used on
   * orchestrator shutdown so deferred restarts don't fire after the
   * daemon has begun tearing down. The running head is left to
   * finish on its own — interrupting an in-flight spawn risks
   * orphan processes.
   */
  cancelPending(key: string, reason: string): void {
    const queue = this.queues.get(key);
    if (!queue) return;
    const startIdx = queue.running ? 1 : 0;
    const toCancel = queue.items.slice(startIdx);
    queue.items.length = startIdx;
    for (const item of toCancel) {
      item.preempted = true;
      try { item.onPreempt?.(); } catch { /* best-effort */ }
      item.reject(new LifecyclePreempted(key, item.op, 'cancel', reason));
    }
  }

  /**
   * True while any op for `key` is queued or running. Used by tests +
   * shutdown logic to wait until the orchestrator is quiescent.
   */
  isBusy(key: string): boolean {
    const queue = this.queues.get(key);
    return !!queue && queue.items.length > 0;
  }

  /** Total queued or running ops across all keys. */
  size(): number {
    let n = 0;
    for (const q of this.queues.values()) n += q.items.length;
    return n;
  }

  private getOrCreate(key: string): PerKeyQueue {
    let q = this.queues.get(key);
    if (!q) {
      q = { items: [], running: false };
      this.queues.set(key, q);
    }
    return q;
  }

  private priority(op: LifecycleOp): number {
    switch (op) {
      case 'stop': return 4;
      case 'restart': return 3;
      case 'start': return 2;
      case 'crash-restart': return 1;
      default: return 0;
    }
  }

  private async drain(key: string): Promise<void> {
    const queue = this.queues.get(key);
    if (!queue || queue.running) return;
    const head = queue.items[0];
    if (!head) {
      // Empty queue — purge to avoid Map leak across long-lived daemons.
      this.queues.delete(key);
      return;
    }
    queue.running = true;
    try {
      const result = await head.run();
      head.resolve(result);
    } catch (err) {
      head.reject(err);
    } finally {
      queue.running = false;
      // Shift the head off — we already resolved/rejected it.
      if (queue.items[0] === head) queue.items.shift();
      void this.drain(key);
    }
  }
}

/**
 * Error thrown when an op is preempted by a higher-priority op
 * arriving on the same key, or when the queue is cancelled at
 * shutdown. Callers can `instanceof`-check this to distinguish
 * "we deliberately skipped this op" from "the op failed".
 */
export class LifecyclePreempted extends Error {
  override readonly name = 'LifecyclePreempted';
  constructor(
    public readonly key: string,
    public readonly preemptedOp: LifecycleOp,
    public readonly byOp: LifecycleOp | 'cancel',
    public readonly reason?: string,
  ) {
    super(
      byOp === 'cancel'
        ? `Lifecycle op '${preemptedOp}' for '${key}' was cancelled${reason ? `: ${reason}` : ''}`
        : `Lifecycle op '${preemptedOp}' for '${key}' was preempted by '${byOp}'`,
    );
  }
}
