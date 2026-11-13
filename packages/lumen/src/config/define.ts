import type { LumenUserConfig, LumenConfig } from './schema.js';
import { LumenUserConfigSchema } from './schema.js';

export function defineLumenConfig(input: LumenUserConfig): LumenConfig {
  const parsed = LumenUserConfigSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(`Invalid Lumen configuration:\n${parsed.error.issues
      .map(issue => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('\n')}`, { cause: parsed.error });
  }
  const userConfig = parsed.data;
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
    examples: userConfig.examples,
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
          paperSections: userConfig.pdf.paperSections ?? [],
        }
      : undefined,
  };
}
