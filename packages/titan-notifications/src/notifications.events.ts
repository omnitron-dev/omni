/**
 * Notifications Events Integration
 *
 * Provides event emission for notification lifecycle events.
 * Integrates with Titan's Events module for inter-module communication.
 */

import { Injectable, Optional, Inject } from '@omnitron-dev/titan/decorators';
import type { EventsService } from '@omnitron-dev/titan-events';
import type { NotificationPayload, NotificationRecipient, SendResult, BroadcastResult } from './notifications.types.js';

// Event names
export const NOTIFICATIONS_EVENTS = {
  // Send lifecycle
  NOTIFICATION_SENDING: 'notifications.notification.sending',
  NOTIFICATION_SENT: 'notifications.notification.sent',
  NOTIFICATION_FAILED: 'notifications.notification.failed',

  // Broadcast lifecycle
  BROADCAST_STARTING: 'notifications.broadcast.starting',
  BROADCAST_COMPLETED: 'notifications.broadcast.completed',
  BROADCAST_FAILED: 'notifications.broadcast.failed',

  // Schedule lifecycle
  NOTIFICATION_SCHEDULED: 'notifications.notification.scheduled',
  NOTIFICATION_CANCELLED: 'notifications.notification.cancelled',

  // Channel delivery
  CHANNEL_DELIVERY_SUCCESS: 'notifications.channel.delivery.success',
  CHANNEL_DELIVERY_FAILED: 'notifications.channel.delivery.failed',

  // DLQ events
  DLQ_MESSAGE_ADDED: 'notifications.dlq.message.added',
  DLQ_MESSAGE_REQUEUED: 'notifications.dlq.message.requeued',

  // In-app specific
  INAPP_NOTIFICATION_READ: 'notifications.inapp.notification.read',
  INAPP_NOTIFICATION_DISMISSED: 'notifications.inapp.notification.dismissed',
} as const;

export type NotificationsEventName = (typeof NOTIFICATIONS_EVENTS)[keyof typeof NOTIFICATIONS_EVENTS];

// Event payload types
export interface NotificationSendingEvent {
  recipient: NotificationRecipient;
  payload: NotificationPayload;
  channels?: string[];
  timestamp: number;
}

export interface NotificationSentEvent {
  result: SendResult;
  recipient: NotificationRecipient;
  payload: NotificationPayload;
  channels?: string[];
  timestamp: number;
  durationMs: number;
}

export interface NotificationFailedEvent {
  error: string;
  recipient: NotificationRecipient;
  payload: NotificationPayload;
  channels?: string[];
  timestamp: number;
}

export interface BroadcastStartingEvent {
  recipients: NotificationRecipient[];
  payload: NotificationPayload;
  options?: Record<string, unknown>;
  timestamp: number;
}

export interface BroadcastCompletedEvent {
  result: BroadcastResult;
  payload: NotificationPayload;
  timestamp: number;
  durationMs: number;
}

export interface ChannelDeliveryEvent {
  channel: string;
  recipient: NotificationRecipient;
  notificationId: string;
  success: boolean;
  error?: string;
  messageId?: string;
  timestamp: number;
}

export interface InAppNotificationEvent {
  recipientId: string;
  notificationId: string;
  action: 'read' | 'dismissed';
  timestamp: number;
}

/**
 * Notifications Event Emitter
 *
 * Wraps EventsService to emit notification lifecycle events.
 * This is optional - if EventsService is not available, events are silently skipped.
 */
@Injectable()
export class NotificationsEventEmitter {
  constructor(@Optional() @Inject('EVENTS_SERVICE_TOKEN') private readonly events?: EventsService) {}

  /**
   * Check if events are available
   */
  get isAvailable(): boolean {
    return !!this.events;
  }

  /**
   * Emit a notification sending event
   */
  async emitSending(data: Omit<NotificationSendingEvent, 'timestamp'>): Promise<void> {
    await this.emit(NOTIFICATIONS_EVENTS.NOTIFICATION_SENDING, {
      ...data,
      timestamp: Date.now(),
    });
  }

  /**
   * Emit a notification sent event
   */
  async emitSent(data: Omit<NotificationSentEvent, 'timestamp'>): Promise<void> {
    await this.emit(NOTIFICATIONS_EVENTS.NOTIFICATION_SENT, {
      ...data,
      timestamp: Date.now(),
    });
  }

  /**
   * Emit a notification failed event
   */
  async emitFailed(data: Omit<NotificationFailedEvent, 'timestamp'>): Promise<void> {
    await this.emit(NOTIFICATIONS_EVENTS.NOTIFICATION_FAILED, {
      ...data,
      timestamp: Date.now(),
    });
  }

  /**
   * Emit a broadcast starting event
   */
  async emitBroadcastStarting(data: Omit<BroadcastStartingEvent, 'timestamp'>): Promise<void> {
    await this.emit(NOTIFICATIONS_EVENTS.BROADCAST_STARTING, {
      ...data,
      timestamp: Date.now(),
    });
  }

  /**
   * Emit a broadcast completed event
   */
  async emitBroadcastCompleted(data: Omit<BroadcastCompletedEvent, 'timestamp'>): Promise<void> {
    await this.emit(NOTIFICATIONS_EVENTS.BROADCAST_COMPLETED, {
      ...data,
      timestamp: Date.now(),
    });
  }

  /**
   * Emit a channel delivery event
   */
  async emitChannelDelivery(data: Omit<ChannelDeliveryEvent, 'timestamp'>): Promise<void> {
    const eventName = data.success
      ? NOTIFICATIONS_EVENTS.CHANNEL_DELIVERY_SUCCESS
      : NOTIFICATIONS_EVENTS.CHANNEL_DELIVERY_FAILED;

    await this.emit(eventName, {
      ...data,
      timestamp: Date.now(),
    });
  }

  /**
   * Emit an in-app notification event
   */
  async emitInAppAction(data: Omit<InAppNotificationEvent, 'timestamp'>): Promise<void> {
    const eventName =
      data.action === 'read'
        ? NOTIFICATIONS_EVENTS.INAPP_NOTIFICATION_READ
        : NOTIFICATIONS_EVENTS.INAPP_NOTIFICATION_DISMISSED;

    await this.emit(eventName, {
      ...data,
      timestamp: Date.now(),
    });
  }

  /**
   * Emit a notification scheduled event
   */
  async emitScheduled(notificationId: string, scheduledAt: number): Promise<void> {
    await this.emit(NOTIFICATIONS_EVENTS.NOTIFICATION_SCHEDULED, {
      notificationId,
      scheduledAt,
      timestamp: Date.now(),
    });
  }

  /**
   * Emit a DLQ message added event
   */
  async emitDLQAdded(notificationId: string, channel: string, error: string): Promise<void> {
    await this.emit(NOTIFICATIONS_EVENTS.DLQ_MESSAGE_ADDED, {
      notificationId,
      channel,
      error,
      timestamp: Date.now(),
    });
  }

  /**
   * Generic emit method
   */
  private async emit(event: string, data: unknown): Promise<void> {
    if (!this.events) {
      return;
    }

    try {
      await this.events.emit(event, data);
    } catch {
      // Silently ignore event emission errors
    }
  }
}
