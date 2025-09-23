/**
 * Discovery Module for Titan Framework
 * 
 * Provides service discovery capabilities as a Titan module.
 */

import { Redis } from 'ioredis';
import { Module, Injectable } from '../../decorators/index.js';
import { IModule, IApplication } from '../../types.js';
import { createToken, type Token } from '../../nexus/index.js';
import type { ILogger } from '../logger/logger.types.js';
import { DiscoveryService } from './discovery.service.js';
import {
  DISCOVERY_SERVICE_TOKEN,
  REDIS_TOKEN,
  LOGGER_TOKEN,
  DISCOVERY_OPTIONS_TOKEN,
  DiscoveryOptions,
  IDiscoveryService
} from './types.js';

// Module configuration interface
export interface DiscoveryModuleOptions extends DiscoveryOptions {
  redisUrl?: string;
  redisOptions?: any;
}

// Token for the module
export const DiscoveryModuleToken: Token<DiscoveryModule> = createToken<DiscoveryModule>('DiscoveryModule');

/**
 * Discovery Module class that integrates service discovery into Titan applications
 */
@Injectable()
@Module({
  name: 'discovery',
  providers: [
    DiscoveryService,
    {
      provide: DISCOVERY_SERVICE_TOKEN,
      useExisting: DiscoveryService
    }
  ],
  exports: [DISCOVERY_SERVICE_TOKEN]
})
export class DiscoveryModule implements IModule {
  name = 'discovery';
  version = '1.0.0';

  private redis?: Redis;
  private discoveryService?: IDiscoveryService;
  private logger?: ILogger;
  private options: DiscoveryModuleOptions;

  constructor(options: DiscoveryModuleOptions = {}) {
    this.options = options;
  }

  /**
   * Create a configured module instance
   */
  static forRoot(options: DiscoveryModuleOptions = {}): DiscoveryModule {
    return new DiscoveryModule(options);
  }

  /**
   * Register the module with the application
   */
  async onRegister(app: IApplication): Promise<void> {
    // Get or create logger
    try {
      this.logger = app.resolve(createToken<ILogger>('Logger'));
    } catch {
      // Use console as fallback
      this.logger = {
        info: (msg: any, ...args: any[]) => console.log('[Discovery]', msg, ...args),
        error: (msg: any, ...args: any[]) => console.error('[Discovery]', msg, ...args),
        warn: (msg: any, ...args: any[]) => console.warn('[Discovery]', msg, ...args),
        debug: (msg: any, ...args: any[]) => console.debug('[Discovery]', msg, ...args),
      } as ILogger;
    }

    // Create or get Redis instance
    if (!app.hasProvider(REDIS_TOKEN)) {
      this.redis = new Redis(this.options.redisUrl || this.options.redisOptions || {});
      app.register(REDIS_TOKEN, { useValue: this.redis });
      this.logger.info('Redis client created for Discovery module');
    } else {
      this.redis = app.resolve(REDIS_TOKEN);
      this.logger.info('Using existing Redis client');
    }

    // Register logger
    if (!app.hasProvider(LOGGER_TOKEN)) {
      app.register(LOGGER_TOKEN, { useValue: this.logger });
    }

    // Register options
    app.register(DISCOVERY_OPTIONS_TOKEN, { useValue: this.options });

    // Register DiscoveryService if not already registered
    if (!app.hasProvider(DISCOVERY_SERVICE_TOKEN)) {
      app.register(DISCOVERY_SERVICE_TOKEN, { useClass: DiscoveryService });
    }

    this.logger.info('DiscoveryModule registered');
  }

  /**
   * Start the discovery service
   */
  async onStart(app: IApplication): Promise<void> {
    this.discoveryService = app.resolve(DISCOVERY_SERVICE_TOKEN);
    await this.discoveryService.start();
    this.logger?.info('DiscoveryModule started');
  }

  /**
   * Stop the discovery service
   */
  async onStop(app: IApplication): Promise<void> {
    if (this.discoveryService) {
      await this.discoveryService.stop();
    }

    // Close Redis connection if we created it
    if (this.redis && this.options.redisUrl) {
      this.redis.disconnect();
      this.logger?.info('Redis connection closed');
    }

    this.logger?.info('DiscoveryModule stopped');
  }

  /**
   * Clean up resources
   */
  async onDestroy(): Promise<void> {
    if (this.redis && this.options.redisUrl) {
      this.redis.disconnect();
    }
    this.logger?.debug('DiscoveryModule destroyed');
  }

  /**
   * Get the discovery service instance
   */
  getService(): IDiscoveryService | undefined {
    return this.discoveryService;
  }
}

/**
 * Factory function for creating a discovery module
 */
export function createDiscoveryModule(options: DiscoveryModuleOptions = {}): DiscoveryModule {
  return DiscoveryModule.forRoot(options);
}
