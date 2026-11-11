/**
 * LumenHighlighter: Isomorphic build-time dual-theme Shiki syntax highlighter
 */

import type { HighlighterCore } from 'shiki';
import { createHighlighterCoreSync, createJavaScriptRegexEngine } from 'shiki';
import githubDark from 'shiki/themes/github-dark.mjs';
import githubLight from 'shiki/themes/github-light.mjs';
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

const LANGUAGE_ALIASES: Record<string, string> = {
  typescript: 'typescript',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  javascript: 'javascript',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  json: 'json',
  jsonc: 'json',
  bash: 'bash',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  rust: 'rust',
  rs: 'rust',
  python: 'python',
  py: 'python',
  css: 'css',
  html: 'html',
  yaml: 'yaml',
  yml: 'yaml',
  markdown: 'markdown',
  md: 'markdown',
};

let singletonShiki: HighlighterCore | null = null;
let loadedLangSet: Set<string> | null = null;

export function getShikiHighlighter(): HighlighterCore {
  if (!singletonShiki) {
    singletonShiki = createHighlighterCoreSync({
      themes: [githubLight, githubDark],
      langs: [
        langTypescript,
        langTsx,
        langJavascript,
        langJsx,
        langJson,
        langBash,
        langRust,
        langPython,
        langCss,
        langHtml,
        langYaml,
        langMarkdown,
      ],
      engine: createJavaScriptRegexEngine(),
    });
    loadedLangSet = new Set(singletonShiki.getLoadedLanguages());
  }
  return singletonShiki;
}

export function resolveShikiLanguage(rawLang: string): string | null {
  const key = rawLang.trim().toLowerCase();
  const mapped = LANGUAGE_ALIASES[key] ?? key;
  const highlighter = getShikiHighlighter();
  const available = loadedLangSet ?? new Set(highlighter.getLoadedLanguages());
  return available.has(mapped) ? mapped : null;
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
