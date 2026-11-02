/** Exact sliding tally of actual restart attempts, independent of lifetime diagnostics. */
export class RestartWindow {
  private readonly buckets = new Map<number, number>();
  private total = 0;
  private clock = 0;

  recent(windowMs = 60_000, now = performance.now()): number {
    if (!Number.isFinite(now)) throw new RangeError('Restart window clock must be finite');
    // Monotonic elapsed milliseconds avoid wall-clock jumps. Coalescing bounds storage by the
    // configured window, even when a custom handler retries many times/ms.
    const window = Number.isFinite(windowMs) && windowMs > 0 ? Math.ceil(windowMs) : 60_000;
    this.clock = Math.max(this.clock, Math.trunc(now));
    const cutoff = this.clock - window;
    for (const [at, count] of this.buckets) {
      if (at > cutoff) break;
      this.buckets.delete(at); this.total -= count;
    }
    return this.total;
  }

  record(windowMs = 60_000, now = performance.now()): number {
    this.recent(windowMs, now);
    this.buckets.set(this.clock, (this.buckets.get(this.clock) ?? 0) + 1);
    return ++this.total;
  }

  clear(): void { this.buckets.clear(); this.total = 0; }
}
