/**
 * Priceverse 2.0 - Root Application Module
 * Integrates all Titan core modules and application modules
 */

import { Module } from '@omnitron-dev/titan/decorators';
import { ConfigModule, CONFIG_SERVICE_TOKEN, type ConfigService } from '@omnitron-dev/titan/module/config';
import { LoggerModule } from '@omnitron-dev/titan/module/logger';
import { DatabaseModule, type DatabaseModuleOptions } from '@omnitron-dev/titan/module/database';
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

@Module({
  imports: [
    // Titan Core Modules
    ConfigModule.forRoot({
      schema: configSchema,
      prefix: 'PRICEVERSE_',
      sources: [
        { type: 'file', path: 'config/default.json', optional: true },
        { type: 'env', prefix: 'PRICEVERSE_', separator: '__' },
      ],
    }),
    LoggerModule.forRoot(),
    DatabaseModule.forRootAsync({
      useFactory: async (...args: unknown[]): Promise<DatabaseModuleOptions> => {
        const config = args[0] as ConfigService;
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
          // Default to SQLite for development/testing
          return {
            connection: {
              dialect: 'sqlite',
              connection: ':memory:',
            },
          };
        }

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
            pool: dbConfig.pool,
          },
        };
      },
      inject: [CONFIG_SERVICE_TOKEN],
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
  providers: [],
  exports: [],
})
export class AppModule {}
