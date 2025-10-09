# Titan Validation Subsystem Integration Guide

**Version**: 1.0
**Last Updated**: 2025-10-09
**Status**: Production Ready

---

## Table of Contents

1. [Introduction](#introduction)
2. [Netron HTTP Server Integration](#netron-http-server-integration)
3. [Decorator-based Validation Pattern](#decorator-based-validation-pattern)
4. [Service Contract Definition Best Practices](#service-contract-definition-best-practices)
5. [OpenAPI Generation from Contracts](#openapi-generation-from-contracts)
6. [Real-world Examples](#real-world-examples)

---

## Introduction

### What is the Validation Subsystem?

The Titan validation subsystem is an independent, high-performance component that provides runtime validation for service methods using Zod schemas. It integrates seamlessly with Netron's HTTP transport to provide contract-based RPC with automatic input/output validation, error handling, and OpenAPI documentation generation.

### Key Features

- **Type-safe Contracts**: Define service contracts with Zod schemas for compile-time and runtime safety
- **Decorator-based API**: Simple `@Contract` and `@Validate` decorators for service validation
- **Performance Optimized**: Validator caching, lazy compilation, and fast-path execution
- **Streaming Support**: Validate streaming methods with async generators
- **Error Handling**: Detailed validation errors with configurable formats
- **OpenAPI Generation**: Automatic API documentation from contracts
- **Transport Agnostic**: Works across HTTP, WebSocket, and local transports

### When to Use It

Use the validation subsystem when you need:

1. **Runtime Contract Enforcement**: Ensure clients send valid data to your services
2. **API Documentation**: Generate OpenAPI specs automatically from contracts
3. **Type Safety**: Maintain TypeScript types and runtime validation in sync
4. **Input Sanitization**: Strip unknown fields, coerce types, and validate formats
5. **Output Validation**: Guarantee your services return valid data structures
6. **Streaming Validation**: Validate each item in async generator methods

---

## Netron HTTP Server Integration

### How Contracts Work with HTTP Transport

When you define a contract and expose a service through Netron's HTTP transport:

1. **Service Registration**: The `@Contract` decorator stores validation metadata on the service class
2. **Contract Extraction**: The HTTP server extracts contracts during service registration
3. **Request Validation**: Incoming HTTP requests are validated against input schemas
4. **Method Execution**: Only valid inputs reach your service methods
5. **Response Validation**: Method outputs are validated before sending to clients
6. **Error Handling**: Validation errors are automatically mapped to HTTP 422 responses

### Request/Response Validation Flow

```
┌─────────────┐
│ HTTP Client │
└──────┬──────┘
       │
       │ POST /netron/invoke
       │ { service: "calculator", method: "add", input: { a: 5, b: 3 } }
       │
       ▼
┌──────────────────────────────────────────────────────────┐
│ HTTP Server                                               │
│                                                           │
│  1. Parse JSON body                                       │
│  2. Extract service and method                            │
│  3. Get contract for method                               │
│  4. Validate input with contract.input schema ◄──────┐   │
│  5. Execute method if valid                          │   │
│  6. Validate output with contract.output schema ◄────┼─┐ │
│  7. Return JSON response                             │ │ │
│                                                      │ │ │
└──────────────────────────────────────────────────────┼─┼─┘
                                                       │ │
                        ┌──────────────────────────────┘ │
                        │                                │
                        ▼                                ▼
              ┌─────────────────┐            ┌─────────────────┐
              │ ValidationEngine │            │ ValidationEngine │
              │ - Compile schema │            │ - Compile schema │
              │ - Cache validator│            │ - Cache validator│
              │ - Validate input │            │ - Validate output│
              └─────────────────┘            └─────────────────┘
```

### Error Handling in HTTP Context

Validation errors are automatically converted to HTTP responses:

**Input Validation Failure**:
```json
HTTP 422 Unprocessable Entity
{
  "id": "req-123",
  "error": {
    "code": "422",
    "message": "Input validation failed",
    "details": {
      "issues": [
        {
          "path": "email",
          "message": "Invalid email format",
          "code": "invalid_string"
        }
      ]
    }
  }
}
```

**Success Response**:
```json
HTTP 200 OK
{
  "id": "req-123",
  "result": { "id": "user-456", "email": "john@example.com" },
  "timestamp": 1696723200000,
  "hints": {
    "metrics": { "serverTime": 15 }
  }
}
```

### Real Code Example with HTTP Transport

```typescript
import { z } from 'zod';
import { Service } from '@omnitron-dev/titan';
import { Contract, contract } from '@omnitron-dev/titan/validation';
import { Netron, HttpTransport } from '@omnitron-dev/titan/netron';

// Define contract with Zod schemas
const CalculatorContract = contract({
  add: {
    input: z.object({
      a: z.number(),
      b: z.number()
    }),
    output: z.number(),
    http: {
      status: 200,
      contentType: 'application/json',
      openapi: {
        summary: 'Add two numbers',
        description: 'Returns the sum of a and b',
        tags: ['math']
      }
    }
  },
  divide: {
    input: z.object({
      dividend: z.number(),
      divisor: z.number().refine(val => val !== 0, {
        message: 'Divisor cannot be zero'
      })
    }),
    output: z.number(),
    errors: {
      400: z.object({
        code: z.literal('DIVISION_BY_ZERO'),
        message: z.string()
      })
    }
  }
});

// Apply contract to service
@Service('calculator@1.0.0')
@Contract(CalculatorContract)
class CalculatorService {
  add(input: { a: number; b: number }): number {
    return input.a + input.b;
  }

  divide(input: { dividend: number; divisor: number }): number {
    if (input.divisor === 0) {
      throw new Error('DIVISION_BY_ZERO: Cannot divide by zero');
    }
    return input.dividend / input.divisor;
  }
}

// Server setup
const serverNetron = new Netron(logger, { id: 'calculator-server' });
serverNetron.registerTransport('http', () => new HttpTransport());
serverNetron.registerTransportServer('http', {
  name: 'http',
  options: { host: 'localhost', port: 3000 }
});

await serverNetron.start();
await serverNetron.peer.exposeService(new CalculatorService());

// Client usage
const clientNetron = new Netron(logger, { id: 'calculator-client' });
clientNetron.registerTransport('http', () => new HttpTransport());

const peer = await clientNetron.connect('http://localhost:3000');
const calculator = await peer.queryInterface('calculator@1.0.0');

// Valid request - succeeds
const sum = await calculator.add({ a: 5, b: 3 }); // Returns 8

// Invalid request - validation fails before method execution
try {
  await calculator.add({ a: 'not-a-number', b: 3 });
} catch (error) {
  // ValidationError: Input validation failed
  // Path: a, Message: Expected number, received string
}

// Business logic error - method executed but throws
try {
  await calculator.divide({ dividend: 10, divisor: 0 });
} catch (error) {
  // Error: DIVISION_BY_ZERO: Cannot divide by zero
}
```

---

## Decorator-based Validation Pattern

### Using @Contract Decorator

The `@Contract` decorator applies a validation contract to an entire service class:

```typescript
import { z } from 'zod';
import { Service, Contract, contract } from '@omnitron-dev/titan';

const UserContract = contract({
  createUser: {
    input: z.object({
      email: z.string().email(),
      age: z.number().int().min(0).max(150),
      username: z.string().min(3).max(20)
    }),
    output: z.object({
      id: z.string().uuid(),
      email: z.string(),
      age: z.number(),
      username: z.string()
    })
  },
  getUser: {
    input: z.string().uuid(),
    output: z.object({
      id: z.string().uuid(),
      email: z.string(),
      age: z.number(),
      username: z.string()
    }).nullable()
  },
  updateUser: {
    input: z.object({
      id: z.string().uuid(),
      data: z.object({
        email: z.string().email().optional(),
        age: z.number().int().min(0).max(150).optional(),
        username: z.string().min(3).max(20).optional()
      })
    }),
    output: z.object({
      id: z.string().uuid(),
      email: z.string(),
      age: z.number(),
      username: z.string()
    })
  }
});

@Service('user@1.0.0')
@Contract(UserContract)
class UserService {
  private users = new Map<string, any>();

  createUser(input: { email: string; age: number; username: string }) {
    const user = { id: crypto.randomUUID(), ...input };
    this.users.set(user.id, user);
    return user;
  }

  getUser(id: string) {
    return this.users.get(id) ?? null;
  }

  updateUser(input: { id: string; data: any }) {
    const user = this.users.get(input.id);
    if (!user) throw new Error('User not found');

    Object.assign(user, input.data);
    return user;
  }
}
```

### Using @Validate Decorator

The `@Validate` decorator applies validation to individual methods:

```typescript
import { z } from 'zod';
import { Service, Validate } from '@omnitron-dev/titan';

@Service('string@1.0.0')
class StringService {
  @Validate({
    input: z.object({
      strings: z.array(z.string()).min(1).max(10)
    }),
    output: z.string()
  })
  concat(input: { strings: string[] }) {
    return input.strings.join('');
  }

  @Validate({
    input: z.string().min(1),
    output: z.string()
  })
  reverse(input: string) {
    return input.split('').reverse().join('');
  }
}
```

### Using @ValidateInput, @ValidateOutput, @ValidateStream

Helper decorators for common patterns:

```typescript
import { z } from 'zod';
import { Service, ValidateInput, ValidateOutput, ValidateStream } from '@omnitron-dev/titan';

@Service('data@1.0.0')
class DataService {
  // Validate input only (skip output validation)
  @ValidateInput(z.object({
    key: z.string().min(1).max(100),
    value: z.any()
  }))
  store(input: { key: string; value: any }): boolean {
    // Implementation
    return true;
  }

  // Validate output only (skip input validation)
  @ValidateOutput(z.object({
    total: z.number(),
    items: z.array(z.any())
  }))
  getStats(): any {
    return { total: 42, items: [] };
  }

  // Validate streaming method (async generator)
  @ValidateStream(
    z.object({
      start: z.number().int(),
      end: z.number().int(),
      step: z.number().int().positive().default(1)
    }),
    z.number()
  )
  async* generateNumbers(input: { start: number; end: number; step: number }) {
    for (let i = input.start; i <= input.end; i += input.step) {
      yield i;
    }
  }
}
```

### Method-level vs Class-level Contracts

**Method-level** (`@Validate`):
- Fine-grained control per method
- Useful for services with diverse validation needs
- Can override class-level contracts

**Class-level** (`@Contract`):
- Centralized contract definition
- Better for service versioning
- Easier to generate documentation
- Recommended for RPC services

```typescript
// Class-level: Recommended for RPC services
@Service('user@1.0.0')
@Contract(UserContract)
class UserService {
  // All methods validated by contract
}

// Method-level: Useful for mixed services
@Service('mixed@1.0.0')
class MixedService {
  @Validate({ input: z.string(), output: z.number() })
  processString(input: string): number {
    return input.length;
  }

  @Validate({ input: z.number(), output: z.boolean() })
  processNumber(input: number): boolean {
    return input > 0;
  }

  // No validation on this method
  internalMethod(): void {
    // Implementation
  }
}
```

---

## Service Contract Definition Best Practices

### Contract Structure

Organize contracts by service and version:

```typescript
// contracts/user-v1.contract.ts
import { z } from 'zod';
import { contract } from '@omnitron-dev/titan/validation';

export const UserContractV1 = contract({
  // Method definitions
}, {
  name: 'user',
  version: '1.0.0',
  description: 'User management service'
});
```

### Using Zod Schemas Effectively

**1. Reuse Common Schemas**:

```typescript
import { z } from 'zod';

// Define once, use many times
const EmailSchema = z.string().email();
const UuidSchema = z.string().uuid();
const PaginationSchema = z.object({
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(100).default(20)
});

const UserContract = contract({
  createUser: {
    input: z.object({
      email: EmailSchema,
      age: z.number().int().min(0).max(150)
    }),
    output: z.object({
      id: UuidSchema,
      email: EmailSchema,
      age: z.number()
    })
  },
  listUsers: {
    input: PaginationSchema,
    output: z.object({
      items: z.array(z.object({
        id: UuidSchema,
        email: EmailSchema,
        age: z.number()
      })),
      total: z.number(),
      offset: z.number(),
      limit: z.number()
    })
  }
});
```

**2. Use Schema Composition**:

```typescript
const BaseUserSchema = z.object({
  email: z.string().email(),
  username: z.string().min(3).max(20),
  age: z.number().int().min(0).max(150)
});

const UserWithIdSchema = BaseUserSchema.extend({
  id: z.string().uuid()
});

const UserContract = contract({
  createUser: {
    input: BaseUserSchema,
    output: UserWithIdSchema
  },
  updateUser: {
    input: z.object({
      id: z.string().uuid(),
      data: BaseUserSchema.partial() // All fields optional
    }),
    output: UserWithIdSchema
  }
});
```

**3. Define Clear Error Types**:

```typescript
const UserContract = contract({
  createUser: {
    input: z.object({
      email: z.string().email(),
      username: z.string().min(3)
    }),
    output: z.object({
      id: z.string().uuid(),
      email: z.string(),
      username: z.string()
    }),
    errors: {
      409: z.object({
        code: z.literal('USER_EXISTS'),
        message: z.string(),
        email: z.string().optional()
      }),
      400: z.object({
        code: z.literal('INVALID_USERNAME'),
        message: z.string(),
        suggestions: z.array(z.string()).optional()
      })
    }
  }
});
```

### Input/Output Validation

**Input Validation Best Practices**:

```typescript
const SafeInputContract = contract({
  processData: {
    input: z.object({
      // Required fields
      userId: z.string().uuid(),

      // Optional with defaults
      timeout: z.number().int().positive().default(5000),

      // Constrained strings
      category: z.enum(['user', 'admin', 'guest']),

      // Validated formats
      email: z.string().email(),
      url: z.string().url(),

      // Custom refinements
      password: z.string().min(8).refine(
        (val) => /[A-Z]/.test(val) && /[0-9]/.test(val),
        { message: 'Password must contain uppercase and number' }
      ),

      // Nested objects
      settings: z.object({
        notifications: z.boolean().default(true),
        theme: z.enum(['light', 'dark']).default('light')
      }).optional()
    }),
    output: z.object({
      success: z.boolean(),
      processedAt: z.number()
    })
  }
});
```

**Output Validation Best Practices**:

```typescript
const StrictOutputContract = contract({
  getUserProfile: {
    input: z.string().uuid(),
    output: z.object({
      // Always include all fields
      id: z.string().uuid(),
      email: z.string().email(),
      username: z.string(),

      // Use nullable for optional data
      phoneNumber: z.string().nullable(),

      // Validate nested structures
      profile: z.object({
        firstName: z.string(),
        lastName: z.string(),
        bio: z.string().max(500).nullable()
      }),

      // Validate arrays
      roles: z.array(z.enum(['user', 'admin', 'moderator'])),

      // Include timestamps
      createdAt: z.number(),
      updatedAt: z.number()
    })
  }
});
```

### Streaming Contracts

Define contracts for async generator methods:

```typescript
const StreamContract = contract({
  watchEvents: {
    input: z.object({
      userId: z.string().uuid(),
      eventTypes: z.array(z.string()).optional(),
      since: z.number().optional()
    }),
    output: z.discriminatedUnion('type', [
      z.object({
        type: z.literal('user.created'),
        userId: z.string(),
        email: z.string().email(),
        timestamp: z.number()
      }),
      z.object({
        type: z.literal('user.updated'),
        userId: z.string(),
        changes: z.record(z.any()),
        timestamp: z.number()
      }),
      z.object({
        type: z.literal('user.deleted'),
        userId: z.string(),
        timestamp: z.number()
      })
    ]),
    stream: true, // Mark as streaming method
    http: {
      streaming: true, // Enable HTTP streaming (SSE)
      contentType: 'text/event-stream'
    }
  }
});

@Service('events@1.0.0')
@Contract(StreamContract)
class EventService {
  async* watchEvents(input: { userId: string; eventTypes?: string[]; since?: number }) {
    // Stream events as they occur
    while (true) {
      const event = await this.getNextEvent(input);
      if (event) yield event;
    }
  }
}
```

### Error Handling

**Validation Error Handling**:

Validation errors are automatically caught and formatted:

```typescript
// Client receives structured error
try {
  await userService.createUser({
    email: 'invalid-email',
    age: -5,
    username: 'ab'
  });
} catch (error) {
  // error.code === 'VALIDATION_ERROR'
  // error.statusCode === 422
  // error.details.errors === [
  //   { path: 'email', message: 'Invalid email', code: 'invalid_string' },
  //   { path: 'age', message: 'Number must be greater than or equal to 0' },
  //   { path: 'username', message: 'String must contain at least 3 character(s)' }
  // ]
}
```

**Business Logic Error Handling**:

Use contract error schemas for domain errors:

```typescript
const OrderContract = contract({
  createOrder: {
    input: z.object({
      items: z.array(z.object({
        productId: z.string(),
        quantity: z.number().int().positive()
      }))
    }),
    output: z.object({
      orderId: z.string().uuid(),
      total: z.number(),
      status: z.enum(['pending', 'confirmed'])
    }),
    errors: {
      400: z.object({
        code: z.literal('INSUFFICIENT_STOCK'),
        message: z.string(),
        productId: z.string(),
        available: z.number()
      }),
      402: z.object({
        code: z.literal('PAYMENT_REQUIRED'),
        message: z.string(),
        amount: z.number()
      })
    }
  }
});
```

### Performance Considerations

**1. Validator Caching**:

The validation engine automatically caches compiled validators:

```typescript
// First call compiles and caches
const result1 = await userService.createUser({ email: 'test@example.com', age: 25, username: 'test' });

// Subsequent calls use cached validator (much faster)
const result2 = await userService.createUser({ email: 'test2@example.com', age: 30, username: 'test2' });
```

**2. Lazy Compilation**:

Validators are compiled on first use, not at service registration:

```typescript
// Service registration is fast - no compilation
await netron.peer.exposeService(new UserService());

// First request compiles validators
await calculator.add({ a: 5, b: 3 }); // Compilation + validation

// Subsequent requests use cached validators
await calculator.add({ a: 10, b: 20 }); // Fast validation only
```

**3. Validation Options**:

Control performance with validation options:

```typescript
const FastContract = contract({
  processData: {
    input: z.object({
      data: z.string()
    }),
    output: z.any(),
    options: {
      mode: 'strip', // Strip unknown fields (fastest)
      abortEarly: true, // Stop on first error (faster)
      coerce: false, // Disable type coercion (faster)
      skipValidation: false // Never skip (safety)
    }
  }
});

const StrictContract = contract({
  criticalData: {
    input: z.object({
      data: z.string()
    }),
    output: z.any(),
    options: {
      mode: 'strict', // Reject unknown fields (strictest)
      abortEarly: false, // Collect all errors (slower but more helpful)
      errorFormat: 'detailed' // Detailed error messages
    }
  }
});
```

---

## OpenAPI Generation from Contracts

### How Contracts Become OpenAPI Schemas

The HTTP server automatically generates OpenAPI 3.0 specifications from service contracts:

**Contract Definition**:
```typescript
const UserContract = contract({
  createUser: {
    input: z.object({
      email: z.string().email(),
      username: z.string().min(3).max(20)
    }),
    output: z.object({
      id: z.string().uuid(),
      email: z.string(),
      username: z.string()
    }),
    http: {
      status: 201,
      openapi: {
        summary: 'Create a new user',
        description: 'Creates a new user account with email and username',
        tags: ['users'],
        deprecated: false
      }
    }
  }
});
```

**Generated OpenAPI**:
```yaml
openapi: 3.0.3
info:
  title: Netron HTTP Services
  version: 2.0.0
paths:
  /rpc/user/createUser:
    post:
      operationId: user_createUser
      summary: Create a new user
      description: Creates a new user account with email and username
      tags:
        - users
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/user_createUser_Input'
      responses:
        '201':
          description: Successful response
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/user_createUser_Output'
        '400':
          description: Bad request - Invalid input or validation failed
        '422':
          description: Validation error
components:
  schemas:
    user_createUser_Input:
      type: object
      properties:
        email:
          type: string
          format: email
        username:
          type: string
          minLength: 3
          maxLength: 20
      required:
        - email
        - username
    user_createUser_Output:
      type: object
      properties:
        id:
          type: string
          format: uuid
        email:
          type: string
        username:
          type: string
      required:
        - id
        - email
        - username
```

### Contract Discovery Endpoint

Access all service contracts via the discovery endpoint:

**Request**:
```http
GET http://localhost:3000/netron/discovery
```

**Response**:
```json
{
  "services": {
    "user@1.0.0": {
      "name": "user",
      "version": "1.0.0",
      "methods": ["createUser", "getUser", "updateUser", "deleteUser"],
      "description": "User management service"
    },
    "calculator@1.0.0": {
      "name": "calculator",
      "version": "1.0.0",
      "methods": ["add", "subtract", "multiply", "divide"]
    }
  },
  "contracts": {
    "user@1.0.0": {
      "createUser": {
        "input": { /* Zod schema */ },
        "output": { /* Zod schema */ },
        "http": { /* HTTP config */ }
      }
    }
  },
  "server": {
    "version": "2.0.0",
    "protocol": "2.0",
    "features": ["batch", "discovery", "metrics", "health"]
  },
  "timestamp": 1696723200000
}
```

### Integration with API Documentation

**1. Access OpenAPI Spec**:

```http
GET http://localhost:3000/openapi.json
```

**2. Use with Swagger UI**:

```html
<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: 'http://localhost:3000/openapi.json',
      dom_id: '#swagger-ui'
    });
  </script>
</body>
</html>
```

**3. Generate TypeScript Client**:

```bash
# Using openapi-typescript
npx openapi-typescript http://localhost:3000/openapi.json --output ./generated/api-types.ts
```

---

## Real-world Examples

### Example 1: CRUD Service with Full Validation

```typescript
import { z } from 'zod';
import { Service, Contract, contract } from '@omnitron-dev/titan';

// Define entity schema
const ProductSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
  description: z.string().max(1000),
  price: z.number().positive(),
  stock: z.number().int().min(0),
  category: z.enum(['electronics', 'clothing', 'food', 'books']),
  tags: z.array(z.string()).max(10),
  createdAt: z.number(),
  updatedAt: z.number()
});

// Define CRUD contract
const ProductContract = contract({
  create: {
    input: ProductSchema.omit({ id: true, createdAt: true, updatedAt: true }),
    output: ProductSchema,
    errors: {
      409: z.object({
        code: z.literal('PRODUCT_EXISTS'),
        message: z.string()
      })
    },
    http: {
      status: 201,
      openapi: {
        summary: 'Create product',
        description: 'Creates a new product in the catalog',
        tags: ['products']
      }
    }
  },
  read: {
    input: z.string().uuid(),
    output: ProductSchema.nullable(),
    http: {
      openapi: {
        summary: 'Get product',
        description: 'Retrieves a product by ID',
        tags: ['products']
      }
    }
  },
  update: {
    input: z.object({
      id: z.string().uuid(),
      data: ProductSchema.partial().omit({ id: true, createdAt: true })
    }),
    output: ProductSchema,
    errors: {
      404: z.object({
        code: z.literal('PRODUCT_NOT_FOUND'),
        message: z.string()
      })
    },
    http: {
      openapi: {
        summary: 'Update product',
        description: 'Updates an existing product',
        tags: ['products']
      }
    }
  },
  delete: {
    input: z.string().uuid(),
    output: z.boolean(),
    errors: {
      404: z.object({
        code: z.literal('PRODUCT_NOT_FOUND'),
        message: z.string()
      })
    },
    http: {
      status: 204,
      openapi: {
        summary: 'Delete product',
        description: 'Deletes a product from the catalog',
        tags: ['products']
      }
    }
  },
  list: {
    input: z.object({
      offset: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(100).default(20),
      category: z.enum(['electronics', 'clothing', 'food', 'books']).optional(),
      minPrice: z.number().positive().optional(),
      maxPrice: z.number().positive().optional(),
      search: z.string().max(100).optional()
    }),
    output: z.object({
      items: z.array(ProductSchema),
      total: z.number(),
      offset: z.number(),
      limit: z.number(),
      hasMore: z.boolean()
    }),
    http: {
      openapi: {
        summary: 'List products',
        description: 'Retrieves a paginated list of products with optional filters',
        tags: ['products']
      }
    }
  }
});

@Service('product@1.0.0')
@Contract(ProductContract)
class ProductService {
  private products = new Map<string, any>();

  create(input: Omit<z.infer<typeof ProductSchema>, 'id' | 'createdAt' | 'updatedAt'>) {
    const product = {
      id: crypto.randomUUID(),
      ...input,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    this.products.set(product.id, product);
    return product;
  }

  read(id: string) {
    return this.products.get(id) ?? null;
  }

  update(input: { id: string; data: Partial<z.infer<typeof ProductSchema>> }) {
    const product = this.products.get(input.id);
    if (!product) {
      throw new Error('PRODUCT_NOT_FOUND: Product not found');
    }

    Object.assign(product, input.data, { updatedAt: Date.now() });
    return product;
  }

  delete(id: string) {
    const exists = this.products.has(id);
    if (!exists) {
      throw new Error('PRODUCT_NOT_FOUND: Product not found');
    }

    this.products.delete(id);
    return true;
  }

  list(input: {
    offset: number;
    limit: number;
    category?: string;
    minPrice?: number;
    maxPrice?: number;
    search?: string;
  }) {
    let items = Array.from(this.products.values());

    // Apply filters
    if (input.category) {
      items = items.filter(p => p.category === input.category);
    }
    if (input.minPrice) {
      items = items.filter(p => p.price >= input.minPrice!);
    }
    if (input.maxPrice) {
      items = items.filter(p => p.price <= input.maxPrice!);
    }
    if (input.search) {
      const search = input.search.toLowerCase();
      items = items.filter(p =>
        p.name.toLowerCase().includes(search) ||
        p.description.toLowerCase().includes(search)
      );
    }

    const total = items.length;
    const paginated = items.slice(input.offset, input.offset + input.limit);

    return {
      items: paginated,
      total,
      offset: input.offset,
      limit: input.limit,
      hasMore: input.offset + input.limit < total
    };
  }
}
```

### Example 2: Authentication Service

```typescript
import { z } from 'zod';
import { Service, Contract, contract } from '@omnitron-dev/titan';

const AuthContract = contract({
  register: {
    input: z.object({
      email: z.string().email(),
      password: z.string().min(8).refine(
        (val) => /[A-Z]/.test(val) && /[a-z]/.test(val) && /[0-9]/.test(val),
        { message: 'Password must contain uppercase, lowercase, and number' }
      ),
      confirmPassword: z.string(),
      firstName: z.string().min(2).max(50),
      lastName: z.string().min(2).max(50)
    }).refine(data => data.password === data.confirmPassword, {
      message: "Passwords don't match",
      path: ['confirmPassword']
    }),
    output: z.object({
      user: z.object({
        id: z.string().uuid(),
        email: z.string(),
        firstName: z.string(),
        lastName: z.string()
      }),
      token: z.string()
    }),
    errors: {
      409: z.object({
        code: z.literal('USER_EXISTS'),
        message: z.string()
      })
    },
    http: {
      status: 201,
      openapi: {
        summary: 'Register new user',
        description: 'Creates a new user account',
        tags: ['auth']
      }
    }
  },
  login: {
    input: z.object({
      email: z.string().email(),
      password: z.string()
    }),
    output: z.object({
      token: z.string(),
      refreshToken: z.string(),
      expiresAt: z.number()
    }),
    errors: {
      401: z.object({
        code: z.literal('INVALID_CREDENTIALS'),
        message: z.string()
      })
    },
    http: {
      openapi: {
        summary: 'Login',
        description: 'Authenticates user and returns access token',
        tags: ['auth']
      }
    }
  },
  refresh: {
    input: z.object({
      refreshToken: z.string()
    }),
    output: z.object({
      token: z.string(),
      expiresAt: z.number()
    }),
    errors: {
      401: z.object({
        code: z.literal('INVALID_TOKEN'),
        message: z.string()
      })
    },
    http: {
      openapi: {
        summary: 'Refresh token',
        description: 'Generates new access token from refresh token',
        tags: ['auth']
      }
    }
  },
  logout: {
    input: z.object({
      token: z.string(),
      everywhere: z.boolean().default(false)
    }),
    output: z.object({
      success: z.boolean()
    }),
    http: {
      openapi: {
        summary: 'Logout',
        description: 'Invalidates access token',
        tags: ['auth']
      }
    }
  }
});

@Service('auth@1.0.0')
@Contract(AuthContract)
class AuthService {
  private users = new Map<string, any>();
  private sessions = new Map<string, any>();

  register(input: any) {
    if (this.users.has(input.email)) {
      throw new Error('USER_EXISTS: User already exists');
    }

    const user = {
      id: crypto.randomUUID(),
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
      passwordHash: this.hashPassword(input.password)
    };

    this.users.set(input.email, user);

    const token = this.generateToken(user.id);

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName
      },
      token
    };
  }

  login(input: { email: string; password: string }) {
    const user = this.users.get(input.email);
    if (!user || !this.verifyPassword(input.password, user.passwordHash)) {
      throw new Error('INVALID_CREDENTIALS: Invalid email or password');
    }

    const token = this.generateToken(user.id);
    const refreshToken = this.generateRefreshToken(user.id);
    const expiresAt = Date.now() + 3600000; // 1 hour

    this.sessions.set(token, { userId: user.id, expiresAt });

    return { token, refreshToken, expiresAt };
  }

  refresh(input: { refreshToken: string }) {
    const userId = this.verifyRefreshToken(input.refreshToken);
    if (!userId) {
      throw new Error('INVALID_TOKEN: Invalid or expired refresh token');
    }

    const token = this.generateToken(userId);
    const expiresAt = Date.now() + 3600000;

    this.sessions.set(token, { userId, expiresAt });

    return { token, expiresAt };
  }

  logout(input: { token: string; everywhere: boolean }) {
    if (input.everywhere) {
      // Remove all sessions for this user
      const session = this.sessions.get(input.token);
      if (session) {
        for (const [token, s] of this.sessions.entries()) {
          if (s.userId === session.userId) {
            this.sessions.delete(token);
          }
        }
      }
    } else {
      this.sessions.delete(input.token);
    }

    return { success: true };
  }

  private hashPassword(password: string): string {
    // Implementation
    return `hashed_${password}`;
  }

  private verifyPassword(password: string, hash: string): boolean {
    return hash === `hashed_${password}`;
  }

  private generateToken(userId: string): string {
    return `token_${userId}_${Date.now()}`;
  }

  private generateRefreshToken(userId: string): string {
    return `refresh_${userId}_${Date.now()}`;
  }

  private verifyRefreshToken(token: string): string | null {
    // Implementation
    return token.split('_')[1] || null;
  }
}
```

### Example 3: Streaming Data Service

```typescript
import { z } from 'zod';
import { Service, Contract, contract } from '@omnitron-dev/titan';

const EventStreamContract = contract({
  watchEvents: {
    input: z.object({
      userId: z.string().uuid(),
      eventTypes: z.array(z.enum(['user.created', 'user.updated', 'user.deleted'])).optional(),
      since: z.number().optional()
    }),
    output: z.discriminatedUnion('type', [
      z.object({
        type: z.literal('user.created'),
        userId: z.string().uuid(),
        email: z.string().email(),
        timestamp: z.number()
      }),
      z.object({
        type: z.literal('user.updated'),
        userId: z.string().uuid(),
        changes: z.record(z.any()),
        timestamp: z.number()
      }),
      z.object({
        type: z.literal('user.deleted'),
        userId: z.string().uuid(),
        timestamp: z.number()
      })
    ]),
    stream: true,
    http: {
      streaming: true,
      contentType: 'text/event-stream',
      openapi: {
        summary: 'Watch user events',
        description: 'Streams real-time user events',
        tags: ['events']
      }
    }
  },
  generateReport: {
    input: z.object({
      startDate: z.number(),
      endDate: z.number(),
      format: z.enum(['csv', 'json', 'xml']).default('json')
    }),
    output: z.object({
      chunk: z.string(),
      progress: z.number().min(0).max(100),
      completed: z.boolean()
    }),
    stream: true,
    http: {
      streaming: true,
      openapi: {
        summary: 'Generate report',
        description: 'Generates report with progress updates',
        tags: ['reports']
      }
    }
  }
});

@Service('stream@1.0.0')
@Contract(EventStreamContract)
class StreamService {
  private eventLog: any[] = [];

  async* watchEvents(input: { userId: string; eventTypes?: string[]; since?: number }) {
    let lastCheck = input.since || Date.now();

    while (true) {
      // Get new events since last check
      const newEvents = this.eventLog.filter(event => {
        const typeMatch = !input.eventTypes || input.eventTypes.includes(event.type);
        const timeMatch = event.timestamp > lastCheck;
        return typeMatch && timeMatch;
      });

      // Yield each new event
      for (const event of newEvents) {
        yield event;
        lastCheck = event.timestamp;
      }

      // Wait for next batch
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  async* generateReport(input: { startDate: number; endDate: number; format: string }) {
    const totalChunks = 10;

    for (let i = 0; i < totalChunks; i++) {
      // Generate chunk
      const chunk = this.generateChunk(i, input);
      const progress = ((i + 1) / totalChunks) * 100;
      const completed = i === totalChunks - 1;

      yield {
        chunk,
        progress,
        completed
      };

      // Simulate processing delay
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  private generateChunk(index: number, input: any): string {
    // Implementation
    return `Chunk ${index + 1} data`;
  }
}
```

### Example 4: Complex Nested Schemas

```typescript
import { z } from 'zod';
import { Service, Contract, contract } from '@omnitron-dev/titan';

// Nested schema definitions
const AddressSchema = z.object({
  street: z.string().min(1),
  city: z.string().min(1),
  state: z.string().length(2),
  postalCode: z.string().regex(/^\d{5}(-\d{4})?$/)
});

const PaymentMethodSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('credit_card'),
    cardNumber: z.string().regex(/^\d{16}$/),
    expiryMonth: z.number().int().min(1).max(12),
    expiryYear: z.number().int().min(2025),
    cvv: z.string().regex(/^\d{3,4}$/)
  }),
  z.object({
    type: z.literal('bank_account'),
    accountNumber: z.string(),
    routingNumber: z.string().regex(/^\d{9}$/)
  }),
  z.object({
    type: z.literal('digital_wallet'),
    provider: z.enum(['paypal', 'apple_pay', 'google_pay']),
    walletId: z.string()
  })
]);

const OrderItemSchema = z.object({
  productId: z.string().uuid(),
  name: z.string(),
  quantity: z.number().int().positive(),
  price: z.number().positive(),
  discount: z.number().min(0).max(1).default(0),
  metadata: z.record(z.any()).optional()
});

const OrderContract = contract({
  createOrder: {
    input: z.object({
      customer: z.object({
        id: z.string().uuid(),
        email: z.string().email(),
        shippingAddress: AddressSchema,
        billingAddress: AddressSchema.optional()
      }),
      items: z.array(OrderItemSchema).min(1).max(50),
      paymentMethod: PaymentMethodSchema,
      shippingMethod: z.enum(['standard', 'express', 'overnight']),
      notes: z.string().max(500).optional(),
      metadata: z.record(z.any()).optional()
    }),
    output: z.object({
      orderId: z.string().uuid(),
      orderNumber: z.string(),
      status: z.enum(['pending', 'confirmed', 'processing', 'shipped', 'delivered']),
      subtotal: z.number(),
      tax: z.number(),
      shipping: z.number(),
      total: z.number(),
      estimatedDelivery: z.number(),
      trackingUrl: z.string().url().nullable()
    }),
    errors: {
      400: z.object({
        code: z.literal('INVALID_PAYMENT'),
        message: z.string()
      }),
      409: z.object({
        code: z.literal('INSUFFICIENT_STOCK'),
        message: z.string(),
        items: z.array(z.object({
          productId: z.string(),
          requested: z.number(),
          available: z.number()
        }))
      })
    },
    http: {
      status: 201,
      openapi: {
        summary: 'Create order',
        description: 'Creates a new order with payment and shipping details',
        tags: ['orders']
      }
    }
  }
});

@Service('order@1.0.0')
@Contract(OrderContract)
class OrderService {
  createOrder(input: any) {
    // Calculate totals
    const subtotal = input.items.reduce((sum: number, item: any) => {
      const itemTotal = item.quantity * item.price * (1 - item.discount);
      return sum + itemTotal;
    }, 0);

    const tax = subtotal * 0.08; // 8% tax
    const shipping = this.calculateShipping(input.shippingMethod);
    const total = subtotal + tax + shipping;

    // Create order
    const order = {
      orderId: crypto.randomUUID(),
      orderNumber: `ORD-${Date.now()}`,
      status: 'pending' as const,
      subtotal,
      tax,
      shipping,
      total,
      estimatedDelivery: this.calculateDelivery(input.shippingMethod),
      trackingUrl: null
    };

    return order;
  }

  private calculateShipping(method: string): number {
    const rates = { standard: 5.99, express: 12.99, overnight: 24.99 };
    return rates[method as keyof typeof rates] || 0;
  }

  private calculateDelivery(method: string): number {
    const days = { standard: 7, express: 3, overnight: 1 };
    return Date.now() + days[method as keyof typeof days] * 86400000;
  }
}
```

### Example 5: Error Scenarios

```typescript
import { z } from 'zod';
import { Service, Contract, contract } from '@omnitron-dev/titan';

const FileContract = contract({
  uploadFile: {
    input: z.object({
      fileName: z.string().min(1).max(255).regex(/^[\w\-. ]+$/),
      content: z.string().max(10 * 1024 * 1024), // 10MB limit
      contentType: z.string().regex(/^[\w\-]+\/[\w\-+.]+$/),
      tags: z.array(z.string()).max(10).optional()
    }),
    output: z.object({
      fileId: z.string().uuid(),
      fileName: z.string(),
      size: z.number(),
      url: z.string().url(),
      uploadedAt: z.number()
    }),
    errors: {
      400: z.object({
        code: z.literal('INVALID_FILE_TYPE'),
        message: z.string(),
        allowedTypes: z.array(z.string())
      }),
      413: z.object({
        code: z.literal('FILE_TOO_LARGE'),
        message: z.string(),
        maxSize: z.number(),
        actualSize: z.number()
      }),
      507: z.object({
        code: z.literal('INSUFFICIENT_STORAGE'),
        message: z.string(),
        available: z.number()
      })
    },
    http: {
      openapi: {
        summary: 'Upload file',
        description: 'Uploads a file to storage',
        tags: ['files']
      }
    }
  }
});

@Service('file@1.0.0')
@Contract(FileContract)
class FileService {
  private allowedTypes = ['image/jpeg', 'image/png', 'application/pdf'];
  private maxSize = 10 * 1024 * 1024; // 10MB
  private availableStorage = 1024 * 1024 * 1024; // 1GB

  uploadFile(input: { fileName: string; content: string; contentType: string; tags?: string[] }) {
    // Validate file type
    if (!this.allowedTypes.includes(input.contentType)) {
      throw {
        statusCode: 400,
        data: {
          code: 'INVALID_FILE_TYPE',
          message: `File type ${input.contentType} not allowed`,
          allowedTypes: this.allowedTypes
        }
      };
    }

    // Validate file size
    const size = Buffer.byteLength(input.content, 'utf-8');
    if (size > this.maxSize) {
      throw {
        statusCode: 413,
        data: {
          code: 'FILE_TOO_LARGE',
          message: `File size ${size} exceeds maximum ${this.maxSize}`,
          maxSize: this.maxSize,
          actualSize: size
        }
      };
    }

    // Check storage
    if (size > this.availableStorage) {
      throw {
        statusCode: 507,
        data: {
          code: 'INSUFFICIENT_STORAGE',
          message: 'Not enough storage available',
          available: this.availableStorage
        }
      };
    }

    // Create file record
    const file = {
      fileId: crypto.randomUUID(),
      fileName: input.fileName,
      size,
      url: `https://storage.example.com/files/${crypto.randomUUID()}`,
      uploadedAt: Date.now()
    };

    this.availableStorage -= size;

    return file;
  }
}

// Client usage with error handling
async function uploadWithErrorHandling() {
  const fileService = await peer.queryInterface('file@1.0.0');

  try {
    const result = await fileService.uploadFile({
      fileName: 'document.pdf',
      content: 'base64-encoded-content',
      contentType: 'application/pdf',
      tags: ['important', 'contract']
    });

    console.log('File uploaded:', result);
  } catch (error: any) {
    if (error.statusCode === 400 && error.data?.code === 'INVALID_FILE_TYPE') {
      console.error('Invalid file type. Allowed:', error.data.allowedTypes);
    } else if (error.statusCode === 413 && error.data?.code === 'FILE_TOO_LARGE') {
      console.error(`File too large: ${error.data.actualSize} > ${error.data.maxSize}`);
    } else if (error.statusCode === 507 && error.data?.code === 'INSUFFICIENT_STORAGE') {
      console.error(`Storage full. Available: ${error.data.available} bytes`);
    } else {
      console.error('Upload failed:', error);
    }
  }
}
```

---

## Summary

The Titan validation subsystem provides a robust, high-performance solution for contract-based RPC with:

- **Seamless Netron Integration**: Automatic validation for HTTP transport
- **Developer-Friendly API**: Simple decorators and Zod schemas
- **Production Ready**: Caching, error handling, and performance optimizations
- **Full Documentation**: OpenAPI generation and contract discovery

For more information, see:
- [Validation Subsystem README](./README.md) - Complete guide and API reference
- [Validation Engine API](./validation-engine.ts)
- [Contract API](./contract.ts)
- [Validation Middleware](./validation-middleware.ts)

**Last Updated**: 2025-10-09
**Version**: 1.0
