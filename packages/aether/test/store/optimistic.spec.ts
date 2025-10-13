/**
 * @fileoverview Comprehensive tests for optimistic updates
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { optimistic, optimisticSignal, optimisticArray } from '../../src/store/optimistic.js';
import { signal } from '../../src/core/reactivity/signal.js';

describe('optimistic', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('basic optimistic updates', () => {
    it('should apply optimistic update immediately', async () => {
      const state = signal(0);
      let applied = false;

      const mutation = optimistic(
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return 42;
        },
        {
          update: () => {
            applied = true;
            state.set(42);
          },
          rollback: (snapshot) => state.set(snapshot),
          snapshot: () => state.peek(),
        }
      );

      const promise = mutation();

      // Update should be applied immediately
      expect(applied).toBe(true);
      expect(state()).toBe(42);

      vi.advanceTimersByTime(100);
      await promise;
    });

    it('should keep optimistic update on success', async () => {
      const state = signal(0);

      const mutation = optimistic(
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return 42;
        },
        {
          update: () => state.set(42),
          rollback: (snapshot) => state.set(snapshot),
          snapshot: () => state.peek(),
        }
      );

      const promise = mutation();
      expect(state()).toBe(42);

      vi.advanceTimersByTime(100);
      await promise;

      // Should still be 42 after success
      expect(state()).toBe(42);
    });

    it('should rollback on error', async () => {
      const state = signal(0);

      const mutation = optimistic(
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 100));
          throw new Error('Test error');
        },
        {
          update: () => state.set(42),
          rollback: (snapshot) => state.set(snapshot),
          snapshot: () => state.peek(),
        }
      );

      const promise = mutation();
      expect(state()).toBe(42);

      vi.advanceTimersByTime(100);

      await expect(promise).rejects.toThrow('Test error');

      // Should rollback to 0
      expect(state()).toBe(0);
    });
  });

  describe('callbacks', () => {
    it('should call onSuccess callback', async () => {
      const onSuccess = vi.fn();

      const mutation = optimistic(
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return { data: 'test' };
        },
        {
          update: () => {},
          rollback: () => {},
          snapshot: () => 0,
          onSuccess,
        }
      );

      const promise = mutation();
      vi.advanceTimersByTime(100);
      await promise;

      expect(onSuccess).toHaveBeenCalledWith({ data: 'test' });
    });

    it('should call onError callback before rollback', async () => {
      const onError = vi.fn();
      const state = signal(0);

      const mutation = optimistic(
        async () => {
          throw new Error('Test error');
        },
        {
          update: () => state.set(42),
          rollback: (snapshot) => state.set(snapshot),
          snapshot: () => state.peek(),
          onError,
        }
      );

      await expect(mutation()).rejects.toThrow();

      expect(onError).toHaveBeenCalledWith(expect.any(Error), 0);
      expect(state()).toBe(0);
    });

    it('should call onConflict on successful mutation', async () => {
      const onConflict = vi.fn();
      const state = signal({ version: 1 });

      const mutation = optimistic(async () => ({ version: 2, data: 'server' }), {
        update: () => state.set({ version: 2 }),
        rollback: (snapshot) => state.set(snapshot),
        snapshot: () => state.peek(),
        onConflict,
      });

      await mutation();

      expect(onConflict).toHaveBeenCalledWith({ version: 1 }, { version: 2, data: 'server' });
    });

    it('should handle errors in callbacks gracefully', async () => {
      const mutation = optimistic(async () => ({ data: 'test' }), {
        update: () => {},
        rollback: () => {},
        snapshot: () => 0,
        onSuccess: () => {
          throw new Error('Callback error');
        },
      });

      // Should not throw even if callback throws
      await expect(mutation()).resolves.toEqual({ data: 'test' });
    });
  });

  describe('retry logic', () => {
    it('should retry on failure', async () => {
      let attempts = 0;

      const mutation = optimistic(
        async () => {
          attempts++;
          if (attempts < 3) {
            throw new Error('Retry');
          }
          return 'success';
        },
        {
          update: () => {},
          rollback: () => {},
          snapshot: () => 0,
          retry: {
            attempts: 3,
          },
        }
      );

      const promise = mutation();

      // Advance timers for retries with promise flushing
      await vi.advanceTimersByTimeAsync(1000);

      await promise;

      expect(attempts).toBe(3);
    });

    it('should use exponential backoff by default', async () => {
      let attempts = 0;
      const delays: number[] = [];

      const mutation = optimistic(
        async () => {
          attempts++;
          delays.push(Date.now());
          if (attempts < 3) {
            throw new Error('Retry');
          }
          return 'success';
        },
        {
          update: () => {},
          rollback: () => {},
          snapshot: () => 0,
          retry: {
            attempts: 3,
          },
        }
      );

      const promise = mutation();

      // Advance timers progressively with async to flush promises
      await vi.advanceTimersByTimeAsync(100); // First retry
      await vi.advanceTimersByTimeAsync(200); // Second retry

      await promise;

      expect(attempts).toBe(3);
    });

    it('should use custom delay function', async () => {
      let attempts = 0;
      const delayFn = vi.fn((attempt) => attempt * 500);

      const mutation = optimistic(
        async () => {
          attempts++;
          if (attempts < 3) {
            throw new Error('Retry');
          }
          return 'success';
        },
        {
          update: () => {},
          rollback: () => {},
          snapshot: () => 0,
          retry: {
            attempts: 3,
            delay: delayFn,
          },
        }
      );

      const promise = mutation();

      await vi.advanceTimersByTimeAsync(1500);
      await promise;

      expect(delayFn).toHaveBeenCalled();
      expect(attempts).toBe(3);
    });

    it('should rollback after all retries fail', async () => {
      const state = signal(0);
      let attempts = 0;

      const mutation = optimistic(
        async () => {
          attempts++;
          throw new Error('Always fails');
        },
        {
          update: () => state.set(42),
          rollback: (snapshot) => state.set(snapshot),
          snapshot: () => state.peek(),
          retry: {
            attempts: 3,
          },
        }
      );

      const promise = mutation();
      // Add a rejection handler immediately to prevent unhandled rejection warning
      promise.catch(() => {});

      expect(state()).toBe(42);

      // Advance timers and handle the rejection properly
      await vi.advanceTimersByTimeAsync(5000);

      // Expect the promise to reject
      await expect(promise).rejects.toThrow('Always fails');

      expect(attempts).toBe(3);
      expect(state()).toBe(0);
    });
  });

  describe('mutation state tracking', () => {
    it('should track isPending state', async () => {
      const mutation = optimistic(
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return 'done';
        },
        {
          update: () => {},
          rollback: () => {},
          snapshot: () => 0,
        }
      );

      expect(mutation.isPending()).toBe(false);

      const promise = mutation();
      expect(mutation.isPending()).toBe(true);

      vi.advanceTimersByTime(100);
      await promise;

      expect(mutation.isPending()).toBe(false);
    });

    it('should track error state', async () => {
      const mutation = optimistic(
        async () => {
          throw new Error('Test error');
        },
        {
          update: () => {},
          rollback: () => {},
          snapshot: () => 0,
        }
      );

      expect(mutation.getError()).toBeUndefined();

      await expect(mutation()).rejects.toThrow();

      expect(mutation.getError()).toBeInstanceOf(Error);
      expect(mutation.getError()?.message).toBe('Test error');
    });

    it('should clear error', async () => {
      const mutation = optimistic(
        async () => {
          throw new Error('Test error');
        },
        {
          update: () => {},
          rollback: () => {},
          snapshot: () => 0,
        }
      );

      await expect(mutation()).rejects.toThrow();
      expect(mutation.getError()).toBeDefined();

      mutation.clearError();
      expect(mutation.getError()).toBeUndefined();
    });

    it('should prevent concurrent mutations', async () => {
      const mutation = optimistic(
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return 'done';
        },
        {
          update: () => {},
          rollback: () => {},
          snapshot: () => 0,
        }
      );

      const promise1 = mutation();

      // Try to call again while pending
      await expect(mutation()).rejects.toThrow('Mutation already in progress');

      vi.advanceTimersByTime(100);
      await promise1;
    });
  });

  describe('optimisticSignal', () => {
    it('should create optimistic mutation for signal', async () => {
      const count = signal(0);

      const increment = optimisticSignal(
        count,
        async (amount: number) => {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return amount;
        },
        (current, amount) => current + amount
      );

      const promise = increment(5);
      expect(count()).toBe(5);

      vi.advanceTimersByTime(100);
      await promise;

      expect(count()).toBe(5);
    });

    it('should rollback signal on error', async () => {
      const count = signal(10);

      const increment = optimisticSignal(
        count,
        async (amount: number) => {
          throw new Error('Failed');
        },
        (current, amount) => current + amount
      );

      const promise = increment(5);
      expect(count()).toBe(15);

      await expect(promise).rejects.toThrow();
      expect(count()).toBe(10);
    });

    it('should support additional options', async () => {
      const count = signal(0);
      const onSuccess = vi.fn();

      const increment = optimisticSignal(
        count,
        async (amount: number) => amount,
        (current, amount) => current + amount,
        {
          onSuccess,
          retry: { attempts: 2 },
        }
      );

      await increment(5);
      expect(onSuccess).toHaveBeenCalled();
    });
  });

  describe('optimisticArray', () => {
    interface User {
      id: string;
      name: string;
    }

    describe('add operation', () => {
      it('should optimistically add item to array', async () => {
        const users = signal<User[]>([]);

        const addUser = optimisticArray(
          users,
          async (user: User) => {
            await new Promise((resolve) => setTimeout(resolve, 100));
            return user;
          },
          'add'
        );

        const promise = addUser({ id: '1', name: 'John' });
        expect(users()).toHaveLength(1);
        expect(users()[0].name).toBe('John');

        vi.advanceTimersByTime(100);
        await promise;

        expect(users()).toHaveLength(1);
      });

      it('should rollback add on error', async () => {
        const users = signal<User[]>([{ id: '0', name: 'Existing' }]);

        const addUser = optimisticArray(
          users,
          async (user: User) => {
            throw new Error('Failed');
          },
          'add'
        );

        const promise = addUser({ id: '1', name: 'John' });
        expect(users()).toHaveLength(2);

        await expect(promise).rejects.toThrow();
        expect(users()).toHaveLength(1);
        expect(users()[0].name).toBe('Existing');
      });
    });

    describe('update operation', () => {
      it('should optimistically update item in array', async () => {
        const users = signal<User[]>([
          { id: '1', name: 'John' },
          { id: '2', name: 'Jane' },
        ]);

        const updateUser = optimisticArray(
          users,
          async (id: string, data: Partial<User>) => {
            await new Promise((resolve) => setTimeout(resolve, 100));
            return { id, ...data };
          },
          'update'
        );

        const promise = updateUser('1', { name: 'Johnny' });
        expect(users()[0].name).toBe('Johnny');

        vi.advanceTimersByTime(100);
        await promise;

        expect(users()[0].name).toBe('Johnny');
      });

      it('should rollback update on error', async () => {
        const users = signal<User[]>([{ id: '1', name: 'John' }]);

        const updateUser = optimisticArray(
          users,
          async (id: string, data: Partial<User>) => {
            throw new Error('Failed');
          },
          'update'
        );

        const promise = updateUser('1', { name: 'Johnny' });
        expect(users()[0].name).toBe('Johnny');

        await expect(promise).rejects.toThrow();
        expect(users()[0].name).toBe('John');
      });

      it('should support custom ID field', async () => {
        interface Post {
          postId: string;
          title: string;
        }

        const posts = signal<Post[]>([{ postId: 'p1', title: 'First' }]);

        const updatePost = optimisticArray(posts, async (id: string, data: Partial<Post>) => data, 'update', {
          idField: 'postId',
        });

        await updatePost('p1', { title: 'Updated' });
        expect(posts()[0].title).toBe('Updated');
      });
    });

    describe('delete operation', () => {
      it('should optimistically delete item from array', async () => {
        const users = signal<User[]>([
          { id: '1', name: 'John' },
          { id: '2', name: 'Jane' },
        ]);

        const deleteUser = optimisticArray(
          users,
          async (id: string) => {
            await new Promise((resolve) => setTimeout(resolve, 100));
            return id;
          },
          'delete'
        );

        const promise = deleteUser('1');
        expect(users()).toHaveLength(1);
        expect(users()[0].id).toBe('2');

        vi.advanceTimersByTime(100);
        await promise;

        expect(users()).toHaveLength(1);
      });

      it('should rollback delete on error', async () => {
        const users = signal<User[]>([
          { id: '1', name: 'John' },
          { id: '2', name: 'Jane' },
        ]);

        const deleteUser = optimisticArray(
          users,
          async (id: string) => {
            throw new Error('Failed');
          },
          'delete'
        );

        const promise = deleteUser('1');
        expect(users()).toHaveLength(1);

        await expect(promise).rejects.toThrow();
        expect(users()).toHaveLength(2);
        expect(users()[0].id).toBe('1');
      });
    });
  });

  describe('edge cases', () => {
    it('should handle update function throwing error', async () => {
      const mutation = optimistic(async () => 'done', {
        update: () => {
          throw new Error('Update error');
        },
        rollback: () => {},
        snapshot: () => 0,
      });

      await expect(mutation()).rejects.toThrow('Update error');
    });

    it('should handle rollback function throwing error', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const mutation = optimistic(
        async () => {
          throw new Error('Mutation error');
        },
        {
          update: () => {},
          rollback: () => {
            throw new Error('Rollback error');
          },
          snapshot: () => 0,
        }
      );

      await expect(mutation()).rejects.toThrow('Mutation error');
      expect(consoleSpy).toHaveBeenCalledWith('Error rolling back optimistic update:', expect.any(Error));

      consoleSpy.mockRestore();
    });

    it('should handle null/undefined snapshots', async () => {
      const state = signal<any>(null);

      const mutation = optimistic(
        async () => {
          throw new Error('Failed');
        },
        {
          update: () => state.set({ data: 'test' }),
          rollback: (snapshot) => state.set(snapshot),
          snapshot: () => state.peek(),
        }
      );

      const promise = mutation();
      expect(state()).toEqual({ data: 'test' });

      await expect(promise).rejects.toThrow();
      expect(state()).toBe(null);
    });

    it('should handle complex state objects', async () => {
      const state = signal({
        users: [{ id: 1 }],
        meta: { count: 1, loading: false },
      });

      const mutation = optimistic(
        async () => {
          throw new Error('Failed');
        },
        {
          update: () => {
            state.set({
              users: [{ id: 1 }, { id: 2 }],
              meta: { count: 2, loading: true },
            });
          },
          rollback: (snapshot) => state.set(snapshot),
          snapshot: () => state.peek(),
        }
      );

      const original = state.peek();
      const promise = mutation();

      expect(state().users).toHaveLength(2);

      await expect(promise).rejects.toThrow();

      expect(state()).toEqual(original);
    });
  });
});
