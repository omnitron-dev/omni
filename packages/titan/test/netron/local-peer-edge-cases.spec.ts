/**
 * Tests for LocalPeer edge cases
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { Netron } from '../../src/netron/netron.js';
import { createMockLogger } from './test-utils.js';
import { Service, Public } from '../../src/decorators/core.js';

describe('LocalPeer Edge Cases', () => {
  let netron: Netron;

  beforeEach(async () => {
    netron = await Netron.create(createMockLogger(), { id: 'test-netron-local-peer' });
  });

  afterEach(async () => {
    if (netron) {
      await netron.stop();
    }
  });

  describe('exposeService errors', () => {
    it('should throw error when exposing same service instance twice', async () => {
      @Service('TestService@1.0.0')
      class TestService {
        @Method()
        method() {
          return 'test';
        }
      }

      const service = new TestService();
      await netron.peer.exposeService(service);

      // Try to expose same instance again
      await expect(netron.peer.exposeService(service)).rejects.toThrow('Service instance already exposed: TestService');
    });

    it('should throw error when exposing service with same qualified name', async () => {
      @Service('DuplicateService@1.0.0')
      class DuplicateService1 {
        @Method()
        method1() {
          return 'v1';
        }
      }

      @Service('DuplicateService@1.0.0')
      class DuplicateService2 {
        @Method()
        method2() {
          return 'v2';
        }
      }

      const service1 = new DuplicateService1();
      await netron.peer.exposeService(service1);

      const service2 = new DuplicateService2();
      // Try to expose with same qualified name
      await expect(netron.peer.exposeService(service2)).rejects.toThrow(
        'Service already exposed: DuplicateService@1.0.0'
      );
    });
  });

  describe('HTTP server integration', () => {
    it('should expose service successfully even without transport server', async () => {
      @Service('NoServerService@1.0.0')
      class NoServerService {
        @Method()
        getData() {
          return { data: 'test' };
        }
      }

      const service = new NoServerService();

      // Should expose service successfully even without transport server
      await netron.peer.exposeService(service);

      // Service should be in netron.services
      expect(netron.services.has('NoServerService@1.0.0')).toBe(true);
    });
  });

  describe('queryInterface edge cases', () => {
    it('should return existing interface when queried multiple times', async () => {
      @Service('CachedService@1.0.0')
      class CachedService {
        @Method()
        value = 42;
      }

      const service = new CachedService();
      await netron.peer.exposeService(service);

      const iface1 = await netron.peer.queryInterface('CachedService@1.0.0');
      const iface2 = await netron.peer.queryInterface('CachedService@1.0.0');

      // Should return same interface instance
      expect(iface1).toBe(iface2);
    });
  });

  describe('Service event emission', () => {
    it('should emit service expose event when service is exposed', async () => {
      @Service('EventService@1.0.0')
      class EventService {
        @Method()
        test() {
          return 'event';
        }
      }

      // Spy on emitSpecial to verify event emission
      const emitSpy = jest.spyOn(netron, 'emitSpecial' as any);

      const service = new EventService();
      await netron.peer.exposeService(service);

      // Verify emitSpecial was called with correct parameters
      // Note: actual event names are 'service:expose' and 'svc:ServiceName@version'
      expect(emitSpy).toHaveBeenCalledWith(
        'service:expose',
        'svc:EventService@1.0.0',
        expect.objectContaining({
          name: 'EventService',
          version: '1.0.0',
          qualifiedName: 'EventService@1.0.0',
          peerId: netron.peer.id,
        })
      );
    });
  });
});
