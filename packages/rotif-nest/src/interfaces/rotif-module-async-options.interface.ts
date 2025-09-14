import { Type, ModuleMetadata } from '@nestjs/common';

import { RotifModuleOptions } from './rotif-module-options.interface';

/**
 * Interface defining async configuration options for the RotifModule.
 * This interface extends ModuleMetadata to support NestJS's dynamic module
 * pattern, allowing for configuration to be loaded asynchronously from
 * various sources (e.g., ConfigService, environment variables, etc.).
 *
 * @example
 * ```typescript
 * // Using useFactory
 * RotifModule.registerAsync({
 *   imports: [ConfigModule],
 *   useFactory: (config: ConfigService) => ({
 *     redis: config.get('REDIS_URL'),
 *     exactlyOnce: true
 *   }),
 *   inject: [ConfigService]
 * });
 *
 * // Using useClass
 * RotifModule.registerAsync({
 *   useClass: RotifConfigService
 * });
 *
 * // Using useExisting
 * RotifModule.registerAsync({
 *   useExisting: ConfigService
 * });
 * ```
 */
export interface RotifModuleAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
  /**
   * Factory function that returns module options or a promise of module options.
   * This is the most flexible way to configure the module as it allows for
   * async configuration and dependency injection.
   */
  useFactory?: (...args: any[]) => Promise<RotifModuleOptions> | RotifModuleOptions;

  /**
   * Array of dependencies that should be injected into the factory function.
   * These dependencies must be available in the module context.
   */
  inject?: any[];

  /**
   * Class that implements RotifModuleOptionsFactory.
   * The class will be instantiated and used to create the module options.
   */
  useClass?: Type<RotifModuleOptionsFactory>;

  /**
   * Existing provider that implements RotifModuleOptionsFactory.
   * The existing instance will be used to create the module options.
   */
  useExisting?: Type<RotifModuleOptionsFactory>;
}

/**
 * Interface that must be implemented by classes that provide
 * configuration options for the RotifModule.
 *
 * @example
 * ```typescript
 * ＠Injectable()
 * export class RotifConfigService implements RotifModuleOptionsFactory {
 *   constructor(private configService: ConfigService) {}
 *
 *   async createRotifModuleOptions(): Promise<RotifModuleOptions> {
 *     return {
 *       redis: this.configService.get('REDIS_URL'),
 *       exactlyOnce: true,
 *       deduplication: {
 *         type: 'redis',
 *         ttlSeconds: 3600
 *       }
 *     };
 *   }
 * }
 * ```
 */
export interface RotifModuleOptionsFactory {
  /**
   * Method that returns module options or a promise of module options.
   * This method will be called during module initialization to get
   * the configuration.
   *
   * @returns Promise resolving to module options or module options directly
   */
  createRotifModuleOptions(): Promise<RotifModuleOptions> | RotifModuleOptions;
}