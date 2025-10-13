/**
 * Formatters Tests
 */

import { describe, it, expect } from 'vitest';
import { createFormatters } from '../../src/i18n/formatters.js';

describe('Formatters', () => {
  describe('Number Formatting', () => {
    it('should format numbers', () => {
      const formatters = createFormatters('en-US');
      const result = formatters.number(1234.56);
      expect(result).toMatch(/1[,\s]?234/);
    });

    it('should format numbers with options', () => {
      const formatters = createFormatters('en-US');
      const result = formatters.number(1234.56, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      expect(result).toMatch(/1[,\s]?234\.56/);
    });

    it('should respect locale', () => {
      const enFormatters = createFormatters('en-US');
      const deFormatters = createFormatters('de-DE');

      // Just verify both produce valid output
      expect(enFormatters.number(1234.56)).toBeTruthy();
      expect(deFormatters.number(1234.56)).toBeTruthy();
    });
  });

  describe('Currency Formatting', () => {
    it('should format currency', () => {
      const formatters = createFormatters('en-US');
      const result = formatters.currency(99.99, 'USD');
      expect(result).toContain('99.99');
      expect(result).toMatch(/\$/);
    });

    it('should support different currencies', () => {
      const formatters = createFormatters('en-US');

      const usd = formatters.currency(100, 'USD');
      const eur = formatters.currency(100, 'EUR');

      expect(usd).toBeTruthy();
      expect(eur).toBeTruthy();
      expect(usd).not.toBe(eur);
    });

    it('should respect locale for currency', () => {
      const enFormatters = createFormatters('en-US');
      const frFormatters = createFormatters('fr-FR');

      const enResult = enFormatters.currency(1234.56, 'EUR');
      const frResult = frFormatters.currency(1234.56, 'EUR');

      expect(enResult).toBeTruthy();
      expect(frResult).toBeTruthy();
    });
  });

  describe('Percent Formatting', () => {
    it('should format percentages', () => {
      const formatters = createFormatters('en-US');
      const result = formatters.percent(0.75);
      expect(result).toContain('75');
      expect(result).toContain('%');
    });

    it('should handle decimal percentages', () => {
      const formatters = createFormatters('en-US');
      const result = formatters.percent(0.1234, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      expect(result).toMatch(/12\.34/);
    });
  });

  describe('Date Formatting', () => {
    it('should format dates', () => {
      const formatters = createFormatters('en-US');
      const date = new Date('2024-01-15T12:00:00Z');
      const result = formatters.date(date);
      expect(result).toBeTruthy();
    });

    it('should format dates with timestamp', () => {
      const formatters = createFormatters('en-US');
      const timestamp = new Date('2024-01-15').getTime();
      const result = formatters.date(timestamp);
      expect(result).toBeTruthy();
    });

    it('should format dates with string', () => {
      const formatters = createFormatters('en-US');
      const result = formatters.date('2024-01-15');
      expect(result).toBeTruthy();
    });

    it('should support date styles', () => {
      const formatters = createFormatters('en-US');
      const date = new Date('2024-01-15');

      const short = formatters.date(date, { dateStyle: 'short' });
      const long = formatters.date(date, { dateStyle: 'long' });

      expect(short).toBeTruthy();
      expect(long).toBeTruthy();
      expect(long.length).toBeGreaterThan(short.length);
    });
  });

  describe('Time Formatting', () => {
    it('should format time', () => {
      const formatters = createFormatters('en-US');
      const date = new Date('2024-01-15T14:30:00Z');
      const result = formatters.time(date);
      expect(result).toMatch(/\d{1,2}:\d{2}/);
    });

    it('should support time styles', () => {
      const formatters = createFormatters('en-US');
      const date = new Date('2024-01-15T14:30:45Z');

      const short = formatters.time(date, { timeStyle: 'short' });
      const long = formatters.time(date, { timeStyle: 'long' });

      expect(short).toBeTruthy();
      expect(long).toBeTruthy();
    });
  });

  describe('DateTime Formatting', () => {
    it('should format date and time', () => {
      const formatters = createFormatters('en-US');
      const date = new Date('2024-01-15T14:30:00Z');
      const result = formatters.dateTime(date);
      expect(result).toBeTruthy();
    });

    it('should support date and time styles', () => {
      const formatters = createFormatters('en-US');
      const date = new Date('2024-01-15T14:30:00Z');

      const result = formatters.dateTime(date, {
        dateStyle: 'short',
        timeStyle: 'short',
      });

      expect(result).toBeTruthy();
    });
  });

  describe('Relative Time Formatting', () => {
    it('should format relative time in seconds', () => {
      const formatters = createFormatters('en-US');
      const now = Date.now();
      const past = now - 30 * 1000; // 30 seconds ago

      const result = formatters.relativeTime(past);
      expect(result).toContain('second');
    });

    it('should format relative time in minutes', () => {
      const formatters = createFormatters('en-US');
      const now = Date.now();
      const past = now - 5 * 60 * 1000; // 5 minutes ago

      const result = formatters.relativeTime(past);
      expect(result).toContain('minute');
    });

    it('should format relative time in hours', () => {
      const formatters = createFormatters('en-US');
      const now = Date.now();
      const past = now - 3 * 60 * 60 * 1000; // 3 hours ago

      const result = formatters.relativeTime(past);
      expect(result).toContain('hour');
    });

    it('should format relative time in days', () => {
      const formatters = createFormatters('en-US');
      const now = Date.now();
      const past = now - 2 * 24 * 60 * 60 * 1000; // 2 days ago

      const result = formatters.relativeTime(past);
      expect(result).toContain('day');
    });

    it('should handle future dates', () => {
      const formatters = createFormatters('en-US');
      const now = Date.now();
      const future = now + 2 * 60 * 60 * 1000; // 2 hours from now

      const result = formatters.relativeTime(future);
      expect(result).toContain('hour');
    });
  });

  describe('List Formatting', () => {
    it('should format lists', () => {
      const formatters = createFormatters('en-US');
      const result = formatters.list(['Alice', 'Bob', 'Charlie']);
      expect(result).toContain('Alice');
      expect(result).toContain('Bob');
      expect(result).toContain('Charlie');
    });

    it('should handle empty lists', () => {
      const formatters = createFormatters('en-US');
      const result = formatters.list([]);
      expect(result).toBe('');
    });

    it('should handle single item', () => {
      const formatters = createFormatters('en-US');
      const result = formatters.list(['Alice']);
      expect(result).toBe('Alice');
    });

    it('should handle two items', () => {
      const formatters = createFormatters('en-US');
      const result = formatters.list(['Alice', 'Bob']);
      expect(result).toContain('Alice');
      expect(result).toContain('Bob');
    });

    it('should support disjunction type', () => {
      const formatters = createFormatters('en-US');
      const result = formatters.list(['Alice', 'Bob', 'Charlie'], { type: 'disjunction' });
      expect(result).toContain('Alice');
      expect(result).toContain('Bob');
      expect(result).toContain('Charlie');
    });
  });
});
