/**
 * Worker Unit Tests
 *
 * Comprehensive tests for the worker.ts module in the PM system.
 * Tests cover:
 * - Transport configuration (unix, tcp, http, ws, ipc)
 * - Service metadata copying from ProcessClass to ServiceClass
 * - Message handling (shutdown, ping, unknown messages)
 * - Worker configuration parsing and validation
 *
 * Note: These tests do NOT spawn real worker threads. Instead, they test
 * the logic patterns and configurations used by the worker module.
 */

import 'reflect-metadata';
import { describe, it, expect, beforeEach } from 'vitest';
import { EventEmitter } from '@omnitron-dev/eventemitter';

// ============================================================================
// Test Utilities and Types
// ============================================================================

/**
 * WorkerConfig interface matching worker.ts
 */
interface WorkerConfig {
  processId: string;
  className: string;
  modulePath: string;
  netron: {
    id: string;
    transport: string;
    listenHost: string;
    listenPort: number;
    discoveryEnabled?: boolean;
    discoveryUrl?: string;
  };
  serviceName?: string;
  version?: string;
  options?: any;
}

/**
 * Transport configuration result
 */
interface TransportConfigResult {
  transportUrl: string;
  transportName: string;
  transportOptions: {
    host: string;
    port: number;
    path?: string;
  };
}

/**
 * Configure transport based on configuration
 * Extracted logic from worker.ts for testability
 */
function configureTransport(
  transport: string,
  listenHost: string,
  listenPort: number,
  processId: string
): TransportConfigResult {
  let transportUrl = '';
  let transportName = 'ws'; // default
  const transportOptions: any = {
    host: listenHost,
    port: listenPort,
  };

  switch (transport) {
    case 'unix':
      transportUrl = `unix:///tmp/titan-pm-${processId}.sock`;
      transportName = 'unix';
      transportOptions.path = transportUrl;
      break;
    case 'tcp':
      transportUrl = `tcp://${listenHost}:${listenPort}`;
      transportName = 'tcp';
      break;
    case 'http':
      transportUrl = `http://${listenHost}:${listenPort}`;
      transportName = 'http';
      break;
    case 'websocket':
    case 'ws':
      transportUrl = `ws://${listenHost}:${listenPort}`;
      transportName = 'ws';
      break;
    default:
      transportUrl = `ws://${listenHost}:${listenPort}`;
      transportName = 'ws';
  }

  return { transportUrl, transportName, transportOptions };
}

/**
 * Copy metadata from ProcessClass to ServiceClass
 * Extracted logic from worker.ts for testability
 */
function copyServiceMetadata(ProcessClass: any, ServiceClass: any, serviceName: string, version: string): void {
  const processMetadata = Reflect.getMetadata('netron:service', ProcessClass) || {};
  Reflect.defineMetadata(
    'netron:service',
    {
      ...processMetadata,
      name: serviceName,
      version,
    },
    ServiceClass
  );
}

/**
 * Extract public methods from a process instance
 * Extracted logic from worker.ts for testability
 */
function extractPublicMethods(processInstance: any, PROCESS_METHOD_METADATA_KEY: symbol): Map<string, Function> {
  const publicMethods = new Map<string, Function>();
  const prototype = Object.getPrototypeOf(processInstance);
  const methodNames = Object.getOwnPropertyNames(prototype);

  for (const methodName of methodNames) {
    if (methodName === 'constructor') continue;

    const descriptor = Object.getOwnPropertyDescriptor(prototype, methodName);
    if (!descriptor || typeof descriptor.value !== 'function') continue;

    // Check if method is marked as public
    const metadata = Reflect.getMetadata(PROCESS_METHOD_METADATA_KEY, prototype, methodName);
    if (metadata?.public) {
      publicMethods.set(methodName, descriptor.value.bind(processInstance));
    }
  }

  return publicMethods;
}

/**
 * Mock parent port for testing message handling
 */
class MockParentPort extends EventEmitter {
  public messages: any[] = [];

  postMessage(message: any): void {
    this.messages.push(message);
  }
}

/**
 * Message handler extracted from worker.ts pattern
 */
function createMessageHandler(
  serviceInterface: { __shutdown: () => Promise<void> },
  parentPort: MockParentPort
): (message: { type: string }) => Promise<void> {
  return async (message: { type: string }) => {
    switch (message.type) {
      case 'shutdown':
        await serviceInterface.__shutdown();
        break;
      case 'ping':
        parentPort.postMessage({ type: 'pong' });
        break;
      default:
        // Unknown message types are silently ignored
        break;
    }
  };
}

// ============================================================================
// Transport Configuration Tests
// ============================================================================

describe('Worker Transport Configuration', () => {
  describe('Unix socket transport', () => {
    it('should configure unix socket with process-specific path', () => {
      const result = configureTransport('unix', 'localhost', 3000, 'test-process-123');

      expect(result.transportUrl).toBe('unix:///tmp/titan-pm-test-process-123.sock');
      expect(result.transportName).toBe('unix');
      expect(result.transportOptions.path).toBe('unix:///tmp/titan-pm-test-process-123.sock');
    });

    it('should preserve host and port in transport options', () => {
      const result = configureTransport('unix', '127.0.0.1', 8080, 'proc-456');

      expect(result.transportOptions.host).toBe('127.0.0.1');
      expect(result.transportOptions.port).toBe(8080);
    });

    it('should handle special characters in processId', () => {
      const result = configureTransport('unix', 'localhost', 3000, 'process-with-dashes-and_underscores');

      expect(result.transportUrl).toBe('unix:///tmp/titan-pm-process-with-dashes-and_underscores.sock');
    });
  });

  describe('TCP transport', () => {
    it('should configure tcp with host and port', () => {
      const result = configureTransport('tcp', '192.168.1.100', 4000, 'tcp-process');

      expect(result.transportUrl).toBe('tcp://192.168.1.100:4000');
      expect(result.transportName).toBe('tcp');
      expect(result.transportOptions.host).toBe('192.168.1.100');
      expect(result.transportOptions.port).toBe(4000);
    });

    it('should handle localhost', () => {
      const result = configureTransport('tcp', 'localhost', 5000, 'local-tcp');

      expect(result.transportUrl).toBe('tcp://localhost:5000');
    });

    it('should handle IPv6 addresses', () => {
      const result = configureTransport('tcp', '::1', 6000, 'ipv6-tcp');

      expect(result.transportUrl).toBe('tcp://::1:6000');
    });

    it('should not set path in transport options for tcp', () => {
      const result = configureTransport('tcp', 'localhost', 3000, 'test');

      expect(result.transportOptions.path).toBeUndefined();
    });
  });

  describe('HTTP transport', () => {
    it('should configure http with host and port', () => {
      const result = configureTransport('http', '0.0.0.0', 8080, 'http-process');

      expect(result.transportUrl).toBe('http://0.0.0.0:8080');
      expect(result.transportName).toBe('http');
    });

    it('should work with standard http port', () => {
      const result = configureTransport('http', 'localhost', 80, 'http-standard');

      expect(result.transportUrl).toBe('http://localhost:80');
    });

    it('should preserve all transport options', () => {
      const result = configureTransport('http', 'api.example.com', 3000, 'http-api');

      expect(result.transportOptions).toEqual({
        host: 'api.example.com',
        port: 3000,
      });
    });
  });

  describe('WebSocket transport', () => {
    it('should configure websocket with "websocket" keyword', () => {
      const result = configureTransport('websocket', 'localhost', 3001, 'ws-process');

      expect(result.transportUrl).toBe('ws://localhost:3001');
      expect(result.transportName).toBe('ws');
    });

    it('should configure websocket with "ws" keyword', () => {
      const result = configureTransport('ws', 'localhost', 3002, 'ws-short');

      expect(result.transportUrl).toBe('ws://localhost:3002');
      expect(result.transportName).toBe('ws');
    });

    it('should produce same result for "websocket" and "ws"', () => {
      const resultWebsocket = configureTransport('websocket', 'localhost', 3000, 'test');
      const resultWs = configureTransport('ws', 'localhost', 3000, 'test');

      expect(resultWebsocket.transportUrl).toBe(resultWs.transportUrl);
      expect(resultWebsocket.transportName).toBe(resultWs.transportName);
    });
  });

  describe('Default fallback behavior', () => {
    it('should fallback to websocket for unknown transport type', () => {
      const result = configureTransport('unknown', 'localhost', 3000, 'unknown-proc');

      expect(result.transportUrl).toBe('ws://localhost:3000');
      expect(result.transportName).toBe('ws');
    });

    it('should fallback to websocket for empty string', () => {
      const result = configureTransport('', 'localhost', 3000, 'empty-proc');

      expect(result.transportUrl).toBe('ws://localhost:3000');
      expect(result.transportName).toBe('ws');
    });

    it('should fallback to websocket for misspelled transport', () => {
      const result = configureTransport('tcpp', 'localhost', 3000, 'typo-proc');

      expect(result.transportUrl).toBe('ws://localhost:3000');
      expect(result.transportName).toBe('ws');
    });

    it('should fallback to websocket for case-sensitive mismatch', () => {
      // The switch is case-sensitive, so 'TCP' should fallback to ws
      const result = configureTransport('TCP', 'localhost', 3000, 'case-proc');

      expect(result.transportUrl).toBe('ws://localhost:3000');
      expect(result.transportName).toBe('ws');
    });

    it('should fallback to websocket for null-like values', () => {
      const result = configureTransport(undefined as any, 'localhost', 3000, 'null-proc');

      expect(result.transportName).toBe('ws');
    });
  });

  describe('Edge cases', () => {
    it('should handle port 0 (dynamic port)', () => {
      const result = configureTransport('tcp', 'localhost', 0, 'dynamic-port');

      expect(result.transportUrl).toBe('tcp://localhost:0');
      expect(result.transportOptions.port).toBe(0);
    });

    it('should handle high port numbers', () => {
      const result = configureTransport('tcp', 'localhost', 65535, 'high-port');

      expect(result.transportUrl).toBe('tcp://localhost:65535');
    });

    it('should handle empty host', () => {
      const result = configureTransport('tcp', '', 3000, 'empty-host');

      expect(result.transportUrl).toBe('tcp://:3000');
      expect(result.transportOptions.host).toBe('');
    });
  });
});

// ============================================================================
// Service Metadata Copying Tests
// ============================================================================

describe('Service Metadata Copying', () => {
  beforeEach(() => {
    // Clean up any existing metadata
  });

  describe('Basic metadata copying', () => {
    it('should copy metadata from ProcessClass to ServiceClass', () => {
      class ProcessClass {}
      Reflect.defineMetadata('netron:service', { custom: 'value' }, ProcessClass);

      class ServiceClass {}
      copyServiceMetadata(ProcessClass, ServiceClass, 'TestService', '1.0.0');

      const metadata = Reflect.getMetadata('netron:service', ServiceClass);

      expect(metadata).toBeDefined();
      expect(metadata.name).toBe('TestService');
      expect(metadata.version).toBe('1.0.0');
      expect(metadata.custom).toBe('value');
    });

    it('should handle ProcessClass without existing metadata', () => {
      class ProcessClass {}
      class ServiceClass {}

      copyServiceMetadata(ProcessClass, ServiceClass, 'NewService', '2.0.0');

      const metadata = Reflect.getMetadata('netron:service', ServiceClass);

      expect(metadata).toBeDefined();
      expect(metadata.name).toBe('NewService');
      expect(metadata.version).toBe('2.0.0');
    });

    it('should override name and version from config', () => {
      class ProcessClass {}
      Reflect.defineMetadata('netron:service', { name: 'OriginalName', version: '0.1.0' }, ProcessClass);

      class ServiceClass {}
      copyServiceMetadata(ProcessClass, ServiceClass, 'OverriddenName', '3.0.0');

      const metadata = Reflect.getMetadata('netron:service', ServiceClass);

      expect(metadata.name).toBe('OverriddenName');
      expect(metadata.version).toBe('3.0.0');
    });
  });

  describe('Metadata preservation', () => {
    it('should preserve additional metadata properties', () => {
      class ProcessClass {}
      Reflect.defineMetadata(
        'netron:service',
        {
          description: 'A test service',
          author: 'Test Author',
          tags: ['test', 'unit'],
        },
        ProcessClass
      );

      class ServiceClass {}
      copyServiceMetadata(ProcessClass, ServiceClass, 'PreserveTest', '1.0.0');

      const metadata = Reflect.getMetadata('netron:service', ServiceClass);

      expect(metadata.description).toBe('A test service');
      expect(metadata.author).toBe('Test Author');
      expect(metadata.tags).toEqual(['test', 'unit']);
    });

    it('should preserve nested metadata objects', () => {
      class ProcessClass {}
      Reflect.defineMetadata(
        'netron:service',
        {
          config: {
            timeout: 5000,
            retries: 3,
          },
        },
        ProcessClass
      );

      class ServiceClass {}
      copyServiceMetadata(ProcessClass, ServiceClass, 'NestedTest', '1.0.0');

      const metadata = Reflect.getMetadata('netron:service', ServiceClass);

      expect(metadata.config).toEqual({ timeout: 5000, retries: 3 });
    });
  });

  describe('Edge cases', () => {
    it('should handle empty serviceName', () => {
      class ProcessClass {}
      class ServiceClass {}

      copyServiceMetadata(ProcessClass, ServiceClass, '', '1.0.0');

      const metadata = Reflect.getMetadata('netron:service', ServiceClass);

      expect(metadata.name).toBe('');
    });

    it('should handle empty version', () => {
      class ProcessClass {}
      class ServiceClass {}

      copyServiceMetadata(ProcessClass, ServiceClass, 'TestService', '');

      const metadata = Reflect.getMetadata('netron:service', ServiceClass);

      expect(metadata.version).toBe('');
    });

    it('should not modify original ProcessClass metadata', () => {
      class ProcessClass {}
      const originalMetadata = { original: true };
      Reflect.defineMetadata('netron:service', originalMetadata, ProcessClass);

      class ServiceClass {}
      copyServiceMetadata(ProcessClass, ServiceClass, 'ModifyTest', '1.0.0');

      const processMetadata = Reflect.getMetadata('netron:service', ProcessClass);

      // Original should remain unchanged
      expect(processMetadata).toBe(originalMetadata);
      expect(processMetadata.name).toBeUndefined();
    });
  });
});

// ============================================================================
// Message Handling Tests
// ============================================================================

describe('Worker Message Handling', () => {
  let mockParentPort: MockParentPort;
  let shutdownCalled: boolean;
  let messageHandler: (message: { type: string }) => Promise<void>;

  beforeEach(() => {
    mockParentPort = new MockParentPort();
    shutdownCalled = false;

    const serviceInterface = {
      __shutdown: async () => {
        shutdownCalled = true;
      },
    };

    messageHandler = createMessageHandler(serviceInterface, mockParentPort);
  });

  describe('Shutdown message handling', () => {
    it('should call __shutdown when receiving shutdown message', async () => {
      await messageHandler({ type: 'shutdown' });

      expect(shutdownCalled).toBe(true);
    });

    it('should handle async shutdown gracefully', async () => {
      let shutdownStarted = false;
      let shutdownCompleted = false;

      const asyncServiceInterface = {
        __shutdown: async () => {
          shutdownStarted = true;
          await new Promise((resolve) => setTimeout(resolve, 10));
          shutdownCompleted = true;
        },
      };

      const asyncHandler = createMessageHandler(asyncServiceInterface, mockParentPort);
      await asyncHandler({ type: 'shutdown' });

      expect(shutdownStarted).toBe(true);
      expect(shutdownCompleted).toBe(true);
    });
  });

  describe('Ping message handling', () => {
    it('should respond with pong when receiving ping message', async () => {
      await messageHandler({ type: 'ping' });

      expect(mockParentPort.messages).toContainEqual({ type: 'pong' });
    });

    it('should not call shutdown on ping', async () => {
      await messageHandler({ type: 'ping' });

      expect(shutdownCalled).toBe(false);
    });

    it('should respond to multiple pings', async () => {
      await messageHandler({ type: 'ping' });
      await messageHandler({ type: 'ping' });
      await messageHandler({ type: 'ping' });

      expect(mockParentPort.messages.filter((m) => m.type === 'pong')).toHaveLength(3);
    });
  });

  describe('Unknown message type handling', () => {
    it('should silently ignore unknown message types', async () => {
      await messageHandler({ type: 'unknown' });

      expect(shutdownCalled).toBe(false);
      expect(mockParentPort.messages).toHaveLength(0);
    });

    it('should ignore messages with empty type', async () => {
      await messageHandler({ type: '' });

      expect(shutdownCalled).toBe(false);
      expect(mockParentPort.messages).toHaveLength(0);
    });

    it('should ignore messages with arbitrary type', async () => {
      await messageHandler({ type: 'custom-event' });
      await messageHandler({ type: 'restart' });
      await messageHandler({ type: 'scale' });

      expect(shutdownCalled).toBe(false);
      expect(mockParentPort.messages).toHaveLength(0);
    });
  });

  describe('Message sequence handling', () => {
    it('should handle ping followed by shutdown', async () => {
      await messageHandler({ type: 'ping' });
      await messageHandler({ type: 'shutdown' });

      expect(mockParentPort.messages).toContainEqual({ type: 'pong' });
      expect(shutdownCalled).toBe(true);
    });

    it('should handle unknown message followed by ping', async () => {
      await messageHandler({ type: 'unknown' });
      await messageHandler({ type: 'ping' });

      expect(mockParentPort.messages).toHaveLength(1);
      expect(mockParentPort.messages[0]).toEqual({ type: 'pong' });
    });
  });
});

// ============================================================================
// Worker Configuration Parsing Tests
// ============================================================================

describe('Worker Configuration Parsing', () => {
  describe('Valid configuration parsing', () => {
    it('should accept minimal valid configuration', () => {
      const config: WorkerConfig = {
        processId: 'test-123',
        className: 'TestService',
        modulePath: '/path/to/module.js',
        netron: {
          id: 'netron-123',
          transport: 'tcp',
          listenHost: 'localhost',
          listenPort: 3000,
        },
      };

      expect(config.processId).toBe('test-123');
      expect(config.className).toBe('TestService');
      expect(config.netron.transport).toBe('tcp');
    });

    it('should accept full configuration with optional fields', () => {
      const config: WorkerConfig = {
        processId: 'full-config-123',
        className: 'FullService',
        modulePath: '/path/to/service.js',
        netron: {
          id: 'netron-full',
          transport: 'ws',
          listenHost: '0.0.0.0',
          listenPort: 8080,
          discoveryEnabled: true,
          discoveryUrl: 'http://discovery.local:3000',
        },
        serviceName: 'CustomServiceName',
        version: '2.0.0',
        options: { custom: 'value' },
      };

      expect(config.serviceName).toBe('CustomServiceName');
      expect(config.version).toBe('2.0.0');
      expect(config.netron.discoveryEnabled).toBe(true);
      expect(config.netron.discoveryUrl).toBe('http://discovery.local:3000');
      expect(config.options).toEqual({ custom: 'value' });
    });
  });

  describe('Configuration with missing fields', () => {
    it('should allow optional serviceName to be undefined', () => {
      const config: WorkerConfig = {
        processId: 'test',
        className: 'Test',
        modulePath: '/test.js',
        netron: {
          id: 'n1',
          transport: 'tcp',
          listenHost: 'localhost',
          listenPort: 3000,
        },
      };

      expect(config.serviceName).toBeUndefined();
    });

    it('should allow optional version to be undefined', () => {
      const config: WorkerConfig = {
        processId: 'test',
        className: 'Test',
        modulePath: '/test.js',
        netron: {
          id: 'n1',
          transport: 'tcp',
          listenHost: 'localhost',
          listenPort: 3000,
        },
      };

      expect(config.version).toBeUndefined();
    });

    it('should allow optional discovery fields to be undefined', () => {
      const config: WorkerConfig = {
        processId: 'test',
        className: 'Test',
        modulePath: '/test.js',
        netron: {
          id: 'n1',
          transport: 'tcp',
          listenHost: 'localhost',
          listenPort: 3000,
        },
      };

      expect(config.netron.discoveryEnabled).toBeUndefined();
      expect(config.netron.discoveryUrl).toBeUndefined();
    });
  });

  describe('Configuration defaults behavior', () => {
    it('should use className as serviceName fallback in metadata copy', () => {
      const config: WorkerConfig = {
        processId: 'test',
        className: 'MyTestClass',
        modulePath: '/test.js',
        netron: {
          id: 'n1',
          transport: 'tcp',
          listenHost: 'localhost',
          listenPort: 3000,
        },
      };

      class ProcessClass {}
      class ServiceClass {}

      // Simulate the fallback behavior from worker.ts
      const serviceName = config.serviceName || config.className;
      const version = config.version || '1.0.0';

      copyServiceMetadata(ProcessClass, ServiceClass, serviceName, version);

      const metadata = Reflect.getMetadata('netron:service', ServiceClass);

      expect(metadata.name).toBe('MyTestClass');
      expect(metadata.version).toBe('1.0.0');
    });

    it('should use provided serviceName when available', () => {
      const config: WorkerConfig = {
        processId: 'test',
        className: 'MyTestClass',
        modulePath: '/test.js',
        netron: {
          id: 'n1',
          transport: 'tcp',
          listenHost: 'localhost',
          listenPort: 3000,
        },
        serviceName: 'CustomName',
        version: '2.5.0',
      };

      class ProcessClass {}
      class ServiceClass {}

      const serviceName = config.serviceName || config.className;
      const version = config.version || '1.0.0';

      copyServiceMetadata(ProcessClass, ServiceClass, serviceName, version);

      const metadata = Reflect.getMetadata('netron:service', ServiceClass);

      expect(metadata.name).toBe('CustomName');
      expect(metadata.version).toBe('2.5.0');
    });
  });

  describe('Configuration with invalid values', () => {
    it('should handle negative port numbers', () => {
      const config: WorkerConfig = {
        processId: 'test',
        className: 'Test',
        modulePath: '/test.js',
        netron: {
          id: 'n1',
          transport: 'tcp',
          listenHost: 'localhost',
          listenPort: -1, // Invalid but allowed by type
        },
      };

      const result = configureTransport(
        config.netron.transport,
        config.netron.listenHost,
        config.netron.listenPort,
        config.processId
      );

      // The function doesn't validate port - it just uses it
      expect(result.transportUrl).toBe('tcp://localhost:-1');
    });

    it('should handle very long processId', () => {
      const longId = 'a'.repeat(1000);
      const config: WorkerConfig = {
        processId: longId,
        className: 'Test',
        modulePath: '/test.js',
        netron: {
          id: 'n1',
          transport: 'unix',
          listenHost: 'localhost',
          listenPort: 3000,
        },
      };

      const result = configureTransport(
        config.netron.transport,
        config.netron.listenHost,
        config.netron.listenPort,
        config.processId
      );

      expect(result.transportUrl).toContain(longId);
    });

    it('should handle special characters in modulePath', () => {
      const config: WorkerConfig = {
        processId: 'test',
        className: 'Test',
        modulePath: '/path/with spaces/and-special_chars!/module.js',
        netron: {
          id: 'n1',
          transport: 'tcp',
          listenHost: 'localhost',
          listenPort: 3000,
        },
      };

      expect(config.modulePath).toContain('spaces');
      expect(config.modulePath).toContain('!');
    });
  });
});

// ============================================================================
// Public Method Extraction Tests
// ============================================================================

describe('Public Method Extraction', () => {
  const PROCESS_METHOD_METADATA_KEY = Symbol.for('process:method:metadata');

  describe('Basic method extraction', () => {
    it('should extract methods marked as public', () => {
      class TestProcess {
        publicMethod() {
          return 'public';
        }
        privateMethod() {
          return 'private';
        }
      }

      // Mark publicMethod as public
      Reflect.defineMetadata(PROCESS_METHOD_METADATA_KEY, { public: true }, TestProcess.prototype, 'publicMethod');

      const instance = new TestProcess();
      const publicMethods = extractPublicMethods(instance, PROCESS_METHOD_METADATA_KEY);

      expect(publicMethods.has('publicMethod')).toBe(true);
      expect(publicMethods.has('privateMethod')).toBe(false);
    });

    it('should skip constructor', () => {
      class TestProcess {
        constructor() {}
        publicMethod() {
          return 'public';
        }
      }

      Reflect.defineMetadata(PROCESS_METHOD_METADATA_KEY, { public: true }, TestProcess.prototype, 'publicMethod');
      Reflect.defineMetadata(PROCESS_METHOD_METADATA_KEY, { public: true }, TestProcess.prototype, 'constructor');

      const instance = new TestProcess();
      const publicMethods = extractPublicMethods(instance, PROCESS_METHOD_METADATA_KEY);

      expect(publicMethods.has('constructor')).toBe(false);
      expect(publicMethods.has('publicMethod')).toBe(true);
    });

    it('should skip properties that are not functions', () => {
      class TestProcess {
        stringProp = 'hello';
        numberProp = 42;
        publicMethod() {
          return 'method';
        }
      }

      Reflect.defineMetadata(PROCESS_METHOD_METADATA_KEY, { public: true }, TestProcess.prototype, 'stringProp');
      Reflect.defineMetadata(PROCESS_METHOD_METADATA_KEY, { public: true }, TestProcess.prototype, 'publicMethod');

      const instance = new TestProcess();
      const publicMethods = extractPublicMethods(instance, PROCESS_METHOD_METADATA_KEY);

      expect(publicMethods.has('stringProp')).toBe(false);
      expect(publicMethods.has('publicMethod')).toBe(true);
    });
  });

  describe('Bound methods', () => {
    it('should bind methods to the process instance', () => {
      class TestProcess {
        private value = 'instance-value';

        getValue() {
          return this.value;
        }
      }

      Reflect.defineMetadata(PROCESS_METHOD_METADATA_KEY, { public: true }, TestProcess.prototype, 'getValue');

      const instance = new TestProcess();
      const publicMethods = extractPublicMethods(instance, PROCESS_METHOD_METADATA_KEY);

      const getValueFn = publicMethods.get('getValue')!;
      expect(getValueFn()).toBe('instance-value');
    });

    it('should maintain correct this context when called', async () => {
      class TestProcess {
        private counter = 0;

        increment() {
          this.counter++;
          return this.counter;
        }
      }

      Reflect.defineMetadata(PROCESS_METHOD_METADATA_KEY, { public: true }, TestProcess.prototype, 'increment');

      const instance = new TestProcess();
      const publicMethods = extractPublicMethods(instance, PROCESS_METHOD_METADATA_KEY);

      const incrementFn = publicMethods.get('increment')!;
      expect(incrementFn()).toBe(1);
      expect(incrementFn()).toBe(2);
      expect(incrementFn()).toBe(3);
    });
  });

  describe('Multiple public methods', () => {
    it('should extract all marked public methods', () => {
      class TestProcess {
        method1() {}
        method2() {}
        method3() {}
        privateMethod() {}
      }

      Reflect.defineMetadata(PROCESS_METHOD_METADATA_KEY, { public: true }, TestProcess.prototype, 'method1');
      Reflect.defineMetadata(PROCESS_METHOD_METADATA_KEY, { public: true }, TestProcess.prototype, 'method2');
      Reflect.defineMetadata(PROCESS_METHOD_METADATA_KEY, { public: true }, TestProcess.prototype, 'method3');

      const instance = new TestProcess();
      const publicMethods = extractPublicMethods(instance, PROCESS_METHOD_METADATA_KEY);

      expect(publicMethods.size).toBe(3);
      expect(publicMethods.has('method1')).toBe(true);
      expect(publicMethods.has('method2')).toBe(true);
      expect(publicMethods.has('method3')).toBe(true);
      expect(publicMethods.has('privateMethod')).toBe(false);
    });
  });

  describe('Edge cases', () => {
    it('should handle class with no public methods', () => {
      class TestProcess {
        privateMethod1() {}
        privateMethod2() {}
      }

      const instance = new TestProcess();
      const publicMethods = extractPublicMethods(instance, PROCESS_METHOD_METADATA_KEY);

      expect(publicMethods.size).toBe(0);
    });

    it('should handle class with only constructor', () => {
      class EmptyProcess {
        constructor() {}
      }

      const instance = new EmptyProcess();
      const publicMethods = extractPublicMethods(instance, PROCESS_METHOD_METADATA_KEY);

      expect(publicMethods.size).toBe(0);
    });

    it('should handle metadata with public: false', () => {
      class TestProcess {
        method() {}
      }

      Reflect.defineMetadata(PROCESS_METHOD_METADATA_KEY, { public: false }, TestProcess.prototype, 'method');

      const instance = new TestProcess();
      const publicMethods = extractPublicMethods(instance, PROCESS_METHOD_METADATA_KEY);

      expect(publicMethods.has('method')).toBe(false);
    });

    it('should handle metadata without public field', () => {
      class TestProcess {
        method() {}
      }

      Reflect.defineMetadata(PROCESS_METHOD_METADATA_KEY, { other: 'value' }, TestProcess.prototype, 'method');

      const instance = new TestProcess();
      const publicMethods = extractPublicMethods(instance, PROCESS_METHOD_METADATA_KEY);

      expect(publicMethods.has('method')).toBe(false);
    });
  });
});

// ============================================================================
// Internal Service Methods Tests
// ============================================================================

describe('Internal Service Methods', () => {
  describe('__getProcessMetrics', () => {
    it('should return valid metrics structure', () => {
      // Simulate the metrics structure from worker.ts
      const getProcessMetrics = async () => ({
        cpu: process.cpuUsage().user / 1000000,
        memory: process.memoryUsage().heapUsed,
        requests: 0,
        errors: 0,
        uptime: process.uptime(),
      });

      const result = getProcessMetrics();

      return result.then((metrics) => {
        expect(metrics).toHaveProperty('cpu');
        expect(metrics).toHaveProperty('memory');
        expect(metrics).toHaveProperty('requests');
        expect(metrics).toHaveProperty('errors');
        expect(metrics).toHaveProperty('uptime');
        expect(typeof metrics.cpu).toBe('number');
        expect(typeof metrics.memory).toBe('number');
      });
    });
  });

  describe('__getProcessHealth', () => {
    it('should return healthy when no checkHealth method', async () => {
      const processInstance: any = {};

      const getProcessHealth = async () => {
        const healthMethod = processInstance.checkHealth;
        if (typeof healthMethod === 'function') {
          try {
            return await healthMethod.call(processInstance);
          } catch (error: any) {
            return {
              status: 'unhealthy' as const,
              error: error.message,
              timestamp: Date.now(),
            };
          }
        }

        return {
          status: 'healthy' as const,
          checks: [],
          timestamp: Date.now(),
        };
      };

      const health = await getProcessHealth();

      expect(health.status).toBe('healthy');
      expect(health.checks).toEqual([]);
      expect(health.timestamp).toBeDefined();
    });

    it('should call checkHealth when available', async () => {
      const processInstance: any = {
        checkHealth: async () => ({
          status: 'healthy' as const,
          checks: [{ name: 'database', status: 'pass' }],
          timestamp: Date.now(),
        }),
      };

      const getProcessHealth = async () => {
        const healthMethod = processInstance.checkHealth;
        if (typeof healthMethod === 'function') {
          try {
            return await healthMethod.call(processInstance);
          } catch (error: any) {
            return {
              status: 'unhealthy' as const,
              error: error.message,
              timestamp: Date.now(),
            };
          }
        }

        return {
          status: 'healthy' as const,
          checks: [],
          timestamp: Date.now(),
        };
      };

      const health = await getProcessHealth();

      expect(health.status).toBe('healthy');
      expect(health.checks).toContainEqual({ name: 'database', status: 'pass' });
    });

    it('should return unhealthy when checkHealth throws', async () => {
      const processInstance: any = {
        checkHealth: async () => {
          throw new Error('Database connection failed');
        },
      };

      const getProcessHealth = async () => {
        const healthMethod = processInstance.checkHealth;
        if (typeof healthMethod === 'function') {
          try {
            return await healthMethod.call(processInstance);
          } catch (error: any) {
            return {
              status: 'unhealthy' as const,
              error: error.message,
              timestamp: Date.now(),
            };
          }
        }

        return {
          status: 'healthy' as const,
          checks: [],
          timestamp: Date.now(),
        };
      };

      const health = await getProcessHealth();

      expect(health.status).toBe('unhealthy');
      expect(health.error).toBe('Database connection failed');
    });
  });

  describe('__shutdown', () => {
    it('should call onShutdown if available', async () => {
      let shutdownCalled = false;

      const processInstance: any = {
        onShutdown: async () => {
          shutdownCalled = true;
        },
      };

      const shutdown = async () => {
        const shutdownMethod = processInstance.onShutdown;
        if (typeof shutdownMethod === 'function') {
          await shutdownMethod.call(processInstance);
        }
      };

      await shutdown();

      expect(shutdownCalled).toBe(true);
    });

    it('should handle missing onShutdown gracefully', async () => {
      const processInstance: any = {};

      const shutdown = async () => {
        const shutdownMethod = processInstance.onShutdown;
        if (typeof shutdownMethod === 'function') {
          await shutdownMethod.call(processInstance);
        }
      };

      // Should not throw
      await expect(shutdown()).resolves.toBeUndefined();
    });
  });
});

// ============================================================================
// Ready Message Tests
// ============================================================================

describe('Ready Message', () => {
  it('should include required fields in ready message', () => {
    const config: WorkerConfig = {
      processId: 'ready-test-123',
      className: 'ReadyService',
      modulePath: '/test.js',
      netron: {
        id: 'n1',
        transport: 'tcp',
        listenHost: 'localhost',
        listenPort: 3000,
      },
    };

    const { transportUrl } = configureTransport(
      config.netron.transport,
      config.netron.listenHost,
      config.netron.listenPort,
      config.processId
    );

    const readyMessage = {
      type: 'ready',
      processId: config.processId,
      transportUrl,
    };

    expect(readyMessage.type).toBe('ready');
    expect(readyMessage.processId).toBe('ready-test-123');
    expect(readyMessage.transportUrl).toBe('tcp://localhost:3000');
  });
});

// ============================================================================
// Error Message Tests
// ============================================================================

describe('Error Message', () => {
  it('should include error details in error message', () => {
    const error = new Error('Test initialization error');

    const errorMessage = {
      type: 'error',
      error: error.message,
      stack: error.stack,
    };

    expect(errorMessage.type).toBe('error');
    expect(errorMessage.error).toBe('Test initialization error');
    expect(errorMessage.stack).toBeDefined();
  });

  it('should handle errors without stack trace', () => {
    const error = { message: 'Simple error' };

    const errorMessage = {
      type: 'error',
      error: error.message,
      stack: undefined,
    };

    expect(errorMessage.error).toBe('Simple error');
    expect(errorMessage.stack).toBeUndefined();
  });
});
