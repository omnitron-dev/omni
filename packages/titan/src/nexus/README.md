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
  - [Module System](#module-system)
  - [Middleware System](#middleware-system)
  - [Lifecycle Management](#lifecycle-management)
  - [Context System](#context-system)
- [Advanced Features](#advanced-features)
  - [Async Resolution](#async-resolution)
  - [Streaming Providers](#streaming-providers)
  - [Contextual Injection](#contextual-injection)
- [Experimental Features](#experimental-features)
- [Error Reference](#error-reference)
- [Best Practices](#best-practices)

## Overview

Nexus DI is a powerful, type-safe dependency injection container for TypeScript applications. It provides a comprehensive IoC (Inversion of Control) system with support for async resolution, streaming, contextual injection, and advanced lifecycle management.

### Core Philosophy

- **Type Safety**: Full TypeScript support with strong typing
- **Flexibility**: Multiple provider types and registration patterns
- **Performance**: Optimized resolution with caching and lazy loading
- **Extensibility**: Middleware and extension systems
- **Runtime Agnostic**: Works in Node.js, Bun, Deno, and browsers

## Key Features

- **Type-Safe Tokens**: Strongly typed dependency injection
- **Async Support**: First-class async provider support
- **Module System**: Organize code into reusable modules
- **Streaming**: AsyncIterable provider support
- **Contextual Injection**: Context-aware dependency resolution
- **Middleware**: Request interception and transformation
- **Multiple Scopes**: Singleton, Transient, Scoped, Request
- **Cross-Platform**: Runtime detection and compatibility utilities

## Core Concepts

### Container

The `Container` is the central component that manages dependencies, their lifecycle, and resolution.

```typescript
import { Container, createContainer } from '@omnitron-dev/titan/nexus';

// Create container using class
const container = new Container();

// Or using helper function
const container = createContainer();
```

### Tokens

Tokens are type-safe identifiers for dependencies:

```typescript
import {
  createToken,
  createMultiToken,
  createOptionalToken,
  createLazyToken,
  createAsyncToken,
  createScopedToken,
  createConfigToken,
  createStreamToken
} from '@omnitron-dev/titan/nexus';

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

// Optional token (resolveOptional returns undefined if not found)
const CACHE = createOptionalToken<Cache>('Cache');

// Lazy token (deferred resolution)
const LAZY_SERVICE = createLazyToken<Service>('LazyService');

// Async token
const ASYNC_SERVICE = createAsyncToken<Service>('AsyncService');

// Scoped token (with default scope)
const SCOPED_SERVICE = createScopedToken<Service>('ScopedService', Scope.Request);

// Config token (for configuration values)
const CONFIG = createConfigToken<ConfigType>('Config');

// Stream token
const DATA_STREAM = createStreamToken<DataType>('DataStream');
```

### Providers

Providers define how to create instances:

```typescript
import { Scope } from '@omnitron-dev/titan/nexus';

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

// Async factory provider
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
import { Scope } from '@omnitron-dev/titan/nexus';

// Available scopes
enum Scope {
  Transient = 'transient',  // New instance each time
  Singleton = 'singleton',  // One instance per container
  Scoped = 'scoped',        // One instance per scope
  Request = 'request'       // One instance per request
}
```

### Modules

Organize providers into reusable modules:

```typescript
import { createModule, ModuleBuilder, moduleBuilder } from '@omnitron-dev/titan/nexus';

// Using createModule
const UserModule = createModule({
  name: 'UserModule',
  imports: [DatabaseModule],
  providers: [
    UserService,
    [USER_REPOSITORY, { useClass: UserRepository }]
  ],
  exports: [UserService],
  global: false
});

// Using ModuleBuilder
const module = new ModuleBuilder('MyModule')
  .imports(CoreModule)
  .providers(MyService, OtherService)
  .provide(API_CLIENT, {
    useFactory: (config: Config) => new ApiClient(config.apiUrl),
    inject: [CONFIG]
  })
  .exports(MyService, API_CLIENT)
  .global(true)
  .build();

// Using moduleBuilder function
const module = moduleBuilder('MyModule')
  .imports(DatabaseModule, CacheModule)
  .providers(ServiceA, ServiceB)
  .exports(ServiceA)
  .build();

// Load module into container
container.loadModule(UserModule);
```

## API Reference

### Container API

#### Registration Methods

```typescript
class Container {
  /**
   * Register a provider
   */
  register<T>(
    token: InjectionToken<T>,
    provider: ProviderDefinition<T>,
    options?: RegistrationOptions
  ): this;

  /**
   * Register streaming provider
   */
  registerStream<T>(
    token: InjectionToken<AsyncIterable<T>>,
    provider: ProviderDefinition<AsyncIterable<T>>,
    options?: RegistrationOptions
  ): this;

  /**
   * Auto-register a class based on its decorator metadata
   */
  autoRegister<T>(constructor: Constructor<T>): this;

  /**
   * Load a module
   */
  loadModule(module: IModule): this;

  /**
   * Load enhanced module (with decorator metadata)
   */
  loadEnhancedModule(module: any): this;
}
```

#### Resolution Methods

```typescript
class Container {
  /**
   * Resolve a dependency synchronously
   */
  resolve<T>(token: InjectionToken<T>): T;

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
  ): Promise<Array<{ status: 'fulfilled'; value: T } | { status: 'rejected'; reason: any }>>;

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

  /**
   * Run function with container context
   */
  withContext<T>(fn: () => T): T;

  /**
   * Install an extension
   */
  use(extension: { install(container: IContainer): void }): this;

  /**
   * Set logger instance
   */
  setLogger(logger: ILogger): this;
}
```

#### Middleware and Lifecycle

```typescript
class Container {
  /**
   * Add middleware to resolution pipeline
   */
  addMiddleware(middleware: Middleware): this;

  /**
   * Remove middleware by name
   */
  removeMiddleware(name: string): this;

  /**
   * Add lifecycle hook
   */
  on(event: LifecycleEvent, hook: (data: any) => void | Promise<void>): this;

  /**
   * Remove lifecycle hook
   */
  off(event: LifecycleEvent, hook: (data: any) => void | Promise<void>): this;

  /**
   * Add hook with common event names
   * Maps: beforeResolve, afterResolve, beforeRegister, afterRegister, onError, onDispose
   */
  addHook(event: string, handler: (...args: any[]) => void | Promise<void>): this;
}
```

### Token System

#### Token Creation Functions

```typescript
// Basic token
createToken<T>(name: string, metadata?: TokenMetadata): Token<T>

// Multi-token (allows multiple providers)
createMultiToken<T>(name: string): MultiToken<T>

// Optional token (won't throw if not found)
createOptionalToken<T>(name: string): Token<T>

// Lazy token (deferred resolution)
createLazyToken<T>(name: string): Token<T>

// Async token
createAsyncToken<T>(name: string): Token<T>

// Scoped token (with default scope)
createScopedToken<T>(name: string, scope: Scope): Token<T>

// Config token (for configuration values)
createConfigToken<T>(name: string): Token<T>

// Stream token
createStreamToken<T>(name: string): Token<AsyncIterable<T>>
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
  multi?: boolean;            // For multi-token
  condition?: (context: ResolutionContext) => boolean;
  fallback?: ProviderDefinition<T>;
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
  async?: boolean;            // Mark as async
  timeout?: number;           // Async timeout
  retry?: {                   // Retry configuration
    maxAttempts: number;
    delay: number;
  };
  multi?: boolean;
  condition?: (context: ResolutionContext) => boolean;
  fallback?: ProviderDefinition<T>;
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
  fallback?: ProviderDefinition<T>;
}

// Example
container.register(CONFIG, {
  useValue: {
    apiUrl: 'https://api.example.com',
    timeout: 30000
  }
});
```

#### TokenProvider

```typescript
interface TokenProvider<T> {
  useToken: InjectionToken<T>;  // Alias to another token
  multi?: boolean;
  condition?: (context: ResolutionContext) => boolean;
  fallback?: ProviderDefinition<T>;
}

// Example
container.register(LOGGER, {
  useToken: process.env.NODE_ENV === 'production'
    ? ProductionLogger
    : ConsoleLogger
});
```

#### Provider Utility Functions

```typescript
import {
  createValueProvider,
  createClassProvider,
  createFactoryProvider,
  createTokenProvider,
  createMultiProvider,
  createConditionalProvider,
  isConstructor,
  isAsyncProvider,
  hasScope,
  isMultiProvider
} from '@omnitron-dev/titan/nexus';

// Create provider helpers
const valueProvider = createValueProvider({ foo: 'bar' });
const classProvider = createClassProvider(MyService, { scope: Scope.Singleton });
const factoryProvider = createFactoryProvider(() => new Service(), { inject: [DEP] });
const tokenProvider = createTokenProvider(OTHER_TOKEN);
const multiProvider = createMultiProvider({ useClass: Handler });
const conditionalProvider = createConditionalProvider(
  { useClass: ProdService },
  (ctx) => ctx.metadata?.env === 'production'
);
```

### Module System

#### Module Creation

```typescript
import {
  createModule,
  createDynamicModule,
  ModuleBuilder,
  moduleBuilder,
  createConfigModule,
  createFeatureModule,
  forwardRef
} from '@omnitron-dev/titan/nexus';

// Create static module
const MyModule = createModule({
  name: 'MyModule',
  imports: [OtherModule],
  providers: [
    MyService,
    [MY_TOKEN, { useClass: MyImpl }]
  ],
  exports: [MyService],
  global: false,
  requires: ['RequiredModule'],
  onModuleInit: () => console.log('Module initialized'),
  onModuleDestroy: () => console.log('Module destroyed')
});

// Create dynamic module
const DynamicMod = createDynamicModule({
  name: 'DynamicModule',
  providers: [...],
  imports: [...],
  exports: [...],
  global: true
});

// Create config module
const ConfigModule = createConfigModule({
  name: 'ConfigModule',
  load: async () => loadConfig(),
  validate: (config) => !!config.apiKey
});

// Forward reference (for circular dependencies)
const CircularModule = createModule({
  name: 'CircularModule',
  imports: [forwardRef(() => OtherModule)]
});
```

#### Module Builder

```typescript
const module = new ModuleBuilder('UserModule')
  .imports(DatabaseModule, CacheModule)
  .providers(
    UserService,
    UserRepository,
    { provide: USER_CONFIG, useValue: config }
  )
  .provide(CUSTOM_TOKEN, { useFactory: () => new Custom() })
  .provideIf(
    (container) => container?.has(FEATURE_FLAG),
    PREMIUM_SERVICE,
    { useClass: PremiumServiceImpl }
  )
  .exports(UserService)
  .controllers(UserController)
  .global(false)
  .build();
```

#### Async Options Helpers

```typescript
import {
  createAsyncOptionsProvider,
  createServiceProvider,
  createAliasProvider,
  defineFactory,
  defineClass,
  defineValue,
  defineExisting,
  defineProviders
} from '@omnitron-dev/titan/nexus';

// For forRootAsync patterns
const providers = createAsyncOptionsProvider(OPTIONS_TOKEN, {
  useFactory: async (config) => ({ url: config.dbUrl }),
  inject: [CONFIG]
});

// Create service with dependencies
const serviceProvider = createServiceProvider(
  MY_SERVICE,
  MyService,
  [DEP1, DEP2]
);

// Create alias
const aliasProvider = createAliasProvider(MyService, MY_SERVICE_TOKEN);

// Type-safe provider definitions
const providers = defineProviders([
  defineFactory(SERVICE_TOKEN, {
    useFactory: () => new Service(),
    scope: 'singleton'
  }),
  defineClass(OTHER_TOKEN, {
    useClass: OtherService,
    inject: [DEP_TOKEN]
  }),
  defineValue(CONFIG_TOKEN, { useValue: myConfig }),
  defineExisting(MyService, { useExisting: MY_SERVICE_TOKEN })
]);
```

### Middleware System

#### Built-in Middleware

```typescript
import {
  LoggingMiddleware,
  CachingMiddleware,
  RetryMiddleware,
  ValidationMiddleware,
  TransactionMiddleware,
  CircuitBreakerMiddleware,
  RateLimitMiddleware,
  createMiddleware,
  composeMiddleware,
  MiddlewarePipeline
} from '@omnitron-dev/titan/nexus';

// Add built-in middleware
container.addMiddleware(LoggingMiddleware);
container.addMiddleware(CachingMiddleware);
container.addMiddleware(RetryMiddleware);
container.addMiddleware(ValidationMiddleware);
container.addMiddleware(TransactionMiddleware);

// Circuit breaker with options
container.addMiddleware(new CircuitBreakerMiddleware({
  threshold: 5,
  timeout: 60000,
  resetTimeout: 30000
}));

// Rate limiting
container.addMiddleware(new RateLimitMiddleware(100, 60000)); // 100 requests per minute
```

#### Custom Middleware

```typescript
// Create custom middleware
const customMiddleware = createMiddleware({
  name: 'custom',
  priority: 50,  // Higher executes first
  condition: (context) => context.token !== EXCLUDED_TOKEN,

  execute: async (context, next) => {
    console.log('Before resolution');
    const result = await next();
    console.log('After resolution');
    return result;
  },

  onError: (error, context) => {
    console.error('Resolution failed:', error);
  }
});

container.addMiddleware(customMiddleware);

// Compose multiple middleware
const composed = composeMiddleware(
  LoggingMiddleware,
  CachingMiddleware,
  customMiddleware
);
container.addMiddleware(composed);

// Using MiddlewarePipeline directly
const pipeline = new MiddlewarePipeline();
pipeline.use(LoggingMiddleware);
pipeline.use(customMiddleware);
pipeline.remove('logging');
```

### Lifecycle Management

#### Lifecycle Events

```typescript
import { LifecycleEvent, LifecycleManager } from '@omnitron-dev/titan/nexus';

// Available events
enum LifecycleEvent {
  BeforeRegister = 'beforeRegister',
  AfterRegister = 'afterRegister',
  BeforeResolve = 'beforeResolve',
  AfterResolve = 'afterResolve',
  CacheHit = 'cacheHit',
  ResolveFailed = 'resolveFailed',
  InstanceCreated = 'instanceCreated',
  InstanceInitializing = 'instanceInitializing',
  InstanceInitialized = 'instanceInitialized',
  ContainerInitialized = 'containerInitialized',
  ContainerDisposing = 'containerDisposing',
  ModuleLoading = 'moduleLoading',
  ModuleLoaded = 'moduleLoaded',
  MiddlewareAdded = 'middlewareAdded'
}

// Subscribe to events
container.on(LifecycleEvent.AfterResolve, (data) => {
  console.log(`Resolved ${data.token}:`, data.instance);
});

// Using addHook with common names
container.addHook('beforeResolve', (token, context) => {
  console.log('Resolving:', token);
});

container.addHook('afterResolve', (token, instance, context) => {
  console.log('Resolved:', token, instance);
});

container.addHook('onError', (error, token, context) => {
  console.error('Failed:', error);
});
```

#### Lifecycle Observers

```typescript
import {
  AuditObserver,
  MemoryObserver,
  PerformanceObserver
} from '@omnitron-dev/titan/nexus';

// Audit observer for tracking all operations
const auditObserver = new AuditObserver();

// Memory observer for tracking memory usage
const memoryObserver = new MemoryObserver();

// Performance observer for timing
const perfObserver = new PerformanceObserver();
```

### Context System

#### Context Management

```typescript
import {
  ContextManager,
  DefaultContextProvider,
  createContextKey,
  ContextKeys
} from '@omnitron-dev/titan/nexus';

// Create context keys
const TENANT_KEY = createContextKey<string>('tenant');
const USER_KEY = createContextKey<User>('user');

// Built-in context keys
ContextKeys.REQUEST_ID
ContextKeys.TENANT_ID
ContextKeys.USER_ID
ContextKeys.CORRELATION_ID

// Create scoped container with context
const scope = container.createScope({
  metadata: {
    [TENANT_KEY]: 'tenant-123',
    [USER_KEY]: currentUser
  }
});

const service = scope.resolve(TenantService);
```

#### Context-Aware Providers

```typescript
import {
  createContextAwareProvider,
  TenantStrategy,
  RoleBasedStrategy,
  EnvironmentStrategy,
  FeatureFlagStrategy
} from '@omnitron-dev/titan/nexus';

// Create context-aware provider
const dbProvider = createContextAwareProvider({
  strategies: [new TenantStrategy(), new RoleBasedStrategy()],
  factory: (context) => {
    const tenant = context.get('tenant');
    return new Database(`db_${tenant}`);
  }
});

container.register(DATABASE, dbProvider);

// Resolve with context
const scope = container.createScope({
  metadata: { tenant: 'customer1', role: 'admin' }
});
const db = scope.resolve(DATABASE);
```

## Advanced Features

### Async Resolution

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

// Parallel with settled results (no throw)
const results = await container.resolveParallelSettled([
  DATABASE,
  OPTIONAL_SERVICE
]);
results.forEach(result => {
  if (result.status === 'fulfilled') {
    console.log('Resolved:', result.value);
  } else {
    console.log('Failed:', result.reason);
  }
});
```

### Streaming Providers

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

// With filtering and batching
container.registerStream(BATCH_STREAM, {
  useFactory: async function*() {
    for await (const item of source) {
      yield item;
    }
  },
  filter: (item) => item.isValid,
  batch: { size: 100 }
});

// Consume stream
const stream = container.resolveStream(DATA_STREAM);
for await (const data of stream) {
  console.log('Received:', data);
}
```

### Lazy Resolution

```typescript
// Synchronous lazy proxy
const lazyService = container.resolveLazy(HEAVY_SERVICE);
// Service not resolved yet

lazyService.doSomething(); // Now resolved on first access

// Async lazy proxy
const lazyAsync = await container.resolveLazyAsync(ASYNC_SERVICE);
```

## Experimental Features

The following features are available but marked as experimental. APIs may change in minor versions.

### Service Mesh

```typescript
import { ServiceMeshManager } from '@omnitron-dev/titan/nexus';

const mesh = new ServiceMeshManager({
  serviceName: 'my-service',
  discovery: { /* discovery config */ },
  loadBalancing: 'round-robin'
});
```

### Distributed Tracing

```typescript
import { TracingManager, TraceSpan } from '@omnitron-dev/titan/nexus';

const tracing = new TracingManager({
  serviceName: 'api-gateway'
});

const span = tracing.startSpan('process-request');
// ... operation
span.finish();
```

### DevTools

```typescript
import { DevToolsPlugin } from '@omnitron-dev/titan/nexus';

const devTools = new DevToolsPlugin();
container.use(devTools);
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
| `NotInjectableError` | Class not properly configured | Check class metadata |

### Lifecycle Errors

| Error | Description | Solution |
|-------|-------------|----------|
| `InitializationError` | Initialization failed | Check onInit implementation |
| `DisposalError` | Disposal failed | Check dispose implementation |
| `ContainerDisposedError` | Container already disposed | Create new container |
| `ModuleError` | Module loading failed | Check module configuration |

### Error Utilities

```typescript
import {
  NexusError,
  isNexusError,
  getRootCause,
  NexusAggregateError
} from '@omnitron-dev/titan/nexus';

try {
  container.resolve(MISSING_TOKEN);
} catch (error) {
  if (isNexusError(error)) {
    const root = getRootCause(error);
    console.log('Root cause:', root);
  }
}
```

## Runtime Utilities

```typescript
import {
  isNode,
  isBun,
  isDeno,
  isBrowser,
  isServer,
  Runtime,
  detectRuntime,
  getRuntimeInfo,
  getMemoryUsage,
  getGlobalObject,
  hasESMSupport,
  hasWorkerSupport,
  loadRuntimeModule,
  PerformanceTimer
} from '@omnitron-dev/titan/nexus';

// Detect current runtime
const runtime = detectRuntime(); // Runtime.Node | Runtime.Bun | Runtime.Deno | Runtime.Browser

// Get runtime info
const info = getRuntimeInfo();
console.log(info.runtime, info.version);

// Check capabilities
if (hasESMSupport()) {
  await loadRuntimeModule('my-esm-module');
}

// Performance timing
const timer = new PerformanceTimer();
timer.start('operation');
// ... do work
const duration = timer.end('operation');
```

## Best Practices

### 1. Use Tokens for Type Safety

```typescript
// Good - type-safe
const USER_SERVICE = createToken<UserService>('UserService');
container.register(USER_SERVICE, { useClass: UserServiceImpl });
const service = container.resolve(USER_SERVICE); // Type: UserService

// Avoid - no type safety
container.register('userService', { useClass: UserServiceImpl });
```

### 2. Organize with Modules

```typescript
// Group related providers into modules
const UserModule = createModule({
  name: 'UserModule',
  imports: [DatabaseModule],
  providers: [UserService, UserRepository],
  exports: [UserService]
});
```

### 3. Use Appropriate Scopes

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

### 4. Handle Async Dependencies Properly

```typescript
// Mark async providers explicitly
container.register(DATABASE, {
  useFactory: async () => { /* ... */ },
  async: true
});

// Always use resolveAsync for async providers
const db = await container.resolveAsync(DATABASE);
```

### 5. Implement Proper Cleanup

```typescript
// Implement Disposable interface
class ResourceService implements Disposable {
  async dispose() {
    await this.closeConnections();
    await this.clearCache();
  }
}

// Or use lifecycle hooks
class Service {
  onDestroy() {
    // Cleanup logic
  }
}

// Always dispose container on shutdown
await container.dispose();
```

### 6. Use Middleware for Cross-Cutting Concerns

```typescript
// Logging, caching, retries as middleware
container.addMiddleware(LoggingMiddleware);
container.addMiddleware(new CircuitBreakerMiddleware({ threshold: 5 }));
```

## API Stability

| Feature | Status | Since |
|---------|--------|-------|
| Core Container | Stable | 0.1.0 |
| Token System | Stable | 0.1.0 |
| Basic Providers | Stable | 0.1.0 |
| Async Resolution | Stable | 0.1.0 |
| Module System | Stable | 0.1.0 |
| Middleware | Stable | 0.1.0 |
| Lifecycle Hooks | Stable | 0.1.0 |
| Context System | Stable | 0.1.0 |
| Streaming | Stable | 0.1.0 |
| Service Mesh | Experimental | 0.1.0 |
| Distributed Tracing | Experimental | 0.1.0 |
| DevTools | Experimental | 0.1.0 |

## Feature Flags

```typescript
import { NEXUS_FEATURES } from '@omnitron-dev/titan/nexus';

// Check available features
NEXUS_FEATURES.CORE              // true
NEXUS_FEATURES.TOKEN_SYSTEM      // true
NEXUS_FEATURES.PROVIDERS         // true
NEXUS_FEATURES.LIFECYCLE         // true
NEXUS_FEATURES.ERROR_HANDLING    // true
NEXUS_FEATURES.ASYNC             // true
NEXUS_FEATURES.MODULES           // true
NEXUS_FEATURES.CROSS_PLATFORM    // true
NEXUS_FEATURES.MIDDLEWARE        // true
NEXUS_FEATURES.LIFECYCLE_HOOKS   // true
NEXUS_FEATURES.ADVANCED_CONTEXT  // true
NEXUS_FEATURES.ENHANCED_MODULES  // true
NEXUS_FEATURES.CONTEXTUAL_INJECTION // true
NEXUS_FEATURES.SERVICE_MESH      // true (experimental)
NEXUS_FEATURES.DISTRIBUTED_TRACING // true (experimental)
NEXUS_FEATURES.DEVTOOLS          // true (experimental)
NEXUS_FEATURES.DECORATORS        // false (requires separate import)
```

## License

MIT - See LICENSE file for details
