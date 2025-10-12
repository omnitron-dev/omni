/**
 * Masonry - Pinterest-style masonry grid layout
 *
 * Features:
 * - Dynamic column layout
 * - Responsive columns
 * - Variable item heights
 * - Gap control
 * - Automatic reflow on resize
 */

import { defineComponent, onCleanup } from '../core/component/index.js';
import { jsx } from '../jsx-runtime.js';

export interface MasonryProps {
  columns?: number;
  gap?: number;
  children?: any;
  [key: string]: any;
}

export const Masonry = defineComponent<MasonryProps>((props) => {
  const columns = props.columns ?? 3;
  const gap = props.gap ?? 16;

  let containerElement: HTMLDivElement | null = null;
  let resizeListener: (() => void) | null = null;
  let layoutTimeout: number | null = null;

  const layout = () => {
    if (!containerElement) return;

    const children = Array.from(containerElement.children) as HTMLElement[];
    const heights = Array(columns).fill(0);

    children.forEach((child, index) => {
      const col = index % columns;
      const leftPercent = col * (100 / columns);
      const top = heights[col];

      child.style.position = 'absolute';
      child.style.left = leftPercent + '%';
      child.style.top = top + 'px';
      child.style.width = 'calc(' + 100 / columns + '% - ' + gap + 'px)';

      heights[col] += child.offsetHeight + gap;
    });

    const maxHeight = Math.max(...heights);
    if (containerElement) containerElement.style.height = maxHeight + 'px';
  };

  // Ref callback - layout after element is mounted
  const refCallback = (element: HTMLDivElement | null) => {
    // Cleanup previous resources
    if (layoutTimeout !== null) {
      clearTimeout(layoutTimeout);
      layoutTimeout = null;
    }

    if (resizeListener && typeof window !== 'undefined') {
      window.removeEventListener('resize', resizeListener);
      resizeListener = null;
    }

    containerElement = element;

    if (element) {
      // Layout after children are inserted
      layoutTimeout = setTimeout(layout, 0) as any;

      // Add resize listener for this instance
      if (typeof window !== 'undefined') {
        resizeListener = layout;
        window.addEventListener('resize', resizeListener);
      }
    }
  };

  // Register cleanup when component is destroyed
  onCleanup(() => {
    if (layoutTimeout !== null) {
      clearTimeout(layoutTimeout);
      layoutTimeout = null;
    }

    if (resizeListener && typeof window !== 'undefined') {
      window.removeEventListener('resize', resizeListener);
      resizeListener = null;
    }
  });

  return () => {
    const { columns, gap, children, style, ...restProps } = props;

    return jsx('div', {
      ...restProps,
      ref: refCallback,
      'data-masonry': '',
      style: { position: 'relative', ...style },
      children,
    });
  };
});
