import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { PagefindAdapter } from './pagefind-adapter.js';
import { NetronAdapter } from './netron-adapter.js';

export interface LumenSearchDialogProps {
  /** Controlled open state */
  open?: boolean;
  /** Callback invoked to close the dialog */
  onClose?: () => void;
  /** Initial query text */
  initialQuery?: string;
  /** Active search tab ('local' | 'semantic') */
  defaultTab?: 'local' | 'semantic';
  /** Path to Pagefind WASM bundle (default: '/pagefind/pagefind.js') */
  pagefindUrl?: string;
  /** Endpoint for Netron semantic search RPC */
  rpcEndpoint?: string;
  /** Direct RPC client interface */
  rpcClient?: { search: (query: string, options?: any) => Promise<any[]> };
  /** Maximum number of search results to return */
  maxResults?: number;
  /** Callback when result is selected */
  onSelectResult?: (result: { url: string; title: string }) => void;
  className?: string;
}

function sanitizeSnippetHtml(html: string): string {
  if (!html) return '';
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/\bon\w+\s*=\s*(?:'[^']*'|"[^"]*"|[^\s>]+)/gi, '');
}

export function LumenSearchDialogContent({
  onClose,
  initialQuery = '',
  defaultTab = 'local',
  pagefindUrl = '/pagefind/pagefind.js',
  rpcEndpoint = '/api/rpc/search',
  rpcClient,
  maxResults = 10,
  onSelectResult,
}: Omit<LumenSearchDialogProps, 'open' | 'className'>): React.JSX.Element {
  const [query, setQuery] = useState(initialQuery);
  const [activeTab, setActiveTab] = useState<'local' | 'semantic'>(defaultTab);
  const [results, setResults] = useState<Array<{ id: string; title: string; url: string; snippet: string }>>([]);
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const pagefindAdapter = useMemo(() => new PagefindAdapter(pagefindUrl), [pagefindUrl]);
  const netronAdapter = useMemo(() => new NetronAdapter(rpcClient, rpcEndpoint), [rpcClient, rpcEndpoint]);

  const sanitizeQuery = useCallback((str: string): string => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    const raw = query.trim();
    if (!raw) {
      setResults([]);
      return undefined;
    }

    const truncated = sanitizeQuery(raw.slice(0, 256));
    let cancelled = false;

    async function executeSearch() {
      setIsLoading(true);
      try {
        if (activeTab === 'local') {
          const res = await pagefindAdapter.search(truncated, maxResults);
          if (!cancelled) {
            setResults(res.map((r) => ({ id: r.id, title: r.title, url: r.url, snippet: r.excerpt })));
          }
        } else {
          const res = await netronAdapter.search(truncated, maxResults);
          if (!cancelled) {
            setResults(res.map((r) => ({ id: r.id, title: r.title, url: r.path, snippet: r.snippet })));
          }
        }
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    const timer = setTimeout(executeSearch, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, activeTab, maxResults, pagefindAdapter, netronAdapter, sanitizeQuery]);

  return (
    <div className="lumen-search-dialog">
      <header className="lumen-search-header">
        <div className="lumen-search-input-wrapper">
          <input
            ref={inputRef}
            type="search"
            className="lumen-search-input"
            placeholder="Search documentation..."
            value={query}
            maxLength={256}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {onClose && (
          <button type="button" onClick={onClose}>
            Close
          </button>
        )}
      </header>

      <div className="lumen-search-tabs">
        <button
          type="button"
          className={`lumen-search-tab ${activeTab === 'local' ? 'active' : ''}`}
          onClick={() => setActiveTab('local')}
        >
          Local Docs
        </button>
        <button
          type="button"
          className={`lumen-search-tab ${activeTab === 'semantic' ? 'active' : ''}`}
          onClick={() => setActiveTab('semantic')}
        >
          Semantic AI
        </button>
      </div>

      <div className="lumen-search-results">
        {isLoading && <div className="lumen-search-loading">Searching...</div>}
        {!isLoading && query.trim() && results.length === 0 && (
          <div className="lumen-search-empty">No results found for &quot;{query.slice(0, 32)}&quot;</div>
        )}
        {!isLoading && results.length > 0 && (
          <ul className="lumen-search-results-list">
            {results.map((r) => (
              <li
                key={r.id}
                className="lumen-search-result-item"
                onClick={() => {
                  onSelectResult?.({ url: r.url, title: r.title });
                  onClose?.();
                }}
              >
                <a href={r.url} className="lumen-search-result-link">
                  <span className="lumen-search-result-title">{r.title}</span>
                  {r.snippet && (
                    <span
                      className="lumen-search-result-snippet"
                      dangerouslySetInnerHTML={{ __html: sanitizeSnippetHtml(r.snippet) }}
                    />
                  )}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function LumenSearchDialog({
  open = false,
  onClose,
  initialQuery = '',
  defaultTab = 'local',
  pagefindUrl = '/pagefind/pagefind.js',
  rpcEndpoint = '/api/rpc/search',
  rpcClient,
  maxResults = 10,
  onSelectResult,
  className,
}: LumenSearchDialogProps): React.JSX.Element | null {
  if (!open) return null;

  return React.createElement(
    'div',
    {
      className: className ? `lumen-search-dialog-backdrop ${className}` : 'lumen-search-dialog-backdrop',
      role: 'dialog',
      'aria-modal': true,
      onClick: (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) onClose?.();
      },
    },
    React.createElement(LumenSearchDialogContent, {
      onClose,
      initialQuery,
      defaultTab,
      pagefindUrl,
      rpcEndpoint,
      rpcClient,
      maxResults,
      onSelectResult,
    })
  );
}
