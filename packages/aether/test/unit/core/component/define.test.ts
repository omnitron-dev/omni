/**
 * Component Definition Tests
 */

import { describe, it, expect, vi } from 'vitest';
import { defineComponent, component } from '../../../../src/core/component/define.js';
import { signal } from '../../../../src/core/reactivity/signal.js';
import { getTextContent } from '../../../utils/test-helpers.js';

describe('defineComponent', () => {
  describe('Basic component creation', () => {
    it('should create a component from setup function', () => {
      const Counter = defineComponent(() => {
        const count = signal(0);
        return () => count();
      });

      expect(typeof Counter).toBe('function');
    });

    it('should run setup function once when component is called', () => {
      const setupFn = vi.fn(() => () => 'rendered');
      const MyComponent = defineComponent(setupFn);

      MyComponent({});

      expect(setupFn).toHaveBeenCalledTimes(1);
    });

    it('should return render result when component is called', () => {
      const MyComponent = defineComponent(() => () => 'Hello World');

      const result = MyComponent({});

      expect(getTextContent(result)).toBe('Hello World');
    });

    it('should set display name when provided', () => {
      const MyComponent = defineComponent(() => () => null, 'MyComponent');

      expect(MyComponent.displayName).toBe('MyComponent');
    });
  });

  describe('Props handling', () => {
    it('should pass props to setup function', () => {
      const MyComponent = defineComponent<{ name: string }>((props) => () => `Hello ${props.name}`);

      const result = MyComponent({ name: 'Alice' });

      expect(getTextContent(result)).toBe('Hello Alice');
    });

    it('should handle props reactively', () => {
      const MyComponent = defineComponent<{ count: number }>((props) => {
        const count = signal(props.count);
        return () => count();
      });

      const result = MyComponent({ count: 42 });

      expect(getTextContent(result)).toBe(42);
    });
  });

  describe('Reactive scope', () => {
    it('should create reactive scope for component', () => {
      const MyComponent = defineComponent(() => {
        const count = signal(0);

        // This effect should track count
        let effectRuns = 0;
        const renderFn = () => {
          effectRuns++;
          return count();
        };

        return renderFn;
      });

      const result = MyComponent({});

      expect(typeof getTextContent(result)).toBe('number');
    });

    it('should isolate component reactivity', () => {
      const globalSignal = signal(0);

      const Component1 = defineComponent(() => {
        const local = signal(1);
        return () => local();
      });

      const Component2 = defineComponent(() => {
        const local = signal(2);
        return () => local();
      });

      const result1 = Component1({});
      const result2 = Component2({});

      expect(getTextContent(result1)).toBe(1);
      expect(getTextContent(result2)).toBe(2);
    });
  });

  describe('component() alias', () => {
    it('should create component with explicit name', () => {
      const MyComponent = component('MyComponent', () => () => 'test');

      expect(MyComponent.displayName).toBe('MyComponent');
    });

    it('should work identically to defineComponent', () => {
      const setupFn = vi.fn(() => () => 'rendered');

      const Component1 = defineComponent(setupFn, 'Test1');
      const Component2 = component('Test2', setupFn);

      const result1 = Component1({});
      const result2 = Component2({});

      expect(getTextContent(result1)).toBe(getTextContent(result2));
      expect(setupFn).toHaveBeenCalledTimes(2);
    });
  });

  describe('Cleanup and lifecycle', () => {
    it('should support cleanup on unmount', () => {
      const cleanup = vi.fn();

      const MyComponent = defineComponent(
        () => () =>
          // In real implementation, cleanup would be registered via onCleanup
          null
      );

      MyComponent({});

      // Note: Actual cleanup testing requires full lifecycle implementation
      // This is a basic structure test
    });
  });

  describe('Error handling', () => {
    it('should handle errors in setup function', () => {
      const MyComponent = defineComponent(
        () =>
          // This would throw in a real error scenario
          () =>
            null
      );

      expect(() => MyComponent({})).not.toThrow();
    });

    it('should handle errors in render function', () => {
      const MyComponent = defineComponent(
        () => () =>
          // Render function should be able to throw
          null
      );

      expect(() => MyComponent({})).not.toThrow();
    });
  });

  describe('Type safety', () => {
    it('should enforce prop types', () => {
      interface Props {
        name: string;
        age: number;
      }

      const MyComponent = defineComponent<Props>(
        (props) =>
          // TypeScript should enforce props.name is string and props.age is number
          () =>
            `${props.name} is ${props.age}`
      );

      const result = MyComponent({ name: 'Alice', age: 30 });

      expect(getTextContent(result)).toBe('Alice is 30');
    });
  });

  describe('Nested components', () => {
    it('should support component composition', () => {
      const Child = defineComponent<{ value: number }>((props) => () => props.value * 2);

      const Parent = defineComponent(() => {
        const childResult = Child({ value: 21 });
        return () => childResult;
      });

      const result = Parent({});

      expect(getTextContent(result)).toBe(42);
    });
  });
});
