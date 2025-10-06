import { describe, it, expect } from 'vitest';
import { signal } from '../../../src/core/reactivity/signal';
import {
  classNames,
  cx,
  classes,
  reactiveClasses,
  toggleClass,
  conditionalClasses,
  variantClasses,
  mergeClasses,
} from '../../../src/utils/classes';

describe('Class Utilities', () => {
  describe('classNames', () => {
    it('should combine string class names', () => {
      const result = classNames('foo', 'bar', 'baz');
      expect(result).toBe('foo bar baz');
    });

    it('should filter out falsy values', () => {
      const result = classNames('foo', undefined, 'bar', null, 'baz', false);
      expect(result).toBe('foo bar baz');
    });

    it('should handle arrays', () => {
      const result = classNames('foo', ['bar', 'baz']);
      expect(result).toBe('foo bar baz');
    });

    it('should handle conditional objects', () => {
      const result = classNames('base', {
        active: true,
        disabled: false,
        hidden: true,
      });
      expect(result).toBe('base active hidden');
    });

    it('should handle function conditions', () => {
      const isActive = () => true;
      const isDisabled = () => false;

      const result = classNames('base', {
        active: isActive,
        disabled: isDisabled,
      });
      expect(result).toBe('base active');
    });

    it('should handle mixed inputs', () => {
      const result = classNames(
        'base',
        ['foo', 'bar'],
        { active: true, disabled: false },
        undefined,
        'baz'
      );
      expect(result).toBe('base foo bar active baz');
    });
  });

  describe('cx (alias)', () => {
    it('should be an alias for classNames', () => {
      expect(cx).toBe(classNames);
    });
  });

  describe('classes', () => {
    it('should combine base and conditional classes', () => {
      const result = classes('btn', {
        'btn-primary': true,
        'btn-disabled': false,
      });
      expect(result).toBe('btn btn-primary');
    });

    it('should handle array base classes', () => {
      const result = classes(['btn', 'btn-lg'], {
        active: true,
      });
      expect(result).toBe('btn btn-lg active');
    });

    it('should handle function conditions', () => {
      const isActive = () => true;
      const result = classes('btn', {
        active: isActive,
      });
      expect(result).toBe('btn active');
    });
  });

  describe('reactiveClasses', () => {
    it('should evaluate function to get class string', () => {
      const isActive = signal(true);
      const result = reactiveClasses(() =>
        classNames('base', { active: isActive() })
      );
      expect(result).toBe('base active');
    });

    it('should work with reactive signals', () => {
      const theme = signal('dark');
      const result = reactiveClasses(() => `theme-${theme()}`);
      expect(result).toBe('theme-dark');
    });
  });

  describe('toggleClass', () => {
    it('should return class name when condition is true', () => {
      const result = toggleClass('active', true);
      expect(result).toBe('active');
    });

    it('should return empty string when condition is false', () => {
      const result = toggleClass('active', false);
      expect(result).toBe('');
    });

    it('should handle function conditions', () => {
      const isActive = () => true;
      const result = toggleClass('active', isActive);
      expect(result).toBe('active');
    });
  });

  describe('conditionalClasses', () => {
    it('should return classes for true conditions', () => {
      const result = conditionalClasses({
        active: true,
        disabled: false,
        hidden: true,
      });
      expect(result).toBe('active hidden');
    });

    it('should handle function conditions', () => {
      const isActive = () => true;
      const isDisabled = () => false;

      const result = conditionalClasses({
        active: isActive,
        disabled: isDisabled,
      });
      expect(result).toBe('active');
    });

    it('should return empty string when all conditions are false', () => {
      const result = conditionalClasses({
        active: false,
        disabled: false,
      });
      expect(result).toBe('');
    });
  });

  describe('variantClasses', () => {
    it('should apply variant classes', () => {
      const variants = {
        primary: 'btn-primary',
        secondary: 'btn-secondary',
        sm: 'btn-sm',
        lg: 'btn-lg',
      };

      const result = variantClasses('btn', variants, ['primary', 'lg']);
      expect(result).toBe('btn btn-primary btn-lg');
    });

    it('should handle single variant', () => {
      const variants = {
        primary: 'btn-primary',
        secondary: 'btn-secondary',
      };

      const result = variantClasses('btn', variants, 'primary');
      expect(result).toBe('btn btn-primary');
    });

    it('should handle function for active variant', () => {
      const variants = {
        primary: 'btn-primary',
        secondary: 'btn-secondary',
      };

      const getVariant = () => 'secondary';
      const result = variantClasses('btn', variants, getVariant);
      expect(result).toBe('btn btn-secondary');
    });

    it('should handle array base classes', () => {
      const variants = {
        primary: 'btn-primary',
      };

      const result = variantClasses(['btn', 'rounded'], variants, 'primary');
      expect(result).toBe('btn rounded btn-primary');
    });

    it('should filter out undefined variants', () => {
      const variants = {
        primary: 'btn-primary',
        secondary: 'btn-secondary',
      };

      const result = variantClasses('btn', variants, ['primary', 'unknown']);
      expect(result).toBe('btn btn-primary');
    });
  });

  describe('mergeClasses', () => {
    it('should merge multiple class strings', () => {
      const result = mergeClasses('foo bar', 'baz qux');
      expect(result).toBe('foo bar baz qux');
    });

    it('should remove duplicates', () => {
      const result = mergeClasses('foo bar', 'bar baz', 'foo qux');
      expect(result).toBe('foo bar baz qux');
    });

    it('should filter out undefined and null', () => {
      const result = mergeClasses('foo', undefined, 'bar', null, 'baz');
      expect(result).toBe('foo bar baz');
    });

    it('should handle empty strings', () => {
      const result = mergeClasses('foo', '', 'bar');
      expect(result).toBe('foo bar');
    });

    it('should preserve order while removing duplicates', () => {
      const result = mergeClasses('a b c', 'c d e', 'e f g');
      // First occurrence of each class is preserved
      expect(result).toBe('a b c d e f g');
    });
  });

  describe('Integration tests', () => {
    it('should work with reactive signals', () => {
      const isActive = signal(true);
      const isDisabled = signal(false);

      const result = classNames('btn', {
        active: isActive,
        disabled: () => isDisabled(),
      });

      expect(result).toBe('btn active');

      isActive.set(false);
      isDisabled.set(true);

      const result2 = classNames('btn', {
        active: isActive,
        disabled: () => isDisabled(),
      });

      expect(result2).toBe('btn disabled');
    });

    it('should compose multiple utilities', () => {
      const variant = signal<'primary' | 'secondary'>('primary');
      const size = signal<'sm' | 'lg'>('lg');
      const isActive = signal(true);

      const variants = {
        primary: 'btn-primary',
        secondary: 'btn-secondary',
        sm: 'btn-sm',
        lg: 'btn-lg',
      };

      const base = variantClasses('btn', variants, [variant(), size()]);
      const conditional = conditionalClasses({ active: isActive });
      const result = mergeClasses(base, conditional);

      expect(result).toBe('btn btn-primary btn-lg active');
    });
  });
});
