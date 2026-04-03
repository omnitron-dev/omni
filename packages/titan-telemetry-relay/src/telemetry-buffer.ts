/**
 * Telemetry Buffer — In-memory accumulator with overflow protection
 *
 * Entries are added via `push()` and extracted via `drain()`.
 * When the buffer exceeds `maxSize`, oldest entries are dropped (ring buffer).
 *
 * Thread-safe for single-threaded Node.js (no mutex needed).
 *
 * @module titan/modules/telemetry-relay
 */

import type { TelemetryEntry, TelemetryBufferConfig } from './types.js';

const DEFAULT_MAX_SIZE = 1_000;
const DEFAULT_FLUSH_INTERVAL = 10_000; // 10s
const DEFAULT_MAX_BATCH = 500;

export class TelemetryBuffer {
  private entries: TelemetryEntry[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private onFlush: ((entries: TelemetryEntry[]) => Promise<void>) | null = null;
  private flushing = false;
  private disposed = false;

  readonly maxSize: number;
  readonly flushIntervalMs: number;
  readonly maxBatchSize: number;

  /** Counter: total entries pushed */
  totalPushed = 0;
  /** Counter: total entries dropped (buffer overflow) */
  totalDropped = 0;
  /** Counter: total entries flushed */
  totalFlushed = 0;

  constructor(config?: TelemetryBufferConfig) {
    this.maxSize = config?.maxBufferSize ?? DEFAULT_MAX_SIZE;
    this.flushIntervalMs = config?.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL;
    this.maxBatchSize = config?.maxBatchSize ?? DEFAULT_MAX_BATCH;
  }

  /**
   * Register the flush handler. Called periodically with accumulated entries.
   */
  onDrain(handler: (entries: TelemetryEntry[]) => Promise<void>): void {
    this.onFlush = handler;
  }

  /**
   * Start periodic flushing.
   */
  start(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => {
      this.flush().catch(() => {});
    }, this.flushIntervalMs);
    this.flushTimer.unref();
  }

  /**
   * Stop periodic flushing. Does NOT flush remaining entries.
   * Call `flush()` explicitly before dispose for graceful shutdown.
   */
  stop(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /**
   * Push one or more entries into the buffer.
   * If buffer overflows, oldest entries are silently dropped.
   */
  push(...entries: TelemetryEntry[]): void {
    if (this.disposed) return;

    this.entries.push(...entries);
    this.totalPushed += entries.length;

    // Overflow protection: drop oldest
    if (this.entries.length > this.maxSize) {
      const dropped = this.entries.length - this.maxSize;
      this.entries.splice(0, dropped);
      this.totalDropped += dropped;
    }
  }

  /**
   * Drain up to `maxBatchSize` entries from the buffer.
   * Returns the drained entries (removed from buffer).
   */
  drain(count?: number): TelemetryEntry[] {
    const n = Math.min(count ?? this.maxBatchSize, this.entries.length);
    if (n === 0) return [];
    return this.entries.splice(0, n);
  }

  /**
   * Current buffer size.
   */
  get size(): number {
    return this.entries.length;
  }

  /**
   * Flush the buffer by calling the registered drain handler.
   */
  async flush(): Promise<void> {
    if (this.flushing || this.entries.length === 0 || !this.onFlush) return;
    this.flushing = true;

    try {
      const batch = this.drain();
      if (batch.length > 0) {
        await this.onFlush(batch);
        this.totalFlushed += batch.length;
      }
    } catch {
      // On failure, entries are lost (they were already drained).
      // WAL provides durability — buffer is for performance batching only.
    } finally {
      this.flushing = false;
    }
  }

  /**
   * Graceful shutdown: wait for in-flight flush, then final flush.
   */
  async dispose(): Promise<void> {
    this.disposed = true;
    this.stop();

    // Wait for any in-flight flush
    while (this.flushing) {
      await new Promise((r) => setTimeout(r, 50));
    }

    // Final flush
    await this.flush();
  }

  /**
   * Get buffer statistics.
   */
  stats(): { size: number; totalPushed: number; totalDropped: number; totalFlushed: number } {
    return {
      size: this.entries.length,
      totalPushed: this.totalPushed,
      totalDropped: this.totalDropped,
      totalFlushed: this.totalFlushed,
    };
  }
}
