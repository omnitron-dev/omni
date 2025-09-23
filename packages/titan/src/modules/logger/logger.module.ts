/**
 * Logger Module for Titan Framework
 *
 * Provides centralized logging with Pino
 */

import { Module, Global } from '../../nexus/index.js';

import { LoggerService } from './logger.service.js';
import {
  LOGGER_SERVICE_TOKEN,
  LOGGER_OPTIONS_TOKEN,
  LOGGER_TRANSPORTS_TOKEN,
  LOGGER_PROCESSORS_TOKEN
} from './logger.tokens.js';

import { CONFIG_SERVICE_TOKEN } from '../config/config.tokens.js';

import type {
  ILoggerModuleOptions,
  ITransport,
  ILogProcessor
} from './logger.types.js';

// Re-export types for convenience
export type {
  ILogger,
  ILoggerModule,
  ILoggerOptions,
  ILoggerModuleOptions,
  ITransport,
  ILogProcessor,
  LogLevel
} from './logger.types.js';

// Re-export tokens
export {
  LOGGER_SERVICE_TOKEN,
  LOGGER_OPTIONS_TOKEN,
  LOGGER_TRANSPORTS_TOKEN,
  LOGGER_PROCESSORS_TOKEN
} from './logger.tokens.js';

/**
 * Global Logger Module
 *
 * Provides logging capabilities to the entire application
 */

@Global()
@Module({
  providers: [
    // Main Logger Service
    [LOGGER_SERVICE_TOKEN, {
      useClass: LoggerService,
      inject: [
        [LOGGER_OPTIONS_TOKEN, { optional: true }],
        [LOGGER_TRANSPORTS_TOKEN, { optional: true }],
        [LOGGER_PROCESSORS_TOKEN, { optional: true }],
        [CONFIG_SERVICE_TOKEN, { optional: true }]
      ],
      scope: 'singleton'
    }] as any
  ],
  exports: [
    LOGGER_SERVICE_TOKEN
  ]
})
export class LoggerModule {
  /**
   * Configure the Logger module with options
   */
  static forRoot(options: ILoggerModuleOptions = {}): any {
    return {
      module: LoggerModule,
      providers: [
        // Provide options
        [LOGGER_OPTIONS_TOKEN, {
          useValue: options
        }] as any,

        // Provide transports if specified
        ...(options.transports ? [
          [LOGGER_TRANSPORTS_TOKEN, {
            useValue: options.transports
          }] as any
        ] : []),

        // Provide processors if specified
        ...(options.processors ? [
          [LOGGER_PROCESSORS_TOKEN, {
            useValue: options.processors
          }] as any
        ] : []),

        // Main Logger Service
        [LOGGER_SERVICE_TOKEN, {
          useClass: LoggerService,
          scope: 'singleton'
        }] as any
      ],
      exports: [
        LOGGER_SERVICE_TOKEN
      ]
    };
  }

  /**
   * Configure the Logger module asynchronously
   */
  static forRootAsync(options: {
    useFactory: (...args: any[]) => Promise<ILoggerModuleOptions> | ILoggerModuleOptions;
    inject?: any[];
  }): any {
    return {
      module: LoggerModule,
      providers: [
        // Provide options asynchronously
        [LOGGER_OPTIONS_TOKEN, {
          useFactory: options.useFactory,
          inject: options.inject || []
        }] as any,

        // Main Logger Service
        [LOGGER_SERVICE_TOKEN, {
          useClass: LoggerService,
          scope: 'singleton'
        }] as any
      ],
      exports: [
        LOGGER_SERVICE_TOKEN
      ]
    };
  }
}


/**
 * Console transport for testing
 */
export class ConsoleTransport implements ITransport {
  name = 'console';

  write(log: any): void {
    console.log(JSON.stringify(log));
  }
}

/**
 * Redaction processor
 */
export class RedactionProcessor implements ILogProcessor {
  constructor(private paths: string[]) { }

  process(log: any): any {
    const processed = { ...log };

    for (const path of this.paths) {
      const parts = path.split('.');
      let current = processed;

      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (!part || !current[part]) break;
        current = current[part];
      }

      if (current && parts.length > 0) {
        const lastPart = parts[parts.length - 1];
        if (lastPart && lastPart in current) {
          current[lastPart] = '[REDACTED]';
        }
      }
    }

    return processed;
  }
}