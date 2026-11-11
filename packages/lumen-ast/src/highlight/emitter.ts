/**
 * Code Block HTML Emitter with Real Shiki Dual-Theme CSS Variable Token Mapping
 */

import type { ThemedToken } from 'shiki';

import { escapeHtml } from '../katex/render-math.js';
import { parseCodeDirectives } from './directives.js';
import { getShikiHighlighter, resolveShikiLanguage } from './highlighter.js';
import type { TwoslashAnnotation } from './twoslash.js';
import { parseTwoslashAnnotations } from './twoslash.js';

const DEFAULT_ROOT_STYLE = '--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e';
const MAX_FULL_TOKENIZE_LINES = 2500;
const PARTIAL_TOKENIZE_HEAD = 400;

function formatTokenStyle(token: ThemedToken): string {
  const htmlStyle = token.htmlStyle;
  if (!htmlStyle) {
    return token.color ? `--shiki-light:${token.color};--shiki-dark:${token.color}` : '';
  }

  const parts: string[] = [];
  const light = htmlStyle['--shiki-light'] ?? htmlStyle['color'];
  const dark = htmlStyle['--shiki-dark'] ?? light;
  if (light) {
    parts.push(`--shiki-light:${light}`);
  }
  if (dark) {
    parts.push(`--shiki-dark:${dark}`);
  }
  const fontStyle = htmlStyle['--shiki-light-font-style'] ?? htmlStyle['font-style'];
  if (fontStyle) {
    parts.push(`--shiki-light-font-style:${fontStyle}`);
  }
  const darkFontStyle = htmlStyle['--shiki-dark-font-style'];
  if (darkFontStyle) {
    parts.push(`--shiki-dark-font-style:${darkFontStyle}`);
  }
  return parts.join(';');
}

function renderTokenizedLine(tokens: ThemedToken[]): string {
  if (tokens.length === 0) {
    return '';
  }
  return tokens
    .map((tok) => {
      const escapedContent = escapeHtml(tok.content);
      const style = formatTokenStyle(tok);
      return style ? `<span style="${escapeHtml(style)}">${escapedContent}</span>` : `<span>${escapedContent}</span>`;
    })
    .join('');
}

export function renderCodeBlockHtml(code: string, language?: string, meta?: string): string {
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

  let tokenLines: ThemedToken[][] | null = null;
  let rootStyle = DEFAULT_ROOT_STYLE;
  const resolvedLang = resolveShikiLanguage(cleanLang);

  if (resolvedLang && cleanCodeText.length > 0) {
    try {
      const highlighter = getShikiHighlighter();
      const targetCode =
        parsedLines.length <= MAX_FULL_TOKENIZE_LINES
          ? cleanCodeText
          : parsedLines
              .slice(0, PARTIAL_TOKENIZE_HEAD)
              .map((l) => l.text)
              .join('\n');

      const tokenized = highlighter.codeToTokens(targetCode, {
        lang: resolvedLang,
        themes: { light: 'github-light', dark: 'github-dark' },
        defaultColor: false,
      });

      tokenLines = tokenized.tokens;
      if (tokenized.rootStyle) {
        rootStyle = tokenized.rootStyle;
      }
    } catch {
      tokenLines = null;
    }
  }

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

      const lineTokens = tokenLines?.[idx];
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

  return `<pre class="lumen-code-block language-${escapedLang}" data-language="${escapedLang}" data-code="${escapeHtml(cleanCodeText)}" style="${escapeHtml(rootStyle)}"><code class="${codeClasses}">${linesHtml}</code></pre>`;
}
