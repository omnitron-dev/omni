# @omnitron-dev/titan-notifications

> Multi-channel notification delivery for the Titan framework

Part of the [Omni](../../README.md) monorepo — Fullstack Type-Safe RPC Framework.

## Installation

```bash
pnpm add @omnitron-dev/titan-notifications
```

## Overview

Provides multi-channel notification delivery with Rotif messaging and dead-letter queue (DLQ) support. Channels are pluggable — add custom delivery backends alongside built-in ones.

## Operational diagnostics

The optional `@omnitron-dev/titan-notifications/diagnostics` entry point exports
`DiagnosticNotificationsModule`, `DiagnosticNotificationSink` and
`DIAGNOSTIC_NOTIFICATION_SINK`. Pass a configured `NotificationsModule.forRoot`
or `forRootAsync` module; the adapter uses its transport, queue, deduplication and
DLQ. No messenger integration or automatic publication is enabled by importing it.

Delivery rejects when no consumer accepts the event. A queued receipt confirms
broker acceptance, not human receipt. Reuse event identities across retries;
consumers must remain idempotent outside the 24-hour deduplication window.

Notification lifecycle observer failures are logged and retained in health until
the next successful invocation of that event. They do not resend a notification
whose delivery has already committed.

## License

MIT
