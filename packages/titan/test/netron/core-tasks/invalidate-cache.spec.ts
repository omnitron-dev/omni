/**
 * Tests for invalidate_cache core-task
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { invalidate_cache } from '../../../src/netron/core-tasks/invalidate-cache.js';
import type { Definition } from '../../../src/netron/definition.js';

describe('invalidate_cache core-task', () => {
  let remotePeer: any;
  let mockLogger: any;
  let servicesMap: Map<string, Definition>;

  beforeEach(() => {
    mockLogger = {
      child: jest.fn().mockReturnThis(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    servicesMap = new Map();

    remotePeer = {
      services: servicesMap,
      logger: mockLogger,
    } as any;
  });

  describe('clear all cache', () => {
    it('should clear all cached definitions when no pattern provided', async () => {
      const def1: Definition = {
        id: 'def-1',
        peerId: 'peer-1',
        parentId: '',
        meta: {
          name: 'service1',
          version: '1.0.0',
          properties: {},
          methods: {},
          transports: [],
        },
      };

      const def2: Definition = {
        id: 'def-2',
        peerId: 'peer-1',
        parentId: '',
        meta: {
          name: 'service2',
          version: '1.0.0',
          properties: {},
          methods: {},
          transports: [],
        },
      };

      servicesMap.set('service1@1.0.0', def1);
      servicesMap.set('service2@1.0.0', def2);

      const count = await invalidate_cache(remotePeer);

      expect(count).toBe(2);
      expect(servicesMap.size).toBe(0);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ count: 2 }),
        'All cached service definitions invalidated'
      );
    });

    it('should return 0 when cache is empty', async () => {
      const count = await invalidate_cache(remotePeer);

      expect(count).toBe(0);
      expect(servicesMap.size).toBe(0);
    });
  });

  describe('pattern matching', () => {
    beforeEach(() => {
      // Setup multiple services with different names
      servicesMap.set('userService@1.0.0', createDefinition('userService'));
      servicesMap.set('userAuth@1.0.0', createDefinition('userAuth'));
      servicesMap.set('adminService@1.0.0', createDefinition('adminService'));
      servicesMap.set('productService@1.0.0', createDefinition('productService'));
      servicesMap.set('orderService@2.0.0', createDefinition('orderService'));
    });

    it('should invalidate cache for exact service name match', async () => {
      const count = await invalidate_cache(remotePeer, 'userService@1.0.0');

      expect(count).toBe(1);
      expect(servicesMap.has('userService@1.0.0')).toBe(false);
      expect(servicesMap.has('userAuth@1.0.0')).toBe(true);
      expect(servicesMap.size).toBe(4);
    });

    it('should invalidate cache for wildcard pattern at end', async () => {
      const count = await invalidate_cache(remotePeer, 'user*');

      expect(count).toBe(2);
      expect(servicesMap.has('userService@1.0.0')).toBe(false);
      expect(servicesMap.has('userAuth@1.0.0')).toBe(false);
      expect(servicesMap.has('adminService@1.0.0')).toBe(true);
      expect(servicesMap.size).toBe(3);
    });

    it('should invalidate cache for wildcard pattern in middle', async () => {
      const count = await invalidate_cache(remotePeer, '*Service@1.0.0');

      expect(count).toBe(3);
      expect(servicesMap.has('userService@1.0.0')).toBe(false);
      expect(servicesMap.has('adminService@1.0.0')).toBe(false);
      expect(servicesMap.has('productService@1.0.0')).toBe(false);
      expect(servicesMap.has('orderService@2.0.0')).toBe(true);
      expect(servicesMap.size).toBe(2);
    });

    it('should invalidate cache for wildcard pattern matching all', async () => {
      const count = await invalidate_cache(remotePeer, '*');

      expect(count).toBe(5);
      expect(servicesMap.size).toBe(0);
    });

    it('should invalidate cache for complex wildcard pattern', async () => {
      const count = await invalidate_cache(remotePeer, '*Service@*.0.0');

      expect(count).toBe(4);
      expect(servicesMap.has('userAuth@1.0.0')).toBe(true);
      expect(servicesMap.size).toBe(1);
    });

    it('should return 0 when no services match pattern', async () => {
      const count = await invalidate_cache(remotePeer, 'nonexistent*');

      expect(count).toBe(0);
      expect(servicesMap.size).toBe(5);
    });

    it('should handle pattern without wildcards as exact match', async () => {
      const count = await invalidate_cache(remotePeer, 'adminService@1.0.0');

      expect(count).toBe(1);
      expect(servicesMap.has('adminService@1.0.0')).toBe(false);
      expect(servicesMap.size).toBe(4);
    });
  });

  describe('edge cases', () => {
    it('should handle empty service name in pattern', async () => {
      servicesMap.set('service@1.0.0', createDefinition('service'));

      const count = await invalidate_cache(remotePeer, '');

      expect(count).toBe(0);
      expect(servicesMap.size).toBe(1);
    });

    it('should handle regex special characters in pattern', async () => {
      servicesMap.set('service.test@1.0.0', createDefinition('service.test'));
      servicesMap.set('service-test@1.0.0', createDefinition('service-test'));
      servicesMap.set('service+test@1.0.0', createDefinition('service+test'));

      const count = await invalidate_cache(remotePeer, 'service.test@1.0.0');

      expect(count).toBe(1);
      expect(servicesMap.has('service.test@1.0.0')).toBe(false);
      expect(servicesMap.has('service-test@1.0.0')).toBe(true);
    });

    it('should handle multiple wildcards in pattern', async () => {
      servicesMap.set('user-service-v1@1.0.0', createDefinition('user-service-v1'));
      servicesMap.set('user-auth-v1@1.0.0', createDefinition('user-auth-v1'));
      servicesMap.set('admin-service-v2@2.0.0', createDefinition('admin-service-v2'));

      const count = await invalidate_cache(remotePeer, 'user-*-v1@*');

      expect(count).toBe(2);
      expect(servicesMap.has('user-service-v1@1.0.0')).toBe(false);
      expect(servicesMap.has('user-auth-v1@1.0.0')).toBe(false);
      expect(servicesMap.has('admin-service-v2@2.0.0')).toBe(true);
    });
  });

  describe('logging', () => {
    it('should log all invalidations', async () => {
      servicesMap.set('service1@1.0.0', createDefinition('service1'));
      servicesMap.set('service2@1.0.0', createDefinition('service2'));

      await invalidate_cache(remotePeer);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ count: 2 }),
        'All cached service definitions invalidated'
      );
    });

    it('should log pattern-based invalidations', async () => {
      servicesMap.set('userService@1.0.0', createDefinition('userService'));
      servicesMap.set('userAuth@1.0.0', createDefinition('userAuth'));

      await invalidate_cache(remotePeer, 'user*');

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          pattern: 'user*',
          count: 2,
          services: expect.arrayContaining(['userService@1.0.0', 'userAuth@1.0.0']),
        }),
        'Cached service definitions invalidated'
      );
    });

    it('should log when no services match pattern', async () => {
      servicesMap.set('service@1.0.0', createDefinition('service'));

      await invalidate_cache(remotePeer, 'nonexistent*');

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          pattern: 'nonexistent*',
          count: 0,
          services: [],
        }),
        'Cached service definitions invalidated'
      );
    });
  });

  describe('return value', () => {
    it('should return correct count for single invalidation', async () => {
      servicesMap.set('service@1.0.0', createDefinition('service'));

      const count = await invalidate_cache(remotePeer, 'service@1.0.0');

      expect(count).toBe(1);
    });

    it('should return correct count for multiple invalidations', async () => {
      servicesMap.set('service1@1.0.0', createDefinition('service1'));
      servicesMap.set('service2@1.0.0', createDefinition('service2'));
      servicesMap.set('service3@1.0.0', createDefinition('service3'));

      const count = await invalidate_cache(remotePeer, 'service*');

      expect(count).toBe(3);
    });

    it('should return 0 when nothing invalidated', async () => {
      const count = await invalidate_cache(remotePeer, 'service@1.0.0');

      expect(count).toBe(0);
    });
  });
});

/**
 * Helper function to create a Definition
 */
function createDefinition(name: string): Definition {
  return {
    id: `def-${name}`,
    peerId: 'peer-123',
    parentId: '',
    meta: {
      name,
      version: '1.0.0',
      properties: {},
      methods: {},
      transports: [],
    },
  };
}
