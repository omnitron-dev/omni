/**
 * Pluralization Tests
 */

import { describe, it, expect } from 'vitest';
import { getPluralRule, selectPluralForm } from '../../src/i18n/pluralization.js';

describe('Pluralization', () => {
  describe('English Plural Rules', () => {
    it('should return "one" for 1', () => {
      const rule = getPluralRule('en');
      expect(rule(1)).toBe('one');
    });

    it('should return "other" for other numbers', () => {
      const rule = getPluralRule('en');
      expect(rule(0)).toBe('other');
      expect(rule(2)).toBe('other');
      expect(rule(5)).toBe('other');
      expect(rule(100)).toBe('other');
    });
  });

  describe('Russian Plural Rules', () => {
    it('should return "one" for 1, 21, 31, etc.', () => {
      const rule = getPluralRule('ru');
      expect(rule(1)).toBe('one');
      expect(rule(21)).toBe('one');
      expect(rule(31)).toBe('one');
      expect(rule(101)).toBe('one');
    });

    it('should return "few" for 2-4, 22-24, etc.', () => {
      const rule = getPluralRule('ru');
      expect(rule(2)).toBe('few');
      expect(rule(3)).toBe('few');
      expect(rule(4)).toBe('few');
      expect(rule(22)).toBe('few');
      expect(rule(23)).toBe('few');
    });

    it('should return "many" for 0, 5-20, 25-30, etc.', () => {
      const rule = getPluralRule('ru');
      expect(rule(0)).toBe('many');
      expect(rule(5)).toBe('many');
      expect(rule(10)).toBe('many');
      expect(rule(11)).toBe('many');
      expect(rule(20)).toBe('many');
      expect(rule(25)).toBe('many');
    });

    it('should return "other" for fractional numbers', () => {
      const rule = getPluralRule('ru');
      expect(rule(1.5)).toBe('other');
      expect(rule(2.3)).toBe('other');
    });
  });

  describe('Arabic Plural Rules', () => {
    it('should return "zero" for 0', () => {
      const rule = getPluralRule('ar');
      expect(rule(0)).toBe('zero');
    });

    it('should return "one" for 1', () => {
      const rule = getPluralRule('ar');
      expect(rule(1)).toBe('one');
    });

    it('should return "two" for 2', () => {
      const rule = getPluralRule('ar');
      expect(rule(2)).toBe('two');
    });

    it('should return "few" for 3-10', () => {
      const rule = getPluralRule('ar');
      expect(rule(3)).toBe('few');
      expect(rule(5)).toBe('few');
      expect(rule(10)).toBe('few');
    });

    it('should return "many" for 11-99', () => {
      const rule = getPluralRule('ar');
      expect(rule(11)).toBe('many');
      expect(rule(50)).toBe('many');
      expect(rule(99)).toBe('many');
    });

    it('should return "other" for 100+', () => {
      const rule = getPluralRule('ar');
      expect(rule(100)).toBe('other');
      expect(rule(1000)).toBe('other');
    });
  });

  describe('Japanese Plural Rules', () => {
    it('should always return "other"', () => {
      const rule = getPluralRule('ja');
      expect(rule(0)).toBe('other');
      expect(rule(1)).toBe('other');
      expect(rule(2)).toBe('other');
      expect(rule(100)).toBe('other');
    });
  });

  describe('selectPluralForm', () => {
    it('should select correct form based on count', () => {
      const forms = {
        one: '1 item',
        other: '{count} items',
      };

      expect(selectPluralForm(1, forms, 'en')).toBe('1 item');
      expect(selectPluralForm(5, forms, 'en')).toBe('{count} items');
    });

    it('should fall back to "other" if form not found', () => {
      const forms = {
        other: '{count} items',
      };

      expect(selectPluralForm(1, forms, 'en')).toBe('{count} items');
    });

    it('should handle locale with region code', () => {
      const forms = {
        one: '1 item',
        other: '{count} items',
      };

      expect(selectPluralForm(1, forms, 'en-US')).toBe('1 item');
      expect(selectPluralForm(5, forms, 'en-GB')).toBe('{count} items');
    });
  });
});
