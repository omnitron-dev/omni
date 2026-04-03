#!/usr/bin/env node

/**
 * Error System Demo
 *
 * Demonstrates the comprehensive error handling capabilities of Titan
 */

import { z } from 'zod';
import {
  createError,
  ErrorCode,
  TitanError,
  ValidationError,
  ContractError,
  ContractService,
  contract,
  mapToTransport,
  TransportType,
  retryWithBackoff,
  HttpError,
  RestError,
} from '../src/errors/index.js';
import type { inferErrorTypes } from '../src/errors/contract.js';

// =============================================================================
// 1. BASIC ERROR CREATION
// =============================================================================

console.log('\n=== 1. BASIC ERROR CREATION ===\n');

// Create simple errors
const notFoundError = createError({
  code: ErrorCode.NOT_FOUND,
  message: 'User not found',
  details: { userId: '123' },
});

console.log('Not Found Error:', {
  code: notFoundError.code,
  category: notFoundError.category,
  message: notFoundError.message,
  isRetryable: notFoundError.isRetryable(),
});

// Error with cause chain
const dbError = new Error('Connection timeout');
const serviceError = createError({
  code: ErrorCode.SERVICE_UNAVAILABLE,
  message: 'Database unavailable',
  cause: dbError,
});

console.log('\nService Error with Cause:');
console.log('Message:', serviceError.message);
console.log('Stack includes cause:', serviceError.stack?.includes('Connection timeout'));

// =============================================================================
// 2. CONTRACT-BASED ERRORS WITH TYPE SAFETY
// =============================================================================

console.log('\n=== 2. CONTRACT-BASED ERRORS ===\n');

// Define a contract with error schemas
const userContract = contract({
  getUser: {
    input: z.object({ id: z.string().uuid() }),
    output: z.object({
      id: z.string(),
      name: z.string(),
      email: z.string().email(),
    }),
    errors: {
      404: z.object({
        code: z.literal('USER_NOT_FOUND'),
        message: z.string(),
        userId: z.string(),
      }),
      403: z.object({
        code: z.literal('ACCESS_DENIED'),
        reason: z.enum(['inactive', 'banned', 'unverified']),
      }),
    },
  },
  createUser: {
    input: z.object({
      name: z.string().min(2),
      email: z.string().email(),
      age: z.number().min(18),
    }),
    output: z.object({
      id: z.string(),
      name: z.string(),
      email: z.string(),
    }),
    errors: {
      409: z.object({
        code: z.literal('USER_EXISTS'),
        email: z.string(),
      }),
      422: z.object({
        code: z.literal('VALIDATION_ERROR'),
        fields: z.array(
          z.object({
            field: z.string(),
            error: z.string(),
          })
        ),
      }),
    },
  },
});

// Type-safe service implementation
class UserService extends ContractService<typeof userContract> {
  private users = new Map<string, any>();

  async getUser(input: { id: string }) {
    const user = this.users.get(input.id);

    if (!user) {
      // TypeScript ensures this matches the contract exactly
      this.throwError('getUser', 404, {
        code: 'USER_NOT_FOUND',
        message: 'User not found in database',
        userId: input.id,
      });
    }

    if (user.status === 'banned') {
      this.throwError('getUser', 403, {
        code: 'ACCESS_DENIED',
        reason: 'banned',
      });
    }

    return user;
  }

  async createUser(input: { name: string; email: string; age: number }) {
    if (Array.from(this.users.values()).some((u) => u.email === input.email)) {
      this.throwError('createUser', 409, {
        code: 'USER_EXISTS',
        email: input.email,
      });
    }

    if (input.age < 18) {
      this.throwError('createUser', 422, {
        code: 'VALIDATION_ERROR',
        fields: [
          {
            field: 'age',
            error: 'Must be 18 or older',
          },
        ],
      });
    }

    const id = Math.random().toString(36).substr(2, 9);
    const user = { id, ...input };
    this.users.set(id, user);
    return user;
  }
}

// Demonstrate type inference
type GetUserErrors = inferErrorTypes<typeof userContract, 'getUser'>;

// This compiles - correct structure
const validError: GetUserErrors[404] = {
  code: 'USER_NOT_FOUND',
  message: 'Not found',
  userId: '123',
};

// This would not compile if uncommented - wrong structure
// const invalidError: GetUserErrors[404] = {
//   code: 'WRONG_CODE', // Type error!
//   userId: '123'
// };

console.log('Contract defines errors for getUser:', Object.keys(userContract.definition.getUser.errors || {}));

// =============================================================================
// 3. VALIDATION ERRORS
// =============================================================================

console.log('\n=== 3. VALIDATION ERRORS ===\n');

const userSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  age: z.number().min(18),
});

const invalidData = {
  name: 'A', // Too short
  email: 'not-an-email',
  age: 16, // Too young
};

const validationResult = userSchema.safeParse(invalidData);

if (!validationResult.success) {
  const error = ValidationError.fromZodError(validationResult.error);

  console.log('Validation Error:');
  console.log('- Category:', error.category);
  console.log('- HTTP Status:', error.httpStatus);
  console.log('- Validation Errors:', error.validationErrors);

  // Get simple format
  const simple = error.getSimpleFormat();
  console.log('- Simple Format:', simple.errors);
}

// =============================================================================
// 4. TRANSPORT MAPPING
// =============================================================================

console.log('\n=== 4. TRANSPORT MAPPING ===\n');

const sampleError = createError({
  code: ErrorCode.NOT_FOUND,
  message: 'Resource not found',
  requestId: 'req-123',
});

// Map to HTTP
const httpResponse = mapToTransport(sampleError, TransportType.HTTP);
console.log('HTTP Mapping:', {
  status: httpResponse.status,
  headers: httpResponse.headers,
  body: httpResponse.body,
});

// Map to WebSocket
const wsMessage = mapToTransport(sampleError, TransportType.WEBSOCKET, {
  requestId: 'req-123',
});
console.log('\nWebSocket Mapping:', wsMessage);

// Map to gRPC
const grpcError = mapToTransport(sampleError, TransportType.GRPC);
console.log('\ngRPC Mapping:', {
  code: grpcError.code,
  message: grpcError.message,
});

// =============================================================================
// 5. ERROR RECOVERY AND RETRY
// =============================================================================

console.log('\n=== 5. ERROR RECOVERY ===\n');

let attempts = 0;
async function unreliableOperation() {
  attempts++;
  if (attempts < 3) {
    throw createError({
      code: ErrorCode.SERVICE_UNAVAILABLE,
      message: `Attempt ${attempts} failed`,
    });
  }
  return 'Success!';
}

async function demonstrateRetry() {
  try {
    const result = await retryWithBackoff(unreliableOperation, {
      maxAttempts: 5,
      initialDelay: 100,
      backoffFactor: 2,
      onRetry: (error, attempt, delay) => {
        console.log(`Retry attempt ${attempt} after ${delay}ms delay`);
      },
    });
    console.log('Final result:', result);
  } catch (error) {
    console.log('Failed after all retries:', error);
  }
}

await demonstrateRetry();

// =============================================================================
// 6. HTTP-SPECIFIC ERRORS
// =============================================================================

console.log('\n=== 6. HTTP-SPECIFIC ERRORS ===\n');

// REST errors
const userNotFound = RestError.resourceNotFound('User', '123');
console.log('REST Not Found:', {
  status: userNotFound.httpStatus,
  resource: userNotFound.resource,
  resourceId: userNotFound.resourceId,
});

// API errors
const apiError = HttpError.tooManyRequests('Rate limit exceeded', {
  retryAfter: 60,
});
console.log('Rate Limit Error:', {
  status: apiError.httpStatus,
  message: apiError.message,
  details: apiError.details,
});

// =============================================================================
// 7. ERROR STATISTICS
// =============================================================================

console.log('\n=== 7. ERROR STATISTICS ===\n');

// Reset stats for clean demo
TitanError.resetStatistics();

// Generate some errors
createError({ code: ErrorCode.NOT_FOUND });
createError({ code: ErrorCode.NOT_FOUND });
createError({ code: ErrorCode.BAD_REQUEST });
createError({ code: ErrorCode.INTERNAL_ERROR });

const stats = TitanError.getStatistics();
console.log('Error Statistics:');
console.log('- Total Errors:', stats.totalErrors);
console.log('- By Code:', stats.byCode);
console.log('- By Category:', stats.byCategory);

const metrics = TitanError.getMetrics({
  window: '1m',
  groupBy: ['code', 'category'],
});
console.log('\nError Metrics:');
console.log('- Error Rate:', metrics.rate.toFixed(2), 'errors/sec');
console.log('- Top Errors:', metrics.topErrors.slice(0, 3));

// =============================================================================
// 8. ERROR AGGREGATION
// =============================================================================

console.log('\n=== 8. ERROR AGGREGATION ===\n');

const multipleErrors = [
  createError({ code: ErrorCode.VALIDATION_ERROR, message: 'Invalid email' }),
  createError({ code: ErrorCode.VALIDATION_ERROR, message: 'Invalid email' }), // Duplicate
  createError({ code: ErrorCode.VALIDATION_ERROR, message: 'Invalid password' }),
  createError({ code: ErrorCode.BAD_REQUEST, message: 'Missing field' }),
];

const aggregated = TitanError.aggregate(multipleErrors);
console.log('Aggregated Errors:', {
  code: aggregated.code,
  summary: aggregated.summary,
  errorCount: aggregated.errors.length,
});

const deduplicated = TitanError.aggregate(multipleErrors, { deduplicate: true });
console.log('Deduplicated:', {
  originalCount: multipleErrors.length,
  deduplicatedCount: deduplicated.errors.length,
});

// =============================================================================
// 9. PERFORMANCE OPTIMIZATION
// =============================================================================

console.log('\n=== 9. PERFORMANCE OPTIMIZATION ===\n');

// Error caching
const cached1 = TitanError.getCached(ErrorCode.NOT_FOUND);
const cached2 = TitanError.getCached(ErrorCode.NOT_FOUND);
console.log('Cached errors are same instance:', cached1 === cached2);

// Object pooling
const pool = TitanError.createPool({ size: 5 });
console.log('Pool initial size:', pool.size);

const pooledError = pool.acquire(ErrorCode.BAD_REQUEST);
console.log('Pool after acquire:', pool.size);

pool.release(pooledError);
console.log('Pool after release:', pool.size);

// Performance test
const iterations = 10000;
const start = performance.now();
for (let i = 0; i < iterations; i++) {
  const error = createError({ code: ErrorCode.BAD_REQUEST });
  error.toJSON();
}
const duration = performance.now() - start;
console.log(`\nCreated and serialized ${iterations} errors in ${duration.toFixed(2)}ms`);
console.log(`Average: ${(duration / iterations).toFixed(4)}ms per error`);

// =============================================================================

console.log('\n=== DEMO COMPLETE ===\n');
console.log('The Titan Error System provides:');
console.log('✓ Type-safe contract-based errors');
console.log('✓ Transport-agnostic error mapping');
console.log('✓ Automatic validation integration');
console.log('✓ Built-in retry and recovery');
console.log('✓ Performance optimization');
console.log('✓ Comprehensive error statistics');
