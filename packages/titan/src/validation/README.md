# Titan Validation Subsystem

> High-performance, type-safe validation engine for distributed systems

[![Test Coverage](https://img.shields.io/badge/coverage-92.54%25-brightgreen.svg)](../../test/validation/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8+-blue.svg)](https://www.typescriptlang.org/)
[![Zod](https://img.shields.io/badge/Zod-3.x-purple.svg)](https://zod.dev/)

## Overview

The Titan validation subsystem provides runtime validation for service methods using Zod schemas. It integrates seamlessly with Netron's transport layer to provide contract-based RPC with automatic input/output validation, error handling, and OpenAPI documentation generation.

**Key Features:**

- 🎯 **Type-Safe Contracts** - Define service contracts with Zod schemas for compile-time and runtime safety
- 🚀 **High Performance** - Validator caching, lazy compilation, and fast-path execution
- 🔌 **Decorator API** - Simple `@Contract` and `@Validate` decorators
- 📡 **Streaming Support** - Validate streaming methods with async generators
- 📝 **OpenAPI Generation** - Automatic API documentation from contracts
- 🌐 **Transport Agnostic** - Works across HTTP, WebSocket, and local transports

## Table of Contents

- [Quick Start](#quick-start)
- [Core Concepts](#core-concepts)
  - [Contracts](#contracts)
  - [Validation Engine](#validation-engine)
  - [Validation Middleware](#validation-middleware)
- [Usage Guide](#usage-guide)
  - [Basic Service with Validation](#basic-service-with-validation)
  - [Decorator Patterns](#decorator-patterns)
  - [Streaming Methods](#streaming-methods)
  - [Error Handling](#error-handling)
- [Architecture](#architecture)
- [Performance](#performance)
- [API Reference](#api-reference)
- [Testing](#testing)
- [Advanced Topics](#advanced-topics)
- [Further Reading](#further-reading)

## Quick Start

Install dependencies:

```bash
yarn add zod
```

Define a contract and create a validated service:

```typescript
import { z } from 'zod';
import { Service } from '@omnitron-dev/titan';
import { Contract } from '@omnitron-dev/titan/decorators';
import { contract } from '@omnitron-dev/titan/validation';

// Define contract with Zod schemas
const CalculatorContract = contract({
  add: {
    input: z.object({
      a: z.number(),
      b: z.number(),
    }),
    output: z.number(),
  },
});

// Apply contract to service
@Service('calculator@1.0.0')
@Contract(CalculatorContract)
class CalculatorService {
  add(input: { a: number; b: number }): number {
    return input.a + input.b;
  }
}

// Expose service
await netron.peer.exposeService(new CalculatorService());

// Client usage - validation happens automatically
const calculator = await peer.queryInterface('calculator@1.0.0');
const result = await calculator.add({ a: 5, b: 3 }); // Returns 8

// Invalid input is rejected before method execution
try {
  await calculator.add({ a: 'not-a-number', b: 3 });
} catch (error) {
  // ValidationError: Expected number, received string
}
```

## Core Concepts

### Contracts

Contracts define the validation rules for service methods using Zod schemas:

```typescript
import { z } from 'zod';
import { contract } from '@omnitron-dev/titan/validation';

const UserContract = contract({
  createUser: {
    input: z.object({
      email: z.string().email(),
      age: z.number().int().min(0).max(150),
    }),
    output: z.object({
      id: z.string().uuid(),
      email: z.string(),
      age: z.number(),
    }),
    errors: {
      409: z.object({
        code: z.literal('USER_EXISTS'),
        message: z.string(),
      }),
    },
  },
});
```

**Contract Options:**

- `input` - Zod schema for method input validation
- `output` - Zod schema for method output validation
- `errors` - Zod schemas for domain error types (keyed by HTTP status)
- `stream` - Boolean flag for streaming methods
- `options` - Validation options (mode, error format, etc.)
- `http` - HTTP-specific options (status, headers, OpenAPI metadata)

### Validation Engine

The validation engine compiles and caches validators for optimal performance:

```typescript
import { ValidationEngine } from '@omnitron-dev/titan/validation';

const engine = new ValidationEngine();

// Compile a validator (cached for reuse)
const validator = engine.compile(UserSchema);

// Synchronous validation
const user = validator.validate(input);

// Async validation (for async refinements)
const user = await validator.validateAsync(input);

// Type guard
if (validator.is(data)) {
  // data is User
}
```

**Performance Features:**

- **Validator Caching** - Compiled validators are cached using WeakMap
- **Lazy Compilation** - Schemas compiled only on first use
- **Fast-path Execution** - Optimized paths for simple validations
- **Memory Efficiency** - Schema tracking without memory leaks

### Validation Middleware

Middleware wraps service methods with automatic validation:

```typescript
import { ValidationMiddleware } from '@omnitron-dev/titan/validation';

const middleware = new ValidationMiddleware(engine);

// Wrap a single method
const wrappedMethod = middleware.wrapMethod(service, 'methodName', methodContract);

// Wrap entire service
const wrappedService = middleware.wrapService(service, contract);

// Create handler with hooks
const handler = middleware.createHandler(service, contract, {
  beforeValidation: (method, input) => console.log('Validating:', method),
  afterValidation: (method, output) => console.log('Validated:', method),
  onError: (method, error) => console.error('Error:', method, error),
});
```

## Usage Guide

### Basic Service with Validation

```typescript
import { z } from 'zod';
import { Service } from '@omnitron-dev/titan';
import { Contract } from '@omnitron-dev/titan/decorators';
import { contract } from '@omnitron-dev/titan/validation';

// Define schemas
const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  username: z.string().min(3).max(20),
  age: z.number().int().min(0).max(150),
});

// Create contract
const UserContract = contract({
  createUser: {
    input: UserSchema.omit({ id: true }),
    output: UserSchema,
  },
  getUser: {
    input: z.string().uuid(),
    output: UserSchema.nullable(),
  },
  updateUser: {
    input: z.object({
      id: z.string().uuid(),
      data: UserSchema.partial().omit({ id: true }),
    }),
    output: UserSchema,
  },
});

// Implement service
@Service('user@1.0.0')
@Contract(UserContract)
class UserService {
  private users = new Map<string, any>();

  createUser(input: Omit<User, 'id'>): User {
    const user = { id: crypto.randomUUID(), ...input };
    this.users.set(user.id, user);
    return user;
  }

  getUser(id: string): User | null {
    return this.users.get(id) ?? null;
  }

  updateUser(input: { id: string; data: Partial<User> }): User {
    const user = this.users.get(input.id);
    if (!user) throw new Error('User not found');

    Object.assign(user, input.data);
    return user;
  }
}
```

### Decorator Patterns

#### Class-level Contract

Best for RPC services with centralized contract definition:

```typescript
@Service('product@1.0.0')
@Contract(ProductContract)
class ProductService {
  // All methods validated by contract
}
```

#### Method-level Validation

Useful for mixed services or overriding class-level contracts:

```typescript
@Service('data@1.0.0')
class DataService {
  @Validate({
    input: z.object({ key: z.string(), value: z.any() }),
    output: z.boolean(),
  })
  store(input: { key: string; value: any }): boolean {
    // Implementation
  }

  @ValidateInput(z.string().uuid())
  fetch(id: string): any {
    // Implementation
  }

  @ValidateOutput(z.array(z.any()))
  listAll(): any[] {
    // Implementation
  }
}
```

#### Batch Validation

Process arrays with validation controls using the `@ValidationBatch` decorator:

```typescript
import { ValidationBatch } from '@omnitron-dev/titan';

@Service('batch@1.0.0')
class BatchService {
  @ValidationBatch({
    batchSize: 100, // Process in batches of 100
    parallel: true, // Validate items in parallel
    continueOnError: false, // Stop on first error (default)
  })
  @ValidateInput(
    z.array(
      z.object({
        id: z.string(),
        value: z.number(),
      })
    )
  )
  processBatch(items: Array<{ id: string; value: number }>): void {
    // Process validated batch
  }

  @ValidationBatch({
    batchSize: 50,
    parallel: false, // Sequential validation
    continueOnError: true, // Collect all errors before failing
  })
  @ValidateInput(z.array(z.string().email()))
  validateEmails(emails: string[]): void {
    // Each email validated according to batch options
  }
}
```

**ValidationBatch Options:**

- `batchSize?: number` - Number of items to process per batch (improves memory efficiency for large arrays)
- `parallel?: boolean` - Whether to validate items in parallel (default: false, sequential)
- `continueOnError?: boolean` - Whether to continue validation after errors (default: false, abort early)

#### Global Validation Options

Apply validation options to all methods in a service:

```typescript
@Service('strict@1.0.0')
@WithValidationOptions({
  mode: 'strict', // Reject unknown fields
  abortEarly: false, // Collect all errors
  errorFormat: 'detailed', // Detailed error messages
})
@Contract(StrictContract)
class StrictService {
  // All methods use strict validation
}
```

### Streaming Methods

Validate async generator methods:

```typescript
const StreamContract = contract({
  watchEvents: {
    input: z.object({
      userId: z.string().uuid(),
      since: z.number().optional(),
    }),
    output: z.discriminatedUnion('type', [
      z.object({
        type: z.literal('user.created'),
        userId: z.string(),
        timestamp: z.number(),
      }),
      z.object({
        type: z.literal('user.updated'),
        userId: z.string(),
        changes: z.record(z.any()),
        timestamp: z.number(),
      }),
    ]),
    stream: true,
  },
});

@Service('events@1.0.0')
@Contract(StreamContract)
class EventService {
  async *watchEvents(input: { userId: string; since?: number }) {
    // Stream events as they occur
    while (true) {
      const event = await this.getNextEvent(input);
      if (event) yield event; // Each item is validated
    }
  }
}

// Or use decorator
@Service('stream@1.0.0')
class StreamService {
  @ValidateStream(z.object({ start: z.number(), end: z.number() }), z.number())
  async *generateNumbers(input: { start: number; end: number }) {
    for (let i = input.start; i <= input.end; i++) {
      yield i;
    }
  }
}
```

### Error Handling

#### Validation Errors

Validation errors are automatically caught and formatted:

```typescript
try {
  await userService.createUser({
    email: 'invalid-email',
    age: -5,
    username: 'ab',
  });
} catch (error) {
  // ValidationError with structured details:
  // {
  //   code: 'VALIDATION_ERROR',
  //   message: 'Validation failed',
  //   errors: [
  //     { path: 'email', message: 'Invalid email', code: 'invalid_string' },
  //     { path: 'age', message: 'Number must be >= 0' },
  //     { path: 'username', message: 'String must contain >= 3 characters' }
  //   ]
  // }
}
```

#### Domain Errors

Use contract error schemas for business logic errors:

```typescript
const OrderContract = contract({
  createOrder: {
    input: z.object({
      items: z.array(
        z.object({
          productId: z.string(),
          quantity: z.number().positive(),
        })
      ),
    }),
    output: z.object({
      orderId: z.string().uuid(),
      total: z.number(),
    }),
    errors: {
      400: z.object({
        code: z.literal('INSUFFICIENT_STOCK'),
        productId: z.string(),
        available: z.number(),
      }),
    },
  },
});

@Service('order@1.0.0')
@Contract(OrderContract)
class OrderService {
  createOrder(input: any) {
    // Check stock
    if (stockNotAvailable) {
      throw {
        statusCode: 400,
        data: {
          code: 'INSUFFICIENT_STOCK',
          productId: 'prod-123',
          available: 5,
        },
      };
    }
    // Process order
  }
}
```

## Architecture

The validation subsystem is an **independent, cross-cutting concern** at the same level as Netron, not a Netron-specific feature:

```
Titan Framework
├── Core Utilities (common, errors, decorators)
├── Dependency Injection (nexus)
├── Validation Subsystem ← Independent concern
├── RPC Framework (netron) ← Uses validation
├── Built-in Modules (events, config, scheduler) ← Use validation
└── Application Layer ← Uses all above
```

**Why Independent?**

1. **Reusability** - Used by Netron (HTTP transport), Events module, Config module, and application code
2. **Separation of Concerns** - Validation deals with domain logic (what data is valid), Netron deals with transport logic (how data moves)
3. **Performance** - Optimizations benefit all consumers, not just Netron
4. **Testability** - Can be tested without Netron
5. **Independent Evolution** - Validation and Netron can evolve separately

**Used by 60+ files** across Titan:

- 21 files in Netron (HTTP server, middleware, local peer)
- 39+ files outside Netron (decorators, events, config, services)

## Performance

The validation engine is optimized for high-throughput scenarios:

### Validator Caching

```typescript
// First call compiles and caches
const result1 = await userService.createUser(data1);
// ~5ms (compilation + validation)

// Subsequent calls use cached validator
const result2 = await userService.createUser(data2);
// ~0.1ms (validation only)
```

### Lazy Compilation

Validators are compiled on first use, not at service registration:

```typescript
// Fast - no compilation
await netron.peer.exposeService(new UserService());

// First request compiles validators
await userService.createUser(data); // Compilation + validation

// Subsequent requests are fast
await userService.createUser(data); // Fast validation
```

### Fast-path Execution

Simple requests skip middleware overhead:

```typescript
// No auth, no CORS, no custom middleware → Fast path
const result = await calculator.add({ a: 5, b: 3 });
// Direct method execution with validation
```

### Benchmarks

Performance characteristics (on Apple M1):

- **Simple validation**: ~100 µs
- **Complex nested schemas**: ~500 µs
- **Cached validator lookup**: ~10 µs
- **Compilation overhead**: ~5 ms (one-time per schema)

## API Reference

### Core Exports

```typescript
// From @omnitron-dev/titan/validation
export {
  // Contract system
  Contract, // CLASS - for programmatic contract creation
  MethodContract,
  contract,
  contractBuilder,
  Contracts,

  // Validation engine
  ValidationEngine,
  ValidationError,
  ServiceError,
  ValidationOptions,
  CompiledValidator,

  // Middleware
  ValidationMiddleware,
};

// From @omnitron-dev/titan/decorators
export {
  // Decorators
  Contract, // DECORATOR - for applying contracts to service classes
  Validate,
  ValidateInput,
  ValidateOutput,
  ValidateStream,
  WithValidationOptions,
  NoValidation,
};

// From @omnitron-dev/titan
export {
  // Presets
  ValidationSchemas,
  ValidationPresets,
};
```

**Important Distinction:**

- **`Contract` CLASS** (from `@omnitron-dev/titan/validation`):
  - Used internally by the validation system to represent a contract instance
  - Created via the `contract()` helper function or `contractBuilder()`
  - Programmatic API for advanced use cases
  - Example: `const myContract = contract({ ... })`

- **`@Contract()` DECORATOR** (from `@omnitron-dev/titan/decorators`):
  - Used to apply a contract to a service class
  - The recommended way to use contracts in application code
  - Applies to the entire class and validates all methods defined in the contract
  - Example: `@Contract(myContract) class MyService { ... }`

In most cases, you'll use the `contract()` helper to create a contract definition, then apply it to your service class using the `@Contract()` decorator.

### Contract Helpers

```typescript
// CRUD contract template
const UserCRUD = Contracts.crud(UserSchema);

// Streaming contract template
const EventStream = Contracts.streaming(EventSchema);

// RPC contract template
const RPC = Contracts.rpc(InputSchema, OutputSchema);

// Builder pattern
const CustomContract = contractBuilder()
  .method('method1', { input: Schema1, output: Output1 })
  .method('method2', { input: Schema2, output: Output2 })
  .withMetadata({ name: 'service', version: '1.0.0' })
  .build();
```

### ServiceError

Throw typed service errors that are validated against error schemas in contracts:

```typescript
import { ServiceError } from '@omnitron-dev/titan/validation';
import { z } from 'zod';

// Define contract with error schemas
const ProductContract = contract({
  purchase: {
    input: z.object({
      productId: z.string(),
      quantity: z.number().positive(),
    }),
    output: z.object({
      orderId: z.string(),
      total: z.number(),
    }),
    errors: {
      400: z.object({
        code: z.literal('INSUFFICIENT_STOCK'),
        productId: z.string(),
        available: z.number(),
      }),
      404: z.object({
        code: z.literal('PRODUCT_NOT_FOUND'),
        productId: z.string(),
      }),
    },
  },
});

@Service('product@1.0.0')
@Contract(ProductContract)
class ProductService {
  purchase(input: { productId: string; quantity: number }) {
    const product = this.findProduct(input.productId);

    if (!product) {
      // Throw typed 404 error
      throw new ServiceError(404, {
        code: 'PRODUCT_NOT_FOUND',
        productId: input.productId,
      });
    }

    if (product.stock < input.quantity) {
      // Throw typed 400 error
      throw new ServiceError(400, {
        code: 'INSUFFICIENT_STOCK',
        productId: input.productId,
        available: product.stock,
      });
    }

    // Process purchase...
  }
}
```

**ServiceError API:**

- `constructor(statusCode: number, data: Record<string, unknown>)` - Creates a service error with HTTP status code and error data
- `statusCode: number` - The HTTP status code (400, 404, 500, etc.)
- `data: Record<string, unknown>` - Error data that must match the error schema defined in the contract
- Extends `Error` class with standard `name` and `message` properties

**Benefits:**

- Type-safe error throwing with contract validation
- Automatic error schema validation on the server side
- Client receives typed, structured errors
- Works seamlessly with HTTP status codes and error responses

### HttpMethodOptions

Configure HTTP-specific behavior and OpenAPI documentation for contract methods:

```typescript
import { contract } from '@omnitron-dev/titan/validation';
import { z } from 'zod';

const ApiContract = contract({
  uploadFile: {
    input: z.object({
      filename: z.string(),
      content: z.instanceof(Buffer),
    }),
    output: z.object({
      url: z.string().url(),
      size: z.number(),
    }),
    http: {
      status: 201, // Custom success status code
      responseHeaders: {
        'X-Upload-Version': '1.0',
      },
      contentType: 'application/json',
      openapi: {
        summary: 'Upload a file',
        description: 'Uploads a file and returns its URL',
        tags: ['files', 'upload'],
        examples: {
          'image-upload': {
            filename: 'avatar.png',
            content: '<binary data>',
          },
        },
      },
    },
  },
  streamLogs: {
    input: z.object({
      serviceId: z.string(),
      since: z.number().optional(),
    }),
    output: z.object({
      timestamp: z.number(),
      level: z.enum(['info', 'warn', 'error']),
      message: z.string(),
    }),
    stream: true,
    http: {
      streaming: true, // Enable SSE/WebSocket streaming
      openapi: {
        summary: 'Stream service logs',
        description: 'Real-time log streaming via Server-Sent Events',
        tags: ['logs', 'monitoring'],
        deprecated: false,
      },
    },
  },
});
```

**HttpMethodOptions Fields:**

- `status?: number` - HTTP status code for successful responses (default: 200)
- `responseHeaders?: Record<string, string>` - Custom response headers
- `contentType?: string` - Response content type (default: 'application/json')
- `streaming?: boolean` - Enable streaming response (SSE, WebSocket, etc.)
- `openapi?: object` - OpenAPI documentation metadata
  - `summary?: string` - Short summary of the method
  - `description?: string` - Detailed description
  - `tags?: string[]` - OpenAPI tags for grouping
  - `deprecated?: boolean` - Mark method as deprecated
  - `examples?: Record<string, any>` - Example requests/responses

**Use Cases:**

- Custom success status codes (201 for creation, 204 for no content)
- Adding custom headers (caching, versioning, CORS)
- OpenAPI documentation generation
- Streaming endpoints (logs, events, real-time data)

### Validation Schemas

Common schemas for reuse:

```typescript
import { ValidationSchemas } from '@omnitron-dev/titan';

// Basic validators
ValidationSchemas.uuid; // string().uuid()
ValidationSchemas.email; // string().email()
ValidationSchemas.url; // string().url()
ValidationSchemas.dateString; // string().datetime()
ValidationSchemas.positiveInt; // number().int().positive()

// Pagination and filtering
ValidationSchemas.pagination; // { offset, limit }
ValidationSchemas.sort; // { field, order }
ValidationSchemas.filter; // record(string, any).optional()
ValidationSchemas.idInput; // uuid | positive int

// Response schemas
ValidationSchemas.successResponse;
ValidationSchemas.errorResponse;
ValidationSchemas.listResponse(itemSchema);

// Schema helpers
ValidationSchemas.nullable(schema); // Make any schema nullable
ValidationSchemas.optional(schema); // Make any schema optional
```

**Schema Helper Examples:**

```typescript
import { ValidationSchemas } from '@omnitron-dev/titan';
import { z } from 'zod';

// Using nullable helper
const UserSchema = z.object({
  id: ValidationSchemas.uuid,
  email: ValidationSchemas.email,
  deletedAt: ValidationSchemas.nullable(ValidationSchemas.dateString), // null | string
});

// Using optional helper
const SearchInput = z.object({
  query: z.string(),
  limit: ValidationSchemas.optional(z.number().int().positive()), // number | undefined
  offset: ValidationSchemas.optional(z.number().int().min(0)), // number | undefined
});

// Combining with built-in schemas
const GetUserOutput = ValidationSchemas.nullable(
  z.object({
    id: ValidationSchemas.uuid,
    email: ValidationSchemas.email,
    createdAt: ValidationSchemas.dateString,
  })
); // Returns User | null

// List responses with pagination
const UserListContract = contract({
  listUsers: {
    input: z.object({
      pagination: ValidationSchemas.optional(ValidationSchemas.pagination),
      filter: ValidationSchemas.filter,
      sort: ValidationSchemas.optional(ValidationSchemas.sort),
    }),
    output: ValidationSchemas.listResponse(
      z.object({
        id: ValidationSchemas.uuid,
        email: ValidationSchemas.email,
      })
    ),
  },
});
```

## Testing

The validation subsystem has **92.54% test coverage**:

```
src/validation/
├── contract.ts              100.00%
├── validation-engine.ts      86.48%
└── validation-middleware.ts  97.77%
```

### Unit Testing

Test validation without Netron:

```typescript
import { ValidationEngine } from '@omnitron-dev/titan/validation';
import { z } from 'zod';

describe('ValidationEngine', () => {
  it('should validate complex schemas', () => {
    const engine = new ValidationEngine();
    const validator = engine.compile(UserSchema);

    const validUser = { email: 'test@example.com', age: 25 };
    expect(validator.validate(validUser)).toEqual(validUser);

    const invalidUser = { email: 'not-an-email', age: -5 };
    expect(() => validator.validate(invalidUser)).toThrow(ValidationError);
  });
});
```

### Integration Testing

Test with HTTP transport:

```typescript
describe('HTTP Validation Integration', () => {
  it('should validate requests over HTTP', async () => {
    const server = new Netron(logger, { id: 'server' });
    await server.peer.exposeService(new CalculatorService());

    const client = new Netron(logger, { id: 'client' });
    const peer = await client.connect('http://localhost:3000');
    const calc = await peer.queryInterface('calculator@1.0.0');

    // Valid request
    expect(await calc.add({ a: 5, b: 3 })).toBe(8);

    // Invalid request
    await expect(calc.add({ a: 'not-a-number', b: 3 })).rejects.toThrow(ValidationError);
  });
});
```

See [test/validation/](../../test/validation/) for complete test suite.

## Advanced Topics

### Custom Error Formats

```typescript
const validator = engine.compile(schema, {
  errorFormat: 'simple', // or 'detailed'
  errorMap: (issue, ctx) => {
    // Custom error messages
    if (issue.code === 'invalid_string') {
      return { message: 'Invalid format' };
    }
    return { message: ctx.defaultError };
  },
});
```

### Validation Options

Configure validation behavior with the `ValidationOptions` interface:

```typescript
import { contract } from '@omnitron-dev/titan/validation';

const MyContract = contract({
  method: {
    input: schema,
    output: schema,
    options: {
      // Schema processing modes
      mode: 'strip', // Strip unknown fields (default)
      // mode: 'strict',        // Reject unknown fields
      // mode: 'passthrough',   // Pass through unknown fields

      // Error handling
      abortEarly: false, // Collect all errors (default: true)
      errorFormat: 'detailed', // 'simple' | 'detailed' (default: 'simple')
      errorMap: customErrorMap, // Custom error message transformer

      // Type coercion
      coerce: true, // Enable type coercion (e.g., "123" → 123)
      coerceTypes: true, // Alias for coerce

      // Unknown field handling
      stripUnknown: true, // Strip unknown fields (same as mode: 'strip')

      // Performance and caching
      cacheValidators: true, // Cache compiled validators (default: true)
      lazyCompilation: true, // Compile validators on first use (default: true)

      // Safety options
      skipValidation: false, // Never skip validation (default: false)
    },
  },
});
```

**ValidationOptions Fields:**

- **`mode?: 'strip' | 'strict' | 'passthrough'`** - How to handle unknown fields
  - `'strip'` (default): Remove unknown fields from validated data
  - `'strict'`: Throw error if unknown fields are present
  - `'passthrough'`: Keep unknown fields in validated data

- **`abortEarly?: boolean`** - Error collection behavior
  - `true` (default): Stop validation on first error
  - `false`: Collect all validation errors before throwing

- **`errorFormat?: 'simple' | 'detailed'`** - Error message format
  - `'simple'` (default): Concise error messages
  - `'detailed'`: Verbose error messages with full context

- **`errorMap?: z.ZodErrorMap`** - Custom error message transformer

- **`coerce?: boolean`** - Enable automatic type coercion (e.g., `"123"` → `123`)

- **`coerceTypes?: boolean`** - Alias for `coerce` option

- **`stripUnknown?: boolean`** - Remove unknown fields (equivalent to `mode: 'strip'`)

- **`cacheValidators?: boolean`** - Cache compiled validators for reuse (default: `true`)

- **`lazyCompilation?: boolean`** - Compile validators on first use instead of eagerly (default: `true`)

- **`skipValidation?: boolean`** - Skip validation entirely (use with caution, default: `false`)

**Usage Examples:**

```typescript
// Strict validation with all errors collected
const StrictContract = contract({
  createUser: {
    input: UserSchema,
    output: UserSchema,
    options: {
      mode: 'strict', // Reject unknown fields
      abortEarly: false, // Collect all errors
      errorFormat: 'detailed', // Detailed error messages
    },
  },
});

// Lenient validation with type coercion
const LenientContract = contract({
  search: {
    input: SearchSchema,
    output: ResultsSchema,
    options: {
      mode: 'strip', // Strip unknown fields
      coerce: true, // Auto-convert types
      abortEarly: true, // Fast fail
    },
  },
});

// High-performance validation
const FastContract = contract({
  bulkInsert: {
    input: z.array(ItemSchema),
    output: z.array(ResultSchema),
    options: {
      cacheValidators: true, // Cache validators
      lazyCompilation: true, // Compile lazily
      abortEarly: true, // Stop on first error
    },
  },
});
```

**Note on Array Coercion**: Due to Zod v4 limitations, type coercion inside arrays is disabled. For example, `z.array(z.coerce.number())` will not coerce string values to numbers within the array. If you need coercion for array elements, you must perform it manually before validation.

### Validation Presets

Use built-in presets for common patterns like authentication:

```typescript
import { ValidationPresets } from '@omnitron-dev/titan/decorators';

@Service('auth@1.0.0')
class AuthService {
  @ValidationPresets.auth.login
  async login(input: { email: string; password: string }) {
    // Authentication logic
    return { token: 'jwt...', user: { id: '123' } };
  }

  @ValidationPresets.auth.register
  async register(input: { email: string; password: string; confirmPassword: string }) {
    // Registration logic
    return { user: { id: '123' }, token: 'jwt...' };
  }

  @ValidationPresets.auth.refresh
  async refresh(input: { refreshToken: string }) {
    return { token: 'new-jwt...' };
  }
}
```

### OpenAPI Generation

Contracts automatically generate OpenAPI documentation:

```typescript
// Access OpenAPI spec
const spec = await fetch('http://localhost:3000/openapi.json');

// Contract discovery endpoint
const contracts = await fetch('http://localhost:3000/netron/discovery');
```

See [INTEGRATION.md](./INTEGRATION.md) for OpenAPI integration guide.

### Schema Composition

Reuse and compose schemas:

```typescript
const BaseUserSchema = z.object({
  email: z.string().email(),
  username: z.string().min(3).max(20),
});

const UserWithIdSchema = BaseUserSchema.extend({
  id: z.string().uuid(),
});

const CreateUserInput = BaseUserSchema;
const UpdateUserInput = BaseUserSchema.partial();
const UserOutput = UserWithIdSchema;
```

### Type Extraction

Extract TypeScript types from contracts:

```typescript
import { ContractTypes } from '@omnitron-dev/titan/validation';

type UserContract = typeof UserContract;

// Extract input type
type CreateUserInput = ContractTypes.Input<UserContract['definition']['createUser']>;

// Extract output type
type CreateUserOutput = ContractTypes.Output<UserContract['definition']['createUser']>;

// Extract service interface
type UserServiceInterface = ContractTypes.Service<UserContract>;
```

## Further Reading

### Documentation

- **[INTEGRATION.md](./INTEGRATION.md)** - Comprehensive integration guide with Netron HTTP transport
  - Request/response validation flow
  - Real-world examples (CRUD, auth, streaming, complex schemas)
  - OpenAPI generation
  - Best practices and performance considerations

### Code Examples

- **[validation-example.ts](../../../examples/validation-example.ts)** - Basic usage examples
- **[test/validation/](../../test/validation/)** - Comprehensive test suite with examples
  - Unit tests for engine, contracts, middleware
  - Integration tests with HTTP transport
  - Streaming validation tests
  - Performance tests

### External Resources

- [Zod Documentation](https://zod.dev/) - Schema validation library
- [OpenAPI Specification](https://swagger.io/specification/) - API documentation standard
- [TypeScript Handbook](https://www.typescriptlang.org/docs/) - TypeScript reference

## Contributing

When contributing to the validation subsystem:

1. **Maintain test coverage** - Aim for 90%+ coverage
2. **Follow patterns** - Use existing contract/decorator patterns
3. **Document examples** - Add real-world examples for new features
4. **Performance** - Benchmark performance-critical changes
5. **Type safety** - Ensure full TypeScript type inference

## License

MIT

---

**Version**: 1.0.0
**Last Updated**: 2025-10-09
**Test Coverage**: 92.54%
**Status**: Production Ready ✅
