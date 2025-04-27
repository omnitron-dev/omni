import { Netron, NetronOptions } from '@devgrid/netron';
import { Reflector, DiscoveryService } from '@nestjs/core';
import {
  Inject,
  Logger,
  Injectable,
  OnApplicationShutdown,
  OnApplicationBootstrap,
} from '@nestjs/common';

import { NETRON_OPTIONS } from './constants';
import { NETRON_SERVICE_METADATA } from './decorators/service.decorator';

/**
 * Core service for Netron integration with NestJS.
 * 
 * @description
 * This service manages the lifecycle of the Netron instance and handles automatic
 * service discovery and registration. It implements NestJS lifecycle hooks to
 * ensure proper initialization and cleanup of the Netron instance.
 * 
 * @remarks
 * The service acts as a bridge between NestJS's dependency injection system and
 * Netron's distributed service architecture. It automatically discovers and
 * registers services decorated with @Service() during application bootstrap.
 */
@Injectable()
export class NetronService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(NetronService.name);
  private readonly netron: Netron;

  /**
   * Creates an instance of NetronService.
   * 
   * @param options - Configuration options for Netron instance
   * @param discoveryService - NestJS service for provider discovery
   * @param reflector - NestJS reflector for metadata inspection
   */
  constructor(
    @Inject(NETRON_OPTIONS) private readonly options: NetronOptions,
    private readonly discoveryService: DiscoveryService,
    private readonly reflector: Reflector,
  ) {
    this.netron = new Netron(this.options);
  }

  /**
   * Initializes and starts the Netron instance, registering discovered services.
   * 
   * @description
   * This method is called automatically by NestJS during application bootstrap.
   * It starts the Netron instance and configures it based on the provided options.
   * If listenHost and listenPort are configured, it starts in server mode;
   * otherwise, it operates in client-only mode.
   * 
   * @remarks
   * After starting the Netron instance, it automatically discovers and registers
   * all services decorated with @Service() in the application.
   */
  async onApplicationBootstrap(): Promise<void> {
    await this.netron.start();
    if (this.options.listenHost || this.options.listenPort) {
      this.logger.log(`Netron server started at ${this.options.listenHost}:${this.options.listenPort}`);
    } else {
      this.logger.log('Netron initialized in client mode.');
    }

    this.registerDiscoveredServices();
  }

  /**
   * Gracefully shuts down the Netron instance.
   * 
   * @description
   * This method is called automatically by NestJS during application shutdown.
   * It ensures proper cleanup of the Netron instance and all its resources.
   * 
   * @param signal - Optional shutdown signal received from the system
   */
  async onApplicationShutdown(signal?: string): Promise<void> {
    this.logger.log(`Shutting down Netron (signal: ${signal})`);
    await this.netron.stop();
  }

  /**
   * Discovers and registers services decorated with @Service().
   * 
   * @description
   * This method scans all providers in the application and registers those
   * decorated with @Service() as Netron services. It handles both static
   * and dynamic providers, with appropriate logging and error handling.
   * 
   * @remarks
   * Services defined in non-static providers are skipped with a warning,
   * as they cannot be reliably exposed in the distributed system.
   */
  private registerDiscoveredServices(): void {
    const providers = this.discoveryService.getProviders();

    for (const wrapper of providers) {
      const { instance, metatype } = wrapper;

      if (!instance || !metatype || typeof instance !== 'object') continue;

      if (!wrapper.isDependencyTreeStatic()) {
        this.logger.warn(
          `Service "${wrapper.name}" cannot be exposed because it is defined in a non-static provider.`,
        );
        continue;
      }

      const qualifiedName = this.reflector.get<string>(NETRON_SERVICE_METADATA, metatype);
      if (qualifiedName) {
        try {
          this.netron.peer.exposeService(instance);
          this.logger.log(`Service "${qualifiedName}" successfully exposed.`);
        } catch (error: any) {
          this.logger.error(`Error exposing service "${qualifiedName}": ${error.message}`);
        }
      }
    }
  }

  /**
   * Provides access to the Netron instance.
   * 
   * @description
   * This getter allows other parts of the application to access the Netron
   * instance for direct interaction with the distributed system.
   * 
   * @returns The Netron instance managed by this service
   */
  get instance(): Netron {
    return this.netron;
  }
}
