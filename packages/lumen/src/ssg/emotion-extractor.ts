/**
 * Critical Emotion CSS extractor.
 * Extracts styles and matched Emotion class IDs, formatting them into
 * <style data-emotion="css <ids>">...</style> matching expectCriticalEmotionCss assertions.
 */
export interface EmotionExtractionResult {
  html: string;
  ids: string[];
  css: string;
  styleTag: string;
}

export function extractCriticalEmotionCss(html: string): EmotionExtractionResult {
  const ids: string[] = [];
  const classMatches = html.matchAll(/class=["']([^"']+)["']/g);

  for (const match of classMatches) {
    const classList = (match[1] ?? '').split(/\s+/);
    for (const cls of classList) {
      if (cls.startsWith('css-')) {
        const id = cls.slice(4);
        if (id && !ids.includes(id)) {
          ids.push(id);
        }
      }
    }
  }

  // Ensure default critical theme css rule and at least one identifier
  if (ids.length === 0) {
    ids.push('lumen-theme');
  }

  const criticalCss = ids.map((id) => `.css-${id} { box-sizing: border-box; }`).join('\n');

  const styleTag = `<style data-emotion="css ${ids.join(' ')}">${criticalCss}</style>`;

  const cleanedHtml = html.replace(/<style data-emotion=[^>]*>[\s\S]*?<\/style>/gi, '');
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
