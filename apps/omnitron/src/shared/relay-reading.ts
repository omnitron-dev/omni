import type { INodeRelayStats } from './dto/nodes.js';

/** One interpretation for CLI and Console; absence is never a zero loss counter. */
export function relayReading(data: INodeRelayStats) {
  const relay = data.relay;
  if (!data.reachable || !relay) return { state: 'unknown' as const, label: 'unavailable',
    detail: data.error ?? 'No relay measurement was returned; check node connectivity and access.' };
  if (relay.state === 'not-applicable') return { state: 'neutral' as const, label: 'not applicable',
    detail: 'Worker logs and metrics use the durable replication outbox. Delivery evidence is reported under Replication.' };
  const s = relay.stats;
  if (!s || typeof s.started !== 'boolean' || !s.destination) return { state: 'unknown' as const,
    label: 'unavailable', detail: 'The node did not report relay lifecycle and destination; update its backend.' };
  const failed = s.buffer.totalDropped > 0 || Boolean(s.lastError);
  const available = s.started && (s.destination === 'aggregator' || (s.destination === 'transport' && s.transportConnected));
  return { state: available && !failed ? 'healthy' as const : 'degraded' as const,
    label: !s.started ? 'stopped' : s.destination === 'aggregator' ? 'local database' :
      s.destination === 'transport' ? s.transportConnected ? 'transport up' : 'transport down' : 'no destination',
    detail: `${s.buffer.size} buffered · ${s.totalSent} sent · ${s.totalFailed} failed${s.lastError ? ` · ${s.lastError}` : ''}`,
    dropped: s.buffer.totalDropped };
}
