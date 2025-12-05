/**
 * Common type definitions for Process Manager module
 * to ensure type safety and eliminate 'any' usage
 */

// ============================================================================
// Handler Types with Generic Support
// ============================================================================

/**
 * Handler for worker messages with generic message type
 * @template T - Type of the message data
 */
export type MessageHandler<T = unknown> = (message: T) => void | Promise<void>;

/**
 * Generic event handler
 * @template TArgs - Tuple type of event handler arguments
 */
export type EventHandler<TArgs extends unknown[] = unknown[]> = (...args: TArgs) => void | Promise<void>;

/**
 * Process method with typed arguments and return value
 * @template TArgs - Tuple type of method arguments
 * @template TReturn - Return type of the method
 */
export type ProcessMethod<TArgs extends unknown[] = unknown[], TReturn = unknown> = (...args: TArgs) => TReturn;

/**
 * Async process method
 * @template TArgs - Tuple type of method arguments
 * @template TReturn - Resolved type of the promise
 */
export type AsyncProcessMethod<TArgs extends unknown[] = unknown[], TReturn = unknown> = (
  ...args: TArgs
) => Promise<TReturn>;

/**
 * Streaming method returning an async generator
 * @template TYield - Type yielded by the generator
 * @template TReturn - Final return type
 * @template TNext - Type accepted by next()
 */
export type StreamingMethod<TYield = unknown, TReturn = unknown, TNext = unknown> = (
  ...args: unknown[]
) => AsyncGenerator<TYield, TReturn, TNext>;

// ============================================================================
// Worker Message Types
// ============================================================================

/**
 * Known worker message types
 */
export type WorkerMessageType =
  | 'ready'
  | 'error'
  | 'pong'
  | 'shutdown'
  | 'ping'
  | 'call'
  | 'result'
  | 'stream-chunk'
  | 'stream-end';

/**
 * Worker message structure with discriminated union for type safety
 */
export interface WorkerMessageBase {
  type: WorkerMessageType | string;
  id?: string;
}

export interface WorkerCallMessage extends WorkerMessageBase {
  type: 'call';
  method: string;
  args: unknown[];
}

export interface WorkerResultMessage extends WorkerMessageBase {
  type: 'result';
  result: unknown;
}

export interface WorkerErrorMessage extends WorkerMessageBase {
  type: 'error';
  error: {
    message: string;
    stack?: string;
    code?: string;
  };
}

export interface WorkerStreamChunkMessage extends WorkerMessageBase {
  type: 'stream-chunk';
  chunk: unknown;
}

export interface WorkerReadyMessage extends WorkerMessageBase {
  type: 'ready';
  processId: string;
  transportUrl?: string;
  serviceName?: string;
  serviceVersion?: string;
}

/**
 * Union type for all worker messages
 */
export type WorkerMessage =
  | WorkerCallMessage
  | WorkerResultMessage
  | WorkerErrorMessage
  | WorkerStreamChunkMessage
  | WorkerReadyMessage
  | WorkerMessageBase;

/**
 * Legacy WorkerMessage interface for backward compatibility
 * @deprecated Use the discriminated union WorkerMessage type instead
 */
export interface LegacyWorkerMessage {
  type: string;
  id?: string;
  method?: string;
  args?: unknown[];
  result?: unknown;
  error?: unknown;
  chunk?: unknown;
}

// ============================================================================
// Method Descriptor Types
// ============================================================================

/**
 * Method descriptor for service methods
 */
export interface MethodDescriptor<TArgs extends unknown[] = unknown[], TReturn = unknown> {
  name: string;
  handler: ProcessMethod<TArgs, TReturn>;
  isAsync?: boolean;
  isStreaming?: boolean;
}

/**
 * Service method map using generic ProcessMethod
 */
export type ServiceMethodMap = Map<string, ProcessMethod>;

// ============================================================================
// Context Types
// ============================================================================

/**
 * Process context with typed metadata
 * @template TMeta - Type of metadata object
 */
export interface ProcessContext<TMeta extends Record<string, unknown> = Record<string, unknown>> {
  processId: string;
  serviceName: string;
  metadata?: TMeta;
}

// ============================================================================
// Workflow Types
// ============================================================================

/**
 * Workflow handler with typed input and output
 * @template TInput - Input type
 * @template TOutput - Output type
 */
export type WorkflowHandler<TInput = unknown, TOutput = unknown> = (input: TInput) => Promise<TOutput>;

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if value is an async generator
 */
export function isAsyncGenerator(value: unknown): value is AsyncGenerator<unknown, unknown, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as AsyncGenerator).next === 'function' &&
    typeof (value as AsyncGenerator).throw === 'function' &&
    typeof (value as AsyncGenerator).return === 'function'
  );
}

/**
 * Check if value is a Promise
 */
export function isPromise<T = unknown>(value: unknown): value is Promise<T> {
  return value !== null && typeof value === 'object' && typeof (value as Promise<T>).then === 'function';
}

/**
 * Check if value is a WorkerCallMessage
 */
export function isWorkerCallMessage(message: WorkerMessage): message is WorkerCallMessage {
  return message.type === 'call' && 'method' in message && 'args' in message;
}

/**
 * Check if value is a WorkerResultMessage
 */
export function isWorkerResultMessage(message: WorkerMessage): message is WorkerResultMessage {
  return message.type === 'result' && 'result' in message;
}

/**
 * Check if value is a WorkerErrorMessage
 */
export function isWorkerErrorMessage(message: WorkerMessage): message is WorkerErrorMessage {
  return message.type === 'error' && 'error' in message;
}

/**
 * Check if value is a WorkerReadyMessage
 */
export function isWorkerReadyMessage(message: WorkerMessage): message is WorkerReadyMessage {
  return message.type === 'ready' && 'processId' in message;
}
