# Titan Configuration Module Documentation

## Overview

The Titan Configuration Module provides a comprehensive, type-safe configuration management system for your applications. It supports multiple configuration sources, validation, hot-reload, caching, and dependency injection integration.

## Key Features

- 📁 **Multiple Configuration Sources**: Files (JSON, YAML, ENV), environment variables, command-line arguments, objects, and remote sources
- ✅ **Schema Validation**: Built-in validation with Zod schemas
- 🔄 **Hot Reload**: Automatic configuration reload on file changes
- 💾 **Caching**: Configurable caching for improved performance
- 🎯 **Type Safety**: Full TypeScript support with decorators
- 💉 **Dependency Injection**: Seamless integration with Titan's DI container
- 🔍 **Configuration Watch**: React to configuration changes in real-time
- 🌍 **Environment-based Loading**: Automatic environment-specific configuration
- 🎭 **Transformation & Validation**: Transform and validate values on the fly

## Table of Contents

1. [Installation & Basic Setup](#installation--basic-setup)
2. [Configuration Sources](#configuration-sources)
3. [Schema Validation](#schema-validation)
4. [Decorators](#decorators)
5. [Advanced Usage](#advanced-usage)
6. [API Reference](#api-reference)
7. [Examples](#examples)
8. [Best Practices](#best-practices)

## Installation & Basic Setup

### Basic Module Registration

```typescript
import { Application } from '@omnitron-dev/titan';
import { ConfigModule } from '@omnitron-dev/titan/modules/config';

// Simple setup with default options
const app = await Application.create({
  imports: [
    ConfigModule.forRoot({
      sources: [
        { type: 'file', path: './config/default.json' },
        { type: 'env', prefix: 'APP_' }
      ]
    })
  ]
});
```

### Global Configuration Module

```typescript
// Make configuration available globally
ConfigModule.forRoot({
  global: true, // Available to all modules
  sources: [
    { type: 'file', path: './config/default.json' },
    { type: 'env', prefix: 'APP_' }
  ]
})
```

## Configuration Sources

### 1. File Sources

The module supports multiple file formats:

```typescript
ConfigModule.forRoot({
  sources: [
    // JSON configuration
    {
      type: 'file',
      path: './config/default.json',
      format: 'json'
    },

    // YAML configuration
    {
      type: 'file',
      path: './config/settings.yaml',
      format: 'yaml'
    },

    // .env file
    {
      type: 'file',
      path: '.env',
      format: 'env'
    },

    // Environment-specific config (auto-detected format)
    {
      type: 'file',
      path: `./config/${process.env.NODE_ENV}.json`,
      optional: true // Won't fail if file doesn't exist
    }
  ]
})
```

### 2. Environment Variables

Load configuration from environment variables with flexible naming conventions:

```typescript
ConfigModule.forRoot({
  sources: [
    {
      type: 'env',
      prefix: 'APP_',           // Only load vars starting with APP_
      separator: '__',          // Use __ for nested paths (APP__DB__HOST → db.host)
      transform: 'camelCase'    // Transform keys to camelCase
    }
  ]
})
```

Example environment variables:
```bash
APP__DATABASE__HOST=localhost
APP__DATABASE__PORT=5432
APP__REDIS__URL=redis://localhost:6379
APP__DEBUG=true
```

Results in configuration:
```javascript
{
  database: {
    host: 'localhost',
    port: 5432  // Automatically parsed as number
  },
  redis: {
    url: 'redis://localhost:6379'
  },
  debug: true  // Automatically parsed as boolean
}
```

### 3. Command-Line Arguments

Parse command-line arguments as configuration:

```typescript
ConfigModule.forRoot({
  sources: [
    {
      type: 'argv',
      prefix: '--'  // Parse args starting with --
    }
  ]
})
```

Example usage:
```bash
node app.js --port=3000 --database.host=localhost --debug
```

### 4. Object Sources

Provide configuration directly as objects:

```typescript
ConfigModule.forRoot({
  sources: [
    {
      type: 'object',
      data: {
        app: {
          name: 'My Application',
          version: '1.0.0'
        },
        features: {
          analytics: true,
          notifications: false
        }
      }
    }
  ]
})
```

### 5. Remote Sources

Load configuration from remote endpoints:

```typescript
ConfigModule.forRoot({
  sources: [
    {
      type: 'remote',
      url: 'https://config.example.com/api/config',
      headers: {
        'Authorization': `Bearer ${process.env.CONFIG_TOKEN}`
      },
      timeout: 5000,
      retry: 3,
      optional: true
    }
  ]
})
```

### Source Priority

Sources are loaded in the order specified, with later sources overriding earlier ones:

```typescript
ConfigModule.forRoot({
  sources: [
    // 1. Default configuration (lowest priority)
    { type: 'file', path: './config/default.json' },

    // 2. Environment-specific config
    { type: 'file', path: `./config/${process.env.NODE_ENV}.json`, optional: true },

    // 3. Local overrides
    { type: 'file', path: './config/local.json', optional: true },

    // 4. Environment variables
    { type: 'env', prefix: 'APP_' },

    // 5. Command-line arguments (highest priority)
    { type: 'argv', prefix: '--' }
  ]
})
```

## Schema Validation

### Using Zod Schemas

Define and validate your configuration with Zod schemas:

```typescript
import { z } from 'zod';

const ConfigSchema = z.object({
  app: z.object({
    name: z.string(),
    port: z.number().min(1).max(65535),
    host: z.string().default('localhost'),
    debug: z.boolean().default(false)
  }),
  database: z.object({
    host: z.string(),
    port: z.number().default(5432),
    database: z.string(),
    user: z.string(),
    password: z.string()
  }),
  redis: z.object({
    url: z.string().url()
  }).optional(),
  features: z.object({
    rateLimit: z.boolean().default(true),
    caching: z.boolean().default(true)
  })
});

// Apply schema validation
ConfigModule.forRoot({
  schema: ConfigSchema,
  validateOnStartup: true,  // Validate on application start
  strict: true,              // Throw on validation errors
  sources: [
    { type: 'file', path: './config/app.json' },
    { type: 'env', prefix: 'APP_' }
  ]
})
```

### Feature-Specific Schemas

Validate configuration for specific features:

```typescript
const DatabaseSchema = z.object({
  host: z.string(),
  port: z.number(),
  database: z.string(),
  pool: z.object({
    min: z.number().default(2),
    max: z.number().default(10)
  }).optional()
});

// In your module
@Module({
  imports: [
    ConfigModule.forFeature('database', DatabaseSchema)
  ]
})
class DatabaseModule {
  constructor(
    @Inject('Config:database') private dbConfig: z.infer<typeof DatabaseSchema>
  ) {
    // dbConfig is fully typed and validated
  }
}
```

## Decorators

### @Config - Property/Parameter Injection

Inject configuration values into class properties or constructor parameters:

```typescript
import { Injectable } from '@omnitron-dev/titan';
import { Config } from '@omnitron-dev/titan/modules/config';

@Injectable()
class EmailService {
  // Property injection with path
  @Config('email.smtp.host')
  private smtpHost: string;

  // Property injection with default value
  @Config('email.smtp.port', 587)
  private smtpPort: number;

  // Constructor parameter injection
  constructor(
    @Config('email.from') private fromAddress: string,
    @Config('email.replyTo', 'noreply@example.com') private replyTo: string
  ) {}

  sendEmail(to: string, subject: string, body: string) {
    console.log(`Sending email from ${this.fromAddress} to ${to}`);
    console.log(`SMTP: ${this.smtpHost}:${this.smtpPort}`);
  }
}
```

### @InjectConfig - Full Service Injection

Inject the entire ConfigService for dynamic access:

```typescript
import { Injectable } from '@omnitron-dev/titan';
import { InjectConfig, ConfigService } from '@omnitron-dev/titan/modules/config';

@Injectable()
class DynamicService {
  constructor(
    @InjectConfig() private config: ConfigService
  ) {}

  async processRequest(feature: string) {
    // Dynamic configuration access
    const isEnabled = this.config.get(`features.${feature}.enabled`, false);

    if (isEnabled) {
      const settings = this.config.get(`features.${feature}.settings`);
      // Process with feature settings
    }

    // Get typed configuration
    const appConfig = this.config.getTyped(AppConfigSchema);
  }
}
```

### @ConfigSchema - Class Validation

Define configuration schemas for classes:

```typescript
import { z } from 'zod';
import { ConfigSchema } from '@omnitron-dev/titan/modules/config';

const ServerConfigSchema = z.object({
  port: z.number(),
  host: z.string(),
  ssl: z.object({
    enabled: z.boolean(),
    cert: z.string().optional(),
    key: z.string().optional()
  }).optional()
});

@ConfigSchema(ServerConfigSchema)
class ServerConfig {
  port: number;
  host: string;
  ssl?: {
    enabled: boolean;
    cert?: string;
    key?: string;
  };

  // Automatically added by decorator
  validate() {
    return ServerConfigSchema.safeParse(this);
  }
}
```

### @Configuration - Configuration Classes

Mark a class as a configuration provider:

```typescript
import { Configuration, ConfigDefaults } from '@omnitron-dev/titan/modules/config';

@Configuration('database')
@ConfigDefaults({
  host: 'localhost',
  port: 5432,
  pool: {
    min: 2,
    max: 10
  }
})
class DatabaseConfiguration {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  pool?: {
    min: number;
    max: number;
  };
}

// Automatically registered and available for injection
@Injectable()
class DatabaseService {
  constructor(
    @Inject('DatabaseConfigurationConfig') private config: DatabaseConfiguration
  ) {}
}
```

### @ConfigWatch - React to Changes

Watch for configuration changes:

```typescript
import { Injectable } from '@omnitron-dev/titan';
import { ConfigWatch } from '@omnitron-dev/titan/modules/config';

@Injectable()
class CacheService {
  private cache = new Map();

  @ConfigWatch('cache.ttl')
  onCacheTTLChange(newValue: number, oldValue: number) {
    console.log(`Cache TTL changed from ${oldValue}ms to ${newValue}ms`);
    this.clearCache();
    this.reconfigureCache(newValue);
  }

  @ConfigWatch('cache.enabled')
  onCacheToggle(enabled: boolean) {
    if (!enabled) {
      this.clearCache();
    }
  }

  private clearCache() {
    this.cache.clear();
  }

  private reconfigureCache(ttl: number) {
    // Reconfigure cache with new TTL
  }
}
```

### @ConfigValidate - Property Validation

Validate configuration values:

```typescript
import { z } from 'zod';
import { ConfigValidate, Config } from '@omnitron-dev/titan/modules/config';

@Injectable()
class ServerService {
  @ConfigValidate(z.number().min(1).max(65535))
  @Config('server.port')
  private port: number;

  @ConfigValidate(z.string().url())
  @Config('server.publicUrl')
  private publicUrl: string;

  @ConfigValidate(z.string().email())
  @Config('admin.email')
  private adminEmail: string;
}
```

### @ConfigTransform - Value Transformation

Transform configuration values:

```typescript
import { ConfigTransform, Config } from '@omnitron-dev/titan/modules/config';

@Injectable()
class AppService {
  // Transform to uppercase
  @ConfigTransform((value) => value.toUpperCase())
  @Config('app.environment')
  private environment: string;

  // Parse JSON string
  @ConfigTransform((value) => JSON.parse(value))
  @Config('app.features')
  private features: Record<string, boolean>;

  // Convert to array
  @ConfigTransform((value) => value.split(',').map(s => s.trim()))
  @Config('app.allowedOrigins')
  private allowedOrigins: string[];
}
```

## Advanced Usage

### Hot Reload Configuration

Enable hot reload to automatically update configuration when files change:

```typescript
ConfigModule.forRoot({
  watchForChanges: true,  // Enable file watching
  sources: [
    { type: 'file', path: './config/app.json' }
  ]
})

// Listen to changes in your service
@Injectable()
class ConfigurableService {
  constructor(@InjectConfig() private config: ConfigService) {
    // Subscribe to configuration changes
    const unsubscribe = config.onChange((event) => {
      console.log(`Config changed at ${event.path}:`, {
        old: event.oldValue,
        new: event.newValue,
        source: event.source,
        timestamp: event.timestamp
      });

      // React to specific changes
      if (event.path.startsWith('database.')) {
        this.reconnectDatabase();
      }
    });

    // Clean up subscription when needed
    // unsubscribe();
  }
}
```

### Caching Configuration

Enable caching for improved performance:

```typescript
ConfigModule.forRoot({
  cache: {
    enabled: true,
    ttl: 60000  // Cache for 60 seconds
  },
  sources: [
    { type: 'file', path: './config/app.json' }
  ]
})
```

### Async Configuration

Load configuration asynchronously with factory functions:

```typescript
ConfigModule.forRootAsync({
  useFactory: async (secretsService: SecretsService) => {
    const dbPassword = await secretsService.getSecret('DB_PASSWORD');

    return {
      sources: [
        { type: 'file', path: './config/default.json' },
        {
          type: 'object',
          data: {
            database: {
              password: dbPassword
            }
          }
        }
      ],
      validateOnStartup: true
    };
  },
  inject: [SecretsService],
  global: true
})
```

### Multiple Environments

Handle multiple environments with ease:

```typescript
const environment = process.env.NODE_ENV || 'development';

ConfigModule.forRoot({
  environment,
  sources: [
    // Base configuration
    { type: 'file', path: './config/base.json' },

    // Environment-specific configuration
    {
      type: 'file',
      path: `./config/${environment}.json`,
      optional: environment === 'development'  // Optional in dev
    },

    // Local overrides (git-ignored)
    {
      type: 'file',
      path: './config/local.json',
      optional: true
    },

    // Environment variables override
    { type: 'env', prefix: `${environment.toUpperCase()}_` },

    // Production-only remote config
    ...(environment === 'production' ? [{
      type: 'remote' as const,
      url: 'https://config.example.com/production',
      headers: { 'X-API-Key': process.env.CONFIG_API_KEY! }
    }] : [])
  ]
})
```

### Custom Configuration Providers

Create custom configuration providers:

```typescript
import { ConfigProvider } from '@omnitron-dev/titan/modules/config';

class VaultConfigProvider {
  @ConfigProvider('secrets')
  async provideSecrets(): Promise<Record<string, any>> {
    // Fetch from HashiCorp Vault or AWS Secrets Manager
    const secrets = await this.vault.getSecrets('/app/secrets');
    return {
      database: {
        password: secrets.dbPassword
      },
      api: {
        key: secrets.apiKey
      }
    };
  }

  @ConfigProvider('features')
  async provideFeatureFlags(): Promise<Record<string, boolean>> {
    // Fetch from feature flag service
    const flags = await this.featureService.getFlags();
    return flags;
  }
}
```

### Configuration Composition

Compose configuration from multiple modules:

```typescript
// Database configuration module
const DatabaseConfigModule = ConfigModule.forFeature('database', DatabaseSchema);

// Redis configuration module
const RedisConfigModule = ConfigModule.forFeature('redis', RedisSchema);

// Email configuration module
const EmailConfigModule = ConfigModule.forFeature('email', EmailSchema);

// Main application module
@Module({
  imports: [
    ConfigModule.forRoot({
      global: true,
      sources: [/* ... */]
    }),
    DatabaseConfigModule,
    RedisConfigModule,
    EmailConfigModule
  ]
})
class AppModule {}
```

## Examples

### Example 1: Microservice Configuration

```typescript
import { Application, Module, Injectable } from '@omnitron-dev/titan';
import { ConfigModule, Config, InjectConfig } from '@omnitron-dev/titan/modules/config';
import { z } from 'zod';

// Define configuration schema
const MicroserviceConfigSchema = z.object({
  service: z.object({
    name: z.string(),
    version: z.string(),
    port: z.number(),
    host: z.string().default('0.0.0.0')
  }),
  database: z.object({
    url: z.string().url(),
    pool: z.object({
      min: z.number().default(2),
      max: z.number().default(10),
      idle: z.number().default(10000)
    })
  }),
  cache: z.object({
    redis: z.object({
      url: z.string().url(),
      ttl: z.number().default(300)
    })
  }),
  logging: z.object({
    level: z.enum(['trace', 'debug', 'info', 'warn', 'error']),
    pretty: z.boolean().default(false)
  }),
  metrics: z.object({
    enabled: z.boolean().default(true),
    port: z.number().default(9090)
  })
});

type MicroserviceConfig = z.infer<typeof MicroserviceConfigSchema>;

// Service implementation
@Injectable()
class HealthService {
  @Config('service.name')
  private serviceName: string;

  @Config('service.version')
  private version: string;

  getStatus() {
    return {
      service: this.serviceName,
      version: this.version,
      status: 'healthy',
      timestamp: new Date().toISOString()
    };
  }
}

// Application module
@Module({
  imports: [
    ConfigModule.forRoot({
      schema: MicroserviceConfigSchema,
      validateOnStartup: true,
      watchForChanges: process.env.NODE_ENV === 'development',
      sources: [
        // Default configuration
        {
          type: 'object',
          data: {
            service: {
              name: 'user-service',
              version: '1.0.0',
              port: 3000
            },
            logging: {
              level: 'info',
              pretty: false
            }
          }
        },
        // Configuration file
        { type: 'file', path: './config/service.json', optional: true },
        // Environment variables
        { type: 'env', prefix: 'SERVICE_' },
        // Command line arguments
        { type: 'argv', prefix: '--' }
      ],
      cache: {
        enabled: true,
        ttl: 30000
      }
    })
  ],
  providers: [HealthService]
})
class ServiceModule {}

// Create and start application
async function bootstrap() {
  const app = await Application.create(ServiceModule);

  // Access configuration
  const config = app.get(ConfigModule);
  const serviceConfig = config.get<MicroserviceConfig['service']>('service');

  console.log(`Starting ${serviceConfig.name} v${serviceConfig.version}`);
  console.log(`Listening on ${serviceConfig.host}:${serviceConfig.port}`);

  await app.start();
}

bootstrap().catch(console.error);
```

### Example 2: Multi-Tenant Configuration

```typescript
import { ConfigModule, ConfigService, InjectConfig } from '@omnitron-dev/titan/modules/config';

interface TenantConfig {
  id: string;
  name: string;
  database: {
    host: string;
    database: string;
  };
  features: {
    [key: string]: boolean;
  };
  limits: {
    maxUsers: number;
    maxStorage: number; // in GB
  };
}

@Injectable()
class TenantConfigService {
  private tenantConfigs = new Map<string, TenantConfig>();

  constructor(@InjectConfig() private config: ConfigService) {
    this.loadTenantConfigs();
  }

  private loadTenantConfigs() {
    const tenants = this.config.get<TenantConfig[]>('tenants', []);

    for (const tenant of tenants) {
      this.tenantConfigs.set(tenant.id, tenant);
    }
  }

  getTenantConfig(tenantId: string): TenantConfig | undefined {
    return this.tenantConfigs.get(tenantId);
  }

  isFeatureEnabled(tenantId: string, feature: string): boolean {
    const tenant = this.getTenantConfig(tenantId);
    return tenant?.features[feature] ?? false;
  }

  getTenantDatabase(tenantId: string) {
    const tenant = this.getTenantConfig(tenantId);
    if (!tenant) {
      throw new Error(`Tenant ${tenantId} not found`);
    }

    return {
      host: tenant.database.host,
      database: tenant.database.database,
      // Use shared credentials from main config
      user: this.config.get('database.user'),
      password: this.config.get('database.password')
    };
  }
}

// Usage in a service
@Injectable()
class UserService {
  constructor(
    private tenantConfig: TenantConfigService,
    @InjectConfig() private config: ConfigService
  ) {}

  async createUser(tenantId: string, userData: any) {
    const tenant = this.tenantConfig.getTenantConfig(tenantId);

    if (!tenant) {
      throw new Error('Invalid tenant');
    }

    // Check tenant limits
    const currentUsers = await this.getUserCount(tenantId);
    if (currentUsers >= tenant.limits.maxUsers) {
      throw new Error('User limit reached for tenant');
    }

    // Check if email verification is enabled for this tenant
    if (this.tenantConfig.isFeatureEnabled(tenantId, 'emailVerification')) {
      await this.sendVerificationEmail(userData.email);
    }

    // Create user with tenant-specific database
    const db = this.tenantConfig.getTenantDatabase(tenantId);
    // ... create user in database
  }
}
```

### Example 3: Dynamic Feature Flags

```typescript
import { ConfigModule, ConfigService, ConfigWatch } from '@omnitron-dev/titan/modules/config';

@Injectable()
class FeatureFlagService {
  private features = new Map<string, boolean>();
  private experiments = new Map<string, ExperimentConfig>();

  constructor(@InjectConfig() private config: ConfigService) {
    this.loadFeatures();
    this.loadExperiments();
  }

  private loadFeatures() {
    const features = this.config.get<Record<string, boolean>>('features', {});
    for (const [key, enabled] of Object.entries(features)) {
      this.features.set(key, enabled);
    }
  }

  private loadExperiments() {
    const experiments = this.config.get<ExperimentConfig[]>('experiments', []);
    for (const exp of experiments) {
      this.experiments.set(exp.id, exp);
    }
  }

  @ConfigWatch('features')
  onFeaturesChange(newFeatures: Record<string, boolean>) {
    console.log('Features updated:', newFeatures);
    this.loadFeatures();
    this.emit('features:changed', newFeatures);
  }

  @ConfigWatch('experiments')
  onExperimentsChange(newExperiments: ExperimentConfig[]) {
    console.log('Experiments updated');
    this.loadExperiments();
  }

  isEnabled(feature: string, context?: FeatureContext): boolean {
    // Check if feature is globally enabled
    const globalEnabled = this.features.get(feature) ?? false;

    if (!globalEnabled) {
      return false;
    }

    // Check if user is in an experiment
    if (context?.userId) {
      const experiment = this.experiments.get(feature);
      if (experiment) {
        return this.isUserInExperiment(context.userId, experiment);
      }
    }

    return globalEnabled;
  }

  private isUserInExperiment(userId: string, experiment: ExperimentConfig): boolean {
    // Simple percentage-based rollout
    const hash = this.hashUserId(userId);
    const percentage = (hash % 100) / 100;
    return percentage < experiment.rolloutPercentage;
  }

  private hashUserId(userId: string): number {
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
      hash = ((hash << 5) - hash) + userId.charCodeAt(i);
      hash = hash & hash;
    }
    return Math.abs(hash);
  }
}

interface ExperimentConfig {
  id: string;
  name: string;
  rolloutPercentage: number;
  targetGroups?: string[];
}

interface FeatureContext {
  userId?: string;
  group?: string;
  properties?: Record<string, any>;
}

// Usage
@Injectable()
class PaymentService {
  constructor(private features: FeatureFlagService) {}

  async processPayment(userId: string, amount: number) {
    const context: FeatureContext = { userId };

    if (this.features.isEnabled('newPaymentFlow', context)) {
      return this.processPaymentV2(amount);
    } else {
      return this.processPaymentV1(amount);
    }
  }

  private async processPaymentV1(amount: number) {
    // Legacy payment processing
  }

  private async processPaymentV2(amount: number) {
    // New payment processing with improved features
  }
}
```

### Example 4: Configuration with Secrets Management

```typescript
import { ConfigModule } from '@omnitron-dev/titan/modules/config';
import { SecretsManager } from '@aws-sdk/client-secrets-manager';

// Custom secrets loader
class AWSSecretsLoader {
  private client: SecretsManager;

  constructor() {
    this.client = new SecretsManager({ region: process.env.AWS_REGION });
  }

  async loadSecrets(secretId: string): Promise<Record<string, any>> {
    try {
      const response = await this.client.getSecretValue({
        SecretId: secretId
      });

      if (response.SecretString) {
        return JSON.parse(response.SecretString);
      }

      return {};
    } catch (error) {
      console.error('Failed to load secrets:', error);
      throw error;
    }
  }
}

// Application setup
async function bootstrap() {
  const secretsLoader = new AWSSecretsLoader();
  const secrets = await secretsLoader.loadSecrets('prod/app/secrets');

  const app = await Application.create({
    imports: [
      ConfigModule.forRoot({
        sources: [
          // Public configuration
          { type: 'file', path: './config/app.json' },

          // Secrets from AWS
          {
            type: 'object',
            data: {
              database: {
                password: secrets.dbPassword
              },
              api: {
                keys: {
                  stripe: secrets.stripeKey,
                  sendgrid: secrets.sendgridKey
                }
              }
            }
          },

          // Environment overrides
          { type: 'env', prefix: 'APP_' }
        ],
        validateOnStartup: true
      })
    ]
  });

  await app.start();
}
```

## Best Practices

### 1. Environment-Specific Configuration

Always separate environment-specific configuration:

```typescript
// config/default.json - Shared defaults
{
  "app": {
    "name": "MyApp",
    "version": "1.0.0"
  },
  "logging": {
    "level": "info"
  }
}

// config/development.json - Development overrides
{
  "logging": {
    "level": "debug",
    "pretty": true
  },
  "database": {
    "host": "localhost"
  }
}

// config/production.json - Production settings
{
  "logging": {
    "pretty": false
  },
  "database": {
    "host": "prod-db.example.com",
    "ssl": true
  }
}
```

### 2. Validation First

Always validate configuration on startup:

```typescript
ConfigModule.forRoot({
  schema: AppConfigSchema,
  validateOnStartup: true,
  strict: true  // Fail fast on invalid config
})
```

### 3. Secret Management

Never store secrets in configuration files:

```typescript
// ❌ Bad: Secrets in config file
{
  "database": {
    "password": "hardcoded-password"
  }
}

// ✅ Good: Reference secrets from environment
{
  "database": {
    "password": "${DB_PASSWORD}"
  }
}

// Or load from secret management service
const secrets = await secretManager.getSecrets();
ConfigModule.forRoot({
  sources: [
    { type: 'file', path: './config/app.json' },
    { type: 'object', data: { secrets } }
  ]
})
```

### 4. Type Safety

Always use TypeScript interfaces and Zod schemas:

```typescript
// Define types
interface AppConfig {
  server: ServerConfig;
  database: DatabaseConfig;
  features: FeatureConfig;
}

// Use with type safety
@Injectable()
class AppService {
  constructor(@InjectConfig() private config: ConfigService) {}

  getTypedConfig(): AppConfig {
    return this.config.getTyped<AppConfig>(AppConfigSchema);
  }
}
```

### 5. Configuration Documentation

Document your configuration schema:

```typescript
const ConfigSchema = z.object({
  server: z.object({
    port: z.number().describe('Server port (1-65535)'),
    host: z.string().describe('Server bind address'),
    cors: z.object({
      enabled: z.boolean().describe('Enable CORS headers'),
      origins: z.array(z.string()).describe('Allowed origins')
    })
  }).describe('Server configuration'),

  database: z.object({
    url: z.string().url().describe('Database connection URL'),
    pool: z.object({
      min: z.number().describe('Minimum pool connections'),
      max: z.number().describe('Maximum pool connections')
    }).describe('Connection pool settings')
  }).describe('Database configuration')
});
```

## API Reference

### ConfigModule

#### `ConfigModule.forRoot(options: IConfigModuleOptions)`

Configure the root configuration module.

**Options:**
- `sources`: Array of configuration sources
- `schema`: Zod schema for validation
- `environment`: Environment name
- `validateOnStartup`: Enable startup validation
- `watchForChanges`: Enable file watching
- `cache`: Cache configuration
- `strict`: Strict mode (throw on errors)
- `global`: Make module global

#### `ConfigModule.forFeature(name: string, schema?: ZodType)`

Configure a feature-specific configuration module.

#### `ConfigModule.forRootAsync(options: IConfigAsyncOptions)`

Configure the module asynchronously.

### ConfigService

#### `get<T>(path: string, defaultValue?: T): T`

Get configuration value by path.

```typescript
const port = config.get('server.port', 3000);
const database = config.get<DatabaseConfig>('database');
```

#### `getAll(): Record<string, any>`

Get all configuration values.

#### `has(path: string): boolean`

Check if configuration path exists.

#### `set(path: string, value: any): void`

Set configuration value (runtime only).

#### `getTyped<T>(schema: ZodType<T>, path?: string): T`

Get typed and validated configuration.

#### `validate(schema?: ZodType): IConfigValidationResult`

Validate configuration against schema.

#### `onChange(listener: (event: IConfigChangeEvent) => void): () => void`

Subscribe to configuration changes.

#### `reload(): Promise<void>`

Reload configuration from sources.

### Configuration Sources

#### File Source
```typescript
interface IFileConfigSource {
  type: 'file';
  path: string;
  format?: 'json' | 'yaml' | 'toml' | 'ini' | 'env';
  encoding?: BufferEncoding;
  optional?: boolean;
}
```

#### Environment Source
```typescript
interface IEnvironmentConfigSource {
  type: 'env';
  prefix?: string;
  separator?: string;
  transform?: 'lowercase' | 'uppercase' | 'camelCase';
  optional?: boolean;
}
```

#### Command Line Arguments Source
```typescript
interface IArgvConfigSource {
  type: 'argv';
  prefix?: string;
  optional?: boolean;
}
```

#### Object Source
```typescript
interface IObjectConfigSource {
  type: 'object';
  data: Record<string, any>;
  optional?: boolean;
}
```

#### Remote Source
```typescript
interface IRemoteConfigSource {
  type: 'remote';
  url: string;
  headers?: Record<string, string>;
  timeout?: number;
  retry?: number;
  optional?: boolean;
}
```

## Troubleshooting

### Configuration not loading

1. Check source paths are correct
2. Verify file permissions
3. Ensure format is specified or detectable
4. Check for syntax errors in configuration files

### Validation failures

1. Review schema definition
2. Check for missing required fields
3. Verify data types match schema
4. Use `.optional()` for optional fields in Zod

### Hot reload not working

1. Ensure `watchForChanges: true` is set
2. Check file system supports watching
3. Verify file paths are absolute
4. Check for permission issues

### Environment variables not loading

1. Check prefix configuration
2. Verify separator for nested paths
3. Ensure variables are set before app starts
4. Check for naming conflicts

## Migration Guide

### From process.env

```typescript
// Before
const port = process.env.PORT || 3000;
const dbHost = process.env.DB_HOST || 'localhost';

// After
@Injectable()
class AppService {
  @Config('server.port', 3000)
  private port: number;

  @Config('database.host', 'localhost')
  private dbHost: string;
}
```

### From JSON config files

```typescript
// Before
const config = JSON.parse(fs.readFileSync('./config.json', 'utf-8'));
const port = config.server?.port || 3000;

// After
ConfigModule.forRoot({
  sources: [
    { type: 'file', path: './config.json' }
  ]
})

@Injectable()
class AppService {
  @Config('server.port', 3000)
  private port: number;
}
```

### From dotenv

```typescript
// Before
import dotenv from 'dotenv';
dotenv.config();
const apiKey = process.env.API_KEY;

// After
ConfigModule.forRoot({
  sources: [
    { type: 'file', path: '.env', format: 'env' }
  ]
})

@Injectable()
class ApiService {
  @Config('API_KEY')
  private apiKey: string;
}
```

## Performance Considerations

1. **Caching**: Enable caching for frequently accessed values
2. **Lazy Loading**: Configuration is loaded on first access
3. **Watch Debouncing**: File changes are debounced to prevent excessive reloads
4. **Validation**: Run validation once at startup, not on every access
5. **Source Priority**: Order sources by frequency of override

## Security Considerations

1. **Never commit secrets**: Use environment variables or secret management
2. **Validate inputs**: Always validate configuration with schemas
3. **Sanitize paths**: Be careful with dynamic configuration paths
4. **Restrict file access**: Ensure config files have appropriate permissions
5. **Encrypt sensitive data**: Use encryption for sensitive configuration
6. **Audit changes**: Log configuration changes in production
7. **Use HTTPS for remote**: Always use HTTPS for remote configuration sources

## Conclusion

The Titan Configuration Module provides a robust, type-safe, and flexible configuration management system. With support for multiple sources, validation, hot-reload, and extensive decorator support, it simplifies configuration management in complex applications while maintaining type safety and best practices.