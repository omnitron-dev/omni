# Dependency Injection - Frontend DI System

## Introduction

The Dependency Injection (DI) system in Nexus is a **lightweight, frontend-focused** DI system optimized for reactive UI applications. It is **separate** from Titan's backend DI but connects to it via type-safe RPC contracts.

> **Architecture Note**: Frontend (Nexus) and Backend (Titan) have **separate DI systems**. They communicate via interface contracts, not shared service instances. See `19-TITAN-INTEGRATION.md` for details.

### Key Principles

1. **Frontend-Focused** — Optimized for component-based UI applications
2. **Lightweight** — Minimal overhead, tree-shakeable
3. **Function-Based** — Prefer `injectable()` over class decorators
4. **Type-Safe** — Full TypeScript support
5. **Reactive** — Works seamlessly with signals and resources
6. **Module-Scoped** — Services scoped to Nexus modules
7. **Zero-Config** — Works out of the box

### Difference from Titan DI

| Aspect | Nexus (Frontend) | Titan (Backend) |
|--------|------------------|-----------------|
| **Style** | Function-based (`injectable()`) | Class-based (`@Injectable()`) |
| **Overhead** | Minimal (tree-shakeable) | Feature-rich (scopes, decorators) |
| **Primary Use** | UI components, client state | Business logic, data access |
| **Injection** | `inject()` in setup | Constructor injection |
| **Scope** | Component/Module | Singleton/Transient/Request |
| **Connection** | Via RPC proxies | Via service implementation |

## Basic Concepts

### Injectable Service

A service is a class or function marked with the `Injectable` decorator/function.

```typescript
// Function-based service (recommended for simple cases)
import { injectable } from 'nexus';

export const CounterService = injectable(() => {
  const count = signal(0);

  return {
    count,
    increment() {
      count.set(count() + 1);
    },
    decrement() {
      count.set(count() + 1);
    },
    reset() {
      count.set(0);
    }
  };
});

// Class-based service (for complex logic and inheritance)
import { Injectable } from 'nexus';

@Injectable()
export class UserService {
  private users = signal<User[]>([]);

  async loadUsers() {
    const data = await fetch('/api/users').then(r => r.json());
    this.users(data);
  }

  get users() {
    return this.users;
  }

  addUser(user: User) {
    this.users([...this.users(), user]);
  }
}
```

### Injection

Obtain a service instance using the `inject()` function.

```typescript
import { defineComponent, inject, onMount } from 'nexus';
import { For } from 'nexus/components';
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

// In another service
@Injectable()
export class AuthService {
  // Injection via constructor
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

// In a function-based service
export const AuthService = injectable(() => {
  const userService = inject(UserService);
  const http = inject(HttpService);

  return {
    async login(credentials) {
      const user = await http.post('/auth/login', credentials);
      userService.addUser(user);
      return user;
    }
  };
});
```

## Providers

A provider describes how to create a service instance.

### Class Provider

```typescript
import { defineModule } from 'nexus';

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
import { defineModule, InjectionToken } from 'nexus';

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
import { defineModule, InjectionToken } from 'nexus';

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
import { defineModule } from 'nexus';

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
import { defineModule } from 'nexus';

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
import { InjectionToken } from 'nexus';

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
import { defineModule } from 'nexus';

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
import { defineModule } from 'nexus';

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
import { defineComponent, inject } from 'nexus';

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
import { defineComponent, inject } from 'nexus';

const ChildComponent = defineComponent(() => {
  // Gets the same LocalService instance from the parent injector
  const local = inject(LocalService);

  return () => <div>Child content</div>;
});
```

## Optional Dependencies

A dependency can be optional.

```typescript
import { inject, Optional } from 'nexus';

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
import { inject, Self, SkipSelf } from 'nexus';

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

## Multi Providers

Multiple values for a single token.

```typescript
import { defineModule, InjectionToken } from 'nexus';

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

Nexus uses a unified DI container with Titan.

### Shared Service

```typescript
// services/user.service.ts — a single file for frontend and backend
import { Injectable } from '@omnitron-dev/titan';

@Injectable()
export class UserService {
  private users = signal<User[]>([]);

  // Backend method (database access)
  async loadFromDatabase() {
    if (import.meta.env.SERVER) {
      const users = await this.db.query('SELECT * FROM users');
      this.users(users);
    }
  }

  // Frontend method (RPC)
  async loadFromAPI() {
    if (import.meta.env.CLIENT) {
      const users = await fetch('/api/users').then(r => r.json());
      this.users(users);
    }
  }

  // Shared method (works everywhere)
  get users() {
    return this.users;
  }

  addUser(user: User) {
    this.users([...this.users(), user]);
  }
}
```

### Backend-Only Service (Titan)

```typescript
import { Injectable, Service, Public } from '@omnitron-dev/titan';

@Injectable()
@Service('users@1.0.0')
export class UserService {
  constructor(private db: DatabaseService) {}

  @Public()
  async findAll(): Promise<User[]> {
    return this.db.query('SELECT * FROM users');
  }

  @Public()
  async findOne(id: number): Promise<User> {
    return this.db.queryOne('SELECT * FROM users WHERE id = ?', [id]);
  }
}
```

### Frontend RPC Client (auto-generated)

```typescript
// Automatically generated by the compiler
export class UserServiceClient {
  constructor(private rpc: NetronClient) {}

  async findAll(): Promise<User[]> {
    return this.rpc.call('users@1.0.0', 'findAll', []);
  }

  async findOne(id: number): Promise<User> {
    return this.rpc.call('users@1.0.0', 'findOne', [id]);
  }
}

// Automatically registered in the Nexus DI container
export const UserModule = defineModule({
  id: 'user',
  providers: [
    {
      provide: UserService,
      useClass: UserServiceClient, // On the client
      // useClass: UserService      // On the server
    }
  ]
});
```

### Usage in components

```typescript
// routes/users/index.tsx
import { defineComponent, inject, signal, onMount } from 'nexus';
import { For } from 'nexus/components';
import { UserService } from '@/services/user.service';
import { UserCard } from '@/components/UserCard';

export default defineComponent(() => {
  // Same code on client and server!
  const userService = inject(UserService);
  const users = signal<User[]>([]);

  onMount(async () => {
    // On the server: direct method call
    // On the client: RPC via Netron
    users(await userService.findAll());
  });

  return () => (
    <div>
      <For each={users()}>
        {user => <UserCard user={user} />}
      </For>
    </div>
  );
});
```

## Testing

### Mocking Services

```typescript
import { createTestingModule } from 'nexus/testing';
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
import { defineModule } from 'nexus';

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
import { defineModule } from 'nexus';

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

### 1. Prefer Function-Based Services

```typescript
// ✅ Good: simpler, less boilerplate
export const CounterService = injectable(() => {
  const count = signal(0);
  return {
    count,
    increment: () => count.set(count() + 1)
  };
});

// ❌ Bad: unnecessary syntax for simple cases
@Injectable()
export class CounterService {
  count = signal(0);

  increment() {
    this.count(this.count() + 1);
  }
}
```

### 2. Use Injection Tokens for Primitives

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

The DI system in Nexus provides:

- ✅ **Type Safety** — Full type safety
- ✅ **Simplicity** — Minimal boilerplate
- ✅ **Testability** — Easy to test
- ✅ **Performance** — Tree-shakeable
- ✅ **Flexibility** — Multiple scopes, hierarchical injection
- ✅ **Titan Integration** — Unified container for frontend and backend

Next section: [12-THEMING.md](./12-THEMING.md)
