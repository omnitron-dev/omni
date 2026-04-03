/**
 * Validation Utilities Unit Tests
 */
import { describe, it, expect } from 'vitest';
import {
  isValidDefId,
  isValidPropertyName,
  isValidServiceName,
  parseQualifiedServiceName,
  createValidationError,
  validateRpcInputs,
  escapeRegex,
  createPatternRegex,
  MAX_LENGTHS,
} from '../../src/utils/validation.js';

describe('Validation Utilities', () => {
  describe('isValidDefId', () => {
    it('should accept valid UUID v4', () => {
      expect(isValidDefId('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
      expect(isValidDefId('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
    });

    it('should reject invalid UUIDs', () => {
      expect(isValidDefId('invalid')).toBe(false);
      expect(isValidDefId('550e8400-e29b-41d4-a716')).toBe(false); // too short
      expect(isValidDefId('550e8400-e29b-41d4-a716-446655440000-extra')).toBe(false); // too long
      expect(isValidDefId('')).toBe(false);
      expect(isValidDefId(null)).toBe(false);
      expect(isValidDefId(undefined)).toBe(false);
      expect(isValidDefId(123)).toBe(false);
    });
  });

  describe('isValidPropertyName', () => {
    it('should accept valid property names', () => {
      expect(isValidPropertyName('myMethod')).toBe(true);
      expect(isValidPropertyName('_privateVar')).toBe(true);
      expect(isValidPropertyName('$special')).toBe(true);
      expect(isValidPropertyName('camelCase')).toBe(true);
      expect(isValidPropertyName('PascalCase')).toBe(true);
      expect(isValidPropertyName('with123Numbers')).toBe(true);
    });

    it('should reject invalid property names', () => {
      expect(isValidPropertyName('123invalid')).toBe(false); // starts with number
      expect(isValidPropertyName('has-hyphen')).toBe(false);
      expect(isValidPropertyName('has space')).toBe(false);
      expect(isValidPropertyName('')).toBe(false);
      expect(isValidPropertyName(null)).toBe(false);
      expect(isValidPropertyName(123)).toBe(false);
    });

    it('should reject very long names', () => {
      const longName = 'a'.repeat(257);
      expect(isValidPropertyName(longName)).toBe(false);
    });
  });

  describe('isValidServiceName', () => {
    it('should accept valid service names', () => {
      expect(isValidServiceName('userService')).toBe(true);
      expect(isValidServiceName('user-service')).toBe(true);
      expect(isValidServiceName('user.service')).toBe(true);
      expect(isValidServiceName('user_service')).toBe(true);
      expect(isValidServiceName('UserService@1.0.0')).toBe(true);
      expect(isValidServiceName('my.nested.service@2.1.0')).toBe(true);
    });

    it('should reject invalid service names', () => {
      expect(isValidServiceName('')).toBe(false);
      expect(isValidServiceName('has space')).toBe(false);
      expect(isValidServiceName('has@multiple@at')).toBe(false);
      expect(isValidServiceName(null)).toBe(false);
    });
  });

  describe('parseQualifiedServiceName', () => {
    it('should parse service name without version', () => {
      const result = parseQualifiedServiceName('userService');
      expect(result.name).toBe('userService');
      expect(result.version).toBeUndefined();
      expect(result.isWildcard).toBe(false);
    });

    it('should parse service name with version', () => {
      const result = parseQualifiedServiceName('userService@1.0.0');
      expect(result.name).toBe('userService');
      expect(result.version).toBe('1.0.0');
      expect(result.isWildcard).toBe(false);
    });

    it('should identify wildcard version', () => {
      const result = parseQualifiedServiceName('userService@*');
      expect(result.name).toBe('userService');
      expect(result.version).toBe('*');
      expect(result.isWildcard).toBe(true);
    });

    it('should handle nested names with version', () => {
      const result = parseQualifiedServiceName('my.nested.service@2.1.0');
      expect(result.name).toBe('my.nested.service');
      expect(result.version).toBe('2.1.0');
    });
  });

  describe('createValidationError', () => {
    it('should create error messages for different types', () => {
      expect(createValidationError('defId', 'invalid')).toContain('Invalid definition ID');
      expect(createValidationError('propertyName', '123bad')).toContain('Invalid property/method name');
      expect(createValidationError('serviceName', 'bad name')).toContain('Invalid service name');
    });

    it('should truncate long values', () => {
      const longValue = 'a'.repeat(100);
      const error = createValidationError('defId', longValue);
      expect(error).toContain('...');
      expect(error.length).toBeLessThan(100 + 100); // Message + truncated value
    });
  });

  describe('validateRpcInputs', () => {
    it('should not throw for valid inputs', () => {
      expect(() => validateRpcInputs('550e8400-e29b-41d4-a716-446655440000', 'myMethod')).not.toThrow();
    });

    it('should throw for invalid defId', () => {
      expect(() => validateRpcInputs('invalid', 'myMethod')).toThrow('Invalid definition ID');
    });

    it('should throw for invalid property name', () => {
      expect(() => validateRpcInputs('550e8400-e29b-41d4-a716-446655440000', '123bad')).toThrow(
        'Invalid property/method name'
      );
    });
  });

  describe('escapeRegex', () => {
    it('should escape special regex characters', () => {
      expect(escapeRegex('test.*+?')).toBe('test\\.\\*\\+\\?');
      expect(escapeRegex('a^b$c')).toBe('a\\^b\\$c');
      expect(escapeRegex('(group)')).toBe('\\(group\\)');
      expect(escapeRegex('[chars]')).toBe('\\[chars\\]');
    });

    it('should leave normal characters unchanged', () => {
      expect(escapeRegex('normalText')).toBe('normalText');
      expect(escapeRegex('with123numbers')).toBe('with123numbers');
    });
  });

  describe('createPatternRegex', () => {
    it('should create regex from wildcard pattern', () => {
      const regex = createPatternRegex('user*');
      expect(regex.test('userService')).toBe(true);
      expect(regex.test('userManager')).toBe(true);
      expect(regex.test('authService')).toBe(false);
    });

    it('should handle multiple wildcards', () => {
      const regex = createPatternRegex('*Service*');
      expect(regex.test('userServiceV2')).toBe(true);
      expect(regex.test('ServiceManager')).toBe(true);
    });

    it('should escape special characters in pattern', () => {
      const regex = createPatternRegex('test.service*');
      expect(regex.test('test.service123')).toBe(true);
      expect(regex.test('testXservice123')).toBe(false);
    });
  });

  describe('MAX_LENGTHS', () => {
    it('should have expected limits', () => {
      expect(MAX_LENGTHS.PROPERTY_NAME).toBe(256);
      expect(MAX_LENGTHS.SERVICE_NAME).toBe(512);
      expect(MAX_LENGTHS.DEF_ID).toBe(36);
    });
  });
});
