# 31. Internationalization (i18n)

## Table of Contents
- [Overview](#overview)
- [Setup](#setup)
- [Translation Files](#translation-files)
- [Using Translations](#using-translations)
- [Language Detection](#language-detection)
- [Language Switching](#language-switching)
- [Pluralization](#pluralization)
- [Number Formatting](#number-formatting)
- [Date and Time Formatting](#date-and-time-formatting)
- [Currency Formatting](#currency-formatting)
- [RTL Support](#rtl-support)
- [Dynamic Translations](#dynamic-translations)
- [Translation Management](#translation-management)
- [Server-Side i18n](#server-side-i18n)
- [SEO](#seo)
- [Testing](#testing)
- [Best Practices](#best-practices)
- [Examples](#examples)

## Overview

Internationalization (i18n) and localization (l10n) make your app accessible to users worldwide.

### Definitions

```typescript
/**
 * i18n (Internationalization):
 * - Process of designing app to support multiple languages
 * - Includes translations, date/number formats, cultural conventions
 *
 * l10n (Localization):
 * - Process of adapting app for specific region/language
 * - Includes translating content, adapting design, local regulations
 *
 * Locale:
 * - Combination of language and region (e.g., en-US, fr-FR, es-MX)
 * - Format: language[-region][-script]
 *
 * Translation:
 * - Converting text from one language to another
 *
 * Pluralization:
 * - Different forms based on quantity (e.g., 1 item vs 2 items)
 *
 * RTL (Right-to-Left):
 * - Languages that read right-to-left (Arabic, Hebrew)
 */
```

### Core Features

```typescript
/**
 * Aether i18n Features:
 *
 * ✓ Multiple language support
 * ✓ Automatic language detection
 * ✓ Dynamic language switching
 * ✓ Pluralization rules
 * ✓ Number/date/currency formatting
 * ✓ RTL support
 * ✓ Nested translations
 * ✓ Interpolation
 * ✓ Context-aware translations
 * ✓ Lazy-loaded translations
 * ✓ Type-safe translations
 */
```

## Setup

Install and configure i18n.

### Installation

```bash
npm install @aether/i18n
```

### Basic Configuration

```typescript
// i18n.ts
import { createI18n } from '@aether/i18n';

export const i18n = createI18n({
  // Default locale
  locale: 'en',

  // Fallback locale
  fallbackLocale: 'en',

  // Available locales
  locales: ['en', 'es', 'fr', 'de', 'ja', 'ar'],

  // Translation messages
  messages: {
    en: {
      hello: 'Hello',
      welcome: 'Welcome to Aether'
    },
    es: {
      hello: 'Hola',
      welcome: 'Bienvenido a (Aether)'
    },
    fr: {
      hello: 'Bonjour',
      welcome: 'Bienvenue chez (Aether)'
    }
  },

  // Options
  missing: (locale, key) => {
    console.warn(`Missing translation: ${key} for locale ${locale}`);
    return key;
  },

  // Number formats
  numberFormats: {
    en: {
      currency: {
        style: 'currency',
        currency: 'USD'
      }
    },
    es: {
      currency: {
        style: 'currency',
        currency: 'EUR'
      }
    }
  },

  // Date/time formats
  datetimeFormats: {
    en: {
      short: {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      },
      long: {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'long'
      }
    }
  }
});
```

### App Integration

```typescript
// main.tsx
import { I18nProvider } from '@aether/i18n';
import { i18n } from './i18n';

render(() => (
  <I18nProvider i18n={i18n}>
    <App />
  </I18nProvider>
), document.getElementById('root')!);
```

## Translation Files

Organize translations in separate files.

### File Structure

```typescript
/**
 * locales/
 * ├── en/
 * │   ├── common.json
 * │   ├── auth.json
 * │   └── dashboard.json
 * ├── es/
 * │   ├── common.json
 * │   ├── auth.json
 * │   └── dashboard.json
 * └── fr/
 *     ├── common.json
 *     ├── auth.json
 *     └── dashboard.json
 */
```

### Translation File Format

```json
// locales/en/common.json
{
  "app": {
    "name": "Aether",
    "tagline": "Build amazing apps"
  },
  "nav": {
    "home": "Home",
    "about": "About",
    "contact": "Contact"
  },
  "actions": {
    "save": "Save",
    "cancel": "Cancel",
    "delete": "Delete",
    "edit": "Edit"
  },
  "messages": {
    "loading": "Loading...",
    "error": "An error occurred",
    "success": "Success!"
  }
}
```

```json
// locales/en/auth.json
{
  "login": {
    "title": "Log in to your account",
    "email": "Email address",
    "password": "Password",
    "submit": "Sign in",
    "forgot": "Forgot password?",
    "noAccount": "Don't have an account? {signUpLink}"
  },
  "register": {
    "title": "Create an account",
    "name": "Full name",
    "email": "Email address",
    "password": "Password",
    "submit": "Sign up",
    "hasAccount": "Already have an account? {signInLink}"
  },
  "errors": {
    "invalidCredentials": "Invalid email or password",
    "emailTaken": "Email already taken",
    "weakPassword": "Password is too weak"
  }
}
```

### Load Translations

```typescript
// i18n.ts
import { createI18n } from '@aether/i18n';

// Lazy load translations
const loadLocaleMessages = async (locale: string) => {
  const messages = await import(`./locales/${locale}/common.json`);
  return messages.default;
};

export const i18n = createI18n({
  locale: 'en',
  fallbackLocale: 'en',
  locales: ['en', 'es', 'fr'],
  messages: {},

  // Lazy loading
  async: true
});

// Load initial locale
i18n.loadLocaleMessages('en', await loadLocaleMessages('en'));

// Helper to load locale
export const loadLocale = async (locale: string) => {
  if (!i18n.availableLocales.includes(locale)) {
    const messages = await loadLocaleMessages(locale);
    i18n.loadLocaleMessages(locale, messages);
  }
  i18n.locale = locale;
};
```

## Using Translations

Access translations in components.

### useI18n Hook

```typescript
import { useI18n } from '@aether/i18n';

export default defineComponent(() => {
  const { t, locale, setLocale } = useI18n();

  return () => (
    <div>
      <h1>{t('app.name')}</h1>
      <p>{t('app.tagline')}</p>

      <nav>
        <a href="/">{t('nav.home')}</a>
        <a href="/about">{t('nav.about')}</a>
        <a href="/contact">{t('nav.contact')}</a>
      </nav>

      <button onClick={() => setLocale('es')}>
        Español
      </button>
    </div>
  );
});
```

### Interpolation

```typescript
// Translation with variables
{
  "greeting": "Hello, {name}!",
  "itemCount": "You have {count} items in your cart",
  "welcome": "Welcome back, {name}. You have {count} new messages."
}

// Usage
const { t } = useI18n();

t('greeting', { name: 'Alice' }); // "Hello, Alice!"
t('itemCount', { count: 5 }); // "You have 5 items in your cart"
t('welcome', { name: 'Bob', count: 3 }); // "Welcome back, Bob. You have 3 new messages."
```

### HTML in Translations

```typescript
// Translation with HTML
{
  "terms": "I agree to the <a href='/terms'>terms and conditions</a>",
  "markdown": "This is **bold** and *italic*"
}

// Usage - with HTML
<div innerHTML={t('terms')} />

// Or use Trans component for safe HTML
import { Trans } from '@aether/i18n';

<Trans
  i18nKey="terms"
  components={{
    a: <a href="/terms" />
  }}
/>
```

### Namespaces

```typescript
// Load multiple translation files
const { t } = useI18n({ namespace: 'auth' });

t('login.title'); // From auth.json
t('login.email');
t('login.password');

// Multiple namespaces
const { t } = useI18n({ namespaces: ['common', 'auth'] });

t('common:app.name');
t('auth:login.title');
```

## Language Detection

Automatically detect user's language.

### Browser Language

```typescript
// Detect browser language
export const detectBrowserLanguage = (): string => {
  // Check navigator.language
  const browserLang = navigator.language || (navigator as any).userLanguage;

  // Extract language code (en-US -> en)
  const lang = browserLang.split('-')[0];

  return lang;
};

// Use in i18n setup
const detectedLang = detectBrowserLanguage();

export const i18n = createI18n({
  locale: detectedLang,
  fallbackLocale: 'en'
  // ...
});
```

### User Preference

```typescript
// Save user preference
export const setUserLanguage = (locale: string) => {
  localStorage.setItem('user-language', locale);
  i18n.setLocale(locale);
};

// Load user preference
export const getUserLanguage = (): string | null => {
  return localStorage.getItem('user-language');
};

// Initialize with user preference
const userLang = getUserLanguage();
const browserLang = detectBrowserLanguage();
const defaultLang = userLang || browserLang || 'en';

i18n.setLocale(defaultLang);
```

### URL-Based Detection

```typescript
// Detect language from URL path
// /en/about -> en
// /es/acerca -> es

export const detectLanguageFromPath = (path: string): string | null => {
  const match = path.match(/^\/([a-z]{2})\//);
  return match ? match[1] : null;
};

// Router integration
export default defineComponent(() => {
  const location = useLocation();
  const { setLocale } = useI18n();

  createEffect(() => {
    const lang = detectLanguageFromPath(location.pathname);
    if (lang) {
      setLocale(lang);
    }
  });

  return () => <Router />;
});
```

## Language Switching

Allow users to change language.

### Language Selector

```typescript
export const LanguageSelector = defineComponent(() => {
  const { locale, setLocale, availableLocales } = useI18n();

  const languages = {
    en: '🇬🇧 English',
    es: '🇪🇸 Español',
    fr: '🇫🇷 Français',
    de: '🇩🇪 Deutsch',
    ja: '🇯🇵 日本語',
    ar: '🇸🇦 العربية'
  };

  return () => (
    <select
      value={locale()}
      onChange={(e) => setLocale(e.currentTarget.value)}
    >
      <For each={availableLocales()}>
        {(lang) => (
          <option value={lang}>
            {languages[lang as keyof typeof languages]}
          </option>
        )}
      </For>
    </select>
  );
});
```

### Dropdown Menu

```typescript
export const LanguageMenu = defineComponent(() => {
  const { locale, setLocale } = useI18n();
  const open = signal(false);

  const languages = [
    { code: 'en', name: 'English', flag: '🇬🇧' },
    { code: 'es', name: 'Español', flag: '🇪🇸' },
    { code: 'fr', name: 'Français', flag: '🇫🇷' },
    { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
    { code: 'ja', name: '日本語', flag: '🇯🇵' },
    { code: 'ar', name: 'العربية', flag: '🇸🇦' }
  ];

  const currentLang = () => languages.find(l => l.code === locale());

  const handleSelect = (code: string) => {
    setLocale(code);
    open.set(false);
  };

  return () => (
    <div class="language-menu">
      <button onClick={() => open.set(!open())}>
        {currentLang()?.flag} {currentLang()?.name}
      </button>

      <Show when={open()}>
        <div class="dropdown">
          <For each={languages}>
            {(lang) => (
              <button
                onClick={() => handleSelect(lang.code)}
                class={locale() === lang.code ? 'active' : ''}
              >
                {lang.flag} {lang.name}
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
});
```

## Pluralization

Handle plural forms correctly.

### Basic Pluralization

```typescript
// Translation with pluralization
{
  "items": {
    "zero": "No items",
    "one": "One item",
    "other": "{count} items"
  }
}

// Usage
const { t } = useI18n();

t('items', { count: 0 }); // "No items"
t('items', { count: 1 }); // "One item"
t('items', { count: 5 }); // "5 items"
```

### Language-Specific Plurals

```typescript
// English (2 forms: one, other)
{
  "items": {
    "one": "{count} item",
    "other": "{count} items"
  }
}

// Russian (4 forms: one, few, many, other)
{
  "items": {
    "one": "{count} товар",
    "few": "{count} товара",
    "many": "{count} товаров",
    "other": "{count} товара"
  }
}

// Arabic (6 forms: zero, one, two, few, many, other)
{
  "items": {
    "zero": "لا توجد عناصر",
    "one": "عنصر واحد",
    "two": "عنصران",
    "few": "{count} عناصر",
    "many": "{count} عنصرًا",
    "other": "{count} عنصر"
  }
}
```

### Custom Plural Rules

```typescript
// Define custom plural rule
import { createI18n } from '@aether/i18n';

export const i18n = createI18n({
  pluralRules: {
    en: (count: number) => {
      if (count === 0) return 'zero';
      if (count === 1) return 'one';
      return 'other';
    },
    ru: (count: number) => {
      if (count % 10 === 1 && count % 100 !== 11) return 'one';
      if (count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 10 || count % 100 >= 20)) return 'few';
      return 'many';
    }
  }
});
```

## Number Formatting

Format numbers according to locale.

### Basic Number Formatting

```typescript
const { n } = useI18n();

// Default formatting
n(1234.56); // en: "1,234.56", de: "1.234,56", fr: "1 234,56"

// With options
n(1234.56, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
}); // "1,234.56"

// Percentage
n(0.75, { style: 'percent' }); // "75%"

// Scientific
n(123456, { notation: 'scientific' }); // "1.23E5"
```

### Named Number Formats

```typescript
// Define formats in config
export const i18n = createI18n({
  numberFormats: {
    en: {
      decimal: {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      },
      percent: {
        style: 'percent',
        minimumFractionDigits: 1
      },
      compact: {
        notation: 'compact',
        compactDisplay: 'short'
      }
    }
  }
});

// Usage
const { n } = useI18n();

n(1234.5, 'decimal'); // "1,234.50"
n(0.756, 'percent'); // "75.6%"
n(1200000, 'compact'); // "1.2M"
```

## Date and Time Formatting

Format dates and times according to locale.

### Basic Date Formatting

```typescript
const { d } = useI18n();

const date = new Date('2024-01-15T14:30:00');

// Default formatting
d(date); // en: "1/15/2024", de: "15.1.2024", fr: "15/01/2024"

// With options
d(date, {
  year: 'numeric',
  month: 'long',
  day: 'numeric'
}); // en: "January 15, 2024"

d(date, {
  hour: 'numeric',
  minute: 'numeric',
  hour12: true
}); // en: "2:30 PM"
```

### Named Date Formats

```typescript
// Define formats in config
export const i18n = createI18n({
  datetimeFormats: {
    en: {
      short: {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      },
      long: {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'long'
      },
      time: {
        hour: 'numeric',
        minute: 'numeric',
        hour12: true
      },
      full: {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        hour12: true
      }
    }
  }
});

// Usage
const { d } = useI18n();

const date = new Date();

d(date, 'short'); // "Jan 15, 2024"
d(date, 'long'); // "Monday, January 15, 2024"
d(date, 'time'); // "2:30 PM"
d(date, 'full'); // "January 15, 2024, 2:30 PM"
```

### Relative Time

```typescript
// Relative time formatting
import { formatRelativeTime } from '@aether/i18n';

const now = new Date();
const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
const lastWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

formatRelativeTime(yesterday); // "1 day ago"
formatRelativeTime(lastWeek); // "1 week ago"

// Custom relative time
export const useRelativeTime = (date: Date) => {
  const { locale } = useI18n();

  const formatter = new Intl.RelativeTimeFormat(locale(), {
    numeric: 'auto',
    style: 'long'
  });

  const diff = date.getTime() - Date.now();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (Math.abs(days) > 0) {
    return formatter.format(days, 'day');
  } else if (Math.abs(hours) > 0) {
    return formatter.format(hours, 'hour');
  } else if (Math.abs(minutes) > 0) {
    return formatter.format(minutes, 'minute');
  } else {
    return formatter.format(seconds, 'second');
  }
};
```

## Currency Formatting

Format currency according to locale.

### Basic Currency Formatting

```typescript
const { n } = useI18n();

// Default currency (from config)
n(1234.56, 'currency'); // en-US: "$1,234.56", de-DE: "1.234,56 €"

// Specific currency
n(1234.56, {
  style: 'currency',
  currency: 'USD'
}); // "$1,234.56"

n(1234.56, {
  style: 'currency',
  currency: 'EUR'
}); // "€1,234.56" (en) or "1.234,56 €" (de)

n(1234.56, {
  style: 'currency',
  currency: 'JPY'
}); // "¥1,235" (no decimals for JPY)
```

### Named Currency Formats

```typescript
// Define formats
export const i18n = createI18n({
  numberFormats: {
    en: {
      currency: {
        style: 'currency',
        currency: 'USD'
      },
      currencyCompact: {
        style: 'currency',
        currency: 'USD',
        notation: 'compact'
      }
    },
    de: {
      currency: {
        style: 'currency',
        currency: 'EUR'
      }
    },
    ja: {
      currency: {
        style: 'currency',
        currency: 'JPY'
      }
    }
  }
});

// Usage
n(1234567, 'currencyCompact'); // "$1.2M"
```

## RTL Support

Support right-to-left languages.

### Detect RTL

```typescript
// RTL languages
const RTL_LOCALES = ['ar', 'he', 'fa', 'ur'];

export const isRTL = (locale: string): boolean => {
  return RTL_LOCALES.includes(locale);
};

// Usage in component
export default defineComponent(() => {
  const { locale } = useI18n();
  const rtl = () => isRTL(locale());

  return () => (
    <div dir={rtl() ? 'rtl' : 'ltr'}>
      <App />
    </div>
  );
});
```

### RTL Styles

```typescript
// CSS for RTL
const styles = css({
  '.container': {
    paddingLeft: '1rem',

    '[dir="rtl"] &': {
      paddingLeft: 0,
      paddingRight: '1rem'
    }
  },

  // Or use logical properties (automatically flips)
  '.container': {
    paddingInlineStart: '1rem' // Left in LTR, right in RTL
  },

  '.icon': {
    marginInlineEnd: '0.5rem' // Right in LTR, left in RTL
  }
});

// Flip icons for RTL
<Show when={rtl()}>
  <Icon name="arrow-right" style={{ transform: 'scaleX(-1)' }} />
</Show>
```

### BiDi Text

```typescript
// Handle bidirectional text
export const BidiText = defineComponent((props: { children: string }) => {
  return () => (
    <span dir="auto">
      {props.children}
    </span>
  );
});

// Usage - automatically detects text direction
<BidiText>مرحبا Hello</BidiText>
```

## Dynamic Translations

Translate dynamic content.

### Database Content

```typescript
// Store translations in database
interface Post {
  id: string;
  translations: {
    [locale: string]: {
      title: string;
      content: string;
    };
  };
}

// Access translated content
export const PostView = defineComponent((props: { post: Post }) => {
  const { locale } = useI18n();

  const translated = () => {
    return props.post.translations[locale()] || props.post.translations['en'];
  };

  return () => (
    <article>
      <h1>{translated().title}</h1>
      <div innerHTML={translated().content} />
    </article>
  );
});
```

### API Translations

```typescript
// Request translations from API
export const fetchTranslatedPost = async (id: string, locale: string) => {
  const response = await fetch(`/api/posts/${id}?locale=${locale}`);
  return response.json();
};

// Component
export const PostView = defineComponent((props: { id: string }) => {
  const { locale } = useI18n();
  const [post] = resource(() => ({ id: props.id, locale: locale() }),
    ({ id, locale }) => fetchTranslatedPost(id, locale)
  );

  return () => (
    <Show when={post()}>
      <article>
        <h1>{post()!.title}</h1>
        <div innerHTML={post()!.content} />
      </article>
    </Show>
  );
});
```

## Translation Management

Manage translations efficiently.

### Translation Keys

```typescript
// Type-safe translation keys
export type TranslationKeys = {
  'app.name': string;
  'app.tagline': string;
  'nav.home': string;
  'nav.about': string;
  'auth.login.title': string;
  'auth.login.email': string;
  // ... all keys
};

// Typed t function
const t = <K extends keyof TranslationKeys>(
  key: K,
  params?: Record<string, any>
): TranslationKeys[K] => {
  return i18n.t(key, params);
};

// Usage - autocomplete and type checking
t('app.name'); // ✓
t('invalid.key'); // ✗ Type error
```

### Missing Translations

```typescript
// Track missing translations
const missingTranslations = new Set<string>();

export const i18n = createI18n({
  missing: (locale, key) => {
    const missing = `${locale}:${key}`;

    if (!missingTranslations.has(missing)) {
      missingTranslations.add(missing);

      // Log to server
      fetch('/api/translations/missing', {
        method: 'POST',
        body: JSON.stringify({ locale, key })
      });

      console.warn(`Missing translation: ${missing}`);
    }

    return key;
  }
});
```

### Translation Coverage

```typescript
// Check translation coverage
export const getTranslationCoverage = (locale: string) => {
  const baseKeys = Object.keys(i18n.messages['en']);
  const localeKeys = Object.keys(i18n.messages[locale]);

  const coverage = (localeKeys.length / baseKeys.length) * 100;

  const missing = baseKeys.filter(key => !localeKeys.includes(key));

  return {
    coverage: Math.round(coverage),
    total: baseKeys.length,
    translated: localeKeys.length,
    missing
  };
};

// Usage
const coverage = getTranslationCoverage('es');
console.log(`Spanish: ${coverage.coverage}% (${coverage.translated}/${coverage.total})`);
console.log('Missing keys:', coverage.missing);
```

## Server-Side i18n

Handle i18n on the server.

### SSR with i18n

```typescript
// server.ts
import { createI18n } from '@aether/i18n';

export const render = async (req: Request) => {
  // Detect locale from request
  const locale = detectLocale(req);

  // Create i18n instance for this request
  const i18n = createI18n({
    locale,
    messages: {
      // Load messages
    }
  });

  // Render with i18n
  const html = renderToString(() => (
    <I18nProvider i18n={i18n}>
      <App />
    </I18nProvider>
  ));

  return html;
};

// Detect locale from request
const detectLocale = (req: Request): string => {
  // 1. Check URL parameter
  const url = new URL(req.url);
  const urlLocale = url.searchParams.get('locale');
  if (urlLocale) return urlLocale;

  // 2. Check cookie
  const cookieLocale = req.cookies?.locale;
  if (cookieLocale) return cookieLocale;

  // 3. Check Accept-Language header
  const acceptLanguage = req.headers['accept-language'];
  if (acceptLanguage) {
    const locale = acceptLanguage.split(',')[0].split('-')[0];
    return locale;
  }

  // 4. Default
  return 'en';
};
```

## SEO

Optimize multilingual sites for search engines.

### Alternate Links

```html
<!-- Add alternate links for each language -->
<head>
  <link rel="alternate" hreflang="en" href="https://example.com/en/page" />
  <link rel="alternate" hreflang="es" href="https://example.com/es/page" />
  <link rel="alternate" hreflang="fr" href="https://example.com/fr/page" />
  <link rel="alternate" hreflang="x-default" href="https://example.com/en/page" />
</head>
```

```typescript
// Generate alternate links
export const AlternateLinks = defineComponent((props: { path: string }) => {
  const { availableLocales } = useI18n();

  return () => (
    <>
      <For each={availableLocales()}>
        {(locale) => (
          <link
            rel="alternate"
            hreflang={locale}
            href={`https://example.com/${locale}${props.path}`}
          />
        )}
      </For>
      <link
        rel="alternate"
        hreflang="x-default"
        href={`https://example.com/en${props.path}`}
      />
    </>
  );
});
```

### Sitemap

```xml
<!-- sitemap.xml -->
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url>
    <loc>https://example.com/en/page</loc>
    <xhtml:link rel="alternate" hreflang="es" href="https://example.com/es/page"/>
    <xhtml:link rel="alternate" hreflang="fr" href="https://example.com/fr/page"/>
  </url>
  <url>
    <loc>https://example.com/es/page</loc>
    <xhtml:link rel="alternate" hreflang="en" href="https://example.com/en/page"/>
    <xhtml:link rel="alternate" hreflang="fr" href="https://example.com/fr/page"/>
  </url>
</urlset>
```

## Testing

Test translations and i18n.

### Unit Tests

```typescript
import { createI18n } from '@aether/i18n';

describe('i18n', () => {
  const i18n = createI18n({
    locale: 'en',
    messages: {
      en: {
        hello: 'Hello',
        greeting: 'Hello, {name}!',
        items: {
          one: 'One item',
          other: '{count} items'
        }
      },
      es: {
        hello: 'Hola',
        greeting: 'Hola, {name}!',
        items: {
          one: 'Un artículo',
          other: '{count} artículos'
        }
      }
    }
  });

  it('translates simple key', () => {
    expect(i18n.t('hello')).toBe('Hello');
  });

  it('interpolates variables', () => {
    expect(i18n.t('greeting', { name: 'Alice' })).toBe('Hello, Alice!');
  });

  it('handles pluralization', () => {
    expect(i18n.t('items', { count: 1 })).toBe('One item');
    expect(i18n.t('items', { count: 5 })).toBe('5 items');
  });

  it('switches locale', () => {
    i18n.setLocale('es');
    expect(i18n.t('hello')).toBe('Hola');
  });

  it('falls back to default locale', () => {
    i18n.setLocale('de'); // No translations for 'de'
    expect(i18n.t('hello')).toBe('Hello'); // Falls back to 'en'
  });
});
```

### E2E Tests

```typescript
import { test, expect } from '@playwright/test';

test.describe('i18n', () => {
  test('switches language', async ({ page }) => {
    await page.goto('/');

    // Check initial language
    await expect(page.locator('h1')).toHaveText('Welcome');

    // Switch to Spanish
    await page.selectOption('[name="language"]', 'es');

    // Check Spanish text
    await expect(page.locator('h1')).toHaveText('Bienvenido');

    // Reload page - should persist
    await page.reload();
    await expect(page.locator('h1')).toHaveText('Bienvenido');
  });

  test('formats numbers correctly', async ({ page }) => {
    await page.goto('/');

    const price = page.locator('.price');

    // English
    await expect(price).toHaveText('$1,234.56');

    // German
    await page.selectOption('[name="language"]', 'de');
    await expect(price).toHaveText('1.234,56 €');
  });
});
```

## Best Practices

### Guidelines

```typescript
/**
 * i18n Best Practices:
 *
 * 1. Use Keys, Not English Text
 *    ✓ t('auth.login.title')
 *    ✗ t('Log in to your account')
 *
 * 2. Organize by Feature
 *    - auth.json, dashboard.json, etc.
 *    - Not all.json
 *
 * 3. Use Namespaces
 *    - Avoid key collisions
 *    - Lazy load translations
 *
 * 4. Provide Context
 *    - button.save vs form.save
 *    - Different contexts may need different translations
 *
 * 5. Avoid Concatenation
 *    ✓ t('greeting', { name })
 *    ✗ t('hello') + ' ' + name
 *
 * 6. Support Pluralization
 *    - Use plural forms, not if/else
 *
 * 7. Use ICU Message Format
 *    - For complex pluralization/gender
 *
 * 8. Extract Translatable Strings
 *    - Don't hardcode text
 *    - Use extraction tools
 *
 * 9. Test All Locales
 *    - Ensure translations work
 *    - Check formatting
 *
 * 10. Monitor Missing Translations
 *     - Track and fix missing keys
 */
```

## Examples

### Complete i18n Setup

```typescript
// i18n/index.ts
import { createI18n } from '@aether/i18n';

// Lazy load translations
const loadLocale = async (locale: string) => {
  const [common, auth, dashboard] = await Promise.all([
    import(`./locales/${locale}/common.json`),
    import(`./locales/${locale}/auth.json`),
    import(`./locales/${locale}/dashboard.json`)
  ]);

  return {
    common: common.default,
    auth: auth.default,
    dashboard: dashboard.default
  };
};

// Detect initial locale
const detectInitialLocale = (): string => {
  // 1. User preference
  const saved = localStorage.getItem('locale');
  if (saved) return saved;

  // 2. Browser language
  const browserLang = navigator.language.split('-')[0];
  const supported = ['en', 'es', 'fr', 'de', 'ja', 'ar'];
  if (supported.includes(browserLang)) return browserLang;

  // 3. Default
  return 'en';
};

export const i18n = createI18n({
  locale: detectInitialLocale(),
  fallbackLocale: 'en',
  messages: {},
  async: true
});

// Load initial locale
const initialLocale = detectInitialLocale();
const messages = await loadLocale(initialLocale);
i18n.setMessages(initialLocale, messages);

// Helper to change locale
export const changeLocale = async (locale: string) => {
  // Load if not loaded
  if (!i18n.availableLocales.includes(locale)) {
    const messages = await loadLocale(locale);
    i18n.setMessages(locale, messages);
  }

  // Set locale
  i18n.setLocale(locale);

  // Save preference
  localStorage.setItem('locale', locale);

  // Update document
  document.documentElement.lang = locale;
  document.documentElement.dir = isRTL(locale) ? 'rtl' : 'ltr';
};
```

## Summary

Internationalization makes your app accessible worldwide:

1. **Setup**: Configure i18n with locales and messages
2. **Translations**: Organize in separate files by feature
3. **Detection**: Auto-detect user's language
4. **Switching**: Allow users to change language
5. **Pluralization**: Handle plural forms correctly
6. **Formatting**: Format numbers, dates, currency
7. **RTL**: Support right-to-left languages
8. **Dynamic**: Translate database content
9. **Management**: Track missing translations
10. **SEO**: Optimize for search engines

Build global apps with Aether i18n.
