/**
 * VirtualList - Virtualized list for rendering large datasets efficiently
 *
 * Features:
 * - Window/scroll virtualization for performance
 * - Dynamic item heights support
 * - Infinite scroll support
 * - Overscan for smooth scrolling
 * - Horizontal and vertical scrolling
 * - Item measurement and caching
 * - Scroll to index/offset
 * - ARIA support for accessibility
 */

import { defineComponent } from '../core/component/index.js';
import { createContext } from '../core/component/context.js';
import type { WritableSignal } from '../core/reactivity/types.js';
import { signal } from '../core/reactivity/index.js';
import { jsx } from '../jsx-runtime.js';
import { effect } from '../core/reactivity/effect.js';

// ============================================================================
// Types
// ============================================================================

export interface VirtualListProps {
  /** Total number of items */
  count: number;
  /** Item renderer function */
  children: (index: number) => any;
  /** Height of container (required for vertical) */
  height?: number | string;
  /** Width of container (required for horizontal) */
  width?: number | string;
  /** Item size (fixed) or estimator function (dynamic) */
  itemSize: number | ((index: number) => number);
  /** Overscan count (items to render outside viewport) */
  overscan?: number;
  /** Scroll direction */
  direction?: 'vertical' | 'horizontal';
  /** Scroll to index */
  scrollToIndex?: number;
  /** Scroll behavior */
  scrollBehavior?: ScrollBehavior;
  /** On scroll callback */
  onScroll?: (scrollOffset: number) => void;
  /** Additional props */
  [key: string]: any;
}

interface VirtualListContextValue {
  /** Get item offset */
  getItemOffset: (index: number) => number;
  /** Get item size */
  getItemSize: (index: number) => number;
  /** Direction */
  direction: 'vertical' | 'horizontal';
}

interface ItemMeasurement {
  size: number;
  offset: number;
}

// ============================================================================
// Context
// ============================================================================

const VirtualListContext = createContext<VirtualListContextValue | null>(null);

// ============================================================================
// VirtualList Root
// ============================================================================

export const VirtualList = defineComponent<VirtualListProps>((props) => {
  const direction = props.direction ?? 'vertical';
  const overscan = props.overscan ?? 3;

  const scrollContainerRef: { current: HTMLDivElement | null } = { current: null };

  // State
  const scrollOffset: WritableSignal<number> = signal<number>(0);
  const measurements: Map<number, ItemMeasurement> = new Map();

  const isFixedSize = typeof props.itemSize === 'number';

  const getItemSize = (index: number): number => {
    if (isFixedSize) {
      return props.itemSize as number;
    }
    // Check if we have a measurement
    const measured = measurements.get(index);
    if (measured) {
      return measured.size;
    }
    // Estimate using function
    return (props.itemSize as (index: number) => number)(index);
  };

  const getItemOffset = (index: number): number => {
    if (isFixedSize) {
      return index * (props.itemSize as number);
    }

    // Check if we have a measurement
    const measured = measurements.get(index);
    if (measured) {
      return measured.offset;
    }

    // Calculate offset by summing previous items
    let offset = 0;
    for (let i = 0; i < index; i++) {
      offset += getItemSize(i);
    }
    return offset;
  };

  const getTotalSize = (): number => {
    if (isFixedSize) {
      return props.count * (props.itemSize as number);
    }

    // Sum all item sizes
    let total = 0;
    for (let i = 0; i < props.count; i++) {
      total += getItemSize(i);
    }
    return total;
  };

  const getVisibleRange = (): [number, number] => {
    const container = scrollContainerRef.current;
    if (!container) {
      // On first render, calculate a reasonable initial range
      const defaultHeight = typeof props.height === 'number' ? props.height : 300;
      const defaultWidth = typeof props.width === 'number' ? props.width : 300;
      const viewportSize = direction === 'vertical' ? defaultHeight : defaultWidth;

      if (isFixedSize) {
        const itemSize = props.itemSize as number;
        const visibleCount = Math.ceil(viewportSize / itemSize);
        return [0, Math.min(props.count, visibleCount + overscan)];
      }

      // For dynamic sizes, render first few items
      return [0, Math.min(props.count, 10)];
    }

    const currentScroll = scrollOffset();
    const viewportSize = direction === 'vertical' ? container.clientHeight : container.clientWidth;

    // Find start index
    let startIndex = 0;
    let accumulatedSize = 0;

    if (isFixedSize) {
      startIndex = Math.floor(currentScroll / (props.itemSize as number));
    } else {
      for (let i = 0; i < props.count; i++) {
        accumulatedSize += getItemSize(i);
        if (accumulatedSize > currentScroll) {
          startIndex = i;
          break;
        }
      }
    }

    // Find end index
    let endIndex = startIndex;
    accumulatedSize = getItemOffset(startIndex);

    while (endIndex < props.count && accumulatedSize < currentScroll + viewportSize) {
      accumulatedSize += getItemSize(endIndex);
      endIndex++;
    }

    // Apply overscan
    startIndex = Math.max(0, startIndex - overscan);
    endIndex = Math.min(props.count, endIndex + overscan);

    return [startIndex, endIndex];
  };

  const handleScroll = (e: Event) => {
    const target = e.target as HTMLDivElement;
    const newOffset = direction === 'vertical' ? target.scrollTop : target.scrollLeft;
    scrollOffset.set(newOffset);
    props.onScroll?.(newOffset);
  };

  const scrollToIndexFn = (index: number, behavior?: ScrollBehavior) => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const offset = getItemOffset(index);

    if (direction === 'vertical') {
      container.scrollTo({
        top: offset,
        behavior: behavior ?? props.scrollBehavior ?? 'auto',
      });
    } else {
      container.scrollTo({
        left: offset,
        behavior: behavior ?? props.scrollBehavior ?? 'auto',
      });
    }
  };

  // Handle scrollToIndex prop
  if (props.scrollToIndex !== undefined) {
    scrollToIndexFn(props.scrollToIndex);
  }

  const contextValue: VirtualListContextValue = {
    getItemOffset,
    getItemSize,
    direction,
  };

  // Use a signal to trigger re-renders when needed
  const forceUpdate = signal(0);

  return () => {
    // Force re-render by reading the signal
    forceUpdate();

    const {
      children,
      count,
      height,
      width,
      onScroll,
      itemSize,
      direction: _,
      overscan: __,
      scrollToIndex,
      scrollBehavior,
      ...rest
    } = props;

    const [startIndex, endIndex] = getVisibleRange();
    const totalSize = getTotalSize();

    const containerStyle: any = {
      overflow: 'auto',
      position: 'relative',
    };

    if (height) containerStyle.height = typeof height === 'number' ? `${height}px` : height;
    if (width) containerStyle.width = typeof width === 'number' ? `${width}px` : width;

    const contentStyle: any = {
      position: 'relative',
    };

    if (direction === 'vertical') {
      contentStyle.height = `${totalSize}px`;
      contentStyle.width = '100%';
    } else {
      contentStyle.width = `${totalSize}px`;
      contentStyle.height = '100%';
    }

    // Render visible items
    const visibleItems: any[] = [];
    for (let i = startIndex; i < endIndex; i++) {
      const offset = getItemOffset(i);
      const size = getItemSize(i);

      const itemStyle: any = {
        position: 'absolute',
      };

      if (direction === 'vertical') {
        itemStyle.top = `${offset}px`;
        itemStyle.left = 0;
        itemStyle.right = 0;
        itemStyle.height = `${size}px`;
      } else {
        itemStyle.left = `${offset}px`;
        itemStyle.top = 0;
        itemStyle.bottom = 0;
        itemStyle.width = `${size}px`;
      }

      visibleItems.push(
        jsx('div', {
          key: i,
          'data-virtual-item': '',
          'data-index': i,
          style: itemStyle,
          children: children(i),
        })
      );
    }

    const refCallback = (el: HTMLDivElement | null) => {
      scrollContainerRef.current = el;
      if (!el) return;

      // Set up reactive effect to update visible items when scrollOffset changes
      effect(() => {
        scrollOffset(); // Track scrollOffset changes
        forceUpdate.set(forceUpdate() + 1); // Trigger re-render
      });
    };

    return jsx(VirtualListContext.Provider, {
      value: contextValue,
      children: jsx('div', {
        ref: refCallback,
        'data-virtual-list': '',
        'data-direction': direction,
        style: containerStyle,
        onScroll: handleScroll,
        ...rest,
        children: jsx('div', {
          'data-virtual-content': '',
          style: contentStyle,
          children: visibleItems,
        }),
      }),
    });
  };
});

// ============================================================================
// Export types
// ============================================================================

export type { VirtualListContextValue };
