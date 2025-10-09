/**
 * Netron-specific error classes
 */

import { TitanError, ErrorOptions } from './core.js';
import { ErrorCode } from './codes.js';

/**
 * Base Netron error class
 */
export class NetronError extends TitanError {
  public readonly serviceId?: string;
  public readonly methodName?: string;
  public readonly peerId?: string;

  constructor(
    options: ErrorOptions & {
      serviceId?: string;
      methodName?: string;
      peerId?: string;
    }
  ) {
    super(options);
    this.name = 'NetronError';
    this.serviceId = options.serviceId;
    this.methodName = options.methodName;
    this.peerId = options.peerId;
  }

  override toJSON(): any {
    return {
      ...super.toJSON(),
      serviceId: this.serviceId,
      methodName: this.methodName,
      peerId: this.peerId
    };
  }
}

/**
 * Service not found error
 */
export class ServiceNotFoundError extends NetronError {
  constructor(serviceId: string, details?: any) {
    super({
      code: ErrorCode.NOT_FOUND,
      message: `Service not found: ${serviceId}`,
      details,
      serviceId
    });
    this.name = 'ServiceNotFoundError';
  }

  static create(serviceId: string): ServiceNotFoundError {
    return new ServiceNotFoundError(serviceId);
  }
}

/**
 * Method not found error
 */
export class MethodNotFoundError extends NetronError {
  constructor(serviceId: string, methodName: string, details?: any) {
    super({
      code: ErrorCode.NOT_FOUND,
      message: `Method not found: ${serviceId}.${methodName}`,
      details,
      serviceId,
      methodName
    });
    this.name = 'MethodNotFoundError';
  }

  static create(serviceId: string, methodName: string): MethodNotFoundError {
    return new MethodNotFoundError(serviceId, methodName);
  }
}

/**
 * Transport error
 */
export class TransportError extends NetronError {
  public readonly transport?: string;
  public readonly address?: string;

  constructor(
    options: ErrorOptions & {
      transport?: string;
      address?: string;
    }
  ) {
    super(options);
    this.name = 'TransportError';
    this.transport = options.transport;
    this.address = options.address;
  }

  /**
   * Connection failed error
   */
  static connectionFailed(transport: string, address: string, cause?: Error): TransportError {
    return new TransportError({
      code: ErrorCode.SERVICE_UNAVAILABLE,
      message: `Failed to connect to ${address} via ${transport}`,
      transport,
      address,
      cause
    });
  }

  /**
   * Connection timeout error
   */
  static connectionTimeout(transport: string, address: string): TransportError {
    return new TransportError({
      code: ErrorCode.REQUEST_TIMEOUT,
      message: `Connection timeout to ${address} via ${transport}`,
      transport,
      address
    });
  }

  /**
   * Connection closed error
   */
  static connectionClosed(transport: string, reason?: string): TransportError {
    return new TransportError({
      code: ErrorCode.SERVICE_UNAVAILABLE,
      message: reason || `Connection closed unexpectedly`,
      transport,
      details: { reason }
    });
  }

  override toJSON(): any {
    return {
      ...super.toJSON(),
      transport: this.transport,
      address: this.address
    };
  }
}

/**
 * Peer error
 */
export class PeerError extends NetronError {
  constructor(
    options: ErrorOptions & {
      peerId: string;
    }
  ) {
    super(options);
    this.name = 'PeerError';
  }

  /**
   * Peer not found error
   */
  static notFound(peerId: string): PeerError {
    return new PeerError({
      code: ErrorCode.NOT_FOUND,
      message: `Peer not found: ${peerId}`,
      peerId
    });
  }

  /**
   * Peer disconnected error
   */
  static disconnected(peerId: string, reason?: string): PeerError {
    return new PeerError({
      code: ErrorCode.SERVICE_UNAVAILABLE,
      message: `Peer disconnected: ${peerId}${reason ? ` (${reason})` : ''}`,
      peerId,
      details: { reason }
    });
  }

  /**
   * Peer unauthorized error
   */
  static unauthorized(peerId: string): PeerError {
    return new PeerError({
      code: ErrorCode.UNAUTHORIZED,
      message: `Peer not authorized: ${peerId}`,
      peerId
    });
  }
}

/**
 * RPC error
 */
export class RpcError extends NetronError {
  public readonly rpcId?: number;

  constructor(
    options: ErrorOptions & {
      rpcId?: number;
      serviceId?: string;
      methodName?: string;
    }
  ) {
    super(options);
    this.name = 'RpcError';
    this.rpcId = options.rpcId;
  }

  /**
   * Request timeout error
   */
  static timeout(serviceId: string, methodName: string, timeoutMs: number): RpcError {
    return new RpcError({
      code: ErrorCode.REQUEST_TIMEOUT,
      message: `RPC call ${serviceId}.${methodName} timed out after ${timeoutMs}ms`,
      serviceId,
      methodName,
      details: { timeout: timeoutMs }
    });
  }

  /**
   * Invalid request error
   */
  static invalidRequest(reason: string, details?: any): RpcError {
    return new RpcError({
      code: ErrorCode.BAD_REQUEST,
      message: `Invalid RPC request: ${reason}`,
      details
    });
  }

  /**
   * Invalid response error
   */
  static invalidResponse(serviceId: string, methodName: string, details?: any): RpcError {
    return new RpcError({
      code: ErrorCode.INTERNAL_ERROR,
      message: `Invalid RPC response from ${serviceId}.${methodName}`,
      serviceId,
      methodName,
      details
    });
  }

  override toJSON(): any {
    return {
      ...super.toJSON(),
      rpcId: this.rpcId
    };
  }
}

/**
 * Stream error
 */
export class StreamError extends NetronError {
  public readonly streamId?: string;

  constructor(
    options: ErrorOptions & {
      streamId?: string;
    }
  ) {
    super(options);
    this.name = 'StreamError';
    this.streamId = options.streamId;
  }

  /**
   * Stream closed error
   */
  static closed(streamId: string, reason?: string): StreamError {
    return new StreamError({
      code: ErrorCode.GONE,
      message: `Stream closed: ${streamId}${reason ? ` (${reason})` : ''}`,
      streamId,
      details: { reason }
    });
  }

  /**
   * Stream error
   */
  static error(streamId: string, error: Error): StreamError {
    return new StreamError({
      code: ErrorCode.INTERNAL_ERROR,
      message: `Stream error: ${error.message}`,
      streamId,
      cause: error
    });
  }

  /**
   * Backpressure error
   */
  static backpressure(streamId: string, bufferSize: number): StreamError {
    return new StreamError({
      code: ErrorCode.TOO_MANY_REQUESTS,
      message: `Stream backpressure: buffer size ${bufferSize}`,
      streamId,
      details: { bufferSize }
    });
  }

  override toJSON(): any {
    return {
      ...super.toJSON(),
      streamId: this.streamId
    };
  }
}

/**
 * Serialization error
 */
export class SerializationError extends NetronError {
  public readonly serializationType?: 'encode' | 'decode';

  constructor(
    options: ErrorOptions & {
      serializationType?: 'encode' | 'decode';
    }
  ) {
    super(options);
    this.name = 'SerializationError';
    this.serializationType = options.serializationType;
  }

  /**
   * Encode error
   */
  static encode(value: any, cause?: Error): SerializationError {
    return new SerializationError({
      code: ErrorCode.INTERNAL_ERROR,
      message: `Failed to encode value: ${typeof value}`,
      serializationType: 'encode',
      cause
    });
  }

  /**
   * Decode error
   */
  static decode(data: any, cause?: Error): SerializationError {
    return new SerializationError({
      code: ErrorCode.BAD_REQUEST,
      message: `Failed to decode data`,
      serializationType: 'decode',
      cause
    });
  }

  override toJSON(): any {
    return {
      ...super.toJSON(),
      serializationType: this.serializationType
    };
  }
}

/**
 * Contract error (re-export for convenience)
 */
export { ContractError } from './contract.js';
