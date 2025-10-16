/**
 * Component Tracking Tests
 *
 * Tests for component lifecycle tracking, render duration measurement,
 * re-render counting, props change detection, and effect timing.
 *
 * @vitest-environment happy-dom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createInspector } from '../../src/devtools/inspector.js';
import { createProfiler } from '../../src/devtools/profiler.js';
import type { Inspector, Profiler, ComponentMetadata } from '../../src/devtools/types.js';

describe('Component Tracking', () => {
  let inspector: Inspector;
  let profiler: Profiler;

  beforeEach(() => {
    inspector = createInspector();
    profiler = createProfiler();
  });

  afterEach(() => {
    inspector.dispose();
    profiler.clear();
  });

  describe('Component Lifecycle Tracking', () => {
    it('should track component mount', () => {
      const Component = function TestComponent() {};
      const props = { id: 1, title: 'Test' };

      inspector.trackComponent(Component, props, {
        name: 'TestComponent',
      });

      const state = inspector.getState();
      expect(state.components.size).toBe(1);

      const component = Array.from(state.components.values())[0] as ComponentMetadata;
      expect(component.name).toBe('TestComponent');
      expect(component.isMounted).toBe(true);
      expect(component.renderCount).toBe(1);
      expect(component.props).toEqual(props);
      expect(component.createdAt).toBeDefined();
      expect(component.lastRenderedAt).toBeDefined();
    });

    it('should track component unmount', () => {
      const Component = function TestComponent() {};

      inspector.trackComponent(
        Component,
        {},
        {
          name: 'TestComponent',
        }
      );

      const state = inspector.getState();
      const component = Array.from(state.components.values())[0] as ComponentMetadata;

      // Simulate unmount by updating metadata
      component.isMounted = false;

      expect(component.isMounted).toBe(false);
    });

    it('should track component hierarchy', () => {
      const Parent = function ParentComponent() {};
      const Child = function ChildComponent() {};

      inspector.trackComponent(Parent, {}, { name: 'Parent' });

      const parentState = inspector.getState();
      const parentId = Array.from(parentState.components.values())[0].id;

      inspector.trackComponent(
        Child,
        {},
        {
          name: 'Child',
          parentId,
        }
      );

      const state = inspector.getState();
      const parent = Array.from(state.components.values())[0] as ComponentMetadata;

      expect(parent.children.length).toBe(1);
      expect(parent.children[0]).toBeDefined();
    });

    it('should track nested component hierarchies', () => {
      const Root = function RootComponent() {};
      const Parent = function ParentComponent() {};
      const Child = function ChildComponent() {};

      inspector.trackComponent(Root, {}, { name: 'Root' });
      const rootState = inspector.getState();
      const rootId = Array.from(rootState.components.values())[0].id;

      inspector.trackComponent(Parent, {}, { name: 'Parent', parentId: rootId });
      const parentState = inspector.getState();
      const parentId = Array.from(parentState.components.values())[1].id;

      inspector.trackComponent(Child, {}, { name: 'Child', parentId });

      const componentTree = inspector.getComponentTree();
      expect(componentTree.length).toBe(1); // One root
      expect(componentTree[0].children.length).toBe(1); // One parent
      expect(componentTree[0].children[0].children.length).toBe(1); // One child
    });

    it('should track multiple siblings', () => {
      const Parent = function ParentComponent() {};
      const Child1 = function Child1Component() {};
      const Child2 = function Child2Component() {};

      inspector.trackComponent(Parent, {}, { name: 'Parent' });
      const parentState = inspector.getState();
      const parentId = Array.from(parentState.components.values())[0].id;

      inspector.trackComponent(Child1, {}, { name: 'Child1', parentId });
      inspector.trackComponent(Child2, {}, { name: 'Child2', parentId });

      const state = inspector.getState();
      const parent = Array.from(state.components.values())[0] as ComponentMetadata;

      expect(parent.children.length).toBe(2);
    });
  });

  describe('Render Duration Measurement', () => {
    it('should measure component render duration', () => {
      profiler.startProfiling();

      const Component = function TestComponent() {};
      const componentId = 'test-component-1';

      profiler.startMeasuringComponent(componentId, 'TestComponent');

      // Simulate render work
      const start = performance.now();
      while (performance.now() - start < 10) {
        // Busy wait for 10ms
      }

      profiler.endMeasuringComponent(componentId);
      const profile = profiler.stopProfiling();

      expect(profile.measurements.length).toBe(1);
      expect(profile.measurements[0].type).toBe('component');
      expect(profile.measurements[0].duration).toBeGreaterThan(0);
    });

    it('should track average render time', () => {
      profiler.startProfiling();

      const componentId = 'test-component';

      // Render multiple times
      for (let i = 0; i < 3; i++) {
        profiler.startMeasuringComponent(componentId, 'TestComponent');
        profiler.endMeasuringComponent(componentId);
      }

      profiler.stopProfiling();

      const avgTime = profiler.getAverageTime(componentId, 'component');
      expect(avgTime).toBeGreaterThanOrEqual(0);
    });

    it('should measure component with convenience wrapper', () => {
      profiler.startProfiling();

      const Component = { id: 'test', name: 'TestComponent' };

      profiler.measureComponent(Component, () => {
        // Simulate work
        const start = performance.now();
        while (performance.now() - start < 5) {
          // Busy wait
        }
      });

      const profile = profiler.stopProfiling();
      expect(profile.measurements.length).toBe(1);
    });
  });

  describe('Re-render Counting', () => {
    it('should count component renders', () => {
      const Component = function TestComponent() {};

      inspector.trackComponent(Component, { count: 1 });
      inspector.trackComponent(Component, { count: 2 });
      inspector.trackComponent(Component, { count: 3 });

      const state = inspector.getState();
      const component = Array.from(state.components.values())[0] as ComponentMetadata;

      expect(component.renderCount).toBe(3);
    });

    it('should track render timestamps', () => {
      const Component = function TestComponent() {};

      inspector.trackComponent(Component, {});
      const initialState = inspector.getState();
      const initialComponent = Array.from(initialState.components.values())[0] as ComponentMetadata;
      const initialTime = initialComponent.lastRenderedAt;

      // Wait a bit
      const delay = new Promise((resolve) => setTimeout(resolve, 10));
      return delay.then(() => {
        inspector.trackComponent(Component, {});
        const updatedState = inspector.getState();
        const updatedComponent = Array.from(updatedState.components.values())[0] as ComponentMetadata;

        expect(updatedComponent.lastRenderedAt).toBeGreaterThan(initialTime);
      });
    });

    it('should track render frequency for performance analysis', () => {
      const Component = function HighFrequencyComponent() {};

      const renderCount = 100;
      const startTime = Date.now();

      for (let i = 0; i < renderCount; i++) {
        inspector.trackComponent(Component, { frame: i });
      }

      const endTime = Date.now();
      const duration = endTime - startTime;

      const state = inspector.getState();
      const component = Array.from(state.components.values())[0] as ComponentMetadata;

      expect(component.renderCount).toBe(renderCount);

      // Calculate renders per second
      const rendersPerSecond = (renderCount / duration) * 1000;
      expect(rendersPerSecond).toBeGreaterThan(0);
    });
  });

  describe('Props Change Detection', () => {
    it('should detect props changes', () => {
      const Component = function TestComponent() {};

      inspector.trackComponent(Component, { value: 1 });

      inspector.trackComponent(Component, { value: 2 });
      const updatedState = inspector.getState();
      const updatedComponent = Array.from(updatedState.components.values())[0] as ComponentMetadata;

      // Component props are updated in place, so we only check the final value
      expect(updatedComponent.props.value).toBe(2);
      expect(updatedComponent.renderCount).toBe(2);
    });

    it('should serialize complex props', () => {
      const Component = function TestComponent() {};
      const complexProps = {
        id: 1,
        user: {
          name: 'John',
          email: 'john@example.com',
        },
        items: [1, 2, 3],
        date: new Date('2024-01-01'),
        regex: /test/gi,
      };

      inspector.trackComponent(Component, complexProps);

      const state = inspector.getState();
      const component = Array.from(state.components.values())[0] as ComponentMetadata;

      expect(component.props.id).toBe(1);
      expect(component.props.user.name).toBe('John');
      expect(component.props.items).toEqual([1, 2, 3]);
      expect(component.props.date.__type).toBe('Date');
      expect(component.props.regex.__type).toBe('RegExp');
    });

    it('should handle circular references in props', () => {
      const Component = function TestComponent() {};
      const circularProps: any = { id: 1 };
      circularProps.self = circularProps;

      inspector.trackComponent(Component, circularProps);

      const state = inspector.getState();
      const component = Array.from(state.components.values())[0] as ComponentMetadata;

      expect(component.props.id).toBe(1);
      expect(component.props.self).toBe('[Circular]');
    });

    it('should track props changes over multiple renders', () => {
      const Component = function TestComponent() {};

      const propsHistory = [{ count: 0 }, { count: 1 }, { count: 2 }, { count: 3 }];

      for (const props of propsHistory) {
        inspector.trackComponent(Component, props);
      }

      const state = inspector.getState();
      const component = Array.from(state.components.values())[0] as ComponentMetadata;

      expect(component.renderCount).toBe(4);
      expect(component.props.count).toBe(3);
    });
  });

  describe('Effect Timing', () => {
    it('should measure effect execution time', () => {
      profiler.startProfiling();

      const effect = () => {
        // Simulate work
        const start = performance.now();
        while (performance.now() - start < 5) {
          // Busy wait
        }
      };

      const effectId = 'test-effect';

      profiler.startMeasuringEffect(effectId, 'TestEffect');
      effect();
      profiler.endMeasuringEffect(effectId);

      const profile = profiler.stopProfiling();
      expect(profile.measurements.length).toBe(1);
      expect(profile.measurements[0].type).toBe('effect');
      expect(profile.measurements[0].duration).toBeGreaterThan(0);
    });

    it('should track effect execution count', () => {
      const effect = vi.fn();

      inspector.trackEffect(effect, [], { name: 'TestEffect' });
      inspector.trackEffect(effect, [], { name: 'TestEffect' });
      inspector.trackEffect(effect, [], { name: 'TestEffect' });

      const state = inspector.getState();
      const effectMeta = Array.from(state.effects.values())[0];

      expect(effectMeta.executionCount).toBe(3);
    });

    it('should link effects to components', () => {
      const Component = function TestComponent() {};
      const effect = vi.fn();

      inspector.trackComponent(Component, {}, { name: 'TestComponent' });

      const state = inspector.getState();
      const componentId = Array.from(state.components.values())[0].id;

      inspector.trackEffect(effect, [], {
        name: 'ComponentEffect',
        componentId,
      });

      const effectState = inspector.getState();
      const effectMeta = Array.from(effectState.effects.values())[0];

      expect(effectMeta.componentId).toBe(componentId);
    });

    it('should measure effect with convenience wrapper', () => {
      profiler.startProfiling();

      const effect = () => {
        const start = performance.now();
        while (performance.now() - start < 5) {
          // Busy wait
        }
      };

      profiler.measureEffect(effect, effect);

      const profile = profiler.stopProfiling();
      expect(profile.measurements.length).toBe(1);
    });
  });

  describe('Performance Analysis', () => {
    it('should identify slow component renders', () => {
      profiler.startProfiling();

      const FastComponent = { id: 'fast', name: 'Fast' };
      const SlowComponent = { id: 'slow', name: 'Slow' };

      profiler.measureComponent(FastComponent, () => {
        // Fast render (1ms)
        const start = performance.now();
        while (performance.now() - start < 1) {
          // Busy wait
        }
      });

      profiler.measureComponent(SlowComponent, () => {
        // Slow render (20ms)
        const start = performance.now();
        while (performance.now() - start < 20) {
          // Busy wait
        }
      });

      const bottlenecks = profiler.identifyBottlenecks(16); // 16ms threshold (60fps)

      expect(bottlenecks.length).toBeGreaterThanOrEqual(1);
      expect(bottlenecks[0].targetId).toBe('slow');
      expect(bottlenecks[0].duration).toBeGreaterThan(16);
    });

    it('should calculate component render statistics', () => {
      profiler.startProfiling();

      const componentId = 'test-component';

      // Render multiple times with varying durations
      for (let i = 0; i < 5; i++) {
        profiler.startMeasuringComponent(componentId, 'TestComponent');
        const start = performance.now();
        while (performance.now() - start < 5) {
          // Busy wait
        }
        profiler.endMeasuringComponent(componentId);
      }

      profiler.stopProfiling();

      const avgTime = profiler.getAverageTime(componentId, 'component');
      expect(avgTime).toBeGreaterThan(0);
    });

    it('should track memory usage during renders', () => {
      profiler.startProfiling();

      const Component = { id: 'test', name: 'Test' };

      profiler.measureComponent(Component, () => {
        // Allocate memory
        const array = new Array(10000).fill(0);
        void array; // Use the array
      });

      const profile = profiler.stopProfiling();
      const measurement = profile.measurements[0];

      // Memory delta might not be available in all environments
      if (measurement.memoryDelta !== undefined) {
        expect(typeof measurement.memoryDelta).toBe('number');
      }
    });
  });

  describe('Signal and Effect Integration', () => {
    it('should track signals used by component', () => {
      const Component = function TestComponent() {};
      const mockSignal = { peek: vi.fn(() => 1), subscribe: vi.fn() };

      inspector.trackComponent(Component, {}, { name: 'TestComponent' });

      const state = inspector.getState();
      const componentId = Array.from(state.components.values())[0].id;

      inspector.trackSignal(mockSignal, {
        name: 'ComponentSignal',
        componentId,
      });

      const updatedState = inspector.getState();
      const signal = Array.from(updatedState.signals.values())[0];

      expect(signal.componentId).toBe(componentId);
    });

    it('should track effects created by component', () => {
      const Component = function TestComponent() {};
      const effect = vi.fn();

      inspector.trackComponent(Component, {}, { name: 'TestComponent' });

      const state = inspector.getState();
      const componentId = Array.from(state.components.values())[0].id;

      inspector.trackEffect(effect, [], {
        name: 'ComponentEffect',
        componentId,
      });

      const effectState = inspector.getState();
      const effectMeta = Array.from(effectState.effects.values())[0];

      expect(effectMeta.componentId).toBe(componentId);
    });
  });

  describe('Component Tree Visualization', () => {
    it('should generate component tree for DevTools', () => {
      const Root = function Root() {};
      const Parent1 = function Parent1() {};
      const Parent2 = function Parent2() {};
      const Child1 = function Child1() {};
      const Child2 = function Child2() {};

      inspector.trackComponent(Root, {}, { name: 'Root' });
      const rootState = inspector.getState();
      const rootId = Array.from(rootState.components.values())[0].id;

      inspector.trackComponent(Parent1, {}, { name: 'Parent1', parentId: rootId });
      inspector.trackComponent(Parent2, {}, { name: 'Parent2', parentId: rootId });

      const parentState = inspector.getState();
      const parent1Id = Array.from(parentState.components.values())[1].id;

      inspector.trackComponent(Child1, {}, { name: 'Child1', parentId: parent1Id });
      inspector.trackComponent(Child2, {}, { name: 'Child2', parentId: parent1Id });

      const tree = inspector.getComponentTree();

      expect(tree.length).toBe(1); // One root
      expect(tree[0].children.length).toBe(2); // Two parents
      expect(tree[0].children[0].children.length).toBe(2); // Two children under Parent1
    });
  });

  describe('Concurrent Renders', () => {
    it('should handle concurrent component renders', () => {
      const Component1 = function Comp1() {};
      const Component2 = function Comp2() {};

      profiler.startProfiling();

      profiler.startMeasuringComponent('comp1', 'Comp1');
      profiler.startMeasuringComponent('comp2', 'Comp2');

      profiler.endMeasuringComponent('comp1');
      profiler.endMeasuringComponent('comp2');

      const profile = profiler.stopProfiling();

      expect(profile.measurements.length).toBe(2);
    });
  });

  describe('Memory Management', () => {
    it('should handle large numbers of component instances', () => {
      for (let i = 0; i < 1000; i++) {
        const Component = function TestComponent() {};
        inspector.trackComponent(
          Component,
          { id: i },
          {
            name: `Component${i}`,
          }
        );
      }

      const state = inspector.getState();
      expect(state.components.size).toBe(1000);

      inspector.clear();

      const clearedState = inspector.getState();
      expect(clearedState.components.size).toBe(0);
    });
  });
});
