/**
 * Code Block HTML Emitter with CSS Variable Token Mapping
 */

import { escapeHtml } from '../katex/render-math.js';
import { parseCodeDirectives } from './directives.js';
import { parseTwoslashAnnotations } from './twoslash.js';

export function renderCodeBlockHtml(code: string, language?: string, meta?: string): string {
  const lang = (language || 'text').trim().toLowerCase();
  const isTwoslash = (meta?.includes('twoslash') || lang.endsWith('twoslash')) ?? false;
  const cleanLang = lang.replace(/\s*twoslash\b/, '') || 'text';

  const twoslashData = isTwoslash
    ? parseTwoslashAnnotations(code)
    : { code, annotations: [], hasNoErrors: false, expectedErrors: [] };

  const parsedLines = parseCodeDirectives(twoslashData.code);

  const linesHtml = parsedLines
    .map((line, idx) => {
      let lineClass = 'line';
      if (line.type === 'diff-add') lineClass += ' diff add';
      if (line.type === 'diff-del') lineClass += ' diff remove';
      if (line.type === 'highlight') lineClass += ' highlighted';
      if (line.type === 'focus') lineClass += ' focused';

      const escaped = escapeHtml(line.text);
      return `<span class="${lineClass}" data-line="${idx + 1}">${escaped}</span>`;
    })
    .join('\n');

  return `<pre class="lumen-code-block language-${escapeHtml(cleanLang)}" data-language="${escapeHtml(cleanLang)}"><code class="language-${escapeHtml(cleanLang)}">${linesHtml}</code></pre>`;
}
