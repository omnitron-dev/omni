import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LumenSearchDialog, PagefindAdapter, NetronAdapter } from '../src/search/index.js';

describe('Search Dialog & Adapters', () => {
  it('returns null when open is false and renders dialog when true', () => {
    expect(LumenSearchDialog({ open: false })).toBeNull();

    const openEl = LumenSearchDialog({ open: true, onClose: () => {} });
    expect(openEl).not.toBeNull();
    expect(openEl?.props.role).toBe('dialog');

    const html = renderToStaticMarkup(openEl);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('class="lumen-search-dialog"');
    expect(html).toContain('<button type="button">Close</button>');
  });

  it('sanitizes regex patterns and handles query safely', () => {
    const rawPattern = 'special[chars]+(.*)';
    const sanitized = rawPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    expect(sanitized).toBe('special\\[chars\\]\\+\\(\\.\\*\\)');

    const html = renderToStaticMarkup(React.createElement(LumenSearchDialog, { open: true, initialQuery: rawPattern }));
    expect(html).toContain('class="lumen-search-dialog"');
  });

  it('PagefindAdapter gracefully returns empty results when WASM binary is not loaded', async () => {
    const adapter = new PagefindAdapter('/non-existent/pagefind.js');
    const results = await adapter.search('test');
    expect(Array.isArray(results)).toBe(true);
    expect(results).toHaveLength(0);
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

  it('PagefindAdapter records permanent failed state on import failure without repeated imports', async () => {
    const nonExistentPath = `/non-existent/pagefind-${Date.now()}.js`;
    const adapter1 = new PagefindAdapter(nonExistentPath);

    expect(adapter1.isFailedState).toBe(false);
    expect(adapter1.isReady).toBe(false);

    const initResult1 = await adapter1.init();
    expect(initResult1).toBe(false);
    expect(adapter1.isFailedState).toBe(true);
    expect(adapter1.isReady).toBe(false);

    // Second call on same instance returns immediately from failed state without new import
    const initResult2 = await adapter1.init();
    expect(initResult2).toBe(false);

    // New instance with same failed path immediately inherits permanent failure state
    const adapter2 = new PagefindAdapter(nonExistentPath);
    expect(adapter2.isFailedState).toBe(true);
    const initResult3 = await adapter2.init();
    expect(initResult3).toBe(false);

    // Clearing failure cache resets permanent failure state
    PagefindAdapter.resetFailureCache();
    expect(adapter2.isFailedState).toBe(false);
  });
});
