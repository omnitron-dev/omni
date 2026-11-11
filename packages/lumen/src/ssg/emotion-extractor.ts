import type { EmotionCache } from '@emotion/cache';
import createEmotionServer from '@emotion/server/create-instance';

/**
 * Base Lumen critical theme stylesheet providing layout, typography,
 * and dark/light CSS custom properties without placeholder stubs.
 */
export const BASE_LUMEN_THEME_CSS = [
  ':root,[data-theme="dark"]{--lumen-bg:#0b0f19;--lumen-surface:#111827;--lumen-fg:#e2e8f0;--lumen-muted:#94a3b8;--lumen-border:#1e293b;--lumen-accent:#38bdf8;--lumen-code-bg:#0f172a;--lumen-font-sans:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;--lumen-font-mono:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;--lumen-max-width:80rem;}',
  '[data-theme="light"]{--lumen-bg:#ffffff;--lumen-surface:#f8fafc;--lumen-fg:#0f172a;--lumen-muted:#475569;--lumen-border:#e2e8f0;--lumen-accent:#0284c7;--lumen-code-bg:#f1f5f9;}',
  '.lumen-shell{min-height:100vh;background-color:var(--lumen-bg);color:var(--lumen-fg);font-family:var(--lumen-font-sans);line-height:1.65;margin:0;box-sizing:border-box;}',
  '.lumen-doc{max-width:var(--lumen-max-width);margin:0 auto;padding:2rem 1.5rem;box-sizing:border-box;}',
].join('');

/**
 * Critical Emotion CSS extractor.
 * Extracts real styles from Emotion SSR cache chunks and React 19 inline
 * <style data-emotion="..."> tags, consolidating them into <head> and stripping
 * duplicate body style tags.
 */
export interface EmotionExtractionResult {
  html: string;
  ids: string[];
  css: string;
  styleTag: string;
}

export function extractCriticalEmotionCss(html: string, cache?: EmotionCache): EmotionExtractionResult {
  const ids: string[] = [];
  const seenIds = new Set<string>();
  const cssBlocks: string[] = [];
  const seenCss = new Set<string>();

  const addId = (id: string) => {
    const trimmed = id.trim();
    if (trimmed && !seenIds.has(trimmed)) {
      seenIds.add(trimmed);
      ids.push(trimmed);
    }
  };

  const addCss = (ruleText: string) => {
    const trimmed = ruleText.trim();
    if (trimmed && !seenCss.has(trimmed)) {
      seenCss.add(trimmed);
      cssBlocks.push(trimmed);
    }
  };

  // 1. Extract critical chunks via @emotion/server when an EmotionCache instance is provided
  if (cache) {
    try {
      const emotionServer = createEmotionServer(cache);
      const criticalChunks = emotionServer.extractCriticalToChunks(html);
      for (const styleChunk of criticalChunks.styles) {
        for (const chunkId of styleChunk.ids) {
          addId(chunkId);
        }
        if (styleChunk.css) {
          addCss(styleChunk.css);
        }
      }
    } catch {
      // Fallback to direct cache.inserted inspection
    }

    if (cache.inserted && typeof cache.inserted === 'object') {
      for (const [key, val] of Object.entries(cache.inserted)) {
        if (typeof val === 'string' && val.trim().length > 0) {
          addId(key);
          addCss(val);
        }
      }
    }
  }

  // 2. Extract inline <style data-emotion="...">REAL_RULES</style> emitted during React 19 / Emotion SSR
  const inlineStyleMatches = html.matchAll(/<style\b[^>]*\bdata-emotion=["']([^"']*)["'][^>]*>([\s\S]*?)<\/style>/gi);
  for (const match of inlineStyleMatches) {
    const attrTokens = (match[1] ?? '').trim().split(/\s+/).filter(Boolean);
    for (let i = 1; i < attrTokens.length; i++) {
      const token = attrTokens[i];
      if (token) {
        addId(token);
      }
    }

    const cssContent = (match[2] ?? '').trim();
    if (cssContent) {
      addCss(cssContent);
    }
  }

  // 3. Collect matched css-<id> class tokens in markup so all referenced Emotion IDs are tracked
  const classMatches = html.matchAll(/\bclass=["']([^"']+)["']/g);
  for (const match of classMatches) {
    const classList = (match[1] ?? '').split(/\s+/);
    for (const cls of classList) {
      if (cls.startsWith('css-')) {
        const id = cls.slice(4);
        if (id) {
          addId(id);
          const cachedRule = cache?.inserted?.[id];
          if (typeof cachedRule === 'string' && cachedRule.trim().length > 0) {
            addCss(cachedRule);
          }
        }
      }
    }
  }

  // 4. Ensure base theme variables and .lumen-shell rules are always included
  const alreadyHasBaseTheme = cssBlocks.some(
    (block) => block.includes('--lumen-bg:') && block.includes('.lumen-shell{')
  );
  if (!alreadyHasBaseTheme) {
    addCss(BASE_LUMEN_THEME_CSS);
  }

  if (ids.length === 0) {
    addId('lumen-theme');
  }

  const criticalCss = cssBlocks.join('\n');
  const styleTag = `<style data-emotion="css ${ids.join(' ')}">${criticalCss}</style>`;

  const cleanedHtml = html.replace(/<style\b[^>]*\bdata-emotion=["'][^"']*["'][^>]*>[\s\S]*?<\/style>/gi, '');
  const finalHtml = cleanedHtml.includes('</head>')
    ? cleanedHtml.replace('</head>', `${styleTag}</head>`)
    : `${styleTag}\n${cleanedHtml}`;

  return {
    html: finalHtml,
    ids,
    css: criticalCss,
    styleTag,
  };
}
