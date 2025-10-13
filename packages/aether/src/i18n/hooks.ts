/**
 * I18n Hooks
 *
 * React-style hooks for accessing i18n functionality
 */

import { computed } from '../core/reactivity/computed.js';
import type { Computed } from '../core/reactivity/types.js';
import { useContext } from '../core/component/context.js';
import type { I18nContext, LocaleCode, TranslateFunction, Formatters, InterpolationValues } from './types.js';
import { I18nContextSymbol } from './context.js';

/**
 * Use translation function
 *
 * @returns Translation context with t function and locale info
 *
 * @example
 * ```typescript
 * const { t, locale, setLocale } = useTranslation();
 *
 * <p>{t('welcome.message', { name: 'Alice' })}</p>
 * <p>{t('items.count', { count: 5 })}</p>
 * ```
 */
export function useTranslation(): I18nContext {
  const context = useContext(I18nContextSymbol);

  if (!context) {
    throw new Error('useTranslation must be used within I18nProvider');
  }

  return context;
}

/**
 * Use current locale
 *
 * @returns Current locale code
 *
 * @example
 * ```typescript
 * const locale = useLocale();
 * console.log(locale()); // "en"
 * ```
 */
export function useLocale(): Computed<LocaleCode> {
  const { locale } = useTranslation();
  return computed(() => locale);
}

/**
 * Use locale setter
 *
 * @returns Function to change locale
 *
 * @example
 * ```typescript
 * const setLocale = useSetLocale();
 * setLocale('fr');
 * ```
 */
export function useSetLocale(): (locale: LocaleCode) => void | Promise<void> {
  const { setLocale } = useTranslation();
  return setLocale;
}

/**
 * Use translate function
 *
 * @returns Translation function
 *
 * @example
 * ```typescript
 * const t = useT();
 * <p>{t('hello')}</p>
 * ```
 */
export function useT(): TranslateFunction {
  const { t } = useTranslation();
  return t;
}

/**
 * Use formatters
 *
 * @returns Formatting functions for dates, numbers, etc.
 *
 * @example
 * ```typescript
 * const { date, currency, number } = useFormatters();
 *
 * <p>{date(new Date())}</p>
 * <p>{currency(99.99, 'USD')}</p>
 * <p>{number(1234.56)}</p>
 * ```
 */
export function useFormatters(): Formatters {
  const { formatters } = useTranslation();
  return formatters;
}

/**
 * Use direction detection
 *
 * @returns Object with isRTL flag and dir value
 *
 * @example
 * ```typescript
 * const { isRTL, dir } = useDirection();
 *
 * <div dir={dir()}>
 *   {isRTL() ? 'Right-to-left' : 'Left-to-right'}
 * </div>
 * ```
 */
export function useDirection(): { isRTL: boolean; dir: 'ltr' | 'rtl' } {
  const { isRTL, dir } = useTranslation();
  return { isRTL, dir };
}

/**
 * Use available locales
 *
 * @returns Array of available locale codes
 *
 * @example
 * ```typescript
 * const locales = useLocales();
 *
 * <select>
 *   {locales.map(locale => (
 *     <option value={locale}>{locale}</option>
 *   ))}
 * </select>
 * ```
 */
export function useLocales(): LocaleCode[] {
  const { locales } = useTranslation();
  return locales;
}

/**
 * Use scoped translation
 *
 * @param scope - Translation key scope/namespace
 * @returns Scoped translation function
 *
 * @example
 * ```typescript
 * const t = useScopedTranslation('user.profile');
 * <p>{t('title')}</p> // translates 'user.profile.title'
 * ```
 */
export function useScopedTranslation(scope: string): TranslateFunction {
  const { t } = useTranslation();

  return (key: string, values?: InterpolationValues): string => t(`${scope}.${key}`, values);
}

/**
 * Use plural translation
 *
 * @returns Function to translate with pluralization
 *
 * @example
 * ```typescript
 * const tp = usePlural();
 * <p>{tp('items', 5)}</p> // "5 items"
 * <p>{tp('items', 1)}</p> // "1 item"
 * ```
 */
export function usePlural(): (key: string, count: number, values?: InterpolationValues) => string {
  const { t } = useTranslation();

  return (key: string, count: number, values?: InterpolationValues): string => t(key, { ...values, count });
}

/**
 * Use formatted date
 *
 * @returns Reactive formatted date
 *
 * @example
 * ```typescript
 * const formattedDate = useFormattedDate(() => new Date());
 * <p>{formattedDate()}</p>
 * ```
 */
export function useFormattedDate(
  value: () => Date | number | string,
  options?: () => Intl.DateTimeFormatOptions
): Computed<string> {
  const { formatters } = useTranslation();

  return computed(() => formatters.date(value(), options?.()));
}

/**
 * Use formatted number
 *
 * @returns Reactive formatted number
 *
 * @example
 * ```typescript
 * const formattedNumber = useFormattedNumber(() => 1234.56);
 * <p>{formattedNumber()}</p>
 * ```
 */
export function useFormattedNumber(value: () => number, options?: () => Intl.NumberFormatOptions): Computed<string> {
  const { formatters } = useTranslation();

  return computed(() => formatters.number(value(), options?.()));
}

/**
 * Use formatted currency
 *
 * @returns Reactive formatted currency
 *
 * @example
 * ```typescript
 * const formattedPrice = useFormattedCurrency(() => 99.99, 'USD');
 * <p>{formattedPrice()}</p>
 * ```
 */
export function useFormattedCurrency(
  value: () => number,
  currency: string,
  options?: () => Intl.NumberFormatOptions
): Computed<string> {
  const { formatters } = useTranslation();

  return computed(() => formatters.currency(value(), currency, options?.()));
}
