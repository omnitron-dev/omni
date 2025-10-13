/**
 * @fileoverview Comprehensive tests for defineStore
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineStore, defineStoreTyped, defineComputedStore, clearAllStoreInstances, getActiveStoreIds, isStoreActive } from '../../src/store/defineStore.js';
import { signal } from '../../src/core/reactivity/signal.js';
import { computed } from '../../src/core/reactivity/computed.js';

// Mock NetronClient as a proper class
vi.mock('../../src/netron/client.js', () => {
  class MockNetronClient {
    config: any;
    query: any;
    mutate: any;
    backend: any;

    constructor(config?: any) {
      this.config = config;
      this.query = vi.fn().mockResolvedValue({ data: 'mocked' });
      this.mutate = vi.fn().mockResolvedValue({ success: true });
      this.backend = vi.fn().mockReturnValue({});
    }
  }

  return {
    NetronClient: MockNetronClient,
  };
});

// Mock inject to return a NetronClient
vi.mock('../../src/di/inject.js', () => {
  class MockNetronClient {
    config: any;
    query: any;
    mutate: any;
    backend: any;

    constructor(config?: any) {
      this.config = config;
      this.query = vi.fn().mockResolvedValue({ data: 'mocked' });
      this.mutate = vi.fn().mockResolvedValue({ success: true });
      this.backend = vi.fn().mockReturnValue({});
    }
  }

  return {
    inject: vi.fn().mockImplementation(() => new MockNetronClient()),
  };
});

describe('defineStore', () => {
  beforeEach(() => {
    clearAllStoreInstances();
  });

  afterEach(() => {
    clearAllStoreInstances();
  });

  describe('store creation', () => {
    it('should create a store with minimal configuration', () => {
      const useTestStore = defineStore('test', () => {
        const count = signal(0);
        return { count };
      });

      expect(useTestStore).toBeDefined();
      expect(useTestStore.id).toBe('test');
    });

    it('should create a store with custom name', () => {
      const useTestStore = defineStore('test', () => {
        const count = signal(0);
        return { count };
      }, { name: 'TestStore' });

      expect(useTestStore.name).toBe('TestStore');
    });

    it('should throw error for invalid store ID', () => {
      expect(() => {
        // @ts-expect-error Testing invalid input
        defineStore('', () => ({}));
      }).toThrow('Store ID must be a non-empty string');

      expect(() => {
        // @ts-expect-error Testing invalid input
        defineStore(null, () => ({}));
      }).toThrow('Store ID must be a non-empty string');
    });

    it('should throw error for invalid setup function', () => {
      expect(() => {
        // @ts-expect-error Testing invalid input
        defineStore('test', 'not a function');
      }).toThrow('Store setup must be a function');
    });

    it('should pass NetronClient to setup function', () => {
      const setupFn = vi.fn((netron) => {
        // Check that netron has the expected properties instead of using instanceof
        // since vitest mocks create different class instances
        expect(netron).toHaveProperty('query');
        expect(netron).toHaveProperty('mutate');
        expect(netron).toHaveProperty('backend');
        expect(typeof netron.query).toBe('function');
        expect(typeof netron.mutate).toBe('function');
        expect(typeof netron.backend).toBe('function');
        return {};
      });

      const useTestStore = defineStore('test', setupFn);
      useTestStore();

      expect(setupFn).toHaveBeenCalled();
    });
  });

  describe('singleton pattern', () => {
    it('should return same instance on multiple calls', () => {
      const useTestStore = defineStore('test', () => {
        const count = signal(0);
        return { count };
      });

      const instance1 = useTestStore();
      const instance2 = useTestStore();

      expect(instance1).toBe(instance2);
    });

    it('should only call setup function once', () => {
      const setupFn = vi.fn(() => {
        const count = signal(0);
        return { count };
      });

      const useTestStore = defineStore('test', setupFn);

      useTestStore();
      useTestStore();
      useTestStore();

      expect(setupFn).toHaveBeenCalledTimes(1);
    });

    it('should maintain state across multiple accesses', () => {
      const useTestStore = defineStore('test', () => {
        const count = signal(0);
        return { count };
      });

      const instance1 = useTestStore();
      instance1.count.set(42);

      const instance2 = useTestStore();
      expect(instance2.count()).toBe(42);
    });
  });

  describe('store reset', () => {
    it('should reset store to initial state', () => {
      const useTestStore = defineStore('test', () => {
        const count = signal(0);
        return { count };
      });

      const instance = useTestStore();
      instance.count.set(42);

      useTestStore.reset();

      const newInstance = useTestStore();
      expect(newInstance.count()).toBe(0);
    });

    it('should create new instance after reset', () => {
      const useTestStore = defineStore('test', () => {
        const count = signal(0);
        return { count };
      });

      const instance1 = useTestStore();
      useTestStore.reset();
      const instance2 = useTestStore();

      expect(instance1).not.toBe(instance2);
    });
  });

  describe('store disposal', () => {
    it('should dispose store and remove from registry', () => {
      const useTestStore = defineStore('test', () => {
        const count = signal(0);
        return { count };
      });

      useTestStore();
      expect(isStoreActive('test')).toBe(true);

      useTestStore.dispose();
      expect(isStoreActive('test')).toBe(false);
    });

    it('should handle multiple dispose calls gracefully', () => {
      const useTestStore = defineStore('test', () => {
        const count = signal(0);
        return { count };
      });

      useTestStore();
      useTestStore.dispose();

      expect(() => useTestStore.dispose()).not.toThrow();
    });
  });

  describe('reactive state', () => {
    it('should support signals in store', () => {
      const useTestStore = defineStore('test', () => {
        const count = signal(0);
        return { count };
      });

      const store = useTestStore();
      expect(store.count()).toBe(0);

      store.count.set(10);
      expect(store.count()).toBe(10);
    });

    it('should support computed values in store', () => {
      const useTestStore = defineStore('test', () => {
        const count = signal(0);
        const doubled = computed(() => count() * 2);
        return { count, doubled };
      });

      const store = useTestStore();
      expect(store.doubled()).toBe(0);

      store.count.set(5);
      expect(store.doubled()).toBe(10);
    });

    it('should support methods in store', () => {
      const useTestStore = defineStore('test', () => {
        const count = signal(0);
        const increment = () => count.set(count() + 1);
        const decrement = () => count.set(count() - 1);
        return { count, increment, decrement };
      });

      const store = useTestStore();
      store.increment();
      expect(store.count()).toBe(1);

      store.increment();
      store.increment();
      expect(store.count()).toBe(3);

      store.decrement();
      expect(store.count()).toBe(2);
    });
  });

  describe('async operations', () => {
    it('should support async methods', async () => {
      const useTestStore = defineStore('test', (netron) => {
        const data = signal<any>(null);
        const loading = signal(false);

        const fetchData = async () => {
          loading.set(true);
          const result = await netron.query('test', 'getData', []);
          data.set(result);
          loading.set(false);
        };

        return { data, loading, fetchData };
      });

      const store = useTestStore();
      await store.fetchData();

      expect(store.data()).toEqual({ data: 'mocked' });
      expect(store.loading()).toBe(false);
    });

    it('should handle async errors', async () => {
      const useTestStore = defineStore('test', (netron) => {
        const error = signal<Error | null>(null);

        const fetchData = async () => {
          try {
            throw new Error('Test error');
          } catch (err) {
            error.set(err as Error);
          }
        };

        return { error, fetchData };
      });

      const store = useTestStore();
      await store.fetchData();

      expect(store.error()).toBeInstanceOf(Error);
      expect(store.error()?.message).toBe('Test error');
    });
  });

  describe('defineStoreTyped', () => {
    it('should create typed store', () => {
      interface TestStoreState {
        count: ReturnType<typeof signal<number>>;
        increment: () => void;
      }

      const useTestStore = defineStoreTyped<TestStoreState>('test', () => {
        const count = signal(0);
        const increment = () => count.set(count() + 1);
        return { count, increment };
      });

      const store = useTestStore();
      expect(store.count()).toBe(0);
      store.increment();
      expect(store.count()).toBe(1);
    });
  });

  describe('defineComputedStore', () => {
    it('should create computed store from dependencies', () => {
      const useStore1 = defineStore('store1', () => {
        const value = signal(10);
        return { value };
      });

      const useStore2 = defineStore('store2', () => {
        const value = signal(20);
        return { value };
      });

      // Initialize dependencies
      useStore1();
      useStore2();

      const useComputedStore = defineComputedStore(
        'computed',
        ['store1', 'store2'],
        (netron, [store1, store2]) => {
          const sum = computed(() => store1.value() + store2.value());
          return { sum };
        }
      );

      const store = useComputedStore();
      expect(store.sum()).toBe(30);

      useStore1().value.set(15);
      expect(store.sum()).toBe(35);
    });

    it('should handle multiple dependencies', () => {
      const useA = defineStore('a', () => ({ value: signal(1) }));
      const useB = defineStore('b', () => ({ value: signal(2) }));
      const useC = defineStore('c', () => ({ value: signal(3) }));

      useA();
      useB();
      useC();

      const useSum = defineComputedStore(
        'sum',
        ['a', 'b', 'c'],
        (netron, [a, b, c]) => {
          const total = computed(() => a.value() + b.value() + c.value());
          return { total };
        }
      );

      const store = useSum();
      expect(store.total()).toBe(6);
    });
  });

  describe('store registry', () => {
    it('should track active stores', () => {
      const useStore1 = defineStore('store1', () => ({ value: signal(1) }));
      const useStore2 = defineStore('store2', () => ({ value: signal(2) }));

      expect(getActiveStoreIds()).toEqual([]);

      useStore1();
      expect(getActiveStoreIds()).toContain('store1');
      expect(isStoreActive('store1')).toBe(true);

      useStore2();
      expect(getActiveStoreIds()).toHaveLength(2);
      expect(isStoreActive('store2')).toBe(true);
    });

    it('should remove store from active list after dispose', () => {
      const useTestStore = defineStore('test', () => ({ value: signal(1) }));

      useTestStore();
      expect(isStoreActive('test')).toBe(true);

      useTestStore.dispose();
      expect(isStoreActive('test')).toBe(false);
    });

    it('should clear all stores', () => {
      const useStore1 = defineStore('store1', () => ({ value: signal(1) }));
      const useStore2 = defineStore('store2', () => ({ value: signal(2) }));

      useStore1();
      useStore2();

      expect(getActiveStoreIds()).toHaveLength(2);

      clearAllStoreInstances();

      expect(getActiveStoreIds()).toEqual([]);
    });
  });

  describe('edge cases', () => {
    it('should handle empty store state', () => {
      const useTestStore = defineStore('test', () => ({}));
      const store = useTestStore();
      expect(store).toEqual({});
    });

    it('should handle complex nested state', () => {
      const useTestStore = defineStore('test', () => {
        const user = signal({ name: 'John', age: 30 });
        const posts = signal([{ id: 1, title: 'Test' }]);
        const metadata = signal({ created: new Date(), version: 1 });

        return { user, posts, metadata };
      });

      const store = useTestStore();
      expect(store.user().name).toBe('John');
      expect(store.posts()).toHaveLength(1);
      expect(store.metadata().version).toBe(1);
    });

    it('should handle store with only methods', () => {
      const useTestStore = defineStore('test', () => {
        const log = vi.fn();
        const doSomething = () => log('done');
        return { doSomething };
      });

      const store = useTestStore();
      store.doSomething();
      // Store should work fine with only methods
      expect(store).toHaveProperty('doSomething');
    });

    it('should handle circular dependencies in computed', () => {
      const useTestStore = defineStore('test', () => {
        const a = signal(1);
        const b = signal(2);
        const sum = computed(() => a() + b());
        const product = computed(() => a() * b());
        const combined = computed(() => sum() + product());

        return { a, b, sum, product, combined };
      });

      const store = useTestStore();
      expect(store.combined()).toBe(5); // (1+2) + (1*2) = 5

      store.a.set(3);
      expect(store.combined()).toBe(11); // (3+2) + (3*2) = 11
    });
  });

  describe('netron integration', () => {
    it('should use NetronClient for backend calls', async () => {
      const useTestStore = defineStore('test', (netron) => {
        const data = signal(null);

        const load = async () => {
          const result = await netron.query('users', 'getAll', []);
          data.set(result);
        };

        return { data, load };
      });

      const store = useTestStore();
      await store.load();

      expect(store.data()).toEqual({ data: 'mocked' });
    });

    it('should handle netron mutations', async () => {
      const useTestStore = defineStore('test', (netron) => {
        const result = signal(null);

        const save = async (data: any) => {
          const response = await netron.mutate('users', 'update', [data]);
          result.set(response);
        };

        return { result, save };
      });

      const store = useTestStore();
      await store.save({ id: 1, name: 'Test' });

      expect(store.result()).toEqual({ success: true });
    });
  });

  describe('memory management', () => {
    it('should properly cleanup on dispose', () => {
      const cleanupFn = vi.fn();
      const useTestStore = defineStore('test', () => {
        const count = signal(0);
        // Simulated cleanup logic
        return { count, cleanup: cleanupFn };
      });

      useTestStore();
      useTestStore.dispose();

      // Store should be removed from memory
      expect(isStoreActive('test')).toBe(false);
    });

    it('should handle multiple stores independently', () => {
      const useStore1 = defineStore('store1', () => ({ value: signal(1) }));
      const useStore2 = defineStore('store2', () => ({ value: signal(2) }));

      const s1 = useStore1();
      const s2 = useStore2();

      s1.value.set(10);
      s2.value.set(20);

      expect(s1.value()).toBe(10);
      expect(s2.value()).toBe(20);

      useStore1.dispose();

      expect(isStoreActive('store1')).toBe(false);
      expect(isStoreActive('store2')).toBe(true);
      expect(s2.value()).toBe(20);
    });
  });
});
