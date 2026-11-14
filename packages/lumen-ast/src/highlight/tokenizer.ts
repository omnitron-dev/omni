import type { HighlighterCore, ThemedToken } from 'shiki';
import { createHighlighterCoreSync } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import githubDark from 'shiki/themes/github-dark.mjs';
import githubLight from 'shiki/themes/github-light.mjs';

/** Only the requested grammar (and its declared dependencies) enters a browser. */
const languages = {
  typescript: () => import('shiki/langs/typescript.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  bash: () => import('shiki/langs/bash.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
};
const aliases: Record<string, keyof typeof languages> = {
  ts: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsonc: 'json',
  sh: 'bash', shell: 'bash', zsh: 'bash', rs: 'rust', py: 'python', yml: 'yaml', md: 'markdown',
};
const DEFAULT_ROOT_STYLE = '--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e';
const MAX_FULL_TOKENIZE_LINES = 2500;
const PARTIAL_TOKENIZE_HEAD = 400;
let highlighter: HighlighterCore | undefined;
const loading = new Map<string, Promise<void>>();

export interface HighlightedToken {
  content: string;
  /** Dual-theme CSS variables; content always remains literal source text. */
  style: Record<string, string>;
}
export interface HighlightedLine {
  tokens: HighlightedToken[];
  /** Preserve LF, CRLF and CR, including a trailing newline. */
  ending: string;
}
export interface HighlightedSource {
  lines: HighlightedLine[];
  rootStyle: string;
  highlighted: boolean;
}

export function resolveHighlightLanguage(raw: string): string {
  const name = raw.trim().toLowerCase();
  return Object.hasOwn(aliases, name) ? aliases[name]! : name;
}

/** Shared engine for the synchronous compiler and the lazy browser entry point. */
export function getCodeTokenizer(): HighlighterCore {
  highlighter ??= createHighlighterCoreSync({
    themes: [githubLight, githubDark], langs: [], engine: createJavaScriptRegexEngine(),
  });
  return highlighter;
}

function tokenStyle(token: ThemedToken): Record<string, string> {
  const source = token.htmlStyle;
  const light = source?.['--shiki-light'] ?? source?.['color'] ?? token.color;
  const dark = source?.['--shiki-dark'] ?? light;
  const style: Record<string, string> = {};
  if (light) style['--shiki-light'] = light;
  if (dark) style['--shiki-dark'] = dark;
  for (const property of ['font-style', 'font-weight', 'text-decoration']) {
    const lightValue = source?.[`--shiki-light-${property}`] ?? source?.[property];
    const darkValue = source?.[`--shiki-dark-${property}`] ?? lightValue;
    if (lightValue) style[`--shiki-light-${property}`] = lightValue;
    if (darkValue) style[`--shiki-dark-${property}`] = darkValue;
  }
  return style;
}

/** Tokenize registered grammars without interpreting documentation directives. */
export function tokenizeCode(code: string, language: string): HighlightedSource {
  const lines = code.split(/\r\n|\r|\n/);
  const endings = code.match(/\r\n|\r|\n/g) ?? [];
  const engine = getCodeTokenizer();
  const lang = resolveHighlightLanguage(language);
  let tokens: ThemedToken[][] | undefined;
  let rootStyle = DEFAULT_ROOT_STYLE;
  if (code && engine.getLoadedLanguages().includes(lang)) {
    const count = lines.length <= MAX_FULL_TOKENIZE_LINES ? lines.length : PARTIAL_TOKENIZE_HEAD;
    const result = engine.codeToTokens(lines.slice(0, count).join('\n'), {
      lang, themes: { light: 'github-light', dark: 'github-dark' }, defaultColor: false,
    });
    tokens = result.tokens;
    rootStyle = result.rootStyle || rootStyle;
  }
  return {
    rootStyle,
    highlighted: Boolean(tokens),
    lines: lines.map((line, index) => ({
      tokens: tokens?.[index]?.map(token => ({ content: token.content, style: tokenStyle(token) }))
        ?? [{ content: line, style: {} }],
      ending: endings[index] ?? '',
    })),
  };
}

/** Browser-safe highlighting: no AST compiler, Twoslash or eager grammar bundle. */
export async function highlightCode(code: string, language = 'text'): Promise<HighlightedSource> {
  const lang = resolveHighlightLanguage(language);
  if (code && Object.hasOwn(languages, lang)) {
    let pending = loading.get(lang);
    if (!pending) {
      pending = languages[lang as keyof typeof languages]().then(({ default: grammar }) => {
        getCodeTokenizer().loadLanguageSync(grammar);
      }).catch(error => {
        loading.delete(lang);
        throw error;
      });
      loading.set(lang, pending);
    }
    await pending;
  }
  return tokenizeCode(code, lang);
}
