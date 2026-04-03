/**
 * Tests for format-number utilities
 */
import { describe, it, expect } from 'vitest';
import {
  fNumber,
  fCurrency,
  fPercent,
  fShortenNumber,
  fBytes,
  fOrdinal,
  fDecimal,
  getPercentage,
  calculatePercentageChange,
  getCurrencySymbol,
  fNumberWithSign,
  fCompact,
} from '../format-number.js';

describe('format-number utilities', () => {
  describe('fNumber', () => {
    it('formats number with commas', () => {
      expect(fNumber(1234567.89)).toBe('1,234,567.89');
    });

    it('formats string numbers', () => {
      expect(fNumber('1234567.89')).toBe('1,234,567.89');
    });

    it('respects locale option', () => {
      expect(fNumber(1234567.89, { locale: 'de-DE' })).toBe('1.234.567,89');
    });

    it('handles null/undefined/empty', () => {
      expect(fNumber(null)).toBe('');
      expect(fNumber(undefined)).toBe('');
      expect(fNumber('')).toBe('');
    });

    it('handles NaN', () => {
      expect(fNumber(NaN)).toBe('');
      expect(fNumber('not-a-number')).toBe('');
    });
  });

  describe('fCurrency', () => {
    it('formats as USD by default', () => {
      expect(fCurrency(1234.56)).toBe('$1,234.56');
    });

    it('formats other currencies', () => {
      const result = fCurrency(1234.56, { currency: 'EUR', locale: 'de-DE' });
      expect(result).toContain('1.234,56');
      expect(result).toContain('€');
    });

    it('handles JPY (no decimals)', () => {
      expect(fCurrency(1234.56, { currency: 'JPY' })).toBe('¥1,235');
    });

    it('handles null/undefined/empty', () => {
      expect(fCurrency(null)).toBe('');
      expect(fCurrency(undefined)).toBe('');
      expect(fCurrency('')).toBe('');
    });
  });

  describe('fPercent', () => {
    it('formats decimal as percentage', () => {
      expect(fPercent(0.1234)).toBe('12.34%');
    });

    it('respects maximumFractionDigits', () => {
      expect(fPercent(0.1234, { maximumFractionDigits: 0 })).toBe('12%');
    });

    it('handles values over 1', () => {
      expect(fPercent(1.5)).toBe('150%');
    });

    it('handles null/undefined/empty', () => {
      expect(fPercent(null)).toBe('');
      expect(fPercent(undefined)).toBe('');
    });
  });

  describe('fShortenNumber', () => {
    it('shortens thousands with K', () => {
      expect(fShortenNumber(1234)).toBe('1.23K');
    });

    it('shortens millions with M', () => {
      expect(fShortenNumber(1234567)).toBe('1.23M');
    });

    it('shortens billions with B', () => {
      expect(fShortenNumber(1234567890)).toBe('1.23B');
    });

    it('shortens trillions with T', () => {
      expect(fShortenNumber(1234567890000)).toBe('1.23T');
    });

    it('handles custom decimal places', () => {
      expect(fShortenNumber(1234, 1)).toBe('1.2K');
    });

    it('handles small numbers', () => {
      expect(fShortenNumber(123, 2)).toBe('123.00');
    });

    it('handles null/undefined/empty', () => {
      expect(fShortenNumber(null)).toBe('');
      expect(fShortenNumber(undefined)).toBe('');
    });

    it('handles negative numbers', () => {
      expect(fShortenNumber(-1234567)).toBe('-1.23M');
    });
  });

  describe('fBytes', () => {
    it('formats bytes', () => {
      expect(fBytes(500)).toBe('500.00 Bytes');
    });

    it('formats kilobytes', () => {
      expect(fBytes(1024)).toBe('1.00 KB');
    });

    it('formats megabytes', () => {
      expect(fBytes(1048576)).toBe('1.00 MB');
    });

    it('formats gigabytes', () => {
      expect(fBytes(1073741824)).toBe('1.00 GB');
    });

    it('handles zero', () => {
      expect(fBytes(0)).toBe('0 Bytes');
    });

    it('handles null/undefined/empty', () => {
      expect(fBytes(null)).toBe('');
      expect(fBytes(undefined)).toBe('');
    });

    it('handles custom decimals', () => {
      expect(fBytes(1536, 1)).toBe('1.5 KB');
    });
  });

  describe('fOrdinal', () => {
    it('formats 1st', () => {
      expect(fOrdinal(1)).toBe('1st');
    });

    it('formats 2nd', () => {
      expect(fOrdinal(2)).toBe('2nd');
    });

    it('formats 3rd', () => {
      expect(fOrdinal(3)).toBe('3rd');
    });

    it('formats 4th and higher', () => {
      expect(fOrdinal(4)).toBe('4th');
      expect(fOrdinal(11)).toBe('11th');
      expect(fOrdinal(12)).toBe('12th');
      expect(fOrdinal(13)).toBe('13th');
    });

    it('formats 21st, 22nd, 23rd', () => {
      expect(fOrdinal(21)).toBe('21st');
      expect(fOrdinal(22)).toBe('22nd');
      expect(fOrdinal(23)).toBe('23rd');
    });

    it('handles null/undefined', () => {
      expect(fOrdinal(null)).toBe('');
      expect(fOrdinal(undefined)).toBe('');
    });
  });

  describe('fDecimal', () => {
    it('formats with default 2 decimals', () => {
      expect(fDecimal(1234.5678)).toBe('1234.57');
    });

    it('formats with custom decimals', () => {
      expect(fDecimal(1234.5678, 4)).toBe('1234.5678');
    });

    it('pads with zeros', () => {
      expect(fDecimal(1234)).toBe('1234.00');
    });

    it('handles null/undefined/empty', () => {
      expect(fDecimal(null)).toBe('');
      expect(fDecimal(undefined)).toBe('');
    });
  });

  describe('getPercentage', () => {
    it('calculates percentage', () => {
      expect(getPercentage(25, 100)).toBe(25);
    });

    it('handles decimals', () => {
      expect(getPercentage(1, 3, 2)).toBe(33.33);
    });

    it('handles zero total', () => {
      expect(getPercentage(50, 0)).toBe(0);
    });

    it('calculates fractions correctly', () => {
      expect(getPercentage(50, 200)).toBe(25);
    });
  });

  describe('calculatePercentageChange', () => {
    it('calculates increase', () => {
      expect(calculatePercentageChange(150, 100)).toBe(50);
    });

    it('calculates decrease', () => {
      expect(calculatePercentageChange(50, 100)).toBe(-50);
    });

    it('handles no change', () => {
      expect(calculatePercentageChange(100, 100)).toBe(0);
    });

    it('handles zero previous value', () => {
      expect(calculatePercentageChange(100, 0)).toBe(100);
      expect(calculatePercentageChange(0, 0)).toBe(0);
    });

    it('respects decimals', () => {
      expect(calculatePercentageChange(120, 100, 1)).toBe(20);
    });
  });

  describe('getCurrencySymbol', () => {
    it('returns USD symbol', () => {
      expect(getCurrencySymbol('USD')).toBe('$');
    });

    it('returns EUR symbol', () => {
      expect(getCurrencySymbol('EUR')).toBe('€');
    });

    it('returns JPY symbol', () => {
      expect(getCurrencySymbol('JPY')).toBe('¥');
    });

    it('returns GBP symbol', () => {
      expect(getCurrencySymbol('GBP')).toBe('£');
    });
  });

  describe('fNumberWithSign', () => {
    it('adds + for positive numbers', () => {
      expect(fNumberWithSign(25)).toBe('+25');
    });

    it('preserves - for negative numbers', () => {
      expect(fNumberWithSign(-25)).toBe('-25');
    });

    it('returns no sign for zero', () => {
      expect(fNumberWithSign(0)).toBe('0');
    });

    it('handles null/undefined/empty', () => {
      expect(fNumberWithSign(null)).toBe('');
      expect(fNumberWithSign(undefined)).toBe('');
    });

    it('respects format options', () => {
      expect(fNumberWithSign(25.5, { maximumFractionDigits: 1 })).toBe('+25.5');
    });
  });

  describe('fCompact', () => {
    it('formats thousands compactly', () => {
      const result = fCompact(1234);
      expect(result).toMatch(/1\.?2?K/);
    });

    it('formats millions compactly', () => {
      const result = fCompact(1234567);
      expect(result).toMatch(/1\.?2?M/);
    });

    it('formats billions compactly', () => {
      const result = fCompact(1234567890);
      expect(result).toMatch(/1\.?2?B/);
    });

    it('handles null/undefined/empty', () => {
      expect(fCompact(null)).toBe('');
      expect(fCompact(undefined)).toBe('');
    });
  });
});
