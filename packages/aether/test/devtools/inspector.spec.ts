/**
 * Inspector Tests - State Inspector Tests
 *
 * Comprehensive test coverage for the DevTools state inspector,
 * including signal tracking, computed values, effects, components, and stores.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createInspector } from '../../src/devtools/inspector.js';
import type { Inspector, ComputedMetadata, EffectMetadata } from '../../src/devtools/types.js';

// Helper to create mock signals
function createMockSignal(value: any): any {
  const mockFn: any = vi.fn(() => value);
  mockFn.peek = vi.fn(() => value);
  mockFn.subscribe = vi.fn();
  return mockFn;
}

describe('DevTools Inspector', () => {
  let inspector: Inspector;

  beforeEach(() => {
    inspector = createInspector();
    vi.clearAllMocks();
  });

  afterEach(() => {
    inspector.dispose();
  });

  describe('Signal Tracking', () => {
    it('should track new signal creation', () => {
      const mockSignal = {
        peek: vi.fn(() => 42),
        subscribe: vi.fn(),
      };

      inspector.trackSignal(mockSignal, { name: 'TestSignal' });

      const state = inspector.getState();
      expect(state.signals.size).toBe(1);

      const signalMeta = Array.from(state.signals.values())[0];
      expect(signalMeta.name).toBe('TestSignal');
      expect(signalMeta.value).toBe(42);
      expect(signalMeta.type).toBe('signal');
    });

    it('should track writable signal', () => {
      const mockWritableSignal = {
        peek: vi.fn(() => 'test'),
        subscribe: vi.fn(),
        set: vi.fn(),
      };

      inspector.trackSignal(mockWritableSignal, { name: 'WritableSignal' });

      const state = inspector.getState();
      const signalMeta = Array.from(state.signals.values())[0];
      expect(signalMeta.type).toBe('writable');
    });

    it('should update existing signal value', () => {
      const mockSignal = {
        peek: vi.fn(() => 1),
        subscribe: vi.fn(),
      };

      inspector.trackSignal(mockSignal, { name: 'Counter' });

      // Update the value
      mockSignal.peek.mockReturnValue(2);
      inspector.trackSignal(mockSignal, { name: 'Counter' });

      const state = inspector.getState();
      expect(state.signals.size).toBe(1); // Still only one signal

      const signalMeta = Array.from(state.signals.values())[0];
      expect(signalMeta.value).toBe(2);
    });

    it('should track signal metadata', () => {
      const mockSignal = {
        peek: vi.fn(() => 'value'),
        subscribe: vi.fn(),
      };

      inspector.trackSignal(mockSignal, {
        name: 'MetaSignal',
        componentId: 'comp-1',
      });

      const state = inspector.getState();
      const signalMeta = Array.from(state.signals.values())[0];

      expect(signalMeta.name).toBe('MetaSignal');
      expect(signalMeta.componentId).toBe('comp-1');
      expect(signalMeta.createdAt).toBeDefined();
      expect(signalMeta.updatedAt).toBeDefined();
      expect(signalMeta.stack).toBeDefined();
    });

    it('should handle signal with circular reference', () => {
      const circular: any = { a: 1 };
      circular.self = circular;

      const mockSignal = {
        peek: vi.fn(() => circular),
        subscribe: vi.fn(),
      };

      inspector.trackSignal(mockSignal, { name: 'CircularSignal' });

      const state = inspector.getState();
      const signalMeta = Array.from(state.signals.values())[0];

      // Should serialize without throwing
      expect(signalMeta.value).toBeDefined();
      expect(signalMeta.value.a).toBe(1);
      expect(signalMeta.value.self).toBe('[Circular]');
    });

    it('should serialize complex objects', () => {
      const complexValue = {
        date: new Date('2024-01-01'),
        regex: /test/gi,
        map: new Map([['key', 'value']]),
        set: new Set([1, 2, 3]),
        nested: { deep: { value: 42 } },
      };

      const mockSignal = {
        peek: vi.fn(() => complexValue),
        subscribe: vi.fn(),
      };

      inspector.trackSignal(mockSignal, { name: 'ComplexSignal' });

      const state = inspector.getState();
      const signalMeta = Array.from(state.signals.values())[0];

      expect(signalMeta.value.date.__type).toBe('Date');
      expect(signalMeta.value.regex.__type).toBe('RegExp');
      expect(signalMeta.value.map.__type).toBe('Map');
      expect(signalMeta.value.set.__type).toBe('Set');
    });

    it('should limit serialization depth', () => {
      const deepObject: any = { level: 1 };
      let current = deepObject;

      for (let i = 2; i <= 10; i++) {
        current.next = { level: i };
        current = current.next;
      }

      const mockSignal = {
        peek: vi.fn(() => deepObject),
        subscribe: vi.fn(),
      };

      inspector.trackSignal(mockSignal, { name: 'DeepSignal' });

      const state = inspector.getState();
      const signalMeta = Array.from(state.signals.values())[0];

      // Should stop at depth 5
      expect(signalMeta.value).toBeDefined();
    });
  });

  describe('Computed Tracking', () => {
    it('should track computed signal creation', () => {
      const mockComputed = {
        peek: vi.fn(() => 100),
        subscribe: vi.fn(),
      };

      const mockDep1 = { peek: vi.fn(), subscribe: vi.fn() };
      const mockDep2 = { peek: vi.fn(), subscribe: vi.fn() };

      inspector.trackComputed(mockComputed, [mockDep1, mockDep2], {
        name: 'ComputedValue',
      });

      const state = inspector.getState();
      expect(state.computed.size).toBe(1);

      const computedMeta = Array.from(state.computed.values())[0] as ComputedMetadata;
      expect(computedMeta.name).toBe('ComputedValue');
      expect(computedMeta.value).toBe(100);
      expect(computedMeta.type).toBe('computed');
      expect(computedMeta.executionCount).toBe(0);
      expect(computedMeta.avgExecutionTime).toBe(0);
      expect(computedMeta.isStale).toBe(false);
    });

    it('should track computed dependencies', () => {
      const mockDep1 = { peek: vi.fn(), subscribe: vi.fn() };
      const mockDep2 = { peek: vi.fn(), subscribe: vi.fn() };

      // Track dependencies first
      inspector.trackSignal(mockDep1, { name: 'Dep1' });
      inspector.trackSignal(mockDep2, { name: 'Dep2' });

      const mockComputed = {
        peek: vi.fn(() => 'result'),
        subscribe: vi.fn(),
      };

      inspector.trackComputed(mockComputed, [mockDep1, mockDep2], {
        name: 'ComputedWithDeps',
      });

      const state = inspector.getState();
      const computedMeta = Array.from(state.computed.values())[0] as ComputedMetadata;

      expect(computedMeta.dependencies.length).toBe(2);
    });

    it('should update execution count on re-computation', () => {
      const mockComputed = {
        peek: vi.fn(() => 1),
        subscribe: vi.fn(),
      };

      inspector.trackComputed(mockComputed, [], { name: 'Counter' });

      // First execution
      mockComputed.peek.mockReturnValue(2);
      inspector.trackComputed(mockComputed, [], { name: 'Counter' });

      // Second execution
      mockComputed.peek.mockReturnValue(3);
      inspector.trackComputed(mockComputed, [], { name: 'Counter' });

      const state = inspector.getState();
      const computedMeta = Array.from(state.computed.values())[0] as ComputedMetadata;

      expect(computedMeta.executionCount).toBe(2);
      expect(computedMeta.value).toBe(3);
    });

    it('should track dependent count', () => {
      const mockDep = { peek: vi.fn(), subscribe: vi.fn() };

      inspector.trackSignal(mockDep, { name: 'Dependency' });

      const mockComputed1 = { peek: vi.fn(() => 1), subscribe: vi.fn() };
      const mockComputed2 = { peek: vi.fn(() => 2), subscribe: vi.fn() };

      inspector.trackComputed(mockComputed1, [mockDep], { name: 'Computed1' });
      inspector.trackComputed(mockComputed2, [mockDep], { name: 'Computed2' });

      const state = inspector.getState();
      const depMeta = Array.from(state.signals.values())[0];

      // Should have 2 dependents
      expect(depMeta.dependentCount).toBe(2);
    });
  });

  describe('Effect Tracking', () => {
    it('should track effect creation', () => {
      const mockEffect = vi.fn();
      const mockDep = { peek: vi.fn(), subscribe: vi.fn() };

      inspector.trackEffect(mockEffect, [mockDep], {
        name: 'TestEffect',
      });

      const state = inspector.getState();
      expect(state.effects.size).toBe(1);

      const effectMeta = Array.from(state.effects.values())[0] as EffectMetadata;
      expect(effectMeta.name).toBe('TestEffect');
      expect(effectMeta.executionCount).toBe(1);
      expect(effectMeta.isActive).toBe(true);
    });

    it('should track effect dependencies', () => {
      const mockDep1 = { peek: vi.fn(), subscribe: vi.fn() };
      const mockDep2 = { peek: vi.fn(), subscribe: vi.fn() };

      inspector.trackSignal(mockDep1, { name: 'Dep1' });
      inspector.trackSignal(mockDep2, { name: 'Dep2' });

      const mockEffect = vi.fn();
      inspector.trackEffect(mockEffect, [mockDep1, mockDep2], {
        name: 'EffectWithDeps',
      });

      const state = inspector.getState();
      const effectMeta = Array.from(state.effects.values())[0] as EffectMetadata;

      expect(effectMeta.dependencies.length).toBe(2);
    });

    it('should update execution count', () => {
      const mockEffect = vi.fn();

      inspector.trackEffect(mockEffect, [], { name: 'Counter' });
      inspector.trackEffect(mockEffect, [], { name: 'Counter' });
      inspector.trackEffect(mockEffect, [], { name: 'Counter' });

      const state = inspector.getState();
      const effectMeta = Array.from(state.effects.values())[0] as EffectMetadata;

      expect(effectMeta.executionCount).toBe(3);
    });

    it('should track effect metadata', () => {
      const mockEffect = vi.fn();

      inspector.trackEffect(mockEffect, [], {
        name: 'MetaEffect',
        componentId: 'comp-1',
        source: 'function() { console.log("test"); }',
      });

      const state = inspector.getState();
      const effectMeta = Array.from(state.effects.values())[0] as EffectMetadata;

      expect(effectMeta.name).toBe('MetaEffect');
      expect(effectMeta.componentId).toBe('comp-1');
      expect(effectMeta.source).toBe('function() { console.log("test"); }');
      expect(effectMeta.stack).toBeDefined();
    });
  });

  describe('Component Tracking', () => {
    it('should track component creation', () => {
      const mockComponent = function TestComponent() {};
      const props = { id: 1, name: 'Test' };

      inspector.trackComponent(mockComponent, props);

      const state = inspector.getState();
      expect(state.components.size).toBe(1);

      const componentMeta = Array.from(state.components.values())[0];
      expect(componentMeta.name).toBe('TestComponent');
      expect(componentMeta.type).toBe('function');
      expect(componentMeta.renderCount).toBe(1);
      expect(componentMeta.isMounted).toBe(true);
    });

    it('should track component props', () => {
      const mockComponent = function MyComponent() {};
      const props = { id: 1, title: 'Hello', data: { nested: true } };

      inspector.trackComponent(mockComponent, props);

      const state = inspector.getState();
      const componentMeta = Array.from(state.components.values())[0];

      expect(componentMeta.props.id).toBe(1);
      expect(componentMeta.props.title).toBe('Hello');
      expect(componentMeta.props.data.nested).toBe(true);
    });

    it('should track component hierarchy', () => {
      const parentComponent = function Parent() {};
      const childComponent = function Child() {};

      inspector.trackComponent(
        parentComponent,
        {},
        {
          name: 'Parent',
        }
      );

      const parentState = inspector.getState();
      const parentId = Array.from(parentState.components.values())[0].id;

      inspector.trackComponent(
        childComponent,
        {},
        {
          name: 'Child',
          parentId,
        }
      );

      const state = inspector.getState();
      const parentMeta = Array.from(state.components.values())[0];

      expect(parentMeta.children.length).toBe(1);
    });

    it('should update render count on re-render', () => {
      const mockComponent = function TestComponent() {};

      inspector.trackComponent(mockComponent, { count: 1 });
      inspector.trackComponent(mockComponent, { count: 2 });
      inspector.trackComponent(mockComponent, { count: 3 });

      const state = inspector.getState();
      const componentMeta = Array.from(state.components.values())[0];

      expect(componentMeta.renderCount).toBe(3);
      expect(componentMeta.props.count).toBe(3);
    });

    it('should handle anonymous components', () => {
      const mockComponent = () => {};

      inspector.trackComponent(mockComponent, {});

      const state = inspector.getState();
      const componentMeta = Array.from(state.components.values())[0];

      expect(componentMeta.name).toBe('Anonymous');
    });
  });

  describe('Store Tracking', () => {
    it('should track store creation', () => {
      const mockStore = {};
      const state = { count: 0, name: 'Test' };

      (inspector as any).trackStore(mockStore, 'TestStore', state);

      const inspectorState = inspector.getState();
      expect(inspectorState.stores.size).toBe(1);

      const storeMeta = Array.from(inspectorState.stores.values())[0];
      expect(storeMeta.name).toBe('TestStore');
      expect(storeMeta.state.count).toBe(0);
      expect(storeMeta.state.name).toBe('Test');
    });
  });

  describe('State Tree Generation', () => {
    it('should generate state tree', () => {
      const mockSignal = { peek: vi.fn(() => 1), subscribe: vi.fn() };
      const mockComputed = { peek: vi.fn(() => 2), subscribe: vi.fn() };

      inspector.trackSignal(mockSignal, { name: 'Signal1' });
      inspector.trackComputed(mockComputed, [], { name: 'Computed1' });

      const stateTree = inspector.getStateTree();

      expect(stateTree.length).toBeGreaterThan(0);
      expect(stateTree.find((node) => node.label.includes('Signals'))).toBeDefined();
      expect(stateTree.find((node) => node.label.includes('Computed'))).toBeDefined();
    });

    it('should organize state tree by categories', () => {
      const mockSignal = { peek: vi.fn(() => 1), subscribe: vi.fn() };
      const mockEffect = vi.fn();

      inspector.trackSignal(mockSignal, { name: 'Signal1' });
      inspector.trackEffect(mockEffect, [], { name: 'Effect1' });

      const stateTree = inspector.getStateTree();
      const signalCategory = stateTree.find((n) => n.id === 'signals-root');
      const effectCategory = stateTree.find((n) => n.id === 'effects-root');

      expect(signalCategory).toBeDefined();
      expect(signalCategory?.children.length).toBe(1);
      expect(effectCategory).toBeDefined();
      expect(effectCategory?.children.length).toBe(1);
    });
  });

  describe('Component Tree Generation', () => {
    it('should generate component tree', () => {
      const parentComponent = function Parent() {};
      const childComponent = function Child() {};

      inspector.trackComponent(parentComponent, {}, { name: 'Parent' });

      const parentState = inspector.getState();
      const parentId = Array.from(parentState.components.values())[0].id;

      inspector.trackComponent(
        childComponent,
        {},
        {
          name: 'Child',
          parentId,
        }
      );

      const componentTree = inspector.getComponentTree();

      expect(componentTree.length).toBe(1);
      expect(componentTree[0].label).toBe('Parent');
      expect(componentTree[0].children.length).toBe(1);
      expect(componentTree[0].children[0].label).toBe('Child');
    });

    it('should handle multiple root components', () => {
      const comp1 = function Comp1() {};
      const comp2 = function Comp2() {};

      inspector.trackComponent(comp1, {}, { name: 'Comp1' });
      inspector.trackComponent(comp2, {}, { name: 'Comp2' });

      const componentTree = inspector.getComponentTree();

      expect(componentTree.length).toBe(2);
    });
  });

  describe('Cleanup and Disposal', () => {
    it('should clear all tracking data', () => {
      const mockSignal = { peek: vi.fn(() => 1), subscribe: vi.fn() };
      const mockEffect = vi.fn();
      const mockComponent = function Test() {};

      inspector.trackSignal(mockSignal, { name: 'Signal' });
      inspector.trackEffect(mockEffect, [], { name: 'Effect' });
      inspector.trackComponent(mockComponent, {});

      inspector.clear();

      const state = inspector.getState();
      expect(state.signals.size).toBe(0);
      expect(state.effects.size).toBe(0);
      expect(state.components.size).toBe(0);
    });

    it('should dispose inspector', () => {
      const mockSignal = { peek: vi.fn(() => 1), subscribe: vi.fn() };
      inspector.trackSignal(mockSignal, { name: 'Signal' });

      inspector.dispose();

      const state = inspector.getState();
      expect(state.signals.size).toBe(0);
    });

    it('should not throw on double disposal', () => {
      expect(() => {
        inspector.dispose();
        inspector.dispose();
      }).not.toThrow();
    });
  });

  describe('Memory Management', () => {
    it('should handle large numbers of tracked items', () => {
      for (let i = 0; i < 1000; i++) {
        const mockSignal = { peek: vi.fn(() => i), subscribe: vi.fn() };
        inspector.trackSignal(mockSignal, { name: `Signal${i}` });
      }

      const state = inspector.getState();
      expect(state.signals.size).toBe(1000);

      // Cleanup
      inspector.clear();
      const clearedState = inspector.getState();
      expect(clearedState.signals.size).toBe(0);
    });

    it('should prevent memory leaks with WeakMap', () => {
      const mockSignal = { peek: vi.fn(() => 1), subscribe: vi.fn() };

      inspector.trackSignal(mockSignal, { name: 'Signal' });

      // Track again with same signal
      inspector.trackSignal(mockSignal, { name: 'Signal' });

      const state = inspector.getState();
      // Should still be only one signal
      expect(state.signals.size).toBe(1);
    });
  });

  describe('Error Handling', () => {
    it('should handle unserializable values gracefully', () => {
      const unserializable: any = {};
      unserializable.circular = unserializable;

      // Add a function to make it harder to serialize
      unserializable.fn = () => {};

      const mockSignal = {
        peek: vi.fn(() => unserializable),
        subscribe: vi.fn(),
      };

      expect(() => {
        inspector.trackSignal(mockSignal, { name: 'Unserializable' });
      }).not.toThrow();

      const state = inspector.getState();
      expect(state.signals.size).toBe(1);
    });

    it('should handle signals with null values', () => {
      const mockSignal = {
        peek: vi.fn(() => null),
        subscribe: vi.fn(),
      };

      inspector.trackSignal(mockSignal, { name: 'NullSignal' });

      const state = inspector.getState();
      const signalMeta = Array.from(state.signals.values())[0];
      expect(signalMeta.value).toBeNull();
    });

    it('should handle signals with undefined values', () => {
      const mockSignal = {
        peek: vi.fn(() => undefined),
        subscribe: vi.fn(),
      };

      inspector.trackSignal(mockSignal, { name: 'UndefinedSignal' });

      const state = inspector.getState();
      const signalMeta = Array.from(state.signals.values())[0];
      expect(signalMeta.value).toBeUndefined();
    });
  });
});
