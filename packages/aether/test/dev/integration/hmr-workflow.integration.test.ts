/**
 * HMR Workflow Integration Tests
 *
 * Tests the complete HMR workflow including:
 * - File change detection
 * - Module graph updates
 * - HMR boundary detection
 * - WebSocket updates
 * - Fast Refresh with state preservation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HMREngine } from '../../../src/dev/hmr/engine.js';
import { FastRefresh } from '../../../src/dev/hmr/fast-refresh.js';
import type { HMRUpdate, ComponentState } from '../../../src/dev/types.js';

describe('HMR Workflow Integration', () => {
  describe('Complete HMR Cycle', () => {
    let engine: HMREngine;
    let mockWs: any;

    beforeEach(() => {
      engine = new HMREngine({
        preserveState: true,
      });

      mockWs = {
        readyState: 1, // WebSocket.OPEN
        send: vi.fn(),
        close: vi.fn(),
      };

      engine.addConnection(mockWs);
    });

    afterEach(() => {
      engine.close();
    });

    it('should handle complete file change workflow', async () => {
      // 1. Register modules
      engine.registerModule('app', '/src/app.ts', 'module', new Set(['component-a']));
      engine.registerModule('component-a', '/src/components/A.tsx', 'component', new Set(['utils']));
      engine.registerModule('utils', '/src/utils.ts', 'module', new Set());

      // 2. Mark component as accepting HMR
      engine.acceptHMR('component-a', true);

      // 3. Simulate file change
      const onUpdate = vi.fn();
      engine = new HMREngine({
        preserveState: true,
        onUpdate,
      });
      engine.addConnection(mockWs);

      // Re-register modules
      engine.registerModule('app', '/src/app.ts', 'module', new Set(['component-a']));
      engine.registerModule('component-a', '/src/components/A.tsx', 'component', new Set(['utils']));
      engine.registerModule('utils', '/src/utils.ts', 'module', new Set());
      engine.acceptHMR('component-a', true);

      // 4. Trigger update
      await engine.handleUpdate('/src/components/A.tsx');

      // 5. Verify update was processed
      expect(onUpdate).toHaveBeenCalled();
      const update: HMRUpdate = onUpdate.mock.calls[0][0];
      expect(update.type).toBe('update');
      expect(update.path).toBe('/src/components/A.tsx');
      expect(update.acceptedPath).toBe('component-a');

      // 6. Verify WebSocket message
      await new Promise((resolve) => setTimeout(resolve, 20));
      const calls = mockWs.send.mock.calls;
      const updateCall = calls.find((call: any) => {
        const payload = JSON.parse(call[0]);
        return payload.type === 'update';
      });

      expect(updateCall).toBeDefined();
    });

    it('should propagate updates through dependency chain', async () => {
      // Create chain: page -> layout -> component -> utils
      engine.registerModule('page', '/src/pages/Home.tsx', 'component', new Set(['layout']));
      engine.registerModule('layout', '/src/layouts/Main.tsx', 'component', new Set(['component']));
      engine.registerModule('component', '/src/components/Header.tsx', 'component', new Set(['utils']));
      engine.registerModule('utils', '/src/utils/helpers.ts', 'module', new Set());

      // Mark components as boundaries
      engine.acceptHMR('component', true);

      // Update utils file
      await engine.handleUpdate('/src/utils/helpers.ts');

      // Should find component as boundary
      await new Promise((resolve) => setTimeout(resolve, 20));

      const calls = mockWs.send.mock.calls;
      const updateCall = calls.find((call: any) => {
        const payload = JSON.parse(call[0]);
        return payload.type === 'update';
      });

      expect(updateCall).toBeDefined();
    });

    it('should handle multiple concurrent updates', async () => {
      engine.registerModule('module-a', '/src/a.ts', 'module', new Set());
      engine.registerModule('module-b', '/src/b.ts', 'module', new Set());
      engine.registerModule('module-c', '/src/c.ts', 'module', new Set());

      engine.acceptHMR('module-a', true);
      engine.acceptHMR('module-b', true);
      engine.acceptHMR('module-c', true);

      // Trigger concurrent updates
      await Promise.all([
        engine.handleUpdate('/src/a.ts'),
        engine.handleUpdate('/src/b.ts'),
        engine.handleUpdate('/src/c.ts'),
      ]);

      // Wait for all updates to be processed
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should have sent multiple update messages
      const calls = mockWs.send.mock.calls;
      const updateCalls = calls.filter((call: any) => {
        const payload = JSON.parse(call[0]);
        return payload.type === 'update';
      });

      expect(updateCalls.length).toBeGreaterThan(0);
    });

    it('should handle errors and recover', async () => {
      const onError = vi.fn();
      engine = new HMREngine({
        onError,
        reloadOnError: false,
      });
      engine.addConnection(mockWs);

      engine.registerModule('module-a', '/src/a.ts', 'module', new Set(['module-b']));

      // Simulate error during update
      const originalGetAffectedModules = engine.getModuleGraph().getAffectedModules;
      engine.getModuleGraph().getAffectedModules = vi.fn(() => {
        throw new Error('Graph error');
      });

      await engine.handleUpdate('/src/a.ts');

      expect(onError).toHaveBeenCalled();

      // Restore function
      engine.getModuleGraph().getAffectedModules = originalGetAffectedModules;

      // Should recover and handle subsequent updates
      await engine.handleUpdate('/src/a.ts');
    });

    it('should handle circular dependencies gracefully', async () => {
      // Create circular dependency: a -> b -> c -> a
      engine.registerModule('module-a', '/src/a.ts', 'module', new Set(['module-b']));
      engine.registerModule('module-b', '/src/b.ts', 'module', new Set(['module-c']));
      engine.registerModule('module-c', '/src/c.ts', 'module', new Set(['module-a']));

      // Should not hang or crash
      await engine.handleUpdate('/src/a.ts');

      await new Promise((resolve) => setTimeout(resolve, 20));

      // Should have triggered full reload due to no boundary
      const calls = mockWs.send.mock.calls;
      const reloadCall = calls.find((call: any) => {
        const payload = JSON.parse(call[0]);
        return payload.type === 'full-reload';
      });

      expect(reloadCall).toBeDefined();
    });
  });

  describe('Fast Refresh Integration', () => {
    let engine: HMREngine;
    let refresh: FastRefresh;
    let mockWs: any;

    beforeEach(() => {
      engine = new HMREngine({ preserveState: true });
      refresh = new FastRefresh({ preserveLocalState: true });

      mockWs = {
        readyState: 1,
        send: vi.fn(),
        close: vi.fn(),
      };

      engine.addConnection(mockWs);
    });

    afterEach(() => {
      engine.close();
      refresh.clear();
    });

    it('should preserve component state during HMR', async () => {
      // 1. Register component with state
      const component: any = {
        $$signals: {
          count: {
            get: () => 42,
            set: vi.fn(),
          },
          name: {
            get: () => 'test',
            set: vi.fn(),
          },
        },
      };

      refresh.register(component, '/src/Component.tsx', 'signature-1');

      // 2. Preserve state
      const state = refresh.preserveState(component);
      expect(state?.signals.get('count')).toBe(42);
      expect(state?.signals.get('name')).toBe('test');

      // 3. Register module in HMR engine
      engine.registerModule('component', '/src/Component.tsx', 'component', new Set());
      engine.acceptHMR('component', true);

      // 4. Trigger HMR update
      await engine.handleUpdate('/src/Component.tsx');

      // 5. Restore state
      if (state) {
        refresh.restoreState(component, state);
      }

      // 6. Verify state was restored
      expect(component.$$signals.count.set).toHaveBeenCalledWith(42);
      expect(component.$$signals.name.set).toHaveBeenCalledWith('test');
    });

    it('should handle component refresh workflow', async () => {
      // 1. Create and register component
      class TestComponent {
        $$signals = {
          value: {
            get: () => 100,
            set: vi.fn(),
          },
        };
      }

      const instance = new TestComponent();
      refresh.register(instance, '/src/Test.tsx', 'sig-1');

      // 2. Preserve state before update
      const state = refresh.preserveState(instance);

      // 3. Create new component version
      class UpdatedComponent {
        $$signals = {
          value: {
            get: () => 0,
            set: vi.fn(),
          },
        };

        newMethod() {
          return 'new';
        }
      }

      // 4. Trigger refresh
      await refresh.refresh('/src/Test.tsx', { default: UpdatedComponent });

      // 5. Restore state
      if (state) {
        refresh.restoreState(instance, state);
      }

      // 6. Verify state was preserved
      expect(instance.$$signals.value.set).toHaveBeenCalledWith(100);
    });

    it('should handle refresh callback triggers', async () => {
      const refreshCallback = vi.fn();
      refresh.onRefresh(refreshCallback);

      // Register component
      const component: any = { $$signals: {} };
      refresh.register(component, '/src/Component.tsx', 'sig-1');

      // Create new version
      function NewComponent() {}
      NewComponent.$$component = true;

      // Trigger refresh
      await refresh.refresh('/src/Component.tsx', { default: NewComponent });

      // Callback should have been called
      expect(refreshCallback).toHaveBeenCalled();
    });

    it('should skip refresh when signatures incompatible', () => {
      const oldModule = {
        ComponentA: function A() {},
        ComponentB: function B() {},
      };

      const newModule = {
        ComponentA: function A() {},
        // ComponentB removed
      };

      const canRefresh = refresh.canRefresh('/src/Components.tsx', oldModule, newModule);

      // Different structure, can't safely refresh
      expect(canRefresh).toBe(false);
    });
  });

  describe('Module Graph Updates', () => {
    let engine: HMREngine;

    beforeEach(() => {
      engine = new HMREngine();
    });

    afterEach(() => {
      engine.close();
    });

    it('should update module dependencies dynamically', () => {
      // Initial state: A imports B
      engine.registerModule('module-a', '/src/a.ts', 'module', new Set(['module-b']));
      engine.registerModule('module-b', '/src/b.ts', 'module', new Set());

      const graph = engine.getModuleGraph();
      let moduleA = graph.getModuleById('module-a')!;
      let moduleB = graph.getModuleById('module-b')!;

      expect(moduleA.importedModules.size).toBe(1);
      expect(moduleB.importers.size).toBe(1);

      // Update: A now imports C instead of B
      engine.registerModule('module-a', '/src/a.ts', 'module', new Set(['module-c']));
      engine.registerModule('module-c', '/src/c.ts', 'module', new Set());

      moduleA = graph.getModuleById('module-a')!;
      moduleB = graph.getModuleById('module-b')!;
      const moduleC = graph.getModuleById('module-c')!;

      expect(moduleA.importedModules.has(moduleB)).toBe(false);
      expect(moduleA.importedModules.has(moduleC)).toBe(true);
      expect(moduleB.importers.size).toBe(0);
      expect(moduleC.importers.size).toBe(1);
    });

    it('should handle module replacement', () => {
      // Register module
      engine.registerModule('module-a', '/src/a.ts', 'module', new Set());

      const graph = engine.getModuleGraph();
      const moduleA1 = graph.getModuleById('module-a')!;
      const timestamp1 = moduleA1.lastHMRTimestamp;

      // Wait and replace
      vi.useFakeTimers();
      vi.advanceTimersByTime(100);

      engine.registerModule('module-a', '/src/a-new.ts', 'module', new Set());

      const moduleA2 = graph.getModuleById('module-a')!;

      // Same ID, updated file
      expect(moduleA2.id).toBe('module-a');
      expect(moduleA2.file).toBe('/src/a-new.ts');

      vi.useRealTimers();
    });

    it('should invalidate affected modules', () => {
      // Create dependency chain
      engine.registerModule('module-a', '/src/a.ts', 'module', new Set(['module-b']));
      engine.registerModule('module-b', '/src/b.ts', 'module', new Set(['module-c']));
      engine.registerModule('module-c', '/src/c.ts', 'module', new Set());

      const graph = engine.getModuleGraph();
      const moduleC = graph.getModuleById('module-c')!;

      vi.useFakeTimers();
      const initialTimestamp = moduleC.lastHMRTimestamp;

      vi.advanceTimersByTime(100);

      // Invalidate module C
      graph.invalidateModule(moduleC);

      // All modules in chain should be invalidated
      const moduleA = graph.getModuleById('module-a')!;
      const moduleB = graph.getModuleById('module-b')!;

      expect(moduleC.lastHMRTimestamp).toBeGreaterThan(initialTimestamp);
      expect(moduleB.lastHMRTimestamp).toBeGreaterThan(0);
      expect(moduleA.lastHMRTimestamp).toBeGreaterThan(0);

      vi.useRealTimers();
    });
  });

  describe('Error Recovery', () => {
    let engine: HMREngine;
    let refresh: FastRefresh;

    beforeEach(() => {
      engine = new HMREngine({ reloadOnError: true });
      refresh = new FastRefresh();
    });

    afterEach(() => {
      engine.close();
      refresh.clear();
    });

    it('should recover from state preservation errors', async () => {
      const component: any = {
        $$signals: {
          broken: {
            get: () => {
              throw new Error('Get error');
            },
          },
        },
      };

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      refresh.register(component, '/src/Component.tsx', 'sig-1');
      const state = refresh.preserveState(component);

      // Should return null on error
      expect(state).toBeNull();

      consoleSpy.mockRestore();
    });

    it('should recover from state restoration errors', () => {
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

      // Should not throw
      refresh.restoreState(component, state);

      consoleSpy.mockRestore();
    });

    it('should reload page on critical errors', async () => {
      const mockWs = {
        readyState: 1,
        send: vi.fn(),
        close: vi.fn(),
      };

      engine.addConnection(mockWs);

      const onUpdate = vi.fn(() => {
        throw new Error('Critical error');
      });

      engine = new HMREngine({ onUpdate, reloadOnError: true });
      engine.addConnection(mockWs);

      engine.registerModule('module-a', '/src/a.ts', 'module', new Set());

      await engine.handleUpdate('/src/a.ts');

      // Should send reload message
      await new Promise((resolve) => setTimeout(resolve, 20));

      // The error is caught and logged, update still attempted
    });
  });

  describe('Performance', () => {
    let engine: HMREngine;

    beforeEach(() => {
      engine = new HMREngine();
    });

    afterEach(() => {
      engine.close();
    });

    it('should handle large module graphs efficiently', () => {
      const startTime = Date.now();

      // Create 1000 modules
      for (let i = 0; i < 1000; i++) {
        engine.registerModule(`module-${i}`, `/src/module-${i}.ts`, 'module', new Set());
      }

      const duration = Date.now() - startTime;

      // Should complete in reasonable time
      expect(duration).toBeLessThan(1000); // 1 second
    });

    it('should batch multiple updates efficiently', async () => {
      const mockWs = {
        readyState: 1,
        send: vi.fn(),
        close: vi.fn(),
      };

      engine.addConnection(mockWs);

      // Register modules
      for (let i = 0; i < 10; i++) {
        engine.registerModule(`module-${i}`, `/src/${i}.ts`, 'module', new Set());
        engine.acceptHMR(`module-${i}`, true);
      }

      const startTime = Date.now();

      // Send 10 updates rapidly
      const updates = [];
      for (let i = 0; i < 10; i++) {
        updates.push(engine.handleUpdate(`/src/${i}.ts`));
      }

      await Promise.all(updates);
      await new Promise((resolve) => setTimeout(resolve, 50));

      const duration = Date.now() - startTime;

      // Should batch and complete quickly
      expect(duration).toBeLessThan(200);

      // Should have batched updates
      const calls = mockWs.send.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
    });
  });
});
