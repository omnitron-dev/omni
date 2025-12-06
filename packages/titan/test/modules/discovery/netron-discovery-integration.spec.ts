/**
 * Netron-Discovery Integration Tests
 *
 * Tests the automatic registration/unregistration of Netron services with Discovery.
 */

import { EventEmitter } from '@omnitron-dev/eventemitter';
import { NetronDiscoveryIntegration } from '../../../src/modules/discovery/netron-integration.js';
import { NETRON_EVENT_SERVICE_EXPOSE, NETRON_EVENT_SERVICE_UNEXPOSE } from '../../../src/netron/constants.js';
import type { IDiscoveryService, ServiceInfo } from '../../../src/modules/discovery/types.js';
import type { ServiceExposeEvent, ServiceUnexposeEvent } from '../../../src/netron/types.js';

// Mock types
interface MockNetron extends EventEmitter {
  services: Map<string, { definition: { meta: { name: string; version: string } } }>;
}

interface MockLogger {
  info: jest.Mock;
  debug: jest.Mock;
  error: jest.Mock;
  warn: jest.Mock;
}

describe('NetronDiscoveryIntegration', () => {
  let mockNetron: MockNetron;
  let mockDiscovery: jest.Mocked<IDiscoveryService>;
  let mockLogger: MockLogger;
  let integration: NetronDiscoveryIntegration;

  beforeEach(() => {
    // Create mock Netron with EventEmitter functionality
    mockNetron = Object.assign(new EventEmitter(), {
      services: new Map(),
    }) as MockNetron;

    // Create mock Discovery service
    mockDiscovery = {
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
      registerNode: jest.fn().mockResolvedValue(undefined),
      deregisterNode: jest.fn().mockResolvedValue(undefined),
      getActiveNodes: jest.fn().mockResolvedValue([]),
      findNodesByService: jest.fn().mockResolvedValue([]),
      isNodeActive: jest.fn().mockResolvedValue(true),
      updateNodeAddress: jest.fn().mockResolvedValue(undefined),
      updateNodeServices: jest.fn().mockResolvedValue(undefined),
      onEvent: jest.fn(),
      offEvent: jest.fn(),
      registerService: jest.fn().mockResolvedValue(undefined),
      unregisterService: jest.fn().mockResolvedValue(undefined),
    };

    // Create mock logger
    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    };
  });

  afterEach(async () => {
    if (integration) {
      await integration.onModuleDestroy();
    }
  });

  describe('Initialization', () => {
    it('should initialize successfully when both Netron and Discovery are available', async () => {
      integration = new NetronDiscoveryIntegration(mockNetron as any, mockDiscovery, mockLogger as any);

      await integration.onModuleInit();

      expect(integration.isActive()).toBe(true);
      expect(integration.isEnabled()).toBe(true);
    });

    it('should gracefully handle missing Netron', async () => {
      integration = new NetronDiscoveryIntegration(null, mockDiscovery, mockLogger as any);

      await integration.onModuleInit();

      expect(integration.isActive()).toBe(false);
      expect(mockLogger.debug).toHaveBeenCalled();
    });

    it('should gracefully handle missing Discovery', async () => {
      integration = new NetronDiscoveryIntegration(mockNetron as any, null, mockLogger as any);

      await integration.onModuleInit();

      expect(integration.isActive()).toBe(false);
    });

    it('should register existing services on initialization', async () => {
      // Add existing service to Netron
      mockNetron.services.set('test-service:1.0.0', {
        definition: { meta: { name: 'test-service', version: '1.0.0' } },
      });

      integration = new NetronDiscoveryIntegration(mockNetron as any, mockDiscovery, mockLogger as any);

      await integration.onModuleInit();

      expect(mockDiscovery.registerService).toHaveBeenCalledWith({
        name: 'test-service',
        version: '1.0.0',
      });
    });
  });

  describe('Service Expose Event Handling', () => {
    beforeEach(async () => {
      integration = new NetronDiscoveryIntegration(mockNetron as any, mockDiscovery, mockLogger as any);
      await integration.onModuleInit();
    });

    it('should register service with Discovery when service is exposed', async () => {
      const event: ServiceExposeEvent = {
        name: 'my-service',
        version: '2.0.0',
        qualifiedName: 'my-service:2.0.0',
        peerId: 'peer-1',
        definition: { meta: { name: 'my-service', version: '2.0.0' } } as any,
      };

      mockNetron.emit(NETRON_EVENT_SERVICE_EXPOSE, event);

      // Wait for async handler
      await new Promise((resolve) => setImmediate(resolve));

      expect(mockDiscovery.registerService).toHaveBeenCalledWith({
        name: 'my-service',
        version: '2.0.0',
      });
    });

    it('should log errors when registration fails', async () => {
      mockDiscovery.registerService.mockRejectedValue(new Error('Redis error'));

      const event: ServiceExposeEvent = {
        name: 'failing-service',
        version: '1.0.0',
        qualifiedName: 'failing-service:1.0.0',
        peerId: 'peer-1',
        definition: { meta: { name: 'failing-service', version: '1.0.0' } } as any,
      };

      mockNetron.emit(NETRON_EVENT_SERVICE_EXPOSE, event);

      // Wait for async handler
      await new Promise((resolve) => setImmediate(resolve));

      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('Service Unexpose Event Handling', () => {
    beforeEach(async () => {
      integration = new NetronDiscoveryIntegration(mockNetron as any, mockDiscovery, mockLogger as any);
      await integration.onModuleInit();
    });

    it('should unregister service from Discovery when service is unexposed', async () => {
      const event: ServiceUnexposeEvent = {
        name: 'my-service',
        version: '2.0.0',
        qualifiedName: 'my-service:2.0.0',
        peerId: 'peer-1',
        defId: 'def-123',
      };

      mockNetron.emit(NETRON_EVENT_SERVICE_UNEXPOSE, event);

      // Wait for async handler
      await new Promise((resolve) => setImmediate(resolve));

      expect(mockDiscovery.unregisterService).toHaveBeenCalledWith('my-service');
    });

    it('should log errors when unregistration fails', async () => {
      mockDiscovery.unregisterService.mockRejectedValue(new Error('Redis error'));

      const event: ServiceUnexposeEvent = {
        name: 'failing-service',
        version: '1.0.0',
        qualifiedName: 'failing-service:1.0.0',
        peerId: 'peer-1',
        defId: 'def-456',
      };

      mockNetron.emit(NETRON_EVENT_SERVICE_UNEXPOSE, event);

      // Wait for async handler
      await new Promise((resolve) => setImmediate(resolve));

      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('Enable/Disable Integration', () => {
    beforeEach(async () => {
      integration = new NetronDiscoveryIntegration(mockNetron as any, mockDiscovery, mockLogger as any);
      await integration.onModuleInit();
    });

    it('should not register services when disabled', async () => {
      integration.setEnabled(false);
      expect(integration.isEnabled()).toBe(false);
      expect(integration.isActive()).toBe(false);

      const event: ServiceExposeEvent = {
        name: 'disabled-service',
        version: '1.0.0',
        qualifiedName: 'disabled-service:1.0.0',
        peerId: 'peer-1',
        definition: { meta: { name: 'disabled-service', version: '1.0.0' } } as any,
      };

      mockNetron.emit(NETRON_EVENT_SERVICE_EXPOSE, event);

      // Wait for async handler
      await new Promise((resolve) => setImmediate(resolve));

      expect(mockDiscovery.registerService).not.toHaveBeenCalled();
    });

    it('should resume registering services when re-enabled', async () => {
      integration.setEnabled(false);
      integration.setEnabled(true);

      const event: ServiceExposeEvent = {
        name: 're-enabled-service',
        version: '1.0.0',
        qualifiedName: 're-enabled-service:1.0.0',
        peerId: 'peer-1',
        definition: { meta: { name: 're-enabled-service', version: '1.0.0' } } as any,
      };

      mockNetron.emit(NETRON_EVENT_SERVICE_EXPOSE, event);

      // Wait for async handler
      await new Promise((resolve) => setImmediate(resolve));

      expect(mockDiscovery.registerService).toHaveBeenCalledWith({
        name: 're-enabled-service',
        version: '1.0.0',
      });
    });
  });

  describe('Resync Services', () => {
    it('should resync all existing services', async () => {
      // Add multiple services
      mockNetron.services.set('service-a:1.0.0', {
        definition: { meta: { name: 'service-a', version: '1.0.0' } },
      });
      mockNetron.services.set('service-b:2.0.0', {
        definition: { meta: { name: 'service-b', version: '2.0.0' } },
      });

      integration = new NetronDiscoveryIntegration(mockNetron as any, mockDiscovery, mockLogger as any);
      await integration.onModuleInit();

      // Clear previous calls from init
      mockDiscovery.registerService.mockClear();

      await integration.resyncServices();

      expect(mockDiscovery.registerService).toHaveBeenCalledTimes(2);
      expect(mockDiscovery.registerService).toHaveBeenCalledWith({
        name: 'service-a',
        version: '1.0.0',
      });
      expect(mockDiscovery.registerService).toHaveBeenCalledWith({
        name: 'service-b',
        version: '2.0.0',
      });
    });

    it('should warn when trying to resync inactive integration', async () => {
      integration = new NetronDiscoveryIntegration(
        null, // No Netron
        mockDiscovery,
        mockLogger as any
      );
      await integration.onModuleInit();

      await integration.resyncServices();

      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });

  describe('Cleanup', () => {
    it('should remove event listeners on destroy', async () => {
      const offSpy = jest.spyOn(mockNetron, 'off');

      integration = new NetronDiscoveryIntegration(mockNetron as any, mockDiscovery, mockLogger as any);
      await integration.onModuleInit();

      await integration.onModuleDestroy();

      expect(offSpy).toHaveBeenCalledWith(NETRON_EVENT_SERVICE_EXPOSE, expect.any(Function));
      expect(offSpy).toHaveBeenCalledWith(NETRON_EVENT_SERVICE_UNEXPOSE, expect.any(Function));
    });

    it('should handle destroy when not initialized', async () => {
      integration = new NetronDiscoveryIntegration(null, mockDiscovery, mockLogger as any);

      // This should not throw
      await expect(integration.onModuleDestroy()).resolves.not.toThrow();
    });
  });
});
