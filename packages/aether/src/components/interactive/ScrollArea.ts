/**
 * Styled ScrollArea Component
 *
 * Custom styled scrollbars for overflow content.
 * Built on top of the ScrollArea primitive with styled() function.
 */

import { styled } from '../../styling/styled.js';
import {
  ScrollArea as ScrollAreaPrimitive,
  ScrollAreaViewport as ScrollAreaViewportPrimitive,
  ScrollAreaScrollbar as ScrollAreaScrollbarPrimitive,
  ScrollAreaThumb as ScrollAreaThumbPrimitive,
  type ScrollAreaProps as ScrollAreaPrimitiveProps,
} from '../../primitives/ScrollArea.js';

/**
 * ScrollArea - Root component
 */
export const ScrollArea = styled(ScrollAreaPrimitive, {
  base: {
    position: 'relative',
    overflow: 'hidden',
    width: '100%',
    height: '100%',
  },
});

/**
 * ScrollAreaViewport - Scrollable viewport
 */
export const ScrollAreaViewport = styled(ScrollAreaViewportPrimitive, {
  base: {
    width: '100%',
    height: '100%',
    overflow: 'auto',
    scrollbarWidth: 'none',
    msOverflowStyle: 'none',
    '&::-webkit-scrollbar': {
      display: 'none',
    },
  },
});

/**
 * ScrollAreaScrollbar - Custom scrollbar
 */
export const ScrollAreaScrollbar = styled<{
  size?: 'sm' | 'md' | 'lg';
  orientation?: 'vertical' | 'horizontal';
}>(ScrollAreaScrollbarPrimitive, {
  base: {
    display: 'flex',
    userSelect: 'none',
    touchAction: 'none',
    padding: '2px',
    backgroundColor: 'transparent',
    transition: 'background-color 0.15s ease',
    '&:hover': {
      backgroundColor: 'rgba(0, 0, 0, 0.05)',
    },
    '&[data-state="visible"]': {
      opacity: '1',
    },
    '&[data-state="hidden"]': {
      opacity: '0',
    },
  },
  variants: {
    size: {
      sm: {},
      md: {},
      lg: {},
    },
    orientation: {
      vertical: {
        position: 'absolute',
        top: '0',
        right: '0',
        bottom: '0',
        flexDirection: 'column',
      },
      horizontal: {
        position: 'absolute',
        left: '0',
        right: '0',
        bottom: '0',
        flexDirection: 'row',
      },
    },
  },
  compoundVariants: [
    {
      orientation: 'vertical',
      size: 'sm',
      css: { width: '8px' },
    },
    {
      orientation: 'vertical',
      size: 'md',
      css: { width: '10px' },
    },
    {
      orientation: 'vertical',
      size: 'lg',
      css: { width: '12px' },
    },
    {
      orientation: 'horizontal',
      size: 'sm',
      css: { height: '8px' },
    },
    {
      orientation: 'horizontal',
      size: 'md',
      css: { height: '10px' },
    },
    {
      orientation: 'horizontal',
      size: 'lg',
      css: { height: '12px' },
    },
  ],
  defaultVariants: {
    size: 'md',
    orientation: 'vertical',
  },
});

/**
 * ScrollAreaThumb - Draggable thumb
 */
export const ScrollAreaThumb = styled(ScrollAreaThumbPrimitive, {
  base: {
    flex: '1',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    borderRadius: '9999px',
    position: 'relative',
    transition: 'background-color 0.15s ease',
    '&:hover': {
      backgroundColor: 'rgba(0, 0, 0, 0.4)',
    },
    '&[data-dragging]': {
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
    },
  },
});

// Attach sub-components
(ScrollArea as any).Viewport = ScrollAreaViewport;
(ScrollArea as any).Scrollbar = ScrollAreaScrollbar;
(ScrollArea as any).Thumb = ScrollAreaThumb;

// Display names
ScrollArea.displayName = 'ScrollArea';
ScrollAreaViewport.displayName = 'ScrollAreaViewport';
ScrollAreaScrollbar.displayName = 'ScrollAreaScrollbar';
ScrollAreaThumb.displayName = 'ScrollAreaThumb';

// Type exports
export type { ScrollAreaPrimitiveProps as ScrollAreaProps };
