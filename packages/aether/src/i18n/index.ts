/**
 * I18n Module
 *
 * Internationalization system for Aether framework
 */

// Core
export { I18n, createI18n } from './i18n.js';
export { Translator } from './translator.js';

// Types
export type {
  I18nConfig,
  I18nContext,
  LocaleCode,
  LocaleData,
  LocaleMetadata,
  TranslationMessages,
  TranslationValue,
  TranslateFunction,
  InterpolationValues,
  PluralForm,
  PluralRules,
  DateTimeStyle,
  NumberFormatOptions,
  DateFormatOptions,
  CurrencyFormatOptions,
  Formatters,
  RouteLocaleConfig,
  TranslationKey,
  ExtractedMessage,
  LocaleDetectionStrategy,
} from './types.js';

// Formatters
export { createFormatters } from './formatters.js';

// Pluralization
export { getPluralRule, selectPluralForm, PLURAL_RULES } from './pluralization.js';
export type { PluralRuleFunction } from './pluralization.js';

// RTL Support
export {
  isRTL,
  getDirection,
  applyDirection,
  getDirectionClassName,
  getStartPosition,
  getEndPosition,
  flipForRTL,
  getLogicalProperty,
  createDirectionStyles,
  DirectionObserver,
} from './rtl.js';

// Loader
export {
  TranslationLoader,
  createFileLoader,
  createDynamicLoader,
  createChunkedLoader,
  createFallbackLoader,
  createCachedLoader,
} from './loader.js';
export type { LoaderFunction } from './loader.js';

// Locale Router
export { LocaleRouter, createLocaleRouter, createLocalizedLink, createLocaleNavigate } from './locale-router.js';
export type { LocaleRouterConfig } from './locale-router.js';

// Context
export { I18nContextSymbol, provideI18nContext } from './context.js';

// Hooks
export {
  useTranslation,
  useLocale,
  useSetLocale,
  useT,
  useFormatters,
  useDirection,
  useLocales,
  useScopedTranslation,
  usePlural,
  useFormattedDate,
  useFormattedNumber,
  useFormattedCurrency,
} from './hooks.js';

// Components
export {
  I18nProvider,
  Trans,
  LocaleSwitch,
  FormattedDate,
  FormattedNumber,
  FormattedCurrency,
  FormattedRelativeTime,
  FormattedList,
} from './components.js';
export type {
  I18nProviderProps,
  TransProps,
  LocaleSwitchProps,
  FormattedDateProps,
  FormattedNumberProps,
  FormattedCurrencyProps,
  FormattedRelativeTimeProps,
  FormattedListProps,
} from './components.js';
