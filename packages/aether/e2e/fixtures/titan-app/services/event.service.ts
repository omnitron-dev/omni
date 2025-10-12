/**
 * Event Service - Test service for WebSocket events and subscriptions
 * Tests real-time events and pub/sub patterns
 */

import { Injectable } from '@omnitron-dev/titan/nexus';
import { Service, Public, OnEvent } from '@omnitron-dev/titan/netron';
import { EventEmitter } from 'events';

export interface ChatMessage {
  id: string;
  userId: string;
  userName: string;
  message: string;
  timestamp: string;
}

export interface NotificationEvent {
  id: string;
  type: 'info' | 'warning' | 'error' | 'success';
  title: string;
  message: string;
  timestamp: string;
}

export interface ProgressEvent {
  taskId: string;
  progress: number; // 0-100
  status: 'pending' | 'running' | 'completed' | 'failed';
  message: string;
}

/**
 * Test Event Service
 * Provides event emission and subscription for testing WebSocket transport
 */
@Injectable()
@Service('EventService@1.0.0')
export class EventService {
  private eventEmitter = new EventEmitter();
  private messageIdCounter = 0;
  private notificationIdCounter = 0;

  constructor() {
    // Start background tasks for testing
    this.startPeriodicEvents();
  }

  /**
   * Send a chat message (emits event)
   */
  @Public()
  async sendMessage(userId: string, userName: string, message: string): Promise<ChatMessage> {
    const chatMessage: ChatMessage = {
      id: `msg-${++this.messageIdCounter}`,
      userId,
      userName,
      message,
      timestamp: new Date().toISOString(),
    };

    // Emit event to all subscribers
    this.eventEmitter.emit('message.sent', chatMessage);

    return chatMessage;
  }

  /**
   * Send notification
   */
  @Public()
  async sendNotification(type: NotificationEvent['type'], title: string, message: string): Promise<NotificationEvent> {
    const notification: NotificationEvent = {
      id: `notif-${++this.notificationIdCounter}`,
      type,
      title,
      message,
      timestamp: new Date().toISOString(),
    };

    this.eventEmitter.emit('notification', notification);
    return notification;
  }

  /**
   * Start a long-running task with progress updates
   */
  @Public()
  async startTask(taskId: string, durationMs: number): Promise<{ taskId: string; started: boolean }> {
    const steps = 10;
    const stepDuration = durationMs / steps;

    // Emit progress events
    (async () => {
      for (let i = 0; i <= steps; i++) {
        await new Promise((resolve) => setTimeout(resolve, stepDuration));

        const progress: ProgressEvent = {
          taskId,
          progress: (i / steps) * 100,
          status: i === 0 ? 'pending' : i < steps ? 'running' : 'completed',
          message: i === steps ? 'Task completed' : `Processing step ${i}/${steps}`,
        };

        this.eventEmitter.emit('task.progress', progress);

        if (i === steps) {
          this.eventEmitter.emit('task.completed', { taskId, completedAt: new Date().toISOString() });
        }
      }
    })();

    return { taskId, started: true };
  }

  /**
   * Subscribe to chat messages
   */
  @Public()
  subscribeToMessages(callback: (message: ChatMessage) => void): () => void {
    this.eventEmitter.on('message.sent', callback);
    return () => this.eventEmitter.off('message.sent', callback);
  }

  /**
   * Subscribe to notifications
   */
  @Public()
  subscribeToNotifications(callback: (notification: NotificationEvent) => void): () => void {
    this.eventEmitter.on('notification', callback);
    return () => this.eventEmitter.off('notification', callback);
  }

  /**
   * Subscribe to task progress
   */
  @Public()
  subscribeToTaskProgress(taskId: string, callback: (progress: ProgressEvent) => void): () => void {
    const handler = (progress: ProgressEvent) => {
      if (progress.taskId === taskId) {
        callback(progress);
      }
    };

    this.eventEmitter.on('task.progress', handler);
    return () => this.eventEmitter.off('task.progress', handler);
  }

  /**
   * Get active subscriptions count (for testing)
   */
  @Public()
  async getSubscriptionCount(): Promise<{
    messages: number;
    notifications: number;
    taskProgress: number;
  }> {
    return {
      messages: this.eventEmitter.listenerCount('message.sent'),
      notifications: this.eventEmitter.listenerCount('notification'),
      taskProgress: this.eventEmitter.listenerCount('task.progress'),
    };
  }

  /**
   * Start periodic events for testing continuous streams
   */
  private startPeriodicEvents() {
    // Emit periodic notifications every 5 seconds
    setInterval(() => {
      const notification: NotificationEvent = {
        id: `notif-${++this.notificationIdCounter}`,
        type: 'info',
        title: 'Periodic Update',
        message: `Server time: ${new Date().toISOString()}`,
        timestamp: new Date().toISOString(),
      };

      this.eventEmitter.emit('notification', notification);
    }, 5000);
  }

  /**
   * Emit high-frequency events (stress test)
   */
  @Public()
  async emitHighFrequency(count: number, intervalMs: number): Promise<{ emitted: number }> {
    let emitted = 0;

    for (let i = 0; i < count; i++) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));

      const notification: NotificationEvent = {
        id: `notif-${++this.notificationIdCounter}`,
        type: 'info',
        title: `Rapid Event ${i + 1}`,
        message: `High frequency event ${i + 1}/${count}`,
        timestamp: new Date().toISOString(),
      };

      this.eventEmitter.emit('notification', notification);
      emitted++;
    }

    return { emitted };
  }
}
