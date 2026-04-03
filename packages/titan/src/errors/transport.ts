/**
 * Transport mapping for errors
 * Maps TitanError to various transport-specific formats
 */

import { TitanError } from './core.js';
import { ErrorCode, getErrorName } from './codes.js';
import { RateLimitError, AuthError } from './http.js';
import { Errors } from './factories.js';

/**
 * Supported transport types
 */
export enum TransportType {
  HTTP = 'http',
  WEBSOCKET = 'websocket',
  GRPC = 'grpc',
  TCP = 'tcp',
  GRAPHQL = 'graphql',
  JSONRPC = 'jsonrpc',
}

/**
 * HTTP error response format
 */
export interface HttpErrorResponse {
  status: number;
  headers: Record<string, string>;
  body: {
    error: {
      code: string;
      message: string;
      details: any;
    };
  };
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
 * gRPC error format
 */
export interface GrpcError {
  code: number;
  message: string;
  details: any;
}

/**
 * GraphQL error format
 */
export interface GraphQLError {
  message: string;
  extensions: {
    code: string;
    statusCode: number;
    details: any;
  };
}

/**
 * JSON-RPC error format
 */
export interface JsonRpcError {
  jsonrpc: '2.0';
  id?: string | number | null;
  error: {
    code: number;
    message: string;
    data?: any;
  };
}

/**
 * Transport mapping options
 */
export interface TransportMappingOptions {
  requestId?: string;
  includeStack?: boolean;
  includeContext?: boolean;
}

/**
 * Map TitanError to HTTP status codes
 */
const httpStatusMap: Record<number, number> = {
  // 2xx Success
  [ErrorCode.OK]: 200,
  [ErrorCode.CREATED]: 201,
  [ErrorCode.ACCEPTED]: 202,
  [ErrorCode.NO_CONTENT]: 204,

  // 4xx Client Errors
  [ErrorCode.BAD_REQUEST]: 400,
  [ErrorCode.UNAUTHORIZED]: 401,
  [ErrorCode.PAYMENT_REQUIRED]: 402,
  [ErrorCode.FORBIDDEN]: 403,
  [ErrorCode.NOT_FOUND]: 404,
  [ErrorCode.METHOD_NOT_ALLOWED]: 405,
  [ErrorCode.NOT_ACCEPTABLE]: 406,
  [ErrorCode.PROXY_AUTHENTICATION_REQUIRED]: 407,
  [ErrorCode.REQUEST_TIMEOUT]: 408,
  [ErrorCode.CONFLICT]: 409,
  [ErrorCode.GONE]: 410,
  [ErrorCode.LENGTH_REQUIRED]: 411,
  [ErrorCode.PRECONDITION_FAILED]: 412,
  [ErrorCode.PAYLOAD_TOO_LARGE]: 413,
  [ErrorCode.URI_TOO_LONG]: 414,
  [ErrorCode.UNSUPPORTED_MEDIA_TYPE]: 415,
  [ErrorCode.RANGE_NOT_SATISFIABLE]: 416,
  [ErrorCode.EXPECTATION_FAILED]: 417,
  [ErrorCode.IM_A_TEAPOT]: 418,
  [ErrorCode.MISDIRECTED_REQUEST]: 421,
  [ErrorCode.UNPROCESSABLE_ENTITY]: 422,
  [ErrorCode.LOCKED]: 423,
  [ErrorCode.FAILED_DEPENDENCY]: 424,
  [ErrorCode.TOO_EARLY]: 425,
  [ErrorCode.UPGRADE_REQUIRED]: 426,
  [ErrorCode.PRECONDITION_REQUIRED]: 428,
  [ErrorCode.TOO_MANY_REQUESTS]: 429,
  [ErrorCode.REQUEST_HEADER_FIELDS_TOO_LARGE]: 431,
  [ErrorCode.UNAVAILABLE_FOR_LEGAL_REASONS]: 451,

  // 5xx Server Errors
  [ErrorCode.INTERNAL_SERVER_ERROR]: 500,
  [ErrorCode.NOT_IMPLEMENTED]: 501,
  [ErrorCode.BAD_GATEWAY]: 502,
  [ErrorCode.SERVICE_UNAVAILABLE]: 503,
  [ErrorCode.GATEWAY_TIMEOUT]: 504,
  [ErrorCode.HTTP_VERSION_NOT_SUPPORTED]: 505,
  [ErrorCode.VARIANT_ALSO_NEGOTIATES]: 506,
  [ErrorCode.INSUFFICIENT_STORAGE]: 507,
  [ErrorCode.LOOP_DETECTED]: 508,
  [ErrorCode.NOT_EXTENDED]: 510,
  [ErrorCode.NETWORK_AUTHENTICATION_REQUIRED]: 511,

  // Custom error codes (600+) - map to 500 Internal Server Error
  [ErrorCode.MULTIPLE_ERRORS]: 500,
  [ErrorCode.UNKNOWN_ERROR]: 500,
};

/**
 * Map TitanError to gRPC status codes
 */
const grpcStatusMap: Record<number, number> = {
  [ErrorCode.BAD_REQUEST]: 3, // INVALID_ARGUMENT
  [ErrorCode.UNAUTHORIZED]: 16, // UNAUTHENTICATED
  [ErrorCode.FORBIDDEN]: 7, // PERMISSION_DENIED
  [ErrorCode.NOT_FOUND]: 5, // NOT_FOUND
  [ErrorCode.CONFLICT]: 6, // ALREADY_EXISTS
  [ErrorCode.REQUEST_TIMEOUT]: 4, // DEADLINE_EXCEEDED
  [ErrorCode.UNPROCESSABLE_ENTITY]: 3, // INVALID_ARGUMENT
  [ErrorCode.TOO_MANY_REQUESTS]: 8, // RESOURCE_EXHAUSTED
  [ErrorCode.INTERNAL_SERVER_ERROR]: 13, // INTERNAL
  [ErrorCode.NOT_IMPLEMENTED]: 12, // UNIMPLEMENTED
  [ErrorCode.SERVICE_UNAVAILABLE]: 14, // UNAVAILABLE
  [ErrorCode.GATEWAY_TIMEOUT]: 4, // DEADLINE_EXCEEDED

  // Custom error codes
  [ErrorCode.MULTIPLE_ERRORS]: 13, // INTERNAL
  [ErrorCode.UNKNOWN_ERROR]: 2, // UNKNOWN
};

/**
 * Map error to transport-specific format
 */
export function mapToTransport(error: TitanError, transport: TransportType, options?: TransportMappingOptions): any {
  switch (transport) {
    case TransportType.HTTP:
      return mapToHttp(error, options);

    case TransportType.WEBSOCKET:
      return mapToWebSocket(error, options);

    case TransportType.GRPC:
      return mapToGrpc(error, options);

    case TransportType.TCP:
      return mapToTcp(error, options);

    case TransportType.GRAPHQL:
      return mapToGraphQL(error, options);

    case TransportType.JSONRPC:
      return mapToJsonRpc(error, options);

    default:
      throw Errors.badRequest(`Unsupported transport: ${transport}`);
  }
}

/**
 * Export mapToHttp for direct use by HTTP transport
 */
export { mapToHttp };

/**
 * Map error name to ErrorCode
 */
const errorNameToCodeMap: Record<string, ErrorCode> = {
  OK: ErrorCode.OK,
  CREATED: ErrorCode.CREATED,
  NO_CONTENT: ErrorCode.NO_CONTENT,
  BAD_REQUEST: ErrorCode.BAD_REQUEST,
  UNAUTHORIZED: ErrorCode.UNAUTHORIZED,
  FORBIDDEN: ErrorCode.FORBIDDEN,
  NOT_FOUND: ErrorCode.NOT_FOUND,
  METHOD_NOT_ALLOWED: ErrorCode.METHOD_NOT_ALLOWED,
  REQUEST_TIMEOUT: ErrorCode.REQUEST_TIMEOUT,
  CONFLICT: ErrorCode.CONFLICT,
  GONE: ErrorCode.GONE,
  PAYLOAD_TOO_LARGE: ErrorCode.PAYLOAD_TOO_LARGE,
  URI_TOO_LONG: ErrorCode.URI_TOO_LONG,
  UNSUPPORTED_MEDIA_TYPE: ErrorCode.UNSUPPORTED_MEDIA_TYPE,
  IM_A_TEAPOT: ErrorCode.IM_A_TEAPOT,
  UNPROCESSABLE_ENTITY: ErrorCode.UNPROCESSABLE_ENTITY,
  VALIDATION_ERROR: ErrorCode.VALIDATION_ERROR,
  TOO_MANY_REQUESTS: ErrorCode.TOO_MANY_REQUESTS,
  INTERNAL_SERVER_ERROR: ErrorCode.INTERNAL_SERVER_ERROR,
  NOT_IMPLEMENTED: ErrorCode.NOT_IMPLEMENTED,
  BAD_GATEWAY: ErrorCode.BAD_GATEWAY,
  SERVICE_UNAVAILABLE: ErrorCode.SERVICE_UNAVAILABLE,
  GATEWAY_TIMEOUT: ErrorCode.GATEWAY_TIMEOUT,
  INSUFFICIENT_STORAGE: ErrorCode.INSUFFICIENT_STORAGE,
  MULTIPLE_ERRORS: ErrorCode.MULTIPLE_ERRORS,
  UNKNOWN_ERROR: ErrorCode.UNKNOWN_ERROR,
};

/**
 * Parse HTTP error response back to TitanError
 * Enables clients to reconstruct typed errors from HTTP responses
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
    code = errorNameToCodeMap[errorCode] || status;
  } else if (typeof errorCode === 'number') {
    code = errorCode;
  }

  // Extract tracing headers
  const requestId = headers?.['x-request-id'] || headers?.['X-Request-ID'];
  const correlationId = headers?.['x-correlation-id'] || headers?.['X-Correlation-ID'];
  const traceId = headers?.['x-trace-id'] || headers?.['X-Trace-ID'];
  const spanId = headers?.['x-span-id'] || headers?.['X-Span-ID'];

  // Special handling for rate limit errors
  if (status === 429 || code === ErrorCode.TOO_MANY_REQUESTS) {
    const retryAfter = headers?.['retry-after'] || headers?.['Retry-After'];
    const limit = headers?.['x-ratelimit-limit'] || headers?.['X-RateLimit-Limit'];
    const remaining = headers?.['x-ratelimit-remaining'] || headers?.['X-RateLimit-Remaining'];
    const reset = headers?.['x-ratelimit-reset'] || headers?.['X-RateLimit-Reset'];

    return new RateLimitError(message, details, {
      retryAfter: retryAfter ? parseInt(retryAfter) : undefined,
      limit: limit ? parseInt(limit) : undefined,
      remaining: remaining ? parseInt(remaining) : undefined,
      resetTime: reset ? new Date(parseInt(reset) * 1000) : undefined,
    });
  }

  // Special handling for auth errors
  if (status === 401 || code === ErrorCode.UNAUTHORIZED) {
    const wwwAuth = headers?.['www-authenticate'] || headers?.['WWW-Authenticate'];
    let authType: string | undefined;
    let realm: string | undefined;

    if (wwwAuth) {
      const match = wwwAuth.match(/^(\w+)(?:\s+realm="([^"]+)")?/);
      if (match) {
        authType = match[1];
        realm = match[2];
      }
    }

    return new AuthError(message, details, { authType, realm });
  }

  // Create standard TitanError with all context
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
 * Map to HTTP response
 */
function mapToHttp(error: TitanError, options?: TransportMappingOptions): HttpErrorResponse {
  const status = httpStatusMap[error.code] || error.httpStatus || 500;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Add context headers if present
  if (error.requestId) {
    headers['X-Request-ID'] = error.requestId;
  }
  if (error.correlationId) {
    headers['X-Correlation-ID'] = error.correlationId;
  }
  if (error.traceId) {
    headers['X-Trace-ID'] = error.traceId;
  }
  if (error.spanId) {
    headers['X-Span-ID'] = error.spanId;
  }

  // Add WWW-Authenticate header for 401 errors
  if (status === 401 && error instanceof AuthError) {
    headers['WWW-Authenticate'] = error.getAuthenticateHeader();
  }

  // Add full rate limit headers for 429 errors
  if (status === 429 && error instanceof RateLimitError) {
    Object.assign(headers, error.getRateLimitHeaders());
  } else if (error.code === ErrorCode.TOO_MANY_REQUESTS && error.details?.retryAfter) {
    // Fallback for generic rate limit errors
    headers['Retry-After'] = String(error.details.retryAfter);
  }

  return {
    status,
    headers,
    body: {
      error: {
        code: getErrorName(error.code),
        message: error.message,
        details: error.details,
        ...(options?.includeContext && { context: error.context }),
        ...(options?.includeStack && { stack: error.stack }),
      },
    },
  };
}

/**
 * Map to WebSocket message
 */
function mapToWebSocket(error: TitanError, options?: TransportMappingOptions): WebSocketErrorMessage {
  const requestId = options?.requestId || error.requestId;
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
 * Map to gRPC error
 */
function mapToGrpc(error: TitanError, options?: TransportMappingOptions): GrpcError {
  const code = grpcStatusMap[error.code] || 13; // Default to INTERNAL

  return {
    code,
    message: error.message,
    details: {
      ...error.details,
      ...(options?.includeContext && { context: error.context }),
    },
  };
}

/**
 * Map to TCP binary format
 * Format: [1 byte: packet type][2 bytes: error code][2 bytes: message length][N bytes: message]
 */
function mapToTcp(error: TitanError, options?: TransportMappingOptions): Buffer {
  const message = error.message;
  const messageBuffer = Buffer.from(message, 'utf-8');
  const messageLength = messageBuffer.length;

  // Create buffer: 1 + 2 + 2 + messageLength
  const buffer = Buffer.allocUnsafe(5 + messageLength);

  // Packet type: 1 = error
  buffer[0] = 1;

  // Error code (16-bit)
  buffer.writeUInt16BE(error.code, 1);

  // Message length (16-bit)
  buffer.writeUInt16BE(messageLength, 3);

  // Message
  messageBuffer.copy(buffer, 5);

  return buffer;
}

/**
 * Map to GraphQL error format
 */
function mapToGraphQL(error: TitanError, options?: TransportMappingOptions): GraphQLError {
  return {
    message: error.message,
    extensions: {
      code: getErrorName(error.code),
      statusCode: error.code,
      details: error.details,
      ...(error.requestId && { requestId: error.requestId }),
      ...(options?.includeContext && { context: error.context }),
    },
  };
}

/**
 * Map to JSON-RPC error format
 */
function mapToJsonRpc(error: TitanError, options?: TransportMappingOptions): JsonRpcError {
  // JSON-RPC error codes:
  // -32700: Parse error
  // -32600: Invalid Request
  // -32601: Method not found
  // -32602: Invalid params
  // -32603: Internal error
  // -32000 to -32099: Server error

  let jsonRpcCode: number;

  switch (error.code) {
    case ErrorCode.BAD_REQUEST:
    case ErrorCode.INVALID_ARGUMENT:
      jsonRpcCode = -32602; // Invalid params
      break;
    case ErrorCode.NOT_FOUND:
      jsonRpcCode = -32601; // Method not found
      break;
    case ErrorCode.VALIDATION_ERROR:
    case ErrorCode.UNPROCESSABLE_ENTITY:
      jsonRpcCode = -32602; // Invalid params
      break;
    case ErrorCode.INTERNAL_SERVER_ERROR:
    case ErrorCode.INTERNAL_ERROR:
      jsonRpcCode = -32603; // Internal error
      break;
    default:
      // Use custom server error range
      jsonRpcCode = -32000 - (error.code % 100);
  }

  return {
    jsonrpc: '2.0',
    ...(options?.requestId && { id: options.requestId }),
    error: {
      code: jsonRpcCode,
      message: error.message,
      data: error.details,
    },
  };
}

/**
 * Transport adapter base class
 */
export abstract class TransportAdapter {
  constructor(protected readonly transport: TransportType) {}

  /**
   * Map error to transport format
   */
  abstract mapError(error: TitanError, options?: TransportMappingOptions): any;

  /**
   * Send error response
   */
  abstract sendError(error: TitanError, context: any): Promise<void>;

  /**
   * Parse error from transport format
   */
  abstract parseError(data: any): TitanError | null;
}

/**
 * HTTP transport adapter
 */
export class HttpTransportAdapter extends TransportAdapter {
  constructor() {
    super(TransportType.HTTP);
  }

  mapError(error: TitanError, options?: TransportMappingOptions): HttpErrorResponse {
    return mapToHttp(error, options);
  }

  async sendError(error: TitanError, response: any): Promise<void> {
    const mapped = this.mapError(error);
    response.status(mapped.status);

    for (const [key, value] of Object.entries(mapped.headers)) {
      response.setHeader(key, value);
    }

    response.json(mapped.body);
  }

  parseError(data: any): TitanError | null {
    if (!data?.error) return null;

    return new TitanError({
      code: data.error.statusCode || ErrorCode.INTERNAL_ERROR,
      message: data.error.message,
      details: data.error.details,
    });
  }
}

/**
 * WebSocket transport adapter
 */
export class WebSocketTransportAdapter extends TransportAdapter {
  constructor() {
    super(TransportType.WEBSOCKET);
  }

  mapError(error: TitanError, options?: TransportMappingOptions): WebSocketErrorMessage {
    return mapToWebSocket(error, options);
  }

  async sendError(error: TitanError, ws: any): Promise<void> {
    const mapped = this.mapError(error);
    ws.send(JSON.stringify(mapped));
  }

  parseError(data: any): TitanError | null {
    if (!data?.error) return null;

    return new TitanError({
      code: data.error.code || ErrorCode.INTERNAL_ERROR,
      message: data.error.message,
      details: data.error.details,
    });
  }
}

/**
 * Create a transport adapter
 */
export function createTransportAdapter(transport: TransportType): TransportAdapter {
  switch (transport) {
    case TransportType.HTTP:
      return new HttpTransportAdapter();

    case TransportType.WEBSOCKET:
      return new WebSocketTransportAdapter();

    // Add more adapters as needed
    default:
      throw Errors.badRequest(`No adapter available for transport: ${transport}`);
  }
}
