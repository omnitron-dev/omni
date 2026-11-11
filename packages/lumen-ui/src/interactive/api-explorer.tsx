import React, { useState, useMemo, useTransition } from 'react';
import clsx from 'clsx';

export interface ApiExplorerMethod {
  name: string;
  signature?: string;
  description?: string;
  visibility?: 'public' | 'protected' | 'private';
  isStatic?: boolean;
  isAsync?: boolean;
}

export interface ApiSymbolItem {
  id?: string;
  name: string;
  kind?: string;
  module?: string;
  description?: string;
  signature?: string;
  [key: string]: unknown;
}

export interface ApiExplorerProps {
  symbol?: string | null;
  module?: string;
  symbols?: ApiSymbolItem[];
  endpoint?: string;
  specUrl?: string;
  filterTags?: string[];
  methods?: ApiExplorerMethod[];
  description?: string;
  searchQuery?: string;
  onSelectSymbol?: (symbol: ApiSymbolItem | string) => void;
  itemHeight?: number;
  maxListHeight?: number;
  className?: string;
}

export function ApiExplorer({
  symbol = null,
  module = '',
  symbols = [],
  endpoint,
  specUrl,
  filterTags = [],
  methods = [],
  description = '',
  searchQuery = '',
  onSelectSymbol,
  itemHeight = 36,
  maxListHeight = 400,
  className,
}: ApiExplorerProps = {}): React.JSX.Element {
  const [filter, setFilter] = useState(searchQuery);
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(symbol);
  const [scrollTop, setScrollTop] = useState(0);
  const [, startTransition] = useTransition();

  const filteredSymbols = useMemo(() => {
    if (!filter.trim()) return symbols;
    const lower = filter.toLowerCase();
    return symbols.filter(
      (s) =>
        s.name.toLowerCase().includes(lower) ||
        s.kind?.toLowerCase().includes(lower) ||
        s.module?.toLowerCase().includes(lower)
    );
  }, [symbols, filter]);

  const totalItems = filteredSymbols.length;
  const totalHeight = totalItems * itemHeight;
  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - 2);
  const visibleCount = Math.ceil(maxListHeight / itemHeight) + 4;
  const endIndex = Math.min(totalItems, startIndex + visibleCount);
  const visibleItems = useMemo(
    () => filteredSymbols.slice(startIndex, endIndex),
    [filteredSymbols, startIndex, endIndex]
  );
  const offsetY = startIndex * itemHeight;

  return (
    <div
      className={clsx('lumen-api-explorer', className)}
      data-module={module || undefined}
      data-symbol={symbol ?? undefined}
      data-endpoint={endpoint}
      data-spec-url={specUrl}
    >
      <header className="lumen-api-explorer-header">
        <div className="lumen-api-explorer-title-row">
          <span className="lumen-api-explorer-badge">API EXPLORER</span>
          {module && <span className="lumen-api-explorer-module">{module}</span>}
          {selectedSymbol && <h3 className="lumen-api-explorer-symbol-title">{selectedSymbol}</h3>}
        </div>
        {description && <p className="lumen-api-explorer-desc">{description}</p>}
      </header>

      {symbols.length > 0 && (
        <div className="lumen-api-explorer-search">
          <input
            type="search"
            className="lumen-api-explorer-filter-input"
            placeholder="Filter symbols..."
            value={filter}
            onChange={(e) => {
              const val = e.target.value;
              startTransition(() => setFilter(val));
            }}
          />
        </div>
      )}

      {symbols.length > 0 && (
        <div
          className="lumen-api-explorer-list-container"
          style={{ maxHeight: maxListHeight, overflowY: 'auto', position: 'relative' }}
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        >
          <div style={{ height: totalHeight, position: 'relative', width: '100%' }}>
            <div style={{ transform: `translateY(${offsetY}px)`, position: 'absolute', width: '100%' }}>
              {visibleItems.map((sym, idx) => (
                <div
                  key={sym.id || sym.name || idx}
                  className={`lumen-api-symbol-item ${selectedSymbol === sym.name ? 'active' : ''}`}
                  style={{ height: itemHeight, display: 'flex', alignItems: 'center' }}
                  onClick={() => {
                    setSelectedSymbol(sym.name);
                    onSelectSymbol?.(sym);
                  }}
                >
                  {sym.kind && <span className={`lumen-kind-badge kind-${sym.kind}`}>{sym.kind}</span>}
                  <span className="lumen-symbol-name">{sym.name}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {methods.length > 0 && (
        <div className="lumen-api-explorer-methods">
          <h4 className="lumen-api-section-title">Methods</h4>
          <ul className="lumen-api-methods-list">
            {methods.map((m, idx) => (
              <li key={idx} className="lumen-api-method-item">
                <code className="lumen-api-method-signature">{m.signature || m.name}</code>
                {m.description && <p className="lumen-api-method-desc">{m.description}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {filterTags.length > 0 && (
        <footer className="lumen-api-explorer-footer">
          <div className="lumen-api-tags">
            {filterTags.map((tag) => (
              <span key={tag} className="lumen-api-tag">
                #{tag}
              </span>
            ))}
          </div>
        </footer>
      )}
    </div>
  );
}
