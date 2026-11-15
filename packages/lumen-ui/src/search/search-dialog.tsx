import React, { useState, useEffect, useMemo, useRef, useId } from 'react';
import { Alert, Box, Dialog, DialogContent, IconButton, List, ListItem, ListItemButton, ListItemText, Stack, Tab, Tabs, TextField, Typography } from '@omnitron-dev/prism/ui';
import { CloseIcon } from '@omnitron-dev/prism/icons';
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

  const tabsId = useId();
  const requestIdRef = useRef(0);

  const pagefindAdapter = useMemo(() => new PagefindAdapter(pagefindUrl), [pagefindUrl]);
  const netronAdapter = useMemo(() => rpcClient ? new NetronAdapter(rpcClient) : null, [rpcClient]);

  useEffect(() => { if (!rpcClient) setActiveTab('local'); }, [rpcClient]);

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
    <Box className="lumen-search-content">
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <TextField type="search" fullWidth autoFocus label="Search query" placeholder="Search documentation..."
          value={query} slotProps={{ htmlInput: { maxLength: 256 } }}
          onChange={event => setQuery(event.target.value)} />
        {onClose && <IconButton type="button" aria-label="Close search" onClick={onClose}><CloseIcon /></IconButton>}
      </Stack>
      {rpcClient && <Tabs value={activeTab} onChange={(_, tab: 'local' | 'semantic') => setActiveTab(tab)}
        aria-label="Search source" sx={{ mt: 2 }}>
        <Tab value="local" label="Local Docs" id={`${tabsId}-local`} aria-controls={`${tabsId}-results`} />
        <Tab value="semantic" label="Semantic AI" id={`${tabsId}-semantic`} aria-controls={`${tabsId}-results`} />
      </Tabs>}
      <Box id={`${tabsId}-results`} role={rpcClient ? 'tabpanel' : undefined}
        aria-labelledby={rpcClient ? `${tabsId}-${activeTab}` : undefined} sx={{ mt: 2 }}>
        {isLoading && <Typography role="status">Searching...</Typography>}
        {!isLoading && searchError && <Alert severity="error">{searchError}</Alert>}
        {!isLoading && !searchError && query.trim() && results.length === 0 && (
          <Typography role="status">No results found for &quot;{query.slice(0, 32)}&quot;</Typography>
        )}
        {!isLoading && results.length > 0 && <List disablePadding aria-label="Search results">
          {results.map(result => {
            const safeUrl = sanitizeSearchResultUrl(result.url);
            const snippetNodes = result.snippet ? parseSearchSnippet(result.snippet) : [];
            return <ListItem key={result.id} disablePadding className="lumen-search-result-item">
              <ListItemButton component="a" href={safeUrl} className="lumen-search-result-link"
                onClick={() => {
                  onSelectResult?.({ url: safeUrl, title: result.title });
                  onClose?.();
                }}>
                <ListItemText primary={result.title} secondary={snippetNodes.length ? snippetNodes : undefined} />
              </ListItemButton>
            </ListItem>;
          })}
        </List>}
      </Box>
    </Box>
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

  return <Dialog open onClose={onClose} maxWidth="sm" fullWidth className={className}
    slotProps={{ paper: { 'aria-label': 'Search documentation' } }}>
    <DialogContent sx={{ pt: 3 }}>
      <LumenSearchDialogContent onClose={onClose} initialQuery={initialQuery} defaultTab={defaultTab}
        pagefindUrl={pagefindUrl} rpcClient={rpcClient} maxResults={maxResults} onSelectResult={onSelectResult} />
    </DialogContent>
  </Dialog>;
}
