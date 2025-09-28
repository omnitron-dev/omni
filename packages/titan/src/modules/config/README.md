# Titan Configuration Module

Comprehensive configuration management system for the Titan framework with multi-source loading, schema validation, hot reload, and type-safe access.

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Installation & Setup](#installation--setup)
  - [Basic Setup](#basic-setup)
  - [Advanced Setup](#advanced-setup)
  - [Async Configuration](#async-configuration)
- [Configuration Sources](#configuration-sources)
  - [File Sources](#file-sources)
  - [Environment Variables](#environment-variables)
  - [Command Line Arguments](#command-line-arguments)
  - [Object Sources](#object-sources)
  - [Remote Sources](#remote-sources)
- [Configuration Access](#configuration-access)
  - [Service API](#service-api)
  - [Decorator Injection](#decorator-injection)
  - [Typed Access](#typed-access)
- [Schema Validation](#schema-validation)
  - [Global Schema](#global-schema)
  - [Feature Schemas](#feature-schemas)
  - [Validation Options](#validation-options)
- [Configuration Decorators](#configuration-decorators)
  - [@Config](#config)
  - [@InjectConfig](#injectconfig)
  - [@ConfigSchema](#configschema)
  - [@Configuration](#configuration)
  - [@ConfigValidate](#configvalidate)
  - [@ConfigWatch](#configwatch)
  - [@ConfigDefaults](#configdefaults)
  - [@ConfigProvider](#configprovider)
  - [@ConfigTransform](#configtransform)
- [Hot Reload](#hot-reload)
  - [File Watching](#file-watching)
  - [Change Events](#change-events)
  - [Reload Strategies](#reload-strategies)
- [Caching](#caching)
- [Environment Management](#environment-management)
- [Feature Modules](#feature-modules)
- [Advanced Usage](#advanced-usage)
  - [Custom Loaders](#custom-loaders)
  - [Transformations](#transformations)
  - [Priority & Merging](#priority--merging)
  - [Conditional Configuration](#conditional-configuration)
- [Testing](#testing)
- [Best Practices](#best-practices)
- [API Reference](#api-reference)
- [Examples](#examples)

## Overview

The Titan Configuration Module provides a robust, type-safe configuration management system that supports multiple sources, runtime validation, hot reloading, and seamless integration with the dependency injection system.

### Key Capabilities

- **Multi-source Configuration**: Load from files, environment variables, command-line arguments, objects, and remote sources
- **Type Safety**: Full TypeScript support with Zod schema validation
- **Hot Reload**: Automatic configuration reloading on file changes
- **Dependency Injection**: Deep integration with Titan's DI system via decorators
- **Caching**: Built-in caching for frequently accessed values
- **Environment Support**: Environment-specific configuration management
- **Extensible**: Custom loaders, validators, and transformations

## Features

### Core Features

- ✅ **Multiple Configuration Sources** with priority-based merging
- ✅ **Schema Validation** using Zod for type safety
- ✅ **Hot Reload** with file watching capabilities
- ✅ **Decorator-based Injection** for seamless DI integration
- ✅ **Caching Layer** for performance optimization
- ✅ **Environment Management** for different deployment stages
- ✅ **Feature Modules** for modular configuration
- ✅ **Change Notifications** with event-driven updates
- ✅ **Async Loading** for remote and dynamic sources
- ✅ **Transformation Pipeline** for data processing

### Supported Formats

- JSON (`.json`)
- YAML (`.yaml`, `.yml`)
- TOML (`.toml`)
- INI (`.ini`)
- Environment files (`.env`)
- Properties files (`.properties`) - Java-style properties
- TypeScript/JavaScript modules

## Installation & Setup

### Basic Setup

Configure the module with default options:

```typescript
import { Application } from '@omnitron-dev/titan';
import { ConfigModule } from '@omnitron-dev/titan/module/config';

const app = await Application.create({
  imports: [
    ConfigModule.forRoot({
      sources: [
        { type: 'file', path: 'config/default.json' },
        { type: 'env', prefix: 'APP_' },
        { type: 'argv' }
      ],
      global: true
    })
  ]
});
```

### Advanced Setup

Full configuration with all options:

```typescript
import { z } from 'zod';

const AppConfigSchema = z.object({
  server: z.object({
    port: z.number().min(1).max(65535),
    host: z.string().default('localhost'),
    ssl: z.object({
      enabled: z.boolean().default(false),
      cert: z.string().optional(),
      key: z.string().optional()
    })
  }),
  database: z.object({
    url: z.string().url(),
    pool: z.object({
      min: z.number().default(2),
      max: z.number().default(10)
    })
  }),
  redis: z.object({
    host: z.string().default('localhost'),
    port: z.number().default(6379),
    password: z.string().optional()
  }),
  features: z.object({
    analytics: z.boolean().default(false),
    notifications: z.boolean().default(true)
  })
});

ConfigModule.forRoot({
  // Configuration sources (priority: first = lowest)
  sources: [
    // Default configuration
    {
      type: 'file',
      path: 'config/default.json',
      priority: 1
    },

    // Environment-specific configuration
    {
      type: 'file',
      path: `config/${process.env.NODE_ENV || 'development'}.json`,
      optional: true,
      priority: 2
    },

    // Environment variables
    {
      type: 'env',
      prefix: 'APP_',
      separator: '__',
      transform: 'camelCase',
      priority: 3
    },

    // Command-line arguments
    {
      type: 'argv',
      prefix: '--config.',
      priority: 4
    },

    // Local overrides
    {
      type: 'file',
      path: 'config/local.json',
      optional: true,
      priority: 5
    }
  ],

  // Global schema validation
  schema: AppConfigSchema,

  // Environment
  environment: process.env.NODE_ENV || 'development',

  // Validation options
  validateOnStartup: true,

  // File watching for hot reload
  watchForChanges: process.env.NODE_ENV !== 'production',

  // Caching configuration
  cache: {
    enabled: true,
    ttl: 60000 // 1 minute
  },

  // Strict mode
  strict: true,

  // Make globally available
  global: true
})
```

### Async Configuration

Load configuration asynchronously:

```typescript
ConfigModule.forRootAsync({
  useFactory: async (secretsManager: SecretsManager) => {
    const secrets = await secretsManager.getSecrets();

    return {
      sources: [
        {
          type: 'object',
          data: {
            database: {
              password: secrets.dbPassword,
              apiKey: secrets.apiKey
            }
          }
        },
        {
          type: 'file',
          path: 'config/app.json'
        }
      ],
      schema: AppConfigSchema
    };
  },
  inject: [SecretsManager],
  global: true
})
```

## Configuration Sources

### File Sources

Load configuration from various file formats:

```typescript
// JSON file
{
  type: 'file',
  path: 'config/app.json',
  format: 'json',
  encoding: 'utf-8',
  optional: false,
  priority: 1
}

// YAML file
{
  type: 'file',
  path: 'config/settings.yaml',
  format: 'yaml',
  transform: (data) => {
    // Transform loaded data
    return transformConfig(data);
  }
}

// TOML file
{
  type: 'file',
  path: 'config/app.toml',
  format: 'toml'
}

// INI file
{
  type: 'file',
  path: 'config/database.ini',
  format: 'ini'
}

// Environment file
{
  type: 'file',
  path: '.env',
  format: 'env'
}

// Properties file (Java-style)
{
  type: 'file',
  path: 'config/app.properties',
  format: 'properties'  // Supports key=value and key:value formats
}
```

**Properties File Format:**
```properties
# app.properties - Java-style properties file
# Comments start with # or !

# Basic key-value pairs
app.name=MyApplication
app.version=1.0.0

# Nested properties using dots
server.host=localhost
server.port=8080
server.ssl.enabled=true

# Colon as separator
database.url:postgres://localhost:5432/mydb
database.pool.min:2
database.pool.max:10

# Line continuation with backslash
app.description=This is a very long description \
               that spans multiple lines \
               for better readability

# Special characters in values
app.path=/usr/local/app
app.regex=^[a-zA-Z0-9]+$
app.special=Value with spaces and = signs
```

**Supported Formats:**
- **JSON**: Standard JSON files (`.json`)
- **YAML**: YAML configuration files (`.yaml`, `.yml`)
- **TOML**: TOML configuration files (`.toml`)
- **INI**: INI format files (`.ini`)
- **ENV**: Dotenv format files (`.env`)
- **Properties**: Java-style properties files (`.properties`)

**Format Auto-Detection:**
When `format` is not specified, the loader automatically detects the format from file extension:
```typescript
{
  type: 'file',
  path: 'config/settings.yaml',  // Format auto-detected as 'yaml'
  optional: true
}
```

### Environment Variables

Load from process environment:

```typescript
{
  type: 'env',
  prefix: 'APP_',           // Only load vars with this prefix
  separator: '__',          // Nested key separator (APP__DB__HOST → db.host)
  transform: 'camelCase',   // Transform keys to camelCase
  priority: 3
}

// Custom transform function
{
  type: 'env',
  transform: (key: string, value: any) => {
    // Custom transformation logic
    if (key.endsWith('_PORT')) {
      return parseInt(value, 10);
    }
    return value;
  }
}
```

**Environment Mapping:**
```bash
# Shell environment
export APP_SERVER__PORT=3000
export APP_DATABASE__URL="postgres://localhost:5432/mydb"
export APP_FEATURES__ANALYTICS=true
export APP_CACHE__OPTIONS='{"ttl":3600,"max":1000}'  # JSON object parsing
export APP_ALLOWED_IPS='["10.0.0.1","10.0.0.2"]'     # JSON array parsing
export APP_TIMEOUT=5000                                  # Number parsing
export APP_DEBUG=false                                   # Boolean parsing
export APP_NULLABLE=null                                 # Null parsing

# Maps to configuration:
{
  server: {
    port: 3000  // Automatically parsed as number
  },
  database: {
    url: "postgres://localhost:5432/mydb"  // String value
  },
  features: {
    analytics: true  // Automatically parsed as boolean
  },
  cache: {
    options: {  // Automatically parsed from JSON
      ttl: 3600,
      max: 1000
    }
  },
  allowedIps: ["10.0.0.1", "10.0.0.2"],  // Parsed from JSON array
  timeout: 5000,  // Parsed as number
  debug: false,   // Parsed as boolean
  nullable: null  // Parsed as null
}
```

**Automatic Value Parsing:**
The environment loader automatically parses values:
- **Quoted strings**: Quotes are removed (`"value"` or `'value'` → `value`)
- **Booleans**: `'true'` → `true`, `'false'` → `false`
- **Numbers**: Integer (`'123'` → `123`) and float (`'3.14'` → `3.14`)
- **Null values**: `'null'` or `'undefined'` → `null`
- **JSON objects**: Strings starting with `{` are parsed as JSON
- **JSON arrays**: Strings starting with `[` are parsed as JSON
- **Regular strings**: Everything else remains as string

### Command Line Arguments

Load from command-line arguments:

```typescript
{
  type: 'argv',
  prefix: '--config.',  // Prefix for config args
  priority: 4
}

// Usage:
// node app.js --config.port=3000 --config.database.host=localhost

// Boolean flags (no value = true)
// node app.js --config.debug --config.verbose

// Nested values using dots
// node app.js --config.server.port=8080 --config.server.ssl.enabled=true

// Array values (JSON)
// node app.js --config.allowedIps='["10.0.0.1","10.0.0.2"]'
```

**Command Line Parsing:**
- Arguments starting with the prefix are parsed as config
- Values are automatically parsed (numbers, booleans, JSON)
- Flags without values are set to `true`
- Dots in keys create nested objects

### Object Sources

Direct object configuration:

```typescript
{
  type: 'object',
  data: {
    server: {
      port: 3000,
      host: 'localhost'
    },
    features: {
      experimental: true
    }
  },
  priority: 0
}
```

### Remote Sources

Load configuration from remote endpoints:

```typescript
{
  type: 'remote',
  url: 'https://config-server.com/api/config/myapp',
  headers: {
    'Authorization': 'Bearer token',
    'X-Environment': 'production'
  },
  timeout: 5000,  // Request timeout in milliseconds
  retry: 3,        // Number of retry attempts (not yet implemented)
  priority: 2
}
```

**Remote Source Features:**
- Automatic content-type detection (JSON, YAML)
- Custom headers support
- Configurable timeout with AbortController
- Falls back to JSON parsing for unknown content types

## Configuration Access

### Service API

Access configuration via the ConfigService:

```typescript
import { Injectable, Inject } from '@omnitron-dev/titan';
import { ConfigService } from '@omnitron-dev/titan/module/config';

@Injectable()
class MyService {
  constructor(
    @Inject(ConfigService) private config: ConfigService
  ) {}

  async initialize() {
    // Get value with dot notation
    const port = this.config.get<number>('server.port');
    const dbUrl = this.config.get<string>('database.url');

    // Get with default value
    const timeout = this.config.get('server.timeout', 30000);

    // Get entire section
    const dbConfig = this.config.get('database');

    // Check if path exists
    if (this.config.has('redis.password')) {
      // Use Redis with auth
    }

    // Get all configuration
    const allConfig = this.config.getAll();

    // Set value at runtime
    this.config.set('features.beta', true);

    // Get environment
    const env = this.config.environment; // 'development' | 'production' | etc.

    // Get metadata
    const metadata = this.config.getMetadata();
    console.log('Config loaded from:', metadata.sources);
  }
}
```

### Decorator Injection

Inject configuration values directly into class members:

```typescript
@Injectable()
class ApiService {
  // Property injection
  @Config('api.baseUrl')
  private baseUrl!: string;

  @Config('api.timeout', 5000)
  private timeout!: number;

  // Constructor injection
  constructor(
    @Config('api.key') private apiKey: string,
    @Config('api.retries', 3) private retries: number
  ) {}

  // Full config service injection
  constructor(
    @InjectConfig() private config: ConfigService
  ) {}
}
```

### Typed Access

Access configuration with type safety:

```typescript
const ServerConfigSchema = z.object({
  port: z.number(),
  host: z.string(),
  ssl: z.object({
    enabled: z.boolean(),
    cert: z.string().optional(),
    key: z.string().optional()
  })
});

type ServerConfig = z.infer<typeof ServerConfigSchema>;

@Injectable()
class ServerService {
  constructor(
    @Inject(ConfigService) private config: ConfigService
  ) {}

  getServerConfig(): ServerConfig {
    // Get typed configuration with validation
    return this.config.getTyped(ServerConfigSchema, 'server');
  }

  async start() {
    const serverConfig = this.getServerConfig();
    // serverConfig is fully typed
    console.log(`Starting server on ${serverConfig.host}:${serverConfig.port}`);
  }
}
```

## Schema Validation

### Global Schema

Define a global schema for entire configuration:

```typescript
const GlobalSchema = z.object({
  app: z.object({
    name: z.string(),
    version: z.string(),
    environment: z.enum(['development', 'staging', 'production'])
  }),
  server: z.object({
    port: z.number().min(1).max(65535),
    host: z.string()
  }),
  database: z.object({
    type: z.enum(['postgres', 'mysql', 'mongodb']),
    url: z.string().url(),
    options: z.record(z.any()).optional()
  })
});

ConfigModule.forRoot({
  schema: GlobalSchema,
  validateOnStartup: true,
  sources: [...]
})
```

### Feature Schemas

Define schemas for specific features:

```typescript
// Define feature schema
const CacheConfigSchema = z.object({
  enabled: z.boolean(),
  ttl: z.number().min(0),
  maxSize: z.number().positive(),
  strategy: z.enum(['lru', 'lfu', 'fifo'])
});

// Register feature configuration
ConfigModule.forFeature('cache', CacheConfigSchema)

// Use in service
@Injectable()
class CacheService {
  constructor(
    @Inject('Config:cache') private cacheConfig: z.infer<typeof CacheConfigSchema>
  ) {
    // cacheConfig is fully typed and validated
  }
}
```

### Validation Options

Control validation behavior:

```typescript
// Manual validation
const result = configService.validate();
if (!result.success) {
  console.error('Config validation failed:', result.errors);
}

// Validate specific path
const pathResult = configService.validate(
  z.number().min(1).max(65535),
  'server.port'
);

// Custom validation in decorator
@Injectable()
class ServiceWithValidation {
  @ConfigValidate(z.number().min(1).max(100))
  @Config('app.maxConnections')
  private maxConnections!: number;
}
```

## Configuration Decorators

### @Config

Inject configuration values into properties or constructor parameters:

```typescript
class ExampleService {
  // Property injection with path
  @Config('database.host')
  private dbHost!: string;

  // With default value
  @Config('server.port', 3000)
  private port!: number;

  // Constructor parameter injection
  constructor(
    @Config('app.name') private appName: string,
    @Config('features.cache', false) private cacheEnabled: boolean
  ) {}

  // Nested path injection
  @Config('redis.connection.options.timeout', 5000)
  private redisTimeout!: number;
}
```

### @InjectConfig

Inject the entire ConfigService:

```typescript
@Injectable()
class DynamicService {
  constructor(
    @InjectConfig() private config: ConfigService
  ) {}

  async processRequest() {
    const endpoint = this.config.get('api.endpoint');
    const headers = this.config.get('api.headers');
    // Use configuration dynamically
  }
}
```

### @ConfigSchema

Define validation schema for configuration classes:

```typescript
const UserConfigSchema = z.object({
  maxUsers: z.number().positive(),
  allowRegistration: z.boolean(),
  passwordPolicy: z.object({
    minLength: z.number().min(8),
    requireSpecialChars: z.boolean(),
    requireNumbers: z.boolean()
  })
});

@ConfigSchema(UserConfigSchema)
class UserConfig {
  maxUsers!: number;
  allowRegistration!: boolean;
  passwordPolicy!: {
    minLength: number;
    requireSpecialChars: boolean;
    requireNumbers: boolean;
  };

  // Automatically added by decorator
  validate() {
    return UserConfigSchema.safeParse(this);
  }
}
```

### @Configuration

Mark a class as a configuration class:

```typescript
@Configuration('database')
@ConfigSchema(DatabaseConfigSchema)
class DatabaseConfig {
  host: string = 'localhost';
  port: number = 5432;
  database: string = 'myapp';
  username?: string;
  password?: string;

  get connectionString(): string {
    return `postgres://${this.username}:${this.password}@${this.host}:${this.port}/${this.database}`;
  }
}

// Automatically registered with DI container
@Injectable()
class DatabaseService {
  constructor(
    @Inject('DatabaseConfigConfig') private dbConfig: DatabaseConfig
  ) {}
}
```

### @ConfigValidate

Validate configuration values:

```typescript
class ValidatedConfig {
  @ConfigValidate(z.number().min(1).max(65535))
  @Config('server.port')
  private port!: number;

  @ConfigValidate(z.string().email())
  @Config('admin.email')
  private adminEmail!: string;

  @ConfigValidate(z.array(z.string().url()))
  @Config('api.endpoints')
  private apiEndpoints!: string[];
}
```

### @ConfigWatch

Watch for configuration changes:

```typescript
@Injectable()
class DynamicFeatureService {
  private features: Set<string> = new Set();

  @ConfigWatch('features')
  onFeaturesChange(newValue: Record<string, boolean>, oldValue: Record<string, boolean>) {
    console.log('Features changed from', oldValue, 'to', newValue);

    // Update enabled features
    this.features.clear();
    for (const [feature, enabled] of Object.entries(newValue)) {
      if (enabled) {
        this.features.add(feature);
      }
    }

    // React to changes
    this.updateFeatureFlags();
  }

  @ConfigWatch('database.connectionString')
  async onDatabaseChange(newValue: string, oldValue: string) {
    console.log('Database connection changed, reconnecting...');
    await this.reconnectDatabase(newValue);
  }
}
```

### @ConfigDefaults

Provide default values for configuration classes:

```typescript
@ConfigDefaults({
  host: 'localhost',
  port: 6379,
  db: 0,
  password: undefined,
  retryAttempts: 3,
  retryDelay: 1000
})
@ConfigSchema(RedisConfigSchema)
class RedisConfig {
  host!: string;
  port!: number;
  db!: number;
  password?: string;
  retryAttempts!: number;
  retryDelay!: number;
}
```

### @ConfigProvider

Mark methods as configuration providers:

```typescript
@Injectable()
class ConfigProviders {
  constructor(
    private secretsManager: SecretsManager,
    private vaultClient: VaultClient
  ) {}

  @ConfigProvider('database')
  async provideDatabaseConfig(): Promise<DatabaseConfig> {
    const secrets = await this.secretsManager.getSecrets('database');

    return {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'myapp',
      username: secrets.username,
      password: secrets.password
    };
  }

  @ConfigProvider('api-keys')
  async provideApiKeys(): Promise<Record<string, string>> {
    return await this.vaultClient.getApiKeys();
  }
}
```

### @ConfigTransform

Transform configuration values:

```typescript
class TransformedConfig {
  @ConfigTransform((value) => value.toUpperCase())
  @Config('app.environment')
  private environment!: string;  // Always uppercase

  @ConfigTransform((value) => parseInt(value, 10))
  @Config('server.port')
  private port!: number;  // String to number

  @ConfigTransform((value) => value.split(',').map(s => s.trim()))
  @Config('app.allowedOrigins')
  private allowedOrigins!: string[];  // CSV to array

  @ConfigTransform((value) => {
    // Complex transformation
    return {
      ...value,
      normalized: value.toLowerCase().replace(/[^a-z0-9]/g, ''),
      timestamp: Date.now()
    };
  })
  @Config('app.identifier')
  private identifier!: any;
}
```

## Hot Reload

### File Watching

Enable automatic configuration reloading:

```typescript
ConfigModule.forRoot({
  sources: [
    { type: 'file', path: 'config/app.json' },
    { type: 'file', path: 'config/features.yaml' }
  ],
  watchForChanges: true,  // Enable file watching
  schema: AppSchema
})
```

### Change Events

Subscribe to configuration changes:

```typescript
@Injectable()
class ConfigChangeHandler {
  constructor(
    @Inject(ConfigService) private config: ConfigService
  ) {}

  async onModuleInit() {
    // Subscribe to all changes
    const unsubscribe = this.config.onChange((event) => {
      console.log(`Config changed: ${event.path}`);
      console.log(`Old value:`, event.oldValue);
      console.log(`New value:`, event.newValue);
      console.log(`Source:`, event.source);

      // React to specific changes
      if (event.path.startsWith('features.')) {
        this.updateFeatures();
      }
    });

    // Unsubscribe when needed
    // unsubscribe();
  }
}
```

### Reload Strategies

Implement custom reload strategies:

```typescript
@Injectable()
class ConfigReloadService {
  constructor(
    @Inject(ConfigService) private config: ConfigService
  ) {}

  async manualReload() {
    try {
      // Manually trigger reload
      await this.config.reload();
      console.log('Configuration reloaded successfully');

      // Validate after reload
      const result = this.config.validate();
      if (!result.success) {
        console.error('Validation failed after reload:', result.errors);
        // Potentially rollback or handle error
      }
    } catch (error) {
      console.error('Failed to reload configuration:', error);
    }
  }

  // Scheduled reload
  @Cron('0 */5 * * *')  // Every 5 hours
  async scheduledReload() {
    await this.manualReload();
  }
}
```

## Caching

Configure caching for better performance:

```typescript
ConfigModule.forRoot({
  cache: {
    enabled: true,
    ttl: 60000  // Cache for 1 minute
  },
  sources: [...]
})
```

Cache behavior:

```typescript
@Injectable()
class CachedConfigExample {
  constructor(
    @Inject(ConfigService) private config: ConfigService
  ) {}

  demonstrateCaching() {
    // First access - loads from source
    const value1 = this.config.get('expensive.computation');

    // Second access within TTL - returns from cache
    const value2 = this.config.get('expensive.computation');

    // Runtime set clears cache for that path
    this.config.set('expensive.computation', 'new value');

    // Next access loads fresh value
    const value3 = this.config.get('expensive.computation');
  }
}
```

## Environment Management

Handle environment-specific configuration:

```typescript
// Configuration structure
// config/
//   default.json      - Default configuration
//   development.json  - Development overrides
//   staging.json      - Staging overrides
//   production.json   - Production overrides
//   test.json        - Test overrides

ConfigModule.forRoot({
  environment: process.env.NODE_ENV || 'development',
  sources: [
    // Base configuration
    {
      type: 'file',
      path: 'config/default.json',
      priority: 1
    },

    // Environment-specific
    {
      type: 'file',
      path: `config/${process.env.NODE_ENV || 'development'}.json`,
      optional: true,
      priority: 2
    }
  ]
})

// Access environment
@Injectable()
class EnvironmentAwareService {
  constructor(
    @Inject(ConfigService) private config: ConfigService
  ) {}

  initialize() {
    const env = this.config.environment;

    if (env === 'production') {
      // Production-specific initialization
    } else if (env === 'development') {
      // Development-specific initialization
    }
  }
}
```

## Feature Modules

Create feature-specific configuration modules:

```typescript
// Define feature configuration
const EmailConfigSchema = z.object({
  provider: z.enum(['sendgrid', 'ses', 'smtp']),
  from: z.string().email(),
  replyTo: z.string().email().optional(),
  smtp: z.object({
    host: z.string(),
    port: z.number(),
    secure: z.boolean(),
    auth: z.object({
      user: z.string(),
      pass: z.string()
    })
  }).optional()
});

// Register feature module
@Module({
  imports: [
    ConfigModule.forFeature('email', EmailConfigSchema)
  ],
  providers: [EmailService],
  exports: [EmailService]
})
class EmailModule {}

// Use in service
@Injectable()
class EmailService {
  constructor(
    @Inject('Config:email') private emailConfig: z.infer<typeof EmailConfigSchema>
  ) {}

  async sendEmail(to: string, subject: string, body: string) {
    const { provider, from } = this.emailConfig;

    switch (provider) {
      case 'sendgrid':
        return this.sendViaSendGrid(from, to, subject, body);
      case 'ses':
        return this.sendViaSES(from, to, subject, body);
      case 'smtp':
        return this.sendViaSMTP(from, to, subject, body);
    }
  }
}
```

## Advanced Usage

### Custom Loaders

Implement custom configuration loaders:

```typescript
class ConsulConfigLoader {
  async load(key: string): Promise<Record<string, any>> {
    const consul = new Consul();
    const result = await consul.kv.get(key);
    return JSON.parse(result.Value);
  }
}

// Use custom loader
ConfigModule.forRootAsync({
  useFactory: async (consulLoader: ConsulConfigLoader) => {
    const consulConfig = await consulLoader.load('myapp/config');

    return {
      sources: [
        {
          type: 'object',
          data: consulConfig,
          priority: 10
        },
        {
          type: 'file',
          path: 'config/local.json',
          priority: 20
        }
      ]
    };
  },
  inject: [ConsulConfigLoader]
})
```

### Transformations

Apply transformations to configuration:

```typescript
// Transform function for source
{
  type: 'file',
  path: 'config/raw.json',
  transform: (data) => {
    // Transform raw configuration
    return {
      ...data,
      processedAt: new Date(),
      version: packageJson.version,
      computedValues: {
        fullUrl: `${data.protocol}://${data.host}:${data.port}${data.path}`
      }
    };
  }
}

// Environment variable transformation
{
  type: 'env',
  transform: (key: string, value: any) => {
    // Parse JSON strings
    if (typeof value === 'string' && value.startsWith('{')) {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }

    // Parse numbers
    if (/^\d+$/.test(value)) {
      return parseInt(value, 10);
    }

    // Parse booleans
    if (value === 'true') return true;
    if (value === 'false') return false;

    return value;
  }
}
```

### Priority & Merging

Control configuration merging with priorities:

```typescript
ConfigModule.forRoot({
  sources: [
    // Lowest priority (1) - base defaults
    {
      type: 'object',
      data: { logLevel: 'info', timeout: 30000 },
      priority: 1
    },

    // Medium priority (5) - file configuration
    {
      type: 'file',
      path: 'config/app.json',
      priority: 5
    },

    // High priority (10) - environment overrides
    {
      type: 'env',
      priority: 10
    },

    // Highest priority (20) - command line overrides
    {
      type: 'argv',
      priority: 20
    }
  ]
})

// Result: argv > env > file > defaults
```

### Conditional Configuration

Load configuration conditionally:

```typescript
ConfigModule.forRootAsync({
  useFactory: async () => {
    const sources: ConfigSource[] = [
      { type: 'file', path: 'config/base.json' }
    ];

    // Conditionally add sources
    if (process.env.USE_REMOTE_CONFIG === 'true') {
      sources.push({
        type: 'remote',
        url: process.env.CONFIG_SERVER_URL!,
        priority: 10
      });
    }

    if (await fileExists('config/local.json')) {
      sources.push({
        type: 'file',
        path: 'config/local.json',
        priority: 20
      });
    }

    if (process.env.NODE_ENV === 'test') {
      sources.push({
        type: 'object',
        data: { testMode: true, mockServices: true },
        priority: 30
      });
    }

    return { sources };
  }
})
```

## Special Behaviors & Edge Cases

### Path Notation

```typescript
// Dot notation for nested access
config.get('server.port');           // Gets server.port
config.get('server.ssl.enabled');    // Gets server.ssl.enabled

// Empty path behavior
config.get('');      // Returns undefined
config.set('', {});  // Replaces entire configuration

// Path with empty segments
config.get('server..port');  // Handles gracefully, skips empty segments
```

### Synchronous Initialization

The ConfigService can be used synchronously if object sources are provided:

```typescript
// Constructor sets initial config from object sources
// This allows synchronous access before full initialization
ConfigModule.forRoot({
  sources: [
    {
      type: 'object',
      data: { port: 3000 }  // Available immediately
    },
    {
      type: 'file',
      path: 'config.json'  // Loaded asynchronously
    }
  ]
})

// Can access object data synchronously
const port = config.get('port');  // Works before initialize()
```

### Transform Function Behaviors

```typescript
// File source transform
{
  type: 'file',
  path: 'config.json',
  transform: (data) => {
    // Receives parsed data object
    // Must return transformed object
    return processConfig(data);
  }
}

// Environment source transform
{
  type: 'env',
  transform: (key: string, value: any) => {
    // Receives each key-value pair
    // Return undefined to skip the key
    if (key.startsWith('IGNORE_')) {
      return undefined;
    }
    return value;
  }
}
```

### Default Value Handling

```typescript
// Module accepts 'defaults' as shorthand for object source
ConfigModule.forRoot({
  defaults: {  // Converted to object source internally
    port: 3000,
    host: 'localhost'
  }
})

// Equivalent to:
ConfigModule.forRoot({
  sources: [{
    type: 'object',
    data: {
      port: 3000,
      host: 'localhost'
    }
  }]
})
```

### Reload Behavior

```typescript
// Reload preserves configuration on validation failure
async reload() {
  const oldConfig = this.config;

  try {
    this.config = await loadNewConfig();
    await validate(this.config);
  } catch (error) {
    this.config = oldConfig;  // Rollback on error
    throw error;
  }
}
```

### Watcher Limitations

- Only watches file sources (not remote or env)
- Skips already watched files
- Ignores errors for optional sources
- Uses Node.js fs.watch (subject to platform limitations)

## Testing

### Mock Configuration

Create mock configuration for tests:

```typescript
import { Test } from '@omnitron-dev/titan/testing';
import { ConfigModule, ConfigService } from '@omnitron-dev/titan/module/config';

describe('ServiceTest', () => {
  let configService: ConfigService;
  let myService: MyService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          sources: [
            {
              type: 'object',
              data: {
                api: {
                  url: 'http://mock-api.test',
                  key: 'test-key',
                  timeout: 1000
                },
                features: {
                  analytics: false,
                  notifications: true
                }
              }
            }
          ]
        })
      ],
      providers: [MyService]
    }).compile();

    configService = module.get(ConfigService);
    myService = module.get(MyService);
  });

  it('should use test configuration', () => {
    expect(configService.get('api.url')).toBe('http://mock-api.test');
    expect(configService.get('features.analytics')).toBe(false);
  });
});
```

### Override Configuration

Override configuration in tests:

```typescript
describe('FeatureTest', () => {
  let configService: ConfigService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot()],
      providers: [
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((path: string) => {
              const testConfig = {
                'feature.enabled': true,
                'api.timeout': 100
              };
              return testConfig[path];
            }),
            set: jest.fn(),
            getAll: jest.fn(() => ({}))
          }
        }
      ]
    }).compile();

    configService = module.get(ConfigService);
  });

  it('should use mocked config', () => {
    expect(configService.get('feature.enabled')).toBe(true);
    expect(configService.get('api.timeout')).toBe(100);
  });
});
```

### Test Configuration Changes

Test configuration change handling:

```typescript
describe('ConfigChangeTest', () => {
  it('should handle configuration changes', async () => {
    const configService = new ConfigService(
      { sources: [], watchForChanges: true },
      loader,
      validator,
      watcher,
      schema
    );

    const changeHandler = jest.fn();
    configService.onChange(changeHandler);

    // Trigger change
    configService.set('test.value', 'new');

    expect(changeHandler).toHaveBeenCalledWith({
      path: 'test.value',
      oldValue: undefined,
      newValue: 'new',
      source: 'runtime',
      timestamp: expect.any(Date)
    });
  });
});
```

## Best Practices

### 1. Schema Validation

Always define schemas for type safety:

```typescript
// ✅ Good - Type-safe configuration
const Schema = z.object({
  port: z.number().min(1).max(65535),
  host: z.string(),
  ssl: z.boolean()
});

ConfigModule.forRoot({
  schema: Schema,
  validateOnStartup: true
})

// ❌ Bad - No validation
ConfigModule.forRoot({
  sources: [{ type: 'file', path: 'config.json' }]
})
```

### 2. Environment-Specific Configuration

Separate environment-specific values:

```typescript
// ✅ Good - Clear separation
sources: [
  { type: 'file', path: 'config/default.json', priority: 1 },
  { type: 'file', path: `config/${env}.json`, priority: 2 },
  { type: 'env', priority: 3 }
]

// ❌ Bad - Mixed configuration
sources: [
  { type: 'file', path: 'config/everything.json' }
]
```

### 3. Secure Secrets

Never store secrets in configuration files:

```typescript
// ✅ Good - Secrets from secure sources
@ConfigProvider('database')
async provideDatabaseConfig() {
  const password = await this.secretsManager.getSecret('db-password');
  return {
    host: this.config.get('database.host'),
    password
  };
}

// ❌ Bad - Secrets in config files
{
  "database": {
    "password": "plaintext-password"  // Never do this!
  }
}
```

### 4. Use Defaults

Always provide sensible defaults:

```typescript
// ✅ Good - Defaults provided
@Config('server.timeout', 30000)
private timeout: number;

const value = config.get('optional.value', 'default');

// ❌ Bad - No defaults
@Config('server.timeout')  // May be undefined
private timeout: number;
```

### 5. Validate Early

Validate configuration at startup:

```typescript
// ✅ Good - Early validation
ConfigModule.forRoot({
  schema: AppSchema,
  validateOnStartup: true,  // Fail fast
  strict: true
})

// ❌ Bad - Runtime failures
ConfigModule.forRoot({
  validateOnStartup: false  // Errors discovered later
})
```

### 6. Use Typed Access

Prefer typed configuration access:

```typescript
// ✅ Good - Type-safe access
const serverConfig = config.getTyped(ServerSchema, 'server');

// ❌ Bad - Untyped access
const serverConfig = config.get('server') as any;
```

### 7. Handle Changes Gracefully

Implement proper change handling:

```typescript
// ✅ Good - Graceful change handling
@ConfigWatch('database.url')
async onDatabaseChange(newUrl: string) {
  await this.closeConnections();
  await this.reconnect(newUrl);
}

// ❌ Bad - No change handling
// Configuration changes may cause inconsistencies
```

### 8. Cache Appropriately

Use caching for frequently accessed values:

```typescript
// ✅ Good - Cached for performance
ConfigModule.forRoot({
  cache: {
    enabled: true,
    ttl: 60000  // 1 minute
  }
})

// Consider cache invalidation for dynamic values
```

### 9. Document Configuration

Document all configuration options:

```typescript
/**
 * Application Configuration Schema
 *
 * @property server.port - HTTP server port (1-65535)
 * @property server.host - Server hostname
 * @property database.url - PostgreSQL connection URL
 * @property redis.host - Redis server hostname
 */
const AppConfigSchema = z.object({
  server: z.object({
    port: z.number().describe('HTTP server port'),
    host: z.string().describe('Server hostname')
  }),
  // ... well-documented schema
});
```

### 10. Test Configuration

Test with different configurations:

```typescript
// ✅ Good - Test multiple configurations
describe.each([
  { env: 'development', port: 3000 },
  { env: 'production', port: 80 },
  { env: 'test', port: 0 }
])('Config for $env', ({ env, port }) => {
  // Test environment-specific behavior
});
```

## API Reference

### ConfigModule

```typescript
class ConfigModule {
  /**
   * Configure module with options
   */
  static forRoot(options?: IConfigModuleOptions): DynamicModule;

  /**
   * Configure module asynchronously
   */
  static forRootAsync(options: IConfigAsyncOptions): DynamicModule;

  /**
   * Configure feature-specific configuration
   */
  static forFeature(name: string, schema?: ZodType): DynamicModule;
}
```

### ConfigService

```typescript
class ConfigService {
  /**
   * Get configuration value by path
   */
  get<T = any>(path: string, defaultValue?: T): T;

  /**
   * Get all configuration
   */
  getAll(): Record<string, any>;

  /**
   * Check if path exists
   */
  has(path: string): boolean;

  /**
   * Set value at runtime
   */
  set(path: string, value: any): void;

  /**
   * Get typed configuration with validation
   */
  getTyped<T>(schema: ZodType<T>, path?: string): T;

  /**
   * Validate configuration
   */
  validate(schema?: ZodType): IConfigValidationResult;

  /**
   * Get configuration metadata
   */
  getMetadata(): IConfigMetadata;

  /**
   * Get environment name
   */
  get environment(): string;

  /**
   * Subscribe to configuration changes
   */
  onChange(listener: (event: IConfigChangeEvent) => void): () => void;

  /**
   * Reload configuration from sources
   */
  reload(): Promise<void>;

  /**
   * Initialize service (called automatically)
   */
  initialize(): Promise<void>;

  /**
   * Dispose service
   */
  dispose(): Promise<void>;
}
```

### Configuration Options

```typescript
interface IConfigModuleOptions {
  /**
   * Configuration sources
   */
  sources?: ConfigSource[];

  /**
   * Global validation schema
   */
  schema?: ZodType;

  /**
   * Environment name
   */
  environment?: string;

  /**
   * Validate on startup
   */
  validateOnStartup?: boolean;

  /**
   * Enable file watching
   */
  watchForChanges?: boolean;

  /**
   * Cache configuration
   */
  cache?: {
    enabled: boolean;
    ttl?: number;
  };

  /**
   * Strict mode
   */
  strict?: boolean;

  /**
   * Global prefix
   */
  prefix?: string;

  /**
   * Logger instance
   */
  logger?: any;

  /**
   * Register globally
   */
  global?: boolean;
}
```

### Configuration Sources

```typescript
type ConfigSource =
  | IFileConfigSource
  | IEnvironmentConfigSource
  | IArgvConfigSource
  | IObjectConfigSource
  | IRemoteConfigSource;

interface IFileConfigSource {
  type: 'file';
  path: string;
  format?: 'json' | 'yaml' | 'toml' | 'ini' | 'env';
  encoding?: BufferEncoding;
  optional?: boolean;
  priority?: number;
  transform?: (data: any) => any;
}

interface IEnvironmentConfigSource {
  type: 'env';
  prefix?: string;
  separator?: string;
  transform?: 'lowercase' | 'uppercase' | 'camelCase' | ((key: string, value: any) => any);
  optional?: boolean;
  priority?: number;
}

interface IArgvConfigSource {
  type: 'argv';
  prefix?: string;
  optional?: boolean;
  priority?: number;
}

interface IObjectConfigSource {
  type: 'object';
  data: Record<string, any>;
  optional?: boolean;
  priority?: number;
}

interface IRemoteConfigSource {
  type: 'remote';
  url: string;
  headers?: Record<string, string>;
  timeout?: number;
  retry?: number;
  optional?: boolean;
  priority?: number;
}
```

### Events and Metadata

```typescript
interface IConfigChangeEvent {
  path: string;
  oldValue: any;
  newValue: any;
  source: string;
  timestamp: Date;
}

interface IConfigMetadata {
  source: string;
  loadedAt: Date;
  environment: string;
  sources?: Array<{
    type: string;
    name?: string;
    loaded: boolean;
    error?: string;
  }>;
  validated?: boolean;
  cached?: boolean;
}

interface IConfigValidationResult {
  success: boolean;
  errors?: Array<{
    path: string;
    message: string;
    expected?: string;
    received?: string;
  }>;
  warnings?: Array<{
    path: string;
    message: string;
  }>;
}
```

## Examples

### Complete Application Example

```typescript
import { Application } from '@omnitron-dev/titan';
import { ConfigModule, ConfigService } from '@omnitron-dev/titan/module/config';
import { z } from 'zod';

// Define configuration schema
const AppConfigSchema = z.object({
  app: z.object({
    name: z.string(),
    version: z.string(),
    port: z.number().min(1).max(65535)
  }),
  database: z.object({
    host: z.string(),
    port: z.number(),
    name: z.string(),
    user: z.string().optional(),
    password: z.string().optional()
  }),
  redis: z.object({
    url: z.string().url()
  }),
  features: z.record(z.boolean())
});

// Application service
@Injectable()
class AppService {
  constructor(
    @Inject(ConfigService) private config: ConfigService
  ) {}

  @PostConstruct()
  async initialize() {
    const appName = this.config.get('app.name');
    const version = this.config.get('app.version');
    console.log(`Starting ${appName} v${version}`);

    // Watch for feature changes
    this.config.onChange((event) => {
      if (event.path.startsWith('features.')) {
        console.log('Feature toggle changed:', event.path, event.newValue);
      }
    });
  }

  @ConfigWatch('app.port')
  async onPortChange(newPort: number, oldPort: number) {
    console.log(`Port changed from ${oldPort} to ${newPort}, restarting server...`);
    await this.restartServer(newPort);
  }

  private async restartServer(port: number) {
    // Server restart logic
  }
}

// Create application
async function bootstrap() {
  const app = await Application.create({
    imports: [
      ConfigModule.forRoot({
        sources: [
          // Base configuration
          {
            type: 'object',
            data: {
              app: {
                name: 'MyApp',
                version: '1.0.0',
                port: 3000
              }
            },
            priority: 0
          },

          // File configuration
          {
            type: 'file',
            path: 'config/app.yaml',
            format: 'yaml',
            optional: false,
            priority: 1
          },

          // Environment overrides
          {
            type: 'env',
            prefix: 'APP_',
            separator: '__',
            transform: 'camelCase',
            priority: 2
          },

          // Command line overrides
          {
            type: 'argv',
            prefix: '--',
            priority: 3
          }
        ],

        schema: AppConfigSchema,
        validateOnStartup: true,
        watchForChanges: process.env.NODE_ENV !== 'production',

        cache: {
          enabled: true,
          ttl: 60000
        },

        global: true
      })
    ],
    providers: [AppService]
  });

  await app.start();

  const config = app.get(ConfigService);
  const port = config.get<number>('app.port');

  console.log(`Application running on port ${port}`);
}

bootstrap().catch(console.error);
```

### Microservice Configuration

```typescript
// Microservice with dynamic configuration
@Module({
  imports: [
    ConfigModule.forRootAsync({
      useFactory: async (consul: ConsulService) => {
        // Load service configuration from Consul
        const serviceConfig = await consul.getConfig('services/user-service');

        return {
          sources: [
            // Service defaults
            {
              type: 'file',
              path: 'config/defaults.json',
              priority: 1
            },

            // Consul configuration
            {
              type: 'object',
              data: serviceConfig,
              priority: 2
            },

            // Environment overrides
            {
              type: 'env',
              prefix: 'SERVICE_',
              priority: 3
            }
          ],

          watchForChanges: true,
          validateOnStartup: true
        };
      },
      inject: [ConsulService]
    })
  ],
  providers: [UserService]
})
class UserServiceModule {}
```

### Feature Flags

```typescript
// Feature flag service with hot reload
@Injectable()
class FeatureService {
  private features = new Map<string, boolean>();

  constructor(
    @Inject(ConfigService) private config: ConfigService
  ) {}

  @PostConstruct()
  async initialize() {
    // Load initial features
    this.loadFeatures();

    // Watch for changes
    this.config.onChange((event) => {
      if (event.path.startsWith('features.')) {
        this.loadFeatures();
      }
    });
  }

  private loadFeatures() {
    const features = this.config.get<Record<string, boolean>>('features', {});

    this.features.clear();
    for (const [key, enabled] of Object.entries(features)) {
      this.features.set(key, enabled);
      console.log(`Feature '${key}': ${enabled ? 'enabled' : 'disabled'}`);
    }
  }

  isEnabled(feature: string): boolean {
    return this.features.get(feature) ?? false;
  }

  @ConfigWatch('features')
  onFeaturesChange(newFeatures: Record<string, boolean>) {
    // Emit events for feature changes
    for (const [feature, enabled] of Object.entries(newFeatures)) {
      const wasEnabled = this.features.get(feature);

      if (wasEnabled !== enabled) {
        this.eventBus.emit('feature.toggled', { feature, enabled });
      }
    }
  }
}
```

### Multi-Tenant Configuration

```typescript
// Multi-tenant configuration service
@Injectable()
class TenantConfigService {
  private tenantConfigs = new Map<string, any>();

  constructor(
    @Inject(ConfigService) private globalConfig: ConfigService
  ) {}

  async loadTenantConfig(tenantId: string): Promise<void> {
    // Load tenant-specific configuration
    const tenantConfig = await this.fetchTenantConfig(tenantId);

    // Merge with global defaults
    const defaults = this.globalConfig.get('tenant.defaults', {});
    const merged = { ...defaults, ...tenantConfig };

    this.tenantConfigs.set(tenantId, merged);
  }

  getTenantConfig<T = any>(tenantId: string, path: string, defaultValue?: T): T {
    const config = this.tenantConfigs.get(tenantId);

    if (!config) {
      throw new Error(`Configuration not loaded for tenant: ${tenantId}`);
    }

    return this.getByPath(config, path) ?? defaultValue;
  }

  private async fetchTenantConfig(tenantId: string) {
    // Fetch from database, API, or file
    return {};
  }

  private getByPath(obj: any, path: string): any {
    return path.split('.').reduce((curr, key) => curr?.[key], obj);
  }
}
```

## Internal Services

### ConfigLoaderService

Handles loading configuration from various sources:

```typescript
class ConfigLoaderService {
  /**
   * Load configuration from multiple sources
   * Sources are sorted by priority (lower first)
   */
  async load(sources: ConfigSource[] | ConfigSource): Promise<Record<string, any>>;

  /**
   * Load configuration from a single source
   */
  async loadSource(source: ConfigSource): Promise<Record<string, any>>;
}
```

**Supported Operations:**
- File format auto-detection based on extension
- Automatic value parsing (numbers, booleans, JSON)
- Deep merging of configuration objects
- Transform functions for data processing
- Error handling for optional vs required sources

### ConfigValidatorService

Provides schema validation using Zod:

```typescript
class ConfigValidatorService {
  /**
   * Validate entire configuration
   */
  validate(config: Record<string, any>, schema?: ZodType): IConfigValidationResult;

  /**
   * Validate specific path
   */
  validatePath(path: string, value: any, schema?: ZodType): IConfigValidationResult;
}
```

### ConfigWatcherService

Monitors configuration files for changes:

```typescript
class ConfigWatcherService {
  /**
   * Watch configuration sources for changes
   * Only watches file sources
   */
  watch(sources: ConfigSource[], onChange: (event: IConfigChangeEvent) => void): void;

  /**
   * Stop watching all files
   */
  unwatch(): void;
}
```

## Dependency Injection Tokens

### Available Tokens

The module exports the following DI tokens for advanced usage:

```typescript
import {
  CONFIG_SERVICE_TOKEN,
  CONFIG_LOADER_SERVICE_TOKEN,
  CONFIG_VALIDATOR_SERVICE_TOKEN,
  CONFIG_WATCHER_SERVICE_TOKEN,
  CONFIG_OPTIONS_TOKEN,
  CONFIG_SCHEMA_TOKEN,
  CONFIG_LOGGER_TOKEN
} from '@omnitron-dev/titan/module/config';

// Usage in providers
@Injectable()
class CustomConfigService {
  constructor(
    @Inject(CONFIG_SERVICE_TOKEN) private config: ConfigService,
    @Inject(CONFIG_LOADER_SERVICE_TOKEN) private loader: ConfigLoaderService,
    @Inject(CONFIG_VALIDATOR_SERVICE_TOKEN) private validator: ConfigValidatorService,
    @Optional() @Inject(CONFIG_WATCHER_SERVICE_TOKEN) private watcher?: ConfigWatcherService,
    @Optional() @Inject(CONFIG_SCHEMA_TOKEN) private schema?: ZodType,
    @Optional() @Inject(CONFIG_LOGGER_TOKEN) private logger?: any
  ) {}
}
```

### Token Descriptions

- **CONFIG_SERVICE_TOKEN**: Main configuration service instance
- **CONFIG_LOADER_SERVICE_TOKEN**: Service for loading configuration from sources
- **CONFIG_VALIDATOR_SERVICE_TOKEN**: Service for validating configuration with schemas
- **CONFIG_WATCHER_SERVICE_TOKEN**: Service for watching file changes (optional)
- **CONFIG_OPTIONS_TOKEN**: Module configuration options
- **CONFIG_SCHEMA_TOKEN**: Global validation schema (optional)
- **CONFIG_LOGGER_TOKEN**: Logger instance for debugging (optional)

## Deep Merge Strategy

### Merge Algorithm

Configuration sources are merged using a deep merge strategy:

1. **Sources are sorted by priority** (lower values first)
2. **Later sources override earlier ones**
3. **Objects are merged recursively**
4. **Arrays are replaced entirely** (not concatenated)
5. **Primitive values are overwritten**

```typescript
// Example merge behavior
const source1 = {
  server: {
    port: 3000,
    host: 'localhost',
    ssl: {
      enabled: false
    }
  },
  features: ['auth', 'api']
};

const source2 = {
  server: {
    port: 8080,  // Overrides
    ssl: {
      enabled: true,  // Overrides
      cert: 'cert.pem'  // Adds new property
    }
  },
  features: ['dashboard'],  // Replaces entire array
  database: {  // Adds new section
    host: 'localhost'
  }
};

// Result after merge:
{
  server: {
    port: 8080,
    host: 'localhost',  // Preserved
    ssl: {
      enabled: true,
      cert: 'cert.pem'
    }
  },
  features: ['dashboard'],  // Array replaced
  database: {
    host: 'localhost'
  }
}
```

## File Format Details

### Properties File Format

Java-style properties files with enhanced parsing:

```properties
# Comments with # or !
! This is also a comment

# Basic syntax
key=value
key:value

# Spaces are trimmed
key = value with spaces

# Line continuation
longValue = This is a very \
           long value that \
           spans multiple lines

# Special characters
path=/usr/local/bin
regex=^[a-z]+$
url=https\://example.com

# Nested properties (dots create objects)
server.host=localhost
server.port=8080
server.ssl.enabled=true
```

### ENV File Format

Dotenv format with automatic value parsing:

```env
# .env file
NODE_ENV=production
PORT=3000
DEBUG=false

# Quoted values
DATABASE_URL="postgres://localhost:5432/mydb"
API_KEY='secret-key-123'

# JSON values
CACHE_CONFIG={"ttl":3600,"max":1000}
ALLOWED_ORIGINS=["http://localhost:3000","https://example.com"]

# Multiline values (in quotes)
CERTIFICATE="-----BEGIN CERTIFICATE-----
MIIBkTCB+wIJAKHHIG...
-----END CERTIFICATE-----"
```

## Error Handling

### Source Loading Errors

```typescript
// Required source fails
{
  type: 'file',
  path: 'config/required.json',
  optional: false  // Will throw if file doesn't exist
}

// Optional source fails
{
  type: 'file',
  path: 'config/optional.json',
  optional: true  // Will be skipped if file doesn't exist
}
```

### Validation Errors

Validation errors include detailed information:

```typescript
interface IConfigValidationResult {
  success: boolean;
  errors?: Array<{
    path: string;      // 'server.port'
    message: string;   // 'Expected number, received string'
    expected?: string; // 'number'
    received?: string; // 'string'
  }>;
  warnings?: Array<{
    path: string;
    message: string;
  }>;
}
```

### Runtime Errors

```typescript
try {
  const config = configService.getTyped(ServerSchema, 'server');
} catch (error) {
  // Validation failed - handle error
  console.error('Invalid server configuration:', error.message);
}

// Safe access with defaults
const port = configService.get('server.port', 3000);  // Won't throw
```

## Performance Considerations

### Caching Strategy

- **Cache hit/miss tracking**: Monitor cache effectiveness
- **TTL configuration**: Balance freshness vs performance
- **Selective caching**: Only cache frequently accessed paths
- **Cache invalidation**: Automatic on `set()` and `reload()`

### Optimization Tips

1. **Use caching for frequently accessed values**
```typescript
cache: {
  enabled: true,
  ttl: 60000  // 1 minute cache
}
```

2. **Batch configuration access**
```typescript
// Good - single access
const serverConfig = config.get('server');
const { port, host, ssl } = serverConfig;

// Bad - multiple accesses
const port = config.get('server.port');
const host = config.get('server.host');
const ssl = config.get('server.ssl');
```

3. **Use typed access for validation once**
```typescript
// Validate once at startup
const validatedConfig = config.getTyped(AppSchema);
// Use validated config throughout
```

4. **Minimize file watches in production**
```typescript
watchForChanges: process.env.NODE_ENV !== 'production'
```

## Summary

The Titan Configuration Module provides a comprehensive, flexible, and type-safe configuration management solution. Its key strengths include:

- **Multi-source Loading**: Combine configuration from files, environment, CLI, and remote sources
- **Type Safety**: Full TypeScript and Zod schema validation support
- **Hot Reload**: Automatic reloading with file watching
- **DI Integration**: Seamless integration with Titan's dependency injection
- **Performance**: Built-in caching and optimization
- **Flexibility**: Extensible with custom loaders, validators, and transformations

Use the Configuration Module to build robust, configurable applications that can adapt to different environments and requirements without code changes.