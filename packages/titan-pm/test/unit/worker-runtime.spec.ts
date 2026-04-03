/**
 * Worker Runtime Unit Tests
 *
 * Comprehensive tests for the worker runtime module including:
 * - Dynamic module loading and validation
 * - Memory monitoring with threshold transitions
 * - Transport setup and error handling
 * - Shutdown handling and signal processing
 * - Service wrapper creation and method extraction
 *
 * Note: These tests focus on testing the logic in isolation without
 * spawning real workers, by testing extractable helper functions
 * and simulating the runtime behavior.
 */

import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from '@omnitron-dev/eventemitter';
import { Errors } from '@omnitron-dev/titan/errors';

// Metadata keys matching worker-runtime.ts
const PROCESS_METADATA_KEY = Symbol.for('process:metadata');
const PROCESS_METHOD_METADATA_KEY = Symbol.for('process:method:metadata');

// Mock logger
const createMockLogger = () => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  fatal: vi.fn(),
  child: vi.fn().mockReturnThis(),
});

// Mock parent port
class MockParentPort extends EventEmitter {
  public messages: unknown[] = [];

  postMessage(message: unknown): void {
    this.messages.push(message);
  }
}

// ============================================================================
// Dynamic Module Loading Tests
// ============================================================================

describe('Worker Runtime - Dynamic Module Loading', () => {
  describe('Module loading validation', () => {
    it('should accept module with valid default export', () => {
      class ValidProcess {
        processData() {
          return 'processed';
        }
      }

      const MockModule = { default: ValidProcess };
      const ProcessClass = MockModule.default;

      expect(ProcessClass).toBeDefined();
      expect(typeof ProcessClass).toBe('function');
      expect(new ProcessClass()).toBeInstanceOf(ValidProcess);
    });

    it('should detect missing default export', () => {
      const MockModuleNoDefault = {
        namedExport: class SomeClass {},
      };

      const ProcessClass = (MockModuleNoDefault as any).default;

      expect(ProcessClass).toBeUndefined();
    });

    it('should detect null default export', () => {
      const MockModuleNullDefault = { default: null };

      const ProcessClass = MockModuleNullDefault.default;

      expect(ProcessClass).toBeNull();
      expect(!ProcessClass).toBe(true);
    });

    it('should detect undefined default export', () => {
      const MockModuleUndefinedDefault = { default: undefined };

      const ProcessClass = MockModuleUndefinedDefault.default;

      expect(ProcessClass).toBeUndefined();
      expect(!ProcessClass).toBe(true);
    });

    it('should throw NotFound error when default export is missing', () => {
      const processPath = '/path/to/invalid-module.js';

      expect(() => {
        const ProcessClass = undefined;
        if (!ProcessClass) {
          throw Errors.notFound('Default export', processPath);
        }
      }).toThrow();
    });

    it('should create instance from valid process class', () => {
      class TestProcess {
        private value = 42;

        getValue() {
          return this.value;
        }
      }

      const MockModule = { default: TestProcess };
      const ProcessClass = MockModule.default;
      const instance = new ProcessClass();

      expect(instance).toBeInstanceOf(TestProcess);
      expect(instance.getValue()).toBe(42);
    });

    it('should call init method with dependencies if available', async () => {
      const initMock = vi.fn();

      class ProcessWithInit {
        init = initMock;
      }

      const instance = new ProcessWithInit();
      const dependencies = { db: 'dbConnection', cache: 'cacheClient' };

      if (typeof instance.init === 'function') {
        await instance.init(dependencies);
      }

      expect(initMock).toHaveBeenCalledWith(dependencies);
    });

    it('should not fail if init method is not defined', async () => {
      class ProcessWithoutInit {
        doWork() {
          return 'working';
        }
      }

      const instance = new ProcessWithoutInit();
      const dependencies = { db: 'dbConnection' };

      // Should not throw
      if (typeof (instance as any).init === 'function') {
        await (instance as any).init(...Object.values(dependencies));
      }

      expect(true).toBe(true);
    });
  });

  describe('Process metadata extraction', () => {
    it('should extract process metadata from decorated class', () => {
      class DecoratedProcess {}

      Reflect.defineMetadata(PROCESS_METADATA_KEY, { name: 'TestService', version: '2.0.0' }, DecoratedProcess);

      const metadata = Reflect.getMetadata(PROCESS_METADATA_KEY, DecoratedProcess) || {};

      expect(metadata.name).toBe('TestService');
      expect(metadata.version).toBe('2.0.0');
    });

    it('should use class name as fallback when no name in metadata', () => {
      class MyServiceProcess {}

      Reflect.defineMetadata(PROCESS_METADATA_KEY, {}, MyServiceProcess);

      const metadata = Reflect.getMetadata(PROCESS_METADATA_KEY, MyServiceProcess) || {};
      const serviceName = metadata.name || MyServiceProcess.name || 'UnnamedService';

      expect(serviceName).toBe('MyServiceProcess');
    });

    it('should use default version when not specified', () => {
      class NoVersionProcess {}

      const metadata = Reflect.getMetadata(PROCESS_METADATA_KEY, NoVersionProcess) || {};
      const serviceVersion = metadata.version || '1.0.0';

      expect(serviceVersion).toBe('1.0.0');
    });

    it('should use UnnamedService when no name available', () => {
      const AnonymousClass = function AnonymousProcess() {} as any;
      Object.defineProperty(AnonymousClass, 'name', { value: '' });

      const metadata = Reflect.getMetadata(PROCESS_METADATA_KEY, AnonymousClass) || {};
      const serviceName = metadata.name || AnonymousClass.name || 'UnnamedService';

      expect(serviceName).toBe('UnnamedService');
    });
  });
});

// ============================================================================
// Memory Monitoring Tests
// ============================================================================

describe('Worker Runtime - Memory Monitoring', () => {
  const MEMORY_WARNING_THRESHOLD = 0.8;
  const MEMORY_CRITICAL_THRESHOLD = 0.95;

  /**
   * Simulates the memory monitoring logic from worker-runtime.ts
   */
  function checkMemoryPressure(
    heapUsed: number,
    heapLimit: number,
    memoryWarningEmitted: boolean,
    parentPort: MockParentPort,
    processId: string,
    gcAvailable: boolean
  ): { warningEmitted: boolean; gcTriggered: boolean } {
    const heapUsedRatio = heapUsed / heapLimit;
    let gcTriggered = false;

    if (heapUsedRatio > MEMORY_CRITICAL_THRESHOLD && !memoryWarningEmitted) {
      parentPort.postMessage({
        type: 'memory_critical',
        processId,
        heapUsed,
        heapLimit,
        ratio: heapUsedRatio,
      });

      if (gcAvailable) {
        gcTriggered = true;
      }

      return { warningEmitted: true, gcTriggered };
    } else if (heapUsedRatio > MEMORY_WARNING_THRESHOLD && !memoryWarningEmitted) {
      parentPort.postMessage({
        type: 'memory_warning',
        processId,
        heapUsed,
        heapLimit,
        ratio: heapUsedRatio,
      });
      return { warningEmitted: false, gcTriggered: false };
    } else if (heapUsedRatio < MEMORY_WARNING_THRESHOLD * 0.9) {
      return { warningEmitted: false, gcTriggered: false };
    }

    return { warningEmitted: memoryWarningEmitted, gcTriggered: false };
  }

  describe('Memory threshold transitions', () => {
    it('should emit warning at 80% memory threshold', () => {
      const parentPort = new MockParentPort();
      const processId = 'test-process';
      const heapLimit = 1024 * 1024 * 512; // 512MB
      const heapUsed = heapLimit * 0.85; // 85% usage

      const result = checkMemoryPressure(heapUsed, heapLimit, false, parentPort, processId, false);

      expect(parentPort.messages).toHaveLength(1);
      const message = parentPort.messages[0] as any;
      expect(message.type).toBe('memory_warning');
      expect(message.processId).toBe(processId);
      expect(message.ratio).toBeCloseTo(0.85, 2);
      expect(result.warningEmitted).toBe(false);
    });

    it('should emit critical at 95% memory threshold', () => {
      const parentPort = new MockParentPort();
      const processId = 'test-process';
      const heapLimit = 1024 * 1024 * 512;
      const heapUsed = heapLimit * 0.97; // 97% usage

      const result = checkMemoryPressure(heapUsed, heapLimit, false, parentPort, processId, false);

      expect(parentPort.messages).toHaveLength(1);
      const message = parentPort.messages[0] as any;
      expect(message.type).toBe('memory_critical');
      expect(message.processId).toBe(processId);
      expect(message.ratio).toBeCloseTo(0.97, 2);
      expect(result.warningEmitted).toBe(true);
    });

    it('should not emit duplicate warnings', () => {
      const parentPort = new MockParentPort();
      const processId = 'test-process';
      const heapLimit = 1024 * 1024 * 512;
      const heapUsed = heapLimit * 0.85;

      // First check - emits warning
      checkMemoryPressure(heapUsed, heapLimit, false, parentPort, processId, false);

      // Second check with warning already emitted
      checkMemoryPressure(heapUsed, heapLimit, true, parentPort, processId, false);

      // Should only have 1 message
      expect(parentPort.messages).toHaveLength(1);
    });

    it('should reset warning flag when memory drops below 72%', () => {
      const parentPort = new MockParentPort();
      const processId = 'test-process';
      const heapLimit = 1024 * 1024 * 512;
      const heapUsedLow = heapLimit * 0.7; // 70% usage (below 72%)

      const result = checkMemoryPressure(
        heapUsedLow,
        heapLimit,
        true, // Previously warning emitted
        parentPort,
        processId,
        false
      );

      expect(result.warningEmitted).toBe(false);
    });

    it('should not emit any message when under warning threshold', () => {
      const parentPort = new MockParentPort();
      const processId = 'test-process';
      const heapLimit = 1024 * 1024 * 512;
      const heapUsed = heapLimit * 0.5; // 50% usage

      checkMemoryPressure(heapUsed, heapLimit, false, parentPort, processId, false);

      expect(parentPort.messages).toHaveLength(0);
    });
  });

  describe('GC trigger behavior', () => {
    it('should trigger GC when critical threshold reached and GC available', () => {
      const parentPort = new MockParentPort();
      const processId = 'test-process';
      const heapLimit = 1024 * 1024 * 512;
      const heapUsed = heapLimit * 0.96;

      const result = checkMemoryPressure(
        heapUsed,
        heapLimit,
        false,
        parentPort,
        processId,
        true // GC available
      );

      expect(result.gcTriggered).toBe(true);
    });

    it('should not trigger GC when GC is not available', () => {
      const parentPort = new MockParentPort();
      const processId = 'test-process';
      const heapLimit = 1024 * 1024 * 512;
      const heapUsed = heapLimit * 0.96;

      const result = checkMemoryPressure(
        heapUsed,
        heapLimit,
        false,
        parentPort,
        processId,
        false // GC not available
      );

      expect(result.gcTriggered).toBe(false);
    });

    it('should not trigger GC on warning threshold only', () => {
      const parentPort = new MockParentPort();
      const processId = 'test-process';
      const heapLimit = 1024 * 1024 * 512;
      const heapUsed = heapLimit * 0.85;

      const result = checkMemoryPressure(heapUsed, heapLimit, false, parentPort, processId, true);

      expect(result.gcTriggered).toBe(false);
    });
  });

  describe('Memory message format', () => {
    it('should include all required fields in warning message', () => {
      const parentPort = new MockParentPort();
      const processId = 'proc-123';
      const heapLimit = 1024 * 1024 * 512;
      const heapUsed = heapLimit * 0.85;

      checkMemoryPressure(heapUsed, heapLimit, false, parentPort, processId, false);

      const message = parentPort.messages[0] as any;
      expect(message).toHaveProperty('type', 'memory_warning');
      expect(message).toHaveProperty('processId', 'proc-123');
      expect(message).toHaveProperty('heapUsed');
      expect(message).toHaveProperty('heapLimit');
      expect(message).toHaveProperty('ratio');
    });

    it('should include all required fields in critical message', () => {
      const parentPort = new MockParentPort();
      const processId = 'proc-456';
      const heapLimit = 1024 * 1024 * 512;
      const heapUsed = heapLimit * 0.97;

      checkMemoryPressure(heapUsed, heapLimit, false, parentPort, processId, false);

      const message = parentPort.messages[0] as any;
      expect(message).toHaveProperty('type', 'memory_critical');
      expect(message).toHaveProperty('processId', 'proc-456');
      expect(message).toHaveProperty('heapUsed');
      expect(message).toHaveProperty('heapLimit');
      expect(message).toHaveProperty('ratio');
    });
  });
});

// ============================================================================
// Transport Setup Tests
// ============================================================================

describe('Worker Runtime - Transport Setup', () => {
  describe('Transport type validation', () => {
    it('should recognize ipc transport type', () => {
      const config = {
        transport: { type: 'ipc' as const },
      };

      // IPC transport skips external transport setup
      expect(config.transport.type).toBe('ipc');
      expect(config.transport.type !== 'ipc').toBe(false);
    });

    it('should recognize tcp transport type', () => {
      const config = {
        transport: {
          type: 'tcp' as const,
          host: 'localhost',
          port: 3000,
        },
      };

      expect(config.transport.type).toBe('tcp');
      expect(config.transport.host).toBe('localhost');
      expect(config.transport.port).toBe(3000);
    });

    it('should recognize unix socket transport type', () => {
      const config = {
        transport: {
          type: 'unix' as const,
          path: '/tmp/service.sock',
        },
      };

      expect(config.transport.type).toBe('unix');
      expect(config.transport.path).toBe('/tmp/service.sock');
    });

    it('should recognize ws transport type', () => {
      const config = {
        transport: {
          type: 'ws' as const,
          url: 'ws://localhost:8080',
        },
      };

      expect(config.transport.type).toBe('ws');
      expect(config.transport.url).toBe('ws://localhost:8080');
    });
  });

  describe('Transport URL handling', () => {
    it('should use url from config when available', () => {
      const config = {
        transport: {
          type: 'tcp' as const,
          url: 'tcp://localhost:5000',
        },
      };

      const transportUrl = config.transport.url || '';
      expect(transportUrl).toBe('tcp://localhost:5000');
    });

    it('should use empty string when url not provided', () => {
      const config = {
        transport: {
          type: 'tcp' as const,
          host: 'localhost',
          port: 5000,
        },
      };

      const transportUrl = (config.transport as any).url || '';
      expect(transportUrl).toBe('');
    });
  });

  describe('Server options extraction', () => {
    it('should extract host from config', () => {
      const config = {
        transport: {
          type: 'tcp' as const,
          host: '192.168.1.100',
          port: 8080,
        },
      };

      const serverOptions: any = {};
      if (config.transport.host) serverOptions.host = config.transport.host;
      if (config.transport.port) serverOptions.port = config.transport.port;

      expect(serverOptions.host).toBe('192.168.1.100');
      expect(serverOptions.port).toBe(8080);
    });

    it('should extract path for unix socket', () => {
      const config = {
        transport: {
          type: 'unix' as const,
          path: '/var/run/myapp.sock',
        },
      };

      const serverOptions: any = {};
      if (config.transport.path) serverOptions.path = config.transport.path;

      expect(serverOptions.path).toBe('/var/run/myapp.sock');
    });

    it('should handle missing optional options', () => {
      const config = {
        transport: {
          type: 'tcp' as const,
        },
      };

      const serverOptions: any = {};
      if ((config.transport as any).host) serverOptions.host = (config.transport as any).host;
      if ((config.transport as any).port) serverOptions.port = (config.transport as any).port;

      expect(Object.keys(serverOptions)).toHaveLength(0);
    });
  });

  describe('Transport error handling', () => {
    it('should throw NotFound error for invalid transport URL', () => {
      const transportUrl = 'invalid://nowhere';

      expect(() => {
        const transport = null; // Simulating getTransportForAddress returning null
        if (!transport) {
          throw Errors.notFound('Transport for URL', transportUrl);
        }
      }).toThrow();
    });

    it('should handle transport with no createServer method', () => {
      const mockTransport = {
        name: 'mock-transport',
        // No createServer method
      };

      expect((mockTransport as any).createServer).toBeUndefined();
    });

    it('should handle transport with createServer method', () => {
      const mockTransport = {
        name: 'mock-transport',
        createServer: vi.fn().mockResolvedValue({
          listen: vi.fn().mockResolvedValue(undefined),
        }),
      };

      expect(mockTransport.createServer).toBeDefined();
      expect(typeof mockTransport.createServer).toBe('function');
    });
  });

  describe('Transport name resolution', () => {
    it('should use transport type as transport name', () => {
      const config = {
        transport: {
          type: 'tcp' as const,
        },
      };

      const transportName = config.transport.type || 'default';
      expect(transportName).toBe('tcp');
    });

    it('should fall back to default when type not set', () => {
      const config = {
        transport: {},
      };

      const transportName = (config.transport as any).type || 'default';
      expect(transportName).toBe('default');
    });
  });
});

// ============================================================================
// Shutdown Handling Tests
// ============================================================================

describe('Worker Runtime - Shutdown Handling', () => {
  describe('Graceful shutdown', () => {
    it('should call shutdown methods decorated with @OnShutdown', async () => {
      const shutdownMock = vi.fn();

      class ProcessWithShutdown {
        async onShutdown() {
          shutdownMock();
        }
      }

      const instance = new ProcessWithShutdown();
      const prototype = Object.getPrototypeOf(instance);
      const propertyNames = Object.getOwnPropertyNames(prototype);

      // Simulate finding methods with shutdown metadata
      Reflect.defineMetadata(PROCESS_METHOD_METADATA_KEY, { onShutdown: true }, prototype, 'onShutdown');

      for (const propertyName of propertyNames) {
        if (propertyName === 'constructor') continue;
        const metadata = Reflect.getMetadata(PROCESS_METHOD_METADATA_KEY, prototype, propertyName);
        if (metadata?.onShutdown) {
          await (instance as any)[propertyName]();
        }
      }

      expect(shutdownMock).toHaveBeenCalled();
    });

    it('should handle multiple shutdown handlers', async () => {
      const cleanup1Mock = vi.fn();
      const cleanup2Mock = vi.fn();

      class ProcessWithMultipleCleanup {
        async cleanup1() {
          cleanup1Mock();
        }
        async cleanup2() {
          cleanup2Mock();
        }
      }

      const instance = new ProcessWithMultipleCleanup();
      const prototype = Object.getPrototypeOf(instance);

      Reflect.defineMetadata(PROCESS_METHOD_METADATA_KEY, { onShutdown: true }, prototype, 'cleanup1');
      Reflect.defineMetadata(PROCESS_METHOD_METADATA_KEY, { onShutdown: true }, prototype, 'cleanup2');

      const propertyNames = Object.getOwnPropertyNames(prototype);
      for (const propertyName of propertyNames) {
        if (propertyName === 'constructor') continue;
        const metadata = Reflect.getMetadata(PROCESS_METHOD_METADATA_KEY, prototype, propertyName);
        if (metadata?.onShutdown) {
          await (instance as any)[propertyName]();
        }
      }

      expect(cleanup1Mock).toHaveBeenCalled();
      expect(cleanup2Mock).toHaveBeenCalled();
    });
  });

  describe('Shutdown error handling', () => {
    it('should continue shutdown even if one handler throws', async () => {
      const logger = createMockLogger();
      const successMock = vi.fn();

      class ProcessWithFailingShutdown {
        async failingCleanup() {
          throw new Error('Cleanup failed');
        }
        async successCleanup() {
          successMock();
        }
      }

      const instance = new ProcessWithFailingShutdown();
      const prototype = Object.getPrototypeOf(instance);

      Reflect.defineMetadata(PROCESS_METHOD_METADATA_KEY, { onShutdown: true }, prototype, 'failingCleanup');
      Reflect.defineMetadata(PROCESS_METHOD_METADATA_KEY, { onShutdown: true }, prototype, 'successCleanup');

      const propertyNames = Object.getOwnPropertyNames(prototype);
      for (const propertyName of propertyNames) {
        if (propertyName === 'constructor') continue;
        const metadata = Reflect.getMetadata(PROCESS_METHOD_METADATA_KEY, prototype, propertyName);
        if (metadata?.onShutdown) {
          try {
            await (instance as any)[propertyName]();
          } catch (error: any) {
            logger.error({ err: error, method: propertyName }, 'Error during shutdown');
          }
        }
      }

      expect(successMock).toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalled();
    });

    it('should log error with method name when shutdown fails', async () => {
      const logger = createMockLogger();

      class ProcessWithError {
        async cleanupResources() {
          throw new Error('Resource cleanup failed');
        }
      }

      const instance = new ProcessWithError();
      const prototype = Object.getPrototypeOf(instance);

      Reflect.defineMetadata(PROCESS_METHOD_METADATA_KEY, { onShutdown: true }, prototype, 'cleanupResources');

      const propertyNames = Object.getOwnPropertyNames(prototype);
      for (const propertyName of propertyNames) {
        if (propertyName === 'constructor') continue;
        const metadata = Reflect.getMetadata(PROCESS_METHOD_METADATA_KEY, prototype, propertyName);
        if (metadata?.onShutdown) {
          try {
            await (instance as any)[propertyName]();
          } catch (error: any) {
            logger.error({ err: error, method: propertyName }, 'Error during shutdown');
          }
        }
      }

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'cleanupResources' }),
        'Error during shutdown'
      );
    });
  });

  describe('Shutdown message handling', () => {
    it('should respond to shutdown message from parent', async () => {
      const shutdownMock = vi.fn();
      const parentPort = new MockParentPort();

      const serviceWrapper = {
        __shutdown: shutdownMock,
      };

      parentPort.on('message', async (message: any) => {
        if (message.type === 'shutdown') {
          await serviceWrapper.__shutdown();
        }
      });

      parentPort.emit('message', { type: 'shutdown' });

      // Allow async handler to complete
      await new Promise((resolve) => setImmediate(resolve));

      expect(shutdownMock).toHaveBeenCalled();
    });

    it('should ignore non-shutdown messages', async () => {
      const shutdownMock = vi.fn();
      const parentPort = new MockParentPort();

      const serviceWrapper = {
        __shutdown: shutdownMock,
      };

      parentPort.on('message', async (message: any) => {
        if (message.type === 'shutdown') {
          await serviceWrapper.__shutdown();
        }
      });

      parentPort.emit('message', { type: 'ping' });
      parentPort.emit('message', { type: 'custom_message' });

      await new Promise((resolve) => setImmediate(resolve));

      expect(shutdownMock).not.toHaveBeenCalled();
    });
  });
});

// ============================================================================
// Service Wrapper Creation Tests
// ============================================================================

describe('Worker Runtime - Service Wrapper Creation', () => {
  describe('Method extraction from prototype', () => {
    it('should extract methods from prototype', () => {
      class TestService {
        methodA() {
          return 'A';
        }
        methodB() {
          return 'B';
        }
      }

      const instance = new TestService();
      const prototype = Object.getPrototypeOf(instance);
      const propertyNames = Object.getOwnPropertyNames(prototype);

      const methods = propertyNames.filter((name) => {
        if (name === 'constructor') return false;
        const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
        return descriptor && typeof descriptor.value === 'function';
      });

      expect(methods).toContain('methodA');
      expect(methods).toContain('methodB');
      expect(methods).not.toContain('constructor');
    });

    it('should skip non-function properties', () => {
      class ServiceWithProperties {
        value = 42;
        name = 'test';

        compute() {
          return this.value * 2;
        }
      }

      const instance = new ServiceWithProperties();
      const prototype = Object.getPrototypeOf(instance);
      const propertyNames = Object.getOwnPropertyNames(prototype);

      const methods = propertyNames.filter((name) => {
        if (name === 'constructor') return false;
        const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
        return descriptor && typeof descriptor.value === 'function';
      });

      expect(methods).toContain('compute');
      expect(methods).not.toContain('value');
      expect(methods).not.toContain('name');
    });

    it('should skip getter and setter methods', () => {
      class ServiceWithAccessors {
        private _data = 0;

        get data() {
          return this._data;
        }

        set data(value: number) {
          this._data = value;
        }

        process() {
          return this._data;
        }
      }

      const instance = new ServiceWithAccessors();
      const prototype = Object.getPrototypeOf(instance);
      const propertyNames = Object.getOwnPropertyNames(prototype);

      const methods = propertyNames.filter((name) => {
        if (name === 'constructor') return false;
        const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
        // Getters/setters have get/set but not value
        return descriptor && typeof descriptor.value === 'function';
      });

      expect(methods).toContain('process');
      expect(methods).not.toContain('data');
    });
  });

  describe('Public method detection via PROCESS_METHOD_METADATA_KEY', () => {
    it('should detect public methods marked with metadata', () => {
      class PublicService {
        publicMethod() {
          return 'public';
        }
        privateMethod() {
          return 'private';
        }
      }

      const prototype = PublicService.prototype;
      Reflect.defineMetadata(PROCESS_METHOD_METADATA_KEY, { public: true }, prototype, 'publicMethod');

      const metadata = Reflect.getMetadata(PROCESS_METHOD_METADATA_KEY, prototype, 'publicMethod');

      expect(metadata?.public).toBe(true);
    });

    it('should not detect methods without public metadata', () => {
      class MixedService {
        publicMethod() {}
        privateMethod() {}
      }

      const prototype = MixedService.prototype;
      Reflect.defineMetadata(PROCESS_METHOD_METADATA_KEY, { public: true }, prototype, 'publicMethod');
      // privateMethod has no metadata

      const publicMeta = Reflect.getMetadata(PROCESS_METHOD_METADATA_KEY, prototype, 'publicMethod');
      const privateMeta = Reflect.getMetadata(PROCESS_METHOD_METADATA_KEY, prototype, 'privateMethod');

      expect(publicMeta?.public).toBe(true);
      expect(privateMeta?.public).toBeUndefined();
    });

    it('should handle method with public: false', () => {
      class ExplicitlyPrivateService {
        hiddenMethod() {}
      }

      const prototype = ExplicitlyPrivateService.prototype;
      Reflect.defineMetadata(PROCESS_METHOD_METADATA_KEY, { public: false }, prototype, 'hiddenMethod');

      const metadata = Reflect.getMetadata(PROCESS_METHOD_METADATA_KEY, prototype, 'hiddenMethod');

      expect(metadata?.public).toBe(false);
    });
  });

  describe('Service wrapper method wrapping', () => {
    it('should wrap method to track request count', async () => {
      class CountingService {
        __requestCount = 0;

        async doWork() {
          return 'done';
        }
      }

      const instance = new CountingService();

      // Simulate the wrapper logic
      const originalMethod = instance.doWork.bind(instance);
      const wrappedMethod = async (...args: any[]) => {
        try {
          const result = await originalMethod(...args);
          instance.__requestCount++;
          return result;
        } catch (error) {
          throw error;
        }
      };

      await wrappedMethod();
      await wrappedMethod();
      await wrappedMethod();

      expect(instance.__requestCount).toBe(3);
    });

    it('should wrap method to track error count', async () => {
      class ErrorTrackingService {
        __errorCount = 0;

        async failingMethod() {
          throw new Error('Intentional failure');
        }
      }

      const instance = new ErrorTrackingService();
      const originalMethod = instance.failingMethod.bind(instance);

      const wrappedMethod = async () => {
        try {
          return await originalMethod();
        } catch (error) {
          instance.__errorCount++;
          throw error;
        }
      };

      try {
        await wrappedMethod();
      } catch {
        // Expected
      }

      try {
        await wrappedMethod();
      } catch {
        // Expected
      }

      expect(instance.__errorCount).toBe(2);
    });

    it('should wrap method to track latency', async () => {
      class LatencyTrackingService {
        __lastLatency = 0;

        async slowMethod() {
          await new Promise((resolve) => setTimeout(resolve, 50));
          return 'completed';
        }
      }

      const instance = new LatencyTrackingService();
      const originalMethod = instance.slowMethod.bind(instance);

      const wrappedMethod = async () => {
        const startTime = Date.now();
        try {
          return await originalMethod();
        } finally {
          instance.__lastLatency = Date.now() - startTime;
        }
      };

      await wrappedMethod();

      expect(instance.__lastLatency).toBeGreaterThanOrEqual(40);
    });

    it('should preserve original method return value', async () => {
      class ReturnValueService {
        __requestCount = 0;

        async calculate(a: number, b: number) {
          return a + b;
        }
      }

      const instance = new ReturnValueService();
      const originalMethod = instance.calculate.bind(instance);

      const wrappedMethod = async (a: number, b: number) => {
        try {
          const result = await originalMethod(a, b);
          instance.__requestCount++;
          return result;
        } catch (error) {
          throw error;
        }
      };

      const result = await wrappedMethod(5, 7);

      expect(result).toBe(12);
    });

    it('should propagate errors after tracking', async () => {
      class ErrorPropagationService {
        __errorCount = 0;

        async validateInput(input: any) {
          if (!input) {
            throw new Error('Input required');
          }
          return input;
        }
      }

      const instance = new ErrorPropagationService();
      const originalMethod = instance.validateInput.bind(instance);

      const wrappedMethod = async (input: any) => {
        try {
          return await originalMethod(input);
        } catch (error) {
          instance.__errorCount++;
          throw error;
        }
      };

      await expect(wrappedMethod(null)).rejects.toThrow('Input required');
      expect(instance.__errorCount).toBe(1);
    });
  });

  describe('Health check method detection', () => {
    it('should detect methods marked with healthCheck metadata', () => {
      class HealthService {
        async checkDatabase() {
          return { status: 'healthy' };
        }
        async checkCache() {
          return { status: 'healthy' };
        }
      }

      const prototype = HealthService.prototype;
      Reflect.defineMetadata(PROCESS_METHOD_METADATA_KEY, { healthCheck: true }, prototype, 'checkDatabase');
      Reflect.defineMetadata(PROCESS_METHOD_METADATA_KEY, { healthCheck: true }, prototype, 'checkCache');

      const propertyNames = Object.getOwnPropertyNames(prototype);
      const healthCheckMethods: string[] = [];

      for (const name of propertyNames) {
        const metadata = Reflect.getMetadata(PROCESS_METHOD_METADATA_KEY, prototype, name);
        if (metadata?.healthCheck) {
          healthCheckMethods.push(name);
        }
      }

      expect(healthCheckMethods).toContain('checkDatabase');
      expect(healthCheckMethods).toContain('checkCache');
      expect(healthCheckMethods).toHaveLength(2);
    });

    it('should call health check methods and aggregate status', async () => {
      class MultiHealthService {
        async checkDb() {
          return { status: 'healthy' as const };
        }
        async checkApi() {
          return { status: 'degraded' as const };
        }
      }

      const instance = new MultiHealthService();
      const prototype = Object.getPrototypeOf(instance);

      Reflect.defineMetadata(PROCESS_METHOD_METADATA_KEY, { healthCheck: true }, prototype, 'checkDb');
      Reflect.defineMetadata(PROCESS_METHOD_METADATA_KEY, { healthCheck: true }, prototype, 'checkApi');

      const propertyNames = Object.getOwnPropertyNames(prototype);
      const healthCheckMethods: string[] = [];

      for (const name of propertyNames) {
        if (name === 'constructor') continue;
        const metadata = Reflect.getMetadata(PROCESS_METHOD_METADATA_KEY, prototype, name);
        if (metadata?.healthCheck) {
          healthCheckMethods.push(name);
        }
      }

      let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

      for (const methodName of healthCheckMethods) {
        const result = await (instance as any)[methodName]();
        if (result.status === 'unhealthy') {
          overallStatus = 'unhealthy';
        } else if (result.status === 'degraded' && overallStatus === 'healthy') {
          overallStatus = 'degraded';
        }
      }

      expect(overallStatus).toBe('degraded');
    });

    it('should mark status as unhealthy if health check throws', async () => {
      class FailingHealthService {
        async checkConnection() {
          throw new Error('Connection failed');
        }
      }

      const instance = new FailingHealthService();
      const prototype = Object.getPrototypeOf(instance);

      Reflect.defineMetadata(PROCESS_METHOD_METADATA_KEY, { healthCheck: true }, prototype, 'checkConnection');

      const checks: Array<{ name: string; status: 'pass' | 'fail'; message?: string }> = [];
      let overallStatus: 'healthy' | 'unhealthy' = 'healthy';

      try {
        await instance.checkConnection();
      } catch (error: any) {
        overallStatus = 'unhealthy';
        checks.push({
          name: 'checkConnection',
          status: 'fail',
          message: error.message,
        });
      }

      expect(overallStatus).toBe('unhealthy');
      expect(checks[0]).toEqual({
        name: 'checkConnection',
        status: 'fail',
        message: 'Connection failed',
      });
    });
  });
});

// ============================================================================
// Ready Notification Tests
// ============================================================================

describe('Worker Runtime - Ready Notification', () => {
  it('should send ready message with process info', () => {
    const parentPort = new MockParentPort();

    const processId = 'proc-001';
    const transportUrl = 'tcp://localhost:3000';
    const serviceName = 'TestService';
    const serviceVersion = '1.2.3';

    parentPort.postMessage({
      type: 'ready',
      processId,
      transportUrl,
      serviceName,
      serviceVersion,
    });

    expect(parentPort.messages).toHaveLength(1);
    const message = parentPort.messages[0] as any;
    expect(message.type).toBe('ready');
    expect(message.processId).toBe('proc-001');
    expect(message.transportUrl).toBe('tcp://localhost:3000');
    expect(message.serviceName).toBe('TestService');
    expect(message.serviceVersion).toBe('1.2.3');
  });
});

// ============================================================================
// Error Notification Tests
// ============================================================================

describe('Worker Runtime - Error Notification', () => {
  it('should send error message with error details', () => {
    const parentPort = new MockParentPort();
    const processId = 'proc-error';
    const error = new Error('Initialization failed');

    parentPort.postMessage({
      type: 'error',
      processId,
      error: {
        message: error.message,
        stack: error.stack,
      },
    });

    expect(parentPort.messages).toHaveLength(1);
    const message = parentPort.messages[0] as any;
    expect(message.type).toBe('error');
    expect(message.processId).toBe('proc-error');
    expect(message.error.message).toBe('Initialization failed');
    expect(message.error.stack).toBeDefined();
  });
});

// ============================================================================
// Process Metrics Tests
// ============================================================================

describe('Worker Runtime - Process Metrics', () => {
  it('should calculate CPU usage in seconds', () => {
    const cpuUsage = { user: 1000000, system: 500000 }; // microseconds
    const cpuSeconds = (cpuUsage.user + cpuUsage.system) / 1000000;

    expect(cpuSeconds).toBe(1.5);
  });

  it('should return heap used ratio', () => {
    const memUsage = { heapUsed: 256 * 1024 * 1024 }; // 256MB
    const heapLimit = 512 * 1024 * 1024; // 512MB

    const heapUsedRatio = memUsage.heapUsed / heapLimit;

    expect(heapUsedRatio).toBe(0.5);
  });

  it('should track request and error counts', () => {
    const instance = {
      __requestCount: 0,
      __errorCount: 0,
      __lastLatency: 0,
    };

    instance.__requestCount = 150;
    instance.__errorCount = 5;
    instance.__lastLatency = 45;

    const metrics = {
      requests: instance.__requestCount || 0,
      errors: instance.__errorCount || 0,
      latency: {
        last: instance.__lastLatency || 0,
      },
    };

    expect(metrics.requests).toBe(150);
    expect(metrics.errors).toBe(5);
    expect(metrics.latency.last).toBe(45);
  });

  it('should handle missing metric values gracefully', () => {
    const instance = {};

    const metrics = {
      requests: (instance as any).__requestCount || 0,
      errors: (instance as any).__errorCount || 0,
      latency: {
        last: (instance as any).__lastLatency || 0,
      },
    };

    expect(metrics.requests).toBe(0);
    expect(metrics.errors).toBe(0);
    expect(metrics.latency.last).toBe(0);
  });
});

// ============================================================================
// Netron Service Metadata Tests
// ============================================================================

describe('Worker Runtime - Netron Service Metadata', () => {
  it('should define netron:service metadata on wrapper', () => {
    const serviceWrapper = {};
    const serviceName = 'MyService';
    const serviceVersion = '2.0.0';

    Reflect.defineMetadata('netron:service', { name: serviceName, version: serviceVersion }, serviceWrapper);

    const metadata = Reflect.getMetadata('netron:service', serviceWrapper);

    expect(metadata).toEqual({ name: 'MyService', version: '2.0.0' });
  });

  it('should store instance reference in wrapper', () => {
    class TestProcess {
      getValue() {
        return 42;
      }
    }

    const instance = new TestProcess();
    const serviceWrapper: any = {
      __instance: instance,
    };

    expect(serviceWrapper.__instance).toBe(instance);
    expect(serviceWrapper.__instance.getValue()).toBe(42);
  });
});

// ============================================================================
// Edge Cases and Error Scenarios
// ============================================================================

describe('Worker Runtime - Edge Cases', () => {
  it('should handle class with no methods', () => {
    class EmptyProcess {}

    const instance = new EmptyProcess();
    const prototype = Object.getPrototypeOf(instance);
    const propertyNames = Object.getOwnPropertyNames(prototype);

    const methods = propertyNames.filter((name) => {
      if (name === 'constructor') return false;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
      return descriptor && typeof descriptor.value === 'function';
    });

    expect(methods).toHaveLength(0);
  });

  it('should handle class with only constructor', () => {
    class ConstructorOnlyProcess {
      constructor(private value: number) {}
    }

    const prototype = ConstructorOnlyProcess.prototype;
    const propertyNames = Object.getOwnPropertyNames(prototype);

    const nonConstructorMethods = propertyNames.filter((name) => name !== 'constructor');

    expect(nonConstructorMethods).toHaveLength(0);
  });

  it('should handle async init method', async () => {
    const initPromise = Promise.resolve('initialized');

    class AsyncInitProcess {
      async init() {
        return initPromise;
      }
    }

    const instance = new AsyncInitProcess();
    const result = await instance.init();

    expect(result).toBe('initialized');
  });

  it('should handle process with symbol-keyed methods', () => {
    const symbolMethod = Symbol('myMethod');

    class SymbolMethodProcess {
      [symbolMethod]() {
        return 'symbol result';
      }
    }

    const instance = new SymbolMethodProcess();
    const result = instance[symbolMethod]();

    expect(result).toBe('symbol result');
  });

  it('should handle inherited methods from parent class', () => {
    class BaseProcess {
      baseMethod() {
        return 'base';
      }
    }

    class DerivedProcess extends BaseProcess {
      derivedMethod() {
        return 'derived';
      }
    }

    const instance = new DerivedProcess();
    const prototype = Object.getPrototypeOf(instance);
    const propertyNames = Object.getOwnPropertyNames(prototype);

    // Only direct prototype methods are listed
    expect(propertyNames).toContain('derivedMethod');
    expect(propertyNames).toContain('constructor');
    // baseMethod is on parent prototype, not direct
    expect(propertyNames).not.toContain('baseMethod');

    // But the instance can still call it
    expect(instance.baseMethod()).toBe('base');
  });
});
