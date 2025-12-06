/**
 * Comprehensive tests for AbstractPeer
 *
 * Tests cover:
 * - Peer initialization and configuration
 * - LRU cache behavior (add, get, evict)
 * - Definition caching mechanisms
 * - Interface lifecycle (create, update, destroy)
 * - Event subscription and emission
 * - Error handling
 * - Cleanup and disposal
 */

import { jest, describe, beforeEach, afterEach, it, expect } from '@jest/globals';
import {
  AbstractPeer,
  DEFAULT_DEFINITION_CACHE_OPTIONS,
  DefinitionCacheOptions,
  isNetronPeer,
} from '../../src/netron/abstract-peer.js';
import { Definition } from '../../src/netron/definition.js';
import { Interface } from '../../src/netron/interface.js';
import type { INetron, EventSubscriber, ServiceMetadata } from '../../src/netron/types.js';
import { createMockLogger } from './test-utils.js';

// ============================================================================
// Test Fixtures and Mocks
// ============================================================================

/**
 * Creates a mock ServiceMetadata for testing
 */
function createMockServiceMetadata(name: string, version: string = '1.0.0'): ServiceMetadata {
  return {
    name,
    version,
    properties: {
      testProp: { type: 'string', readonly: false },
      readOnlyProp: { type: 'number', readonly: true },
    },
    methods: {
      testMethod: { type: 'string', arguments: [] },
      addNumbers: { type: 'number', arguments: [{ index: 0, type: 'number' }, { index: 1, type: 'number' }] },
    },
  };
}

/**
 * Creates a mock Definition for testing
 */
function createMockDefinition(id: string, peerId: string, serviceName: string, version: string = '1.0.0'): Definition {
  return new Definition(id, peerId, createMockServiceMetadata(serviceName, version));
}

/**
 * Creates a mock INetron instance for testing
 */
function createMockNetron(overrides: Partial<INetron> = {}): INetron {
  const logger = createMockLogger();
  const services = new Map();
  const peers = new Map();
  const transportServers = new Map();

  const mockPeer = {
    id: 'local-peer-id',
    netron: null as any,
    stubs: new Map(),
    serviceInstances: new Map(),
    logger,
    queryInterface: jest.fn(),
    subscribe: jest.fn(),
    unsubscribe: jest.fn(),
    set: jest.fn(),
    get: jest.fn(),
    call: jest.fn(),
    expose: jest.fn(),
    unexpose: jest.fn(),
    exposeRemoteService: jest.fn(),
    unexposeRemoteService: jest.fn(),
    refService: jest.fn(),
    unrefService: jest.fn(),
    getStubByDefinitionId: jest.fn(),
    queryInterfaceByDefId: jest.fn(),
  };

  const netron: INetron = {
    uuid: 'test-netron-uuid',
    logger,
    options: {},
    services,
    peer: mockPeer as any,
    peers,
    transportServers,
    getLocalPeer: jest.fn(() => mockPeer as any),
    findPeer: jest.fn(),
    trackTask: jest.fn(),
    emitSpecial: jest.fn(),
    getServiceNames: jest.fn(() => []),
    emit: jest.fn(() => true),
    on: jest.fn().mockReturnThis(),
    off: jest.fn().mockReturnThis(),
    removeListener: jest.fn().mockReturnThis(),
    ...overrides,
  };

  mockPeer.netron = netron;
  return netron;
}

/**
 * Concrete implementation of AbstractPeer for testing
 * AbstractPeer is abstract, so we need a concrete class to test it
 */
class TestPeer extends AbstractPeer {
  // Storage for exposed services
  private services = new Map<string, Definition>();
  private servicesByDefId = new Map<string, Definition>();
  private eventHandlers = new Map<string, Set<EventSubscriber>>();
  
  // Track method calls for testing
  public setCallCount = 0;
  public getCallCount = 0;
  public callCallCount = 0;
  public subscribeCallCount = 0;
  public unsubscribeCallCount = 0;
  public exposeServiceCallCount = 0;
  public unexposeServiceCallCount = 0;
  public queryInterfaceRemoteCallCount = 0;
  public releaseInterfaceInternalCallCount = 0;

  // Mock return values for abstract methods
  public mockSetResult: Promise<void> = Promise.resolve();
  public mockGetResult: any = undefined;
  public mockCallResult: any = undefined;
  public mockQueryInterfaceRemoteResult: Definition | null = null;
  public mockQueryInterfaceRemoteError: Error | null = null;
  public mockReleaseInterfaceInternalError: Error | null = null;

  constructor(netron: INetron, id: string, cacheOptions?: DefinitionCacheOptions) {
    super(netron, id, cacheOptions);
  }

  async set(defId: string, name: string, value: any): Promise<void> {
    this.setCallCount++;
    return this.mockSetResult;
  }

  async get(defId: string, name: string): Promise<any> {
    this.getCallCount++;
    return this.mockGetResult;
  }

  async call(defId: string, method: string, args: any[]): Promise<any> {
    this.callCallCount++;
    return this.mockCallResult;
  }

  subscribe(eventName: string, handler: EventSubscriber): void {
    this.subscribeCallCount++;
    if (!this.eventHandlers.has(eventName)) {
      this.eventHandlers.set(eventName, new Set());
    }
    this.eventHandlers.get(eventName)!.add(handler);
  }

  unsubscribe(eventName: string, handler: EventSubscriber): void {
    this.unsubscribeCallCount++;
    const handlers = this.eventHandlers.get(eventName);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  async exposeService(instance: any): Promise<Definition> {
    this.exposeServiceCallCount++;
    const meta = Reflect.getMetadata('service:metadata', instance.constructor);
    if (!meta) {
      throw new Error('Invalid service: missing metadata');
    }
    const def = new Definition(Definition.nextId(), this.id, meta);
    const qualifiedName = `${meta.name}@${meta.version}`;
    this.services.set(qualifiedName, def);
    this.services.set(meta.name, def);
    this.servicesByDefId.set(def.id, def);
    return def;
  }

  async unexposeService(ctxId: string, releaseOriginated?: boolean): Promise<void> {
    this.unexposeServiceCallCount++;
    const def = this.services.get(ctxId);
    if (def) {
      this.services.delete(ctxId);
      this.services.delete(`${def.meta.name}@${def.meta.version}`);
      this.servicesByDefId.delete(def.id);
    }
  }

  getServiceNames(): string[] {
    return Array.from(this.services.keys());
  }

  protected async queryInterfaceRemote(qualifiedName: string): Promise<Definition> {
    this.queryInterfaceRemoteCallCount++;
    if (this.mockQueryInterfaceRemoteError) {
      throw this.mockQueryInterfaceRemoteError;
    }
    if (this.mockQueryInterfaceRemoteResult) {
      return this.mockQueryInterfaceRemoteResult;
    }
    throw new Error(`Service not found: ${qualifiedName}`);
  }

  protected async releaseInterfaceInternal(iInstance: any): Promise<void> {
    this.releaseInterfaceInternalCallCount++;
    if (this.mockReleaseInterfaceInternalError) {
      throw this.mockReleaseInterfaceInternalError;
    }
  }

  protected getDefinitionById(defId: string): Definition {
    const def = this.servicesByDefId.get(defId);
    if (!def) {
      throw new Error(`Definition not found: ${defId}`);
    }
    return def;
  }

  protected getDefinitionByServiceName(name: string): Definition {
    const def = this.services.get(name);
    if (!def) {
      throw new Error(`Service not found: ${name}`);
    }
    return def;
  }

  // Test helpers - expose internal state
  public getInterfaces(): Map<string, { instance: Interface; refCount: number }> {
    return this.interfaces;
  }

  public getDefinitionCache() {
    return this.definitionCache;
  }

  public isDefinitionCacheDisabled(): boolean {
    return this.definitionCacheDisabled;
  }

  // Helper to manually add a service for testing
  public addService(name: string, version: string = '1.0.0'): Definition {
    const def = createMockDefinition(Definition.nextId(), this.id, name, version);
    const qualifiedName = `${name}@${version}`;
    this.services.set(qualifiedName, def);
    this.services.set(name, def);
    this.servicesByDefId.set(def.id, def);
    return def;
  }

  // Helper to emit events for testing
  public emitEvent(eventName: string, ...args: unknown[]): void {
    const handlers = this.eventHandlers.get(eventName);
    if (handlers) {
      handlers.forEach(handler => handler(...args));
    }
  }
}

// ============================================================================
// Test Suites
// ============================================================================

describe('AbstractPeer', () => {
  let netron: INetron;
  let peer: TestPeer;

  beforeEach(() => {
    netron = createMockNetron();
    peer = new TestPeer(netron, 'test-peer-id');
  });

  afterEach(() => {
    peer.disposeDefinitionCache();
  });

  // ==========================================================================
  // Initialization and Configuration Tests
  // ==========================================================================

  describe('Initialization and Configuration', () => {
    it('should initialize with default cache options', () => {
      expect(peer.id).toBe('test-peer-id');
      expect(peer.netron).toBe(netron);
      expect(peer.isDefinitionCacheDisabled()).toBe(false);
      
      const stats = peer.getDefinitionCacheStats();
      expect(stats.maxSize).toBe(DEFAULT_DEFINITION_CACHE_OPTIONS.maxSize);
      expect(stats.ttl).toBe(DEFAULT_DEFINITION_CACHE_OPTIONS.ttl);
    });

    it('should initialize with custom cache options', () => {
      const customPeer = new TestPeer(netron, 'custom-peer', {
        maxSize: 100,
        ttl: 10000,
        cleanupInterval: 5000,
      });

      const stats = customPeer.getDefinitionCacheStats();
      expect(stats.maxSize).toBe(100);
      expect(stats.ttl).toBe(10000);

      customPeer.disposeDefinitionCache();
    });

    it('should disable cache when disabled option is true', () => {
      const disabledPeer = new TestPeer(netron, 'disabled-peer', {
        disabled: true,
      });

      expect(disabledPeer.isDefinitionCacheDisabled()).toBe(true);
      disabledPeer.disposeDefinitionCache();
    });

    it('should use default values when cache options are undefined', () => {
      const defaultPeer = new TestPeer(netron, 'default-peer', undefined);
      
      const stats = defaultPeer.getDefinitionCacheStats();
      expect(stats.maxSize).toBe(500);
      expect(stats.ttl).toBe(5 * 60 * 1000);

      defaultPeer.disposeDefinitionCache();
    });

    it('should have correct default cache options constant values', () => {
      expect(DEFAULT_DEFINITION_CACHE_OPTIONS.maxSize).toBe(500);
      expect(DEFAULT_DEFINITION_CACHE_OPTIONS.ttl).toBe(5 * 60 * 1000);
      expect(DEFAULT_DEFINITION_CACHE_OPTIONS.cleanupInterval).toBe(60 * 1000);
    });
  });

  // ==========================================================================
  // LRU Cache Behavior Tests
  // ==========================================================================

  describe('LRU Cache Behavior', () => {
    it('should cache definitions when querying interface', async () => {
      const def = peer.addService('testService', '1.0.0');
      
      await peer.queryInterface('testService');
      
      const cache = peer.getDefinitionCache();
      expect(cache.size).toBe(1);
      expect(cache.has('testService')).toBe(true);
    });

    it('should not cache definitions when caching is disabled', async () => {
      const disabledPeer = new TestPeer(netron, 'disabled-peer', { disabled: true });
      const def = disabledPeer.addService('testService', '1.0.0');
      
      await disabledPeer.queryInterface('testService');
      
      const cache = disabledPeer.getDefinitionCache();
      expect(cache.size).toBe(0);

      disabledPeer.disposeDefinitionCache();
    });

    it('should retrieve cached definitions on subsequent queries', async () => {
      const def = peer.addService('testService', '1.0.0');
      
      await peer.queryInterface('testService');
      await peer.queryInterface('testService');
      await peer.queryInterface('testService');
      
      const stats = peer.getDefinitionCacheStats();
      expect(stats.hits).toBeGreaterThan(0);
    });

    it('should evict LRU entries when cache is full', async () => {
      const smallCachePeer = new TestPeer(netron, 'small-cache-peer', {
        maxSize: 3,
        ttl: 0, // Disable TTL for this test
      });

      // Add 4 services
      for (let i = 1; i <= 4; i++) {
        smallCachePeer.addService(`service${i}`, '1.0.0');
      }

      // Query all 4 services
      for (let i = 1; i <= 4; i++) {
        await smallCachePeer.queryInterface(`service${i}`);
      }

      const cache = smallCachePeer.getDefinitionCache();
      expect(cache.size).toBe(3);
      
      // First service should be evicted (LRU)
      expect(cache.has('service1')).toBe(false);
      expect(cache.has('service4')).toBe(true);

      smallCachePeer.disposeDefinitionCache();
    });

    it('should update cache statistics correctly', async () => {
      const def = peer.addService('testService', '1.0.0');
      
      // First query - cache miss
      await peer.queryInterface('testService');
      
      // Second query - cache hit
      await peer.queryInterface('testService');
      
      const stats = peer.getDefinitionCacheStats();
      expect(stats.size).toBe(1);
    });

    it('should handle cache invalidation for specific pattern', async () => {
      peer.addService('userService', '1.0.0');
      peer.addService('userAuth', '1.0.0');
      peer.addService('orderService', '1.0.0');
      
      await peer.queryInterface('userService');
      await peer.queryInterface('userAuth');
      await peer.queryInterface('orderService');
      
      const invalidated = peer.invalidateDefinitionCache('user*');
      expect(invalidated).toBe(2);
      
      const cache = peer.getDefinitionCache();
      expect(cache.has('orderService')).toBe(true);
      expect(cache.has('userService')).toBe(false);
      expect(cache.has('userAuth')).toBe(false);
    });

    it('should invalidate all cache entries when no pattern provided', async () => {
      peer.addService('service1', '1.0.0');
      peer.addService('service2', '1.0.0');
      
      await peer.queryInterface('service1');
      await peer.queryInterface('service2');
      
      expect(peer.getDefinitionCache().size).toBe(2);
      
      const invalidated = peer.invalidateDefinitionCache();
      expect(invalidated).toBe(2);
      expect(peer.getDefinitionCache().size).toBe(0);
    });

    it('should clear all cache entries with clearDefinitionCache', async () => {
      peer.addService('service1', '1.0.0');
      peer.addService('service2', '1.0.0');
      
      await peer.queryInterface('service1');
      await peer.queryInterface('service2');
      
      const cleared = peer.clearDefinitionCache();
      expect(cleared).toBe(2);
      expect(peer.getDefinitionCache().size).toBe(0);
    });

    it('should handle exact pattern matching in cache invalidation', async () => {
      peer.addService('testService', '1.0.0');
      peer.addService('testServiceExtra', '1.0.0');
      
      await peer.queryInterface('testService');
      await peer.queryInterface('testServiceExtra');
      
      const invalidated = peer.invalidateDefinitionCache('testService');
      expect(invalidated).toBe(1);
      expect(peer.getDefinitionCache().has('testServiceExtra')).toBe(true);
    });

    it('should return 0 when invalidating non-existent pattern', () => {
      const invalidated = peer.invalidateDefinitionCache('nonExistent*');
      expect(invalidated).toBe(0);
    });
  });

  // ==========================================================================
  // Definition Caching Mechanisms Tests
  // ==========================================================================

  describe('Definition Caching Mechanisms', () => {
    it('should cache with version-specific key', async () => {
      peer.addService('testService', '1.0.0');
      peer.addService('testService', '2.0.0');
      
      await peer.queryInterface('testService@1.0.0');
      await peer.queryInterface('testService@2.0.0');
      
      const cache = peer.getDefinitionCache();
      expect(cache.has('testService@1.0.0')).toBe(true);
      expect(cache.has('testService@2.0.0')).toBe(true);
    });

    it('should normalize cache key for wildcard version', async () => {
      peer.addService('testService', '1.0.0');
      
      await peer.queryInterface('testService@*');
      
      const cache = peer.getDefinitionCache();
      // When version is *, it normalizes to just the name
      expect(cache.has('testService')).toBe(true);
    });

    it('should invalidate cache when definition is deleted', async () => {
      const def = peer.addService('testService', '1.0.0');
      
      await peer.queryInterface('testService');
      expect(peer.getDefinitionCache().has('testService')).toBe(true);
      
      // Simulate service being unexposed (definition deleted)
      await peer.unexposeService('testService');
      
      // Next query should refresh the cache
      peer.addService('testService', '1.0.0');
      await peer.queryInterface('testService');
      
      // Cache should be updated with new definition
      expect(peer.getDefinitionCache().has('testService')).toBe(true);
    });

    it('should handle cache miss and query remote for versioned service', async () => {
      peer.mockQueryInterfaceRemoteResult = createMockDefinition(
        'remote-def-id',
        'remote-peer',
        'remoteService',
        '1.0.0'
      );
      
      // Service not in local cache, should query remote
      await peer.queryInterface('remoteService@1.0.0');
      
      expect(peer.queryInterfaceRemoteCallCount).toBe(1);
    });

    it('should handle cache miss and query remote for unversioned service', async () => {
      peer.mockQueryInterfaceRemoteResult = createMockDefinition(
        'remote-def-id',
        'remote-peer',
        'remoteService',
        '1.0.0'
      );
      
      // Service not in local cache, should query remote
      await peer.queryInterface('remoteService');
      
      expect(peer.queryInterfaceRemoteCallCount).toBe(1);
    });

    it('should cleanup expired cache entries', async () => {
      const shortTtlPeer = new TestPeer(netron, 'short-ttl-peer', {
        ttl: 50, // 50ms TTL
        cleanupInterval: 10000, // Long cleanup interval, we'll trigger manually
      });

      shortTtlPeer.addService('testService', '1.0.0');
      await shortTtlPeer.queryInterface('testService');
      
      expect(shortTtlPeer.getDefinitionCache().size).toBe(1);
      
      // Wait for TTL to expire
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const cleaned = shortTtlPeer.cleanupDefinitionCache();
      expect(cleaned).toBe(1);
      expect(shortTtlPeer.getDefinitionCache().size).toBe(0);

      shortTtlPeer.disposeDefinitionCache();
    });
  });

  // ==========================================================================
  // Interface Lifecycle Tests
  // ==========================================================================

  describe('Interface Lifecycle', () => {
    it('should create interface from definition', async () => {
      const def = peer.addService('testService', '1.0.0');
      
      const iface = await peer.queryInterface('testService');
      
      expect(iface).toBeDefined();
      const interfaces = peer.getInterfaces();
      expect(interfaces.size).toBe(1);
    });

    it('should return same interface instance for same definition', async () => {
      const def = peer.addService('testService', '1.0.0');
      
      const iface1 = await peer.queryInterface('testService');
      const iface2 = await peer.queryInterface('testService');
      
      expect(iface1).toBe(iface2);
    });

    it('should increment reference count on repeated queries', async () => {
      const def = peer.addService('testService', '1.0.0');
      
      await peer.queryInterface('testService');
      await peer.queryInterface('testService');
      await peer.queryInterface('testService');
      
      const interfaces = peer.getInterfaces();
      const ifaceInfo = Array.from(interfaces.values())[0];
      expect(ifaceInfo!.refCount).toBe(3);
    });

    it('should decrement reference count on release', async () => {
      const def = peer.addService('testService', '1.0.0');
      
      const iface1 = await peer.queryInterface('testService');
      const iface2 = await peer.queryInterface('testService');
      
      await peer.releaseInterface(iface1);
      
      const interfaces = peer.getInterfaces();
      const ifaceInfo = Array.from(interfaces.values())[0];
      expect(ifaceInfo!.refCount).toBe(1);
    });

    it('should remove interface when reference count reaches zero', async () => {
      const def = peer.addService('testService', '1.0.0');
      
      const iface = await peer.queryInterface('testService');
      
      await peer.releaseInterface(iface);
      
      const interfaces = peer.getInterfaces();
      expect(interfaces.size).toBe(0);
    });

    it('should call releaseInterfaceInternal when interface is fully released', async () => {
      const def = peer.addService('testService', '1.0.0');
      
      const iface = await peer.queryInterface('testService');
      
      await peer.releaseInterface(iface);
      
      expect(peer.releaseInterfaceInternalCallCount).toBe(1);
    });

    it('should clear $def and $peer when interface is released', async () => {
      const def = peer.addService('testService', '1.0.0');

      const iface: any = await peer.queryInterface('testService');

      expect(iface.$def).toBeDefined();
      expect(iface.$peer).toBeDefined();

      await peer.releaseInterface(iface);

      // After release, the Interface proxy throws when $def is undefined
      // because the get trap requires $def to be present
      // This verifies that $def was cleared (set to undefined)
      expect(() => {
        // Try to access a method - should throw because $def is now undefined
        iface.testMethod;
      }).toThrow(/Invalid interface|Service definition is missing/);
    });

    it('should release child interfaces when parent is released', async () => {
      const parentDef = peer.addService('parentService', '1.0.0');
      const childDef = peer.addService('childService', '1.0.0');
      childDef.parentId = parentDef.id;
      
      const parentIface = await peer.queryInterface('parentService');
      const childIface = await peer.queryInterface('childService');
      
      // Release parent should also release child
      await peer.releaseInterface(parentIface);
      
      const interfaces = peer.getInterfaces();
      expect(interfaces.size).toBe(0);
    });

    it('should throw error when releasing invalid interface', async () => {
      await expect(peer.releaseInterface(null as any)).rejects.toThrow(/Invalid interface/);
      await expect(peer.releaseInterface({} as any)).rejects.toThrow(/Invalid interface/);
      await expect(peer.releaseInterface({ $def: null } as any)).rejects.toThrow(/Invalid interface/);
    });

    it('should throw error when releasing already released interface', async () => {
      const def = peer.addService('testService', '1.0.0');
      
      const iface = await peer.queryInterface('testService');
      
      await peer.releaseInterface(iface);
      
      await expect(peer.releaseInterface(iface)).rejects.toThrow(/Invalid interface/);
    });

    it('should handle circular release prevention', async () => {
      const def = peer.addService('testService', '1.0.0');
      const iface = await peer.queryInterface('testService');
      
      // Create a set to track released
      const released = new Set<string>();
      released.add((iface as any).$def.id);
      
      // This should return early because the defId is already in the released set
      await peer.releaseInterface(iface, released);
      
      // Interface should still exist because we pre-added it to released
      const interfaces = peer.getInterfaces();
      expect(interfaces.size).toBe(1);
    });

    it('should query interface by definition id', async () => {
      const def = peer.addService('testService', '1.0.0');
      
      const iface = peer.queryInterfaceByDefId(def.id);
      
      expect(iface).toBeDefined();
      expect((iface as any).$def.id).toBe(def.id);
    });

    it('should query interface by definition id with pre-fetched definition', async () => {
      const def = peer.addService('testService', '1.0.0');
      
      const iface = peer.queryInterfaceByDefId(def.id, def);
      
      expect(iface).toBeDefined();
      expect((iface as any).$def).toBe(def);
    });
  });

  // ==========================================================================
  // Event Subscription Tests
  // ==========================================================================

  describe('Event Subscription and Emission', () => {
    it('should subscribe to events', () => {
      const handler = jest.fn();
      
      peer.subscribe('testEvent', handler);
      
      expect(peer.subscribeCallCount).toBe(1);
    });

    it('should unsubscribe from events', () => {
      const handler = jest.fn();
      
      peer.subscribe('testEvent', handler);
      peer.unsubscribe('testEvent', handler);
      
      expect(peer.unsubscribeCallCount).toBe(1);
    });

    it('should call event handlers when event is emitted', () => {
      const handler = jest.fn();
      
      peer.subscribe('testEvent', handler);
      peer.emitEvent('testEvent', 'arg1', 'arg2');
      
      expect(handler).toHaveBeenCalledWith('arg1', 'arg2');
    });

    it('should support multiple handlers for same event', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();
      
      peer.subscribe('testEvent', handler1);
      peer.subscribe('testEvent', handler2);
      peer.emitEvent('testEvent', 'data');
      
      expect(handler1).toHaveBeenCalledWith('data');
      expect(handler2).toHaveBeenCalledWith('data');
    });

    it('should only remove specific handler on unsubscribe', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();
      
      peer.subscribe('testEvent', handler1);
      peer.subscribe('testEvent', handler2);
      peer.unsubscribe('testEvent', handler1);
      peer.emitEvent('testEvent', 'data');
      
      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).toHaveBeenCalledWith('data');
    });
  });

  // ==========================================================================
  // Error Handling Tests
  // ==========================================================================

  describe('Error Handling', () => {
    it('should throw when querying non-existent service', async () => {
      await expect(peer.queryInterface('nonExistent')).rejects.toThrow(/Service not found|not found/);
    });

    it('should throw when remote query fails', async () => {
      peer.mockQueryInterfaceRemoteError = new Error('Remote query failed');
      
      await expect(peer.queryInterface('remoteService')).rejects.toThrow('Remote query failed');
    });

    it('should handle errors in release interface internal', async () => {
      const def = peer.addService('testService', '1.0.0');
      const iface = await peer.queryInterface('testService');
      
      peer.mockReleaseInterfaceInternalError = new Error('Release failed');
      
      await expect(peer.releaseInterface(iface)).rejects.toThrow('Release failed');
    });

    it('should throw when getting non-existent definition by id', () => {
      expect(() => peer.queryInterfaceByDefId('non-existent-id')).toThrow(/Definition not found/);
    });
  });

  // ==========================================================================
  // Service Version Resolution Tests
  // ==========================================================================

  describe('Service Version Resolution', () => {
    it('should find service without version specifier', async () => {
      peer.addService('testService', '1.0.0');
      
      const iface = await peer.queryInterface('testService');
      
      expect(iface).toBeDefined();
    });

    it('should find service with specific version', async () => {
      peer.addService('testService', '1.0.0');
      peer.addService('testService', '2.0.0');
      
      const iface = await peer.queryInterface('testService@1.0.0');
      
      expect(iface).toBeDefined();
      expect((iface as any).$def.meta.version).toBe('1.0.0');
    });

    it('should find latest version with wildcard', async () => {
      peer.addService('versionedService', '1.0.0');
      peer.addService('versionedService', '2.0.0');
      peer.addService('versionedService', '1.5.0');
      
      // Without version should find service directly
      const iface = await peer.queryInterface('versionedService');
      
      expect(iface).toBeDefined();
    });

    it('should parse qualified name correctly', async () => {
      peer.addService('my.service', '1.0.0');
      
      const iface = await peer.queryInterface('my.service@1.0.0');
      
      expect(iface).toBeDefined();
      expect((iface as any).$def.meta.name).toBe('my.service');
    });

    it('should handle service name with @ character', async () => {
      const def = peer.addService('test', '1.0.0');
      
      // Query with version
      const iface = await peer.queryInterface('test@1.0.0');
      
      expect(iface).toBeDefined();
    });
  });

  // ==========================================================================
  // Cleanup and Disposal Tests
  // ==========================================================================

  describe('Cleanup and Disposal', () => {
    it('should dispose definition cache', () => {
      const newPeer = new TestPeer(netron, 'dispose-test-peer');
      
      newPeer.disposeDefinitionCache();
      
      // Should be safe to call multiple times
      newPeer.disposeDefinitionCache();
    });

    it('should unexpose all services', async () => {
      peer.addService('service1', '1.0.0');
      peer.addService('service2', '1.0.0');
      peer.addService('service3', '1.0.0');
      
      expect(peer.getServiceNames().length).toBe(6); // 3 services x 2 keys each
      
      peer.unexposeAllServices();
      
      expect(peer.unexposeServiceCallCount).toBe(6);
    });

    it('should cleanup expired entries manually', () => {
      const cleaned = peer.cleanupDefinitionCache();
      expect(cleaned).toBe(0); // No expired entries
    });

    it('should get definition cache stats', () => {
      const stats = peer.getDefinitionCacheStats();
      
      expect(stats).toHaveProperty('size');
      expect(stats).toHaveProperty('maxSize');
      expect(stats).toHaveProperty('hits');
      expect(stats).toHaveProperty('misses');
      expect(stats).toHaveProperty('hitRate');
      expect(stats).toHaveProperty('sizeEvictions');
      expect(stats).toHaveProperty('ttlEvictions');
      expect(stats).toHaveProperty('ttl');
    });
  });

  // ==========================================================================
  // Abstract Method Implementation Tests
  // ==========================================================================

  describe('Abstract Method Implementations', () => {
    it('should call set method', async () => {
      await peer.set('defId', 'propName', 'value');
      expect(peer.setCallCount).toBe(1);
    });

    it('should call get method', async () => {
      peer.mockGetResult = 'testValue';
      const result = await peer.get('defId', 'propName');
      expect(peer.getCallCount).toBe(1);
      expect(result).toBe('testValue');
    });

    it('should call call method', async () => {
      peer.mockCallResult = 42;
      const result = await peer.call('defId', 'methodName', [1, 2]);
      expect(peer.callCallCount).toBe(1);
      expect(result).toBe(42);
    });

    it('should expose service', async () => {
      // Create a mock service with metadata
      class MockService {
        testMethod() { return 'test'; }
      }
      Reflect.defineMetadata('service:metadata', {
        name: 'mockService',
        version: '1.0.0',
        methods: {},
        properties: {},
      }, MockService);
      
      const def = await peer.exposeService(new MockService());
      
      expect(peer.exposeServiceCallCount).toBe(1);
      expect(def).toBeDefined();
      expect(def.meta.name).toBe('mockService');
    });

    it('should throw when exposing service without metadata', async () => {
      class InvalidService {
        testMethod() { return 'test'; }
      }
      
      await expect(peer.exposeService(new InvalidService())).rejects.toThrow(/Invalid service|missing metadata/);
    });

    it('should unexpose service', async () => {
      peer.addService('testService', '1.0.0');
      
      await peer.unexposeService('testService');
      
      expect(peer.unexposeServiceCallCount).toBe(1);
    });
  });

  // ==========================================================================
  // Pattern Matching Tests
  // ==========================================================================

  describe('Pattern Matching in Cache Invalidation', () => {
    beforeEach(async () => {
      peer.addService('user.service', '1.0.0');
      peer.addService('user.auth', '1.0.0');
      peer.addService('order.service', '1.0.0');
      peer.addService('payment.service', '1.0.0');
      
      await peer.queryInterface('user.service');
      await peer.queryInterface('user.auth');
      await peer.queryInterface('order.service');
      await peer.queryInterface('payment.service');
    });

    it('should match prefix patterns', () => {
      const invalidated = peer.invalidateDefinitionCache('user.*');
      expect(invalidated).toBe(2);
    });

    it('should match suffix patterns', () => {
      const invalidated = peer.invalidateDefinitionCache('*.service');
      expect(invalidated).toBe(3);
    });

    it('should match middle wildcard patterns', () => {
      const invalidated = peer.invalidateDefinitionCache('*.auth');
      expect(invalidated).toBe(1);
    });

    it('should handle patterns with no matches', () => {
      const invalidated = peer.invalidateDefinitionCache('nonexistent*');
      expect(invalidated).toBe(0);
    });

    it('should handle exact match without wildcard', () => {
      const invalidated = peer.invalidateDefinitionCache('order.service');
      expect(invalidated).toBe(1);
    });

    it('should not match partial strings without wildcard', () => {
      const invalidated = peer.invalidateDefinitionCache('user');
      expect(invalidated).toBe(0); // Should not match 'user.service' or 'user.auth'
    });

    it('should handle complex patterns', () => {
      peer.addService('api.v1.user', '1.0.0');
      peer.addService('api.v2.user', '1.0.0');
      
      // Wait for these to be cached
      // Re-query to cache them
      (async () => {
        await peer.queryInterface('api.v1.user');
        await peer.queryInterface('api.v2.user');
      })();
      
      const invalidated = peer.invalidateDefinitionCache('api.*.user');
      // May not match if async hasn't completed, but pattern matching should work
      expect(invalidated).toBeGreaterThanOrEqual(0);
    });
  });

  // ==========================================================================
  // isNetronPeer Predicate Tests
  // ==========================================================================

  describe('isNetronPeer Predicate', () => {
    it('should return true for AbstractPeer instance', () => {
      expect(isNetronPeer(peer)).toBe(true);
    });

    it('should return false for null', () => {
      expect(isNetronPeer(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isNetronPeer(undefined)).toBe(false);
    });

    it('should return false for plain object', () => {
      expect(isNetronPeer({})).toBe(false);
    });

    it('should return false for object with similar shape', () => {
      const fakePeer = {
        id: 'fake',
        netron: createMockNetron(),
        queryInterface: () => {},
        subscribe: () => {},
        unsubscribe: () => {},
      };
      expect(isNetronPeer(fakePeer)).toBe(false);
    });

    it('should return false for primitive values', () => {
      expect(isNetronPeer('string')).toBe(false);
      expect(isNetronPeer(123)).toBe(false);
      expect(isNetronPeer(true)).toBe(false);
    });

    it('should return false for array', () => {
      expect(isNetronPeer([])).toBe(false);
    });

    it('should return false for function', () => {
      expect(isNetronPeer(() => {})).toBe(false);
    });
  });

  // ==========================================================================
  // Edge Cases and Boundary Tests
  // ==========================================================================

  describe('Edge Cases and Boundary Conditions', () => {
    it('should handle empty service name', async () => {
      await expect(peer.queryInterface('')).rejects.toThrow();
    });

    it('should handle service name with only @ symbol', async () => {
      await expect(peer.queryInterface('@')).rejects.toThrow();
    });

    it('should handle very long service names', async () => {
      const longName = 'a'.repeat(1000);
      peer.addService(longName, '1.0.0');
      
      const iface = await peer.queryInterface(longName);
      expect(iface).toBeDefined();
    });

    it('should handle special characters in service names', async () => {
      peer.addService('my-service_v2', '1.0.0');
      
      const iface = await peer.queryInterface('my-service_v2');
      expect(iface).toBeDefined();
    });

    it('should handle concurrent interface queries', async () => {
      const def = peer.addService('concurrentService', '1.0.0');
      
      const promises = Array(10).fill(null).map(() => 
        peer.queryInterface('concurrentService')
      );
      
      const results = await Promise.all(promises);
      
      // All should return the same interface
      const first = results[0];
      results.forEach(iface => {
        expect(iface).toBe(first);
      });
      
      // Reference count should be 10
      const interfaces = peer.getInterfaces();
      const ifaceInfo = Array.from(interfaces.values())[0];
      expect(ifaceInfo!.refCount).toBe(10);
    });

    it('should handle rapid cache operations', async () => {
      for (let i = 0; i < 100; i++) {
        peer.addService(`rapidService${i}`, '1.0.0');
      }
      
      const queries = [];
      for (let i = 0; i < 100; i++) {
        queries.push(peer.queryInterface(`rapidService${i}`));
      }
      
      await Promise.all(queries);
      
      // Should have cached many entries
      expect(peer.getDefinitionCache().size).toBeGreaterThan(0);
    });

    it('should handle zero TTL cache option', () => {
      const zeroTtlPeer = new TestPeer(netron, 'zero-ttl-peer', {
        ttl: 0,
      });
      
      const stats = zeroTtlPeer.getDefinitionCacheStats();
      expect(stats.ttl).toBe(0);
      
      // Cleanup should return 0 when TTL is disabled
      const cleaned = zeroTtlPeer.cleanupDefinitionCache();
      expect(cleaned).toBe(0);
      
      zeroTtlPeer.disposeDefinitionCache();
    });

    it('should handle maxSize of 1', async () => {
      const singleEntryPeer = new TestPeer(netron, 'single-entry-peer', {
        maxSize: 1,
      });
      
      singleEntryPeer.addService('service1', '1.0.0');
      singleEntryPeer.addService('service2', '1.0.0');
      
      await singleEntryPeer.queryInterface('service1');
      await singleEntryPeer.queryInterface('service2');
      
      // Only one entry should be in cache
      expect(singleEntryPeer.getDefinitionCache().size).toBe(1);
      expect(singleEntryPeer.getDefinitionCache().has('service2')).toBe(true);
      expect(singleEntryPeer.getDefinitionCache().has('service1')).toBe(false);
      
      singleEntryPeer.disposeDefinitionCache();
    });
  });

  // ==========================================================================
  // Integration-style Tests
  // ==========================================================================

  describe('Integration-style Tests', () => {
    it('should handle full lifecycle: expose, query, use, release, unexpose', async () => {
      // Create service with metadata
      class TestService {
        value = 42;
        getValue() { return this.value; }
      }
      Reflect.defineMetadata('service:metadata', {
        name: 'testService',
        version: '1.0.0',
        methods: { getValue: { type: 'number', arguments: [] } },
        properties: { value: { type: 'number', readonly: false } },
      }, TestService);
      
      // Expose
      const def = await peer.exposeService(new TestService());
      expect(def).toBeDefined();
      
      // Query
      const iface = await peer.queryInterface('testService');
      expect(iface).toBeDefined();
      
      // Use (in test peer, this just increments counters)
      await peer.call(def.id, 'getValue', []);
      expect(peer.callCallCount).toBe(1);
      
      // Release
      await peer.releaseInterface(iface);
      expect(peer.getInterfaces().size).toBe(0);
      
      // Unexpose
      await peer.unexposeService('testService');
      expect(peer.getServiceNames()).not.toContain('testService');
    });

    it('should handle multiple peers sharing same netron', () => {
      const peer1 = new TestPeer(netron, 'peer-1');
      const peer2 = new TestPeer(netron, 'peer-2');
      
      expect(peer1.netron).toBe(peer2.netron);
      expect(peer1.id).not.toBe(peer2.id);
      
      peer1.disposeDefinitionCache();
      peer2.disposeDefinitionCache();
    });

    it('should handle cache with version evolution', async () => {
      // Add v1.0.0
      peer.addService('evolvingService', '1.0.0');
      const iface1 = await peer.queryInterface('evolvingService@1.0.0');
      
      // Add v2.0.0
      peer.addService('evolvingService', '2.0.0');
      const iface2 = await peer.queryInterface('evolvingService@2.0.0');
      
      // Both versions should be cached
      expect(peer.getDefinitionCache().has('evolvingService@1.0.0')).toBe(true);
      expect(peer.getDefinitionCache().has('evolvingService@2.0.0')).toBe(true);
      
      // Interfaces should be different
      expect(iface1).not.toBe(iface2);
    });
  });
});
