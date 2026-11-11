/**
 * LumenHighlighter: Isomorphic build-time code highlighter
 */

import { renderCodeBlockHtml } from './emitter.js';
import { parseCodeDirectives } from './directives.js';
import { parseTwoslashAnnotations } from './twoslash.js';

export interface HighlightOptions {
  language?: string;
  meta?: string;
  lineNumbers?: boolean;
}

export class LumenHighlighter {
  highlight(code: string, options: HighlightOptions = {}): string {
    return renderCodeBlockHtml(code, options.language, options.meta);
  }

  parseDirectives(code: string) {
    return parseCodeDirectives(code);
  }

  parseTwoslash(code: string) {
    return parseTwoslashAnnotations(code);
  }
}

export const defaultHighlighter = new LumenHighlighter();
