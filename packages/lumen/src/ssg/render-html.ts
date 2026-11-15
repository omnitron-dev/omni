import React from 'react';
import { prerenderToNodeStream } from 'react-dom/static';
import { text } from 'node:stream/consumers';
import createCache from '@emotion/cache';
import { CacheProvider, ClassNames, Global } from '@emotion/react';
import createEmotionServer from '@emotion/server/create-instance';
import { LumenShell, type IslandRegistry } from '@omnitron-dev/lumen-ui';
import { mixins } from '@omnitron-dev/prism/theme';
import {
  createDocumentAccessPredicate,
  projectDocumentAccess,
  type LumenDocumentAst,
} from '@omnitron-dev/lumen-ast';
import type { CorpusProjectionOptions } from '../corpus/projection.js';
import { buildHtmlPage } from './assemble-html.js';
import { renderDocumentContent } from './render-react.js';

export interface RenderDocumentHtmlOptions extends CorpusProjectionOptions {
  macros?: Record<string, string>;
  theme?: 'light' | 'dark' | string;
  locale?: string;
  baseUrl?: string;
  currentPath?: string;
  extraHead?: string[];
  bodyScripts?: string[];
  renderLayout?: (content: React.ReactNode) => React.ReactNode;
  islands?: IslandRegistry;
  /** Cancels this document without producing a partial static page. */
  signal?: AbortSignal;
  /** Maximum asynchronous render time per document. Defaults to 30 seconds. */
  renderTimeoutMs?: number;
}

async function prerenderDocument(
  content: React.ReactNode,
  options: RenderDocumentHtmlOptions | undefined,
): Promise<string> {
  const timeoutMs = options?.renderTimeoutMs ?? 30_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) {
    throw new RangeError('renderTimeoutMs must be a positive integer no greater than 2147483647');
  }
  options?.signal?.throwIfAborted();
  const controller = new AbortController();
  const signal = options?.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;
  const timer = setTimeout(() => {
    controller.abort(new Error(`Static rendering exceeded ${timeoutMs} ms for ${options?.currentPath ?? '/'}`));
  }, timeoutMs);
  const rejectIncompleteRender = (cause: unknown) => {
    if (!signal.aborted) {
      controller.abort(new Error(`Static rendering failed for ${options?.currentPath ?? '/'}`, { cause }));
    }
  };
  try {
    const { prelude, postponed } = await prerenderToNodeStream(content, {
      signal,
      // Static pages are buffered in full. React's streaming-size heuristic
      // otherwise outlines complete large boundaries behind browser-only scripts.
      progressiveChunkSize: Number.MAX_SAFE_INTEGER,
      onError: rejectIncompleteRender,
      onBrowserBailout: rejectIncompleteRender,
    });
    const html = await text(prelude);
    signal.throwIfAborted();
    if (postponed !== null) throw new Error('Static rendering returned an incomplete document');
    return html;
  } catch (error) {
    signal.throwIfAborted();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function renderDocumentHtml(ast: LumenDocumentAst, options?: RenderDocumentHtmlOptions): Promise<string> {
  options?.signal?.throwIfAborted();
  const theme = options?.theme ?? 'dark';
  const locale = options?.locale ?? 'en';
  const currentPath = options?.currentPath ?? '/';
  const roles = options?.roles ?? ['anonymous'];

  const { allowed: docAllowed, ast: effectiveAst } = projectDocumentAccess(
    ast,
    createDocumentAccessPredicate(roles, options?.accessFilter)
  );

  const cache = createCache({ key: 'css' });
  // Enable Emotion's SSR cache before rendering; extraction happens once in buildHtmlPage.
  createEmotionServer(cache);
  const article = docAllowed
    ? renderDocumentContent(effectiveAst, { macros: options?.macros, islands: options?.islands })
    : React.createElement('article', { className: 'lumen-doc' }, React.createElement('h1', null, 'Restricted'));

  const renderedShellHtml = await prerenderDocument(
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
            { theme, locale, currentPath, islands: options?.islands, disablePrismProvider: Boolean(options?.renderLayout) },
            (options?.renderLayout ?? ((content) => content))(
              React.createElement('div', {
                className: cx(
                  'lumen-doc-container',
                  css`
                    display: block;
                    width: 100%;
                    color: inherit;
                  `
                ),
              }, article)
            )
          ),
      })
    ),
    options,
  );

  return buildHtmlPage({
    title: String(effectiveAst.frontmatter?.title ?? 'Documentation'),
    description: effectiveAst.frontmatter?.description ? String(effectiveAst.frontmatter.description) : undefined,
    lang: locale,
    theme,
    contentHtml: renderedShellHtml,
    baseUrl: options?.baseUrl,
    extraHead: options?.extraHead,
    bodyScripts: options?.bodyScripts,
    shellWrapped: true,
    emotionCache: cache,
  });
}
