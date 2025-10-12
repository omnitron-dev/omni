/**
 * Carousel Primitive
 *
 * A carousel/slider component for cycling through content.
 * Supports keyboard navigation, autoplay, and responsive sliding.
 *
 * @example
 * ```tsx
 * const index = signal(0);
 *
 * <Carousel value={index()} onValueChange={index}>
 *   <Carousel.Viewport>
 *     <Carousel.Slide>Slide 1</Carousel.Slide>
 *     <Carousel.Slide>Slide 2</Carousel.Slide>
 *     <Carousel.Slide>Slide 3</Carousel.Slide>
 *   </Carousel.Viewport>
 *   <Carousel.Previous>←</Carousel.Previous>
 *   <Carousel.Next>→</Carousel.Next>
 *   <Carousel.Indicators />
 * </Carousel>
 * ```
 */

import { defineComponent } from '../core/component/index.js';
import { createContext, useContext, provideContext } from '../core/component/context.js';
import { signal, computed, type WritableSignal, type Signal } from '../core/reactivity/index.js';
import { effect } from '../core/reactivity/effect.js';
import { jsx } from '../jsx-runtime.js';

// ============================================================================
// Types
// ============================================================================

export interface CarouselProps {
  children?: any;
  /** Current slide index */
  value?: number;
  /** Callback when slide changes */
  onValueChange?: (index: number) => void;
  /** Default slide index (uncontrolled) */
  defaultValue?: number;
  /** Whether carousel loops */
  loop?: boolean;
  /** Autoplay interval in ms (0 = disabled) */
  autoplay?: number;
  /** Orientation */
  orientation?: 'horizontal' | 'vertical';
  [key: string]: any;
}

export interface CarouselViewportProps {
  children?: any;
  [key: string]: any;
}

export interface CarouselSlideProps {
  children?: any;
  [key: string]: any;
}

export interface CarouselPreviousProps {
  children?: any;
  [key: string]: any;
}

export interface CarouselNextProps {
  children?: any;
  [key: string]: any;
}

export interface CarouselIndicatorsProps {
  children?: any;
  [key: string]: any;
}

interface CarouselContextValue {
  currentIndex: Signal<number>;
  totalSlides: Signal<number>;
  orientation: 'horizontal' | 'vertical';
  loop: boolean;
  canGoPrevious: Signal<boolean>;
  canGoNext: Signal<boolean>;
  goTo: (index: number) => void;
  goToPrevious: () => void;
  goToNext: () => void;
  registerSlide: () => number;
  unregisterSlide: () => void;
}

// ============================================================================
// Context
// ============================================================================

const CarouselContext = createContext<CarouselContextValue | undefined>(undefined);

function useCarouselContext(): CarouselContextValue {
  const context = useContext(CarouselContext);
  if (!context) {
    throw new Error('Carousel components must be used within Carousel');
  }
  return context;
}

// ============================================================================
// Components
// ============================================================================

/**
 * Carousel Root
 */
export const Carousel = defineComponent<CarouselProps>((props) => {
  const internalValue: WritableSignal<number> = signal<number>(props.defaultValue ?? 0);
  const slideCount: WritableSignal<number> = signal<number>(0);
  let autoplayTimer: number | null = null;

  const isControlled = () => props.value !== undefined;
  const currentIndex = () => (isControlled() ? props.value ?? 0 : internalValue());

  const setValue = (index: number) => {
    if (!isControlled()) {
      internalValue.set(index);
    }
    props.onValueChange?.(index);
  };

  const goTo = (index: number) => {
    const total = slideCount();
    if (total === 0) return;

    let newIndex = index;
    if (props.loop) {
      newIndex = ((index % total) + total) % total; // Handle negative wrapping
    } else {
      newIndex = Math.max(0, Math.min(index, total - 1));
    }
    setValue(newIndex);
    resetAutoplay();
  };

  const goToPrevious = () => {
    goTo(currentIndex() - 1);
  };

  const goToNext = () => {
    goTo(currentIndex() + 1);
  };

  const canGoPrevious = computed(() => props.loop || currentIndex() > 0);

  const canGoNext = computed(() => props.loop || currentIndex() < slideCount() - 1);

  let slideIndexCounter = 0;
  const registerSlide = () => {
    const index = slideIndexCounter++;
    slideCount.set(slideCount() + 1);
    return index;
  };

  const unregisterSlide = () => {
    slideCount.set(Math.max(0, slideCount() - 1));
  };

  const resetAutoplay = () => {
    if (autoplayTimer !== null) {
      clearInterval(autoplayTimer);
    }
    if (props.autoplay && props.autoplay > 0) {
      autoplayTimer = setInterval(() => {
        goToNext();
      }, props.autoplay) as any;
    }
  };

  // Initialize autoplay
  resetAutoplay();

  const contextValue: CarouselContextValue = {
    currentIndex: computed(() => currentIndex()),
    totalSlides: computed(() => slideCount()),
    orientation: props.orientation ?? 'horizontal',
    loop: props.loop ?? false,
    canGoPrevious,
    canGoNext,
    goTo,
    goToPrevious,
    goToNext,
    registerSlide,
    unregisterSlide,
  };

  // Provide context during setup phase (Pattern 17)
  provideContext(CarouselContext, contextValue);

  return () => {
    const { children, orientation = 'horizontal' } = props;

    // Evaluate function children during render (Pattern 17)
    const evaluatedChildren = typeof children === 'function' ? children() : children;

    return jsx('div', {
      'data-carousel': '',
      'data-orientation': orientation,
      role: 'region',
      'aria-roledescription': 'carousel',
      'aria-label': 'Carousel',
      children: evaluatedChildren,
    });
  };
});

/**
 * Carousel Viewport
 * Container for slides with overflow management
 */
export const CarouselViewport = defineComponent<CarouselViewportProps>((props) => () => {
  const context = useCarouselContext();
  const { children, ...restProps } = props;

  // Evaluate function children (Pattern 17)
  const evaluatedChildren = typeof children === 'function' ? children() : children;

  return jsx('div', {
    ...restProps,
    'data-carousel-viewport': '',
    'data-orientation': context.orientation,
    role: 'presentation',
    children: evaluatedChildren,
  });
});

/**
 * Carousel Slide
 * Individual slide content
 */
export const CarouselSlide = defineComponent<CarouselSlideProps>((props) => {
  const context = useCarouselContext();
  let slideIndex: number | null = null;

  // Register slide on mount
  if (slideIndex === null) {
    slideIndex = context.registerSlide();
  }

  return () => {
    const { children, ...restProps } = props;
    const position = slideIndex! + 1;

    const slide = jsx('div', {
      ...restProps,
      'data-carousel-slide': '',
      role: 'group',
      'aria-roledescription': 'slide',
      children,
    }) as HTMLElement;

    // Reactively update active state and ARIA attributes (Pattern 18)
    effect(() => {
      const isActive = context.currentIndex() === slideIndex;
      const total = context.totalSlides();

      if (isActive) {
        slide.setAttribute('data-active', '');
      } else {
        slide.removeAttribute('data-active');
      }

      slide.setAttribute('aria-label', `${position} of ${total}`);
      slide.setAttribute('aria-hidden', String(!isActive));
    });

    return slide;
  };
});

/**
 * Carousel Previous Button
 */
export const CarouselPrevious = defineComponent<CarouselPreviousProps>((props) => {
  const context = useCarouselContext();

  const handleClick = (e: MouseEvent) => {
    context.goToPrevious();
    props.onClick?.(e);
  };

  return () => {
    const { children, onClick, ...restProps } = props;

    const button = jsx('button', {
      ...restProps,
      type: 'button',
      'data-carousel-previous': '',
      'aria-label': 'Previous slide',
      onClick: handleClick,
      children,
    }) as HTMLButtonElement;

    // Reactively update disabled state (Pattern 18)
    effect(() => {
      button.disabled = !context.canGoPrevious();
    });

    return button;
  };
});

/**
 * Carousel Next Button
 */
export const CarouselNext = defineComponent<CarouselNextProps>((props) => {
  const context = useCarouselContext();

  const handleClick = (e: MouseEvent) => {
    context.goToNext();
    props.onClick?.(e);
  };

  return () => {
    const { children, onClick, ...restProps } = props;

    const button = jsx('button', {
      ...restProps,
      type: 'button',
      'data-carousel-next': '',
      'aria-label': 'Next slide',
      onClick: handleClick,
      children,
    }) as HTMLButtonElement;

    // Reactively update disabled state (Pattern 18)
    effect(() => {
      button.disabled = !context.canGoNext();
    });

    return button;
  };
});

/**
 * Carousel Indicators
 * Dot indicators for each slide
 */
export const CarouselIndicators = defineComponent<CarouselIndicatorsProps>((props) => {
  const context = useCarouselContext();

  return () => {
    const { children, ...restProps } = props;
    const total = context.totalSlides();

    const indicators = Array.from({ length: total }, (_, i) => {
      const button = jsx('button', {
        key: i,
        type: 'button',
        'data-carousel-indicator': '',
        'aria-label': `Go to slide ${i + 1}`,
        onClick: () => context.goTo(i),
      }) as HTMLButtonElement;

      // Reactively update active state (Pattern 18)
      effect(() => {
        const isActive = i === context.currentIndex();
        if (isActive) {
          button.setAttribute('data-active', '');
          button.setAttribute('aria-current', 'true');
        } else {
          button.removeAttribute('data-active');
          button.setAttribute('aria-current', 'false');
        }
      });

      return button;
    });

    return jsx('div', {
      ...restProps,
      'data-carousel-indicators': '',
      role: 'group',
      'aria-label': 'Slide indicators',
      children: indicators,
    });
  };
});

// ============================================================================
// Attach sub-components
// ============================================================================

(Carousel as any).Viewport = CarouselViewport;
(Carousel as any).Slide = CarouselSlide;
(Carousel as any).Previous = CarouselPrevious;
(Carousel as any).Next = CarouselNext;
(Carousel as any).Indicators = CarouselIndicators;

// ============================================================================
// Type augmentation
// ============================================================================

export interface CarouselComponent {
  (props: CarouselProps): any;
  Viewport: typeof CarouselViewport;
  Slide: typeof CarouselSlide;
  Previous: typeof CarouselPrevious;
  Next: typeof CarouselNext;
  Indicators: typeof CarouselIndicators;
}
