/**
 * RangeSlider - Slider with two thumbs for selecting a range
 *
 * Features:
 * - Dual thumb slider for range selection
 * - Keyboard navigation (arrows, Page Up/Down, Home/End)
 * - Min/max value constraints
 * - Step increments
 * - Vertical and horizontal orientation
 * - Disabled state
 * - Controlled and uncontrolled modes
 * - ARIA support for accessibility
 */

import { defineComponent } from '../core/component/index.js';
import { createContext, useContext } from '../core/component/context.js';
import type { Signal, WritableSignal } from '../core/reactivity/types.js';
import { signal, computed } from '../core/reactivity/index.js';
import { jsx } from '../jsx-runtime.js';

// ============================================================================
// Types
// ============================================================================

export interface RangeValue {
  min: number;
  max: number;
}

export interface RangeSliderProps {
  /** Controlled value [min, max] */
  value?: RangeValue;
  /** Value change callback */
  onValueChange?: (value: RangeValue) => void;
  /** Default value (uncontrolled) */
  defaultValue?: RangeValue;
  /** Minimum allowed value */
  min?: number;
  /** Maximum allowed value */
  max?: number;
  /** Step increment */
  step?: number;
  /** Orientation */
  orientation?: 'horizontal' | 'vertical';
  /** Whether the slider is disabled */
  disabled?: boolean;
  /** Minimum distance between thumbs */
  minDistance?: number;
  /** Children */
  children?: any;
}

export interface RangeSliderTrackProps {
  /** Children */
  children?: any;
  /** Additional props */
  [key: string]: any;
}

export interface RangeSliderRangeProps {
  /** Children */
  children?: any;
  /** Additional props */
  [key: string]: any;
}

export interface RangeSliderThumbProps {
  /** Which thumb: 'min' or 'max' */
  position: 'min' | 'max';
  /** Children */
  children?: any;
  /** Additional props */
  [key: string]: any;
}

interface RangeSliderContextValue {
  /** Current range value */
  value: Signal<RangeValue>;
  /** Min allowed value */
  min: number;
  /** Max allowed value */
  max: number;
  /** Step */
  step: number;
  /** Orientation */
  orientation: 'horizontal' | 'vertical';
  /** Disabled state */
  disabled: boolean;
  /** Min distance between thumbs */
  minDistance: number;
  /** Set min thumb value */
  setMinValue: (value: number) => void;
  /** Set max thumb value */
  setMaxValue: (value: number) => void;
  /** Get percentage for value */
  getPercentage: (value: number) => number;
  /** Get value from percentage */
  getValueFromPercentage: (percentage: number) => number;
}

// ============================================================================
// Context
// ============================================================================

const noop = () => {};
const noopValue = () => ({ min: 0, max: 100 });
const noopPercentage = () => 0;

const RangeSliderContext = createContext<RangeSliderContextValue>({
  value: noopValue as Signal<RangeValue>,
  min: 0,
  max: 100,
  step: 1,
  orientation: 'horizontal',
  disabled: false,
  minDistance: 0,
  setMinValue: noop,
  setMaxValue: noop,
  getPercentage: noopPercentage,
  getValueFromPercentage: noopPercentage,
});

const useRangeSliderContext = (): RangeSliderContextValue => {
  return useContext(RangeSliderContext);
};

// ============================================================================
// Helper Functions
// ============================================================================

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const roundToStep = (value: number, step: number): number => Math.round(value / step) * step;

// ============================================================================
// RangeSlider Root
// ============================================================================

export const RangeSlider = defineComponent<RangeSliderProps>((props) => {
  const min = props.min ?? 0;
  const max = props.max ?? 100;
  const step = props.step ?? 1;
  const orientation = props.orientation ?? 'horizontal';
  const disabled = props.disabled ?? false;
  const minDistance = props.minDistance ?? 0;

  // State
  const internalValue: WritableSignal<RangeValue> = signal<RangeValue>(
    props.defaultValue ?? { min, max },
  );

  const currentValue = (): RangeValue => {
    if (props.value !== undefined) {
      return props.value;
    }
    return internalValue();
  };

  const setValue = (newValue: RangeValue) => {
    if (props.value === undefined) {
      internalValue.set(newValue);
    }
    props.onValueChange?.(newValue);
  };

  const setMinValue = (value: number) => {
    const current = currentValue();
    const clampedValue = clamp(
      roundToStep(value, step),
      min,
      current.max - minDistance,
    );
    setValue({ min: clampedValue, max: current.max });
  };

  const setMaxValue = (value: number) => {
    const current = currentValue();
    const clampedValue = clamp(
      roundToStep(value, step),
      current.min + minDistance,
      max,
    );
    setValue({ min: current.min, max: clampedValue });
  };

  const getPercentage = (value: number): number => ((value - min) / (max - min)) * 100;

  const getValueFromPercentage = (percentage: number): number => (percentage / 100) * (max - min) + min;

  const contextValue: RangeSliderContextValue = {
    value: computed(() => currentValue()),
    min,
    max,
    step,
    orientation,
    disabled,
    minDistance,
    setMinValue,
    setMaxValue,
    getPercentage,
    getValueFromPercentage,
  };

  return () =>
    jsx(RangeSliderContext.Provider, {
      value: contextValue,
      children: jsx('div', {
        'data-range-slider': '',
        'data-orientation': orientation,
        'data-disabled': disabled ? '' : undefined,
        role: 'group',
        'aria-label': 'Range slider',
        children: props.children,
      }),
    });
});

// ============================================================================
// RangeSlider Track
// ============================================================================

export const RangeSliderTrack = defineComponent<RangeSliderTrackProps>((props) => {
  const context = useRangeSliderContext();

  return () => {
    const { children, ...rest } = props;

    return jsx('div', {
      'data-range-slider-track': '',
      'data-orientation': context.orientation,
      role: 'presentation',
      ...rest,
      children,
    });
  };
});

// ============================================================================
// RangeSlider Range
// ============================================================================

export const RangeSliderRange = defineComponent<RangeSliderRangeProps>((props) => {
  const context = useRangeSliderContext();

  return () => {
    const { children, ...rest } = props;
    const value = context.value();

    const minPercent = context.getPercentage(value.min);
    const maxPercent = context.getPercentage(value.max);

    const style =
      context.orientation === 'horizontal'
        ? {
            left: `${minPercent}%`,
            width: `${maxPercent - minPercent}%`,
          }
        : {
            bottom: `${minPercent}%`,
            height: `${maxPercent - minPercent}%`,
          };

    return jsx('div', {
      'data-range-slider-range': '',
      'data-orientation': context.orientation,
      role: 'presentation',
      style,
      ...rest,
      children,
    });
  };
});

// ============================================================================
// RangeSlider Thumb
// ============================================================================

export const RangeSliderThumb = defineComponent<RangeSliderThumbProps>((props) => {
  const context = useRangeSliderContext();
  const thumbRef: { current: HTMLDivElement | null } = { current: null };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (context.disabled) return;

    const current = context.value();
    const currentValue = props.position === 'min' ? current.min : current.max;
    const setValue = props.position === 'min' ? context.setMinValue : context.setMaxValue;

    let newValue = currentValue;

    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowDown':
        e.preventDefault();
        newValue = currentValue - context.step;
        break;
      case 'ArrowRight':
      case 'ArrowUp':
        e.preventDefault();
        newValue = currentValue + context.step;
        break;
      case 'PageDown':
        e.preventDefault();
        newValue = currentValue - context.step * 10;
        break;
      case 'PageUp':
        e.preventDefault();
        newValue = currentValue + context.step * 10;
        break;
      case 'Home':
        e.preventDefault();
        newValue = props.position === 'min' ? context.min : current.min + context.minDistance;
        break;
      case 'End':
        e.preventDefault();
        newValue = props.position === 'max' ? context.max : current.max - context.minDistance;
        break;
    }

    if (newValue !== currentValue) {
      setValue(newValue);
    }
  };

  const handlePointerDown = (e: PointerEvent) => {
    if (context.disabled) return;

    const thumb = thumbRef.current;
    if (!thumb) return;

    const track = thumb.closest('[data-range-slider-track]') as HTMLElement;
    if (!track) return;

    thumb.setPointerCapture(e.pointerId);

    const setValue = props.position === 'min' ? context.setMinValue : context.setMaxValue;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const rect = track.getBoundingClientRect();
      let percentage: number;

      if (context.orientation === 'horizontal') {
        percentage = ((moveEvent.clientX - rect.left) / rect.width) * 100;
      } else {
        percentage = ((rect.bottom - moveEvent.clientY) / rect.height) * 100;
      }

      const value = context.getValueFromPercentage(clamp(percentage, 0, 100));
      setValue(value);
    };

    const handlePointerUp = () => {
      thumb.releasePointerCapture(e.pointerId);
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
    };

    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
  };

  return () => {
    const { position, children, ...rest } = props;
    const value = context.value();
    const currentValue = position === 'min' ? value.min : value.max;
    const percentage = context.getPercentage(currentValue);

    const style =
      context.orientation === 'horizontal'
        ? { left: `${percentage}%` }
        : { bottom: `${percentage}%` };

    return jsx('div', {
      ref: thumbRef,
      'data-range-slider-thumb': '',
      'data-position': position,
      'data-orientation': context.orientation,
      role: 'slider',
      tabIndex: context.disabled ? -1 : 0,
      'aria-label': `${position === 'min' ? 'Minimum' : 'Maximum'} value`,
      'aria-valuemin': context.min,
      'aria-valuemax': context.max,
      'aria-valuenow': currentValue,
      'aria-disabled': context.disabled,
      'aria-orientation': context.orientation,
      style,
      onKeyDown: handleKeyDown,
      onPointerDown: handlePointerDown,
      ...rest,
      children,
    });
  };
});

// ============================================================================
// Attach sub-components
// ============================================================================

(RangeSlider as any).Track = RangeSliderTrack;
(RangeSlider as any).Range = RangeSliderRange;
(RangeSlider as any).Thumb = RangeSliderThumb;

// ============================================================================
// Export types
// ============================================================================

export type { RangeSliderContextValue };
