/**
 * Tests for Interface edge cases and error handling
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { Netron } from '../../src/netron/netron.js';
import { Interface } from '../../src/netron/interface.js';
import { createMockLogger } from './test-utils.js';
import { Service, Public } from '../../src/decorators/core.js';

describe('Interface Edge Cases', () => {
  let netron: Netron;

  beforeEach(async () => {
    netron = await Netron.create(createMockLogger(), { id: 'test-netron-interface' });
  });

  afterEach(async () => {
    if (netron) {
      await netron.stop();
    }
  });

  describe('Property access errors', () => {
    it('should throw error when accessing unknown property', async () => {
      @Service('TestService@1.0.0')
      class TestService {
        @Public()
        knownProp = 'value';
      }

      const service = new TestService();
      await netron.peer.exposeService(service);

      const iface = await netron.peer.queryInterface('TestService@1.0.0');

      // Try to access unknown property
      expect(() => {
        (iface as any).unknownProperty;
      }).toThrow("Unknown member: 'unknownProperty' is not defined in the service interface");
    });

    it('should throw error when setting unknown property', async () => {
      @Service('TestService@1.0.0')
      class TestService {
        @Public()
        knownProp = 'value';
      }

      const service = new TestService();
      await netron.peer.exposeService(service);

      const iface = await netron.peer.queryInterface('TestService@1.0.0');

      // Try to set unknown property
      expect(() => {
        (iface as any).unknownProperty = 'test';
      }).toThrow("Unknown member: 'unknownProperty' is not defined in the service interface");
    });

    it('should throw error when setting readonly property', async () => {
      @Service('TestService@1.0.0')
      class TestService {
        @Public({ readonly: true })
        readonlyProp = 'constant';
      }

      const service = new TestService();
      await netron.peer.exposeService(service);

      const iface = await netron.peer.queryInterface('TestService@1.0.0');

      // Try to set readonly property
      expect(() => {
        (iface as any).readonlyProp = 'new value';
      }).toThrow("Property is not writable: 'readonlyProp' is marked as readonly");
    });
  });

  describe('Invalid interface handling', () => {
    it('should throw error when setting property on invalid interface', () => {
      const iface = new Interface();

      // Interface without $def should throw
      expect(() => {
        (iface as any).someProp = 'value';
      }).toThrow('Invalid interface: Service definition is missing');
    });
  });

  describe('waitForAssigned', () => {
    it('should resolve immediately when no pending promise exists', async () => {
      @Service('TestService@1.0.0')
      class TestService {
        @Public()
        prop = 'value';
      }

      const service = new TestService();
      await netron.peer.exposeService(service);

      const iface = await netron.peer.queryInterface('TestService@1.0.0');

      // waitForAssigned should resolve immediately if no pending operation
      await expect(iface.waitForAssigned('prop')).resolves.toBeUndefined();
    });

    it('should wait for property assignment to complete', async () => {
      @Service('TestService@1.0.0')
      class TestService {
        @Public()
        prop = 'initial';
      }

      const service = new TestService();
      await netron.peer.exposeService(service);

      // Mock the set method to simulate delay
      const setSpy = jest
        .spyOn(netron.peer, 'set')
        .mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(undefined), 50)));

      const iface = await netron.peer.queryInterface('TestService@1.0.0');

      // Set property (this will be async)
      (iface as any).prop = 'new value';

      // Wait for assignment
      await iface.waitForAssigned('prop');

      expect(setSpy).toHaveBeenCalled();
    });

    it('should handle errors during property assignment', async () => {
      @Service('TestService@1.0.0')
      class TestService {
        @Public()
        prop = 'value';
      }

      const service = new TestService();
      await netron.peer.exposeService(service);

      // Mock set to throw error
      jest.spyOn(netron.peer, 'set').mockRejectedValue(new Error('Set failed'));

      const iface = await netron.peer.queryInterface('TestService@1.0.0');

      // Set property (will fail)
      (iface as any).prop = 'new value';

      // waitForAssigned should reject with the error
      await expect(iface.waitForAssigned('prop')).rejects.toThrow('Set failed');
    });
  });

  describe('$processValue', () => {
    it('should process nested service references', async () => {
      @Service('NestedService@1.0.0')
      class NestedService {
        @Public()
        value = 42;
      }

      @Service('ParentService@1.0.0')
      class ParentService {
        @Public()
        nested = new NestedService();
      }

      const parent = new ParentService();
      await netron.peer.exposeService(parent);

      const iface = await netron.peer.queryInterface('ParentService@1.0.0');

      // Getting nested should return an interface
      const nested = await (iface as any).nested;
      expect(nested).toBeDefined();
    });
  });

  describe('Internal properties', () => {
    it('should allow access to $def internal property', async () => {
      @Service('TestService@1.0.0')
      class TestService {
        @Public()
        prop = 'value';
      }

      const service = new TestService();
      await netron.peer.exposeService(service);

      const iface = await netron.peer.queryInterface('TestService@1.0.0');

      // Should be able to access $def
      expect((iface as any).$def).toBeDefined();
      expect((iface as any).$def.id).toBeDefined();
    });

    it('should allow setting internal properties', async () => {
      @Service('TestService@1.0.0')
      class TestService {
        @Public()
        prop = 'value';
      }

      const service = new TestService();
      await netron.peer.exposeService(service);

      const iface = await netron.peer.queryInterface('TestService@1.0.0');

      // Should be able to set internal properties
      (iface as any).$peer = null;
      expect((iface as any).$peer).toBeNull();
    });
  });
});
