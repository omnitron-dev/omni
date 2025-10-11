/**
 * Error serialization and deserialization for network transmission
 * Compatible with Titan's error protocol
 */

import { TitanError, SerializedError } from './core.js';
import { ErrorCode, getErrorName } from './codes.js';
import {
  NetronError,
  ServiceNotFoundError,
  MethodNotFoundError,
  TransportError,
  PeerError,
  RpcError,
  StreamError,
  SerializationError,
} from './netron.js';

/**
 * Error factory function type for deserialization
 */
type ErrorFactory = (options: {
  code: number;
  message: string;
  details?: any;
  context?: any;
  requestId?: string;
  correlationId?: string;
  spanId?: string;
  traceId?: string;
}) => TitanError;

/**
 * Error name to factory mapping for deserialization
 */
const errorFactories: Record<string, ErrorFactory> = {
  TitanError: (options) => new TitanError(options),
  NetronError: (options) => new NetronError(options),
  ServiceNotFoundError: (options) => new ServiceNotFoundError(options.details?.serviceId || 'unknown', options.details),
  MethodNotFoundError: (options) =>
    new MethodNotFoundError(
      options.details?.serviceId || 'unknown',
      options.details?.methodName || 'unknown',
      options.details
    ),
  TransportError: (options) => new TransportError(options),
  PeerError: (options) => new PeerError({ ...options, peerId: options.details?.peerId || 'unknown' }),
  RpcError: (options) => new RpcError(options),
  StreamError: (options) => new StreamError({ ...options, streamId: options.details?.streamId }),
  SerializationError: (options) => new SerializationError(options),
};

/**
 * Serialize error for network transmission
 */
export function serializeError(error: TitanError, includeStack = false): SerializedError {
  const serialized = error.toJSON();

  // Optionally include stack trace (useful for debugging)
  if (includeStack && error.stack) {
    serialized.stack = error.stack;
  }

  return serialized;
}

/**
 * Deserialize error from network data
 */
export function deserializeError(data: any): TitanError {
  // Handle null/undefined
  if (!data) {
    return new TitanError({
      code: ErrorCode.UNKNOWN_ERROR,
      message: 'Unknown error occurred',
    });
  }

  // If it's already a TitanError, return it
  if (data instanceof TitanError) {
    return data;
  }

  // Extract error properties
  const errorData: SerializedError = {
    name: data.name || 'TitanError',
    code: data.code || ErrorCode.INTERNAL_ERROR,
    category: data.category,
    message: data.message || 'An error occurred',
    details: data.details || {},
    context: data.context || {},
    timestamp: data.timestamp || Date.now(),
    requestId: data.requestId,
    correlationId: data.correlationId,
    spanId: data.spanId,
    traceId: data.traceId,
    stack: data.stack,
  };

  // Use specific factory if available, otherwise use default TitanError
  const factory = errorFactories[errorData.name] || ((options) => new TitanError(options));

  // Create error instance
  const error = factory({
    code: errorData.code,
    message: errorData.message,
    details: errorData.details,
    context: errorData.context,
    requestId: errorData.requestId,
    correlationId: errorData.correlationId,
    spanId: errorData.spanId,
    traceId: errorData.traceId,
  });

  // Restore stack if present
  if (errorData.stack) {
    error.stack = errorData.stack;
  }

  return error;
}

/**
 * Parse HTTP error response to TitanError
 */
export function parseHttpError(status: number, body: any, headers?: Record<string, string>): TitanError {
  // Extract error information from body
  const errorData = body?.error || body;
  const errorCode = errorData.code;
  const message = errorData.message || `HTTP ${status}`;
  const details = errorData.details || {};

  // Map error name to code if it's a string
  let code: ErrorCode | number = status;
  if (typeof errorCode === 'string') {
    // Try to find matching error code by name
    const codeValue = ErrorCode[errorCode as keyof typeof ErrorCode];
    if (codeValue !== undefined) {
      code = codeValue;
    }
  } else if (typeof errorCode === 'number') {
    code = errorCode;
  }

  // Extract tracing headers
  const requestId = headers?.['x-request-id'] || headers?.['X-Request-ID'];
  const correlationId = headers?.['x-correlation-id'] || headers?.['X-Correlation-ID'];
  const traceId = headers?.['x-trace-id'] || headers?.['X-Trace-ID'];
  const spanId = headers?.['x-span-id'] || headers?.['X-Span-ID'];

  // Create TitanError with all context
  return new TitanError({
    code,
    message,
    details,
    requestId,
    correlationId,
    traceId,
    spanId,
  });
}

/**
 * WebSocket error message format
 */
export interface WebSocketErrorMessage {
  type: 'error';
  id?: string;
  error: {
    code: number;
    name: string;
    message: string;
    details: any;
  };
}

/**
 * Serialize error for WebSocket transmission
 */
export function serializeWebSocketError(error: TitanError, requestId?: string): WebSocketErrorMessage {
  return {
    type: 'error',
    ...(requestId && { id: requestId }),
    error: {
      code: error.code,
      name: getErrorName(error.code),
      message: error.message,
      details: error.details,
    },
  };
}

/**
 * Parse WebSocket error message to TitanError
 */
export function parseWebSocketError(message: WebSocketErrorMessage): TitanError {
  if (!message?.error) {
    return new TitanError({
      code: ErrorCode.INTERNAL_ERROR,
      message: 'Invalid WebSocket error message',
    });
  }

  return new TitanError({
    code: message.error.code || ErrorCode.INTERNAL_ERROR,
    message: message.error.message,
    details: message.error.details,
  });
}

/**
 * Convert any error to TitanError
 */
export function toTitanError(error: unknown): TitanError {
  if (error instanceof TitanError) {
    return error;
  }

  if (error instanceof Error) {
    return new TitanError({
      code: ErrorCode.INTERNAL_ERROR,
      message: error.message,
      cause: error,
    });
  }

  return new TitanError({
    code: ErrorCode.UNKNOWN_ERROR,
    message: String(error),
  });
}

/**
 * Check if a value is a serialized error
 */
export function isSerializedError(value: any): value is SerializedError {
  return (
    value &&
    typeof value === 'object' &&
    typeof value.code === 'number' &&
    typeof value.message === 'string' &&
    typeof value.category === 'string'
  );
}

/**
 * Safely serialize any error (handles circular references)
 */
export function safeSerializeError(error: any): SerializedError {
  try {
    if (error instanceof TitanError) {
      return serializeError(error);
    }

    if (error instanceof Error) {
      return {
        name: error.name,
        code: ErrorCode.INTERNAL_ERROR,
        category: 'server',
        message: error.message,
        details: {},
        context: {},
        timestamp: Date.now(),
        stack: error.stack,
      };
    }

    return {
      name: 'Error',
      code: ErrorCode.UNKNOWN_ERROR,
      category: 'custom',
      message: String(error),
      details: {},
      context: {},
      timestamp: Date.now(),
    };
  } catch (err) {
    // Fallback for any serialization errors
    return {
      name: 'Error',
      code: ErrorCode.INTERNAL_ERROR,
      category: 'server',
      message: 'Error serialization failed',
      details: {},
      context: {},
      timestamp: Date.now(),
    };
  }
}
