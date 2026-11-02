# @omnitron-dev/titan-telemetry-relay

> Store-and-forward telemetry pipeline for distributed Titan applications

Part of the [Omni](../../README.md) monorepo — Fullstack Type-Safe RPC Framework.

## Installation

```bash
pnpm add @omnitron-dev/titan-telemetry-relay
```

## Overview

The relay batches application logs, metrics, health reports, events and alerts.
Configure a producer with a stable `nodeId` and a dedicated WAL directory.
Install a `TelemetryTransport` that authenticates the recipient. On the
receiving side, bind the source to the authenticated peer before calling
`receive(nodeId, entries)`.

A transport or aggregator returns the number of entries durably accepted.
Only a full acknowledgement across the replay clears the WAL. A timeout,
partial count, malformed response or unreadable segment keeps the batch
pending. Retry can deliver entries the sink already committed. Newly recorded
entries have stable IDs for sink-side deduplication. Older WALs remain readable.

`stats().lastError` describes the latest failed delivery. The memory buffer
reports capacity drops in `buffer.totalDropped`. Entries become durable when
the WAL flush completes. Segment rotation retains up to `wal.maxSegments`;
size that limit for the expected outage. The WAL reports capacity evictions
in `evictedSegments` and `evictedBytes` since startup. Await `stop()` to flush every memory
batch before shutdown. With `wal: false`, unresolved entries stay in process
memory and a failed final flush rejects `stop()`.

## License

MIT
