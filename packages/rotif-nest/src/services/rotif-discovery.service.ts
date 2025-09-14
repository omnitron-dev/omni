import { Logger, Injectable, OnModuleInit } from '@nestjs/common';
import { Reflector, MetadataScanner, DiscoveryService } from '@nestjs/core';

import { RotifService } from './rotif.service';
import { ROTIF_SUBSCRIBE_METADATA } from '../constants';
import { RotifSubscribeMetadata } from '../decorators/rotif-subscribe.decorator';

/**
 * RotifDiscoveryService automatically discovers and registers methods decorated
 * with the @RotifSubscribe decorator at application startup. It uses NestJS's DiscoveryService
 * and MetadataScanner to scan controllers and providers reliably.
 */
@Injectable()
export class RotifDiscoveryService implements OnModuleInit {
  private readonly logger = new Logger(RotifDiscoveryService.name);

  constructor(
    private readonly discoveryService: DiscoveryService,
    private readonly metadataScanner: MetadataScanner,
    private readonly reflector: Reflector,
    private readonly rotifService: RotifService,
  ) { }

  /**
   * This lifecycle hook is executed when the module has been initialized.
   * It triggers the discovery and registration of Rotif handlers.
   */
  onModuleInit() {
    this.exploreHandlers();
  }

  /**
   * Explores providers and controllers to find methods annotated with @RotifSubscribe,
   * and registers them with the RotifService.
   */
  private exploreHandlers(): void {
    const wrappers = [
      ...this.discoveryService.getProviders(),
      ...this.discoveryService.getControllers(),
    ];

    wrappers.forEach((wrapper) => {
      const { instance, metatype } = wrapper;

      if (!instance || !metatype || typeof instance !== 'object') {
        return;
      }

      const prototype = Object.getPrototypeOf(instance);
      if (!prototype) return;

      this.metadataScanner.scanFromPrototype(instance, prototype, (methodName: string) => {
        if (!wrapper.isDependencyTreeStatic()) {
          this.logger.warn(
            `Cannot register handler "${wrapper.name}@${methodName}" because it is defined in a non-static provider.`,
          );
          return;
        }

        const handler = prototype[methodName];
        const metadata = this.reflector.get<RotifSubscribeMetadata>(
          ROTIF_SUBSCRIBE_METADATA,
          handler,
        );

        if (metadata) {
          this.logger.debug(
            `Registering Rotif handler "${wrapper.name}@${methodName}" for pattern "${metadata.pattern}".`,
          );

          this.rotifService.subscribe(
            metadata.pattern,
            this.wrapHandlerWithErrorHandling(instance, handler, wrapper.name, methodName),
            metadata.options,
          );
        }
      });
    });
  }

  /**
   * Wraps handler execution in a try-catch block to ensure robust error handling
   * and prevent unexpected termination of the handler lifecycle.
   *
   * @param instance - Instance of the class containing the handler method
   * @param handler - Method reference of the handler
   * @param providerName - Name of the provider class
   * @param methodName - Name of the handler method
   */
  private wrapHandlerWithErrorHandling(
    instance: any,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    handler: Function,
    providerName: string,
    methodName: string,
  ) {
    return async (...args: any[]) => {
      try {
        await handler.apply(instance, args);
      } catch (error: any) {
        this.logger.error(
          `Error in Rotif handler "${providerName}@${methodName}": ${error.message}`,
          error.stack,
        );
      }
    };
  }
}
