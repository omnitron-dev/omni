/**
 * Telemetry Relay Service — Store-and-forward telemetry pipeline
 *
 * Architecture:
 *   App/Service → relay.emit(entry) → Buffer → WAL → Transport → Aggregator
 *
 * The relay operates in one of three modes:
 *   - `producer`: Collects and forwards telemetry to a remote aggregator
 *   - `aggregator`: Receives telemetry from remote producers
 *   - `both`: Self-contained (single-node setup, leader daemon)
 *
 * Resilience:
 *   1. Memory buffer batches entries (10s / 1000 entries)
 *   2. On flush, entries are written to WAL before transport
 *   3. If transport fails, entries remain in WAL for retry
 *   4. On reconnect, the retained WAL is replayed in bounded batches
 *   5. WAL segments are rotated (50MB/segment, 10 segments max = 500MB)
 *
 * Bounded queues protect the producer. Delivery is at least once while the WAL
 * retains an entry. Consumers can deduplicate by entry ID after a lost acknowledgement.
 *
 * @module titan/modules/telemetry-relay
 */

import { randomUUID } from 'node:crypto';
import { EventEmitter } from '@omnitron-dev/eventemitter';
import { TelemetryBuffer } from './telemetry-buffer.js';
import { TelemetryWal } from './telemetry-wal.js';
import type {
  TelemetryEntry,
  TelemetryTransport,
  TelemetryRelayModuleOptions,
  TelemetryAggregator,
} from './types.js';

const DEFAULT_NODE_ID = `node-${process.pid}-${Date.now().toString(36)}`;

export class TelemetryRelayService extends EventEmitter {
  readonly nodeId: string;
  readonly role: 'producer' | 'aggregator' | 'both';

  private readonly buffer: TelemetryBuffer;
  private readonly wal: TelemetryWal | null;
  private transport: TelemetryTransport | null;
  private aggregator: TelemetryAggregator | null = null;

  private retryTimer: NodeJS.Timeout | null = null;
  private disposed = false;
  private started = false;
  private delivery: Promise<void> = Promise.resolve();
  private lastError: string | null = null;

  /** Stats */
  totalEmitted = 0;
  totalSent = 0;
  totalFailed = 0;
  totalReceived = 0;

  constructor(options?: TelemetryRelayModuleOptions) {
    super();
    this.nodeId = options?.nodeId ?? DEFAULT_NODE_ID;
    this.role = options?.role ?? 'both';
    this.transport = options?.transport ?? null;

    // Buffer
    this.buffer = new TelemetryBuffer(options?.buffer);
    this.buffer.onDrain(async (entries) => {
      await this.forwardEntries(entries);
    });

    // WAL (disabled when role=aggregator-only or explicitly disabled)
    if (options?.wal === false || this.role === 'aggregator') {
      this.wal = null;
    } else {
      this.wal = new TelemetryWal(typeof options?.wal === 'object' ? options.wal : undefined);
    }
  }

  // ===========================================================================
  // Producer API — emit telemetry entries
  // ===========================================================================

  /**
   * Emit a telemetry entry. This is the main ingestion point.
   * The entry is buffered in memory and periodically flushed to WAL + transport.
   */
  record(entry: Omit<TelemetryEntry, 'nodeId' | 'timestamp'> & { timestamp?: string }): boolean {
    if (this.disposed) return false;

    const fullEntry: TelemetryEntry = {
      ...entry,
      id: entry.id ?? randomUUID(),
      nodeId: this.nodeId,
      timestamp: entry.timestamp ?? new Date().toISOString(),
    };

    this.buffer.push(fullEntry);
    this.totalEmitted++;

    return true;
  }

  /**
   * Convenience: emit a log entry.
   */
  emitLog(app: string, level: string, message: string, labels?: Record<string, string>): void {
    this.record({
      type: 'log',
      app,
      data: { level, message },
      labels,
    });
  }

  /**
   * Convenience: emit a metric entry.
   */
  emitMetric(name: string, value: number, labels?: Record<string, string>, app?: string): void {
    this.record({
      type: 'metric',
      app,
      data: { name, value },
      labels,
    });
  }

  /**
   * Convenience: emit a health status entry.
   */
  emitHealth(app: string, status: string, details?: Record<string, unknown>): void {
    this.record({
      type: 'health',
      app,
      data: { status, ...details },
    });
  }

  // ===========================================================================
  // Aggregator API — receive telemetry from remote producers
  // ===========================================================================

  /**
   * Set the aggregator handler for receiving data from remote nodes.
   */
  setAggregator(aggregator: TelemetryAggregator): void {
    this.aggregator = aggregator;
    if (this.role === 'both' && this.wal && this.started && !this.disposed) void this.forwardEntries([]).catch(() => {});
  }

  /**
   * Accept entries from a peer authenticated by the caller's transport.
   */
  async receive(nodeId: string, entries: TelemetryEntry[]): Promise<number> {
    if (!this.aggregator) return 0;
    const expected = entries.length;
    try {
      if (!nodeId || entries.some(entry => entry.nodeId !== nodeId)) throw new Error('Telemetry source identity mismatch');
      const acknowledged = this.validateAck(await this.aggregator.ingest(nodeId, entries), expected);
      this.totalReceived += acknowledged;
      this.lastError = acknowledged === expected ? null : `Incomplete telemetry acknowledgement: ${acknowledged} of ${expected}`;
      return acknowledged;
    } catch (error) {
      this.totalFailed += expected;
      this.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Start the relay (buffer flushing + WAL replay).
   */
  async start(): Promise<void> {
    if (this.disposed) throw new Error('Telemetry relay has stopped');
    this.started = true;
    this.buffer.start();

    if (this.wal) await this.forwardEntries([]);
  }

  /**
   * Stop the relay gracefully.
   */
  async stop(): Promise<void> {
    this.disposed = true;

    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }

    try {
      await this.buffer.dispose();
      await this.delivery;
    } finally {
      try { await this.transport?.disconnect(); }
      finally { await this.wal?.dispose(); }
    }
  }

  /**
   * Set or replace the transport (for dynamic leader discovery).
   */
  setTransport(transport: TelemetryTransport): void {
    this.transport = transport;
    if (this.wal && this.started && !this.disposed) void this.forwardEntries([]).catch(() => {});
  }

  /**
   * Get relay statistics.
   */
  stats(): {
    nodeId: string;
    role: string;
    buffer: ReturnType<TelemetryBuffer['stats']>;
    wal: ReturnType<TelemetryWal['stats']> | null;
    totalEmitted: number;
    totalSent: number;
    totalFailed: number;
    totalReceived: number;
    lastError: string | null;
    transportConnected: boolean;
  } {
    return {
      nodeId: this.nodeId,
      role: this.role,
      buffer: this.buffer.stats(),
      wal: this.wal?.stats() ?? null,
      totalEmitted: this.totalEmitted,
      totalSent: this.totalSent,
      totalFailed: this.totalFailed,
      totalReceived: this.totalReceived,
      lastError: this.lastError,
      transportConnected: this.transport?.isConnected() ?? false,
    };
  }

  // ===========================================================================
  // Private — Forward entries to WAL + transport
  // ===========================================================================

  private validateAck(count: number, requested: number): number {
    if (!Number.isSafeInteger(count) || count < 0 || count > requested) {
      throw new Error('Invalid telemetry acknowledgement count');
    }
    return count;
  }

  /** Replay, retry and ordinary flush operate on one snapshot at a time. */
  private forwardEntries(entries: TelemetryEntry[]): Promise<void> {
    const current = this.delivery.then(() => this.forward(entries));
    this.delivery = current.catch(() => {});
    return current;
  }

  private async forward(entries: TelemetryEntry[]): Promise<void> {
    let persisted = false;
    let attempted = entries.length;
    try {
      if (this.wal) {
        this.wal.append(entries);
        await this.wal.flush();
        persisted = true;
      }
      const transport = this.transport;
      const local = this.role === 'both' && this.aggregator;
      if (!transport && !local) {
        if (entries.length || this.wal?.stats().totalSize) throw new Error('No telemetry destination configured');
        return;
      }
      // The buffer owns its original batch until success, even if a sink consumes its input array.
      const batches = this.wal ? this.wal.readBatches(this.buffer.maxBatchSize) : [entries.slice()];
      let sent = 0;
      for await (const batch of batches) {
        const expected = batch.length;
        if (!expected) continue;
        attempted = sent + expected;
        let count: number;
        if (transport) {
          if (!transport.isConnected()) await transport.connect();
          if (!transport.isConnected()) throw new Error('Telemetry transport did not connect');
          count = await transport.send(batch);
        } else {
          count = await this.aggregator!.ingest(this.nodeId, batch);
        }
        this.validateAck(count, expected);
        if (count !== expected) throw new Error(`Incomplete telemetry acknowledgement: ${count} of ${expected}`);
        sent += count;
      }
      if (this.wal && sent) {
        this.wal.clear();
        await this.wal.flush();
      }
      this.totalSent += sent;
      this.lastError = null;
    } catch (error) {
      this.totalFailed += attempted;
      this.lastError = error instanceof Error ? error.message : String(error);
      if (!persisted) throw error; // The memory buffer still owns these entries.
      if (this.transport || this.aggregator) this.scheduleRetry();
    }
  }

  private scheduleRetry(): void {
    if (this.retryTimer || this.disposed) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.forwardEntries([]).catch(() => this.scheduleRetry());
    }, 30_000);
    this.retryTimer.unref();
  }
}
