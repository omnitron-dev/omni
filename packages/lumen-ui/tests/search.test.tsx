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
  parseSearchSnippet,
  sanitizeSearchResultUrl,
} from '../src/search/index.js';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

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

  it('returns null when open is false and renders accessible dialog when true', () => {
    expect(LumenSearchDialog({ open: false })).toBeNull();

    const html = renderToStaticMarkup(React.createElement(LumenSearchDialog, { open: true, onClose: () => {} }));
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="Search documentation"');
    expect(html).toContain('class="lumen-search-dialog"');
    expect(html).toContain('<button type="button">Close</button>');
  });

  it('offers local search without advertising an unconnected semantic service', () => {
    const html = renderToStaticMarkup(React.createElement(LumenSearchDialog, { open: true }));
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
      expect(container.querySelector('[role="alert"]')?.textContent).toContain('Local search index is unavailable');
      expect(container.textContent).not.toContain('No results found');
    } finally {
      await act(async () => { root.unmount(); });
      search.mockRestore();
    }
  });

  it('passes literal search text to the queried service and displays service failures', async () => {
    const rpcClient = { search: vi.fn().mockRejectedValue(new Error('Search service unavailable')) };
    const root = createRoot(container);
    await act(async () => {
      root.render(React.createElement(LumenSearchDialog, {
        open: true, defaultTab: 'semantic', initialQuery: '@package/entry[0]', rpcClient,
      }));
    });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 200)); });
    expect(rpcClient.search).toHaveBeenCalledWith('@package/entry[0]', { limit: 10 });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Search service unavailable');
    expect(container.textContent).not.toContain('No results found');
    await act(async () => { root.unmount(); });
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
      await new Promise((resolve) => setTimeout(resolve, 200));
    });

    const link = container.querySelector('.lumen-search-result-item a') as HTMLAnchorElement | null;
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('#');
    expect(container.querySelector('.lumen-search-result-item img')).toBeNull();
    expect(container.querySelector('.lumen-search-result-item script')).toBeNull();
    expect(container.querySelector('.lumen-search-result-item mark')?.textContent).toBe('term');

    await act(async () => {
      link?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    expect(onSelectResult).toHaveBeenCalledWith({ url: '#', title: 'XSS Candidate' });

    await act(async () => {
      root.unmount();
    });
  });

  it('UI-06: clears loading state immediately when query is emptied and ignores superseded search responses', async () => {
    let resolveSlowSearch: ((items: any[]) => void) | null = null;
    const rpcClient = {
      search: vi.fn().mockImplementation(
        () =>
          new Promise<any[]>((resolve) => {
            resolveSlowSearch = resolve;
          })
      ),
    };

    const root = createRoot(container);
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

    expect(container.textContent).toContain('Searching...');

    const input = container.querySelector('input[type="search"]') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, '');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(container.textContent).not.toContain('Searching...');

    await act(async () => {
      resolveSlowSearch?.([{ id: 'late', title: 'Stale Result', url: '/docs/stale', snippet: 'late' }]);
      await new Promise((resolve) => setTimeout(resolve, 260));
    });

    expect(container.textContent).not.toContain('Searching...');
    expect(container.textContent).not.toContain('Stale Result');

    await act(async () => {
      root.unmount();
    });
  });

  it('UI-07: traps Tab and Shift+Tab focus strictly inside dialog and restores prior focus on close', async () => {
    const outsideTrigger = document.createElement('button');
    outsideTrigger.type = 'button';
    outsideTrigger.textContent = 'Open Search';
    document.body.appendChild(outsideTrigger);
    outsideTrigger.focus();
    expect(document.activeElement).toBe(outsideTrigger);

    const root = createRoot(container);
    await act(async () => {
      root.render(React.createElement(LumenSearchDialog, { open: true, onClose: () => {} }));
    });

    const dialog = container.querySelector('.lumen-search-dialog') as HTMLElement;
    expect(dialog.getAttribute('aria-label')).toBe('Search documentation');

    const focusables = Array.from(
      dialog.querySelectorAll<HTMLElement>('input:not([disabled]), button:not([disabled]), a[href]')
    );
    expect(focusables.length).toBeGreaterThanOrEqual(2);

    const firstEl = focusables[0]!;
    const lastEl = focusables[focusables.length - 1]!;

    lastEl.focus();
    expect(document.activeElement).toBe(lastEl);

    const forwardTab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    await act(async () => {
      dialog.dispatchEvent(forwardTab);
    });
    expect(forwardTab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(firstEl);

    const backwardTab = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      dialog.dispatchEvent(backwardTab);
    });
    expect(backwardTab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(lastEl);

    await act(async () => {
      root.render(React.createElement(LumenSearchDialog, { open: false, onClose: () => {} }));
    });

    expect(document.activeElement).toBe(outsideTrigger);

    await act(async () => {
      root.unmount();
    });
    document.body.removeChild(outsideTrigger);
  });
});
