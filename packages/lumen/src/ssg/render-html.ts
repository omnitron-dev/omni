import React from 'react';
import { renderToString } from 'react-dom/server';
import createCache from '@emotion/cache';
import { CacheProvider, ClassNames } from '@emotion/react';
import createEmotionServer from '@emotion/server/create-instance';
import { LumenShell } from '@omnitron-dev/lumen-ui';
import { toHtmlSsr, type LumenDocumentAst } from '@omnitron-dev/lumen-ast';
import { isAccessAllowedForRoles, projectDocumentAst } from '../corpus/projection.js';
import { buildHtmlPage } from './assemble-html.js';

export interface RenderDocumentHtmlOptions {
  theme?: 'light' | 'dark' | string;
  locale?: string;
  baseUrl?: string;
  currentPath?: string;
  extraHead?: string[];
  bodyScripts?: string[];
  roles?: string[];
}

export function renderDocumentHtml(ast: LumenDocumentAst, options?: RenderDocumentHtmlOptions): string {
  const theme = options?.theme ?? 'dark';
  const locale = options?.locale ?? 'en';
  const currentPath = options?.currentPath ?? '/';
  const roles = options?.roles ?? ['anonymous'];

  const docAllowed = isAccessAllowedForRoles(ast.frontmatter?.['access'], roles);
  const effectiveAst: LumenDocumentAst = docAllowed
    ? projectDocumentAst(ast, roles).ast
    : {
        frontmatter: { title: 'Restricted' },
        children: [],
        toc: [],
        diagnostics: [],
        rawContent: undefined,
      };

  const articleHtml = docAllowed
    ? toHtmlSsr(effectiveAst, { theme })
    : '<article class="lumen-doc"><h1>Restricted</h1></article>';

  const cache = createCache({ key: 'css' });
  const emotionServer = createEmotionServer(cache);

  const renderedShellHtml = renderToString(
    React.createElement(
      CacheProvider,
      { value: cache },
      React.createElement(ClassNames, {
        children: ({ css, cx }) =>
          React.createElement(
            LumenShell,
            { theme, locale, currentPath },
            React.createElement('div', {
              className: cx(
                'lumen-doc-container',
                css`
                  display: block;
                  width: 100%;
                  color: inherit;
                `
              ),
              dangerouslySetInnerHTML: { __html: articleHtml },
            })
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
