/**
 * VirtualList — windowed list for variable-height rows.
 *
 * Wraps `@tanstack/react-virtual` with the most common ergonomic
 * defaults: a scrolling viewport, dynamic height measurement (rows
 * may expand and the list rebalances), and an optional infinite-load
 * hook that fires when the user scrolls within `loadMoreThreshold`
 * px of the bottom.
 *
 * Use cases that drove the API: audit log dialogs (rows can expand
 * to reveal payloads), chat/message histories, paginated transaction
 * tables. Items are keyed by the caller-supplied `getKey` so row
 * identity survives reorder.
 *
 * @example
 * ```tsx
 * <VirtualList
 *   items={trades}
 *   getKey={(t) => t.id}
 *   estimateSize={48}
 *   maxHeight={500}
 *   onEndReached={() => fetchNextPage()}
 * >
 *   {(trade) => <TradeRow trade={trade} />}
 * </VirtualList>
 * ```
 */
import { useEffect, useRef, type ReactNode } from 'react';
import Box, { type BoxProps } from '@mui/material/Box';
import { useVirtualizer } from '@tanstack/react-virtual';

export interface VirtualListProps<T> {
  /** Source items, in render order. */
  items: readonly T[];
  /** Stable key for each row — needed for reorders and dynamic measurement. */
  getKey: (item: T, index: number) => string | number;
  /** Render a single row. */
  children: (item: T, index: number) => ReactNode;
  /**
   * Initial size estimate per row in px. The virtualizer will replace
   * this with the measured size once each row mounts.
   */
  estimateSize?: number;
  /**
   * Number of items to render outside the visible window on each
   * side. Higher values reduce blank flashes on fast scroll at the
   * cost of more DOM. Default 5.
   */
  overscan?: number;
  /**
   * Cap on the scroll viewport height. The Box auto-fills its parent
   * if not supplied — set this when the parent isn't height-bounded
   * (e.g. inside a Dialog without `fullHeight`).
   */
  maxHeight?: number | string;
  /** Fires when the user scrolls within `loadMoreThreshold` of the bottom. */
  onEndReached?: () => void;
  /** Distance from the bottom (px) at which `onEndReached` fires. Default 200. */
  loadMoreThreshold?: number;
  /** Forwarded to the outer scrolling Box for layout overrides. */
  sx?: BoxProps['sx'];
  /** Inner padding (px) — applied as content offset, not scroll padding. */
  paddingY?: number;
}

export function VirtualList<T>({
  items,
  getKey,
  children,
  estimateSize = 48,
  overscan = 5,
  maxHeight,
  onEndReached,
  loadMoreThreshold = 200,
  sx,
  paddingY = 0,
}: VirtualListProps<T>): ReactNode {
  const parentRef = useRef<HTMLDivElement | null>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize,
    overscan,
    getItemKey: (index) => {
      const item = items[index];
      return item === undefined ? index : getKey(item, index);
    },
  });

  // Fire onEndReached when the last virtual item is within the
  // threshold of the visible area. We sample every render — cheap,
  // since virtualizer.getVirtualItems is already memoized.
  const virtualItems = virtualizer.getVirtualItems();
  const lastItem = virtualItems[virtualItems.length - 1];
  useEffect(() => {
    if (!onEndReached || !lastItem) return;
    if (lastItem.index >= items.length - 1) {
      // Already at the actual end — nothing more to load yet.
      return;
    }
    const scrollEl = parentRef.current;
    if (!scrollEl) return;
    const distanceToBottom =
      virtualizer.getTotalSize() - (scrollEl.scrollTop + scrollEl.clientHeight);
    if (distanceToBottom <= loadMoreThreshold) {
      onEndReached();
    }
  }, [lastItem, virtualizer, items.length, loadMoreThreshold, onEndReached]);

  return (
    <Box
      ref={parentRef}
      sx={{
        overflow: 'auto',
        contain: 'strict',
        maxHeight,
        height: maxHeight === undefined ? '100%' : undefined,
        ...sx,
      }}
    >
      <Box
        sx={{
          height: virtualizer.getTotalSize() + paddingY * 2,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualItems.map((virtualRow) => {
          const item = items[virtualRow.index];
          if (item === undefined) return null;
          return (
            <Box
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              sx={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start + paddingY}px)`,
              }}
            >
              {children(item, virtualRow.index)}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
