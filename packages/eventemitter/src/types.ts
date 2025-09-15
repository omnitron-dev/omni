
/* eslint-disable @typescript-eslint/no-unsafe-function-type */

// Core event types
export type EventListener = {
  fn: Function;
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
  propagate?: boolean;
  validate?: boolean;
}

// Wildcard configuration
export interface WildcardOptions {
  delimiter?: string;
  wildcard?: boolean;
  globstar?: boolean;
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

// Error handling options
export interface ErrorHandlingOptions {
  isolation?: boolean;
  retry?: RetryOptions;
  fallback?: Function;
  circuit?: CircuitOptions;
  errorBoundary?: boolean;
  onError?: (error: Error, data: any, metadata: EventMetadata) => void;
}

// Circuit breaker options
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
export interface ListenerOptions {
  priority?: number;
  errorBoundary?: boolean;
  onError?: (error: Error, data: any, metadata?: EventMetadata) => void;
  timeout?: number;
  retry?: RetryOptions;
  circuit?: CircuitOptions;
}