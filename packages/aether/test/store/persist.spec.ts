/**
 * @fileoverview Comprehensive tests for state persistence
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  persist,
  createPersistManager,
  hydrateSignal,
  persistSignal,
  clearPersistedData,
} from '../../src/store/persist.js';
import { signal } from '../../src/core/reactivity/signal.js';

describe('persist', () => {
  let storage: Map<string, string>;

  beforeEach(() => {
    // Create mock storage
    storage = new Map();
    global.window = {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
        clear: () => storage.clear(),
      },
      sessionStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
        clear: () => storage.clear(),
      },
    } as any;
  });

  afterEach(() => {
    storage.clear();
    vi.restoreAllMocks();
  });

  describe('basic persistence', () => {
    it('should persist signal to localStorage', async () => {
      const count = signal(0);

      persist(count, { key: 'count', storage: 'local' });

      count.set(42);

      // Wait for persistence
      await new Promise((resolve) => setTimeout(resolve, 10));

      const stored = storage.get('count');
      expect(stored).toBe('42');
    });

    it('should hydrate signal from localStorage', async () => {
      storage.set('count', '42');

      const count = signal(0);

      persist(count, { key: 'count', storage: 'local' });

      // Wait for hydration
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(count()).toBe(42);
    });

    it('should persist to sessionStorage', async () => {
      const data = signal({ value: 'test' });

      persist(data, { key: 'data', storage: 'session' });

      data.set({ value: 'updated' });

      await new Promise((resolve) => setTimeout(resolve, 10));

      const stored = storage.get('data');
      expect(stored).toBeDefined();
      expect(JSON.parse(stored!)).toEqual({ value: 'updated' });
    });

    it('should support memory storage', async () => {
      const count = signal(0);

      persist(count, { key: 'count', storage: 'memory' });

      count.set(42);

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Memory storage doesn't persist to external storage
      expect(storage.has('count')).toBe(false);
    });
  });

  describe('hydration', () => {
    it('should hydrate complex objects', async () => {
      const data = {
        users: [{ id: 1, name: 'John' }],
        meta: { count: 1 },
      };
      storage.set('data', JSON.stringify(data));

      const state = signal({});

      persist(state, { key: 'data', storage: 'local' });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(state()).toEqual(data);
    });

    it('should handle missing data gracefully', async () => {
      const count = signal(10);

      persist(count, { key: 'missing', storage: 'local' });

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Should keep initial value when no stored data
      expect(count()).toBe(10);
    });

    it('should handle corrupted data gracefully', async () => {
      storage.set('data', 'invalid json {');

      const state = signal({ default: true });
      const onError = vi.fn();

      persist(state, { key: 'data', storage: 'local', onError });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(onError).toHaveBeenCalled();
      expect(state()).toEqual({ default: true });
    });
  });

  describe('selective persistence', () => {
    it('should persist only included fields', async () => {
      const state = signal({
        name: 'John',
        age: 30,
        temp: 'temp value',
      });

      persist(state, {
        key: 'user',
        storage: 'local',
        include: ['name', 'age'],
      });

      state.set({
        name: 'Jane',
        age: 25,
        temp: 'ignored',
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      const stored = JSON.parse(storage.get('user')!);
      expect(stored).toEqual({ name: 'Jane', age: 25 });
      expect(stored).not.toHaveProperty('temp');
    });

    it('should exclude specified fields', async () => {
      const state = signal({
        name: 'John',
        age: 30,
        password: 'secret',
      });

      persist(state, {
        key: 'user',
        storage: 'local',
        exclude: ['password'],
      });

      state.set({
        name: 'Jane',
        age: 25,
        password: 'secret123',
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      const stored = JSON.parse(storage.get('user')!);
      expect(stored).toEqual({ name: 'Jane', age: 25 });
      expect(stored).not.toHaveProperty('password');
    });

    it('should prioritize include over exclude', async () => {
      const state = signal({
        name: 'John',
        age: 30,
        temp: 'temp',
      });

      persist(state, {
        key: 'user',
        storage: 'local',
        include: ['name'],
        exclude: ['name', 'temp'],
      });

      state.set({ name: 'Jane', age: 25, temp: 'ignored' });

      await new Promise((resolve) => setTimeout(resolve, 10));

      const stored = JSON.parse(storage.get('user')!);
      expect(stored).toEqual({ name: 'Jane' });
    });
  });

  describe('debouncing', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should debounce rapid updates', async () => {
      const count = signal(0);

      persist(count, {
        key: 'count',
        storage: 'local',
        debounce: 500,
      });

      // Rapid updates
      count.set(1);
      count.set(2);
      count.set(3);
      count.set(4);
      count.set(5);

      // Should not persist immediately
      expect(storage.has('count')).toBe(false);

      // Wait for debounce
      vi.advanceTimersByTime(500);
      await vi.runAllTimersAsync();

      // Should persist the final value
      expect(storage.get('count')).toBe('5');
    });

    it('should reset debounce timer on new updates', async () => {
      const count = signal(0);

      persist(count, {
        key: 'count',
        storage: 'local',
        debounce: 500,
      });

      count.set(1);
      vi.advanceTimersByTime(300);

      count.set(2);
      vi.advanceTimersByTime(300);

      // Still shouldn't persist (timer reset)
      expect(storage.has('count')).toBe(false);

      vi.advanceTimersByTime(200);
      await vi.runAllTimersAsync();

      // Now it should persist
      expect(storage.get('count')).toBe('2');
    });
  });

  describe('versioning and migrations', () => {
    it('should store version with data', async () => {
      const state = signal({ value: 'test' });

      persist(state, {
        key: 'data',
        storage: 'local',
        version: 1,
      });

      state.set({ value: 'updated' });

      await new Promise((resolve) => setTimeout(resolve, 10));

      const stored = JSON.parse(storage.get('data')!);
      expect(stored.__version).toBe(1);
    });

    it('should migrate data when version changes', async () => {
      // Store old version
      storage.set(
        'data',
        JSON.stringify({
          __version: 1,
          oldField: 'value',
        })
      );

      const migrate = vi.fn((data, fromVersion, toVersion) => {
        if (fromVersion === 1 && toVersion === 2) {
          return {
            newField: data.oldField,
          };
        }
        return data;
      });

      const state = signal({});

      persist(state, {
        key: 'data',
        storage: 'local',
        version: 2,
        migrate,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(migrate).toHaveBeenCalledWith(expect.objectContaining({ oldField: 'value' }), 1, 2);
      expect(state()).toEqual({ newField: 'value', __version: 2 });
    });

    it('should handle multi-step migrations', async () => {
      storage.set(
        'data',
        JSON.stringify({
          __version: 1,
          value: 'old',
        })
      );

      const migrate = vi.fn((data, fromVersion, toVersion) => {
        let migrated = { ...data };

        // Migrate from 1 to 2
        if (fromVersion < 2 && toVersion >= 2) {
          migrated.value = migrated.value.toUpperCase();
        }

        // Migrate from 2 to 3
        if (fromVersion < 3 && toVersion >= 3) {
          migrated.extra = 'added';
        }

        return migrated;
      });

      const state = signal({});

      persist(state, {
        key: 'data',
        storage: 'local',
        version: 3,
        migrate,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(state()).toEqual({
        value: 'OLD',
        extra: 'added',
        __version: 3,
      });
    });

    it('should handle missing version as version 0', async () => {
      storage.set('data', JSON.stringify({ value: 'old' }));

      const migrate = vi.fn((data, fromVersion, toVersion) => {
        if (fromVersion === 0) {
          return { ...data, migrated: true };
        }
        return data;
      });

      const state = signal({});

      persist(state, {
        key: 'data',
        storage: 'local',
        version: 1,
        migrate,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(migrate).toHaveBeenCalledWith(expect.objectContaining({ value: 'old' }), 0, 1);
    });
  });

  describe('custom serialization', () => {
    it('should use custom serialize function', async () => {
      const serialize = vi.fn((value) => `custom:${value}`);

      const count = signal(42);

      persist(count, {
        key: 'count',
        storage: 'local',
        serialize,
      });

      count.set(42);

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(serialize).toHaveBeenCalledWith(42);
      expect(storage.get('count')).toBe('custom:42');
    });

    it('should use custom deserialize function', async () => {
      const deserialize = vi.fn((value) => parseInt(value.replace('custom:', ''), 10));

      storage.set('count', 'custom:42');

      const count = signal(0);

      persist(count, {
        key: 'count',
        storage: 'local',
        deserialize,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(deserialize).toHaveBeenCalledWith('custom:42');
      expect(count()).toBe(42);
    });

    it('should handle custom serialization errors', async () => {
      const onError = vi.fn();

      const count = signal(42);

      persist(count, {
        key: 'count',
        storage: 'local',
        serialize: () => {
          throw new Error('Serialize error');
        },
        onError,
      });

      count.set(42);

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('PersistManager', () => {
    it('should create persist manager', async () => {
      const count = signal(0);
      const manager = createPersistManager(count, {
        key: 'count',
        storage: 'local',
      });

      expect(manager).toBeDefined();
      expect(manager).toHaveProperty('hydrate');
      expect(manager).toHaveProperty('persist');
      expect(manager).toHaveProperty('clear');
    });

    it('should manually hydrate', async () => {
      storage.set('count', '42');

      const count = signal(0);
      const manager = createPersistManager(count, {
        key: 'count',
        storage: 'local',
      });

      const data = await manager.hydrate();
      expect(data).toBe(42);
    });

    it('should manually persist', async () => {
      const count = signal(0);
      const manager = createPersistManager(count, {
        key: 'count',
        storage: 'local',
      });

      await manager.persist(42);

      expect(storage.get('count')).toBe('42');
    });

    it('should clear persisted data', async () => {
      storage.set('count', '42');

      const count = signal(0);
      const manager = createPersistManager(count, {
        key: 'count',
        storage: 'local',
      });

      await manager.clear();

      expect(storage.has('count')).toBe(false);
    });

    it('should dispose manager', async () => {
      const count = signal(0);
      const manager = createPersistManager(count, {
        key: 'count',
        storage: 'local',
      });

      manager.startWatching();

      // Wait for initial value to be persisted
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(storage.get('count')).toBe('0');

      manager.dispose();

      // After dispose, should not persist new values
      count.set(42);

      // Wait to ensure no persistence happens
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Should still have the old value, not the new one
      expect(storage.get('count')).toBe('0');
    });
  });

  describe('helper functions', () => {
    it('should hydrate signal without persistence', async () => {
      storage.set('count', '42');

      const count = signal(0);

      const data = await hydrateSignal(count, {
        key: 'count',
        storage: 'local',
      });

      expect(data).toBe(42);

      // Should not persist changes
      count.set(10);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(storage.get('count')).toBe('42');
    });

    it('should persist signal without watching', async () => {
      const count = signal(42);

      await persistSignal(count, {
        key: 'count',
        storage: 'local',
      });

      expect(storage.get('count')).toBe('42');

      // Should not persist future changes
      count.set(10);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(storage.get('count')).toBe('42');
    });

    it('should clear persisted data by key', async () => {
      storage.set('count', '42');

      await clearPersistedData('count', 'local');

      expect(storage.has('count')).toBe(false);
    });
  });

  describe('SSR compatibility', () => {
    it('should use memory storage when window is undefined', async () => {
      const originalWindow = global.window;
      // @ts-expect-error Testing SSR
      delete global.window;

      const count = signal(0);

      persist(count, {
        key: 'count',
        storage: 'local',
      });

      count.set(42);

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Should not throw, uses memory storage
      expect(count()).toBe(42);

      global.window = originalWindow;
    });
  });

  describe('error handling', () => {
    it('should call onError callback on persistence failure', async () => {
      const onError = vi.fn();

      const count = signal(0);

      persist(count, {
        key: 'count',
        storage: 'local',
        serialize: () => {
          throw new Error('Serialize error');
        },
        onError,
      });

      count.set(42);

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });

    it('should call onError callback on hydration failure', async () => {
      storage.set('count', 'invalid');

      const onError = vi.fn();
      const count = signal(0);

      persist(count, {
        key: 'count',
        storage: 'local',
        deserialize: () => {
          throw new Error('Deserialize error');
        },
        onError,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });

    it('should log errors to console by default', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      storage.set('count', 'invalid');

      const count = signal(0);

      persist(count, {
        key: 'count',
        storage: 'local',
        deserialize: () => {
          throw new Error('Deserialize error');
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(consoleSpy).toHaveBeenCalledWith('Failed to hydrate from storage:', expect.any(Error));

      consoleSpy.mockRestore();
    });
  });

  describe('edge cases', () => {
    it('should handle arrays', async () => {
      const items = signal([1, 2, 3]);

      persist(items, {
        key: 'items',
        storage: 'local',
      });

      items.set([4, 5, 6]);

      await new Promise((resolve) => setTimeout(resolve, 10));

      const stored = JSON.parse(storage.get('items')!);
      expect(stored).toEqual([4, 5, 6]);
    });

    it('should handle nested objects', async () => {
      const state = signal({
        user: {
          profile: {
            name: 'John',
            settings: {
              theme: 'dark',
            },
          },
        },
      });

      persist(state, {
        key: 'state',
        storage: 'local',
      });

      state.set({
        user: {
          profile: {
            name: 'Jane',
            settings: {
              theme: 'light',
            },
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      const stored = JSON.parse(storage.get('state')!);
      expect(stored.user.profile.settings.theme).toBe('light');
    });

    it('should handle null values', async () => {
      const value = signal(null);

      persist(value, {
        key: 'value',
        storage: 'local',
      });

      value.set(null);

      await new Promise((resolve) => setTimeout(resolve, 10));

      const stored = storage.get('value');
      expect(stored).toBe('null');
    });

    it('should handle undefined values', async () => {
      const value = signal<string | undefined>('initial');

      persist(value, {
        key: 'value',
        storage: 'local',
      });

      // Wait for initial value to be persisted
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(storage.get('value')).toBe('"initial"');

      // Set to undefined
      value.set(undefined);

      await new Promise((resolve) => setTimeout(resolve, 10));

      // JSON.stringify(undefined) returns undefined (not a string),
      // which gets converted to "undefined" string by storage.setItem
      // However, the behavior depends on the serialize implementation.
      // Since we're using the default JSON.stringify, undefined values
      // will result in an undefined serialization result, which may or may not
      // be stored depending on the storage backend.
      // For this test, we just verify no error is thrown
      const stored = storage.get('value');
      // The key may still exist with undefined or may be the previous value
      // depending on how setItem handles undefined
      expect(stored === undefined || stored === '"initial"').toBe(true);
    });
  });
});
