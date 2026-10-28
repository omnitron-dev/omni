import type {
  IncomingNotification,
  MessagingTransport,
  NotificationSubscription,
} from '@omnitron-dev/titan-notifications';
import { AbstractEmailChannel } from '@omnitron-dev/titan-notifications';
import type { EmailContent } from '@omnitron-dev/titan-notifications';
import type { MailerService } from './mailer.service.js';
import type { MailMessage, MailReceipt, MailSender } from './types.js';

/** Durable source of truth, implemented by the application's transaction store. */
export interface MailOutbox {
  pending(limit: number): Promise<string[]>;
  /** Lock/claim id, skip completed or not-due rows, persist outcome before resolving.
   * Transient failures must retain the message with backoff; expired messages must not send.
   * Database failure must reject. SMTP and the database cannot commit atomically.
   */
  deliver(id: string, send: (mail: MailMessage) => Promise<MailReceipt>): Promise<void>;
}
export interface MailDeliveryWorkerOptions {
  channel: string;
  group: string;
  consumer?: string;
  intervalMs?: number;
  batchSize?: number;
  maxConcurrent?: number;
  onError?: (stage: 'relay' | 'delivery', code: MailWorkerFailureCode) => void | Promise<void>;
}
export type MailWorkerFailureCode =
  'outbox_read_failed' | 'notification_publish_failed' | 'outbox_delivery_failed' | 'notification_ack_failed';
/** Redis carries opaque outbox IDs. Reconciliation repairs lost/trimmed wake-ups.
 * Successful ACK means the durable store recorded the outcome, not recipient delivery.
 */
export class MailDeliveryWorker {
  private subscription?: NotificationSubscription;
  private starting?: Promise<void>;
  private stopping?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  private relay?: Promise<void>;
  private active = new Set<Promise<void>>();
  private closed = false;
  private failure = false;
  private deliveryFailure = false;
  private readonly maxConcurrent: number;
  readonly interval: number;
  readonly batchSize: number;
  constructor(
    private readonly bus: MessagingTransport,
    private readonly store: MailOutbox,
    private readonly mailer: MailSender,
    private readonly options: MailDeliveryWorkerOptions
  ) {
    this.maxConcurrent = options.maxConcurrent ?? 25;
    this.interval = options.intervalMs ?? 2000;
    this.batchSize = options.batchSize ?? 25;
    if (
      !Number.isSafeInteger(this.maxConcurrent) ||
      this.maxConcurrent < 1 ||
      this.maxConcurrent > 1000 ||
      !/^[a-zA-Z0-9_.:-]+$/.test(options.channel) ||
      !options.group ||
      !Number.isSafeInteger(this.interval) ||
      this.interval < 10 ||
      !Number.isSafeInteger(this.batchSize) ||
      this.batchSize < 1 ||
      this.batchSize > 1000
    )
      throw new Error('Invalid mail delivery worker configuration');
  }
  start(): Promise<void> {
    if (this.closed) return Promise.reject(new Error('Mail delivery worker is closed'));
    return (this.starting ??= this.subscribe());
  }
  private async subscribe(): Promise<void> {
    this.subscription = await this.bus.subscribe(this.options.channel, (msg) => this.accept(msg), {
      groupName: this.options.group,
      consumerName: this.options.consumer,
      startFrom: '0',
    });
    const tick = async () => {
      if (this.closed) return;
      try {
        await this.reconcile();
      } catch {
        /* reconcile reports its failure, including explicit operator calls */
      }
      if (!this.closed) {
        this.timer = setTimeout(tick, this.interval);
        this.timer.unref();
      }
    };
    void tick();
  }
  private accept(message: IncomingNotification): Promise<void> {
    if (this.closed) return Promise.reject(new Error('Mail delivery worker is stopping'));
    if (this.active.size >= this.maxConcurrent) return Promise.reject(new Error('Mail delivery worker at capacity'));
    const work = (async () => {
      const payload = message.payload;
      if (
        !payload ||
        typeof payload !== 'object' ||
        payload.type !== 'mail.outbox' ||
        typeof payload.data !== 'string' ||
        payload.data.length > 200
      ) {
        // No body/address from the queue is ever accepted as an email instruction.
        await message.ack();
        return;
      }
      try {
        await this.store.deliver(payload.data, (mail) => this.mailer.send(mail));
      } catch (error) {
        this.deliveryFailure = true;
        await this.report('delivery', 'outbox_delivery_failed');
        throw error;
      }
      try {
        await message.ack();
        this.deliveryFailure = false;
      } catch (error) {
        this.deliveryFailure = true;
        await this.report('delivery', 'notification_ack_failed');
        throw error;
      }
    })();
    this.active.add(work);
    void work.finally(() => this.active.delete(work)).catch(() => {});
    return work;
  }
  /** Explicit reconciliation is also useful for operational recovery and tests. */
  reconcile(): Promise<void> {
    if (this.closed) return Promise.reject(new Error('Mail delivery worker is closed'));
    if (this.relay) return this.relay;
    let code: MailWorkerFailureCode = 'outbox_read_failed';
    this.relay = (async () => {
      const ids = await this.store.pending(this.batchSize);
      code = 'notification_publish_failed';
      for (const id of ids) {
        if (this.closed) break;
        // No publisher-side "exactly once": an ACK lost after SMTP is inherently ambiguous.
        const result = await this.bus.publish(this.options.channel, { type: 'mail.outbox', data: id });
        if (!result.success) throw new Error('Mail notification transport unavailable');
      }
      this.failure = false;
    })()
      .catch(async (error) => {
        this.failure = true;
        await this.report('relay', code);
        throw error;
      })
      .finally(() => {
        this.relay = undefined;
      });
    return this.relay;
  }
  private async report(stage: 'relay' | 'delivery', code: MailWorkerFailureCode): Promise<void> {
    try {
      await this.options.onError?.(stage, code);
    } catch {
      /* Telemetry cannot change ACK/retry semantics. */
    }
  }
  async health(): Promise<{ available: boolean; active: number }> {
    const transport = await this.bus.healthCheck();
    return {
      available:
        !this.closed &&
        !this.failure &&
        !this.deliveryFailure &&
        !!this.subscription &&
        transport.connected &&
        transport.status !== 'unhealthy',
      active: this.active.size,
    };
  }
  stop(): Promise<void> {
    this.closed = true;
    clearTimeout(this.timer);
    return (this.stopping ??= (async () => {
      await this.starting?.catch(() => {});
      await this.relay?.catch(() => {});
      // Retain the shared pattern: other consumers may still be running.
      try {
        await this.subscription?.unsubscribe(false);
      } finally {
        await Promise.allSettled([...this.active]);
      }
    })());
  }
  onDestroy(): Promise<void> {
    return this.stop();
  }
}

/** Adapter for the existing Titan notification channel registry. Mailer owns its pool. */
export class MailerEmailChannel extends AbstractEmailChannel {
  constructor(private readonly mailer: MailerService) {
    super();
  }
  override async isAvailable(): Promise<boolean> {
    try {
      await this.mailer.verify();
      return true;
    } catch {
      return false;
    }
  }
  override async sendEmail(to: string, content: EmailContent): Promise<{ messageId: string }> {
    const receipt = await this.mailer.send({
      to,
      subject: content.subject,
      text: content.text ?? '',
      html: content.html,
      attachments: content.attachments?.map((f) => ({
        filename: f.filename,
        content: Buffer.isBuffer(f.content) ? f.content : Buffer.from(f.content),
        contentType: f.contentType,
      })),
      ...(content.from ? { from: content.from } : {}),
      ...(content.replyTo ? { replyTo: content.replyTo } : {}),
    });
    return { messageId: receipt.messageId };
  }
}
