/**
 * Date Formatting Utilities
 *
 * Locale-aware date formatting utilities using Intl.DateTimeFormat.
 * For more complex formatting, consider using dayjs or date-fns.
 *
 * @module @omnitron/prism/utils/format-date
 */

// =============================================================================
// TYPES
// =============================================================================

export type DateInput = Date | string | number | null | undefined;

export interface FormatDateOptions extends Intl.DateTimeFormatOptions {
  /** Locale for formatting (default: 'en-US') */
  locale?: string;
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Parse various date inputs into a Date object.
 */
function parseDate(input: DateInput): Date | null {
  if (input === null || input === undefined) {
    return null;
  }

  if (input instanceof Date) {
    return input;
  }

  const date = new Date(input);
  return Number.isNaN(date.getTime()) ? null : date;
}

// =============================================================================
// DATE FORMATTING
// =============================================================================

/**
 * Format a date with locale-aware formatting.
 *
 * @example
 * ```ts
 * fDate(new Date())
 * // => "Jan 15, 2025"
 *
 * fDate(new Date(), { locale: 'ru-RU' })
 * // => "15 янв. 2025 г."
 *
 * fDate('2025-01-15')
 * // => "Jan 15, 2025"
 * ```
 */
export function fDate(date: DateInput, options: FormatDateOptions = {}): string {
  const { locale = 'en-US', ...formatOptions } = options;

  const parsed = parseDate(date);
  if (!parsed) return '';

  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...formatOptions,
  }).format(parsed);
}

/**
 * Format a date with time.
 *
 * @example
 * ```ts
 * fDateTime(new Date())
 * // => "Jan 15, 2025, 2:30 PM"
 *
 * fDateTime(new Date(), { hour12: false })
 * // => "Jan 15, 2025, 14:30"
 * ```
 */
export function fDateTime(date: DateInput, options: FormatDateOptions = {}): string {
  const { locale = 'en-US', ...formatOptions } = options;

  const parsed = parseDate(date);
  if (!parsed) return '';

  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    ...formatOptions,
  }).format(parsed);
}

/**
 * Format time only.
 *
 * @example
 * ```ts
 * fTime(new Date())
 * // => "2:30 PM"
 *
 * fTime(new Date(), { hour12: false })
 * // => "14:30"
 *
 * fTime(new Date(), { second: 'numeric' })
 * // => "2:30:45 PM"
 * ```
 */
export function fTime(date: DateInput, options: FormatDateOptions = {}): string {
  const { locale = 'en-US', ...formatOptions } = options;

  const parsed = parseDate(date);
  if (!parsed) return '';

  return new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: 'numeric',
    ...formatOptions,
  }).format(parsed);
}

/**
 * Format a date as ISO string (YYYY-MM-DD).
 *
 * @example
 * ```ts
 * fDateISO(new Date())
 * // => "2025-01-15"
 * ```
 */
export function fDateISO(date: DateInput): string {
  const parsed = parseDate(date);
  if (!parsed) return '';

  return parsed.toISOString().split('T')[0];
}

/**
 * Format a timestamp as relative time (e.g., "2 hours ago").
 *
 * @example
 * ```ts
 * fRelativeTime(new Date(Date.now() - 3600000))
 * // => "1 hour ago"
 *
 * fRelativeTime(new Date(Date.now() + 86400000))
 * // => "in 1 day"
 *
 * fRelativeTime(new Date(Date.now() - 86400000 * 7))
 * // => "1 week ago"
 * ```
 */
export function fRelativeTime(date: DateInput, options: { locale?: string } = {}): string {
  const { locale = 'en-US' } = options;

  const parsed = parseDate(date);
  if (!parsed) return '';

  const now = new Date();
  const diffMs = parsed.getTime() - now.getTime();
  const diffSeconds = Math.round(diffMs / 1000);
  const diffMinutes = Math.round(diffSeconds / 60);
  const diffHours = Math.round(diffMinutes / 60);
  const diffDays = Math.round(diffHours / 24);
  const diffWeeks = Math.round(diffDays / 7);
  const diffMonths = Math.round(diffDays / 30);
  const diffYears = Math.round(diffDays / 365);

  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

  if (Math.abs(diffSeconds) < 60) {
    return rtf.format(diffSeconds, 'second');
  }
  if (Math.abs(diffMinutes) < 60) {
    return rtf.format(diffMinutes, 'minute');
  }
  if (Math.abs(diffHours) < 24) {
    return rtf.format(diffHours, 'hour');
  }
  if (Math.abs(diffDays) < 7) {
    return rtf.format(diffDays, 'day');
  }
  if (Math.abs(diffWeeks) < 4) {
    return rtf.format(diffWeeks, 'week');
  }
  if (Math.abs(diffMonths) < 12) {
    return rtf.format(diffMonths, 'month');
  }
  return rtf.format(diffYears, 'year');
}

/**
 * Format a duration in milliseconds to human-readable string.
 *
 * @example
 * ```ts
 * fDuration(3661000)
 * // => "1h 1m 1s"
 *
 * fDuration(90000)
 * // => "1m 30s"
 *
 * fDuration(1000)
 * // => "1s"
 * ```
 */
export function fDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || ms < 0) return '';

  const seconds = Math.floor((ms / 1000) % 60);
  const minutes = Math.floor((ms / (1000 * 60)) % 60);
  const hours = Math.floor((ms / (1000 * 60 * 60)) % 24);
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));

  const parts: string[] = [];

  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);

  return parts.join(' ');
}

/**
 * Check if a date is today.
 *
 * @example
 * ```ts
 * isToday(new Date())
 * // => true
 *
 * isToday(new Date('2020-01-01'))
 * // => false
 * ```
 */
export function isToday(date: DateInput): boolean {
  const parsed = parseDate(date);
  if (!parsed) return false;

  const today = new Date();
  return (
    parsed.getDate() === today.getDate() &&
    parsed.getMonth() === today.getMonth() &&
    parsed.getFullYear() === today.getFullYear()
  );
}

/**
 * Check if a date is yesterday.
 */
export function isYesterday(date: DateInput): boolean {
  const parsed = parseDate(date);
  if (!parsed) return false;

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  return (
    parsed.getDate() === yesterday.getDate() &&
    parsed.getMonth() === yesterday.getMonth() &&
    parsed.getFullYear() === yesterday.getFullYear()
  );
}

/**
 * Check if a date is within the current week.
 */
export function isThisWeek(date: DateInput): boolean {
  const parsed = parseDate(date);
  if (!parsed) return false;

  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay());
  weekStart.setHours(0, 0, 0, 0);

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);

  return parsed >= weekStart && parsed <= weekEnd;
}

/**
 * Check if a date is in the past.
 */
export function isPast(date: DateInput): boolean {
  const parsed = parseDate(date);
  if (!parsed) return false;

  return parsed.getTime() < Date.now();
}

/**
 * Check if a date is in the future.
 */
export function isFuture(date: DateInput): boolean {
  const parsed = parseDate(date);
  if (!parsed) return false;

  return parsed.getTime() > Date.now();
}

/**
 * Get the difference between two dates in days.
 */
export function diffInDays(date1: DateInput, date2: DateInput): number {
  const d1 = parseDate(date1);
  const d2 = parseDate(date2);

  if (!d1 || !d2) return 0;

  const diffTime = Math.abs(d2.getTime() - d1.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

// =============================================================================
// DATE RANGE UTILITIES (Aurora pattern)
// =============================================================================

/** One day in milliseconds */
const DAY_MS = 1000 * 60 * 60 * 24;

/**
 * Generate an array of dates between start and end.
 *
 * @param startDate - Start date
 * @param endDate - End date
 * @param interval - Interval in milliseconds (default: 1 day)
 * @returns Array of Date objects
 *
 * @example
 * ```ts
 * const dates = getDates(
 *   new Date('2025-01-01'),
 *   new Date('2025-01-07')
 * );
 * // => [Date(Jan 1), Date(Jan 2), ..., Date(Jan 7)]
 *
 * // With custom interval (every 2 days)
 * const dates = getDates(
 *   new Date('2025-01-01'),
 *   new Date('2025-01-07'),
 *   DAY_MS * 2
 * );
 * // => [Date(Jan 1), Date(Jan 3), Date(Jan 5), Date(Jan 7)]
 * ```
 */
export function getDates(startDate: DateInput, endDate: DateInput, interval: number = DAY_MS): Date[] {
  const start = parseDate(startDate);
  const end = parseDate(endDate);

  if (!start || !end) return [];

  const duration = +end - +start;
  const steps = Math.floor(duration / interval);

  return Array.from({ length: steps + 1 }, (_, i) => new Date(start.valueOf() + interval * i));
}

/**
 * Duration preset for getPastDates.
 */
export type DateDurationPreset = 'week' | 'month' | 'quarter' | 'year';

/**
 * Get an array of dates for past duration.
 *
 * @param duration - Duration preset or number of days
 * @returns Array of Date objects from past to present
 *
 * @example
 * ```ts
 * // Last 7 days
 * const weekDates = getPastDates('week');
 *
 * // Last 30 days
 * const monthDates = getPastDates('month');
 *
 * // Last 90 days
 * const quarterDates = getPastDates('quarter');
 *
 * // Last 365 days
 * const yearDates = getPastDates('year');
 *
 * // Custom: last 14 days
 * const customDates = getPastDates(14);
 * ```
 */
export function getPastDates(duration: DateDurationPreset | number): Date[] {
  const durationMap: Record<DateDurationPreset, number> = {
    week: 7,
    month: 30,
    quarter: 90,
    year: 365,
  };

  const days = typeof duration === 'number' ? duration : durationMap[duration];
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - days);

  return getDates(startDate, endDate);
}

/**
 * Get an array of dates for future duration.
 *
 * @param duration - Duration preset or number of days
 * @returns Array of Date objects from present to future
 *
 * @example
 * ```ts
 * // Next 7 days
 * const weekDates = getFutureDates('week');
 *
 * // Next 30 days
 * const monthDates = getFutureDates('month');
 *
 * // Custom: next 14 days
 * const customDates = getFutureDates(14);
 * ```
 */
export function getFutureDates(duration: DateDurationPreset | number): Date[] {
  const durationMap: Record<DateDurationPreset, number> = {
    week: 7,
    month: 30,
    quarter: 90,
    year: 365,
  };

  const days = typeof duration === 'number' ? duration : durationMap[duration];
  const startDate = new Date();
  const endDate = new Date();
  endDate.setDate(startDate.getDate() + days);

  return getDates(startDate, endDate);
}

/**
 * Get start of day (midnight) for a date.
 *
 * @param date - Input date
 * @returns Date set to 00:00:00.000
 */
export function startOfDay(date: DateInput): Date | null {
  const parsed = parseDate(date);
  if (!parsed) return null;

  const result = new Date(parsed);
  result.setHours(0, 0, 0, 0);
  return result;
}

/**
 * Get end of day (23:59:59.999) for a date.
 *
 * @param date - Input date
 * @returns Date set to 23:59:59.999
 */
export function endOfDay(date: DateInput): Date | null {
  const parsed = parseDate(date);
  if (!parsed) return null;

  const result = new Date(parsed);
  result.setHours(23, 59, 59, 999);
  return result;
}

/**
 * Add days to a date.
 *
 * @param date - Input date
 * @param days - Number of days to add (can be negative)
 * @returns New date with days added
 */
export function addDays(date: DateInput, days: number): Date | null {
  const parsed = parseDate(date);
  if (!parsed) return null;

  const result = new Date(parsed);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Add months to a date.
 *
 * @param date - Input date
 * @param months - Number of months to add (can be negative)
 * @returns New date with months added
 */
export function addMonths(date: DateInput, months: number): Date | null {
  const parsed = parseDate(date);
  if (!parsed) return null;

  const result = new Date(parsed);
  result.setMonth(result.getMonth() + months);
  return result;
}
