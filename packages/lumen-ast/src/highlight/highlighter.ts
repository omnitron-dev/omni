/**
 * LumenHighlighter: Isomorphic build-time dual-theme Shiki syntax highlighter
 */

import type { HighlighterCore } from 'shiki';
import { getCodeTokenizer, resolveHighlightLanguage } from './tokenizer.js';
import langBash from 'shiki/langs/bash.mjs';
import langCss from 'shiki/langs/css.mjs';
import langHtml from 'shiki/langs/html.mjs';
import langJavascript from 'shiki/langs/javascript.mjs';
import langJson from 'shiki/langs/json.mjs';
import langJsx from 'shiki/langs/jsx.mjs';
import langMarkdown from 'shiki/langs/markdown.mjs';
import langPython from 'shiki/langs/python.mjs';
import langRust from 'shiki/langs/rust.mjs';
import langTsx from 'shiki/langs/tsx.mjs';
import langTypescript from 'shiki/langs/typescript.mjs';
import langYaml from 'shiki/langs/yaml.mjs';

import { parseCodeDirectives } from './directives.js';
import { renderCodeBlockHtml } from './emitter.js';
import { parseTwoslashAnnotations } from './twoslash.js';

export interface HighlightOptions {
  language?: string;
  meta?: string;
  lineNumbers?: boolean;
}

let registered = false;

/** The compiler preloads its grammar set; browser consumers load one language on demand. */
export function getShikiHighlighter(): HighlighterCore {
  const engine = getCodeTokenizer();
  if (!registered) {
    engine.loadLanguageSync(langTypescript, langTsx, langJavascript, langJsx, langJson, langBash,
      langRust, langPython, langCss, langHtml, langYaml, langMarkdown);
    registered = true;
  }
  return engine;
}

export function resolveShikiLanguage(rawLang: string): string | null {
  const name = resolveHighlightLanguage(rawLang);
  return getShikiHighlighter().getLoadedLanguages().includes(name) ? name : null;
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
