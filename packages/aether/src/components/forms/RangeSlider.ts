/**
 * Styled RangeSlider Component
 *
 * A multi-handle range slider for selecting value ranges.
 * Built on top of the RangeSlider primitive with the styled() function.
 */

import { styled } from '../../styling/styled.js';
import {
  RangeSlider as RangeSliderPrimitive,
  RangeSliderTrack,
  RangeSliderRange,
  RangeSliderThumb,
} from '../../primitives/RangeSlider.js';

/**
 * RangeSlider - Multi-handle range selection
 *
 * @example
 * ```tsx
 * <RangeSlider value={range} onValueChange={setRange} min={0} max={100} size="md">
 *   <RangeSlider.Track>
 *     <RangeSlider.Range />
 *   </RangeSlider.Track>
 *   <RangeSlider.Thumb index={0} />
 *   <RangeSlider.Thumb index={1} />
 * </RangeSlider>
 * ```
 */
export const RangeSlider = RangeSliderPrimitive;

export const StyledRangeSliderTrack = styled(RangeSliderTrack, {
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

export const StyledRangeSliderRange = styled(RangeSliderRange, {
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

export const StyledRangeSliderThumb = styled(RangeSliderThumb, {
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
      zIndex: 1,
    },
    '&:active': {
      cursor: 'grabbing',
      zIndex: 2,
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

// Attach styled sub-components to RangeSlider
(RangeSlider as any).Track = StyledRangeSliderTrack;
(RangeSlider as any).Range = StyledRangeSliderRange;
(RangeSlider as any).Thumb = StyledRangeSliderThumb;

// Attach display name
(RangeSlider as any).displayName = 'RangeSlider';
