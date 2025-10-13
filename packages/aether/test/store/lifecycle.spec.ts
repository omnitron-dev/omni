/**
 * @fileoverview Comprehensive tests for store lifecycle hooks
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  LifecycleManager,
  onStoreInit,
  onStoreDestroy,
  onStoreHydrate,
  runWithLifecycle,
  getCurrentLifecycle,
  setCurrentLifecycle,
} from '../../src/store/lifecycle.js';
import { defineStore, clearAllStoreInstances } from '../../src/store/defineStore.js';
import { signal } from '../../src/core/reactivity/signal.js';
import { NetronClient } from '../../src/netron/client.js';

// Mock dependencies
vi.mock('../../src/netron/client.js', () => ({
  NetronClient: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../../src/di/inject.js', () => ({
  inject: vi.fn().mockImplementation(() => new NetronClient()),
}));

describe('LifecycleManager', () => {
  let lifecycle: LifecycleManager;

  beforeEach(() => {
    lifecycle = new LifecycleManager();
  });

  describe('hook registration', () => {
    it('should register lifecycle hooks', () => {
      const handler = vi.fn();

      lifecycle.on('onStoreInit', handler);

      expect(lifecycle.has('onStoreInit')).toBe(true);
    });

    it('should return unregister function', () => {
      const handler = vi.fn();

      const unregister = lifecycle.on('onStoreInit', handler);

      expect(lifecycle.has('onStoreInit')).toBe(true);

      unregister();

      expect(lifecycle.has('onStoreInit')).toBe(false);
    });

    it('should support multiple handlers for same hook', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      lifecycle.on('onStoreInit', handler1);
      lifecycle.on('onStoreInit', handler2);

      expect(lifecycle.getHandlers('onStoreInit')).toHaveLength(2);
    });

    it('should throw for unknown hook', () => {
      expect(() => {
        // @ts-expect-error Testing invalid hook
        lifecycle.on('unknownHook', () => {});
      }).toThrow('Unknown lifecycle hook');
    });
  });

  describe('hook triggering', () => {
    it('should trigger hooks', async () => {
      const handler = vi.fn();

      lifecycle.on('onStoreInit', handler);

      await lifecycle.trigger('onStoreInit');

      expect(handler).toHaveBeenCalled();
    });

    it('should pass arguments to handlers', async () => {
      const handler = vi.fn();

      lifecycle.on('onStoreHydrate', handler);

      await lifecycle.trigger('onStoreHydrate', { data: 'test' });

      expect(handler).toHaveBeenCalledWith({ data: 'test' });
    });

    it('should trigger multiple handlers in order', async () => {
      const order: number[] = [];

      lifecycle.on('onStoreInit', () => order.push(1));
      lifecycle.on('onStoreInit', () => order.push(2));
      lifecycle.on('onStoreInit', () => order.push(3));

      await lifecycle.trigger('onStoreInit');

      expect(order).toEqual([1, 2, 3]);
    });

    it('should handle async handlers', async () => {
      const order: number[] = [];

      lifecycle.on('onStoreInit', async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        order.push(1);
      });

      lifecycle.on('onStoreInit', async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        order.push(2);
      });

      await lifecycle.trigger('onStoreInit');

      // Should wait for all handlers
      expect(order).toHaveLength(2);
    });

    it('should continue on handler error', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const handler1 = vi.fn(() => {
        throw new Error('Handler 1 error');
      });
      const handler2 = vi.fn();

      lifecycle.on('onStoreInit', handler1);
      lifecycle.on('onStoreInit', handler2);

      await lifecycle.trigger('onStoreInit');

      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should handle async handler errors', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const handler1 = vi.fn(async () => {
        throw new Error('Async error');
      });
      const handler2 = vi.fn();

      lifecycle.on('onStoreInit', handler1);
      lifecycle.on('onStoreInit', handler2);

      await lifecycle.trigger('onStoreInit');

      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('clearing handlers', () => {
    it('should clear specific hook handlers', () => {
      lifecycle.on('onStoreInit', vi.fn());
      lifecycle.on('onStoreInit', vi.fn());
      lifecycle.on('onStoreDestroy', vi.fn());

      lifecycle.clear('onStoreInit');

      expect(lifecycle.has('onStoreInit')).toBe(false);
      expect(lifecycle.has('onStoreDestroy')).toBe(true);
    });

    it('should clear all handlers', () => {
      lifecycle.on('onStoreInit', vi.fn());
      lifecycle.on('onStoreDestroy', vi.fn());
      lifecycle.on('onStoreHydrate', vi.fn());

      lifecycle.clear();

      expect(lifecycle.has('onStoreInit')).toBe(false);
      expect(lifecycle.has('onStoreDestroy')).toBe(false);
      expect(lifecycle.has('onStoreHydrate')).toBe(false);
    });
  });

  describe('has() method', () => {
    it('should return false for empty hooks', () => {
      expect(lifecycle.has('onStoreInit')).toBe(false);
    });

    it('should return true when hooks are registered', () => {
      lifecycle.on('onStoreInit', vi.fn());
      expect(lifecycle.has('onStoreInit')).toBe(true);
    });
  });

  describe('getHandlers() method', () => {
    it('should return empty array for no handlers', () => {
      expect(lifecycle.getHandlers('onStoreInit')).toEqual([]);
    });

    it('should return all registered handlers', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      lifecycle.on('onStoreInit', handler1);
      lifecycle.on('onStoreInit', handler2);

      const handlers = lifecycle.getHandlers('onStoreInit');
      expect(handlers).toHaveLength(2);
      expect(handlers).toContain(handler1);
      expect(handlers).toContain(handler2);
    });
  });
});

describe('lifecycle context', () => {
  beforeEach(() => {
    setCurrentLifecycle(null);
  });

  afterEach(() => {
    setCurrentLifecycle(null);
  });

  it('should get current lifecycle', () => {
    const lifecycle = new LifecycleManager();
    setCurrentLifecycle(lifecycle);

    expect(getCurrentLifecycle()).toBe(lifecycle);
  });

  it('should set lifecycle context', () => {
    const lifecycle = new LifecycleManager();
    setCurrentLifecycle(lifecycle);

    expect(getCurrentLifecycle()).toBe(lifecycle);

    setCurrentLifecycle(null);

    expect(getCurrentLifecycle()).toBeNull();
  });

  it('should run with lifecycle context', () => {
    const lifecycle = new LifecycleManager();
    let captured: LifecycleManager | null = null;

    runWithLifecycle(lifecycle, () => {
      captured = getCurrentLifecycle();
    });

    expect(captured).toBe(lifecycle);
    expect(getCurrentLifecycle()).toBeNull();
  });

  it('should restore previous lifecycle context', () => {
    const lifecycle1 = new LifecycleManager();
    const lifecycle2 = new LifecycleManager();

    setCurrentLifecycle(lifecycle1);

    runWithLifecycle(lifecycle2, () => {
      expect(getCurrentLifecycle()).toBe(lifecycle2);
    });

    expect(getCurrentLifecycle()).toBe(lifecycle1);
  });

  it('should return function result', () => {
    const lifecycle = new LifecycleManager();

    const result = runWithLifecycle(lifecycle, () => 42);

    expect(result).toBe(42);
  });
});

describe('lifecycle hooks', () => {
  let lifecycle: LifecycleManager;

  beforeEach(() => {
    lifecycle = new LifecycleManager();
    setCurrentLifecycle(lifecycle);
  });

  afterEach(() => {
    setCurrentLifecycle(null);
  });

  describe('onStoreInit', () => {
    it('should register init hook', () => {
      const handler = vi.fn();

      onStoreInit(handler);

      expect(lifecycle.has('onStoreInit')).toBe(true);
    });

    it('should throw when not in lifecycle context', () => {
      setCurrentLifecycle(null);

      expect(() => {
        onStoreInit(() => {});
      }).toThrow('onStoreInit must be called during store setup');
    });

    it('should return unregister function', () => {
      const handler = vi.fn();

      const unregister = onStoreInit(handler);

      expect(lifecycle.has('onStoreInit')).toBe(true);

      unregister();

      expect(lifecycle.has('onStoreInit')).toBe(false);
    });
  });

  describe('onStoreDestroy', () => {
    it('should register destroy hook', () => {
      const handler = vi.fn();

      onStoreDestroy(handler);

      expect(lifecycle.has('onStoreDestroy')).toBe(true);
    });

    it('should throw when not in lifecycle context', () => {
      setCurrentLifecycle(null);

      expect(() => {
        onStoreDestroy(() => {});
      }).toThrow('onStoreDestroy must be called during store setup');
    });
  });

  describe('onStoreHydrate', () => {
    it('should register hydrate hook', () => {
      const handler = vi.fn();

      onStoreHydrate(handler);

      expect(lifecycle.has('onStoreHydrate')).toBe(true);
    });

    it('should throw when not in lifecycle context', () => {
      setCurrentLifecycle(null);

      expect(() => {
        onStoreHydrate(() => {});
      }).toThrow('onStoreHydrate must be called during store setup');
    });
  });
});

describe('store lifecycle integration', () => {
  beforeEach(() => {
    clearAllStoreInstances();
  });

  afterEach(() => {
    clearAllStoreInstances();
  });

  it('should trigger onStoreInit when store is created', async () => {
    const initHandler = vi.fn();

    const useTestStore = defineStore('test', () => {
      onStoreInit(initHandler);
      return { value: signal(0) };
    });

    useTestStore();

    // Wait for async init
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(initHandler).toHaveBeenCalled();
  });

  it('should trigger onStoreDestroy when store is disposed', async () => {
    const destroyHandler = vi.fn();

    const useTestStore = defineStore('test', () => {
      onStoreDestroy(destroyHandler);
      return { value: signal(0) };
    });

    useTestStore();
    useTestStore.dispose();

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(destroyHandler).toHaveBeenCalled();
  });

  it('should support async init handlers', async () => {
    let initialized = false;

    const useTestStore = defineStore('test', () => {
      onStoreInit(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        initialized = true;
      });

      return { value: signal(0) };
    });

    useTestStore();

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(initialized).toBe(true);
  });

  it('should support async destroy handlers', async () => {
    let destroyed = false;

    const useTestStore = defineStore('test', () => {
      onStoreDestroy(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        destroyed = true;
      });

      return { value: signal(0) };
    });

    useTestStore();
    useTestStore.dispose();

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(destroyed).toBe(true);
  });

  it('should handle multiple lifecycle hooks', async () => {
    const initOrder: number[] = [];
    const destroyOrder: number[] = [];

    const useTestStore = defineStore('test', () => {
      onStoreInit(() => initOrder.push(1));
      onStoreInit(() => initOrder.push(2));

      onStoreDestroy(() => destroyOrder.push(1));
      onStoreDestroy(() => destroyOrder.push(2));

      return { value: signal(0) };
    });

    useTestStore();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(initOrder).toEqual([1, 2]);

    useTestStore.dispose();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(destroyOrder).toEqual([1, 2]);
  });

  it('should cleanup subscriptions on destroy', async () => {
    const cleanup = vi.fn();

    const useTestStore = defineStore('test', () => {
      onStoreDestroy(cleanup);
      return { value: signal(0) };
    });

    useTestStore();
    useTestStore.dispose();

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(cleanup).toHaveBeenCalled();
  });

  it('should handle errors in init hooks', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const handler2 = vi.fn();

    const useTestStore = defineStore('test', () => {
      onStoreInit(() => {
        throw new Error('Init error');
      });
      onStoreInit(handler2);

      return { value: signal(0) };
    });

    useTestStore();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Should not prevent store creation
    expect(consoleSpy).toHaveBeenCalled();
    expect(handler2).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('should handle errors in destroy hooks', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const handler2 = vi.fn();

    const useTestStore = defineStore('test', () => {
      onStoreDestroy(() => {
        throw new Error('Destroy error');
      });
      onStoreDestroy(handler2);

      return { value: signal(0) };
    });

    useTestStore();
    useTestStore.dispose();

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(consoleSpy).toHaveBeenCalled();
    expect(handler2).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('should support data loading in init hook', async () => {
    const useTestStore = defineStore('test', () => {
      const data = signal<any>(null);
      const loading = signal(true);

      onStoreInit(async () => {
        // Simulate data loading
        await new Promise((resolve) => setTimeout(resolve, 10));
        data.set({ loaded: true });
        loading.set(false);
      });

      return { data, loading };
    });

    const store = useTestStore();

    expect(store.loading()).toBe(true);
    expect(store.data()).toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(store.loading()).toBe(false);
    expect(store.data()).toEqual({ loaded: true });
  });
});
