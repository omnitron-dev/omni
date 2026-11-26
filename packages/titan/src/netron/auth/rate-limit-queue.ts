interface Waiter<Result> {
  key: string;
  priority: number;
  deadline: number;
  nextAttempt: number;
  lastDenial: Result;
  consume: () => Result | Promise<Result>;
  resolve: (result: Result) => void;
  reject: (error: unknown) => void;
  detach?: () => void;
}

/** Waits for one authoritative quota acquisition. Capacity and deadlines are local to the limiter. */
export class RateLimitWaitQueue<Result extends { allowed: boolean }> {
  private readonly waiters = new Set<Waiter<Result>>();
  private readonly active = new Map<string, Waiter<Result>>();
  private timer?: ReturnType<typeof setTimeout>;
  private wakeAt = Infinity;
  private closed = false;

  constructor(
    private readonly capacity: number,
    private readonly timeoutMs: number,
    private readonly retryInMs: (denial: Result) => number
  ) {
    if (![capacity, timeoutMs].every(value => Number.isSafeInteger(value) && value >= 0)) {
      throw new RangeError('Rate limit queue capacity and timeout must be nonnegative integers');
    }
  }

  count(key?: string): number {
    if (key === undefined) return this.waiters.size;
    let count = 0;
    for (const entry of this.waiters) if (entry.key === key) count++;
    return count;
  }

  /** Returns undefined when the initial denial is final. Only a confirmed denial may be retried. */
  wait(key: string, priority: number, denial: Result, consume: () => Result | Promise<Result>, signal?: AbortSignal): Promise<Result> | undefined {
    signal?.throwIfAborted();
    if (this.closed) throw new Error('Rate limiter destroyed');
    if (this.waiters.size >= this.capacity || this.timeoutMs === 0) return undefined;
    const now = performance.now();
    return new Promise<Result>((resolve, reject) => {
      const entry: Waiter<Result> = {
        key, priority, deadline: now + this.timeoutMs, nextAttempt: this.nextAttempt(denial, now),
        lastDenial: denial, consume, resolve, reject,
      };
      if (signal) {
        const abort = () => {
          if (this.remove(entry)) reject(signal.reason);
          this.schedule();
        };
        signal.addEventListener('abort', abort, { once: true });
        entry.detach = () => signal.removeEventListener('abort', abort);
      }
      this.waiters.add(entry);
      this.schedule();
    });
  }

  wake(key: string): void {
    for (const entry of this.waiters) if (entry.key === key) entry.nextAttempt = performance.now();
    this.schedule();
  }

  destroy(): void {
    this.closed = true;
    clearTimeout(this.timer);
    for (const entry of this.waiters) {
      this.remove(entry);
      entry.reject(new Error('Rate limiter destroyed'));
    }
  }

  private remove(entry: Waiter<Result>): boolean {
    entry.detach?.();
    return this.waiters.delete(entry);
  }

  private nextAttempt(denial: Result, now: number): number {
    const delay = this.retryInMs(denial);
    return Number.isFinite(delay) ? now + Math.max(1, delay) : Infinity;
  }

  private schedule(): void {
    if (this.closed) return;
    let next = Infinity;
    for (const entry of this.waiters) {
      // An acquisition already sent to storage must settle on its own result.
      if (this.active.get(entry.key) === entry) continue;
      next = Math.min(next, entry.deadline);
      if (!this.active.has(entry.key)) next = Math.min(next, entry.nextAttempt);
    }
    if (next === this.wakeAt) return;
    clearTimeout(this.timer);
    this.wakeAt = next;
    if (next !== Infinity) {
      const delay = Math.min(2 ** 31 - 1, Math.max(0, Math.ceil(next - performance.now())));
      this.timer = setTimeout(() => this.drain(), delay);
    }
  }

  private drain(): void {
    this.wakeAt = Infinity;
    const now = performance.now();
    // Stable sorting preserves FIFO within a priority. Independent subjects can make progress together.
    for (const entry of [...this.waiters].sort((a, b) => b.priority - a.priority)) {
      if (this.active.get(entry.key) === entry) continue;
      if (entry.deadline <= now) {
        this.remove(entry);
        entry.resolve(entry.lastDenial);
      } else if (!this.active.has(entry.key) && entry.nextAttempt <= now) {
        this.active.set(entry.key, entry);
        void this.acquire(entry);
      }
    }
    this.schedule();
  }

  private async acquire(entry: Waiter<Result>): Promise<void> {
    try {
      const result = await entry.consume();
      if (!this.waiters.has(entry)) return;
      if (result.allowed) {
        this.remove(entry);
        entry.resolve(result);
      } else {
        entry.lastDenial = result;
        entry.nextAttempt = this.nextAttempt(result, performance.now());
      }
    } catch (error) {
      if (this.remove(entry)) entry.reject(error);
    } finally {
      this.active.delete(entry.key);
      this.schedule();
    }
  }
}
