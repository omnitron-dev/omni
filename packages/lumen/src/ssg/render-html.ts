import { toHtmlSsr, type LumenDocumentAst } from '@omnitron-dev/lumen-ast';
import { buildHtmlPage } from './assemble-html.js';

export interface RenderDocumentHtmlOptions {
  theme?: 'light' | 'dark' | string;
  locale?: string;
  baseUrl?: string;
}

export function renderDocumentHtml(ast: LumenDocumentAst, options?: RenderDocumentHtmlOptions): string {
  const contentHtml = toHtmlSsr(ast, {
    theme: options?.theme,
  });

  return buildHtmlPage({
    title: String(ast.frontmatter?.title ?? 'Documentation'),
    description: ast.frontmatter?.description ? String(ast.frontmatter.description) : undefined,
    lang: options?.locale ?? 'en',
    theme: options?.theme ?? 'dark',
    contentHtml,
    baseUrl: options?.baseUrl,
  });
}
