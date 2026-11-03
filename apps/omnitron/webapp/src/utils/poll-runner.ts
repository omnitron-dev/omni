/**
 * The polling policy every console page was writing for itself.
 *
 * Fourteen pages each carried the same shape: a `fetchX` callback that
 * try/catches into `setData` / `setError` / `setLoading`, and a `useEffect`
 * that calls it once and then on a `setInterval` with a hand-picked period —
 * 5s, 10s or 15s depending on the page. Copied fourteen times, three things
 * were missing from every copy:
 *
 *   - **No overlap guard.** When a fetch takes longer than the interval, the
 *     timer fires again anyway and requests pile up. That is not theoretical:
 *     on a loaded machine a daemon round trip runs into seconds, which is
 *     exactly when a console is being watched.
 *   - **No pause when nobody is looking.** A background tab kept polling the
 *     daemon every five seconds indefinitely.
 *   - **Data replaced by failure.** Several pages set `[]` on error, so one
 *     failed poll wiped the table an operator was reading. The last good
 *     answer is more useful than an empty one, as long as the error is shown
 *     beside it.
 *
 * The policy lives here, apart from React, so it can be tested with fake
 * timers rather than a renderer.
 */

export interface PollState<T> {
  /** Last successful result. Kept across failures. */
  data: T | null;
  /** Message from the most recent failure, cleared by the next success. */
  error: string | null;
  /** True until the first attempt settles, either way. */
  loading: boolean;
}

export interface PollRunnerOptions<T> {
  /** Performs one fetch. */
  readonly fetcher: () => Promise<T>;
  /** Called whenever the state changes. */
  readonly onState: (state: PollState<T>) => void;
  /** Turns an unknown throw into something worth showing. */
  readonly describeError?: (err: unknown) => string;
}

const defaultDescribeError = (err: unknown): string =>
  (err as { message?: string })?.message ?? 'Request failed';

/**
 * Runs a fetch on an interval, without the three faults above.
 *
 * Deliberately does NOT own a timer: `tick()` is called by whoever does (a
 * React effect in the app, a fake clock in tests). That keeps the policy —
 * overlap, retention, error shape — separable from the scheduling.
 */
export class PollRunner<T> {
  private state: PollState<T> = { data: null, error: null, loading: true };
  private inFlight: Promise<boolean> | null = null;
  private queuedRefresh: { promise: Promise<boolean>; resolve: (active: boolean) => void; reject: (error: unknown) => void } | null = null;
  private stopped = false;
  private readonly describeError: (err: unknown) => string;

  constructor(private readonly options: PollRunnerOptions<T>) {
    this.describeError = options.describeError ?? defaultDescribeError;
  }

  /** Current state — the same object last handed to `onState`. */
  get current(): PollState<T> {
    return this.state;
  }

  /** True while a fetch is outstanding. */
  get busy(): boolean {
    return this.inFlight !== null;
  }

  /**
   * Run one fetch, unless one is already outstanding.
   *
   * @returns true when the read completes while active, false when stopped or
   *          skipped because the previous one had not come back. A skipped tick is not an error:
   *          the next one will run, and the data is only as stale as the slow
   *          request that is still running.
   */
  tick(): Promise<boolean> {
    if (this.inFlight || this.stopped) return Promise.resolve(false);
    let resolve!: (active: boolean) => void, reject!: (error: unknown) => void;
    const promise = new Promise<boolean>((accept, refuse) => { resolve = accept; reject = refuse; });
    // Install the barrier before invoking even a synchronously throwing fetcher.
    this.inFlight = promise;
    const finish = () => {
      this.inFlight = null;
      const queued = this.queuedRefresh;
      this.queuedRefresh = null;
      if (queued) {
        if (this.stopped) queued.resolve(false);
        else void this.tick().then(queued.resolve, queued.reject);
      }
    };
    void this.read().then(
      (active) => { finish(); resolve(active); },
      (error) => { finish(); reject(error); },
    );
    return promise;
  }

  /** Explicit invalidation must observe a read started after the request. Concurrent
   * invalidations share one queued read; background ticks continue to skip overlap.
   * A later invalidation during that follow-up queues at most one further read. */
  refresh(): Promise<boolean> {
    if (this.stopped) return Promise.resolve(false);
    if (!this.inFlight) return this.tick();
    if (!this.queuedRefresh) {
      let resolve!: (active: boolean) => void, reject!: (error: unknown) => void;
      const promise = new Promise<boolean>((accept, refuse) => { resolve = accept; reject = refuse; });
      this.queuedRefresh = { promise, resolve, reject };
    }
    return this.queuedRefresh.promise;
  }

  private async read(): Promise<boolean> {
    try {
      const data = await this.options.fetcher();
      if (this.stopped) return false;
      this.emit({ data, error: null, loading: false });
    } catch (err) {
      if (this.stopped) return false;
      // Keep `data`: a failed poll must not blank a table someone is reading.
      this.emit({ data: this.state.data, error: this.describeError(err), loading: false });
    }

    return true;
  }

  /**
   * Stop delivering state.
   *
   * A fetch already in flight is not cancellable, but its result is dropped —
   * which is what keeps an unmounted page from setting state.
   */
  stop(): void {
    this.stopped = true;
    this.queuedRefresh?.resolve(false);
    this.queuedRefresh = null;
  }

  /**
   * Deliver state again after a `stop()`.
   *
   * Needed because a React effect's cleanup is not only run at unmount.
   * `StrictMode` mounts, cleans up, and mounts again on purpose — to catch
   * exactly the code that cannot survive it. This class could not: `stop()`
   * was terminal, so the simulated unmount permanently silenced a runner the
   * remount then went on using. The first fetch's result was dropped and no
   * later tick ran, leaving every page built on `usePolledResource` showing
   * its loading state forever — in development, which is where the console
   * is looked at most.
   */
  resume(): void {
    this.stopped = false;
  }

  private emit(next: PollState<T>): void {
    this.state = next;
    this.options.onState(next);
  }
}
