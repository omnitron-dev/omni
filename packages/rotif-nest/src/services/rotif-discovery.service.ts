import { Reflector, DiscoveryService } from '@nestjs/core';
import {
  Logger,
  Injectable,
  OnModuleInit,
} from '@nestjs/common';

import { RotifService } from './rotif.service';
import { ROTIF_SUBSCRIBE_METADATA } from '../constants';
import { RotifSubscribeMetadata } from '../decorators/rotif-subscribe.decorator';

/**
 * Service responsible for automatically discovering and registering message handlers
 * decorated with @RotifSubscribe in a NestJS application. This service uses NestJS's
 * discovery system to find all methods decorated with @RotifSubscribe and sets up
 * the appropriate subscriptions during module initialization.
 *
 * The discovery process happens during the onModuleInit lifecycle hook, ensuring
 * that all handlers are registered before the application starts processing requests.
 *
 * @example
 * // Example of a handler that will be automatically discovered
 * ＠Injectable()
 * export class OrdersHandler {
 *   ＠RotifSubscribe('orders.created', {
 *     group: 'order-processor',
 *     maxRetries: 3
 *   })
 *   async handleOrderCreated(message: RotifMessage) {
 *     // Handler implementation
 *   }
 * }
 */
@Injectable()
export class RotifDiscoveryService implements OnModuleInit {
  private readonly logger = new Logger(RotifDiscoveryService.name);

  constructor(
    private readonly discoveryService: DiscoveryService,
    private readonly reflector: Reflector,
    private readonly rotifService: RotifService,
  ) { }

  /**
   * Lifecycle hook that runs when the module is initialized.
   * This method performs the discovery and registration of all @RotifSubscribe
   * decorated methods in the application.
   *
   * The discovery process:
   * 1. Finds all providers in the application using DiscoveryService
   * 2. For each provider, examines its prototype methods
   * 3. Checks each method for @RotifSubscribe metadata
   * 4. If metadata is found, registers a subscription using RotifService
   *
   * @throws Error if registration of any handler fails
   *
   * The discovery process is automatic and requires no additional configuration
   * beyond decorating methods with @RotifSubscribe. This enables a declarative
   * approach to setting up message handlers in the application.
   */
  async onModuleInit() {
    const providers = this.discoveryService.getProviders();

    for (const provider of providers) {
      const { instance } = provider;

      // Skip if provider has no instance or is not an object
      if (!instance || typeof instance !== 'object') continue;

      const prototype = Object.getPrototypeOf(instance);
      // Get all method names except constructor
      const methods = Object.getOwnPropertyNames(prototype).filter(
        (method) => method !== 'constructor' && typeof prototype[method] === 'function',
      );

      // Check each method for @RotifSubscribe metadata
      methods.forEach((methodName) => {
        const metadata = this.reflector.get<RotifSubscribeMetadata>(
          ROTIF_SUBSCRIBE_METADATA,
          prototype[methodName],
        );

        if (metadata) {
          this.logger.debug(`Registering handler for "${metadata.pattern}"`);

          // Register the subscription with the handler bound to the instance
          this.rotifService.subscribe(
            metadata.pattern,
            (msg) => instance[methodName](msg),
            metadata.options,
          );
        }
      });
    }
  }
}
