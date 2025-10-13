/**
 * Locale Router
 *
 * Router integration for locale-based routing
 */

import type { LocaleCode, RouteLocaleConfig } from './types.js';
import type { I18n } from './i18n.js';

/**
 * Locale router configuration
 */
export interface LocaleRouterConfig extends RouteLocaleConfig {
  i18n: I18n;
}

/**
 * Locale router class
 */
export class LocaleRouter {
  private config: Required<RouteLocaleConfig>;
  private i18n: I18n;

  constructor(config: LocaleRouterConfig) {
    this.i18n = config.i18n;
    this.config = {
      includeLocaleInPath: config.includeLocaleInPath ?? true,
      localePrefix: config.localePrefix ?? 'as-needed',
      excludePaths: config.excludePaths ?? [],
      redirectToLocale: config.redirectToLocale ?? true,
    };
  }

  /**
   * Get localized path
   */
  getLocalizedPath(path: string, locale?: LocaleCode): string {
    const effectiveLocale = locale || this.i18n.getLocale();
    const defaultLocale = this.i18n.locales[0] || effectiveLocale;

    // Check if path should be excluded
    if (this.isExcluded(path)) {
      return path;
    }

    // Remove existing locale prefix if present
    const cleanPath = this.removeLocalePrefix(path);

    // Determine if locale prefix should be added
    const shouldAddPrefix = this.shouldAddLocalePrefix(effectiveLocale, defaultLocale);

    if (shouldAddPrefix) {
      return `/${effectiveLocale}${cleanPath}`;
    }

    return cleanPath;
  }

  /**
   * Extract locale from path
   */
  extractLocaleFromPath(path: string): { locale: LocaleCode | null; path: string } {
    const parts = path.split('/').filter(Boolean);

    if (parts.length === 0) {
      return { locale: null, path: '/' };
    }

    const firstPart = parts[0];

    // Check if first part is a valid locale
    if (firstPart && this.i18n.locales.includes(firstPart)) {
      const remainingPath = '/' + parts.slice(1).join('/');
      return { locale: firstPart, path: remainingPath || '/' };
    }

    return { locale: null, path };
  }

  /**
   * Remove locale prefix from path
   */
  removeLocalePrefix(path: string): string {
    const { path: cleanPath } = this.extractLocaleFromPath(path);
    return cleanPath;
  }

  /**
   * Check if locale prefix should be added
   */
  private shouldAddLocalePrefix(locale: LocaleCode, defaultLocale: LocaleCode): boolean {
    if (!this.config.includeLocaleInPath) {
      return false;
    }

    switch (this.config.localePrefix) {
      case 'always':
        return true;

      case 'as-needed':
        return locale !== defaultLocale;

      case 'never':
        return false;

      default:
        return false;
    }
  }

  /**
   * Check if path should be excluded from locale handling
   */
  private isExcluded(path: string): boolean {
    return this.config.excludePaths.some((excludePath) => {
      if (excludePath.endsWith('*')) {
        // Wildcard matching
        const prefix = excludePath.slice(0, -1);
        return path.startsWith(prefix);
      }
      return path === excludePath;
    });
  }

  /**
   * Generate hreflang links
   */
  generateHreflangLinks(path: string, baseUrl: string): Array<{ locale: LocaleCode; url: string }> {
    const cleanPath = this.removeLocalePrefix(path);

    return this.i18n.locales.map((locale) => {
      const localizedPath = this.getLocalizedPath(cleanPath, locale);
      const url = `${baseUrl}${localizedPath}`;
      return { locale, url };
    });
  }

  /**
   * Create hreflang link elements
   */
  createHreflangElements(path: string, baseUrl: string): string {
    const links = this.generateHreflangLinks(path, baseUrl);

    return links.map(({ locale, url }) => `<link rel="alternate" hreflang="${locale}" href="${url}" />`).join('\n');
  }

  /**
   * Redirect to localized URL
   */
  redirectToLocale(locale?: LocaleCode): void {
    if (typeof window === 'undefined') return;

    const targetLocale = locale || this.i18n.getLocale();
    const currentPath = window.location.pathname;
    const localizedPath = this.getLocalizedPath(currentPath, targetLocale);

    if (localizedPath !== currentPath) {
      const search = window.location.search;
      const hash = window.location.hash;
      window.location.href = localizedPath + search + hash;
    }
  }

  /**
   * Get locale from current URL
   */
  getLocaleFromURL(): LocaleCode | null {
    if (typeof window === 'undefined') return null;

    const { locale } = this.extractLocaleFromPath(window.location.pathname);
    return locale;
  }

  /**
   * Sync URL with current locale
   */
  syncURLWithLocale(): void {
    if (!this.config.redirectToLocale) return;

    const urlLocale = this.getLocaleFromURL();
    const currentLocale = this.i18n.getLocale();

    if (urlLocale !== currentLocale) {
      this.redirectToLocale(currentLocale);
    }
  }
}

/**
 * Create locale router
 */
export function createLocaleRouter(config: LocaleRouterConfig): LocaleRouter {
  return new LocaleRouter(config);
}

/**
 * Locale-aware Link props helper
 */
export function createLocalizedLink(
  router: LocaleRouter,
  href: string,
  locale?: LocaleCode
): { href: string; hreflang?: string } {
  const localizedHref = router.getLocalizedPath(href, locale);

  return {
    href: localizedHref,
    hreflang: locale,
  };
}

/**
 * Navigation hook for locale-aware routing
 */
export function createLocaleNavigate(
  router: LocaleRouter,
  navigate: (path: string) => void
): (path: string, locale?: LocaleCode) => void {
  return (path: string, locale?: LocaleCode) => {
    const localizedPath = router.getLocalizedPath(path, locale);
    navigate(localizedPath);
  };
}
