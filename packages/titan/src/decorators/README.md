# Titan Decorators

Comprehensive decorator system for dependency injection, metadata management, and cross-cutting concerns in the Titan framework.

## Table of Contents

- [Overview](#overview)
- [Core Decorators](#core-decorators)
  - [Dependency Injection](#dependency-injection)
  - [Service Definition](#service-definition)
  - [Module System](#module-system)
- [Injection Decorators](#injection-decorators)
  - [Parameter Injection](#parameter-injection)
  - [Property Injection](#property-injection)
  - [Advanced Injection](#advanced-injection)
- [Lifecycle Decorators](#lifecycle-decorators)
- [Utility Decorators](#utility-decorators)
  - [Performance](#performance)
  - [Error Handling](#error-handling)
  - [Logging](#logging)
- [Validation Decorators](#validation-decorators)
  - [Schema Validation](#schema-validation)
  - [Method Validation](#method-validation)
  - [Validation Presets](#validation-presets)
- [Module-Specific Decorators](#module-specific-decorators)
  - [Event Decorators](#event-decorators)
  - [Scheduler Decorators](#scheduler-decorators)
  - [Configuration Decorators](#configuration-decorators)
  - [Logger Decorators](#logger-decorators)
- [Custom Decorator Creation](#custom-decorator-creation)
  - [Decorator Factory API](#decorator-factory-api)
  - [Method Interceptors](#method-interceptors)
  - [Property Interceptors](#property-interceptors)
- [Advanced Features](#advanced-features)
- [Best Practices](#best-practices)
- [API Reference](#api-reference)

## Overview

Titan's decorator system provides a powerful, type-safe way to configure classes and their members with metadata for dependency injection, validation, event handling, and more. All decorators are built on TypeScript's experimental decorator support and the `reflect-metadata` library.

### Key Features

- **Type-Safe**: Full TypeScript support with proper type inference
- **Composable**: Decorators can be combined and stacked
- **Extensible**: Create custom decorators using the fluent builder API
- **Performance-Oriented**: Minimal runtime overhead with metadata caching
- **Framework Integration**: Deep integration with Nexus DI container and Netron RPC

### Installation

Decorators are included in the `@omnitron-dev/titan` package:

```typescript
import {
  Injectable,
  Service,
  Module,
  Inject,
  OnEvent,
  Cron
} from '@omnitron-dev/titan';
```

## Core Decorators

### Dependency Injection

#### `@Injectable(options?)`

Marks a class as injectable for dependency injection.

```typescript
@Injectable()
class UserRepository {
  // Class is now available for DI
}

// With options
@Injectable({
  scope: 'singleton',  // 'singleton' | 'transient' | 'scoped' | 'request'
  token: USER_REPOSITORY_TOKEN,
  providedIn: 'root'
})
class UserRepositoryImpl implements IUserRepository {
  // Advanced DI configuration
}
```

**Options:**
- `scope`: Lifecycle scope of the instance
- `token`: Custom injection token
- `providedIn`: Module scope ('root' | 'any' | module name)

#### `@Singleton()`

Creates a single instance for the entire application.

```typescript
@Singleton()
class ConfigService {
  // Only one instance will be created
}
```

#### `@Transient()`

Creates a new instance for every injection.

```typescript
@Transient()
class RequestContext {
  // New instance per injection
}
```

#### `@Scoped()`

Creates one instance per scope/context.

```typescript
@Scoped()
class TransactionManager {
  // One instance per scope
}
```

#### `@Request()`

Creates one instance per request.

```typescript
@Request()
class RequestLogger {
  // One instance per HTTP request
}
```

### Service Definition

#### `@Service(name | options)`

Defines a Netron service for RPC communication.

```typescript
// Simple usage
@Service('users@1.0.0')
class UserService {
  @Method()
  async getUser(id: string) {
    return { id, name: 'John' };
  }
}

// Advanced configuration
@Service({
  name: 'auth@2.0.0',
  contract: AuthContract,
  transports: [
    new WebSocketTransport({ port: 8080 }),
    new HttpTransport({ port: 3000 })
  ],
  transportConfig: {
    timeout: 5000,
    compression: true,
    maxMessageSize: 1024 * 1024  // 1MB
  }
})
class AuthService {
  // Service implementation
}
```

#### `@Method(options?)`

Marks a method or property as publicly accessible in a service.

```typescript
class CalculatorService {
  @Method()
  add(a: number, b: number): number {
    return a + b;
  }

  @Method({ readonly: true })
  readonly version: string = '1.0.0';
}
```

#### `@Controller(path?)`

Marks a class as a controller with an optional base path.

```typescript
@Controller('/api/users')
class UserController {
  @Get('/:id')
  async getUser(@Param('id') id: string) {
    // Controller logic
  }
}
```

#### `@Repository(entity?)`

Marks a class as a repository for data access.

```typescript
@Repository(User)
class UserRepository {
  async findById(id: string): Promise<User> {
    // Repository logic
  }
}
```

#### `@Factory(name)`

Marks a method as a factory for creating instances.

```typescript
class ConnectionFactory {
  @Factory('database')
  createDatabaseConnection(config: DbConfig) {
    return new DatabaseConnection(config);
  }
}
```

### Module System

#### `@Module(options)`

Defines a module with providers, imports, and exports.

```typescript
@Module({
  name: 'UserModule',
  version: '1.0.0',
  imports: [DatabaseModule, AuthModule],
  providers: [
    UserService,
    UserRepository,
    { provide: USER_CONFIG, useValue: defaultConfig }
  ],
  exports: [UserService],
  global: false
})
class UserModule {}
```

#### `@Global()`

Makes a module or provider globally available.

```typescript
@Global()
@Module({
  providers: [LoggerService],
  exports: [LoggerService]
})
class LoggerModule {}
```

## Injection Decorators

### Parameter Injection

#### `@Inject(token)`

Injects a dependency by token.

```typescript
class UserService {
  constructor(
    @Inject(DATABASE_TOKEN) private db: Database,
    @Inject('ConfigService') private config: ConfigService
  ) {}
}
```

#### `@Optional()`

Marks a dependency as optional.

```typescript
class NotificationService {
  constructor(
    @Optional() @Inject('EmailService') private email?: EmailService
  ) {}
}
```

#### `@InjectAll(token)`

Injects all instances of a multi-provider.

```typescript
class PluginManager {
  constructor(
    @InjectAll(PLUGIN_TOKEN) private plugins: IPlugin[]
  ) {}
}
```

### Property Injection

```typescript
class UserService {
  @Inject(LOGGER_TOKEN)
  private logger!: Logger;

  @Inject('ConfigService')
  private config!: ConfigService;
}
```

### Advanced Injection

#### `@Value(path, defaultValue?)`

Injects a value from configuration.

```typescript
class ApiService {
  constructor(
    @Value('api.url', 'http://localhost:3000') private apiUrl: string,
    @Value('api.timeout') private timeout: number
  ) {}
}
```

#### `@InjectEnv(key, defaultValue?)`

Injects an environment variable.

```typescript
class DatabaseService {
  constructor(
    @InjectEnv('DATABASE_URL', 'postgres://localhost:5432') private dbUrl: string
  ) {}
}
```

#### `@InjectConfig(path)`

Injects configuration value by path.

```typescript
class CacheService {
  constructor(
    @InjectConfig('cache.redis.host') private redisHost: string
  ) {}
}
```

#### `@ConditionalInject(token, condition, fallback?)`

Conditionally injects based on a predicate.

```typescript
class PaymentService {
  constructor(
    @ConditionalInject(
      STRIPE_SERVICE,
      () => process.env.PAYMENT_PROVIDER === 'stripe',
      new MockPaymentService()
    )
    private payment: IPaymentService
  ) {}
}
```

#### `@Lazy(tokenFactory)`

Delays dependency resolution until first use.

```typescript
class ReportService {
  @Lazy(() => DATABASE_TOKEN)
  private database!: Database;  // Resolved on first access
}
```

## Lifecycle Decorators

#### `@PostConstruct()`

Method called after instance construction.

```typescript
class DatabaseService {
  private connection?: Connection;

  @PostConstruct()
  async initialize() {
    this.connection = await this.connect();
  }
}
```

#### `@PreDestroy()`

Method called before instance destruction.

```typescript
class WebSocketService {
  @PreDestroy()
  async cleanup() {
    await this.closeAllConnections();
  }
}
```

## Utility Decorators

### Performance

#### `@Timeout(options)`

Adds timeout to method execution.

```typescript
class ApiClient {
  @Timeout({ ms: 5000 })
  async fetchData(): Promise<Data> {
    // Will timeout after 5 seconds
  }
}
```

#### `@Retryable(options)`

Adds retry logic with exponential backoff.

```typescript
class NetworkService {
  @Retryable({
    attempts: 3,
    delay: 1000,
    maxDelay: 30000,
    backoff: 2,
    retryOn: (error) => error.code === 'NETWORK_ERROR'
  })
  async sendRequest(data: any) {
    // Will retry on network errors
  }
}
```

#### `@Monitor(options)`

Tracks method performance metrics.

```typescript
class DataProcessor {
  @Monitor({
    name: 'process-batch',
    sampleRate: 0.1,  // Sample 10% of calls
    includeArgs: true,
    includeResult: false
  })
  async processBatch(items: any[]) {
    // Performance will be tracked
  }
}
```

### Error Handling

#### `@Deprecated(options)`

Marks code as deprecated.

```typescript
class LegacyService {
  @Deprecated({
    message: 'Use newMethod() instead',
    version: '2.0.0'
  })
  oldMethod() {
    // Will log deprecation warning
  }
}
```

#### `@Validate(schema)`

Validates method arguments or return values.

```typescript
class ValidationExample {
  @Validate({
    schema: (age: number) => age >= 0 && age <= 120
  })
  setAge(age: number) {
    // Age will be validated
  }
}
```

### Logging

#### `@Log(options)`

Logs method entry, exit, and errors.

```typescript
class PaymentProcessor {
  @Log({
    level: 'info',
    includeArgs: true,
    includeResult: false,
    message: 'Processing payment'
  })
  async processPayment(amount: number, currency: string) {
    // Method execution will be logged
  }
}
```

#### `@Memoize()`

Caches method results based on arguments.

```typescript
class ExpensiveCalculations {
  @Memoize()
  fibonacci(n: number): number {
    // Results will be cached
    if (n <= 1) return n;
    return this.fibonacci(n - 1) + this.fibonacci(n - 2);
  }
}
```

## Validation Decorators

### Schema Validation

#### `@Contract(contract)`

Applies a validation contract to a service.

```typescript
import { Contract as ContractClass } from '@omnitron-dev/titan';

const UserContract = new ContractClass({
  methods: {
    createUser: {
      input: z.object({
        email: z.string().email(),
        password: z.string().min(8)
      }),
      output: z.object({
        id: z.string().uuid(),
        email: z.string().email()
      })
    }
  }
});

@Contract(UserContract)
class UserService {
  // Methods will be validated against contract
}
```

#### `@ValidationOptions(options)`

Sets global validation options for a service.

```typescript
@ValidationOptions({
  strict: true,
  stripUnknown: true,
  abortEarly: false
})
class StrictService {
  // All validations use these options
}
```

### Method Validation

#### `@Validate(options)`

Validates specific method input/output.

```typescript
class UserService {
  @Validate({
    input: z.object({
      email: z.string().email(),
      age: z.number().min(18)
    }),
    output: z.object({
      id: z.string(),
      created: z.date()
    })
  })
  async createUser(data: any) {
    // Input and output will be validated
  }
}
```

#### `@ValidateInput(schema, options?)`

Validates only method input.

```typescript
class SearchService {
  @ValidateInput(
    z.object({
      query: z.string().min(3),
      limit: z.number().max(100)
    })
  )
  async search(params: any) {
    // Only input is validated
  }
}
```

#### `@ValidateOutput(schema, options?)`

Validates only method output.

```typescript
class DataService {
  @ValidateOutput(
    z.array(z.object({
      id: z.string(),
      value: z.number()
    }))
  )
  async getData() {
    // Only output is validated
  }
}
```

#### `@ValidateStream(input, output, options?)`

Validates streaming method.

```typescript
class StreamService {
  @ValidateStream(
    z.object({ channel: z.string() }),
    z.object({ data: z.any() })
  )
  async *streamData(params: any) {
    // Stream validation
  }
}
```

#### `@NoValidation()`

Disables validation for a method.

```typescript
class MixedService {
  @Validate({ input: userSchema })
  createUser(data: any) { }

  @NoValidation()
  internalMethod(data: any) {
    // Validation skipped
  }
}
```

#### `@ValidationBatch(options)`

Batch validation for array processing.

```typescript
class BatchProcessor {
  @ValidationBatch({
    batchSize: 100,
    parallel: true,
    continueOnError: true
  })
  async processBatch(items: any[]) {
    // Batch validation logic
  }
}
```

### Validation Presets

#### CRUD Validation Preset

```typescript
import { ValidationPresets, ValidationSchemas } from '@omnitron-dev/titan';

const UserSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().email()
});

class UserService {
  @ValidationPresets.crud(UserSchema).create
  async createUser(data: any) { }

  @ValidationPresets.crud(UserSchema).read
  async getUser(id: string) { }

  @ValidationPresets.crud(UserSchema).update
  async updateUser(id: string, data: any) { }

  @ValidationPresets.crud(UserSchema).delete
  async deleteUser(id: string) { }

  @ValidationPresets.crud(UserSchema).list
  async listUsers(params: any) { }
}
```

#### Authentication Preset

```typescript
class AuthService {
  @ValidationPresets.auth.login
  async login(credentials: any) { }

  @ValidationPresets.auth.register
  async register(userData: any) { }

  @ValidationPresets.auth.logout
  async logout(session: any) { }

  @ValidationPresets.auth.refresh
  async refreshToken(token: string) { }
}
```

## Module-Specific Decorators

### Event Decorators

#### `@OnEvent(options)`

Listens for events.

```typescript
class NotificationService {
  @OnEvent({
    event: 'user.created',
    async: true,
    priority: 10,
    timeout: 5000,
    filter: (data) => data.verified === true,
    transform: (data) => ({ ...data, timestamp: Date.now() }),
    errorBoundary: true,
    onError: (error, data) => console.error('Event error:', error)
  })
  async handleUserCreated(userData: any) {
    // Handle event
  }
}
```

#### `@OnceEvent(options)`

One-time event listener.

```typescript
class StartupService {
  @OnceEvent({
    event: 'app.ready',
    timeout: 30000
  })
  async initialize() {
    // Runs once when app is ready
  }
}
```

#### `@OnAnyEvent(options)`

Listens to all events.

```typescript
class EventLogger {
  @OnAnyEvent({
    priority: -1,
    filter: (event, data) => !event.startsWith('internal.')
  })
  logEvent(event: string, data: any) {
    console.log(`Event: ${event}`, data);
  }
}
```

#### `@EmitEvent(options)`

Emits events based on method results.

```typescript
class UserService {
  @EmitEvent({
    event: 'user.created',
    mapResult: (user) => ({ id: user.id, email: user.email }),
    mapError: (error) => ({ message: error.message })
  })
  async createUser(data: any) {
    // Will emit user.created.success or user.created.error
    return user;
  }
}
```

#### `@ScheduleEvent(options)`

Schedules event emission.

```typescript
class ScheduledTasks {
  @ScheduleEvent({
    event: 'cleanup.trigger',
    cron: '0 0 * * *',  // Daily at midnight
    // OR
    delay: 60000,       // After 60 seconds
    // OR
    at: new Date('2024-12-31')  // At specific time
  })
  async triggerCleanup() {
    return { timestamp: new Date() };
  }
}
```

#### `@BatchEvents(options)`

Batch event handling.

```typescript
class MetricsService {
  @BatchEvents({
    event: 'metrics.data',
    maxSize: 100,      // Max batch size
    maxWait: 5000      // Max wait time in ms
  })
  async processBatch(events: any[]) {
    console.log(`Processing ${events.length} metrics`);
  }
}
```

#### `@OnModuleEvent(options)`

Module-level event listener.

```typescript
class DatabaseModule {
  @OnModuleEvent({
    event: 'module.initialized',
    filter: (data) => data.module === 'database'
  })
  onModuleInit(data: any) {
    // Handle module initialization
  }
}
```

#### `@EventEmitter(options)`

Marks class as event emitter.

```typescript
@EventEmitter({
  namespace: 'user',     // Prefix for all events
  wildcard: true,        // Enable wildcard events
  delimiter: '.'         // Event delimiter
})
class UserEventEmitter {
  // All events will be prefixed with 'user.'
}
```

### Scheduler Decorators

#### `@Cron(expression, options?)`

Schedules a cron job.

```typescript
class ScheduledJobs {
  @Cron('0 */5 * * * *', {
    name: 'sync-data',
    timeZone: 'America/New_York',
    disabled: false,
    runOnInit: false,
    retryAttempts: 3,
    retryDelay: 5000
  })
  async syncData() {
    console.log('Syncing data every 5 minutes');
  }

  // Using predefined expressions
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async dailyCleanup() {
    // Runs at midnight
  }
}
```

#### `@Interval(milliseconds, options?)`

Schedules an interval job.

```typescript
class MonitoringService {
  @Interval(30000, {  // Every 30 seconds
    name: 'health-check',
    runOnInit: true,
    stopOnError: false
  })
  async checkHealth() {
    // Health check logic
  }
}
```

#### `@Timeout(milliseconds, options?)`

Schedules a one-time delayed job.

```typescript
class StartupService {
  @Timeout(5000, {  // After 5 seconds
    name: 'delayed-start',
    runOnInit: false
  })
  async delayedInitialization() {
    // Runs once after 5 seconds
  }
}
```

#### `@Schedulable()`

Marks class as schedulable (optional).

```typescript
@Schedulable()
class CronJobs {
  // Contains scheduled methods
}
```

### Configuration Decorators

#### `@Config(path?, defaultValue?)`

Injects configuration values.

```typescript
class ApiService {
  @Config('api.baseUrl', 'http://localhost:3000')
  private baseUrl!: string;

  constructor(
    @Config('api.timeout', 5000) private timeout: number
  ) {}
}
```

#### `@InjectConfig()`

Injects entire configuration service.

```typescript
class ServiceManager {
  constructor(
    @InjectConfig() private config: ConfigService
  ) {}
}
```

#### `@ConfigSchema(schema)`

Defines configuration schema.

```typescript
const DatabaseConfigSchema = z.object({
  host: z.string(),
  port: z.number(),
  username: z.string(),
  password: z.string()
});

@ConfigSchema(DatabaseConfigSchema)
class DatabaseConfig {
  host!: string;
  port!: number;
  username!: string;
  password!: string;
}
```

#### `@Configuration(prefix?)`

Marks class as configuration class.

```typescript
@Configuration('database')
@ConfigSchema(DatabaseSchema)
class DatabaseConfiguration {
  host: string = 'localhost';
  port: number = 5432;
}
```

#### `@ConfigValidate(schema)`

Validates configuration value.

```typescript
class ServerConfig {
  @ConfigValidate(z.number().min(1).max(65535))
  @Config('server.port')
  private port!: number;
}
```

#### `@ConfigWatch(path)`

Watches configuration changes.

```typescript
class DynamicService {
  @ConfigWatch('features.flags')
  onFeatureFlagsChange(newValue: any, oldValue: any) {
    console.log('Feature flags changed:', newValue);
    this.updateFeatures(newValue);
  }
}
```

#### `@ConfigDefaults(defaults)`

Provides default configuration values.

```typescript
@ConfigDefaults({
  host: 'localhost',
  port: 5432,
  ssl: false
})
class PostgresConfig {
  host!: string;
  port!: number;
  ssl!: boolean;
}
```

#### `@ConfigProvider(name)`

Marks method as configuration provider.

```typescript
class ConfigProviders {
  @ConfigProvider('database')
  async provideDatabaseConfig(): Promise<DatabaseConfig> {
    return {
      host: await this.getSecretValue('DB_HOST'),
      port: 5432,
      username: await this.getSecretValue('DB_USER'),
      password: await this.getSecretValue('DB_PASS')
    };
  }
}
```

#### `@ConfigTransform(transformer)`

Transforms configuration value.

```typescript
class EnvironmentConfig {
  @ConfigTransform((value) => value.toUpperCase())
  @Config('app.environment')
  private environment!: string;  // Will be uppercase
}
```

### Logger Decorators

#### `@Logger(name?)`

Injects a logger instance.

```typescript
class UserService {
  @Logger('UserService')
  private logger!: ILogger;

  @Logger()  // Uses class name
  private defaultLogger!: ILogger;

  async createUser(data: any) {
    this.logger.info({ data }, 'Creating user');
    // Logger operations
  }
}
```

#### `@Log(options)`

Logs method execution.

```typescript
class PaymentService {
  @Log({
    level: 'info',
    includeArgs: true,
    includeResult: false,
    message: 'Processing payment'
  })
  async processPayment(amount: number) {
    // Method will be logged
    return { success: true };
  }
}
```

#### `@Monitor(options)`

Monitors method performance.

```typescript
class DataService {
  @Monitor({
    name: 'fetch-data',
    sampleRate: 0.1,     // Sample 10% of calls
    includeArgs: false,
    includeResult: false
  })
  async fetchData(query: any) {
    // Performance tracked
  }
}
```

## Custom Decorator Creation

### Decorator Factory API

Create custom decorators using the fluent builder API:

```typescript
import { createDecorator, DecoratorTarget } from '@omnitron-dev/titan';

// Simple custom decorator
const Cacheable = createDecorator<{ ttl?: number }>()
  .withName('Cacheable')
  .forMethod()
  .withMetadata((context) => ({
    cacheable: true,
    ttl: context.options?.ttl || 3600
  }))
  .build();

// Usage
class DataService {
  @Cacheable({ ttl: 600 })
  async getData() {
    // Method will have caching metadata
  }
}
```

### Method Interceptors

Create decorators that modify method behavior:

```typescript
import { createMethodInterceptor } from '@omnitron-dev/titan';

const RateLimit = createMethodInterceptor<{
  limit: number;
  window: number;
}>('RateLimit', async (originalMethod, args, context) => {
  const { limit, window } = context.options!;

  // Check rate limit
  if (await checkRateLimit(context.propertyKey, limit, window)) {
    return originalMethod(...args);
  }

  throw new Error('Rate limit exceeded');
});

// Usage
class ApiService {
  @RateLimit({ limit: 10, window: 60000 })
  async apiCall() {
    // Rate limited to 10 calls per minute
  }
}
```

### Property Interceptors

Create decorators for properties:

```typescript
import { createPropertyInterceptor } from '@omnitron-dev/titan';

const Readonly = createPropertyInterceptor('Readonly', {
  set: (value, context) => {
    if (context.target[context.propertyKey!] !== undefined) {
      throw new Error(`Property ${String(context.propertyKey)} is readonly`);
    }
    return value;
  }
});

// Usage
class Config {
  @Readonly()
  apiKey: string = 'secret-key';
}
```

### Complex Custom Decorators

Create sophisticated decorators with validation and hooks:

```typescript
const Transactional = createDecorator<{
  isolation?: 'READ_UNCOMMITTED' | 'READ_COMMITTED' | 'REPEATABLE_READ' | 'SERIALIZABLE';
  timeout?: number;
}>()
  .withName('Transactional')
  .forMethod()
  .withValidation((options) => {
    if (options?.timeout && options.timeout <= 0) {
      return 'Timeout must be positive';
    }
  })
  .withHooks({
    beforeApply: (context) => {
      console.log(`Applying @Transactional to ${String(context.propertyKey)}`);
    },
    afterApply: (context) => {
      // Store transaction metadata
      Reflect.defineMetadata('transaction', context.options, context.target, context.propertyKey!);
    }
  })
  .withMetadata((context) => ({
    transactional: true,
    isolation: context.options?.isolation || 'READ_COMMITTED',
    timeout: context.options?.timeout || 30000
  }))
  .inheritable(true)
  .stackable(false)
  .withPriority(100)
  .build();
```

### Decorator Composition

Combine multiple decorators:

```typescript
import { combineDecorators } from '@omnitron-dev/titan';

// Combine existing decorators
const SecureEndpoint = combineDecorators(
  Authenticate(),
  Authorize(['admin', 'moderator']),
  RateLimit({ limit: 100, window: 60000 }),
  Log({ level: 'info', includeArgs: true })
);

// Usage
class AdminService {
  @SecureEndpoint
  async deleteUser(userId: string) {
    // Multiple decorators applied
  }
}

// Or compose in decorator creation
const AuditedMethod = createDecorator()
  .withName('Audited')
  .compose(
    Log({ level: 'info' }),
    Monitor({ name: 'audit' })
  )
  .forMethod()
  .build();
```

## Advanced Features

### Metadata Access

Access decorator metadata at runtime:

```typescript
import {
  getCustomMetadata,
  getAllCustomMetadata,
  hasDecorator,
  getDecoratorOptions
} from '@omnitron-dev/titan';

// Check if decorator is applied
if (hasDecorator('Cacheable', MyClass.prototype, 'myMethod')) {
  // Method has @Cacheable decorator
}

// Get decorator options
const cacheOptions = getDecoratorOptions('Cacheable', MyClass.prototype, 'myMethod');
console.log('TTL:', cacheOptions?.ttl);

// Get all custom metadata
const metadata = getAllCustomMetadata(MyClass.prototype, 'myMethod');
metadata.forEach((value, key) => {
  console.log(`${key}:`, value);
});
```

### Decorator Inheritance

Control decorator inheritance:

```typescript
const InheritableConfig = createDecorator()
  .withName('Config')
  .inheritable(true)  // Will be inherited by subclasses
  .forClass()
  .build();

@InheritableConfig({ version: '1.0' })
class BaseService {}

class ExtendedService extends BaseService {
  // Inherits @InheritableConfig
}
```

### Stackable Decorators

Allow multiple instances of the same decorator:

```typescript
const Tag = createDecorator<string>()
  .withName('Tag')
  .stackable(true)  // Can be applied multiple times
  .forClass()
  .withMetadata((context) => ({
    tag: context.options
  }))
  .build();

@Tag('service')
@Tag('api')
@Tag('v2')
class MultiTaggedService {
  // Has multiple tags
}
```

### Decorator Priority

Control execution order with priority:

```typescript
const HighPriority = createDecorator()
  .withName('HighPriority')
  .withPriority(1000)  // Higher priority executes first
  .forMethod()
  .build();

const LowPriority = createDecorator()
  .withName('LowPriority')
  .withPriority(10)
  .forMethod()
  .build();
```

### Conditional Decorators

Apply decorators based on conditions:

```typescript
const ConditionalAuth = (condition: () => boolean) => {
  return condition()
    ? Authenticate()
    : (target: any, propertyKey?: string) => {};
};

class Service {
  @ConditionalAuth(() => process.env.NODE_ENV === 'production')
  sensitiveOperation() {
    // Only authenticated in production
  }
}
```

## Best Practices

### 1. Type Safety

Always provide proper TypeScript types:

```typescript
// Good - Type-safe decorator
const TypedDecorator = createDecorator<{
  name: string;
  value: number;
}>()
  .withName('TypedDecorator')
  .forMethod()
  .build();

// Usage with type checking
@TypedDecorator({ name: 'test', value: 42 })
method() {}
```

### 2. Validation

Validate decorator options:

```typescript
const ValidatedDecorator = createDecorator<{ port: number }>()
  .withName('ValidatedDecorator')
  .withValidation((options) => {
    if (!options?.port || options.port < 1 || options.port > 65535) {
      return 'Port must be between 1 and 65535';
    }
  })
  .forClass()
  .build();
```

### 3. Error Handling

Handle errors gracefully in decorators:

```typescript
const SafeDecorator = createMethodInterceptor('Safe', async (originalMethod, args, context) => {
  try {
    return await originalMethod(...args);
  } catch (error) {
    console.error(`Error in ${String(context.propertyKey)}:`, error);
    // Handle or rethrow
    throw error;
  }
});
```

### 4. Performance

Minimize overhead in frequently called decorators:

```typescript
const PerformantDecorator = createMethodInterceptor('Performant', (originalMethod, args, context) => {
  // Cache expensive operations
  const cache = context.metadata.get('cache') || new Map();

  const key = JSON.stringify(args);
  if (cache.has(key)) {
    return cache.get(key);
  }

  const result = originalMethod(...args);
  cache.set(key, result);
  context.metadata.set('cache', cache);

  return result;
});
```

### 5. Documentation

Document custom decorators thoroughly:

```typescript
/**
 * Caches method results for the specified TTL
 * @param options.ttl - Time to live in seconds (default: 3600)
 * @example
 * ```typescript
 * @Cacheable({ ttl: 600 })
 * async getData() { }
 * ```
 */
const Cacheable = createDecorator<{ ttl?: number }>()
  // ... implementation
```

### 6. Testing

Test decorators separately:

```typescript
describe('Cacheable decorator', () => {
  it('should cache method results', () => {
    class TestClass {
      callCount = 0;

      @Cacheable({ ttl: 100 })
      getData(id: string) {
        this.callCount++;
        return { id, data: 'test' };
      }
    }

    const instance = new TestClass();
    const result1 = instance.getData('1');
    const result2 = instance.getData('1');

    expect(instance.callCount).toBe(1);
    expect(result1).toBe(result2);
  });
});
```

## API Reference

### Core Exports

```typescript
// Core decorators
export {
  Injectable,
  Singleton,
  Transient,
  Scoped,
  Request,
  Service,
  Controller,
  Repository,
  Factory,
  Module,
  Global,
  Method,
  Public,  // Deprecated, use @Method
}

// Injection decorators
export {
  Inject,
  Optional,
  InjectAll,
  InjectMany,
  Value,
  Lazy,
  InjectEnv,
  InjectConfig,
  ConditionalInject,
}

// Lifecycle decorators
export {
  PostConstruct,
  PreDestroy,
}

// Utility decorators
export {
  Timeout,
  Retryable,
  Log,
  Monitor,
  Deprecated,
  Validate,
  Memoize,
  Retry,
}

// Validation decorators
export {
  Contract,
  ValidationOptions,
  NoValidation,
  ValidationBatch,
  ValidateInput,
  ValidateOutput,
  ValidateStream,
  ConfigSchema,
  Configuration,
  ConfigValidate,
  ConfigWatch,
  ConfigDefaults,
  ConfigProvider,
  ConfigTransform,
}

// Decorator factory API
export {
  createDecorator,
  createMethodInterceptor,
  createPropertyInterceptor,
  createParameterizedDecorator,
  combineDecorators,
  getCustomMetadata,
  getAllCustomMetadata,
  hasDecorator,
  getDecoratorOptions,
  DecoratorTarget,
  type DecoratorContext,
  type DecoratorTransform,
  type MetadataTransform,
  type OptionsValidator,
  type DecoratorHook,
  type CustomDecoratorConfig,
}
```

### Module-Specific Exports

```typescript
// Event decorators (from events module)
export {
  OnEvent,
  OnceEvent,
  OnAnyEvent,
  EmitEvent,
  ScheduleEvent,
  BatchEvents,
  OnModuleEvent,
  EventEmitter,
}

// Scheduler decorators (from scheduler module)
export {
  Cron,
  Interval,
  Timeout,
  Schedulable,
  CronExpression,  // Enum with predefined expressions
}

// Config decorators (from config module)
export {
  Config,
  InjectConfig,
}

// Logger decorators (from logger module)
export {
  Logger,
}
```

### Type Definitions

```typescript
// Scope types
type Scope = 'singleton' | 'transient' | 'scoped' | 'request';

// Injectable options
interface InjectableOptions {
  scope?: Scope;
  token?: any;
  providedIn?: 'root' | 'any' | string;
}

// Module options
interface ModuleDecoratorOptions {
  name?: string;
  version?: string;
  imports?: any[];
  providers?: any[];
  exports?: any[];
  global?: boolean;
}

// Service options
interface ServiceOptions {
  name: string;
  contract?: any;
  transports?: ITransport[];
  transportConfig?: {
    timeout?: number;
    compression?: boolean;
    maxMessageSize?: number;
  };
}

// Decorator context
interface DecoratorContext<TOptions = any> {
  target: any;
  propertyKey?: string | symbol;
  descriptor?: PropertyDescriptor;
  parameterIndex?: number;
  options?: TOptions;
  container?: Container;
  metadata: Map<string, any>;
}
```

## Examples

### Complete Service Example

```typescript
import {
  Module,
  Injectable,
  Service,
  Method,
  Logger,
  OnEvent,
  Cron,
  Config,
  ValidateInput,
  Monitor,
  PostConstruct,
  PreDestroy
} from '@omnitron-dev/titan';
import { z } from 'zod';

@Module({
  name: 'UserModule',
  providers: [UserService, UserRepository],
  exports: [UserService]
})
class UserModule {}

@Service('users@1.0.0')
@Injectable({ scope: 'singleton' })
class UserService {
  @Logger('UserService')
  private logger!: ILogger;

  @Config('users.maxResults', 100)
  private maxResults!: number;

  constructor(
    @Inject(UserRepository) private repo: UserRepository
  ) {}

  @PostConstruct()
  async initialize() {
    this.logger.info('UserService initialized');
  }

  @Method()
  @ValidateInput(z.object({
    email: z.string().email(),
    name: z.string().min(2)
  }))
  @Monitor({ name: 'create-user' })
  async createUser(data: any) {
    this.logger.info({ data }, 'Creating user');
    const user = await this.repo.create(data);
    return user;
  }

  @OnEvent({ event: 'user.verify' })
  async handleUserVerification(userId: string) {
    await this.repo.verify(userId);
  }

  @Cron('0 0 * * *')
  async dailyCleanup() {
    await this.repo.cleanupInactive();
  }

  @PreDestroy()
  async cleanup() {
    this.logger.info('UserService shutting down');
  }
}
```

### Custom Decorator Library

```typescript
// decorators/security.ts
import { createMethodInterceptor, combineDecorators } from '@omnitron-dev/titan';

export const Authenticate = createMethodInterceptor('Authenticate',
  async (originalMethod, args, context) => {
    const token = context.metadata.get('token');
    if (!await validateToken(token)) {
      throw new UnauthorizedError();
    }
    return originalMethod(...args);
  }
);

export const Authorize = (roles: string[]) =>
  createMethodInterceptor('Authorize',
    async (originalMethod, args, context) => {
      const user = context.metadata.get('user');
      if (!roles.includes(user.role)) {
        throw new ForbiddenError();
      }
      return originalMethod(...args);
    }
  );

export const SecureEndpoint = (roles: string[]) =>
  combineDecorators(
    Authenticate(),
    Authorize(roles),
    Log({ level: 'info' }),
    Monitor({ name: 'secure-endpoint' })
  );
```

### Testing Decorators

```typescript
import { hasDecorator, getDecoratorOptions } from '@omnitron-dev/titan';

describe('Service decorators', () => {
  it('should apply service metadata', () => {
    @Service('test@1.0.0')
    class TestService {
      @Method()
      testMethod() {}
    }

    const metadata = Reflect.getMetadata('netron:service', TestService);
    expect(metadata.name).toBe('test');
    expect(metadata.version).toBe('1.0.0');

    const hasMethod = hasDecorator('Method', TestService.prototype, 'testMethod');
    expect(hasMethod).toBe(true);
  });
});
```

## Migration Guide

### From Legacy Decorators

```typescript
// Old (legacy)
@Public()
class OldService {
  @Public()
  method() {}
}

// New (Titan)
@Service('service@1.0.0')
class NewService {
  @Method()
  method() {}
}
```

### From Other DI Frameworks

```typescript
// NestJS
@Injectable()
@Controller('users')
class NestController {
  @Get(':id')
  getUser(@Param('id') id: string) {}
}

// Titan equivalent
@Injectable()
@Controller('/users')
class TitanController {
  @Method()
  getUser(id: string) {}
}
```

## Troubleshooting

### Common Issues

1. **Decorator not working**
   - Ensure `reflect-metadata` is imported
   - Check decorator is applied to correct target type
   - Verify TypeScript compiler options include `experimentalDecorators` and `emitDecoratorMetadata`

2. **Metadata not available**
   - Import decorators before using them
   - Ensure proper decorator execution order
   - Check for circular dependencies

3. **Type inference issues**
   - Provide explicit types in decorator options
   - Use proper TypeScript version (5.0+)
   - Enable strict mode in tsconfig

4. **Performance problems**
   - Use caching in custom decorators
   - Avoid heavy computation in decorator factories
   - Consider using lazy evaluation

## Related Documentation

- [Nexus DI Container](../nexus/README.md) - Dependency injection system
- [Netron RPC Framework](../netron/README.md) - Service communication
- [Application Layer](../application/README.md) - Application lifecycle
- [Events Module](../modules/events/README.md) - Event system
- [Scheduler Module](../modules/scheduler/README.md) - Task scheduling
- [Config Module](../modules/config/README.md) - Configuration management
- [Logger Module](../modules/logger/README.md) - Logging system