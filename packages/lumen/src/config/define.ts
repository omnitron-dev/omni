import type { LumenUserConfig, LumenConfig } from './schema.js';

export function defineLumenConfig(userConfig: LumenUserConfig): LumenConfig {
  let baseUrl = userConfig.baseUrl ?? '/';
  if (!baseUrl.startsWith('/')) {
    baseUrl = `/${baseUrl}`;
  }

  let locales: string[] = ['en'];
  let defaultLocale: string = userConfig.defaultLocale ?? 'en';

  if (Array.isArray(userConfig.locales)) {
    locales = [...userConfig.locales];
    if (!userConfig.defaultLocale && locales.length > 0) {
      defaultLocale = locales[0]!;
    }
  } else if (userConfig.locales && typeof userConfig.locales === 'object') {
    locales = [...userConfig.locales.locales];
    defaultLocale = userConfig.locales.defaultLocale ?? defaultLocale;
  } else if (userConfig.defaultLocale) {
    locales = [userConfig.defaultLocale];
  }

  return {
    title: userConfig.title,
    tagline: userConfig.tagline ?? '',
    url: userConfig.url ?? 'http://localhost:3000',
    baseUrl,
    trailingSlash: userConfig.trailingSlash ?? false,
    onBrokenLinks: userConfig.onBrokenLinks ?? 'throw',
    onBrokenAnchors: userConfig.onBrokenAnchors ?? 'throw',
    srcDir: userConfig.srcDir ?? 'docs',
    outDir: userConfig.outDir ?? 'dist',
    publicDir: userConfig.publicDir,
    pagesDir: userConfig.pagesDir,
    clientEntry: userConfig.clientEntry,
    stylesheets: userConfig.stylesheets ?? [],
    sidebars: (userConfig.sidebars ?? {}) as Record<string, import('./schema.js').LumenSidebarItem[]>,
    katexMacros: userConfig.katexMacros ?? {},
    locales,
    defaultLocale,
    theme: {
      defaultMode: userConfig.theme?.defaultMode ?? 'dark',
      layout: userConfig.theme?.layout,
    },
    gates: userConfig.gates ?? [],
    pdf: userConfig.pdf
      ? {
          enabled: userConfig.pdf.enabled ?? false,
          paperSections: userConfig.pdf.paperSections ?? [],
        }
      : undefined,
    titan: {
      url: userConfig.titan?.url,
      enabled: userConfig.titan?.enabled ?? false,
    },
  };
}
