/**
 * Logger Module - Public API
 *
 * Provides structured logging with Pino backend, transports, and processors.
 *
 * @example
 * ```typescript
 * import { LoggerModule, LoggerService, Logger } from '@omnitron-dev/titan/module/logger';
 *
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
  LOGGER_SERVICE_TOKEN,
  LOGGER_OPTIONS_TOKEN,
  LOGGER_TRANSPORTS_TOKEN,
  LOGGER_PROCESSORS_TOKEN,
} from './logger.tokens.js';

// ============================================================================
// Types
// ============================================================================
export type {
  LogLevel,
  ILogger,
  ILoggerOptions,
  ILoggerModuleOptions,
  ITransport,
  ILogProcessor,
  ILoggerModule,
} from './logger.types.js';
