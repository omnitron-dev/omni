/**
 * Netron Event Subscriptions Example
 * Demonstrates real-time event handling with Netron client
 */

import { NetronClient } from '@omnitron-dev/aether/netron';

interface NotificationService {
  sendNotification(userId: string, message: string): Promise<void>;
  broadcastMessage(message: string): Promise<void>;
}

interface ChatService {
  sendMessage(roomId: string, message: string): Promise<void>;
  joinRoom(roomId: string): Promise<void>;
  leaveRoom(roomId: string): Promise<void>;
}

async function main() {
  console.log('=== Netron Event Subscriptions Example ===\n');

  const client = new NetronClient({
    url: 'ws://localhost:3000',
    reconnect: true,
  });

  try {
    await client.connect();
    console.log('Connected to server\n');

    // 1. Subscribe to system events
    console.log('Subscribing to system events...');
    await client.subscribe('system.broadcast', (data: any) => {
      console.log('[SYSTEM]', data.message);
    });

    // 2. Subscribe to user notifications
    console.log('Subscribing to user notifications...');
    await client.subscribe('user.notification', (data: any) => {
      console.log('[NOTIFICATION]', data.title, '-', data.body);
    });

    // 3. Subscribe to chat messages
    console.log('Subscribing to chat messages...');
    const chatMessageHandler = (data: any) => {
      const timestamp = new Date(data.timestamp).toLocaleTimeString();
      console.log(`[CHAT] [${timestamp}] ${data.user}: ${data.message}`);
    };
    await client.subscribe('chat.message', chatMessageHandler);
    console.log('Subscriptions active\n');

    // 4. Get services
    const chatService = await client.queryInterface<ChatService>('ChatService@1.0.0');
    const notificationService = await client.queryInterface<NotificationService>('NotificationService@1.0.0');

    // 5. Join chat room
    console.log('Joining chat room...');
    await chatService.joinRoom('general');
    console.log('Joined room: general\n');

    // 6. Send messages
    console.log('Sending chat messages...');
    await chatService.sendMessage('general', 'Hello from Netron client!');
    await chatService.sendMessage('general', 'Testing real-time messaging');

    // 7. Send notification
    await notificationService.sendNotification('user-123', 'Test notification');

    // 8. Broadcast message
    await notificationService.broadcastMessage('System maintenance in 10 minutes');

    // Keep connection alive for 30 seconds to receive events
    console.log('\nListening for events (30 seconds)...\n');
    await new Promise(resolve => setTimeout(resolve, 30000));

    // 9. Unsubscribe from specific event
    console.log('\nUnsubscribing from chat messages...');
    await client.unsubscribe('chat.message', chatMessageHandler);
    console.log('Unsubscribed from chat.message');

    // 10. Leave chat room
    await chatService.leaveRoom('general');
    console.log('Left room: general');
  } catch (error: any) {
    console.error('Error:', error.message);
  } finally {
    await client.disconnect();
    console.log('\nDisconnected');
  }
}

main().catch(console.error);
