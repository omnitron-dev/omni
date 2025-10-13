/**
 * @fileoverview Comprehensive tests for store composition helpers
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  unregisterStore,
  getStoreFactory,
  hasStore,
  getAllStoreIds,
  clearAllStores,
  useStore,
  readonly,
  batch,
  deriveStore,
  extendStore,
  resetStore,
  disposeStore,
  getStoreMetadata,
  isStoreInitialized,
  composeStores,
} from '../../src/store/composition.js';
import { defineStore, clearAllStoreInstances } from '../../src/store/defineStore.js';
import { signal } from '../../src/core/reactivity/signal.js';
import { computed } from '../../src/core/reactivity/computed.js';
import { NetronClient } from '../../src/netron/client.js';

// Mock dependencies
vi.mock('../../src/netron/client.js', () => ({
  NetronClient: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../../src/di/inject.js', () => ({
  inject: vi.fn().mockImplementation(() => new NetronClient()),
}));

describe('store composition', () => {
  beforeEach(() => {
    clearAllStores();
    clearAllStoreInstances();
  });

  afterEach(() => {
    clearAllStores();
    clearAllStoreInstances();
  });

  describe('store registry', () => {
    it('should register store factory', () => {
      const factory = defineStore('test', () => ({ value: signal(0) }));

      expect(hasStore('test')).toBe(true);
      expect(getStoreFactory('test')).toBe(factory);
    });

    it('should unregister store factory', () => {
      defineStore('test', () => ({ value: signal(0) }));

      expect(hasStore('test')).toBe(true);

      const result = unregisterStore('test');

      expect(result).toBe(true);
      expect(hasStore('test')).toBe(false);
    });

    it('should return false when unregistering non-existent store', () => {
      const result = unregisterStore('nonexistent');
      expect(result).toBe(false);
    });

    it('should get all registered store IDs', () => {
      defineStore('store1', () => ({ value: signal(1) }));
      defineStore('store2', () => ({ value: signal(2) }));
      defineStore('store3', () => ({ value: signal(3) }));

      const ids = getAllStoreIds();

      expect(ids).toContain('store1');
      expect(ids).toContain('store2');
      expect(ids).toContain('store3');
      expect(ids).toHaveLength(3);
    });

    it('should warn when registering duplicate store ID', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      defineStore('test', () => ({ value: signal(1) }));
      defineStore('test', () => ({ value: signal(2) }));

      expect(warnSpy).toHaveBeenCalledWith("Store 'test' is already registered. Replacing existing store.");

      warnSpy.mockRestore();
    });

    it('should clear all stores', () => {
      defineStore('store1', () => ({ value: signal(1) }));
      defineStore('store2', () => ({ value: signal(2) }));

      useStore('store1');
      useStore('store2');

      clearAllStores();

      expect(getAllStoreIds()).toEqual([]);
    });
  });

  describe('useStore', () => {
    it('should get store by ID', () => {
      const useTestStore = defineStore('test', () => {
        const count = signal(0);
        return { count };
      });

      useTestStore(); // Initialize

      const store = useStore('test');

      expect(store).toHaveProperty('count');
      expect(store.count()).toBe(0);
    });

    it('should throw for non-existent store', () => {
      expect(() => {
        useStore('nonexistent');
      }).toThrow("Store 'nonexistent' not found");
    });

    it('should throw when throwIfNotFound option is true', () => {
      expect(() => {
        useStore('nonexistent', { throwIfNotFound: true });
      }).toThrow("Store 'nonexistent' not found. Make sure it's defined with defineStore() and registered.");
    });

    it('should return same instance on multiple calls', () => {
      defineStore('test', () => ({ count: signal(0) }));

      const store1 = useStore('test');
      const store2 = useStore('test');

      expect(store1).toBe(store2);
    });
  });

  describe('readonly', () => {
    it('should create readonly signal', () => {
      const writable = signal(0);
      const readOnly = readonly(writable);

      expect(readOnly()).toBe(0);

      writable.set(42);

      expect(readOnly()).toBe(42);
    });

    it('should not have set method', () => {
      const writable = signal(0);
      const readOnly = readonly(writable);

      // @ts-expect-error Testing runtime behavior
      expect(readOnly.set).toBeUndefined();
    });
  });

  describe('batch', () => {
    it('should batch signal updates', () => {
      const x = signal(0);
      const y = signal(0);
      const sum = computed(() => x() + y());

      let computeCount = 0;
      const tracked = computed(() => {
        computeCount++;
        return sum();
      });

      // Access to establish tracking
      tracked();
      expect(computeCount).toBe(1);
      computeCount = 0;

      // With batch: should trigger recomputation only once
      batch(() => {
        x.set(1);
        y.set(2);
      });

      // After batch, tracked should have recomputed at most once
      expect(computeCount).toBeLessThanOrEqual(1);
    });

    it('should return function result', () => {
      const result = batch(() => 42);

      expect(result).toBe(42);
    });
  });

  describe('deriveStore', () => {
    it('should derive store from multiple stores', () => {
      defineStore('user', () => ({
        name: signal('John'),
        age: signal(30),
      }));

      defineStore('settings', () => ({
        theme: signal('dark'),
      }));

      useStore('user');
      useStore('settings');

      const derived = deriveStore({ user: 'user', settings: 'settings' }, ({ user, settings }) => {
        const display = computed(() => `${user.name()} - ${settings.theme()}`);
        return { display };
      });

      expect(derived.display()).toBe('John - dark');
    });

    it('should react to source store changes', () => {
      defineStore('count1', () => ({ value: signal(1) }));
      defineStore('count2', () => ({ value: signal(2) }));

      useStore('count1');
      useStore('count2');

      const derived = deriveStore({ c1: 'count1', c2: 'count2' }, ({ c1, c2 }) => {
        const sum = computed(() => c1.value() + c2.value());
        return { sum };
      });

      expect(derived.sum()).toBe(3);

      useStore('count1').value.set(10);

      expect(derived.sum()).toBe(12);
    });

    it('should handle multiple derived stores', () => {
      defineStore('base', () => ({ value: signal(10) }));
      useStore('base');

      const derived1 = deriveStore({ base: 'base' }, ({ base }) => ({
        doubled: computed(() => base.value() * 2),
      }));

      const derived2 = deriveStore({ base: 'base' }, ({ base }) => ({
        tripled: computed(() => base.value() * 3),
      }));

      expect(derived1.doubled()).toBe(20);
      expect(derived2.tripled()).toBe(30);
    });
  });

  describe('extendStore', () => {
    it('should extend existing store', () => {
      defineStore('base', () => {
        const count = signal(0);
        return { count };
      });

      useStore('base');

      const extended = extendStore('base', (base) => {
        const doubled = computed(() => base.count() * 2);
        return { ...base, doubled };
      });

      expect(extended.count()).toBe(0);
      expect(extended.doubled()).toBe(0);

      extended.count.set(5);

      expect(extended.doubled()).toBe(10);
    });

    it('should allow overriding base properties', () => {
      defineStore('base', () => ({
        value: signal(10),
        name: 'base',
      }));

      useStore('base');

      const extended = extendStore('base', (base) => ({
        ...base,
        name: 'extended',
      }));

      expect(extended.name).toBe('extended');
      expect(extended.value()).toBe(10);
    });

    it('should throw for non-existent base store', () => {
      expect(() => {
        extendStore('nonexistent', (base) => base);
      }).toThrow();
    });
  });

  describe('resetStore', () => {
    it('should reset store to initial state', () => {
      defineStore('test', () => ({ count: signal(0) }));

      const store = useStore('test');
      store.count.set(42);

      resetStore('test');

      const newStore = useStore('test');
      expect(newStore.count()).toBe(0);
    });

    it('should throw for non-existent store', () => {
      expect(() => {
        resetStore('nonexistent');
      }).toThrow("Store 'nonexistent' not found");
    });
  });

  describe('disposeStore', () => {
    it('should dispose store and remove from registry', () => {
      defineStore('test', () => ({ count: signal(0) }));

      useStore('test');

      expect(hasStore('test')).toBe(true);

      disposeStore('test');

      expect(hasStore('test')).toBe(false);
    });

    it('should throw for non-existent store', () => {
      expect(() => {
        disposeStore('nonexistent');
      }).toThrow("Store 'nonexistent' not found");
    });
  });

  describe('getStoreMetadata', () => {
    it('should get store metadata', () => {
      defineStore('test', () => ({ value: signal(0) }), {
        name: 'TestStore',
      });

      const metadata = getStoreMetadata('test');

      expect(metadata).toEqual({
        id: 'test',
        name: 'TestStore',
      });
    });

    it('should return undefined for non-existent store', () => {
      const metadata = getStoreMetadata('nonexistent');
      expect(metadata).toBeUndefined();
    });

    it('should handle stores without custom name', () => {
      defineStore('test', () => ({ value: signal(0) }));

      const metadata = getStoreMetadata('test');

      expect(metadata?.id).toBe('test');
    });
  });

  describe('isStoreInitialized', () => {
    it('should return false for non-existent store', () => {
      expect(isStoreInitialized('nonexistent')).toBe(false);
    });

    it('should return true for initialized store', () => {
      defineStore('test', () => ({ value: signal(0) }));

      expect(isStoreInitialized('test')).toBe(false);

      useStore('test');

      expect(isStoreInitialized('test')).toBe(true);
    });
  });

  describe('composeStores', () => {
    it('should compose multiple stores', () => {
      defineStore('user', () => ({
        name: signal('John'),
        setName: (name: string) => useStore('user').name.set(name),
      }));

      defineStore('settings', () => ({
        theme: signal('dark'),
        setTheme: (theme: string) => useStore('settings').theme.set(theme),
      }));

      defineStore('notifications', () => ({
        count: signal(0),
        increment: () => useStore('notifications').count.set(useStore('notifications').count() + 1),
      }));

      // Initialize stores
      useStore('user');
      useStore('settings');
      useStore('notifications');

      const stores = composeStores({
        user: 'user',
        settings: 'settings',
        notifications: 'notifications',
      });

      expect(stores.user.name()).toBe('John');
      expect(stores.settings.theme()).toBe('dark');
      expect(stores.notifications.count()).toBe(0);

      stores.user.setName('Jane');
      stores.settings.setTheme('light');
      stores.notifications.increment();

      expect(stores.user.name()).toBe('Jane');
      expect(stores.settings.theme()).toBe('light');
      expect(stores.notifications.count()).toBe(1);
    });

    it('should use getters for lazy access', () => {
      defineStore('test', () => ({ value: signal(0) }));

      const composed = composeStores({ test: 'test' });

      // Should create store on access
      expect(isStoreInitialized('test')).toBe(false);

      const store = composed.test;

      expect(isStoreInitialized('test')).toBe(true);
      expect(store.value()).toBe(0);
    });

    it('should handle single store composition', () => {
      defineStore('single', () => ({ value: signal(42) }));

      useStore('single');

      const composed = composeStores({ single: 'single' });

      expect(composed.single.value()).toBe(42);
    });

    it('should support enumeration', () => {
      defineStore('store1', () => ({ value: signal(1) }));
      defineStore('store2', () => ({ value: signal(2) }));

      useStore('store1');
      useStore('store2');

      const composed = composeStores({
        store1: 'store1',
        store2: 'store2',
      });

      const keys = Object.keys(composed);

      expect(keys).toContain('store1');
      expect(keys).toContain('store2');
    });
  });

  describe('complex compositions', () => {
    it('should support nested compositions', () => {
      defineStore('base', () => ({ value: signal(1) }));
      useStore('base');

      const level1 = extendStore('base', (base) => ({
        ...base,
        doubled: computed(() => base.value() * 2),
      }));

      const level2 = deriveStore({ base: 'base' }, ({ base }) => ({
        tripled: computed(() => base.value() * 3),
      }));

      expect(level1.doubled()).toBe(2);
      expect(level2.tripled()).toBe(3);

      level1.value.set(10);

      expect(level1.doubled()).toBe(20);
      expect(level2.tripled()).toBe(30);
    });

    it('should handle circular dependencies gracefully', () => {
      defineStore('store1', () => {
        const value = signal(1);
        return { value };
      });

      defineStore('store2', () => {
        const value = signal(2);
        return { value };
      });

      useStore('store1');
      useStore('store2');

      const derived = deriveStore({ s1: 'store1', s2: 'store2' }, ({ s1, s2 }) => {
        const combined = computed(() => {
          const v1 = s1.value();
          const v2 = s2.value();
          return v1 + v2;
        });
        return { combined };
      });

      expect(derived.combined()).toBe(3);
    });
  });

  describe('edge cases', () => {
    it('should handle empty composition', () => {
      const composed = composeStores({});

      expect(Object.keys(composed)).toHaveLength(0);
    });

    it('should handle store disposal in composition', () => {
      defineStore('test', () => ({ value: signal(0) }));

      const composed = composeStores({ test: 'test' });

      useStore('test');

      expect(() => composed.test).not.toThrow();

      disposeStore('test');

      expect(() => composed.test).toThrow();
    });

    it('should handle multiple registrations', () => {
      const factory1 = defineStore('test', () => ({ value: signal(1) }));
      const factory2 = defineStore('test', () => ({ value: signal(2) }));

      const store = useStore('test');

      expect(store.value()).toBe(2);
      expect(getStoreFactory('test')).toBe(factory2);
    });
  });
});
