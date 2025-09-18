/**
 * Template Module for Titan Framework
 *
 * This module demonstrates how to create a Titan module with:
 * - Static and dynamic configuration
 * - Service registration
 * - Dependency injection
 * - Module lifecycle
 */

import { Container, createToken } from '@omnitron-dev/nexus';
import {
  ApplicationModule,
  IApplication,
  IHealthStatus
} from '@omnitron-dev/titan';
import type {
  TemplateModuleOptions,
  TemplateModuleAsyncOptions,
  TemplateOptionsFactory
} from './types.js';
import {
  TEMPLATE_MODULE_OPTIONS,
  TEMPLATE_SERVICE,
  TEMPLATE_CACHE_SERVICE,
  TEMPLATE_LOGGER,
  DEFAULT_OPTIONS
} from './constants.js';
import { TemplateService } from './services/template.service.js';
import { CacheService } from './services/cache.service.js';
import { LoggerService } from './services/logger.service.js';
import { mergeDeep } from './utils.js';

export class TemplateModule implements ApplicationModule {
  name = 'TemplateModule';
  private static globalOptions: TemplateModuleOptions | null = null;
  private container!: Container;
  private logger!: LoggerService;
  private initialized = false;
  private options: TemplateModuleOptions;

  constructor(options: TemplateModuleOptions = {}) {
    this.options = mergeDeep({}, DEFAULT_OPTIONS, options) as TemplateModuleOptions;
  }

  /**
   * Create a module with static configuration
   */
  static forRoot(options: TemplateModuleOptions = {}): TemplateModule {
    this.globalOptions = mergeDeep({}, DEFAULT_OPTIONS, options) as TemplateModuleOptions;
    return new TemplateModule(this.globalOptions);
  }

  /**
   * Create a module with async configuration
   */
  static forRootAsync(options: TemplateModuleAsyncOptions): TemplateModule {
    const module = new TemplateModule();

    // Store async options for later resolution
    (module as any).__asyncOptions = options;

    return module;
  }

  /**
   * Create a feature module that uses the root configuration
   */
  static forFeature(): TemplateModule {
    if (!this.globalOptions) {
      throw new Error('TemplateModule.forRoot() must be called before forFeature()');
    }
    return new TemplateModule(this.globalOptions);
  }

  /**
   * Configure module
   */
  async configure(app: IApplication): Promise<void> {
    // Module configuration logic
  }

  /**
   * Health check status
   */
  async health(): Promise<IHealthStatus> {
    return this.healthCheck();
  }

  /**
   * Register module resources
   */
  async onRegister(app: IApplication): Promise<void> {
    // Module registration logic
  }

  /**
   * Initialize the module
   */
  async onApplicationInit(app: IApplication): Promise<void> {
    this.container = app.container;

    // Handle async configuration
    if ((this as any).__asyncOptions) {
      await this.resolveAsyncOptions((this as any).__asyncOptions);
    }

    // Register options
    this.container.register(TEMPLATE_MODULE_OPTIONS, {
      useValue: this.options
    });

    // Register logger
    this.container.register(TEMPLATE_LOGGER, {
      useClass: LoggerService
    });

    // Register cache service
    this.container.register(TEMPLATE_CACHE_SERVICE, {
      useClass: CacheService
    });

    // Register main service
    this.container.register(TEMPLATE_SERVICE, {
      useClass: TemplateService
    });

    // Get logger instance
    this.logger = this.container.resolve(TEMPLATE_LOGGER);

    // Initialize services
    const templateService = this.container.resolve(TEMPLATE_SERVICE);
    await templateService.initialize();

    this.initialized = true;
    this.logger.info('TemplateModule initialized', { options: this.options });
  }

  /**
   * Module lifecycle - onStart
   */
  async onStart(app: IApplication): Promise<void> {
    // Called when module starts
  }

  /**
   * Module lifecycle - onStop
   */
  async onStop(app: IApplication): Promise<void> {
    // Called when module stops
  }

  /**
   * Module lifecycle - onDestroy
   */
  async onDestroy(): Promise<void> {
    // Called when module is destroyed
  }

  /**
   * Module lifecycle - onHealthCheck
   */
  async onHealthCheck(app: IApplication): Promise<IHealthStatus> {
    return this.healthCheck();
  }

  /**
   * Start the module
   */
  async onApplicationStart(app: IApplication): Promise<void> {
    if (!this.initialized) {
      throw new Error('Module not initialized');
    }

    const templateService = this.container.resolve(TEMPLATE_SERVICE);
    await templateService.start();

    this.logger.info('TemplateModule started');
  }

  /**
   * Stop the module
   */
  async onApplicationStop(app: IApplication): Promise<void> {
    const templateService = this.container.resolve(TEMPLATE_SERVICE);
    await templateService.stop();

    this.logger.info('TemplateModule stopped');
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<IHealthStatus> {
    try {
      const templateService = this.container.resolve(TEMPLATE_SERVICE);
      const result = await templateService.healthCheck();

      return {
        status: result.status === 'healthy' ? 'healthy' : 'unhealthy',
        details: result.checks
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        details: {
          error: (error as Error).message
        }
      };
    }
  }

  /**
   * Resolve async options
   */
  private async resolveAsyncOptions(asyncOptions: TemplateModuleAsyncOptions): Promise<void> {
    let options: TemplateModuleOptions;

    if (asyncOptions.useFactory) {
      const inject = asyncOptions.inject || [];
      const deps = inject.map(token => this.container.resolve(token));
      options = await asyncOptions.useFactory(...deps);
    } else if (asyncOptions.useExisting) {
      const factory = this.container.resolve(asyncOptions.useExisting);
      options = await factory.createTemplateOptions();
    } else if (asyncOptions.useClass) {
      this.container.register(createToken<TemplateOptionsFactory>('TEMP_FACTORY'), {
        useClass: asyncOptions.useClass
      });
      const factory = this.container.resolve<TemplateOptionsFactory>(createToken('TEMP_FACTORY'));
      options = await factory.createTemplateOptions();
    } else {
      throw new Error('Invalid async options configuration');
    }

    this.options = mergeDeep({}, DEFAULT_OPTIONS, options) as TemplateModuleOptions;
  }
}