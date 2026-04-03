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
import { Container } from '@omnitron-dev/titan/nexus';
import { Module, Global, Inject } from '@omnitron-dev/titan/decorators';

import { EventsService } from './events.service.js';
import { EventBusService } from './event-bus.service.js';
import { EventHistoryService } from './event-history.service.js';
import { EventMetadataService } from './event-metadata.service.js';
import { EventDiscoveryService } from './event-discovery.service.js';
import { EventSchedulerService } from './event-scheduler.service.js';
import { EventValidationService } from './event-validation.service.js';

import type { IEventEmitterOptions } from './types.js';
import type { InjectionToken } from '@omnitron-dev/titan/nexus';

// Import tokens from centralized location
import {
  EVENT_EMITTER_TOKEN,
  EVENTS_SERVICE_TOKEN,
  EVENT_METADATA_SERVICE_TOKEN,
  EVENT_DISCOVERY_SERVICE_TOKEN,
  EVENT_BUS_SERVICE_TOKEN,
  EVENT_SCHEDULER_SERVICE_TOKEN,
  EVENT_VALIDATION_SERVICE_TOKEN,
  EVENT_HISTORY_SERVICE_TOKEN,
  EVENT_OPTIONS_TOKEN,
  LOGGER_TOKEN,
} from './tokens.js';

/**
 * Type for provider tuples used in module metadata
 * Format: [token, definition]
 *
 * Note: We use a readonly tuple with loose typing to work around TypeScript's
 * strict literal type inference with satisfies. The container accepts both
 * Scope enum values and string literals for backward compatibility.
 */
type ProviderTuple = readonly [InjectionToken<any>, any];

// Re-export tokens for convenience
export {
  EVENT_EMITTER_TOKEN,
  EVENTS_SERVICE_TOKEN,
  EVENT_METADATA_SERVICE_TOKEN,
  EVENT_DISCOVERY_SERVICE_TOKEN,
  EVENT_BUS_SERVICE_TOKEN,
  EVENT_SCHEDULER_SERVICE_TOKEN,
  EVENT_VALIDATION_SERVICE_TOKEN,
  EVENT_HISTORY_SERVICE_TOKEN,
  EVENT_OPTIONS_TOKEN,
  LOGGER_TOKEN,
} from './tokens.js';

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

  /**
   * Register as global module (default: true).
   * When true, all modules share the same EventsService instance.
   */
  isGlobal?: boolean;
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
    [
      EVENT_EMITTER_TOKEN,
      {
        useFactory: (options: IEventEmitterOptions) => {
          const emitter = new EnhancedEventEmitter({
            wildcard: options.wildcard !== false,
            delimiter: options.delimiter || '.',
            maxListeners: options.maxListeners || 100,
            concurrency: options.concurrency || 10,
          });

          // Enable history if configured
          if (options.history?.enabled) {
            emitter.enableHistory({
              maxSize: options.history.maxSize || 1000,
              ttl: options.history.ttl,
            });
          }

          // Enable metrics if configured
          if (options.metrics?.enabled) {
            emitter.enableMetrics({
              slowThreshold: options.metrics.slowThreshold || 100,
              sampleRate: options.metrics.sampleRate || 1.0,
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
        scope: 'singleton',
      },
    ] as ProviderTuple,

    // Core Events Service
    [
      EVENTS_SERVICE_TOKEN,
      {
        useClass: EventsService,
        inject: [EVENT_EMITTER_TOKEN, EVENT_METADATA_SERVICE_TOKEN],
        scope: 'singleton',
      },
    ] as ProviderTuple,

    // Event Metadata Service
    [
      EVENT_METADATA_SERVICE_TOKEN,
      {
        useClass: EventMetadataService,
        scope: 'singleton',
      },
    ] as ProviderTuple,

    // Event Discovery Service
    [
      EVENT_DISCOVERY_SERVICE_TOKEN,
      {
        useClass: EventDiscoveryService,
        inject: [Container, EVENT_EMITTER_TOKEN, EVENT_METADATA_SERVICE_TOKEN],
        scope: 'singleton',
      },
    ] as ProviderTuple,

    // Event Bus Service
    [
      EVENT_BUS_SERVICE_TOKEN,
      {
        useClass: EventBusService,
        inject: [EVENT_EMITTER_TOKEN],
        scope: 'singleton',
      },
    ] as ProviderTuple,

    // Event Scheduler Service
    [
      EVENT_SCHEDULER_SERVICE_TOKEN,
      {
        useClass: EventSchedulerService,
        inject: [EVENT_EMITTER_TOKEN],
        scope: 'singleton',
      },
    ] as ProviderTuple,

    // Event Validation Service
    [
      EVENT_VALIDATION_SERVICE_TOKEN,
      {
        useClass: EventValidationService,
        scope: 'singleton',
      },
    ] as ProviderTuple,

    // Event History Service
    [
      EVENT_HISTORY_SERVICE_TOKEN,
      {
        useClass: EventHistoryService,
        inject: [EVENT_EMITTER_TOKEN],
        scope: 'singleton',
      },
    ] as ProviderTuple,
  ],

  exports: [
    EVENT_EMITTER_TOKEN,
    EVENTS_SERVICE_TOKEN,
    EVENT_METADATA_SERVICE_TOKEN,
    EVENT_DISCOVERY_SERVICE_TOKEN,
    EVENT_BUS_SERVICE_TOKEN,
    EVENT_SCHEDULER_SERVICE_TOKEN,
    EVENT_VALIDATION_SERVICE_TOKEN,
    EVENT_HISTORY_SERVICE_TOKEN,
  ],
})
export class EventsModule {
  constructor(
    @Inject(EVENT_SCHEDULER_SERVICE_TOKEN) private readonly scheduler?: EventSchedulerService,
    @Inject(EVENT_EMITTER_TOKEN) private readonly emitter?: EnhancedEventEmitter
  ) {}

  /**
   * Clean up resources when module is destroyed
   */
  async onModuleDestroy(): Promise<void> {
    // Clean up scheduler timers and intervals
    if (this.scheduler) {
      await this.scheduler.onDestroy();
    }

    // Remove all event listeners
    if (this.emitter) {
      this.emitter.removeAllListeners();
    }
  }

  /**
   * Configure the Events module with options
   */
  static forRoot(options: IEventsModuleOptions = {}): any {
    return {
      module: EventsModule,
      global: options.isGlobal ?? true, // Events should be global by default — single emitter instance
      providers: [
        // Provide options
        [
          EVENT_OPTIONS_TOKEN,
          {
            useValue: options,
          },
        ] as ProviderTuple,

        // Enhanced Event Emitter
        [
          EVENT_EMITTER_TOKEN,
          {
            useFactory: (opts: IEventEmitterOptions) => {
              const emitter = new EnhancedEventEmitter({
                wildcard: opts.wildcard !== false,
                delimiter: opts.delimiter || '.',
                maxListeners: opts.maxListeners || 100,
                concurrency: opts.concurrency || 10,
              });

              // Enable history if configured
              if (opts.history?.enabled) {
                emitter.enableHistory({
                  maxSize: opts.history.maxSize || 1000,
                  ttl: opts.history.ttl,
                });
              }

              // Enable metrics if configured
              if (opts.metrics?.enabled) {
                emitter.enableMetrics({
                  slowThreshold: opts.metrics.slowThreshold || 100,
                  sampleRate: opts.metrics.sampleRate || 1.0,
                });
              }

              return emitter;
            },
            inject: [EVENT_OPTIONS_TOKEN],
            scope: 'singleton',
          },
        ] as ProviderTuple,

        // Core Events Service
        [
          EVENTS_SERVICE_TOKEN,
          {
            useClass: EventsService,
            inject: [EVENT_EMITTER_TOKEN, EVENT_METADATA_SERVICE_TOKEN],
            scope: 'singleton',
          },
        ] as ProviderTuple,

        // Event Metadata Service
        [
          EVENT_METADATA_SERVICE_TOKEN,
          {
            useClass: EventMetadataService,
            scope: 'singleton',
          },
        ] as ProviderTuple,

        // Event Discovery Service
        [
          EVENT_DISCOVERY_SERVICE_TOKEN,
          {
            useClass: EventDiscoveryService,
            inject: [Container, EVENT_EMITTER_TOKEN, EVENT_METADATA_SERVICE_TOKEN],
            scope: 'singleton',
          },
        ] as ProviderTuple,

        // Event Bus Service
        [
          EVENT_BUS_SERVICE_TOKEN,
          {
            useClass: EventBusService,
            inject: [EVENT_EMITTER_TOKEN],
            scope: 'singleton',
          },
        ] as ProviderTuple,

        // Event Scheduler Service
        [
          EVENT_SCHEDULER_SERVICE_TOKEN,
          {
            useClass: EventSchedulerService,
            inject: [EVENT_EMITTER_TOKEN],
            scope: 'singleton',
          },
        ] as ProviderTuple,

        // Event Validation Service
        [
          EVENT_VALIDATION_SERVICE_TOKEN,
          {
            useClass: EventValidationService,
            scope: 'singleton',
          },
        ] as ProviderTuple,

        // Event History Service
        [
          EVENT_HISTORY_SERVICE_TOKEN,
          {
            useClass: EventHistoryService,
            inject: [EVENT_EMITTER_TOKEN],
            scope: 'singleton',
          },
        ] as ProviderTuple,
      ],
      exports: [
        EVENT_EMITTER_TOKEN,
        EVENTS_SERVICE_TOKEN,
        EVENT_METADATA_SERVICE_TOKEN,
        EVENT_DISCOVERY_SERVICE_TOKEN,
        EVENT_BUS_SERVICE_TOKEN,
        EVENT_SCHEDULER_SERVICE_TOKEN,
        EVENT_VALIDATION_SERVICE_TOKEN,
        EVENT_HISTORY_SERVICE_TOKEN,
      ],
    };
  }

  /**
   * Configure the Events module for a specific feature
   */
  static forFeature(
    options: {
      events?: string[];
      schemas?: Record<string, any>;
    } = {}
  ): any {
    const FEATURE_EVENTS_TOKEN = Symbol('FEATURE_EVENTS');
    const FEATURE_SCHEMAS_TOKEN = Symbol('FEATURE_SCHEMAS');

    return {
      module: EventsModule,
      providers: [
        // Feature-specific configuration
        [
          FEATURE_EVENTS_TOKEN,
          {
            useValue: options.events || [],
          },
        ] as ProviderTuple,
        [
          FEATURE_SCHEMAS_TOKEN,
          {
            useValue: options.schemas || {},
          },
        ] as ProviderTuple,
      ],
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
        [
          EVENT_OPTIONS_TOKEN,
          {
            useFactory: options.useFactory,
            inject: options.inject || [],
          },
        ] as ProviderTuple,

        // Enhanced Event Emitter with async options
        [
          EVENT_EMITTER_TOKEN,
          {
            useFactory: async (opts: IEventsModuleOptions) => {
              const emitter = new EnhancedEventEmitter({
                wildcard: opts.wildcard !== false,
                delimiter: opts.delimiter || '.',
                maxListeners: opts.maxListeners || 100,
                concurrency: opts.concurrency || 10,
              });

              // Enable history if configured
              if (opts.history?.enabled) {
                emitter.enableHistory({
                  maxSize: opts.history.maxSize || 1000,
                  ttl: opts.history.ttl,
                });
              }

              // Enable metrics if configured
              if (opts.metrics?.enabled) {
                emitter.enableMetrics({
                  slowThreshold: opts.metrics.slowThreshold || 100,
                  sampleRate: opts.metrics.sampleRate || 1.0,
                });
              }

              return emitter;
            },
            inject: [EVENT_OPTIONS_TOKEN],
            scope: 'singleton',
          },
        ] as ProviderTuple,

        // Core Events Service
        [
          EVENTS_SERVICE_TOKEN,
          {
            useClass: EventsService,
            inject: [EVENT_EMITTER_TOKEN, EVENT_METADATA_SERVICE_TOKEN],
            scope: 'singleton',
          },
        ] as ProviderTuple,

        // Metadata Service
        [
          EVENT_METADATA_SERVICE_TOKEN,
          {
            useClass: EventMetadataService,
            scope: 'singleton',
          },
        ] as ProviderTuple,

        // Event Bus Service
        [
          EVENT_BUS_SERVICE_TOKEN,
          {
            useClass: EventBusService,
            inject: [EVENT_EMITTER_TOKEN, [LOGGER_TOKEN, { optional: true }]],
            scope: 'singleton',
          },
        ] as ProviderTuple,

        // Discovery Service
        [
          EVENT_DISCOVERY_SERVICE_TOKEN,
          {
            useClass: EventDiscoveryService,
            inject: [Container, EVENT_EMITTER_TOKEN, EVENT_METADATA_SERVICE_TOKEN, [LOGGER_TOKEN, { optional: true }]],
            scope: 'singleton',
          },
        ] as ProviderTuple,

        // Scheduler Service
        [
          EVENT_SCHEDULER_SERVICE_TOKEN,
          {
            useClass: EventSchedulerService,
            inject: [EVENT_EMITTER_TOKEN, [LOGGER_TOKEN, { optional: true }]],
            scope: 'singleton',
          },
        ] as ProviderTuple,

        // Validation Service
        [
          EVENT_VALIDATION_SERVICE_TOKEN,
          {
            useClass: EventValidationService,
            scope: 'singleton',
          },
        ] as ProviderTuple,

        // History Service
        [
          EVENT_HISTORY_SERVICE_TOKEN,
          {
            useClass: EventHistoryService,
            inject: [EVENT_EMITTER_TOKEN, [LOGGER_TOKEN, { optional: true }]],
            scope: 'singleton',
          },
        ] as ProviderTuple,
      ],
      exports: [
        EVENTS_SERVICE_TOKEN,
        EVENT_BUS_SERVICE_TOKEN,
        EVENT_EMITTER_TOKEN,
        EVENT_METADATA_SERVICE_TOKEN,
        EVENT_DISCOVERY_SERVICE_TOKEN,
        EVENT_SCHEDULER_SERVICE_TOKEN,
        EVENT_VALIDATION_SERVICE_TOKEN,
        EVENT_HISTORY_SERVICE_TOKEN,
      ],
    };
  }
}

// Note: All public exports are managed by the index.ts barrel file.
// This module file only exports the EventsModule class and its configuration interface.
