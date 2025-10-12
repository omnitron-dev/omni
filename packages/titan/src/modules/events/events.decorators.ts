/**
 * Event System Decorators
 *
 * Decorators for event-driven architecture in Titan framework
 */

import { createDecorator, createMethodInterceptor } from '../../decorators/index.js';
import { EVENT_HANDLER_METADATA, EVENT_ONCE_METADATA, EVENT_EMITTER_METADATA } from './event-discovery.service.js';

/**
 * Event handler decorator - listens for events
 *
 * @example
 * ```typescript
 * class UserService {
 *   @OnEvent({ event: 'user.created' })
 *   async handleUserCreated(userData: any) {
 *     console.log('New user:', userData);
 *   }
 * }
 * ```
 */
export const OnEvent = createDecorator<{
  event: string;
  async?: boolean;
  priority?: number;
  timeout?: number;
  filter?: (data: any) => boolean;
  transform?: (data: any) => any;
  errorBoundary?: boolean;
  onError?: (error: Error, data: any) => void;
}>()
  .withName('OnEvent')
  .forMethod()
  .withMetadata((context: any) => {
    // Set metadata that tests expect
    Reflect.defineMetadata('custom:OnEvent', context.options || {}, context.target, context.propertyKey!);
    if (context.options?.event) {
      Reflect.defineMetadata('custom:OnEvent:event', context.options.event, context.target, context.propertyKey!);
    }
    if (context.options?.async !== undefined) {
      Reflect.defineMetadata('custom:OnEvent:async', context.options.async, context.target, context.propertyKey!);
    }
    if (context.options?.priority !== undefined) {
      Reflect.defineMetadata('custom:OnEvent:priority', context.options.priority, context.target, context.propertyKey!);
    }

    return {
      event: context.options?.event,
      handler: true,
      async: context.options?.async,
      priority: context.options?.priority || 0,
      timeout: context.options?.timeout,
      filter: context.options?.filter,
      transform: context.options?.transform,
      errorBoundary: context.options?.errorBoundary,
      onError: context.options?.onError,
    };
  })
  .withHooks({
    afterApply: (context: any) => {
      // Store metadata for discovery
      Reflect.defineMetadata(
        EVENT_HANDLER_METADATA,
        {
          event: context.options?.event,
          options: context.options,
        },
        context.target,
        context.propertyKey!
      );
    },
  })
  .build();

/**
 * One-time event listener decorator
 *
 * @example
 * ```typescript
 * class StartupService {
 *   @OnceEvent({ event: 'app.ready' })
 *   async initialize() {
 *     console.log('App is ready, initializing once...');
 *   }
 * }
 * ```
 */
export const OnceEvent = createDecorator<{
  event: string;
  timeout?: number;
  filter?: (data: any) => boolean;
  transform?: (data: any) => any;
}>()
  .withName('OnceEvent')
  .forMethod()
  .withMetadata((context: any) => ({
    event: context.options?.event,
    once: true,
    timeout: context.options?.timeout,
    filter: context.options?.filter,
    transform: context.options?.transform,
  }))
  .withHooks({
    afterApply: (context: any) => {
      // Store metadata for discovery
      Reflect.defineMetadata(
        EVENT_ONCE_METADATA,
        {
          event: context.options?.event,
          options: context.options,
        },
        context.target,
        context.propertyKey!
      );
    },
  })
  .build();

/**
 * Listen to all events (wildcard listener)
 *
 * @example
 * ```typescript
 * class EventLogger {
 *   @OnAnyEvent({ priority: -1 })
 *   logEvent(event: string, data: any) {
 *     console.log(`Event: ${event}`, data);
 *   }
 * }
 * ```
 */
export const OnAnyEvent = createDecorator<{
  filter?: (event: string, data: any) => boolean;
  priority?: number;
}>()
  .withName('OnAnyEvent')
  .forMethod()
  .withMetadata((context: any) => ({
    event: '*',
    handler: true,
    anyEvent: true,
    filter: context.options?.filter,
    priority: context.options?.priority || 0,
  }))
  .withHooks({
    afterApply: (context: any) => {
      // Store metadata for discovery
      Reflect.defineMetadata(
        EVENT_HANDLER_METADATA,
        {
          event: '*',
          options: context.options,
        },
        context.target,
        context.propertyKey!
      );
    },
  })
  .build();

/**
 * Event emitter decorator - emits events based on method results
 *
 * @example
 * ```typescript
 * class UserService {
 *   @EmitEvent({
 *     event: 'user.created',
 *     mapResult: (user) => ({ id: user.id, name: user.name })
 *   })
 *   async createUser(userData: any) {
 *     // Create user logic
 *     return user;
 *   }
 * }
 * ```
 */
export const EmitEvent = createMethodInterceptor<{
  event: string;
  mapResult?: (result: any) => any;
  mapError?: (error: any) => any;
}>('EmitEvent', async (originalMethod, args, context) => {
  const { event, mapResult, mapError } = context.options!;

  try {
    const result = await originalMethod(...args);

    // Emit success event
    const eventData = mapResult ? mapResult(result) : result;
    // TODO: Actually emit the event with eventData
    // This requires access to an event emitter instance
    void eventData; // Suppress unused variable warning

    // Store metadata for discovery
    Reflect.defineMetadata(EVENT_EMITTER_METADATA, { event: `${event}.success` }, context.target, context.propertyKey!);

    return result;
  } catch (error) {
    // Emit error event
    const errorData = mapError ? mapError(error) : error;
    // TODO: Actually emit the error event with errorData
    // This requires access to an event emitter instance
    void errorData; // Suppress unused variable warning

    // Store metadata for discovery
    Reflect.defineMetadata(EVENT_EMITTER_METADATA, { event: `${event}.error` }, context.target, context.propertyKey!);

    throw error;
  }
});

/**
 * Schedule event emission
 *
 * @example
 * ```typescript
 * class ScheduledTasks {
 *   @ScheduleEvent({
 *     event: 'cleanup.trigger',
 *     cron: '0 0 * * *' // Daily at midnight
 *   })
 *   async triggerCleanup() {
 *     return { timestamp: new Date() };
 *   }
 * }
 * ```
 */
export const ScheduleEvent = createDecorator<{
  event: string;
  cron?: string;
  delay?: number;
  at?: Date;
}>()
  .withName('ScheduleEvent')
  .forMethod()
  .withMetadata((context: any) => ({
    scheduled: true,
    event: context.options?.event,
    cron: context.options?.cron,
    delay: context.options?.delay,
    at: context.options?.at,
  }))
  .withHooks({
    afterApply: (context: any) => {
      // Store metadata for discovery
      Reflect.defineMetadata(
        'metadata',
        {
          scheduled: true,
          event: context.options?.event,
          cron: context.options?.cron,
          delay: context.options?.delay,
          at: context.options?.at,
        },
        context.target,
        context.propertyKey!
      );
    },
  })
  .build();

/**
 * Batch event handling - collect multiple events and process as batch
 *
 * @example
 * ```typescript
 * class MetricsService {
 *   @BatchEvents({
 *     event: 'metrics.data',
 *     maxSize: 100,
 *     maxWait: 5000 // 5 seconds
 *   })
 *   async processBatch(events: any[]) {
 *     console.log(`Processing ${events.length} metrics`);
 *   }
 * }
 * ```
 */
export const BatchEvents = createDecorator<{
  event: string;
  maxSize: number;
  maxWait: number;
}>()
  .withName('BatchEvents')
  .forMethod()
  .withMetadata((context: any) => ({
    batch: true,
    event: context.options?.event,
    maxSize: context.options?.maxSize,
    maxWait: context.options?.maxWait,
  }))
  .withHooks({
    afterApply: (context: any) => {
      // Store metadata for batch processing
      const BATCH_HANDLER_METADATA = Symbol.for('event:batch');
      Reflect.defineMetadata(
        BATCH_HANDLER_METADATA,
        {
          event: `${context.options?.event}:batch`,
          options: context.options,
        },
        context.target,
        context.propertyKey!
      );
    },
  })
  .build();

/**
 * Module event listener decorator
 * For module-level events with filtering
 *
 * @example
 * ```typescript
 * class UserModule {
 *   @OnModuleEvent({
 *     event: 'module.initialized',
 *     filter: (data) => data.module === 'user'
 *   })
 *   onModuleInit(data: any) {
 *     console.log('User module initialized');
 *   }
 * }
 * ```
 */
export const OnModuleEvent = createDecorator<{
  event: string;
  filter?: (data: any) => boolean;
}>()
  .withName('OnModuleEvent')
  .forMethod((context) => {
    const event = context.options?.event;
    const filter = context.options?.filter;
    const handler = context.descriptor!.value;

    // Wrap handler with filter if provided
    if (filter) {
      context.descriptor!.value = function (...args: any[]) {
        if (filter(args[0])) {
          return handler.apply(this, args);
        }
        return undefined;
      };
    }

    // Store event handler metadata
    context.metadata.set('event', event);
    context.metadata.set('handler', true);

    return context.descriptor;
  })
  .build();

/**
 * Event emitter class decorator
 * Marks a class as an event emitter with configuration
 *
 * @example
 * ```typescript
 * @EventEmitter({ namespace: 'user' })
 * class UserEventEmitter {
 *   // All events will be prefixed with 'user.'
 * }
 * ```
 */
export const EventEmitter = createDecorator<{
  namespace?: string;
  wildcard?: boolean;
  delimiter?: string;
}>()
  .withName('EventEmitter')
  .forClass()
  .withMetadata((context: any) => ({
    eventEmitter: true,
    namespace: context.options?.namespace,
    wildcard: context.options?.wildcard !== false,
    delimiter: context.options?.delimiter || '.',
  }))
  .withHooks({
    afterApply: (context: any) => {
      // Store metadata for discovery
      Reflect.defineMetadata(
        'metadata',
        {
          eventEmitter: true,
          namespace: context.options?.namespace,
          wildcard: context.options?.wildcard !== false,
          delimiter: context.options?.delimiter || '.',
        },
        context.target
      );
    },
  })
  .build();
