import { TelemetryRelayService } from '@omnitron-dev/titan-telemetry-relay';
import type { LogCollectorService } from './log-collector.service.js';

/** Local application relay. Fleet log/metric replication uses the receipt-backed Sync service. */
export function createTelemetryRelay(logCollector: Pick<LogCollectorService, 'persistCaptured'>): TelemetryRelayService {
  const relay = new TelemetryRelayService({ nodeId: 'local', role: 'both', wal: false,
    buffer: { maxBufferSize: 5_000, flushIntervalMs: 5_000, maxBatchSize: 1_000 } });
  relay.setAggregator({
    async ingest(nodeId, entries) {
      if (nodeId !== relay.nodeId) throw new Error('Local relay source identity mismatch');
      const batch = entries.map(entry => {
        if (entry.type !== 'log' && entry.type !== 'event' && entry.type !== 'alert') {
          throw new Error(`The local log sink cannot persist telemetry type '${entry.type}'`);
        }
        return {
          ...(entry.id && { id: entry.id }), app: entry.app ?? 'unknown', timestamp: entry.timestamp,
          level: typeof entry.data['level'] === 'string' ? entry.data['level'] : 'info',
          message: typeof entry.data['message'] === 'string' ? entry.data['message'] : JSON.stringify(entry.data),
          labels: { ...entry.labels, nodeId, type: entry.type }, metadata: { telemetry: entry.data },
          ...(typeof entry.data['traceId'] === 'string' && { traceId: entry.data['traceId'] }),
          ...(typeof entry.data['spanId'] === 'string' && { spanId: entry.data['spanId'] }),
        };
      });
      await logCollector.persistCaptured(batch);
      return batch.length;
    },
    async query() { throw new Error('Read stored application logs through OmnitronLogs'); },
  });
  return relay;
}
