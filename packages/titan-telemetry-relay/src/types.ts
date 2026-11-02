/**
 * Telemetry Relay Types
 *
 * Store-and-forward telemetry pipeline for distributed Titan applications.
 * Data flows: App → Local Buffer → WAL File → Batch Push → Leader Aggregator
 *
 * Designed for unreliable network conditions where the leader (aggregator)
 * may be offline. Followers buffer locally and replay on reconnect.
 *
 * @module titan/modules/telemetry-relay
 */

// =============================================================================
// Telemetry Entry — the universal data unit
// =============================================================================

export interface TelemetryEntry {
  /** Producer-assigned identity retained through retries and WAL replay. Older WAL records may lack it. */
  id?: string;
  /** Entry type for routing at the aggregator */
  type: 'log' | 'metric' | 'event' | 'health' | 'alert';
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Source node identifier */
  nodeId: string;
  /** Source application name */
  app?: string;
  /** Entry payload (type-dependent) */
  data: Record<string, unknown>;
  /** Optional labels for filtering/routing */
  labels?: Record<string, string>;
}

// =============================================================================
// Buffer Configuration
// =============================================================================

export interface TelemetryBufferConfig {
  /** Maximum entries retained in memory before oldest entries are dropped (default: 1000) */
  maxBufferSize?: number;
  /** Flush interval in ms (default: 10_000 — 10s) */
  flushIntervalMs?: number;
  /** Maximum batch size per flush (default: 500) */
  maxBatchSize?: number;
}

// =============================================================================
// WAL (Write-Ahead Log) Configuration
// =============================================================================

export interface TelemetryWalConfig {
  /** WAL file directory (default: ~/.omnitron/wal/) */
  directory?: string;
  /** Maximum WAL file size in bytes (default: 50MB) */
  maxSizeBytes?: number;
  /** Number of WAL segment files to retain (default: 10) */
  maxSegments?: number;
}

// =============================================================================
// Transport — how data reaches the aggregator
// =============================================================================

export interface TelemetryTransport {
  /** Return the number durably accepted by the authenticated recipient. */
  send(entries: TelemetryEntry[]): Promise<number>;
  /** Check if the transport is connected to the aggregator */
  isConnected(): boolean;
  /** Connect to the aggregator */
  connect(): Promise<void>;
  /** Disconnect from the aggregator */
  disconnect(): Promise<void>;
}

// =============================================================================
// Aggregator — receives and stores telemetry
// =============================================================================

export interface TelemetryAggregator {
  /** Receive a batch of entries from a follower node */
  ingest(nodeId: string, entries: TelemetryEntry[]): Promise<number>;
  /** Query stored telemetry */
  query(filter: TelemetryQueryFilter): Promise<TelemetryEntry[]>;
}

export interface TelemetryQueryFilter {
  type?: TelemetryEntry['type'] | TelemetryEntry['type'][];
  nodeId?: string;
  app?: string;
  from?: string;
  to?: string;
  labels?: Record<string, string>;
  limit?: number;
  offset?: number;
}

// =============================================================================
// Module Options
// =============================================================================

export interface TelemetryRelayModuleOptions {
  /** Unique node identifier (auto-generated if not provided) */
  nodeId?: string;
  /** Buffer configuration */
  buffer?: TelemetryBufferConfig;
  /** WAL configuration (set to false to disable WAL) */
  wal?: TelemetryWalConfig | false;
  /** Application-supplied transport, responsible for authenticating its peer. */
  transport?: TelemetryTransport;
  /** Role: 'producer' sends data, 'aggregator' receives and stores */
  role?: 'producer' | 'aggregator' | 'both';
}
