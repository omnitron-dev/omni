/**
 * Carousel Component Types
 *
 * Type definitions for the Carousel component - a responsive slider
 * with autoplay, navigation, and various layout options.
 *
 * @module @omnitron-dev/prism/components/carousel
 */

import type { Theme, SxProps } from '@mui/material/styles';

// =============================================================================
// CAROUSEL SLIDE TYPES
// =============================================================================

/**
 * Individual slide in the carousel.
 */
export interface CarouselSlide {
  /** Unique identifier */
  id?: string | number;
  /** Image source URL (for image slides) */
  src?: string;
  /** Alt text for image */
  alt?: string;
  /** Slide title */
  title?: string;
  /** Slide description */
  description?: string;
  /** Custom content to render */
  content?: React.ReactNode;
  /** Additional slide data */
  [key: string]: unknown;
}

// =============================================================================
// CAROUSEL PROPS
// =============================================================================

/**
 * Carousel component props.
 */
export interface CarouselProps extends React.ComponentProps<'div'> {
  /** Carousel children (slides) */
  children: React.ReactNode;
  /** Number of slides visible at once */
  slidesToShow?: number;
  /** Number of slides to scroll at once */
  slidesToScroll?: number;
  /** Space between slides (px) */
  spacing?: number;
  /** Autoplay slides */
  autoplay?: boolean;
  /** Autoplay interval in ms */
  autoplayInterval?: number;
  /** Pause autoplay on hover */
  pauseOnHover?: boolean;
  /** Enable infinite loop */
  loop?: boolean;
  /** Enable swipe/drag navigation */
  draggable?: boolean;
  /** Animation duration in ms */
  speed?: number;
  /** Carousel direction */
  direction?: 'horizontal' | 'vertical';
  /** Show navigation arrows */
  arrows?: boolean;
  /** Show dots indicator */
  dots?: boolean;
  /** Dots position */
  dotsPosition?: 'bottom' | 'top' | 'left' | 'right';
  /** Enable keyboard navigation */
  keyboard?: boolean;
  /** Initial slide index */
  initialSlide?: number;
  /** Callback when slide changes */
  onSlideChange?: (index: number) => void;
  /** Enable center mode (active slide centered) */
  centerMode?: boolean;
  /** Fade transition instead of slide */
  fade?: boolean;
  /** Responsive breakpoints */
  responsive?: CarouselBreakpoint[];
  /** MUI sx prop */
  sx?: SxProps<Theme>;
  /** Slot props for internal components */
  slotProps?: {
    /** Container styles */
    container?: SxProps<Theme>;
    /** Track styles */
    track?: SxProps<Theme>;
    /** Slide wrapper styles */
    slide?: SxProps<Theme>;
    /** Arrow button styles */
    arrow?: SxProps<Theme>;
    /** Dots container styles */
    dots?: SxProps<Theme>;
    /** Individual dot styles */
    dot?: SxProps<Theme>;
  };
}

/**
 * Responsive breakpoint configuration.
 */
export interface CarouselBreakpoint {
  /** Max width for this breakpoint */
  breakpoint: number;
  /** Settings for this breakpoint */
  settings: {
    slidesToShow?: number;
    slidesToScroll?: number;
    spacing?: number;
    arrows?: boolean;
    dots?: boolean;
  };
}

// =============================================================================
// CAROUSEL ARROW PROPS
// =============================================================================

/**
 * Carousel arrow button props.
 */
export interface CarouselArrowProps extends React.ComponentProps<'button'> {
  /** Arrow direction */
  direction: 'prev' | 'next';
  /** Whether arrow is disabled */
  disabled?: boolean;
  /** Arrow variant */
  variant?: 'default' | 'contained' | 'outlined';
  /** Arrow size */
  size?: 'small' | 'medium' | 'large';
  /** Arrow position inside or outside */
  position?: 'inside' | 'outside';
  /** MUI sx prop */
  sx?: SxProps<Theme>;
}

// =============================================================================
// CAROUSEL DOTS PROPS
// =============================================================================

/**
 * Carousel dots indicator props.
 */
export interface CarouselDotsProps extends React.ComponentProps<'div'> {
  /** Total number of dots */
  count: number;
  /** Active dot index */
  activeIndex: number;
  /** Dot click handler */
  onDotClick: (index: number) => void;
  /** Dot variant */
  variant?: 'default' | 'line' | 'number';
  /** Dots position */
  position?: 'bottom' | 'top' | 'left' | 'right';
  /** MUI sx prop */
  sx?: SxProps<Theme>;
}

// =============================================================================
// USE CAROUSEL RETURN TYPE
// =============================================================================

/**
 * Return type for useCarousel hook.
 */
export interface UseCarouselReturn {
  /** Current slide index */
  currentIndex: number;
  /** Total number of slides */
  totalSlides: number;
  /** Can go to previous slide */
  canPrev: boolean;
  /** Can go to next slide */
  canNext: boolean;
  /** Go to specific slide */
  goTo: (index: number) => void;
  /** Go to next slide */
  next: () => void;
  /** Go to previous slide */
  prev: () => void;
  /** Pause autoplay */
  pause: () => void;
  /** Resume autoplay */
  play: () => void;
  /** Is autoplay active */
  isPlaying: boolean;
  /** Carousel ref for imperative control */
  carouselRef: React.RefObject<HTMLDivElement | null>;
}
