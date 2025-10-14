/**
 * Reactive Props Tests
 */

import { describe, it, expect, vi } from 'vitest';
import { reactiveProps, PROPS_UPDATE } from '../../../../src/core/component/props.js';
import { signal } from '../../../../src/core/reactivity/signal.js';
import { effect } from '../../../../src/core/reactivity/effect.js';
import { computed } from '../../../../src/core/reactivity/computed.js';

describe('reactiveProps', () => {
  describe('Basic functionality', () => {
    it('should create a reactive proxy from props object', () => {
      const props = { name: 'Alice', age: 30 };
      const reactive = reactiveProps(props);

      expect(reactive.name).toBe('Alice');
      expect(reactive.age).toBe(30);
    });

    it('should have PROPS_UPDATE method for updating props', () => {
      const props = { name: 'Alice' };
      const reactive = reactiveProps(props);

      expect(typeof reactive[PROPS_UPDATE]).toBe('function');
    });

    it('should update props when PROPS_UPDATE is called', () => {
      const props = { name: 'Alice', age: 30 };
      const reactive = reactiveProps(props);

      expect(reactive.name).toBe('Alice');

      reactive[PROPS_UPDATE]!({ name: 'Bob', age: 25 });

      expect(reactive.name).toBe('Bob');
      expect(reactive.age).toBe(25);
    });

    it('should handle function props correctly', () => {
      const onClick = vi.fn();
      const props = { onClick };
      const reactive = reactiveProps(props);

      // Call the function
      reactive.onClick();

      expect(onClick).toHaveBeenCalled();
    });

    it('should preserve this context for functions', () => {
      const props = {
        value: 42,
        getValue(this: any) {
          return this.value;
        },
      };

      const reactive = reactiveProps(props);

      // Function should be bound to props object
      const result = reactive.getValue();

      expect(result).toBe(42);
    });
  });

  describe('Reactivity', () => {
    it('should create reactive dependency when accessed in effect', () => {
      const props = { count: 0 };
      const reactive = reactiveProps(props);

      const spy = vi.fn();

      effect(() => {
        spy(reactive.count);
      });

      // Initial call
      expect(spy).toHaveBeenCalledWith(0);
      expect(spy).toHaveBeenCalledTimes(1);

      // Update props
      reactive[PROPS_UPDATE]!({ count: 1 });

      // Effect should re-run
      expect(spy).toHaveBeenCalledWith(1);
      expect(spy).toHaveBeenCalledTimes(2);
    });

    it('should create reactive dependency for multiple properties', () => {
      const props = { firstName: 'Alice', lastName: 'Smith' };
      const reactive = reactiveProps(props);

      const spy = vi.fn();

      effect(() => {
        spy(`${reactive.firstName} ${reactive.lastName}`);
      });

      expect(spy).toHaveBeenCalledWith('Alice Smith');
      expect(spy).toHaveBeenCalledTimes(1);

      // Update first name
      reactive[PROPS_UPDATE]!({ firstName: 'Bob', lastName: 'Smith' });

      expect(spy).toHaveBeenCalledWith('Bob Smith');
      expect(spy).toHaveBeenCalledTimes(2);

      // Update last name
      reactive[PROPS_UPDATE]!({ firstName: 'Bob', lastName: 'Jones' });

      expect(spy).toHaveBeenCalledWith('Bob Jones');
      expect(spy).toHaveBeenCalledTimes(3);
    });

    it('should work with computed values', () => {
      const props = { firstName: 'Alice', lastName: 'Smith' };
      const reactive = reactiveProps(props);

      const fullName = computed(() => `${reactive.firstName} ${reactive.lastName}`);

      expect(fullName()).toBe('Alice Smith');

      reactive[PROPS_UPDATE]!({ firstName: 'Bob', lastName: 'Smith' });

      expect(fullName()).toBe('Bob Smith');
    });

    it('should not create dependency when accessed outside reactive context', () => {
      const props = { count: 0 };
      const reactive = reactiveProps(props);

      // Access outside effect - should not track
      const value = reactive.count;

      expect(value).toBe(0);

      const spy = vi.fn();

      effect(() => {
        spy('effect ran');
      });

      // Effect should run once
      expect(spy).toHaveBeenCalledTimes(1);

      // Update props - effect should NOT re-run (no dependency created)
      reactive[PROPS_UPDATE]!({ count: 1 });

      // Effect should still be called once
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('should handle nested object props', () => {
      const props = { user: { name: 'Alice', age: 30 } };
      const reactive = reactiveProps(props);

      const spy = vi.fn();

      effect(() => {
        spy(reactive.user);
      });

      expect(spy).toHaveBeenCalledWith({ name: 'Alice', age: 30 });
      expect(spy).toHaveBeenCalledTimes(1);

      reactive[PROPS_UPDATE]!({ user: { name: 'Bob', age: 25 } });

      expect(spy).toHaveBeenCalledWith({ name: 'Bob', age: 25 });
      expect(spy).toHaveBeenCalledTimes(2);
    });

    it('should handle array props', () => {
      const props = { items: [1, 2, 3] };
      const reactive = reactiveProps(props);

      const spy = vi.fn();

      effect(() => {
        spy(reactive.items.length);
      });

      expect(spy).toHaveBeenCalledWith(3);
      expect(spy).toHaveBeenCalledTimes(1);

      reactive[PROPS_UPDATE]!({ items: [1, 2, 3, 4] });

      expect(spy).toHaveBeenCalledWith(4);
      expect(spy).toHaveBeenCalledTimes(2);
    });
  });

  describe('Integration with signals', () => {
    it('should work when props contain signals', () => {
      const count = signal(0);
      const props = { count };
      const reactive = reactiveProps(props);

      expect(reactive.count()).toBe(0);

      count.set(1);

      expect(reactive.count()).toBe(1);
    });

    it('should create dependencies when accessing signal props in effect', () => {
      const count = signal(0);
      const props = { count };
      const reactive = reactiveProps(props);

      const spy = vi.fn();

      effect(() => {
        spy(reactive.count());
      });

      expect(spy).toHaveBeenCalledWith(0);
      expect(spy).toHaveBeenCalledTimes(1);

      count.set(1);

      expect(spy).toHaveBeenCalledWith(1);
      expect(spy).toHaveBeenCalledTimes(2);
    });

    it('should handle mixed signal and regular props', () => {
      const count = signal(10);
      const props = { count, name: 'Alice' };
      const reactive = reactiveProps(props);

      const spy = vi.fn();

      effect(() => {
        spy(`${reactive.name}: ${reactive.count()}`);
      });

      expect(spy).toHaveBeenCalledWith('Alice: 10');
      expect(spy).toHaveBeenCalledTimes(1);

      // Update signal
      count.set(20);

      expect(spy).toHaveBeenCalledWith('Alice: 20');
      expect(spy).toHaveBeenCalledTimes(2);

      // Update name via PROPS_UPDATE
      reactive[PROPS_UPDATE]!({ count, name: 'Bob' });

      expect(spy).toHaveBeenCalledWith('Bob: 20');
      expect(spy).toHaveBeenCalledTimes(3);
    });
  });

  describe('Edge cases', () => {
    it('should handle undefined props', () => {
      const props = { value: undefined };
      const reactive = reactiveProps(props);

      expect(reactive.value).toBeUndefined();
    });

    it('should handle null props', () => {
      const props = { value: null };
      const reactive = reactiveProps(props);

      expect(reactive.value).toBeNull();
    });

    it('should handle empty props object', () => {
      const props = {};
      const reactive = reactiveProps(props);

      expect(Object.keys(reactive)).toEqual([]);
    });

    it('should handle symbol keys', () => {
      const sym = Symbol('test');
      const props = { [sym]: 'value' };
      const reactive = reactiveProps(props);

      expect(reactive[sym]).toBe('value');
    });

    it('should support hasOwnProperty checks', () => {
      const props = { name: 'Alice', age: 30 };
      const reactive = reactiveProps(props);

      expect('name' in reactive).toBe(true);
      expect('email' in reactive).toBe(false);
    });

    it('should support Object.keys()', () => {
      const props = { name: 'Alice', age: 30 };
      const reactive = reactiveProps(props);

      const keys = Object.keys(reactive);

      expect(keys).toContain('name');
      expect(keys).toContain('age');
    });
  });
});
