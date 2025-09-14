import { Type } from '@nestjs/common';
import { Middleware, RotifConfig } from '@omnitron-dev/rotif';

/**
 * Configuration options for message deduplication.
 * Defines how duplicate messages should be detected and handled.
 */
export interface RotifDeduplicationOptions {
  /**
   * Time-to-live in seconds for deduplication records.
   * After this period, a message with the same ID will be
   * processed again. Defaults to 3600 (1 hour).
   */
  ttlSeconds?: number;
}

/**
 * Configuration options for the RotifModule.
 * Extends the base RotifConfig from @omnitron-dev/rotif with NestJS-specific
 * options for middleware, exception filters, and interceptors.
 *
 * @example
 * ```typescript
 * RotifModule.register({
 *   redis: 'redis://localhost:6379',
 *   middleware: [LoggingMiddleware],
 *   globalExceptionFilters: [RotifExceptionFilter],
 *   globalInterceptors: [RotifLoggingInterceptor],
 *   exactlyOnce: true,
 *   deduplication: {
 *     ttlSeconds: 3600
 *   }
 * });
 * ```
 */
export interface RotifModuleOptions extends RotifConfig {
  /**
   * Array of middleware to apply to all message processing.
   * Middleware can intercept and modify messages before and after
   * processing, as well as handle errors.
   */
  middleware?: Middleware[];

  /**
   * Array of exception filter types to apply globally.
   * These filters will catch and handle errors thrown during
   * message processing.
   */
  globalExceptionFilters?: Type<any>[];

  /**
   * Array of interceptor types to apply globally.
   * These interceptors can transform messages before and after
   * processing, as well as handle timing and metrics.
   */
  globalInterceptors?: Type<any>[];

  /**
   * Enable exactly-once message processing.
   * When true, ensures that each message is processed exactly
   * once, even in case of retries or multiple deliveries.
   */
  exactlyOnce?: boolean;

  /**
   * Configuration for message deduplication.
   * Required when exactlyOnce is true. Specifies how
   * duplicate messages should be detected and handled.
   */
  deduplication?: RotifDeduplicationOptions;
}