import React, { useState, useMemo, useEffect, useRef, useId, useTransition } from 'react';
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
  /** Informational tags; filtering is driven by the symbol search input. */
  tags?: string[];
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
  tags = [],
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
  const [focusedIndex, setFocusedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  if (!Number.isFinite(itemHeight) || itemHeight <= 0 || !Number.isFinite(maxListHeight) || maxListHeight <= 0) {
    throw new RangeError('API explorer row and viewport heights must be positive finite numbers');
  }
  useEffect(() => setFilter(searchQuery), [searchQuery]);
  useEffect(() => setSelectedSymbol(symbol), [symbol]);
  useEffect(() => {
    setFocusedIndex(0);
    setScrollTop(0);
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [filter, symbols]);
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
  const startIndex = Math.min(Math.max(0, totalItems - 1), Math.max(0, Math.floor(scrollTop / itemHeight) - 2));
  const visibleCount = Math.ceil(maxListHeight / itemHeight) + 4;
  const endIndex = Math.min(totalItems, startIndex + visibleCount);
  const visibleItems = useMemo(
    () => filteredSymbols.slice(startIndex, endIndex),
    [filteredSymbols, startIndex, endIndex]
  );
  const offsetY = startIndex * itemHeight;
  const selectSymbol = (index: number) => {
    const selected = filteredSymbols[index];
    if (!selected) return;
    setFocusedIndex(index);
    setSelectedSymbol(selected.name);
    onSelectSymbol?.(selected);
  };
  const navigateSymbols = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!totalItems) return;
    const origin = focusedIndex >= startIndex && focusedIndex < endIndex ? focusedIndex : startIndex;
    let next: number;
    switch (event.key) {
      case 'ArrowDown': next = Math.min(totalItems - 1, origin + 1); break;
      case 'ArrowUp': next = Math.max(0, origin - 1); break;
      case 'Home': next = 0; break;
      case 'End': next = totalItems - 1; break;
      case 'PageDown': next = Math.min(totalItems - 1, origin + Math.max(1, Math.floor(maxListHeight / itemHeight))); break;
      case 'PageUp': next = Math.max(0, origin - Math.max(1, Math.floor(maxListHeight / itemHeight))); break;
      case 'Enter': case ' ': event.preventDefault(); event.stopPropagation(); selectSymbol(origin); return;
      default: return;
    }
    event.preventDefault();
    event.stopPropagation();
    setFocusedIndex(next);
    const top = next * itemHeight;
    const bottom = top + itemHeight;
    const position = top < scrollTop ? top : bottom > scrollTop + maxListHeight ? bottom - maxListHeight : scrollTop;
    if (listRef.current) listRef.current.scrollTop = position;
    setScrollTop(position);
  };

  return (
    <div
      className={clsx('lumen-api-explorer', className)}
      data-module={module || undefined}
      data-symbol={symbol ?? undefined}
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
            aria-label="Filter API symbols"
            aria-controls={listId}
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
          ref={listRef}
          id={listId}
          role="listbox"
          tabIndex={0}
          aria-label="API symbols"
          aria-activedescendant={focusedIndex >= startIndex && focusedIndex < endIndex ? `${listId}-${focusedIndex}` : undefined}
          onKeyDown={navigateSymbols}
          className="lumen-api-explorer-list-container"
          style={{ maxHeight: maxListHeight, overflowY: 'auto', position: 'relative' }}
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        >
          <div style={{ height: totalHeight, position: 'relative', width: '100%' }}>
            <div style={{ transform: `translateY(${offsetY}px)`, position: 'absolute', width: '100%' }}>
              {visibleItems.map((sym, idx) => (
                <div
                  key={sym.id || sym.name || idx}
                  id={`${listId}-${startIndex + idx}`}
                  role="option"
                  aria-selected={selectedSymbol === sym.name}
                  aria-posinset={startIndex + idx + 1}
                  aria-setsize={totalItems}
                  className={`lumen-api-symbol-item ${selectedSymbol === sym.name ? 'active' : ''}`}
                  data-focused={focusedIndex === startIndex + idx || undefined}
                  style={{ height: itemHeight, display: 'flex', alignItems: 'center' }}
                  onClick={() => {
                    selectSymbol(startIndex + idx);
                    listRef.current?.focus();
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

      {symbols.length > 0 && totalItems === 0 && <p role="status">No matching symbols</p>}

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

      {tags.length > 0 && (
        <footer className="lumen-api-explorer-footer">
          <div className="lumen-api-tags">
            {tags.map((tag) => (
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
