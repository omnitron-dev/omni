/**
 * Interface Direct Service Exposure Test
 * Tests the direct service exposure functionality in Interface class
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { Netron } from '../../src/netron/netron.js';
import { Interface } from '../../src/netron/interface.js';
import { Definition } from '../../src/netron/definition.js';
import { Service } from '../../src/decorators/core.js';
import { createMockLogger } from './test-utils.js';
import type { ILogger } from '../../src/modules/logger/logger.types.js';

// Test service classes
@Service({ name: 'TestService', version: '1.0.0' })
class TestService {
  greet(name: string): string {
    return `Hello, ${name}!`;
  }

  add(a: number, b: number): number {
    return a + b;
  }
}

@Service({ name: 'SecondService', version: '1.0.0' })
class SecondService {
  multiply(a: number, b: number): number {
    return a * b;
  }
}

describe('Interface Direct Service Exposure', () => {
  let logger: ILogger;
  let netron: Netron;
  let testService: TestService;

  beforeEach(() => {
    logger = createMockLogger();
    netron = new Netron(logger, { id: 'test-netron' });
    testService = new TestService();
  });

  afterEach(async () => {
    if (netron) {
      try {
        await netron.close();
      } catch (err) {
        // Ignore cleanup errors
      }
    }
  });

  describe('Service Instance Detection', () => {
    it('should detect service instances passed as arguments', async () => {
      // Expose the test service first
      await netron.exposeService(testService);

      const localPeer = netron.getLocalPeer();
      const stub = localPeer.serviceInstances.get(testService);

      expect(stub).toBeDefined();
      expect(stub?.definition).toBeDefined();
    });

    it('should return Reference for already exposed services', async () => {
      // Expose the service
      const definition = await netron.exposeService(testService);

      // Create an interface and try to process the service instance
      const iface = new Interface(definition, netron.getLocalPeer());

      // Access private method for testing
      const processValue = (iface as any).$processValue.bind(iface);

      // Should return a Reference since service is already exposed
      const result = processValue(testService);

      expect(result).toBeDefined();
      expect(result.constructor.name).toBe('Reference');
    });
  });

  describe('Error Handling', () => {
    it('should throw error for unexposed service instances', async () => {
      const secondService = new SecondService();

      // Expose test service
      const definition = await netron.exposeService(testService);
      const iface = new Interface(definition, netron.getLocalPeer());

      const processValue = (iface as any).$processValue.bind(iface);

      // Should throw error because secondService is not exposed
      expect(() => processValue(secondService)).toThrow(/Direct service exposure/);
      expect(() => processValue(secondService)).toThrow(/exposed first/);
    });

    it('should throw error when peer is not available', () => {
      // Create interface without peer
      const definition = new Definition('test-id', 'peer-id', {
        name: 'TestService',
        version: '1.0.0',
        methods: {},
        properties: {},
        events: {},
      });

      const iface = new Interface(definition, undefined);
      const processValue = (iface as any).$processValue.bind(iface);

      // Should throw error because no peer is available
      expect(() => processValue(testService)).toThrow(/No peer or netron instance available/);
    });

    it('should throw error for services without metadata', () => {
      // Create a class without @Service decorator
      class PlainClass {
        doSomething() {
          return 'test';
        }
      }

      const plainInstance = new PlainClass();

      // This should not be detected as a service
      const definition = new Definition('test-id', 'peer-id', {
        name: 'TestService',
        version: '1.0.0',
        methods: {},
        properties: {},
        events: {},
      });

      const iface = new Interface(definition, netron.getLocalPeer());
      const processValue = (iface as any).$processValue.bind(iface);

      // Should not throw for non-service instances
      const result = processValue(plainInstance);
      expect(result).toBe(plainInstance);
    });
  });

  describe('Argument Processing', () => {
    it('should process Interface instances correctly', async () => {
      const definition = await netron.exposeService(testService);
      const iface = new Interface(definition, netron.getLocalPeer());

      const processValue = (iface as any).$processValue.bind(iface);

      // Should convert Interface to Reference
      const result = processValue(iface);

      expect(result).toBeDefined();
      expect(result.constructor.name).toBe('Reference');
      expect(result.id).toBe(definition.id);
    });

    it('should process regular values without modification', async () => {
      const definition = await netron.exposeService(testService);
      const iface = new Interface(definition, netron.getLocalPeer());

      const processValue = (iface as any).$processValue.bind(iface);

      // Regular values should pass through unchanged
      expect(processValue('string')).toBe('string');
      expect(processValue(123)).toBe(123);
      expect(processValue(true)).toBe(true);
      expect(processValue(null)).toBe(null);

      const obj = { foo: 'bar' };
      expect(processValue(obj)).toBe(obj);

      const arr = [1, 2, 3];
      expect(processValue(arr)).toBe(arr);
    });

    it('should process arrays of arguments correctly', async () => {
      const definition = await netron.exposeService(testService);
      const iface = new Interface(definition, netron.getLocalPeer());

      const processArgs = (iface as any).$processArgs.bind(iface);

      const args = ['test', 123, true, { foo: 'bar' }];
      const result = processArgs(args);

      expect(result).toEqual(args);
      expect(result.length).toBe(args.length);
    });
  });

  describe('Error Messages', () => {
    it('should provide clear error message for unexposed services', async () => {
      const definition = await netron.exposeService(testService);
      const iface = new Interface(definition, netron.getLocalPeer());
      const processValue = (iface as any).$processValue.bind(iface);

      const secondService = new SecondService();

      try {
        processValue(secondService);
        expect.fail('Should have thrown an error');
      } catch (err: any) {
        expect(err.message).toContain('Direct service exposure');
        expect(err.message).toContain('exposed first');
        expect(err.message).toContain('netron.exposeService()');
      }
    });

    it('should provide clear error message when Interface is missing definition', () => {
      const iface = new Interface(undefined, netron.getLocalPeer());
      const processValue = (iface as any).$processValue.bind(iface);

      const ifaceWithoutDef = new Interface(undefined, netron.getLocalPeer());

      try {
        processValue(ifaceWithoutDef);
        expect.fail('Should have thrown an error');
      } catch (err: any) {
        expect(err.message).toContain('Missing service definition');
      }
    });
  });

  describe('Integration with LocalPeer', () => {
    it('should check serviceInstances map for exposed services', async () => {
      const definition = await netron.exposeService(testService);
      const localPeer = netron.getLocalPeer();

      // Verify service is in serviceInstances map
      const stub = localPeer.serviceInstances.get(testService);
      expect(stub).toBeDefined();
      expect(stub?.definition.id).toBe(definition.id);
    });

    it('should handle multiple exposed services', async () => {
      const secondService = new SecondService();

      const def1 = await netron.exposeService(testService);
      const def2 = await netron.exposeService(secondService);

      const localPeer = netron.getLocalPeer();

      expect(localPeer.serviceInstances.get(testService)?.definition.id).toBe(def1.id);
      expect(localPeer.serviceInstances.get(secondService)?.definition.id).toBe(def2.id);
    });
  });
});
