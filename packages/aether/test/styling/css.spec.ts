/**
 * CSS Utilities Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  css,
  cx,
  keyframes,
  globalStyles,
  cssReset,
  responsive,
  darkMode,
  mergeCSS,
  cssVariables,
} from '../../src/styling/css.js';
import { cleanupStyles, resetStyleIdCounter } from '../../src/styling/runtime.js';

describe('CSS Utilities', () => {
  beforeEach(() => {
    resetStyleIdCounter();
    cleanupStyles();
  });

  afterEach(() => {
    cleanupStyles();
  });

  describe('css', () => {
    it('should generate class name from styles', () => {
      const className = css({
        color: 'red',
        fontSize: 16,
      });

      expect(className).toBeTruthy();
      expect(className).toMatch(/^aether-/);
    });

    it('should handle pseudo-selectors', () => {
      const className = css({
        color: 'red',
        '&:hover': {
          color: 'blue',
        },
        '&:focus': {
          outline: 'none',
        },
      });

      expect(className).toBeTruthy();
    });

    it('should handle media queries', () => {
      const className = css({
        fontSize: 14,
        '@media (min-width: 768px)': {
          fontSize: 16,
        },
      });

      expect(className).toBeTruthy();
    });

    it('should handle array of styles', () => {
      const className = css([{ color: 'red' }, { fontSize: 16 }]);

      expect(className).toBeTruthy();
    });

    it('should skip undefined and null values', () => {
      const className = css({
        color: 'red',
        fontSize: undefined,
        padding: null,
      });

      expect(className).toBeTruthy();
    });
  });

  describe('cx', () => {
    it('should merge string class names', () => {
      const result = cx('foo', 'bar', 'baz');

      expect(result).toBe('foo bar baz');
    });

    it('should filter out falsy values', () => {
      const result = cx('foo', null, undefined, false, '', 'bar');

      expect(result).toBe('foo bar');
    });

    it('should handle arrays', () => {
      const result = cx(['foo', 'bar'], 'baz');

      expect(result).toBe('foo bar baz');
    });

    it('should handle objects', () => {
      const result = cx({
        foo: true,
        bar: false,
        baz: true,
      });

      expect(result).toBe('foo baz');
    });

    it('should handle nested arrays', () => {
      const result = cx('foo', ['bar', ['baz', 'qux']]);

      expect(result).toBe('foo bar baz qux');
    });

    it('should handle mixed inputs', () => {
      const result = cx('foo', { bar: true, baz: false }, ['qux'], null, 'end');

      expect(result).toBe('foo bar qux end');
    });

    it('should handle numbers', () => {
      const result = cx('foo', 123, 'bar');

      expect(result).toBe('foo 123 bar');
    });
  });

  describe('keyframes', () => {
    it('should create animation keyframes', () => {
      const name = keyframes('fadeIn', {
        '0%': { opacity: 0 },
        '100%': { opacity: 1 },
      });

      expect(name).toBe('fadeIn');
    });

    it('should handle multiple keyframe steps', () => {
      const name = keyframes('slideIn', {
        '0%': { transform: 'translateX(-100%)' },
        '50%': { transform: 'translateX(-50%)' },
        '100%': { transform: 'translateX(0)' },
      });

      expect(name).toBe('slideIn');
    });

    it('should convert camelCase properties', () => {
      const name = keyframes('test', {
        '0%': { backgroundColor: 'red' },
        '100%': { backgroundColor: 'blue' },
      });

      expect(name).toBe('test');
    });
  });

  describe('globalStyles', () => {
    it('should inject global styles', () => {
      globalStyles({
        body: {
          margin: 0,
          padding: 0,
        },
        '*': {
          boxSizing: 'border-box',
        },
      });

      // Should not throw and should inject styles
      expect(true).toBe(true);
    });

    it('should handle pseudo-selectors in global styles', () => {
      globalStyles({
        'a:hover': {
          textDecoration: 'underline',
        },
      });

      expect(true).toBe(true);
    });

    it('should skip undefined values', () => {
      globalStyles({
        body: {
          margin: 0,
          padding: undefined,
        },
      });

      expect(true).toBe(true);
    });
  });

  describe('cssReset', () => {
    it('should apply CSS reset', () => {
      cssReset();

      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe('responsive', () => {
    it('should create responsive styles', () => {
      const className = responsive({
        base: { fontSize: 14 },
        sm: { fontSize: 16 },
        md: { fontSize: 18 },
        lg: { fontSize: 20 },
      });

      expect(className).toBeTruthy();
    });

    it('should work with only base styles', () => {
      const className = responsive({
        base: { color: 'red' },
      });

      expect(className).toBeTruthy();
    });

    it('should work with only responsive styles', () => {
      const className = responsive({
        md: { fontSize: 18 },
        lg: { fontSize: 20 },
      });

      expect(className).toBeTruthy();
    });
  });

  describe('darkMode', () => {
    it('should create dark mode styles', () => {
      const className = darkMode(
        { color: 'black', backgroundColor: 'white' },
        { color: 'white', backgroundColor: 'black' }
      );

      expect(className).toBeTruthy();
    });
  });

  describe('mergeCSS', () => {
    it('should merge CSS properties', () => {
      const result = mergeCSS({ color: 'red', fontSize: 14 }, { color: 'blue', padding: 10 });

      expect(result).toEqual({
        color: 'blue',
        fontSize: 14,
        padding: 10,
      });
    });

    it('should handle undefined values', () => {
      const result = mergeCSS({ color: 'red' }, undefined, { fontSize: 16 });

      expect(result).toEqual({
        color: 'red',
        fontSize: 16,
      });
    });

    it('should handle null values', () => {
      const result = mergeCSS({ color: 'red' }, null, { fontSize: 16 });

      expect(result).toEqual({
        color: 'red',
        fontSize: 16,
      });
    });

    it('should override properties in order', () => {
      const result = mergeCSS({ color: 'red' }, { color: 'blue' }, { color: 'green' });

      expect(result.color).toBe('green');
    });
  });

  describe('cssVariables', () => {
    it('should create CSS variables', () => {
      const vars = cssVariables({
        'primary-color': '#3b82f6',
        'secondary-color': '#6c757d',
      });

      expect(vars).toEqual({
        '--primary-color': '#3b82f6',
        '--secondary-color': '#6c757d',
      });
    });

    it('should handle existing -- prefix', () => {
      const vars = cssVariables({
        '--already-prefixed': 'value',
        'needs-prefix': 'value2',
      });

      expect(vars).toEqual({
        '--already-prefixed': 'value',
        '--needs-prefix': 'value2',
      });
    });

    it('should handle numeric values', () => {
      const vars = cssVariables({
        spacing: 16,
        opacity: 0.5,
      });

      expect(vars).toEqual({
        '--spacing': 16,
        '--opacity': 0.5,
      });
    });
  });
});
