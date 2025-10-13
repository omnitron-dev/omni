/**
 * I18n Components
 *
 * React components for i18n
 */

import { defineComponent } from '../core/component/define.js';
import { computed } from '../core/reactivity/computed.js';
import type { I18nContext, InterpolationValues } from './types.js';
import type { I18n } from './i18n.js';
import { provideI18nContext } from './context.js';
import { useTranslation } from './hooks.js';

/**
 * I18nProvider props
 */
export interface I18nProviderProps {
  i18n: I18n;
  children: any;
}

/**
 * I18n Provider component
 *
 * Provides i18n context to child components
 *
 * @example
 * ```tsx
 * const i18n = createI18n({ ... });
 *
 * <I18nProvider i18n={i18n}>
 *   <App />
 * </I18nProvider>
 * ```
 */
export const I18nProvider = defineComponent<I18nProviderProps>((props) => {
  const i18n = props.i18n;

  // Create context value
  const context: I18nContext = {
    locale: i18n.getLocale(),
    setLocale: (locale) => i18n.setLocale(locale),
    t: (key, values) => i18n.t(key, values),
    isRTL: i18n.isRTL(),
    dir: i18n.dir(),
    locales: i18n.locales,
    formatters: i18n.formatters,
  };

  // Provide context
  provideI18nContext(context);

  return () => props.children;
});

/**
 * Trans component props
 */
export interface TransProps {
  /** Translation key */
  i18nKey: string;

  /** Interpolation values */
  values?: InterpolationValues;

  /** Default text if translation not found */
  defaults?: string;

  /** Component to render (default: span) */
  as?: string;

  /** Additional props for wrapper element */
  [key: string]: any;
}

/**
 * Trans component
 *
 * Component-based translation with JSX support
 *
 * @example
 * ```tsx
 * <Trans i18nKey="welcome.message" values={{ name: 'Alice' }} />
 * <Trans i18nKey="greeting" as="h1" className="title" />
 * ```
 */
export const Trans = defineComponent<TransProps>((props) => {
  const { t } = useTranslation();

  return () => {
    const { i18nKey, values, defaults, as = 'span', ...restProps } = props;

    const text = computed(() => {
      const translation = t(i18nKey, values);
      return translation === i18nKey && defaults ? defaults : translation;
    });

    // Create element props
    const elementProps = {
      ...restProps,
      children: text(),
    };

    return { type: as, props: elementProps };
  };
});

/**
 * LocaleSwitch component props
 */
export interface LocaleSwitchProps {
  /** Available locales to show */
  locales?: string[];

  /** Custom render function */
  render?: (locale: string, isCurrent: boolean, setLocale: (locale: string) => void) => any;

  /** Wrapper element */
  as?: string;

  /** Additional props */
  [key: string]: any;
}

/**
 * LocaleSwitch component
 *
 * Locale switcher component
 *
 * @example
 * ```tsx
 * <LocaleSwitch />
 * <LocaleSwitch locales={['en', 'fr', 'es']} />
 * <LocaleSwitch render={(locale, isCurrent, setLocale) => (
 *   <button onClick={() => setLocale(locale)} disabled={isCurrent}>
 *     {locale}
 *   </button>
 * )} />
 * ```
 */
export const LocaleSwitch = defineComponent<LocaleSwitchProps>((props) => {
  const { locale, setLocale, locales: availableLocales } = useTranslation();

  return () => {
    const { locales: propLocales, render, as = 'div', ...restProps } = props;

    const locales = propLocales || availableLocales;
    const currentLocale = locale;

    const children = locales.map((loc: string) => {
      const isCurrent = loc === currentLocale;

      if (render) {
        return render(loc, isCurrent, setLocale);
      }

      // Default render
      return {
        type: 'button',
        props: {
          key: loc,
          onClick: () => setLocale(loc),
          disabled: isCurrent,
          children: loc,
        },
      };
    });

    return {
      type: as,
      props: {
        ...restProps,
        children,
      },
    };
  };
});

/**
 * FormattedDate component props
 */
export interface FormattedDateProps {
  value: Date | number | string;
  options?: Intl.DateTimeFormatOptions;
  as?: string;
  [key: string]: any;
}

/**
 * FormattedDate component
 *
 * @example
 * ```tsx
 * <FormattedDate value={new Date()} />
 * <FormattedDate value={timestamp} options={{ dateStyle: 'full' }} />
 * ```
 */
export const FormattedDate = defineComponent<FormattedDateProps>((props) => {
  const { formatters } = useTranslation();

  return () => {
    const { value, options, as = 'span', ...restProps } = props;

    const formatted = computed(() => formatters.date(value, options));

    return {
      type: as,
      props: {
        ...restProps,
        children: formatted(),
      },
    };
  };
});

/**
 * FormattedNumber component props
 */
export interface FormattedNumberProps {
  value: number;
  options?: Intl.NumberFormatOptions;
  as?: string;
  [key: string]: any;
}

/**
 * FormattedNumber component
 *
 * @example
 * ```tsx
 * <FormattedNumber value={1234.56} />
 * <FormattedNumber value={0.75} options={{ style: 'percent' }} />
 * ```
 */
export const FormattedNumber = defineComponent<FormattedNumberProps>((props) => {
  const { formatters } = useTranslation();

  return () => {
    const { value, options, as = 'span', ...restProps } = props;

    const formatted = computed(() => formatters.number(value, options));

    return {
      type: as,
      props: {
        ...restProps,
        children: formatted(),
      },
    };
  };
});

/**
 * FormattedCurrency component props
 */
export interface FormattedCurrencyProps {
  value: number;
  currency: string;
  options?: Intl.NumberFormatOptions;
  as?: string;
  [key: string]: any;
}

/**
 * FormattedCurrency component
 *
 * @example
 * ```tsx
 * <FormattedCurrency value={99.99} currency="USD" />
 * <FormattedCurrency value={1234.56} currency="EUR" />
 * ```
 */
export const FormattedCurrency = defineComponent<FormattedCurrencyProps>((props) => {
  const { formatters } = useTranslation();

  return () => {
    const { value, currency, options, as = 'span', ...restProps } = props;

    const formatted = computed(() => formatters.currency(value, currency, options));

    return {
      type: as,
      props: {
        ...restProps,
        children: formatted(),
      },
    };
  };
});

/**
 * FormattedRelativeTime component props
 */
export interface FormattedRelativeTimeProps {
  value: Date | number;
  options?: Intl.RelativeTimeFormatOptions;
  as?: string;
  [key: string]: any;
}

/**
 * FormattedRelativeTime component
 *
 * @example
 * ```tsx
 * <FormattedRelativeTime value={new Date(Date.now() - 3600000)} />
 * // Outputs: "1 hour ago"
 * ```
 */
export const FormattedRelativeTime = defineComponent<FormattedRelativeTimeProps>((props) => {
  const { formatters } = useTranslation();

  return () => {
    const { value, options, as = 'span', ...restProps } = props;

    const formatted = computed(() => formatters.relativeTime(value, options));

    return {
      type: as,
      props: {
        ...restProps,
        children: formatted(),
      },
    };
  };
});

/**
 * FormattedList component props
 */
export interface FormattedListProps {
  items: string[];
  options?: Intl.ListFormatOptions;
  as?: string;
  [key: string]: any;
}

/**
 * FormattedList component
 *
 * @example
 * ```tsx
 * <FormattedList items={['Alice', 'Bob', 'Charlie']} />
 * // Outputs: "Alice, Bob, and Charlie"
 * ```
 */
export const FormattedList = defineComponent<FormattedListProps>((props) => {
  const { formatters } = useTranslation();

  return () => {
    const { items, options, as = 'span', ...restProps } = props;

    const formatted = computed(() => formatters.list(items, options));

    return {
      type: as,
      props: {
        ...restProps,
        children: formatted(),
      },
    };
  };
});
