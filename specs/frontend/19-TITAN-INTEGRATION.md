# 19. Titan Integration

## Table of Contents

- [Overview](#overview)
- [Philosophy](#philosophy)
- [Module System](#module-system)
- [Dependency Injection](#dependency-injection)
- [RPC via Netron](#rpc-via-netron)
- [Type-Safe APIs](#type-safe-apis)
- [Authentication](#authentication)
- [Real-Time Features](#real-time-features)
- [Server Actions](#server-actions)
- [Full-Stack Modules](#full-stack-modules)
- [Configuration](#configuration)
- [Deployment](#deployment)
- [Best Practices](#best-practices)
- [Advanced Patterns](#advanced-patterns)
- [API Reference](#api-reference)
- [Examples](#examples)

## Overview

Nexus provides **deep integration with Titan**, the TypeScript framework for distributed applications. This integration enables:

- 🔄 **Separate DI Systems**: Frontend (Nexus) and Backend (Titan) each have their own DI, connected via contracts
- 🌐 **Type-Safe RPC**: Call backend services from frontend with full type safety via interface contracts
- 📦 **Contract-Based Communication**: Clean separation using shared TypeScript interfaces
- 🔐 **Role-Based Security**: Netron dynamically projects interfaces based on user roles
- ⚡ **Real-Time**: WebSocket support via Netron
- 🚀 **Single Deployment**: Deploy as one application

> **Architecture Decision**: Frontend and backend have **separate DI implementations** connected via type-safe interface contracts. See `ARCHITECTURE-DECISION-TITAN-DI.md` for details.

### Architecture

```
┌─────────────────────────────────────────────┐
│                  Browser                     │
│  ┌──────────────────────────────────────┐  │
│  │        Nexus Frontend                 │  │
│  │  - Components                         │  │
│  │  - Client-side DI                     │  │
│  │  - Netron RPC Client                  │  │
│  └──────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
                     │
                     │ HTTP/WebSocket (RPC)
                     │
┌─────────────────────────────────────────────┐
│              Titan Application               │
│  ┌──────────────────────────────────────┐  │
│  │          Nexus SSR                    │  │
│  │  - Server rendering                   │  │
│  │  - Route handling                     │  │
│  │  - Server components                  │  │
│  └──────────────────────────────────────┘  │
│  ┌──────────────────────────────────────┐  │
│  │         Shared Services               │  │
│  │  - Business logic                     │  │
│  │  - Data access                        │  │
│  │  - Authentication                     │  │
│  └──────────────────────────────────────┘  │
│  ┌──────────────────────────────────────┐  │
│  │         Netron RPC Server             │  │
│  │  - Service exposure                   │  │
│  │  - WebSocket handling                 │  │
│  └──────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

### Quick Example

```typescript
// 1. Define contract interface (shared)
// shared/contracts/user.contract.ts
export interface IUserService {
  findAll(): Promise<User[]>;
  findById(id: string): Promise<User>;
}

// 2. Backend implementation
// backend/services/user.service.ts
import { Injectable } from '@omnitron-dev/titan';
import { Service, Public } from '@omnitron-dev/titan/netron';

@Injectable()
@Service('users@1.0.0')
export class UserService implements IUserService {
  @Public()
  async findAll() {
    return await this.db.users.findMany();
  }

  @Public()
  async findById(id: string) {
    return await this.db.users.findUnique({ where: { id } });
  }
}

// 3. Frontend RPC service
// frontend/services/user-rpc.service.ts
import { injectable, inject } from 'nexus';
import { NetronClient } from 'nexus/netron';
import { IUserService } from '@/shared/contracts/user.contract';

export const UserRPCService = injectable(() => {
  const netron = inject(NetronClient);
  return netron.createProxy<IUserService>('users@1.0.0');
});

// 4. Use in component
import { UserRPCService } from '@/services/user-rpc.service';

export default defineComponent(() => {
  const userService = inject(UserRPCService);
  const users = resource(() => userService.findAll());

  return () => (
    <ul>
      {#each users() as user}
        <li>{user.name}</li>
      {/each}
    </ul>
  );
});

// ✅ Type-safe, contract-based, secure!
```

## Philosophy

### Unified Framework

**One framework for frontend and backend**:

```typescript
// Traditional (separate frameworks)
// Backend: NestJS/Express
// Frontend: React/Vue
// = Different DI, different patterns, separate deployments

// Nexus + Titan (unified)
// Backend: Titan
// Frontend: Nexus
// = Shared DI, shared patterns, single deployment
```

### Type Safety Everywhere

**End-to-end type safety**:

```typescript
// Backend
@Injectable()
export class ProductService {
  @Public()
  async getProducts(): Promise<Product[]> {
    return await db.products.findMany();
  }
}

// Frontend (automatic type inference)
const productService = useRPC(ProductService);

const [products] = resource(() => productService.getProducts());
// products is typed as Product[]! No manual typing needed.
```

### Zero Boilerplate

**No manual API routes**:

```typescript
// ❌ Traditional (manual API routes)
// Backend
app.get('/api/users', async (req, res) => {
  const users = await userService.findAll();
  res.json(users);
});

// Frontend
const users = await fetch('/api/users').then(r => r.json());

// ✅ Nexus + Titan (automatic RPC)
// Backend
@Injectable()
export class UserService {
  @Public()
  async findAll() {
    return await db.users.findMany();
  }
}

// Frontend
const userService = useRPC(UserService);
const users = await userService.findAll();
```

### Progressive Enhancement

**Works without RPC**:

```typescript
// Server: Direct service calls (no RPC)
export const loader = async ({ inject }) => {
  const userService = inject(UserService);
  const users = await userService.findAll(); // Direct call
  return users;
};

// Client: RPC (automatic fallback)
const userService = useRPC(UserService);
const users = await userService.findAll(); // RPC call
```

## Module System

### Unified Modules

Modules work on both frontend and backend:

```typescript
// user.module.ts
import { defineModule } from 'nexus/titan';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { UserListComponent } from './components/UserList';

export const UserModule = defineModule({
  providers: [
    UserService, // Backend service
    UserController // Backend controller
  ],
  components: [
    UserListComponent // Frontend component
  ],
  exports: [UserService] // Export for DI and RPC
});
```

### Root Module

Create root application module:

```typescript
// app.module.ts
import { defineModule } from 'nexus/titan';
import { ConfigModule } from '@omnitron-dev/titan/module/config';
import { NexusModule } from 'nexus/titan';
import { UserModule } from './user/user.module';
import { ProductModule } from './product/product.module';

export const AppModule = defineModule({
  imports: [
    ConfigModule.forRoot(),
    NexusModule.forRoot({
      entry: './src/entry-server.ts',
      port: 3000
    }),
    UserModule,
    ProductModule
  ]
});
```

### Feature Modules

Create feature modules:

```typescript
// product.module.ts
import { defineModule } from 'nexus/titan';
import { ProductService } from './product.service';
import { ProductRepository } from './product.repository';

export const ProductModule = defineModule({
  providers: [ProductService, ProductRepository],
  exports: [ProductService]
});

// Import in other modules
import { ProductModule } from './product/product.module';

export const CartModule = defineModule({
  imports: [ProductModule], // Access ProductService
  providers: [CartService]
});
```

## Dependency Injection

### Shared DI Container

Services are shared between frontend and backend:

```typescript
// Shared service
@Injectable()
export class ConfigService {
  get apiUrl() {
    return process.env.API_URL || 'http://localhost:3000';
  }
}

// Backend usage
@Injectable()
export class UserService {
  constructor(private config: ConfigService) {}

  async findAll() {
    console.log('API:', this.config.apiUrl);
    return await db.users.findMany();
  }
}

// Frontend usage
export default defineComponent(() => {
  const config = inject(ConfigService);

  return () => <div>API: {config.apiUrl}</div>;
});
```

### Service Injection

Inject services in components:

```typescript
import { inject } from 'nexus/di';
import { UserService } from '@/services/user.service';

export default defineComponent(() => {
  const userService = inject(UserService);

  onMount(async () => {
    const users = await userService.findAll();
    console.log(users);
  });

  return () => <div>Check console</div>;
});
```

### Scoped Providers

Request-scoped providers:

```typescript
@Injectable({ scope: 'request' })
export class RequestContext {
  constructor(private request: Request) {}

  get userId() {
    return this.request.headers.get('x-user-id');
  }
}

// Accessible in any service/component during request
const context = inject(RequestContext);
console.log(context.userId);
```

## RPC via Netron

### Exposing Services

Expose services to frontend:

```typescript
import { Injectable, Public } from 'nexus/titan';

@Injectable()
export class UserService {
  @Public() // Expose this method via RPC
  async findAll() {
    return await db.users.findMany();
  }

  @Public()
  async findById(id: string) {
    return await db.users.findUnique({ where: { id } });
  }

  // Private method (not exposed)
  private async validateUser(id: string) {
    // ...
  }
}
```

### Calling Services

Call services from frontend:

```typescript
import { useRPC } from 'nexus/titan';
import { UserService } from '@/services/user.service';

export default defineComponent(() => {
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
@Injectable()
export class UserService {
  @Public()
  async search(query: string, limit: number = 10) {
    return await db.users.findMany({
      where: { name: { contains: query } },
      take: limit
    });
  }
}

// Frontend
const userService = useRPC(UserService);

const [results] = resource(
  () => query(), // Dependency
  (q) => userService.search(q, 20) // Call with args
);
```

### Error Handling

Handle RPC errors:

```typescript
const userService = useRPC(UserService);

const fetchUser = async (id: string) => {
  try {
    const user = await userService.findById(id);
    return user;
  } catch (error) {
    if (error.code === 'NOT_FOUND') {
      toast.error('User not found');
    } else {
      toast.error('Failed to load user');
    }
    throw error;
  }
};
```

## Type-Safe APIs

### Automatic Type Inference

Types flow from backend to frontend:

```typescript
// Backend
interface Product {
  id: string;
  name: string;
  price: number;
  inStock: boolean;
}

@Injectable()
export class ProductService {
  @Public()
  async getProducts(): Promise<Product[]> {
    return await db.products.findMany();
  }
}

// Frontend (automatic type inference!)
const productService = useRPC(ProductService);

const [products] = resource(() => productService.getProducts());

// products() is typed as Product[]
products().forEach(p => {
  console.log(p.name); // ✅ TypeScript knows 'name' exists
  console.log(p.invalid); // ❌ Type error
});
```

### DTOs (Data Transfer Objects)

Use DTOs for API contracts:

```typescript
// dtos/create-user.dto.ts
export class CreateUserDto {
  name: string;
  email: string;
  password: string;
}

// Backend
@Injectable()
export class UserService {
  @Public()
  async create(dto: CreateUserDto) {
    return await db.users.create({ data: dto });
  }
}

// Frontend
const userService = useRPC(UserService);

const createUser = async (data: CreateUserDto) => {
  return await userService.create(data);
};

// ✅ Type-safe
createUser({ name: 'Alice', email: 'alice@example.com', password: '123' });

// ❌ Type error (missing password)
createUser({ name: 'Alice', email: 'alice@example.com' });
```

### Validation

Validate DTOs with decorators:

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
@Injectable()
export class UserService {
  @Public()
  @Validate() // Auto-validate DTO
  async create(dto: CreateUserDto) {
    return await db.users.create({ data: dto });
  }
}

// Frontend - validation errors returned automatically
try {
  await userService.create({ name: 'A', email: 'invalid', password: '123' });
} catch (error) {
  console.log(error.validationErrors);
  // [
  //   { field: 'name', message: 'name must be at least 3 characters' },
  //   { field: 'email', message: 'email must be a valid email' },
  //   { field: 'password', message: 'password must be at least 8 characters' }
  // ]
}
```

## Authentication

### Auth Service

Create authentication service:

```typescript
// auth.service.ts
@Injectable()
export class AuthService {
  constructor(
    private userService: UserService,
    private jwtService: JwtService
  ) {}

  @Public()
  async login(email: string, password: string) {
    const user = await this.userService.findByEmail(email);

    if (!user || !await bcrypt.compare(password, user.password)) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const token = this.jwtService.sign({ userId: user.id });

    return { token, user };
  }

  @Public()
  async getCurrentUser(@CurrentUser() userId: string) {
    return await this.userService.findById(userId);
  }
}
```

### Frontend Auth

Use auth service in frontend:

```typescript
// stores/auth.store.ts
import { defineStore } from 'nexus/state';
import { useRPC } from 'nexus/titan';
import { AuthService } from '@/services/auth.service';

export const useAuthStore = defineStore('auth', () => {
  const authService = useRPC(AuthService);

  const [state, setState] = createStore({
    user: null as User | null,
    token: null as string | null
  });

  const login = async (email: string, password: string) => {
    const { token, user } = await authService.login(email, password);

    setState({ token, user });

    // Store token
    localStorage.setItem('token', token);
  };

  const logout = () => {
    setState({ token: null, user: null });
    localStorage.removeItem('token');
  };

  const loadUser = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;

    try {
      const user = await authService.getCurrentUser();
      setState({ user, token });
    } catch {
      logout();
    }
  };

  return { state, login, logout, loadUser };
});

// Usage
const auth = useAuthStore();

await auth.login('alice@example.com', 'password');
console.log(auth.state.user);
```

### Protected Routes

Protect routes with guards:

```typescript
// guards/auth.guard.ts
import { defineGuard } from 'nexus/router';
import { useAuthStore } from '@/stores/auth.store';

export const authGuard = defineGuard(async (to, from) => {
  const auth = useAuthStore();

  if (!auth.state.token) {
    return '/login'; // Redirect to login
  }

  return true; // Allow access
});

// Usage
export default defineRoute({
  path: '/dashboard',
  guards: [authGuard],
  component: DashboardComponent
});
```

### RPC Authentication

Authenticate RPC calls:

```typescript
// Automatic token injection
import { configureRPC } from 'nexus/titan';

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
  @Authorized() // Requires valid token
  async getProfile() {
    return await this.userService.getCurrentUser();
  }
}
```

## Real-Time Features

### WebSocket RPC

Use WebSocket for real-time RPC:

```typescript
// Backend
@Injectable()
export class ChatService {
  @Public()
  @WebSocket() // Use WebSocket instead of HTTP
  async *subscribeToMessages(roomId: string) {
    const stream = this.messageStream(roomId);

    for await (const message of stream) {
      yield message;
    }
  }
}

// Frontend
const chatService = useRPC(ChatService);

const messages = signal([]);

onMount(async () => {
  const stream = await chatService.subscribeToMessages('room-1');

  for await (const message of stream) {
    messages.set([...messages(), message]);
  }
});
```

### Server Events

Subscribe to server events:

```typescript
// Backend
@Injectable()
export class NotificationService {
  @Public()
  async *subscribe() {
    const userId = this.getCurrentUserId();

    // Subscribe to notifications
    const stream = this.notificationStream(userId);

    for await (const notification of stream) {
      yield notification;
    }
  }
}

// Frontend
const notificationService = useRPC(NotificationService);

const notifications = signal([]);

onMount(async () => {
  const stream = await notificationService.subscribe();

  for await (const notification of stream) {
    notifications.set([...notifications(), notification]);
    toast.info(notification.message);
  }
});
```

### Bi-directional Streams

Two-way communication:

```typescript
// Backend
@Injectable()
export class GameService {
  @Public()
  async *play(moves: AsyncIterable<Move>) {
    for await (const move of moves) {
      const response = await this.processMove(move);
      yield response;
    }
  }
}

// Frontend
const gameService = useRPC(GameService);

const playGame = async () => {
  const { send, receive } = await gameService.play();

  // Send moves
  send({ type: 'MOVE', x: 0, y: 0 });

  // Receive responses
  for await (const response of receive) {
    console.log('Server response:', response);
  }
};
```

## Server Actions

### Defining Server Actions

Create server-side actions:

```typescript
// actions/user.actions.ts
'use server';

import { db } from '@/lib/db';

export async function createUser(data: { name: string; email: string }) {
  return await db.users.create({ data });
}

export async function updateUser(id: string, data: Partial<User>) {
  return await db.users.update({ where: { id }, data });
}

export async function deleteUser(id: string) {
  return await db.users.delete({ where: { id } });
}
```

### Using Server Actions

Call server actions from frontend:

```typescript
import { createUser, updateUser } from '@/actions/user.actions';

export default defineComponent(() => {
  const handleCreate = async () => {
    const user = await createUser({
      name: 'Alice',
      email: 'alice@example.com'
    });

    console.log('Created:', user);
  };

  return () => (
    <button onClick={handleCreate}>Create User</button>
  );
});
```

### Form Actions

Use server actions with forms:

```typescript
// actions/login.ts
'use server';

export async function login(formData: FormData) {
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;

  // Validate
  if (!email || !password) {
    throw new Error('Email and password required');
  }

  // Authenticate
  const user = await authService.login(email, password);

  return user;
}

// Component
import { login } from '@/actions/login';

export default defineComponent(() => {
  const form = createForm({
    action: login,
    onSuccess: (user) => {
      toast.success(`Welcome, ${user.name}!`);
    }
  });

  return () => (
    <form onSubmit={form.handleSubmit}>
      <input name="email" type="email" />
      <input name="password" type="password" />
      <button type="submit">Login</button>
    </form>
  );
});
```

## Full-Stack Modules

### Creating Full-Stack Modules

Modules that span frontend and backend:

```typescript
// todo.module.ts
import { defineModule } from 'nexus/titan';
import { TodoService } from './todo.service';
import { TodoController } from './todo.controller';
import { TodoList } from './components/TodoList';
import { TodoForm } from './components/TodoForm';

export const TodoModule = defineModule({
  // Backend
  providers: [TodoService, TodoController],

  // Frontend
  components: [TodoList, TodoForm],

  // Shared
  exports: [TodoService]
});

// app.module.ts
import { TodoModule } from './todo/todo.module';

export const AppModule = defineModule({
  imports: [TodoModule]
});
```

### Module Routes

Define routes in modules:

```typescript
export const TodoModule = defineModule({
  providers: [TodoService],
  components: [TodoList, TodoForm],
  routes: [
    {
      path: '/todos',
      component: TodoList
    },
    {
      path: '/todos/new',
      component: TodoForm
    }
  ]
});
```

## Configuration

### Environment Variables

Access config in frontend:

```typescript
// Backend config
@Injectable()
export class ConfigService {
  @Public()
  getPublicConfig() {
    return {
      apiUrl: process.env.API_URL,
      googleMapsKey: process.env.GOOGLE_MAPS_KEY,
      // Don't expose secrets!
    };
  }
}

// Frontend
const configService = useRPC(ConfigService);

const [config] = resource(() => configService.getPublicConfig());

<GoogleMap apiKey={config().googleMapsKey} />
```

### Nexus Configuration

Configure Nexus module:

```typescript
// app.module.ts
import { NexusModule } from 'nexus/titan';

export const AppModule = defineModule({
  imports: [
    NexusModule.forRoot({
      entry: './src/entry-server.ts',
      port: 3000,
      publicDir: './public',
      ssr: {
        streaming: true,
        cache: {
          enabled: true,
          ttl: 60 * 5 // 5 minutes
        }
      },
      rpc: {
        endpoint: '/api/rpc',
        websocket: true
      }
    })
  ]
});
```

## Deployment

### Single Deployment

Deploy as one Titan application:

```bash
# Build
npm run build

# Output:
# dist/
# ├── server/        # Titan server
# ├── client/        # Nexus frontend
# └── index.js       # Entry point

# Deploy
node dist/index.js
```

### Docker Deployment

```dockerfile
# Dockerfile
FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY dist ./dist

EXPOSE 3000

CMD ["node", "dist/index.js"]
```

### Environment Variables

```bash
# .env
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
JWT_SECRET=...

# Public vars (exposed to frontend)
NEXT_PUBLIC_API_URL=https://api.example.com
NEXT_PUBLIC_GOOGLE_MAPS_KEY=...
```

## Best Practices

### 1. Use Server Actions for Mutations

```typescript
// ✅ Server actions for mutations
'use server';
export async function createPost(data: CreatePostDto) {
  return await db.posts.create({ data });
}

// ✅ RPC services for queries
@Injectable()
export class PostService {
  @Public()
  async findAll() {
    return await db.posts.findMany();
  }
}
```

### 2. Validate All Inputs

```typescript
// ✅ Validate DTOs
export class CreateUserDto {
  @IsEmail()
  email: string;

  @MinLength(8)
  password: string;
}

@Injectable()
export class UserService {
  @Public()
  @Validate()
  async create(dto: CreateUserDto) {
    return await db.users.create({ data: dto });
  }
}
```

### 3. Secure RPC Methods

```typescript
// ✅ Only expose what's needed
@Injectable()
export class UserService {
  @Public() // ✅ Exposed
  async findById(id: string) {
    return await db.users.findUnique({ where: { id } });
  }

  // ❌ NOT exposed (no @Public decorator)
  private async findByEmail(email: string) {
    return await db.users.findUnique({ where: { email } });
  }
}
```

### 4. Use Type-Safe DTOs

```typescript
// ✅ Explicit DTOs
export class UpdateUserDto {
  name?: string;
  email?: string;
}

@Public()
async update(id: string, dto: UpdateUserDto) {
  return await db.users.update({ where: { id }, data: dto });
}

// ❌ Any type
@Public()
async update(id: string, data: any) {
  return await db.users.update({ where: { id }, data });
}
```

## Advanced Patterns

### Custom RPC Transport

Implement custom transport:

```typescript
import { createRPCTransport } from 'nexus/titan';

const customTransport = createRPCTransport({
  send: async (request) => {
    // Custom send logic
    const response = await fetch('/api/custom-rpc', {
      method: 'POST',
      body: JSON.stringify(request)
    });

    return await response.json();
  },

  connect: async () => {
    // WebSocket connection
    return new WebSocket('wss://api.example.com/rpc');
  }
});

configureRPC({ transport: customTransport });
```

### RPC Middleware

Add middleware to RPC calls:

```typescript
import { useRPCMiddleware } from 'nexus/titan';

useRPCMiddleware({
  before: async (request) => {
    console.log('RPC call:', request.method);

    // Add auth header
    request.headers.set('Authorization', `Bearer ${getToken()}`);

    return request;
  },

  after: async (response) => {
    console.log('RPC response:', response);

    // Track analytics
    analytics.track('rpc_call', { method: response.method });

    return response;
  },

  error: async (error) => {
    console.error('RPC error:', error);

    // Show toast
    toast.error(error.message);

    throw error;
  }
});
```

### Service Proxies

Create service proxies:

```typescript
import { createServiceProxy } from 'nexus/titan';

const userService = createServiceProxy(UserService, {
  cache: {
    findById: { ttl: 60 * 5 }, // Cache for 5 minutes
    findAll: { ttl: 60 } // Cache for 1 minute
  },
  retry: {
    attempts: 3,
    delay: 1000
  }
});

// Cached, retried automatically
const user = await userService.findById('123');
```

## API Reference

### useRPC

```typescript
function useRPC<T>(
  service: Type<T>,
  options?: {
    endpoint?: string;
    headers?: Record<string, string>;
    timeout?: number;
  }
): T;
```

### defineModule

```typescript
function defineModule(options: {
  imports?: Module[];
  providers?: Provider[];
  components?: Component[];
  routes?: Route[];
  exports?: (Provider | Component)[];
}): Module;
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

### configureRPC

```typescript
function configureRPC(options: {
  endpoint?: string;
  transport?: RPCTransport;
  beforeRequest?: (request: RPCRequest) => void | Promise<void>;
  afterResponse?: (response: RPCResponse) => void | Promise<void>;
}): void;
```

## Examples

### Full-Stack Todo App

```typescript
// todo.service.ts
@Injectable()
export class TodoService {
  @Public()
  async findAll() {
    return await db.todos.findMany();
  }

  @Public()
  async create(text: string) {
    return await db.todos.create({
      data: { text, done: false }
    });
  }

  @Public()
  async toggle(id: string) {
    const todo = await db.todos.findUnique({ where: { id } });
    return await db.todos.update({
      where: { id },
      data: { done: !todo.done }
    });
  }

  @Public()
  async delete(id: string) {
    return await db.todos.delete({ where: { id } });
  }
}

// TodoList.tsx
import { useRPC } from 'nexus/titan';
import { TodoService } from './todo.service';

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

// TodoForm.tsx
export const TodoForm = defineComponent(() => {
  const todoService = useRPC(TodoService);
  const text = signal('')

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    await todoService.create(text());
    text.set('');
  };

  return () => (
    <form onSubmit={handleSubmit}>
      <input
        value={text()}
        onInput={e => text.set(e.target.value)}
        placeholder="Add todo..."
      />
      <button type="submit">Add</button>
    </form>
  );
});

// todo.module.ts
export const TodoModule = defineModule({
  providers: [TodoService],
  components: [TodoList, TodoForm],
  exports: [TodoService]
});
```

---

**Nexus + Titan integration provides a seamless full-stack experience** with type-safe RPC, unified DI, and zero boilerplate. Build modern web applications with the power of a unified framework.

**Next**: [14. Component Library →](./14-COMPONENTS-LIBRARY.md)
