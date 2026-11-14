/**
 * Code Block HTML Emitter with Real Shiki Dual-Theme CSS Variable Token Mapping
 */

import { escapeHtml } from '../katex/render-math.js';
import { parseCodeDirectives } from './directives.js';
import { getShikiHighlighter } from './highlighter.js';
import { tokenizeCode, type HighlightedToken } from './tokenizer.js';
import type { TwoslashAnnotation } from './twoslash.js';
import { parseTwoslashAnnotations } from './twoslash.js';

function renderTokenizedLine(tokens: HighlightedToken[]): string {
  return tokens.map(token => {
    const content = escapeHtml(token.content);
    const style = Object.entries(token.style).map(([key, value]) => `${key}:${value}`).join(';');
    return style ? `<span style="${escapeHtml(style)}">${content}</span>` : `<span>${content}</span>`;
  }).join('');
}

export function renderCodeBlockHtml(code: string, language?: string, meta?: string): string {
  // Compiler directives and Twoslash use line indexes. Normalize their input
  // together so tokenization cannot split a different number of display lines.
  code = code.replace(/\r\n?/g, '\n');
  const lang = (language || 'text').trim().toLowerCase();
  const isTwoslash = Boolean(meta?.includes('twoslash') || /\btwoslash\b/.test(lang));
  const cleanLang = lang.replace(/\s*\btwoslash\b\s*/g, '').trim() || 'text';

  const twoslashData = isTwoslash
    ? parseTwoslashAnnotations(code)
    : {
        code,
        annotations: [] as TwoslashAnnotation[],
        hasNoErrors: false,
        expectedErrors: [] as number[],
        actualErrors: [] as number[],
        errorsValid: true,
      };

  const parsedLines = parseCodeDirectives(twoslashData.code);
  const cleanCodeText = parsedLines.map((l) => l.text).join('\n');
  const hasFocusedLines = parsedLines.some((l) => l.type === 'focus');

  const annotationsByLine = new Map<number, TwoslashAnnotation[]>();
  for (const ann of twoslashData.annotations) {
    const bucket = annotationsByLine.get(ann.lineIndex);
    if (bucket) {
      bucket.push(ann);
    } else {
      annotationsByLine.set(ann.lineIndex, [ann]);
    }
  }

  getShikiHighlighter();
  const highlighted = tokenizeCode(cleanCodeText, cleanLang);

  const linesHtml = parsedLines
    .map((line, idx) => {
      let lineClass = 'line';
      if (line.type === 'diff-add') lineClass += ' diff add diff-add';
      if (line.type === 'diff-del') lineClass += ' diff remove diff-remove';
      if (line.type === 'highlight') lineClass += ' highlighted';
      if (line.type === 'focus') lineClass += ' focused';

      const lineAnnotations = annotationsByLine.get(idx);
      if (lineAnnotations && lineAnnotations.length > 0) {
        lineClass += ' has-twoslash';
      }

      const lineTokens = highlighted.lines[idx]?.tokens;
      const innerTokensHtml = lineTokens ? renderTokenizedLine(lineTokens) : escapeHtml(line.text);

      let popupHtml = '';
      if (lineAnnotations && lineAnnotations.length > 0) {
        popupHtml = lineAnnotations
          .map((ann) => {
            const popupClass =
              ann.type === 'error'
                ? 'twoslash-popup-error lumen-twoslash-error'
                : 'twoslash-popup-info lumen-twoslash-popup';
            const errAttr = ann.code !== undefined ? ` data-error-code="${ann.code}"` : '';
            return `<span class="${popupClass}" role="tooltip" data-col="${ann.column}"${errAttr}>${escapeHtml(ann.text || ann.content)}</span>`;
          })
          .join('');
      }

      return `<span class="${lineClass}" data-line="${idx + 1}">${innerTokensHtml}${popupHtml}</span>`;
    })
    .join('\n');

  const escapedLang = escapeHtml(cleanLang);
  const codeClasses = `shiki language-${escapedLang}${hasFocusedLines ? ' has-focused-lines' : ''}`;

  return `<pre class="lumen-code-block language-${escapedLang}"${cleanCodeText ? ' tabindex="0"' : ''} data-language="${escapedLang}" data-code="${escapeHtml(cleanCodeText)}" style="${escapeHtml(highlighted.rootStyle)}"><code class="${codeClasses}">${linesHtml}</code></pre>`;
}
