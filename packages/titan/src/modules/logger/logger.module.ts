/**
 * Logger Module for Titan Framework
 *
 * Provides centralized logging with Pino
 */

import { Module, Global } from '../../decorators/index.js';

import { LoggerService } from './logger.service.js';
import {
  LOGGER_TOKEN,
  LOGGER_SERVICE_TOKEN,
  LOGGER_OPTIONS_TOKEN,
  LOGGER_TRANSPORTS_TOKEN,
  LOGGER_PROCESSORS_TOKEN,
} from './logger.tokens.js';

import { CONFIG_SERVICE_TOKEN } from '../config/index.js';

import type { ILoggerModuleOptions, ITransport, ILogProcessor, ILogger } from './logger.types.js';

// Re-export types for convenience
export type {
  ILogger,
  ILoggerModule,
  ILoggerOptions,
  ILoggerModuleOptions,
  ITransport,
  ILogProcessor,
  LogLevel,
} from './logger.types.js';

// Re-export tokens
export {
  LOGGER_TOKEN,
  LOGGER_SERVICE_TOKEN,
  LOGGER_OPTIONS_TOKEN,
  LOGGER_TRANSPORTS_TOKEN,
  LOGGER_PROCESSORS_TOKEN,
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
    [
      LOGGER_SERVICE_TOKEN,
      {
        useClass: LoggerService,
        inject: [
          { token: LOGGER_OPTIONS_TOKEN, optional: true },
          { token: LOGGER_TRANSPORTS_TOKEN, optional: true },
          { token: LOGGER_PROCESSORS_TOKEN, optional: true },
          { token: CONFIG_SERVICE_TOKEN, optional: true },
        ],
        scope: 'singleton',
      },
    ] as any,
    // ILogger alias — derives the root logger from LoggerService
    [
      LOGGER_TOKEN,
      {
        useFactory: (loggerModule: any): ILogger => loggerModule?.logger,
        inject: [LOGGER_SERVICE_TOKEN],
        scope: 'singleton',
      },
    ] as any,
  ],
  exports: [LOGGER_SERVICE_TOKEN, LOGGER_TOKEN],
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
        [
          LOGGER_OPTIONS_TOKEN,
          {
            useValue: options,
          },
        ] as any,

        // Provide transports if specified
        ...(options.transports
          ? [
              [
                LOGGER_TRANSPORTS_TOKEN,
                {
                  useValue: options.transports,
                },
              ] as any,
            ]
          : []),

        // Provide processors if specified
        ...(options.processors
          ? [
              [
                LOGGER_PROCESSORS_TOKEN,
                {
                  useValue: options.processors,
                },
              ] as any,
            ]
          : []),

        // Main Logger Service
        [
          LOGGER_SERVICE_TOKEN,
          {
            // The optional ConfigService is injected here for the same reason
            // `forRootAsync` injects it: `LoggerService` reads `logger.level`,
            // `logger.prettyPrint`, `logger.redact`, `logger.base`,
            // `logger.timestamp` and `logger.messageKey` from it. Without it
            // those six keys are silently ignored — an app that sets
            // `logger.redact` in its config and wires the module with
            // `forRoot` gets no redaction and no indication that it asked for
            // any.
            //
            // Today no app trips it: the three downstream backends that configure
            // `logger.*` all use `forRootAsync`, and the three on `forRoot`
            // configure none. That alignment is a coincidence, not a design —
            // and the failure it hides is a config key that does nothing.
            useFactory: (configService?: any) =>
              // Options still come from the closure; config only fills gaps.
              new LoggerService(options, options.transports, options.processors, configService),
            inject: [{ token: CONFIG_SERVICE_TOKEN, optional: true }],
            scope: 'singleton',
          },
        ] as any,
        // ILogger alias
        [
          LOGGER_TOKEN,
          {
            useFactory: (loggerModule: any): ILogger => loggerModule?.logger,
            inject: [LOGGER_SERVICE_TOKEN],
            scope: 'singleton',
          },
        ] as any,
      ],
      exports: [LOGGER_SERVICE_TOKEN, LOGGER_TOKEN],
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
        [
          LOGGER_OPTIONS_TOKEN,
          {
            useFactory: options.useFactory,
            inject: options.inject || [],
          },
        ] as any,

        // Main Logger Service
        [
          LOGGER_SERVICE_TOKEN,
          {
            useFactory: (
              options_?: ILoggerModuleOptions,
              transports?: ITransport[],
              processors?: ILogProcessor[],
              configService?: any
            ) => new LoggerService(options_ || {}, transports, processors, configService),
            inject: [
              { token: LOGGER_OPTIONS_TOKEN, optional: true },
              { token: LOGGER_TRANSPORTS_TOKEN, optional: true },
              { token: LOGGER_PROCESSORS_TOKEN, optional: true },
              { token: CONFIG_SERVICE_TOKEN, optional: true },
            ],
            scope: 'singleton',
          },
        ] as any,
        // ILogger alias
        [
          LOGGER_TOKEN,
          {
            useFactory: (loggerModule: any): ILogger => loggerModule?.logger,
            inject: [LOGGER_SERVICE_TOKEN],
            scope: 'singleton',
          },
        ] as any,
      ],
      exports: [LOGGER_SERVICE_TOKEN, LOGGER_TOKEN],
    };
  }
}

/**
 * Console transport for testing
 */
export class ConsoleTransport implements ITransport {
  name = 'console';
  private logger?: ILogger;

  constructor(logger?: ILogger) {
    this.logger = logger;
  }

  write(log: any): void {
    this.logger?.info({ log }, 'Console transport log');
  }
}

/**
 * Redaction processor
 */
export class RedactionProcessor implements ILogProcessor {
  constructor(private paths: string[]) {}

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
