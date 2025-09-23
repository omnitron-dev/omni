/**
 * Common type definitions for the event system
 */

/**
 * Generic event data type
 */
export type EventData = Record<string, unknown>;

/**
 * Event handler function type
 */
export type EventHandler<T = EventData> = (
  data: T,
  metadata?: EventMetadata
) => void | Promise<void>;

/**
 * Event handler with variable arguments
 */
export type VarArgEventHandler = (...args: unknown[]) => void | Promise<void>;

/**
 * Event metadata
 */
export interface EventMetadata {
  timestamp?: number;
  source?: string;
  correlationId?: string;
  userId?: string;
  priority?: number;
  [key: string]: unknown;
}

/**
 * Event subscription
 */
export interface IEventSubscription {
  unsubscribe(): void;
  isActive(): boolean;
}

/**
 * Event validator function
 */
export type EventValidator<T = EventData> = (data: T) => boolean | string | Promise<boolean | string>;

/**
 * Event transformer function
 */
export type EventTransformer<TIn = EventData, TOut = EventData> = (data: TIn) => TOut | Promise<TOut>;

/**
 * Event middleware function
 */
export type EventMiddleware<T = EventData> = (
  data: T,
  next: (data: T) => void | Promise<void>
) => void | Promise<void>;

/**
 * Event schema definition
 */
export interface EventSchema<T = EventData> {
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
  validate?: EventValidator<T>;
  transform?: EventTransformer<T, T>;
  [key: string]: unknown;
}

/**
 * Event error handler
 */
export type EventErrorHandler = (
  error: Error,
  event: string,
  data: EventData
) => void | Promise<void>;

/**
 * Event emission options
 */
export interface EmitOptions {
  parallel?: boolean;
  sequential?: boolean;
  sync?: boolean;
  timeout?: number;
  metadata?: Partial<EventMetadata>;
}

/**
 * Event subscription options
 */
export interface SubscriptionOptions {
  priority?: number;
  replay?: boolean;
  filter?: (data: EventData) => boolean;
  transform?: EventTransformer;
  timeout?: number;
  errorBoundary?: boolean;
  onError?: EventErrorHandler;
}

/**
 * Event statistics
 */
export interface EventStatistics {
  event: string;
  emitCount: number;
  handlerCount: number;
  lastEmitAt?: number;
  errorCount: number;
}

/**
 * Health check result
 */
export interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  details?: Record<string, unknown>;
}