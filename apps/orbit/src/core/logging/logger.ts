import { LogFormatter } from './logFormatter';
import { Logger, LoggerLevel } from '../../types/common';

export class StructuredLogger implements Logger {
  constructor(private formatter: LogFormatter, private minLevel: LoggerLevel = 'info') { }

  private levelPriority: Record<LoggerLevel, number> = {
    trace: 0,
    debug: 1,
    info: 2,
    warn: 3,
    error: 4,
  };

  log(level: LoggerLevel, message: string, meta?: Record<string, any>): void {
    if (this.levelPriority[level] >= this.levelPriority[this.minLevel]) {
      console.log(this.formatter.format(level, message, meta));
    }
  }

  trace(message: string, meta?: Record<string, any>): void {
    this.log('trace', message, meta);
  }

  debug(message: string, meta?: Record<string, any>): void {
    this.log('debug', message, meta);
  }

  info(message: string, meta?: Record<string, any>): void {
    this.log('info', message, meta);
  }

  warn(message: string, meta?: Record<string, any>): void {
    this.log('warn', message, meta);
  }

  error(message: string, meta?: Record<string, any>): void {
    this.log('error', message, meta);
  }
}
