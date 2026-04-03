/**
 * Number Formatting Utilities
 *
 * Locale-aware number formatting utilities.
 *
 * @module @omnitron/prism/utils/format-number
 */

// =============================================================================
// TYPES
// =============================================================================

export interface FormatNumberOptions extends Intl.NumberFormatOptions {
  /** Locale for formatting (default: 'en-US') */
  locale?: string;
}

export interface FormatCurrencyOptions extends FormatNumberOptions {
  /** Currency code (default: 'USD') */
  currency?: string;
}

// =============================================================================
// NUMBER FORMATTING
// =============================================================================

/**
 * Format a number with locale-aware formatting.
 *
 * @example
 * ```ts
 * fNumber(1234567.89)
 * // => "1,234,567.89"
 *
 * fNumber(1234567.89, { locale: 'de-DE' })
 * // => "1.234.567,89"
 *
 * fNumber(0.1234, { style: 'percent' })
 * // => "12%"
 * ```
 */
export function fNumber(value: number | string | null | undefined, options: FormatNumberOptions = {}): string {
  const { locale = 'en-US', ...formatOptions } = options;

  if (value === null || value === undefined || value === '') {
    return '';
  }

  const num = typeof value === 'string' ? parseFloat(value) : value;

  if (Number.isNaN(num)) {
    return '';
  }

  return new Intl.NumberFormat(locale, formatOptions).format(num);
}

/**
 * Format a number as currency.
 *
 * @example
 * ```ts
 * fCurrency(1234.56)
 * // => "$1,234.56"
 *
 * fCurrency(1234.56, { currency: 'EUR', locale: 'de-DE' })
 * // => "1.234,56 €"
 *
 * fCurrency(1234.56, { currency: 'JPY' })
 * // => "¥1,235" (JPY has no decimal places)
 * ```
 */
export function fCurrency(value: number | string | null | undefined, options: FormatCurrencyOptions = {}): string {
  const { currency = 'USD', locale = 'en-US', ...formatOptions } = options;

  if (value === null || value === undefined || value === '') {
    return '';
  }

  const num = typeof value === 'string' ? parseFloat(value) : value;

  if (Number.isNaN(num)) {
    return '';
  }

  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    ...formatOptions,
  }).format(num);
}

/**
 * Format a number as a percentage.
 *
 * @example
 * ```ts
 * fPercent(0.1234)
 * // => "12.34%"
 *
 * fPercent(0.1234, { maximumFractionDigits: 0 })
 * // => "12%"
 *
 * fPercent(1.5)
 * // => "150%"
 * ```
 */
export function fPercent(value: number | string | null | undefined, options: FormatNumberOptions = {}): string {
  const { locale = 'en-US', ...formatOptions } = options;

  if (value === null || value === undefined || value === '') {
    return '';
  }

  const num = typeof value === 'string' ? parseFloat(value) : value;

  if (Number.isNaN(num)) {
    return '';
  }

  return new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
    ...formatOptions,
  }).format(num);
}

/**
 * Shorten a large number with K, M, B suffixes.
 *
 * @example
 * ```ts
 * fShortenNumber(1234)
 * // => "1.23K"
 *
 * fShortenNumber(1234567)
 * // => "1.23M"
 *
 * fShortenNumber(1234567890)
 * // => "1.23B"
 *
 * fShortenNumber(1234567890000)
 * // => "1.23T"
 * ```
 */
export function fShortenNumber(value: number | string | null | undefined, decimals: number = 2): string {
  if (value === null || value === undefined || value === '') {
    return '';
  }

  const num = typeof value === 'string' ? parseFloat(value) : value;

  if (Number.isNaN(num)) {
    return '';
  }

  const absNum = Math.abs(num);

  if (absNum >= 1e12) {
    return `${(num / 1e12).toFixed(decimals)}T`;
  }
  if (absNum >= 1e9) {
    return `${(num / 1e9).toFixed(decimals)}B`;
  }
  if (absNum >= 1e6) {
    return `${(num / 1e6).toFixed(decimals)}M`;
  }
  if (absNum >= 1e3) {
    return `${(num / 1e3).toFixed(decimals)}K`;
  }

  return num.toFixed(decimals);
}

/**
 * Format bytes to human-readable size.
 *
 * @example
 * ```ts
 * fBytes(1024)
 * // => "1 KB"
 *
 * fBytes(1048576)
 * // => "1 MB"
 *
 * fBytes(1073741824)
 * // => "1 GB"
 * ```
 */
export function fBytes(bytes: number | string | null | undefined, decimals: number = 2): string {
  if (bytes === null || bytes === undefined || bytes === '') {
    return '';
  }

  const num = typeof bytes === 'string' ? parseFloat(bytes) : bytes;

  if (Number.isNaN(num) || num === 0) {
    return '0 Bytes';
  }

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(Math.abs(num)) / Math.log(k));

  return `${(num / Math.pow(k, i)).toFixed(decimals)} ${sizes[i]}`;
}

/**
 * Format number with ordinal suffix (1st, 2nd, 3rd, etc.)
 *
 * @example
 * ```ts
 * fOrdinal(1)
 * // => "1st"
 *
 * fOrdinal(22)
 * // => "22nd"
 *
 * fOrdinal(33)
 * // => "33rd"
 *
 * fOrdinal(44)
 * // => "44th"
 * ```
 */
export function fOrdinal(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }

  const num = Math.abs(Math.floor(value));
  const suffixes = ['th', 'st', 'nd', 'rd'];
  const remainder = num % 100;

  const suffix = suffixes[(remainder - 20) % 10] || suffixes[remainder] || suffixes[0];

  return `${value}${suffix}`;
}

/**
 * Format a number with decimal places.
 *
 * @example
 * ```ts
 * fDecimal(1234.5678)
 * // => "1234.57"
 *
 * fDecimal(1234.5678, 4)
 * // => "1234.5678"
 *
 * fDecimal(1234)
 * // => "1234.00"
 * ```
 */
export function fDecimal(value: number | string | null | undefined, decimals: number = 2): string {
  if (value === null || value === undefined || value === '') {
    return '';
  }

  const num = typeof value === 'string' ? parseFloat(value) : value;

  if (Number.isNaN(num)) {
    return '';
  }

  return num.toFixed(decimals);
}

// =============================================================================
// PERCENTAGE CALCULATIONS (Aurora pattern)
// =============================================================================

/**
 * Calculate percentage of a value relative to a total.
 *
 * @param value - The part value
 * @param total - The total value
 * @param decimals - Decimal places (default: 0)
 * @returns Percentage number (0-100)
 *
 * @example
 * ```ts
 * getPercentage(25, 100)
 * // => 25
 *
 * getPercentage(1, 3)
 * // => 33
 *
 * getPercentage(1, 3, 2)
 * // => 33.33
 *
 * getPercentage(50, 200)
 * // => 25
 * ```
 */
export function getPercentage(value: number, total: number, decimals: number = 0): number {
  if (total === 0) return 0;
  const percentage = (value / total) * 100;
  return Number(percentage.toFixed(decimals));
}

/**
 * Calculate percentage change between two values.
 *
 * @param current - Current value
 * @param previous - Previous value
 * @param decimals - Decimal places (default: 0)
 * @returns Percentage change (positive = increase, negative = decrease)
 *
 * @example
 * ```ts
 * calculatePercentageChange(150, 100)
 * // => 50 (50% increase)
 *
 * calculatePercentageChange(50, 100)
 * // => -50 (50% decrease)
 *
 * calculatePercentageChange(100, 100)
 * // => 0 (no change)
 *
 * calculatePercentageChange(120, 100, 1)
 * // => 20.0
 * ```
 */
export function calculatePercentageChange(current: number, previous: number, decimals: number = 0): number {
  if (previous === 0) return current === 0 ? 0 : 100;
  const change = ((current - previous) / Math.abs(previous)) * 100;
  return Number(change.toFixed(decimals));
}

/**
 * Get currency symbol for a currency code.
 *
 * @param currencyCode - ISO 4217 currency code (e.g., 'USD', 'EUR')
 * @param locale - Locale for formatting (default: 'en-US')
 * @returns Currency symbol (e.g., '$', '€', '¥')
 *
 * @example
 * ```ts
 * getCurrencySymbol('USD')
 * // => "$"
 *
 * getCurrencySymbol('EUR')
 * // => "€"
 *
 * getCurrencySymbol('JPY')
 * // => "¥"
 *
 * getCurrencySymbol('GBP')
 * // => "£"
 * ```
 */
export function getCurrencySymbol(currencyCode: string, locale: string = 'en-US'): string {
  const parts = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currencyCode,
  })
    .formatToParts(0)
    .find((part) => part.type === 'currency');

  return parts?.value ?? currencyCode;
}

/**
 * Format a number with +/- sign prefix.
 *
 * @param value - Number to format
 * @param options - Formatting options
 * @returns Formatted string with sign
 *
 * @example
 * ```ts
 * fNumberWithSign(25)
 * // => "+25"
 *
 * fNumberWithSign(-25)
 * // => "-25"
 *
 * fNumberWithSign(0)
 * // => "0"
 *
 * fNumberWithSign(25.5, { maximumFractionDigits: 1 })
 * // => "+25.5"
 * ```
 */
export function fNumberWithSign(value: number | string | null | undefined, options: FormatNumberOptions = {}): string {
  if (value === null || value === undefined || value === '') {
    return '';
  }

  const num = typeof value === 'string' ? parseFloat(value) : value;

  if (Number.isNaN(num)) {
    return '';
  }

  const formatted = fNumber(Math.abs(num), options);
  if (num > 0) return `+${formatted}`;
  if (num < 0) return `-${formatted}`;
  return formatted;
}

/**
 * Format a number as compact notation (1K, 1M, 1B).
 * Uses Intl.NumberFormat with compact notation.
 *
 * @example
 * ```ts
 * fCompact(1234)
 * // => "1.2K"
 *
 * fCompact(1234567)
 * // => "1.2M"
 *
 * fCompact(1234567890)
 * // => "1.2B"
 * ```
 */
export function fCompact(value: number | string | null | undefined, options: FormatNumberOptions = {}): string {
  const { locale = 'en-US', ...formatOptions } = options;

  if (value === null || value === undefined || value === '') {
    return '';
  }

  const num = typeof value === 'string' ? parseFloat(value) : value;

  if (Number.isNaN(num)) {
    return '';
  }

  return new Intl.NumberFormat(locale, {
    notation: 'compact',
    compactDisplay: 'short',
    maximumFractionDigits: 1,
    ...formatOptions,
  }).format(num);
}
