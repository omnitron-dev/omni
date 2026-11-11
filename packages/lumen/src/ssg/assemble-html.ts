import type { EmotionCache } from '@emotion/cache';
import { extractCriticalEmotionCss } from './emotion-extractor.js';

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface HtmlPageOptions {
  title: string;
  description?: string;
  lang?: string;
  theme?: 'light' | 'dark' | string;
  contentHtml: string;
  baseUrl?: string;
  extraHead?: string[];
  bodyScripts?: string[];
  shellWrapped?: boolean;
  emotionCache?: EmotionCache;
}

export function buildHtmlPage(options: HtmlPageOptions): string {
  const lang = options.lang ?? 'en';
  const theme = options.theme ?? 'dark';
  const escapedTitle = escapeHtml(options.title);
  const escapedDesc = options.description ? escapeHtml(options.description) : '';

  const metaDesc = escapedDesc ? `\n    <meta name="description" content="${escapedDesc}" />` : '';
  const ogDesc = escapedDesc ? `\n    <meta property="og:description" content="${escapedDesc}" />` : '';
  const extraHeadTags =
    options.extraHead && options.extraHead.length > 0 ? `\n    ${options.extraHead.join('\n    ')}` : '';
  const bodyScriptTags =
    options.bodyScripts && options.bodyScripts.length > 0 ? `\n    ${options.bodyScripts.join('\n    ')}` : '';

  const bodyContent = options.shellWrapped
    ? options.contentHtml
    : `<div class="lumen-shell" data-theme="${escapeHtml(theme)}" data-locale="${escapeHtml(lang)}">\n      ${options.contentHtml}\n    </div>`;

  const initialHtml = `<!DOCTYPE html>
<html lang="${escapeHtml(lang)}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapedTitle}</title>${metaDesc}
    <meta property="og:title" content="${escapedTitle}" />${ogDesc}
    <meta property="og:type" content="article" />${extraHeadTags}
  </head>
  <body data-theme="${escapeHtml(theme)}">
    ${bodyContent}${bodyScriptTags}
  </body>
</html>`;

  // Extract and consolidate critical Emotion CSS into <head>
  const { html } = extractCriticalEmotionCss(initialHtml, options.emotionCache);
  return html;
}
