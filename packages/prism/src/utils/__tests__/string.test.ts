/**
 * Tests for string utilities
 */
import { describe, it, expect } from 'vitest';
import {
  truncate,
  getInitials,
  capitalize,
  titleCase,
  kebabCase,
  camelCase,
  snakeCase,
  highlightText,
  escapeRegExp,
  containsIgnoreCase,
  isBlank,
  isEmail,
  isUrl,
  randomString,
  uuid,
  slugify,
} from '../string.js';

describe('string utilities', () => {
  describe('truncate', () => {
    it('truncates long text with ellipsis', () => {
      expect(truncate('Hello, World!', 8)).toBe('Hello...');
    });

    it('returns text unchanged if shorter than length', () => {
      expect(truncate('Short', 10)).toBe('Short');
    });

    it('uses custom suffix', () => {
      expect(truncate('Hello, World!', 9, '…')).toBe('Hello, W…');
    });

    it('handles null/undefined', () => {
      expect(truncate(null, 10)).toBe('');
      expect(truncate(undefined, 10)).toBe('');
    });

    it('handles exact length match', () => {
      expect(truncate('Hello', 5)).toBe('Hello');
    });
  });

  describe('getInitials', () => {
    it('returns initials for two-word name', () => {
      expect(getInitials('John Doe')).toBe('JD');
    });

    it('returns first and last initials for multi-word name', () => {
      expect(getInitials('Alice Bob Charlie')).toBe('AC');
    });

    it('returns first two letters for single name', () => {
      expect(getInitials('SingleName')).toBe('SI');
    });

    it('handles null/undefined', () => {
      expect(getInitials(null)).toBe('');
      expect(getInitials(undefined)).toBe('');
    });

    it('handles empty string', () => {
      expect(getInitials('')).toBe('');
    });
  });

  describe('capitalize', () => {
    it('capitalizes first letter', () => {
      expect(capitalize('hello world')).toBe('Hello world');
    });

    it('handles already capitalized', () => {
      expect(capitalize('Hello')).toBe('Hello');
    });

    it('handles null/undefined', () => {
      expect(capitalize(null)).toBe('');
      expect(capitalize(undefined)).toBe('');
    });
  });

  describe('titleCase', () => {
    it('capitalizes each word', () => {
      expect(titleCase('hello world')).toBe('Hello World');
    });

    it('handles multiple words', () => {
      expect(titleCase('the quick brown fox')).toBe('The Quick Brown Fox');
    });

    it('handles null/undefined', () => {
      expect(titleCase(null)).toBe('');
      expect(titleCase(undefined)).toBe('');
    });
  });

  describe('kebabCase', () => {
    it('converts space-separated to kebab', () => {
      expect(kebabCase('Hello World')).toBe('hello-world');
    });

    it('converts camelCase to kebab', () => {
      expect(kebabCase('camelCaseString')).toBe('camel-case-string');
    });

    it('handles underscores', () => {
      expect(kebabCase('hello_world')).toBe('hello-world');
    });

    it('handles null/undefined', () => {
      expect(kebabCase(null)).toBe('');
      expect(kebabCase(undefined)).toBe('');
    });
  });

  describe('camelCase', () => {
    it('converts space-separated to camel', () => {
      expect(camelCase('Hello World')).toBe('helloWorld');
    });

    it('converts kebab-case to camel', () => {
      expect(camelCase('kebab-case-string')).toBe('kebabCaseString');
    });

    it('handles null/undefined', () => {
      expect(camelCase(null)).toBe('');
      expect(camelCase(undefined)).toBe('');
    });
  });

  describe('snakeCase', () => {
    it('converts space-separated to snake', () => {
      expect(snakeCase('Hello World')).toBe('hello_world');
    });

    it('converts camelCase to snake', () => {
      expect(snakeCase('camelCaseString')).toBe('camel_case_string');
    });

    it('handles hyphens', () => {
      expect(snakeCase('hello-world')).toBe('hello_world');
    });

    it('handles null/undefined', () => {
      expect(snakeCase(null)).toBe('');
      expect(snakeCase(undefined)).toBe('');
    });
  });

  describe('highlightText', () => {
    it('highlights search query with mark tags', () => {
      expect(highlightText('Hello World', 'wor')).toBe('Hello <mark>Wor</mark>ld');
    });

    it('uses custom tags', () => {
      expect(highlightText('Test Case', 'test', '<strong>', '</strong>')).toBe('<strong>Test</strong> Case');
    });

    it('handles no match', () => {
      expect(highlightText('Hello World', 'xyz')).toBe('Hello World');
    });

    it('handles null/undefined', () => {
      expect(highlightText(null, 'test')).toBe('');
      expect(highlightText('text', null)).toBe('text');
    });

    it('handles special regex characters in query', () => {
      expect(highlightText('test.string', '.')).toBe('test<mark>.</mark>string');
    });
  });

  describe('escapeRegExp', () => {
    it('escapes special regex characters', () => {
      expect(escapeRegExp('test.string+with[special]chars')).toBe('test\\.string\\+with\\[special\\]chars');
    });

    it('handles multiple special characters', () => {
      expect(escapeRegExp('a*b?c^d$e')).toBe('a\\*b\\?c\\^d\\$e');
    });
  });

  describe('containsIgnoreCase', () => {
    it('returns true for case-insensitive match', () => {
      expect(containsIgnoreCase('Hello World', 'WORLD')).toBe(true);
    });

    it('returns false for no match', () => {
      expect(containsIgnoreCase('Hello World', 'foo')).toBe(false);
    });

    it('handles null/undefined', () => {
      expect(containsIgnoreCase(null, 'test')).toBe(false);
      expect(containsIgnoreCase('test', null)).toBe(false);
    });
  });

  describe('isBlank', () => {
    it('returns true for empty string', () => {
      expect(isBlank('')).toBe(true);
    });

    it('returns true for whitespace only', () => {
      expect(isBlank('   ')).toBe(true);
      expect(isBlank('\t\n')).toBe(true);
    });

    it('returns false for non-empty string', () => {
      expect(isBlank('hello')).toBe(false);
    });

    it('returns true for null/undefined', () => {
      expect(isBlank(null)).toBe(true);
      expect(isBlank(undefined)).toBe(true);
    });
  });

  describe('isEmail', () => {
    it('returns true for valid email', () => {
      expect(isEmail('test@example.com')).toBe(true);
      expect(isEmail('user.name+tag@domain.co')).toBe(true);
    });

    it('returns false for invalid email', () => {
      expect(isEmail('invalid')).toBe(false);
      expect(isEmail('test@')).toBe(false);
      expect(isEmail('@example.com')).toBe(false);
    });

    it('handles null/undefined', () => {
      expect(isEmail(null)).toBe(false);
      expect(isEmail(undefined)).toBe(false);
    });
  });

  describe('isUrl', () => {
    it('returns true for valid URL', () => {
      expect(isUrl('https://example.com')).toBe(true);
      expect(isUrl('http://localhost:3000')).toBe(true);
      expect(isUrl('ftp://files.example.com')).toBe(true);
    });

    it('returns false for invalid URL', () => {
      expect(isUrl('not-a-url')).toBe(false);
      expect(isUrl('/relative/path')).toBe(false);
    });

    it('handles null/undefined', () => {
      expect(isUrl(null)).toBe(false);
      expect(isUrl(undefined)).toBe(false);
    });
  });

  describe('randomString', () => {
    it('generates string of specified length', () => {
      expect(randomString(8).length).toBe(8);
      expect(randomString(16).length).toBe(16);
    });

    it('uses default length of 8', () => {
      expect(randomString().length).toBe(8);
    });

    it('uses custom character set', () => {
      const result = randomString(10, 'abc');
      expect(result).toMatch(/^[abc]{10}$/);
    });

    it('generates different strings', () => {
      const str1 = randomString(20);
      const str2 = randomString(20);
      expect(str1).not.toBe(str2);
    });
  });

  describe('uuid', () => {
    it('generates valid UUID v4 format', () => {
      const id = uuid();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it('generates unique UUIDs', () => {
      const ids = new Set(Array.from({ length: 100 }, () => uuid()));
      expect(ids.size).toBe(100);
    });
  });

  describe('slugify', () => {
    it('converts text to slug', () => {
      expect(slugify('Hello World!')).toBe('hello-world');
    });

    it('handles multiple spaces', () => {
      expect(slugify('This is a Test  String')).toBe('this-is-a-test-string');
    });

    it('removes special characters', () => {
      expect(slugify('Hello! @World#')).toBe('hello-world');
    });

    it('handles null/undefined', () => {
      expect(slugify(null)).toBe('');
      expect(slugify(undefined)).toBe('');
    });

    it('trims leading/trailing hyphens', () => {
      expect(slugify('--hello world--')).toBe('hello-world');
    });
  });
});
