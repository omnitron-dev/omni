# @omnitron-dev/titan-mailer

Transactional email for Titan applications: managed SMTP pools, typed templates and optional durable delivery through Titan Notifications.

## Capabilities

- Bounded SMTP submission with lifecycle-managed connection pools.
- Typed, renderer-independent templates and explicit plaintext bodies.
- Notification workers that carry opaque delivery IDs through Redis.
- A PostgreSQL outbox adapter that uses the application's existing database executor.

## Quick start

```sh
pnpm add @omnitron-dev/titan-mailer
```

```ts
import { MailerModule } from '@omnitron-dev/titan-mailer';

export function mail(smtp: string) {
  return MailerModule.forRoot({
    smtp,
    from: 'Example <noreply@example.org>',
    pool: { maxConnections: 3 },
    maxPending: 1000,
  });
}
```

Add the returned module to your Titan application and inject `MailerService` or `MAILER`. Supply an SMTP URL through application configuration. `verify()` checks the connection without sending mail; `verifyOnStart` enables that check during creation. Application shutdown drains accepted work and closes the pool.

`send()` accepts one envelope recipient, a plaintext body, optional HTML, memory-backed attachments and a stable Message-ID. It reports SMTP acceptance, not inbox delivery. TLS certificate verification is required; the explicit insecure option is restricted to loopback development servers.

## Durable delivery

Use `MailDeliveryWorker` from `@omnitron-dev/titan-mailer/notifications` with a notification transport, mailer and durable `MailOutbox`. Stop the worker before disposing its injected dependencies. Persist rendered messages in the application's business transaction; send only opaque IDs through Redis.

`@omnitron-dev/titan-mailer/postgres` exports `PostgresMailOutbox`, schema SQL and schema readiness requirements. Apply the schema through your migration workflow and pass an existing database executor. The adapter does not create a second pool or migrate on startup.

An SMTP server and a database cannot share one atomic transaction. A crash after SMTP acceptance can lead to a repeated delivery. Stable Message-IDs support reconciliation but do not guarantee recipient-side deduplication. The application owns retries, cancellation and terminal-failure handling.

## Documentation

[Public API](src/index.ts) · [Package exports](package.json) · [Notifications](../titan-notifications/README.md) · [Omni](../../README.md)

## License

[MIT](../../LICENSE).
