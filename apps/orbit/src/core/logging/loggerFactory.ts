import { StructuredLogger } from './logger';
import { Logger, LoggerLevel } from '../../types/common';
import { LogFormatter, JsonLogFormatter, SimpleLogFormatter } from './logFormatter';

export type LoggerFormat = 'json' | 'simple';

export interface LoggerFactoryOptions {
  format?: LoggerFormat;
  level?: LoggerLevel;
}

export class LoggerFactory {
  static createLogger(options?: LoggerFactoryOptions): Logger {
    const formatter: LogFormatter = options?.format === 'json'
      ? new JsonLogFormatter()
      : new SimpleLogFormatter();

    return new StructuredLogger(formatter, options?.level || 'info');
  }
}
