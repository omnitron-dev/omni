/**
 * Logger Module for Titan Framework
 *
 * Provides structured logging with Pino backend:
 * - Multiple transports (console, file, remote)
 * - Log processors for transformation and redaction
 * - Decorators for automatic logging
 * - Performance monitoring
 *
 * @module @omnitron-dev/titan/module/logger
 *
 * @example
 * ```typescript
 * import {
 *   LoggerModule,
 *   LoggerService,
 *   Logger,
 *   LOGGER_SERVICE_TOKEN
 * } from '@omnitron-dev/titan/module/logger';
 *
 * // Configure module
 * @Module({
 *   imports: [LoggerModule.forRoot({ level: 'info' })]
 * })
 * class AppModule {}
 *
 * // Use with decorator
 * @Injectable()
 * class MyService {
 *   @Logger() private logger!: ILogger;
 *
 *   doWork() {
 *     this.logger.info('Processing started');
 *   }
 * }
 *
 * // Or inject directly
 * @Injectable()
 * class MyService {
 *   constructor(@Inject(LOGGER_SERVICE_TOKEN) private logger: LoggerService) {}
 * }
 * ```
 */

// ============================================================================
// Module
// ============================================================================

export { LoggerModule } from './logger.module.js';

// ============================================================================
// Services
// ============================================================================

export { LoggerService } from './logger.service.js';

// ============================================================================
// Built-in Transports and Processors
// ============================================================================

export { ConsoleTransport, RedactionProcessor } from './logger.module.js';

// ============================================================================
// Decorators
// ============================================================================

export { Logger, Log, Monitor } from './logger.decorators.js';

// ============================================================================
// Tokens (for DI)
// ============================================================================

export {
  LOGGER_TOKEN,
  LOGGER_SERVICE_TOKEN,
  LOGGER_OPTIONS_TOKEN,
  LOGGER_TRANSPORTS_TOKEN,
  LOGGER_PROCESSORS_TOKEN,
} from './logger.tokens.js';

// ============================================================================
// Types & Interfaces
// ============================================================================

export type {
  // Log levels
  LogLevel,

  // Core interfaces
  ILogger,
  ILoggerOptions,
  ILoggerModuleOptions,
  ILoggerModule,

  // Transport and processor interfaces
  ITransport,
  ILogProcessor,
} from './logger.types.js';

// ============================================================================
// Utilities
// ============================================================================

export { createNullLogger, isLogger } from './logger.types.js';
