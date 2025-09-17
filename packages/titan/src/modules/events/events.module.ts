/**
 * Events Module - Core event system for Titan framework
 * 
 * Provides comprehensive event-driven architecture with:
 * - Type-safe event handling
 * - Wildcard and namespaced events
 * - Decorator-based event listeners
 * - Event metadata and context propagation
 * - Async event patterns
 * - Event history and replay
 * - Performance monitoring
 * 
 * @module titan/modules/events
 */

import { EnhancedEventEmitter } from '@omnitron-dev/eventemitter';
import { Token, Module, Global, Container, createToken } from '@omnitron-dev/nexus';

import { EventsService } from './events.service.js';
import { EventBusService } from './event-bus.service.js';
import { EventHistoryService } from './event-history.service.js';
import { EventMetadataService } from './event-metadata.service.js';
import { EventDiscoveryService } from './event-discovery.service.js';
import { EventSchedulerService } from './event-scheduler.service.js';
import { EventValidationService } from './event-validation.service.js';

import type { IEventEmitterOptions } from './types.js';

// Tokens
export const EVENT_EMITTER_TOKEN: Token<EnhancedEventEmitter> = createToken<EnhancedEventEmitter>('EventEmitter');
export const EVENTS_SERVICE_TOKEN: Token<EventsService> = createToken<EventsService>('EventsService');
export const EVENT_METADATA_SERVICE_TOKEN: Token<EventMetadataService> = createToken<EventMetadataService>('EventMetadataService');
export const EVENT_DISCOVERY_SERVICE_TOKEN: Token<EventDiscoveryService> = createToken<EventDiscoveryService>('EventDiscoveryService');
export const EVENT_BUS_SERVICE_TOKEN: Token<EventBusService> = createToken<EventBusService>('EventBusService');
export const EVENT_SCHEDULER_SERVICE_TOKEN: Token<EventSchedulerService> = createToken<EventSchedulerService>('EventSchedulerService');
export const EVENT_VALIDATION_SERVICE_TOKEN: Token<EventValidationService> = createToken<EventValidationService>('EventValidationService');
export const EVENT_HISTORY_SERVICE_TOKEN: Token<EventHistoryService> = createToken<EventHistoryService>('EventHistoryService');
export const EVENT_OPTIONS_TOKEN: Token<IEventEmitterOptions> = createToken<IEventEmitterOptions>('EventEmitterOptions');
export const LOGGER_TOKEN: Token<any> = createToken<any>('Logger');

/**
 * Events module configuration
 */
export interface IEventsModuleOptions {
  /**
   * Enable wildcard event support
   */
  wildcard?: boolean;

  /**
   * Event namespace delimiter
   */
  delimiter?: string;

  /**
   * Maximum listeners per event
   */
  maxListeners?: number;

  /**
   * Enable verbose memory leak warnings
   */
  verboseMemoryLeak?: boolean;

  /**
   * Enable event history
   */
  history?: {
    enabled: boolean;
    maxSize?: number;
    ttl?: number;
  };

  /**
   * Enable metrics collection
   */
  metrics?: {
    enabled: boolean;
    slowThreshold?: number;
    sampleRate?: number;
  };

  /**
   * Global error handler
   */
  onError?: (error: Error, event: string, data: any) => void;

  /**
   * Event validation schemas
   */
  schemas?: Record<string, any>;

  /**
   * Concurrency limit for async events
   */
  concurrency?: number;
}

/**
 * Global Events Module
 * 
 * Provides event-driven capabilities to the entire application
 */
@Global()
@Module({
  providers: [
    // Enhanced Event Emitter
    [EVENT_EMITTER_TOKEN, {
      useFactory: (options: IEventEmitterOptions) => {
        const emitter = new EnhancedEventEmitter({
          wildcard: options.wildcard !== false,
          delimiter: options.delimiter || '.',
          maxListeners: options.maxListeners || 100,
          concurrency: options.concurrency || 10
        });

        // Enable history if configured
        if (options.history?.enabled) {
          emitter.enableHistory({
            maxSize: options.history.maxSize || 1000,
            ttl: options.history.ttl
          });
        }

        // Enable metrics if configured
        if (options.metrics?.enabled) {
          emitter.enableMetrics({
            slowThreshold: options.metrics.slowThreshold || 100,
            sampleRate: options.metrics.sampleRate || 1.0
          });
        }

        // Set global error handler if provided
        if (options.onError) {
          emitter.onError(options.onError);
        }

        // Register validation schemas if provided
        if (options.schemas) {
          Object.entries(options.schemas).forEach(([event, schema]) => {
            emitter.registerSchema(event, schema);
          });
        }

        return emitter;
      },
      inject: [EVENT_OPTIONS_TOKEN],
      scope: 'singleton'
    }] as any,

    // Core Events Service
    [EVENTS_SERVICE_TOKEN, {
      useClass: EventsService,
      inject: [EVENT_EMITTER_TOKEN, EVENT_METADATA_SERVICE_TOKEN],
      scope: 'singleton'
    }] as any,

    // Event Metadata Service
    [EVENT_METADATA_SERVICE_TOKEN, {
      useClass: EventMetadataService,
      scope: 'singleton'
    }] as any,

    // Event Discovery Service
    [EVENT_DISCOVERY_SERVICE_TOKEN, {
      useClass: EventDiscoveryService,
      inject: [Container, EVENT_EMITTER_TOKEN, EVENT_METADATA_SERVICE_TOKEN],
      scope: 'singleton'
    }] as any,

    // Event Bus Service
    [EVENT_BUS_SERVICE_TOKEN, {
      useClass: EventBusService,
      inject: [EVENT_EMITTER_TOKEN],
      scope: 'singleton'
    }] as any,

    // Event Scheduler Service
    [EVENT_SCHEDULER_SERVICE_TOKEN, {
      useClass: EventSchedulerService,
      inject: [EVENT_EMITTER_TOKEN],
      scope: 'singleton'
    }] as any,

    // Event Validation Service
    [EVENT_VALIDATION_SERVICE_TOKEN, {
      useClass: EventValidationService,
      scope: 'singleton'
    }] as any,

    // Event History Service
    [EVENT_HISTORY_SERVICE_TOKEN, {
      useClass: EventHistoryService,
      inject: [EVENT_EMITTER_TOKEN],
      scope: 'singleton'
    }] as any
  ],

  exports: [
    EVENT_EMITTER_TOKEN,
    EVENTS_SERVICE_TOKEN,
    EVENT_METADATA_SERVICE_TOKEN,
    EVENT_DISCOVERY_SERVICE_TOKEN,
    EVENT_BUS_SERVICE_TOKEN,
    EVENT_SCHEDULER_SERVICE_TOKEN,
    EVENT_VALIDATION_SERVICE_TOKEN,
    EVENT_HISTORY_SERVICE_TOKEN
  ]
})
export class EventsModule {
  /**
   * Configure the Events module with options
   */
  static forRoot(options: IEventsModuleOptions = {}): any {
    return {
      module: EventsModule,
      providers: [
        // Provide options
        [EVENT_OPTIONS_TOKEN, {
          useValue: options
        }] as any,

        // Enhanced Event Emitter
        [EVENT_EMITTER_TOKEN, {
          useFactory: (opts: IEventEmitterOptions) => {
            const emitter = new EnhancedEventEmitter({
              wildcard: opts.wildcard !== false,
              delimiter: opts.delimiter || '.',
              maxListeners: opts.maxListeners || 100,
              concurrency: opts.concurrency || 10
            });

            // Enable history if configured
            if (opts.history?.enabled) {
              emitter.enableHistory({
                maxSize: opts.history.maxSize || 1000,
                ttl: opts.history.ttl
              });
            }

            // Enable metrics if configured
            if (opts.metrics?.enabled) {
              emitter.enableMetrics({
                slowThreshold: opts.metrics.slowThreshold || 100,
                sampleRate: opts.metrics.sampleRate || 1.0
              });
            }

            return emitter;
          },
          inject: [EVENT_OPTIONS_TOKEN],
          scope: 'singleton'
        }] as any,

        // Core Events Service
        [EVENTS_SERVICE_TOKEN, {
          useClass: EventsService,
          inject: [EVENT_EMITTER_TOKEN, EVENT_METADATA_SERVICE_TOKEN],
          scope: 'singleton'
        }] as any,

        // Event Metadata Service
        [EVENT_METADATA_SERVICE_TOKEN, {
          useClass: EventMetadataService,
          scope: 'singleton'
        }] as any,

        // Event Discovery Service
        [EVENT_DISCOVERY_SERVICE_TOKEN, {
          useClass: EventDiscoveryService,
          inject: [Container, EVENT_EMITTER_TOKEN, EVENT_METADATA_SERVICE_TOKEN],
          scope: 'singleton'
        }] as any,

        // Event Bus Service
        [EVENT_BUS_SERVICE_TOKEN, {
          useClass: EventBusService,
          inject: [EVENT_EMITTER_TOKEN],
          scope: 'singleton'
        }] as any,

        // Event Scheduler Service
        [EVENT_SCHEDULER_SERVICE_TOKEN, {
          useClass: EventSchedulerService,
          inject: [EVENT_EMITTER_TOKEN],
          scope: 'singleton'
        }] as any,

        // Event Validation Service
        [EVENT_VALIDATION_SERVICE_TOKEN, {
          useClass: EventValidationService,
          scope: 'singleton'
        }] as any,

        // Event History Service
        [EVENT_HISTORY_SERVICE_TOKEN, {
          useClass: EventHistoryService,
          inject: [EVENT_EMITTER_TOKEN],
          scope: 'singleton'
        }] as any
      ],
      exports: [
        EVENT_EMITTER_TOKEN,
        EVENTS_SERVICE_TOKEN,
        EVENT_METADATA_SERVICE_TOKEN,
        EVENT_DISCOVERY_SERVICE_TOKEN,
        EVENT_BUS_SERVICE_TOKEN,
        EVENT_SCHEDULER_SERVICE_TOKEN,
        EVENT_VALIDATION_SERVICE_TOKEN,
        EVENT_HISTORY_SERVICE_TOKEN
      ]
    };
  }

  /**
   * Configure the Events module for a specific feature
   */
  static forFeature(options: {
    events?: string[];
    schemas?: Record<string, any>;
  } = {}): any {
    return {
      module: EventsModule,
      providers: [
        // Feature-specific configuration
        [Symbol('FEATURE_EVENTS'), {
          useValue: options.events || []
        }] as any,
        [Symbol('FEATURE_SCHEMAS'), {
          useValue: options.schemas || {}
        }] as any
      ]
    };
  }

  /**
   * Configure the Events module asynchronously
   */
  static forRootAsync(options: {
    useFactory: (...args: any[]) => Promise<IEventsModuleOptions> | IEventsModuleOptions;
    inject?: any[];
  }): any {
    return {
      module: EventsModule,
      providers: [
        // Provide async options
        [EVENT_OPTIONS_TOKEN, {
          useFactory: options.useFactory,
          inject: options.inject || []
        }] as any,

        // Enhanced Event Emitter with async options
        [EVENT_EMITTER_TOKEN, {
          useFactory: async (opts: IEventsModuleOptions) => {
            const emitter = new EnhancedEventEmitter({
              wildcard: opts.wildcard !== false,
              delimiter: opts.delimiter || '.',
              maxListeners: opts.maxListeners || 100,
              concurrency: opts.concurrency || 10
            });

            // Enable history if configured
            if (opts.history?.enabled) {
              emitter.enableHistory({
                maxSize: opts.history.maxSize || 1000,
                ttl: opts.history.ttl
              });
            }

            // Enable metrics if configured
            if (opts.metrics?.enabled) {
              emitter.enableMetrics({
                slowThreshold: opts.metrics.slowThreshold || 100,
                sampleRate: opts.metrics.sampleRate || 1.0
              });
            }

            return emitter;
          },
          inject: [EVENT_OPTIONS_TOKEN],
          scope: 'singleton'
        }] as any,

        // Core Events Service
        [EVENTS_SERVICE_TOKEN, {
          useClass: EventsService,
          inject: [EVENT_EMITTER_TOKEN, EVENT_METADATA_SERVICE_TOKEN],
          scope: 'singleton'
        }] as any,

        // Metadata Service
        [EVENT_METADATA_SERVICE_TOKEN, {
          useClass: EventMetadataService,
          scope: 'singleton'
        }] as any,

        // Event Bus Service
        [EVENT_BUS_SERVICE_TOKEN, {
          useClass: EventBusService,
          inject: [EVENT_EMITTER_TOKEN, [LOGGER_TOKEN, { optional: true }]],
          scope: 'singleton'
        }] as any,

        // Discovery Service
        [EVENT_DISCOVERY_SERVICE_TOKEN, {
          useClass: EventDiscoveryService,
          inject: [Container, EVENT_EMITTER_TOKEN, EVENT_METADATA_SERVICE_TOKEN, [LOGGER_TOKEN, { optional: true }]],
          scope: 'singleton'
        }] as any,

        // Scheduler Service
        [EVENT_SCHEDULER_SERVICE_TOKEN, {
          useClass: EventSchedulerService,
          inject: [EVENT_EMITTER_TOKEN, [LOGGER_TOKEN, { optional: true }]],
          scope: 'singleton'
        }] as any,

        // Validation Service
        [EVENT_VALIDATION_SERVICE_TOKEN, {
          useClass: EventValidationService,
          scope: 'singleton'
        }] as any,

        // History Service
        [EVENT_HISTORY_SERVICE_TOKEN, {
          useClass: EventHistoryService,
          inject: [EVENT_EMITTER_TOKEN, [LOGGER_TOKEN, { optional: true }]],
          scope: 'singleton'
        }] as any
      ],
      exports: [
        EVENTS_SERVICE_TOKEN,
        EVENT_BUS_SERVICE_TOKEN,
        EVENT_EMITTER_TOKEN,
        EVENT_METADATA_SERVICE_TOKEN,
        EVENT_DISCOVERY_SERVICE_TOKEN,
        EVENT_SCHEDULER_SERVICE_TOKEN,
        EVENT_VALIDATION_SERVICE_TOKEN,
        EVENT_HISTORY_SERVICE_TOKEN
      ]
    };
  }
}

/**
 * Re-export types and interfaces
 */
export * from './types.js';
export * from './events.service.js';
export * from './event-bus.service.js';
export * from './event-history.service.js';
export * from './event-metadata.service.js';
export * from './event-discovery.service.js';
export * from './event-scheduler.service.js';
export * from './event-validation.service.js';