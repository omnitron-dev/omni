/**
 * Comprehensive tests for Netron-specific error classes
 */

import { describe, it, expect } from '@jest/globals';
import {
  NetronError,
  ServiceNotFoundError,
  MethodNotFoundError,
  TransportError,
  PeerError,
  RpcError,
  StreamError,
  SerializationError,
} from '../../src/errors/netron.js';
import { ErrorCode } from '../../src/errors/codes.js';

describe('Netron Errors', () => {
  describe('NetronError', () => {
    it('should create with service context', () => {
      const error = new NetronError({
        code: ErrorCode.NOT_FOUND,
        message: 'Service not found',
        serviceId: 'calculator@1.0.0',
        methodName: 'add',
        peerId: 'peer-123',
      });

      expect(error.code).toBe(ErrorCode.NOT_FOUND);
      expect(error.serviceId).toBe('calculator@1.0.0');
      expect(error.methodName).toBe('add');
      expect(error.peerId).toBe('peer-123');
    });

    it('should serialize with Netron-specific fields', () => {
      const error = new NetronError({
        code: ErrorCode.BAD_REQUEST,
        message: 'Invalid RPC',
        serviceId: 'test@1.0.0',
        methodName: 'test',
      });

      const json = error.toJSON();

      expect(json.serviceId).toBe('test@1.0.0');
      expect(json.methodName).toBe('test');
    });
  });

  describe('ServiceNotFoundError', () => {
    it('should create service not found error', () => {
      const error = new ServiceNotFoundError('auth@1.0.0');

      expect(error.code).toBe(ErrorCode.NOT_FOUND);
      expect(error.message).toBe('Service not found: auth@1.0.0');
      expect(error.serviceId).toBe('auth@1.0.0');
    });

    it('should create with static factory', () => {
      const error = ServiceNotFoundError.create('users@2.0.0');

      expect(error).toBeInstanceOf(ServiceNotFoundError);
      expect(error.serviceId).toBe('users@2.0.0');
    });

    it('should include details', () => {
      const error = new ServiceNotFoundError('test@1.0.0', { reason: 'not registered' });

      expect(error.details).toEqual({ reason: 'not registered' });
    });
  });

  describe('MethodNotFoundError', () => {
    it('should create method not found error', () => {
      const error = new MethodNotFoundError('calculator@1.0.0', 'divide');

      expect(error.code).toBe(ErrorCode.NOT_FOUND);
      expect(error.message).toBe('Method not found: calculator@1.0.0.divide');
      expect(error.serviceId).toBe('calculator@1.0.0');
      expect(error.methodName).toBe('divide');
    });

    it('should create with static factory', () => {
      const error = MethodNotFoundError.create('auth@1.0.0', 'logout');

      expect(error).toBeInstanceOf(MethodNotFoundError);
      expect(error.serviceId).toBe('auth@1.0.0');
      expect(error.methodName).toBe('logout');
    });
  });

  describe('TransportError', () => {
    it('should create transport error', () => {
      const error = new TransportError({
        code: ErrorCode.SERVICE_UNAVAILABLE,
        message: 'Connection failed',
        transport: 'websocket',
        address: 'ws://localhost:3000',
      });

      expect(error.transport).toBe('websocket');
      expect(error.address).toBe('ws://localhost:3000');
    });

    it('should create connectionFailed error', () => {
      const cause = new Error('ECONNREFUSED');
      const error = TransportError.connectionFailed('tcp', '127.0.0.1:8080', cause);

      expect(error.code).toBe(ErrorCode.SERVICE_UNAVAILABLE);
      expect(error.message).toContain('Failed to connect');
      expect(error.transport).toBe('tcp');
      expect(error.address).toBe('127.0.0.1:8080');
      expect((error as any).cause).toBe(cause);
    });

    it('should create connectionTimeout error', () => {
      const error = TransportError.connectionTimeout('http', 'http://api.example.com');

      expect(error.code).toBe(ErrorCode.REQUEST_TIMEOUT);
      expect(error.message).toContain('Connection timeout');
      expect(error.transport).toBe('http');
      expect(error.address).toBe('http://api.example.com');
    });

    it('should create connectionClosed error', () => {
      const error = TransportError.connectionClosed('websocket', 'Server shutdown');

      expect(error.code).toBe(ErrorCode.SERVICE_UNAVAILABLE);
      expect(error.message).toBe('Server shutdown');
      expect(error.transport).toBe('websocket');
      expect(error.details.reason).toBe('Server shutdown');
    });

    it('should create connectionClosed without reason', () => {
      const error = TransportError.connectionClosed('tcp');

      expect(error.message).toBe('Connection closed unexpectedly');
      expect(error.transport).toBe('tcp');
    });

    it('should serialize with transport fields', () => {
      const error = new TransportError({
        code: ErrorCode.BAD_GATEWAY,
        message: 'Gateway error',
        transport: 'http',
        address: 'http://gateway.local',
      });

      const json = error.toJSON();

      expect(json.transport).toBe('http');
      expect(json.address).toBe('http://gateway.local');
    });
  });

  describe('PeerError', () => {
    it('should create peer error', () => {
      const error = new PeerError({
        code: ErrorCode.NOT_FOUND,
        message: 'Peer not found',
        peerId: 'peer-abc',
      });

      expect(error.peerId).toBe('peer-abc');
    });

    it('should create notFound error', () => {
      const error = PeerError.notFound('peer-xyz');

      expect(error.code).toBe(ErrorCode.NOT_FOUND);
      expect(error.message).toBe('Peer not found: peer-xyz');
      expect(error.peerId).toBe('peer-xyz');
    });

    it('should create disconnected error', () => {
      const error = PeerError.disconnected('peer-123');

      expect(error.code).toBe(ErrorCode.SERVICE_UNAVAILABLE);
      expect(error.message).toBe('Peer disconnected: peer-123');
      expect(error.peerId).toBe('peer-123');
    });

    it('should create disconnected error with reason', () => {
      const error = PeerError.disconnected('peer-456', 'Network timeout');

      expect(error.message).toBe('Peer disconnected: peer-456 (Network timeout)');
      expect(error.details.reason).toBe('Network timeout');
    });

    it('should create unauthorized error', () => {
      const error = PeerError.unauthorized('peer-789');

      expect(error.code).toBe(ErrorCode.UNAUTHORIZED);
      expect(error.message).toBe('Peer not authorized: peer-789');
      expect(error.peerId).toBe('peer-789');
    });
  });

  describe('RpcError', () => {
    it('should create RPC error', () => {
      const error = new RpcError({
        code: ErrorCode.BAD_REQUEST,
        message: 'Invalid RPC call',
        rpcId: 12345,
        serviceId: 'test@1.0.0',
        methodName: 'test',
      });

      expect(error.rpcId).toBe(12345);
      expect(error.serviceId).toBe('test@1.0.0');
      expect(error.methodName).toBe('test');
    });

    it('should create timeout error', () => {
      const error = RpcError.timeout('calculator@1.0.0', 'add', 5000);

      expect(error.code).toBe(ErrorCode.REQUEST_TIMEOUT);
      expect(error.message).toContain('timed out after 5000ms');
      expect(error.serviceId).toBe('calculator@1.0.0');
      expect(error.methodName).toBe('add');
      expect(error.details.timeout).toBe(5000);
    });

    it('should create invalidRequest error', () => {
      const error = RpcError.invalidRequest('Missing required field', { field: 'id' });

      expect(error.code).toBe(ErrorCode.BAD_REQUEST);
      expect(error.message).toBe('Invalid RPC request: Missing required field');
      expect(error.details).toEqual({ field: 'id' });
    });

    it('should create invalidResponse error', () => {
      const error = RpcError.invalidResponse('auth@1.0.0', 'login', { reason: 'malformed' });

      expect(error.code).toBe(ErrorCode.INTERNAL_ERROR);
      expect(error.message).toBe('Invalid RPC response from auth@1.0.0.login');
      expect(error.serviceId).toBe('auth@1.0.0');
      expect(error.methodName).toBe('login');
      expect(error.details).toEqual({ reason: 'malformed' });
    });

    it('should serialize with RPC fields', () => {
      const error = new RpcError({
        code: ErrorCode.NOT_FOUND,
        message: 'RPC error',
        rpcId: 999,
      });

      const json = error.toJSON();

      expect(json.rpcId).toBe(999);
    });
  });

  describe('StreamError', () => {
    it('should create stream error', () => {
      const error = new StreamError({
        code: ErrorCode.GONE,
        message: 'Stream closed',
        streamId: 'stream-123',
      });

      expect(error.streamId).toBe('stream-123');
    });

    it('should create closed error', () => {
      const error = StreamError.closed('stream-abc');

      expect(error.code).toBe(ErrorCode.GONE);
      expect(error.message).toBe('Stream closed: stream-abc');
      expect(error.streamId).toBe('stream-abc');
    });

    it('should create closed error with reason', () => {
      const error = StreamError.closed('stream-xyz', 'Client disconnect');

      expect(error.message).toBe('Stream closed: stream-xyz (Client disconnect)');
      expect(error.details.reason).toBe('Client disconnect');
    });

    it('should create stream error from Error', () => {
      const cause = new Error('Stream write failed');
      const error = StreamError.error('stream-456', cause);

      expect(error.code).toBe(ErrorCode.INTERNAL_ERROR);
      expect(error.message).toBe('Stream error: Stream write failed');
      expect(error.streamId).toBe('stream-456');
      expect((error as any).cause).toBe(cause);
    });

    it('should create backpressure error', () => {
      const error = StreamError.backpressure('stream-789', 10000);

      expect(error.code).toBe(ErrorCode.TOO_MANY_REQUESTS);
      expect(error.message).toContain('buffer size 10000');
      expect(error.streamId).toBe('stream-789');
      expect(error.details.bufferSize).toBe(10000);
    });

    it('should serialize with stream fields', () => {
      const error = new StreamError({
        code: ErrorCode.GONE,
        message: 'Stream error',
        streamId: 'test-stream',
      });

      const json = error.toJSON();

      expect(json.streamId).toBe('test-stream');
    });
  });

  describe('SerializationError', () => {
    it('should create serialization error', () => {
      const error = new SerializationError({
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Serialization failed',
        serializationType: 'encode',
      });

      expect(error.serializationType).toBe('encode');
    });

    it('should create encode error', () => {
      const value = { circular: null as any };
      value.circular = value;
      const cause = new Error('Converting circular structure to JSON');

      const error = SerializationError.encode(value, cause);

      expect(error.code).toBe(ErrorCode.INTERNAL_ERROR);
      expect(error.message).toContain('Failed to encode value');
      expect(error.serializationType).toBe('encode');
      expect((error as any).cause).toBe(cause);
    });

    it('should create decode error', () => {
      const invalidData = Buffer.from('invalid');
      const cause = new Error('Unexpected token');

      const error = SerializationError.decode(invalidData, cause);

      expect(error.code).toBe(ErrorCode.BAD_REQUEST);
      expect(error.message).toBe('Failed to decode data');
      expect(error.serializationType).toBe('decode');
      expect((error as any).cause).toBe(cause);
    });

    it('should handle encode without cause', () => {
      const error = SerializationError.encode({ test: 'data' });

      expect(error.serializationType).toBe('encode');
      expect((error as any).cause).toBeUndefined();
    });

    it('should handle decode without cause', () => {
      const error = SerializationError.decode('invalid');

      expect(error.serializationType).toBe('decode');
      expect((error as any).cause).toBeUndefined();
    });

    it('should serialize with serialization fields', () => {
      const error = new SerializationError({
        code: ErrorCode.BAD_REQUEST,
        message: 'Decode error',
        serializationType: 'decode',
      });

      const json = error.toJSON();

      expect(json.serializationType).toBe('decode');
    });
  });
});
