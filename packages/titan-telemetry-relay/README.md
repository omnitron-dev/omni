# @omnitron-dev/titan-telemetry-relay

A store-and-forward relay for application logs, metrics, events, health reports and alerts. Producers buffer entries and replay their write-ahead log when the authenticated recipient becomes available.

## Capabilities

- Bounded memory buffering and file-backed WAL segments.
- Producer and aggregator roles with application-supplied transports.
- Stable entry IDs across retries and replay.
- Delivery statistics, error reporting and shutdown flushing.

## Quick start

```sh
pnpm add @omnitron-dev/titan-telemetry-relay
```

```ts
import { TelemetryRelayService, type TelemetryTransport } from '@omnitron-dev/titan-telemetry-relay';

export async function startRelay(transport: TelemetryTransport) {
  const relay = new TelemetryRelayService({
    role: 'producer',
    nodeId: 'api-1',
    wal: { directory: './var/telemetry/api-1' },
    transport,
  });
  await relay.start();
  relay.emitLog('api', 'info', 'Application started');
  return relay;
}
```

Supply a transport that authenticates its recipient. Use a stable, unique `nodeId` and a dedicated WAL directory. On the receiving side, bind the source to the authenticated peer before calling `receive(nodeId, entries)`. Await `relay.stop()` before shutdown.

Entries become durable when the WAL flush completes. A transport returns the number durably accepted; partial, invalid or failed acknowledgements retain pending data. Retries may repeat committed entries, so the sink must deduplicate by entry ID when required.

Size memory and WAL limits for the expected outage. Capacity evictions are reported, not silently converted into successful delivery. With `wal: false`, unresolved entries remain in memory and a failed final flush rejects `stop()`.

## Documentation

[Public API](src/index.ts) · [Transport and storage contracts](src/types.ts) · [Omni](../../README.md)

## License

[MIT](../../LICENSE).
