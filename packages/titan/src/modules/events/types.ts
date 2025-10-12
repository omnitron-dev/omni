/**
 * Type definitions for the Events module
 */

import type { EventMetadata } from '@omnitron-dev/eventemitter';

/**
 * Event emitter configuration options
 */
export interface IEventEmitterOptions {
  wildcard?: boolean;
  delimiter?: string;
  maxListeners?: number;
  verboseMemoryLeak?: boolean;
  concurrency?: number;
  history?: {
    enabled: boolean;
    maxSize?: number;
    ttl?: number;
  };
  metrics?: {
    enabled: boolean;
    slowThreshold?: number;
    sampleRate?: number;
  };
  onError?: (error: Error, event: string, data: any) => void;
  schemas?: Record<string, any>;
}

/**
 * Event listener options for decorators
 */
export interface IEventListenerOptions {
  /**
   * Listen for events asynchronously
   */
  async?: boolean;

  /**
   * Priority for event handling (higher = earlier)
   */
  priority?: number;

  /**
   * Timeout for async handlers (ms)
   */
  timeout?: number;

  /**
   * Error handling strategy
   */
  errorHandling?: 'throw' | 'log' | 'ignore' | 'retry';

  /**
   * Retry configuration
   */
  retry?: {
    attempts: number;
    delay: number;
    backoff?: number;
  };

  /**
   * Filter function to conditionally handle events
   */
  filter?: (data: any, metadata?: EventMetadata) => boolean;

  /**
   * Transform event data before handling
   */
  transform?: (data: any) => any;

  /**
   * Enable error boundary
   */
  errorBoundary?: boolean;

  /**
   * Custom error handler
   */
  onError?: (error: Error, data: any, metadata?: EventMetadata) => void;

  /**
   * Throttle event handling
   */
  throttle?: number;

  /**
   * Debounce event handling
   */
  debounce?: number;
}

/**
 * Event handler metadata
 */
export interface IEventHandlerMetadata {
  /**
   * Event pattern to listen for
   */
  event: string;

  /**
   * Handler method name
   */
  method: string;

  /**
   * Target class
   */
  target: any;

  /**
   * Handler options
   */
  options?: IEventListenerOptions;

  /**
   * Whether this is a one-time handler
   */
  once?: boolean;

  /**
   * Handler priority
   */
  priority?: number;
}

/**
 * Event context passed to handlers
 */
export interface IEventContext<T = any> {
  /**
   * Event name
   */
  event: string;

  /**
   * Event data
   */
  data: T;

  /**
   * Event metadata
   */
  metadata: EventMetadata;

  /**
   * Correlation ID for tracing
   */
  correlationId?: string;

  /**
   * User context
   */
  userId?: string;

  /**
   * Session context
   */
  sessionId?: string;

  /**
   * Additional context
   */
  [key: string]: any;
}

/**
 * Event emitter decorator options
 */
export interface IEmitEventOptions {
  /**
   * Event to emit
   */
  event: string;

  /**
   * Map method result to event data
   */
  mapResult?: (result: any) => any;

  /**
   * Map method error to event data
   */
  mapError?: (error: any) => any;

  /**
   * Emit event before method execution
   */
  before?: boolean;

  /**
   * Emit event after method execution
   */
  after?: boolean;

  /**
   * Include method arguments in event data
   */
  includeArgs?: boolean;

  /**
   * Include method result in event data
   */
  includeResult?: boolean;

  /**
   * Custom metadata
   */
  metadata?: Partial<EventMetadata>;
}

/**
 * Event subscription handle
 */
export interface IEventSubscription {
  /**
   * Unsubscribe from the event
   */
  unsubscribe(): void;

  /**
   * Check if subscription is active
   */
  isActive(): boolean;

  /**
   * Event pattern
   */
  event: string;

  /**
   * Handler reference
   */
  handler: (...args: any[]) => any;

  /**
   * Wrapped handler reference (internal)
   */
  wrappedHandler?: (...args: any[]) => any;
}

/**
 * Event bus message
 */
export interface IEventBusMessage<T = any> {
  /**
   * Unique message ID
   */
  id: string;

  /**
   * Event name
   */
  event: string;

  /**
   * Event data
   */
  data: T;

  /**
   * Message metadata
   */
  metadata: EventMetadata;

  /**
   * Message timestamp
   */
  timestamp: number;

  /**
   * Source service/module
   */
  source?: string;

  /**
   * Target service/module
   */
  target?: string;
}

/**
 * Event validation result
 */
export interface IEventValidationResult {
  /**
   * Whether validation passed
   */
  valid: boolean;

  /**
   * Validation errors
   */
  errors?: string[];

  /**
   * Transformed data (if transformation was applied)
   */
  data?: any;
}

/**
 * Event statistics
 */
export interface IEventStatistics {
  /**
   * Event name
   */
  event: string;

  /**
   * Total emissions
   */
  emitCount: number;

  /**
   * Total listeners
   */
  listenerCount: number;

  /**
   * Average processing time (ms)
   */
  avgProcessingTime: number;

  /**
   * Max processing time (ms)
   */
  maxProcessingTime: number;

  /**
   * Min processing time (ms)
   */
  minProcessingTime: number;

  /**
   * Error count
   */
  errorCount: number;

  /**
   * Last emission timestamp
   */
  lastEmitted?: number;

  /**
   * Last error timestamp
   */
  lastError?: number;
}

/**
 * Event replay options
 */
export interface IEventReplayOptions {
  /**
   * Filter events to replay
   */
  filter?: {
    event?: string | string[];
    from?: Date;
    to?: Date;
    metadata?: Partial<EventMetadata>;
  };

  /**
   * Replay speed multiplier
   */
  speed?: number;

  /**
   * Transform events before replay
   */
  transform?: (event: any) => any;

  /**
   * Skip failed events
   */
  skipErrors?: boolean;

  /**
   * Dry run (don't actually emit)
   */
  dryRun?: boolean;
}

/**
 * Event discovery result
 */
export interface IEventDiscoveryResult {
  /**
   * Discovered event handlers
   */
  handlers: IEventHandlerMetadata[];

  /**
   * Discovered event emitters
   */
  emitters: Array<{
    class: string;
    method: string;
    event: string;
  }>;

  /**
   * Event dependencies graph
   */
  dependencies: Map<string, string[]>;

  /**
   * Statistics
   */
  stats: {
    totalHandlers: number;
    totalEmitters: number;
    totalEvents: number;
    wildcardHandlers: number;
  };
}

/**
 * Event scheduler job
 */
export interface IEventSchedulerJob {
  /**
   * Job ID
   */
  id: string;

  /**
   * Event to emit
   */
  event: string;

  /**
   * Event data
   */
  data: any;

  /**
   * Scheduled time
   */
  scheduledAt: Date;

  /**
   * Cron expression (for recurring)
   */
  cron?: string;

  /**
   * Job status
   */
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

  /**
   * Retry configuration
   */
  retry?: {
    attempts: number;
    currentAttempt: number;
    delay: number;
    lastError?: Error;
  };
}

/**
 * Event module lifecycle
 */
export interface IEventModuleLifecycle {
  /**
   * Called when module is initialized
   */
  onModuleInit?(): Promise<void> | void;

  /**
   * Called when application is ready
   */
  onApplicationReady?(): Promise<void> | void;

  /**
   * Called before module is destroyed
   */
  onModuleDestroy?(): Promise<void> | void;

  /**
   * Called on application shutdown
   */
  onApplicationShutdown?(signal?: string): Promise<void> | void;
}
