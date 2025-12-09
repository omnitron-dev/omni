/**
 * Priceverse - Root Application Module
 * Integrates all Titan core modules and application modules
 * Full integration with @omnitron-dev/titan database module
 */

import { Module } from '@omnitron-dev/titan/decorators';
import { ConfigModule, CONFIG_SERVICE_TOKEN, type ConfigService } from '@omnitron-dev/titan/module/config';
import { LoggerModule, LOGGER_SERVICE_TOKEN, type ILoggerModule } from '@omnitron-dev/titan/module/logger';
import {
  DatabaseModule,
  DATABASE_CONNECTION,
  type DatabaseModuleOptions,
} from '@omnitron-dev/titan/module/database';
import { RedisModule } from '@omnitron-dev/titan/module/redis';
import { SchedulerModule } from '@omnitron-dev/titan/module/scheduler';

// Import all application modules
import { CollectorModule } from './modules/collector/index.js';
import { AggregatorModule } from './modules/aggregator/index.js';
import { PricesModule } from './modules/prices/index.js';
import { ChartsModule } from './modules/charts/index.js';
import { HealthModule } from './modules/health/index.js';
import { MetricsModule } from './modules/metrics/index.js';
import { configSchema } from './config/config.schema.js';

// Import repositories
import { PriceHistoryRepository, OhlcvRepository } from './database/index.js';
import { PRICE_HISTORY_REPOSITORY, OHLCV_REPOSITORY } from './shared/tokens.js';

@Module({
  imports: [
    // Titan Core Modules
    ConfigModule.forRoot({
      schema: configSchema,
      sources: [
        { type: 'file', path: 'config/default.json', optional: true },
        { type: 'env', prefix: 'PRICEVERSE_', separator: '__' },
      ],
    }),
    LoggerModule.forRoot(),
    DatabaseModule.forRootAsync({
      useFactory: async (...args: unknown[]): Promise<DatabaseModuleOptions> => {
        const config = args[0] as ConfigService;
        const loggerModule = args[1] as ILoggerModule;
        const logger = loggerModule?.logger;

        const dbConfig = config.get('database') as {
          dialect: 'postgres' | 'mysql' | 'sqlite';
          host: string;
          port: number;
          database: string;
          user: string;
          password: string;
          pool?: { min: number; max: number };
          ssl?: boolean;
        } | undefined;

        if (!dbConfig) {
          logger?.info('[Database] No config found, using in-memory SQLite');
          // Default to SQLite for development/testing
          return {
            connection: {
              dialect: 'sqlite',
              connection: ':memory:',
            },
            // Enable plugins for better functionality
            plugins: {
              builtIn: {
                timestamps: true, // Auto-manage created_at
              },
            },
            // Enable health monitoring
            healthCheck: true,
          };
        }

        logger?.info(`[Database] Connecting to ${dbConfig.dialect}://${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`);

        return {
          connection: {
            dialect: dbConfig.dialect,
            connection: {
              host: dbConfig.host,
              port: dbConfig.port,
              database: dbConfig.database,
              user: dbConfig.user,
              password: dbConfig.password,
              ssl: dbConfig.ssl ? { rejectUnauthorized: false } : undefined,
            },
            pool: dbConfig.pool ?? { min: 2, max: 20 },
          },
          // Enable plugins for better functionality
          plugins: {
            builtIn: {
              timestamps: true, // Auto-manage created_at/updated_at
            },
          },
          // Enable health monitoring
          healthCheck: true,
          // Migration settings
          migrations: {
            directory: './src/database/migrations',
          },
          autoMigrate: false, // Manual migration control
        };
      },
      inject: [CONFIG_SERVICE_TOKEN, LOGGER_SERVICE_TOKEN],
    }),
    RedisModule.forRoot(),
    SchedulerModule.forRoot(),

    // Application Modules
    CollectorModule,
    AggregatorModule,
    PricesModule,
    ChartsModule,
    HealthModule,
    MetricsModule,
  ],
  providers: [
    // Register repositories as providers
    {
      provide: PRICE_HISTORY_REPOSITORY,
      useFactory: (db: unknown) => new PriceHistoryRepository(db as any),
      inject: [DATABASE_CONNECTION],
    },
    {
      provide: OHLCV_REPOSITORY,
      useFactory: (db: unknown) => new OhlcvRepository(db as any),
      inject: [DATABASE_CONNECTION],
    },
    // DatabaseHealthIndicator is provided by DatabaseModule when healthCheck: true
  ],
  exports: [
    PRICE_HISTORY_REPOSITORY,
    OHLCV_REPOSITORY,
  ],
})
export class AppModule { }
