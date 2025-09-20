/**
 * Logger Module Tokens
 *
 * Dependency injection tokens for the logger module
 */

import { createToken, Token } from '@omnitron-dev/nexus';
import type { ILoggerModule, ILoggerOptions, ITransport, ILogProcessor } from './logger.types.js';

// Service token
export const LOGGER_SERVICE_TOKEN: Token<ILoggerModule> = createToken<ILoggerModule>('LoggerService');

// Options token
export const LOGGER_OPTIONS_TOKEN: Token<ILoggerOptions> = createToken<ILoggerOptions>('LoggerOptions');

// Transport token
export const LOGGER_TRANSPORTS_TOKEN: Token<ITransport[]> = createToken<ITransport[]>('LoggerTransports');

// Processor token
export const LOGGER_PROCESSORS_TOKEN: Token<ILogProcessor[]> = createToken<ILogProcessor[]>('LoggerProcessors');