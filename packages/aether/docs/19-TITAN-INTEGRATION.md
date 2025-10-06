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

Aether provides **optional integration with Titan**, the TypeScript framework for distributed applications. **This integration is completely optional** - Aether has its own built-in SSR server and can work standalone. When you choose to integrate, it enables:

- 🔄 **Separate DI Systems**: Frontend (Aether) and Backend (Titan) each have their own DI, connected via contracts
- 🌐 **Type-Safe RPC**: Call backend services from frontend with full type safety via interface contracts
- 📦 **Contract-Based Communication**: Clean separation using shared TypeScript interfaces
- 🔐 **Role-Based Security**: Netron dynamically projects interfaces based on user roles
- ⚡ **Real-Time**: WebSocket support via Netron
- 🚀 **Single Deployment**: Deploy as one application

> **Architecture Decision**: Frontend and backend have **separate DI implementations** connected via type-safe interface contracts. See `ARCHITECTURE-DECISION-TITAN-DI.md` for details.

### Architecture (Optional Integration)

```
┌─────────────────────────────────────────────┐
│                  Browser                     │
│  ┌──────────────────────────────────────┐  │
│  │        Aether Frontend                 │  │
│  │  - Components                         │  │
│  │  - Client-side DI                     │  │
│  │  - Netron RPC Client (optional)       │  │
│  └──────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
                     │
                     │ HTTP/WebSocket (RPC)
                     │ (Optional via Netron)
                     │
┌──────────────────────────────┬──────────────┐
│   Aether SSR Server          │              │
│   (Port 3000)                │              │
│   - Built-in HTTP server     │              │
│   - Server rendering         │              │
│   - Route handling           │              │
│   - Static files             │              │
└──────────────────────────────┘              │
                     │                        │
                     │ Optional               │
                     │ Netron RPC             │
                     │                        │
┌─────────────────────────────────────────────┐
│        Titan Backend (Optional)              │
│        (Port 4000)                           │
│  ┌──────────────────────────────────────┐  │
│  │         Business Services             │  │
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

> **Key Point**: Aether runs on its own port (3000) with its own built-in server. Titan (4000) is optional and connects via Netron RPC.

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
import { injectable, inject } from 'aether';
import { NetronClient } from 'aether/netron';
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

### Contract-Based Integration

**Clean separation with type-safe contracts**:

```typescript
// ❌ Traditional (tightly coupled)
// Frontend directly imports backend classes
import { UserService } from '@/backend/services/user.service'; // Bad!

// ✅ Aether + Titan (contract-based)
// 1. Define shared interface contract
export interface IUserService {
  findAll(): Promise<User[]>;
}

// 2. Backend implements
@Service('users@1.0.0')
export class UserService implements IUserService { ... }

// 3. Frontend creates RPC proxy
export const UserRPCService = injectable(() => {
  const netron = inject(NetronClient);
  return netron.createProxy<IUserService>('users@1.0.0');
});
```

### Separate DI Systems

**Each side has its own DI optimized for its needs**:

```typescript
// Backend DI (Titan)
// - Constructor injection
// - Decorators (@Injectable, @Service)
// - Scopes (singleton, transient, request)
@Injectable()
@Service('products@1.0.0')
export class ProductService {
  constructor(
    private db: DatabaseService,
    private logger: LoggerService
  ) {}
}

// Frontend DI (Aether)
// - Function-based (injectable())
// - Lightweight, tree-shakeable
// - Component-scoped by default
export const ProductRPCService = injectable(() => {
  const netron = inject(NetronClient);
  return netron.createProxy<IProductService>('products@1.0.0');
});
```

### Type Safety Everywhere

**End-to-end type safety via interfaces**:

```typescript
// shared/contracts/product.contract.ts
export interface IProductService {
  getProducts(filters?: ProductFilters): Promise<Product[]>;
  getProductById(id: string): Promise<Product>;
}

// Backend implementation
@Service('products@1.0.0')
export class ProductService implements IProductService {
  @Public()
  async getProducts(filters?: ProductFilters) {
    return await this.db.products.findMany({ where: filters });
  }

  @Public()
  async getProductById(id: string) {
    return await this.db.products.findUnique({ where: { id } });
  }
}

// Frontend usage - fully typed!
const ProductPage = defineComponent(() => {
  const productService = inject(ProductRPCService);
  const products = resource(() => productService.getProducts());
  // products() is typed as Product[] | undefined - no manual typing!

  return () => (
    <div>
      {products() && products().map(p => <ProductCard product={p} />)}
    </div>
  );
});
```

### Zero Boilerplate

**No manual API routes needed**:

```typescript
// ❌ Traditional (manual REST API)
// Backend
app.get('/api/users', async (req, res) => {
  const users = await userService.findAll();
  res.json(users);
});

// Frontend
const users = await fetch('/api/users').then(r => r.json());

// ✅ Aether + Titan (contract + RPC)
// 1. Interface (shared)
export interface IUserService {
  findAll(): Promise<User[]>;
}

// 2. Backend (implements)
@Service('users@1.0.0')
export class UserService implements IUserService {
  @Public()
  async findAll() { return this.db.users.findMany(); }
}

// 3. Frontend (proxy)
const userService = inject(UserRPCService);
const users = await userService.findAll(); // Type-safe RPC call!
```

### Security by Design

**Role-based interface projection**:

```typescript
// Backend defines roles
@Service('users@1.0.0')
export class UserService {
  @Public()
  @Roles('user', 'admin')
  async findAll(): Promise<User[]> { ... }

  @Public()
  @Roles('admin')
  async deleteUser(id: string): Promise<void> { ... }
}

// Frontend receives projected interface based on user's role
// Regular user: only findAll() available
// Admin: both findAll() and deleteUser() available

const userService = inject(UserRPCService);
// TypeScript knows which methods are available based on user role!

## Contract-First Development

### Step 1: Define Interface Contract

Create shared TypeScript interfaces in `shared/contracts/`:

```typescript
// shared/contracts/user.contract.ts
export interface IUserService {
  findAll(): Promise<User[]>;
  findById(id: string): Promise<User | null>;
  create(data: CreateUserDTO): Promise<User>;
  update(id: string, data: UpdateUserDTO): Promise<User>;
  delete(id: string): Promise<void>;
}

// shared/models/user.model.ts
export interface User {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
}

export interface CreateUserDTO {
  name: string;
  email: string;
  password: string;
}

export interface UpdateUserDTO {
  name?: string;
  email?: string;
}
```

### Step 2: Implement Backend Service

```typescript
// backend/services/user.service.ts
import { Injectable } from '@omnitron-dev/titan';
import { Service, Public, Roles } from '@omnitron-dev/titan/netron';
import { IUserService } from '@/shared/contracts/user.contract';

@Injectable()
@Service('users@1.0.0')
export class UserService implements IUserService {
  constructor(
    private db: DatabaseService,
    private logger: LoggerService
  ) {}

  @Public()
  @Roles('user', 'admin')
  async findAll(): Promise<User[]> {
    this.logger.info('Finding all users');
    return this.db.users.findMany();
  }

  @Public()
  @Roles('user', 'admin')
  async findById(id: string): Promise<User | null> {
    return this.db.users.findUnique({ where: { id } });
  }

  @Public()
  @Roles('admin')
  async create(data: CreateUserDTO): Promise<User> {
    const hashedPassword = await bcrypt.hash(data.password, 10);
    return this.db.users.create({
      data: { ...data, password: hashedPassword }
    });
  }

  @Public()
  @Roles('admin')
  async update(id: string, data: UpdateUserDTO): Promise<User> {
    return this.db.users.update({ where: { id }, data });
  }

  @Public()
  @Roles('admin')
  async delete(id: string): Promise<void> {
    await this.db.users.delete({ where: { id } });
  }
}
```

### Step 3: Create Frontend RPC Service

```typescript
// frontend/services/user-rpc.service.ts
import { injectable, inject } from 'aether';
import { NetronClient } from 'aether/netron';
import { IUserService } from '@/shared/contracts/user.contract';

/**
 * RPC proxy for UserService
 * Automatically handles:
 * - Type-safe method calls
 * - Serialization/deserialization
 * - Error handling
 * - Authentication headers
 */
export const UserRPCService = injectable(() => {
  const netron = inject(NetronClient);

  // Create type-safe RPC proxy from interface
  return netron.createProxy<IUserService>('users@1.0.0');
});
```

### Step 4: Use in Components

```typescript
// frontend/pages/users/index.tsx
import { defineComponent, inject, resource, signal } from 'aether';
import { UserRPCService } from '@/services/user-rpc.service';

export default defineComponent(() => {
  const userService = inject(UserRPCService);

  // Reactive data loading
  const users = resource(() => userService.findAll());

  const handleDelete = async (id: string) => {
    if (confirm('Delete user?')) {
      await userService.delete(id);
      users.refetch(); // Reload data
    }
  };

  return () => (
    <div>
      <h1>Users</h1>

      {#if users.loading()}
        <Spinner />
      {:else if users.error()}
        <Error message={users.error().message} />
      {:else if users()}
        <ul>
          {#each users() as user}
            <li>
              {user.name} ({user.email})
              <button on:click={() => handleDelete(user.id)}>
                Delete
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  );
});
```

## Dependency Injection

### Backend DI (Titan)

Backend uses Titan's powerful DI system:

```typescript
// backend/services/order.service.ts
import { Injectable } from '@omnitron-dev/titan';
import { Service, Public } from '@omnitron-dev/titan/netron';

@Injectable()
@Service('orders@1.0.0')
export class OrderService implements IOrderService {
  // Constructor injection (Titan DI)
  constructor(
    private db: DatabaseService,
    private userService: UserService,
    private emailService: EmailService,
    private logger: LoggerService
  ) {}

  @Public()
  async createOrder(userId: string, items: OrderItem[]) {
    const user = await this.userService.findById(userId);
    const order = await this.db.orders.create({ data: { userId, items } });

    // Send confirmation email
    await this.emailService.send({
      to: user.email,
      subject: 'Order confirmation',
      template: 'order-confirmation',
      data: { order }
    });

    this.logger.info(`Order created: ${order.id}`);
    return order;
  }
}
```

### Frontend DI (Aether)

Frontend uses lightweight, function-based DI:

```typescript
// frontend/services/order-rpc.service.ts
import { injectable, inject } from 'aether';
import { NetronClient } from 'aether/netron';

export const OrderRPCService = injectable(() => {
  const netron = inject(NetronClient);
  return netron.createProxy<IOrderService>('orders@1.0.0');
});

// frontend/services/cart.service.ts
// Pure frontend service (no backend equivalent)
export const CartService = injectable(() => {
  const items = signal<CartItem[]>([]);
  const orderRPC = inject(OrderRPCService);

  return {
    items,

    addItem(item: CartItem) {
      items.set([...items(), item]);
    },

    removeItem(id: string) {
      items.set(items().filter(i => i.id !== id));
    },

    async checkout() {
      const userId = getCurrentUserId();
      const order = await orderRPC.createOrder(userId, items());
      items.set([]); // Clear cart
      return order;
    }
  };
});
```

### Component Injection

```typescript
import { inject } from 'aether/di';
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
import { Injectable, Public } from 'aether/titan';

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
import { useRPC } from 'aether/titan';
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
const query = signal('');

const results = resource(() =>
  userService.search(query(), 20)
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

const products = resource(() => productService.getProducts());

// products() is typed as Product[] | undefined
products()?.forEach(p => {
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
import { defineStore } from 'aether/state';
import { useRPC } from 'aether/titan';
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
import { defineGuard } from 'aether/router';
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
import { defineModule } from 'aether/titan';
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

const config = resource(() => configService.getPublicConfig());

<GoogleMap apiKey={config()?.googleMapsKey} />
```

### Aether Configuration

Configure Aether module:

```typescript
// app.module.ts
import { AetherModule } from 'aether/titan';

export const AppModule = defineModule({
  imports: [
    AetherModule.forRoot({
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
# ├── client/        # Aether frontend
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
import { createRPCTransport } from 'aether/titan';

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
import { useRPCMiddleware } from 'aether/titan';

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
import { createServiceProxy } from 'aether/titan';

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
import { useRPC } from 'aether/titan';
import { TodoService } from './todo.service';

export const TodoList = defineComponent(() => {
  const todoService = useRPC(TodoService);

  const todos = resource(() => todoService.findAll());

  const handleToggle = async (id: string) => {
    await todoService.toggle(id);
    todos.refetch();
  };

  const handleDelete = async (id: string) => {
    await todoService.delete(id);
    todos.refetch();
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

**Aether + Titan integration provides a seamless full-stack experience** with type-safe RPC, unified DI, and zero boilerplate. Build modern web applications with the power of a unified framework.

**Next**: [14. Component Library →](./14-COMPONENTS-LIBRARY.md)
