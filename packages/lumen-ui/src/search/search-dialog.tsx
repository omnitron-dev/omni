import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { PagefindAdapter } from './pagefind-adapter.js';
import { NetronAdapter, type NetronSearchClient } from './netron-adapter.js';

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
  /** Queried LumenService client; enables the semantic search tab when present. */
  rpcClient?: NetronSearchClient;
  /** Maximum number of search results to return */
  maxResults?: number;
  /** Callback when result is selected */
  onSelectResult?: (result: { url: string; title: string }) => void;
  className?: string;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&#x27;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

function decodeSafeEntities(text: string): string {
  if (!text || !text.includes('&')) return text;
  return text.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39|#x27);/gi, (match) => {
    const lower = match.toLowerCase();
    return ENTITY_MAP[lower] ?? match;
  });
}

/**
 * Strictly validates search result URLs, allowing only http:, https:, mailto:,
 * or safe relative URLs (/, ./, ../, #, ?). Replaces javascript:, vbscript:, data:,
 * protocol-relative //, and unknown schemes with '#'.
 */
export function sanitizeSearchResultUrl(rawUrl: string): string {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return '#';
  }

  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return '#';
  }

  // Reject any URL containing control characters (e.g. java\tscript:, null bytes, newlines)
  for (let i = 0; i < trimmed.length; i++) {
    const code = trimmed.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) {
      return '#';
    }
  }

  // Reject protocol-relative URLs (//evil.example)
  if (trimmed.startsWith('//')) {
    return '#';
  }

  // Allow safe relative URL forms
  if (
    trimmed.startsWith('/') ||
    trimmed.startsWith('./') ||
    trimmed.startsWith('../') ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('?')
  ) {
    return trimmed;
  }

  // Normalize whitespace to detect obfuscated schemes
  const collapsed = trimmed.replace(/\s+/g, '');
  const colonIdx = collapsed.indexOf(':');
  if (colonIdx !== -1) {
    const scheme = collapsed.slice(0, colonIdx + 1).toLowerCase();
    if (scheme === 'http:' || scheme === 'https:' || scheme === 'mailto:') {
      return trimmed;
    }
    return '#';
  }

  return '#';
}

/**
 * Parses a search result snippet into safe React child nodes without raw HTML injection.
 * - Strips <script>...</script> and <style>...</style> blocks completely.
 * - Converts <mark>...</mark> segments into React <mark> elements.
 * - Strips all other tags down to plain escaped text nodes.
 */
export function parseSearchSnippet(snippet: string): React.ReactNode[] {
  if (!snippet || typeof snippet !== 'string') {
    return [];
  }

  const nodes: React.ReactNode[] = [];
  let plainBuffer = '';
  let markBuffer = '';
  let inMark = false;
  let ignoredTag: 'script' | 'style' | null = null;
  let markKey = 0;
  let index = 0;

  const flushPlain = () => {
    if (plainBuffer.length > 0) {
      nodes.push(decodeSafeEntities(plainBuffer));
      plainBuffer = '';
    }
  };

  const flushMark = () => {
    if (markBuffer.length > 0) {
      nodes.push(React.createElement('mark', { key: `mark-${markKey}` }, decodeSafeEntities(markBuffer)));
      markKey += 1;
      markBuffer = '';
    }
  };

  while (index < snippet.length) {
    const lt = snippet.indexOf('<', index);
    if (lt === -1) {
      if (ignoredTag === null) {
        const tail = snippet.slice(index);
        if (inMark) {
          markBuffer += tail;
        } else {
          plainBuffer += tail;
        }
      }
      break;
    }

    if (lt > index && ignoredTag === null) {
      const chunk = snippet.slice(index, lt);
      if (inMark) {
        markBuffer += chunk;
      } else {
        plainBuffer += chunk;
      }
    }

    const gt = snippet.indexOf('>', lt + 1);
    if (gt === -1) {
      // Unclosed tag at end of snippet: drop trailing fragment safely
      break;
    }

    const rawTag = snippet.slice(lt + 1, gt).trim();
    index = gt + 1;

    if (!rawTag || rawTag.startsWith('!')) {
      continue;
    }

    const isClosing = rawTag.startsWith('/');
    const tagBody = isClosing ? rawTag.slice(1).trim() : rawTag;
    const isSelfClosing = !isClosing && rawTag.endsWith('/');

    let nameEnd = 0;
    while (nameEnd < tagBody.length) {
      const ch = tagBody.charCodeAt(nameEnd);
      const isAlphaNum = (ch >= 48 && ch <= 57) || (ch >= 65 && ch <= 90) || (ch >= 97 && ch <= 122) || ch === 45;
      if (!isAlphaNum) break;
      nameEnd += 1;
    }
    const tagName = tagBody.slice(0, nameEnd).toLowerCase();

    if (ignoredTag !== null) {
      if (isClosing && tagName === ignoredTag) {
        ignoredTag = null;
      }
      continue;
    }

    if (!isClosing && (tagName === 'script' || tagName === 'style')) {
      if (!isSelfClosing) {
        ignoredTag = tagName;
      }
      continue;
    }

    if (tagName === 'mark') {
      if (!isClosing && !isSelfClosing) {
        if (!inMark) {
          flushPlain();
          inMark = true;
        }
      } else if (isClosing && inMark) {
        flushMark();
        inMark = false;
      }
    }
  }

  if (inMark) {
    flushMark();
  }
  flushPlain();

  return nodes;
}

export function LumenSearchDialogContent({
  onClose,
  initialQuery = '',
  defaultTab = 'local',
  pagefindUrl = '/pagefind/pagefind.js',
  rpcClient,
  maxResults = 10,
  onSelectResult,
}: Omit<LumenSearchDialogProps, 'open' | 'className'>): React.JSX.Element {
  const [query, setQuery] = useState(initialQuery);
  const [activeTab, setActiveTab] = useState<'local' | 'semantic'>(rpcClient ? defaultTab : 'local');
  const [results, setResults] = useState<Array<{ id: string; title: string; url: string; snippet: string }>>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(
    typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null
  );
  const requestIdRef = useRef(0);

  const pagefindAdapter = useMemo(() => new PagefindAdapter(pagefindUrl), [pagefindUrl]);
  const netronAdapter = useMemo(() => rpcClient ? new NetronAdapter(rpcClient) : null, [rpcClient]);

  useEffect(() => { if (!rpcClient) setActiveTab('local'); }, [rpcClient]);

  // Focus search input on open and restore previously focused element on close/unmount
  useEffect(() => {
    if (typeof document === 'undefined') {
      return undefined;
    }

    if (!previousFocusRef.current) {
      const active = document.activeElement;
      if (active instanceof HTMLElement && active !== inputRef.current) {
        previousFocusRef.current = active;
      }
    }

    inputRef.current?.focus();

    return () => {
      const prev = previousFocusRef.current;
      if (prev && typeof prev.focus === 'function' && prev.isConnected) {
        prev.focus();
      }
    };
  }, []);

  const trapTabFocus = useCallback((e: { key: string; shiftKey: boolean; preventDefault: () => void }) => {
    if (typeof document === 'undefined') return;
    const container = dialogRef.current;
    if (!container) return;

    const focusable = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    if (focusable.length === 0) {
      e.preventDefault();
      return;
    }

    const activeEl = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const currentIndex = activeEl ? focusable.indexOf(activeEl) : -1;

    e.preventDefault();
    if (e.shiftKey) {
      const prevIndex = currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1;
      focusable[prevIndex]?.focus();
    } else {
      const nextIndex = currentIndex === -1 || currentIndex >= focusable.length - 1 ? 0 : currentIndex + 1;
      focusable[nextIndex]?.focus();
    }
  }, []);

  const handleDialogKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose?.();
      } else if (e.key === 'Tab') {
        trapTabFocus(e);
      }
    },
    [onClose, trapTabFocus]
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const handleWindowKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose?.();
      } else if (e.key === 'Tab') {
        trapTabFocus(e);
      }
    };

    window.addEventListener('keydown', handleWindowKeyDown);
    return () => window.removeEventListener('keydown', handleWindowKeyDown);
  }, [onClose, trapTabFocus]);

  useEffect(() => {
    const raw = query.trim();
    setSearchError(null);
    if (!raw) {
      requestIdRef.current += 1;
      setResults([]);
      setIsLoading(false);
      return undefined;
    }

    const currentRequestId = requestIdRef.current + 1;
    requestIdRef.current = currentRequestId;
    const truncated = raw.slice(0, 256);
    let cancelled = false;
    setIsLoading(true);

    async function executeSearch() {
      if (cancelled || currentRequestId !== requestIdRef.current) return;
      try {
        if (activeTab === 'local') {
          const res = await pagefindAdapter.search(truncated, maxResults);
          if (!cancelled && currentRequestId === requestIdRef.current) {
            setResults(res.map((r) => ({ id: r.id, title: r.title, url: r.url, snippet: r.excerpt })));
          }
        } else {
          if (!netronAdapter) throw new Error('Semantic search is not connected.');
          const res = await netronAdapter.search(truncated, maxResults);
          if (!cancelled && currentRequestId === requestIdRef.current) {
            setResults(res.map((r) => ({ id: r.id, title: r.title, url: r.path, snippet: r.snippet })));
          }
        }
      } catch (error) {
        if (!cancelled && currentRequestId === requestIdRef.current) {
          setResults([]);
          setSearchError(error instanceof Error ? error.message : 'Search is unavailable.');
        }
      } finally {
        if (!cancelled && currentRequestId === requestIdRef.current) {
          setIsLoading(false);
        }
      }
    }

    const timer = setTimeout(executeSearch, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, activeTab, maxResults, pagefindAdapter, netronAdapter]);

  return (
    <div
      ref={dialogRef}
      className="lumen-search-dialog"
      aria-label="Search documentation"
      onKeyDown={handleDialogKeyDown}
    >
      <header className="lumen-search-header">
        <div className="lumen-search-input-wrapper">
          <input
            ref={inputRef}
            type="search"
            className="lumen-search-input"
            placeholder="Search documentation..."
            aria-label="Search query"
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

      {rpcClient && <div className="lumen-search-tabs">
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
      </div>}

      <div className="lumen-search-results">
        {isLoading && <div className="lumen-search-loading">Searching...</div>}
        {!isLoading && searchError && <p className="lumen-search-error" role="alert">{searchError}</p>}
        {!isLoading && !searchError && query.trim() && results.length === 0 && (
          <div className="lumen-search-empty">No results found for &quot;{query.slice(0, 32)}&quot;</div>
        )}
        {!isLoading && results.length > 0 && (
          <ul className="lumen-search-results-list">
            {results.map((r) => {
              const safeUrl = sanitizeSearchResultUrl(r.url);
              const snippetNodes = r.snippet ? parseSearchSnippet(r.snippet) : [];
              return (
                <li
                  key={r.id}
                  className="lumen-search-result-item"
                  onClick={() => {
                    onSelectResult?.({ url: safeUrl, title: r.title });
                    onClose?.();
                  }}
                >
                  <a href={safeUrl} className="lumen-search-result-link">
                    <span className="lumen-search-result-title">{r.title}</span>
                    {snippetNodes.length > 0 && <span className="lumen-search-result-snippet">{snippetNodes}</span>}
                  </a>
                </li>
              );
            })}
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
      'aria-label': 'Search documentation',
      onClick: (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) onClose?.();
      },
    },
    React.createElement(LumenSearchDialogContent, {
      onClose,
      initialQuery,
      defaultTab,
      pagefindUrl,
      rpcClient,
      maxResults,
      onSelectResult,
    })
  );
}
