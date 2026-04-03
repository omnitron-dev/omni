# Notifications Channel System

Comprehensive channel management for notification delivery in the Notifications module.

## Features

- **Channel Registry**: Centralized management of all notification channels
- **Multiple Channel Types**: Email, SMS, Push, In-App, and Webhook
- **Health Monitoring**: Built-in health checks for all channels
- **Abstract Base Classes**: Easy extension for custom implementations
- **Production-Ready Implementations**: InApp and Webhook channels ready to use
- **Type-Safe**: Full TypeScript support with comprehensive interfaces

## Architecture

### Channel Interface

All channels implement the `NotificationChannel` interface:

```typescript
interface NotificationChannel {
  readonly name: string;
  readonly type: ChannelType;

  initialize?(): Promise<void>;
  shutdown?(): Promise<void>;
  isAvailable(): Promise<boolean>;
  healthCheck(): Promise<ChannelHealth>;
  validateRecipient(recipient: NotificationRecipient): boolean;
  formatContent(notification: NotificationPayload): ChannelContent;
  send(recipient: NotificationRecipient, content: ChannelContent): Promise<ChannelSendResult>;
}
```

### Channel Types

- `ChannelType.Email` - Email delivery
- `ChannelType.SMS` - SMS text messages
- `ChannelType.Push` - Push notifications (iOS, Android, Web)
- `ChannelType.InApp` - In-application notifications
- `ChannelType.Webhook` - HTTP webhook delivery

## Usage

### 1. Setting Up the Channel Registry

```typescript
import { ChannelRegistry, InAppChannel, WebhookChannel } from '@omnitron-dev/titan/module/notifications';

// Create registry
const registry = new ChannelRegistry();

// Register channels
registry.register(new InAppChannel(redisClient));
registry.register(new WebhookChannel({ timeout: 5000, retries: 3 }));

// Initialize all channels
await registry.initializeAll();

// Get a channel
const inAppChannel = registry.get('inApp');

// Health check all channels
const health = await registry.healthCheck();
```

### 2. Using the InApp Channel

```typescript
import { InAppChannel } from '@omnitron-dev/titan/module/notifications';

// Create channel with Redis client
const inAppChannel = new InAppChannel(redisClient);

// Configure options
inAppChannel.configure({
  keyPrefix: 'myapp:notifications',
  defaultTTL: 604800, // 7 days
  maxNotificationsPerUser: 200,
  enableRealtime: true,
});

// Send notification
const result = await inAppChannel.send(
  { id: 'user123', email: 'user@example.com' },
  {
    title: 'New Message',
    message: 'You have a new message from John',
    type: 'info',
    data: { messageId: '456' },
  }
);

// Get unread notifications
const unread = await inAppChannel.getUnread('user123', 20);

// Mark as read
await inAppChannel.markAsRead('user123', notificationId);

// Get unread count
const count = await inAppChannel.getCount('user123');
```

### 3. Using the Webhook Channel

```typescript
import { WebhookChannel, verifyWebhookSignature } from '@omnitron-dev/titan/module/notifications';

// Create channel with options
const webhookChannel = new WebhookChannel({
  timeout: 10000,
  retries: 3,
  retryDelay: 1000,
  signatureSecret: 'your-secret-key',
  signatureHeader: 'X-Webhook-Signature',
  signatureAlgorithm: 'sha256',
});

// Send notification
const result = await webhookChannel.send(
  { id: 'user123', webhookUrl: 'https://example.com/webhook' },
  {
    payload: {
      id: 'notif-123',
      type: 'alert',
      title: 'System Alert',
      message: 'High CPU usage detected',
      data: { cpu: 95, timestamp: Date.now() },
    },
  }
);

// Verify webhook signature (in your webhook receiver)
const isValid = verifyWebhookSignature(
  requestBody,
  request.headers['x-webhook-signature'],
  'your-secret-key',
  'sha256'
);
```

### 4. Implementing Custom Email Channel

```typescript
import { AbstractEmailChannel, type EmailContent } from '@omnitron-dev/titan/module/notifications';
import nodemailer from 'nodemailer';

class NodemailerEmailChannel extends AbstractEmailChannel {
  private transporter: nodemailer.Transporter;

  constructor(config: nodemailer.TransportOptions) {
    super();
    this.transporter = nodemailer.createTransport(config);

    this.configure({
      from: 'notifications@example.com',
      replyTo: 'support@example.com',
    });
  }

  async sendEmail(to: string, content: EmailContent): Promise<{ messageId: string }> {
    const result = await this.transporter.sendMail({
      from: content.from,
      to,
      subject: content.subject,
      text: content.text,
      html: content.html,
      replyTo: content.replyTo,
    });

    return { messageId: result.messageId };
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.transporter.verify();
      return true;
    } catch {
      return false;
    }
  }
}

// Use the custom channel
const emailChannel = new NodemailerEmailChannel({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: { user: 'your@gmail.com', pass: 'password' },
});

registry.register(emailChannel);
```

### 5. Implementing Custom SMS Channel

```typescript
import { AbstractSMSChannel, type SMSContent } from '@omnitron-dev/titan/module/notifications';
import { Twilio } from 'twilio';

class TwilioSMSChannel extends AbstractSMSChannel {
  private client: Twilio;

  constructor(accountSid: string, authToken: string, fromNumber: string) {
    super();
    this.client = new Twilio(accountSid, authToken);

    this.configure({
      from: fromNumber,
      maxLength: 160,
      truncateLongMessages: true,
      includeTypePrefix: true,
    });
  }

  async sendSMS(to: string, content: SMSContent): Promise<{ messageId: string }> {
    const result = await this.client.messages.create({
      to: this.normalizePhone(to),
      from: content.from || this.options.from,
      body: content.text,
    });

    return { messageId: result.sid };
  }
}
```

### 6. Implementing Custom Push Channel

```typescript
import { AbstractPushChannel, type PushContent, type PushSendResult } from '@omnitron-dev/titan/module/notifications';
import * as admin from 'firebase-admin';

class FCMPushChannel extends AbstractPushChannel {
  private messaging: admin.messaging.Messaging;

  constructor(serviceAccount: admin.ServiceAccount) {
    super();
    const app = admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    this.messaging = app.messaging();

    this.configure({
      batchSize: 500,
      priority: 'high',
      ttl: 86400,
    });
  }

  async sendPush(tokens: string[], content: PushContent): Promise<PushSendResult> {
    const message = {
      notification: {
        title: content.title,
        body: content.body,
      },
      data: content.data as Record<string, string>,
      tokens,
    };

    const result = await this.messaging.sendEachForMulticast(message);

    const invalidTokens = result.responses
      .map((resp, idx) => (resp.success ? null : tokens[idx]))
      .filter((token): token is string => token !== null);

    return {
      successCount: result.successCount,
      failureCount: result.failureCount,
      invalidTokens: invalidTokens.length > 0 ? invalidTokens : undefined,
    };
  }
}
```

### 7. Health Monitoring

```typescript
// Check health of all channels
const healthMap = await registry.healthCheck();

for (const [name, health] of healthMap.entries()) {
  console.log(`${name}: ${health.available ? 'UP' : 'DOWN'} (${health.latency}ms)`);
  if (health.error) {
    console.error(`  Error: ${health.error}`);
  }
}

// Check specific channel availability
const available = await registry.get('email')?.isAvailable();
```

### 8. Channel Lifecycle

```typescript
// Initialize all channels
await registry.initializeAll();

// Shutdown all channels (cleanup resources)
await registry.shutdownAll();

// Individual channel lifecycle
const channel = new WebhookChannel();
await channel.initialize?.();
// ... use channel ...
await channel.shutdown?.();
```

## Content Types

Each channel type has its own content interface:

### EmailContent
```typescript
interface EmailContent {
  subject: string;
  text: string;
  html?: string;
  from?: string;
  replyTo?: string;
  attachments?: Array<{
    filename: string;
    content: Buffer | string;
    contentType?: string;
  }>;
}
```

### SMSContent
```typescript
interface SMSContent {
  text: string;
  from?: string;
}
```

### PushContent
```typescript
interface PushContent {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  badge?: number;
  sound?: string;
  icon?: string;
  image?: string;
  clickAction?: string;
}
```

### InAppContent
```typescript
interface InAppContent {
  title: string;
  message: string;
  type: string;
  priority?: string;
  data?: Record<string, unknown>;
}
```

### WebhookContent
```typescript
interface WebhookContent {
  payload: Record<string, unknown>;
  headers?: Record<string, string>;
}
```

## File Structure

```
channel/
├── channel.interface.ts       # Channel interfaces and types
├── channel-registry.ts        # Channel registry service
├── index.ts                   # Main exports
├── README.md                  # This file
└── channels/
    ├── email.channel.ts       # Abstract email channel
    ├── sms.channel.ts         # Abstract SMS channel
    ├── push.channel.ts        # Abstract push channel
    ├── inapp.channel.ts       # InApp channel implementation
    ├── webhook.channel.ts     # Webhook channel implementation
    └── index.ts               # Channel exports
```

## Best Practices

1. **Always initialize channels** before use:
   ```typescript
   await registry.initializeAll();
   ```

2. **Use health checks** to monitor channel availability:
   ```typescript
   const health = await channel.healthCheck();
   if (!health.available) {
     // Handle unavailable channel
   }
   ```

3. **Validate recipients** before sending:
   ```typescript
   if (channel.validateRecipient(recipient)) {
     await channel.send(recipient, content);
   }
   ```

4. **Handle send failures** gracefully:
   ```typescript
   const result = await channel.send(recipient, content);
   if (!result.success) {
     console.error(`Failed to send: ${result.error}`);
     // Implement fallback strategy
   }
   ```

5. **Configure channels** appropriately for your use case:
   ```typescript
   webhookChannel.configure({
     timeout: 10000,
     retries: 5,
     signatureSecret: process.env.WEBHOOK_SECRET,
   });
   ```

6. **Clean up resources** on shutdown:
   ```typescript
   process.on('SIGTERM', async () => {
     await registry.shutdownAll();
   });
   ```

## Testing

Mock implementations are provided for testing:

```typescript
import { MockEmailChannel, MockSMSChannel, MockPushChannel } from '@omnitron-dev/titan/module/notifications';

// Email testing
const mockEmail = new MockEmailChannel();
await mockEmail.send(recipient, content);
const sentEmails = mockEmail.getSentEmails();
expect(sentEmails).toHaveLength(1);
mockEmail.clearSentEmails();

// SMS testing
const mockSMS = new MockSMSChannel();
await mockSMS.send(recipient, content);
const sentMessages = mockSMS.getSentMessages();

// Push testing
const mockPush = new MockPushChannel();
await mockPush.send(recipient, content);
const sentNotifications = mockPush.getSentNotifications();
```

## Error Handling

All channel methods return results with error information:

```typescript
const result = await channel.send(recipient, content);

if (!result.success) {
  switch (result.error) {
    case 'Recipient does not have an email address':
      // Handle missing email
      break;
    case 'HTTP 429: Too Many Requests':
      // Handle rate limiting
      break;
    default:
      // Handle generic error
      console.error(result.error);
  }
}
```

## Integration with Notifications Service

Channels are designed to integrate seamlessly with the Notifications service:

```typescript
import { NotificationsModule, ChannelRegistry, InAppChannel } from '@omnitron-dev/titan/module/notifications';

@Module({
  imports: [
    NotificationsModule.forRootAsync({
      useFactory: async (redis: RedisService) => {
        const registry = new ChannelRegistry();
        registry.register(new InAppChannel(redis.getClient()));

        return {
          channelRouter: {
            route: async (recipient, payload, channels) => {
              // Custom routing logic
              return channels || ['inApp'];
            },
          },
        };
      },
      inject: [REDIS_SERVICE],
    }),
  ],
})
export class AppModule {}
```
