/**
 * Styled Carousel Component
 *
 * Image/content carousel with navigation.
 * Built on top of the Carousel primitive with styled() function.
 */

import { styled } from '../../styling/styled.js';
import {
  Carousel as CarouselPrimitive,
  CarouselContent as CarouselContentPrimitive,
  CarouselItem as CarouselItemPrimitive,
  CarouselPrevious as CarouselPreviousPrimitive,
  CarouselNext as CarouselNextPrimitive,
  type CarouselProps as CarouselPrimitiveProps,
} from '../../primitives/Carousel.js';

/**
 * Carousel - Root component
 */
export const Carousel = styled(CarouselPrimitive, {
  base: {
    position: 'relative',
    width: '100%',
    overflow: 'hidden',
  },
});

/**
 * CarouselContent - Content container
 */
export const CarouselContent = styled(CarouselContentPrimitive, {
  base: {
    display: 'flex',
    transition: 'transform 0.3s ease',
  },
});

/**
 * CarouselItem - Individual item
 */
export const CarouselItem = styled(CarouselItemPrimitive, {
  base: {
    flexShrink: '0',
    width: '100%',
    minWidth: '0',
  },
});

/**
 * CarouselPrevious - Previous button
 */
export const CarouselPrevious = styled<{
  size?: 'sm' | 'md' | 'lg';
}>(CarouselPreviousPrimitive, {
  base: {
    position: 'absolute',
    top: '50%',
    left: '1rem',
    transform: 'translateY(-50%)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '2.5rem',
    height: '2.5rem',
    borderRadius: '50%',
    border: 'none',
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    color: '#111827',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
    zIndex: '10',
    '&:hover:not(:disabled)': {
      backgroundColor: '#ffffff',
      boxShadow: '0 4px 6px rgba(0, 0, 0, 0.15)',
    },
    '&:focus': {
      outline: 'none',
      boxShadow: '0 0 0 2px #3b82f6',
    },
    '&:disabled': {
      opacity: '0.5',
      cursor: 'not-allowed',
    },
  },
  variants: {
    size: {
      sm: {
        width: '2rem',
        height: '2rem',
        fontSize: '0.875rem',
      },
      md: {
        width: '2.5rem',
        height: '2.5rem',
        fontSize: '1rem',
      },
      lg: {
        width: '3rem',
        height: '3rem',
        fontSize: '1.25rem',
      },
    },
  },
  defaultVariants: {
    size: 'md',
  },
});

/**
 * CarouselNext - Next button
 */
export const CarouselNext = styled<{
  size?: 'sm' | 'md' | 'lg';
}>(CarouselNextPrimitive, {
  base: {
    position: 'absolute',
    top: '50%',
    right: '1rem',
    transform: 'translateY(-50%)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '2.5rem',
    height: '2.5rem',
    borderRadius: '50%',
    border: 'none',
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    color: '#111827',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
    zIndex: '10',
    '&:hover:not(:disabled)': {
      backgroundColor: '#ffffff',
      boxShadow: '0 4px 6px rgba(0, 0, 0, 0.15)',
    },
    '&:focus': {
      outline: 'none',
      boxShadow: '0 0 0 2px #3b82f6',
    },
    '&:disabled': {
      opacity: '0.5',
      cursor: 'not-allowed',
    },
  },
  variants: {
    size: {
      sm: {
        width: '2rem',
        height: '2rem',
        fontSize: '0.875rem',
      },
      md: {
        width: '2.5rem',
        height: '2.5rem',
        fontSize: '1rem',
      },
      lg: {
        width: '3rem',
        height: '3rem',
        fontSize: '1.25rem',
      },
    },
  },
  defaultVariants: {
    size: 'md',
  },
});

// Attach sub-components
(Carousel as any).Content = CarouselContent;
(Carousel as any).Item = CarouselItem;
(Carousel as any).Previous = CarouselPrevious;
(Carousel as any).Next = CarouselNext;

// Display names
Carousel.displayName = 'Carousel';
CarouselContent.displayName = 'CarouselContent';
CarouselItem.displayName = 'CarouselItem';
CarouselPrevious.displayName = 'CarouselPrevious';
CarouselNext.displayName = 'CarouselNext';

// Type exports
export type { CarouselPrimitiveProps as CarouselProps };
