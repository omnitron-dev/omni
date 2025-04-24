import { LoggerLevel } from '../../types/common';

export interface LogFormatter {
  format(level: LoggerLevel, message: string, meta?: Record<string, any>): string;
}

export class JsonLogFormatter implements LogFormatter {
  format(level: LoggerLevel, message: string, meta?: Record<string, any>): string {
    return JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message,
      meta,
    });
  }
}

export class SimpleLogFormatter implements LogFormatter {
  format(level: LoggerLevel, message: string, meta?: Record<string, any>): string {
    const timestamp = new Date().toISOString();
    const metaString = meta ? ` | ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaString}`;
  }
}
