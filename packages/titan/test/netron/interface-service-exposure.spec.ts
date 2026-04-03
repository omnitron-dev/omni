/**
 * Interface Direct Service Exposure Test
 * Tests the direct service exposure functionality in Interface class
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Netron } from '../../src/netron/netron.js';
import { Interface } from '../../src/netron/interface.js';
import { Definition } from '../../src/netron/definition.js';
import { Service, Public } from '../../src/decorators/core.js';
import { Reference } from '../../src/netron/reference.js';
import { createMockLogger } from './test-utils.js';
import type { ILogger } from '../../src/modules/logger/logger.types.js';

// Test service classes
@Service({ name: 'TestService', version: '1.0.0' })
class TestService {
  @Public()
  greet(name: string): string {
    return `Hello, ${name}!`;
  }

  @Public()
  add(a: number, b: number): number {
    return a + b;
  }
}

@Service({ name: 'SecondService', version: '1.0.0' })
class SecondService {
  @Public()
  multiply(a: number, b: number): number {
    return a * b;
  }
}

// Service with a property that accepts service instances
@Service({ name: 'ServiceHolder', version: '1.0.0' })
class ServiceHolder {
  @Public()
  heldService: any = null;

  @Public()
  setService(service: any): void {
    this.heldService = service;
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
      } catch (_err) {
        // Ignore cleanup errors
      }
    }
  });

  describe('Service Instance Detection', () => {
    it('should detect service instances passed as arguments', async () => {
      // Expose the test service first
      const localPeer = netron.getLocalPeer();
      await localPeer.exposeService(testService);

      const stub = localPeer.serviceInstances.get(testService);

      expect(stub).toBeDefined();
      expect(stub?.definition).toBeDefined();
    });

    it('should return Reference for already exposed services via property assignment', async () => {
      // Expose both services
      const testDef = await netron.getLocalPeer().exposeService(testService);
      const holderService = new ServiceHolder();
      await netron.getLocalPeer().exposeService(holderService);

      // Get interface to the holder service
      const holderIface = await netron.peer.queryInterface('ServiceHolder@1.0.0');

      // Get interface to the test service (this is already an Interface)
      const testIface = await netron.peer.queryInterface('TestService@1.0.0');

      // Mock the set method to capture what value is being passed
      let capturedValue: any = null;
      vi.spyOn(netron.peer, 'set').mockImplementation(async (_defId, _prop, value) => {
        capturedValue = value;
        return undefined;
      });

      // Setting the property with an Interface should convert it to a Reference
      (holderIface as any).heldService = testIface;
      await holderIface.waitForAssigned('heldService');

      expect(capturedValue).toBeDefined();
      expect(capturedValue).toBeInstanceOf(Reference);
      expect(capturedValue.defId).toBe(testDef.id);
    });
  });

  describe('Error Handling', () => {
    it('should throw error for unexposed service instances via property assignment', async () => {
      const secondService = new SecondService();

      // Expose only the holder service (not the second service)
      const holderService = new ServiceHolder();
      await netron.getLocalPeer().exposeService(holderService);

      // Get interface to the holder service
      const holderIface = await netron.peer.queryInterface('ServiceHolder@1.0.0');

      // Try to set a property with an unexposed service instance
      // This should fail because secondService is not exposed
      (holderIface as any).heldService = secondService;

      // The error surfaces through waitForAssigned
      // Note: The error includes "Failed to expose service:" prefix and mentions the service needs to be exposed first
      await expect(holderIface.waitForAssigned('heldService')).rejects.toThrow(
        /exposed first|Failed to expose service/
      );
    });

    it('should throw error when peer is not available via property get', () => {
      // Create interface without peer
      const definition = new Definition('test-id', 'peer-id', {
        name: 'TestService',
        version: '1.0.0',
        methods: {},
        properties: { testProp: { type: 'string' } },
        events: {},
      });

      const iface = new Interface(definition, undefined);

      // Should throw error because no peer is available when accessing property
      expect(() => (iface as any).testProp).toThrow(/Peer is missing/);
    });

    it('should pass through non-service instances unchanged via property assignment', async () => {
      // Create a class without @Service decorator
      class PlainClass {
        doSomething() {
          return 'test';
        }
      }

      const plainInstance = new PlainClass();

      // Expose the holder service
      const holderService = new ServiceHolder();
      await netron.getLocalPeer().exposeService(holderService);

      // Get interface to the holder service
      const holderIface = await netron.peer.queryInterface('ServiceHolder@1.0.0');

      // Mock the set method to capture what value is being passed
      let capturedValue: any = null;
      vi.spyOn(netron.peer, 'set').mockImplementation(async (_defId, _prop, value) => {
        capturedValue = value;
        return undefined;
      });

      // Plain objects (not services) should pass through unchanged
      (holderIface as any).heldService = plainInstance;
      await holderIface.waitForAssigned('heldService');

      // The plain instance should be passed through as-is (not converted to Reference)
      expect(capturedValue).toBe(plainInstance);
    });
  });

  describe('Argument Processing', () => {
    it('should process Interface instances correctly via property assignment', async () => {
      const testDef = await netron.getLocalPeer().exposeService(testService);
      const holderService = new ServiceHolder();
      await netron.getLocalPeer().exposeService(holderService);

      // Get interfaces
      const holderIface = await netron.peer.queryInterface('ServiceHolder@1.0.0');
      const testIface = await netron.peer.queryInterface('TestService@1.0.0');

      // Mock the set method to capture what value is being passed
      let capturedValue: any = null;
      vi.spyOn(netron.peer, 'set').mockImplementation(async (_defId, _prop, value) => {
        capturedValue = value;
        return undefined;
      });

      // Should convert Interface to Reference when setting property
      (holderIface as any).heldService = testIface;
      await holderIface.waitForAssigned('heldService');

      expect(capturedValue).toBeDefined();
      expect(capturedValue).toBeInstanceOf(Reference);
      expect(capturedValue.defId).toBe(testDef.id);
    });

    it('should process regular values without modification via property assignment', async () => {
      const holderService = new ServiceHolder();
      await netron.getLocalPeer().exposeService(holderService);

      const holderIface = await netron.peer.queryInterface('ServiceHolder@1.0.0');

      // Test different value types
      const testCases = ['string', 123, true, null, { foo: 'bar' }, [1, 2, 3]];

      for (const testValue of testCases) {
        let capturedValue: any = undefined;
        vi.spyOn(netron.peer, 'set').mockImplementation(async (_defId, _prop, value) => {
          capturedValue = value;
          return undefined;
        });

        (holderIface as any).heldService = testValue;
        await holderIface.waitForAssigned('heldService');

        // Regular values should pass through unchanged
        expect(capturedValue).toEqual(testValue);
      }
    });

    it('should process method arguments correctly', async () => {
      const holderService = new ServiceHolder();
      await netron.getLocalPeer().exposeService(holderService);

      const holderIface = await netron.peer.queryInterface('ServiceHolder@1.0.0');

      // Mock the call method to capture arguments
      let capturedArgs: any[] = [];
      vi.spyOn(netron.peer, 'call').mockImplementation(async (_defId, _method, args) => {
        capturedArgs = args as any[];
        return undefined;
      });

      // Call method with various arguments
      await (holderIface as any).setService('test', 123, true, { foo: 'bar' });

      // Arguments should pass through unchanged
      expect(capturedArgs).toEqual(['test', 123, true, { foo: 'bar' }]);
    });
  });

  describe('Error Messages', () => {
    it('should provide clear error message for unexposed services', async () => {
      // Expose only the holder service
      const holderService = new ServiceHolder();
      await netron.getLocalPeer().exposeService(holderService);

      const holderIface = await netron.peer.queryInterface('ServiceHolder@1.0.0');
      const secondService = new SecondService();

      // Try to set property with unexposed service
      (holderIface as any).heldService = secondService;

      try {
        await holderIface.waitForAssigned('heldService');
        expect.fail('Should have thrown an error');
      } catch (err: any) {
        // The error message includes "Failed to expose service:" prefix
        // and the underlying message about the service needing to be exposed first
        expect(err.message).toContain('Failed to expose service');
        expect(err.message).toMatch(/exposed first|proper metadata/);
      }
    });

    it('should provide clear error message when Interface is missing definition', async () => {
      // Expose the holder service
      const holderService = new ServiceHolder();
      await netron.getLocalPeer().exposeService(holderService);

      const holderIface = await netron.peer.queryInterface('ServiceHolder@1.0.0');

      // Create an Interface without a definition
      const ifaceWithoutDef = new Interface(undefined, netron.getLocalPeer());

      // Try to set property with an invalid interface
      (holderIface as any).heldService = ifaceWithoutDef;

      try {
        await holderIface.waitForAssigned('heldService');
        expect.fail('Should have thrown an error');
      } catch (err: any) {
        // The error message format is "Invalid interface: Service definition is missing"
        expect(err.message).toMatch(/Service definition.*missing|Missing.*definition/i);
      }
    });
  });

  describe('Integration with LocalPeer', () => {
    it('should check serviceInstances map for exposed services', async () => {
      const definition = await netron.getLocalPeer().exposeService(testService);
      const localPeer = netron.getLocalPeer();

      // Verify service is in serviceInstances map
      const stub = localPeer.serviceInstances.get(testService);
      expect(stub).toBeDefined();
      expect(stub?.definition.id).toBe(definition.id);
    });

    it('should handle multiple exposed services', async () => {
      const secondService = new SecondService();

      const localPeer = netron.getLocalPeer();
      const def1 = await localPeer.exposeService(testService);
      const def2 = await localPeer.exposeService(secondService);

      expect(localPeer.serviceInstances.get(testService)?.definition.id).toBe(def1.id);
      expect(localPeer.serviceInstances.get(secondService)?.definition.id).toBe(def2.id);
    });
  });
});
