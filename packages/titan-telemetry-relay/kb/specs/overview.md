---
module: titan-telemetry-relay
title: "Telemetry Relay Service"
tags: [telemetry, buffer, wal, forwarding]
summary: "Store-and-forward telemetry pipeline: buffer → WAL → transport (for distributed tracing/metrics)"
depends_on: [eventemitter]
---

## Architecture

```
App metrics/traces → TelemetryBuffer → TelemetryWal (disk) → Transport → Collector
```

- **TelemetryBuffer** — In-memory ring buffer, configurable flush interval and batch size
- **TelemetryWal** — Write-ahead log on disk for crash recovery
- **Transport** — Pluggable: HTTP, gRPC, or custom

## Purpose
Ensures telemetry data survives app crashes and network outages. The WAL guarantees at-least-once delivery.
