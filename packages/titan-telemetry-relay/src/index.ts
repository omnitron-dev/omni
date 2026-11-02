/**
 * Telemetry Relay Module
 *
 * Store-and-forward telemetry pipeline for distributed Titan applications.
 *
 * @example Producer (follower node):
 * ```typescript
 * const relay = new TelemetryRelayService({ role: 'producer', nodeId: 'app-2' });
 * relay.setTransport(authenticatedTransport); // Application-supplied
 * await relay.start();
 * relay.emitLog('main', 'info', 'App started');
 * relay.emitMetric('cpu', 45.2, { app: 'main' });
 * ```
 *
 * @example Aggregator (leader node):
 * ```typescript
 * const relay = new TelemetryRelayService({ role: 'aggregator' });
 * relay.setAggregator(pgAggregator); // Writes to PostgreSQL
 * await relay.start();
 * // The application authenticates the peer, then calls relay.receive(verifiedNodeId, entries).
 * ```
 *
 * @example Self-contained (single node):
 * ```typescript
 * const relay = new TelemetryRelayService({ role: 'both' });
 * relay.setAggregator(pgAggregator);
 * await relay.start();
 * relay.emitLog('main', 'info', 'Directly stored');
 * ```
 *
 * @module titan/modules/telemetry-relay
 */

export { TelemetryRelayService } from './telemetry-relay.service.js';
export { TelemetryBuffer } from './telemetry-buffer.js';
export { TelemetryWal } from './telemetry-wal.js';
export type {
  TelemetryEntry,
  TelemetryTransport,
  TelemetryAggregator,
  TelemetryQueryFilter,
  TelemetryBufferConfig,
  TelemetryWalConfig,
  TelemetryRelayModuleOptions,
} from './types.js';
