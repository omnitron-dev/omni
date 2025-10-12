/**
 * Titan Configuration Module - Usage Examples
 *
 * This file contains various examples demonstrating
 * the configuration module capabilities.
 */

import { Application, Module, Injectable, OnStart, OnStop } from '../src/index.js';

import {
  ConfigModule,
  ConfigService,
  Config,
  InjectConfig,
  ConfigWatch,
  ConfigSchema,
  Configuration,
  ConfigDefaults,
  ConfigValidate,
  ConfigTransform,
} from '../src/modules/config/index.js';

import { z } from 'zod';

// ============================================
// Example 1: Basic Configuration
// ============================================

const BasicConfigSchema = z.object({
  app: z.object({
    name: z.string(),
    version: z.string(),
    port: z.number().min(1).max(65535),
    debug: z.boolean().default(false),
  }),
  database: z.object({
    host: z.string(),
    port: z.number().default(5432),
    database: z.string(),
  }),
});

@Injectable()
class BasicService {
  @Config('app.name')
  private appName: string;

  @Config('app.port', 3000)
  private port: number;

  @Config('database.host', 'localhost')
  private dbHost: string;

  getInfo() {
    return {
      app: this.appName,
      port: this.port,
      database: this.dbHost,
    };
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({
      schema: BasicConfigSchema,
      validateOnStartup: true,
      sources: [
        {
          type: 'object',
          data: {
            app: {
              name: 'BasicApp',
              version: '1.0.0',
              port: 3000,
            },
            database: {
              host: 'localhost',
              port: 5432,
              database: 'myapp',
            },
          },
        },
        { type: 'env', prefix: 'APP_' },
      ],
    }),
  ],
  providers: [BasicService],
})
class BasicConfigModule {}

// ============================================
// Example 2: Multi-Environment Configuration
// ============================================

@Injectable()
class EnvironmentService {
  constructor(@InjectConfig() private config: ConfigService) {}

  getEnvironment(): string {
    return this.config.environment;
  }

  getDatabaseConfig() {
    const env = this.config.environment;

    if (env === 'production') {
      return {
        host: this.config.get('database.host'),
        port: this.config.get('database.port'),
        ssl: true,
        poolSize: 20,
      };
    } else if (env === 'staging') {
      return {
        host: this.config.get('database.host'),
        port: this.config.get('database.port'),
        ssl: true,
        poolSize: 10,
      };
    } else {
      return {
        host: 'localhost',
        port: 5432,
        ssl: false,
        poolSize: 5,
      };
    }
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({
      environment: process.env.NODE_ENV || 'development',
      sources: [
        // Base configuration
        { type: 'file', path: './config/default.json', optional: true },

        // Environment-specific config
        {
          type: 'file',
          path: `./config/${process.env.NODE_ENV || 'development'}.json`,
          optional: true,
        },

        // Environment variables
        { type: 'env', prefix: 'APP_' },

        // Command-line arguments
        { type: 'argv', prefix: '--' },
      ],
    }),
  ],
  providers: [EnvironmentService],
})
class MultiEnvModule {}

// ============================================
// Example 3: Configuration with Hot Reload
// ============================================

@Injectable()
class HotReloadService implements OnStart, OnStop {
  private unsubscribe?: () => void;

  constructor(@InjectConfig() private config: ConfigService) {}

  @ConfigWatch('features.rateLimit')
  onRateLimitChange(enabled: boolean) {
    console.log(`Rate limiting ${enabled ? 'enabled' : 'disabled'}`);
    if (enabled) {
      this.enableRateLimit();
    } else {
      this.disableRateLimit();
    }
  }

  @ConfigWatch('cache.ttl')
  onCacheTTLChange(newTTL: number, oldTTL: number) {
    console.log(`Cache TTL changed from ${oldTTL}ms to ${newTTL}ms`);
    this.reconfigureCache(newTTL);
  }

  async onStart() {
    // Subscribe to all configuration changes
    this.unsubscribe = this.config.onChange((event) => {
      console.log('Configuration changed:', {
        path: event.path,
        oldValue: event.oldValue,
        newValue: event.newValue,
        timestamp: event.timestamp,
      });
    });
  }

  async onStop() {
    if (this.unsubscribe) {
      this.unsubscribe();
    }
  }

  private enableRateLimit() {
    console.log('Configuring rate limiter...');
  }

  private disableRateLimit() {
    console.log('Disabling rate limiter...');
  }

  private reconfigureCache(ttl: number) {
    console.log(`Reconfiguring cache with TTL: ${ttl}ms`);
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({
      watchForChanges: true, // Enable hot reload
      sources: [{ type: 'file', path: './config/app.json', optional: true }],
    }),
  ],
  providers: [HotReloadService],
})
class HotReloadModule {}

// ============================================
// Example 4: Typed Configuration Classes
// ============================================

const ServerConfigSchema = z.object({
  port: z.number().min(1).max(65535),
  host: z.string().default('0.0.0.0'),
  ssl: z
    .object({
      enabled: z.boolean().default(false),
      cert: z.string().optional(),
      key: z.string().optional(),
    })
    .optional(),
});

@Configuration('server')
@ConfigSchema(ServerConfigSchema)
@ConfigDefaults({
  port: 3000,
  host: '0.0.0.0',
  ssl: {
    enabled: false,
  },
})
class ServerConfiguration {
  port: number = 3000;
  host: string = '0.0.0.0';
  ssl?: {
    enabled: boolean;
    cert?: string;
    key?: string;
  };
}

@Injectable()
class ServerService {
  constructor(@InjectConfig() private config: ConfigService) {}

  async startServer() {
    const serverConfig = this.config.getTyped(ServerConfigSchema, 'server');

    console.log(`Starting server on ${serverConfig.host}:${serverConfig.port}`);

    if (serverConfig.ssl?.enabled) {
      console.log('SSL enabled');
      // Configure SSL
    }
  }
}

// ============================================
// Example 5: Configuration with Validation and Transformation
// ============================================

@Injectable()
class ValidatedService {
  @ConfigValidate(z.string().email())
  @Config('admin.email')
  private adminEmail: string;

  @ConfigValidate(z.string().url())
  @Config('api.endpoint')
  private apiEndpoint: string;

  @ConfigValidate(z.number().min(1).max(100))
  @Config('app.maxRetries', 3)
  private maxRetries: number;

  @ConfigTransform((value: string) => value.toUpperCase())
  @Config('app.environment', 'development')
  private environment: string;

  @ConfigTransform((value: string) => value.split(',').map((s) => s.trim()))
  @Config('app.allowedOrigins', '')
  private allowedOrigins: string[];

  @ConfigTransform((value: any) => {
    if (typeof value === 'string') {
      return JSON.parse(value);
    }
    return value;
  })
  @Config('app.features', {})
  private features: Record<string, boolean>;

  getConfig() {
    return {
      admin: this.adminEmail,
      api: this.apiEndpoint,
      retries: this.maxRetries,
      env: this.environment,
      origins: this.allowedOrigins,
      features: this.features,
    };
  }
}

// ============================================
// Example 6: Feature Flags and A/B Testing
// ============================================

interface FeatureFlag {
  id: string;
  enabled: boolean;
  rolloutPercentage?: number;
  targetGroups?: string[];
  metadata?: Record<string, any>;
}

@Injectable()
class FeatureFlagService {
  private flags = new Map<string, FeatureFlag>();

  constructor(@InjectConfig() private config: ConfigService) {
    this.loadFlags();
  }

  private loadFlags() {
    const features = this.config.get<FeatureFlag[]>('features', []);
    for (const feature of features) {
      this.flags.set(feature.id, feature);
    }
  }

  @ConfigWatch('features')
  onFeaturesUpdate(newFeatures: FeatureFlag[]) {
    console.log('Features updated, reloading...');
    this.flags.clear();
    for (const feature of newFeatures) {
      this.flags.set(feature.id, feature);
    }
  }

  isEnabled(featureId: string, userId?: string): boolean {
    const flag = this.flags.get(featureId);

    if (!flag || !flag.enabled) {
      return false;
    }

    // If no rollout percentage, feature is fully enabled
    if (!flag.rolloutPercentage || flag.rolloutPercentage >= 100) {
      return true;
    }

    // Check rollout percentage for specific user
    if (userId) {
      const hash = this.hashString(userId + featureId);
      const percentage = hash % 100;
      return percentage < flag.rolloutPercentage;
    }

    return false;
  }

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  getEnabledFeatures(userId?: string): string[] {
    const enabled: string[] = [];

    for (const [id] of this.flags) {
      if (this.isEnabled(id, userId)) {
        enabled.push(id);
      }
    }

    return enabled;
  }
}

// ============================================
// Example 7: Database Configuration per Tenant
// ============================================

interface TenantDatabaseConfig {
  tenantId: string;
  database: {
    host: string;
    port: number;
    database: string;
    schema?: string;
  };
  cache?: {
    enabled: boolean;
    ttl: number;
  };
}

@Injectable()
class MultiTenantService {
  private tenantConfigs = new Map<string, TenantDatabaseConfig>();

  constructor(@InjectConfig() private config: ConfigService) {
    this.loadTenantConfigs();
  }

  private loadTenantConfigs() {
    const tenants = this.config.get<TenantDatabaseConfig[]>('tenants', []);

    for (const tenant of tenants) {
      this.tenantConfigs.set(tenant.tenantId, tenant);
    }
  }

  @ConfigWatch('tenants')
  onTenantsUpdate(newTenants: TenantDatabaseConfig[]) {
    console.log('Tenant configurations updated');
    this.tenantConfigs.clear();

    for (const tenant of newTenants) {
      this.tenantConfigs.set(tenant.tenantId, tenant);
    }
  }

  getTenantDatabase(tenantId: string) {
    const config = this.tenantConfigs.get(tenantId);

    if (!config) {
      throw new Error(`Configuration not found for tenant: ${tenantId}`);
    }

    return {
      ...config.database,
      // Add shared credentials from main config
      user: this.config.get('database.user'),
      password: this.config.get('database.password'),
    };
  }

  isCacheEnabled(tenantId: string): boolean {
    const config = this.tenantConfigs.get(tenantId);
    return config?.cache?.enabled ?? false;
  }

  getCacheTTL(tenantId: string): number {
    const config = this.tenantConfigs.get(tenantId);
    return config?.cache?.ttl ?? 300000; // Default 5 minutes
  }
}

// ============================================
// Example 8: Complete Application Example
// ============================================

const AppConfigSchema = z.object({
  app: z.object({
    name: z.string(),
    version: z.string(),
    port: z.number(),
    host: z.string().default('0.0.0.0'),
  }),
  database: z.object({
    host: z.string(),
    port: z.number(),
    database: z.string(),
    user: z.string(),
    password: z.string(),
    pool: z
      .object({
        min: z.number().default(2),
        max: z.number().default(10),
      })
      .optional(),
  }),
  redis: z
    .object({
      host: z.string(),
      port: z.number().default(6379),
      password: z.string().optional(),
    })
    .optional(),
  logging: z.object({
    level: z.enum(['trace', 'debug', 'info', 'warn', 'error']),
    pretty: z.boolean().default(false),
  }),
  features: z.record(z.boolean()).default({}),
});

type AppConfig = z.infer<typeof AppConfigSchema>;

@Injectable()
class ApplicationService implements OnStart {
  @Config('app.name')
  private appName: string;

  @Config('app.version')
  private version: string;

  constructor(
    @InjectConfig() private config: ConfigService,
    private featureFlags: FeatureFlagService
  ) {}

  async onStart() {
    console.log(`Starting ${this.appName} v${this.version}`);

    const config = this.config.getTyped(AppConfigSchema);
    console.log(`Server: ${config.app.host}:${config.app.port}`);
    console.log(`Database: ${config.database.host}:${config.database.port}/${config.database.database}`);

    if (config.redis) {
      console.log(`Redis: ${config.redis.host}:${config.redis.port}`);
    }

    console.log(`Logging level: ${config.logging.level}`);
    console.log(`Enabled features:`, this.featureFlags.getEnabledFeatures());
  }

  getHealth() {
    return {
      service: this.appName,
      version: this.version,
      status: 'healthy',
      environment: this.config.environment,
      timestamp: new Date().toISOString(),
    };
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({
      schema: AppConfigSchema,
      validateOnStartup: true,
      watchForChanges: process.env.NODE_ENV === 'development',
      cache: {
        enabled: true,
        ttl: 30000, // 30 seconds
      },
      sources: [
        // Default configuration
        {
          type: 'object',
          data: {
            app: {
              name: 'TitanApp',
              version: '1.0.0',
              port: 3000,
              host: '0.0.0.0',
            },
            logging: {
              level: 'info',
              pretty: false,
            },
            features: {
              newUI: false,
              analytics: true,
              apiV2: false,
            },
          },
        },

        // Configuration files
        { type: 'file', path: './config/default.json', optional: true },
        {
          type: 'file',
          path: `./config/${process.env.NODE_ENV || 'development'}.json`,
          optional: true,
        },

        // Local overrides (not committed to git)
        { type: 'file', path: './config/local.json', optional: true },

        // Environment variables
        {
          type: 'env',
          prefix: 'TITAN_',
          separator: '__',
        },

        // Command-line arguments
        { type: 'argv', prefix: '--' },
      ],
    }),
  ],
  providers: [ApplicationService, FeatureFlagService, MultiTenantService],
})
class CompleteAppModule {}

// ============================================
// Main Application Bootstrap
// ============================================

async function bootstrap() {
  console.log('Starting Titan Configuration Examples...\n');

  // Example 1: Basic Configuration
  console.log('=== Example 1: Basic Configuration ===');
  const basicApp = await Application.create(BasicConfigModule);
  const basicService = basicApp.resolve(BasicService);
  console.log('Basic Service Info:', basicService.getInfo());
  console.log();

  // Example 2: Multi-Environment
  console.log('=== Example 2: Multi-Environment Configuration ===');
  const envApp = await Application.create(MultiEnvModule);
  const envService = envApp.resolve(EnvironmentService);
  console.log('Environment:', envService.getEnvironment());
  console.log('Database Config:', envService.getDatabaseConfig());
  console.log();

  // Example 8: Complete Application
  console.log('=== Example 8: Complete Application ===');
  const app = await Application.create(CompleteAppModule);
  await app.start();

  const appService = app.resolve(ApplicationService);
  console.log('Health Check:', appService.getHealth());

  // Demonstrate configuration reload
  const configService = app.resolve(ConfigService);
  console.log('\n=== Configuration Reload Demo ===');
  console.log('Current features:', configService.get('features'));

  // Simulate configuration change
  configService.set('features.newUI', true);
  console.log('After update:', configService.get('features'));

  // Shutdown after 5 seconds
  setTimeout(async () => {
    console.log('\n=== Shutting down ===');
    await app.stop();
    process.exit(0);
  }, 5000);
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  bootstrap().catch(console.error);
}

// Export modules for testing
export {
  BasicConfigModule,
  MultiEnvModule,
  HotReloadModule,
  CompleteAppModule,
  BasicService,
  EnvironmentService,
  HotReloadService,
  ApplicationService,
  FeatureFlagService,
  MultiTenantService,
};
