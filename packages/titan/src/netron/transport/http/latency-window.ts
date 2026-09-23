/**
 * How long requests took, over the last minute.
 *
 * The server kept an exponential moving average of response time, and fed it
 * the time from the start of `handleRequest` to the moment a handler RETURNED
 * ITS PROMISE — the invocation branches were `return this.handle…(request)`
 * without `await`, so `finally` ran before the work did. The average measured
 * nothing, and an average cannot answer the question an operator asks of
 * latency anyway: how slow were the slow ones.
 *
 * This keeps the durations of the last `windowMs` in a ring of at most
 * `capacity` samples and reads percentiles from them on demand. Reading is
 * rare — the daemon polls every few seconds — so a sort per read costs less
 * than any structure kept up to date on every request, and it needs nothing
 * from the runtime (titan runs on Bun as well as Node, and `perf_hooks`
 * histograms are not a given there).
 *
 * Above `capacity` requests per window the ring holds the most recent
 * `capacity` of them, and the snapshot says how much time they actually
 * cover (`coveredMs`), so a busy minute is never passed off as a full one.
 */

export interface LatencySnapshot {
  /** The window asked for, ms. */
  windowMs: number;
  /** The span the samples actually cover, ms — less than `windowMs` when the ring filled. */
  coveredMs: number;
  /** Requests that finished inside the covered span. */
  count: number;
  mean: number;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  p99: number;
  max: number;
}

export class LatencyWindow {
  private readonly at: Float64Array;
  private readonly took: Float64Array;
  private next = 0;
  private filled = 0;

  constructor(
    private readonly windowMs = 60_000,
    private readonly capacity = 4096,
    private readonly now: () => number = () => performance.now()
  ) {
    this.at = new Float64Array(capacity);
    this.took = new Float64Array(capacity);
  }

  record(durationMs: number): void {
    this.at[this.next] = this.now();
    this.took[this.next] = durationMs;
    this.next = (this.next + 1) % this.capacity;
    if (this.filled < this.capacity) this.filled++;
  }

  /** `null` when no request finished inside the window — «no traffic», not «0 ms». */
  snapshot(): LatencySnapshot | null {
    const now = this.now();
    const since = now - this.windowMs;
    const values: number[] = [];
    let oldest = now;
    for (let i = 0; i < this.filled; i++) {
      const t = this.at[i]!;
      if (t < since) continue;
      values.push(this.took[i]!);
      if (t < oldest) oldest = t;
    }
    if (values.length === 0) return null;

    values.sort((a, b) => a - b);
    const rank = (p: number) => values[Math.min(values.length - 1, Math.ceil((p / 100) * values.length) - 1)]!;
    let sum = 0;
    for (const v of values) sum += v;

    return {
      windowMs: this.windowMs,
      coveredMs: this.filled === this.capacity ? Math.min(this.windowMs, now - oldest) : this.windowMs,
      count: values.length,
      mean: sum / values.length,
      p50: rank(50),
      p75: rank(75),
      p90: rank(90),
      p95: rank(95),
      p99: rank(99),
      max: values[values.length - 1]!,
    };
  }
}
