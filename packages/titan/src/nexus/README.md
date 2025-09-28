# Nexus DI - Advanced Dependency Injection System

## Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [Core Concepts](#core-concepts)
  - [Container](#container)
  - [Tokens](#tokens)
  - [Providers](#providers)
  - [Scopes](#scopes)
  - [Modules](#modules)
- [API Reference](#api-reference)
  - [Container API](#container-api)
  - [Token System](#token-system)
  - [Provider Types](#provider-types)
  - [Decorators](#decorators)
  - [Module System](#module-system)
- [Advanced Features](#advanced-features)
  - [Async Resolution](#async-resolution)
  - [Streaming Providers](#streaming-providers)
  - [Contextual Injection](#contextual-injection)
  - [Middleware System](#middleware-system)
  - [Plugin Architecture](#plugin-architecture)
- [Usage Examples](#usage-examples)
- [Best Practices](#best-practices)
- [Migration Guide](#migration-guide)

## Overview

Nexus DI is a powerful, type-safe dependency injection container for TypeScript applications. It provides a comprehensive IoC (Inversion of Control) system with support for async resolution, streaming, contextual injection, and advanced lifecycle management.

### Core Philosophy

- **Type Safety**: Full TypeScript support with strong typing
- **Flexibility**: Multiple provider types and registration patterns
- **Performance**: Optimized resolution with caching and lazy loading
- **Extensibility**: Plugin and middleware systems
- **Runtime Agnostic**: Works in Node.js, Bun, Deno, and browsers

## Key Features

- 🎯 **Type-Safe Tokens**: Strongly typed dependency injection
- 🔄 **Async Support**: First-class async provider support
- 📦 **Module System**: Organize code into reusable modules
- 🌊 **Streaming**: AsyncIterable provider support
- 🎭 **Contextual Injection**: Context-aware dependency resolution
- 🔌 **Plugin System**: Extensible through plugins
- 🛠️ **Middleware**: Request interception and transformation
- 🏗️ **Multiple Scopes**: Singleton, Transient, Scoped, Request
- 🧪 **Testing Utilities**: Built-in testing support
- 🔍 **DevTools**: Development tools and debugging

## Core Concepts

### Container

The `Container` is the central component that manages dependencies, their lifecycle, and resolution.

```typescript
import { Container } from '@omnitron-dev/titan/nexus';

const container = new Container();
```

### Tokens

Tokens are type-safe identifiers for dependencies:

```typescript
import { createToken } from '@omnitron-dev/titan/nexus';

// Basic token
const DATABASE = createToken<Database>('Database');

// Token with metadata
const API_SERVICE = createToken<ApiService>('ApiService', {
  description: 'Main API service',
  scope: Scope.Singleton,
  tags: ['api', 'service']
});

// Multi-token for multiple providers
const MIDDLEWARE = createMultiToken<Middleware>('Middleware');

// Optional token
const CACHE = createOptionalToken<Cache>('Cache');
```

### Providers

Providers define how to create instances:

```typescript
// Class provider
container.register(UserService, {
  useClass: UserServiceImpl,
  scope: Scope.Singleton
});

// Factory provider
container.register(DATABASE, {
  useFactory: (config: Config) => new Database(config.dbUrl),
  inject: [CONFIG],
  scope: Scope.Singleton
});

// Value provider
container.register(CONFIG, {
  useValue: { apiUrl: 'https://api.example.com' }
});

// Token provider (aliasing)
container.register(LOGGER, {
  useToken: ConsoleLogger
});
```

### Scopes

Control instance lifecycle with scopes:

```typescript
enum Scope {
  Transient = 'transient',  // New instance each time
  Singleton = 'singleton',  // One instance per container
  Scoped = 'scoped',       // One instance per scope
  Request = 'request'      // One instance per request
}
```

### Modules

Organize providers into reusable modules:

```typescript
@Module({
  imports: [DatabaseModule],
  providers: [UserService, UserRepository],
  exports: [UserService]
})
class UserModule {}
```

## API Reference

### Container API

#### Core Registration Methods

```typescript
class Container {
  /**
   * Register a provider with various overloads
   */
  register<T>(
    token: InjectionToken<T>,
    provider: Provider<T>,
    options?: RegistrationOptions
  ): this;

  register<T>(provider: Provider<T>, options?: RegistrationOptions): this;

  register<T>(token: Constructor<T>): this;

  /**
   * Register async provider (deprecated - use register with async flag)
   */
  registerAsync<T>(
    token: InjectionToken<T>,
    provider: FactoryProvider<T>,
    options?: RegistrationOptions
  ): this;

  /**
   * Register streaming provider
   */
  registerStream<T>(
    token: InjectionToken<AsyncIterable<T>>,
    provider: Provider<AsyncIterable<T>>,
    options?: RegistrationOptions
  ): this;
}
```

#### Resolution Methods

```typescript
class Container {
  /**
   * Resolve a dependency synchronously
   */
  resolve<T>(token: InjectionToken<T>, context?: any): T;

  /**
   * Resolve a dependency asynchronously
   */
  resolveAsync<T>(token: InjectionToken<T>): Promise<T>;

  /**
   * Resolve multiple instances for multi-token
   */
  resolveMany<T>(token: InjectionToken<T>): T[];

  /**
   * Resolve all registered providers for a token
   */
  resolveAll<T>(token: InjectionToken<T>): T[];

  /**
   * Resolve optional dependency (returns undefined if not found)
   */
  resolveOptional<T>(token: InjectionToken<T>): T | undefined;

  /**
   * Resolve streaming dependency
   */
  resolveStream<T>(token: InjectionToken<AsyncIterable<T>>): AsyncIterable<T>;

  /**
   * Resolve multiple tokens in parallel
   */
  resolveParallel<T>(tokens: InjectionToken<T>[]): Promise<T[]>;

  /**
   * Resolve with settled results (doesn't throw on failure)
   */
  resolveParallelSettled<T>(
    tokens: InjectionToken<T>[]
  ): Promise<Array<{
    status: 'fulfilled', value: T
  } | {
    status: 'rejected', reason: any
  }>>;

  /**
   * Batch resolution with timeout and fail-fast options
   */
  resolveBatch<T extends Record<string, InjectionToken<any>> | InjectionToken<any>[]>(
    tokens: T,
    options?: { timeout?: number; failFast?: boolean }
  ): Promise</* mapped result type */>;

  /**
   * Create lazy proxy (resolves on first access)
   */
  resolveLazy<T>(token: InjectionToken<T>): T;

  /**
   * Create async lazy proxy
   */
  resolveLazyAsync<T>(token: InjectionToken<T>): Promise<T>;
}
```

#### Container Management

```typescript
class Container {
  /**
   * Check if token is registered
   */
  has(token: InjectionToken<any>): boolean;

  /**
   * Create child container with context
   */
  createScope(context?: Partial<ResolutionContext>): IContainer;

  /**
   * Create child container (alias for createScope)
   */
  createChildContainer(context?: Partial<ResolutionContext>): IContainer;

  /**
   * Initialize container and all eager singletons
   */
  initialize(): Promise<void>;

  /**
   * Dispose container and cleanup resources
   */
  dispose(): Promise<void>;

  /**
   * Clear resolution cache
   */
  clearCache(): void;

  /**
   * Get container metadata
   */
  getMetadata(): ContainerMetadata;

  /**
   * Get context provider
   */
  getContext(): ContextProvider;
}
```

#### Plugin and Middleware

```typescript
class Container {
  /**
   * Install a plugin
   */
  use(plugin: Plugin): this;

  /**
   * Check if plugin is installed
   */
  hasPlugin(pluginName: string): boolean;

  /**
   * Add middleware to resolution pipeline
   */
  addMiddleware(middleware: Middleware): this;

  /**
   * Remove middleware by name
   */
  removeMiddleware(name: string): this;
}
```

### Token System

#### Token Creation

```typescript
// Basic token
const TOKEN = createToken<Type>('TokenName');

// Token with metadata
const TOKEN = createToken<Type>('TokenName', {
  description: 'Token description',
  scope: Scope.Singleton,
  tags: ['tag1', 'tag2']
});

// Multi-token (allows multiple providers)
const MULTI = createMultiToken<Type>('MultiToken');

// Optional token (won't throw if not found)
const OPTIONAL = createOptionalToken<Type>('OptionalToken');

// Lazy token (deferred resolution)
const LAZY = createLazyToken<Type>('LazyToken');

// Async token
const ASYNC = createAsyncToken<Type>('AsyncToken');

// Scoped token (with default scope)
const SCOPED = createScopedToken<Type>('ScopedToken', Scope.Request);

// Config token (for configuration values)
const CONFIG = createConfigToken<ConfigType>('Config');

// Stream token
const STREAM = createStreamToken<DataType>('DataStream');
```

#### Token Utilities

```typescript
// Check if value is a token
isToken(value: any): boolean

// Check if token is multi-token
isMultiToken(token: Token): boolean

// Check if token is optional
isOptionalToken(token: Token): boolean

// Get token name
getTokenName(token: Token): string

// Create token from class
tokenFromClass(constructor: Constructor): Token
```

### Provider Types

#### ClassProvider

```typescript
interface ClassProvider<T> {
  useClass: Constructor<T>;
  scope?: Scope;
  inject?: InjectionToken[];  // Constructor dependencies
  multi?: boolean;             // For multi-token
  condition?: (context: ResolutionContext) => boolean;
  fallback?: Provider<T>;      // Fallback if condition fails
}

// Example
container.register(SERVICE, {
  useClass: ServiceImpl,
  scope: Scope.Singleton,
  inject: [DATABASE, LOGGER]
});
```

#### FactoryProvider

```typescript
interface FactoryProvider<T> {
  useFactory: Factory<T> | AsyncFactory<T>;
  inject?: InjectionToken[];  // Factory parameters
  scope?: Scope;
  async?: boolean;             // Mark as async
  timeout?: number;            // Async timeout
  retry?: {                   // Retry configuration
    maxAttempts: number;
    delay: number;
  };
  multi?: boolean;
  condition?: (context: ResolutionContext) => boolean;
  fallback?: Provider<T>;
}

// Example
container.register(CONNECTION, {
  useFactory: async (config: Config) => {
    const conn = await createConnection(config.dbUrl);
    return conn;
  },
  inject: [CONFIG],
  async: true,
  timeout: 5000,
  retry: { maxAttempts: 3, delay: 1000 }
});
```

#### ValueProvider

```typescript
interface ValueProvider<T> {
  useValue: T;
  validate?: string | ((value: T) => void);
  multi?: boolean;
  condition?: (context: ResolutionContext) => boolean;
  fallback?: Provider<T>;
}

// Example
container.register(CONFIG, {
  useValue: {
    apiUrl: 'https://api.example.com',
    timeout: 30000
  },
  validate: (config) => {
    if (!config.apiUrl) throw new Error('API URL required');
  }
});
```

#### TokenProvider

```typescript
interface TokenProvider<T> {
  useToken: InjectionToken<T>;  // Alias to another token
  multi?: boolean;
  condition?: (context: ResolutionContext) => boolean;
  fallback?: Provider<T>;
}

// Example
container.register(LOGGER, {
  useToken: process.env.NODE_ENV === 'production'
    ? ProductionLogger
    : ConsoleLogger
});
```

### Decorators

#### Class Decorators

```typescript
// Mark class as injectable with options
@Injectable({
  scope: Scope.Singleton,
  token: CUSTOM_TOKEN,
  tags: ['service']
})
class MyService {}

// Mark class as module
@Module({
  imports: [OtherModule],
  providers: [ServiceA, ServiceB],
  exports: [ServiceA],
  global: true  // Makes exports globally available
})
class MyModule {}

// Mark as scoped (shorthand for scope: Scope.Scoped)
@Scoped()
class ScopedService {}
```

#### Constructor Parameter Decorators

```typescript
class UserService {
  constructor(
    // Inject specific token
    @Inject(DATABASE) private db: Database,

    // Optional injection (won't throw if not found)
    @Optional() @Inject(CACHE) private cache?: Cache,

    // Inject all providers for multi-token
    @InjectAll(MIDDLEWARE) private middlewares: Middleware[],

    // Inject many (alias for InjectAll)
    @InjectMany(PLUGIN) private plugins: Plugin[],

    // Inject environment variable
    @InjectEnv('API_KEY') private apiKey: string,

    // Inject config value
    @InjectConfig('database.host') private dbHost: string
  ) {}
}
```

#### Method Decorators

```typescript
class Service {
  // Called after construction
  @PostConstruct()
  async initialize() {
    await this.connect();
  }

  // Called before disposal
  @PreDestroy()
  async cleanup() {
    await this.disconnect();
  }
}
```

### Module System

#### Module Definition

```typescript
interface IModule {
  // Core properties
  name: string;
  version?: string;
  dependencies?: (InjectionToken<any> | string)[];

  // DI configuration
  imports?: IModule[];                    // Import other modules
  providers?: Provider[];                 // Module providers
  exports?: InjectionToken[];            // Exported providers
  global?: boolean;                       // Make exports global
  requires?: string[];                    // Required module names

  // Metadata
  metadata?: {
    version?: string;
    description?: string;
    author?: string;
    tags?: string[];
    priority?: number;
  };

  // Lifecycle hooks
  configure?(config: any): void | Promise<void>;
  onRegister?(app: any): void | Promise<void>;
  onStart?(app: any): void | Promise<void>;
  onStop?(app: any): void | Promise<void>;
  onDestroy?(): void | Promise<void>;
  health?(): Promise<HealthStatus>;

  // DI-specific hooks
  onModuleInit?(): Promise<void> | void;
  onModuleDestroy?(): Promise<void> | void;
}
```

#### Dynamic Modules

```typescript
// Create dynamic module with configuration
function createDatabaseModule(config: DbConfig): DynamicModule {
  return {
    module: DatabaseModule,
    providers: [
      {
        provide: DB_CONFIG,
        useValue: config
      },
      DatabaseService
    ],
    exports: [DatabaseService],
    global: true
  };
}

// Usage
const dbModule = createDatabaseModule({
  host: 'localhost',
  port: 5432,
  database: 'myapp'
});
```

#### Module Builder

```typescript
import { ModuleBuilder } from '@omnitron-dev/titan/nexus';

const myModule = new ModuleBuilder('MyModule')
  .addImport(CoreModule)
  .addProvider(MyService)
  .addProvider({
    provide: API_CLIENT,
    useFactory: (config: Config) => new ApiClient(config.apiUrl),
    inject: [CONFIG]
  })
  .addExport(MyService)
  .addExport(API_CLIENT)
  .setGlobal(true)
  .build();
```

#### Functional Module Creation

```typescript
// Using createModule
const AuthModule = createModule({
  name: 'AuthModule',
  imports: [UserModule],
  providers: [
    AuthService,
    JwtService,
    {
      provide: JWT_SECRET,
      useValue: process.env.JWT_SECRET
    }
  ],
  exports: [AuthService]
});

// Using moduleBuilder function
const module = moduleBuilder('MyModule')
  .imports(DatabaseModule, CacheModule)
  .providers(ServiceA, ServiceB)
  .exports(ServiceA)
  .build();
```

## Advanced Features

### Async Resolution

Handle asynchronous dependencies seamlessly:

```typescript
// Register async provider
container.register(DATABASE, {
  useFactory: async () => {
    const connection = await createConnection();
    await connection.runMigrations();
    return connection;
  },
  async: true,
  scope: Scope.Singleton
});

// Resolve asynchronously
const db = await container.resolveAsync(DATABASE);

// Parallel resolution
const [db, cache, queue] = await container.resolveParallel([
  DATABASE,
  CACHE_SERVICE,
  QUEUE_SERVICE
]);

// Batch resolution with options
const services = await container.resolveBatch({
  db: DATABASE,
  cache: CACHE_SERVICE,
  api: API_SERVICE
}, {
  timeout: 5000,
  failFast: false  // Continue even if one fails
});
```

### Streaming Providers

Support for AsyncIterable providers:

```typescript
// Register stream provider
container.registerStream(DATA_STREAM, {
  useFactory: async function*() {
    for await (const data of dataSource) {
      yield processData(data);
    }
  },
  scope: Scope.Singleton
});

// Consume stream
const stream = container.resolveStream(DATA_STREAM);
for await (const data of stream) {
  console.log('Received:', data);
}
```

### Contextual Injection

Context-aware dependency resolution:

```typescript
// Define context strategies
const tenantStrategy = new TenantStrategy();
const roleStrategy = new RoleBasedStrategy();

// Create context-aware provider
const dbProvider = createContextAwareProvider({
  strategies: [tenantStrategy, roleStrategy],
  factory: (context) => {
    const tenant = context.get('tenant');
    return new Database(`db_${tenant}`);
  }
});

// Register with container
container.register(DATABASE, dbProvider);

// Resolve with context
const scope = container.createScope({
  tenant: 'customer1',
  role: 'admin'
});
const db = scope.resolve(DATABASE);
```

### Middleware System

Intercept and transform resolution:

```typescript
// Logging middleware
const loggingMiddleware = new LoggingMiddleware({
  logLevel: 'debug',
  includeTimestamp: true
});

// Caching middleware
const cachingMiddleware = new CachingMiddleware({
  ttl: 60000,
  maxSize: 100
});

// Retry middleware
const retryMiddleware = new RetryMiddleware({
  maxAttempts: 3,
  backoff: 'exponential'
});

// Add to container
container
  .addMiddleware(loggingMiddleware)
  .addMiddleware(cachingMiddleware)
  .addMiddleware(retryMiddleware);
```

### Plugin Architecture

Extend container functionality:

```typescript
// Built-in plugins
import {
  MetricsPlugin,
  LoggingPlugin,
  ValidationPlugin,
  PerformancePlugin
} from '@omnitron-dev/titan/nexus';

// Install plugins
container
  .use(new MetricsPlugin())
  .use(new LoggingPlugin({ level: 'info' }))
  .use(new ValidationPlugin())
  .use(new PerformancePlugin({ threshold: 100 }));

// Create custom plugin
const customPlugin = createPlugin({
  name: 'CustomPlugin',
  version: '1.0.0',
  install(container) {
    // Plugin installation logic
    container.addMiddleware(customMiddleware);
  },
  uninstall(container) {
    // Cleanup logic
    container.removeMiddleware('customMiddleware');
  }
});

container.use(customPlugin);
```

## Usage Examples

### Basic Service Registration

```typescript
import { Container, createToken, Injectable, Inject } from '@omnitron-dev/titan/nexus';

// Define tokens
const DATABASE = createToken<Database>('Database');
const USER_SERVICE = createToken<UserService>('UserService');

// Define services
@Injectable()
class Database {
  async connect() { /* ... */ }
  async query(sql: string) { /* ... */ }
}

@Injectable()
class UserService {
  constructor(
    @Inject(DATABASE) private db: Database
  ) {}

  async getUser(id: string) {
    return this.db.query(`SELECT * FROM users WHERE id = ?`, [id]);
  }
}

// Setup container
const container = new Container();
container.register(DATABASE, Database);
container.register(USER_SERVICE, UserService);

// Use
const userService = container.resolve(USER_SERVICE);
const user = await userService.getUser('123');
```

### Module-Based Architecture

```typescript
// database.module.ts
@Module({
  providers: [
    {
      provide: DATABASE,
      useFactory: async () => {
        const db = new Database();
        await db.connect();
        return db;
      },
      async: true,
      scope: Scope.Singleton
    }
  ],
  exports: [DATABASE]
})
export class DatabaseModule {}

// user.module.ts
@Module({
  imports: [DatabaseModule],
  providers: [UserService, UserRepository],
  exports: [UserService]
})
export class UserModule {}

// app.module.ts
@Module({
  imports: [UserModule],
  providers: [AppService]
})
export class AppModule {}

// main.ts
const container = new Container();
await container.loadModule(AppModule);
await container.initialize();

const appService = container.resolve(AppService);
```

### Testing with Mocks

```typescript
import { TestContainer, createTestContainer } from '@omnitron-dev/titan/nexus';

describe('UserService', () => {
  let container: TestContainer;

  beforeEach(() => {
    container = createTestContainer();

    // Register mock
    container.registerMock(DATABASE, {
      query: jest.fn().mockResolvedValue([{ id: '1', name: 'John' }])
    });

    // Register service under test
    container.register(USER_SERVICE, UserService);
  });

  it('should fetch user', async () => {
    const service = container.resolve(USER_SERVICE);
    const user = await service.getUser('1');

    expect(user).toEqual({ id: '1', name: 'John' });
    expect(container.getMock(DATABASE).query).toHaveBeenCalledWith(
      'SELECT * FROM users WHERE id = ?',
      ['1']
    );
  });
});
```

### Advanced Configuration

```typescript
// Configure with environment-specific providers
const container = new Container();

if (process.env.NODE_ENV === 'production') {
  container.register(CACHE, {
    useClass: RedisCache,
    scope: Scope.Singleton
  });
  container.register(DATABASE, {
    useFactory: () => new PostgresDatabase(process.env.DATABASE_URL),
    scope: Scope.Singleton
  });
} else {
  container.register(CACHE, {
    useClass: MemoryCache,
    scope: Scope.Singleton
  });
  container.register(DATABASE, {
    useClass: SqliteDatabase,
    scope: Scope.Singleton
  });
}

// Conditional providers
container.register(FEATURE_SERVICE, {
  useClass: FeatureService,
  condition: (context) => context.features?.newFeature === true,
  fallback: {
    useClass: LegacyFeatureService
  }
});
```

### Lifecycle Management

```typescript
@Injectable()
class ConnectionPool {
  private pool: Pool;

  @PostConstruct()
  async initialize() {
    this.pool = await createPool({
      max: 10,
      idleTimeout: 30000
    });
  }

  @PreDestroy()
  async cleanup() {
    await this.pool.drain();
    await this.pool.clear();
  }

  async getConnection() {
    return this.pool.acquire();
  }
}

// Container lifecycle
const container = new Container();
container.register(CONNECTION_POOL, ConnectionPool);

// Initialize all services
await container.initialize();

// ... application runs ...

// Cleanup on shutdown
await container.dispose();
```

## Best Practices

### 1. Use Tokens for Type Safety

Always use tokens instead of strings for better type safety:

```typescript
// ❌ Bad
container.register('userService', UserService);
const service = container.resolve('userService'); // No type safety

// ✅ Good
const USER_SERVICE = createToken<UserService>('UserService');
container.register(USER_SERVICE, UserService);
const service = container.resolve(USER_SERVICE); // Type-safe
```

### 2. Organize with Modules

Group related providers into modules:

```typescript
// ✅ Good module organization
@Module({
  imports: [SharedModule],
  providers: [
    AuthService,
    JwtStrategy,
    LocalStrategy
  ],
  exports: [AuthService]
})
class AuthModule {}
```

### 3. Prefer Constructor Injection

Use constructor injection for better testability:

```typescript
// ❌ Bad - property injection
class Service {
  @Inject(DATABASE)
  private db: Database;
}

// ✅ Good - constructor injection
class Service {
  constructor(
    @Inject(DATABASE) private db: Database
  ) {}
}
```

### 4. Use Appropriate Scopes

Choose the right scope for your providers:

```typescript
// Singleton for stateless services
container.register(CALCULATOR, {
  useClass: CalculatorService,
  scope: Scope.Singleton
});

// Transient for stateful objects
container.register(REQUEST_CONTEXT, {
  useClass: RequestContext,
  scope: Scope.Transient
});

// Scoped for request-specific data
container.register(USER_SESSION, {
  useClass: UserSession,
  scope: Scope.Request
});
```

### 5. Handle Async Dependencies Properly

Always use async resolution for async providers:

```typescript
// Register as async
container.register(DATABASE, {
  useFactory: async () => { /* ... */ },
  async: true
});

// Resolve asynchronously
const db = await container.resolveAsync(DATABASE);
```

### 6. Implement Proper Cleanup

Always implement disposal for resources:

```typescript
@Injectable()
class ResourceService implements Disposable {
  async dispose() {
    await this.closeConnections();
    await this.clearCache();
  }
}
```

### 7. Use Validation for Configuration

Validate configuration values:

```typescript
container.register(CONFIG, {
  useValue: configData,
  validate: (config) => {
    if (!config.apiKey) throw new Error('API key required');
    if (!config.apiUrl) throw new Error('API URL required');
  }
});
```

## Migration Guide

### From Other DI Libraries

#### From InversifyJS

```typescript
// InversifyJS
@injectable()
class Service {
  constructor(
    @inject(TYPES.Database) private db: Database
  ) {}
}

// Nexus DI
@Injectable()
class Service {
  constructor(
    @Inject(DATABASE) private db: Database
  ) {}
}
```

#### From NestJS

```typescript
// NestJS
@Injectable()
export class CatsService {
  constructor(
    @InjectRepository(Cat)
    private catsRepository: Repository<Cat>
  ) {}
}

// Nexus DI
@Injectable()
export class CatsService {
  constructor(
    @Inject(CAT_REPOSITORY)
    private catsRepository: Repository<Cat>
  ) {}
}
```

#### From Angular

```typescript
// Angular
@Injectable({
  providedIn: 'root'
})
export class HeroService {
  constructor(private http: HttpClient) {}
}

// Nexus DI
@Injectable({ scope: Scope.Singleton })
export class HeroService {
  constructor(
    @Inject(HTTP_CLIENT) private http: HttpClient
  ) {}
}
```

### Common Migration Patterns

1. **Replace decorators**: Update decorator imports and syntax
2. **Create tokens**: Define tokens for all dependencies
3. **Update modules**: Convert module definitions to Nexus format
4. **Adjust scopes**: Map scopes to Nexus scope system
5. **Handle async**: Use async resolution for async providers

## Performance Characteristics

### Resolution Performance

- **Singleton**: O(1) after first resolution (cached)
- **Transient**: O(n) where n is dependency depth
- **Scoped**: O(1) within scope (cached per scope)
- **Lazy**: O(1) proxy creation, deferred resolution

### Memory Usage

- **Container overhead**: ~100KB base
- **Per registration**: ~1KB metadata
- **Cached instances**: Varies by scope
- **Child containers**: ~10KB per container

### Optimization Tips

1. Use singleton scope for stateless services
2. Enable lazy loading for rarely used services
3. Use `resolveBatch` for parallel resolution
4. Clear cache periodically for long-running apps
5. Dispose unused child containers

## Troubleshooting

### Common Issues

#### Circular Dependencies

```typescript
// Problem: A depends on B, B depends on A
// Solution: Use lazy resolution or refactor

const A_SERVICE = createLazyToken<AService>('AService');
const B_SERVICE = createToken<BService>('BService');

class AService {
  constructor(@Inject(B_SERVICE) private b: BService) {}
}

class BService {
  constructor(@Inject(A_SERVICE) private a: AService) {}
}
```

#### Missing Provider

```typescript
// Error: DependencyNotFoundError: No provider found for token "Database"
// Solution: Ensure provider is registered

container.register(DATABASE, DatabaseImpl);
```

#### Async Resolution Issues

```typescript
// Error: Cannot resolve async provider synchronously
// Solution: Use resolveAsync for async providers

const db = await container.resolveAsync(DATABASE);
```

### Debug Tools

```typescript
// Enable debug logging
const container = new Container({ debug: true });

// Get container metadata
const meta = container.getMetadata();
console.log('Registrations:', meta.registrations);
console.log('Cached:', meta.cached);

// Use DevTools plugin
container.use(new DevToolsPlugin());
```

## Enterprise Features

### Service Mesh

Distributed service discovery and communication:

```typescript
import {
  ServiceMeshManager,
  ConsulServiceDiscovery,
  createRemoteProxy
} from '@omnitron-dev/titan/nexus';

// Setup service mesh
const mesh = new ServiceMeshManager({
  discovery: new ConsulServiceDiscovery({
    host: 'consul.local',
    port: 8500
  }),
  loadBalancing: 'round-robin',
  circuitBreaker: {
    failureThreshold: 5,
    resetTimeout: 60000
  }
});

// Register local service
await mesh.registerService({
  name: 'user-service',
  version: '1.0.0',
  host: 'localhost',
  port: 3000,
  health: '/health'
});

// Create remote service proxy
const remoteUserService = createRemoteProxy<UserService>({
  service: 'user-service',
  mesh: mesh,
  timeout: 5000,
  retry: {
    maxAttempts: 3,
    backoff: 'exponential'
  }
});

// Use remote service
const user = await remoteUserService.getUser('123');
```

### Module Federation

Share modules across applications:

```typescript
import { FederatedContainer } from '@omnitron-dev/titan/nexus';

// Host application
const hostContainer = new FederatedContainer({
  name: 'host-app',
  exposes: {
    './UserModule': UserModule,
    './AuthModule': AuthModule
  }
});

// Remote application
const remoteContainer = new FederatedContainer({
  name: 'remote-app',
  remotes: {
    host: 'http://localhost:3000/remoteEntry.js'
  }
});

// Import remote module
const UserModule = await remoteContainer.importRemote(
  'host/UserModule'
);
```

### Distributed Tracing

Track requests across services:

```typescript
import {
  TracingManager,
  TraceSpan,
  JaegerExporter
} from '@omnitron-dev/titan/nexus';

// Setup tracing
const tracing = new TracingManager({
  serviceName: 'api-gateway',
  exporter: new JaegerExporter({
    endpoint: 'http://jaeger:14268/api/traces'
  })
});

// Trace operations
const span = tracing.startSpan('process-request');
try {
  // Operation logic
  const result = await processRequest();
  span.setTag('status', 'success');
  return result;
} catch (error) {
  span.setTag('error', true);
  span.log({ message: error.message });
  throw error;
} finally {
  span.finish();
}
```

### DevTools Integration

Development and debugging tools:

```typescript
import {
  DevToolsPlugin,
  ContainerInspector,
  DependencyGraph
} from '@omnitron-dev/titan/nexus';

// Enable DevTools
const container = new Container();
container.use(new DevToolsPlugin({
  port: 9229,
  enableInspector: true,
  enableProfiler: true
}));

// Inspect container
const inspector = new ContainerInspector(container);
const graph = inspector.getDependencyGraph();
console.log(graph.toDot()); // GraphViz format

// Get resolution timeline
const timeline = inspector.getResolutionTimeline();
timeline.forEach(event => {
  console.log(`${event.token}: ${event.duration}ms`);
});

// Memory profiling
const memory = inspector.getMemoryProfile();
console.log(`Instances: ${memory.instanceCount}`);
console.log(`Memory: ${memory.heapUsed / 1024 / 1024}MB`);
```

## Error Reference

### Resolution Errors

| Error | Description | Solution |
|-------|-------------|----------|
| `ResolutionError` | Base resolution error | Check provider registration |
| `CircularDependencyError` | Circular dependency detected | Use lazy resolution or refactor |
| `DependencyNotFoundError` | No provider for token | Register missing provider |
| `AsyncResolutionError` | Async provider error | Use resolveAsync for async providers |
| `ScopeMismatchError` | Scope conflict | Ensure scope compatibility |

### Registration Errors

| Error | Description | Solution |
|-------|-------------|----------|
| `RegistrationError` | Base registration error | Check provider configuration |
| `DuplicateRegistrationError` | Token already registered | Use override option or different token |
| `InvalidProviderError` | Invalid provider config | Validate provider structure |
| `NotInjectableError` | Class not marked injectable | Add @Injectable decorator |

### Lifecycle Errors

| Error | Description | Solution |
|-------|-------------|----------|
| `InitializationError` | Initialization failed | Check onInit implementation |
| `DisposalError` | Disposal failed | Check dispose implementation |
| `ContainerDisposedError` | Container already disposed | Create new container |
| `ModuleError` | Module loading failed | Check module configuration |

## Testing Utilities

### Test Container

```typescript
import {
  TestContainer,
  createTestContainer,
  createIsolatedTestContainer
} from '@omnitron-dev/titan/nexus';

// Create test container
const container = createTestContainer({
  autoMock: true,
  isolate: true
});

// Register mocks
container.registerMock(DATABASE, {
  query: jest.fn(),
  connect: jest.fn()
});

// Spy on provider
container.registerSpy(LOGGER, ConsoleLogger);

// Create stub
container.registerStub(CACHE, {
  get: () => null,
  set: () => void 0
});

// Get mock instance
const dbMock = container.getMock(DATABASE);
expect(dbMock.query).toHaveBeenCalled();

// Get spy
const loggerSpy = container.getSpy(LOGGER);
expect(loggerSpy.log).toHaveBeenCalledWith('test');
```

### Test Harness

```typescript
import {
  TestHarness,
  createTestHarness,
  expectResolution,
  expectRejection,
  expectLifecycle
} from '@omnitron-dev/titan/nexus';

// Create harness
const harness = createTestHarness();

// Test resolution
await expectResolution(harness, TOKEN)
  .toResolve()
  .withValue(expectedValue)
  .inTime(100);

// Test rejection
await expectRejection(harness, FAILING_TOKEN)
  .toThrow(ResolutionError)
  .withMessage(/not found/);

// Test lifecycle
await expectLifecycle(harness, SERVICE)
  .toCallOnInit()
  .toCallOnDestroy()
  .inOrder();
```

### Snapshot Testing

```typescript
// Snapshot container state
const snapshot = container.createSnapshot();

// Modify container
container.register(NEW_SERVICE, NewService);

// Restore snapshot
container.restoreSnapshot(snapshot);

// Compare snapshots
const diff = container.compareSnapshot(snapshot);
console.log('Added:', diff.added);
console.log('Removed:', diff.removed);
console.log('Modified:', diff.modified);
```

## API Stability

| Feature | Status | Since |
|---------|--------|-------|
| Core Container | Stable | 1.0.0 |
| Token System | Stable | 1.0.0 |
| Basic Providers | Stable | 1.0.0 |
| Async Resolution | Stable | 1.1.0 |
| Module System | Stable | 1.2.0 |
| Decorators | Stable | 1.0.0 |
| Middleware | Stable | 2.0.0 |
| Plugins | Stable | 2.0.0 |
| Streaming | Beta | 2.1.0 |
| Context System | Beta | 2.2.0 |
| Federation | Alpha | 3.0.0 |
| Service Mesh | Alpha | 3.0.0 |
| Distributed Tracing | Alpha | 3.1.0 |
| DevTools | Beta | 3.2.0 |

## License

MIT - See LICENSE file for details