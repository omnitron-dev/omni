/**
 * Tests for Titan fluent API
 */
import { describe, it, expect, jest } from '@jest/globals';

// Jest is globally available, no need to import
import { createApp, defineModule, createToken, LOGGER_SERVICE_TOKEN, CONFIG_SERVICE_TOKEN } from '../src';

describe('Fluent API', () => {
  describe('Lifecycle hooks chaining', () => {
    it('should support method chaining for onStart', () => {
      const app = createApp({ name: 'test-app' });
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      const result = app.onStart(handler1).onStart(handler2);

      expect(result).toBe(app);
    });

    it('should support method chaining for onStop', () => {
      const app = createApp({ name: 'test-app' });
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      const result = app.onStop(handler1).onStop(handler2);

      expect(result).toBe(app);
    });

    it('should support method chaining for onError', () => {
      const app = createApp({ name: 'test-app' });
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      const result = app.onError(handler1).onError(handler2);

      expect(result).toBe(app);
    });

    it('should support mixed chaining of lifecycle hooks', async () => {
      const app = createApp({ name: 'test-app' });
      const startHandler = jest.fn();
      const stopHandler = jest.fn();
      const errorHandler = jest.fn();

      app
        .onStart(startHandler)
        .onStop(stopHandler)
        .onError(errorHandler)
        .onStart(async () => {
          // Another start handler
        });

      await app.start();
      expect(startHandler).toHaveBeenCalled();

      await app.stop();
      expect(stopHandler).toHaveBeenCalled();
    });
  });

  describe('Module chaining', () => {
    it('should support method chaining for use()', () => {
      const app = createApp({ name: 'test-app' });
      const module1 = defineModule({ name: 'module1' });
      const module2 = defineModule({ name: 'module2' });

      const result = app.use(module1).use(module2);

      expect(result).toBe(app);
    });

    it('should support method chaining for configure()', () => {
      const app = createApp({ name: 'test-app' });

      const result = app.configure({ custom: 'value1' }).configure({ another: 'value2' });

      expect(result).toBe(app);
      expect(app.config('custom')).toBe('value1');
      expect(app.config('another')).toBe('value2');
    });
  });

  describe('replaceModule functionality', () => {
    it('should replace core logger module', async () => {
      const app = createApp({ name: 'test-app' });

      const customLogger = defineModule({
        name: 'custom-logger',
        logger: {
          trace: jest.fn(),
          debug: jest.fn(),
          info: jest.fn(),
          warn: jest.fn(),
          error: jest.fn(),
          fatal: jest.fn(),
          child: jest.fn(() => customLogger.logger),
        },
      });

      app.replaceModule(LOGGER_SERVICE_TOKEN, customLogger);
      await app.start();

      const logger = app.get(LOGGER_SERVICE_TOKEN);
      expect(logger.name).toBe('custom-logger');
      expect(logger.logger.info).toBeDefined();

      await app.stop();
    });

    it('should replace core config module', async () => {
      const app = createApp({ name: 'test-app' });

      const customConfig = defineModule({
        name: 'custom-config',
        _data: { test: 'value' },
        loadObject(obj: any) {
          Object.assign(this._data, obj);
        },
        get(path?: string, defaultValue?: any) {
          return path ? this._data[path] || defaultValue : this._data;
        },
        set(path: string, value: any) {
          this._data[path] = value;
        },
        has(path: string) {
          return path in this._data;
        },
        delete(path: string) {
          delete this._data[path];
        },
        getEnvironment() {
          return 'test';
        },
        isProduction() {
          return false;
        },
        isDevelopment() {
          return false;
        },
        isTest() {
          return true;
        },
      });

      app.replaceModule(CONFIG_SERVICE_TOKEN, customConfig as any);
      await app.start();

      const config = app.get(CONFIG_SERVICE_TOKEN);
      expect(config.name).toBe('custom-config');
      expect(config.get('test')).toBe('value');
      expect(config.getEnvironment()).toBe('test');

      await app.stop();
    });

    it('should support chaining with replaceModule', () => {
      const app = createApp({ name: 'test-app' });
      const module1 = defineModule({ name: 'module1' });
      const module2 = defineModule({ name: 'module2' });

      const result = app
        .replaceModule(LOGGER_SERVICE_TOKEN, module1 as any)
        .replaceModule(CONFIG_SERVICE_TOKEN, module2 as any);

      expect(result).toBe(app);
    });
  });

  describe('defineModule helper', () => {
    it('should create a simple module', () => {
      const module = defineModule({
        name: 'test-module',
        version: '1.0.0',
      });

      expect(module.name).toBe('test-module');
      expect(module.version).toBe('1.0.0');
    });

    it('should create a module with custom methods', () => {
      interface MyService {
        doSomething(): string;
        calculate(a: number, b: number): number;
      }

      const module = defineModule<MyService>({
        name: 'my-service',
        doSomething() {
          return 'done';
        },
        calculate(a: number, b: number) {
          return a + b;
        },
      });

      expect(module.doSomething()).toBe('done');
      expect(module.calculate(2, 3)).toBe(5);
    });

    it('should create a module with lifecycle hooks', async () => {
      const onStartFn = jest.fn();
      const onStopFn = jest.fn();

      const module = defineModule({
        name: 'lifecycle-module',
        async onStart(app) {
          onStartFn(app.config('name'));
        },
        async onStop(app) {
          onStopFn(app.config('name'));
        },
      });

      const app = createApp({ name: 'test-app' });
      app.use(module);

      await app.start();
      expect(onStartFn).toHaveBeenCalledWith('test-app');

      await app.stop();
      expect(onStopFn).toHaveBeenCalledWith('test-app');
    });

    it('should create a module with internal state', () => {
      const module = defineModule({
        name: 'stateful-module',
        _counter: 0,
        increment() {
          this._counter++;
        },
        getCount() {
          return this._counter;
        },
      });

      expect(module.getCount()).toBe(0);
      module.increment();
      expect(module.getCount()).toBe(1);
      module.increment();
      expect(module.getCount()).toBe(2);
    });
  });

  describe('Full fluent example', () => {
    it('should work with complete fluent API chain', async () => {
      const startHandler = jest.fn();
      const stopHandler = jest.fn();
      const errorHandler = jest.fn();

      const calculatorModule = defineModule({
        name: 'calculator',
        add: (a: number, b: number) => a + b,
        multiply: (a: number, b: number) => a * b,
      });

      const app = createApp()
        .configure({
          name: 'fluent-app',
          version: '1.0.0',
          custom: { value: 42 },
        })
        .use(calculatorModule)
        .onStart(startHandler)
        .onStop(stopHandler)
        .onError(errorHandler);

      await app.start();

      // Verify configuration
      expect(app.config('name')).toBe('fluent-app');
      expect(app.config('version')).toBe('1.0.0');
      expect(app.config('custom')).toEqual({ value: 42 });

      // Verify module
      const calcToken = createToken('calculator');
      const calc = app.get(calcToken);
      expect(calc.add(2, 3)).toBe(5);
      expect(calc.multiply(4, 5)).toBe(20);

      // Verify handlers
      expect(startHandler).toHaveBeenCalled();

      await app.stop();
      expect(stopHandler).toHaveBeenCalled();
    });
  });
});
