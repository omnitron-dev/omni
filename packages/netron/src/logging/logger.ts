import pino, { Logger, LoggerOptions } from 'pino';

import { defaultLoggingOptions } from './config';

class LoggerFactory {
  private static rootLogger: Logger = pino(defaultLoggingOptions);

  static getLogger(context?: Record<string, any>): Logger {
    if (context) {
      return this.rootLogger.child(context);
    }
    return this.rootLogger;
  }

  static overrideLogger(options: LoggerOptions) {
    this.rootLogger = pino({ ...defaultLoggingOptions, ...options });
  }
}

export const logger = LoggerFactory.getLogger();
export default LoggerFactory;
