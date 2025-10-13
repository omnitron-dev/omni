/**
 * Formatters
 *
 * Date, time, number, and currency formatters using Intl API
 */

import type {
  LocaleCode,
  NumberFormatOptions,
  DateFormatOptions,
  Formatters,
} from './types.js';

/**
 * Create formatters for a locale
 */
export function createFormatters(locale: LocaleCode): Formatters {
  /**
   * Format a number
   */
  function number(value: number, options?: NumberFormatOptions): string {
    const effectiveLocale = options?.locale || locale;
    return new Intl.NumberFormat(effectiveLocale, options).format(value);
  }

  /**
   * Format a currency value
   */
  function currency(
    value: number,
    currencyCode: string,
    options?: NumberFormatOptions,
  ): string {
    const effectiveLocale = options?.locale || locale;
    return new Intl.NumberFormat(effectiveLocale, {
      style: 'currency',
      currency: currencyCode,
      ...options,
    }).format(value);
  }

  /**
   * Format a percentage
   */
  function percent(value: number, options?: NumberFormatOptions): string {
    const effectiveLocale = options?.locale || locale;
    return new Intl.NumberFormat(effectiveLocale, {
      style: 'percent',
      ...options,
    }).format(value);
  }

  /**
   * Parse date value
   */
  function parseDate(value: Date | number | string): Date {
    if (value instanceof Date) return value;
    if (typeof value === 'number') return new Date(value);
    return new Date(value);
  }

  /**
   * Format a date
   */
  function date(value: Date | number | string, options?: DateFormatOptions): string {
    const effectiveLocale = options?.locale || locale;
    const dateValue = parseDate(value);

    const formatOptions: Intl.DateTimeFormatOptions = { ...options };

    // Apply dateStyle if provided
    if (options?.dateStyle) {
      formatOptions.dateStyle = options.dateStyle;
      // Remove individual date components when using dateStyle
      delete formatOptions.year;
      delete formatOptions.month;
      delete formatOptions.day;
    }

    return new Intl.DateTimeFormat(effectiveLocale, formatOptions).format(dateValue);
  }

  /**
   * Format a time
   */
  function time(value: Date | number | string, options?: DateFormatOptions): string {
    const effectiveLocale = options?.locale || locale;
    const dateValue = parseDate(value);

    const formatOptions: Intl.DateTimeFormatOptions = { ...options };

    // Apply timeStyle if provided
    if (options?.timeStyle) {
      formatOptions.timeStyle = options.timeStyle;
    } else {
      // Default to showing hour and minute
      formatOptions.hour = formatOptions.hour || 'numeric';
      formatOptions.minute = formatOptions.minute || 'numeric';
    }

    return new Intl.DateTimeFormat(effectiveLocale, formatOptions).format(dateValue);
  }

  /**
   * Format a date and time
   */
  function dateTime(value: Date | number | string, options?: DateFormatOptions): string {
    const effectiveLocale = options?.locale || locale;
    const dateValue = parseDate(value);

    const formatOptions: Intl.DateTimeFormatOptions = { ...options };

    // Apply styles if provided
    if (options?.dateStyle) {
      formatOptions.dateStyle = options.dateStyle;
    }
    if (options?.timeStyle) {
      formatOptions.timeStyle = options.timeStyle;
    }

    // If no styles provided, use defaults
    if (!formatOptions.dateStyle && !formatOptions.timeStyle) {
      formatOptions.year = formatOptions.year || 'numeric';
      formatOptions.month = formatOptions.month || 'numeric';
      formatOptions.day = formatOptions.day || 'numeric';
      formatOptions.hour = formatOptions.hour || 'numeric';
      formatOptions.minute = formatOptions.minute || 'numeric';
    }

    return new Intl.DateTimeFormat(effectiveLocale, formatOptions).format(dateValue);
  }

  /**
   * Format relative time
   */
  function relativeTime(
    value: Date | number,
    options?: Intl.RelativeTimeFormatOptions,
  ): string {
    const now = Date.now();
    const targetTime = value instanceof Date ? value.getTime() : value;
    const diffMs = targetTime - now;
    const diffSeconds = Math.round(diffMs / 1000);
    const diffMinutes = Math.round(diffSeconds / 60);
    const diffHours = Math.round(diffMinutes / 60);
    const diffDays = Math.round(diffHours / 24);
    const diffMonths = Math.round(diffDays / 30);
    const diffYears = Math.round(diffDays / 365);

    const rtf = new Intl.RelativeTimeFormat(locale, options);

    // Choose appropriate unit based on magnitude
    if (Math.abs(diffYears) >= 1) {
      return rtf.format(diffYears, 'year');
    } else if (Math.abs(diffMonths) >= 1) {
      return rtf.format(diffMonths, 'month');
    } else if (Math.abs(diffDays) >= 1) {
      return rtf.format(diffDays, 'day');
    } else if (Math.abs(diffHours) >= 1) {
      return rtf.format(diffHours, 'hour');
    } else if (Math.abs(diffMinutes) >= 1) {
      return rtf.format(diffMinutes, 'minute');
    } else {
      return rtf.format(diffSeconds, 'second');
    }
  }

  /**
   * Format a list
   */
  function list(items: string[], options?: Intl.ListFormatOptions): string {
    if (items.length === 0) return '';
    if (items.length === 1) return items[0] || '';

    // Use Intl.ListFormat if available
    if (typeof Intl.ListFormat !== 'undefined') {
      return new Intl.ListFormat(locale, options).format(items);
    }

    // Fallback for browsers without ListFormat
    const type = options?.type || 'conjunction';
    if (items.length === 2) {
      const separator = type === 'disjunction' ? ' or ' : ' and ';
      return items.join(separator);
    }

    const lastItem = items[items.length - 1];
    const allButLast = items.slice(0, -1);
    const separator = type === 'disjunction' ? ', or ' : ', and ';
    return allButLast.join(', ') + separator + lastItem;
  }

  return {
    number,
    currency,
    percent,
    date,
    time,
    dateTime,
    relativeTime,
    list,
  };
}
