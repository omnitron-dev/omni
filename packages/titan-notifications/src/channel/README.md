# Notification channels

A channel adapts a notification to a delivery endpoint. Import channel types and implementations from `@omnitron-dev/titan-notifications`; this source directory is not a separate package entry point.

[NotificationChannel](channel.interface.ts) defines availability and health checks, recipient validation, content formatting, and `send(recipient, content)`. Optional `initialize` and `shutdown` methods own provider connections. A send returns `ChannelSendResult`, including success, an optional provider message ID, and error details.

[ChannelRegistry](channel-registry.ts) registers named channels, coordinates their lifecycle, and selects available channels. Selection supports all matching channels, first available, or priority order.

| Implementation | Role |
| --- | --- |
| [In-app](channels/inapp.channel.ts) | Store and deliver application notifications |
| [Webhook](channels/webhook.channel.ts) | HTTP delivery and signature verification |
| [Email](channels/email.channel.ts) | Abstract provider adapter and mock |
| [SMS](channels/sms.channel.ts) | Abstract provider adapter and mock |
| [Push](channels/push.channel.ts) | Abstract provider adapter and mock |

Email, SMS, and push require a concrete provider implementation for real delivery. Mock channels are test tools. A provider's acceptance of a message is distinct from delivery to the recipient; expose the result the provider actually supplies.

Register channels through the notification module described in the [package README](../../README.md). Keep provider credentials in application configuration, and close provider resources during shutdown.
