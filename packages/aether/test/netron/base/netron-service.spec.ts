/**
 * @fileoverview Comprehensive tests for NetronService base class
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NetronService } from '../../../src/netron/base/netron-service.js';
import { NetronClient } from '../../../src/netron/client.js';
import { Backend, getBackendName } from '../../../src/netron/decorators/backend.js';
import { Service, getServiceName } from '../../../src/netron/decorators/service.js';
import { Injectable } from '../../../src/di/index.js';
import type { QueryOptions, MutationOptions } from '../../../src/netron/types.js';

// Mock NetronClient
vi.mock('../../../src/netron/client.js', () => {
  return {
    NetronClient: vi.fn().mockImplementation(() => ({
      backend: vi.fn().mockReturnValue({
        queryFluentInterface: vi.fn().mockResolvedValue({
          getUsers: vi.fn().mockResolvedValue([{ id: '1', name: 'John' }]),
          getUser: vi.fn().mockResolvedValue({ id: '1', name: 'John' }),
          updateUser: vi.fn().mockResolvedValue({ id: '1', name: 'John Updated' }),
        }),
      }),
      query: vi.fn().mockResolvedValue({ id: '1', name: 'John' }),
      mutate: vi.fn().mockResolvedValue({ id: '1', name: 'John Updated' }),
      invalidate: vi.fn(),
      getCacheStats: vi.fn().mockReturnValue({ entries: 0, size: 0, hits: 0, misses: 0, hitRate: 0 }),
    })),
  };
});

// Mock DI inject
vi.mock('../../../src/di/index.js', () => ({
  Injectable: () => (target: any) => target,
  inject: vi.fn().mockReturnValue({
    backend: vi.fn().mockReturnValue({
      queryFluentInterface: vi.fn().mockResolvedValue({}),
    }),
    query: vi.fn().mockResolvedValue({}),
    mutate: vi.fn().mockResolvedValue({}),
    invalidate: vi.fn(),
    getCacheStats: vi.fn().mockReturnValue({ entries: 0, size: 0, hits: 0, misses: 0, hitRate: 0 }),
  }),
}));

interface IUserService {
  getUsers(): Promise<Array<{ id: string; name: string }>>;
  getUser(id: string): Promise<{ id: string; name: string }>;
  updateUser(id: string, data: any): Promise<{ id: string; name: string }>;
  deleteUser(id: string): Promise<void>;
}

describe('NetronService', () => {
  @Injectable()
  @Backend('api')
  @Service('users@1.0.0')
  class UserService extends NetronService<IUserService> {}

  describe('constructor', () => {
    it('should initialize with NetronClient', () => {
      const service = new UserService();
      expect(service).toBeDefined();
      expect(service['netron']).toBeDefined();
    });

    it('should extract backend name from decorator', () => {
      const service = new UserService();
      expect(service['backendName']).toBe('api');
    });

    it('should extract service name from decorator', () => {
      const service = new UserService();
      expect(service['serviceName']).toBe('users@1.0.0');
    });

    it('should work without Backend decorator', () => {
      @Injectable()
      @Service('posts@1.0.0')
      class PostService extends NetronService<any> {}

      const service = new PostService();
      expect(service['backendName']).toBe('main');
      expect(service['serviceName']).toBe('posts@1.0.0');
    });

    it('should derive service name when no Service decorator', () => {
      @Injectable()
      @Backend('api')
      class CommentService extends NetronService<any> {}

      const service = new CommentService();
      expect(service['backendName']).toBe('api');
      expect(service['serviceName']).toBe('comment');
    });
  });

  describe('getService()', () => {
    it('should return service interface', async () => {
      const service = new UserService();
      const serviceInterface = await service.getService();

      expect(serviceInterface).toBeDefined();
    });

    it('should call backend() with correct backend name', async () => {
      const service = new UserService();
      const backendSpy = vi.spyOn(service['netron'], 'backend');

      await service.getService();
      expect(backendSpy).toHaveBeenCalledWith('api');
    });

    it('should call queryFluentInterface with service name', async () => {
      const service = new UserService();
      const peer = service['netron'].backend('api');
      const querySpy = vi.spyOn(peer, 'queryFluentInterface');

      await service.getService();
      expect(querySpy).toHaveBeenCalledWith('users@1.0.0');
    });
  });

  describe('query()', () => {
    it('should execute query method', async () => {
      const service = new UserService();
      const result = await service['query']('getUsers', []);

      expect(result).toBeDefined();
    });

    it('should pass method arguments', async () => {
      const service = new UserService();
      const querySpy = vi.spyOn(service['netron'], 'query');

      await service['query']('getUser', ['123']);

      expect(querySpy).toHaveBeenCalledWith(
        'users@1.0.0',
        'getUser',
        ['123'],
        undefined,
        'api'
      );
    });

    it('should accept query options', async () => {
      const service = new UserService();
      const querySpy = vi.spyOn(service['netron'], 'query');
      const options: QueryOptions = {
        cache: { maxAge: 60000 },
        retry: { attempts: 3 },
      };

      await service['query']('getUsers', [], options);

      expect(querySpy).toHaveBeenCalledWith(
        'users@1.0.0',
        'getUsers',
        [],
        options,
        'api'
      );
    });

    it('should return typed result', async () => {
      const service = new UserService();
      const result = await service['query']('getUsers', []);

      expect(result).toBeDefined();
    });
  });

  describe('mutate()', () => {
    it('should execute mutation method', async () => {
      const service = new UserService();
      const result = await service['mutate']('updateUser', ['123', { name: 'Updated' }]);

      expect(result).toBeDefined();
    });

    it('should pass method arguments', async () => {
      const service = new UserService();
      const mutateSpy = vi.spyOn(service['netron'], 'mutate');

      await service['mutate']('updateUser', ['123', { name: 'Updated' }]);

      expect(mutateSpy).toHaveBeenCalledWith(
        'users@1.0.0',
        'updateUser',
        ['123', { name: 'Updated' }],
        undefined,
        'api'
      );
    });

    it('should accept mutation options', async () => {
      const service = new UserService();
      const mutateSpy = vi.spyOn(service['netron'], 'mutate');
      const options: MutationOptions = {
        optimistic: () => ({ id: '123', name: 'Updated' }),
        invalidate: ['users'],
      };

      await service['mutate']('updateUser', ['123', { name: 'Updated' }], options);

      expect(mutateSpy).toHaveBeenCalledWith(
        'users@1.0.0',
        'updateUser',
        ['123', { name: 'Updated' }],
        options,
        'api'
      );
    });

    it('should return typed result', async () => {
      const service = new UserService();
      const result = await service['mutate']('updateUser', ['123', { name: 'Updated' }]);

      expect(result).toBeDefined();
    });
  });

  describe('invalidate()', () => {
    it('should invalidate cache by string pattern', () => {
      const service = new UserService();
      const invalidateSpy = vi.spyOn(service['netron'], 'invalidate');

      service['invalidate']('users');

      expect(invalidateSpy).toHaveBeenCalledWith('users', 'api');
    });

    it('should invalidate cache by regex pattern', () => {
      const service = new UserService();
      const invalidateSpy = vi.spyOn(service['netron'], 'invalidate');

      service['invalidate'](/user-.*/);

      expect(invalidateSpy).toHaveBeenCalledWith(/user-.*/, 'api');
    });

    it('should invalidate cache by tag array', () => {
      const service = new UserService();
      const invalidateSpy = vi.spyOn(service['netron'], 'invalidate');

      service['invalidate'](['users', 'user-list']);

      expect(invalidateSpy).toHaveBeenCalledWith(['users', 'user-list'], 'api');
    });
  });

  describe('getCacheStats()', () => {
    it('should return cache statistics', () => {
      const service = new UserService();
      const stats = service['getCacheStats']();

      expect(stats).toBeDefined();
      expect(stats).toHaveProperty('entries');
      expect(stats).toHaveProperty('size');
    });

    it('should call NetronClient getCacheStats', () => {
      const service = new UserService();
      const statsSpy = vi.spyOn(service['netron'], 'getCacheStats');

      service['getCacheStats']();

      expect(statsSpy).toHaveBeenCalled();
    });
  });

  describe('inheritance', () => {
    it('should support service inheritance', () => {
      @Injectable()
      @Backend('api')
      @Service('admin-users@1.0.0')
      class AdminUserService extends UserService {}

      const service = new AdminUserService();
      expect(service['backendName']).toBe('api');
      expect(service['serviceName']).toBe('admin-users@1.0.0');
    });

    it('should allow adding custom methods', async () => {
      @Injectable()
      @Backend('api')
      @Service('users@1.0.0')
      class ExtendedUserService extends NetronService<IUserService> {
        async getActiveUsers() {
          const users = await this.query('getUsers', []);
          return users;
        }
      }

      const service = new ExtendedUserService();
      const result = await service.getActiveUsers();
      expect(result).toBeDefined();
    });
  });

  describe('error handling', () => {
    it('should propagate query errors', async () => {
      const service = new UserService();
      vi.spyOn(service['netron'], 'query').mockRejectedValueOnce(new Error('Query failed'));

      await expect(service['query']('getUsers', [])).rejects.toThrow('Query failed');
    });

    it('should propagate mutation errors', async () => {
      const service = new UserService();
      vi.spyOn(service['netron'], 'mutate').mockRejectedValueOnce(new Error('Mutation failed'));

      await expect(service['mutate']('updateUser', ['123', {}])).rejects.toThrow('Mutation failed');
    });
  });

  describe('type safety', () => {
    it('should enforce correct method names at compile time', async () => {
      const service = new UserService();

      // These should type-check correctly
      await service['query']('getUsers', []);
      await service['query']('getUser', ['123']);

      // Note: TypeScript would prevent incorrect method names at compile time
    });

    it('should enforce correct argument types', async () => {
      const service = new UserService();

      // These should type-check correctly
      await service['query']('getUser', ['123']);
      await service['mutate']('updateUser', ['123', { name: 'John' }]);
    });
  });

  describe('edge cases', () => {
    it('should handle empty args array', async () => {
      const service = new UserService();
      const result = await service['query']('getUsers', []);
      expect(result).toBeDefined();
    });

    it('should handle multiple arguments', async () => {
      const service = new UserService();
      const result = await service['mutate']('updateUser', ['123', { name: 'John' }]);
      expect(result).toBeDefined();
    });

    it('should handle undefined options', async () => {
      const service = new UserService();
      const result = await service['query']('getUsers', [], undefined);
      expect(result).toBeDefined();
    });
  });
});
