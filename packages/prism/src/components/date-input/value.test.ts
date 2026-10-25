import { describe, expect, it } from 'vitest';
import { parseCalendarValue, formatCalendarValue } from './value.js';
describe('calendar and wall-clock serialization', () => {
  it('preserves dates and local seconds without a timezone conversion', () => {
    for (const [kind, value] of [
      ['date', '1984-02-29'],
      ['date', '0001-01-01'],
      ['date', '0099-12-31'],
      ['time', '00:00:17'],
      ['datetime', '2026-03-29T02:30:17'],
    ] as const) {
      const parsed = parseCalendarValue(value, kind);
      expect(parsed?.isValid()).toBe(true);
      expect(formatCalendarValue(parsed, kind, 'second')).toBe(value);
    }
    // This local time is in a DST gap in Europe/Berlin. A birth wall value is
    // evidence, not a device-local instant; rejecting it belongs to its zone resolver.
    expect(formatCalendarValue(parseCalendarValue('2026-03-29T02:30', 'datetime'), 'datetime', 'minute')).toBe(
      '2026-03-29T02:30'
    );
  });
  it('does not normalize overflow, partial input, UTC timestamps or invalid leap days', () => {
    for (const value of ['2025-02-29', '2026-13-01', '2026-02-30', '2026-1-1', '2026-10-', '2026-10-25Z']) {
      expect(parseCalendarValue(value, 'date')?.isValid()).toBe(false);
    }
    for (const value of ['24:00', '12:60', '12:30:60', '2:00', '12:30Z']) {
      expect(parseCalendarValue(value, 'time')?.isValid()).toBe(false);
    }
    expect(parseCalendarValue('2026-10-25T12:30+03:00', 'datetime')?.isValid()).toBe(false);
  });
  it('distinguishes clear from invalid input and preserves an explicitly supplied second', () => {
    expect(parseCalendarValue('', 'date')).toBeNull();
    expect(parseCalendarValue('invalid', 'date')?.isValid()).toBe(false);
    expect(formatCalendarValue(null, 'date', 'minute')).toBe('');
    expect(formatCalendarValue(parseCalendarValue('19:42', 'time'), 'time', 'second')).toBe('19:42:00');
  });
});
