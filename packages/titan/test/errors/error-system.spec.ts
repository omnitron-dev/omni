/**
 * Comprehensive test suite for the transport-agnostic error system
 * Using TDD approach to drive the design
 */

import { z } from 'zod';
import {
  TitanError,
  ErrorCode,
  ErrorCategory,
  createError,
  isErrorCode,
  mapToTransport,
  TransportType,
  ContractError,
  inferErrorTypes,
  ValidationError,
  HttpError,
} from '../../src/errors/index.js';
import { contract } from '../../src/validation/contract.js';

describe('Transport-Agnostic Error System', () => {
  describe('Core Error System', () => {
    it('should create errors with proper structure', () => {
      const error = createError({
        code: ErrorCode.NOT_FOUND,
        message: 'User not found',
        details: { userId: '123' },
      });

      expect(error).toBeInstanceOf(TitanError);
      expect(error.code).toBe(ErrorCode.NOT_FOUND);
      expect(error.message).toBe('User not found');
      expect(error.details).toEqual({ userId: '123' });
      expect(error.category).toBe(ErrorCategory.CLIENT);
      expect(error.httpStatus).toBe(404);
    });

    it('should categorize errors correctly', () => {
      const clientError = createError({ code: ErrorCode.BAD_REQUEST });
      expect(clientError.category).toBe(ErrorCategory.CLIENT);

      const serverError = createError({ code: ErrorCode.INTERNAL_ERROR });
      expect(serverError.category).toBe(ErrorCategory.SERVER);

      const authError = createError({ code: ErrorCode.UNAUTHORIZED });
      expect(authError.category).toBe(ErrorCategory.AUTH);
    });

    it('should support error chaining', () => {
      const originalError = new Error('Database connection failed');
      const error = createError({
        code: ErrorCode.SERVICE_UNAVAILABLE,
        message: 'Cannot process request',
        cause: originalError,
      });

      expect(error.cause).toBe(originalError);
      expect(error.stack).toContain('Database connection failed');
    });

    it('should provide type guards', () => {
      const error = createError({ code: ErrorCode.NOT_FOUND });
      const normalError = new Error('Regular error');

      expect(TitanError.isTitanError(error)).toBe(true);
      expect(TitanError.isTitanError(normalError)).toBe(false);

      expect(isErrorCode(error, ErrorCode.NOT_FOUND)).toBe(true);
      expect(isErrorCode(error, ErrorCode.BAD_REQUEST)).toBe(false);
    });
  });

  describe('Validation Integration', () => {
    it('should convert validation errors to TitanError', () => {
      const zodError = new z.ZodError([
        {
          code: 'invalid_type',
          expected: 'string',
          received: 'number',
          path: ['name'],
          message: 'Expected string, received number',
        },
      ]);

      const error = ValidationError.fromZodError(zodError);

      expect(error).toBeInstanceOf(TitanError);
      expect(error.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(error.category).toBe(ErrorCategory.VALIDATION); // 422 is correctly categorized as validation
      expect(error.httpStatus).toBe(422);
      expect(error.details).toHaveProperty('errors');
      expect(error.details.errors).toHaveLength(1);
    });

    it('should support custom validation error messages', () => {
      const zodError = new z.ZodError([
        {
          code: 'custom',
          path: ['email'],
          message: 'Invalid email format',
        },
      ]);

      const error = ValidationError.fromZodError(zodError, {
        message: 'Please check your input',
        code: ErrorCode.BAD_REQUEST,
      });

      expect(error.message).toBe('Please check your input');
      expect(error.code).toBe(ErrorCode.BAD_REQUEST);
      expect(error.httpStatus).toBe(400);
    });
  });

  describe('Contract-Based Error System', () => {
    const userContract = contract({
      getUser: {
        input: z.object({ id: z.string() }),
        output: z.object({ id: z.string(), name: z.string() }),
        errors: {
          404: z.object({
            code: z.literal('USER_NOT_FOUND'),
            message: z.string(),
            userId: z.string(),
          }),
          403: z.object({
            code: z.literal('ACCESS_DENIED'),
            reason: z.string(),
          }),
        },
      },
      createUser: {
        input: z.object({ name: z.string(), email: z.string() }),
        output: z.object({ id: z.string(), name: z.string(), email: z.string() }),
        errors: {
          409: z.object({
            code: z.literal('USER_EXISTS'),
            email: z.string(),
          }),
          422: z.object({
            code: z.literal('INVALID_DATA'),
            errors: z.array(
              z.object({
                field: z.string(),
                message: z.string(),
              })
            ),
          }),
        },
      },
    });

    it('should create contract-aware errors', () => {
      const error = ContractError.create(userContract, 'getUser', 404, {
        code: 'USER_NOT_FOUND',
        message: 'User not found',
        userId: '123',
      });

      expect(error).toBeInstanceOf(ContractError);
      expect(error.code).toBe(ErrorCode.NOT_FOUND);
      expect(error.contractMethod).toBe('getUser');
      expect(error.payload).toEqual({
        code: 'USER_NOT_FOUND',
        message: 'User not found',
        userId: '123',
      });
    });

    it('should validate error payload against contract', () => {
      // Invalid payload - missing required field
      expect(() => {
        ContractError.create(userContract, 'getUser', 404, {
          code: 'USER_NOT_FOUND',
          message: 'User not found',
          // Missing userId
        });
      }).toThrow('Invalid error payload for contract');

      // Invalid error code for method
      expect(() => {
        ContractError.create(userContract, 'getUser', 500, {
          message: 'Server error',
        });
      }).toThrow('Error code 500 not defined in contract');
    });

    it('should infer error types from contract', () => {
      type GetUserErrors = inferErrorTypes<typeof userContract, 'getUser'>;

      // This should compile without errors
      const error404: GetUserErrors[404] = {
        code: 'USER_NOT_FOUND',
        message: 'Not found',
        userId: '123',
      };

      const error403: GetUserErrors[403] = {
        code: 'ACCESS_DENIED',
        reason: 'Insufficient permissions',
      };

      // TypeScript should catch these at compile time
      // @ts-expect-error - Invalid error code
      const invalidCode: GetUserErrors[500] = {};

      // @ts-expect-error - Invalid payload structure
      const invalidPayload: GetUserErrors[404] = {
        code: 'WRONG_CODE',
      };
    });

    it('should provide type-safe error throwing', () => {
      class UserService {
        private contract = userContract;

        async getUser(input: { id: string }) {
          // Should be able to throw only contract-defined errors
          if (!input.id) {
            throw ContractError.create(this.contract, 'getUser', 404, {
              code: 'USER_NOT_FOUND',
              message: 'User not found',
              userId: input.id,
            });
          }

          // This should be caught by TypeScript
          // @ts-expect-error - Error code not in contract
          throw ContractError.create(this.contract, 'getUser', 500, {});
        }
      }
    });
  });

  describe('Transport Mapping', () => {
    describe('HTTP Mapping', () => {
      it('should map to HTTP status codes', () => {
        const error = createError({
          code: ErrorCode.NOT_FOUND,
          message: 'Resource not found',
        });

        const httpResponse = mapToTransport(error, TransportType.HTTP);

        expect(httpResponse.status).toBe(404);
        expect(httpResponse.body).toEqual({
          error: {
            code: 'NOT_FOUND',
            message: 'Resource not found',
            details: {},
          },
        });
        expect(httpResponse.headers).toEqual({
          'Content-Type': 'application/json',
        });
      });

      it('should handle custom HTTP errors', () => {
        const error = new HttpError(418, "I'm a teapot", {
          custom: 'data',
        });

        const httpResponse = mapToTransport(error, TransportType.HTTP);
        expect(httpResponse.status).toBe(418);
        expect(httpResponse.body.error.message).toBe("I'm a teapot");
      });
    });

    describe('WebSocket Mapping', () => {
      it('should map to WebSocket message format', () => {
        const error = createError({
          code: ErrorCode.BAD_REQUEST,
          message: 'Invalid parameters',
        });

        const wsMessage = mapToTransport(error, TransportType.WEBSOCKET);

        expect(wsMessage).toEqual({
          type: 'error',
          error: {
            code: 400,
            name: 'BAD_REQUEST',
            message: 'Invalid parameters',
            details: {},
          },
        });
      });

      it('should include request ID if provided', () => {
        const error = createError({
          code: ErrorCode.NOT_FOUND,
          requestId: 'req-123',
        });

        const wsMessage = mapToTransport(error, TransportType.WEBSOCKET, {
          requestId: 'req-123',
        });

        expect(wsMessage.id).toBe('req-123');
      });
    });

    describe('gRPC Mapping', () => {
      it('should map to gRPC status codes', () => {
        const errorMappings = [
          { titan: ErrorCode.NOT_FOUND, grpc: 5 }, // NOT_FOUND
          { titan: ErrorCode.INVALID_ARGUMENT, grpc: 3 }, // INVALID_ARGUMENT
          { titan: ErrorCode.PERMISSION_DENIED, grpc: 7 }, // PERMISSION_DENIED
          { titan: ErrorCode.UNAUTHORIZED, grpc: 16 }, // UNAUTHENTICATED
          { titan: ErrorCode.INTERNAL_ERROR, grpc: 13 }, // INTERNAL
          { titan: ErrorCode.SERVICE_UNAVAILABLE, grpc: 14 }, // UNAVAILABLE
        ];

        errorMappings.forEach(({ titan, grpc }) => {
          const error = createError({ code: titan });
          const grpcError = mapToTransport(error, TransportType.GRPC);

          expect(grpcError.code).toBe(grpc);
          expect(grpcError.message).toBeDefined();
          expect(grpcError.details).toBeDefined();
        });
      });
    });

    describe('Raw TCP Mapping', () => {
      it('should map to binary protocol format', () => {
        const error = createError({
          code: ErrorCode.NOT_FOUND,
          message: 'Not found',
        });

        const tcpPacket = mapToTransport(error, TransportType.TCP);

        expect(tcpPacket).toBeInstanceOf(Buffer);

        // Parse the packet
        const packetType = tcpPacket[0];
        const errorCode = tcpPacket.readUInt16BE(1);
        const messageLength = tcpPacket.readUInt16BE(3);
        const message = tcpPacket.subarray(5, 5 + messageLength).toString();

        expect(packetType).toBe(1); // Error packet
        expect(errorCode).toBe(404);
        expect(message).toBe('Not found');
      });
    });
  });

  describe('Performance Optimization', () => {
    it('should cache error instances for common errors', () => {
      const error1 = TitanError.getCached(ErrorCode.NOT_FOUND);
      const error2 = TitanError.getCached(ErrorCode.NOT_FOUND);

      expect(error1).toBe(error2); // Same instance
      expect(error1.code).toBe(ErrorCode.NOT_FOUND);
    });

    it('should optimize serialization for frequent errors', () => {
      const error = createError({
        code: ErrorCode.VALIDATION_ERROR,
        details: { fields: ['email', 'password'] },
      });

      const start = performance.now();
      for (let i = 0; i < 10000; i++) {
        error.toJSON();
      }
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(100); // Should be very fast
    });

    it('should use object pooling for temporary error objects', () => {
      const pool = TitanError.createPool({ size: 10 });

      const error1 = pool.acquire(ErrorCode.BAD_REQUEST);
      error1.message = 'Bad request';

      const error2 = pool.acquire(ErrorCode.NOT_FOUND);
      expect(pool.size).toBe(8); // 2 acquired

      pool.release(error1);
      expect(pool.size).toBe(9);

      const error3 = pool.acquire(ErrorCode.INTERNAL_ERROR);
      expect(error3).toBe(error1); // Reused instance
    });
  });

  describe('Error Recovery and Retry Logic', () => {
    it('should determine if error is retryable', () => {
      const retryableError = createError({
        code: ErrorCode.SERVICE_UNAVAILABLE,
      });
      expect(retryableError.isRetryable()).toBe(true);

      const nonRetryableError = createError({
        code: ErrorCode.BAD_REQUEST,
      });
      expect(nonRetryableError.isRetryable()).toBe(false);
    });

    it('should suggest retry strategy', () => {
      const error = createError({
        code: ErrorCode.RATE_LIMITED,
        details: { retryAfter: 60 },
      });

      const strategy = error.getRetryStrategy();
      expect(strategy.shouldRetry).toBe(true);
      expect(strategy.delay).toBe(60000); // 60 seconds in ms
      expect(strategy.maxAttempts).toBe(3);
    });
  });

  describe('Error Aggregation', () => {
    it('should aggregate multiple errors', () => {
      const errors = [
        createError({ code: ErrorCode.VALIDATION_ERROR, message: 'Invalid email' }),
        createError({ code: ErrorCode.VALIDATION_ERROR, message: 'Invalid password' }),
        createError({ code: ErrorCode.BAD_REQUEST, message: 'Missing field' }),
      ];

      const aggregated = TitanError.aggregate(errors);

      expect(aggregated.code).toBe(ErrorCode.MULTIPLE_ERRORS);
      expect(aggregated.errors).toHaveLength(3);
      expect(aggregated.summary).toContain('3 errors occurred');
    });

    it('should deduplicate similar errors', () => {
      const errors = [
        createError({ code: ErrorCode.NOT_FOUND, message: 'User not found' }),
        createError({ code: ErrorCode.NOT_FOUND, message: 'User not found' }),
        createError({ code: ErrorCode.NOT_FOUND, message: 'Post not found' }),
      ];

      const aggregated = TitanError.aggregate(errors, { deduplicate: true });
      expect(aggregated.errors).toHaveLength(2); // Deduplicated
    });
  });

  describe('Error Context and Correlation', () => {
    it('should maintain request context', () => {
      const error = createError({
        code: ErrorCode.INTERNAL_ERROR,
        context: {
          requestId: 'req-123',
          userId: 'user-456',
          service: 'UserService',
          method: 'getUser',
          timestamp: Date.now(),
        },
      });

      expect(error.context.requestId).toBe('req-123');
      expect(error.context.service).toBe('UserService');
    });

    it('should support error correlation across services', () => {
      const error = createError({
        code: ErrorCode.SERVICE_UNAVAILABLE,
        correlationId: 'corr-789',
        spanId: 'span-123',
        traceId: 'trace-456',
      });

      const serialized = error.toJSON();
      expect(serialized.correlationId).toBe('corr-789');
      expect(serialized.traceId).toBe('trace-456');
    });
  });

  describe('Error Metrics and Monitoring', () => {
    it('should track error statistics', () => {
      // Reset statistics before testing
      TitanError.resetStatistics();

      createError({ code: ErrorCode.NOT_FOUND });
      createError({ code: ErrorCode.NOT_FOUND });
      createError({ code: ErrorCode.BAD_REQUEST });

      const stats = TitanError.getStatistics();
      expect(stats.totalErrors).toBe(3);
      expect(stats.byCode[ErrorCode.NOT_FOUND]).toBe(2);
      expect(stats.byCode[ErrorCode.BAD_REQUEST]).toBe(1);
    });

    it('should provide error rate metrics', () => {
      const metrics = TitanError.getMetrics({
        window: '1m',
        groupBy: ['code', 'category'],
      });

      expect(metrics).toHaveProperty('rate');
      expect(metrics).toHaveProperty('topErrors');
      expect(metrics).toHaveProperty('byCategory');
    });
  });
});
