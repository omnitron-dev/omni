# Aether i18n - Internationalization System

A comprehensive internationalization (i18n) system for the Aether framework, providing locale management, translation, pluralization, formatting, and RTL support.

## Features

- **Locale Management**: Automatic locale detection and switching
- **Translation Engine**: Key-based translations with interpolation and nested keys
- **Pluralization**: Unicode CLDR plural rules for 30+ languages
- **Formatters**: Date, time, number, currency, and relative time formatting
- **RTL Support**: Right-to-left language support with automatic direction detection
- **Lazy Loading**: Dynamic loading of translation files for code-splitting
- **Router Integration**: Locale-based routing with automatic URL handling
- **Type Safety**: Full TypeScript support with type-safe translation keys
- **React-style Hooks**: Composable hooks for accessing i18n functionality
- **Components**: Pre-built components for common i18n patterns

## Installation

```bash
# Already included in @omnitron-dev/aether
import { createI18n } from '@omnitron-dev/aether/i18n';
```

## Basic Usage

### 1. Create i18n Instance

```typescript
import { createI18n } from '@omnitron-dev/aether/i18n';

const i18n = createI18n({
  defaultLocale: 'en',
  locales: ['en', 'fr', 'es', 'ar'],
  messages: {
    en: {
      welcome: 'Welcome',
      greeting: 'Hello, {name}!',
      items: {
        one: '1 item',
        other: '{count} items',
      },
    },
    fr: {
      welcome: 'Bienvenue',
      greeting: 'Bonjour, {name}!',
      items: {
        one: '1 article',
        other: '{count} articles',
      },
    },
  },
});
```

### 2. Provide i18n Context

```typescript
import { I18nProvider } from '@omnitron-dev/aether/i18n';

const App = defineComponent(() => {
  return () => (
    <I18nProvider i18n={i18n}>
      <MyApp />
    </I18nProvider>
  );
});
```

### 3. Use Translations

```typescript
import { useTranslation } from '@omnitron-dev/aether/i18n';

const MyComponent = defineComponent(() => {
  const { t, locale, setLocale } = useTranslation();

  return () => (
    <div>
      <p>{t('welcome')}</p>
      <p>{t('greeting', { name: 'Alice' })}</p>
      <p>{t('items', { count: 5 })}</p>

      <button onClick={() => setLocale('fr')}>
        Switch to French
      </button>
    </div>
  );
});
```

## Advanced Features

### Lazy Loading

Load translation files dynamically:

```typescript
import { createI18n, createFileLoader } from '@omnitron-dev/aether/i18n';

const i18n = createI18n({
  defaultLocale: 'en',
  locales: ['en', 'fr', 'es'],
  messageLoader: createFileLoader('/locales'),
});

// Preload a locale
await i18n.preloadLocale('fr');
```

### Pluralization

Support for complex plural rules:

```typescript
const messages = {
  en: {
    items: {
      one: '1 item',
      other: '{count} items',
    },
  },
  ar: {
    items: {
      zero: 'لا يوجد عناصر',
      one: 'عنصر واحد',
      two: 'عنصران',
      few: '{count} عناصر',
      many: '{count} عنصر',
      other: '{count} عنصر',
    },
  },
};
```

### Formatters

```typescript
import { useFormatters } from '@omnitron-dev/aether/i18n';

const MyComponent = defineComponent(() => {
  const { date, currency, number, relativeTime } = useFormatters();

  return () => (
    <div>
      <p>Date: {date(new Date())}</p>
      <p>Price: {currency(99.99, 'USD')}</p>
      <p>Number: {number(1234.56)}</p>
      <p>Time: {relativeTime(new Date(Date.now() - 3600000))}</p>
    </div>
  );
});
```

### RTL Support

Automatic RTL detection and styling:

```typescript
import { useDirection } from '@omnitron-dev/aether/i18n';

const MyComponent = defineComponent(() => {
  const { isRTL, dir } = useDirection();

  return () => (
    <div dir={dir()}>
      {isRTL() ? 'Right-to-left' : 'Left-to-right'}
    </div>
  );
});
```

### Locale-based Routing

```typescript
import { createLocaleRouter } from '@omnitron-dev/aether/i18n';

const localeRouter = createLocaleRouter({
  i18n,
  includeLocaleInPath: true,
  localePrefix: 'as-needed',
});

// Generate localized paths
const path = localeRouter.getLocalizedPath('/about'); // /fr/about

// Generate hreflang links
const links = localeRouter.generateHreflangLinks('/about', 'https://example.com');
```

## Components

### Trans Component

```typescript
import { Trans } from '@omnitron-dev/aether/i18n';

<Trans i18nKey="welcome.message" values={{ name: 'Alice' }} />
<Trans i18nKey="greeting" as="h1" className="title" />
```

### Formatted Components

```typescript
import {
  FormattedDate,
  FormattedNumber,
  FormattedCurrency,
  FormattedRelativeTime,
} from '@omnitron-dev/aether/i18n';

<FormattedDate value={new Date()} />
<FormattedNumber value={1234.56} />
<FormattedCurrency value={99.99} currency="USD" />
<FormattedRelativeTime value={new Date(Date.now() - 3600000)} />
```

### Locale Switcher

```typescript
import { LocaleSwitch } from '@omnitron-dev/aether/i18n';

// Default switcher
<LocaleSwitch />

// Custom render
<LocaleSwitch
  render={(locale, isCurrent, setLocale) => (
    <button
      onClick={() => setLocale(locale)}
      className={isCurrent ? 'active' : ''}
    >
      {locale.toUpperCase()}
    </button>
  )}
/>
```

## Hooks Reference

### useTranslation()

Main hook for accessing i18n functionality:

```typescript
const { t, locale, setLocale, isRTL, dir, locales, formatters } = useTranslation();
```

### useLocale()

Get current locale:

```typescript
const locale = useLocale();
console.log(locale()); // "en"
```

### useSetLocale()

Get locale setter function:

```typescript
const setLocale = useSetLocale();
setLocale('fr');
```

### useT()

Get translation function only:

```typescript
const t = useT();
<p>{t('welcome')}</p>
```

### useScopedTranslation()

Create scoped translation function:

```typescript
const t = useScopedTranslation('user.profile');
<p>{t('title')}</p> // translates 'user.profile.title'
```

### usePlural()

Simplified pluralization:

```typescript
const tp = usePlural();
<p>{tp('items', 5)}</p> // "5 items"
```

## Type Safety

Define translation keys with TypeScript:

```typescript
import type { TranslationKey } from '@omnitron-dev/aether/i18n';

interface Messages {
  welcome: string;
  greeting: string;
  items: {
    one: string;
    other: string;
  };
}

type Keys = TranslationKey<Messages>;
// "welcome" | "greeting" | "items.one" | "items.other"
```

## Supported Languages

The pluralization system supports 30+ languages including:

- **Simple plurals**: English, German, Dutch, Swedish, Spanish, Italian, etc.
- **Complex plurals**: Arabic, Russian, Polish, Czech, Lithuanian, etc.
- **No plurals**: Japanese, Korean, Chinese, Vietnamese, Thai, etc.

## Performance

- **Lazy loading**: Load translations on-demand
- **Caching**: Automatic caching with configurable TTL
- **Tree-shaking**: Import only what you need
- **Bundle optimization**: Separate locale bundles

## Browser Support

- Chrome/Edge: Latest 2 versions
- Firefox: Latest 2 versions
- Safari: Latest 2 versions
- Uses native Intl API for formatting

## License

MIT
