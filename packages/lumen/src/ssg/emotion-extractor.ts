import type { EmotionCache } from '@emotion/cache';
import createEmotionServer from '@emotion/server/create-instance';

/**
 * Base Lumen critical theme stylesheet providing layout, typography,
 * and dark/light CSS custom properties without placeholder stubs.
 */
export const BASE_LUMEN_THEME_CSS = [
  ':root{--lumen-code-font-size:0.875rem;}',
  ':root,[data-theme="dark"]{--lumen-bg:#0b0f19;--lumen-surface:#111827;--lumen-fg:#e2e8f0;--lumen-muted:#94a3b8;--lumen-border:#1e293b;--lumen-accent:#38bdf8;--lumen-code-bg:#0f172a;--lumen-font-sans:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;--lumen-font-mono:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;--lumen-max-width:80rem;}',
  '[data-theme="light"]{--lumen-bg:#ffffff;--lumen-surface:#f8fafc;--lumen-fg:#0f172a;--lumen-muted:#475569;--lumen-border:#e2e8f0;--lumen-accent:#0284c7;--lumen-code-bg:#f1f5f9;}',
  '.lumen-shell{min-height:100vh;background-color:var(--lumen-bg);color:var(--lumen-fg);font-family:var(--lumen-font-sans);line-height:1.65;margin:0;box-sizing:border-box;}',
  '.lumen-doc{max-width:var(--lumen-max-width);margin:0 auto;padding:2rem 1.5rem;box-sizing:border-box;}',
].join('');

/**
 * Critical Emotion CSS extractor.
 * Extracts real styles from Emotion SSR cache chunks and React 19 inline
 * <style data-emotion="..."> tags, consolidating them into <head> while
 * preserving each inline chunk's metadata and cascade order.
 */
export interface EmotionExtractionResult {
  html: string;
  ids: string[];
  css: string;
  styleTag: string;
}

export function extractCriticalEmotionCss(html: string, cache?: EmotionCache): EmotionExtractionResult {
  const chunks: Array<{ key: string; ids: string[]; css: string; tag: string }> = [];
  const inlineChunks: typeof chunks = [];

  // Emotion lists serialized dependencies, including shared keyframes and IDs
  // whose rules were emitted earlier. IDs therefore cannot partition CSS chunks.
  // Repeated Global instances also retain their original cascade positions.
  const inline = /<style\b[^>]*\bdata-emotion=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/style>/gi;
  const cleaned = html
    .replace(inline, (tag: string, _quote: string, attribute: string, css: string) => {
      const [key, ...ids] = attribute.trim().split(/\s+/);
      if (!key) throw new Error('Emotion style is missing its cache key');
      if (css.trim()) inlineChunks.push({ key, ids, css, tag });
      return '';
    })
    .replace(/<style data-lumen-theme>[\s\S]*?<\/style>/g, '');
  const inlineTags = new Set(inlineChunks.map((chunk) => chunk.tag));

  // Emotion owns the cache classification and the order of Global/style chunks.
  // An extraction failure is an SSR failure, never a reason to guess inserted IDs.
  if (cache) {
    const server = createEmotionServer(cache);
    const critical = server.extractCriticalToChunks(html);
    for (const chunk of critical.styles) {
      const tag = server.constructStyleTagsFromChunks({ html: '', styles: [chunk] });
      // A caller may have already serialized this exact cache chunk into HTML.
      // Keep its inline position rather than adding another extracted copy.
      if (chunk.css.trim() && !inlineTags.has(tag)) chunks.push({ ...chunk, tag });
    }
  }
  chunks.push(...inlineChunks);

  // Lumen's static baseline is not an Emotion insertion and must not occupy its IDs.
  const styleTag =
    `<style data-lumen-theme>${BASE_LUMEN_THEME_CSS}</style>` + chunks.map((chunk) => chunk.tag).join('');
  const finalHtml = /<\/head\s*>/i.test(cleaned)
    ? cleaned.replace(/<\/head\s*>/i, (closing) => styleTag + closing)
    : `${styleTag}\n${cleaned}`;

  return {
    html: finalHtml,
    ids: [...new Set(chunks.flatMap((chunk) => chunk.ids))],
    css: [BASE_LUMEN_THEME_CSS, ...chunks.map((chunk) => chunk.css)].join('\n'),
    styleTag,
  };
}
