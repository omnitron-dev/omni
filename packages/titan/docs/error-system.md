# Titan Error System

## Overview

The Titan Error System is a comprehensive, transport-agnostic error handling framework designed for maximum performance and type safety. It's based on HTTP status codes as the universal standard, making it easy to map to any transport protocol.

## Key Features

- **Transport-agnostic**: Works with HTTP, WebSocket, gRPC, TCP, GraphQL, JSON-RPC
- **Type-safe**: Full TypeScript support with type inference for contract-based errors
- **Performance-optimized**: Error caching, object pooling, and optimized serialization
- **Validation integration**: Seamless integration with Zod validation
- **Contract-based**: Define error schemas per method with automatic validation
- **Error recovery**: Built-in retry strategies and circuit breakers
- **Metrics & monitoring**: Automatic error tracking and statistics

## Core Concepts

### 1. Error Codes

Based on HTTP status codes, providing a universal language for errors:

```typescript
import { ErrorCode } from '@omnitron-dev/titan/errors';

// Standard HTTP codes
ErrorCode.BAD_REQUEST        // 400
ErrorCode.UNAUTHORIZED       // 401
ErrorCode.FORBIDDEN          // 403
ErrorCode.NOT_FOUND          // 404
ErrorCode.VALIDATION_ERROR   // 422
ErrorCode.TOO_MANY_REQUESTS  // 429
ErrorCode.INTERNAL_ERROR     // 500
ErrorCode.SERVICE_UNAVAILABLE // 503
```

### 2. Error Categories

Errors are automatically categorized for easier handling:

```typescript
ErrorCategory.CLIENT      // 4xx errors
ErrorCategory.SERVER      // 5xx errors
ErrorCategory.AUTH        // 401, 403, 407
ErrorCategory.VALIDATION  // 422
ErrorCategory.RATE_LIMIT  // 429
```

### 3. Creating Errors

```typescript
import { createError, TitanError, ErrorCode } from '@omnitron-dev/titan/errors';

// Simple error
const error = createError({
  code: ErrorCode.NOT_FOUND,
  message: 'User not found',
  details: { userId: '123' }
});

// Error with cause chain
const dbError = new Error('Connection failed');
const serviceError = createError({
  code: ErrorCode.SERVICE_UNAVAILABLE,
  message: 'Cannot process request',
  cause: dbError
});

// Error with context
const contextError = createError({
  code: ErrorCode.INTERNAL_ERROR,
  context: {
    service: 'UserService',
    method: 'getUser',
    requestId: 'req-123'
  }
});
```

## Contract-Based Errors

### Defining Error Contracts

```typescript
import { z } from 'zod';
import { contract } from '@omnitron-dev/titan/validation';

const userContract = contract({
  getUser: {
    input: z.object({ id: z.string() }),
    output: z.object({ id: z.string(), name: z.string() }),
    errors: {
      404: z.object({
        code: z.literal('USER_NOT_FOUND'),
        message: z.string(),
        userId: z.string()
      }),
      403: z.object({
        code: z.literal('ACCESS_DENIED'),
        reason: z.string()
      })
    }
  }
});
```

### Type-Safe Error Throwing

```typescript
import { ContractError, ContractService } from '@omnitron-dev/titan/errors';

class UserService extends ContractService<typeof userContract> {
  async getUser(input: { id: string }) {
    const user = await this.db.findUser(input.id);

    if (!user) {
      // Type-safe error - TypeScript knows the exact shape
      this.throwError('getUser', 404, {
        code: 'USER_NOT_FOUND',
        message: 'User not found',
        userId: input.id
      });
    }

    if (!user.isActive) {
      this.throwError('getUser', 403, {
        code: 'ACCESS_DENIED',
        reason: 'User account is inactive'
      });
    }

    return user;
  }
}
```

### Type Inference

```typescript
import { inferErrorTypes } from '@omnitron-dev/titan/errors';

// Extract error types for a method
type GetUserErrors = inferErrorTypes<typeof userContract, 'getUser'>;

// TypeScript knows the exact shape
const error404: GetUserErrors[404] = {
  code: 'USER_NOT_FOUND',
  message: 'Not found',
  userId: '123'
};

// This won't compile - wrong error structure
const invalidError: GetUserErrors[404] = {
  code: 'WRONG_CODE' // Error: Type '"WRONG_CODE"' is not assignable to type '"USER_NOT_FOUND"'
};
```

## Validation Integration

### With Zod Validation

```typescript
import { ValidationError, ValidateInput, ValidateOutput } from '@omnitron-dev/titan/errors';

class UserService {
  @ValidateInput(z.object({
    name: z.string().min(3),
    email: z.string().email()
  }))
  @ValidateOutput(z.object({
    id: z.string(),
    name: z.string(),
    email: z.string()
  }))
  async createUser(input: unknown) {
    // Input is automatically validated and typed
    return await this.db.createUser(input);
  }
}

// Manual validation
const schema = z.object({ email: z.string().email() });
const result = schema.safeParse(data);

if (!result.success) {
  throw ValidationError.fromZodError(result.error);
}
```

## Transport Mapping

### HTTP

```typescript
import { mapToTransport, TransportType } from '@omnitron-dev/titan/errors';

const error = createError({
  code: ErrorCode.NOT_FOUND,
  message: 'Resource not found'
});

const httpResponse = mapToTransport(error, TransportType.HTTP);
// {
//   status: 404,
//   headers: { 'Content-Type': 'application/json' },
//   body: {
//     error: {
//       code: 'NOT_FOUND',
//       message: 'Resource not found'
//     }
//   }
// }
```

### WebSocket

```typescript
const wsMessage = mapToTransport(error, TransportType.WEBSOCKET, {
  requestId: 'req-123'
});
// {
//   type: 'error',
//   id: 'req-123',
//   error: {
//     code: 404,
//     name: 'NOT_FOUND',
//     message: 'Resource not found'
//   }
// }
```

### gRPC

```typescript
const grpcError = mapToTransport(error, TransportType.GRPC);
// {
//   code: 5,  // gRPC NOT_FOUND
//   message: 'Resource not found',
//   details: {}
// }
```

## Error Recovery

### Retry Strategies

```typescript
// Check if error is retryable
if (error.isRetryable()) {
  const strategy = error.getRetryStrategy();
  // {
  //   shouldRetry: true,
  //   delay: 1000,
  //   maxAttempts: 3,
  //   backoffFactor: 2
  // }
}

// Automatic retry with backoff
import { retryWithBackoff } from '@omnitron-dev/titan/errors';

const result = await retryWithBackoff(
  async () => {
    return await apiCall();
  },
  {
    maxAttempts: 3,
    initialDelay: 1000,
    backoffFactor: 2,
    shouldRetry: (error) => error.isRetryable()
  }
);
```

### Circuit Breaker

```typescript
import { CircuitBreaker } from '@omnitron-dev/titan/errors';

const breaker = new CircuitBreaker<string>({
  failureThreshold: 5,
  resetTimeout: 30000
});

try {
  const result = await breaker.execute(async () => {
    return await unreliableService.call();
  });
} catch (error) {
  if (error.code === ErrorCode.SERVICE_UNAVAILABLE) {
    // Circuit is open, service is down
  }
}
```

## Performance Optimization

### Error Caching

```typescript
// Get cached instance for common errors
const notFound = TitanError.getCached(ErrorCode.NOT_FOUND);
// Same instance returned on each call
```

### Object Pooling

```typescript
// Create a pool for high-frequency error creation
const pool = TitanError.createPool({ size: 100 });

// Acquire error from pool
const error = pool.acquire(ErrorCode.BAD_REQUEST);
error.message = 'Invalid input';

// Use the error...

// Return to pool for reuse
pool.release(error);
```

## Error Aggregation

```typescript
const errors = [
  createError({ code: ErrorCode.VALIDATION_ERROR, message: 'Invalid email' }),
  createError({ code: ErrorCode.VALIDATION_ERROR, message: 'Invalid password' }),
  createError({ code: ErrorCode.BAD_REQUEST, message: 'Missing field' })
];

// Aggregate multiple errors
const aggregated = TitanError.aggregate(errors);
// aggregated.code === ErrorCode.MULTIPLE_ERRORS
// aggregated.errors.length === 3

// With deduplication
const deduplicated = TitanError.aggregate(errors, { deduplicate: true });
```

## HTTP-Specific Errors

```typescript
import { HttpError, ApiError, RestError, AuthError, RateLimitError } from '@omnitron-dev/titan/errors';

// Standard HTTP errors
throw HttpError.notFound('User not found');
throw HttpError.badRequest('Invalid input');
throw HttpError.unauthorized('Token required');

// REST resource errors
throw RestError.resourceNotFound('User', '123');
throw RestError.resourceConflict('Email', 'user@example.com');

// Authentication errors
throw AuthError.bearerTokenRequired('api');
throw AuthError.tokenExpired();

// Rate limiting
throw new RateLimitError('Too many requests', undefined, {
  limit: 100,
  remaining: 0,
  resetTime: new Date(Date.now() + 60000),
  retryAfter: 60
});
```

## Error Handling Utilities

### Try-Catch Wrappers

```typescript
import { tryAsync, handleError } from '@omnitron-dev/titan/errors';

// Wrap async functions
const result = await tryAsync(
  async () => await riskyOperation(),
  ErrorCode.SERVICE_UNAVAILABLE
);

// Handle with recovery
const data = await handleError(
  async () => await fetchData(),
  {
    [ErrorCode.NOT_FOUND]: async () => ({ default: 'data' }),
    [ErrorCode.SERVICE_UNAVAILABLE]: async () => {
      await delay(1000);
      return await fetchFromCache();
    },
    default: async (error) => {
      console.error('Unexpected error:', error);
      throw error;
    }
  }
);
```

### Error Handler Chains

```typescript
import { ErrorHandlerChain } from '@omnitron-dev/titan/errors';

const chain = new ErrorHandlerChain()
  .addForCode(ErrorCode.NOT_FOUND, async (error) => {
    await logNotFound(error);
  })
  .addForCategory('auth', async (error) => {
    await invalidateSession();
  })
  .add(async (error) => {
    await logToSentry(error);
  });

// Handle error through chain
await chain.handle(error);
```

## Monitoring & Metrics

```typescript
// Track error statistics
const stats = TitanError.getStatistics();
console.log(`Total errors: ${stats.totalErrors}`);
console.log(`By code:`, stats.byCode);
console.log(`By category:`, stats.byCategory);

// Get error metrics
const metrics = TitanError.getMetrics({
  window: '5m',
  groupBy: ['code', 'category']
});
console.log(`Error rate: ${metrics.rate} errors/sec`);
console.log(`Top errors:`, metrics.topErrors);

// Reset statistics
TitanError.resetStatistics();
```

## Best Practices

1. **Use Contract-Based Errors**: Define error schemas in contracts for type safety
2. **Leverage Error Categories**: Handle errors by category rather than individual codes
3. **Chain Error Causes**: Maintain error context through cause chains
4. **Implement Retry Logic**: Use built-in retry strategies for transient failures
5. **Monitor Error Rates**: Track error statistics and set up alerts
6. **Pool Frequent Errors**: Use object pooling for high-frequency error scenarios
7. **Document Error Contracts**: Keep error documentation in sync with contracts

## Example: Complete Service

```typescript
import { z } from 'zod';
import {
  contract,
  ContractService,
  ValidateInput,
  retryWithBackoff,
  CircuitBreaker
} from '@omnitron-dev/titan';

// Define contract with errors
const userServiceContract = contract({
  createUser: {
    input: z.object({
      name: z.string().min(2),
      email: z.string().email()
    }),
    output: z.object({
      id: z.string(),
      name: z.string(),
      email: z.string()
    }),
    errors: {
      409: z.object({
        code: z.literal('USER_EXISTS'),
        email: z.string()
      }),
      422: z.object({
        code: z.literal('VALIDATION_ERROR'),
        fields: z.array(z.string())
      })
    }
  }
});

// Implement service
class UserService extends ContractService<typeof userServiceContract> {
  private breaker = new CircuitBreaker<any>({
    failureThreshold: 5,
    resetTimeout: 30000
  });

  @ValidateInput(userServiceContract.definition.createUser.input!)
  async createUser(input: z.infer<typeof userServiceContract.definition.createUser.input>) {
    // Check for existing user
    const existing = await this.breaker.execute(
      () => this.db.findByEmail(input.email)
    );

    if (existing) {
      this.throwError('createUser', 409, {
        code: 'USER_EXISTS',
        email: input.email
      });
    }

    // Create with retry
    const user = await retryWithBackoff(
      () => this.db.create(input),
      { maxAttempts: 3 }
    );

    return user;
  }
}

// Usage
const service = new UserService(userServiceContract);

try {
  const user = await service.createUser({
    name: 'John',
    email: 'john@example.com'
  });
} catch (error) {
  if (ContractError.isContractError(error)) {
    // Handle contract error with full type information
    if (error.code === 409) {
      console.log('User already exists:', error.payload.email);
    }
  }
}
```