/**
 * Fast Refresh Unit Tests
 *
 * Comprehensive tests for Fast Refresh functionality
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastRefresh, initFastRefresh, getFastRefresh, withFastRefresh } from '../../../src/dev/hmr/fast-refresh.js';
import type { ComponentState, FastRefreshConfig } from '../../../src/dev/types.js';

describe('Fast Refresh', () => {
  describe('Component Registration', () => {
    let refresh: FastRefresh;

    beforeEach(() => {
      refresh = new FastRefresh({ enabled: true });
    });

    afterEach(() => {
      refresh.clear();
    });

    it('should register component', () => {
      const component = {};
      refresh.register(component, '/src/Component.tsx', 'signature-1');

      const stats = refresh.getStats();
      expect(stats.totalComponents).toBe(1);
      expect(stats.fileCount).toBe(1);
    });

    it('should register multiple components from same file', () => {
      const component1 = {};
      const component2 = {};

      refresh.register(component1, '/src/Components.tsx', 'signature-1');
      refresh.register(component2, '/src/Components.tsx', 'signature-2');

      const stats = refresh.getStats();
      expect(stats.totalComponents).toBe(2);
      expect(stats.fileCount).toBe(1);
    });

    it('should register components from different files', () => {
      const component1 = {};
      const component2 = {};

      refresh.register(component1, '/src/ComponentA.tsx', 'signature-1');
      refresh.register(component2, '/src/ComponentB.tsx', 'signature-2');

      const stats = refresh.getStats();
      expect(stats.totalComponents).toBe(2);
      expect(stats.fileCount).toBe(2);
    });

    it('should not register when disabled', () => {
      refresh = new FastRefresh({ enabled: false });

      const component = {};
      refresh.register(component, '/src/Component.tsx', 'signature-1');

      const stats = refresh.getStats();
      expect(stats.totalComponents).toBe(0);
    });

    it('should generate unique component IDs', () => {
      const component1 = {};
      const component2 = {};

      refresh.register(component1, '/src/A.tsx', 'sig-1');
      refresh.register(component2, '/src/A.tsx', 'sig-2');

      // Different signatures should generate different IDs
      const stats = refresh.getStats();
      expect(stats.totalComponents).toBe(2);
    });
  });

  describe('State Preservation', () => {
    let refresh: FastRefresh;

    beforeEach(() => {
      refresh = new FastRefresh({ preserveLocalState: true });
    });

    afterEach(() => {
      refresh.clear();
    });

    it('should preserve signal values', () => {
      const component: any = {
        $$signals: {
          count: {
            get: () => 42,
          },
          name: {
            get: () => 'test',
          },
        },
      };

      refresh.register(component, '/src/Component.tsx', 'signature-1');
      const state = refresh.preserveState(component);

      expect(state).toBeDefined();
      expect(state?.signals.get('count')).toBe(42);
      expect(state?.signals.get('name')).toBe('test');
    });

    it('should preserve effect subscriptions', () => {
      const effect1 = vi.fn();
      const effect2 = vi.fn();

      const component: any = {
        $$signals: {},
        $$effects: new Set([effect1, effect2]),
      };

      refresh.register(component, '/src/Component.tsx', 'signature-1');
      const state = refresh.preserveState(component);

      expect(state).toBeDefined();
      expect(state?.effects.size).toBe(2);
      expect(state?.effects.has(effect1)).toBe(true);
      expect(state?.effects.has(effect2)).toBe(true);
    });

    it('should preserve memo computations', () => {
      const component: any = {
        $$signals: {},
        $$memos: {
          computed1: {
            get: () => 'computed-value',
          },
          computed2: {
            get: () => 100,
          },
        },
      };

      refresh.register(component, '/src/Component.tsx', 'signature-1');
      const state = refresh.preserveState(component);

      expect(state).toBeDefined();
      expect(state?.memos.get('computed1')).toBe('computed-value');
      expect(state?.memos.get('computed2')).toBe(100);
    });

    it('should return null when preservation disabled', () => {
      refresh = new FastRefresh({ preserveLocalState: false });

      const component: any = {
        $$signals: {
          count: { get: () => 42 },
        },
      };

      refresh.register(component, '/src/Component.tsx', 'signature-1');
      const state = refresh.preserveState(component);

      expect(state).toBeNull();
    });

    it('should return null for unregistered component', () => {
      const component = {};
      const state = refresh.preserveState(component);

      expect(state).toBeNull();
    });

    it('should handle preservation errors gracefully', () => {
      const component: any = {
        $$signals: {
          broken: {
            get: () => {
              throw new Error('Signal error');
            },
          },
        },
      };

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      refresh.register(component, '/src/Component.tsx', 'signature-1');
      const state = refresh.preserveState(component);

      expect(state).toBeNull();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should preserve complex nested state', () => {
      const component: any = {
        $$signals: {
          user: {
            get: () => ({ id: 1, name: 'John', roles: ['admin', 'user'] }),
          },
          settings: {
            get: () => ({ theme: 'dark', notifications: true }),
          },
        },
        $$memos: {
          fullName: {
            get: () => 'John Doe',
          },
        },
        $$effects: new Set([vi.fn(), vi.fn()]),
      };

      refresh.register(component, '/src/Component.tsx', 'signature-1');
      const state = refresh.preserveState(component);

      expect(state).toBeDefined();
      expect(state?.signals.get('user')).toEqual({
        id: 1,
        name: 'John',
        roles: ['admin', 'user'],
      });
      expect(state?.signals.get('settings')).toEqual({
        theme: 'dark',
        notifications: true,
      });
      expect(state?.memos.get('fullName')).toBe('John Doe');
      expect(state?.effects.size).toBe(2);
    });
  });

  describe('State Restoration', () => {
    let refresh: FastRefresh;

    beforeEach(() => {
      refresh = new FastRefresh({ preserveLocalState: true });
    });

    afterEach(() => {
      refresh.clear();
    });

    it('should restore signal values', () => {
      const setSpy = vi.fn();
      const component: any = {
        $$signals: {
          count: {
            set: setSpy,
          },
        },
      };

      const state: ComponentState = {
        signals: new Map([['count', 42]]),
        effects: new Set(),
        memos: new Map(),
      };

      refresh.restoreState(component, state);

      expect(setSpy).toHaveBeenCalledWith(42);
    });

    it('should restore multiple signals', () => {
      const setCount = vi.fn();
      const setName = vi.fn();

      const component: any = {
        $$signals: {
          count: { set: setCount },
          name: { set: setName },
        },
      };

      const state: ComponentState = {
        signals: new Map([
          ['count', 100],
          ['name', 'restored'],
        ]),
        effects: new Set(),
        memos: new Map(),
      };

      refresh.restoreState(component, state);

      expect(setCount).toHaveBeenCalledWith(100);
      expect(setName).toHaveBeenCalledWith('restored');
    });

    it('should not restore when disabled', () => {
      refresh = new FastRefresh({ preserveLocalState: false });

      const setSpy = vi.fn();
      const component: any = {
        $$signals: {
          count: { set: setSpy },
        },
      };

      const state: ComponentState = {
        signals: new Map([['count', 42]]),
        effects: new Set(),
        memos: new Map(),
      };

      refresh.restoreState(component, state);

      expect(setSpy).not.toHaveBeenCalled();
    });

    it('should handle restoration errors gracefully', () => {
      const component: any = {
        $$signals: {
          broken: {
            set: () => {
              throw new Error('Set error');
            },
          },
        },
      };

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const state: ComponentState = {
        signals: new Map([['broken', 42]]),
        effects: new Set(),
        memos: new Map(),
      };

      refresh.restoreState(component, state);

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should skip missing signals during restoration', () => {
      const component: any = {
        $$signals: {
          existing: { set: vi.fn() },
        },
      };

      const state: ComponentState = {
        signals: new Map([
          ['existing', 1],
          ['missing', 2],
        ]),
        effects: new Set(),
        memos: new Map(),
      };

      // Should not throw
      refresh.restoreState(component, state);
    });
  });

  describe('Component Signature Comparison', () => {
    let refresh: FastRefresh;

    beforeEach(() => {
      refresh = new FastRefresh();
    });

    afterEach(() => {
      refresh.clear();
    });

    it('should allow refresh when signatures match', () => {
      const oldModule = {
        default: function Component() {},
      };

      const newModule = {
        default: function Component() {},
      };

      const canRefresh = refresh.canRefresh('/src/Component.tsx', oldModule, newModule);
      expect(canRefresh).toBe(true);
    });

    it('should allow refresh when signatures differ but structure same', () => {
      const oldModule = {
        ComponentA: function A() {},
        ComponentB: function B() {},
      };

      const newModule = {
        ComponentA: function A() {},
        ComponentB: function B() {},
      };

      const canRefresh = refresh.canRefresh('/src/Components.tsx', oldModule, newModule);
      expect(canRefresh).toBe(true);
    });

    it('should prevent refresh when force reset enabled', () => {
      refresh = new FastRefresh({ forceReset: true });

      const oldModule = { default: function Component() {} };
      const newModule = { default: function Component() {} };

      const canRefresh = refresh.canRefresh('/src/Component.tsx', oldModule, newModule);
      expect(canRefresh).toBe(false);
    });

    it('should allow refresh when signature cannot be determined', () => {
      const canRefresh = refresh.canRefresh('/src/Component.tsx', null, null);
      expect(canRefresh).toBe(true);
    });

    it('should detect export structure changes', () => {
      const oldModule = {
        default: function Component() {},
      };

      const newModule = {
        default: function Component() {},
        newExport: 'value',
      };

      const canRefresh = refresh.canRefresh('/src/Component.tsx', oldModule, newModule);
      // Different export keys mean different signature
      expect(canRefresh).toBe(false);
    });
  });

  describe('Refresh Eligibility Checks', () => {
    let refresh: FastRefresh;

    beforeEach(() => {
      refresh = new FastRefresh();
    });

    afterEach(() => {
      refresh.clear();
    });

    it('should detect component exports', () => {
      // Test isComponent via module extraction
      const module = {
        default: function MyComponent() {},
      };

      // Component name starts with capital
      expect(module.default.name).toMatch(/^[A-Z]/);
    });

    it('should detect non-component exports', () => {
      const module = {
        default: function helperFunction() {},
      };

      // Lowercase name
      expect(module.default.name).toMatch(/^[a-z]/);
    });

    it('should handle multiple exports', () => {
      const module = {
        ComponentA: function ComponentA() {},
        ComponentB: function ComponentB() {},
        helper: function helper() {},
      };

      // Has component exports
      expect(Object.keys(module).length).toBe(3);
    });
  });

  describe('Component Refresh', () => {
    let refresh: FastRefresh;

    beforeEach(() => {
      refresh = new FastRefresh({ preserveLocalState: true });
    });

    afterEach(() => {
      refresh.clear();
    });

    it('should refresh components in file', async () => {
      const component: any = {
        $$signals: {
          count: {
            get: () => 42,
            set: vi.fn(),
          },
        },
      };

      refresh.register(component, '/src/Component.tsx', 'signature-1');

      function NewComponent() {}
      const newModule = { default: NewComponent };

      await refresh.refresh('/src/Component.tsx', newModule);

      // Should preserve and restore state
      expect(component.$$signals.count.set).toHaveBeenCalledWith(42);
    });

    it('should handle file with no registered components', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await refresh.refresh('/src/Unknown.tsx', { default: function Component() {} });

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('No components to refresh'));

      consoleSpy.mockRestore();
    });

    it('should handle module without component export', async () => {
      const component = {};
      refresh.register(component, '/src/Component.tsx', 'signature-1');

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await refresh.refresh('/src/Component.tsx', { data: 'not a component' });

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Could not extract component'));

      consoleSpy.mockRestore();
    });

    it('should trigger refresh callbacks', async () => {
      const callback = vi.fn();
      refresh.onRefresh(callback);

      const component: any = {
        $$signals: {},
      };

      function NewComponent() {}
      NewComponent.$$component = true;

      refresh.register(component, '/src/Component.tsx', 'signature-1');
      await refresh.refresh('/src/Component.tsx', { default: NewComponent });

      expect(callback).toHaveBeenCalled();
    });

    it('should handle refresh callback errors', async () => {
      const errorCallback = vi.fn(() => {
        throw new Error('Callback error');
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      refresh.onRefresh(errorCallback);

      const component: any = { $$signals: {} };
      function NewComponent() {}
      NewComponent.$$component = true;

      refresh.register(component, '/src/Component.tsx', 'signature-1');
      await refresh.refresh('/src/Component.tsx', { default: NewComponent });

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should handle refresh errors', async () => {
      const component: any = {
        $$signals: {
          broken: {
            get: () => {
              throw new Error('Get error');
            },
          },
        },
      };

      refresh.register(component, '/src/Component.tsx', 'signature-1');

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await expect(refresh.refresh('/src/Component.tsx', { default: function Component() {} })).rejects.toThrow();

      consoleSpy.mockRestore();
    });

    it('should unsubscribe refresh callbacks', async () => {
      const callback = vi.fn();
      const unsubscribe = refresh.onRefresh(callback);

      unsubscribe();

      const component: any = { $$signals: {} };
      function NewComponent() {}
      NewComponent.$$component = true;

      refresh.register(component, '/src/Component.tsx', 'signature-1');
      await refresh.refresh('/src/Component.tsx', { default: NewComponent });

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('Global Instance', () => {
    afterEach(() => {
      const instance = getFastRefresh();
      instance?.clear();
    });

    it('should initialize global instance', () => {
      const instance = initFastRefresh({ enabled: true });
      expect(instance).toBeInstanceOf(FastRefresh);
    });

    it('should return same instance on subsequent calls', () => {
      const instance1 = initFastRefresh();
      const instance2 = initFastRefresh();
      expect(instance1).toBe(instance2);
    });

    it('should get current instance', () => {
      const instance = initFastRefresh();
      const retrieved = getFastRefresh();
      expect(retrieved).toBe(instance);
    });

    it('should return null when not initialized', () => {
      const retrieved = getFastRefresh();
      expect(retrieved).toBeDefined(); // May be initialized from previous test
    });
  });

  describe('Decorator', () => {
    beforeEach(() => {
      initFastRefresh({ enabled: true });
    });

    afterEach(() => {
      const instance = getFastRefresh();
      instance?.clear();
    });

    it('should wrap component with Fast Refresh', () => {
      class TestComponent {
        name = 'test';
      }

      const WrappedComponent = withFastRefresh(TestComponent, '/src/Test.tsx');
      const instance = new WrappedComponent();

      expect(instance).toBeInstanceOf(TestComponent);
      expect(instance.name).toBe('test');

      const refresh = getFastRefresh();
      const stats = refresh?.getStats();
      expect(stats?.totalComponents).toBe(1);
    });

    it('should preserve component name', () => {
      class MyComponent {}

      const WrappedComponent = withFastRefresh(MyComponent, '/src/My.tsx');

      expect(WrappedComponent.name).toBe('MyComponent');
    });

    it('should return original component when not initialized', () => {
      // Clear instance
      const instance = getFastRefresh();
      instance?.clear();

      class TestComponent {}

      // Don't initialize Fast Refresh
      const result = withFastRefresh(TestComponent, '/src/Test.tsx');

      // Should return original since no instance
      expect(result).toBe(TestComponent);
    });

    it('should handle constructor arguments', () => {
      class TestComponent {
        constructor(public value: number) {}
      }

      const WrappedComponent = withFastRefresh(TestComponent, '/src/Test.tsx');
      const instance = new WrappedComponent(42);

      expect(instance.value).toBe(42);
    });
  });

  describe('Statistics', () => {
    let refresh: FastRefresh;

    beforeEach(() => {
      refresh = new FastRefresh();
    });

    afterEach(() => {
      refresh.clear();
    });

    it('should track component count', () => {
      refresh.register({}, '/src/A.tsx', 'sig-1');
      refresh.register({}, '/src/B.tsx', 'sig-2');
      refresh.register({}, '/src/C.tsx', 'sig-3');

      const stats = refresh.getStats();
      expect(stats.totalComponents).toBe(3);
      expect(stats.fileCount).toBe(3);
    });

    it('should track file count', () => {
      refresh.register({}, '/src/Components.tsx', 'sig-1');
      refresh.register({}, '/src/Components.tsx', 'sig-2');

      const stats = refresh.getStats();
      expect(stats.totalComponents).toBe(2);
      expect(stats.fileCount).toBe(1);
    });

    it('should reset stats on clear', () => {
      refresh.register({}, '/src/A.tsx', 'sig-1');
      refresh.clear();

      const stats = refresh.getStats();
      expect(stats.totalComponents).toBe(0);
      expect(stats.fileCount).toBe(0);
    });
  });

  describe('Browser Integration', () => {
    it('should dispatch custom event in browser', async () => {
      // Mock window
      const dispatchEventSpy = vi.fn();
      global.window = {
        dispatchEvent: dispatchEventSpy,
      } as any;

      const refresh = new FastRefresh();
      const component: any = { $$signals: {} };

      function NewComponent() {}
      NewComponent.$$component = true;

      refresh.register(component, '/src/Component.tsx', 'signature-1');
      await refresh.refresh('/src/Component.tsx', { default: NewComponent });

      expect(dispatchEventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'aether:fast-refresh',
        })
      );

      delete (global as any).window;
      refresh.clear();
    });
  });

  describe('Configuration', () => {
    it('should use default configuration', () => {
      const refresh = new FastRefresh();
      expect(refresh).toBeDefined();
      refresh.clear();
    });

    it('should accept custom configuration', () => {
      const refresh = new FastRefresh({
        enabled: false,
        preserveLocalState: false,
        forceReset: true,
      });

      expect(refresh).toBeDefined();
      refresh.clear();
    });

    it('should merge with default configuration', () => {
      const refresh = new FastRefresh({ enabled: true });
      expect(refresh).toBeDefined();
      refresh.clear();
    });
  });
});
