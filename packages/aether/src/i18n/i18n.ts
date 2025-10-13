/**
 * I18n Core
 *
 * Main internationalization class with locale management
 */

import { signal } from '../core/reactivity/signal.js';
import { computed } from '../core/reactivity/computed.js';
import type { WritableSignal } from '../core/reactivity/types.js';
import type { Computed } from '../core/reactivity/types.js';
import type {
  I18nConfig,
  LocaleCode,
  TranslationMessages,
  InterpolationValues,
  TranslateFunction,
  Formatters,
} from './types.js';
import { Translator } from './translator.js';
import { TranslationLoader } from './loader.js';
import { createFormatters } from './formatters.js';
import { isRTL, getDirection, DirectionObserver } from './rtl.js';

/**
 * I18n class
 */
export class I18n {
  private config: Required<I18nConfig>;
  private translator: Translator;
  private loader: TranslationLoader;
  private localeSignal: WritableSignal<LocaleCode>;
  private directionObserver: DirectionObserver;
  private formattersCache = new Map<LocaleCode, Formatters>();

  constructor(config: I18nConfig) {
    // Set defaults
    this.config = {
      defaultLocale: config.defaultLocale,
      locales: config.locales,
      fallbackLocale: config.fallbackLocale || config.defaultLocale,
      detection: config.detection || ['url', 'cookie', 'localStorage', 'browser'],
      cookieName: config.cookieName || 'locale',
      localStorageKey: config.localStorageKey || 'locale',
      messages: config.messages || {},
      messageLoader: config.messageLoader || (async () => ({})),
      onMissingTranslation:
        config.onMissingTranslation ||
        ((locale, key) => {
          console.warn(`Missing translation for key "${key}" in locale "${locale}"`);
          return key;
        }),
      localeLoader: config.localeLoader || (async () => ({ code: '', name: '', direction: 'ltr', messages: {} })),
    };

    // Create translator
    const fallbackLocales = Array.isArray(this.config.fallbackLocale)
      ? this.config.fallbackLocale
      : [this.config.fallbackLocale];

    this.translator = new Translator(
      this.config.defaultLocale,
      this.config.messages,
      fallbackLocales,
    );

    // Create loader
    this.loader = new TranslationLoader();
    if (this.config.messageLoader) {
      this.loader.setLoader(this.config.messageLoader);
    }

    // Detect initial locale
    const detectedLocale = this.detectLocale();

    // Create reactive locale signal
    this.localeSignal = signal<LocaleCode>(detectedLocale);

    // Create direction observer
    this.directionObserver = new DirectionObserver(detectedLocale);

    // Update translator locale
    this.translator.setLocale(detectedLocale);
  }

  /**
   * Get current locale (reactive)
   */
  get locale(): Computed<LocaleCode> {
    return computed(() => this.localeSignal());
  }

  /**
   * Get current locale value
   */
  getLocale(): LocaleCode {
    return this.localeSignal();
  }

  /**
   * Set current locale
   */
  async setLocale(locale: LocaleCode): Promise<void> {
    if (!this.config.locales.includes(locale)) {
      throw new Error(`Locale "${locale}" is not configured`);
    }

    // Load messages if not already loaded
    if (!this.translator.hasLocale(locale)) {
      try {
        const messages = await this.loader.load(locale);
        this.translator.addMessages(locale, messages);
      } catch (error) {
        console.error(`Failed to load messages for locale "${locale}":`, error);
      }
    }

    // Update locale
    this.localeSignal.set(locale);
    this.translator.setLocale(locale);
    this.directionObserver.updateDirection(locale);

    // Persist locale
    this.persistLocale(locale);

    // Update document attributes
    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale;
      document.documentElement.dir = getDirection(locale);
    }
  }

  /**
   * Translate a key
   */
  t: TranslateFunction = (key: string, values?: InterpolationValues): string => {
    const locale = this.getLocale();
    const translation = this.translator.translate(key, values, { locale });

    // Call missing translation handler if translation not found
    if (translation === key && this.config.onMissingTranslation) {
      const customTranslation = this.config.onMissingTranslation(locale, key);
      if (typeof customTranslation === 'string') {
        return customTranslation;
      }
    }

    return translation;
  };

  /**
   * Check if current locale is RTL
   */
  get isRTL(): Computed<boolean> {
    return computed(() => isRTL(this.localeSignal()));
  }

  /**
   * Get text direction
   */
  get dir(): Computed<'ltr' | 'rtl'> {
    return computed(() => getDirection(this.localeSignal()));
  }

  /**
   * Get available locales
   */
  get locales(): LocaleCode[] {
    return this.config.locales;
  }

  /**
   * Get formatters for current locale
   */
  get formatters(): Formatters {
    const locale = this.getLocale();

    // Check cache
    let formatters = this.formattersCache.get(locale);
    if (!formatters) {
      formatters = createFormatters(locale);
      this.formattersCache.set(locale, formatters);
    }

    return formatters;
  }

  /**
   * Detect locale from various sources
   */
  private detectLocale(): LocaleCode {
    for (const strategy of this.config.detection) {
      let detectedLocale: LocaleCode | null = null;

      switch (strategy) {
        case 'url':
          detectedLocale = this.detectFromURL();
          break;

        case 'cookie':
          detectedLocale = this.detectFromCookie();
          break;

        case 'localStorage':
          detectedLocale = this.detectFromLocalStorage();
          break;

        case 'browser':
        case 'navigator':
          detectedLocale = this.detectFromBrowser();
          break;
          default:
          // Unknown detection strategy
          break;
      }

      if (detectedLocale && this.config.locales.includes(detectedLocale)) {
        return detectedLocale;
      }
    }

    return this.config.defaultLocale;
  }

  /**
   * Detect locale from URL
   */
  private detectFromURL(): LocaleCode | null {
    if (typeof window === 'undefined') return null;

    // Check URL path (e.g., /en/about, /fr/contact)
    const pathParts = window.location.pathname.split('/').filter(Boolean);
    const firstPart = pathParts[0];

    if (firstPart && this.config.locales.includes(firstPart)) {
      return firstPart;
    }

    // Check URL query parameter (e.g., ?locale=en)
    const urlParams = new URLSearchParams(window.location.search);
    const localeParam = urlParams.get('locale') || urlParams.get('lang');

    if (localeParam && this.config.locales.includes(localeParam)) {
      return localeParam;
    }

    return null;
  }

  /**
   * Detect locale from cookie
   */
  private detectFromCookie(): LocaleCode | null {
    if (typeof document === 'undefined') return null;

    const cookies = document.cookie.split(';');
    for (const cookie of cookies) {
      const [name, value] = cookie.trim().split('=');
      if (name === this.config.cookieName) {
        return value || null;
      }
    }

    return null;
  }

  /**
   * Detect locale from localStorage
   */
  private detectFromLocalStorage(): LocaleCode | null {
    if (typeof localStorage === 'undefined') return null;

    try {
      return localStorage.getItem(this.config.localStorageKey);
    } catch {
      return null;
    }
  }

  /**
   * Detect locale from browser
   */
  private detectFromBrowser(): LocaleCode | null {
    if (typeof navigator === 'undefined') return null;

    // Check navigator.language
    const browserLocale = navigator.language;
    if (browserLocale) {
      // Try exact match first
      if (this.config.locales.includes(browserLocale)) {
        return browserLocale;
      }

      // Try language code without region
      const languageCode = browserLocale.split('-')[0];
      if (languageCode && this.config.locales.includes(languageCode)) {
        return languageCode;
      }
    }

    return null;
  }

  /**
   * Persist locale to storage
   */
  private persistLocale(locale: LocaleCode): void {
    // Save to cookie
    if (typeof document !== 'undefined') {
      document.cookie = `${this.config.cookieName}=${locale}; path=/; max-age=31536000`; // 1 year
    }

    // Save to localStorage
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(this.config.localStorageKey, locale);
      } catch {
        // Ignore errors
      }
    }
  }

  /**
   * Add messages for a locale
   */
  addMessages(locale: LocaleCode, messages: TranslationMessages): void {
    this.translator.addMessages(locale, messages);
  }

  /**
   * Preload locale
   */
  async preloadLocale(locale: LocaleCode): Promise<void> {
    if (!this.translator.hasLocale(locale)) {
      const messages = await this.loader.load(locale);
      this.translator.addMessages(locale, messages);
    }
  }

  /**
   * Subscribe to direction changes
   */
  onDirectionChange(callback: (direction: 'ltr' | 'rtl') => void): () => void {
    return this.directionObserver.subscribe(callback);
  }

  /**
   * Get loader
   */
  getLoader(): TranslationLoader {
    return this.loader;
  }
}

/**
 * Create i18n instance
 */
export function createI18n(config: I18nConfig): I18n {
  return new I18n(config);
}
