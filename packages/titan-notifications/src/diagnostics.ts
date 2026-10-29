import { Module } from '@omnitron-dev/titan/decorators';
import { createToken, type DynamicModule, type Token } from '@omnitron-dev/titan/nexus';
import {
  sanitizeDiagnostic, redactDiagnosticText,
  type DiagnosticEvent, type DiagnosticReceipt, type DiagnosticSink,
} from '@omnitron-dev/titan/diagnostics';
import { NOTIFICATIONS_TRANSPORT } from './notifications.tokens.js';
import type { MessagingTransport } from './transport/transport.interface.js';

export const DIAGNOSTIC_NOTIFICATION_SINK: Token<DiagnosticSink> = createToken('DiagnosticNotificationSink');

export class DiagnosticDeliveryError extends Error {
  readonly code = 'DIAGNOSTIC_DELIVERY_UNAVAILABLE';
  constructor(readonly status: 'no_subscribers' | 'failed', detail?: string) {
    super(
      status === 'no_subscribers'
        ? 'No consumer is registered for operational diagnostics'
        : 'The notification transport did not acknowledge the diagnostic',
      detail ? { cause: new Error(redactDiagnosticText(detail)) } : undefined,
    );
    this.name = 'DiagnosticDeliveryError';
  }
}

/** Uses the existing durable transport. Owns no queue or retry engine. */
export class DiagnosticNotificationSink implements DiagnosticSink {
  constructor(private readonly transport: Pick<MessagingTransport, 'publish'>, private readonly channel = 'diagnostics.operational') {
    if (!/^[a-zA-Z0-9_.-]+$/.test(channel)) throw new Error('Invalid diagnostic channel');
  }

  async deliver(event: DiagnosticEvent): Promise<DiagnosticReceipt> {
    if (!event.eventId || !event.id || !event.source || !Number.isFinite(event.timestamp)) throw new Error('Incomplete diagnostic event');
    const result = await this.transport.publish(this.channel, {
      id: event.eventId,
      type: 'operational.diagnostic',
      data: sanitizeDiagnostic(event),
      metadata: { schemaVersion: 1 },
    }, {
      // Deduplication limits repeats within this window. This is broker
      // acceptance, never a claim of exactly-once delivery to a person.
      exactlyOnce: true,
      dedupKey: `diagnostic:${event.eventId}:${event.state}`,
      deduplicationTTL: 86_400,
      priority: event.severity === 'critical' ? 'urgent' : event.severity === 'error' ? 'high' : 'normal',
    });
    if (!result.success || !['published', 'scheduled', 'duplicate'].includes(result.status)) {
      throw new DiagnosticDeliveryError(
        result.status === 'no_subscribers' ? 'no_subscribers' : 'failed',
        result.error,
      );
    }
    return { status: result.status === 'duplicate' ? 'duplicate' : 'queued', messageIds: result.messageIds };
  }
}

/** Explicit bridge to a configured NotificationsModule. Never creates a transport implicitly. */
@Module()
export class DiagnosticNotificationsModule {
  static forRoot(options: { notifications: DynamicModule; channel?: string }): DynamicModule {
    return {
      module: DiagnosticNotificationsModule,
      imports: [{ ...options.notifications, name: options.notifications.module.name }],
      providers: [[DIAGNOSTIC_NOTIFICATION_SINK, {
        useFactory: (transport: MessagingTransport) => new DiagnosticNotificationSink(transport, options.channel),
        inject: [NOTIFICATIONS_TRANSPORT],
      }]],
      exports: [DIAGNOSTIC_NOTIFICATION_SINK],
    };
  }
}
