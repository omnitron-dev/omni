/**
 * Omnitron Telemetry Service — Wires TelemetryRelay into the daemon
 *
 * In single-node (dev) mode: role='both' — records and stores locally.
 * In cluster mode: leader=aggregator, followers=producers via Netron TCP.
 *
 * Aggregator stores telemetry in omnitron-pg via LogCollectorService (logs)
 * and will store metrics in metrics_raw table when Phase 2 is complete.
 */

import type { Kysely } from 'kysely';
import type { ILogger } from '@omnitron-dev/titan/module/logger';
import {
  TelemetryRelayService,
  type TelemetryEntry,
  type TelemetryAggregator,
} from '@omnitron-dev/titan-telemetry-relay';
import type { OmnitronDatabase } from '../database/schema.js';
import type { LogCollectorService } from './log-collector.service.js';

// =============================================================================
// PG Aggregator — stores telemetry in omnitron-pg
// =============================================================================

class PgTelemetryAggregator implements TelemetryAggregator {
  constructor(
    private readonly logCollector: LogCollectorService,
    private readonly logger: ILogger
  ) {}

  async ingest(nodeId: string, entries: TelemetryEntry[]): Promise<number> {
    let ingested = 0;

    // Batch by type for efficient storage
    const logs: TelemetryEntry[] = [];
    const metricEntries: TelemetryEntry[] = [];
    const healthEntries: TelemetryEntry[] = [];

    for (const entry of entries) {
      switch (entry.type) {
        case 'log':
          logs.push(entry);
          break;
        case 'metric':
          metricEntries.push(entry);
          break;
        case 'health':
          healthEntries.push(entry);
          break;
        default:
          // event, alert — store as log with type label
          logs.push(entry);
          break;
      }
    }

    // Ingest logs
    if (logs.length > 0) {
      try {
        await this.logCollector.ingestBatch(
          logs.map((e) => ({
            app: e.app ?? 'unknown',
            level: (e.data['level'] as string) ?? 'info',
            message: (e.data['message'] as string) ?? JSON.stringify(e.data),
            labels: { ...e.labels, nodeId, type: e.type },
            traceId: (e.data['traceId'] as string) ?? null,
            spanId: (e.data['spanId'] as string) ?? null,
          }))
        );
        ingested += logs.length;
      } catch (err) {
        this.logger.warn({ error: (err as Error).message, count: logs.length }, 'Failed to ingest telemetry logs');
      }
    }

    // Metrics are now handled by TitanMetricsModule — telemetry relay just counts them
    ingested += metricEntries.length;

    // Process health entries (update node health state)
    for (const _entry of healthEntries) {
      // Future: update nodes table with health status
      ingested++;
    }

    return ingested;
  }

  async query(): Promise<TelemetryEntry[]> {
    // Query delegates to LogCollectorService for now
    return [];
  }
}

// =============================================================================
// Factory
// =============================================================================

export interface TelemetryServiceDeps {
  db: Kysely<OmnitronDatabase>;
  logCollector: LogCollectorService;
  logger: ILogger;
  nodeId?: string;
  isLeader?: boolean;
}

/**
 * Create and configure the TelemetryRelayService for the daemon.
 */
export function createTelemetryRelay(deps: TelemetryServiceDeps): TelemetryRelayService {
  const role = deps.isLeader !== false ? 'both' : 'producer';

  const relay = new TelemetryRelayService({
    nodeId: deps.nodeId ?? `omnitron-${process.pid}`,
    role,
    buffer: {
      maxBufferSize: 5_000,
      flushIntervalMs: 5_000, // 5s flush for telemetry
      maxBatchSize: 1_000,
    },
    wal: role === 'producer' ? { maxSizeBytes: 50 * 1024 * 1024, maxSegments: 10 } : false,
  });

  // Set up aggregator (for 'both' role — leader stores telemetry locally)
  if (role === 'both') {
    const aggregator = new PgTelemetryAggregator(deps.logCollector, deps.logger);
    relay.setAggregator(aggregator);
  }

  return relay;
}

/**
 * Wire the relay into the orchestrator's log pipeline.
 * Every app log line goes through the relay for unified telemetry.
 */
export function wireTelemetryToOrchestrator(
  relay: TelemetryRelayService,
  onAppLog: (handler: (appName: string, line: string) => void) => void
): void {
  onAppLog((appName, line) => {
    // Parse pino JSON line
    let level = 'info';
    let message = line;
    try {
      const parsed = JSON.parse(line);
      level = pinoLevelToString(parsed.level ?? 30);
      message = parsed.msg ?? parsed.message ?? line;
    } catch {
      // Plain text — use as-is
    }

    relay.record({
      type: 'log',
      app: appName,
      data: { level, message },
    });
  });
}

function pinoLevelToString(level: number): string {
  if (level <= 10) return 'trace';
  if (level <= 20) return 'debug';
  if (level <= 30) return 'info';
  if (level <= 40) return 'warn';
  if (level <= 50) return 'error';
  return 'fatal';
}
