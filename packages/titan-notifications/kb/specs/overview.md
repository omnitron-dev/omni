---
module: titan-notifications
title: "Notifications Module"
tags: [notifications, email, sms, push, webhook, channels, templates]
summary: "Multi-channel notification system with templates, rate limiting, preferences, and DLQ"
depends_on: [titan/nexus, titan-events, titan-redis]
---

## Channels

| Channel | Transport | Optional Dep |
|---------|-----------|-------------|
| Email | SMTP | nodemailer |
| SMS | Twilio | twilio |
| Push | FCM | firebase-admin |
| Webhook | HTTP POST | — |
| In-App | Rotif messaging | @omnitron-dev/rotif |

## Architecture
```
NotificationsService → ChannelRegistry → Channel → Transport
                     → TemplateEngine (Handlebars)
                     → RedisRateLimiter (per-user limits)
                     → RedisPreferenceStore (opt-out)
                     → NotificationPublisher → Worker (async delivery)
```

## DLQ (Dead Letter Queue)
Failed notifications go to DLQ for retry or manual inspection.
