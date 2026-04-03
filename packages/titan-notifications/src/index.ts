/**
 * Notifications Module for Titan Framework
 *
 * Multi-channel notification delivery system providing:
 * - Multiple delivery channels (Email, SMS, Push, In-App, Webhook)
 * - Template engine with variable substitution
 * - Rate limiting and preference management
 * - Delivery tracking and health monitoring
 * - Dead letter queue support
 *
 * @module @omnitron-dev/titan/module/notifications
 *
 * @example
 * ```typescript
 * import {
 *   NotificationsModule,
 *   NotificationsService,
 *   OnNotification,
 *   NOTIFICATIONS_SERVICE
 * } from '@omnitron-dev/titan/module/notifications';
 *
 * // Configure module
 * @Module({
 *   imports: [
 *     NotificationsModule.forRoot({
 *       channels: ['email', 'push'],
 *       rateLimiting: { enabled: true }
 *     })
 *   ]
 * })
 * class AppModule {}
 *
 * // Send notifications
 * @Injectable()
 * class OrderService {
 *   constructor(@Inject(NOTIFICATIONS_SERVICE) private notifications: NotificationsService) {}
 *
 *   async sendOrderConfirmation(orderId: string, userId: string) {
 *     await this.notifications.send({
 *       type: 'order.confirmed',
 *       recipient: { userId },
 *       data: { orderId }
 *     });
 *   }
 * }
 * ```
 */

// ============================================================================
// Module
// ============================================================================

export { NotificationsModule } from './notifications.module.js';

// ============================================================================
// Services
// ============================================================================

export { NotificationsService } from './notifications.service.js';
export { NotificationsHealthIndicator } from './notifications.health.js';

// ============================================================================
// Transport Layer
// ============================================================================

export { RotifTransport } from './transport/rotif.transport.js';
export { generateUuid } from './transport/transport.interface.js';

// ============================================================================
// Channel System
// ============================================================================

export { ChannelType, ChannelRegistry } from './channel/index.js';

// Channel implementations
export {
  InAppChannel,
  WebhookChannel,
  AbstractEmailChannel,
  AbstractSMSChannel,
  AbstractPushChannel,
  MockEmailChannel,
  MockSMSChannel,
  MockPushChannel,
  verifyWebhookSignature,
  REDIS_CLIENT,
} from './channel/index.js';

// ============================================================================
// Template Engine
// ============================================================================

export { TemplateEngine, DEFAULT_TEMPLATES } from './template-engine.js';

// ============================================================================
// Rate Limiting & Preferences
// ============================================================================

export { RedisRateLimiter } from './redis-rate-limiter.js';
export { RedisPreferenceStore } from './redis-preference-store.js';

// ============================================================================
// Retry Strategies (re-exported from unified utils module)
// ============================================================================

export { RetryStrategies, createRetryDelayFn } from '@omnitron-dev/titan/utils';

// ============================================================================
// Events Integration
// ============================================================================

export { NotificationsEventEmitter, NOTIFICATIONS_EVENTS } from './notifications.events.js';

// ============================================================================
// Decorators
// ============================================================================

export { OnNotification, getNotificationHandlers, hasNotificationHandlers } from './notifications.decorators.js';

// ============================================================================
// Tokens (for DI)
// ============================================================================

export {
  NOTIFICATIONS_SERVICE,
  NOTIFICATIONS_TRANSPORT,
  NOTIFICATIONS_MODULE_OPTIONS,
  NOTIFICATIONS_HEALTH,
  NOTIFICATIONS_RATE_LIMITER,
  NOTIFICATIONS_PREFERENCE_STORE,
  NOTIFICATIONS_CHANNEL_ROUTER,
  NOTIFICATIONS_EVENT_EMITTER,
  NOTIFICATIONS_CHANNEL_REGISTRY,
  NOTIFICATIONS_TEMPLATE_ENGINE,
  NOTIFICATIONS_REDIS_RATE_LIMITER,
  NOTIFICATIONS_REDIS_PREFERENCE_STORE,
} from './notifications.tokens.js';

// ============================================================================
// Types & Interfaces
// ============================================================================

// Module options
export type {
  NotificationsModuleOptions,
  NotificationsModuleAsyncOptions,
  RotifTransportOptions,
} from './notifications.types.js';

export type { NotificationsWorkerModuleOptions } from './notifications.module.js';

// Notification types
export type {
  NotificationPayload,
  NotificationRecipient,
  NotificationType,
  NotificationPriority,
  NotificationMetadata,
  StoredNotification,
} from './notifications.types.js';

// Send/Broadcast types
export type {
  SendOptions,
  SendResult,
  BroadcastOptions,
  BroadcastResult,
  ScheduleResult,
} from './notifications.types.js';

// Service interfaces
export type { IRateLimiter, IPreferenceStore, IChannelRouter } from './notifications.service.js';

// Transport interface types
export type {
  MessagingTransport,
  TransportPublishOptions,
  TransportPublishResult,
  TransportSubscribeOptions,
  NotificationHandler,
  NotificationSubscription,
  IncomingNotification,
  SubscriptionStats,
  TransportHealth,
  NotificationMessage,
  TransportMiddleware,
  // DLQ types
  DLQStats,
  DLQQueryOptions,
  DLQMessageInfo,
  DLQCleanupConfig,
} from './transport/transport.interface.js';

// Channel types
export type {
  NotificationChannel,
  ChannelContent,
  ChannelSendResult,
  ChannelHealth,
  EmailContent,
  SMSContent,
  PushContent,
  InAppContent,
  WebhookContent,
} from './channel/index.js';

export type {
  InAppChannelOptions,
  WebhookChannelOptions,
  EmailChannelOptions,
  SMSChannelOptions,
  PushChannelOptions,
  PushSendResult,
} from './channel/index.js';

// Channel strategy types
export type { ChannelStrategy, ChannelSelectionOptions, ChannelSelectionResult } from './channel/channel-registry.js';

// Decorator types
export type { OnNotificationOptions, NotificationHandlerMetadata } from './notifications.decorators.js';

// Health types
export type { NotificationsHealthStatus } from './notifications.health.js';

// Retry types (re-exported from unified utils module)
export type { RetryStrategyConfig, RetryStrategyType as RetryStrategy } from '@omnitron-dev/titan/utils';

// Event types
export type {
  NotificationsEventName,
  NotificationSendingEvent,
  NotificationSentEvent,
  NotificationFailedEvent,
  BroadcastStartingEvent,
  BroadcastCompletedEvent,
  ChannelDeliveryEvent,
  InAppNotificationEvent,
} from './notifications.events.js';

// Template types
export type {
  NotificationTemplate,
  TemplateContent,
  TemplateVariable,
  RenderedContent,
  RenderOptions,
  TemplateEngineOptions,
} from './template-engine.js';

// ============================================================================
// Publisher (cross-service notification publishing)
// ============================================================================

export { NotificationPublisher } from './publisher.js';
export type { NotificationEvent, NotificationPriorityLevel, NotificationEventAction } from './publisher.js';

// ============================================================================
// Worker (notification event consumer)
// ============================================================================

export {
  NotificationWorkerService,
  NOTIFICATION_TARGET_RESOLVER,
  NOTIFICATION_PERSISTER,
  NOTIFICATION_REALTIME_SIGNALER,
} from './worker/index.js';

export type {
  NotificationWorkerOptions,
  NotificationRecord,
  PersistedNotification,
  INotificationTargetResolver,
  INotificationPersister,
  INotificationRealtimeSignaler,
} from './worker/index.js';

// Rate limiter types
export type { RateLimitConfig, RateLimitStatus, RedisRateLimiterOptions } from './redis-rate-limiter.js';

// Preference store types
export type {
  ExtendedNotificationPreferences,
  CategoryPreference,
  FrequencyLimits,
  DigestConfig,
  QuietHoursConfig,
  RedisPreferenceStoreOptions,
} from './redis-preference-store.js';
