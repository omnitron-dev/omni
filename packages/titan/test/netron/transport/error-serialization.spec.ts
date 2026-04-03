/**
 * TitanError Serialization Tests Across All Transports
 *
 * Comprehensive tests to verify TitanError serialization and deserialization
 * works correctly for WebSocket, TCP, and Unix socket transports.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TitanError, ErrorCode } from '../../../src/errors/index.js';
import { encodePacket, decodePacket, Packet } from '../../../src/netron/packet/index.js';
import { WebSocketTransport } from '../../../src/netron/transport/websocket/index.js';
import { TcpTransport } from '../../../src/netron/transport/tcp-transport.js';
import { UnixSocketTransport, NamedPipeTransport } from '../../../src/netron/transport/unix-transport.js';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promises as fs } from 'node:fs';
import { getFreePort, getFreeHttpPort, waitForEvent } from '../../utils/index.js';

// Helper to generate unique socket path
function getSocketPath(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);

  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\test-error-${timestamp}-${random}`;
  } else {
    return join(tmpdir(), `test-error-${timestamp}-${random}.sock`);
  }
}

// Helper to clean up socket files
async function cleanupSocketFile(path: string): Promise<void> {
  if (process.platform !== 'win32') {
    try {
      await fs.unlink(path);
    } catch (_error) {
      // Ignore error if file doesn't exist
    }
  }
}

describe('TitanError Serialization Across Transports', () => {
  describe('Packet Encoding/Decoding', () => {
    it('should serialize and deserialize simple TitanError', () => {
      const error = new TitanError({
        code: ErrorCode.BAD_REQUEST,
        message: 'Invalid input',
        details: { field: 'email', value: 'invalid@' },
      });

      const packet = new Packet(1);
      packet.setError(1);
      packet.data = error;

      const encoded = encodePacket(packet);
      const decoded = decodePacket(encoded);

      expect(decoded.data).toBeInstanceOf(TitanError);
      expect(decoded.data.code).toBe(ErrorCode.BAD_REQUEST);
      expect(decoded.data.message).toBe('Invalid input');
      expect(decoded.data.details).toEqual({ field: 'email', value: 'invalid@' });
    });

    it('should preserve all TitanError properties', () => {
      const error = new TitanError({
        code: ErrorCode.UNAUTHORIZED,
        message: 'Authentication required',
        details: { reason: 'Token expired' },
        context: { userId: 'user-123', action: 'view-profile' },
        requestId: 'req-456',
        correlationId: 'corr-789',
        traceId: 'trace-abc',
        spanId: 'span-def',
      });

      const packet = new Packet(2);
      packet.setError(1);
      packet.data = error;

      const encoded = encodePacket(packet);
      const decoded = decodePacket(encoded);

      expect(decoded.data).toBeInstanceOf(TitanError);
      expect(decoded.data.code).toBe(ErrorCode.UNAUTHORIZED);
      expect(decoded.data.message).toBe('Authentication required');
      expect(decoded.data.details).toEqual({ reason: 'Token expired' });
      expect(decoded.data.context).toEqual({ userId: 'user-123', action: 'view-profile' });
      expect(decoded.data.requestId).toBe('req-456');
      expect(decoded.data.correlationId).toBe('corr-789');
      expect(decoded.data.traceId).toBe('trace-abc');
      expect(decoded.data.spanId).toBe('span-def');
    });

    it('should serialize TitanError with cause chain (TitanError)', () => {
      const rootCause = new TitanError({
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Database connection failed',
      });

      const error = new TitanError({
        code: ErrorCode.SERVICE_UNAVAILABLE,
        message: 'Service temporarily unavailable',
        cause: rootCause,
      });

      const packet = new Packet(3);
      packet.setError(1);
      packet.data = error;

      const encoded = encodePacket(packet);
      const decoded = decodePacket(encoded);

      expect(decoded.data).toBeInstanceOf(TitanError);
      expect(decoded.data.message).toBe('Service temporarily unavailable');
      expect(decoded.data.cause).toBeInstanceOf(TitanError);
      expect(decoded.data.cause.message).toBe('Database connection failed');
      expect(decoded.data.cause.code).toBe(ErrorCode.INTERNAL_ERROR);
    });

    it('should serialize TitanError with plain Error cause', () => {
      const rootCause = new Error('Network timeout');
      rootCause.name = 'NetworkError';

      const error = new TitanError({
        code: ErrorCode.GATEWAY_TIMEOUT,
        message: 'Request timed out',
        cause: rootCause,
      });

      const packet = new Packet(4);
      packet.setError(1);
      packet.data = error;

      const encoded = encodePacket(packet);
      const decoded = decodePacket(encoded);

      expect(decoded.data).toBeInstanceOf(TitanError);
      expect(decoded.data.message).toBe('Request timed out');
      expect(decoded.data.cause).toBeInstanceOf(Error);
      expect(decoded.data.cause.message).toBe('Network timeout');
      expect(decoded.data.cause.name).toBe('NetworkError');
    });

    it('should serialize TitanError with deep cause chain', () => {
      const level3 = new Error('Level 3 error');
      const level2 = new TitanError({
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Level 2 error',
        cause: level3,
      });
      const level1 = new TitanError({
        code: ErrorCode.SERVICE_UNAVAILABLE,
        message: 'Level 1 error',
        cause: level2,
      });

      const packet = new Packet(5);
      packet.setError(1);
      packet.data = level1;

      const encoded = encodePacket(packet);
      const decoded = decodePacket(encoded);

      expect(decoded.data).toBeInstanceOf(TitanError);
      expect(decoded.data.message).toBe('Level 1 error');
      expect(decoded.data.cause).toBeInstanceOf(TitanError);
      expect(decoded.data.cause.message).toBe('Level 2 error');
      expect(decoded.data.cause.cause).toBeInstanceOf(Error);
      expect(decoded.data.cause.cause.message).toBe('Level 3 error');
    });

    it('should preserve stack traces', () => {
      const error = new TitanError({
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Test error with stack',
      });

      const packet = new Packet(6);
      packet.setError(1);
      packet.data = error;

      const encoded = encodePacket(packet);
      const decoded = decodePacket(encoded);

      expect(decoded.data).toBeInstanceOf(TitanError);
      expect(decoded.data.stack).toBeDefined();
      expect(decoded.data.stack).toContain('TitanError');
    });

    it('should handle TitanError subclasses', () => {
      class CustomTitanError extends TitanError {
        constructor(message: string) {
          super({
            code: ErrorCode.BAD_REQUEST,
            message,
          });
          this.name = 'CustomTitanError';
        }
      }

      const error = new CustomTitanError('Custom error message');

      const packet = new Packet(7);
      packet.setError(1);
      packet.data = error;

      const encoded = encodePacket(packet);
      const decoded = decodePacket(encoded);

      expect(decoded.data).toBeInstanceOf(TitanError);
      expect(decoded.data.name).toBe('CustomTitanError');
      expect(decoded.data.message).toBe('Custom error message');
    });
  });

  describe('WebSocket Transport', () => {
    let transport: WebSocketTransport;
    let testPort: number;
    let httpServer: any;
    let wsServer: WebSocketServer;
    let serverConnection: any;
    let clientConnection: any;

    beforeEach(async () => {
      transport = new WebSocketTransport();
      testPort = await getFreeHttpPort();

      httpServer = createServer();
      await promisify(httpServer.listen).bind(httpServer)(testPort);
      wsServer = new WebSocketServer({ server: httpServer });

      // Set up server connection handler BEFORE client connects
      const serverConnPromise = new Promise<any>((resolve) => {
        wsServer.once('connection', async (ws) => {
          const { WebSocketConnection } = await import('../../../src/netron/transport/websocket/index.js');
          const conn = new WebSocketConnection(ws, {}, true);
          resolve(conn);
        });
      });

      // Connect client
      clientConnection = await transport.connect(`ws://127.0.0.1:${testPort}`);
      serverConnection = await serverConnPromise;
    });

    afterEach(async () => {
      await clientConnection?.close();
      await serverConnection?.close();

      // Close all clients
      const closePromises = Array.from(wsServer.clients).map(
        (client) =>
          new Promise<void>((resolve) => {
            if (client.readyState === 1) {
              client.once('close', () => resolve());
              client.close();
            } else {
              resolve();
            }
          })
      );

      await Promise.all(closePromises);

      // Close WebSocket server
      await new Promise<void>((resolve) => {
        wsServer.close(() => resolve());
      });

      // Close HTTP server
      await promisify(httpServer.close).bind(httpServer)();
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    it('should transmit TitanError through WebSocket', async () => {
      // Create test packet (following tcp-transport.spec.ts pattern)
      const testPacket = new Packet(100);
      testPacket.setType(1);
      testPacket.setError(1);
      testPacket.data = new TitanError({
        code: ErrorCode.FORBIDDEN,
        message: 'Access denied',
        details: { resource: 'user-data', action: 'read' },
      });

      // Server listens for packet
      const packetPromise = waitForEvent(serverConnection, 'packet');

      // Client sends packet
      await clientConnection.sendPacket(testPacket);

      // Server receives packet
      const receivedPacket = await packetPromise;
      const receivedError = receivedPacket.data as TitanError;

      expect(receivedError).toBeInstanceOf(TitanError);
      expect(receivedError.code).toBe(ErrorCode.FORBIDDEN);
      expect(receivedError.message).toBe('Access denied');
      expect(receivedError.details).toEqual({ resource: 'user-data', action: 'read' });
    }, 15000);

    it('should handle bidirectional TitanError transmission over WebSocket', async () => {
      const serverError = new TitanError({
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Server processing error',
        details: { operation: 'validate' },
      });

      // Create test packet
      const testPacket = new Packet(200);
      testPacket.setType(1);
      testPacket.setError(1);
      testPacket.data = new TitanError({
        code: ErrorCode.BAD_REQUEST,
        message: 'Client request error',
        details: { field: 'username' },
      });

      // Set up handlers for bidirectional communication
      // Server handler: receive packet and send response
      const serverReceivedPromise = new Promise<TitanError>((resolve) => {
        serverConnection.once('packet', async (packet: Packet) => {
          // Send response back to client
          const responsePacket = new Packet(packet.id + 1);
          responsePacket.setType(1);
          responsePacket.setError(1);
          responsePacket.data = serverError;
          await serverConnection.sendPacket(responsePacket);
          resolve(packet.data);
        });
      });

      // Client handler: receive response
      const clientReceivedPromise = waitForEvent(clientConnection, 'packet');

      // Client sends packet
      await clientConnection.sendPacket(testPacket);

      // Wait for both sides to complete
      const [serverReceived, clientReceivedPacket] = await Promise.all([serverReceivedPromise, clientReceivedPromise]);
      const clientReceived = clientReceivedPacket.data as TitanError;

      // Verify server received client error
      expect(serverReceived).toBeInstanceOf(TitanError);
      expect(serverReceived.code).toBe(ErrorCode.BAD_REQUEST);
      expect(serverReceived.message).toBe('Client request error');

      // Verify client received server error
      expect(clientReceived).toBeInstanceOf(TitanError);
      expect(clientReceived.code).toBe(ErrorCode.INTERNAL_ERROR);
      expect(clientReceived.message).toBe('Server processing error');
    }, 15000);
  });

  describe('TCP Transport', () => {
    let transport: TcpTransport;
    let testPort: number;
    let server: any;
    let serverConnection: any;
    let clientConnection: any;

    beforeEach(async () => {
      transport = new TcpTransport();
      testPort = await getFreePort();
      server = await transport.createServer({ port: testPort, host: '127.0.0.1' } as any);

      // Set up connection handler BEFORE connecting (exactly like tcp-transport.spec.ts)
      const connectionPromise = waitForEvent(server, 'connection');

      // Connect client
      clientConnection = await transport.connect(`tcp://127.0.0.1:${testPort}`);
      serverConnection = await connectionPromise;
    });

    afterEach(async () => {
      await clientConnection?.close();
      await serverConnection?.close();
      await server?.close();
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    it('should transmit TitanError through TCP', async () => {
      // Create test packet with TitanError data (exactly like tcp-transport.spec.ts pattern)
      const testPacket = new Packet(123);
      testPacket.setType(1);
      testPacket.setError(1);
      testPacket.data = new TitanError({
        code: ErrorCode.CONFLICT,
        message: 'Resource conflict',
        details: { conflictingId: 'res-123' },
      });

      // Server listens for packet (exactly like tcp-transport.spec.ts)
      const packetPromise = waitForEvent(serverConnection, 'packet');

      // Client sends packet
      await clientConnection.sendPacket(testPacket);

      // Server receives packet
      const receivedPacket = await packetPromise;
      const receivedError = receivedPacket.data as TitanError;

      expect(receivedError).toBeInstanceOf(TitanError);
      expect(receivedError.code).toBe(ErrorCode.CONFLICT);
      expect(receivedError.message).toBe('Resource conflict');
      expect(receivedError.details).toEqual({ conflictingId: 'res-123' });
    }, 15000);

    it('should transmit TitanError with cause chain through TCP', async () => {
      const rootCause = new TitanError({
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Database error',
      });

      // Create test packet with cause chain (following tcp-transport.spec.ts pattern)
      const testPacket = new Packet(101);
      testPacket.setType(1);
      testPacket.setError(1);
      testPacket.data = new TitanError({
        code: ErrorCode.SERVICE_UNAVAILABLE,
        message: 'Service unavailable',
        cause: rootCause,
      });

      // Server listens for packet
      const packetPromise = waitForEvent(serverConnection, 'packet');

      // Client sends packet
      await clientConnection.sendPacket(testPacket);

      // Server receives packet
      const receivedPacket = await packetPromise;
      const receivedError = receivedPacket.data as TitanError;

      expect(receivedError).toBeInstanceOf(TitanError);
      expect(receivedError.message).toBe('Service unavailable');
      expect(receivedError.cause).toBeInstanceOf(TitanError);
      expect(receivedError.cause!.message).toBe('Database error');
    }, 15000);
  });

  describe('Unix Socket Transport', () => {
    let transport: UnixSocketTransport | NamedPipeTransport;
    let socketPath: string;
    let server: any;
    let serverConnection: any;
    let clientConnection: any;
    const isWindows = process.platform === 'win32';

    beforeEach(async () => {
      transport = isWindows ? new NamedPipeTransport() : new UnixSocketTransport();
      socketPath = getSocketPath();
      server = await transport.createServer(socketPath);
      await server.listen();

      // Set up connection handler BEFORE connecting (like tcp-transport.spec.ts)
      const connectionPromise = waitForEvent(server, 'connection');

      // Connect client
      clientConnection = await transport.connect(socketPath);
      serverConnection = await connectionPromise;
    });

    afterEach(async () => {
      await clientConnection?.close();
      await serverConnection?.close();
      await server?.close();
      await cleanupSocketFile(socketPath);
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    it('should transmit TitanError through Unix socket', async () => {
      // Create test packet (following tcp-transport.spec.ts pattern)
      const testPacket = new Packet(100);
      testPacket.setType(1);
      testPacket.setError(1);
      testPacket.data = new TitanError({
        code: ErrorCode.TOO_MANY_REQUESTS,
        message: 'Rate limit exceeded',
        details: { limit: 100, window: '1h' },
      });

      // Server listens for packet
      const packetPromise = waitForEvent(serverConnection, 'packet');

      // Client sends packet
      await clientConnection.sendPacket(testPacket);

      // Server receives packet
      const receivedPacket = await packetPromise;
      const receivedError = receivedPacket.data as TitanError;

      expect(receivedError).toBeInstanceOf(TitanError);
      expect(receivedError.code).toBe(ErrorCode.TOO_MANY_REQUESTS);
      expect(receivedError.message).toBe('Rate limit exceeded');
      expect(receivedError.details).toEqual({ limit: 100, window: '1h' });
    }, 15000);

    it('should preserve all tracing properties through Unix socket', async () => {
      // Create test packet with tracing properties
      const testPacket = new Packet(102);
      testPacket.setType(1);
      testPacket.setError(1);
      testPacket.data = new TitanError({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Validation failed',
        details: { errors: ['field1', 'field2'] },
        requestId: 'req-unix-123',
        correlationId: 'corr-unix-456',
        traceId: 'trace-unix-789',
        spanId: 'span-unix-abc',
      });

      // Server listens for packet
      const packetPromise = waitForEvent(serverConnection, 'packet');

      // Client sends packet
      await clientConnection.sendPacket(testPacket);

      // Server receives packet
      const receivedPacket = await packetPromise;
      const receivedError = receivedPacket.data as TitanError;

      expect(receivedError).toBeInstanceOf(TitanError);
      expect(receivedError.requestId).toBe('req-unix-123');
      expect(receivedError.correlationId).toBe('corr-unix-456');
      expect(receivedError.traceId).toBe('trace-unix-789');
      expect(receivedError.spanId).toBe('span-unix-abc');
    }, 15000);
  });

  describe('Cross-Transport Consistency', () => {
    it('should produce identical serialization across all transports', () => {
      const error = new TitanError({
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Consistency test',
        details: { test: 'value' },
        requestId: 'req-123',
      });

      const packet1 = new Packet(1);
      packet1.setError(1);
      packet1.data = error;

      const packet2 = new Packet(1);
      packet2.setError(1);
      packet2.data = error;

      const packet3 = new Packet(1);
      packet3.setError(1);
      packet3.data = error;

      const encoded1 = encodePacket(packet1);
      const encoded2 = encodePacket(packet2);
      const encoded3 = encodePacket(packet3);

      // All encodings should be identical
      expect(encoded1).toEqual(encoded2);
      expect(encoded2).toEqual(encoded3);

      // All decodings should produce equivalent errors
      const decoded1 = decodePacket(encoded1);
      const decoded2 = decodePacket(encoded2);
      const decoded3 = decodePacket(encoded3);

      expect(decoded1.data.code).toBe(decoded2.data.code);
      expect(decoded2.data.code).toBe(decoded3.data.code);
      expect(decoded1.data.message).toBe(decoded2.data.message);
      expect(decoded2.data.message).toBe(decoded3.data.message);
    });
  });

  describe('Edge Cases', () => {
    it('should handle TitanError with null/undefined properties', () => {
      const error = new TitanError({
        code: ErrorCode.BAD_REQUEST,
        message: 'Test error',
        details: null as any,
        context: undefined,
      });

      const packet = new Packet(1);
      packet.setError(1);
      packet.data = error;

      const encoded = encodePacket(packet);
      const decoded = decodePacket(encoded);

      expect(decoded.data).toBeInstanceOf(TitanError);
      // Note: null serializes to {} in MessagePack when part of an object, undefined becomes null
      // MessagePack treats null object properties as empty objects
      expect(decoded.data.details).toEqual({});
    });

    it('should handle TitanError with large details object', () => {
      const largeDetails = {
        data: new Array(1000).fill(0).map((_, i) => ({ index: i, value: `value-${i}` })),
      };

      const error = new TitanError({
        code: ErrorCode.UNPROCESSABLE_ENTITY,
        message: 'Large payload',
        details: largeDetails,
      });

      const packet = new Packet(1);
      packet.setError(1);
      packet.data = error;

      const encoded = encodePacket(packet);
      const decoded = decodePacket(encoded);

      expect(decoded.data).toBeInstanceOf(TitanError);
      expect(decoded.data.details.data).toHaveLength(1000);
      expect(decoded.data.details.data[500]).toEqual({ index: 500, value: 'value-500' });
    });

    it('should handle TitanError with special characters in message', () => {
      const error = new TitanError({
        code: ErrorCode.BAD_REQUEST,
        message: 'Error with 中文, emoji 🎉, and symbols ©®™',
      });

      const packet = new Packet(1);
      packet.setError(1);
      packet.data = error;

      const encoded = encodePacket(packet);
      const decoded = decodePacket(encoded);

      expect(decoded.data).toBeInstanceOf(TitanError);
      expect(decoded.data.message).toBe('Error with 中文, emoji 🎉, and symbols ©®™');
    });
  });
});
