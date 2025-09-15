/**
 * Example usage of the updated ConfigModule with zod@4.1.8
 */

import { z } from 'zod';
import { 
  createConfigModule, 
  ConfigSchemas,
  createTypedConfig,
  createEnvConfig,
  type ConfigModule 
} from '../src/modules/config.module';

// Define your application configuration schema
const AppConfigSchema = z.object({
  app: ConfigSchemas.app,
  server: ConfigSchemas.server,
  database: ConfigSchemas.database,
  redis: ConfigSchemas.redis.optional(),
  logger: ConfigSchemas.logger,
  
  // Custom application settings
  features: z.object({
    enableCache: z.boolean().default(true),
    maxUploadSize: z.number().positive().default(10 * 1024 * 1024), // 10MB
    allowedOrigins: z.array(z.string().url()).default([]),
    rateLimiting: z.object({
      enabled: z.boolean().default(true),
      maxRequests: z.number().int().positive().default(100),
      windowMs: z.number().int().positive().default(60000) // 1 minute
    }).optional()
  }),
  
  // API keys and secrets
  secrets: z.object({
    jwtSecret: z.string().min(32),
    apiKey: z.string().uuid().optional(),
    encryptionKey: z.string().length(32).optional()
  }),
  
  // External services
  services: z.object({
    email: z.object({
      provider: z.enum(['smtp', 'sendgrid', 'aws-ses']),
      from: z.string().email(),
      config: z.record(z.unknown())
    }).optional(),
    
    storage: z.object({
      provider: z.enum(['local', 's3', 'gcs']),
      bucket: z.string().optional(),
      region: z.string().optional(),
      credentials: z.record(z.string()).optional()
    }).optional()
  }).optional()
});

// Infer the type from schema
type AppConfig = z.infer<typeof AppConfigSchema>;

// Example 1: Basic usage with validation
async function basicUsage() {
  const config = createConfigModule<AppConfig>({
    schema: AppConfigSchema,
    validateOnLoad: false, // Don't validate immediately since we haven't loaded data yet
    defaults: {
      app: {
        name: 'my-app',
        version: '1.0.0',
        environment: 'development',
        debug: true
      },
      server: {
        port: 3000,
        host: 'localhost'
      },
      database: {
        host: 'localhost',
        port: 5432,
        database: 'myapp',
        username: 'user',
        password: 'password'
      },
      logger: {
        level: 'info',
        pretty: true
      },
      features: {
        enableCache: true,
        maxUploadSize: 10 * 1024 * 1024,
        allowedOrigins: []
      },
      secrets: {
        jwtSecret: 'supersecretkey123456789012345678' // 32 chars
      }
    },
    sources: [
      { type: 'file', path: './config/default.json', optional: true },
      { type: 'file', path: `./config/${process.env.NODE_ENV}.json`, optional: true },
      { type: 'env', prefix: 'APP_' }
    ]
  });
  
  // Try to get typed configuration safely
  const validationResult = config.validateSafe(AppConfigSchema);
  if (!validationResult.success) {
    console.log('Using default configuration');
    // Use defaults for demo
    const appConfig = config.get();
  console.log('App name:', appConfig.app.name);
  console.log('Server port:', appConfig.server.port);
  
  // Get specific values with validation
  const dbConfig = config.getValidated('database', ConfigSchemas.database);
  console.log('Database host:', dbConfig.host);
  
    console.log('App name:', appConfig.app.name);
    console.log('Server port:', appConfig.server?.port || 3000);
  } else {
    const appConfig = validationResult.data!;
    console.log('App name:', appConfig.app.name);
    console.log('Server port:', appConfig.server.port);
  }
  
  // Get specific values safely
  const dbConfig = config.get('database', ConfigSchemas.database.parse({
    host: 'localhost',
    port: 5432,
    database: 'myapp',
    username: 'user',
    password: 'password'
  }));
  console.log('Database host:', dbConfig.host);
}

// Example 2: Using typed configuration getter
function typedConfigUsage(config: ConfigModule) {
  // Create a typed getter
  const getConfig = createTypedConfig(config, AppConfigSchema);
  
  // Always returns typed configuration
  const appConfig = getConfig();
  
  // TypeScript knows the exact shape
  const serverPort: number = appConfig.server.port;
  const dbHost: string = appConfig.database.host;
  
  // This would cause a TypeScript error:
  // const invalid: string = appConfig.server.port; // Error: Type 'number' is not assignable to type 'string'
}

// Example 3: Path-specific schemas
async function pathSchemaUsage() {
  const config = createConfigModule({
    schemas: {
      'database': ConfigSchemas.database,
      'server': ConfigSchemas.server,
      'features.rateLimiting': z.object({
        enabled: z.boolean(),
        maxRequests: z.number().min(1).max(1000),
        windowMs: z.number().min(1000).max(3600000)
      })
    }
  });
  
  // Load configuration from multiple sources
  await config.loadFile('./config.json');
  await config.loadEnv('APP_');
  
  // Validate specific paths
  const dbConfig = config.validatePath('database', ConfigSchemas.database);
  const serverConfig = config.validatePath('server', ConfigSchemas.server);
  
  // Get typed values with optional validation
  const rateLimiting = config.getTyped(
    'features.rateLimiting',
    z.object({
      enabled: z.boolean(),
      maxRequests: z.number(),
      windowMs: z.number()
    })
  );
  
  if (rateLimiting) {
    console.log('Rate limiting enabled:', rateLimiting.enabled);
  }
}

// Example 4: Environment-based configuration
function envConfigUsage() {
  // Create configuration from environment variables
  const config = createEnvConfig(AppConfigSchema, 'MY_APP');
  
  // This will load from:
  // 1. Environment variables with MY_APP_ prefix
  // 2. .env file (if exists)
  // 3. .env.{NODE_ENV} file (if exists)
  
  // Get configuration with full type safety
  const appConfig = config.validate(AppConfigSchema);
  
  // Watch for changes
  const unwatch = config.watch('server.port', (newPort) => {
    console.log('Server port changed to:', newPort);
  });
  
  // Later: stop watching
  // unwatch();
}

// Example 5: Advanced validation with custom schemas
function advancedValidation() {
  // Create custom schemas with refinements
  const CustomConfigSchema = z.object({
    port: z.number()
      .int()
      .positive()
      .refine(
        (port) => port >= 3000 && port <= 9999,
        { message: 'Port must be between 3000 and 9999' }
      ),
    
    email: z.string()
      .email()
      .refine(
        (email) => email.endsWith('@company.com'),
        { message: 'Email must be a company email address' }
      ),
    
    password: z.string()
      .min(8)
      .refine(
        (password) => /[A-Z]/.test(password),
        { message: 'Password must contain at least one uppercase letter' }
      )
      .refine(
        (password) => /[0-9]/.test(password),
        { message: 'Password must contain at least one number' }
      )
      .refine(
        (password) => /[!@#$%^&*]/.test(password),
        { message: 'Password must contain at least one special character' }
      ),
    
    // Cross-field validation
    timeRange: z.object({
      start: z.string().datetime(),
      end: z.string().datetime()
    }).refine(
      (data) => new Date(data.end) > new Date(data.start),
      { message: 'End time must be after start time' }
    )
  });
  
  const config = createConfigModule({
    schema: CustomConfigSchema,
    validateOnLoad: false // Validate manually
  });
  
  // Load and validate
  config.loadObject({
    port: 3001,
    email: 'admin@company.com',
    password: 'SecurePass123!',
    timeRange: {
      start: '2024-01-01T00:00:00Z',
      end: '2024-12-31T23:59:59Z'
    }
  });
  
  // Safe validation to get detailed errors
  const result = config.validateSafe(CustomConfigSchema);
  if (!result.success) {
    console.error('Validation errors:');
    result.formattedErrors?.forEach(error => console.error(error));
  }
}

// Example 6: Async validation with external checks
async function asyncValidation() {
  // Schema with async validation
  const AsyncConfigSchema = z.object({
    database: z.object({
      host: z.string(),
      port: z.number(),
      database: z.string()
    }).refine(
      async (db) => {
        // Simulate database connection check
        try {
          // const conn = await testConnection(db);
          // return conn.isConnected;
          return true; // Placeholder
        } catch {
          return false;
        }
      },
      { message: 'Cannot connect to database with provided configuration' }
    ),
    
    apiEndpoint: z.string()
      .url()
      .refine(
        async (url) => {
          // Simulate API health check
          try {
            // const response = await fetch(`${url}/health`);
            // return response.ok;
            return true; // Placeholder
          } catch {
            return false;
          }
        },
        { message: 'API endpoint is not reachable' }
      )
  });
  
  const config = createConfigModule({
    schema: AsyncConfigSchema
  });
  
  config.loadObject({
    database: {
      host: 'localhost',
      port: 5432,
      database: 'myapp'
    },
    apiEndpoint: 'https://api.example.com'
  });
  
  // Async validation
  try {
    const validated = await config.validateAsync(AsyncConfigSchema);
    console.log('Configuration validated successfully:', validated);
  } catch (error) {
    console.error('Async validation failed:', error);
  }
}

// Example 7: Dynamic configuration with watchers
function dynamicConfiguration() {
  const config = createConfigModule<AppConfig>();
  
  // Register watchers for specific paths
  config.watch('features.enableCache', (enabled) => {
    console.log(`Cache ${enabled ? 'enabled' : 'disabled'}`);
    // Update cache service accordingly
  });
  
  config.watch('logger.level', (level) => {
    console.log(`Log level changed to: ${level}`);
    // Update logger configuration
  });
  
  // Watch with validation
  const loggerSchema = ConfigSchemas.logger;
  config.watch('logger', (loggerConfig) => {
    try {
      const validated = loggerSchema.parse(loggerConfig);
      console.log('Logger config updated:', validated);
    } catch (error) {
      console.error('Invalid logger configuration:', error);
    }
  });
  
  // Trigger watchers by updating configuration
  config.set('features.enableCache', false);
  config.set('logger.level', 'debug');
}

// Export for use in other modules
export {
  AppConfigSchema,
  type AppConfig,
  createConfigModule,
  createTypedConfig
};

// Main execution
if (require.main === module) {
  (async () => {
    process.on('uncaughtException', (err) => {
      console.error('Uncaught exception:', err);
      process.exit(1);
    });
    console.log('=== Configuration Module Examples with zod@4.1.8 ===\n');
    
    try {
      console.log('1. Basic Usage:');
      await basicUsage();
      
      console.log('\n3. Advanced Validation:');
      advancedValidation();
      
      console.log('\n✅ Examples completed successfully!');
      process.exit(0);
    } catch (error) {
      console.error('Error in examples:', error);
      process.exit(1);
    }
  })().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}