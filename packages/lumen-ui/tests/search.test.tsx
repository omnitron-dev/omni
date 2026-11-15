import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { vi, it, expect, describe, beforeEach } from 'vitest';

import {
  NetronAdapter,
  PagefindAdapter,
  LumenSearchDialog,
  LumenSearchDialogContent,
  parseSearchSnippet,
  sanitizeSearchResultUrl,
} from '../src/search/index.js';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

describe('Search Dialog & Adapters', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    return () => {
      if (container.parentNode) {
        container.parentNode.removeChild(container);
      }
    };
  });

  it('renders the shared modal in a portal only when open', async () => {
    expect(renderToStaticMarkup(<LumenSearchDialog open={false} />)).toBe('');
    const root = createRoot(container);
    try {
      await act(async () => root.render(<LumenSearchDialog open onClose={() => {}} />));
      const dialog = document.querySelector('[role="dialog"]');
      expect(dialog?.getAttribute('aria-modal')).toBe('true');
      expect(dialog?.getAttribute('aria-label')).toBe('Search documentation');
      expect(dialog?.querySelector('input[type="search"]')).toBe(document.activeElement);
      expect(dialog?.querySelector('button[aria-label="Close search"]')).not.toBeNull();
      expect(container.contains(dialog)).toBe(false);
    } finally { await act(async () => root.unmount()); }
  });

  it('offers local search without advertising an unconnected semantic service', () => {
    const html = renderToStaticMarkup(<LumenSearchDialogContent />);
    expect(html).not.toContain('Semantic AI');
    expect(html).toContain('Search query');
  });

  it('reports an unavailable Pagefind index instead of pretending the query has no matches', async () => {
    const adapter = new PagefindAdapter('/non-existent/pagefind.js');
    await expect(adapter.search('test')).rejects.toThrow('Local search index is unavailable');
    const search = vi.spyOn(PagefindAdapter.prototype, 'search');
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(React.createElement(LumenSearchDialog, {
          open: true, initialQuery: 'test', pagefindUrl: '/non-existent/pagefind.js',
        }));
      });
      await act(async () => {
        await vi.waitFor(() => expect(search).toHaveBeenCalledWith('test', 10), { timeout: 5000 });
        await expect(search.mock.results[0]?.value).rejects.toThrow('Local search index is unavailable');
      });
      expect(document.querySelector('[role="alert"]')?.textContent).toContain('Local search index is unavailable');
      expect(document.body.textContent).not.toContain('No results found');
    } finally {
      await act(async () => { root.unmount(); });
      search.mockRestore();
    }
  });

  it('passes literal search text to the queried service and displays service failures', async () => {
    const rpcClient = { search: vi.fn().mockRejectedValue(new Error('Search service unavailable')) };
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(React.createElement(LumenSearchDialog, {
          open: true, defaultTab: 'semantic', initialQuery: '@package/entry[0]', rpcClient,
        }));
      });
      await act(async () => {
        await vi.waitFor(() => expect(rpcClient.search).toHaveBeenCalledWith('@package/entry[0]', { limit: 10 }), { timeout: 5000 });
        await expect(rpcClient.search.mock.results[0]?.value).rejects.toThrow('Search service unavailable');
      });
      expect(document.querySelector('[role="alert"]')?.textContent).toBe('Search service unavailable');
      expect(document.body.textContent).not.toContain('No results found');
    } finally {
      await act(async () => { root.unmount(); });
    }
  });

  it('NetronAdapter queries rpcClient and transforms results', async () => {
    const mockRpcClient = {
      search: vi
        .fn()
        .mockResolvedValue([
          { documentId: 'doc-1', title: 'Doc One', path: '/docs/1', snippet: 'Intro snippet', score: 0.95 },
        ]),
    };

    const adapter = new NetronAdapter(mockRpcClient);
    const results = await adapter.search('quantum', 5);

    expect(mockRpcClient.search).toHaveBeenCalledWith('quantum', { limit: 5 });
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe('doc-1');
    expect(results[0]?.title).toBe('Doc One');
    expect(results[0]?.path).toBe('/docs/1');
  });

  it('never substitutes an ambient global index for the configured URL', async () => {
    const ambientSearch = vi.fn().mockResolvedValue({ results: [] });
    const target = window as unknown as Record<string, unknown>;
    target.pagefind = { search: ambientSearch };
    try {
      const adapter = new PagefindAdapter('/non-existent/configured-index.js');
      await expect(adapter.search('private index')).rejects.toThrow('Local search index is unavailable');
      expect(ambientSearch).not.toHaveBeenCalled();
      expect(adapter.isReady).toBe(false);
      expect(adapter.isFailedState).toBe(true);
      expect(new PagefindAdapter('/non-existent/configured-index.js').isFailedState).toBe(false);
    } finally {
      delete target.pagefind;
    }
  });

  it('shares concurrent initialization, retries a failed shard and rejects malformed results', async () => {
    const adapter = new PagefindAdapter(pathToFileURL(resolve(import.meta.dirname, 'fixtures/pagefind-recovery.js')).href);
    expect(await Promise.all([adapter.init(), adapter.init()])).toEqual([false, false]);
    expect(adapter.isFailedState).toBe(true);
    expect(await Promise.all([adapter.init(), adapter.init()])).toEqual([true, true]);
    expect(adapter.isFailedState).toBe(false);
    expect(adapter.isReady).toBe(true);
    expect(await adapter.search('literal [text]', 1)).toEqual([{
      id: '1', url: '/docs/1', title: 'Configured index result 1', excerpt: 'literal [text]', score: undefined,
    }]);
    await expect(adapter.search('invalid')).rejects.toThrow('Local search failed');
  });

  it('validates query and result budgets before loading an index', async () => {
    const adapter = new PagefindAdapter('/non-existent/index.js');
    for (const limit of [-1, 1.5, NaN, Infinity, 101]) {
      await expect(adapter.search('test', limit)).rejects.toThrow('Search result limit');
    }
    await expect(adapter.search('я'.repeat(2049))).rejects.toThrow('4096 UTF-8 bytes');
    expect(await adapter.search('test', 0)).toEqual([]);
    expect(await adapter.search('  ')).toEqual([]);
    expect(adapter.isFailedState).toBe(false);
  });

  it('SEC-03: neutralizes XSS in search snippets and URLs without dangerouslySetInnerHTML', async () => {
    const maliciousSnippet =
      'Safe <mark>highlighted</mark> <script>window.__xss = 1</script><style>body{display:none}</style><img src=x onerror="alert(1)"> &amp; more';
    const nodes = parseSearchSnippet(maliciousSnippet);
    const renderedSnippet = renderToStaticMarkup(React.createElement('div', null, ...nodes));

    expect(renderedSnippet).toContain('<mark>highlighted</mark>');
    expect(renderedSnippet).not.toContain('<script');
    expect(renderedSnippet).not.toContain('window.__xss');
    expect(renderedSnippet).not.toContain('<style');
    expect(renderedSnippet).not.toContain('<img');
    expect(renderedSnippet).toContain('&amp; more');

    expect(sanitizeSearchResultUrl('javascript:alert(1)')).toBe('#');
    expect(sanitizeSearchResultUrl('  JaVaScRiPt:alert(1)  ')).toBe('#');
    expect(sanitizeSearchResultUrl('vbscript:msgbox(1)')).toBe('#');
    expect(sanitizeSearchResultUrl('data:text/html,<script>alert(1)</script>')).toBe('#');
    expect(sanitizeSearchResultUrl('//evil.example/phish')).toBe('#');
    expect(sanitizeSearchResultUrl('java\tscript:alert(1)')).toBe('#');
    expect(sanitizeSearchResultUrl('/docs/getting-started#setup')).toBe('/docs/getting-started#setup');
    expect(sanitizeSearchResultUrl('https://docs.example.com/guide')).toBe('https://docs.example.com/guide');

    const onSelectResult = vi.fn();
    const rpcClient = {
      search: vi.fn().mockResolvedValue([
        {
          documentId: 'xss-1',
          title: 'XSS Candidate',
          path: 'javascript:alert(document.cookie)',
          snippet: '<img src=x onerror=alert(1)>Found <mark>term</mark><script>evil()</script>',
          score: 0.99,
        },
      ]),
    };

    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(
          React.createElement(LumenSearchDialog, {
            open: true,
            defaultTab: 'semantic',
            initialQuery: 'term',
            rpcClient,
            onSelectResult,
          })
        );
      });
      await act(async () => {
        await vi.waitFor(() => expect(rpcClient.search).toHaveBeenCalledWith('term', { limit: 10 }), { timeout: 5000 });
        await rpcClient.search.mock.results[0]?.value;
      });

      const link = document.querySelector('.lumen-search-result-item a') as HTMLAnchorElement | null;
      expect(link).not.toBeNull();
      expect(link?.getAttribute('href')).toBe('#');
      expect(document.querySelector('.lumen-search-result-item img')).toBeNull();
      expect(document.querySelector('.lumen-search-result-item script')).toBeNull();
      expect(document.querySelector('.lumen-search-result-item mark')?.textContent).toBe('term');

      await act(async () => {
        link?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      });

      expect(onSelectResult).toHaveBeenCalledWith({ url: '#', title: 'XSS Candidate' });
    } finally {
      await act(async () => { root.unmount(); });
    }
  });

  it('UI-06: clears loading state immediately when query is emptied and ignores superseded search responses', async () => {
    const staleResults = [{ documentId: 'late', title: 'Stale Result', path: '/docs/stale', snippet: 'late' }];
    let resolveSlowSearch!: (items: typeof staleResults) => void;
    const pendingSearch = new Promise<typeof staleResults>((resolve) => { resolveSlowSearch = resolve; });
    const rpcClient = { search: vi.fn().mockReturnValue(pendingSearch) };

    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(
          React.createElement(LumenSearchDialog, {
            open: true,
            defaultTab: 'semantic',
            initialQuery: 'slow-query',
            rpcClient,
          })
        );
      });
      await act(async () => {
        await vi.waitFor(() => expect(rpcClient.search).toHaveBeenCalledWith('slow-query', { limit: 10 }), { timeout: 5000 });
      });

      expect(document.body.textContent).toContain('Searching...');

      const input = document.querySelector('input[type="search"]') as HTMLInputElement;
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter?.call(input, '');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });

      expect(document.body.textContent).not.toContain('Searching...');

      await act(async () => {
        resolveSlowSearch(staleResults);
        await pendingSearch;
      });

      expect(rpcClient.search).toHaveBeenCalledTimes(1);
      expect(document.body.textContent).not.toContain('Searching...');
      expect(document.body.textContent).not.toContain('Stale Result');
    } finally {
      await act(async () => { root.unmount(); });
    }
  });

  it('closes through the shared modal and restores the invoking control', async () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'Open search';
    document.body.append(trigger);
    trigger.focus();
    const root = createRoot(container);
    const onClose = vi.fn();
    try {
      await act(async () => root.render(<LumenSearchDialog open onClose={onClose} />));
      const dialog = document.querySelector('[role="dialog"]')!;
      await act(async () => { dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
      expect(onClose).toHaveBeenCalledOnce();
      await act(async () => root.render(<LumenSearchDialog open={false} onClose={onClose} />));
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(document.activeElement).toBe(trigger);
    } finally {
      await act(async () => root.unmount());
      trigger.remove();
    }
  });
});
