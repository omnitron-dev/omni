/**
 * I18n Types
 *
 * TypeScript type definitions for internationalization system
 */

/**
 * Translation messages object
 * Can be nested for namespacing
 */
export interface TranslationMessages {
  [key: string]: string | TranslationMessages;
}

/**
 * Locale code (e.g., 'en', 'en-US', 'fr', 'ar')
 */
export type LocaleCode = string;

/**
 * Translation interpolation values
 */
export interface InterpolationValues {
  [key: string]: string | number | boolean | Date | null | undefined;
}

/**
 * Plural forms for different languages
 * Based on Unicode CLDR plural rules
 */
export type PluralForm = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';

/**
 * Plural rules object
 */
export interface PluralRules {
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
}

/**
 * Translation with plural forms
 */
export type TranslationValue = string | PluralRules;

/**
 * Locale data structure
 */
export interface LocaleData {
  code: LocaleCode;
  name: string;
  direction: 'ltr' | 'rtl';
  messages: TranslationMessages;
  pluralRules?: (count: number) => PluralForm;
}

/**
 * Locale detection strategy
 */
export type LocaleDetectionStrategy = 'browser' | 'url' | 'cookie' | 'localStorage' | 'navigator';

/**
 * I18n configuration
 */
export interface I18nConfig {
  /** Default locale to use */
  defaultLocale: LocaleCode;

  /** Available locales */
  locales: LocaleCode[];

  /** Fallback locale chain */
  fallbackLocale?: LocaleCode | LocaleCode[];

  /** Locale detection strategies in order of priority */
  detection?: LocaleDetectionStrategy[];

  /** Cookie name for storing locale preference */
  cookieName?: string;

  /** LocalStorage key for storing locale preference */
  localStorageKey?: string;

  /** Messages for all locales */
  messages?: Record<LocaleCode, TranslationMessages>;

  /** Load messages dynamically */
  messageLoader?: (locale: LocaleCode) => Promise<TranslationMessages>;

  /** Missing translation handler */
  onMissingTranslation?: (locale: LocaleCode, key: string) => string | void;

  /** Load locale data dynamically */
  localeLoader?: (locale: LocaleCode) => Promise<LocaleData>;
}

/**
 * Translation function
 */
export interface TranslateFunction {
  (key: string, values?: InterpolationValues): string;
}

/**
 * Date/time formatting style
 */
export type DateTimeStyle = 'full' | 'long' | 'medium' | 'short';

/**
 * Number formatting options
 */
export interface NumberFormatOptions extends Intl.NumberFormatOptions {
  locale?: LocaleCode;
}

/**
 * Date formatting options
 */
export interface DateFormatOptions extends Intl.DateTimeFormatOptions {
  locale?: LocaleCode;
  dateStyle?: DateTimeStyle;
  timeStyle?: DateTimeStyle;
}

/**
 * Currency formatting options
 */
export interface CurrencyFormatOptions extends NumberFormatOptions {
  currency: string;
}

/**
 * Formatter functions
 */
export interface Formatters {
  /** Format a number */
  number: (value: number, options?: NumberFormatOptions) => string;

  /** Format a currency value */
  currency: (value: number, currency: string, options?: NumberFormatOptions) => string;

  /** Format a percentage */
  percent: (value: number, options?: NumberFormatOptions) => string;

  /** Format a date */
  date: (value: Date | number | string, options?: DateFormatOptions) => string;

  /** Format a time */
  time: (value: Date | number | string, options?: DateFormatOptions) => string;

  /** Format a date and time */
  dateTime: (value: Date | number | string, options?: DateFormatOptions) => string;

  /** Format a relative time (e.g., "3 days ago") */
  relativeTime: (value: Date | number, options?: Intl.RelativeTimeFormatOptions) => string;

  /** Format a list */
  list: (items: string[], options?: Intl.ListFormatOptions) => string;
}

/**
 * Translation context
 */
export interface I18nContext {
  /** Current locale */
  locale: LocaleCode;

  /** Set locale */
  setLocale: (locale: LocaleCode) => void | Promise<void>;

  /** Translation function */
  t: TranslateFunction;

  /** Check if locale is RTL */
  isRTL: boolean;

  /** Text direction */
  dir: 'ltr' | 'rtl';

  /** Available locales */
  locales: LocaleCode[];

  /** Formatters */
  formatters: Formatters;
}

/**
 * Route locale configuration
 */
export interface RouteLocaleConfig {
  /** Include locale in URL path */
  includeLocaleInPath?: boolean;

  /** Locale prefix strategy */
  localePrefix?: 'always' | 'as-needed' | 'never';

  /** Exclude paths from locale prefix */
  excludePaths?: string[];

  /** Redirect to locale-prefixed URL */
  redirectToLocale?: boolean;
}

/**
 * Translation key path
 * Used for type-safe translation keys
 */
export type TranslationKey<T> = T extends string
  ? T
  : T extends Record<string, any>
    ? {
        [K in keyof T]: K extends string
          ? T[K] extends string
            ? K
            : T[K] extends Record<string, any>
              ? `${K}.${TranslationKey<T[K]>}`
              : never
          : never;
      }[keyof T]
    : never;

/**
 * Locale metadata
 */
export interface LocaleMetadata {
  code: LocaleCode;
  name: string;
  nativeName: string;
  direction: 'ltr' | 'rtl';
  region?: string;
}

/**
 * Message extraction result
 */
export interface ExtractedMessage {
  key: string;
  defaultMessage: string;
  context?: string;
  file: string;
  line: number;
}
