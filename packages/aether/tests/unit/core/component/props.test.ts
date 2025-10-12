/**
 * Component Props Tests
 */

import { describe, it, expect } from 'vitest';
import { mergeProps, splitProps } from '../../../../src/core/component/props.js';
import { signal } from '../../../../src/core/reactivity/signal.js';

describe('Props System', () => {
  describe('mergeProps', () => {
    it('should merge multiple prop objects', () => {
      const props1 = { a: 1, b: 2 };
      const props2 = { c: 3, d: 4 };

      const merged = mergeProps(props1, props2);

      expect(merged).toEqual({ a: 1, b: 2, c: 3, d: 4 });
    });

    it('should override earlier values with later ones', () => {
      const props1 = { a: 1, b: 2 };
      const props2 = { b: 3, c: 4 };

      const merged = mergeProps(props1, props2);

      expect(merged).toEqual({ a: 1, b: 3, c: 4 });
    });

    it('should handle default props pattern', () => {
      const defaults = { theme: 'light', size: 'medium' };
      const userProps = { theme: 'dark' };

      const merged = mergeProps(defaults, userProps);

      expect(merged).toEqual({ theme: 'dark', size: 'medium' });
    });

    it('should handle empty objects', () => {
      const merged = mergeProps({}, { a: 1 }, {});

      expect(merged).toEqual({ a: 1 });
    });

    it('should handle single object', () => {
      const props = { a: 1, b: 2 };
      const merged = mergeProps(props);

      expect(merged).toEqual(props);
    });

    it('should handle many objects', () => {
      const merged = mergeProps({ a: 1 }, { b: 2 }, { c: 3 }, { d: 4 }, { e: 5 });

      expect(merged).toEqual({ a: 1, b: 2, c: 3, d: 4, e: 5 });
    });

    it('should preserve reactive values', () => {
      const count = signal(42);
      const props1 = { count };
      const props2 = { name: 'test' };

      const merged = mergeProps(props1, props2);

      expect(merged.count()).toBe(42);
      expect(merged.name).toBe('test');
    });

    it('should handle undefined values', () => {
      const props1 = { a: 1, b: undefined };
      const props2 = { b: 2, c: undefined };

      const merged = mergeProps(props1, props2);

      expect(merged).toEqual({ a: 1, b: 2, c: undefined });
    });

    it('should handle null values', () => {
      const props1 = { a: 1, b: null };
      const props2 = { b: 2, c: null };

      const merged = mergeProps(props1, props2);

      expect(merged).toEqual({ a: 1, b: 2, c: null });
    });
  });

  describe('splitProps', () => {
    it('should split props into separate objects', () => {
      const props = { a: 1, b: 2, c: 3, d: 4 };

      const [group1, group2] = splitProps(props, ['a', 'b']);

      expect(group1).toEqual({ a: 1, b: 2 });
      expect(group2).toEqual({ c: 3, d: 4 });
    });

    it('should handle single key', () => {
      const props = { a: 1, b: 2, c: 3 };

      const [group1, rest] = splitProps(props, ['a']);

      expect(group1).toEqual({ a: 1 });
      expect(rest).toEqual({ b: 2, c: 3 });
    });

    it('should handle multiple split groups', () => {
      const props = { a: 1, b: 2, c: 3, d: 4, e: 5 };

      const [group1, group2, rest] = splitProps(props, ['a', 'b'], ['c', 'd']);

      expect(group1).toEqual({ a: 1, b: 2 });
      expect(group2).toEqual({ c: 3, d: 4 });
      expect(rest).toEqual({ e: 5 });
    });

    it('should handle non-existent keys', () => {
      const props = { a: 1, b: 2 };

      const [group1, rest] = splitProps(props, ['a', 'c' as any]);

      expect(group1).toEqual({ a: 1 });
      expect(rest).toEqual({ b: 2 });
    });

    it('should preserve reactive values', () => {
      const count = signal(42);
      const props = { count, name: 'test', age: 30 };

      const [reactive, static_] = splitProps(props, ['count']);

      expect(reactive.count()).toBe(42);
      expect(static_.name).toBe('test');
      expect(static_.age).toBe(30);
    });

    it('should handle empty split', () => {
      const props = { a: 1, b: 2 };

      const [group1, rest] = splitProps(props, []);

      expect(group1).toEqual({});
      expect(rest).toEqual({ a: 1, b: 2 });
    });

    it('should handle all keys split', () => {
      const props = { a: 1, b: 2 };

      const [group1, rest] = splitProps(props, ['a', 'b']);

      expect(group1).toEqual({ a: 1, b: 2 });
      expect(rest).toEqual({});
    });

    it('should support class and style extraction pattern', () => {
      const props = {
        class: 'my-class',
        style: { color: 'red' },
        onClick: () => {},
        data: 'value',
      };

      const [domProps, componentProps] = splitProps(props, ['class', 'style', 'onClick']);

      expect(domProps).toEqual({
        class: 'my-class',
        style: { color: 'red' },
        onClick: props.onClick,
      });
      expect(componentProps).toEqual({ data: 'value' });
    });

    it('should handle undefined and null values', () => {
      const props = { a: undefined, b: null, c: 1 };

      const [group1, rest] = splitProps(props, ['a', 'b']);

      expect(group1).toEqual({ a: undefined, b: null });
      expect(rest).toEqual({ c: 1 });
    });
  });

  describe('Props patterns', () => {
    it('should support default props with mergeProps', () => {
      interface ButtonProps {
        variant?: 'primary' | 'secondary';
        size?: 'small' | 'large';
        disabled?: boolean;
      }

      const defaultProps: Required<ButtonProps> = {
        variant: 'primary',
        size: 'large',
        disabled: false,
      };

      const userProps: ButtonProps = {
        variant: 'secondary',
      };

      const props = mergeProps(defaultProps, userProps);

      expect(props).toEqual({
        variant: 'secondary',
        size: 'large',
        disabled: false,
      });
    });

    it('should support prop forwarding pattern', () => {
      const inputProps = {
        type: 'text',
        placeholder: 'Enter text',
        value: 'hello',
        customProp: 'custom',
      };

      const [htmlProps, customProps] = splitProps(inputProps, ['type', 'placeholder', 'value']);

      expect(htmlProps).toEqual({
        type: 'text',
        placeholder: 'Enter text',
        value: 'hello',
      });
      expect(customProps).toEqual({ customProp: 'custom' });
    });

    it('should support multiple prop groups', () => {
      const allProps = {
        // DOM props
        class: 'container',
        id: 'main',
        // Event handlers
        onClick: () => {},
        onInput: () => {},
        // Custom props
        data: 'value',
        config: {},
      };

      const [domProps, eventProps, customProps] = splitProps(allProps, ['class', 'id'], ['onClick', 'onInput']);

      expect(domProps).toEqual({ class: 'container', id: 'main' });
      expect(eventProps).toEqual({
        onClick: allProps.onClick,
        onInput: allProps.onInput,
      });
      expect(customProps).toEqual({ data: 'value', config: {} });
    });

    it('should combine merge and split', () => {
      const defaults = { variant: 'primary', size: 'medium', disabled: false };
      const userProps = { variant: 'secondary', onClick: () => {} };

      const merged = mergeProps(defaults, userProps);
      const [styleProps, behaviorProps] = splitProps(merged, ['variant', 'size']);

      expect(styleProps).toEqual({ variant: 'secondary', size: 'medium' });
      expect(behaviorProps).toEqual({
        disabled: false,
        onClick: userProps.onClick,
      });
    });
  });

  describe('Type safety', () => {
    it('should maintain type information with mergeProps', () => {
      interface Props {
        name: string;
        age: number;
      }

      const defaults: Partial<Props> = { age: 0 };
      const userProps: Partial<Props> = { name: 'Alice' };

      const merged = mergeProps(defaults, userProps) as Props;

      // TypeScript should know these types
      expect(typeof merged.name).toBe('string');
      expect(typeof merged.age).toBe('number');
    });

    it('should maintain type information with splitProps', () => {
      interface Props {
        name: string;
        age: number;
        email: string;
      }

      const props: Props = { name: 'Alice', age: 30, email: 'alice@example.com' };

      const [personal, contact] = splitProps(props, ['name', 'age']);

      expect(personal.name).toBe('Alice');
      expect(personal.age).toBe(30);
      expect(contact.email).toBe('alice@example.com');
    });
  });
});
