/**
 * Safe KaTeX Math Renderer with error isolation and macro support
 */

import katex from 'katex';
import { LumenMacroRegistry } from './macro-registry.js';

export interface KatexRenderOptions {
  displayMode?: boolean;
  macros?: Record<string, string> | LumenMacroRegistry;
  throwOnError?: boolean;
  errorColor?: string;
  output?: 'html' | 'mathml' | 'htmlAndMathml';
  strict?: boolean | string;
  trust?: boolean;
  maxSize?: number;
  maxExpand?: number;
}

export function escapeHtml(str: string): string {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function renderKaTeX(tex: string, options: KatexRenderOptions = {}): { html: string; error?: string } {
  if (typeof tex !== 'string') {
    const errorMsg = 'LaTeX expression must be a string';
    return {
      html: `<code class="lumen-invalid-math" title="${escapeHtml(errorMsg)}"></code>`,
      error: errorMsg,
    };
  }
  let macroDict: Record<string, string> = {};
  if (options.macros instanceof LumenMacroRegistry) {
    macroDict = options.macros.getMacros();
  } else if (options.macros && typeof options.macros === 'object') {
    macroDict = options.macros;
  }

  try {
    const html = katex.renderToString(tex, {
      displayMode: options.displayMode ?? false,
      macros: macroDict,
      throwOnError: options.throwOnError ?? false,
      errorColor: options.errorColor ?? '#cc0000',
      output: options.output ?? 'htmlAndMathml',
      strict: (options.strict as any) ?? false,
      trust: options.trust ?? false,
      maxExpand: options.maxExpand ?? 1000,
      maxSize: options.maxSize ?? 20,
    });

    if (html.includes('class="katex-error"')) {
      const escapedTex = escapeHtml(tex);
      const titleMatch = html.match(/title="([^"]+)"/);
      const errorMsg = titleMatch ? titleMatch[1] : 'KaTeX parse error';
      return {
        html: `<code class="lumen-invalid-math" title="${escapeHtml(errorMsg ?? 'KaTeX error')}">${escapedTex}</code>`,
        error: errorMsg ?? 'KaTeX parse error',
      };
    }

    return { html };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const escapedTex = escapeHtml(tex);
    const fallbackHtml = `<code class="lumen-invalid-math" title="${escapeHtml(message)}">${escapedTex}</code>`;
    return { html: fallbackHtml, error: message };
  }
}
