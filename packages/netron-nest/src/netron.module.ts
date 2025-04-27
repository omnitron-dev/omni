import { DiscoveryModule } from '@nestjs/core';
import { NetronOptions } from '@devgrid/netron';
import { Module, Global, Provider, DynamicModule } from '@nestjs/common';

import { NetronService } from './netron.service';
import { NETRON_OPTIONS, NETRON_INSTANCE } from './constants';

/**
 * Interface defining asynchronous configuration options for NetronModule.
 * 
 * @description
 * This interface provides a flexible way to configure the NetronModule asynchronously,
 * allowing for dynamic configuration loading and dependency injection.
 * 
 * @property {Function} useFactory - Factory function that returns NetronOptions or a Promise of NetronOptions
 * @property {any[]} [inject] - Optional array of dependencies to inject into the factory function
 * @property {any[]} [imports] - Optional array of modules to import for dependency resolution
 */
export interface NetronModuleAsyncOptions {
  useFactory: (...args: any[]) => Promise<NetronOptions> | NetronOptions;
  inject?: any[];
  imports?: any[];
}

/**
 * Global NestJS module for Netron integration.
 * 
 * @description
 * This module provides integration between NestJS and the Netron distributed system.
 * It manages the lifecycle of Netron services and provides configuration options
 * for both synchronous and asynchronous initialization.
 * 
 * @remarks
 * The module is marked as @Global() to make it available throughout the application
 * without explicit imports. It requires DiscoveryModule for service discovery.
 */
@Global()
@Module({
  imports: [DiscoveryModule],
})
export class NetronModule {
  /**
   * Synchronously initializes the NetronModule with static configuration.
   * 
   * @description
   * This static method creates a dynamic module with providers for Netron configuration,
   * service management, and instance access. It's suitable for scenarios where
   * configuration is known at compile time.
   * 
   * @param {NetronOptions} options - Configuration options for Netron
   * @returns {DynamicModule} A configured dynamic module with all necessary providers
   */
  static forRoot(options: NetronOptions): DynamicModule {
    const providers = this.createProviders(options);
    return {
      module: NetronModule,
      providers,
      exports: providers,
    };
  }

  /**
   * Asynchronously initializes the NetronModule with dynamic configuration.
   * 
   * @description
   * This static method creates a dynamic module that supports asynchronous
   * configuration loading. It's suitable for scenarios where configuration
   * depends on external services or requires runtime resolution.
   * 
   * @param {NetronModuleAsyncOptions} asyncOptions - Asynchronous configuration options
   * @returns {DynamicModule} A configured dynamic module with async providers
   */
  static forRootAsync(asyncOptions: NetronModuleAsyncOptions): DynamicModule {
    const asyncProviders = this.createAsyncProviders(asyncOptions);
    return {
      module: NetronModule,
      imports: asyncOptions.imports || [],
      providers: asyncProviders,
      exports: asyncProviders,
    };
  }

  /**
   * Creates providers for synchronous module initialization.
   * 
   * @description
   * This private static method generates the necessary providers for the NetronModule,
   * including configuration options, service management, and instance access.
   * 
   * @param {NetronOptions} options - Static configuration options
   * @returns {Provider[]} Array of providers for dependency injection
   * @private
   */
  private static createProviders(options: NetronOptions): Provider[] {
    return [
      {
        provide: NETRON_OPTIONS,
        useValue: options,
      },
      NetronService,
      {
        provide: NETRON_INSTANCE,
        useFactory: (netronService: NetronService) => netronService.instance,
        inject: [NetronService],
      },
    ];
  }

  /**
   * Creates providers for asynchronous module initialization.
   * 
   * @description
   * This private static method generates providers that support asynchronous
   * configuration loading, including factory-based option resolution and
   * dependency injection.
   * 
   * @param {NetronModuleAsyncOptions} options - Asynchronous configuration options
   * @returns {Provider[]} Array of async-aware providers for dependency injection
   * @private
   */
  private static createAsyncProviders(options: NetronModuleAsyncOptions): Provider[] {
    return [
      {
        provide: NETRON_OPTIONS,
        useFactory: options.useFactory,
        inject: options.inject || [],
      },
      NetronService,
      {
        provide: NETRON_INSTANCE,
        useFactory: (netronService: NetronService) => netronService.instance,
        inject: [NetronService],
      },
    ];
  }
}
