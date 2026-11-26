import { createHash, randomUUID } from 'node:crypto';
import type { SendResult } from '../notifications.types.js';
import type { NotificationManager } from '../rotif/rotif.js';
import { getStreamKey } from '../rotif/utils.js';
import type { MessagingTransport, ScheduledDeliveryTransport, ScheduledNotification } from './transport.interface.js';

const terminalReceiptSeconds = 7 * 24 * 60 * 60;
const delayedSet = 'rotif:scheduled';

function deliveryTopic(scope: string): string {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(scope)) throw new Error('Invalid notification delivery scope');
  return 'titan.scheduled.' + scope;
}

function receiptKey(scope: string, id: string): string {
  if (!id || Buffer.byteLength(id) > 1024) throw new Error('Invalid notification ID');
  return 'rotif:notification:' + deliveryTopic(scope) + ':' + id;
}

function receipt(notificationId: string, status: SendResult['status'], error?: string): SendResult {
  return { notificationId, status, channels: [], timestamp: Date.now(), error };
}

/** Reuse Rotif's delayed queue and consumer group. Only the job ID travels on the stream. */
export class RotifScheduledDelivery implements ScheduledDeliveryTransport {
  constructor(private readonly manager: NotificationManager, private readonly transport: Pick<MessagingTransport, 'subscribe'>) {}

  async schedule(scope: string, job: ScheduledNotification): Promise<SendResult> {
    if (this.manager.config.disableDelayed) throw new Error('Delayed notification delivery is disabled');
    const id = job.payload.id;
    const topic = deliveryTopic(scope);
    const body = JSON.stringify(job, (_key, value: unknown) =>
      value !== null && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
        : value);
    const fingerprint = createHash('sha256').update(body).digest('hex');
    const result = receipt(id, 'scheduled');
    const member = randomUUID();
    const envelope = JSON.stringify({ type: 'scheduled-delivery', id, data: member });
    const raw = await this.manager.runLuaScript<string>('publish-message',
      [getStreamKey(topic), delayedSet, receiptKey(scope, id)],
      [envelope, result.timestamp, topic, '1', 'delayed', job.scheduledAt, '0', '', '', '0',
        member, 'false', topic, fingerprint, body, JSON.stringify(result)]);
    return JSON.parse(raw) as SendResult;
  }

  consume(scope: string, deliver: (job: ScheduledNotification) => Promise<SendResult>) {
    const topic = deliveryTopic(scope);
    return this.transport.subscribe(topic, async message => {
      const id = message.payload?.id;
      const member = message.payload?.data;
      if (message.channel !== topic || message.payload?.type !== 'scheduled-delivery' || typeof id !== 'string' || typeof member !== 'string') {
        throw new Error('Invalid scheduled delivery envelope');
      }
      const key = receiptKey(scope, id);
      const token = randomUUID();
      const uncertain = receipt(id, 'unconfirmed', 'Delivery claimed, awaiting provider receipt');
      const body = await this.manager.runLuaScript<string | null>('scheduled-delivery', [key],
        ['claim', token, JSON.stringify(uncertain), member]);
      if (body) {
        let result: SendResult;
        try {
          result = await deliver(JSON.parse(body) as ScheduledNotification);
        } catch (error) {
          result = receipt(id, 'unconfirmed', error instanceof Error ? error.message : String(error));
        }
        const unresolved = result.status === 'unconfirmed' || result.channels.some(channel => channel.status === 'unconfirmed');
        const saved = await this.manager.runLuaScript<number>('scheduled-delivery', [key],
          ['finish', token, JSON.stringify(result), unresolved ? 0 : terminalReceiptSeconds]);
        if (!saved) throw new Error('Scheduled notification receipt could not be confirmed');
      }
    }, { groupName: topic });
  }

  async cancel(scope: string, id: string): Promise<boolean> {
    await this.manager.waitUntilReady();
    return Boolean(await this.manager.runLuaScript<number>('scheduled-delivery', [receiptKey(scope, id), delayedSet],
      ['cancel', '', JSON.stringify(receipt(id, 'cancelled')), terminalReceiptSeconds]));
  }

  async status(scope: string, id: string): Promise<SendResult | null> {
    const raw = await this.manager.redis.hget(receiptKey(scope, id), 'result');
    return raw ? JSON.parse(raw) as SendResult : null;
  }
}
