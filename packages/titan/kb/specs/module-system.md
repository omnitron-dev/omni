---
module: titan
title: "Module System"
tags: [modules, di, config, logger, dynamic-modules, forRoot, forFeature]
summary: "How Titan modules work — @Module decorator, dynamic modules, forRoot/forFeature pattern, and built-in modules"
depends_on: [philosophy, nexus-di, decorators]
---

# Module System

Modules are the organizational unit in Titan. They group related providers, declare dependencies on other modules via imports, and control visibility via exports.

## Defining a Module

### Basic Module

```typescript
import { Module, createToken, Injectable } from '@omnitron-dev/titan';

const USER_REPO_TOKEN = createToken<IUserRepository>('UserRepository');
const USER_SERVICE_TOKEN = createToken<IUserService>('UserService');

@Injectable()
class UserRepository implements IUserRepository { ... }

@Injectable()
class UserService implements IUserService {
  constructor(@Inject(USER_REPO_TOKEN) private repo: IUserRepository) {}
}

@Module({
  providers: [
    [USER_REPO_TOKEN, { useClass: UserRepository, scope: 'singleton' }],
    [USER_SERVICE_TOKEN, { useClass: UserService, scope: 'singleton' }],
  ],
  exports: [USER_SERVICE_TOKEN], // Only UserService is visible to importers
})
class UserModule {}
```

### Module with Imports

```typescript
@Module({
  imports: [DatabaseModule, CacheModule],
  providers: [
    [ORDER_SERVICE_TOKEN, {
      useClass: OrderService,
      inject: [USER_SERVICE_TOKEN, DB_TOKEN],
      scope: 'singleton',
    }],
  ],
  exports: [ORDER_SERVICE_TOKEN],
})
class OrderModule {}
```

### Global Module

Global modules make their exports available to all modules without explicit imports:

```typescript
@Global()
@Module({
  providers: [
    [LOGGER_TOKEN, { useClass: PinoLogger, scope: 'singleton' }],
  ],
  exports: [LOGGER_TOKEN],
})
class LoggerModule {}
```

Or via the options:

```typescript
@Module({
  global: true,
  providers: [...],
  exports: [...],
})
class SharedModule {}
```

## IModule Interface

Under the hood, modules conform to the `IModule` interface from `nexus/types.ts`:

```typescript
interface IModule {
  name: string;
  version?: string;
  dependencies?: (InjectionToken | string)[];

  // DI configuration
  imports?: IModule[];
  providers?: Array<Provider | ProviderInput>;
  exports?: InjectionToken[];
  global?: boolean;
  requires?: string[];

  // Metadata
  metadata?: {
    version?: string;
    description?: string;
    author?: string;
    tags?: string[];
    priority?: number;
  };
}
```

## Dynamic Modules

Dynamic modules return module configuration at runtime. This enables the `forRoot()` / `forFeature()` pattern for configurable modules.

### forRoot Pattern

Used to configure a module once for the entire application (typically in the root module):

```typescript
@Module()
class DatabaseModule {
  static forRoot(options: DatabaseOptions): DynamicModule {
    return {
      module: DatabaseModule,
      providers: [
        [DB_OPTIONS_TOKEN, { useValue: options }] as any,
        [DB_POOL_TOKEN, {
          useFactory: async (opts: DatabaseOptions) => {
            const pool = new Pool(opts.connectionString);
            await pool.connect();
            return pool;
          },
          inject: [DB_OPTIONS_TOKEN],
          scope: 'singleton',
        }] as any,
      ],
      exports: [DB_POOL_TOKEN],
      global: true, // Usually global so all modules can access the DB
    };
  }
}

// Usage
app.use(DatabaseModule.forRoot({
  connectionString: 'postgresql://localhost/mydb',
  poolSize: 10,
}));
```

### forFeature Pattern

Used to register feature-specific configuration within the context of a shared module:

```typescript
@Module()
class ConfigModule {
  static forFeature(name: string, schema?: ZodSchema): DynamicModule {
    const featureToken = createToken(`Config:${name}`);

    return {
      module: ConfigModule,
      providers: [
        [featureToken, {
          useFactory: async (configService: ConfigService) => {
            const value = configService.get(name);
            if (schema) {
              const result = schema.safeParse(value);
              if (!result.success) throw new Error(`Config validation failed: ${name}`);
              return result.data;
            }
            return value;
          },
          inject: [CONFIG_SERVICE_TOKEN],
        }] as any,
      ],
      exports: [featureToken],
    };
  }
}

// Usage — each feature module gets its own typed config slice
@Module({
  imports: [ConfigModule.forFeature('redis', redisConfigSchema)],
  providers: [...],
})
class RedisModule {}
```

### forRootAsync Pattern

For async configuration (e.g., loading from remote config server):

```typescript
app.use(ConfigModule.forRootAsync({
  useFactory: async (secretsService: ISecretsService) => {
    const secrets = await secretsService.loadAll();
    return {
      sources: [{ type: 'object', data: secrets }],
      global: true,
    };
  },
  inject: [SECRETS_SERVICE_TOKEN],
}));
```

### DynamicModule Return Shape

All `forRoot`/`forFeature`/`forRootAsync` methods return this shape:

```typescript
interface DynamicModule {
  module: Constructor;           // The module class
  providers: ProviderInput[];    // Provider tuples
  exports?: InjectionToken[];    // Tokens to export
  imports?: IModule[];           // Additional module imports
  global?: boolean;              // Make exports globally available
}
```

**Important**: Provider tuples often need `as any` casts due to TypeScript inference:

```typescript
providers: [
  [MY_TOKEN, { useValue: myValue }] as any,
  [SERVICE_TOKEN, { useFactory: () => new Service(), scope: 'singleton' }] as any,
],
```

## Built-in Modules

### ConfigModule

Provides configuration management with file/env/object sources, Zod schema validation, and hot reload.

**Import path**: `@omnitron-dev/titan/module/config`

```typescript
import { ConfigModule, CONFIG_SERVICE_TOKEN } from '@omnitron-dev/titan/module/config';

// Basic usage with defaults
app.use(ConfigModule.forRoot({
  defaults: { port: 3000, host: 'localhost' },
  global: true,
}));

// With multiple sources
app.use(ConfigModule.forRoot({
  sources: [
    { type: 'file', path: './config.yaml' },
    { type: 'env', prefix: 'APP_' },
    { type: 'object', data: { port: 3000 } },
  ],
  schema: appConfigSchema,       // Zod schema for validation
  watchForChanges: true,         // Hot reload on file changes
  global: true,
}));

// Feature-specific config slice
app.use(ConfigModule.forFeature('redis', redisConfigSchema));
```

**Tokens:**

| Token | Type | Description |
|-------|------|-------------|
| `CONFIG_SERVICE_TOKEN` | `ConfigService` | Main config service |
| `CONFIG_LOADER_SERVICE_TOKEN` | `ConfigLoaderService` | Source loader |
| `CONFIG_VALIDATOR_SERVICE_TOKEN` | `ConfigValidatorService` | Schema validator |
| `CONFIG_WATCHER_SERVICE_TOKEN` | `ConfigWatcherService` | File watcher |
| `CONFIG_OPTIONS_TOKEN` | `IConfigModuleOptions` | Module options |
| `CONFIG_SCHEMA_TOKEN` | `AnyZodSchema` | Global schema |

**ConfigService API:**

```typescript
const config = container.resolve(CONFIG_SERVICE_TOKEN);

// Get a value by dot-path
const port = config.get('server.port');          // any
const port = config.get<number>('server.port');  // typed

// Get with default
const debug = config.get('debug', false);
```

### LoggerModule

Provides structured logging via Pino.

**Import path**: `@omnitron-dev/titan/module/logger`

```typescript
import { LoggerModule, LOGGER_TOKEN, LOGGER_SERVICE_TOKEN } from '@omnitron-dev/titan/module/logger';

// Basic usage (auto-configured from environment)
app.use(LoggerModule);

// With options
app.use(LoggerModule.forRoot({
  level: 'info',
  pretty: process.env.NODE_ENV !== 'production',
  transports: [new ConsoleTransport()],
  processors: [new RedactionProcessor(['password', 'token'])],
}));

// Async configuration
app.use(LoggerModule.forRootAsync({
  useFactory: async (config: ConfigService) => ({
    level: config.get('logging.level', 'info'),
  }),
  inject: [CONFIG_SERVICE_TOKEN],
}));
```

**Tokens:**

| Token | Type | Description |
|-------|------|-------------|
| `LOGGER_TOKEN` | `ILogger` | Root logger instance |
| `LOGGER_SERVICE_TOKEN` | `LoggerService` | Logger service (manages child loggers) |
| `LOGGER_OPTIONS_TOKEN` | `ILoggerModuleOptions` | Module options |
| `LOGGER_TRANSPORTS_TOKEN` | `ITransport[]` | Custom transports |
| `LOGGER_PROCESSORS_TOKEN` | `ILogProcessor[]` | Log processors |

**ILogger API:**

```typescript
const logger = container.resolve(LOGGER_TOKEN);

logger.info('Server started');
logger.info({ port: 3000 }, 'Server started on port');
logger.error({ err }, 'Failed to connect');
logger.warn('Deprecation warning');
logger.debug({ query }, 'SQL query executed');
```

LoggerModule is marked `@Global()` — its exports are available to all modules without explicit imports.

**LoggerService** manages child loggers with scoped context:

```typescript
const loggerService = container.resolve(LOGGER_SERVICE_TOKEN);
const childLogger = loggerService.child({ module: 'auth', requestId: '123' });
childLogger.info('Processing login');
// Output: { module: "auth", requestId: "123", msg: "Processing login", ... }
```

LoggerService also supports `destinations` for multi-stream output (stdout + file).

## Registering Modules with the Application

```typescript
const app = await Application.create({ name: 'my-app' });

// Register static module
app.use(MyModule);

// Register dynamic module
app.use(ConfigModule.forRoot({ ... }));
app.use(LoggerModule.forRoot({ ... }));

// Register multiple
app.use(UserModule);
app.use(OrderModule);

await app.start();
```

### Module Loading Order

1. Modules are registered in the order `app.use()` is called
2. `imports` are loaded recursively before the importing module
3. `global` modules' exports are available everywhere
4. During `app.start()`:
   - All modules are loaded into the Nexus container
   - Singleton providers are eagerly initialized (`loadModuleAsync` + `eagerlyInitialize`)
   - `@PostConstruct` / `OnInit` hooks fire
   - Netron starts transport servers

### Module Lifecycle Hooks

Module classes can implement lifecycle methods:

```typescript
@Module({ ... })
class MyModule {
  async onStart(app: Application): Promise<void> {
    // Called when the application starts
  }

  async onStop(app: Application): Promise<void> {
    // Called when the application stops
  }
}
```

## Helper Functions

Titan provides convenience functions for common module patterns:

```typescript
import { createModule, defineModule, createToken, createApp, startApp } from '@omnitron-dev/titan';

// createModule — programmatic module creation without decorators
const myModule = createModule({
  name: 'MyModule',
  providers: [
    [TOKEN, { useClass: MyService }],
  ],
  exports: [TOKEN],
});

// createApp — create application instance
const app = createApp({ name: 'my-app', version: '1.0.0' });

// startApp — create and start in one call
const app = await startApp({ name: 'my-app', modules: [MyModule] });
```

## Common Patterns

### Feature Module with Service + RPC

```typescript
// auth.module.ts
@Module({
  providers: [
    [AUTH_REPO_TOKEN, { useClass: AuthRepository, scope: 'singleton' }],
    [AUTH_SERVICE_TOKEN, { useClass: AuthService, scope: 'singleton' }],
    [AUTH_RPC_TOKEN, { useClass: AuthRpcService, scope: 'singleton' }],
  ],
  exports: [AUTH_SERVICE_TOKEN, AUTH_RPC_TOKEN],
})
class AuthModule {}

// Usage in app
app.use(AuthModule);
```

### Shared Infrastructure Module

```typescript
@Global()
@Module({
  providers: [
    [REDIS_TOKEN, {
      useFactory: async (config: ConfigService) => {
        const client = createClient({ url: config.get('redis.url') });
        await client.connect();
        return client;
      },
      inject: [CONFIG_SERVICE_TOKEN],
      scope: 'singleton',
    }] as any,
  ],
  exports: [REDIS_TOKEN],
})
class RedisModule {}
```

### Module with Conditional Providers

```typescript
@Module()
class StorageModule {
  static forRoot(options: StorageOptions): DynamicModule {
    const providers: any[] = [
      [STORAGE_OPTIONS_TOKEN, { useValue: options }] as any,
    ];

    if (options.driver === 's3') {
      providers.push([STORAGE_TOKEN, { useClass: S3Storage, scope: 'singleton' }] as any);
    } else {
      providers.push([STORAGE_TOKEN, { useClass: LocalStorage, scope: 'singleton' }] as any);
    }

    return {
      module: StorageModule,
      providers,
      exports: [STORAGE_TOKEN],
    };
  }
}
```

## Gotchas

1. **Provider tuple `as any` casts**: TypeScript often cannot infer the exact tuple types. Use `as any` on provider tuples to avoid compilation errors. This is a known pattern throughout the codebase.

2. **Module registration order**: If module A imports module B, module B's providers must be available when A's providers are resolved. Generally, register infrastructure modules first (Config, Logger, Redis, DB) then feature modules.

3. **Global modules**: Use sparingly. Every global module's exports pollute the entire application's DI namespace. Good candidates: Logger, Config. Bad candidates: feature-specific services.

4. **forRoot vs static providers**: Use `forRoot` when the module needs runtime configuration. Use static `@Module({ providers: [...] })` when everything is known at compile time.

5. **ConfigModule creates services directly**: Unlike most modules, `ConfigModule.forRoot` instantiates `ConfigService`, `ConfigLoaderService`, etc. directly (not via DI) and registers them as value providers. This is intentional to avoid circular dependency with the config system itself.

6. **LoggerModule optional dependencies**: LoggerModule's providers use optional injection for `LOGGER_OPTIONS_TOKEN`, `CONFIG_SERVICE_TOKEN`, etc. This means the module works even without ConfigModule being loaded.
