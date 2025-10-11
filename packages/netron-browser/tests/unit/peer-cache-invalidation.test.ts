/**
 * Unit tests for Peer Cache Invalidation
 * Tests both HttpRemotePeer and WebSocketPeer cache invalidation functionality
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { HttpRemotePeer } from '../../src/transport/http/peer.js';
import { HttpCacheManager } from '../../src/transport/http/fluent-interface/cache-manager.js';
import { Definition } from '../../src/core/definition.js';

describe('HttpRemotePeer Cache Invalidation', () => {
  let peer: HttpRemotePeer;
  let cacheManager: HttpCacheManager;

  beforeEach(() => {
    peer = new HttpRemotePeer('http://localhost:3000');
    cacheManager = new HttpCacheManager({ maxEntries: 100 });
    peer.setCacheManager(cacheManager);
  });

  describe('invalidateCache', () => {
    it('should invalidate all caches by default', async () => {
      // Setup some cached data
      cacheManager.set('UserService@1.0.0:getUser', { id: 1, name: 'John' }, { maxAge: 60000 });
      cacheManager.set('OrderService@1.0.0:getOrder', { id: 1, total: 100 }, { maxAge: 60000 });

      // Add some service definitions
      const definition = new Definition('def-1', 'peer-1', {
        name: 'UserService',
        version: '1.0.0',
        methods: [],
        properties: [],
        events: [],
      });
      peer.services.set('UserService@1.0.0', definition);

      const statsBeforeHttp = cacheManager.getStats();
      expect(statsBeforeHttp.entries).toBe(2);
      expect(peer.services.size).toBe(1);

      // Invalidate all cache
      const count = await peer.invalidateCache();

      const statsAfterHttp = cacheManager.getStats();
      expect(statsAfterHttp.entries).toBe(0);
      expect(peer.services.size).toBe(0);
      expect(count).toBeGreaterThan(0);
    });

    it('should invalidate only service cache when requested', async () => {
      // Setup cached data
      cacheManager.set('UserService@1.0.0:getUser', { id: 1, name: 'John' }, { maxAge: 60000 });

      // Add service definition
      const definition = new Definition('def-1', 'peer-1', {
        name: 'UserService',
        version: '1.0.0',
        methods: [],
        properties: [],
        events: [],
      });
      peer.services.set('UserService@1.0.0', definition);

      // Invalidate only service cache
      const count = await peer.invalidateCache(undefined, 'service');

      // HTTP cache should still exist
      const stats = cacheManager.getStats();
      expect(stats.entries).toBe(1);

      // Service cache should be cleared
      expect(peer.services.size).toBe(0);
      expect(count).toBe(1);
    });

    it('should invalidate only HTTP cache when requested', async () => {
      // Setup cached data
      cacheManager.set('UserService@1.0.0:getUser', { id: 1, name: 'John' }, { maxAge: 60000 });
      cacheManager.set('OrderService@1.0.0:getOrder', { id: 1, total: 100 }, { maxAge: 60000 });

      // Add service definition
      const definition = new Definition('def-1', 'peer-1', {
        name: 'UserService',
        version: '1.0.0',
        methods: [],
        properties: [],
        events: [],
      });
      peer.services.set('UserService@1.0.0', definition);

      // Invalidate only HTTP cache
      const count = await peer.invalidateCache(undefined, 'http');

      // HTTP cache should be cleared
      const stats = cacheManager.getStats();
      expect(stats.entries).toBe(0);

      // Service cache should still exist
      expect(peer.services.size).toBe(1);
      expect(count).toBe(2);
    });

    it('should invalidate cache by exact pattern', async () => {
      // Setup cached data
      cacheManager.set('UserService@1.0.0:getUser', { id: 1, name: 'John' }, { maxAge: 60000 });
      cacheManager.set('OrderService@1.0.0:getOrder', { id: 1, total: 100 }, { maxAge: 60000 });

      // Add service definitions
      const userDef = new Definition('def-1', 'peer-1', {
        name: 'UserService',
        version: '1.0.0',
        methods: [],
        properties: [],
        events: [],
      });
      peer.services.set('UserService@1.0.0', userDef);

      const orderDef = new Definition('def-2', 'peer-1', {
        name: 'OrderService',
        version: '1.0.0',
        methods: [],
        properties: [],
        events: [],
      });
      peer.services.set('OrderService@1.0.0', orderDef);

      // Invalidate by exact pattern
      const count = await peer.invalidateCache('UserService@1.0.0:getUser');

      // Only matching HTTP cache should be cleared
      const stats = cacheManager.getStats();
      expect(stats.entries).toBe(1);

      // Service cache should still have both
      expect(peer.services.size).toBe(2);
      expect(count).toBe(1);
    });

    it('should invalidate cache by wildcard pattern', async () => {
      // Setup cached data
      cacheManager.set('UserService@1.0.0:getUser', { id: 1, name: 'John' }, { maxAge: 60000 });
      cacheManager.set('UserAuthService@1.0.0:auth', { token: 'abc' }, { maxAge: 60000 });
      cacheManager.set('OrderService@1.0.0:getOrder', { id: 1, total: 100 }, { maxAge: 60000 });

      // Add service definitions
      const userDef = new Definition('def-1', 'peer-1', {
        name: 'UserService',
        version: '1.0.0',
        methods: [],
        properties: [],
        events: [],
      });
      peer.services.set('UserService@1.0.0', userDef);

      const authDef = new Definition('def-2', 'peer-1', {
        name: 'UserAuthService',
        version: '1.0.0',
        methods: [],
        properties: [],
        events: [],
      });
      peer.services.set('UserAuthService@1.0.0', authDef);

      const orderDef = new Definition('def-3', 'peer-1', {
        name: 'OrderService',
        version: '1.0.0',
        methods: [],
        properties: [],
        events: [],
      });
      peer.services.set('OrderService@1.0.0', orderDef);

      // Invalidate by wildcard pattern
      const count = await peer.invalidateCache('User*');

      // Only matching HTTP caches should be cleared
      const stats = cacheManager.getStats();
      expect(stats.entries).toBe(1); // Only OrderService remains

      // Only matching services should be cleared
      expect(peer.services.size).toBe(1);
      expect(peer.services.has('OrderService@1.0.0')).toBe(true);
      expect(count).toBeGreaterThan(0);
    });

    it('should return 0 when no cache manager is set', async () => {
      const peerWithoutCache = new HttpRemotePeer('http://localhost:3000');

      const count = await peerWithoutCache.invalidateCache(undefined, 'http');

      expect(count).toBe(0);
    });

    it('should handle empty cache gracefully', async () => {
      const count = await peer.invalidateCache();

      expect(count).toBe(0);
    });

    it('should handle pattern with no matches', async () => {
      // Setup cached data
      cacheManager.set('UserService@1.0.0:getUser', { id: 1, name: 'John' }, { maxAge: 60000 });

      const count = await peer.invalidateCache('NonExistent*');

      // Nothing should be cleared
      const stats = cacheManager.getStats();
      expect(stats.entries).toBe(1);
      expect(count).toBe(0);
    });

    it('should invalidate cache with version wildcards', async () => {
      // Setup cached data
      cacheManager.set('UserService@1.0.0:getUser', { id: 1, name: 'John' }, { maxAge: 60000 });
      cacheManager.set('UserService@2.0.0:getUser', { id: 2, name: 'Jane' }, { maxAge: 60000 });
      cacheManager.set('OrderService@1.0.0:getOrder', { id: 1, total: 100 }, { maxAge: 60000 });

      // Invalidate by version wildcard
      const count = await peer.invalidateCache('UserService*');

      // Only matching caches should be cleared
      const stats = cacheManager.getStats();
      expect(stats.entries).toBe(1); // Only OrderService remains
      expect(count).toBeGreaterThan(0);
    });
  });

  describe('invalidateDefinitionCache', () => {
    it('should invalidate all definitions', () => {
      // Add service definitions
      const def1 = new Definition('def-1', 'peer-1', {
        name: 'UserService',
        version: '1.0.0',
        methods: [],
        properties: [],
        events: [],
      });
      peer.services.set('UserService@1.0.0', def1);

      const def2 = new Definition('def-2', 'peer-1', {
        name: 'OrderService',
        version: '1.0.0',
        methods: [],
        properties: [],
        events: [],
      });
      peer.services.set('OrderService@1.0.0', def2);

      const count = peer.invalidateDefinitionCache();

      expect(count).toBeGreaterThan(0);
      expect(peer.services.size).toBe(0);
    });

    it('should invalidate definitions by pattern', () => {
      // Add service definitions
      const def1 = new Definition('def-1', 'peer-1', {
        name: 'UserService',
        version: '1.0.0',
        methods: [],
        properties: [],
        events: [],
      });
      peer.services.set('UserService@1.0.0', def1);

      const def2 = new Definition('def-2', 'peer-1', {
        name: 'OrderService',
        version: '1.0.0',
        methods: [],
        properties: [],
        events: [],
      });
      peer.services.set('OrderService@1.0.0', def2);

      const count = peer.invalidateDefinitionCache('User*');

      expect(count).toBeGreaterThan(0);
      expect(peer.services.has('UserService@1.0.0')).toBe(false);
      expect(peer.services.has('OrderService@1.0.0')).toBe(true);
    });
  });
});

describe('HttpCacheManager Integration', () => {
  let cacheManager: HttpCacheManager;

  beforeEach(() => {
    cacheManager = new HttpCacheManager({ maxEntries: 100 });
  });

  it('should support pattern invalidation with string', () => {
    cacheManager.set('UserService@1.0.0:getUser', { id: 1 }, { maxAge: 60000 });
    cacheManager.set('UserService@1.0.0:listUsers', { users: [] }, { maxAge: 60000 });
    cacheManager.set('OrderService@1.0.0:getOrder', { id: 1 }, { maxAge: 60000 });

    cacheManager.invalidate('UserService@1.0.0*');

    const stats = cacheManager.getStats();
    expect(stats.entries).toBe(1); // Only OrderService remains
  });

  it('should support pattern invalidation with regex', () => {
    cacheManager.set('UserService@1.0.0:getUser', { id: 1 }, { maxAge: 60000 });
    cacheManager.set('UserService@2.0.0:getUser', { id: 2 }, { maxAge: 60000 });
    cacheManager.set('OrderService@1.0.0:getOrder', { id: 1 }, { maxAge: 60000 });

    cacheManager.invalidate(/^UserService@/);

    const stats = cacheManager.getStats();
    expect(stats.entries).toBe(1); // Only OrderService remains
  });

  it('should support tag-based invalidation', () => {
    cacheManager.set('key1', { data: 1 }, { maxAge: 60000, tags: ['user', 'profile'] });
    cacheManager.set('key2', { data: 2 }, { maxAge: 60000, tags: ['user', 'settings'] });
    cacheManager.set('key3', { data: 3 }, { maxAge: 60000, tags: ['order'] });

    cacheManager.invalidate(['user']);

    const stats = cacheManager.getStats();
    expect(stats.entries).toBe(1); // Only order remains
  });
});
