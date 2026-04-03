/**
 * Events Module for Titan Framework
 *
 * Comprehensive event-driven architecture providing:
 * - Type-safe event handling with decorators
 * - Wildcard and namespaced event patterns
 * - Event bus for inter-module communication
 * - Event history and replay functionality
 * - Event scheduling (delayed and cron-based)
 * - Event validation with JSON Schema and Zod support
 * - Performance monitoring and metrics
 * - Bounded message queues with backpressure handling
 *
 * @module @omnitron-dev/titan/module/events
 *
 * @example
 * ```typescript
 * import {
 *   EventsModule,
 *   EventsService,
 *   OnEvent,
 *   EVENTS_SERVICE_TOKEN
 * } from '@omnitron-dev/titan/module/events';
 *
 * // Configure module
 * @Module({
 *   imports: [EventsModule.forRoot({ wildcard: true })]
 * })
 * class AppModule {}
 *
 * // Use decorators for event handling
 * @Injectable()
 * class UserService {
 *   @OnEvent({ event: 'user.created' })
 *   handleUserCreated(data: UserData) {
 *     console.log('New user:', data);
 *   }
 * }
 *
 * // Or inject the service directly
 * @Injectable()
 * class NotificationService {
 *   constructor(@Inject(EVENTS_SERVICE_TOKEN) private events: EventsService) {}
 *
 *   notify(userId: string, message: string) {
 *     this.events.emit('notification.sent', { userId, message });
 *   }
 * }
 * ```
 */

// ============================================================================
// Module
// ============================================================================

export { EventsModule } from './events.module.js';

// ============================================================================
// Services
// ============================================================================

/**
 * Core services for event handling:
 * - EventsService: Main facade for event operations (emit, subscribe, etc.)
 * - EventBusService: Message bus for inter-module communication
 * - EventHistoryService: Event history and replay functionality
 * - EventSchedulerService: Delayed and cron-based event scheduling
 * - EventValidationService: Event data validation with schema support
 */
export { EventsService } from './events.service.js';
export { EventBusService } from './event-bus.service.js';
export { EventHistoryService } from './event-history.service.js';
export { EventSchedulerService } from './event-scheduler.service.js';
export { EventValidationService } from './event-validation.service.js';

// ============================================================================
// Decorators
// ============================================================================

/**
 * Event-driven decorators for declarative event handling:
 *
 * Method decorators:
 * - @OnEvent: Subscribe to specific events
 * - @OnceEvent: One-time event subscription
 * - @OnAnyEvent: Wildcard subscription to all events
 * - @EmitEvent: Automatically emit events based on method results
 * - @ScheduleEvent: Schedule events for delayed/cron emission
 * - @BatchEvents: Batch multiple events for processing
 * - @OnModuleEvent: Module-level event handling with filtering
 *
 * Class decorators:
 * - @EventEmitter: Mark class as event emitter with namespace support
 */
export {
  OnEvent,
  OnceEvent,
  OnAnyEvent,
  EmitEvent,
  ScheduleEvent,
  BatchEvents,
  OnModuleEvent,
  EventEmitter,
} from './events.decorators.js';

// ============================================================================
// Tokens (for DI)
// ============================================================================

export {
  EVENT_EMITTER_TOKEN,
  EVENTS_SERVICE_TOKEN,
  EVENT_BUS_SERVICE_TOKEN,
  EVENT_SCHEDULER_SERVICE_TOKEN,
  EVENT_VALIDATION_SERVICE_TOKEN,
  EVENT_HISTORY_SERVICE_TOKEN,
  EVENT_OPTIONS_TOKEN,
} from './tokens.js';

// ============================================================================
// Types & Interfaces
// ============================================================================

// Module options
export type { IEventsModuleOptions } from './events.module.js';

// Core types from types.ts
export type {
  // Event emitter configuration
  IEventEmitterOptions,
  // Listener configuration
  IEventListenerOptions,
  // Event context passed to handlers
  IEventContext,
  // Emit event decorator options
  IEmitEventOptions,
  // Subscription handle
  IEventSubscription,
  // Event bus message format
  IEventBusMessage,
  // Validation result
  IEventValidationResult,
  // Event statistics
  IEventStatistics,
  // Replay options
  IEventReplayOptions,
  // Scheduler job definition
  IEventSchedulerJob,
  // Module lifecycle hooks
  IEventModuleLifecycle,
  // Handler metadata (for advanced use cases)
  IEventHandlerMetadata,
  // Discovery result (for advanced use cases)
  IEventDiscoveryResult,
  // Backpressure handling types
  BackpressureStrategy,
  IMessageQueueConfig,
  IMessageQueueMetrics,
  IQueueAddResult,
} from './types.js';

// Utility types from event.types.ts
export type {
  // Generic event data type
  EventData,
  // Handler function types
  EventHandler,
  VarArgEventHandler,
  // Validation and transformation
  EventValidator,
  EventTransformer,
  EventMiddleware,
  // Schema definition
  EventSchema,
  // Error handling
  EventErrorHandler,
  // Subscription options
  SubscriptionOptions,
} from './event.types.js';

// Validation service types
export type {
  // Schema validator interface for custom validators
  ISchemaValidator,
  // JSON Schema type definition
  JSONSchema,
} from './event-validation.service.js';
