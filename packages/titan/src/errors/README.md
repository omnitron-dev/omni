# Titan Error System

A comprehensive, transport-agnostic error handling system for the Titan framework. Built on HTTP status codes as a universal standard, providing type-safe error handling across all components.

## Table of Contents

- [Philosophy](#philosophy)
- [Architecture](#architecture)
- [Core Classes](#core-classes)
- [Error Categories](#error-categories)
- [Usage Examples](#usage-examples)
- [Error Factories](#error-factories)
- [Transport Mapping](#transport-mapping)
- [Netron Integration](#netron-integration)
- [Validation Errors](#validation-errors)
- [Best Practices](#best-practices)
- [API Reference](#api-reference)

## Philosophy

The Titan error system is designed with the following principles:

1. **Universal Standard**: Based on HTTP status codes that everyone understands
2. **Type Safety**: Full TypeScript support with comprehensive type inference
3. **Transport Agnostic**: Errors map seamlessly across HTTP, WebSocket, gRPC, TCP, and more
4. **Rich Context**: Errors carry detailed context for debugging and monitoring
5. **Performance**: Object pooling and caching for high-throughput scenarios
6. **Observability**: Built-in statistics and metrics tracking

## Architecture

```
TitanError (Base)
│
├── ValidationError     → Zod-based validation errors
├── ContractError       → Type-safe contract-based errors
├── HttpError          → HTTP-specific errors
│   ├── ApiError       → REST API errors
│   ├── RestError      → Resource-based errors
│   ├── AuthError      → Authentication errors
│   ├── PermissionError → Authorization errors
│   └── RateLimitError  → Rate limiting errors
│
└── NetronError        → Netron RPC framework errors
    ├── ServiceNotFoundError
    ├── MethodNotFoundError
    ├── TransportError
    ├── PeerError
    ├── RpcError
    ├── StreamError
    └── SerializationError
```

## Core Classes

### TitanError

The base error class that all Titan errors extend from.

```typescript
import { TitanError, ErrorCode } from '@omnitron-dev/titan/errors';

// Create a basic error
const error = new TitanError({
  code: ErrorCode.NOT_FOUND,
  message: 'User not found',
  details: { userId: 123 },
  context: { service: 'auth', method: 'getUser' }
});

// Check if an error is a TitanError
if (TitanError.isTitanError(error)) {
  console.log(error.code);       // 404
  console.log(error.category);   // 'client'
  console.log(error.isRetryable()); // false
}
```

### Error Properties

Every TitanError includes:

- `code` - HTTP status code or custom error code
- `category` - Error category (success, client, server, auth, validation, etc.)
- `message` - Human-readable error message
- `details` - Structured error details
- `context` - Contextual information (service, method, user, etc.)
- `timestamp` - When the error occurred
- `requestId` - Unique request identifier
- `correlationId` - For distributed tracing
- `spanId` / `traceId` - OpenTelemetry integration

## Error Categories

Errors are automatically categorized:

```typescript
import { getErrorCategory, ErrorCategory } from '@omnitron-dev/titan/errors';

getErrorCategory(404); // ErrorCategory.CLIENT
getErrorCategory(500); // ErrorCategory.SERVER
getErrorCategory(401); // ErrorCategory.AUTH
getErrorCategory(422); // ErrorCategory.VALIDATION
getErrorCategory(429); // ErrorCategory.RATE_LIMIT
```

## Usage Examples

### Basic Error Handling

```typescript
import { Errors, TitanError } from '@omnitron-dev/titan/errors';

// Using factory methods (recommended)
throw Errors.notFound('User', '123');
throw Errors.badRequest('Invalid email format');
throw Errors.timeout('Database query', 5000);

// Using TitanError directly
throw new TitanError({
  code: ErrorCode.CONFLICT,
  message: 'Email already exists',
  details: { email: 'user@example.com' }
});
```

### Error Recovery with Retry

```typescript
import { retryWithBackoff, TitanError } from '@omnitron-dev/titan/errors';

const data = await retryWithBackoff(
  async () => await fetchData(),
  {
    maxAttempts: 3,
    initialDelay: 1000,
    backoffFactor: 2,
    onRetry: (error, attempt, delay) => {
      console.log(`Retry attempt ${attempt} after ${delay}ms`);
    }
  }
);
```

### Error Boundaries

```typescript
import { createErrorBoundary } from '@omnitron-dev/titan/errors';

const boundary = createErrorBoundary(
  [], // default value
  (error) => logger.error({ err: error }, 'Error in handler')
);

const result = await boundary(async () => {
  // Risky operation
  return await riskyOperation();
});
```

### Circuit Breaker

```typescript
import { CircuitBreaker, ErrorCode } from '@omnitron-dev/titan/errors';

const breaker = new CircuitBreaker({
  failureThreshold: 5,
  resetTimeout: 60000 // 1 minute
});

const result = await breaker.execute(async () => {
  return await unstableService();
});
```

## Error Factories

Convenient factory functions for creating common errors:

### General Errors

```typescript
import { Errors } from '@omnitron-dev/titan/errors';

Errors.badRequest('Invalid input');
Errors.unauthorized();
Errors.forbidden('Admin access required');
Errors.notFound('User', '123');
Errors.conflict('Email already exists');
Errors.timeout('Operation', 5000);
Errors.unavailable('Database', 'Connection pool exhausted');
Errors.notImplemented('GraphQL subscriptions');
Errors.tooManyRequests(60); // retry after 60 seconds
Errors.validation([
  { field: 'email', message: 'Invalid email format', code: 'invalid_email' }
]);
```

### Netron Errors

```typescript
import { NetronErrors } from '@omnitron-dev/titan/errors';

// Service errors
NetronErrors.serviceNotFound('UserService@1.0.0');
NetronErrors.methodNotFound('UserService@1.0.0', 'getUser');

// Transport errors
NetronErrors.connectionFailed('websocket', 'ws://localhost:8080');
NetronErrors.connectionTimeout('tcp', '127.0.0.1:9000');
NetronErrors.connectionClosed('websocket', 'Server shutdown');

// Peer errors
NetronErrors.peerNotFound('peer-abc123');
NetronErrors.peerDisconnected('peer-abc123', 'Timeout');
NetronErrors.peerUnauthorized('peer-abc123');

// RPC errors
NetronErrors.rpcTimeout('UserService', 'getUser', 5000);
NetronErrors.invalidRequest('Missing required field: userId');
NetronErrors.invalidResponse('UserService', 'getUser', { expected: 'object', got: 'string' });

// Stream errors
NetronErrors.streamClosed('stream-123', 'Client disconnected');
NetronErrors.streamError('stream-123', new Error('Parse error'));
NetronErrors.streamBackpressure('stream-123', 1000);

// Serialization errors
NetronErrors.serializeEncode({ circular: 'reference' });
NetronErrors.serializeDecode(invalidBuffer);
```

### HTTP Errors

```typescript
import { HttpErrors } from '@omnitron-dev/titan/errors';

HttpErrors.badRequest('Invalid JSON');
HttpErrors.unauthorized('Bearer token required');
HttpErrors.forbidden('Admin access only');
HttpErrors.notFound('Resource not found');
HttpErrors.conflict('Resource already exists');
HttpErrors.tooManyRequests(60);
HttpErrors.internal('Database connection failed');
HttpErrors.fromStatus(503, 'Service temporarily unavailable');
```

### Auth Errors

```typescript
import { AuthErrors } from '@omnitron-dev/titan/errors';

AuthErrors.bearerTokenRequired('api');
AuthErrors.invalidToken('Malformed JWT');
AuthErrors.tokenExpired();
AuthErrors.insufficientPermissions('admin:write', ['admin:read']);
```

## Transport Mapping

Errors automatically map to transport-specific formats:

```typescript
import { mapToTransport, TransportType } from '@omnitron-dev/titan/errors';

const error = Errors.notFound('User', '123');

// HTTP
const httpError = mapToTransport(error, TransportType.HTTP);
// {
//   status: 404,
//   headers: { 'Content-Type': 'application/json' },
//   body: {
//     error: {
//       code: 'NOT_FOUND',
//       message: 'User with id 123 not found',
//       details: { resource: 'User', id: '123' }
//     }
//   }
// }

// WebSocket
const wsError = mapToTransport(error, TransportType.WEBSOCKET);
// {
//   type: 'error',
//   error: {
//     code: 404,
//     name: 'NOT_FOUND',
//     message: 'User with id 123 not found',
//     details: { ... }
//   }
// }

// gRPC
const grpcError = mapToTransport(error, TransportType.GRPC);
// {
//   code: 5,  // gRPC NOT_FOUND
//   message: 'User with id 123 not found',
//   details: { ... }
// }

// JSON-RPC
const jsonRpcError = mapToTransport(error, TransportType.JSONRPC);
// {
//   jsonrpc: '2.0',
//   error: {
//     code: -32601,  // Method not found
//     message: 'User with id 123 not found',
//     data: { ... }
//   }
// }
```

## Netron Integration

### Service Errors

```typescript
import { Service, Public } from '@omnitron-dev/titan/netron';
import { NetronErrors } from '@omnitron-dev/titan/errors';

@Service('UserService@1.0.0')
export class UserService {
  @Public()
  async getUser(userId: string) {
    const user = await this.db.findUser(userId);

    if (!user) {
      throw NetronErrors.serviceNotFound(`User with id ${userId}`);
    }

    return user;
  }

  @Public()
  async createUser(data: CreateUserInput) {
    try {
      return await this.db.createUser(data);
    } catch (error) {
      if (error.code === 'DUPLICATE_KEY') {
        throw Errors.conflict('Email already exists', {
          email: data.email
        });
      }
      throw error;
    }
  }
}
```

### Transport Error Handling

```typescript
import { WebSocketTransport } from '@omnitron-dev/titan/netron';
import { NetronErrors } from '@omnitron-dev/titan/errors';

const transport = new WebSocketTransport();

try {
  const connection = await transport.connect('ws://localhost:8080', {
    connectTimeout: 5000
  });
} catch (error) {
  if (error.code === ErrorCode.REQUEST_TIMEOUT) {
    // Handle timeout
  } else if (error.code === ErrorCode.SERVICE_UNAVAILABLE) {
    // Handle connection failure
  }
}
```

## Validation Errors

### Zod Integration

```typescript
import { z } from 'zod';
import { ValidationError } from '@omnitron-dev/titan/errors';

const userSchema = z.object({
  email: z.string().email(),
  age: z.number().min(18)
});

function validateUser(data: unknown) {
  const result = userSchema.safeParse(data);

  if (!result.success) {
    throw ValidationError.fromZodError(result.error, {
      message: 'Invalid user data'
    });
  }

  return result.data;
}

// Using validation decorator
import { ValidateInput } from '@omnitron-dev/titan/errors';

class UserService {
  @ValidateInput(userSchema)
  async createUser(input: unknown) {
    // input is now typed and validated
    const user = input as z.infer<typeof userSchema>;
    return this.db.createUser(user);
  }
}
```

### Field Errors

```typescript
import { Errors } from '@omnitron-dev/titan/errors';

// Create validation error from field errors
throw Errors.validation([
  {
    field: 'email',
    message: 'Invalid email format',
    code: 'invalid_email'
  },
  {
    field: 'password',
    message: 'Password must be at least 8 characters',
    code: 'password_too_short'
  }
]);
```

## Best Practices

### 1. Use Factory Functions

```typescript
// ✅ Good
throw Errors.notFound('User', userId);

// ❌ Avoid
throw new TitanError({
  code: ErrorCode.NOT_FOUND,
  message: `User ${userId} not found`
});
```

### 2. Include Contextual Information

```typescript
// ✅ Good - Rich context
throw Errors.timeout('Database query', 5000).withContext({
  query: 'SELECT * FROM users',
  database: 'production',
  userId: currentUser.id
});

// ❌ Avoid - Missing context
throw Errors.timeout('Operation', 5000);
```

### 3. Preserve Error Chains

```typescript
// ✅ Good - Preserves original error
try {
  await externalApi.call();
} catch (error) {
  throw Errors.internal('External API call failed', error);
}

// ❌ Avoid - Loses original error
try {
  await externalApi.call();
} catch (error) {
  throw Errors.internal('External API call failed');
}
```

### 4. Use Error Categories

```typescript
import { isRetryableError, ErrorCategory } from '@omnitron-dev/titan/errors';

try {
  await operation();
} catch (error) {
  if (TitanError.isTitanError(error)) {
    if (error.isRetryable()) {
      // Retry the operation
    } else if (error.category === ErrorCategory.CLIENT) {
      // Client error - don't retry, return to user
    } else if (error.category === ErrorCategory.SERVER) {
      // Server error - log and alert
      logger.error({ err: error }, 'Server error occurred');
    }
  }
}
```

### 5. Leverage Error Statistics

```typescript
import { TitanError } from '@omnitron-dev/titan/errors';

// Get error metrics
const metrics = TitanError.getMetrics({ window: '5m' });
console.log(metrics);
// {
//   rate: 12.5,  // errors per second
//   totalErrors: 3750,
//   topErrors: [
//     { code: 404, name: 'NOT_FOUND', count: 2100 },
//     { code: 500, name: 'INTERNAL_ERROR', count: 850 },
//     { code: 429, name: 'TOO_MANY_REQUESTS', count: 800 }
//   ],
//   byCategory: {
//     client: 2500,
//     server: 1000,
//     auth: 250
//   }
// }

// Reset statistics (e.g., at midnight)
TitanError.resetStatistics();
```

### 6. Error Logging

```typescript
import { ErrorLogger } from '@omnitron-dev/titan/errors';

const errorLogger = new ErrorLogger({
  includeStack: process.env.NODE_ENV === 'development',
  includeContext: true,
  filter: (error) => error.category !== ErrorCategory.CLIENT,
  logger: pinoLogger
});

try {
  await operation();
} catch (error) {
  if (TitanError.isTitanError(error)) {
    errorLogger.log(error);
  }
  throw error;
}
```

### 7. Testing with Error Matchers

```typescript
import { ErrorMatcher } from '@omnitron-dev/titan/errors';

describe('UserService', () => {
  it('should throw not found error', async () => {
    const matcher = new ErrorMatcher()
      .withCode(ErrorCode.NOT_FOUND)
      .withMessage(/User .+ not found/);

    await expect(service.getUser('invalid'))
      .rejects
      .toSatisfy(error => matcher.matches(error));
  });
});
```

## API Reference

### Core Classes

#### `TitanError`

Base error class for all Titan errors.

**Constructor:**
```typescript
new TitanError(options: ErrorOptions)
```

**Static Methods:**
- `isTitanError(error: any): boolean` - Check if error is TitanError
- `getCached(code: ErrorCode): TitanError` - Get cached error instance
- `createPool(options): ErrorPool` - Create error object pool
- `getStatistics(): ErrorStatistics` - Get error statistics
- `getMetrics(options): ErrorMetrics` - Get error metrics
- `resetStatistics(): void` - Reset statistics
- `aggregate(errors, options?): AggregateError` - Aggregate multiple errors

**Instance Methods:**
- `isRetryable(): boolean` - Check if error is retryable
- `getRetryStrategy(): RetryStrategy` - Get retry strategy
- `toJSON(): object` - Convert to JSON
- `withContext(context): TitanError` - Add context
- `withDetails(details): TitanError` - Add details

#### `ValidationError`

Validation error with Zod integration.

**Static Methods:**
- `fromZodError(zodError, options?): ValidationError`
- `fromFieldErrors(errors, options?): ValidationError`

**Instance Methods:**
- `hasFieldError(field): boolean`
- `getFieldErrors(field): FieldError[]`
- `getSimpleFormat(): SimpleFormat`
- `getDetailedFormat(): DetailedFormat`

### Error Factories

#### `Errors`

General error factories.

```typescript
Errors.create(code, message, details?)
Errors.badRequest(message?, details?)
Errors.unauthorized(message?, details?)
Errors.forbidden(message?, details?)
Errors.notFound(resource, id?)
Errors.conflict(message, details?)
Errors.validation(errors)
Errors.internal(message?, cause?)
Errors.timeout(operation, timeoutMs)
Errors.unavailable(service, reason?)
Errors.tooManyRequests(retryAfter?)
Errors.notImplemented(feature)
```

#### `NetronErrors`

Netron-specific error factories.

```typescript
NetronErrors.serviceNotFound(serviceId)
NetronErrors.methodNotFound(serviceId, methodName)
NetronErrors.connectionFailed(transport, address, cause?)
NetronErrors.connectionTimeout(transport, address)
NetronErrors.connectionClosed(transport, reason?)
NetronErrors.peerNotFound(peerId)
NetronErrors.peerDisconnected(peerId, reason?)
NetronErrors.peerUnauthorized(peerId)
NetronErrors.rpcTimeout(serviceId, methodName, timeoutMs)
NetronErrors.invalidRequest(reason, details?)
NetronErrors.invalidResponse(serviceId, methodName, details?)
NetronErrors.streamClosed(streamId, reason?)
NetronErrors.streamError(streamId, error)
NetronErrors.streamBackpressure(streamId, bufferSize)
NetronErrors.serializeEncode(value, cause?)
NetronErrors.serializeDecode(data, cause?)
```

#### `HttpErrors`

HTTP-specific error factories.

```typescript
HttpErrors.fromStatus(statusCode, message?, details?)
HttpErrors.badRequest(message?, details?)
HttpErrors.unauthorized(message?, details?)
HttpErrors.forbidden(message?, details?)
HttpErrors.notFound(message?, details?)
HttpErrors.conflict(message?, details?)
HttpErrors.tooManyRequests(retryAfter?)
HttpErrors.internal(message?, details?)
```

#### `AuthErrors`

Authentication/authorization error factories.

```typescript
AuthErrors.bearerTokenRequired(realm?)
AuthErrors.invalidToken(reason?)
AuthErrors.tokenExpired()
AuthErrors.insufficientPermissions(required, userPermissions?)
```

### Utility Functions

```typescript
// Error conversion
toTitanError(error: unknown): TitanError
ensureError(value: unknown): TitanError

// Assertions
assert(condition, errorOrMessage, details?)
assertDefined(value, message)
assertType(value, check, message)

// Try-catch wrappers
tryAsync(fn, errorCode?): Promise<T>
trySync(fn, errorCode?): T
handleError(fn, handlers): Promise<T>

// Retry mechanisms
retryWithBackoff(fn, options?): Promise<T>

// Error boundaries
createErrorBoundary(defaultValue, onError?): Function

// Helper classes
ErrorHandlerChain
CircuitBreaker
ErrorLogger
ErrorMatcher
```

## Error Codes

All error codes are based on HTTP status codes:

- **200-299**: Success codes (not errors)
- **400-499**: Client errors
- **500-599**: Server errors
- **600+**: Custom Titan error codes

Common codes:
- `400` - BAD_REQUEST
- `401` - UNAUTHORIZED
- `403` - FORBIDDEN
- `404` - NOT_FOUND
- `408` - REQUEST_TIMEOUT
- `409` - CONFLICT
- `422` - UNPROCESSABLE_ENTITY (validation)
- `429` - TOO_MANY_REQUESTS
- `500` - INTERNAL_SERVER_ERROR
- `503` - SERVICE_UNAVAILABLE
- `504` - GATEWAY_TIMEOUT

## Performance Considerations

### Object Pooling

For high-throughput scenarios:

```typescript
import { TitanError } from '@omnitron-dev/titan/errors';

// Create a pool of reusable error objects
const pool = TitanError.createPool({ size: 100, name: 'api-errors' });

// Acquire an error from the pool
const error = pool.acquire(ErrorCode.NOT_FOUND, 'User not found');

// Use the error
throw error;

// Later, release back to pool (in error handler)
pool.release(error);
```

### Error Caching

Common errors are automatically cached:

```typescript
// These return the same instance
const error1 = TitanError.getCached(ErrorCode.NOT_FOUND);
const error2 = TitanError.getCached(ErrorCode.NOT_FOUND);
console.log(error1 === error2); // true
```

## Migration Guide

### From Plain Errors

```typescript
// Before
throw new Error('User not found');

// After
throw Errors.notFound('User', userId);
```

### From Custom Error Classes

```typescript
// Before
class UserNotFoundError extends Error {
  constructor(userId: string) {
    super(`User ${userId} not found`);
    this.name = 'UserNotFoundError';
  }
}

// After
// Use factory or TitanError directly
throw Errors.notFound('User', userId);
```

### From HTTP Status Codes

```typescript
// Before
res.status(404).json({ error: 'Not found' });

// After
const error = Errors.notFound('Resource');
const mapped = mapToTransport(error, TransportType.HTTP);
res.status(mapped.status).json(mapped.body);
```

## Contributing

When adding new error types:

1. Extend appropriate base class (`TitanError`, `NetronError`, `HttpError`, etc.)
2. Add factory methods to appropriate factory object
3. Update this documentation
4. Add tests for new error types
5. Ensure transport mappings work correctly

## License

Part of the Titan framework - see main LICENSE file.
