# Rotif: Robust Redis-Based Notification System

Rotif is a highly scalable, reliable, and feature-rich notification and messaging library built on top of Redis streams and Pub/Sub, written in TypeScript. It provides guaranteed message delivery, retry mechanisms, delayed delivery, dead letter queues (DLQ), and middleware hooks, all while maintaining high performance and ease of integration.

---

## Key Features

### ✅ Reliable Delivery
- **Exactly-once Processing:**
  - Built-in deduplication ensures each message is processed exactly once using Redis or in-memory stores.
- **Acknowledgments (ACK):**
  - Explicit message acknowledgment ensures no message is lost or prematurely removed.

### 🔄 Retry and Error Handling
- **Configurable Retries:**
  - Set a custom number of retries per subscription or globally.
- **Flexible Retry Delays:**
  - Fixed or dynamic retry delays based on attempts or message content.
- **Dead Letter Queue (DLQ):**
  - Messages exceeding retry limits are moved to a dedicated DLQ for further inspection or reprocessing.

### ⏲️ Delayed Delivery
- **Delayed Messaging:**
  - Supports scheduling messages to be delivered after a specified delay or at a specific timestamp.

### 📊 Monitoring & Statistics
- **Built-in Stats Tracking:**
  - Track the number of messages processed, retries, failures, and timestamps of the last processed messages.

### 🔧 Middleware Support
- **Hooks for Custom Logic:**
  - Execute custom logic before/after publishing and processing messages, and handle errors gracefully.

### 🚀 Scalability
- **Consumer Groups:**
  - Supports Redis consumer groups for horizontal scaling.
- **Redis Pub/Sub Mode:**
  - Lightweight messaging without persistence using Redis Pub/Sub.

---

## Installation

```bash
npm install @devgrid/rotif
```

## Basic Usage

### Initialization

```typescript
import { NotificationManager } from '@devgrid/rotif';

const manager = new NotificationManager({
  redis: 'redis://localhost:6379',
  maxRetries: 3,
  checkDelayInterval: 1000,
});
```

### Publishing Messages

```typescript
await manager.publish('channel.example', { foo: 'bar' });
```

#### Delayed Delivery

```typescript
await manager.publish('channel.example', { delayed: true }, { delayMs: 5000 });
```

### Subscribing to Messages

```typescript
await manager.subscribe('channel.*', async (msg) => {
  console.log('Received:', msg.payload);
  await msg.ack();
});
```

### Retry & DLQ Example

```typescript
await manager.subscribe('channel.retry', async (msg) => {
  if (msg.attempt < 2) {
    throw new Error('Retry required');
  }
  await msg.ack();
}, { maxRetries: 2 });

await manager.subscribeToDLQ(async (msg) => {
  console.error('DLQ Message:', msg.payload);
  await msg.ack();
});
```

---

## Advanced Features

### Exactly-once Processing

Enable exactly-once semantics:

```typescript
await manager.subscribe('exactly.once', async (msg) => {
  console.log(msg.payload);
  await msg.ack();
}, { exactlyOnce: true });
```

### Middleware

Implement custom logic through middleware hooks:

```typescript
manager.use({
  beforePublish: (channel, payload) => console.log('Publishing', channel, payload),
  afterProcess: (msg) => console.log('Processed', msg.id),
  onError: (msg, err) => console.error('Error on', msg.id, err),
});
```

---

## Use Cases

Rotif is ideal for:

- **Microservices architectures:** Reliable service-to-service communication.
- **Event-driven systems:** Handling events with retries and DLQ management.
- **Delayed notifications:** Scheduling reminders, emails, or deferred tasks.
- **Real-time applications:** Chat messages, notifications, or system alerts.
- **Batch processing and retries:** Reliable batch jobs with retry logic and DLQ fallback.

---

## Redis Scalability Recommendations

- **Horizontal Scaling:**
  - Utilize Redis consumer groups to distribute message load across multiple application instances.
- **Sharding & Clustering:**
  - Consider Redis Cluster for scaling Redis beyond single-node limits.
- **Replication & Persistence:**
  - Enable Redis replication and append-only file (AOF) or RDB snapshotting for data durability.
- **Monitoring:**
  - Monitor Redis memory usage, stream lengths, and latency to ensure optimal performance.

---

## Configuration Options

Detailed configuration via `RotifConfig`:

- `redis`: Redis connection settings.
- `maxRetries`: Global retry limit.
- `checkDelayInterval`: Frequency of delayed message checks.
- `enableDelayed`: Toggle delayed delivery.
- `blockInterval`: Redis blocking read interval.
- `logger`: Custom logger implementation.

---

## Graceful Shutdown

Always gracefully shutdown Rotif:

```typescript
process.on('SIGINT', async () => {
  await manager.stopAll();
  process.exit();
});
```

---

## Advanced Topics

### Message Processing Patterns

#### Batch Processing
You can implement batch processing by accumulating messages before processing:

```typescript
const batchSize = 100;
const messages: any[] = [];

manager.subscribe('orders.created', async (msg) => {
  messages.push(msg);
  
  if (messages.length >= batchSize) {
    await processBatch(messages);
    messages.length = 0;
  }
}, { group: 'batch-processor' });
```

#### Priority Processing
Implement priority queues using separate streams:

```typescript
// High priority subscriber
manager.subscribe('orders.high', async (msg) => {
  // Process high priority orders
}, { group: 'order-processor' });

// Low priority subscriber
manager.subscribe('orders.low', async (msg) => {
  // Process low priority orders
}, { group: 'order-processor' });
```

### Performance Optimization

#### Stream Length Management
Control stream length to optimize memory usage:

```typescript
const manager = new NotificationManager({
  maxStreamLength: 10000,  // Keep approximately 10k messages
  // or
  minStreamId: '1-0',     // Keep messages after this ID
});
```

#### Consumer Group Optimization
Optimize consumer group performance:

```typescript
// Balanced consumer groups
const manager = new NotificationManager({
  groupNameFn: (pattern) => `${pattern}-group`,
  consumerNameFn: () => `consumer-${process.pid}`,
  blockInterval: 1000,  // 1 second blocking interval
});
```

### Monitoring and Debugging

#### Health Checks
Implement health checks for your notification system:

```typescript
async function checkHealth() {
  const subscriptions = manager.getSubscriptions();
  
  for (const sub of subscriptions) {
    const stats = sub.stats();
    
    if (stats.failures > threshold) {
      console.error(`High failure rate in subscription ${sub.pattern}`);
    }
    
    if (stats.pending > maxPending) {
      console.warn(`High pending messages in ${sub.pattern}`);
    }
  }
}
```

#### Metrics Collection
Collect metrics using middleware:

```typescript
const metricsMiddleware: Middleware = {
  beforeProcess: async (msg) => {
    metrics.increment(`message_processing_start{event=${msg.channel}}`);
  },
  afterProcess: async (msg) => {
    metrics.increment(`message_processing_success{event=${msg.channel}}`);
  },
  onError: async (msg, error) => {
    metrics.increment(`message_processing_error{event=${msg.channel},error=${error.name}}`);
  }
};

manager.use(metricsMiddleware);
```

### Error Handling Strategies

#### Custom Error Handling
Implement sophisticated error handling:

```typescript
manager.subscribe('critical.events', async (msg) => {
  try {
    await processMessage(msg);
  } catch (error) {
    if (error instanceof NetworkError) {
      // Retry with exponential backoff
      return msg.retry();
    }
    if (error instanceof ValidationError) {
      // Move to DLQ immediately
      throw error;
    }
    // Default error handling
    console.error('Processing error:', error);
    throw error;
  }
}, {
  maxRetries: 3,
  retryDelay: (attempt) => Math.pow(2, attempt) * 1000, // Exponential backoff
});
```

#### DLQ Processing
Handle Dead Letter Queue messages:

```typescript
// Subscribe to DLQ
manager.subscribeToDLQ(async (msg) => {
  console.log('Processing DLQ message:', msg);
  
  try {
    // Attempt to reprocess
    await processMessage(msg);
    
    // If successful, remove from DLQ
    await msg.ack();
  } catch (error) {
    console.error('Failed to process DLQ message:', error);
    // Keep in DLQ by not acknowledging
  }
});

// Requeue messages from DLQ
async function requeueDLQMessages() {
  const count = await manager.requeueFromDLQ(10); // Requeue 10 messages
  console.log(`Requeued ${count} messages from DLQ`);
}
```

### Testing and Development

#### Integration Testing
Example of integration tests:

```typescript
describe('NotificationManager Integration', () => {
  let manager: NotificationManager;
  
  beforeEach(async () => {
    manager = new NotificationManager({
      redis: 'redis://localhost:6379/1', // Use separate DB for tests
      maxRetries: 2
    });
    await manager.redis.flushdb(); // Clean test database
  });
  
  afterEach(async () => {
    await manager.stopAll();
  });
  
  it('should process messages in order', async () => {
    const received: string[] = [];
    
    await manager.subscribe('test.order', async (msg) => {
      received.push(msg.id);
    }, { group: 'test-group' });
    
    await manager.publish('test.order', { seq: 1 });
    await manager.publish('test.order', { seq: 2 });
    
    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    expect(received).toHaveLength(2);
    expect(received[0]).toBeLessThan(received[1]); // Check order
  });
});
```

#### Mocking for Unit Tests
Example of mocking the notification system:

```typescript
class MockNotificationManager {
  private handlers = new Map<string, Function>();
  
  async publish(channel: string, payload: any) {
    const handler = this.handlers.get(channel);
    if (handler) {
      await handler({ channel, payload, id: 'mock-id' });
    }
  }
  
  subscribe(channel: string, handler: Function) {
    this.handlers.set(channel, handler);
    return {
      unsubscribe: () => this.handlers.delete(channel)
    };
  }
}
```

### Security Considerations

#### Authentication and Authorization
Secure your Redis connection:

```typescript
const manager = new NotificationManager({
  redis: {
    url: 'redis://localhost:6379',
    password: process.env.REDIS_PASSWORD,
    tls: {
      // TLS configuration
      ca: fs.readFileSync('path/to/ca.crt'),
      cert: fs.readFileSync('path/to/client.crt'),
      key: fs.readFileSync('path/to/client.key')
    }
  }
});
```

#### Message Validation
Implement message validation:

```typescript
const validationMiddleware: Middleware = {
  beforePublish: async (channel, payload) => {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid payload format');
    }
    
    // Channel-specific validation
    if (channel.startsWith('user.')) {
      if (!payload.userId) {
        throw new Error('Missing userId in user event');
      }
    }
  }
};

manager.use(validationMiddleware);
```

### Production Deployment

#### Docker Configuration
Example Docker configuration:

```dockerfile
FROM node:16-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV REDIS_URL=redis://redis:6379

CMD ["node", "dist/index.js"]
```

#### Kubernetes Deployment
Example Kubernetes deployment:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: notification-service
spec:
  replicas: 3
  selector:
    matchLabels:
      app: notification-service
  template:
    metadata:
      labels:
        app: notification-service
    spec:
      containers:
      - name: notification-service
        image: notification-service:1.0.0
        env:
        - name: REDIS_URL
          valueFrom:
            secretKeyRef:
              name: redis-credentials
              key: url
        resources:
          requests:
            memory: "128Mi"
            cpu: "100m"
          limits:
            memory: "256Mi"
            cpu: "200m"
```

### Troubleshooting Guide

#### Common Issues and Solutions

1. **Messages Not Being Delivered**
   - Check Redis connection
   - Verify consumer group exists
   - Check subscription patterns
   - Ensure no network issues

2. **High Memory Usage**
   - Monitor stream length
   - Implement proper trimming
   - Check for memory leaks
   - Monitor Redis memory usage

3. **Performance Issues**
   - Optimize batch sizes
   - Adjust blocking intervals
   - Scale horizontally
   - Monitor Redis performance

4. **Message Loss**
   - Enable persistence
   - Use proper acknowledgment
   - Implement retry logic
   - Monitor DLQ

### API Reference

#### NotificationManager Methods

```typescript
class NotificationManager {
  /**
   * Creates a new NotificationManager instance
   */
  constructor(config: RotifConfig);

  /**
   * Publishes a message to a channel
   */
  async publish(channel: string, payload: any, options?: PublishOptions): Promise<string>;

  /**
   * Subscribes to a channel
   */
  async subscribe(
    pattern: string,
    handler: (msg: RotifMessage) => Promise<void>,
    options?: SubscribeOptions
  ): Promise<Subscription>;

  /**
   * Subscribes to the Dead Letter Queue
   */
  async subscribeToDLQ(
    handler: (msg: RotifMessage) => Promise<void>
  ): Promise<void>;

  /**
   * Requeues messages from DLQ
   */
  async requeueFromDLQ(count?: number): Promise<void>;

  /**
   * Stops all subscriptions
   */
  async stopAll(): Promise<void>;
}
```

## Contribution

Contributions are welcome! Submit issues and pull requests on [GitHub](https://github.com/d-e-v-grid/dg-monorepo).

---

## License

MIT © [DevGrid](https://github.com/d-e-v-grid/dg-monorepo)

---

For more information, please consult the [GitHub repository](https://github.com/d-e-v-grid/dg-monorepo).
