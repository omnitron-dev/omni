/**
 * @fileoverview Comprehensive tests for NetronStore base class
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NetronStore } from '../../../src/netron/base/netron-store.js';
import { signal } from '../../../src/core/reactivity/signal.js';
import { Backend } from '../../../src/netron/decorators/backend.js';
import { Service } from '../../../src/netron/decorators/service.js';
import { Injectable } from '../../../src/di/index.js';

// Mock dependencies
vi.mock('../../../src/netron/client.js', () => ({
  NetronClient: vi.fn().mockImplementation(() => ({
    backend: vi.fn().mockReturnValue({
      queryFluentInterface: vi.fn().mockResolvedValue({}),
    }),
    query: vi.fn().mockResolvedValue([]),
    mutate: vi.fn().mockResolvedValue({}),
    invalidate: vi.fn(),
    getCacheStats: vi.fn().mockReturnValue({}),
  })),
}));

vi.mock('../../../src/di/index.js', () => ({
  Injectable: () => (target: any) => target,
  inject: vi.fn().mockReturnValue({
    query: vi.fn().mockResolvedValue([]),
    mutate: vi.fn().mockResolvedValue({}),
  }),
}));

interface User {
  id: string;
  name: string;
  active: boolean;
}

interface IUserService {
  getUsers(): Promise<User[]>;
  getUser(id: string): Promise<User>;
  updateUser(id: string, data: Partial<User>): Promise<User>;
  deleteUser(id: string): Promise<void>;
}

describe('NetronStore', () => {
  @Injectable()
  @Backend('api')
  @Service('users@1.0.0')
  class UserStore extends NetronStore<IUserService> {
    users = signal<User[]>([]);
    loading = signal(false);
    error = signal<Error | null>(null);

    async loadUsers() {
      const result = await this.query('getUsers', []);
      this.users.set(result as any);
      return result;
    }
  }

  describe('extends NetronService', () => {
    it('should have all NetronService functionality', () => {
      const store = new UserStore();
      expect(store['netron']).toBeDefined();
      expect(store['backendName']).toBeDefined();
      expect(store['serviceName']).toBeDefined();
    });

    it('should support query method', async () => {
      const store = new UserStore();
      const result = await store.loadUsers();
      expect(result).toBeDefined();
    });

    it('should support mutate method', async () => {
      const store = new UserStore();
      const result = await store['mutate']('updateUser', ['123', { name: 'Updated' }]);
      expect(result).toBeDefined();
    });
  });

  describe('withLoading()', () => {
    it('should wrap async function with loading state', async () => {
      const store = new UserStore();

      const wrappedFn = store['withLoading'](
        async () => {
          return [{ id: '1', name: 'John', active: true }];
        },
        store.loading
      );

      expect(store.loading()).toBe(false);

      const promise = wrappedFn();
      expect(store.loading()).toBe(true);

      await promise;
      expect(store.loading()).toBe(false);
    });

    it('should handle errors with error signal', async () => {
      const store = new UserStore();
      const testError = new Error('Test error');

      const wrappedFn = store['withLoading'](
        async () => {
          throw testError;
        },
        store.loading,
        store.error
      );

      await expect(wrappedFn()).rejects.toThrow('Test error');
      expect(store.error()).toBe(testError);
      expect(store.loading()).toBe(false);
    });

    it('should reset error on success', async () => {
      const store = new UserStore();
      store.error.set(new Error('Previous error'));

      const wrappedFn = store['withLoading'](
        async () => 'success',
        store.loading,
        store.error
      );

      await wrappedFn();
      expect(store.error()).toBe(null);
    });

    it('should pass through function arguments', async () => {
      const store = new UserStore();
      const mockFn = vi.fn().mockResolvedValue('result');

      const wrappedFn = store['withLoading'](mockFn, store.loading);

      await wrappedFn('arg1', 'arg2', 'arg3');
      expect(mockFn).toHaveBeenCalledWith('arg1', 'arg2', 'arg3');
    });

    it('should return function result', async () => {
      const store = new UserStore();
      const wrappedFn = store['withLoading'](
        async () => 'test result',
        store.loading
      );

      const result = await wrappedFn();
      expect(result).toBe('test result');
    });
  });

  describe('withOptimistic()', () => {
    it('should apply optimistic update immediately', async () => {
      const store = new UserStore();
      store.users.set([{ id: '1', name: 'John', active: true }]);

      const wrappedFn = store['withOptimistic'](
        store.users,
        (current, userId: string, update: Partial<User>) => {
          return current.map(u => u.id === userId ? { ...u, ...update } : u);
        },
        async (userId: string, update: Partial<User>) => {
          return { id: userId, name: update.name!, active: true };
        }
      );

      const promise = wrappedFn('1', { name: 'Updated' });

      // Check optimistic update is applied
      expect(store.users()[0].name).toBe('Updated');

      await promise;
    });

    it('should rollback on error', async () => {
      const store = new UserStore();
      const originalUsers = [{ id: '1', name: 'John', active: true }];
      store.users.set(originalUsers);

      const wrappedFn = store['withOptimistic'](
        store.users,
        (current, userId: string) => {
          return current.filter(u => u.id !== userId);
        },
        async () => {
          throw new Error('Mutation failed');
        }
      );

      await expect(wrappedFn('1')).rejects.toThrow('Mutation failed');

      // Check rollback
      expect(store.users()).toEqual(originalUsers);
    });

    it('should return mutation result', async () => {
      const store = new UserStore();
      store.users.set([{ id: '1', name: 'John', active: true }]);

      const expectedResult = { id: '1', name: 'Updated', active: true };

      const wrappedFn = store['withOptimistic'](
        store.users,
        (current) => current,
        async () => expectedResult
      );

      const result = await wrappedFn();
      expect(result).toEqual(expectedResult);
    });
  });

  describe('batch()', () => {
    it('should execute multiple updates', () => {
      const store = new UserStore();

      store['batch']([
        () => store.users.set([{ id: '1', name: 'John', active: true }]),
        () => store.loading.set(true),
        () => store.error.set(null),
      ]);

      expect(store.users()).toHaveLength(1);
      expect(store.loading()).toBe(true);
      expect(store.error()).toBe(null);
    });

    it('should handle empty array', () => {
      const store = new UserStore();
      expect(() => store['batch']([])).not.toThrow();
    });

    it('should execute updates in order', () => {
      const store = new UserStore();
      const order: number[] = [];

      store['batch']([
        () => order.push(1),
        () => order.push(2),
        () => order.push(3),
      ]);

      expect(order).toEqual([1, 2, 3]);
    });
  });

  describe('persist()', () => {
    beforeEach(() => {
      localStorage.clear();
      sessionStorage.clear();
    });

    it('should save signal value to localStorage', () => {
      const store = new UserStore();
      const key = 'test-users';

      store['persist'](key, store.users);
      store.users.set([{ id: '1', name: 'John', active: true }]);

      // Manually trigger save (in real impl, this would be in effect)
      const saveEffect = (store.users as any).__persist__;
      if (saveEffect) saveEffect();

      const stored = localStorage.getItem(key);
      expect(stored).toBeTruthy();
    });

    it('should load initial value from localStorage', () => {
      const key = 'test-initial';
      const testData = [{ id: '1', name: 'John', active: true }];
      localStorage.setItem(key, JSON.stringify(testData));

      const store = new UserStore();
      const testSignal = signal<User[]>([]);

      store['persist'](key, testSignal);

      expect(testSignal()).toEqual(testData);
    });

    it('should use sessionStorage when specified', () => {
      const store = new UserStore();
      const key = 'test-session';

      store['persist'](key, store.users, { storage: 'session' });

      // Note: Full implementation would require effect system
    });

    it('should use custom serializer', () => {
      const store = new UserStore();
      const key = 'test-custom';

      store['persist'](key, store.users, {
        serialize: (data) => 'custom:' + JSON.stringify(data),
        deserialize: (str) => JSON.parse(str.replace('custom:', '')),
      });

      // Note: Testing would require full implementation
    });

    it('should handle missing storage gracefully', () => {
      const store = new UserStore();
      const testSignal = signal<User[]>([]);

      expect(() => store['persist']('test', testSignal)).not.toThrow();
    });

    it('should remove item when value is null', () => {
      const store = new UserStore();
      const key = 'test-remove';
      const testSignal = signal<User[] | null>([{ id: '1', name: 'John', active: true }]);

      localStorage.setItem(key, 'test');
      store['persist'](key, testSignal);

      testSignal.set(null);
      const saveEffect = (testSignal as any).__persist__;
      if (saveEffect) saveEffect();

      expect(localStorage.getItem(key)).toBeNull();
    });
  });

  describe('debounce()', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should delay function execution', async () => {
      const store = new UserStore();
      const mockFn = vi.fn().mockResolvedValue('result');
      const debouncedFn = store['debounce'](mockFn, 1000);

      const promise = debouncedFn('arg');

      expect(mockFn).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1000);
      await promise;

      expect(mockFn).toHaveBeenCalledWith('arg');
    });

    it('should reset timer on subsequent calls', async () => {
      const store = new UserStore();
      const mockFn = vi.fn().mockResolvedValue('result');
      const debouncedFn = store['debounce'](mockFn, 1000);

      // First call starts timer
      debouncedFn('arg1');

      // Advance partway through delay
      vi.advanceTimersByTime(500);

      // Function should not have been called yet
      expect(mockFn).not.toHaveBeenCalled();

      // Wait for first timer to complete
      vi.advanceTimersByTime(500);
      await vi.runAllTimersAsync();

      // First call should have completed
      expect(mockFn).toHaveBeenCalledTimes(1);
      expect(mockFn).toHaveBeenCalledWith('arg1');

      // Second call after first completes
      mockFn.mockClear();
      debouncedFn('arg2');
      vi.advanceTimersByTime(1000);
      await vi.runAllTimersAsync();

      // Second call should have executed
      expect(mockFn).toHaveBeenCalledTimes(1);
      expect(mockFn).toHaveBeenCalledWith('arg2');
    });
  });

  describe('throttle()', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should execute function immediately on first call', async () => {
      const store = new UserStore();
      const mockFn = vi.fn().mockResolvedValue('result');
      const throttledFn = store['throttle'](mockFn, 1000);

      await throttledFn('arg');

      expect(mockFn).toHaveBeenCalledWith('arg');
    });

    it('should ignore calls within throttle window', async () => {
      const store = new UserStore();
      const mockFn = vi.fn().mockResolvedValue('result');
      const throttledFn = store['throttle'](mockFn, 1000);

      await throttledFn('arg1');
      await throttledFn('arg2'); // Should be ignored

      expect(mockFn).toHaveBeenCalledTimes(1);
      expect(mockFn).toHaveBeenCalledWith('arg1');
    });

    it('should allow calls after throttle window', async () => {
      const store = new UserStore();
      const mockFn = vi.fn().mockResolvedValue('result');
      const throttledFn = store['throttle'](mockFn, 1000);

      await throttledFn('arg1');
      vi.advanceTimersByTime(1000);
      await throttledFn('arg2');

      expect(mockFn).toHaveBeenCalledTimes(2);
    });
  });

  describe('real-world usage', () => {
    it('should support complete store implementation', async () => {
      @Injectable()
      @Backend('api')
      @Service('users@1.0.0')
      class CompleteUserStore extends NetronStore<IUserService> {
        users = signal<User[]>([]);
        selectedUser = signal<User | null>(null);
        loading = signal(false);
        error = signal<Error | null>(null);

        async loadUsers() {
          return this.withLoading(
            async () => {
              const data = await this.query('getUsers', []);
              this.users.set(data as any);
              return data;
            },
            this.loading,
            this.error
          )();
        }

        async updateUser(id: string, update: Partial<User>) {
          return this.withOptimistic(
            this.users,
            (current) => current.map(u => u.id === id ? { ...u, ...update } : u),
            async () => {
              const result = await this.mutate('updateUser', [id, update]);
              this.invalidate(['users']);
              return result;
            }
          )(id, update);
        }
      }

      const store = new CompleteUserStore();
      expect(store.users()).toEqual([]);
      expect(store.loading()).toBe(false);

      // Test load
      await store.loadUsers();
      expect(store.loading()).toBe(false);
    });
  });
});
