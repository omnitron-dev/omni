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
import type { WritableSignal } from '../core/reactivity/types.js';
import { signal } from '../core/reactivity/index.js';
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
  const columnHeights: WritableSignal<number[]> = signal(Array(columns).fill(0));

  const layout = () => {
    if (!containerElement) return;

    const children = Array.from(containerElement.children) as HTMLElement[];
    const heights = Array(columns).fill(0);

    children.forEach((child, index) => {
      const col = index % columns;
      const leftPercent = (col * (100 / columns));
      const top = heights[col];

      child.style.position = 'absolute';
      child.style.left = leftPercent + '%';
      child.style.top = top + 'px';
      child.style.width = 'calc(' + (100 / columns) + '% - ' + gap + 'px)';

      heights[col] += child.offsetHeight + gap;
    });

    columnHeights.set(heights);
    const maxHeight = Math.max(...heights);
    if (containerElement) containerElement.style.height = maxHeight + 'px';
  };

  // Ref callback - layout after element is mounted
  const refCallback = (element: HTMLDivElement | null) => {
    containerElement = element;
    if (element) {
      // Layout after children are inserted
      setTimeout(layout, 0);
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('resize', layout);
    onCleanup(() => window.removeEventListener('resize', layout));
  }

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
