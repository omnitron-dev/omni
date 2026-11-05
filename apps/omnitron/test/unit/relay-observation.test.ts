import { expect, it } from 'vitest';
import { TelemetryRelayService } from '@omnitron-dev/titan-telemetry-relay';
import { TelemetryRpcService } from '../../src/services/telemetry.rpc-service.js';
import { relayReading } from '../../src/shared/relay-reading.js';

const answer = async (relay: TelemetryRelayService | null) => ({ nodeId: 'node', reachable: true, error: null,
  relay: await new TelemetryRpcService(relay).getRelayStats() });

it('reports worker replication as not applicable without inventing relay counters', async () => {
  const reading = relayReading(await answer(null));
  expect(reading.state).toBe('neutral');
  expect(reading.detail).toContain('durable replication outbox');
  expect(reading).not.toHaveProperty('dropped');
});
it('a local aggregator needs no remote transport, and stopped is distinct from healthy', async () => {
  const relay = new TelemetryRelayService({ role: 'both', wal: false });
  relay.setAggregator({ ingest: async (_node, entries) => entries.length, query: async () => [] });
  expect(relayReading(await answer(relay)).label).toBe('stopped');
  await relay.start();
  try {
    expect(relay.stats().transportConnected).toBe(false);
    expect(relayReading(await answer(relay))).toMatchObject({ state: 'healthy', label: 'local database' });
  } finally { await relay.stop(); }
});
it('does not infer node role or replication health from a missing RPC service', () => {
  const reading = relayReading({ nodeId: 'node', reachable: false, relay: null,
    error: "Service 'OmnitronTelemetry' not found" });
  expect(reading.state).toBe('unknown');
  expect(reading.detail).toContain('not found');
  expect(reading).not.toHaveProperty('dropped');
});
