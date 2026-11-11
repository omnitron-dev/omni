import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DocusaurusConfigInput } from '../types.js';

export function loadDocusaurusConfigFromDir(dirPath: string): {
  config: DocusaurusConfigInput;
  rawSidebars?: Record<string, unknown>;
} {
  let config: DocusaurusConfigInput = {};
  let rawSidebars: Record<string, unknown> | undefined;

  const configCandidates = ['docusaurus.config.ts', 'docusaurus.config.js', 'docusaurus.config.mjs'];

  for (const candidate of configCandidates) {
    const fullPath = resolve(dirPath, candidate);
    if (existsSync(fullPath)) {
      const content = readFileSync(fullPath, 'utf8');
      config = parseDocusaurusConfigContent(content);
      break;
    }
  }

  const sidebarCandidates = ['sidebars.ts', 'sidebars.js', 'sidebars.mjs'];

  for (const candidate of sidebarCandidates) {
    const fullPath = resolve(dirPath, candidate);
    if (existsSync(fullPath)) {
      const content = readFileSync(fullPath, 'utf8');
      rawSidebars = parseDocusaurusSidebarsContent(content);
      break;
    }
  }

  return { config, rawSidebars };
}

export function parseDocusaurusConfigContent(content: string): DocusaurusConfigInput {
  if (!content || typeof content !== 'string') {
    return {};
  }

  const config: DocusaurusConfigInput = {};

  // Extract title
  const titleMatch = content.match(/title\s*:\s*['"`]([^'"`]+)['"`]/);
  if (titleMatch && titleMatch[1]) {
    config.title = titleMatch[1];
  }

  // Extract tagline
  const taglineMatch = content.match(/tagline\s*:\s*['"`]([^'"`]+)['"`]/);
  if (taglineMatch && taglineMatch[1]) {
    config.tagline = taglineMatch[1];
  }

  // Extract url
  const urlMatch = content.match(/url\s*:\s*['"`](https?:\/\/[^'"`]+)['"`]/);
  if (urlMatch && urlMatch[1]) {
    config.url = urlMatch[1];
  }

  // Extract baseUrl
  const baseUrlMatch = content.match(/baseUrl\s*:\s*['"`]([^'"`]+)['"`]/);
  if (baseUrlMatch && baseUrlMatch[1]) {
    config.baseUrl = baseUrlMatch[1];
  }

  // Extract trailingSlash
  const trailingSlashMatch = content.match(/trailingSlash\s*:\s*(true|false)/);
  if (trailingSlashMatch && trailingSlashMatch[1]) {
    config.trailingSlash = trailingSlashMatch[1] === 'true';
  }

  // Extract onBrokenLinks
  const onBrokenLinksMatch = content.match(/onBrokenLinks\s*:\s*['"`](throw|warn|ignore|log)['"`]/);
  if (onBrokenLinksMatch && onBrokenLinksMatch[1]) {
    config.onBrokenLinks = onBrokenLinksMatch[1] as any;
  }

  // Extract onBrokenAnchors
  const onBrokenAnchorsMatch = content.match(/onBrokenAnchors\s*:\s*['"`](throw|warn|ignore|log)['"`]/);
  if (onBrokenAnchorsMatch && onBrokenAnchorsMatch[1]) {
    config.onBrokenAnchors = onBrokenAnchorsMatch[1] as any;
  }

  // Extract i18n
  const defaultLocaleMatch = content.match(/defaultLocale\s*:\s*['"`]([^'"`]+)['"`]/);
  const localesMatch = content.match(/locales\s*:\s*\[([^\]]+)\]/);
  if (defaultLocaleMatch || localesMatch) {
    config.i18n = {};
    if (defaultLocaleMatch && defaultLocaleMatch[1]) {
      config.i18n.defaultLocale = defaultLocaleMatch[1];
    }
    if (localesMatch && localesMatch[1]) {
      config.i18n.locales = localesMatch[1]
        .split(',')
        .map((s) => s.replace(/['"`\s]/g, ''))
        .filter(Boolean);
    }
  }

  // Extract KaTeX macros if specified in config
  const macrosBlockMatch = content.match(/macros\s*:\s*\{([^}]+)\}/);
  if (macrosBlockMatch && macrosBlockMatch[1]) {
    const macros: Record<string, string> = {};
    const macroRegex = /['"]([^'"]+)['"]\s*:\s*['"]([^'"]+)['"]/g;
    let m;
    while ((m = macroRegex.exec(macrosBlockMatch[1])) !== null) {
      if (m[1] && m[2]) {
        macros[m[1]] = m[2];
      }
    }
    config.katexMacros = macros;
  }

  return config;
}

export function parseDocusaurusSidebarsContent(content: string): Record<string, unknown> {
  // If the content is simple JS/TS object export
  const sidebars: Record<string, unknown> = {};

  // Find sidebar blocks, e.g. tutorialSidebar: [ ... ] or advancedSidebar: [ ... ]
  const sidebarRegex = /([a-zA-Z0-9_-]+)\s*:\s*(\[[^\]]*\]|\[[\s\S]*?\n\s*\])/g;
  let match;
  while ((match = sidebarRegex.exec(content)) !== null) {
    const name = match[1];
    const rawArray = match[2];
    if (name && rawArray) {
      try {
        // Safe evaluation of simple object/array literals
        // Replace single quotes with double quotes and unquoted keys
        const items: any[] = [];
        const stringItems = rawArray.match(/['"`]([^'"`]+)['"`]/g);
        if (stringItems) {
          for (const s of stringItems) {
            const clean = s.slice(1, -1);
            if (!items.includes(clean)) {
              items.push(clean);
            }
          }
        }
        sidebars[name] = items;
      } catch {
        sidebars[name] = [];
      }
    }
  }

  return sidebars;
}
