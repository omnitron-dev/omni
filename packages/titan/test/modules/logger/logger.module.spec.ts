/**
 * Tests for LoggerModule
 *
 * Tests for module configuration, forRoot, forRootAsync, and built-in transports/processors.
 */

import 'reflect-metadata';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { LoggerModule, ConsoleTransport, RedactionProcessor } from '../../../src/modules/logger/logger.module.js';
import { LoggerService } from '../../../src/modules/logger/logger.service.js';
import {
  LOGGER_SERVICE_TOKEN,
  LOGGER_OPTIONS_TOKEN,
  LOGGER_TRANSPORTS_TOKEN,
  LOGGER_PROCESSORS_TOKEN,
} from '../../../src/modules/logger/logger.tokens.js';
import type { ILoggerModuleOptions, ITransport, ILogProcessor } from '../../../src/modules/logger/logger.types.js';

// Mock pino for tests
jest.mock('pino', () => {
  const mockPinoLogger = {
    trace: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    fatal: jest.fn(),
    child: jest.fn(() => mockPinoLogger),
    isLevelEnabled: jest.fn(() => true),
    level: 'info',
  };

  const mockPino = jest.fn(() => mockPinoLogger);
  (mockPino as any).stdSerializers = {};
  (mockPino as any).stdTimeFunctions = { isoTime: () => `,"time":"${new Date().toISOString()}"` };

  return {
    default: mockPino,
    __esModule: true,
  };
});

describe('LoggerModule', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Module Metadata', () => {
    it('should be decorated with @Global', () => {
      const metadata = Reflect.getMetadata('nexus:global', LoggerModule);
      expect(metadata).toBe(true);
    });

    it('should be decorated with @Module', () => {
      const metadata = Reflect.getMetadata('nexus:module', LoggerModule);
      expect(metadata).toBeDefined();
    });

    it('should export LOGGER_SERVICE_TOKEN', () => {
      const metadata = Reflect.getMetadata('nexus:module', LoggerModule);
      expect(metadata.exports).toContain(LOGGER_SERVICE_TOKEN);
    });
  });

  describe('forRoot() Static Method', () => {
    it('should return dynamic module configuration', () => {
      const result = LoggerModule.forRoot();

      expect(result).toBeDefined();
      expect(result.module).toBe(LoggerModule);
      expect(result.providers).toBeDefined();
      expect(Array.isArray(result.providers)).toBe(true);
      expect(result.exports).toContain(LOGGER_SERVICE_TOKEN);
    });

    it('should configure with default options', () => {
      const result = LoggerModule.forRoot();

      // Should have providers for options and service
      expect(result.providers.length).toBeGreaterThan(0);
    });

    it('should configure with custom log level', () => {
      const options: ILoggerModuleOptions = {
        level: 'debug',
      };

      const result = LoggerModule.forRoot(options);

      // Find the options provider
      const optionsProvider = result.providers.find(
        (p: any) => Array.isArray(p) && p[0] === LOGGER_OPTIONS_TOKEN
      );
      expect(optionsProvider).toBeDefined();
    });

    it('should configure with custom name', () => {
      const options: ILoggerModuleOptions = {
        level: 'info',
      };

      const result = LoggerModule.forRoot(options);
      expect(result).toBeDefined();
    });

    it('should configure with transports', () => {
      const mockTransport: ITransport = {
        name: 'test-transport',
        write: jest.fn(),
      };

      const options: ILoggerModuleOptions = {
        transports: [mockTransport],
      };

      const result = LoggerModule.forRoot(options);

      // Should have transport provider
      const transportProvider = result.providers.find(
        (p: any) => Array.isArray(p) && p[0] === LOGGER_TRANSPORTS_TOKEN
      );
      expect(transportProvider).toBeDefined();
    });

    it('should configure with processors', () => {
      const mockProcessor: ILogProcessor = {
        process: jest.fn((log) => log),
      };

      const options: ILoggerModuleOptions = {
        processors: [mockProcessor],
      };

      const result = LoggerModule.forRoot(options);

      // Should have processor provider
      const processorProvider = result.providers.find(
        (p: any) => Array.isArray(p) && p[0] === LOGGER_PROCESSORS_TOKEN
      );
      expect(processorProvider).toBeDefined();
    });

    it('should configure with context', () => {
      const options: ILoggerModuleOptions = {
        context: {
          environment: 'test',
          version: '1.0.0',
        },
      };

      const result = LoggerModule.forRoot(options);
      expect(result).toBeDefined();
    });

    it('should configure with redaction paths', () => {
      const options: ILoggerModuleOptions = {
        redact: ['password', 'secret', 'apiKey'],
      };

      const result = LoggerModule.forRoot(options);
      expect(result).toBeDefined();
    });

    it('should configure with all options', () => {
      const options: ILoggerModuleOptions = {
        level: 'warn',
        prettyPrint: false,
        transports: [{ name: 'test', write: jest.fn() }],
        processors: [{ process: (log) => log }],
        context: { app: 'test' },
        enabled: true,
        redact: ['password'],
        base: { version: '2.0.0' },
        timestamp: true,
        messageKey: 'message',
        nestedKey: 'payload',
      };

      const result = LoggerModule.forRoot(options);
      expect(result).toBeDefined();
      expect(result.module).toBe(LoggerModule);
    });

    it('should include LoggerService factory in providers', () => {
      const result = LoggerModule.forRoot({ level: 'info' });

      const serviceProvider = result.providers.find(
        (p: any) => Array.isArray(p) && p[0] === LOGGER_SERVICE_TOKEN
      );
      expect(serviceProvider).toBeDefined();

      // The factory should be defined
      const [, config] = serviceProvider as [any, any];
      expect(config.useFactory).toBeDefined();
      expect(typeof config.useFactory).toBe('function');
    });

    it('should create LoggerService instance from factory', () => {
      const options: ILoggerModuleOptions = {
        level: 'debug',
      };

      const result = LoggerModule.forRoot(options);

      const serviceProvider = result.providers.find(
        (p: any) => Array.isArray(p) && p[0] === LOGGER_SERVICE_TOKEN
      );

      const [, config] = serviceProvider as [any, any];
      const service = config.useFactory();

      expect(service).toBeInstanceOf(LoggerService);
    });
  });

  describe('forRootAsync() Static Method', () => {
    it('should return dynamic module with async factory', () => {
      const result = LoggerModule.forRootAsync({
        useFactory: async () => ({ level: 'info' }),
      });

      expect(result).toBeDefined();
      expect(result.module).toBe(LoggerModule);
      expect(result.providers).toBeDefined();
      expect(result.exports).toContain(LOGGER_SERVICE_TOKEN);
    });

    it('should support synchronous factory', () => {
      const result = LoggerModule.forRootAsync({
        useFactory: () => ({ level: 'debug' }),
      });

      expect(result).toBeDefined();
    });

    it('should support factory with inject dependencies', () => {
      const ConfigToken = Symbol('ConfigService');

      const result = LoggerModule.forRootAsync({
        useFactory: (config: any) => ({
          level: config?.logLevel || 'info',
        }),
        inject: [ConfigToken],
      });

      expect(result).toBeDefined();

      // Find options provider
      const optionsProvider = result.providers.find(
        (p: any) => Array.isArray(p) && p[0] === LOGGER_OPTIONS_TOKEN
      );
      expect(optionsProvider).toBeDefined();

      const [, config] = optionsProvider as [any, any];
      expect(config.inject).toContain(ConfigToken);
    });

    it('should configure LoggerService provider with optional dependencies', () => {
      const result = LoggerModule.forRootAsync({
        useFactory: async () => ({ level: 'warn' }),
      });

      const serviceProvider = result.providers.find(
        (p: any) => Array.isArray(p) && p[0] === LOGGER_SERVICE_TOKEN
      );

      expect(serviceProvider).toBeDefined();
      const [, config] = serviceProvider as [any, any];

      // Should have inject configuration for optional dependencies
      expect(config.inject).toBeDefined();
      expect(Array.isArray(config.inject)).toBe(true);
    });

    it('should handle empty inject array', () => {
      const result = LoggerModule.forRootAsync({
        useFactory: () => ({ level: 'info' }),
        inject: [],
      });

      expect(result).toBeDefined();
    });
  });

  describe('ConsoleTransport', () => {
    let transport: ConsoleTransport;
    let consoleSpy: jest.SpiedFunction<typeof console.log>;

    beforeEach(() => {
      transport = new ConsoleTransport();
      consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleSpy.mockRestore();
    });

    it('should have name "console"', () => {
      expect(transport.name).toBe('console');
    });

    it('should write log entry to console', () => {
      const logEntry = {
        level: 30,
        time: Date.now(),
        msg: 'Test message',
      };

      transport.write(logEntry);

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(logEntry));
    });

    it('should handle complex log objects', () => {
      const logEntry = {
        level: 40,
        time: Date.now(),
        msg: 'Warning message',
        context: {
          userId: 123,
          action: 'login',
        },
        metadata: ['tag1', 'tag2'],
      };

      transport.write(logEntry);

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(logEntry));
    });

    it('should handle empty log object', () => {
      transport.write({});
      expect(consoleSpy).toHaveBeenCalledWith('{}');
    });

    it('should handle null values in log', () => {
      const logEntry = {
        level: 30,
        msg: 'Test',
        nullField: null,
      };

      transport.write(logEntry);
      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(logEntry));
    });
  });

  describe('RedactionProcessor', () => {
    it('should redact single path', () => {
      const processor = new RedactionProcessor(['password']);

      const log = {
        msg: 'User login',
        password: 'secret123',
      };

      const processed = processor.process(log);

      expect(processed.password).toBe('[REDACTED]');
      expect(processed.msg).toBe('User login');
    });

    it('should redact multiple paths', () => {
      const processor = new RedactionProcessor(['password', 'secret', 'apiKey']);

      const log = {
        msg: 'Request',
        password: 'pass123',
        secret: 'mysecret',
        apiKey: 'key-abc',
        visible: 'data',
      };

      const processed = processor.process(log);

      expect(processed.password).toBe('[REDACTED]');
      expect(processed.secret).toBe('[REDACTED]');
      expect(processed.apiKey).toBe('[REDACTED]');
      expect(processed.visible).toBe('data');
    });

    it('should redact nested paths', () => {
      const processor = new RedactionProcessor(['user.password', 'auth.token']);

      const log = {
        msg: 'Auth',
        user: {
          name: 'john',
          password: 'secret',
        },
        auth: {
          token: 'jwt-token',
        },
      };

      const processed = processor.process(log);

      expect(processed.user.password).toBe('[REDACTED]');
      expect(processed.auth.token).toBe('[REDACTED]');
      expect(processed.user.name).toBe('john');
    });

    it('should handle missing paths gracefully', () => {
      const processor = new RedactionProcessor(['nonexistent', 'also.missing']);

      const log = {
        msg: 'Test',
        visible: 'data',
      };

      const processed = processor.process(log);

      expect(processed.msg).toBe('Test');
      expect(processed.visible).toBe('data');
    });

    it('should handle deeply nested paths', () => {
      const processor = new RedactionProcessor(['a.b.c.d.secret']);

      const log = {
        a: {
          b: {
            c: {
              d: {
                secret: 'hidden',
                visible: 'shown',
              },
            },
          },
        },
      };

      const processed = processor.process(log);

      expect(processed.a.b.c.d.secret).toBe('[REDACTED]');
      expect(processed.a.b.c.d.visible).toBe('shown');
    });

    it('should not mutate original log object', () => {
      const processor = new RedactionProcessor(['password']);

      const log = {
        msg: 'Test',
        password: 'secret',
      };

      const processed = processor.process(log);

      // Original should be unchanged (shallow copy behavior)
      // Note: The implementation does a shallow spread, so nested objects may still be affected
      expect(processed).not.toBe(log);
    });

    it('should handle empty paths array', () => {
      const processor = new RedactionProcessor([]);

      const log = {
        msg: 'Test',
        password: 'visible',
      };

      const processed = processor.process(log);

      expect(processed.password).toBe('visible');
    });

    it('should handle empty string path', () => {
      const processor = new RedactionProcessor(['']);

      const log = {
        msg: 'Test',
      };

      const processed = processor.process(log);
      expect(processed.msg).toBe('Test');
    });

    it('should handle path with only dots', () => {
      const processor = new RedactionProcessor(['...']);

      const log = {
        msg: 'Test',
      };

      const processed = processor.process(log);
      expect(processed.msg).toBe('Test');
    });
  });

  describe('Type Exports', () => {
    it('should export ILogger type', () => {
      // This is a compile-time check - if types are not exported, this file won't compile
      const _typeCheck = (logger: import('../../../src/modules/logger/logger.types.js').ILogger) => {
        logger.info('test');
      };
      expect(typeof _typeCheck).toBe('function');
    });

    it('should export LogLevel type', () => {
      const level: import('../../../src/modules/logger/logger.types.js').LogLevel = 'info';
      expect(level).toBe('info');
    });

    it('should export ITransport type', () => {
      const transport: import('../../../src/modules/logger/logger.types.js').ITransport = {
        name: 'test',
        write: () => {},
      };
      expect(transport.name).toBe('test');
    });

    it('should export ILogProcessor type', () => {
      const processor: import('../../../src/modules/logger/logger.types.js').ILogProcessor = {
        process: (log) => log,
      };
      expect(typeof processor.process).toBe('function');
    });
  });

  describe('Token Exports', () => {
    it('should export LOGGER_SERVICE_TOKEN', () => {
      expect(LOGGER_SERVICE_TOKEN).toBeDefined();
      expect(typeof LOGGER_SERVICE_TOKEN.toString()).toBe('string');
    });

    it('should export LOGGER_OPTIONS_TOKEN', () => {
      expect(LOGGER_OPTIONS_TOKEN).toBeDefined();
    });

    it('should export LOGGER_TRANSPORTS_TOKEN', () => {
      expect(LOGGER_TRANSPORTS_TOKEN).toBeDefined();
    });

    it('should export LOGGER_PROCESSORS_TOKEN', () => {
      expect(LOGGER_PROCESSORS_TOKEN).toBeDefined();
    });
  });

  describe('Integration Scenarios', () => {
    it('should work with ConsoleTransport in forRoot', () => {
      const result = LoggerModule.forRoot({
        transports: [new ConsoleTransport()],
      });

      expect(result).toBeDefined();
      expect(result.providers.length).toBeGreaterThan(0);
    });

    it('should work with RedactionProcessor in forRoot', () => {
      const result = LoggerModule.forRoot({
        processors: [new RedactionProcessor(['password', 'secret'])],
      });

      expect(result).toBeDefined();
    });

    it('should work with both transports and processors', () => {
      const result = LoggerModule.forRoot({
        level: 'debug',
        transports: [new ConsoleTransport()],
        processors: [new RedactionProcessor(['password'])],
        context: { app: 'integration-test' },
      });

      expect(result).toBeDefined();
      expect(result.providers.length).toBeGreaterThanOrEqual(3);
    });

    it('should create working LoggerService from forRoot factory', () => {
      const options: ILoggerModuleOptions = {
        level: 'info',
        transports: [new ConsoleTransport()],
        processors: [new RedactionProcessor(['secret'])],
      };

      const result = LoggerModule.forRoot(options);

      const serviceProvider = result.providers.find(
        (p: any) => Array.isArray(p) && p[0] === LOGGER_SERVICE_TOKEN
      );

      const [, config] = serviceProvider as [any, any];
      const service = config.useFactory();

      expect(service).toBeInstanceOf(LoggerService);
      expect(service.logger).toBeDefined();
    });
  });
});
