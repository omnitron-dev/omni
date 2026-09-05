/**
 * A listener as this emitter accepts one.
 *
 * `Function` stood here, and it is worse than it looks: it accepts anything
 * callable INCLUDING class constructors, and it carries no call signature, so
 * every listener parameter at every call site becomes an implicit `any`. Under
 * `noImplicitAny` that is 21 errors in this package's own tests alone — and the
 * same erasure reaches every consumer, silently, as untyped listener arguments.
 */
export type ListenerLike = (...args: any[]) => any;

/* eslint-disable @typescript-eslint/no-unsafe-function-type */

// Core event types
export type EventListener = {
  fn: ListenerLike;
  context: any;
  once: boolean;
  priority?: number;
  metadata?: EventListenerMetadata;
};

export type EventListenerMetadata = {
  addedAt?: number;
  lastCalled?: number;
  callCount?: number;
  avgDuration?: number;
  errorCount?: number;
};

// Event metadata for enhanced tracking
export interface EventMetadata {
  id?: string;
  timestamp?: number;
  source?: string;
  correlationId?: string;
  userId?: string;
  sessionId?: string;
  tags?: string[];
  priority?: number;
  ttl?: number;
  [key: string]: any;
}

// Emit options for enhanced control
export interface EmitOptions {
  metadata?: Partial<EventMetadata>;
  async?: boolean;
  timeout?: number;
  /** NOT IMPLEMENTED — read by nothing; emission never propagates anywhere. */
  propagate?: boolean;
  validate?: boolean;
}

// Wildcard configuration
export interface WildcardOptions {
  delimiter?: string;
  wildcard?: boolean;
  globstar?: boolean;
  /**
   * NOT IMPLEMENTED — read by nothing. Node's own `setMaxListeners` is what
   * bounds listener counts here; a value set on this options object does not
   * reach it, so the warning threshold stays at the default.
   */
  maxListeners?: number;
}

// Event interceptor interface
export interface EventInterceptor {
  before?(event: string, data: any, metadata: EventMetadata): any | Promise<any>;
  after?(event: string, data: any, metadata: EventMetadata, result?: any): void;
  error?(event: string, error: Error, metadata: EventMetadata): void;
}

// Event history record
export interface EventRecord {
  event: string;
  data: any;
  metadata: EventMetadata;
  timestamp: number;
  result?: any;
  error?: Error;
  duration?: number;
}

// Event history options
export interface EventHistoryOptions {
  maxSize?: number;
  ttl?: number;
  filter?: (event: string) => boolean;
  storage?: EventStorage;
}

// Event storage interface
export interface EventStorage {
  save(record: EventRecord): Promise<void>;
  load(filter?: EventFilter): Promise<EventRecord[]>;
  clear(): Promise<void>;
}

// Event filter for history queries
export interface EventFilter {
  event?: string | RegExp;
  from?: Date;
  to?: Date;
  tags?: string[];
  correlationId?: string;
}

// Schedule options for delayed/recurring events
export interface ScheduleOptions {
  delay?: number;
  at?: Date;
  cron?: string;
  retry?: RetryOptions;
  /**
   * NOT IMPLEMENTED — read by nothing, and nothing in this package persists a
   * schedule: every scheduled emission lives in memory and is lost on restart,
   * whatever this says.
   */
  persistent?: boolean;
}

// Retry configuration
export interface RetryOptions {
  maxAttempts?: number;
  delay?: number;
  backoff?: 'linear' | 'exponential';
  factor?: number;
  maxDelay?: number;
}

// Batch options for event batching
export interface BatchOptions {
  maxSize?: number;
  maxWait?: number;
  throttle?: number;
  debounce?: number;
}

// Performance metrics
export interface EmitterMetrics {
  eventsEmitted: number;
  eventsFailed: number;
  listenerCount: Map<string, number>;
  avgProcessingTime: Map<string, number>;
  slowestEvents: Array<{ event: string; duration: number }>;
  memoryUsage: number;
  eventCounts: Map<string, number>;
  errorCounts: Map<string, number>;
}

// Metrics options
export interface MetricsOptions {
  slowThreshold?: number;
  sampleRate?: number;
  trackMemory?: boolean;
}

/**
 * NOT IMPLEMENTED — this whole family is unreachable.
 *
 * `ErrorHandlingOptions` is referenced in exactly one place: the type of a
 * private `errorHandlers` Map in `EnhancedEventEmitter` that nothing writes to
 * and nothing reads from. `CircuitOptions` is referenced only from the
 * `circuit` field below, so it has no reachable use at all.
 *
 * `errorBoundary` and `onError` are honoured — but through `ListenerOptions`
 * on `onEnhanced()`, not through this type. Reading these declarations, a
 * caller would reasonably expect per-event isolation, a fallback handler and a
 * circuit breaker; none of the three exists anywhere in this package.
 */
export interface ErrorHandlingOptions {
  isolation?: boolean;
  retry?: RetryOptions;
  fallback?: Function;
  circuit?: CircuitOptions;
  errorBoundary?: boolean;
  onError?: (error: Error, data: any, metadata: EventMetadata) => void;
}

/** NOT IMPLEMENTED — see `ErrorHandlingOptions`. No circuit breaker exists here. */
export interface CircuitOptions {
  threshold?: number;
  timeout?: number;
  resetTimeout?: number;
  onOpen?: () => void;
  onClose?: () => void;
  onHalfOpen?: () => void;
}

// Type-safe event map base
export type EventMap = Record<string | symbol, any>;

// Default event map for backward compatibility
export type DefaultEventMap = Record<string | symbol, any[]>;

// Listener function type
export type ListenerFn<T = any> = (data: T, metadata?: EventMetadata) => void | Promise<void>;

// Scheduled event information
export interface ScheduledEvent {
  id: string;
  event: string;
  data: any;
  options: ScheduleOptions;
  scheduledAt: number;
  executeAt: number;
  status: 'pending' | 'executing' | 'completed' | 'failed' | 'cancelled';
}

// Validation schema type
export interface ValidationSchema {
  validate(data: any): ValidationResult;
}

export interface ValidationResult {
  valid: boolean;
  errors?: ValidationError[];
}

export interface ValidationError {
  path: string;
  message: string;
  value?: any;
}

// Pattern cache entry
export interface PatternCache {
  pattern: string;
  regex: RegExp;
  parts: string[];
  isWildcard: boolean;
}

// Listener options
/**
 * Options for `onEnhanced()` / `onTyped()`.
 *
 * PARTIALLY implemented, which is the awkward part: `errorBoundary`, `onError`,
 * `timeout` and `retry` work, and their working vouches for the two that do
 * not. A caller writing `{ timeout: 100, priority: 10 }` gets the timeout and
 * silently loses the ordering.
 */
export interface ListenerOptions {
  /**
   * NOT IMPLEMENTED — read by nothing; listeners fire in REGISTRATION order.
   * Measured: registering priorities 1, 100, 50 in that order calls them
   * 1 → 100 → 50.
   *
   * Honouring it here would mean reordering the base emitter's own listener
   * storage, with `once`, wildcard dispatch and prepend semantics to preserve
   * — a change to delivery order for every consumer, which is a decision
   * rather than a fix.
   *
   * Ordered dispatch DOES exist one layer up: `@omnitron-dev/titan-events`
   * sorts subscriptions by priority (`event-discovery.service.ts`). Use that
   * if the order matters.
   */
  priority?: number;
  errorBoundary?: boolean;
  onError?: (error: Error, data: any, metadata?: EventMetadata) => void;
  timeout?: number;
  retry?: RetryOptions;
  /** NOT IMPLEMENTED — see `CircuitOptions`. No circuit breaker exists here. */
  circuit?: CircuitOptions;
}

/**
 * Canonical event-bus surface — T#72.
 *
 * The Omnitron framework historically had three independent event
 * systems that drifted apart over time:
 *
 *   1. `@omnitron-dev/eventemitter` (`EventEmitter` / `EnhancedEventEmitter`)
 *      — the underlying primitive used by netron, transports, multi-
 *      backend, and the application's own bus.
 *   2. `@omnitron-dev/titan-events` (`EventBusService` / `EventsService`)
 *      — a DI-driven service layer with decorators, validation,
 *      scheduling, history, and message-queue backpressure.
 *   3. `Application._internal/EventBus` (titan) — a thin lifecycle bus
 *      wrapping the primitive, with its own wildcard fan-out and
 *      error-handler chain semantics.
 *
 * `IEventBus` is the smallest interface every event-bus implementation
 * in the framework is expected to honour. By declaring it here we give
 * the three layers a single contract instead of three implicit ones
 * that consumers had to learn by reading each implementation.
 *
 * **What `IEventBus` does NOT promise**: wildcards, history, metrics,
 * priorities, message queues — those are FEATURES individual
 * implementations may surface, not part of the core contract.
 * `EnhancedEventEmitter` is the reference implementation that adds
 * them; `EventBusService` extends with DI + validation + queues.
 *
 * @stable
 * @since 0.1.4
 */
export interface IEventBus {
  /** Register a listener for `event`. Returns `this` for chaining. */
  on(event: string | symbol, listener: (...args: any[]) => void): this;
  /** Register a one-shot listener. Returns `this` for chaining. */
  once(event: string | symbol, listener: (...args: any[]) => void): this;
  /** Remove a specific listener. Returns `this` for chaining. */
  off(event: string | symbol, listener: (...args: any[]) => void): this;
  /** Synchronous emit. Returns `true` if any listener received the event. */
  emit(event: string | symbol, ...args: any[]): boolean;
  /** Read-only view of listeners on `event`. Implementations may return either an array or a single function. */
  listeners(event: string | symbol): ListenerLike[];
  /** Count listeners on `event`. */
  listenerCount(event: string | symbol): number;
  /** Remove every listener for `event` (or every listener everywhere when omitted). */
  removeAllListeners(event?: string | symbol): this;
}

/**
 * Extended event bus — adds async emit semantics on top of `IEventBus`.
 * `EnhancedEventEmitter` and `EventBusService` both satisfy this.
 *
 * @stable
 * @since 0.1.4
 */
export interface IAsyncEventBus extends IEventBus {
  /** Emit and `await` every listener in parallel. */
  emitParallel(event: string | symbol, ...args: any[]): Promise<unknown[]>;
  /** Emit and `await` listeners sequentially. */
  emitSerial(event: string | symbol, ...args: any[]): Promise<unknown[]>;
}
