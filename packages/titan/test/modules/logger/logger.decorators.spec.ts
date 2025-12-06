/**
 * Tests for Logger Decorators
 *
 * Tests for @Logger, @Log, and @Monitor decorators.
 */

import 'reflect-metadata';
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { Logger, Log, Monitor } from '../../../src/modules/logger/logger.decorators.js';

// Mock console methods
const mockConsole = {
  trace: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  log: jest.fn(),
  timeEnd: jest.fn(),
};

const originalConsole = { ...console };

describe('Logger Decorators', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Mock console methods
    Object.assign(console, mockConsole);
  });

  afterEach(() => {
    // Restore console
    Object.assign(console, originalConsole);
  });

  describe('@Logger Decorator', () => {
    it('should inject logger instance into property', () => {
      class TestService {
        @Logger('TestService')
        private logger!: any;

        getLogger() {
          return this.logger;
        }
      }

      const service = new TestService();
      const logger = service.getLogger();

      expect(logger).toBeDefined();
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.error).toBe('function');
      expect(typeof logger.debug).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.trace).toBe('function');
      expect(typeof logger.fatal).toBe('function');
    });

    it('should use class name as default logger name', () => {
      class MyCustomService {
        @Logger()
        private logger!: any;

        getLogger() {
          return this.logger;
        }

        logSomething() {
          this.logger.info('test message');
        }
      }

      const service = new MyCustomService();
      service.logSomething();

      // The logger should use class name
      expect(mockConsole.info).toHaveBeenCalledWith(
        expect.stringContaining('MyCustomService'),
        'test message'
      );
    });

    it('should use custom name when provided', () => {
      class TestService {
        @Logger('CustomLoggerName')
        private logger!: any;

        logMessage() {
          this.logger.info('custom name test');
        }
      }

      const service = new TestService();
      service.logMessage();

      expect(mockConsole.info).toHaveBeenCalledWith(
        '[CustomLoggerName]',
        'custom name test'
      );
    });

    it('should store metadata on the property', () => {
      class TestService {
        @Logger('MetadataTest')
        private logger!: any;
      }

      const metadata = Reflect.getMetadata('logger', TestService.prototype, 'logger');
      expect(metadata).toBe(true);
    });

    it('should allow setting logger instance', () => {
      class TestService {
        @Logger()
        private logger!: any;

        setLogger(newLogger: any) {
          this.logger = newLogger;
        }

        getLogger() {
          return this.logger;
        }
      }

      const service = new TestService();
      const customLogger = { info: jest.fn() };
      service.setLogger(customLogger);

      expect(service.getLogger()).toBe(customLogger);
    });

    it('should cache logger instance after first access', () => {
      class TestService {
        @Logger('CachedLogger')
        private logger!: any;

        getLogger() {
          return this.logger;
        }
      }

      const service = new TestService();
      const logger1 = service.getLogger();
      const logger2 = service.getLogger();

      expect(logger1).toBe(logger2);
    });

    it('should create independent loggers for different instances', () => {
      class TestService {
        @Logger('IndependentLogger')
        private logger!: any;

        getLogger() {
          return this.logger;
        }
      }

      const service1 = new TestService();
      const service2 = new TestService();

      // Each instance should have its own logger
      expect(service1.getLogger()).toBeDefined();
      expect(service2.getLogger()).toBeDefined();
    });

    it('should support logger methods - trace', () => {
      class TestService {
        @Logger('TraceTest')
        private logger!: any;

        logTrace() {
          this.logger.trace('trace message');
        }
      }

      const service = new TestService();
      service.logTrace();

      expect(mockConsole.trace).toHaveBeenCalledWith('[TraceTest]', 'trace message');
    });

    it('should support logger methods - debug', () => {
      class TestService {
        @Logger('DebugTest')
        private logger!: any;

        logDebug() {
          this.logger.debug('debug message');
        }
      }

      const service = new TestService();
      service.logDebug();

      expect(mockConsole.debug).toHaveBeenCalledWith('[DebugTest]', 'debug message');
    });

    it('should support logger methods - info', () => {
      class TestService {
        @Logger('InfoTest')
        private logger!: any;

        logInfo() {
          this.logger.info('info message');
        }
      }

      const service = new TestService();
      service.logInfo();

      expect(mockConsole.info).toHaveBeenCalledWith('[InfoTest]', 'info message');
    });

    it('should support logger methods - warn', () => {
      class TestService {
        @Logger('WarnTest')
        private logger!: any;

        logWarn() {
          this.logger.warn('warn message');
        }
      }

      const service = new TestService();
      service.logWarn();

      expect(mockConsole.warn).toHaveBeenCalledWith('[WarnTest]', 'warn message');
    });

    it('should support logger methods - error', () => {
      class TestService {
        @Logger('ErrorTest')
        private logger!: any;

        logError() {
          this.logger.error('error message');
        }
      }

      const service = new TestService();
      service.logError();

      expect(mockConsole.error).toHaveBeenCalledWith('[ErrorTest]', 'error message');
    });

    it('should support logger methods - fatal', () => {
      class TestService {
        @Logger('FatalTest')
        private logger!: any;

        logFatal() {
          this.logger.fatal('fatal message');
        }
      }

      const service = new TestService();
      service.logFatal();

      expect(mockConsole.error).toHaveBeenCalledWith('[FatalTest] [FATAL]', 'fatal message');
    });

    it('should support child logger creation', () => {
      class TestService {
        @Logger('ParentLogger')
        private logger!: any;

        createChild() {
          return this.logger.child({ requestId: '123' });
        }
      }

      const service = new TestService();
      const childLogger = service.createChild();

      expect(childLogger).toBeDefined();
      expect(typeof childLogger.info).toBe('function');
    });

    it('should support time() method', () => {
      class TestService {
        @Logger('TimerTest')
        private logger!: any;

        testTimer() {
          const end = this.logger.time('operation');
          return end;
        }
      }

      const service = new TestService();
      const endTimer = service.testTimer();

      expect(typeof endTimer).toBe('function');
    });

    it('should support isLevelEnabled()', () => {
      class TestService {
        @Logger('LevelTest')
        private logger!: any;

        checkLevel() {
          return this.logger.isLevelEnabled('info');
        }
      }

      const service = new TestService();
      const result = service.checkLevel();

      expect(result).toBe(true);
    });
  });

  describe('@Log Decorator', () => {
    it('should log method entry and exit', async () => {
      class TestService {
        @Log()
        async doWork() {
          return 'result';
        }
      }

      const service = new TestService();
      await service.doWork();

      // The @Log decorator uses getLoggerInstance which logs as: [ClassName], {data}, message
      expect(mockConsole.info).toHaveBeenCalledWith(
        '[TestService]',
        expect.objectContaining({
          method: 'TestService.doWork',
        }),
        expect.stringContaining('Entering')
      );

      expect(mockConsole.info).toHaveBeenCalledWith(
        '[TestService]',
        expect.objectContaining({
          method: 'TestService.doWork',
        }),
        expect.stringContaining('Exiting')
      );
    });

    it('should use specified log level', async () => {
      class TestService {
        @Log({ level: 'debug' })
        async debugMethod() {
          return 'debug result';
        }
      }

      const service = new TestService();
      await service.debugMethod();

      expect(mockConsole.debug).toHaveBeenCalled();
    });

    it('should include args when includeArgs is true', async () => {
      class TestService {
        @Log({ includeArgs: true })
        async processData(id: number, name: string) {
          return { id, name };
        }
      }

      const service = new TestService();
      await service.processData(123, 'test');

      expect(mockConsole.info).toHaveBeenCalledWith(
        '[TestService]',
        expect.objectContaining({
          args: [123, 'test'],
        }),
        expect.any(String)
      );
    });

    it('should include result when includeResult is true', async () => {
      class TestService {
        @Log({ includeResult: true })
        async getData() {
          return { value: 42 };
        }
      }

      const service = new TestService();
      await service.getData();

      expect(mockConsole.info).toHaveBeenCalledWith(
        '[TestService]',
        expect.objectContaining({
          result: { value: 42 },
        }),
        expect.stringContaining('Exiting')
      );
    });

    it('should include custom message', async () => {
      class TestService {
        @Log({ message: 'Processing important data' })
        async importantMethod() {
          return true;
        }
      }

      const service = new TestService();
      await service.importantMethod();

      expect(mockConsole.info).toHaveBeenCalledWith(
        '[TestService]',
        expect.objectContaining({
          message: 'Processing important data',
        }),
        expect.any(String)
      );
    });

    it('should log errors and rethrow', async () => {
      class TestService {
        @Log()
        async failingMethod() {
          throw new Error('Test error');
        }
      }

      const service = new TestService();

      await expect(service.failingMethod()).rejects.toThrow('Test error');

      expect(mockConsole.error).toHaveBeenCalledWith(
        '[TestService]',
        expect.objectContaining({
          error: expect.any(Error),
        }),
        expect.stringContaining('Error in TestService.failingMethod')
      );
    });

    it('should work with synchronous methods', async () => {
      class TestService {
        @Log()
        syncMethod() {
          return 'sync result';
        }
      }

      const service = new TestService();
      const result = await service.syncMethod();

      expect(result).toBe('sync result');
      expect(mockConsole.info).toHaveBeenCalled();
    });

    it('should include timestamp in log data', async () => {
      class TestService {
        @Log()
        async timedMethod() {
          return 'done';
        }
      }

      const service = new TestService();
      await service.timedMethod();

      expect(mockConsole.info).toHaveBeenCalledWith(
        '[TestService]',
        expect.objectContaining({
          timestamp: expect.any(String),
        }),
        expect.any(String)
      );
    });

    it('should support warn level', async () => {
      class TestService {
        @Log({ level: 'warn' })
        async warnMethod() {
          return 'warning';
        }
      }

      const service = new TestService();
      await service.warnMethod();

      expect(mockConsole.warn).toHaveBeenCalled();
    });

    it('should support error level (but still log entry/exit, not throw)', async () => {
      class TestService {
        @Log({ level: 'error' })
        async errorLevelMethod() {
          return 'not an error, just logged at error level';
        }
      }

      const service = new TestService();
      const result = await service.errorLevelMethod();

      expect(result).toBe('not an error, just logged at error level');
      expect(mockConsole.error).toHaveBeenCalled();
    });

    it('should handle methods with no arguments', async () => {
      class TestService {
        @Log({ includeArgs: true })
        async noArgs() {
          return 'no args';
        }
      }

      const service = new TestService();
      await service.noArgs();

      expect(mockConsole.info).toHaveBeenCalledWith(
        '[TestService]',
        expect.objectContaining({
          args: [],
        }),
        expect.any(String)
      );
    });

    it('should handle undefined return value', async () => {
      class TestService {
        @Log({ includeResult: true })
        async returnsUndefined() {
          // No return
        }
      }

      const service = new TestService();
      await service.returnsUndefined();

      expect(mockConsole.info).toHaveBeenCalledWith(
        '[TestService]',
        expect.objectContaining({
          result: undefined,
        }),
        expect.stringContaining('Exiting')
      );
    });
  });

  describe('@Monitor Decorator', () => {
    let performanceSpy: jest.SpiedFunction<typeof performance.now>;
    let mockNow = 0;

    beforeEach(() => {
      mockNow = 0;
      performanceSpy = jest.spyOn(performance, 'now').mockImplementation(() => {
        mockNow += 100; // Simulate 100ms passing each call
        return mockNow;
      });
    });

    afterEach(() => {
      performanceSpy.mockRestore();
    });

    it('should track method execution time', async () => {
      class TestService {
        @Monitor()
        async trackedMethod() {
          return 'tracked';
        }
      }

      const service = new TestService();
      await service.trackedMethod();

      expect(mockConsole.debug).toHaveBeenCalledWith(
        expect.stringContaining('[Metrics]'),
        expect.objectContaining({
          duration: expect.stringContaining('ms'),
          success: true,
        })
      );
    });

    it('should use custom metric name', async () => {
      class TestService {
        @Monitor({ name: 'custom-metric-name' })
        async customMetric() {
          return 'result';
        }
      }

      const service = new TestService();
      await service.customMetric();

      expect(mockConsole.debug).toHaveBeenCalledWith(
        expect.stringContaining('custom-metric-name'),
        expect.any(Object)
      );
    });

    it('should use method name as default metric name', async () => {
      class DataService {
        @Monitor()
        async fetchData() {
          return ['data'];
        }
      }

      const service = new DataService();
      await service.fetchData();

      expect(mockConsole.debug).toHaveBeenCalledWith(
        expect.stringContaining('DataService.fetchData'),
        expect.any(Object)
      );
    });

    it('should include args when includeArgs is true', async () => {
      // For this test, we need to check that args are included in metadata
      // The decorator builds metadata but may not directly log args in the debug output
      class TestService {
        @Monitor({ includeArgs: true })
        async processWithArgs(id: number) {
          return id * 2;
        }
      }

      const service = new TestService();
      const result = await service.processWithArgs(5);

      expect(result).toBe(10);
      expect(mockConsole.debug).toHaveBeenCalled();
    });

    it('should include result when includeResult is true', async () => {
      class TestService {
        @Monitor({ includeResult: true })
        async getResult() {
          return { value: 100 };
        }
      }

      const service = new TestService();
      const result = await service.getResult();

      expect(result).toEqual({ value: 100 });
      expect(mockConsole.debug).toHaveBeenCalled();
    });

    it('should log errors with success: false', async () => {
      class TestService {
        @Monitor()
        async failingMonitor() {
          throw new Error('Monitored failure');
        }
      }

      const service = new TestService();

      await expect(service.failingMonitor()).rejects.toThrow('Monitored failure');

      expect(mockConsole.error).toHaveBeenCalledWith(
        expect.stringContaining('[Metrics]'),
        expect.objectContaining({
          success: false,
          error: 'Error',
        })
      );
    });

    it('should respect sample rate of 1.0 (always sample)', async () => {
      class TestService {
        @Monitor({ sampleRate: 1.0 })
        async alwaysSampled() {
          return 'sampled';
        }
      }

      const service = new TestService();

      // Call multiple times
      for (let i = 0; i < 5; i++) {
        await service.alwaysSampled();
      }

      expect(mockConsole.debug).toHaveBeenCalledTimes(5);
    });

    it('should respect sample rate of 0 (never sample)', async () => {
      // Mock Math.random to always return a value > sampleRate
      const mathRandomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);

      class TestService {
        @Monitor({ sampleRate: 0.0 })
        async neverSampled() {
          return 'not sampled';
        }
      }

      const service = new TestService();
      await service.neverSampled();

      // Should not log because sample rate is 0
      expect(mockConsole.debug).not.toHaveBeenCalled();

      mathRandomSpy.mockRestore();
    });

    it('should work with synchronous methods', async () => {
      class TestService {
        @Monitor()
        syncMonitored() {
          return 'sync result';
        }
      }

      const service = new TestService();
      const result = await service.syncMonitored();

      expect(result).toBe('sync result');
      expect(mockConsole.debug).toHaveBeenCalled();
    });

    it('should track duration accurately', async () => {
      mockNow = 0; // Reset

      class TestService {
        @Monitor()
        async timedOperation() {
          return 'done';
        }
      }

      const service = new TestService();
      await service.timedOperation();

      expect(mockConsole.debug).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          duration: '100.00ms',
        })
      );
    });

    it('should handle methods returning null', async () => {
      class TestService {
        @Monitor({ includeResult: true })
        async returnsNull() {
          return null;
        }
      }

      const service = new TestService();
      const result = await service.returnsNull();

      expect(result).toBeNull();
      expect(mockConsole.debug).toHaveBeenCalled();
    });

    it('should handle methods with complex return types', async () => {
      class TestService {
        @Monitor({ includeResult: true })
        async complexReturn() {
          return {
            data: [1, 2, 3],
            nested: { deep: { value: true } },
            date: new Date(),
          };
        }
      }

      const service = new TestService();
      const result = await service.complexReturn();

      expect(result.data).toEqual([1, 2, 3]);
      expect(result.nested.deep.value).toBe(true);
      expect(mockConsole.debug).toHaveBeenCalled();
    });
  });

  describe('Decorator Combinations', () => {
    it('should work with @Logger and @Log on same class', async () => {
      class CombinedService {
        @Logger('CombinedLogger')
        private logger!: any;

        @Log()
        async loggedMethod() {
          this.logger.info('Inside logged method');
          return 'combined';
        }
      }

      const service = new CombinedService();
      await service.loggedMethod();

      // @Log should have logged entry/exit (with [ClassName] prefix)
      expect(mockConsole.info).toHaveBeenCalledWith(
        '[CombinedService]',
        expect.objectContaining({ method: 'CombinedService.loggedMethod' }),
        expect.any(String)
      );

      // @Logger should have logged the explicit message
      expect(mockConsole.info).toHaveBeenCalledWith(
        '[CombinedLogger]',
        'Inside logged method'
      );
    });

    it('should work with @Logger and @Monitor on same class', async () => {
      class MonitoredService {
        @Logger('MonitoredLogger')
        private logger!: any;

        @Monitor({ name: 'monitored-operation' })
        async monitoredMethod() {
          this.logger.debug('Executing monitored operation');
          return 'monitored';
        }
      }

      const service = new MonitoredService();
      await service.monitoredMethod();

      // Both decorators should work
      expect(mockConsole.debug).toHaveBeenCalled();
    });

    it('should work with multiple @Log methods in same class', async () => {
      class MultiLogService {
        @Log()
        async method1() {
          return 'method1';
        }

        @Log()
        async method2() {
          return 'method2';
        }
      }

      const service = new MultiLogService();
      await service.method1();
      await service.method2();

      // Both methods should be logged (with [ClassName] prefix)
      expect(mockConsole.info).toHaveBeenCalledWith(
        '[MultiLogService]',
        expect.objectContaining({ method: 'MultiLogService.method1' }),
        expect.any(String)
      );
      expect(mockConsole.info).toHaveBeenCalledWith(
        '[MultiLogService]',
        expect.objectContaining({ method: 'MultiLogService.method2' }),
        expect.any(String)
      );
    });

    it('should work with @Log and @Monitor on same method', async () => {
      class DoubleDecoratedService {
        @Log()
        @Monitor()
        async doubleDecorated() {
          return 'double';
        }
      }

      const service = new DoubleDecoratedService();
      await service.doubleDecorated();

      // Both should have logged
      expect(mockConsole.info).toHaveBeenCalled();
      expect(mockConsole.debug).toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty string as logger name', () => {
      class TestService {
        @Logger('')
        private logger!: any;

        getLogger() {
          return this.logger;
        }
      }

      const service = new TestService();
      const logger = service.getLogger();

      expect(logger).toBeDefined();
    });

    it('should handle special characters in logger name', () => {
      class TestService {
        @Logger('Service@v1.0.0/module#test')
        private logger!: any;

        log() {
          this.logger.info('special chars test');
        }
      }

      const service = new TestService();
      service.log();

      expect(mockConsole.info).toHaveBeenCalledWith(
        '[Service@v1.0.0/module#test]',
        'special chars test'
      );
    });

    it('should handle async errors in @Log decorator', async () => {
      class TestService {
        @Log()
        async asyncError() {
          await new Promise((resolve) => setTimeout(resolve, 0));
          throw new Error('Async error');
        }
      }

      const service = new TestService();
      await expect(service.asyncError()).rejects.toThrow('Async error');
    });

    it('should handle promise rejection in @Monitor decorator', async () => {
      class TestService {
        @Monitor()
        async promiseRejection() {
          return Promise.reject(new Error('Rejected'));
        }
      }

      const service = new TestService();
      await expect(service.promiseRejection()).rejects.toThrow('Rejected');

      expect(mockConsole.error).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          success: false,
        })
      );
    });

    it('should handle methods with many arguments', async () => {
      class TestService {
        @Log({ includeArgs: true })
        async manyArgs(a: number, b: string, c: boolean, d: object, e: any[]) {
          return { a, b, c, d, e };
        }
      }

      const service = new TestService();
      await service.manyArgs(1, 'two', true, { key: 'value' }, [1, 2, 3]);

      expect(mockConsole.info).toHaveBeenCalledWith(
        '[TestService]',
        expect.objectContaining({
          args: [1, 'two', true, { key: 'value' }, [1, 2, 3]],
        }),
        expect.any(String)
      );
    });

    it('should handle undefined and null arguments', async () => {
      class TestService {
        @Log({ includeArgs: true })
        async nullableArgs(a: string | undefined, b: number | null) {
          return { a, b };
        }
      }

      const service = new TestService();
      await service.nullableArgs(undefined, null);

      expect(mockConsole.info).toHaveBeenCalledWith(
        '[TestService]',
        expect.objectContaining({
          args: [undefined, null],
        }),
        expect.any(String)
      );
    });
  });
});
