import React from 'react';
import { renderToString } from 'react-dom/server';
import createCache from '@emotion/cache';
import { CacheProvider, ClassNames, Global } from '@emotion/react';
import createEmotionServer from '@emotion/server/create-instance';
import { LumenShell } from '@omnitron-dev/lumen-ui';
import { ComponentExample } from '@omnitron-dev/lumen-ui/blocks';
import { mixins } from '@omnitron-dev/prism/theme';
import { PrismThemeProvider, useTheme } from '@omnitron-dev/prism/ui';
import {
  toHtmlSsr,
  createDocumentAccessPredicate,
  projectDocumentAccess,
  type LumenDocumentAst,
} from '@omnitron-dev/lumen-ast';
import type { CorpusProjectionOptions } from '../corpus/projection.js';
import { buildHtmlPage } from './assemble-html.js';

export interface RenderDocumentHtmlOptions extends CorpusProjectionOptions {
  macros?: Record<string, string>;
  theme?: 'light' | 'dark' | string;
  locale?: string;
  baseUrl?: string;
  currentPath?: string;
  extraHead?: string[];
  bodyScripts?: string[];
  renderLayout?: (content: React.ReactNode) => React.ReactNode;
}

export function renderDocumentHtml(ast: LumenDocumentAst, options?: RenderDocumentHtmlOptions): string {
  const theme = options?.theme ?? 'dark';
  const locale = options?.locale ?? 'en';
  const currentPath = options?.currentPath ?? '/';
  const roles = options?.roles ?? ['anonymous'];

  const { allowed: docAllowed, ast: effectiveAst } = projectDocumentAccess(
    ast,
    createDocumentAccessPredicate(roles, options?.accessFilter)
  );

  const cache = createCache({ key: 'css' });
  const emotionServer = createEmotionServer(cache);
  function Article({ className }: { className: string }): React.ReactNode {
    const prismTheme = useTheme();
    const articleHtml = docAllowed
      ? toHtmlSsr(effectiveAst, {
          macros: options?.macros,
          renderExample: ({ id, ...source }, islandHtml, ordinal) => renderToString(
            React.createElement(CacheProvider, { value: cache },
              React.createElement(PrismThemeProvider, { theme: prismTheme },
                React.createElement('section', { 'data-example': id, 'aria-label': `${id} example` },
                  React.createElement(ComponentExample, {
                    ...source,
                    children: React.createElement('div', { dangerouslySetInnerHTML: { __html: islandHtml } }),
                  })
                )
              )
            ),
            { identifierPrefix: `example-${ordinal}-` }
          ),
        })
      : '<article class="lumen-doc"><h1>Restricted</h1></article>';
    return React.createElement('div', { className, dangerouslySetInnerHTML: { __html: articleHtml } });
  }

  const renderedShellHtml = renderToString(
    React.createElement(
      CacheProvider,
      { value: cache },
      React.createElement(Global, { styles: {
        ':is(.lumen-code-block,.lumen-doc pre,.lumen-doc table,.lumen-file-tree,.lumen-diagram-content,.lumen-api-explorer-list-container)':
          mixins.scrollbarStyles(undefined, {
            thumbColor: 'color-mix(in srgb,var(--lumen-muted) 55%,transparent)',
            hoverThumbColor: 'var(--lumen-muted)',
          }),
      } }),
      React.createElement(ClassNames, {
        children: ({ css, cx }) =>
          React.createElement(
            LumenShell,
            { theme, locale, currentPath, disablePrismProvider: Boolean(options?.renderLayout) },
            (options?.renderLayout ?? ((content) => content))(
              React.createElement(Article, {
                className: cx(
                  'lumen-doc-container',
                  css`
                    display: block;
                    width: 100%;
                    color: inherit;
                  `
                ),
              })
            )
          ),
      })
    )
  );

  const criticalChunks = emotionServer.extractCriticalToChunks(renderedShellHtml);
  const chunkStyleTags = emotionServer.constructStyleTagsFromChunks(criticalChunks);

  return buildHtmlPage({
    title: String(effectiveAst.frontmatter?.title ?? 'Documentation'),
    description: effectiveAst.frontmatter?.description ? String(effectiveAst.frontmatter.description) : undefined,
    lang: locale,
    theme,
    contentHtml: `${chunkStyleTags}${renderedShellHtml}`,
    baseUrl: options?.baseUrl,
    extraHead: options?.extraHead,
    bodyScripts: options?.bodyScripts,
    shellWrapped: true,
    emotionCache: cache,
  });
}
