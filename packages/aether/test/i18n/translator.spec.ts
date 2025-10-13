/**
 * Translator Tests
 */

import { describe, it, expect } from 'vitest';
import { Translator } from '../../src/i18n/translator.js';

describe('Translator', () => {
  describe('Basic Translation', () => {
    it('should translate simple messages', () => {
      const translator = new Translator('en', {
        en: {
          hello: 'Hello',
          goodbye: 'Goodbye',
        },
      });

      expect(translator.translate('hello')).toBe('Hello');
      expect(translator.translate('goodbye')).toBe('Goodbye');
    });

    it('should return key if translation not found', () => {
      const translator = new Translator('en', {
        en: {},
      });

      expect(translator.translate('missing.key')).toBe('missing.key');
    });

    it('should support nested keys', () => {
      const translator = new Translator('en', {
        en: {
          user: {
            profile: {
              title: 'User Profile',
            },
          },
        },
      });

      expect(translator.translate('user.profile.title')).toBe('User Profile');
    });
  });

  describe('Interpolation', () => {
    it('should interpolate values', () => {
      const translator = new Translator('en', {
        en: {
          greeting: 'Hello, {name}!',
        },
      });

      expect(translator.translate('greeting', { name: 'Alice' })).toBe('Hello, Alice!');
    });

    it('should interpolate multiple values', () => {
      const translator = new Translator('en', {
        en: {
          message: '{greeting}, {name}! You have {count} messages.',
        },
      });

      expect(
        translator.translate('message', {
          greeting: 'Hi',
          name: 'Bob',
          count: 5,
        })
      ).toBe('Hi, Bob! You have 5 messages.');
    });

    it('should handle missing values', () => {
      const translator = new Translator('en', {
        en: {
          greeting: 'Hello, {name}!',
        },
      });

      expect(translator.translate('greeting', {})).toBe('Hello, {name}!');
    });
  });

  describe('Pluralization', () => {
    it('should handle plural forms', () => {
      const translator = new Translator('en', {
        en: {
          items: {
            one: '1 item',
            other: '{count} items',
          },
        },
      });

      expect(translator.translate('items', { count: 0 })).toBe('0 items');
      expect(translator.translate('items', { count: 1 })).toBe('1 item');
      expect(translator.translate('items', { count: 5 })).toBe('5 items');
    });

    it('should handle complex plural rules', () => {
      const translator = new Translator('ru', {
        ru: {
          items: {
            one: '{count} предмет',
            few: '{count} предмета',
            many: '{count} предметов',
            other: '{count} предметов',
          },
        },
      });

      expect(translator.translate('items', { count: 1 })).toBe('1 предмет');
      expect(translator.translate('items', { count: 2 })).toBe('2 предмета');
      expect(translator.translate('items', { count: 5 })).toBe('5 предметов');
    });
  });

  describe('Fallback', () => {
    it('should fall back to fallback locale', () => {
      const translator = new Translator(
        'fr',
        {
          en: {
            hello: 'Hello',
          },
          fr: {},
        },
        ['en']
      );

      expect(translator.translate('hello')).toBe('Hello');
    });

    it('should prefer current locale over fallback', () => {
      const translator = new Translator(
        'fr',
        {
          en: {
            hello: 'Hello',
          },
          fr: {
            hello: 'Bonjour',
          },
        },
        ['en']
      );

      expect(translator.translate('hello')).toBe('Bonjour');
    });
  });

  describe('Locale Management', () => {
    it('should change locale', () => {
      const translator = new Translator('en', {
        en: {
          hello: 'Hello',
        },
        fr: {
          hello: 'Bonjour',
        },
      });

      expect(translator.translate('hello')).toBe('Hello');

      translator.setLocale('fr');
      expect(translator.translate('hello')).toBe('Bonjour');
    });

    it('should add messages dynamically', () => {
      const translator = new Translator('en', {});

      translator.addMessages('en', {
        hello: 'Hello',
      });

      expect(translator.translate('hello')).toBe('Hello');
    });

    it('should merge messages', () => {
      const translator = new Translator('en', {
        en: {
          hello: 'Hello',
        },
      });

      translator.addMessages('en', {
        goodbye: 'Goodbye',
      });

      expect(translator.translate('hello')).toBe('Hello');
      expect(translator.translate('goodbye')).toBe('Goodbye');
    });
  });

  describe('Formatting', () => {
    it('should format numbers', () => {
      const translator = new Translator('en', {
        en: {
          price: 'Price: {amount, number}',
        },
      });

      expect(translator.translate('price', { amount: 1234.56 })).toMatch(/1[,\s]?234/);
    });

    it('should format dates', () => {
      const translator = new Translator('en', {
        en: {
          date: 'Date: {value, date}',
        },
      });

      const date = new Date('2024-01-15');
      const result = translator.translate('date', { value: date });
      expect(result).toContain('Date:');
    });
  });
});
