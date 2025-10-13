/**
 * Translation Loader
 *
 * Lazy loading and caching of translation files
 */

import type { TranslationMessages, LocaleCode } from './types.js';

/**
 * Loader function type
 */
export type LoaderFunction = (locale: LocaleCode) => Promise<TranslationMessages>;

/**
 * Cache entry
 */
interface CacheEntry {
  messages: TranslationMessages;
  timestamp: number;
}

/**
 * Translation loader with caching
 */
export class TranslationLoader {
  private cache = new Map<LocaleCode, CacheEntry>();
  private loading = new Map<LocaleCode, Promise<TranslationMessages>>();
  private loaderFunction: LoaderFunction | null = null;
  private cacheDuration: number;

  constructor(options?: { cacheDuration?: number }) {
    // Default cache duration: 5 minutes
    this.cacheDuration = options?.cacheDuration ?? 5 * 60 * 1000;
  }

  /**
   * Set loader function
   */
  setLoader(loader: LoaderFunction): void {
    this.loaderFunction = loader;
  }

  /**
   * Load messages for locale
   */
  async load(locale: LocaleCode): Promise<TranslationMessages> {
    // Check cache first
    const cached = this.getFromCache(locale);
    if (cached) {
      return cached;
    }

    // Check if already loading
    const loading = this.loading.get(locale);
    if (loading) {
      return loading;
    }

    // Load messages
    if (!this.loaderFunction) {
      throw new Error('No loader function configured');
    }

    const loadPromise = this.loaderFunction(locale)
      .then((messages) => {
        // Store in cache
        this.cache.set(locale, {
          messages,
          timestamp: Date.now(),
        });

        // Remove from loading map
        this.loading.delete(locale);

        return messages;
      })
      .catch((error) => {
        // Remove from loading map on error
        this.loading.delete(locale);
        throw error;
      });

    // Store loading promise
    this.loading.set(locale, loadPromise);

    return loadPromise;
  }

  /**
   * Get messages from cache
   */
  private getFromCache(locale: LocaleCode): TranslationMessages | null {
    const entry = this.cache.get(locale);
    if (!entry) return null;

    // Check if cache is still valid
    const age = Date.now() - entry.timestamp;
    if (age > this.cacheDuration) {
      this.cache.delete(locale);
      return null;
    }

    return entry.messages;
  }

  /**
   * Preload messages for locale
   */
  async preload(locale: LocaleCode): Promise<void> {
    await this.load(locale);
  }

  /**
   * Preload multiple locales
   */
  async preloadAll(locales: LocaleCode[]): Promise<void> {
    await Promise.all(locales.map((locale) => this.preload(locale)));
  }

  /**
   * Check if locale is cached
   */
  isCached(locale: LocaleCode): boolean {
    return this.cache.has(locale);
  }

  /**
   * Check if locale is currently loading
   */
  isLoading(locale: LocaleCode): boolean {
    return this.loading.has(locale);
  }

  /**
   * Clear cache for locale
   */
  clearCache(locale?: LocaleCode): void {
    if (locale) {
      this.cache.delete(locale);
    } else {
      this.cache.clear();
    }
  }

  /**
   * Get cache size
   */
  getCacheSize(): number {
    return this.cache.size;
  }

  /**
   * Get all cached locales
   */
  getCachedLocales(): LocaleCode[] {
    return Array.from(this.cache.keys());
  }
}

/**
 * Create a file-based loader
 * Loads translation files from a directory
 */
export function createFileLoader(baseUrl: string): LoaderFunction {
  return async (locale: LocaleCode) => {
    const url = `${baseUrl}/${locale}.json`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to load translations for locale ${locale}: ${response.statusText}`);
    }

    return response.json();
  };
}

/**
 * Create a dynamic import loader
 * Uses dynamic imports for code-splitting
 */
export function createDynamicLoader(
  importer: (locale: LocaleCode) => Promise<{ default: TranslationMessages }>,
): LoaderFunction {
  return async (locale: LocaleCode) => {
    const module = await importer(locale);
    return module.default;
  };
}

/**
 * Create a chunked loader
 * Loads translations in chunks/namespaces
 */
export function createChunkedLoader(
  loaders: Record<string, LoaderFunction>,
): LoaderFunction {
  return async (locale: LocaleCode) => {
    const messages: TranslationMessages = {};

    // Load all chunks in parallel
    const entries = Object.entries(loaders);
    const results = await Promise.all(
      entries.map(async ([namespace, loader]) => ({
        namespace,
        messages: await loader(locale),
      })),
    );

    // Merge all chunks
    for (const { namespace, messages: chunkMessages } of results) {
      messages[namespace] = chunkMessages;
    }

    return messages;
  };
}

/**
 * Create a fallback loader
 * Tries multiple loaders in order
 */
export function createFallbackLoader(loaders: LoaderFunction[]): LoaderFunction {
  return async (locale: LocaleCode) => {
    let lastError: Error | null = null;

    for (const loader of loaders) {
      try {
        return await loader(locale);
      } catch (error) {
        lastError = error as Error;
      }
    }

    throw lastError || new Error(`Failed to load translations for locale ${locale}`);
  };
}

/**
 * Create a cached loader
 * Wraps another loader with caching
 */
export function createCachedLoader(
  loader: LoaderFunction,
  options?: { cacheDuration?: number },
): LoaderFunction {
  const translationLoader = new TranslationLoader(options);
  translationLoader.setLoader(loader);

  return (locale: LocaleCode) => translationLoader.load(locale);
}
