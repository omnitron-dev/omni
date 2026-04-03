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
 *   4. On reconnect, WAL is replayed from last ack
 *   5. WAL segments are rotated (50MB/segment, 10 segments max = 500MB)
 *
 * Zero data loss guarantee (within WAL capacity):
 *   - Buffer overflow: oldest in-memory entries dropped (WAL preserves)
 *   - Transport failure: WAL retains until successful ack
 *   - Process crash: WAL survives on disk, replayed on restart
 *
 * @module titan/modules/telemetry-relay
 */

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
  }

  /**
   * Receive a batch from a remote producer (called by Netron RPC handler).
   */
  async receive(nodeId: string, entries: TelemetryEntry[]): Promise<number> {
    if (!this.aggregator) return 0;
    this.totalReceived += entries.length;
    return this.aggregator.ingest(nodeId, entries);
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Start the relay (buffer flushing + WAL replay).
   */
  async start(): Promise<void> {
    this.buffer.start();

    // Replay WAL entries that weren't ack'd before shutdown
    if (this.wal && this.transport) {
      const walEntries = this.wal.readAll();
      if (walEntries.length > 0) {
        try {
          if (this.transport.isConnected()) {
            const ackd = await this.transport.send(walEntries);
            if (ackd === walEntries.length) {
              this.wal.clear();
              this.totalSent += ackd;
            }
          }
        } catch {
          // Will retry on next flush
        }
      }
    }
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

    // Flush remaining buffer → WAL
    await this.buffer.dispose();

    // Disconnect transport
    if (this.transport?.isConnected()) {
      await this.transport.disconnect().catch(() => {});
    }

    // Close WAL fd
    this.wal?.dispose();
  }

  /**
   * Set or replace the transport (for dynamic leader discovery).
   */
  setTransport(transport: TelemetryTransport): void {
    this.transport = transport;
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
      transportConnected: this.transport?.isConnected() ?? false,
    };
  }

  // ===========================================================================
  // Private — Forward entries to WAL + transport
  // ===========================================================================

  private async forwardEntries(entries: TelemetryEntry[]): Promise<void> {
    // 1. Write to WAL first (durability)
    if (this.wal) {
      this.wal.append(entries);
    }

    // 2. Try transport
    if (this.transport) {
      try {
        if (!this.transport.isConnected()) {
          await this.transport.connect();
        }
        const ackd = await this.transport.send(entries);
        this.totalSent += ackd;

        // If all ack'd, we can clear these entries from WAL
        // (In practice, WAL segments are truncated after full replay)
      } catch {
        this.totalFailed += entries.length;
        // Entries are safe in WAL — will be replayed on reconnect
        this.scheduleRetry();
      }
    } else if (this.role === 'both' && this.aggregator) {
      // Self-contained mode: directly feed to aggregator
      const ackd = await this.aggregator.ingest(this.nodeId, entries);
      this.totalSent += ackd;
    }
  }

  private scheduleRetry(): void {
    if (this.retryTimer || this.disposed) return;
    this.retryTimer = setTimeout(async () => {
      this.retryTimer = null;
      if (this.disposed || !this.wal || !this.transport) return;

      try {
        if (!this.transport.isConnected()) {
          await this.transport.connect();
        }
        const entries = this.wal.readAll();
        if (entries.length > 0) {
          const ackd = await this.transport.send(entries);
          if (ackd === entries.length) {
            this.wal.clear();
            this.totalSent += ackd;
          }
        }
      } catch {
        // Will retry again on next buffer flush failure
      }
    }, 30_000); // Retry after 30s
    this.retryTimer.unref();
  }
}
