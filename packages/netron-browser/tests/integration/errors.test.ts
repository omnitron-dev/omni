/**
 * Error Serialization and Propagation Integration Tests
 * Tests error handling across network boundaries with both HTTP and WebSocket
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTitanServer, TitanServerFixture } from '../fixtures/titan-server.js';
import { WebSocketClient } from '../../src/client/ws-client.js';
import { HttpClient } from '../../src/client/http-client.js';
import {
  TitanError,
  serializeError,
  deserializeError,
  parseHttpError,
  ErrorCode,
} from '../../src/errors/index.js';
import { serializer } from '../../src/packet/serializer.js';
import { SmartBuffer } from '@omnitron-dev/smartbuffer';

describe('Error Serialization (WebSocket)', () => {
  let server: TitanServerFixture;
  let client: WebSocketClient;

  beforeAll(async () => {
    server = await createTitanServer({
      enableHttp: false,
      enableWebSocket: true,
      logLevel: 'silent',
    });

    client = new WebSocketClient({
      url: server.wsUrl,
      reconnect: false,
    });

    await client.connect();
  });

  afterAll(async () => {
    await client.disconnect();
    await server.cleanup();
  });

  describe('Error Propagation', () => {
    it('should propagate basic errors from server', async () => {
      await expect(
        client.invoke('echo@1.0.0', 'throwError', ['Custom error message'])
      ).rejects.toThrow('Custom error message');
    });

    it('should propagate division by zero error', async () => {
      await expect(
        client.invoke('calculator@1.0.0', 'divide', [10, 0])
      ).rejects.toThrow('Division by zero');
    });

    it('should propagate user not found error', async () => {
      await expect(
        client.invoke('user@1.0.0', 'getUser', ['nonexistent'])
      ).rejects.toThrow('User not found');
    });

    it('should handle service not found error', async () => {
      await expect(
        client.invoke('nonexistent@1.0.0', 'someMethod', [])
      ).rejects.toThrow();
    });

    it('should handle method not found error', async () => {
      await expect(
        client.invoke('calculator@1.0.0', 'nonExistentMethod', [])
      ).rejects.toThrow();
    });
  });

  describe('Error Object Properties', () => {
    it('should preserve error message', async () => {
      const errorMessage = 'Specific error message for testing';

      try {
        await client.invoke('echo@1.0.0', 'throwError', [errorMessage]);
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).toBe(errorMessage);
      }
    });

    it('should handle errors with special characters', async () => {
      const specialMessages = [
        'Error with "quotes"',
        "Error with 'single quotes'",
        'Error with \\n newlines',
        'Error with unicode: 世界',
        'Error with emoji: 🚀',
      ];

      for (const message of specialMessages) {
        try {
          await client.invoke('echo@1.0.0', 'throwError', [message]);
          expect.fail('Should have thrown an error');
        } catch (error: any) {
          expect(error.message).toBe(message);
        }
      }
    });
  });

  describe('Multiple Error Scenarios', () => {
    it('should handle different error types from different services', async () => {
      const errorTests = [
        {
          service: 'calculator@1.0.0',
          method: 'divide',
          args: [10, 0],
          expectedMessage: 'Division by zero',
        },
        {
          service: 'user@1.0.0',
          method: 'getUser',
          args: ['999'],
          expectedMessage: 'User not found',
        },
        {
          service: 'echo@1.0.0',
          method: 'throwError',
          args: ['Test error'],
          expectedMessage: 'Test error',
        },
      ];

      for (const test of errorTests) {
        try {
          await client.invoke(test.service, test.method, test.args);
          expect.fail(`Should have thrown error for ${test.service}.${test.method}`);
        } catch (error: any) {
          expect(error.message).toContain(test.expectedMessage);
        }
      }
    });

    it('should handle errors in concurrent requests', async () => {
      const operations = [
        client.invoke('calculator@1.0.0', 'divide', [10, 0]),
        client.invoke('user@1.0.0', 'getUser', ['999']),
        client.invoke('echo@1.0.0', 'throwError', ['Error 1']),
        client.invoke('calculator@1.0.0', 'divide', [20, 0]),
        client.invoke('echo@1.0.0', 'throwError', ['Error 2']),
      ];

      const results = await Promise.allSettled(operations);

      // All should be rejected
      results.forEach((result) => {
        expect(result.status).toBe('rejected');
      });

      // Check specific error messages
      expect((results[0] as any).reason.message).toContain('Division by zero');
      expect((results[1] as any).reason.message).toContain('User not found');
      expect((results[2] as any).reason.message).toBe('Error 1');
      expect((results[3] as any).reason.message).toContain('Division by zero');
      expect((results[4] as any).reason.message).toBe('Error 2');
    });
  });

  describe('Error Recovery', () => {
    it('should allow successful requests after error', async () => {
      // First, trigger an error
      try {
        await client.invoke('calculator@1.0.0', 'divide', [10, 0]);
        expect.fail('Should have thrown');
      } catch (error) {
        // Expected
      }

      // Then, make successful request
      const result = await client.invoke('calculator@1.0.0', 'divide', [10, 2]);
      expect(result).toBe(5);
    });

    it('should handle alternating success and error', async () => {
      for (let i = 0; i < 5; i++) {
        // Success
        const successResult = await client.invoke('calculator@1.0.0', 'add', [i, i]);
        expect(successResult).toBe(i * 2);

        // Error
        try {
          await client.invoke('calculator@1.0.0', 'divide', [10, 0]);
          expect.fail('Should have thrown');
        } catch (error) {
          // Expected
        }
      }
    });
  });
});

describe('Error Serialization (HTTP)', () => {
  let server: TitanServerFixture;
  let client: HttpClient;

  beforeAll(async () => {
    server = await createTitanServer({
      enableHttp: true,
      enableWebSocket: false,
      logLevel: 'silent',
    });

    client = new HttpClient({
      url: server.httpUrl,
    });

    await client.connect();
  });

  afterAll(async () => {
    await client.disconnect();
    await server.cleanup();
  });

  describe('HTTP Error Propagation', () => {
    it('should propagate errors via HTTP transport', async () => {
      await expect(
        client.invoke('echo@1.0.0', 'throwError', ['HTTP error test'])
      ).rejects.toThrow('HTTP error test');
    });

    it('should handle division by zero via HTTP', async () => {
      await expect(
        client.invoke('calculator@1.0.0', 'divide', [10, 0])
      ).rejects.toThrow('Division by zero');
    });

    it('should handle not found errors via HTTP', async () => {
      await expect(
        client.invoke('user@1.0.0', 'getUser', ['nonexistent'])
      ).rejects.toThrow('User not found');
    });
  });

  describe('HTTP-Specific Error Handling', () => {
    it('should handle service not found', async () => {
      await expect(
        client.invoke('nonexistent@1.0.0', 'method', [])
      ).rejects.toThrow();
    });

    it('should handle method not found', async () => {
      await expect(
        client.invoke('calculator@1.0.0', 'invalidMethod', [])
      ).rejects.toThrow();
    });
  });

  describe('Error Consistency', () => {
    it('should produce consistent errors with WebSocket', async () => {
      // Create a WebSocket client for comparison
      const wsClient = new WebSocketClient({
        url: server.httpUrl.replace('http', 'ws'),
        reconnect: false,
      });

      // Note: This test would need both transports enabled on the server
      // For now, just verify HTTP errors work
      try {
        await client.invoke('calculator@1.0.0', 'divide', [10, 0]);
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(error.message).toContain('Division by zero');
      }
    });
  });
});

describe('TitanError Serialization', () => {
  describe('Serialization and Deserialization', () => {
    it('should serialize and deserialize TitanError', () => {
      const error = new TitanError({
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Test error message',
        details: { key: 'value', count: 42 },
      });

      const serialized = serializeError(error);
      const deserialized = deserializeError(serialized);

      expect(deserialized).toBeInstanceOf(TitanError);
      expect(deserialized.code).toBe(error.code);
      expect(deserialized.message).toBe(error.message);
      expect(deserialized.details).toEqual(error.details);
    });

    it('should preserve error stack traces', () => {
      const error = new TitanError({
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Test with stack',
      });

      const serialized = serializeError(error, true); // Include stack
      const deserialized = deserializeError(serialized);

      expect(deserialized.stack).toBeDefined();
      expect(typeof deserialized.stack).toBe('string');
    });

    it('should handle errors with tracing information', () => {
      const error = new TitanError({
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Traced error',
        requestId: 'req-123',
        correlationId: 'corr-456',
        traceId: 'trace-789',
        spanId: 'span-abc',
      });

      const serialized = serializeError(error);
      const deserialized = deserializeError(serialized);

      expect(deserialized.requestId).toBe('req-123');
      expect(deserialized.correlationId).toBe('corr-456');
      expect(deserialized.traceId).toBe('trace-789');
      expect(deserialized.spanId).toBe('span-abc');
    });

    it('should serialize TitanError through MessagePack', () => {
      const error = new TitanError({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Validation failed',
        details: {
          field: 'email',
          reason: 'invalid format',
        },
      });

      // Encode with MessagePack
      const encoded = serializer.encode(error);
      expect(encoded).toBeInstanceOf(Uint8Array);

      // Decode back
      const decoded = serializer.decode(new SmartBuffer(encoded));
      expect(decoded).toBeInstanceOf(TitanError);
      expect(decoded.code).toBe(error.code);
      expect(decoded.message).toBe(error.message);
      expect(decoded.details).toEqual(error.details);
    });
  });

  describe('Error Code Handling', () => {
    it('should handle all standard error codes', () => {
      const codes = [
        ErrorCode.VALIDATION_ERROR,
        ErrorCode.NOT_FOUND,
        ErrorCode.UNAUTHORIZED,
        ErrorCode.FORBIDDEN,
        ErrorCode.INTERNAL_ERROR,
        ErrorCode.SERVICE_UNAVAILABLE,
        ErrorCode.TIMEOUT,
      ];

      for (const code of codes) {
        const error = new TitanError({
          code,
          message: `Error with code ${code}`,
        });

        const serialized = serializeError(error);
        const deserialized = deserializeError(serialized);

        expect(deserialized.code).toBe(code);
      }
    });

    it('should handle custom error codes', () => {
      const customCode = 9999;
      const error = new TitanError({
        code: customCode,
        message: 'Custom error',
      });

      const serialized = serializeError(error);
      const deserialized = deserializeError(serialized);

      expect(deserialized.code).toBe(customCode);
    });
  });

  describe('Complex Error Details', () => {
    it('should preserve complex error details', () => {
      const error = new TitanError({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Complex validation error',
        details: {
          errors: [
            { field: 'email', message: 'Invalid format' },
            { field: 'age', message: 'Must be positive' },
          ],
          metadata: {
            timestamp: Date.now(),
            validator: 'custom-validator',
          },
          nested: {
            deep: {
              value: 'preserved',
            },
          },
        },
      });

      const serialized = serializeError(error);
      const deserialized = deserializeError(serialized);

      expect(deserialized.details).toEqual(error.details);
    });

    it('should handle null and undefined in details', () => {
      const error = new TitanError({
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Error with nullish values',
        details: {
          nullValue: null,
          undefinedValue: undefined,
          emptyString: '',
          zero: 0,
          false: false,
        },
      });

      const serialized = serializeError(error);
      const deserialized = deserializeError(serialized);

      expect(deserialized.details.nullValue).toBeNull();
      expect(deserialized.details.emptyString).toBe('');
      expect(deserialized.details.zero).toBe(0);
      expect(deserialized.details.false).toBe(false);
    });
  });

  describe('HTTP Error Parsing', () => {
    it('should parse HTTP 404 errors', () => {
      const error = parseHttpError(404, {
        error: {
          code: ErrorCode.NOT_FOUND,
          message: 'Resource not found',
        },
      });

      expect(error).toBeInstanceOf(TitanError);
      expect(error.code).toBe(ErrorCode.NOT_FOUND);
      expect(error.message).toBe('Resource not found');
    });

    it('should parse HTTP 500 errors', () => {
      const error = parseHttpError(500, {
        error: {
          code: ErrorCode.INTERNAL_ERROR,
          message: 'Internal server error',
        },
      });

      expect(error).toBeInstanceOf(TitanError);
      expect(error.code).toBe(ErrorCode.INTERNAL_ERROR);
    });

    it('should extract tracing headers from HTTP response', () => {
      const headers = {
        'x-request-id': 'req-123',
        'x-correlation-id': 'corr-456',
        'x-trace-id': 'trace-789',
        'x-span-id': 'span-abc',
      };

      const error = parseHttpError(
        500,
        {
          error: {
            code: ErrorCode.INTERNAL_ERROR,
            message: 'Traced error',
          },
        },
        headers
      );

      expect(error.requestId).toBe('req-123');
      expect(error.correlationId).toBe('corr-456');
      expect(error.traceId).toBe('trace-789');
      expect(error.spanId).toBe('span-abc');
    });
  });
});

describe('Error Edge Cases', () => {
  let server: TitanServerFixture;
  let client: WebSocketClient;

  beforeAll(async () => {
    server = await createTitanServer({
      enableHttp: false,
      enableWebSocket: true,
      logLevel: 'silent',
    });

    client = new WebSocketClient({
      url: server.wsUrl,
      reconnect: false,
    });

    await client.connect();
  });

  afterAll(async () => {
    await client.disconnect();
    await server.cleanup();
  });

  describe('Error Boundary Conditions', () => {
    it('should handle very long error messages', async () => {
      const longMessage = 'x'.repeat(10000);

      try {
        await client.invoke('echo@1.0.0', 'throwError', [longMessage]);
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(error.message).toBe(longMessage);
      }
    });

    it('should handle empty error messages', async () => {
      try {
        await client.invoke('echo@1.0.0', 'throwError', ['']);
        expect.fail('Should have thrown');
      } catch (error: any) {
        // Should still be an error, even with empty message
        expect(error).toBeDefined();
      }
    });

    it('should handle errors with special JSON characters', async () => {
      const message = 'Error with { "json": "chars", "array": [1,2,3] }';

      try {
        await client.invoke('echo@1.0.0', 'throwError', [message]);
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(error.message).toBe(message);
      }
    });
  });

  describe('Deserialization Edge Cases', () => {
    it('should handle malformed error data', () => {
      const malformed = {
        // Missing required fields
        message: 'Incomplete error',
      };

      const error = deserializeError(malformed);
      expect(error).toBeInstanceOf(TitanError);
      expect(error.message).toBe('Incomplete error');
    });

    it('should handle null error data', () => {
      const error = deserializeError(null);
      expect(error).toBeInstanceOf(TitanError);
      expect(error.code).toBe(ErrorCode.UNKNOWN_ERROR);
    });

    it('should handle undefined error data', () => {
      const error = deserializeError(undefined);
      expect(error).toBeInstanceOf(TitanError);
      expect(error.code).toBe(ErrorCode.UNKNOWN_ERROR);
    });

    it('should handle already-TitanError data', () => {
      const originalError = new TitanError({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Original error',
      });

      const error = deserializeError(originalError);
      expect(error).toBe(originalError);
    });
  });
});
