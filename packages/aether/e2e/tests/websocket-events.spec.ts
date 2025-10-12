/**
 * WebSocket Events E2E Tests
 * Tests real-time events, subscriptions, and pub/sub patterns
 */

import { test, expect, Page } from '@playwright/test';

test.describe('WebSocket Events - Subscriptions', () => {
  let page: Page;

  test.beforeEach(async ({ page: p }) => {
    page = p;
    await page.goto('/');

    // Connect WebSocket peer
    await page.evaluate(async () => {
      const { WebSocketRemotePeer } = await import('../../src/netron/transport/websocket/peer.js');
      const peer = new WebSocketRemotePeer('ws://localhost:3334');
      await peer.connect();
      window.testState.wsPeer = peer;
      window.testState.subscriptions = [];
      window.updateConnectionStatus();
    });
  });

  test.afterEach(async () => {
    await page.evaluate(async () => {
      // Cleanup subscriptions
      window.testState.subscriptions.forEach((unsub: () => void) => unsub());
      window.testState.subscriptions = [];

      if (window.testState.wsPeer) {
        await window.testState.wsPeer.disconnect();
        window.testState.wsPeer = null;
      }
      window.updateConnectionStatus();
    });
  });

  test('should subscribe to chat messages', async () => {
    const messages = await page.evaluate(async () => {
      const eventService = await window.testState.wsPeer.queryInterface('EventService@1.0.0');

      const receivedMessages: any[] = [];

      // Subscribe to messages
      const unsubscribe = eventService.subscribeToMessages((message: any) => {
        receivedMessages.push(message);
      });
      window.testState.subscriptions.push(unsubscribe);

      // Send some messages
      await eventService.sendMessage('user1', 'Alice', 'Hello World');
      await eventService.sendMessage('user2', 'Bob', 'Hi Alice!');

      // Wait for messages to arrive
      await new Promise((resolve) => setTimeout(resolve, 100));

      return receivedMessages;
    });

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      userId: 'user1',
      userName: 'Alice',
      message: 'Hello World',
    });
    expect(messages[1]).toMatchObject({
      userId: 'user2',
      userName: 'Bob',
      message: 'Hi Alice!',
    });
  });

  test('should subscribe to notifications', async () => {
    const notifications = await page.evaluate(async () => {
      const eventService = await window.testState.wsPeer.queryInterface('EventService@1.0.0');

      const receivedNotifications: any[] = [];

      // Subscribe to notifications
      const unsubscribe = eventService.subscribeToNotifications((notification: any) => {
        receivedNotifications.push(notification);
      });
      window.testState.subscriptions.push(unsubscribe);

      // Send notifications
      await eventService.sendNotification('info', 'Info Title', 'This is an info message');
      await eventService.sendNotification('error', 'Error Title', 'This is an error message');

      // Wait for notifications to arrive
      await new Promise((resolve) => setTimeout(resolve, 100));

      return receivedNotifications;
    });

    expect(notifications).toHaveLength(2);
    expect(notifications[0]).toMatchObject({
      type: 'info',
      title: 'Info Title',
      message: 'This is an info message',
    });
    expect(notifications[1]).toMatchObject({
      type: 'error',
      title: 'Error Title',
      message: 'This is an error message',
    });
  });

  test('should subscribe to task progress', async () => {
    const progressEvents = await page.evaluate(async () => {
      const eventService = await window.testState.wsPeer.queryInterface('EventService@1.0.0');

      const taskId = 'task-123';
      const progressUpdates: any[] = [];

      // Subscribe to task progress
      const unsubscribe = eventService.subscribeToTaskProgress(taskId, (progress: any) => {
        progressUpdates.push(progress);
      });
      window.testState.subscriptions.push(unsubscribe);

      // Start task (500ms total, 10 steps = 50ms per step)
      await eventService.startTask(taskId, 500);

      // Wait for task to complete
      await new Promise((resolve) => setTimeout(resolve, 700));

      return progressUpdates;
    });

    expect(progressEvents.length).toBeGreaterThan(0);

    // First event should be pending/running
    expect(progressEvents[0]).toMatchObject({
      taskId: 'task-123',
      progress: expect.any(Number),
    });

    // Last event should be completed
    const lastEvent = progressEvents[progressEvents.length - 1];
    expect(lastEvent).toMatchObject({
      taskId: 'task-123',
      progress: 100,
      status: 'completed',
    });
  });

  test('should unsubscribe from messages', async () => {
    const result = await page.evaluate(async () => {
      const eventService = await window.testState.wsPeer.queryInterface('EventService@1.0.0');

      const receivedMessages: any[] = [];

      // Subscribe
      const unsubscribe = eventService.subscribeToMessages((message: any) => {
        receivedMessages.push(message);
      });

      // Send message while subscribed
      await eventService.sendMessage('user1', 'Alice', 'Message 1');
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Unsubscribe
      unsubscribe();

      // Send message after unsubscribe
      await eventService.sendMessage('user2', 'Bob', 'Message 2');
      await new Promise((resolve) => setTimeout(resolve, 50));

      return receivedMessages;
    });

    // Should only receive first message
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      message: 'Message 1',
    });
  });

  test('should get subscription count', async () => {
    const counts = await page.evaluate(async () => {
      const eventService = await window.testState.wsPeer.queryInterface('EventService@1.0.0');

      // Subscribe to messages
      const unsub1 = eventService.subscribeToMessages(() => {});
      const unsub2 = eventService.subscribeToMessages(() => {});
      const unsub3 = eventService.subscribeToNotifications(() => {});
      window.testState.subscriptions.push(unsub1, unsub2, unsub3);

      // Get counts
      const counts = await eventService.getSubscriptionCount();

      return counts;
    });

    expect(counts).toMatchObject({
      messages: 2,
      notifications: 1,
      taskProgress: 0,
    });
  });
});

test.describe('WebSocket Events - Real-time Updates', () => {
  let page: Page;

  test.beforeEach(async ({ page: p }) => {
    page = p;
    await page.goto('/');

    await page.evaluate(async () => {
      const { WebSocketRemotePeer } = await import('../../src/netron/transport/websocket/peer.js');
      const peer = new WebSocketRemotePeer('ws://localhost:3334');
      await peer.connect();
      window.testState.wsPeer = peer;
      window.testState.subscriptions = [];
      window.updateConnectionStatus();
    });
  });

  test.afterEach(async () => {
    await page.evaluate(async () => {
      window.testState.subscriptions.forEach((unsub: () => void) => unsub());
      window.testState.subscriptions = [];

      if (window.testState.wsPeer) {
        await window.testState.wsPeer.disconnect();
        window.testState.wsPeer = null;
      }
      window.updateConnectionStatus();
    });
  });

  test('should receive periodic notifications', async () => {
    const notifications = await page.evaluate(async () => {
      const eventService = await window.testState.wsPeer.queryInterface('EventService@1.0.0');

      const receivedNotifications: any[] = [];

      // Subscribe to notifications (service emits every 5 seconds)
      const unsubscribe = eventService.subscribeToNotifications((notification: any) => {
        if (notification.title === 'Periodic Update') {
          receivedNotifications.push(notification);
        }
      });
      window.testState.subscriptions.push(unsubscribe);

      // Wait for at least one periodic notification (5+ seconds)
      await new Promise((resolve) => setTimeout(resolve, 6000));

      return receivedNotifications;
    });

    expect(notifications.length).toBeGreaterThanOrEqual(1);
    notifications.forEach((notif: any) => {
      expect(notif).toMatchObject({
        type: 'info',
        title: 'Periodic Update',
        message: expect.stringContaining('Server time:'),
      });
    });
  });

  test('should handle concurrent subscriptions', async () => {
    const result = await page.evaluate(async () => {
      const eventService = await window.testState.wsPeer.queryInterface('EventService@1.0.0');

      const messages1: any[] = [];
      const messages2: any[] = [];
      const messages3: any[] = [];

      // Multiple subscriptions to same event
      const unsub1 = eventService.subscribeToMessages((msg: any) => messages1.push(msg));
      const unsub2 = eventService.subscribeToMessages((msg: any) => messages2.push(msg));
      const unsub3 = eventService.subscribeToMessages((msg: any) => messages3.push(msg));
      window.testState.subscriptions.push(unsub1, unsub2, unsub3);

      // Send message
      await eventService.sendMessage('user1', 'Alice', 'Broadcast message');
      await new Promise((resolve) => setTimeout(resolve, 100));

      return {
        count1: messages1.length,
        count2: messages2.length,
        count3: messages3.length,
        allSame:
          JSON.stringify(messages1[0]) === JSON.stringify(messages2[0]) &&
          JSON.stringify(messages2[0]) === JSON.stringify(messages3[0]),
      };
    });

    expect(result.count1).toBe(1);
    expect(result.count2).toBe(1);
    expect(result.count3).toBe(1);
    expect(result.allSame).toBe(true);
  });

  test('should handle task with multiple progress updates', async () => {
    const progress = await page.evaluate(async () => {
      const eventService = await window.testState.wsPeer.queryInterface('EventService@1.0.0');

      const taskId = 'long-task';
      const progressUpdates: any[] = [];

      const unsubscribe = eventService.subscribeToTaskProgress(taskId, (progress: any) => {
        progressUpdates.push(progress);
      });
      window.testState.subscriptions.push(unsubscribe);

      // Start task with 2 second duration
      await eventService.startTask(taskId, 2000);

      // Wait for completion
      await new Promise((resolve) => setTimeout(resolve, 2500));

      return progressUpdates;
    });

    // Should have multiple progress updates (10 steps + completion)
    expect(progress.length).toBeGreaterThanOrEqual(10);

    // Progress should increase
    for (let i = 1; i < progress.length; i++) {
      expect(progress[i].progress).toBeGreaterThanOrEqual(progress[i - 1].progress);
    }

    // Last update should be 100%
    expect(progress[progress.length - 1].progress).toBe(100);
    expect(progress[progress.length - 1].status).toBe('completed');
  });
});

test.describe('WebSocket Events - High Frequency', () => {
  let page: Page;

  test.beforeEach(async ({ page: p }) => {
    page = p;
    await page.goto('/');

    await page.evaluate(async () => {
      const { WebSocketRemotePeer } = await import('../../src/netron/transport/websocket/peer.js');
      const peer = new WebSocketRemotePeer('ws://localhost:3334');
      await peer.connect();
      window.testState.wsPeer = peer;
      window.testState.subscriptions = [];
      window.updateConnectionStatus();
    });
  });

  test.afterEach(async () => {
    await page.evaluate(async () => {
      window.testState.subscriptions.forEach((unsub: () => void) => unsub());
      window.testState.subscriptions = [];

      if (window.testState.wsPeer) {
        await window.testState.wsPeer.disconnect();
        window.testState.wsPeer = null;
      }
      window.updateConnectionStatus();
    });
  });

  test('should handle high-frequency events (100 events, 10ms interval)', async () => {
    const result = await page.evaluate(async () => {
      const eventService = await window.testState.wsPeer.queryInterface('EventService@1.0.0');

      const notifications: any[] = [];

      const unsubscribe = eventService.subscribeToNotifications((notification: any) => {
        if (notification.title.startsWith('Rapid Event')) {
          notifications.push(notification);
        }
      });
      window.testState.subscriptions.push(unsubscribe);

      // Emit 100 events with 10ms interval
      const startTime = performance.now();
      await eventService.emitHighFrequency(100, 10);
      const duration = performance.now() - startTime;

      // Wait for all events to arrive
      await new Promise((resolve) => setTimeout(resolve, 500));

      return {
        count: notifications.length,
        duration,
        eventsPerSecond: (notifications.length / duration) * 1000,
      };
    });

    expect(result.count).toBe(100);
    expect(result.eventsPerSecond).toBeGreaterThan(50); // At least 50 events/sec
  });

  test('should handle rapid successive subscriptions', async () => {
    const result = await page.evaluate(async () => {
      const eventService = await window.testState.wsPeer.queryInterface('EventService@1.0.0');

      const notifications: any[] = [];

      // Subscribe and unsubscribe rapidly
      for (let i = 0; i < 10; i++) {
        const unsub = eventService.subscribeToNotifications((notification: any) => {
          notifications.push(notification);
        });

        if (i % 2 === 0) {
          unsub(); // Unsubscribe even-numbered subscriptions
        } else {
          window.testState.subscriptions.push(unsub);
        }
      }

      // Send notification
      await eventService.sendNotification('info', 'Test', 'Message');
      await new Promise((resolve) => setTimeout(resolve, 100));

      return {
        notificationCount: notifications.length,
        activeSubscriptions: window.testState.subscriptions.length,
      };
    });

    // Should have 5 active subscriptions (odd-numbered ones)
    expect(result.activeSubscriptions).toBe(5);
    // Each subscription should receive the notification
    expect(result.notificationCount).toBe(5);
  });

  test('should maintain event order', async () => {
    const messages = await page.evaluate(async () => {
      const eventService = await window.testState.wsPeer.queryInterface('EventService@1.0.0');

      const receivedMessages: any[] = [];

      const unsubscribe = eventService.subscribeToMessages((message: any) => {
        receivedMessages.push(message);
      });
      window.testState.subscriptions.push(unsubscribe);

      // Send messages rapidly
      for (let i = 0; i < 50; i++) {
        await eventService.sendMessage(`user${i}`, `User ${i}`, `Message ${i}`);
      }

      // Wait for all messages
      await new Promise((resolve) => setTimeout(resolve, 500));

      return receivedMessages;
    });

    expect(messages).toHaveLength(50);

    // Verify order
    for (let i = 0; i < 50; i++) {
      expect(messages[i]).toMatchObject({
        userId: `user${i}`,
        userName: `User ${i}`,
        message: `Message ${i}`,
      });
    }
  });

  test('should handle stress test (500 events, 5ms interval)', async () => {
    const result = await page.evaluate(async () => {
      const eventService = await window.testState.wsPeer.queryInterface('EventService@1.0.0');

      const notifications: any[] = [];
      let lastTimestamp = 0;
      const gaps: number[] = [];

      const unsubscribe = eventService.subscribeToNotifications((notification: any) => {
        if (notification.title.startsWith('Rapid Event')) {
          const now = Date.now();
          if (lastTimestamp > 0) {
            gaps.push(now - lastTimestamp);
          }
          lastTimestamp = now;
          notifications.push(notification);
        }
      });
      window.testState.subscriptions.push(unsubscribe);

      const startTime = performance.now();
      await eventService.emitHighFrequency(500, 5);
      const emitDuration = performance.now() - startTime;

      // Wait for all events
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const avgGap = gaps.length > 0 ? gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length : 0;
      const maxGap = gaps.length > 0 ? Math.max(...gaps) : 0;

      return {
        count: notifications.length,
        emitDuration,
        avgGap,
        maxGap,
        throughput: (notifications.length / emitDuration) * 1000,
      };
    });

    expect(result.count).toBe(500);
    expect(result.throughput).toBeGreaterThan(100); // At least 100 events/sec
    expect(result.avgGap).toBeLessThan(50); // Average gap less than 50ms
  });
});

test.describe('WebSocket Events - Error Handling', () => {
  let page: Page;

  test.beforeEach(async ({ page: p }) => {
    page = p;
    await page.goto('/');

    await page.evaluate(async () => {
      const { WebSocketRemotePeer } = await import('../../src/netron/transport/websocket/peer.js');
      const peer = new WebSocketRemotePeer('ws://localhost:3334');
      await peer.connect();
      window.testState.wsPeer = peer;
      window.testState.subscriptions = [];
      window.updateConnectionStatus();
    });
  });

  test.afterEach(async () => {
    await page.evaluate(async () => {
      window.testState.subscriptions.forEach((unsub: () => void) => unsub());
      window.testState.subscriptions = [];

      if (window.testState.wsPeer) {
        await window.testState.wsPeer.disconnect();
        window.testState.wsPeer = null;
      }
      window.updateConnectionStatus();
    });
  });

  test('should handle subscription callback errors gracefully', async () => {
    const result = await page.evaluate(async () => {
      const eventService = await window.testState.wsPeer.queryInterface('EventService@1.0.0');

      let errorThrown = false;
      let successCount = 0;

      // Subscription that throws error
      const unsubscribe = eventService.subscribeToMessages((message: any) => {
        if (message.message === 'error') {
          errorThrown = true;
          throw new Error('Callback error');
        }
        successCount++;
      });
      window.testState.subscriptions.push(unsubscribe);

      // Send messages
      await eventService.sendMessage('user1', 'Alice', 'Message 1');
      await eventService.sendMessage('user2', 'Bob', 'error');
      await eventService.sendMessage('user3', 'Charlie', 'Message 2');

      await new Promise((resolve) => setTimeout(resolve, 100));

      return { errorThrown, successCount };
    });

    expect(result.errorThrown).toBe(true);
    expect(result.successCount).toBe(2); // First and third message
  });

  test('should handle reconnection', async () => {
    const result = await page.evaluate(async () => {
      const eventService = await window.testState.wsPeer.queryInterface('EventService@1.0.0');

      const messages: any[] = [];

      const unsubscribe = eventService.subscribeToMessages((message: any) => {
        messages.push(message);
      });
      window.testState.subscriptions.push(unsubscribe);

      // Send message
      await eventService.sendMessage('user1', 'Alice', 'Before disconnect');
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Disconnect and reconnect
      await window.testState.wsPeer.disconnect();
      await window.testState.wsPeer.connect();

      // Resubscribe (after reconnect)
      const eventService2 = await window.testState.wsPeer.queryInterface('EventService@1.0.0');
      const unsubscribe2 = eventService2.subscribeToMessages((message: any) => {
        messages.push(message);
      });
      window.testState.subscriptions.push(unsubscribe2);

      // Send message after reconnect
      await eventService2.sendMessage('user2', 'Bob', 'After reconnect');
      await new Promise((resolve) => setTimeout(resolve, 100));

      return messages;
    });

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ message: 'Before disconnect' });
    expect(result[1]).toMatchObject({ message: 'After reconnect' });
  });
});
