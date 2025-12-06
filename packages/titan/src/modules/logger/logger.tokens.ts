/**
 * Logger Module Tokens
 *
 * Dependency injection tokens for the logger module
 */

import { createToken, Token } from '../../nexus/index.js';
import type { ILogger, ILoggerModule, ILoggerOptions, ITransport, ILogProcessor } from './logger.types.js';

/**
 * Generic logger token for simple ILogger injection.
 * Use this when you only need basic logging functionality.
 * This is the canonical LOGGER_TOKEN - all modules should import from here.
 */
export const LOGGER_TOKEN: Token<ILogger> = createToken<ILogger>('Logger');

/**
 * Logger module service token for full LoggerModule functionality.
 * Use this when you need advanced features like transports, processors, context.
 */
export const LOGGER_SERVICE_TOKEN: Token<ILoggerModule> = createToken<ILoggerModule>('LoggerService');

// Options token
export const LOGGER_OPTIONS_TOKEN: Token<ILoggerOptions> = createToken<ILoggerOptions>('LoggerOptions');

// Transport token
export const LOGGER_TRANSPORTS_TOKEN: Token<ITransport[]> = createToken<ITransport[]>('LoggerTransports');

// Processor token
export const LOGGER_PROCESSORS_TOKEN: Token<ILogProcessor[]> = createToken<ILogProcessor[]>('LoggerProcessors');
