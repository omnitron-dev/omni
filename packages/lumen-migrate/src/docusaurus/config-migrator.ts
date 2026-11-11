import type { ConvertedLumenConfig, DocusaurusConfigInput } from '../types.js';
import { convertDocusaurusSidebars } from './sidebar-migrator.js';
import { extractKatexMacrosFromConfig } from '../katex/macro-extractor.js';

export function convertDocusaurusConfig(
  config: DocusaurusConfigInput = {},
  rawSidebars?: Record<string, unknown>
): ConvertedLumenConfig {
  const title = typeof config.title === 'string' && config.title.trim() ? config.title : 'Migrated Documentation';

  const baseUrl = typeof config.baseUrl === 'string' && config.baseUrl.trim() ? config.baseUrl : '/';

  const locales =
    config.i18n?.locales && Array.isArray(config.i18n.locales) && config.i18n.locales.length > 0
      ? config.i18n.locales
      : ['en'];

  const defaultLocale =
    typeof config.i18n?.defaultLocale === 'string' && config.i18n.defaultLocale.trim()
      ? config.i18n.defaultLocale
      : 'en';

  const sidebars = rawSidebars ? convertDocusaurusSidebars(rawSidebars) : {};
  const katexMacros = extractKatexMacrosFromConfig(config);

  const defaultMode = config.themeConfig?.colorMode?.defaultMode === 'light' ? 'light' : 'dark';

  return {
    title,
    tagline: config.tagline,
    url: config.url,
    baseUrl,
    trailingSlash: config.trailingSlash,
    onBrokenLinks: config.onBrokenLinks,
    onBrokenAnchors: config.onBrokenAnchors,
    locales,
    defaultLocale,
    sidebars,
    katexMacros,
    theme: { defaultMode },
  };
}
