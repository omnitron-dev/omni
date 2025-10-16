import { describe, expect, it } from 'vitest';
import {
  interpolate,
  interpolateObject,
  hasVariables,
  extractVariables
} from '../../../src/config/interpolation';

describe('Interpolation', () => {
  describe('interpolate', () => {
    it('should interpolate variables', () => {
      const result = interpolate('Hello ${name}!', {
        variables: { name: 'World' }
      });
      expect(result).toBe('Hello World!');
    });

    it('should interpolate environment variables', () => {
      const result = interpolate('Path: ${env.HOME}', {
        variables: {},
        env: { HOME: '/home/user' }
      });
      expect(result).toBe('Path: /home/user');
    });

    it('should keep original if variable not found', () => {
      const result = interpolate('Hello ${unknown}!', {
        variables: {}
      });
      expect(result).toBe('Hello ${unknown}!');
    });

    it('should handle multiple variables', () => {
      const result = interpolate('${greeting} ${name}!', {
        variables: { greeting: 'Hello', name: 'World' }
      });
      expect(result).toBe('Hello World!');
    });
  });

  describe('interpolateObject', () => {
    it('should interpolate strings in object', () => {
      const obj = {
        message: 'Hello ${name}!',
        nested: {
          value: '${value}'
        }
      };

      const result = interpolateObject(obj, {
        variables: { name: 'World', value: '42' }
      });

      expect(result.message).toBe('Hello World!');
      expect(result.nested.value).toBe('42');
    });

    it('should interpolate arrays', () => {
      const obj = {
        items: ['${item1}', '${item2}']
      };

      const result = interpolateObject(obj, {
        variables: { item1: 'first', item2: 'second' }
      });

      expect(result.items).toEqual(['first', 'second']);
    });

    it('should handle non-string values', () => {
      const obj = {
        number: 42,
        boolean: true,
        null: null
      };

      const result = interpolateObject(obj, { variables: {} });

      expect(result).toEqual(obj);
    });
  });

  describe('hasVariables', () => {
    it('should detect variables', () => {
      expect(hasVariables('Hello ${name}!')).toBe(true);
      expect(hasVariables('No variables here')).toBe(false);
    });
  });

  describe('extractVariables', () => {
    it('should extract variable names', () => {
      const vars = extractVariables('Hello ${name}, you are ${age} years old!');
      expect(vars).toEqual(['name', 'age']);
    });

    it('should not extract env variables', () => {
      const vars = extractVariables('Path: ${env.HOME}');
      expect(vars).toEqual([]);
    });

    it('should return empty array for no variables', () => {
      const vars = extractVariables('No variables here');
      expect(vars).toEqual([]);
    });
  });
});
