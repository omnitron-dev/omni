/**
 * Styled Slider Component
 *
 * A single-value slider with marks and styling.
 * Built on top of the Slider primitive with the styled() function.
 */

import { styled } from '../../styling/styled.js';
import { Slider as SliderPrimitive, SliderTrack, SliderRange, SliderThumb } from '../../primitives/Slider.js';

/**
 * Slider - Single value slider
 *
 * @example
 * ```tsx
 * <Slider value={volume} onValueChange={setVolume} min={0} max={100} size="md">
 *   <Slider.Track>
 *     <Slider.Range />
 *   </Slider.Track>
 *   <Slider.Thumb />
 * </Slider>
 * ```
 */
export const Slider = SliderPrimitive;

export const StyledSliderTrack = styled(SliderTrack, {
  base: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    width: '100%',
    height: '0.375rem',
    backgroundColor: '#e5e7eb',
    borderRadius: '9999px',
    cursor: 'pointer',
    touchAction: 'none',
    userSelect: 'none',
    '&[data-orientation="vertical"]': {
      width: '0.375rem',
      height: '100%',
      flexDirection: 'column',
    },
  },
  variants: {
    size: {
      sm: {
        height: '0.25rem',
        '&[data-orientation="vertical"]': {
          width: '0.25rem',
        },
      },
      md: {
        height: '0.375rem',
        '&[data-orientation="vertical"]': {
          width: '0.375rem',
        },
      },
      lg: {
        height: '0.5rem',
        '&[data-orientation="vertical"]': {
          width: '0.5rem',
        },
      },
    },
  },
  defaultVariants: {
    size: 'md',
  },
});

export const StyledSliderRange = styled(SliderRange, {
  base: {
    position: 'absolute',
    height: '100%',
    backgroundColor: '#3b82f6',
    borderRadius: '9999px',
    '&[data-orientation="vertical"]': {
      width: '100%',
    },
  },
  variants: {
    colorScheme: {
      blue: {
        backgroundColor: '#3b82f6',
      },
      green: {
        backgroundColor: '#10b981',
      },
      red: {
        backgroundColor: '#ef4444',
      },
      purple: {
        backgroundColor: '#8b5cf6',
      },
    },
  },
  defaultVariants: {
    colorScheme: 'blue',
  },
});

export const StyledSliderThumb = styled(SliderThumb, {
  base: {
    position: 'absolute',
    display: 'block',
    width: '1.25rem',
    height: '1.25rem',
    backgroundColor: '#ffffff',
    border: '2px solid #3b82f6',
    borderRadius: '9999px',
    boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)',
    cursor: 'grab',
    touchAction: 'none',
    transform: 'translate(-50%, 0)',
    transition: 'box-shadow 0.15s',
    '&:focus': {
      outline: 'none',
      boxShadow: '0 0 0 3px rgba(59, 130, 246, 0.2)',
    },
    '&:active': {
      cursor: 'grabbing',
    },
    '&[data-disabled]': {
      cursor: 'not-allowed',
      opacity: 0.5,
    },
    '&[data-orientation="vertical"]': {
      transform: 'translate(0, 50%)',
    },
  },
  variants: {
    size: {
      sm: {
        width: '1rem',
        height: '1rem',
      },
      md: {
        width: '1.25rem',
        height: '1.25rem',
      },
      lg: {
        width: '1.5rem',
        height: '1.5rem',
      },
    },
    colorScheme: {
      blue: {
        borderColor: '#3b82f6',
        '&:focus': {
          boxShadow: '0 0 0 3px rgba(59, 130, 246, 0.2)',
        },
      },
      green: {
        borderColor: '#10b981',
        '&:focus': {
          boxShadow: '0 0 0 3px rgba(16, 185, 129, 0.2)',
        },
      },
      red: {
        borderColor: '#ef4444',
        '&:focus': {
          boxShadow: '0 0 0 3px rgba(239, 68, 68, 0.2)',
        },
      },
      purple: {
        borderColor: '#8b5cf6',
        '&:focus': {
          boxShadow: '0 0 0 3px rgba(139, 92, 246, 0.2)',
        },
      },
    },
  },
  defaultVariants: {
    size: 'md',
    colorScheme: 'blue',
  },
});

// Attach styled sub-components to Slider
(Slider as any).Track = StyledSliderTrack;
(Slider as any).Range = StyledSliderRange;
(Slider as any).Thumb = StyledSliderThumb;

// Attach display name
(Slider as any).displayName = 'Slider';
