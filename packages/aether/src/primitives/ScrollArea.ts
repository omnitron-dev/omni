/**
 * ScrollArea Component
 *
 * A customizable scroll area with styled scrollbars.
 *
 * @example
 * ```tsx
 * <ScrollArea class="scroll-area" style={{ height: '300px' }}>
 *   <ScrollArea.Viewport>
 *     Long content here
 *   </ScrollArea.Viewport>
 *   <ScrollArea.Scrollbar orientation="vertical">
 *     <ScrollArea.Thumb />
 *   </ScrollArea.Scrollbar>
 *   <ScrollArea.Scrollbar orientation="horizontal">
 *     <ScrollArea.Thumb />
 *   </ScrollArea.Scrollbar>
 * </ScrollArea>
 * ```
 */

import { jsx } from '../jsx-runtime.js';
import { defineComponent } from '../core/component/index.js';
import { signal, computed, type WritableSignal } from '../core/reactivity/index.js';
import { createContext, useContext } from '../core/component/context.js';

export interface ScrollAreaProps {
  /**
   * Scroll type
   * - auto: show scrollbars when needed
   * - always: always show scrollbars
   * - scroll: native scroll behavior
   * - hover: show scrollbars on hover
   */
  type?: 'auto' | 'always' | 'scroll' | 'hover';

  /**
   * Scroll direction
   */
  dir?: 'ltr' | 'rtl';

  /**
   * Children content
   */
  children?: any;

  /**
   * Additional HTML attributes
   */
  [key: string]: any;
}

export interface ScrollAreaViewportProps {
  children?: any;
  [key: string]: any;
}

export interface ScrollAreaScrollbarProps {
  /**
   * Scrollbar orientation
   */
  orientation: 'vertical' | 'horizontal';

  /**
   * Force mount the scrollbar
   */
  forceMount?: boolean;

  children?: any;
  [key: string]: any;
}

export interface ScrollAreaThumbProps {
  [key: string]: any;
}

export interface ScrollAreaContextValue {
  type: () => string;
  dir: () => string;
  scrollX: () => number;
  scrollY: () => number;
  scrollWidth: () => number;
  scrollHeight: () => number;
  clientWidth: () => number;
  clientHeight: () => number;
  setViewportRef: (ref: HTMLElement | null) => void;
}

export interface ScrollbarContextValue {
  orientation: () => 'vertical' | 'horizontal';
  thumbSize: () => number;
  thumbPosition: () => number;
  isVisible: () => boolean;
}

const ScrollAreaContext = createContext<ScrollAreaContextValue>({
  type: () => 'hover',
  dir: () => 'ltr',
  scrollX: () => 0,
  scrollY: () => 0,
  scrollWidth: () => 0,
  scrollHeight: () => 0,
  clientWidth: () => 0,
  clientHeight: () => 0,
  setViewportRef: () => {},
});

const ScrollbarContext = createContext<ScrollbarContextValue>({
  orientation: () => 'vertical',
  thumbSize: () => 0,
  thumbPosition: () => 0,
  isVisible: () => false,
});

/**
 * ScrollArea Root
 */
export const ScrollArea = defineComponent<ScrollAreaProps>((props) => {
  const viewportRef: WritableSignal<HTMLElement | null> = signal<HTMLElement | null>(null);
  const scrollX = signal(0);
  const scrollY = signal(0);
  const scrollWidth = signal(0);
  const scrollHeight = signal(0);
  const clientWidth = signal(0);
  const clientHeight = signal(0);

  let currentViewport: HTMLElement | null = null;
  let resizeObserver: ResizeObserver | null = null;

  const updateScrollMetrics = () => {
    const viewport = viewportRef();
    if (!viewport) return;

    scrollX.set(viewport.scrollLeft);
    scrollY.set(viewport.scrollTop);
    scrollWidth.set(viewport.scrollWidth);
    scrollHeight.set(viewport.scrollHeight);
    clientWidth.set(viewport.clientWidth);
    clientHeight.set(viewport.clientHeight);
  };

  const setViewportRef = (ref: HTMLElement | null) => {
    // Clean up previous viewport
    if (currentViewport) {
      currentViewport.removeEventListener('scroll', updateScrollMetrics);
      if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
      }
    }

    viewportRef.set(ref);
    currentViewport = ref;

    if (ref) {
      updateScrollMetrics();

      // Listen to scroll events
      ref.addEventListener('scroll', updateScrollMetrics);

      // Listen to resize
      resizeObserver = new ResizeObserver(updateScrollMetrics);
      resizeObserver.observe(ref);
    }
  };

  const contextValue: ScrollAreaContextValue = {
    type: () => props.type ?? 'hover',
    dir: () => props.dir ?? 'ltr',
    scrollX: () => scrollX(),
    scrollY: () => scrollY(),
    scrollWidth: () => scrollWidth(),
    scrollHeight: () => scrollHeight(),
    clientWidth: () => clientWidth(),
    clientHeight: () => clientHeight(),
    setViewportRef,
  };

  return () => {
    const { type = 'hover', dir = 'ltr', children, ...restProps } = props;

    return jsx(ScrollAreaContext.Provider, {
      value: contextValue,
      children: jsx('div', {
        ...restProps,
        'data-scroll-area': '',
        'data-type': type,
        dir,
        children,
      }),
    });
  };
});

/**
 * ScrollArea Viewport
 *
 * The scrollable viewport container.
 */
export const ScrollAreaViewport = defineComponent<ScrollAreaViewportProps>((props) => {
  const ctx = useContext(ScrollAreaContext);

  const handleRef = (element: HTMLElement | null) => {
    ctx.setViewportRef(element);
  };

  return () => {
    const { children, ...restProps } = props;

    return jsx('div', {
      ...restProps,
      ref: handleRef as any,
      'data-scroll-area-viewport': '',
      style: {
        ...(props.style || {}),
        overflow: 'scroll',
        scrollbarWidth: 'none', // Firefox
        msOverflowStyle: 'none', // IE/Edge
      },
      children,
    });
  };
});

/**
 * ScrollArea Scrollbar
 *
 * Custom scrollbar track.
 */
export const ScrollAreaScrollbar = defineComponent<ScrollAreaScrollbarProps>((props) => {
  const ctx = useContext(ScrollAreaContext);

  const isVertical = () => props.orientation === 'vertical';

  const scrollSize = computed(() => isVertical() ? ctx.scrollHeight() : ctx.scrollWidth());

  const clientSize = computed(() => isVertical() ? ctx.clientHeight() : ctx.clientWidth());

  const scrollPosition = computed(() => isVertical() ? ctx.scrollY() : ctx.scrollX());

  const isVisible = computed(() => 
    // Show scrollbar if content is scrollable
     scrollSize() > clientSize()
  );

  // Calculate thumb size (proportional to visible area)
  const thumbSize = computed(() => {
    if (!isVisible()) return 0;
    const ratio = clientSize() / scrollSize();
    return Math.max(ratio * 100, 10); // Minimum 10% size
  });

  // Calculate thumb position
  const thumbPosition = computed(() => {
    if (!isVisible()) return 0;
    const maxScroll = scrollSize() - clientSize();
    if (maxScroll <= 0) return 0;
    const scrollRatio = scrollPosition() / maxScroll;
    const maxThumbPosition = 100 - thumbSize();
    return scrollRatio * maxThumbPosition;
  });

  const scrollbarContextValue: ScrollbarContextValue = {
    orientation: () => props.orientation,
    thumbSize: () => thumbSize(),
    thumbPosition: () => thumbPosition(),
    isVisible: () => isVisible(),
  };

  return () => {
    const { orientation, forceMount, children, ...restProps } = props;

    // Hide scrollbar if not visible and not force mounted
    if (!forceMount && !isVisible()) {
      return null;
    }

    return jsx(ScrollbarContext.Provider, {
      value: scrollbarContextValue,
      children: jsx('div', {
        ...restProps,
        'data-scroll-area-scrollbar': '',
        'data-orientation': orientation,
        'data-state': isVisible() ? 'visible' : 'hidden',
        children,
      }),
    });
  };
});

/**
 * ScrollArea Thumb
 *
 * The draggable scrollbar thumb.
 */
export const ScrollAreaThumb = defineComponent<ScrollAreaThumbProps>((props) => {
  const scrollbarCtx = useContext(ScrollbarContext);

  return () => {
    const thumbSize = scrollbarCtx.thumbSize();
    const thumbPosition = scrollbarCtx.thumbPosition();
    const isVertical = scrollbarCtx.orientation() === 'vertical';

    return jsx('div', {
      ...props,
      'data-scroll-area-thumb': '',
      'data-state': scrollbarCtx.isVisible() ? 'visible' : 'hidden',
      style: {
        ...(props.style || {}),
        position: 'absolute',
        ...(isVertical
          ? {
              top: `${thumbPosition}%`,
              height: `${thumbSize}%`,
              left: 0,
              right: 0,
            }
          : {
              left: `${thumbPosition}%`,
              width: `${thumbSize}%`,
              top: 0,
              bottom: 0,
            }),
      },
    });
  };
});

// Attach sub-components
(ScrollArea as any).Viewport = ScrollAreaViewport;
(ScrollArea as any).Scrollbar = ScrollAreaScrollbar;
(ScrollArea as any).Thumb = ScrollAreaThumb;

// Display names
ScrollArea.displayName = 'ScrollArea';
ScrollAreaViewport.displayName = 'ScrollArea.Viewport';
ScrollAreaScrollbar.displayName = 'ScrollArea.Scrollbar';
ScrollAreaThumb.displayName = 'ScrollArea.Thumb';
