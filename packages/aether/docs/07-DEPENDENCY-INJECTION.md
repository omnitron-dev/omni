# Dependency Injection - Frontend DI System

## Introduction

The Dependency Injection (DI) system in Aether is a **lightweight, type-safe** DI system optimized for reactive UI applications. It is **completely separate** from Titan's backend DI and connects to it via type-safe RPC contracts through Netron.

> **Critical Architecture Note**: Aether (frontend) and Titan (backend) have **separate, independent DI containers**. They do NOT share service instances. They communicate via **TypeScript interface contracts** and **Netron RPC proxies**. This separation ensures optimal tree-shaking, security, and flexibility. See `19-TITAN-INTEGRATION.md` for details.

### Key Principles

1. **Frontend-Focused** — Optimized for component-based UI applications
2. **Lightweight** — ~8KB runtime with reflect-metadata, tree-shakeable
3. **Class-Based** — Uses `@Injectable()` decorator for services
4. **Type-Safe** — Full TypeScript support with automatic dependency resolution
5. **Reactive** — Works seamlessly with signals and resources
6. **Scoped** — Singleton, Module, Transient, and Request scopes
7. **Hierarchical** — Parent/child injector support
8. **Optional Decorators** — Can specify dependencies manually without reflect-metadata

### Difference from Titan DI

| Aspect | Aether (Frontend) | Titan (Backend) |
|--------|-------------------|-----------------|
| **Style** | Class-based (`@Injectable()`) | Class-based (`@Injectable()`) |
| **Bundle Size** | ~8KB | ~12KB |
| **Primary Use** | UI components, client state | Business logic, data access |
| **Injection** | `inject()` or constructor | Constructor injection |
| **Scopes** | Singleton/Module/Transient/Request | Singleton/Transient/Request/Custom |
| **Connection** | Separate container | Separate container |
| **Integration** | Via Netron RPC proxies | Via Netron RPC services |

## Basic Concepts

### Injectable Service

A service is a class marked with the `@Injectable()` decorator.

```typescript
// Simple service
import { Injectable, signal } from 'aether';

@Injectable()
export class CounterService {
  private count = signal(0);

  getCount() {
    return this.count;
  }

  increment() {
    this.count.set(this.count() + 1);
  }

  decrement() {
    this.count.set(this.count() - 1);
  }

  reset() {
    this.count.set(0);
  }
}

// Service with dependencies
import { Injectable } from 'aether';

@Injectable()
export class UserService {
  // Constructor injection (automatic with reflect-metadata)
  constructor(private http: HttpService) {}

  private users = signal<User[]>([]);

  async loadUsers() {
    const data = await this.http.get('/api/users');
    this.users.set(data);
  }

  get users() {
    return this.users;
  }

  addUser(user: User) {
    this.users.set([...this.users(), user]);
  }
}
```

### Injection

Obtain a service instance using the `inject()` function.

```typescript
import { defineComponent, inject, onMount } from 'aether';
import { For } from 'aether/components';
import { UserService } from './user.service';

// In a component
const UserListComponent = defineComponent(() => {
  const userService = inject(UserService);

  onMount(() => {
    userService.loadUsers();
  });

  return () => (
    <div>
      <For each={userService.users()}>
        {user => <UserCard user={user} />}
      </For>
    </div>
  );
});

// In another service (constructor injection)
@Injectable()
export class AuthService {
  // Constructor injection (automatic with reflect-metadata)
  constructor(
    private userService: UserService,
    private http: HttpService
  ) {}

  async login(credentials: Credentials) {
    const user = await this.http.post('/auth/login', credentials);
    this.userService.addUser(user);
    return user;
  }
}

// Alternative: inject() function (useful in setup functions)
@Injectable()
export class AnalyticsService {
  private logger: LoggerService;

  constructor() {
    // Manual injection using inject()
    this.logger = inject(LoggerService);
  }

  trackEvent(event: string) {
    this.logger.log(`Event: ${event}`);
  }
}
```

## Providers

A provider describes how to create a service instance.

### Class Provider

```typescript
import { defineModule } from 'aether';

export const AppModule = defineModule({
  id: 'app',
  providers: [
    // Shorthand
    UserService,

    // Verbose
    { provide: UserService, useClass: UserService }
  ]
});
```

### Value Provider

```typescript
import { defineModule, InjectionToken } from 'aether';

export const API_URL = new InjectionToken<string>('API_URL');

export const AppModule = defineModule({
  id: 'app',
  providers: [
    { provide: API_URL, useValue: 'https://api.example.com' }
  ]
});
```

### Factory Provider

```typescript
import { defineModule, InjectionToken } from 'aether';

export const DATABASE_CONNECTION = new InjectionToken<Database>('DB');

export const DatabaseModule = defineModule({
  id: 'database',
  providers: [
    {
      provide: DATABASE_CONNECTION,
      useFactory: (config: ConfigService) => {
        return createDatabaseConnection({
          host: config.get('DB_HOST'),
          port: config.get('DB_PORT')
        });
      },
      deps: [ConfigService] // Factory dependencies
    }
  ]
});
```

### Existing Provider (Aliasing)

```typescript
import { defineModule } from 'aether';

// Create an alias for an existing provider
export const UserModule = defineModule({
  id: 'user',
  providers: [
    UserService,
    { provide: 'USER_SERVICE', useExisting: UserService }
  ]
});
```

### Async Provider

```typescript
import { defineModule } from 'aether';

export const ConfigModule = defineModule({
  id: 'config',
  providers: [
    {
      provide: ConfigService,
      useFactory: async () => {
        const config = await loadConfigFromFile();
        return new ConfigService(config);
      },
      async: true // Mark as async
    }
  ]
});
```

## Injection Tokens

Tokens for primitive values and interfaces.

### Creating a Token

```typescript
import { InjectionToken } from 'aether';

// For primitives
export const API_URL = new InjectionToken<string>('API_URL');
export const MAX_RETRIES = new InjectionToken<number>('MAX_RETRIES');

// For interfaces
export interface Logger {
  log(message: string): void;
  error(message: string): void;
}

export const LOGGER = new InjectionToken<Logger>('LOGGER');
```

### Using a Token

```typescript
import { defineModule } from 'aether';

// Registration
export const ApiModule = defineModule({
  id: 'api',
  providers: [
    { provide: API_URL, useValue: 'https://api.example.com' },
    { provide: MAX_RETRIES, useValue: 3 },
    {
      provide: LOGGER,
      useValue: {
        log: console.log,
        error: console.error
      }
    }
  ]
});

// Injection
@Injectable()
export class ApiService {
  constructor(
    @Inject(API_URL) private apiUrl: string,
    @Inject(MAX_RETRIES) private maxRetries: number,
    @Inject(LOGGER) private logger: Logger
  ) {}
}

// Or in a function-based service
export const ApiService = injectable(() => {
  const apiUrl = inject(API_URL);
  const maxRetries = inject(MAX_RETRIES);
  const logger = inject(LOGGER);

  return {
    async fetch(endpoint: string) {
      logger.log(`Fetching ${apiUrl}${endpoint}`);
      // ...
    }
  };
});
```

## Injection Scopes

### Singleton Scope (default)

A single instance across the entire application.

```typescript
@Injectable({ scope: 'singleton' }) // default
export class AuthService {
  // Created once on first injection
}

// Or for function-based
export const AuthService = injectable(() => {
  // Runs once
}, { scope: 'singleton' });
```

### Transient Scope

A new instance on every injection.

```typescript
@Injectable({ scope: 'transient' })
export class IdGenerator {
  id = crypto.randomUUID();

  generate() {
    return this.id;
  }
}

// Each inject(IdGenerator) creates a new instance
const gen1 = inject(IdGenerator); // id: 'xxx-111'
const gen2 = inject(IdGenerator); // id: 'xxx-222'
```

### Request Scope (SSR)

A new instance per HTTP request (server-side only).

```typescript
@Injectable({ scope: 'request' })
export class RequestContext {
  constructor() {
    // Created for each SSR request
  }

  get user() {
    return getCurrentUser();
  }

  get headers() {
    return getCurrentRequest().headers;
  }
}
```

### Module Scope

One instance per module.

```typescript
@Injectable({ scope: 'module' })
export class FeatureService {
  // Separate instance for each module that imports it
}
```

## Hierarchical Injection

Injectors form a hierarchy.

```typescript
import { defineModule } from 'aether';

// Root Injector (AppModule)
export const AppModule = defineModule({
  id: 'app',
  providers: [
    AppService // Singleton for the entire application
  ]
});

// Feature Injector (FeatureModule)
export const FeatureModule = defineModule({
  id: 'feature',
  providers: [
    FeatureService // Separate instance for the FeatureModule
  ]
});

// Hierarchical lookup:
// inject(FeatureService) → Searches FeatureModule → Found
// inject(AppService)     → Searches FeatureModule → Not found
//                        → Searches AppModule → Found
```

### Component Injector

Each component can have its own injector.

```typescript
// ParentComponent.tsx
import { defineComponent, inject } from 'aether';

// Provide a service at the component level
export const providers = [LocalService];

const ParentComponent = defineComponent(() => {
  const local = inject(LocalService);

  return () => (
    <div>
      <ChildComponent />
    </div>
  );
});

// ChildComponent.tsx
import { defineComponent, inject } from 'aether';

const ChildComponent = defineComponent(() => {
  // Gets the same LocalService instance from the parent injector
  const local = inject(LocalService);

  return () => <div>Child content</div>;
});
```

## Optional Dependencies

A dependency can be optional.

```typescript
import { inject, Optional } from 'aether';

@Injectable()
export class AnalyticsService {
  constructor(
    // Optional dependency
    @Optional() private tracker?: TrackerService
  ) {}

  trackEvent(event: string) {
    // Use only if available
    this.tracker?.track(event);
  }
}

// Or in a function-based service
export const AnalyticsService = injectable(() => {
  const tracker = inject(TrackerService, { optional: true });

  return {
    trackEvent(event: string) {
      tracker?.track(event);
    }
  };
});
```

## Self & SkipSelf

Control dependency lookup within the hierarchy.

```typescript
import { inject, Self, SkipSelf } from 'aether';

// Self — search only in the current injector
@Injectable()
export class ChildService {
  constructor(
    @Self() private local: LocalService // Only in the current injector
  ) {}
}

// SkipSelf — skip the current injector
@Injectable()
export class ChildService {
  constructor(
    @SkipSelf() private parent: ParentService // From the parent injector
  ) {}
}
```

## Store Injection

### Injecting Stores

Stores (classes decorated with `@Store()`) can be injected like any other service:

```typescript
// stores/user.store.ts
import { Injectable, Store, Query } from 'aether';
import { signal } from 'aether/reactivity';

@Injectable()
@Store()
export class UserStore {
  users = signal<User[]>([]);

  @Query({ service: 'UserService@1.0.0', method: 'getUsers' })
  async loadUsers() {}
}

// In a component
import { defineComponent, useStore } from 'aether';
import { UserStore } from '@/stores/user.store';

export const UserList = defineComponent(() => {
  const userStore = useStore(UserStore);

  onMount(() => {
    userStore.loadUsers();
  });

  return () => (
    <div>
      <For each={userStore.users()}>
        {user => <UserCard user={user} />}
      </For>
    </div>
  );
});
```

### Store Dependencies

Stores can inject other stores and services:

```typescript
// stores/auth.store.ts
@Injectable()
@Store()
export class AuthStore {
  user = signal<User | null>(null);
  token = signal<string | null>(null);

  @Query({ service: 'AuthService@1.0.0', method: 'getCurrentUser' })
  async loadCurrentUser() {}
}

// stores/cart.store.ts
@Injectable()
@Store()
export class CartStore {
  // Inject other stores
  constructor(
    private authStore: AuthStore,
    private netronClient: NetronClient
  ) {}

  items = signal<CartItem[]>([]);

  @Mutation({
    service: 'CartService@1.0.0',
    method: 'checkout',
    invalidates: ['getCart']
  })
  async checkout() {
    // Access injected store
    const userId = this.authStore.user()?.id;
    if (!userId) throw new Error('Not authenticated');

    return { userId, items: this.items() };
  }
}
```

### Store Lifecycle

Stores have the same lifecycle hooks as services:

```typescript
@Injectable()
@Store()
export class ProductStore {
  products = signal<Product[]>([]);

  // Called when store is created
  onStoreInit() {
    console.log('ProductStore initialized');
    this.loadProducts();
  }

  // Called when store is destroyed
  onStoreDestroy() {
    console.log('ProductStore destroyed');
    // Cleanup subscriptions, timers, etc.
  }

  @Query({ service: 'ProductService@1.0.0', method: 'getProducts' })
  async loadProducts() {}
}
```

### Store Scopes

Stores support the same scopes as services:

```typescript
// Singleton (default) - one instance for entire app
@Injectable()
@Store({ scope: 'singleton' })
export class GlobalStore {
  // Shared across entire application
}

// Module scope - one instance per module
@Injectable()
@Store({ scope: 'module' })
export class FeatureStore {
  // New instance for each module that imports it
}

// Request scope - one instance per SSR request
@Injectable()
@Store({ scope: 'request' })
export class RequestStore {
  // New instance for each HTTP request (SSR only)
}

// Transient scope - new instance on each injection
@Injectable()
@Store({ scope: 'transient' })
export class TempStore {
  // New instance every time it's injected
}
```

### Providing Stores in Modules

Register stores in modules:

```typescript
import { defineModule } from 'aether';
import { UserStore } from './stores/user.store';
import { CartStore } from './stores/cart.store';

export const ShopModule = defineModule({
  id: 'shop',

  // Register stores
  stores: [
    UserStore,
    CartStore
  ],

  // Export stores for use in other modules
  exportStores: [
    UserStore,
    CartStore
  ]
});
```

### Using useStore Hook

The recommended way to access stores in components:

```typescript
import { useStore } from 'aether';

export const ProductList = defineComponent(() => {
  // Get store instance
  const productStore = useStore(ProductStore);

  // Reactive access to store state
  const products = () => productStore.products();
  const loading = () => productStore.loading();

  return () => (
    <div>
      {loading() ? (
        <Spinner />
      ) : (
        <For each={products()}>
          {product => <ProductCard product={product} />}
        </For>
      )}
    </div>
  );
});
```

### Store Testing

Mock stores in tests:

```typescript
import { createTestingModule } from 'aether/testing';
import { UserStore } from './user.store';

describe('UserList', () => {
  it('should display users', () => {
    // Create mock store
    const mockUserStore = {
      users: signal([
        { id: '1', name: 'Alice' },
        { id: '2', name: 'Bob' }
      ]),
      loading: signal(false),
      loadUsers: vi.fn()
    };

    const module = createTestingModule({
      components: [UserList],
      stores: [
        { provide: UserStore, useValue: mockUserStore }
      ]
    });

    const component = module.render(UserList);

    expect(component.getByText('Alice')).toBeInTheDocument();
    expect(component.getByText('Bob')).toBeInTheDocument();
  });
});
```

## Multi Providers

Multiple values for a single token.

```typescript
import { defineModule, InjectionToken } from 'aether';

// Define a multi token
export const HTTP_INTERCEPTORS = new InjectionToken<HttpInterceptor[]>('HTTP_INTERCEPTORS');

// Register multiple providers
export const HttpModule = defineModule({
  id: 'http',
  providers: [
    { provide: HTTP_INTERCEPTORS, useClass: AuthInterceptor, multi: true },
    { provide: HTTP_INTERCEPTORS, useClass: LoggingInterceptor, multi: true },
    { provide: HTTP_INTERCEPTORS, useClass: CacheInterceptor, multi: true }
  ]
});

// Inject an array
@Injectable()
export class HttpService {
  constructor(
    @Inject(HTTP_INTERCEPTORS) private interceptors: HttpInterceptor[]
  ) {
    // interceptors = [AuthInterceptor, LoggingInterceptor, CacheInterceptor]
  }

  async request(url: string) {
    let req = createRequest(url);

    // Apply all interceptors
    for (const interceptor of this.interceptors) {
      req = await interceptor.intercept(req);
    }

    return fetch(req);
  }
}
```

## Titan Integration

**Critical**: Aether and Titan have **separate DI containers**. They integrate via **TypeScript interface contracts** and **Netron RPC proxies**.

### Architecture: Separate DI Containers

```
┌────────────────────────────────┐
│   Aether DI Container         │
│   (Frontend)                   │
│   - UI Services                │
│   - Client State               │
│   - RPC Proxies ───────┐      │
└────────────────────────│───────┘
                         │
                         │ TypeScript Interface
                         │ + Netron RPC
                         │
┌────────────────────────▼───────┐
│   Titan DI Container          │
│   (Backend)                    │
│   - Business Logic             │
│   - Database Access            │
│   - Real Service Implementation│
└────────────────────────────────┘
```

### Step 1: Define Shared Interface (Contract)

```typescript
// shared/interfaces/user-service.interface.ts
export interface IUserService {
  findAll(): Promise<User[]>;
  findOne(id: number): Promise<User>;
  create(data: CreateUserDto): Promise<User>;
}
```

### Step 2: Implement Backend Service (Titan)

```typescript
// backend/services/user.service.ts
import { Injectable, Service, Public } from '@omnitron-dev/titan';
import { IUserService } from '@shared/interfaces/user-service.interface';

@Injectable()
@Service('users@1.0.0')
export class UserService implements IUserService {
  constructor(private db: DatabaseService) {}

  @Public()
  async findAll(): Promise<User[]> {
    return this.db.query('SELECT * FROM users');
  }

  @Public()
  async findOne(id: number): Promise<User> {
    return this.db.queryOne('SELECT * FROM users WHERE id = ?', [id]);
  }

  @Public()
  async create(data: CreateUserDto): Promise<User> {
    return this.db.insert('users', data);
  }
}
```

### Step 3: Create Frontend RPC Proxy

```typescript
// frontend/services/user.service.proxy.ts
import { Injectable } from '@omnitron-dev/aether/di';
import { NetronClient } from '@omnitron-dev/netron/client';
import { IUserService } from '@shared/interfaces/user-service.interface';

@Injectable()
export class UserServiceProxy implements IUserService {
  constructor(private rpc: NetronClient) {}

  async findAll(): Promise<User[]> {
    return this.rpc.call<User[]>('users@1.0.0', 'findAll');
  }

  async findOne(id: number): Promise<User> {
    return this.rpc.call<User>('users@1.0.0', 'findOne', [id]);
  }

  async create(data: CreateUserDto): Promise<User> {
    return this.rpc.call<User>('users@1.0.0', 'create', [data]);
  }
}
```

### Step 4: Register Proxy in Aether DI

```typescript
// frontend/modules/user.module.ts
import { defineModule, InjectionToken } from '@omnitron-dev/aether';
import { UserServiceProxy } from './services/user.service.proxy';
import { IUserService } from '@shared/interfaces/user-service.interface';

// Create injection token for interface
export const USER_SERVICE = new InjectionToken<IUserService>('IUserService');

export const UserModule = defineModule({
  id: 'user',
  providers: [
    {
      provide: USER_SERVICE,
      useClass: UserServiceProxy
    }
  ],
  exportProviders: [USER_SERVICE]
});
```

### Step 5: Use in Components (Type-Safe!)

```typescript
// frontend/routes/users/index.tsx
import { defineComponent, inject, signal, onMount } from 'aether';
import { For } from 'aether/components';
import { USER_SERVICE } from '@/modules/user.module';
import { IUserService } from '@shared/interfaces/user-service.interface';

export default defineComponent(() => {
  // Inject interface, get RPC proxy
  const userService = inject<IUserService>(USER_SERVICE);
  const users = signal<User[]>([]);

  onMount(async () => {
    // RPC call to backend (looks like local call!)
    users.set(await userService.findAll());
  });

  return () => (
    <div>
      <For each={users()}>
        {user => <div>{user.name}</div>}
      </For>
    </div>
  );
});
```

### Why Separate Containers?

**Benefits:**
1. **Security**: Backend services never exposed to client
2. **Tree-Shaking**: Frontend doesn't bundle backend code
3. **Optimization**: Each DI optimized for its use case
4. **Flexibility**: Can use different DI strategies
5. **Type Safety**: Interface contracts enforce API compatibility

**No shared instances, only shared interfaces.**

## Testing

### Mocking Services

```typescript
import { createTestingModule } from 'aether/testing';
import { UserService } from './user.service';

describe('UserComponent', () => {
  it('should load users', async () => {
    // Mock service
    const mockUserService = {
      findAll: vi.fn().mockResolvedValue([
        { id: 1, name: 'John' },
        { id: 2, name: 'Jane' }
      ])
    };

    const module = createTestingModule({
      components: [UserComponent],
      providers: [
        { provide: UserService, useValue: mockUserService }
      ]
    });

    const component = module.render(UserComponent);

    await waitFor(() => {
      expect(component.getByText('John')).toBeInTheDocument();
    });

    expect(mockUserService.findAll).toHaveBeenCalled();
  });
});
```

## Advanced Patterns

### Dynamic Providers

```typescript
import { defineModule } from 'aether';

// Providers based on configuration
export const FeatureModule = defineModule({
  id: 'feature',
  providers: [
    {
      provide: FEATURE_FLAGS,
      useFactory: (config: ConfigService) => {
        return {
          enableNewUI: config.get('FEATURE_NEW_UI'),
          enableBetaFeatures: config.get('FEATURE_BETA')
        };
      },
      deps: [ConfigService]
    }
  ]
});
```

### Conditional Providers

```typescript
import { defineModule } from 'aether';

// Different providers depending on the environment
export const LoggerModule = defineModule({
  id: 'logger',
  providers: [
    import.meta.env.PROD
      ? { provide: Logger, useClass: ProductionLogger }
      : { provide: Logger, useClass: DevelopmentLogger }
  ]
});
```

### Decorator Composition

```typescript
// Compose decorators for metadata
export function Cache(ttl: number) {
  return (target: any, propertyKey: string) => {
    Reflect.defineMetadata('cache:ttl', ttl, target, propertyKey);
  };
}

@Injectable()
export class ApiService {
  @Cache(60000) // 1 minute
  async fetchUsers() {
    return fetch('/api/users');
  }
}
```

## Best Practices

### 1. Use DI for Testability and Modularity

```typescript
// ✅ Good: Injectable service, easy to test and mock
@Injectable()
export class CounterService {
  private count = signal(0);

  getCount() {
    return this.count;
  }

  increment() {
    this.count.set(this.count() + 1);
  }
}

// ❌ Avoid: Global singleton, hard to test
export const counterService = {
  count: signal(0),
  increment() {
    this.count.set(this.count() + 1);
  }
};
```

### 2. Use Injection Tokens for Primitives and Interfaces

```typescript
// ✅ Good
export const API_URL = new InjectionToken<string>('API_URL');

// ❌ Bad: a string cannot be a token
provide: 'API_URL' // Not type-safe!
```

### 3. Singleton by Default

```typescript
// ✅ Good: singleton for most services
@Injectable() // scope: 'singleton' by default
export class UserService {}

// ⚠️ Use carefully: transient only when needed
@Injectable({ scope: 'transient' })
export class TemporaryService {}
```

### 4. Testability

```typescript
// ✅ Good: easy to mock
@Injectable()
export class UserService {
  constructor(private http: HttpService) {}
}

// In tests
{ provide: UserService, useValue: mockUserService }

// ❌ Bad: global dependency
@Injectable()
export class UserService {
  async fetch() {
    return fetch('/api/users'); // Hard to mock
  }
}
```

## Conclusion

The DI system in Aether provides:

- ✅ **Type Safety** — Full type safety
- ✅ **Simplicity** — Minimal boilerplate
- ✅ **Testability** — Easy to test
- ✅ **Performance** — Tree-shakeable
- ✅ **Flexibility** — Multiple scopes, hierarchical injection
- ✅ **Titan Integration** — Unified container for frontend and backend

Next section: [12-THEMING.md](./12-THEMING.md)
