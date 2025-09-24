/**
 * Transport mapping for errors
 * Maps TitanError to various transport-specific formats
 */

import { TitanError } from './core.js';
import { ErrorCode, getErrorName } from './codes.js';

/**
 * Supported transport types
 */
export enum TransportType {
  HTTP = 'http',
  WEBSOCKET = 'websocket',
  GRPC = 'grpc',
  TCP = 'tcp',
  GRAPHQL = 'graphql',
  JSONRPC = 'jsonrpc'
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
  // Direct mappings (most are already HTTP status codes)
  [ErrorCode.BAD_REQUEST]: 400,
  [ErrorCode.UNAUTHORIZED]: 401,
  [ErrorCode.FORBIDDEN]: 403,
  [ErrorCode.NOT_FOUND]: 404,
  [ErrorCode.METHOD_NOT_ALLOWED]: 405,
  [ErrorCode.REQUEST_TIMEOUT]: 408,
  [ErrorCode.CONFLICT]: 409,
  [ErrorCode.GONE]: 410,
  [ErrorCode.PAYLOAD_TOO_LARGE]: 413,
  [ErrorCode.UNPROCESSABLE_ENTITY]: 422,
  [ErrorCode.TOO_MANY_REQUESTS]: 429,
  [ErrorCode.INTERNAL_SERVER_ERROR]: 500,
  [ErrorCode.NOT_IMPLEMENTED]: 501,
  [ErrorCode.BAD_GATEWAY]: 502,
  [ErrorCode.SERVICE_UNAVAILABLE]: 503,
  [ErrorCode.GATEWAY_TIMEOUT]: 504,

  // Custom codes
  [ErrorCode.MULTIPLE_ERRORS]: 600,
  [ErrorCode.UNKNOWN_ERROR]: 601
};

/**
 * Map TitanError to gRPC status codes
 */
const grpcStatusMap: Record<number, number> = {
  [ErrorCode.BAD_REQUEST]: 3,         // INVALID_ARGUMENT
  [ErrorCode.UNAUTHORIZED]: 16,       // UNAUTHENTICATED
  [ErrorCode.FORBIDDEN]: 7,           // PERMISSION_DENIED
  [ErrorCode.NOT_FOUND]: 5,          // NOT_FOUND
  [ErrorCode.CONFLICT]: 6,           // ALREADY_EXISTS
  [ErrorCode.REQUEST_TIMEOUT]: 4,    // DEADLINE_EXCEEDED
  [ErrorCode.UNPROCESSABLE_ENTITY]: 3, // INVALID_ARGUMENT
  [ErrorCode.TOO_MANY_REQUESTS]: 8,  // RESOURCE_EXHAUSTED
  [ErrorCode.INTERNAL_SERVER_ERROR]: 13, // INTERNAL
  [ErrorCode.NOT_IMPLEMENTED]: 12,   // UNIMPLEMENTED
  [ErrorCode.SERVICE_UNAVAILABLE]: 14, // UNAVAILABLE
  [ErrorCode.GATEWAY_TIMEOUT]: 4,    // DEADLINE_EXCEEDED

  // Custom error codes
  [ErrorCode.MULTIPLE_ERRORS]: 13,    // INTERNAL
  [ErrorCode.UNKNOWN_ERROR]: 2        // UNKNOWN
};

/**
 * Map error to transport-specific format
 */
export function mapToTransport(
  error: TitanError,
  transport: TransportType,
  options?: TransportMappingOptions
): any {
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
      throw new Error(`Unsupported transport: ${transport}`);
  }
}

/**
 * Map to HTTP response
 */
function mapToHttp(error: TitanError, options?: TransportMappingOptions): HttpErrorResponse {
  const status = httpStatusMap[error.code] || error.httpStatus || 500;

  return {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...(error.requestId && { 'X-Request-Id': error.requestId }),
      ...(error.correlationId && { 'X-Correlation-Id': error.correlationId })
    },
    body: {
      error: {
        code: getErrorName(error.code),
        message: error.message,
        details: error.details,
        ...(options?.includeContext && { context: error.context }),
        ...(options?.includeStack && { stack: error.stack })
      }
    }
  };
}

/**
 * Map to WebSocket message
 */
function mapToWebSocket(error: TitanError, options?: TransportMappingOptions): WebSocketErrorMessage {
  return {
    type: 'error',
    ...(options?.requestId && { id: options.requestId }),
    error: {
      code: error.code,
      name: getErrorName(error.code),
      message: error.message,
      details: error.details
    }
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
      ...(options?.includeContext && { context: error.context })
    }
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
      ...(options?.includeContext && { context: error.context })
    }
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
      data: error.details
    }
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
      details: data.error.details
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
      details: data.error.details
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
      throw new Error(`No adapter available for transport: ${transport}`);
  }
}