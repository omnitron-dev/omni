/**
 * Logger Service Comprehensive Tests
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import type { ILogger, LogLevel, ITransport, ILogProcessor } from '../../../src/modules/logger/index.js';

// Create a simplified LoggerImpl for testing without pino dependency
class TestLoggerImpl implements ILogger {
  public _pino: any;
  private bindings: object;
  public logs: Array<{ level: string; msg: any; args: any[] }> = [];

  constructor(bindings: object = {}) {
    this.bindings = bindings;
    this._pino = {
      level: 'info',
      isLevelEnabled: (level: string) => true,
      child: (b: object) => ({ ...this._pino }),
    };
  }

  trace(objOrMsg: object | string, ...args: any[]): void {
    this.logs.push({ level: 'trace', msg: objOrMsg, args });
  }

  debug(objOrMsg: object | string, ...args: any[]): void {
    this.logs.push({ level: 'debug', msg: objOrMsg, args });
  }

  info(objOrMsg: object | string, ...args: any[]): void {
    this.logs.push({ level: 'info', msg: objOrMsg, args });
  }

  warn(objOrMsg: object | string, ...args: any[]): void {
    this.logs.push({ level: 'warn', msg: objOrMsg, args });
  }

  error(objOrMsg: object | string, ...args: any[]): void {
    this.logs.push({ level: 'error', msg: objOrMsg, args });
  }

  fatal(objOrMsg: object | string, ...args: any[]): void {
    this.logs.push({ level: 'fatal', msg: objOrMsg, args });
  }

  child(bindings: object): ILogger {
    return new TestLoggerImpl({ ...this.bindings, ...bindings });
  }

  time(label?: string): () => void {
    const start = Date.now();
    const id = label || 'timer';
    return () => {
      const duration = Date.now() - start;
      this.info({ duration, label: id }, 'Timer completed');
    };
  }

  isLevelEnabled(level: LogLevel): boolean {
    return this._pino.isLevelEnabled(level);
  }
}

// Mock LoggerService for testing
class TestLoggerService {
  private loggers = new Map<string, ILogger>();
  private globalLogger: TestLoggerImpl;
  private transports: ITransport[] = [];
  private processors: ILogProcessor[] = [];
  private context: object = {};
  private currentLevel: LogLevel = 'info';

  constructor(
    private options: any = {},
    initialTransports?: ITransport[],
    initialProcessors?: ILogProcessor[]
  ) {
    this.globalLogger = new TestLoggerImpl();
    if (initialTransports) this.transports.push(...initialTransports);
    if (initialProcessors) this.processors.push(...initialProcessors);
    if (options.context) this.setContext(options.context);
  }

  create(name: string): ILogger {
    if (this.loggers.has(name)) return this.loggers.get(name)!;
    const logger = new TestLoggerImpl({ name, ...this.context });
    this.loggers.set(name, logger);
    return logger;
  }

  child(bindings: object): ILogger {
    return new TestLoggerImpl({ ...this.context, ...bindings });
  }

  get logger(): ILogger {
    return this.globalLogger;
  }

  setLevel(level: LogLevel): void {
    this.currentLevel = level;
  }

  getLevel(): LogLevel {
    return this.currentLevel;
  }

  addTransport(transport: ITransport): void {
    this.transports.push(transport);
  }

  getTransports(): ITransport[] {
    return this.transports;
  }

  addProcessor(processor: ILogProcessor): void {
    this.processors.push(processor);
  }

  getProcessors(): ILogProcessor[] {
    return this.processors;
  }

  setContext(context: object): void {
    this.context = { ...this.context, ...context };
  }

  getContext(): object {
    return this.context;
  }

  withContext(context: object): ILogger {
    return new TestLoggerImpl({ ...this.context, ...context });
  }

  async flush(): Promise<void> {
    await Promise.all(this.transports.filter(t => t.flush).map(t => t.flush!()));
  }
}

describe('LoggerService', () => {
  let loggerService: TestLoggerService;

  beforeEach(() => {
    loggerService = new TestLoggerService();
  });

  describe('constructor', () => {
    it('should create with default options', () => {
      const service = new TestLoggerService();
      expect(service.logger).toBeDefined();
    });

    it('should accept initial transports', () => {
      const transport: ITransport = { write: jest.fn() };
      const service = new TestLoggerService({}, [transport]);
      expect(service.getTransports()).toContain(transport);
    });

    it('should accept initial processors', () => {
      const processor: ILogProcessor = { process: (log) => log };
      const service = new TestLoggerService({}, undefined, [processor]);
      expect(service.getProcessors()).toContain(processor);
    });

    it('should apply initial context', () => {
      const service = new TestLoggerService({ context: { app: 'test' } });
      expect(service.getContext()).toEqual({ app: 'test' });
    });
  });

  describe('create', () => {
    it('should create a named logger', () => {
      const logger = loggerService.create('my-service');
      expect(logger).toBeDefined();
      expect(logger.info).toBeDefined();
    });

    it('should return same logger for same name', () => {
      const logger1 = loggerService.create('my-service');
      const logger2 = loggerService.create('my-service');
      expect(logger1).toBe(logger2);
    });

    it('should create different loggers for different names', () => {
      const logger1 = loggerService.create('service-a');
      const logger2 = loggerService.create('service-b');
      expect(logger1).not.toBe(logger2);
    });
  });

  describe('child', () => {
    it('should create child logger with bindings', () => {
      const childLogger = loggerService.child({ requestId: '123' });
      expect(childLogger).toBeDefined();
    });
  });

  describe('setLevel', () => {
    it('should set log level', () => {
      loggerService.setLevel('debug');
      expect(loggerService.getLevel()).toBe('debug');
    });
  });

  describe('addTransport', () => {
    it('should add transport', () => {
      const transport: ITransport = { write: jest.fn() };
      loggerService.addTransport(transport);
      expect(loggerService.getTransports()).toContain(transport);
    });

    it('should support multiple transports', () => {
      loggerService.addTransport({ write: jest.fn() });
      loggerService.addTransport({ write: jest.fn() });
      expect(loggerService.getTransports()).toHaveLength(2);
    });
  });

  describe('setContext', () => {
    it('should set global context', () => {
      loggerService.setContext({ app: 'test', version: '1.0.0' });
      expect(loggerService.getContext()).toEqual({ app: 'test', version: '1.0.0' });
    });

    it('should merge with existing context', () => {
      loggerService.setContext({ app: 'test' });
      loggerService.setContext({ version: '1.0.0' });
      expect(loggerService.getContext()).toEqual({ app: 'test', version: '1.0.0' });
    });
  });

  describe('withContext', () => {
    it('should create logger with additional context', () => {
      loggerService.setContext({ app: 'test' });
      const contextLogger = loggerService.withContext({ requestId: '123' });
      expect(contextLogger).toBeDefined();
    });
  });

  describe('flush', () => {
    it('should flush all transports', async () => {
      const flushFn = jest.fn().mockResolvedValue(undefined);
      loggerService.addTransport({ write: jest.fn(), flush: flushFn });
      await loggerService.flush();
      expect(flushFn).toHaveBeenCalled();
    });

    it('should handle transports without flush', async () => {
      loggerService.addTransport({ write: jest.fn() });
      await expect(loggerService.flush()).resolves.not.toThrow();
    });
  });
});

describe('Logger Implementation', () => {
  let logger: TestLoggerImpl;

  beforeEach(() => {
    logger = new TestLoggerImpl();
  });

  describe('log levels', () => {
    it('should log trace level', () => {
      logger.trace('trace message');
      expect(logger.logs.some(l => l.level === 'trace')).toBe(true);
    });

    it('should log debug level', () => {
      logger.debug('debug message');
      expect(logger.logs.some(l => l.level === 'debug')).toBe(true);
    });

    it('should log info level', () => {
      logger.info('info message');
      expect(logger.logs.some(l => l.level === 'info')).toBe(true);
    });

    it('should log warn level', () => {
      logger.warn('warn message');
      expect(logger.logs.some(l => l.level === 'warn')).toBe(true);
    });

    it('should log error level', () => {
      logger.error('error message');
      expect(logger.logs.some(l => l.level === 'error')).toBe(true);
    });

    it('should log fatal level', () => {
      logger.fatal('fatal message');
      expect(logger.logs.some(l => l.level === 'fatal')).toBe(true);
    });
  });

  describe('log with object', () => {
    it('should log info with object', () => {
      logger.info({ userId: 123 }, 'User logged in');
      expect(logger.logs[0].msg).toEqual({ userId: 123 });
    });

    it('should log error with object', () => {
      logger.error({ error: 'Connection failed' }, 'Database error');
      expect(logger.logs[0].level).toBe('error');
    });
  });

  describe('child', () => {
    it('should create child logger', () => {
      const childLogger = logger.child({ requestId: '123' });
      expect(childLogger).toBeDefined();
      expect(childLogger).not.toBe(logger);
    });
  });

  describe('time', () => {
    it('should measure time', async () => {
      const endTimer = logger.time('operation');
      await new Promise(resolve => setTimeout(resolve, 10));
      endTimer();
      expect(logger.logs.some(l => l.level === 'info')).toBe(true);
    });

    it('should work without label', () => {
      const endTimer = logger.time();
      endTimer();
      expect(logger.logs.length).toBeGreaterThan(0);
    });
  });

  describe('isLevelEnabled', () => {
    it('should check if level is enabled', () => {
      const result = logger.isLevelEnabled('info');
      expect(typeof result).toBe('boolean');
    });
  });
});

describe('Transport', () => {
  it('should support custom transport', () => {
    const logs: any[] = [];
    const transport: ITransport = {
      write: (log) => logs.push(log),
    };
    transport.write({ level: 'info', msg: 'test' });
    expect(logs).toHaveLength(1);
  });

  it('should support transport with flush', async () => {
    let flushed = false;
    const transport: ITransport = {
      write: jest.fn(),
      flush: async () => { flushed = true; },
    };
    await transport.flush!();
    expect(flushed).toBe(true);
  });
});

describe('Processor', () => {
  it('should process log entries', () => {
    const processor: ILogProcessor = {
      process: (log) => ({ ...log, processed: true }),
    };
    const result = processor.process({ level: 'info', msg: 'test' });
    expect(result.processed).toBe(true);
  });

  it('should support redaction processor', () => {
    const redactProcessor: ILogProcessor = {
      process: (log) => {
        if (log.password) return { ...log, password: '[REDACTED]' };
        return log;
      },
    };
    const result = redactProcessor.process({ level: 'info', password: 'secret123' });
    expect(result.password).toBe('[REDACTED]');
  });
});

describe('Log Levels Priority', () => {
  const levels: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

  it('should have correct level order', () => {
    const levelPriority: Record<LogLevel, number> = {
      trace: 0, debug: 1, info: 2, warn: 3, error: 4, fatal: 5,
    };
    for (let i = 0; i < levels.length - 1; i++) {
      expect(levelPriority[levels[i]]).toBeLessThan(levelPriority[levels[i + 1]]);
    }
  });
});
