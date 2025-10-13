/**
 * Translator Engine
 *
 * Translation engine with interpolation, formatting, and pluralization
 */

import type { TranslationMessages, LocaleCode, InterpolationValues, PluralRules } from './types.js';
import { selectPluralForm } from './pluralization.js';

/**
 * Translator class
 */
export class Translator {
  private messages: Map<LocaleCode, TranslationMessages> = new Map();
  private currentLocale: LocaleCode;
  private fallbackLocales: LocaleCode[];

  constructor(
    defaultLocale: LocaleCode,
    messages: Record<LocaleCode, TranslationMessages> = {},
    fallbackLocales: LocaleCode[] = []
  ) {
    this.currentLocale = defaultLocale;
    this.fallbackLocales = fallbackLocales;

    // Load initial messages
    for (const [locale, msgs] of Object.entries(messages)) {
      this.messages.set(locale, msgs);
    }
  }

  /**
   * Set current locale
   */
  setLocale(locale: LocaleCode): void {
    this.currentLocale = locale;
  }

  /**
   * Get current locale
   */
  getLocale(): LocaleCode {
    return this.currentLocale;
  }

  /**
   * Add messages for a locale
   */
  addMessages(locale: LocaleCode, messages: TranslationMessages): void {
    const existing = this.messages.get(locale) || {};
    this.messages.set(locale, this.deepMerge(existing, messages));
  }

  /**
   * Get messages for a locale
   */
  getMessages(locale: LocaleCode): TranslationMessages | undefined {
    return this.messages.get(locale);
  }

  /**
   * Translate a key
   */
  translate(
    key: string,
    values?: InterpolationValues,
    options?: {
      locale?: LocaleCode;
      defaultValue?: string;
      count?: number;
    }
  ): string {
    const locale = options?.locale || this.currentLocale;
    const count = values?.count as number | undefined;

    // Try to find translation in current locale
    let translation = this.getMessage(key, locale);

    // Try fallback locales if not found
    if (translation === null) {
      for (const fallbackLocale of this.fallbackLocales) {
        translation = this.getMessage(key, fallbackLocale);
        if (translation !== null) break;
      }
    }

    // Use default value if provided
    if (translation === null && options?.defaultValue) {
      translation = options.defaultValue;
    }

    // Return key if no translation found
    if (translation === null) {
      return key;
    }

    // Handle plural forms
    if (typeof translation === 'object' && count !== undefined && this.isPluralRules(translation)) {
      const pluralForms = translation as unknown as Record<string, string>;
      translation = selectPluralForm(count, pluralForms, locale);
    }

    // Ensure translation is a string
    if (typeof translation !== 'string') {
      return key;
    }

    // Interpolate values
    return this.interpolate(translation, values || {});
  }

  /**
   * Get message by key from locale
   */
  private getMessage(key: string, locale: LocaleCode): string | PluralRules | null {
    const messages = this.messages.get(locale);
    if (!messages) return null;

    // Support nested keys with dot notation
    const keys = key.split('.');
    let current: any = messages;

    for (const k of keys) {
      if (current && typeof current === 'object' && k in current) {
        current = current[k];
      } else {
        return null;
      }
    }

    if (typeof current === 'string' || this.isPluralRules(current)) {
      return current;
    }

    return null;
  }

  /**
   * Check if value is plural rules object
   */
  private isPluralRules(value: any): value is PluralRules {
    return typeof value === 'object' && value !== null && 'other' in value && typeof value.other === 'string';
  }

  /**
   * Interpolate values into translation string
   *
   * Supports:
   * - Simple interpolation: "Hello {name}"
   * - Formatted numbers: "Price: {price, number}"
   * - Formatted dates: "Date: {date, date}"
   */
  private interpolate(text: string, values: InterpolationValues): string {
    return text.replace(/\{([^}]+)\}/g, (match, expr) => {
      const parts = expr
        .trim()
        .split(',')
        .map((s: string) => s.trim());
      const key = parts[0];
      const format = parts[1];

      const value = values[key];
      if (value === undefined || value === null) {
        return match;
      }

      // Apply formatting if specified
      if (format) {
        return this.formatValue(value, format);
      }

      return String(value);
    });
  }

  /**
   * Format a value according to format type
   */
  private formatValue(value: any, format: string): string {
    switch (format) {
      case 'number':
        return typeof value === 'number' ? value.toLocaleString(this.currentLocale) : String(value);

      case 'currency':
        if (typeof value === 'number') {
          return new Intl.NumberFormat(this.currentLocale, {
            style: 'currency',
            currency: 'USD', // Default currency
          }).format(value);
        }
        return String(value);

      case 'percent':
        if (typeof value === 'number') {
          return new Intl.NumberFormat(this.currentLocale, {
            style: 'percent',
          }).format(value);
        }
        return String(value);

      case 'date':
        if (value instanceof Date) {
          return new Intl.DateTimeFormat(this.currentLocale).format(value);
        }
        if (typeof value === 'number' || typeof value === 'string') {
          return new Intl.DateTimeFormat(this.currentLocale).format(new Date(value));
        }
        return String(value);

      case 'time':
        if (value instanceof Date) {
          return new Intl.DateTimeFormat(this.currentLocale, {
            hour: 'numeric',
            minute: 'numeric',
          }).format(value);
        }
        if (typeof value === 'number' || typeof value === 'string') {
          return new Intl.DateTimeFormat(this.currentLocale, {
            hour: 'numeric',
            minute: 'numeric',
          }).format(new Date(value));
        }
        return String(value);

      default:
        return String(value);
    }
  }

  /**
   * Deep merge two objects
   */
  private deepMerge<T extends Record<string, any>>(target: T, source: T): T {
    const result = { ...target };

    for (const key in source) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        const sourceValue = source[key];
        const targetValue = result[key];

        if (
          typeof sourceValue === 'object' &&
          sourceValue !== null &&
          !Array.isArray(sourceValue) &&
          typeof targetValue === 'object' &&
          targetValue !== null &&
          !Array.isArray(targetValue)
        ) {
          result[key] = this.deepMerge(targetValue, sourceValue);
        } else {
          result[key] = sourceValue;
        }
      }
    }

    return result;
  }

  /**
   * Check if locale has messages
   */
  hasLocale(locale: LocaleCode): boolean {
    return this.messages.has(locale);
  }

  /**
   * Get all available locales
   */
  getLocales(): LocaleCode[] {
    return Array.from(this.messages.keys());
  }

  /**
   * Clear all messages
   */
  clear(): void {
    this.messages.clear();
  }
}
