/**
 * Notification Service Process
 * Used in real-world scenario tests for e-commerce order processing
 */

import { Process, Public, RateLimit } from '../../../../src/modules/pm/decorators.js';

@Process({ name: 'notification-service', version: '1.0.0' })
export default class NotificationService {
  private notifications: Array<{ userId: string; message: string; timestamp: number }> = [];

  @Public()
  @RateLimit({ rps: 10 })
  async sendNotification(userId: string, message: string): Promise<void> {
    // Simulate sending notification
    await new Promise((resolve) => setTimeout(resolve, 20));

    this.notifications.push({
      userId,
      message,
      timestamp: Date.now(),
    });
  }

  @Public()
  async getNotifications(userId: string): Promise<Array<{ message: string; timestamp: number }>> {
    return this.notifications
      .filter((n) => n.userId === userId)
      .map(({ message, timestamp }) => ({ message, timestamp }));
  }
}
