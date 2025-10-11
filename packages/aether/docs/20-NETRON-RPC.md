# 20. Netron RPC

> **Note**: Aether uses the external `@omnitron-dev/netron-browser` package for browser-based RPC communication. See [NETRON-MIGRATION-NOTICE.md](./NETRON-MIGRATION-NOTICE.md) for details on this architectural decision.

## Table of Contents

- [Overview](#overview)
- [Philosophy](#philosophy)
- [Architecture](#architecture)
- [Basic RPC](#basic-rpc)
- [Service Exposure](#service-exposure)
- [Client Usage](#client-usage)
- [Using Netron in Stores](#using-netron-in-stores)
- [Streaming](#streaming)
- [Authentication](#authentication)
- [Error Handling](#error-handling)
- [Interceptors](#interceptors)
- [Caching](#caching)
- [Performance](#performance)
- [Type Safety](#type-safety)
- [WebSocket Transport](#websocket-transport)
- [Best Practices](#best-practices)
- [Advanced Patterns](#advanced-patterns)
- [API Reference](#api-reference)
- [Examples](#examples)

## Overview

Netron RPC is the **communication layer** between Aether frontend and Titan backend. It provides:

- 🔄 **Type-safe RPC**: Full TypeScript type inference
- ⚡ **WebSocket & HTTP**: Multiple transport protocols
- 📡 **Streaming**: Bi-directional streaming support
- 🔐 **Authentication**: Built-in auth support
- 🎯 **Automatic routing**: No manual API endpoints
- 📦 **Serialization**: Efficient binary serialization (MessagePack)
- 🚀 **Performance**: Optimized for low latency

### How It Works

```
Frontend (Aether)          Netron RPC          Backend (Titan)
─────────────────         ──────────         ────────────────

const service =           ┌─────────┐         @Injectable()
  useRPC(UserService)     │ Netron  │         class UserService {
                          │         │           @Public()
service.findById(1) ──────┤ Encode  │           async findById(id) {
                          │ Route   │             return user;
                          │ Decode  │           }
user ◄────────────────────┤         │         }
                          └─────────┘
```

### Quick Example

```typescript
// Backend: Expose service
@Injectable()
export class UserService {
  @Public() // Expose via RPC
  async findById(id: string): Promise<User> {
    return await db.users.findUnique({ where: { id } });
  }

  @Public()
  async create(data: CreateUserDto): Promise<User> {
    return await db.users.create({ data });
  }
}

// Frontend: Call service
import { useRPC } from 'aether/titan';
import { UserService } from '@/services/user.service';

const userService = useRPC(UserService);

// Type-safe RPC call
const user = await userService.findById('123');
//    ^? User (automatic type inference!)

// Create user
const newUser = await userService.create({
  name: 'Alice',
  email: 'alice@example.com'
});
```

## Philosophy

### Zero Boilerplate

**No manual API routes**:

```typescript
// ❌ Traditional (manual REST API)
// Backend
app.post('/api/users', async (req, res) => {
  const user = await userService.create(req.body);
  res.json(user);
});

// Frontend
const user = await fetch('/api/users', {
  method: 'POST',
  body: JSON.stringify(data)
}).then(r => r.json());

// ✅ Netron RPC (automatic)
// Backend
@Public()
async create(data: CreateUserDto) {
  return await db.users.create({ data });
}

// Frontend
const user = await userService.create(data);
```

### Type Safety

**End-to-end type safety**:

```typescript
// Backend
@Public()
async findById(id: string): Promise<User> {
  return await db.users.findUnique({ where: { id } });
}

// Frontend
const user = await userService.findById('123');
//    ^? User

// TypeScript knows the return type!
// No manual type annotations needed
```

### Progressive Enhancement

**Works everywhere**:

```typescript
// Server: Direct call (no RPC overhead)
const userService = inject(UserService);
const user = await userService.findById('123');

// Client: RPC call (automatic)
const userService = useRPC(UserService);
const user = await userService.findById('123');

// Same interface, different implementation
```

### Protocol Agnostic

**Multiple transports**:

```typescript
// HTTP (default)
const service = useRPC(UserService, {
  transport: 'http'
});

// WebSocket (real-time)
const service = useRPC(UserService, {
  transport: 'websocket'
});

// Automatic (HTTP for queries, WS for mutations)
const service = useRPC(UserService, {
  transport: 'auto'
});
```

## Architecture

### Layered Design

Netron RPC has a modular, layered architecture designed for flexibility and performance:

```
┌─────────────────────────────────────────────────────────────┐
│                    Application Layer                         │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐            │
│  │ UserStore  │  │ CartStore  │  │ OrderStore │            │
│  │            │  │            │  │            │            │
│  │ @Query     │  │ @Mutation  │  │ @Subscribe │            │
│  │ @Mutation  │  │ @Subscribe │  │ @Query     │            │
│  └────────────┘  └────────────┘  └────────────┘            │
└─────────────────────────────────────────────────────────────┘
         │                 │                 │
         └─────────────────┴─────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              NetronStoreAdapter (Bridge Layer)               │
│  • Decorator Runtime (@Query, @Mutation, @Subscribe)        │
│  • Cache Management (Stale-While-Revalidate)                │
│  • Optimistic Updates (Rollback, Retry)                     │
│  • Real-Time Subscriptions (WebSocket Upgrade)              │
│  • Middleware Integration (Auth, Logging, Metrics)          │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│            UnifiedNetronClient (Transport Layer)             │
│  • Auto-select WebSocket or HTTP                            │
│  • Fallback on transport failure                            │
│  • Connection pooling & management                          │
└─────────────────────────────────────────────────────────────┘
         │                                      │
    ┌────┴────┐                        ┌───────┴────────┐
    ▼         ▼                        ▼                ▼
┌──────┐  ┌──────┐               ┌──────────┐   ┌──────────┐
│  WS  │  │ HTTP │               │  Cache   │   │Optimistic│
│Peer  │  │ Peer │               │ Manager  │   │  Update  │
└──────┘  └──────┘               └──────────┘   └──────────┘
    │         │                        │                │
    └─────────┴────────────────────────┴────────────────┘
                           │
                           ▼
                  ┌──────────────────┐
                  │ Backend Services │
                  │  (Titan + Netron)│
                  └──────────────────┘
```

### Two Usage Patterns

Netron supports two complementary patterns:

#### 1. **Direct RPC** (Low-level, explicit)

```typescript
// Manual service access
const userService = useRPC(UserService);
const users = await userService.findAll();

// Full control, manual cache management
```

**Best for:**
- One-off RPC calls
- Direct service access
- Custom cache logic
- Non-store components

#### 2. **Store Integration** (High-level, declarative)

```typescript
// Automatic RPC with decorators
@Store()
class UserStore {
  @Query({
    service: 'UserService@1.0.0',
    method: 'findAll',
    cacheTime: 5 * 60 * 1000
  })
  async loadUsers(): Promise<User[]> {}
}

// Automatic caching, optimistic updates, subscriptions
```

**Best for:**
- State management
- Automatic caching
- Optimistic updates
- Real-time subscriptions
- Cross-cutting concerns (auth, logging)

### Transport Architecture

**WebSocket Transport:**
```typescript
NetronClient → WebSocket → RemotePeer → MessagePack Packets
```

- Binary protocol (MessagePack)
- Real-time bidirectional communication
- Event subscriptions
- Service discovery via `query_interface` task
- Stream support

**HTTP Transport:**
```typescript
HttpNetronClient → HTTP/fetch → HttpRemotePeer → JSON Messages
```

- JSON messaging (OpenAPI-compatible)
- Stateless request/response
- Auth-aware service discovery via `/netron/query-interface`
- Request/response interceptors
- Cache hints support

### Service Discovery

**Auth-Aware On-Demand Discovery:**

```typescript
// 1. Client requests service
await client.queryInterface('UserService@1.0.0')

// 2. Check local cache
if (definitionCache.has('UserService@1.0.0')) {
  return cached definition
}

// 3. Query remote peer (auth-aware)
// - RemotePeer: WebSocket task 'query_interface'
// - HttpRemotePeer: POST /netron/query-interface

// 4. Server validates authorization and returns accessible methods
// - Respects @Authorized decorator
// - Filters methods based on user roles

// 5. Cache definition and create interface proxy
definitionCache.set(serviceName, definition)
return Interface.create(definition, peer)
```

**Benefits:**
- No pre-fetching (faster connection)
- Respects authorization rules
- Type-safe proxy generation
- Automatic cache management

### Advanced Features

For detailed architecture and implementation, see:
- [NETRON-STORE-ARCHITECTURE.md](./NETRON-STORE-ARCHITECTURE.md) - Comprehensive architectural design
- [19-TITAN-INTEGRATION.md](./19-TITAN-INTEGRATION.md) - Backend integration patterns

## Basic RPC

### Service Definition

Define backend service:

```typescript
// services/user.service.ts
import { Injectable, Public } from '@omnitron-dev/titan';

@Injectable()
export class UserService {
  constructor(private db: DatabaseService) {}

  @Public() // Expose via RPC
  async findAll(): Promise<User[]> {
    return await this.db.users.findMany();
  }

  @Public()
  async findById(id: string): Promise<User> {
    return await this.db.users.findUnique({ where: { id } });
  }

  @Public()
  async create(data: CreateUserDto): Promise<User> {
    return await this.db.users.create({ data });
  }

  // Private method (NOT exposed via RPC)
  private async hashPassword(password: string): Promise<string> {
    return await bcrypt.hash(password, 10);
  }
}
```

### Client Usage

Call service from frontend:

```typescript
// components/UserList.tsx
import { useRPC } from 'aether/titan';
import { UserService } from '@/services/user.service';

export const UserList = defineComponent(() => {
  const userService = useRPC(UserService);

  const [users] = resource(() => userService.findAll());

  return () => (
    <ul>
      {#each users() as user}
        <li>{user.name}</li>
      {/each}
    </ul>
  );
});
```

### Method Arguments

Pass arguments to RPC methods:

```typescript
// Backend
@Public()
async search(query: string, limit: number = 10): Promise<User[]> {
  return await this.db.users.findMany({
    where: { name: { contains: query } },
    take: limit
  });
}

// Frontend
const results = await userService.search('alice', 20);
```

### Return Values

Return values are automatically serialized:

```typescript
// Backend
@Public()
async getStats(): Promise<{
  totalUsers: number;
  activeUsers: number;
  registeredToday: number;
}> {
  return {
    totalUsers: await this.db.users.count(),
    activeUsers: await this.db.users.count({ where: { active: true } }),
    registeredToday: await this.db.users.count({
      where: { createdAt: { gte: startOfDay(new Date()) } }
    })
  };
}

// Frontend
const stats = await userService.getStats();
console.log(stats.totalUsers); // Type-safe!
```

## Service Exposure

### @Public Decorator

Expose methods publicly:

```typescript
@Injectable()
export class ProductService {
  @Public() // ✅ Exposed to all
  async findAll() {
    return await this.db.products.findMany();
  }

  // ❌ NOT exposed (no decorator)
  async findInternal() {
    return await this.db.products.findMany({ where: { internal: true } });
  }
}
```

### @Authorized Decorator

Require authentication:

```typescript
import { Authorized, CurrentUser } from '@omnitron-dev/titan';

@Injectable()
export class UserService {
  @Public()
  @Authorized() // Requires authentication
  async getProfile(@CurrentUser() userId: string) {
    return await this.db.users.findUnique({ where: { id: userId } });
  }

  @Public()
  @Authorized({ roles: ['admin'] }) // Requires admin role
  async deleteUser(id: string) {
    return await this.db.users.delete({ where: { id } });
  }
}
```

### Service Versioning

Version services:

```typescript
@Injectable()
@ServiceVersion('1.0.0')
export class UserService {
  @Public()
  async findById(id: string) {
    return await this.db.users.findUnique({ where: { id } });
  }
}

@Injectable()
@ServiceVersion('2.0.0')
export class UserServiceV2 {
  @Public()
  async findById(id: string) {
    // New implementation
    return await this.db.users.findUnique({
      where: { id },
      include: { profile: true }
    });
  }
}

// Frontend: Choose version
const userService = useRPC(UserService, { version: '2.0.0' });
```

## Client Usage

### useRPC Hook

Use RPC services in components:

```typescript
import { useRPC } from 'aether/titan';
import { UserService } from '@/services/user.service';

export default defineComponent(() => {
  const userService = useRPC(UserService);

  const fetchUser = async (id: string) => {
    return await userService.findById(id);
  };

  return () => <div>...</div>;
});
```

### With Resources

Integrate with resource:

```typescript
const userService = useRPC(UserService);

const [users] = resource(() => userService.findAll());

return () => (
  <div>
    {#if users.loading}
      <Spinner />
    {:else if users.error}
      <Error message={users.error.message} />
    {:else}
      <UserList users={users()} />
    {/if}
  </div>
);
```

### Configuration

Configure RPC client:

```typescript
const userService = useRPC(UserService, {
  // Transport protocol
  transport: 'websocket',

  // Endpoint
  endpoint: 'https://api.example.com',

  // Timeout
  timeout: 5000,

  // Retry
  retry: {
    attempts: 3,
    delay: 1000
  },

  // Headers
  headers: {
    'X-Custom-Header': 'value'
  }
});
```

## Using Netron in Stores

For comprehensive information on using Netron RPC within state management stores, see **[10-STATE-MANAGEMENT.md](./10-STATE-MANAGEMENT.md)**.

### Quick Example

```typescript
import { Injectable, signal } from 'aether';
import { NetronClient } from 'aether/netron'; // Re-exported from @omnitron-dev/netron-browser

interface IUserService {
  getUsers(): Promise<User[]>;
  createUser(data: CreateUserDto): Promise<User>;
}

@Injectable()
export class UserStore {
  private users = signal<User[]>([]);

  constructor(private netron: NetronClient) {
    // Subscribe to real-time events
    this.netron.subscribe('user.created', (user: User) => {
      this.users.set([...this.users(), user]);
    });
  }

  async loadUsers() {
    // Type-safe RPC call
    const service = await this.netron.queryInterface<IUserService>('UserService@1.0.0');
    const users = await service.getUsers();
    this.users.set(users);
  }

  async createUser(data: CreateUserDto) {
    const service = await this.netron.queryInterface<IUserService>('UserService@1.0.0');
    const user = await service.createUser(data);
    this.users.set([...this.users(), user]);
    return user;
  }

  getUsers() {
    return this.users;
  }
}
```

**Key Points:**

1. **External Package** - Uses `@omnitron-dev/netron-browser` (re-exported by Aether)
2. **Explicit Control** - Developer manages state updates
3. **Type Safety** - TypeScript interfaces for services
4. **Fluent API** - Direct method calls via `queryInterface()`
5. **Real-Time** - WebSocket subscriptions for live updates

See [10-STATE-MANAGEMENT.md](./10-STATE-MANAGEMENT.md) for complete patterns including:
- Optimistic updates
- Caching strategies
- Error handling
- Async data with `resource()`
- Best practices

### Package Information

Aether re-exports the Netron browser client from `@omnitron-dev/netron-browser` for convenience. You can:

1. **Use Aether's re-export** (recommended for Aether apps):
   ```typescript
   import { NetronClient } from '@omnitron-dev/aether/netron';
   ```

2. **Import directly** (for standalone usage or other frameworks):
   ```typescript
   import { NetronClient } from '@omnitron-dev/netron-browser';
   ```

Both methods provide the same API and functionality. See [NETRON-CLIENT-GUIDE.md](./NETRON-CLIENT-GUIDE.md) for complete documentation.


## Streaming

### Server Streaming

Stream data from server to client:

```typescript
// Backend
@Injectable()
export class LogService {
  @Public()
  async *streamLogs(): AsyncGenerator<LogEntry> {
    const stream = this.logStream();

    for await (const log of stream) {
      yield log;
    }
  }
}

// Frontend
const logService = useRPC(LogService);

onMount(async () => {
  const stream = await logService.streamLogs();

  for await (const log of stream) {
    console.log(log);
  }
});
```

### Client Streaming

Stream data from client to server:

```typescript
// Backend
@Injectable()
export class UploadService {
  @Public()
  async uploadFile(chunks: AsyncIterable<Uint8Array>): Promise<string> {
    const file = await this.assembleChunks(chunks);
    return await this.saveFile(file);
  }
}

// Frontend
const uploadService = useRPC(UploadService);

async function* readFile(file: File) {
  const chunkSize = 64 * 1024; // 64KB chunks
  let offset = 0;

  while (offset < file.size) {
    const chunk = file.slice(offset, offset + chunkSize);
    yield new Uint8Array(await chunk.arrayBuffer());
    offset += chunkSize;
  }
}

const fileId = await uploadService.uploadFile(readFile(file));
```

### Bi-directional Streaming

Stream in both directions:

```typescript
// Backend
@Injectable()
export class ChatService {
  @Public()
  async *chat(
    messages: AsyncIterable<ChatMessage>
  ): AsyncGenerator<ChatResponse> {
    for await (const message of messages) {
      const response = await this.processMessage(message);
      yield response;
    }
  }
}

// Frontend
const chatService = useRPC(ChatService);

const { send, receive } = await chatService.chat();

// Send messages
send({ text: 'Hello', userId: '123' });

// Receive responses
for await (const response of receive) {
  console.log(response.text);
}
```

## Authentication

### Token-Based Auth

Use JWT tokens:

```typescript
// Configure auth globally
import { configureRPC } from 'aether/titan';

configureRPC({
  beforeRequest: (request) => {
    const token = localStorage.getItem('token');
    if (token) {
      request.headers.set('Authorization', `Bearer ${token}`);
    }
  }
});

// Backend validates token
@Injectable()
export class UserService {
  @Public()
  @Authorized()
  async getProfile(@CurrentUser() userId: string) {
    return await this.db.users.findUnique({ where: { id: userId } });
  }
}
```

### Session-Based Auth

Use sessions:

```typescript
// Configure RPC with credentials
configureRPC({
  credentials: 'include' // Send cookies
});

// Backend uses session
@Injectable()
export class AuthService {
  @Public()
  async login(email: string, password: string) {
    const user = await this.validateCredentials(email, password);

    // Set session cookie
    this.session.set('userId', user.id);

    return user;
  }
}
```

### OAuth Integration

Integrate OAuth:

```typescript
// Backend
@Injectable()
export class AuthService {
  @Public()
  async loginWithGoogle(code: string) {
    const tokens = await this.googleOAuth.getTokens(code);
    const profile = await this.googleOAuth.getProfile(tokens.access_token);

    const user = await this.findOrCreateUser(profile);

    return {
      user,
      token: this.jwt.sign({ userId: user.id })
    };
  }
}

// Frontend
const authService = useRPC(AuthService);

const handleGoogleLogin = async (code: string) => {
  const { user, token } = await authService.loginWithGoogle(code);

  localStorage.setItem('token', token);
  setCurrentUser(user);
};
```

## Error Handling

### RPC Errors

Handle RPC errors:

```typescript
// Backend
@Injectable()
export class UserService {
  @Public()
  async findById(id: string) {
    const user = await this.db.users.findUnique({ where: { id } });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }
}

// Frontend
try {
  const user = await userService.findById('123');
} catch (error) {
  if (error instanceof NotFoundException) {
    toast.error('User not found');
  } else if (error instanceof UnauthorizedException) {
    navigate('/login');
  } else {
    toast.error('Something went wrong');
  }
}
```

### Error Types

Built-in error types:

```typescript
import {
  NotFoundException,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
  InternalServerException
} from '@omnitron-dev/titan';

// Backend
@Public()
async deleteUser(id: string) {
  const user = await this.db.users.findUnique({ where: { id } });

  if (!user) {
    throw new NotFoundException('User not found');
  }

  if (!this.hasPermission('delete:user')) {
    throw new ForbiddenException('Not allowed to delete users');
  }

  return await this.db.users.delete({ where: { id } });
}
```

### Custom Errors

Define custom errors:

```typescript
// errors/user-suspended.error.ts
export class UserSuspendedException extends Error {
  constructor(public reason: string) {
    super(`User suspended: ${reason}`);
  }
}

// Backend
@Public()
async login(email: string, password: string) {
  const user = await this.findByEmail(email);

  if (user.suspended) {
    throw new UserSuspendedException(user.suspensionReason);
  }

  return user;
}

// Frontend
try {
  await authService.login(email, password);
} catch (error) {
  if (error instanceof UserSuspendedException) {
    toast.error(`Account suspended: ${error.reason}`);
  }
}
```

## Interceptors

### Request Interceptor

Intercept outgoing requests:

```typescript
import { useRPCInterceptor } from 'aether/titan';

useRPCInterceptor({
  request: async (request) => {
    // Add auth header
    const token = localStorage.getItem('token');
    if (token) {
      request.headers.set('Authorization', `Bearer ${token}`);
    }

    // Log request
    console.log('RPC Request:', request.method, request.params);

    return request;
  }
});
```

### Response Interceptor

Intercept incoming responses:

```typescript
useRPCInterceptor({
  response: async (response) => {
    // Log response
    console.log('RPC Response:', response.result);

    // Track analytics
    analytics.track('rpc_call', {
      method: response.method,
      duration: response.duration
    });

    return response;
  }
});
```

### Error Interceptor

Intercept errors:

```typescript
useRPCInterceptor({
  error: async (error) => {
    // Refresh token on 401
    if (error.code === 401) {
      const newToken = await refreshToken();
      localStorage.setItem('token', newToken);

      // Retry request
      return error.retry();
    }

    // Log error
    console.error('RPC Error:', error);

    throw error;
  }
});
```

## Caching

### Response Caching

Cache RPC responses:

```typescript
const userService = useRPC(UserService, {
  cache: {
    enabled: true,
    ttl: 60 * 5, // 5 minutes
    key: (method, args) => `user:${method}:${JSON.stringify(args)}`
  }
});

// First call: Fetches from server
const user1 = await userService.findById('123');

// Second call: Returns from cache (if within TTL)
const user2 = await userService.findById('123');
```

### Invalidation

Invalidate cache:

```typescript
import { invalidateRPCCache } from 'aether/titan';

// Invalidate specific method
await invalidateRPCCache(UserService, 'findById', ['123']);

// Invalidate all methods
await invalidateRPCCache(UserService);

// Invalidate by pattern
await invalidateRPCCache(UserService, /^find/);
```

### SWR (Stale-While-Revalidate)

Use SWR pattern:

```typescript
const [user] = resource(
  () => userId(),
  (id) => userService.findById(id),
  {
    swr: {
      enabled: true,
      staleTime: 60 * 1000, // 1 minute
      cacheTime: 60 * 5 * 1000 // 5 minutes
    }
  }
);

// Returns stale data immediately, revalidates in background
```

## Performance

### Batching

Batch multiple requests:

```typescript
import { batchRPC } from 'aether/titan';

// Individual calls (3 round trips)
const user1 = await userService.findById('1');
const user2 = await userService.findById('2');
const user3 = await userService.findById('3');

// Batched (1 round trip)
const [user1, user2, user3] = await batchRPC([
  () => userService.findById('1'),
  () => userService.findById('2'),
  () => userService.findById('3')
]);
```

### Compression

Enable compression:

```typescript
configureRPC({
  compression: {
    enabled: true,
    threshold: 1024 // Compress responses > 1KB
  }
});
```

### Debouncing

Debounce RPC calls:

```typescript
import { debounce } from 'aether/utils';

const userService = useRPC(UserService);

const debouncedSearch = debounce(
  (query: string) => userService.search(query),
  300
);

<input onInput={e => debouncedSearch(e.target.value)} />
```

## Type Safety

### Automatic Type Inference

Types flow automatically:

```typescript
// Backend
@Public()
async findById(id: string): Promise<User> {
  return await this.db.users.findUnique({ where: { id } });
}

// Frontend
const user = await userService.findById('123');
//    ^? User (automatic!)

user.name // ✅ TypeScript knows this exists
user.invalid // ❌ Type error
```

### Generic Methods

Use generics:

```typescript
// Backend
@Public()
async findMany<T extends BaseEntity>(
  model: string,
  where: any
): Promise<T[]> {
  return await this.db[model].findMany({ where });
}

// Frontend
const users = await service.findMany<User>('users', { active: true });
//    ^? User[]
```

### DTO Validation

Validate DTOs:

```typescript
import { IsEmail, MinLength } from 'class-validator';

export class CreateUserDto {
  @MinLength(3)
  name: string;

  @IsEmail()
  email: string;

  @MinLength(8)
  password: string;
}

// Backend
@Public()
@ValidateDto()
async create(dto: CreateUserDto) {
  return await this.db.users.create({ data: dto });
}

// Frontend: TypeScript enforces correct shape
await userService.create({
  name: 'Alice',
  email: 'alice@example.com',
  password: 'password123'
}); // ✅

await userService.create({
  name: 'A', // ❌ Too short (caught at runtime via validation)
  email: 'invalid', // ❌ Invalid email
  password: '123' // ❌ Too short
});
```

## WebSocket Transport

### WebSocket Connection

Use WebSocket for real-time:

```typescript
const userService = useRPC(UserService, {
  transport: 'websocket',
  websocket: {
    url: 'wss://api.example.com/rpc',
    reconnect: true,
    reconnectDelay: 1000
  }
});

// All calls use WebSocket
const user = await userService.findById('123');
```

### Connection Events

Listen to connection events:

```typescript
import { onRPCConnect, onRPCDisconnect } from 'aether/titan';

onRPCConnect(() => {
  console.log('Connected to RPC server');
  toast.success('Connected');
});

onRPCDisconnect(() => {
  console.log('Disconnected from RPC server');
  toast.error('Disconnected');
});
```

### Reconnection

Handle reconnection:

```typescript
configureRPC({
  websocket: {
    reconnect: true,
    reconnectAttempts: 5,
    reconnectDelay: 1000,
    reconnectBackoff: 2, // Exponential backoff

    onReconnect: (attempt) => {
      console.log(`Reconnecting... (attempt ${attempt})`);
    },

    onReconnectFailed: () => {
      console.error('Failed to reconnect');
      toast.error('Connection lost. Please refresh.');
    }
  }
});
```

## Best Practices

### 1. Use @Public Sparingly

```typescript
// ✅ Only expose what's needed
@Public()
async findById(id: string) {
  return await this.db.users.findUnique({ where: { id } });
}

// ❌ Don't expose internal methods
@Public() // Bad!
async hashPassword(password: string) {
  return await bcrypt.hash(password, 10);
}
```

### 2. Validate Input

```typescript
// ✅ Validate all inputs
@Public()
@ValidateDto()
async create(dto: CreateUserDto) {
  return await this.db.users.create({ data: dto });
}

// ❌ Don't trust raw input
@Public()
async create(data: any) {
  return await this.db.users.create({ data });
}
```

### 3. Handle Errors Gracefully

```typescript
// ✅ Specific error handling
try {
  const user = await userService.findById(id);
} catch (error) {
  if (error instanceof NotFoundException) {
    navigate('/404');
  } else {
    toast.error('Failed to load user');
  }
}

// ❌ Generic error handling
try {
  const user = await userService.findById(id);
} catch (error) {
  console.error(error);
}
```

### 4. Use Streaming for Large Data

```typescript
// ✅ Stream large datasets
@Public()
async *exportUsers(): AsyncGenerator<User> {
  const users = await this.db.users.findMany();
  for (const user of users) {
    yield user;
  }
}

// ❌ Don't load everything in memory
@Public()
async exportUsers() {
  return await this.db.users.findMany(); // OOM risk
}
```

## Advanced Patterns

### Service Composition

Compose multiple services:

```typescript
const userService = useRPC(UserService);
const postService = useRPC(PostService);

const [user, posts] = await Promise.all([
  userService.findById(userId),
  postService.findByAuthor(userId)
]);
```

### Optimistic Updates

Implement optimistic updates:

```typescript
const [todos, { mutate }] = resource(() => todoService.findAll());

const addTodo = async (text: string) => {
  const optimisticTodo = { id: Date.now(), text, done: false };

  // Optimistic update
  mutate([...todos(), optimisticTodo]);

  try {
    // Actual RPC call
    const todo = await todoService.create({ text });

    // Replace optimistic with real
    mutate(todos().map(t => (t.id === optimisticTodo.id ? todo : t)));
  } catch {
    // Rollback on error
    mutate(todos().filter(t => t.id !== optimisticTodo.id));
  }
};
```

### Circuit Breaker

Implement circuit breaker:

```typescript
import { createCircuitBreaker } from 'aether/resilience';

const circuitBreaker = createCircuitBreaker({
  threshold: 5, // Open after 5 failures
  timeout: 30000, // Stay open for 30s
  onOpen: () => toast.error('Service unavailable')
});

const userService = useRPC(UserService, {
  middleware: [circuitBreaker]
});
```

## API Reference

### useRPC

```typescript
function useRPC<T>(
  service: Type<T>,
  options?: {
    transport?: 'http' | 'websocket' | 'auto';
    endpoint?: string;
    timeout?: number;
    retry?: {
      attempts: number;
      delay: number;
    };
    cache?: {
      enabled: boolean;
      ttl: number;
      key?: (method: string, args: any[]) => string;
    };
    headers?: Record<string, string>;
  }
): T;
```

### configureRPC

```typescript
function configureRPC(options: {
  endpoint?: string;
  transport?: 'http' | 'websocket';
  credentials?: 'include' | 'same-origin' | 'omit';
  compression?: {
    enabled: boolean;
    threshold: number;
  };
  beforeRequest?: (request: RPCRequest) => void | Promise<void>;
  afterResponse?: (response: RPCResponse) => void | Promise<void>;
  onError?: (error: RPCError) => void | Promise<void>;
}): void;
```

### @Public

```typescript
function Public(): MethodDecorator;
```

### @Authorized

```typescript
function Authorized(options?: {
  roles?: string[];
}): MethodDecorator;
```

## Examples

### Full-Stack Todo App

```typescript
// Backend: todo.service.ts
@Injectable()
export class TodoService {
  @Public()
  async findAll(): Promise<Todo[]> {
    return await this.db.todos.findMany();
  }

  @Public()
  async create(text: string): Promise<Todo> {
    return await this.db.todos.create({
      data: { text, done: false }
    });
  }

  @Public()
  async toggle(id: string): Promise<Todo> {
    const todo = await this.db.todos.findUnique({ where: { id } });
    return await this.db.todos.update({
      where: { id },
      data: { done: !todo.done }
    });
  }

  @Public()
  async delete(id: string): Promise<void> {
    await this.db.todos.delete({ where: { id } });
  }
}

// Frontend: TodoList.tsx
import { useRPC } from 'aether/titan';
import { TodoService } from '@/services/todo.service';

export const TodoList = defineComponent(() => {
  const todoService = useRPC(TodoService);

  const [todos, { refetch }] = resource(() => todoService.findAll());

  const handleToggle = async (id: string) => {
    await todoService.toggle(id);
    refetch();
  };

  const handleDelete = async (id: string) => {
    await todoService.delete(id);
    refetch();
  };

  return () => (
    <ul>
      {#each todos() as todo}
        <li>
          <input
            type="checkbox"
            checked={todo.done}
            onChange={() => handleToggle(todo.id)}
          />
          <span>{todo.text}</span>
          <button onClick={() => handleDelete(todo.id)}>Delete</button>
        </li>
      {/each}
    </ul>
  );
});
```

---

**Netron RPC provides seamless, type-safe communication between Aether frontend and Titan backend.** With automatic routing, built-in authentication, and streaming support, you can build full-stack applications without writing API endpoints.

**Next**: [21. Build System →](./21-BUILD-SYSTEM.md)
