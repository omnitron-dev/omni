/**
 * Test utilities for Netron tests
 */

import { jest } from '@jest/globals';
import { Writable } from 'node:stream';
import type { ILogger } from '../../src/modules/logger/logger.types.js';

/**
 * Creates a mock logger for testing
 */
export function createMockLogger(): ILogger {
  const createChildLogger = (context?: any): ILogger => {
    // Recursively create a new mock logger for child
    const childLogger = createMockLogger();
    // Merge context into child logger for debugging
    (childLogger as any)._context = context;
    return childLogger;
  };

  const logger = {
    trace: jest.fn((obj: any, msg?: string, ...args: any[]) => {}),
    debug: jest.fn((obj: any, msg?: string, ...args: any[]) => {}),
    info: jest.fn((obj: any, msg?: string, ...args: any[]) => {}),
    warn: jest.fn((obj: any, msg?: string, ...args: any[]) => {}),
    error: jest.fn((obj: any, msg?: string, ...args: any[]) => {}),
    fatal: jest.fn((obj: any, msg?: string, ...args: any[]) => {}),
    child: jest.fn(createChildLogger),
    time: jest.fn(() => jest.fn()),
    isLevelEnabled: jest.fn(() => true),
    _pino: {} as any,
    level: 'info' as any,
    setLevel: jest.fn(),
  };

  return logger as ILogger;
}

/**
 * Creates a logger that writes to a writable stream for testing log output
 */
export function createStreamLogger(writable: Writable, level: string = 'info'): ILogger {
  const logs: string[] = [];
  const levels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'];
  const currentLevelIdx = levels.indexOf(level);

  const logFn = (logLevel: string) => (obj: any, msg?: string) => {
    // Check if this log level should be output
    const logLevelIdx = levels.indexOf(logLevel);
    if (logLevelIdx > currentLevelIdx) {
      return; // Skip logs below current level
    }

    const logEntry = {
      level: logLevel,
      time: new Date().toISOString(),
      ...(typeof obj === 'string' ? { msg: obj } : obj),
      ...(msg ? { msg } : {}),
    };
    const logStr = JSON.stringify(logEntry);
    logs.push(logStr);
    writable.write(logStr + '\n');
  };

  const logger: ILogger = {
    trace: logFn('trace'),
    debug: logFn('debug'),
    info: logFn('info'),
    warn: logFn('warn'),
    error: logFn('error'),
    fatal: logFn('fatal'),
    child: (context?: any) => {
      // Create a child logger that includes context in all logs
      const childLogger = createStreamLogger(writable, level);
      const originalLogFns = {
        trace: childLogger.trace,
        debug: childLogger.debug,
        info: childLogger.info,
        warn: childLogger.warn,
        error: childLogger.error,
        fatal: childLogger.fatal,
      };

      Object.keys(originalLogFns).forEach((key) => {
        (childLogger as any)[key] = (obj: any, msg?: string) => {
          const mergedObj = typeof obj === 'string' ? { ...context, msg: obj } : { ...context, ...obj };
          (originalLogFns as any)[key](mergedObj, msg);
        };
      });

      return childLogger;
    },
    level: level as any,
    setLevel: jest.fn((newLevel: string) => {
      (logger as any).level = newLevel;
    }),
    isLevelEnabled: jest.fn((checkLevel: string) => {
      const checkIdx = levels.indexOf(checkLevel);
      return checkIdx <= currentLevelIdx;
    }),
  } as any;

  return logger;
}
/**
 * Creates a Netron server instance with WebSocket transport
 */
export async function createNetronServer(options: {
  port: number;
  logger?: any;
  transportOptions?: any;
}): Promise<any> {
  const { Netron } = await import('../../src/netron/netron.js');
  const { WebSocketTransport } = await import('../../src/netron/transport/websocket-transport.js');

  const logger = options.logger || createMockLogger();
  const server = new Netron(logger, {});

  server.registerTransport('ws', () => new WebSocketTransport());
  server.registerTransportServer('ws', {
    name: 'ws',
    options: { host: 'localhost', port: options.port },
  });

  // Set transport options if provided
  if (options.transportOptions) {
    server.setTransportOptions('ws', options.transportOptions);
  }

  return server;
}

/**
 * Creates a Netron client instance with WebSocket transport
 */
export async function createNetronClient(options?: { logger?: any; transportOptions?: any }): Promise<any> {
  const { Netron } = await import('../../src/netron/netron.js');
  const { WebSocketTransport } = await import('../../src/netron/transport/websocket-transport.js');

  const logger = options?.logger || createMockLogger();
  const client = new Netron(logger, {});

  client.registerTransport('ws', () => new WebSocketTransport());

  // Set transport options if provided
  if (options?.transportOptions) {
    client.setTransportOptions('ws', options.transportOptions);
  }

  // IMPORTANT: Call start() to register core tasks (abilities, subscribe, emit, etc.)
  // Even though we're not starting a server, start() registers essential tasks
  await client.start();

  return client;
}
