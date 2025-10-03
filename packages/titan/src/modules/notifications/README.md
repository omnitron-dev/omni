# Titan Notifications Module - Complete Documentation

## Table of Contents

1. [Introduction](#introduction)
2. [Architecture Overview](#architecture-overview)
3. [Core Components](#core-components)
4. [Installation & Setup](#installation--setup)
5. [Configuration Options](#configuration-options)
6. [Notification Service](#notification-service)
7. [Channel Management](#channel-management)
8. [Template Engine](#template-engine)
9. [Workflow Engine](#workflow-engine)
10. [User Preferences](#user-preferences)
11. [Rate Limiting](#rate-limiting)
12. [Analytics & Reporting](#analytics--reporting)
13. [Module Integration](#module-integration)
14. [API Reference](#api-reference)
15. [Type Definitions](#type-definitions)
16. [Decorators & Injection](#decorators--injection)
17. [Error Handling](#error-handling)
18. [Performance Optimization](#performance-optimization)
19. [Best Practices](#best-practices)
20. [Migration Guide](#migration-guide)
21. [Troubleshooting](#troubleshooting)
22. [Examples](#examples)

## Introduction

The Titan Notifications Module provides a comprehensive, enterprise-grade notification system for Titan applications. Built on top of the Rotif reliable messaging system, it offers multi-channel delivery, user preferences, rate limiting, templating, workflows, and analytics.

### Key Features

- **Multi-Channel Delivery**: Email, SMS, Push, Webhook, In-App notifications
- **User Preferences**: Granular control over notification delivery
- **Rate Limiting**: Prevent notification fatigue with intelligent throttling
- **Template Engine**: Dynamic content generation with variable replacement
- **Workflow Engine**: Complex notification sequences and automation
- **Analytics & Reporting**: Track engagement metrics and performance
- **Deduplication**: Prevent duplicate notifications
- **Batch Processing**: Efficient handling of bulk notifications
- **Scheduling**: Delayed and scheduled notification delivery
- **Real-Time Events**: PubSub-based event streaming
- **Quiet Hours**: Respect user time preferences
- **Localization**: Multi-language support

### Use Cases

1. **User Onboarding**: Welcome email series with timed follow-ups
2. **Transactional Alerts**: Order confirmations, password resets
3. **Marketing Campaigns**: Targeted promotional notifications
4. **System Alerts**: Error notifications, maintenance windows
5. **Activity Updates**: Social notifications, comments, likes
6. **Reminder Systems**: Appointment reminders, task deadlines
7. **Broadcasting**: Announcements to user segments
8. **Emergency Alerts**: Critical system-wide notifications

## Architecture Overview

### System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Application Layer                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │   API/HTTP   │  │   WebSocket  │  │   Workers    │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         └──────────────────┼──────────────────┘                 │
├─────────────────────────────┼────────────────────────────────────┤
│              Notification Service Layer                          │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                  NotificationService                       │ │
│  │  • Send notifications  • Broadcast to segments             │ │
│  │  • Schedule delivery   • Deduplication                     │ │
│  └────────┬──────────────────────────────┬────────────────────┘ │
│           │                              │                       │
│  ┌────────▼──────────┐          ┌───────▼──────────┐           │
│  │  ChannelManager   │          │  PreferenceManager│           │
│  │  • Route to channels         │  • User preferences│          │
│  │  • Fallback logic │          │  • Quiet hours     │          │
│  └───────────────────┘          └──────────────────┘           │
│                                                                  │
│  ┌──────────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │   RateLimiter    │  │TemplateEngine│  │  WorkflowEngine  │  │
│  │  • Throttling    │  │ • Variables  │  │  • Sequences     │  │
│  │  • Burst control │  │ • Caching    │  │  • Conditions    │  │
│  └──────────────────┘  └──────────────┘  └──────────────────┘  │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                     Analytics                              │ │
│  │  • Event tracking  • Metrics  • Reports  • Real-time stats │ │
│  └────────────────────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────────────────────┤
│                    Infrastructure Layer                          │
│  ┌──────────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │      Rotif       │  │    Redis     │  │  External APIs   │  │
│  │  • Message queue │  │ • Storage    │  │  • Email (SMTP)  │  │
│  │  • Reliability   │  │ • Caching    │  │  • SMS (Twilio)  │  │
│  │  • Dedup         │  │ • PubSub     │  │  • Push (FCM)    │  │
│  └──────────────────┘  └──────────────┘  └──────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow

```
User Action
    ↓
Notification Request → Deduplication Check → Preference Filter
    ↓                      ↓                     ↓
Template Render      Rate Limit Check      Channel Selection
    ↓                      ↓                     ↓
Content Generation   Throttle/Allow        Delivery Planning
    ↓                      ↓                     ↓
    └──────────────────────┴─────────────────────┘
                           ↓
                    Rotif Queue
                           ↓
                    Channel Delivery
                           ↓
                    Analytics Tracking
```

## Core Components

### 1. NotificationService

The main service orchestrating all notification operations.

**Key Responsibilities:**
- Notification sending and broadcasting
- Deduplication management
- Recipient filtering
- Batch processing
- Scheduling coordination

**Internal State:**
```typescript
class NotificationService {
  private deduplicationCache = new Map<string, number>();
  private scheduleStorage = new Map<string, any>();

  constructor(
    private rotif: NotificationManager,
    private channelManager: ChannelManager,
    private preferenceManager: PreferenceManager,
    private rateLimiter: RateLimiter
  ) {}
}
```

**Internal Methods:**

```typescript
// Filter recipients based on preferences
private async filterByPreferences(
  recipients: Recipient[],
  notification: NotificationPayload,
  options: SendOptions
): Promise<Recipient[]> {
  const filtered: Recipient[] = [];
  for (const recipient of recipients) {
    const shouldSend = await this.preferenceManager.shouldSendNotification(
      recipient.id,
      notification,
      options.channels?.[0] || 'inApp'
    );
    if (shouldSend) {
      filtered.push(recipient);
    }
  }
  return filtered;
}

// Send notifications through Rotif
private async sendViaRotif(
  deliveryPlan: Map<string, { recipients: Recipient[] }>,
  notification: NotificationPayload,
  options: SendOptions
): Promise<DeliveryResults> {
  const results: DeliveryResults = {
    successful: [],
    failed: []
  };

  for (const [channel, group] of deliveryPlan) {
    for (const recipient of group.recipients) {
      const channelName = `notifications.${channel}.${recipient.id}`;

      try {
        await this.rotif.publish(channelName, {
          ...notification,
          recipientId: recipient.id,
          channel
        }, {
          delayMs: options.delay,
          deliverAt: options.scheduledTime,
          exactlyOnce: options.exactlyOnce ?? true
        });

        results.successful.push({
          recipientId: recipient.id,
          channel: channel as ChannelType,
          messageId: notification.id || generateUuid(),
          timestamp: Date.now()
        });
      } catch (error: any) {
        results.failed.push({
          recipientId: recipient.id,
          channel: channel as ChannelType,
          error: error.message,
          timestamp: Date.now()
        });
      }
    }
  }

  return results;
}

// Send notifications in batches
private async sendBatched(
  recipients: Recipient[],
  notification: NotificationPayload,
  options: BroadcastOptions
): Promise<BroadcastResult> {
  const batchSize = options.batchSize || 1000;
  const batches = Math.ceil(recipients.length / batchSize);
  const results: NotificationResult[] = [];

  for (let i = 0; i < batches; i++) {
    const batch = recipients.slice(i * batchSize, (i + 1) * batchSize);
    const result = await this.send(batch, notification, options);
    results.push(result);

    // Add delay between batches to avoid overwhelming the system
    if (i < batches - 1) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  return {
    recipients: recipients.length,
    batches,
    results
  };
}

// Resolve audience from broadcast target
private async resolveAudience(target: BroadcastTarget): Promise<Recipient[]> {
  if (target.userIds) {
    return target.userIds.map(id => ({ id }));
  }
  // In real implementation, would resolve from segment service
  return [];
}
```

**Deduplication Cache Management:**

```typescript
// Deduplication check logic
if (notification.metadata?.deduplicationKey) {
  const dedupKey = notification.metadata.deduplicationKey;
  const lastSent = this.deduplicationCache.get(dedupKey);
  const ttl = options.deduplicationTTL || 86400000; // 24 hours default

  if (lastSent && Date.now() - lastSent < ttl) {
    return {  // Return early, notification already sent
      id: notificationId,
      sent: 0,
      failed: 0,
      filtered: Array.isArray(recipients) ? recipients.length : 1
    };
  }
  this.deduplicationCache.set(dedupKey, Date.now());
}
```

### 2. ChannelManager

Manages notification channels and routing strategies.

**Features:**
- Channel registration and priority
- Delivery planning across channels
- Channel availability checks
- Recipient validation
- Content formatting per channel

**Internal State:**
```typescript
class ChannelManager {
  private channels = new Map<string, NotificationChannel>();
  private channelPriorities = new Map<string, number>();

  constructor() {
    // Register default channels
    this.registerDefaultChannels();
  }
}
```

**Internal Methods:**

```typescript
// Register default notification channels
private registerDefaultChannels(): void {
  // Register InApp channel as default
  const inAppChannel = new InAppChannel();
  this.registerChannel(inAppChannel, 0);  // Highest priority

  // Register Email channel if available
  const emailChannel = new EmailChannel();
  this.registerChannel(emailChannel, 1);
}

// Select appropriate channels for a recipient
private async selectChannels(
  recipient: Recipient,
  notification: NotificationPayload,
  options: SendOptions
): Promise<NotificationChannel[]> {
  const availableChannels: NotificationChannel[] = [];
  const requestedChannels = options.channels || [ChannelType.InApp];

  // Filter channels based on request and availability
  for (const channelType of requestedChannels) {
    const channel = Array.from(this.channels.values())
      .find(c => c.type === channelType);

    if (channel && await this.isChannelSuitable(channel, recipient, notification)) {
      availableChannels.push(channel);
    }
  }

  // Apply channel strategy
  return this.applyChannelStrategy(
    availableChannels,
    options.channelStrategy || 'first-available'
  );
}

// Check if channel is suitable for recipient
private async isChannelSuitable(
  channel: NotificationChannel,
  recipient: Recipient,
  notification: NotificationPayload
): Promise<boolean> {
  // Check if channel is available
  const available = await channel.isAvailable();
  if (!available) {
    return false;
  }

  // Validate recipient for this channel
  return channel.validateRecipient(recipient);
}

// Apply channel selection strategy
private applyChannelStrategy(
  channels: NotificationChannel[],
  strategy: 'first-available' | 'all' | 'fallback'
): NotificationChannel[] {
  if (channels.length === 0) {
    // Default to InApp if no channels available
    const inAppChannel = this.channels.get('inApp');
    return inAppChannel ? [inAppChannel] : [];
  }

  // Sort by priority (lower number = higher priority)
  const sorted = channels.sort((a, b) => {
    const priorityA = this.channelPriorities.get(a.name) || 999;
    const priorityB = this.channelPriorities.get(b.name) || 999;
    return priorityA - priorityB;
  });

  switch (strategy) {
    case 'first-available':
      return sorted[0] ? [sorted[0]] : [];
    case 'all':
      return sorted;
    case 'fallback':
      // In real implementation, would try channels in order until one succeeds
      return sorted[0] ? [sorted[0]] : [];
    default:
      return sorted[0] ? [sorted[0]] : [];
  }
}
```

**Built-in Channels:**
- **InAppChannel**: Always available, stores in-app notifications
- **EmailChannel**: Email delivery with HTML/text support, validates email format
- **SMSChannel**: SMS delivery with message truncation to 160 chars, validates phone format
- **PushChannel**: Mobile push notifications (extensible)
- **WebhookChannel**: HTTP webhook delivery (extensible)

### 3. TemplateEngine

Dynamic content generation with template management.

**Capabilities:**
- Template registration and storage
- Variable replacement ({{variable}} syntax)
- Multi-channel content support
- Localization support
- Render caching for performance
- Nested variable access (user.name)

**Internal State:**
```typescript
class TemplateEngine {
  private templates = new Map<string, NotificationTemplate>();
  private cacheKeyPrefix = 'notifications:template:cache:';

  constructor(
    private redis?: Redis,
    private options?: TemplateOptions
  ) {
    this.loadDefaultTemplates();
  }
}
```

**Internal Methods:**

```typescript
// Load default templates
private loadDefaultTemplates(): void {
  // Register default welcome template
  this.registerTemplate({
    id: 'welcome',
    name: 'Welcome Template',
    engine: 'plain',
    channels: ['email', 'inApp'],
    content: {
      email: {
        subject: 'Welcome to {{appName}}!',
        html: '<h1>Welcome {{userName}}!</h1><p>Thank you for joining {{appName}}.</p>',
        text: 'Welcome {{userName}}! Thank you for joining {{appName}}.'
      },
      inApp: {
        title: 'Welcome!',
        body: 'Thank you for joining {{appName}}, {{userName}}!'
      }
    },
    variables: [
      { name: 'userName', type: 'string', required: true },
      { name: 'appName', type: 'string', default: 'Our App' }
    ]
  });
}

// Get nested value from object
private getNestedValue(obj: any, path: string): any {
  const parts = path.split('.');
  let current = obj;

  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = current[part];
    } else {
      return undefined;
    }
  }

  return current;
}

// Generate cache key
private getCacheKey(templateId: string, data: any, locale?: string): string {
  const dataHash = hash(data);  // Uses SHA256 hash truncated to 16 chars
  return `${this.cacheKeyPrefix}${templateId}:${dataHash}:${locale || 'default'}`;
}

// Validate template structure
private validateTemplate(template: NotificationTemplate): void {
  if (!template.id) {
    throw new Error('Template ID is required');
  }
  if (!template.name) {
    throw new Error('Template name is required');
  }
  if (!template.channels || template.channels.length === 0) {
    throw new Error('At least one channel is required');
  }
  if (!template.content || Object.keys(template.content).length === 0) {
    throw new Error('Template content is required');
  }
}

// Render template content
private async renderTemplate(
  template: NotificationTemplate,
  data: any,
  options: RenderOptions
): Promise<RenderedContent> {
  const rendered: RenderedContent = {};

  // Simple variable replacement
  const replaceVariables = (text: string): string =>
    this.replaceVariables(text, data);

  // Render email content if present
  if (template.content.email) {
    rendered.subject = replaceVariables(template.content.email.subject);
    rendered.html = replaceVariables(template.content.email.html);
    rendered.text = replaceVariables(template.content.email.text || '');
  }

  // Cache the rendered content
  if (this.options?.cache !== false) {
    await this.cacheRender(template.id, data, options.locale, rendered, options.cacheTTL);
  }

  return rendered;
}
```

**Default Templates:**
- Welcome template with email and in-app variants
- Variables: userName (required), appName (default: 'Our App')

### 4. WorkflowEngine

Complex notification sequences and automation.

**Features:**
- Step-based workflow execution
- Conditional branching
- Parallel and batch processing
- Wait/delay steps
- Error handling and retry
- Workflow history tracking

**Internal State:**
```typescript
class WorkflowEngine {
  private workflows = new Map<string, NotificationWorkflow>();
  private runningWorkflows = new Map<string, WorkflowInstance>();
  private storageKeyPrefix = 'notifications:workflow:';

  constructor(
    private notificationService: NotificationService,
    private redis: Redis,
    private options?: WorkflowOptions
  ) {
    this.loadDefaultWorkflows();
  }
}
```

**Internal Methods:**

```typescript
// Create workflow instance
private createInstance(
  workflow: NotificationWorkflow,
  context: WorkflowContext
): WorkflowInstance {
  return {
    id: generateUuid(),
    workflowId: workflow.id,
    workflow,
    context,
    state: 'pending',
    startedAt: Date.now()
  };
}

// Run workflow steps
private async runWorkflow(instance: WorkflowInstance): Promise<WorkflowResult> {
  const results: StepResult[] = [];
  const errors: Error[] = [];

  instance.state = 'running';

  for (const step of instance.workflow.steps) {
    instance.currentStep = step.id;

    try {
      // Check conditions
      if (step.conditions && !this.evaluateConditions(step.conditions, instance.context)) {
        results.push({
          stepId: step.id,
          success: true,
          data: { skipped: true },
          timestamp: Date.now()
        });
        continue;
      }

      // Handle delay
      if (step.delay) {
        await sleep(step.delay);
      }

      // Execute step
      const stepResult = await this.executeStep(step, instance);
      results.push(stepResult);

      // Update context with step result
      instance.context[`step_${step.id}_result`] = stepResult.data;

      if (!stepResult.success) {
        if (step.onError === 'stop') {
          instance.state = 'failed';
          break;
        } else if (step.onError === 'retry') {
          const retryResult = await this.retryStep(step, instance);
          results.push(retryResult);
          if (!retryResult.success) {
            instance.state = 'failed';
            break;
          }
        }
        // 'continue' - just proceed to next step
      }
    } catch (error: any) {
      errors.push(error);
      results.push({
        stepId: step.id,
        success: false,
        error: error.message,
        timestamp: Date.now()
      });

      if (step.onError === 'stop' || !step.onError) {
        instance.state = 'failed';
        break;
      }
    }
  }

  instance.state = instance.state === 'failed' ? 'failed' : 'completed';
  instance.completedAt = Date.now();

  return {
    instanceId: instance.id,
    success: instance.state === 'completed',
    steps: results,
    errors: errors.length > 0 ? errors : undefined,
    startedAt: instance.startedAt,
    completedAt: instance.completedAt
  };
}

// Resolve recipients from config
private resolveRecipients(
  recipientConfig: any,
  context: WorkflowContext
): Recipient | Recipient[] {
  if (typeof recipientConfig === 'function') {
    return recipientConfig(context);
  }
  if (typeof recipientConfig === 'string') {
    return context[recipientConfig] || { id: recipientConfig };
  }
  return recipientConfig;
}

// Resolve notification from config
private resolveNotification(
  notificationConfig: any,
  context: WorkflowContext
): NotificationPayload {
  if (typeof notificationConfig === 'function') {
    return notificationConfig(context);
  }

  // Replace variables in notification
  const notification = { ...notificationConfig };
  if (notification.title) {
    notification.title = this.replaceVariables(notification.title, context);
  }
  if (notification.body) {
    notification.body = this.replaceVariables(notification.body, context);
  }

  return notification;
}

// Replace variables in text
private replaceVariables(text: string, context: WorkflowContext): string {
  return text.replace(/\{\{(\w+)\}\}/g, (match, key) => context[key] ?? match);
}

// Store workflow execution
private async storeExecution(
  instance: WorkflowInstance,
  result: WorkflowResult
): Promise<void> {
  const key = `${this.storageKeyPrefix}execution:${instance.id}`;
  const data = {
    instance,
    result,
    timestamp: Date.now()
  };

  await this.redis.setex(key, 7 * 86400, JSON.stringify(data)); // Store for 7 days
}

// Validate workflow structure
private validateWorkflow(workflow: NotificationWorkflow): void {
  if (!workflow.id) {
    throw new Error('Workflow ID is required');
  }
  if (!workflow.name) {
    throw new Error('Workflow name is required');
  }
  if (!workflow.trigger) {
    throw new Error('Workflow trigger is required');
  }
  if (!workflow.steps || workflow.steps.length === 0) {
    throw new Error('Workflow must have at least one step');
  }
}
```

**Step Types:**
- `notification`: Send notification
- `wait`: Delay execution
- `condition`: Conditional branching
- `parallel`: Execute steps in parallel
- `batch`: Process items in batches

### 5. PreferenceManager

User notification preferences and filtering.

**Preference Controls:**
- Global enable/disable
- Per-channel preferences
- Category-based filtering
- Frequency limits
- Quiet hours with timezone support
- Digest preferences

**Internal State:**
```typescript
class PreferenceManager {
  private readonly PREFERENCE_KEY_PREFIX = 'notifications:preferences:';
  private readonly FREQUENCY_KEY_PREFIX = 'notifications:frequency:';
  private defaultPreferences: UserPreferences;

  constructor(private redis: Redis) {
    this.defaultPreferences = this.getDefaultPreferences();
  }
}
```

**Internal Methods:**

```typescript
// Merge preference updates with current preferences
private mergePreferences(
  current: UserPreferences,
  updates: Partial<UserPreferences>
): UserPreferences {
  return {
    ...current,
    ...updates,
    channels: {
      ...current.channels,
      ...(updates.channels || {})
    },
    categories: {
      ...current.categories,
      ...(updates.categories || {})
    }
  };
}

// Get default preferences
private getDefaultPreferences(): UserPreferences {
  return {
    enabled: true,
    channels: {
      [ChannelType.Email]: { enabled: true },
      [ChannelType.Push]: { enabled: true },
      [ChannelType.SMS]: { enabled: false },  // SMS disabled by default
      [ChannelType.InApp]: { enabled: true },
      [ChannelType.Webhook]: { enabled: false }
    },
    categories: {},
    frequency: {
      maxPerDay: 50,
      maxPerHour: 10,
      maxPerMinute: 3
    },
    quietHours: {
      enabled: false,
      start: '22:00',
      end: '08:00',
      timezone: 'UTC',
      exceptions: []
    },
    locale: 'en'
  };
}

// Check if current time is within quiet hours
private isInQuietHours(quietHours: QuietHours): boolean {
  const now = new Date();
  const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

  // Parse start and end times
  const startParts = quietHours.start.split(':').map(Number);
  const endParts = quietHours.end.split(':').map(Number);
  const currentParts = currentTime.split(':').map(Number);

  const startHour = startParts[0] ?? 0;
  const startMinute = startParts[1] ?? 0;
  const endHour = endParts[0] ?? 0;
  const endMinute = endParts[1] ?? 0;
  const currentHour = currentParts[0] ?? 0;
  const currentMinute = currentParts[1] ?? 0;

  // Convert to minutes for easier comparison
  const startMinutes = startHour * 60 + startMinute;
  const endMinutes = endHour * 60 + endMinute;
  const currentMinutes = currentHour * 60 + currentMinute;

  // Handle overnight quiet hours
  if (startMinutes > endMinutes) {
    // Quiet hours span midnight
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  } else {
    // Normal quiet hours
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }
}

// Check if notification is an exception to quiet hours
private isException(
  notification: NotificationPayload,
  quietHours: QuietHours
): boolean {
  if (!quietHours.exceptions || !notification.metadata?.category) {
    return false;
  }
  return quietHours.exceptions.includes(notification.metadata.category);
}

// Check frequency limits
private async checkFrequencyLimit(
  userId: string,
  limit: FrequencyLimit
): Promise<boolean> {
  const now = Date.now();

  // Check per-minute limit
  if (limit.maxPerMinute) {
    const minuteKey = `${this.FREQUENCY_KEY_PREFIX}${userId}:minute`;
    const minuteCount = await this.getAndIncrementCounter(minuteKey, 60);
    if (minuteCount > limit.maxPerMinute) {
      return false;
    }
  }

  // Check per-hour limit
  if (limit.maxPerHour) {
    const hourKey = `${this.FREQUENCY_KEY_PREFIX}${userId}:hour`;
    const hourCount = await this.getAndIncrementCounter(hourKey, 3600);
    if (hourCount > limit.maxPerHour) {
      return false;
    }
  }

  // Check per-day limit
  if (limit.maxPerDay) {
    const dayKey = `${this.FREQUENCY_KEY_PREFIX}${userId}:day`;
    const dayCount = await this.getAndIncrementCounter(dayKey, 86400);
    if (dayCount > limit.maxPerDay) {
      return false;
    }
  }

  return true;
}

// Get and increment counter with TTL
private async getAndIncrementCounter(
  key: string,
  ttl: number
): Promise<number> {
  const multi = this.redis.multi();
  multi.incr(key);
  multi.expire(key, ttl);
  const result = await multi.exec();

  if (!result || !result[0] || result[0][0]) {
    return 1; // Default to 1 if there's an error
  }

  return result[0][1] as number;
}
```

### 6. RateLimiter

Intelligent throttling to prevent notification fatigue.

**Rate Limit Types:**
- Per-minute limits
- Per-hour limits
- Per-day limits
- Burst limits (consecutive requests)
- Custom limits per identifier

**Internal State:**
```typescript
class RateLimiter {
  private readonly RATE_LIMIT_KEY_PREFIX = 'notifications:ratelimit:';
  private defaultLimits: RateLimitConfig;

  constructor(
    private redis: Redis,
    defaultLimits?: RateLimitConfig
  ) {
    this.defaultLimits = defaultLimits || {
      perMinute: 10,
      perHour: 100,
      perDay: 1000,
      burstLimit: 5
    };
  }
}
```

**Internal Methods:**

```typescript
// Check burst limit using sliding window
private async checkBurstLimit(
  identifier: string,
  action: string,
  limit: number
): Promise<boolean> {
  const key = `${this.RATE_LIMIT_KEY_PREFIX}burst:${identifier}:${action}`;
  const now = Date.now();
  const windowStart = now - 1000; // 1 second window for burst

  // Remove old entries and count recent ones
  const multi = this.redis.multi();
  multi.zremrangebyscore(key, '-inf', windowStart.toString());
  multi.zadd(key, now.toString(), now.toString());
  multi.zcard(key);
  multi.expire(key, 2);  // Expire after 2 seconds

  const results = await multi.exec();
  if (!results || !results[2] || results[2][0]) {
    return true; // Allow on error
  }

  const count = results[2][1] as number;
  return count <= limit;
}

// Check window-based rate limit
private async checkWindowLimit(
  identifier: string,
  action: string,
  window: 'minute' | 'hour' | 'day',
  ttl: number,
  limit: number
): Promise<boolean> {
  const key = `${this.RATE_LIMIT_KEY_PREFIX}${window}:${identifier}:${action}`;

  // Use Redis INCR with TTL
  const multi = this.redis.multi();
  multi.incr(key);
  multi.expire(key, ttl);

  const results = await multi.exec();
  if (!results || !results[0] || results[0][0]) {
    return true; // Allow on error
  }

  const count = results[0][1] as number;
  return count <= limit;
}

// Get status for a specific window
private async getWindowStatus(
  identifier: string,
  action: string,
  window: 'minute' | 'hour' | 'day',
  ttl: number,
  limit: number
): Promise<RateLimitResult> {
  const key = `${this.RATE_LIMIT_KEY_PREFIX}${window}:${identifier}:${action}`;

  const multi = this.redis.multi();
  multi.get(key);
  multi.ttl(key);

  const results = await multi.exec();
  if (!results || !results[0] || results[0][0]) {
    return {
      allowed: true,
      remaining: limit,
      resetAt: Date.now() + (ttl * 1000)
    };
  }

  const count = parseInt(results[0][1] as string || '0', 10);
  const ttlRemaining = results[1]?.[1] as number || ttl;

  return {
    allowed: count < limit,
    remaining: Math.max(0, limit - count),
    resetAt: Date.now() + (ttlRemaining * 1000)
  };
}
```

**Sliding Window Algorithm:**
The burst limit uses a sliding window approach with Redis sorted sets:
1. Store timestamps as both score and value
2. Remove entries older than window
3. Count remaining entries
4. Check against limit

### 7. NotificationAnalytics

Comprehensive tracking and reporting.

**Analytics Features:**
- Event tracking (sent, delivered, opened, clicked, failed)
- Real-time statistics
- Time series data
- Channel performance metrics
- Report generation with recommendations
- Period comparisons
- Issue identification

**Internal State:**
```typescript
class NotificationAnalytics {
  private readonly ANALYTICS_KEY_PREFIX = 'notifications:analytics:';
  private readonly EVENT_TTL = 90 * 86400; // 90 days default

  constructor(
    private redis: Redis,
    private options?: AnalyticsOptions
  ) {}
}
```

**Internal Methods:**

```typescript
// Update analytics counters
private async updateCounters(event: NotificationEvent): Promise<void> {
  const dayKey = this.getDayKey(event.timestamp);
  const multi = this.redis.multi();

  // Global counters
  multi.hincrby(`${this.ANALYTICS_KEY_PREFIX}counters:${dayKey}`, event.type, 1);
  multi.hincrby(`${this.ANALYTICS_KEY_PREFIX}counters:${dayKey}`, 'total', 1);

  // Channel-specific counters
  if (event.channel) {
    multi.hincrby(
      `${this.ANALYTICS_KEY_PREFIX}channel:${event.channel}:${dayKey}`,
      event.type,
      1
    );
  }

  // Category-specific counters
  if (event.category) {
    multi.hincrby(
      `${this.ANALYTICS_KEY_PREFIX}category:${event.category}:${dayKey}`,
      event.type,
      1
    );
  }

  // User-specific counters
  multi.hincrby(
    `${this.ANALYTICS_KEY_PREFIX}user:${event.recipientId}:${dayKey}`,
    event.type,
    1
  );

  await multi.exec();
}

// Get day key for bucketing (YYYY-MM-DD format)
private getDayKey(timestamp: number | Date): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// Group events by channel
private groupByChannel(events: NotificationEvent[]): Map<string, ChannelStatistics> {
  const channelStats = new Map<string, ChannelStatistics>();

  for (const event of events) {
    if (!event.channel) continue;

    if (!channelStats.has(event.channel)) {
      channelStats.set(event.channel, {
        channel: event.channel,
        sent: 0,
        delivered: 0,
        opened: 0,
        clicked: 0,
        failed: 0
      });
    }

    const stats = channelStats.get(event.channel)!;
    switch (event.type) {
      case 'sent':
        stats.sent++;
        break;
      case 'delivered':
        stats.delivered++;
        break;
      case 'opened':
        stats.opened++;
        break;
      case 'clicked':
        stats.clicked++;
        break;
      case 'failed':
        stats.failed++;
        break;
    }
  }

  return channelStats;
}

// Calculate average delivery time
private calculateAvgDeliveryTime(events: NotificationEvent[]): number {
  const sentEvents = new Map<string, number>();
  const deliveryTimes: number[] = [];

  for (const event of events) {
    if (event.type === 'sent') {
      sentEvents.set(event.notificationId, event.timestamp);
    } else if (event.type === 'delivered' && sentEvents.has(event.notificationId)) {
      const sentTime = sentEvents.get(event.notificationId)!;
      deliveryTimes.push(event.timestamp - sentTime);
    }
  }

  if (deliveryTimes.length === 0) return 0;

  const total = deliveryTimes.reduce((sum, time) => sum + time, 0);
  return total / deliveryTimes.length;
}

// Calculate average response time (time to open)
private calculateAvgResponseTime(events: NotificationEvent[]): number {
  const deliveredEvents = new Map<string, number>();
  const responseTimes: number[] = [];

  for (const event of events) {
    if (event.type === 'delivered') {
      deliveredEvents.set(event.notificationId, event.timestamp);
    } else if (event.type === 'opened' && deliveredEvents.has(event.notificationId)) {
      const deliveredTime = deliveredEvents.get(event.notificationId)!;
      responseTimes.push(event.timestamp - deliveredTime);
    }
  }

  if (responseTimes.length === 0) return 0;

  const total = responseTimes.reduce((sum, time) => sum + time, 0);
  return total / responseTimes.length;
}

// Generate time series data
private generateTimeSeries(
  events: NotificationEvent[],
  query: AnalyticsQuery
): TimeSeriesData[] {
  const timeSeries: TimeSeriesData[] = [];
  const buckets = new Map<string, Map<string, number>>();

  for (const event of events) {
    const hour = Math.floor(event.timestamp / 3600000) * 3600000;
    const key = `${hour}-${event.type}`;

    if (!buckets.has(key)) {
      buckets.set(key, new Map());
    }

    const bucket = buckets.get(key)!;
    bucket.set(event.type, (bucket.get(event.type) || 0) + 1);
  }

  // Convert to time series format
  for (const [key, counts] of buckets) {
    const [timestamp, type] = key.split('-');
    if (timestamp) {
      for (const [eventType, count] of counts) {
        timeSeries.push({
          timestamp: parseInt(timestamp),
          count,
          type: eventType
        });
      }
    }
  }

  return timeSeries.sort((a, b) => a.timestamp - b.timestamp);
}

// Identify issues in notification performance
private identifyIssues(statistics: NotificationStatistics): Issue[] {
  const issues: Issue[] = [];

  // Check for high bounce rate
  if (statistics.bounceRate > 10) {
    issues.push({
      type: 'high_bounce',
      count: statistics.bounced,
      description: `High bounce rate detected: ${statistics.bounceRate.toFixed(2)}%`
    });
  }

  // Check for low engagement
  if (statistics.openRate < 20 && statistics.sent > 100) {
    issues.push({
      type: 'low_engagement',
      count: statistics.opened,
      description: `Low open rate detected: ${statistics.openRate.toFixed(2)}%`
    });
  }

  // Check for delivery failures
  if (statistics.failed > statistics.sent * 0.05) {
    issues.push({
      type: 'delivery_failure',
      count: statistics.failed,
      description: `High failure rate: ${((statistics.failed / statistics.sent) * 100).toFixed(2)}%`
    });
  }

  return issues;
}

// Generate recommendations based on statistics
private generateRecommendations(statistics: NotificationStatistics): string[] {
  const recommendations: string[] = [];

  if (statistics.openRate < 20) {
    recommendations.push('Consider improving notification titles and preview text');
  }

  if (statistics.clickRate < 5) {
    recommendations.push('Optimize notification content and call-to-action');
  }

  if (statistics.bounceRate > 10) {
    recommendations.push('Review recipient list quality and email validation');
  }

  if (statistics.avgDeliveryTime > 60000) {
    recommendations.push('Investigate delivery delays and optimize sending infrastructure');
  }

  return recommendations;
}

// Compare with previous period
private async compareWithPreviousPeriod(
  period: ReportPeriod,
  currentStats: NotificationStatistics
): Promise<PeriodComparison> {
  // Calculate previous period dates
  const duration = period.end.getTime() - period.start.getTime();
  const previousStart = new Date(period.start.getTime() - duration);
  const previousEnd = new Date(period.end.getTime() - duration);

  const previousQuery: AnalyticsQuery = {
    startDate: previousStart,
    endDate: previousEnd
  };

  const previousStats = await this.getStatistics(previousQuery);

  return {
    current: currentStats,
    previous: previousStats,
    changes: {
      sent: ((currentStats.sent - previousStats.sent) / previousStats.sent) * 100,
      delivered: ((currentStats.delivered - previousStats.delivered) / previousStats.delivered) * 100,
      openRate: currentStats.openRate - previousStats.openRate,
      clickRate: currentStats.clickRate - previousStats.clickRate
    }
  };
}
```

## Installation & Setup

### Basic Installation

```bash
# Install Titan with notifications module
npm install @omnitron-dev/titan
npm install ioredis  # Redis client dependency
```

### Basic Setup

```typescript
import { Application } from '@omnitron-dev/titan';
import { TitanNotificationsModule } from '@omnitron-dev/titan/module/notifications';

const app = await Application.create({
  imports: [
    TitanNotificationsModule.forRoot({
      redis: {
        host: 'localhost',
        port: 6379
      },
      channels: {
        email: { enabled: true },
        sms: { enabled: true },
        inApp: { enabled: true }
      }
    })
  ]
});

await app.start();
```

### Advanced Setup

```typescript
import { Application } from '@omnitron-dev/titan';
import { TitanNotificationsModule } from '@omnitron-dev/titan/module/notifications';

const app = await Application.create({
  imports: [
    TitanNotificationsModule.forRoot({
      redis: {
        host: 'redis.example.com',
        port: 6379,
        password: 'secret'
      },
      rotif: {
        defaultRetries: 3,
        retryDelay: (attempt) => attempt * 1000,
        deduplicationTTL: 86400000,
        maxStreamLength: 10000
      },
      channels: {
        email: {
          enabled: true,
          provider: 'sendgrid',
          config: {
            apiKey: process.env.SENDGRID_API_KEY
          }
        },
        sms: {
          enabled: true,
          provider: 'twilio',
          config: {
            accountSid: process.env.TWILIO_ACCOUNT_SID,
            authToken: process.env.TWILIO_AUTH_TOKEN
          }
        },
        push: {
          enabled: true,
          provider: 'fcm',
          config: {
            serviceAccount: process.env.FCM_SERVICE_ACCOUNT
          }
        }
      },
      rateLimit: {
        enabled: true,
        default: {
          perMinute: 10,
          perHour: 100,
          perDay: 1000,
          burstLimit: 5
        }
      },
      templates: {
        enabled: true,
        cache: true,
        cacheTTL: 3600
      },
      workflows: {
        enabled: true,
        maxConcurrent: 10
      },
      analytics: {
        enabled: true,
        retention: 90,
        realtime: true
      }
    })
  ]
});
```

### Async Configuration

```typescript
TitanNotificationsModule.forRootAsync({
  useFactory: async (configService: ConfigService) => ({
    redis: await configService.getRedisConfig(),
    channels: await configService.getChannelConfig(),
    // ... other options
  }),
  inject: [ConfigService]
})
```

## Utility Functions

### Core Utilities

```typescript
/**
 * Generate a unique identifier using Node.js randomUUID
 */
export function generateUuid(): string {
  return randomUUID();
}

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate phone number format
 */
export function isValidPhone(phone: string): boolean {
  // Remove spaces and dashes
  const cleaned = phone.replace(/[\s-]/g, '');
  // Check if it starts with + or a digit and has 7-15 digits
  const phoneRegex = /^\+?[1-9]\d{7,14}$/;
  return phoneRegex.test(cleaned);
}

/**
 * Validate URL format
 */
export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Hash a value for caching using SHA256
 */
export function hash(data: any): string {
  return createHash('sha256')
    .update(JSON.stringify(data))
    .digest('hex')
    .substring(0, 16);  // Truncate to 16 characters
}

/**
 * Parse time in HH:mm format to minutes
 */
export function parseTimeToMinutes(time: string): number {
  const parts = time.split(':').map(Number);
  const hours = parts[0] ?? 0;
  const minutes = parts[1] ?? 0;
  return hours * 60 + minutes;
}

/**
 * Format timestamp to ISO string
 */
export function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Chunk an array into smaller arrays
 */
export function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Retry a function with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  initialDelay: number = 100
): Promise<T> {
  let lastError: Error;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      if (attempt < maxAttempts) {
        const delay = initialDelay * Math.pow(2, attempt - 1);
        await sleep(delay);
      }
    }
  }

  throw lastError!;
}

/**
 * Create a deferred promise
 */
export function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
} {
  let resolve: (value: T) => void;
  let reject: (error: Error) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve: resolve!, reject: reject! };
}
```

## Module Constants

### Service Tokens
```typescript
// All DI tokens for service injection
export const NOTIFICATION_SERVICE = createToken<NotificationService>('NOTIFICATION_SERVICE');
export const CHANNEL_MANAGER = createToken<ChannelManager>('CHANNEL_MANAGER');
export const PREFERENCE_MANAGER = createToken<PreferenceManager>('PREFERENCE_MANAGER');
export const RATE_LIMITER = createToken<RateLimiter>('RATE_LIMITER');
export const TEMPLATE_ENGINE = createToken<TemplateEngine>('TEMPLATE_ENGINE');
export const WORKFLOW_ENGINE = createToken<WorkflowEngine>('WORKFLOW_ENGINE');
export const ANALYTICS_SERVICE = createToken<NotificationAnalytics>('ANALYTICS_SERVICE');
export const ROTIF_MANAGER = createToken<NotificationManager>('ROTIF_MANAGER');
export const NOTIFICATION_MODULE_OPTIONS = createToken<NotificationModuleOptions>('NOTIFICATION_MODULE_OPTIONS');
```

### Configuration Constants
```typescript
// Channel type constants
export const DEFAULT_CHANNELS = ['inApp'] as const;
export const ALL_CHANNELS = ['email', 'sms', 'push', 'webhook', 'inApp'] as const;

// Priority levels
export const PRIORITY_LEVELS = {
  LOW: 'low',
  NORMAL: 'normal',
  HIGH: 'high',
  URGENT: 'urgent'
} as const;

// Notification types
export const NOTIFICATION_TYPES = {
  INFO: 'info',
  SUCCESS: 'success',
  WARNING: 'warning',
  ERROR: 'error',
  CRITICAL: 'critical'
} as const;

// Default configuration values
export const DEFAULT_RATE_LIMITS = {
  perMinute: 10,
  perHour: 100,
  perDay: 1000
};

export const DEFAULT_DEDUPLICATION_TTL = 86400; // 24 hours in seconds
export const DEFAULT_BATCH_SIZE = 1000;
export const DEFAULT_RETRY_ATTEMPTS = 3;
export const DEFAULT_TIMEOUT = 30000; // 30 seconds

// Redis key prefixes
export const REDIS_KEY_PREFIXES = {
  PREFERENCES: 'notifications:preferences:',
  RATE_LIMIT: 'notifications:ratelimit:',
  SCHEDULE: 'notifications:schedule:',
  ANALYTICS: 'notifications:analytics:',
  TEMPLATE: 'notifications:template:',
  WORKFLOW: 'notifications:workflow:'
} as const;
```

## Configuration Options

### Complete Configuration Interface

```typescript
interface NotificationModuleOptions {
  // Redis configuration
  redis?: {
    host?: string;
    port?: number;
    db?: number;
    password?: string;
  };

  // Rotif configuration
  rotif?: {
    defaultRetries?: number;
    retryDelay?: number | ((attempt: number) => number);
    deduplicationTTL?: number;
    maxStreamLength?: number;
    disableDelayed?: boolean;
  };

  // Channel configurations
  channels?: {
    email?: {
      enabled?: boolean;
      provider?: string;
      config?: any;
    };
    sms?: {
      enabled?: boolean;
      provider?: string;
      config?: any;
    };
    push?: {
      enabled?: boolean;
      provider?: string;
      config?: any;
    };
    webhook?: {
      enabled?: boolean;
      timeout?: number;
      retries?: number;
    };
    inApp?: {
      enabled?: boolean;
      storage?: 'redis' | 'database';
      ttl?: number;
    };
  };

  // Rate limiting
  rateLimit?: {
    enabled?: boolean;
    default?: RateLimitConfig;
    byChannel?: {
      [channel: string]: RateLimitConfig;
    };
  };

  // Template engine
  templates?: {
    enabled?: boolean;
    path?: string;
    cache?: boolean;
    cacheTTL?: number;
  };

  // Workflow engine
  workflows?: {
    enabled?: boolean;
    storage?: 'redis' | 'database';
    maxConcurrent?: number;
  };

  // Analytics
  analytics?: {
    enabled?: boolean;
    storage?: 'redis' | 'timescale';
    retention?: number; // days
  };

  // Default values
  defaults?: {
    priority?: 'low' | 'normal' | 'high' | 'urgent';
    ttl?: number;
    channels?: string[];
  };

  // Global module registration
  isGlobal?: boolean;
}
```

### Configuration Examples

#### Minimal Configuration
```typescript
TitanNotificationsModule.forRoot({
  redis: { host: 'localhost', port: 6379 }
})
```

#### Production Configuration
```typescript
TitanNotificationsModule.forRoot({
  redis: {
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT),
    password: process.env.REDIS_PASSWORD
  },
  rotif: {
    defaultRetries: 5,
    deduplicationTTL: 86400000 // 24 hours
  },
  rateLimit: {
    enabled: true,
    default: {
      perDay: 100,
      burstLimit: 3
    }
  },
  analytics: {
    enabled: true,
    retention: 180 // 6 months
  }
})
```

## Notification Service

### Sending Notifications

```typescript
@Injectable()
class MyService {
  constructor(
    @Inject(NOTIFICATION_SERVICE) private notifications: NotificationService
  ) {}

  async sendWelcomeEmail(user: User) {
    const result = await this.notifications.send(
      {
        id: user.id,
        email: user.email,
        locale: user.locale
      },
      {
        type: 'info',
        title: 'Welcome to Our App!',
        body: `Hello ${user.name}, welcome aboard!`,
        metadata: {
          category: 'onboarding',
          priority: 'high'
        }
      },
      {
        channels: ['email', 'inApp'],
        templateId: 'welcome'
      }
    );

    console.log(`Sent: ${result.sent}, Failed: ${result.failed}`);
  }
}
```

### Broadcasting

```typescript
// Broadcast to user segment
const broadcastResult = await notifications.broadcast(
  {
    id: 'premium-users',
    segment: 'premium'
  },
  {
    type: 'info',
    title: 'Exclusive Offer',
    body: 'Special discount for premium members!'
  },
  {
    channels: ['email', 'push'],
    batchSize: 500 // Process in batches of 500
  }
);

console.log(`Sent to ${broadcastResult.recipients} users in ${broadcastResult.batches} batches`);
```

### Scheduling

```typescript
// Schedule for future delivery
const scheduleResult = await notifications.schedule(
  recipients,
  notification,
  new Date('2024-12-25 09:00:00'),
  {
    channels: ['email'],
    recurrence: {
      pattern: 'yearly',
      endDate: new Date('2034-12-25')
    }
  }
);

// Cancel scheduled notification
await notifications.cancelScheduled(scheduleResult.scheduleId);
```

### Notification Payload Structure

```typescript
interface NotificationPayload {
  id?: string;                                    // Unique identifier
  type: 'info' | 'success' | 'warning' | 'error' | 'critical';
  title: string;                                   // Notification title
  body: string;                                    // Main content
  data?: Record<string, any>;                     // Additional data
  metadata?: {
    priority?: 'low' | 'normal' | 'high' | 'urgent';
    ttl?: number;                                  // Time to live
    deduplicationKey?: string;                     // Prevent duplicates
    category?: string;                             // Notification category
    tags?: string[];                               // Tags for filtering
    tracking?: {
      impressions?: boolean;
      clicks?: boolean;
      conversions?: boolean;
    };
  };
}
```

## Channel Management

### Built-in Channel Implementations

#### InAppChannel
```typescript
export class InAppChannel implements NotificationChannel {
  name = 'inApp';
  type = ChannelType.InApp;

  async isAvailable(): Promise<boolean> {
    return true; // Always available
  }

  async send(recipient: Recipient, content: ChannelContent): Promise<void> {
    // In real implementation, would store in database
    // For now, just log
    console.log(`InApp notification sent to ${recipient.id}:`, content);
  }

  validateRecipient(recipient: Recipient): boolean {
    return !!recipient.id;  // Only requires recipient ID
  }

  formatContent(notification: NotificationPayload): ChannelContent {
    return {
      subject: notification.title,
      text: notification.body,
      data: notification.data
    };
  }
}
```

#### EmailChannel
```typescript
const inAppChannel = new InAppChannel();
// Always available
// Stores notifications for in-app display
// No external dependencies
```

#### EmailChannel
```typescript
export class EmailChannel implements NotificationChannel {
  name = 'email';
  type = ChannelType.Email;

  async isAvailable(): Promise<boolean> {
    // In real implementation, would check email service health
    return true;
  }

  async send(recipient: Recipient, content: ChannelContent): Promise<void> {
    if (!recipient.email) {
      throw new Error('Recipient email not provided');
    }

    // In real implementation, would send via email service
    console.log(`Email sent to ${recipient.email}:`, content);
  }

  validateRecipient(recipient: Recipient): boolean {
    return !!recipient.email && this.isValidEmail(recipient.email);
  }

  formatContent(notification: NotificationPayload): ChannelContent {
    return {
      subject: notification.title,
      html: `<h1>${notification.title}</h1><p>${notification.body}</p>`,
      text: `${notification.title}\n\n${notification.body}`
    };
  }

  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }
}
```

#### SMSChannel
```typescript
export class SMSChannel implements NotificationChannel {
  name = 'sms';
  type = ChannelType.SMS;

  async isAvailable(): Promise<boolean> {
    // In real implementation, would check SMS service availability
    return true;
  }

  async send(recipient: Recipient, content: ChannelContent): Promise<void> {
    if (!recipient.phone) {
      throw new Error('Recipient phone not provided');
    }

    // In real implementation, would send via SMS service
    console.log(`SMS sent to ${recipient.phone}:`, content.message);
  }

  validateRecipient(recipient: Recipient): boolean {
    return !!recipient.phone && this.isValidPhone(recipient.phone);
  }

  formatContent(notification: NotificationPayload): ChannelContent {
    // Truncate message to 160 characters for SMS
    const message = `${notification.title}: ${notification.body}`.slice(0, 160);
    return { message };
  }

  private isValidPhone(phone: string): boolean {
    // Simple phone validation
    const phoneRegex = /^\+?[1-9]\d{7,14}$/;
    return phoneRegex.test(phone.replace(/\s+/g, ''));
  }
}
```

### Custom Channel Implementation

```typescript
import { NotificationChannel, ChannelType, Recipient, ChannelContent } from '@omnitron-dev/titan/module/notifications';

export class SlackChannel implements NotificationChannel {
  name = 'slack';
  type = ChannelType.Webhook;

  async isAvailable(): Promise<boolean> {
    // Check if Slack webhook is configured
    return !!process.env.SLACK_WEBHOOK_URL;
  }

  async send(recipient: Recipient, content: ChannelContent): Promise<void> {
    const webhookUrl = recipient.webhookUrl || process.env.SLACK_WEBHOOK_URL;

    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: content.text,
        attachments: content.data?.attachments
      })
    });
  }

  validateRecipient(recipient: Recipient): boolean {
    return !!recipient.webhookUrl || !!process.env.SLACK_WEBHOOK_URL;
  }

  formatContent(notification: NotificationPayload): ChannelContent {
    return {
      text: `*${notification.title}*\n${notification.body}`,
      data: {
        attachments: [{
          color: this.getColorForType(notification.type),
          text: notification.body
        }]
      }
    };
  }

  private getColorForType(type: string): string {
    const colors = {
      info: '#36a64f',
      success: '#2eb886',
      warning: '#ffc107',
      error: '#dc3545',
      critical: '#721c24'
    };
    return colors[type] || '#808080';
  }
}
```

### Channel Registration

```typescript
@Injectable()
class NotificationSetup {
  constructor(
    @Inject(CHANNEL_MANAGER) private channelManager: ChannelManager
  ) {}

  onModuleInit() {
    // Register custom channel with priority
    const slackChannel = new SlackChannel();
    this.channelManager.registerChannel(slackChannel, 2);
  }
}
```

### Channel Strategy

```typescript
// First available channel
await notifications.send(recipient, notification, {
  channels: ['push', 'email', 'sms'],
  channelStrategy: 'first-available'  // Use first working channel
});

// All channels
await notifications.send(recipient, notification, {
  channels: ['email', 'push', 'inApp'],
  channelStrategy: 'all'  // Send through all channels
});

// Fallback strategy
await notifications.send(recipient, notification, {
  channels: ['push', 'email', 'sms'],
  channelStrategy: 'fallback'  // Try in order until one succeeds
});
```

## Template Engine

### Template Registration

```typescript
@Injectable()
class TemplateSetup {
  constructor(
    @Inject(TEMPLATE_ENGINE) private templates: TemplateEngine
  ) {}

  async onModuleInit() {
    // Register order confirmation template
    await this.templates.registerTemplate({
      id: 'order-confirmation',
      name: 'Order Confirmation',
      engine: 'handlebars',
      channels: ['email', 'sms'],
      content: {
        email: {
          subject: 'Order #{{orderId}} Confirmed',
          html: `
            <h1>Thank you for your order!</h1>
            <p>Hi {{customer.name}},</p>
            <p>Your order #{{orderId}} has been confirmed.</p>
            <ul>
              {{#each items}}
              <li>{{name}} - ${{price}}</li>
              {{/each}}
            </ul>
            <p>Total: ${{total}}</p>
          `,
          text: 'Order confirmed. Total: ${{total}}'
        },
        sms: {
          message: 'Order #{{orderId}} confirmed. Total: ${{total}}'
        }
      },
      variables: [
        { name: 'orderId', type: 'string', required: true },
        { name: 'customer', type: 'object', required: true },
        { name: 'items', type: 'array', required: true },
        { name: 'total', type: 'number', required: true }
      ],
      category: 'transactional'
    });
  }
}
```

### Template Rendering

```typescript
// Render template with data
const rendered = await templates.render('order-confirmation', {
  orderId: '12345',
  customer: { name: 'John Doe', email: 'john@example.com' },
  items: [
    { name: 'Widget', price: 19.99 },
    { name: 'Gadget', price: 29.99 }
  ],
  total: 49.98
});

// Render for specific channel
const emailContent = await templates.renderForChannel(
  'order-confirmation',
  'email',
  orderData
);
```

### Template Features

```typescript
// Extract variables from content
const variables = templates.extractVariables(templateContent);
// Returns: ['orderId', 'customer.name', 'total']

// Variable replacement with nested access
const text = 'Hello {{user.profile.name}}, your balance is {{account.balance}}';
const result = templates.replaceVariables(text, {
  user: { profile: { name: 'John' } },
  account: { balance: 100 }
});
// Returns: 'Hello John, your balance is 100'

// Template caching
const rendered = await templates.render('welcome', data, {
  skipCache: false,  // Use cache if available
  cacheTTL: 7200    // Cache for 2 hours
});
```

### Template Management

```typescript
// List all templates
const allTemplates = await templates.getAllTemplates();

// Get specific template
const template = templates.getTemplate('welcome');

// Delete template
await templates.deleteTemplate('old-template');

// Process notification with template
const processed = await templates.processNotification({
  templateId: 'welcome',
  recipientId: 'user-123',
  data: { userName: 'Alice' }
});
```

## Workflow Engine

### Defining Workflows

```typescript
@Injectable()
class WorkflowSetup {
  constructor(
    @Inject(WORKFLOW_ENGINE) private workflows: WorkflowEngine
  ) {}

  async onModuleInit() {
    // Define onboarding workflow
    this.workflows.defineWorkflow({
      id: 'user-onboarding',
      name: 'User Onboarding Sequence',
      trigger: { type: 'manual' },
      steps: [
        {
          id: 'welcome',
          name: 'Send welcome email',
          type: 'notification',
          config: {
            notification: {
              type: 'info',
              title: 'Welcome!',
              body: 'Welcome to {{appName}}!'
            },
            channels: ['email', 'inApp']
          }
        },
        {
          id: 'wait-1-hour',
          name: 'Wait 1 hour',
          type: 'wait',
          config: { duration: 3600000 }
        },
        {
          id: 'check-profile',
          name: 'Check if profile completed',
          type: 'condition',
          config: {
            field: 'profileCompleted',
            operator: 'equals',
            value: false,
            onTrue: [],  // Skip if profile completed
            onFalse: [   // Send reminder if not
              {
                id: 'profile-reminder',
                type: 'notification',
                config: {
                  notification: {
                    type: 'info',
                    title: 'Complete Your Profile',
                    body: 'Add more details to get the most out of our app!'
                  },
                  channels: ['email', 'push']
                }
              }
            ]
          }
        },
        {
          id: 'wait-1-day',
          name: 'Wait 1 day',
          type: 'wait',
          config: { duration: 86400000 }
        },
        {
          id: 'tips',
          name: 'Send tips and tricks',
          type: 'notification',
          config: {
            notification: {
              type: 'info',
              title: 'Pro Tips',
              body: 'Here are some tips to help you succeed...'
            },
            channels: ['email']
          }
        }
      ],
      onError: 'continue'  // Continue on step failure
    });
  }
}
```

### Executing Workflows

```typescript
// Execute workflow with context
const result = await workflows.execute('user-onboarding', {
  userId: 'user-123',
  userName: 'John Doe',
  appName: 'SuperApp',
  profileCompleted: false,
  email: 'john@example.com'
});

console.log(`Workflow ${result.success ? 'completed' : 'failed'}`);
console.log(`Steps executed: ${result.steps.length}`);

// Get execution history
const history = await workflows.getExecutionHistory('user-onboarding', 10);

// Get execution details
const details = await workflows.getExecutionDetails(result.instanceId);
```

### Workflow Step Types

#### Notification Step
```typescript
{
  id: 'send-email',
  type: 'notification',
  config: {
    recipients: { id: 'user-123', email: 'user@example.com' },
    notification: {
      type: 'info',
      title: 'Hello',
      body: 'Message body'
    },
    channels: ['email']
  }
}
```

#### Wait Step
```typescript
{
  id: 'delay',
  type: 'wait',
  config: {
    duration: 3600000,  // Wait 1 hour
    // OR
    until: '2024-12-25T09:00:00Z'  // Wait until specific time
  }
}
```

#### Condition Step
```typescript
{
  id: 'check-status',
  type: 'condition',
  config: {
    field: 'user.status',
    operator: 'equals',
    value: 'active',
    onTrue: [/* steps if true */],
    onFalse: [/* steps if false */],
    setContext: { statusChecked: true }  // Update context
  }
}
```

#### Parallel Step
```typescript
{
  id: 'parallel-notifications',
  type: 'parallel',
  config: {
    steps: [
      { /* email notification step */ },
      { /* sms notification step */ },
      { /* push notification step */ }
    ]
  }
}
```

#### Batch Step
```typescript
{
  id: 'batch-process',
  type: 'batch',
  config: {
    items: ['user1', 'user2', 'user3'],
    batchSize: 2,
    batchDelay: 1000,  // Delay between batches
    process: { /* step to execute for each item */ }
  }
}
```

### Workflow Management

```typescript
// Get all workflows
const allWorkflows = workflows.getAllWorkflows();

// Get specific workflow
const workflow = workflows.getWorkflow('user-onboarding');

// Get running workflows
const running = workflows.getRunningWorkflows();

// Cancel running workflow
await workflows.cancelWorkflow(instanceId);

// Get execution history
const history = await workflows.getExecutionHistory('workflow-id', 100);
```

## User Preferences

### Setting Preferences

```typescript
@Injectable()
class PreferenceService {
  constructor(
    @Inject(PREFERENCE_MANAGER) private preferences: PreferenceManager
  ) {}

  async updateUserPreferences(userId: string) {
    await this.preferences.updatePreferences(userId, {
      enabled: true,
      channels: {
        email: { enabled: true },
        sms: { enabled: false },
        push: { enabled: true },
        inApp: { enabled: true }
      },
      categories: {
        'marketing': false,  // Disable marketing
        'transactional': true,  // Enable transactional
        'security': {  // Advanced category settings
          enabled: true,
          channels: ['email', 'sms'],  // Only these channels
          frequency: {
            maxPerDay: 10
          }
        }
      },
      frequency: {
        maxPerDay: 50,
        maxPerHour: 10,
        maxPerMinute: 3
      },
      quietHours: {
        enabled: true,
        start: '22:00',
        end: '08:00',
        timezone: 'America/New_York',
        exceptions: ['security', 'critical']  // Always send these
      },
      locale: 'en-US'
    });
  }
}
```

### Preference Filtering

```typescript
// Automatic preference filtering
const result = await notifications.send(
  recipient,
  {
    type: 'info',
    title: 'Marketing Update',
    body: 'Check out our latest deals!',
    metadata: {
      category: 'marketing'  // Will be filtered if user disabled
    }
  }
);

// Manual preference check
const shouldSend = await preferences.shouldSendNotification(
  userId,
  notification,
  'email'
);

if (shouldSend) {
  // Send notification
}
```

### Quiet Hours

```typescript
interface QuietHours {
  enabled: boolean;
  start: string;    // "22:00" format
  end: string;      // "08:00" format
  timezone: string; // "America/New_York"
  exceptions?: string[];  // Categories to always send
}

// Quiet hours are automatically respected
// Urgent notifications bypass quiet hours
// Exception categories always send
```

### Digest Settings

```typescript
await preferences.updatePreferences(userId, {
  digest: {
    enabled: true,
    frequency: 'daily',  // or 'weekly', 'monthly'
    time: '09:00',
    channels: ['email']
  }
});
```

## Rate Limiting

### Configuration

```typescript
interface RateLimitConfig {
  perMinute?: number;
  perHour?: number;
  perDay?: number;
  burstLimit?: number;  // Consecutive requests limit
}
```

### Usage

```typescript
@Injectable()
class NotificationController {
  constructor(
    @Inject(RATE_LIMITER) private rateLimiter: RateLimiter
  ) {}

  async sendNotification(userId: string) {
    // Check rate limit
    const allowed = await this.rateLimiter.checkLimit(
      userId,
      'notification',
      {
        perMinute: 5,
        perHour: 20,
        perDay: 100,
        burstLimit: 3
      }
    );

    if (!allowed) {
      throw new Error('Rate limit exceeded');
    }

    // Send notification...
  }
}
```

### Batch Rate Limiting

```typescript
// Check limits for multiple recipients
const recipients = [
  { id: 'user1' },
  { id: 'user2' },
  { id: 'user3' }
];

const results = await rateLimiter.checkBatch(
  recipients,
  'broadcast',
  { perDay: 10 }
);

const allowedRecipients = recipients.filter(r => results.get(r.id));
```

### Rate Limit Status

```typescript
// Get current status
const status = await rateLimiter.getStatus(userId, 'notification');
/*
{
  minute: {
    allowed: true,
    remaining: 8,
    resetAt: 1234567890
  },
  hour: {
    allowed: true,
    remaining: 95,
    resetAt: 1234567890
  },
  day: {
    allowed: false,
    remaining: 0,
    resetAt: 1234567890
  }
}
*/

// Reset rate limits
await rateLimiter.reset(userId, 'notification');

// Set custom limits for specific user
await rateLimiter.setCustomLimits(userId, {
  perDay: 200,  // Higher limit for premium user
  burstLimit: 10
});
```

## Analytics & Reporting

### Event Tracking

```typescript
@Injectable()
class AnalyticsTracker {
  constructor(
    @Inject(ANALYTICS_SERVICE) private analytics: NotificationAnalytics
  ) {}

  async trackNotificationEvent(event: NotificationEvent) {
    await this.analytics.track({
      id: generateUuid(),
      type: 'sent',  // or 'delivered', 'opened', 'clicked', 'failed', 'bounced'
      notificationId: 'notif-123',
      recipientId: 'user-456',
      channel: 'email',
      category: 'transactional',
      timestamp: Date.now(),
      metadata: {
        campaignId: 'camp-789',
        variant: 'A'
      }
    });
  }
}
```

### Querying Analytics

```typescript
// Query events
const events = await analytics.queryEvents({
  startDate: new Date('2024-01-01'),
  endDate: new Date('2024-01-31'),
  channel: 'email',
  category: 'marketing',
  limit: 1000
});

// Get statistics
const stats = await analytics.getStatistics({
  startDate: Date.now() - 7 * 86400000,  // Last 7 days
  endDate: Date.now()
});

console.log(`
  Total Sent: ${stats.sent}
  Delivered: ${stats.delivered} (${stats.successRate.toFixed(1)}%)
  Opened: ${stats.opened} (${stats.openRate.toFixed(1)}%)
  Clicked: ${stats.clicked} (${stats.clickRate.toFixed(1)}%)
  Failed: ${stats.failed}

  Avg Delivery Time: ${stats.avgDeliveryTime}ms
  Avg Response Time: ${stats.avgResponseTime}ms
`);
```

### Report Generation

```typescript
// Generate comprehensive report
const report = await analytics.generateReport(
  {
    start: new Date('2024-01-01'),
    end: new Date('2024-01-31'),
    type: 'monthly'
  },
  {
    compareToPrevious: true  // Compare with previous period
  }
);

console.log('Report Summary:');
console.log(`Total Notifications: ${report.statistics.total}`);
console.log(`Success Rate: ${report.statistics.successRate}%`);

// Issues identified
report.issues?.forEach(issue => {
  console.log(`Issue: ${issue.description}`);
});

// Recommendations
report.recommendations?.forEach(rec => {
  console.log(`Recommendation: ${rec}`);
});

// Period comparison
if (report.comparison) {
  console.log(`Change vs Previous Period:`);
  console.log(`  Sent: ${report.comparison.changes.sent}%`);
  console.log(`  Open Rate: ${report.comparison.changes.openRate}%`);
}
```

### Real-Time Analytics

```typescript
// Subscribe to real-time events
const unsubscribe = await analytics.subscribeToEvents((event) => {
  console.log('New event:', event);
});

// Subscribe to real-time statistics
const unsubscribeStats = await analytics.subscribeToStats(
  (stats) => {
    console.log('Updated stats:', stats);
  },
  5000  // Update every 5 seconds
);

// Cleanup
unsubscribe();
unsubscribeStats();
```

### Analytics Cleanup

```typescript
// Clean up old data
const deleted = await analytics.cleanupOldData(90);  // Keep 90 days
console.log(`Deleted ${deleted} old records`);

// Automatic cleanup based on retention setting
await analytics.cleanup();
```

## Module Implementation Details

### TitanNotificationsModule Internal Architecture

```typescript
@Module()
export class TitanNotificationsModule {
  name = 'TitanNotificationsModule';

  static forRoot(options: NotificationModuleOptions = {}): DynamicModule {
    const providers: Array<[InjectionToken<any>, ProviderDefinition<any>]> = [];

    // Store module options
    providers.push([NOTIFICATION_MODULE_OPTIONS, { useValue: options }]);

    // Create Redis client
    const redis = new Redis({
      host: options.redis?.host || 'localhost',
      port: options.redis?.port || 6379,
      db: options.redis?.db || 0,
      password: options.redis?.password
    });

    providers.push(['REDIS_CLIENT' as any, { useValue: redis }]);

    // Create Rotif manager with configuration
    providers.push([ROTIF_MANAGER, {
      useFactory: () => {
        const rotifConfig = {
          redis: options.redis || { host: 'localhost', port: 6379 },
          ...options.rotif
        };
        return new NotificationManager(rotifConfig);
      }
    }]);

    // Core services registration
    providers.push([CHANNEL_MANAGER, {
      useFactory: () => new ChannelManager()
    }]);

    providers.push([PREFERENCE_MANAGER, {
      useFactory: (redisClient: Redis) => new PreferenceManager(redisClient),
      inject: ['REDIS_CLIENT' as any]
    }]);

    providers.push([RATE_LIMITER, {
      useFactory: (redisClient: Redis) => {
        const rateLimitConfig = options.rateLimit?.default;
        return new RateLimiter(redisClient, rateLimitConfig);
      },
      inject: ['REDIS_CLIENT' as any]
    }]);

    // Template engine (optional, defaults to enabled)
    if (options.templates?.enabled !== false) {
      providers.push([TEMPLATE_ENGINE, {
        useFactory: (redisClient: Redis) => new TemplateEngine(redisClient, options.templates),
        inject: ['REDIS_CLIENT' as any]
      }]);
    }

    // Workflow engine (optional, defaults to enabled)
    if (options.workflows?.enabled !== false) {
      providers.push([WORKFLOW_ENGINE, {
        useFactory: (notificationService: NotificationService, redisClient: Redis) =>
          new WorkflowEngine(notificationService, redisClient, options.workflows),
        inject: [NOTIFICATION_SERVICE, 'REDIS_CLIENT' as any]
      }]);
    }

    // Analytics (optional, defaults to enabled)
    if (options.analytics?.enabled !== false) {
      providers.push([ANALYTICS_SERVICE, {
        useFactory: (redisClient: Redis) => new NotificationAnalytics(redisClient, options.analytics),
        inject: ['REDIS_CLIENT' as any]
      }]);
    }

    // Main notification service
    providers.push([NOTIFICATION_SERVICE, {
      useFactory: (
        rotif: NotificationManager,
        channelManager: ChannelManager,
        preferenceManager: PreferenceManager,
        rateLimiter: RateLimiter
      ) => new NotificationService(rotif, channelManager, preferenceManager, rateLimiter),
      inject: [ROTIF_MANAGER, CHANNEL_MANAGER, PREFERENCE_MANAGER, RATE_LIMITER]
    }]);

    // Also register with class token for easier injection
    providers.push([NotificationService as any, {
      useFactory: (service: NotificationService) => service,
      inject: [NOTIFICATION_SERVICE]
    }]);

    // Determine exports based on enabled features
    const exports: InjectionToken<any>[] = [
      NOTIFICATION_SERVICE,
      NotificationService as any,
      CHANNEL_MANAGER,
      PREFERENCE_MANAGER,
      RATE_LIMITER,
      ROTIF_MANAGER
    ];

    if (options.templates?.enabled !== false) {
      exports.push(TEMPLATE_ENGINE);
    }

    if (options.workflows?.enabled !== false) {
      exports.push(WORKFLOW_ENGINE);
    }

    if (options.analytics?.enabled !== false) {
      exports.push(ANALYTICS_SERVICE);
    }

    return {
      module: TitanNotificationsModule,
      providers,
      exports,
      global: options.isGlobal
    };
  }

  static forRootAsync(options: NotificationModuleAsyncOptions): DynamicModule {
    const providers: Array<[InjectionToken<any>, ProviderDefinition<any>] | Provider<any>> = [];

    // Create async options provider
    if (options.useFactory) {
      providers.push([NOTIFICATION_MODULE_OPTIONS, {
        useFactory: options.useFactory,
        inject: options.inject || []
      }]);
    } else if (options.useExisting) {
      providers.push([NOTIFICATION_MODULE_OPTIONS, {
        useFactory: async (optionsFactory: NotificationOptionsFactory) =>
          optionsFactory.createNotificationOptions(),
        inject: [options.useExisting]
      }]);
    } else if (options.useClass) {
      providers.push([options.useClass as any, {
        useClass: options.useClass
      }]);

      providers.push([NOTIFICATION_MODULE_OPTIONS, {
        useFactory: async (optionsFactory: NotificationOptionsFactory) =>
          optionsFactory.createNotificationOptions(),
        inject: [options.useClass as any]
      }]);
    }

    // Create services using async options
    providers.push(['REDIS_CLIENT' as any, {
      useFactory: (moduleOptions: NotificationModuleOptions) => new Redis({
        host: moduleOptions.redis?.host || 'localhost',
        port: moduleOptions.redis?.port || 6379,
        db: moduleOptions.redis?.db || 0,
        password: moduleOptions.redis?.password
      }),
      inject: [NOTIFICATION_MODULE_OPTIONS]
    }]);

    // ... remaining provider registrations follow same pattern

    return {
      module: TitanNotificationsModule,
      imports: options.imports || [],
      providers,
      exports,
      global: options.isGlobal
    };
  }
}
```

### Service Registration Order

1. **Module Options** - Configuration storage
2. **Redis Client** - Base infrastructure
3. **Rotif Manager** - Message queue system
4. **Channel Manager** - Channel routing
5. **Preference Manager** - User preferences
6. **Rate Limiter** - Throttling system
7. **Template Engine** (optional) - Content generation
8. **Analytics Service** (optional) - Event tracking
9. **Notification Service** - Main orchestrator
10. **Workflow Engine** (optional) - Depends on NotificationService

### Dependency Graph

```
┌─────────────────────────────────────────────┐
│             Module Options                  │
└────────────────┬────────────────────────────┘
                 ↓
┌─────────────────────────────────────────────┐
│             Redis Client                    │
└────────┬───────┬───────┬───────┬────────────┘
         ↓       ↓       ↓       ↓
    Preference  Rate  Template Analytics
     Manager  Limiter  Engine   Service
         ↓       ↓       ↓       ↓
┌─────────────────────────────────────────────┐
│         Notification Service                │
└────────────────┬────────────────────────────┘
                 ↓
┌─────────────────────────────────────────────┐
│          Workflow Engine                    │
└─────────────────────────────────────────────┘
```

## Module Integration

### With Dependency Injection

```typescript
@Injectable()
class MyNotificationService {
  constructor(
    @Inject(NOTIFICATION_SERVICE) private notifications: NotificationService,
    @Inject(TEMPLATE_ENGINE) private templates: TemplateEngine,
    @Inject(WORKFLOW_ENGINE) private workflows: WorkflowEngine,
    @Inject(ANALYTICS_SERVICE) private analytics: NotificationAnalytics,
    @Inject(PREFERENCE_MANAGER) private preferences: PreferenceManager,
    @Inject(RATE_LIMITER) private rateLimiter: RateLimiter,
    @Inject(CHANNEL_MANAGER) private channels: ChannelManager
  ) {}

  async sendTemplatedNotification(userId: string, templateId: string, data: any) {
    // Check rate limit
    if (!await this.rateLimiter.checkLimit(userId, 'notification')) {
      throw new Error('Rate limit exceeded');
    }

    // Render template
    const content = await this.templates.render(templateId, data);

    // Send notification
    const result = await this.notifications.send(
      { id: userId },
      {
        type: 'info',
        title: content.subject || 'Notification',
        body: content.text || '',
        data: content.data
      }
    );

    // Track analytics
    await this.analytics.track({
      id: generateUuid(),
      type: 'sent',
      notificationId: result.id,
      recipientId: userId,
      channel: 'email',
      timestamp: Date.now()
    });

    return result;
  }
}
```

### With Other Modules

```typescript
import { Application } from '@omnitron-dev/titan';
import { TitanNotificationsModule } from '@omnitron-dev/titan/module/notifications';
import { ConfigModule } from '@omnitron-dev/titan/module/config';
import { LoggerModule } from '@omnitron-dev/titan/module/logger';
import { DiscoveryModule } from '@omnitron-dev/titan/module/discovery';

const app = await Application.create({
  imports: [
    ConfigModule.forRoot(),
    LoggerModule.forRoot(),
    DiscoveryModule.forRoot(),
    TitanNotificationsModule.forRoot({
      redis: {
        host: process.env.REDIS_HOST,
        port: parseInt(process.env.REDIS_PORT)
      }
    })
  ]
});
```

### Module Lifecycle

```typescript
@Module()
export class AppModule {
  constructor(
    @Inject(NOTIFICATION_SERVICE) private notifications: NotificationService,
    @Inject(TEMPLATE_ENGINE) private templates: TemplateEngine,
    @Inject(WORKFLOW_ENGINE) private workflows: WorkflowEngine
  ) {}

  async onModuleInit() {
    // Register templates
    await this.templates.registerTemplate({...});

    // Define workflows
    this.workflows.defineWorkflow({...});
  }

  async onModuleDestroy() {
    // Cleanup if needed
  }
}
```

## API Reference

### NotificationService API

```typescript
class NotificationService {
  /**
   * Send notification to recipients
   */
  async send(
    recipients: Recipient | Recipient[],
    notification: NotificationPayload,
    options?: SendOptions
  ): Promise<NotificationResult>;

  /**
   * Broadcast to target audience
   */
  async broadcast(
    target: BroadcastTarget,
    notification: NotificationPayload,
    options?: BroadcastOptions
  ): Promise<BroadcastResult>;

  /**
   * Schedule notification for future
   */
  async schedule(
    recipients: Recipient | Recipient[],
    notification: NotificationPayload,
    deliveryTime: Date | number,
    options?: ScheduleOptions
  ): Promise<ScheduleResult>;

  /**
   * Cancel scheduled notification
   */
  async cancelScheduled(scheduleId: string): Promise<boolean>;
}
```

### ChannelManager API

```typescript
class ChannelManager {
  /**
   * Register notification channel
   */
  registerChannel(channel: NotificationChannel, priority?: number): void;

  /**
   * Plan delivery across channels
   */
  async planDelivery(
    recipients: Recipient[],
    notification: NotificationPayload,
    options: SendOptions
  ): Promise<Map<string, { recipients: Recipient[] }>>;
}
```

### TemplateEngine API

```typescript
class TemplateEngine {
  /**
   * Register template
   */
  async registerTemplate(template: NotificationTemplate): Promise<void>;

  /**
   * Render template with data
   */
  async render(
    templateId: string,
    data: any,
    options?: RenderOptions
  ): Promise<RenderedContent>;

  /**
   * Get all templates
   */
  async getAllTemplates(): Promise<NotificationTemplate[]>;

  /**
   * Delete template
   */
  async deleteTemplate(templateId: string): Promise<boolean>;

  /**
   * Extract variables from content
   */
  extractVariables(content: string | any): string[];

  /**
   * Replace variables in content
   */
  replaceVariables(content: string, data: any): string;
}
```

### WorkflowEngine API

```typescript
class WorkflowEngine {
  /**
   * Define workflow
   */
  defineWorkflow(workflow: NotificationWorkflow): void;

  /**
   * Execute workflow
   */
  async execute(
    workflowId: string,
    context: WorkflowContext
  ): Promise<WorkflowResult>;

  /**
   * Get all workflows
   */
  getAllWorkflows(): NotificationWorkflow[];

  /**
   * Cancel running workflow
   */
  async cancelWorkflow(instanceId: string): Promise<boolean>;

  /**
   * Get execution history
   */
  async getExecutionHistory(
    workflowId: string,
    limit?: number
  ): Promise<any[]>;
}
```

## Type Definitions

### Core Types

```typescript
interface Recipient {
  id: string;
  email?: string;
  phone?: string;
  pushTokens?: string[];
  webhookUrl?: string;
  locale?: string;
}

interface NotificationPayload {
  id?: string;
  type: 'info' | 'success' | 'warning' | 'error' | 'critical';
  title: string;
  body: string;
  data?: Record<string, any>;
  metadata?: NotificationMetadata;
}

interface NotificationMetadata {
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  ttl?: number;
  deduplicationKey?: string;
  category?: string;
  tags?: string[];
  tracking?: {
    impressions?: boolean;
    clicks?: boolean;
    conversions?: boolean;
  };
}

interface SendOptions {
  channels?: ChannelType[];
  templateId?: string;
  delay?: number;
  scheduledTime?: number | Date;
  exactlyOnce?: boolean;
  deduplicationTTL?: number;
  channelStrategy?: 'first-available' | 'all' | 'fallback';
}

interface NotificationResult {
  id: string;
  sent: number;
  failed: number;
  filtered: number;
  details?: DeliveryResults;
}
```

## Decorators & Injection

### Injection Tokens

```typescript
import {
  NOTIFICATION_SERVICE,
  CHANNEL_MANAGER,
  PREFERENCE_MANAGER,
  RATE_LIMITER,
  TEMPLATE_ENGINE,
  WORKFLOW_ENGINE,
  ANALYTICS_SERVICE,
  ROTIF_MANAGER
} from '@omnitron-dev/titan/module/notifications';
```

### Service Registration

```typescript
@Injectable()
class CustomNotificationService {
  // Service is automatically registered
}

// Manual registration
app.register(CUSTOM_SERVICE_TOKEN, {
  useClass: CustomNotificationService
});
```

## Advanced Implementation Details

### Deduplication Algorithm

The deduplication system uses an in-memory cache with time-based expiry:

```typescript
// Deduplication cache structure
Map<deduplicationKey: string, timestamp: number>

// Algorithm:
1. Check if key exists in cache
2. If exists, compare timestamp with current time
3. If difference < TTL, skip notification (deduplicated)
4. If difference >= TTL or not exists, send notification
5. Update cache with current timestamp

// Memory management:
- No automatic cleanup (potential memory leak)
- Consider implementing periodic cleanup:
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamp] of deduplicationCache) {
    if (now - timestamp > DEFAULT_DEDUPLICATION_TTL) {
      deduplicationCache.delete(key);
    }
  }
}, 3600000); // Cleanup every hour
```

### Channel Selection Algorithm

```typescript
// Channel selection process:
1. Get requested channels (default: ['inApp'])
2. For each channel type:
   a. Find matching channel in registry
   b. Check channel.isAvailable()
   c. Check channel.validateRecipient(recipient)
3. Apply strategy:
   - 'first-available': Return first valid channel
   - 'all': Return all valid channels
   - 'fallback': Return first (will try next on failure)
4. Sort by priority (lower number = higher priority)
5. If no channels valid, default to InApp
```

### Rate Limiting Algorithms

**Sliding Window (Burst Limit):**
```typescript
// Uses Redis sorted set
ZADD burst:key timestamp timestamp
ZREMRANGEBYSCORE burst:key -inf (now-window)
ZCARD burst:key
// If count > limit, reject
```

**Fixed Window (Per-minute/hour/day):**
```typescript
// Uses Redis counter with TTL
INCR counter:key
EXPIRE counter:key ttl
// If count > limit, reject
```

### Quiet Hours Algorithm

```typescript
// Time comparison in minutes:
currentMinutes = currentHour * 60 + currentMinute
startMinutes = startHour * 60 + startMinute
endMinutes = endHour * 60 + endMinute

// Overnight handling (e.g., 22:00 to 08:00):
if (startMinutes > endMinutes) {
  // Spans midnight
  inQuietHours = currentMinutes >= startMinutes || currentMinutes < endMinutes
} else {
  // Same day
  inQuietHours = currentMinutes >= startMinutes && currentMinutes < endMinutes
}

// Exception handling:
if (inQuietHours && notification.metadata?.priority === 'urgent') {
  // Send anyway
}
if (inQuietHours && quietHours.exceptions?.includes(category)) {
  // Send anyway
}
```

### Batch Processing Algorithm

```typescript
// Batch sending logic:
totalRecipients = recipients.length
batchSize = options.batchSize || 1000
numberOfBatches = Math.ceil(totalRecipients / batchSize)

for (let i = 0; i < numberOfBatches; i++) {
  startIndex = i * batchSize
  endIndex = Math.min((i + 1) * batchSize, totalRecipients)
  batch = recipients.slice(startIndex, endIndex)

  result = await send(batch)
  results.push(result)

  // Inter-batch delay (avoid overwhelming)
  if (i < numberOfBatches - 1) {
    await sleep(100) // 100ms delay
  }
}
```

### Template Variable Resolution

```typescript
// Nested variable access (e.g., {{user.profile.name}}):
function getNestedValue(obj, path) {
  const parts = path.split('.')
  let current = obj

  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = current[part]
    } else {
      return undefined
    }
  }

  return current
}

// Variable replacement:
text.replace(/\{\{([^}]+)\}\}/g, (match, variable) => {
  const value = getNestedValue(data, variable.trim())
  return value !== undefined ? String(value) : match
})
```

### Analytics Bucketing Strategy

```typescript
// Daily buckets for event storage:
Key: notifications:analytics:events:2024-01-15
Value: Sorted set with timestamp as score

// Hourly aggregation for time series:
timestamp = Math.floor(event.timestamp / 3600000) * 3600000
// Groups events into hourly buckets

// Counter hierarchies:
Global: notifications:analytics:counters:2024-01-15
Channel: notifications:analytics:channel:email:2024-01-15
Category: notifications:analytics:category:marketing:2024-01-15
User: notifications:analytics:user:user123:2024-01-15
```

### Workflow Execution State Machine

```typescript
// Workflow states:
enum WorkflowState {
  PENDING = 'pending',     // Created but not started
  RUNNING = 'running',     // Currently executing steps
  COMPLETED = 'completed', // All steps successful
  FAILED = 'failed'        // Step failed with onError: 'stop'
}

// Step execution flow:
1. Check step conditions
2. If conditions false, skip (mark as success with skipped: true)
3. Apply step delay if specified
4. Execute step based on type
5. Update context with result
6. Handle errors based on onError strategy:
   - 'stop': Set workflow state to 'failed', break
   - 'retry': Attempt retry with backoff
   - 'continue': Proceed to next step
```

### Memory Leak Prevention

```typescript
// Potential memory leaks and solutions:

1. Deduplication cache:
   Problem: Unbounded growth
   Solution: Periodic cleanup or use LRU cache

2. Schedule storage:
   Problem: Completed schedules not removed
   Solution: Clean up after execution

3. Running workflows map:
   Problem: Failed workflows might not be removed
   Solution: Use try-finally to ensure cleanup

4. Event listeners:
   Problem: Not removed on module destroy
   Solution: Track and remove in onModuleDestroy

5. Redis connections:
   Problem: Duplicate connections for PubSub
   Solution: Reuse connections where possible
```

## Error Handling

### Common Errors

#### Rate Limit Exceeded
```typescript
try {
  await notifications.send(recipient, notification);
} catch (error) {
  if (error.message.includes('Rate limit')) {
    // Wait and retry or notify user
  }
}
```

#### Channel Unavailable
```typescript
// Automatic fallback with channel strategy
await notifications.send(recipient, notification, {
  channels: ['push', 'email', 'sms'],
  channelStrategy: 'fallback'  // Try next if one fails
});
```

#### Template Not Found
```typescript
try {
  await templates.render('missing-template', data);
} catch (error) {
  // Use default notification without template
  await notifications.send(recipient, {
    type: 'info',
    title: 'Default Title',
    body: 'Default message'
  });
}
```

### Error Recovery

```typescript
// Retry with exponential backoff
import { retry } from '@omnitron-dev/titan/module/notifications';

const result = await retry(
  () => notifications.send(recipient, notification),
  3,  // Max attempts
  1000  // Initial delay
);
```

## Complete Execution Flows

### Send Notification Flow

```
1. send() called with recipients, notification, options
   ↓
2. Generate notification ID if not provided
   ↓
3. Check deduplication cache
   ↓ (if deduplicated)
   Return early with sent:0, filtered:recipients.length
   ↓ (if not deduplicated)
4. Normalize recipients to array
   ↓
5. Filter by preferences (PreferenceManager)
   - Check global enabled
   - Check channel preferences
   - Check category preferences
   - Check frequency limits
   - Check quiet hours
   ↓
6. Apply rate limiting (RateLimiter)
   - Check burst limit
   - Check per-minute/hour/day limits
   ↓
7. Plan delivery (ChannelManager)
   - Select channels per recipient
   - Apply channel strategy
   - Group recipients by channel
   ↓
8. Send via Rotif (sendViaRotif)
   - Publish to channel-specific topics
   - Handle failures per channel
   ↓
9. Return NotificationResult
   - sent count
   - failed count
   - filtered count
   - delivery details
```

### Workflow Execution Flow

```
1. execute() called with workflowId and context
   ↓
2. Create workflow instance
   - Generate unique ID
   - Set state to 'pending'
   - Initialize context
   ↓
3. Add to runningWorkflows map
   ↓
4. Set state to 'running'
   ↓
5. For each step:
   a. Check step conditions
      ↓ (if false)
      Skip step, mark as success with skipped:true
      ↓ (if true)
   b. Apply step delay if specified
      ↓
   c. Execute step based on type:
      - notification: Send via NotificationService
      - wait: Sleep for duration
      - condition: Evaluate and branch
      - parallel: Execute sub-steps concurrently
      - batch: Process items in chunks
      ↓
   d. Update context with step result
      ↓
   e. Handle step failure:
      - onError: 'stop' → Set state to 'failed', break
      - onError: 'retry' → Retry with backoff
      - onError: 'continue' → Proceed to next step
      ↓
6. Set final state ('completed' or 'failed')
   ↓
7. Store execution history in Redis
   ↓
8. Remove from runningWorkflows map
   ↓
9. Return WorkflowResult
```

### Analytics Event Flow

```
1. track() called with NotificationEvent
   ↓
2. Store event in daily bucket (sorted set)
   - Key: notifications:analytics:events:YYYY-MM-DD
   - Score: timestamp
   - Value: JSON event data
   ↓
3. Update counters (updateCounters)
   - Global counter: counters:YYYY-MM-DD
   - Channel counter: channel:{channel}:YYYY-MM-DD
   - Category counter: category:{category}:YYYY-MM-DD
   - User counter: user:{userId}:YYYY-MM-DD
   ↓
4. Set TTL on daily bucket
   - Default: 90 days
   - Configurable via options.retention
   ↓
5. Publish real-time event (if enabled)
   - Channel: notifications:analytics:events
   - Subscribers receive event immediately
```

## Edge Cases and Solutions

### Race Conditions

**Problem**: Multiple concurrent sends with same deduplication key
```typescript
// Potential race condition
Thread 1: Check cache (not found) → Process → Set cache
Thread 2: Check cache (not found) → Process → Set cache
// Result: Both threads send notification
```

**Solution**: Use Redis for distributed deduplication
```typescript
const dedupKey = `dedup:${notification.metadata.deduplicationKey}`;
const set = await redis.set(dedupKey, '1', 'PX', ttl, 'NX');
if (!set) {
  // Already processed
  return;
}
```

### Memory Exhaustion

**Problem**: Large recipient lists cause OOM
```typescript
// Dangerous: Loading all recipients in memory
const recipients = await loadMillionRecipients();
await notifications.send(recipients, notification);
```

**Solution**: Stream processing
```typescript
// Process in chunks
const cursor = getRecipientCursor();
while (cursor.hasNext()) {
  const batch = await cursor.next(1000);
  await notifications.send(batch, notification);
}
```

### Template Circular References

**Problem**: Nested variable causes infinite loop
```typescript
const data = { user: {} };
data.user.profile = data.user; // Circular reference
template.render('template', data); // Stack overflow
```

**Solution**: Detect cycles during traversal
```typescript
function getNestedValue(obj, path, visited = new Set()) {
  if (visited.has(obj)) return undefined;
  visited.add(obj);
  // ... traverse safely
}
```

### Quiet Hours Timezone Issues

**Problem**: Server and user in different timezones
```typescript
// Server: UTC
// User: America/New_York (UTC-5)
// Quiet hours: 22:00-08:00
// Server time: 03:00 UTC = 22:00 EST
// Should be quiet but isn't if using server time
```

**Solution**: Convert to user timezone
```typescript
import { DateTime } from 'luxon';

const userTime = DateTime.now().setZone(quietHours.timezone);
const currentHour = userTime.hour;
const currentMinute = userTime.minute;
```

### Workflow Infinite Loops

**Problem**: Workflow step triggers itself
```typescript
workflow.steps = [{
  id: 'loop',
  type: 'condition',
  config: {
    field: 'counter',
    operator: 'lessThan',
    value: 10,
    onTrue: [{ /* recursive call to 'loop' */ }]
  }
}];
```

**Solution**: Implement max depth or iteration limit
```typescript
const MAX_ITERATIONS = 100;
if (instance.iterations++ > MAX_ITERATIONS) {
  throw new Error('Workflow max iterations exceeded');
}
```

### Channel Failure Cascading

**Problem**: One channel failure affects all recipients
```typescript
// If email service is down, all emails fail
// Even if SMS could work for some recipients
```

**Solution**: Isolated channel processing
```typescript
for (const [channel, group] of deliveryPlan) {
  try {
    await processChannel(channel, group);
  } catch (error) {
    // Log error but continue with other channels
    logger.error({ channel, error });
  }
}
```

## Performance Optimization

### Batching

```typescript
// Efficient batch processing
await notifications.broadcast(
  { userIds: largeUserList },
  notification,
  {
    batchSize: 500,  // Process in chunks
    channels: ['email']
  }
);
```

### Caching

```typescript
// Template caching
await templates.render('welcome', data, {
  skipCache: false,  // Use cache
  cacheTTL: 3600    // 1 hour
});

// Preference caching (automatic)
// Rate limit caching (automatic)
```

### Deduplication

```typescript
// Prevent duplicate sends
await notifications.send(recipient, {
  type: 'info',
  title: 'Alert',
  body: 'System update',
  metadata: {
    deduplicationKey: 'system-update-2024-01'
  }
}, {
  deduplicationTTL: 86400000  // 24 hours
});
```

## Best Practices

### 1. Use Templates

```typescript
// ✅ Good: Use templates for consistent messaging
await notifications.send(recipient, notification, {
  templateId: 'order-confirmation'
});

// ❌ Bad: Hardcoding content
await notifications.send(recipient, {
  title: 'Order confirmed',
  body: 'Your order is confirmed'
});
```

### 2. Respect User Preferences

```typescript
// ✅ Good: Preferences are automatically checked
await notifications.send(recipient, notification);

// ✅ Good: Provide category for filtering
notification.metadata = { category: 'marketing' };
```

### 3. Handle Rate Limits

```typescript
// ✅ Good: Check before bulk operations
const allowed = await rateLimiter.checkBatch(recipients);
const filteredRecipients = recipients.filter(r => allowed.get(r.id));

// ❌ Bad: Send without checking
recipients.forEach(r => notifications.send(r, notification));
```

### 4. Track Analytics

```typescript
// ✅ Good: Track all events
notifications.on('sent', event => analytics.track(event));
notifications.on('delivered', event => analytics.track(event));

// Generate regular reports
setInterval(() => analytics.generateReport(), 86400000);
```

### 5. Use Workflows for Sequences

```typescript
// ✅ Good: Use workflow for complex sequences
await workflows.execute('onboarding', { userId });

// ❌ Bad: Manual timing management
setTimeout(() => send(email1), 0);
setTimeout(() => send(email2), 3600000);
setTimeout(() => send(email3), 86400000);
```

## Migration Guide

### From SendGrid/Mailgun

```typescript
// Old SendGrid code
sgMail.send({
  to: 'user@example.com',
  from: 'app@example.com',
  subject: 'Hello',
  text: 'Hello world'
});

// Titan Notifications equivalent
await notifications.send(
  { email: 'user@example.com' },
  {
    type: 'info',
    title: 'Hello',
    body: 'Hello world'
  },
  { channels: ['email'] }
);
```

### From Firebase Cloud Messaging

```typescript
// Old FCM code
admin.messaging().send({
  token: userToken,
  notification: {
    title: 'Alert',
    body: 'New message'
  }
});

// Titan Notifications equivalent
await notifications.send(
  { pushTokens: [userToken] },
  {
    type: 'info',
    title: 'Alert',
    body: 'New message'
  },
  { channels: ['push'] }
);
```

### From Custom Implementation

```typescript
// Old custom code
async function sendNotification(user, message) {
  if (checkRateLimit(user)) {
    if (user.preferences.email) {
      await sendEmail(user.email, message);
    }
    if (user.preferences.push) {
      await sendPush(user.token, message);
    }
    trackEvent('notification_sent', { user, message });
  }
}

// Titan Notifications equivalent (all handled automatically)
await notifications.send(user, message);
```

## Troubleshooting

### Notifications Not Sending

**Check rate limits:**
```typescript
const status = await rateLimiter.getStatus(userId);
console.log('Rate limit status:', status);
```

**Check preferences:**
```typescript
const prefs = await preferences.getPreferences(userId);
console.log('User preferences:', prefs);
```

**Check channel availability:**
```typescript
const channel = channelManager.getChannel('email');
const available = await channel.isAvailable();
console.log('Channel available:', available);
```

### Template Variables Not Replaced

**Verify variable names:**
```typescript
const variables = templates.extractVariables(templateContent);
console.log('Expected variables:', variables);
```

**Check data structure:**
```typescript
console.log('Provided data:', JSON.stringify(data, null, 2));
```

### Workflow Not Executing

**Check workflow status:**
```typescript
const running = workflows.getRunningWorkflows();
console.log('Running workflows:', running);
```

**View execution history:**
```typescript
const history = await workflows.getExecutionHistory(workflowId);
console.log('Recent executions:', history);
```

### Analytics Not Recording

**Verify Redis connection:**
```typescript
const redis = app.get('REDIS_CLIENT');
await redis.ping();  // Should return 'PONG'
```

**Check event structure:**
```typescript
console.log('Event being tracked:', JSON.stringify(event));
```

## Examples

### Complete Onboarding System

```typescript
@Injectable()
export class OnboardingService {
  constructor(
    @Inject(NOTIFICATION_SERVICE) private notifications: NotificationService,
    @Inject(TEMPLATE_ENGINE) private templates: TemplateEngine,
    @Inject(WORKFLOW_ENGINE) private workflows: WorkflowEngine,
    @Inject(ANALYTICS_SERVICE) private analytics: NotificationAnalytics
  ) {}

  async onModuleInit() {
    // Register templates
    await this.registerTemplates();

    // Define workflow
    await this.defineOnboardingWorkflow();
  }

  private async registerTemplates() {
    // Welcome email
    await this.templates.registerTemplate({
      id: 'welcome',
      name: 'Welcome Email',
      engine: 'handlebars',
      channels: ['email', 'inApp'],
      content: {
        email: {
          subject: 'Welcome to {{appName}}!',
          html: `
            <h1>Welcome {{userName}}!</h1>
            <p>We're excited to have you join {{appName}}.</p>
            <a href="{{profileUrl}}">Complete Your Profile</a>
          `,
          text: 'Welcome to {{appName}}! Complete your profile at {{profileUrl}}'
        },
        inApp: {
          title: 'Welcome!',
          body: 'Complete your profile to get started'
        }
      },
      variables: [
        { name: 'userName', type: 'string', required: true },
        { name: 'appName', type: 'string', required: true },
        { name: 'profileUrl', type: 'string', required: true }
      ]
    });
  }

  private async defineOnboardingWorkflow() {
    this.workflows.defineWorkflow({
      id: 'user-onboarding',
      name: 'User Onboarding',
      trigger: { type: 'manual' },
      steps: [
        // Welcome email
        {
          id: 'welcome',
          name: 'Send welcome notification',
          type: 'notification',
          config: {
            recipients: (ctx) => ({
              id: ctx.userId,
              email: ctx.email
            }),
            notification: {
              type: 'info',
              title: 'Welcome!',
              body: 'Welcome to our platform!'
            },
            channels: ['email', 'inApp'],
            templateId: 'welcome'
          }
        },
        // Wait 1 day
        {
          id: 'wait-day',
          name: 'Wait 1 day',
          type: 'wait',
          config: { duration: 86400000 }
        },
        // Check profile completion
        {
          id: 'check-profile',
          name: 'Check profile status',
          type: 'condition',
          config: {
            field: 'profileCompleted',
            operator: 'equals',
            value: false,
            onFalse: [
              {
                id: 'reminder',
                type: 'notification',
                config: {
                  notification: {
                    type: 'info',
                    title: 'Complete Your Profile',
                    body: 'Add more details to unlock all features'
                  }
                }
              }
            ]
          }
        }
      ]
    });
  }

  async onboardUser(user: User) {
    // Start onboarding workflow
    const result = await this.workflows.execute('user-onboarding', {
      userId: user.id,
      email: user.email,
      userName: user.name,
      appName: 'MyApp',
      profileUrl: `https://app.com/profile/${user.id}`,
      profileCompleted: false
    });

    // Track analytics
    await this.analytics.track({
      id: generateUuid(),
      type: 'sent',
      notificationId: `onboarding-${user.id}`,
      recipientId: user.id,
      channel: 'workflow',
      category: 'onboarding',
      timestamp: Date.now()
    });

    return result;
  }
}
```

### Marketing Campaign System

```typescript
@Injectable()
export class CampaignService {
  constructor(
    @Inject(NOTIFICATION_SERVICE) private notifications: NotificationService,
    @Inject(TEMPLATE_ENGINE) private templates: TemplateEngine,
    @Inject(ANALYTICS_SERVICE) private analytics: NotificationAnalytics,
    @Inject(PREFERENCE_MANAGER) private preferences: PreferenceManager
  ) {}

  async launchCampaign(campaign: Campaign) {
    // Register campaign template
    await this.templates.registerTemplate({
      id: `campaign-${campaign.id}`,
      name: campaign.name,
      engine: 'handlebars',
      channels: campaign.channels,
      content: campaign.content,
      variables: campaign.variables
    });

    // Get target audience
    const recipients = await this.getTargetAudience(campaign.segment);

    // Send with batching
    const result = await this.notifications.broadcast(
      {
        id: campaign.id,
        userIds: recipients.map(r => r.id)
      },
      {
        type: 'info',
        title: campaign.subject,
        body: campaign.preview,
        metadata: {
          category: 'marketing',
          tags: campaign.tags,
          tracking: {
            impressions: true,
            clicks: true,
            conversions: true
          }
        }
      },
      {
        templateId: `campaign-${campaign.id}`,
        channels: campaign.channels,
        batchSize: 500
      }
    );

    // Generate report after 24 hours
    setTimeout(async () => {
      const report = await this.analytics.generateReport({
        start: new Date(),
        end: new Date(Date.now() + 86400000),
        type: 'daily'
      });

      console.log('Campaign Report:', report);
    }, 86400000);

    return result;
  }

  private async getTargetAudience(segment: string): Promise<User[]> {
    // Implementation to fetch users based on segment
    return [];
  }
}
```

### Alert System with Escalation

```typescript
@Injectable()
export class AlertService {
  constructor(
    @Inject(NOTIFICATION_SERVICE) private notifications: NotificationService,
    @Inject(WORKFLOW_ENGINE) private workflows: WorkflowEngine
  ) {}

  async onModuleInit() {
    // Define alert escalation workflow
    this.workflows.defineWorkflow({
      id: 'alert-escalation',
      name: 'Alert Escalation',
      trigger: { type: 'manual' },
      steps: [
        // Level 1: In-app notification
        {
          id: 'level1',
          name: 'In-app alert',
          type: 'notification',
          config: {
            notification: {
              type: 'warning',
              title: '{{alertTitle}}',
              body: '{{alertMessage}}'
            },
            channels: ['inApp']
          }
        },
        // Wait 5 minutes
        {
          id: 'wait5',
          name: 'Wait 5 minutes',
          type: 'wait',
          config: { duration: 300000 }
        },
        // Check if acknowledged
        {
          id: 'check-ack',
          name: 'Check acknowledgment',
          type: 'condition',
          config: {
            field: 'acknowledged',
            operator: 'equals',
            value: false,
            onFalse: [
              // Level 2: Email
              {
                id: 'level2',
                type: 'notification',
                config: {
                  notification: {
                    type: 'error',
                    title: 'URGENT: {{alertTitle}}',
                    body: '{{alertMessage}}'
                  },
                  channels: ['email', 'push']
                }
              },
              // Wait 10 minutes
              {
                id: 'wait10',
                type: 'wait',
                config: { duration: 600000 }
              },
              // Level 3: SMS + Call manager
              {
                id: 'level3',
                type: 'parallel',
                config: {
                  steps: [
                    {
                      type: 'notification',
                      config: {
                        notification: {
                          type: 'critical',
                          title: 'CRITICAL: {{alertTitle}}'
                        },
                        channels: ['sms']
                      }
                    },
                    {
                      type: 'notification',
                      config: {
                        recipients: { id: 'manager-id' },
                        notification: {
                          type: 'critical',
                          title: 'Team Alert: {{alertTitle}}'
                        },
                        channels: ['email', 'sms']
                      }
                    }
                  ]
                }
              }
            ]
          }
        }
      ],
      onError: 'continue'
    });
  }

  async triggerAlert(alert: Alert) {
    await this.workflows.execute('alert-escalation', {
      alertId: alert.id,
      alertTitle: alert.title,
      alertMessage: alert.message,
      recipientId: alert.userId,
      acknowledged: false
    });
  }

  async acknowledgeAlert(alertId: string) {
    // Update workflow context to stop escalation
    // Implementation depends on workflow storage
  }
}
```

## Security Considerations

### Input Validation

```typescript
// Email validation
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
if (!emailRegex.test(email)) {
  throw new Error('Invalid email format');
}

// Phone validation
const phoneRegex = /^\+?[1-9]\d{7,14}$/;
if (!phoneRegex.test(phone.replace(/[\s-]/g, ''))) {
  throw new Error('Invalid phone format');
}

// URL validation for webhooks
try {
  new URL(webhookUrl);
} catch {
  throw new Error('Invalid webhook URL');
}
```

### Data Sanitization

```typescript
// Prevent XSS in HTML content
function sanitizeHtml(html: string): string {
  // Use a library like DOMPurify
  return DOMPurify.sanitize(html);
}

// Escape template variables
function escapeHtml(text: string): string {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}
```

### Rate Limiting Security

```typescript
// Prevent rate limit bypass
// Use consistent identifier formatting
const identifier = userId.toLowerCase().trim();

// Hash sensitive identifiers
const hashedId = createHash('sha256')
  .update(identifier)
  .digest('hex');

// Apply rate limits by hashed ID
await rateLimiter.checkLimit(hashedId, action);
```

### Authentication & Authorization

```typescript
// Verify sender permissions
if (!user.hasPermission('notifications.send')) {
  throw new ForbiddenException('Insufficient permissions');
}

// Validate recipient ownership
if (!user.canNotify(recipientId)) {
  throw new ForbiddenException('Cannot send to this recipient');
}

// Secure webhook signatures
const signature = createHmac('sha256', webhookSecret)
  .update(JSON.stringify(payload))
  .digest('hex');
```

### Data Privacy

```typescript
// PII redaction in logs
logger.info({
  notificationId,
  recipientId: hash(recipientId),
  channel,
  // Don't log: email, phone, content
});

// Encryption for sensitive data
const encrypted = encrypt(notification.body, encryptionKey);
notification.body = encrypted;

// Automatic PII cleanup
setTimeout(() => {
  analytics.cleanup(); // Remove old PII
}, 86400000);
```

## Rotif Integration Details

### Channel Naming Convention

Rotif channels follow this pattern:
```
notifications.{channel}.{recipientId}

Examples:
- notifications.email.user123
- notifications.sms.user456
- notifications.push.user789
```

### Rotif Message Structure

```typescript
interface RotifMessage {
  // From notification
  id?: string;
  type: string;
  title: string;
  body: string;
  data?: any;
  metadata?: NotificationMetadata;

  // Added by NotificationService
  recipientId: string;
  channel: string;

  // Rotif metadata
  messageId: string;
  timestamp: number;
  retryCount?: number;
}
```

### Rotif Configuration

```typescript
// Default Rotif options
const rotifConfig = {
  redis: {
    host: 'localhost',
    port: 6379
  },
  defaultRetries: 3,
  retryDelay: (attempt: number) => attempt * 1000,
  deduplicationTTL: 86400000,      // 24 hours
  maxStreamLength: 10000,           // Max messages per stream
  disableDelayed: false,            // Enable scheduled delivery

  // Reliability settings
  ackTimeout: 30000,                // 30 seconds to process
  consumerGroup: 'notifications',   // Consumer group name
  blockTimeout: 5000,               // Block for 5 seconds
  claimMinIdleTime: 60000,          // Claim after 1 minute idle

  // Performance settings
  batchSize: 100,                   // Process 100 messages at once
  concurrency: 10,                  // Process 10 batches concurrently
};
```

### Rotif Publish Options

```typescript
await rotif.publish(channelName, message, {
  // Scheduling
  delayMs: 5000,                    // Delay 5 seconds
  deliverAt: new Date('2024-12-25'), // Specific time

  // Reliability
  exactlyOnce: true,                // Deduplication enabled
  deduplicationId: 'unique-key',    // Custom dedup key
  ttl: 86400000,                     // Message TTL

  // Retry behavior
  maxRetries: 5,                     // Override default
  retryDelay: (attempt) => attempt * 2000,

  // Priority (future feature)
  priority: 'high',

  // Metadata
  correlationId: 'request-123',
  causationId: 'event-456'
});
```

### Rotif Consumer Setup

```typescript
// Subscribe to notification channels
rotif.subscribe('notifications.*.*', async (message) => {
  const { recipientId, channel } = message;

  // Process based on channel
  switch (channel) {
    case 'email':
      await sendEmail(message);
      break;
    case 'sms':
      await sendSMS(message);
      break;
    case 'push':
      await sendPush(message);
      break;
  }

  // Acknowledge message
  await message.ack();
});
```

### Rotif Error Handling

```typescript
// Dead Letter Queue setup
rotif.on('message.failed', async (message, error) => {
  // Move to DLQ after max retries
  if (message.retryCount >= 3) {
    await rotif.moveToDLQ(message, error);

    // Track in analytics
    await analytics.track({
      type: 'failed',
      notificationId: message.id,
      recipientId: message.recipientId,
      channel: message.channel,
      error: error.message
    });
  }
});

// Process DLQ
setInterval(async () => {
  const messages = await rotif.getDLQMessages(100);

  for (const message of messages) {
    // Alert, log, or retry
    logger.error('DLQ message:', message);
  }
}, 60000); // Check every minute
```

## Summary

The Titan Notifications Module provides a complete, production-ready notification system with:

### Core Capabilities
- **Multi-channel delivery** with fallback strategies
- **User preference management** with granular controls
- **Rate limiting** to prevent notification fatigue
- **Template engine** for dynamic content
- **Workflow engine** for complex sequences
- **Analytics and reporting** for insights
- **Real-time event tracking** and monitoring

### Technical Features
- **Redis-based** storage and caching
- **Rotif integration** for reliable delivery
- **Deduplication** to prevent duplicates
- **Batch processing** for efficiency
- **Scheduling** for delayed delivery
- **Localization** support
- **TypeScript** type safety

### Production Readiness
- **Scalable architecture** with batching
- **Error recovery** with retries
- **Performance optimization** with caching
- **Comprehensive analytics**
- **Flexible configuration**
- **Extensive API**

### Security Features
- **Input validation** for all channels
- **Data sanitization** to prevent XSS
- **Rate limiting** with bypass protection
- **Authentication & authorization** checks
- **PII redaction** in logs
- **Encryption** support for sensitive data

### Implementation Details
- **7 core services** with clear responsibilities
- **Complete internal methods** documentation
- **All utility functions** with examples
- **Module constants** and tokens
- **Execution flows** with step-by-step breakdowns
- **Edge cases** and solutions
- **Memory leak prevention** strategies
- **Rotif integration** specifics

The module seamlessly integrates with the Titan framework and provides a powerful, flexible API for all notification needs in modern applications. Every aspect has been designed with production use in mind, from performance optimization to security considerations.