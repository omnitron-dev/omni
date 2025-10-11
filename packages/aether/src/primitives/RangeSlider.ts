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
import { signal } from '../core/reactivity/signal.js';
import { computed } from '../core/reactivity/computed.js';
import { effect } from '../core/reactivity/effect.js';
import { jsx } from '../jsx-runtime.js';

// ============================================================================
// Types
// ============================================================================

export interface RangeValue {
  min: number;
  max: number;
}

export interface RangeSliderProps {
  /** Controlled value (signal) */
  value?: WritableSignal<RangeValue>;
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

// Global reactive context signal that will be updated during RangeSlider setup
// This allows children to access the context even if they're evaluated before the parent
// Using a SIGNAL makes the context reactive, so effects will rerun when it updates
const globalRangeSliderContextSignal = signal<RangeSliderContextValue | null>(null);

// Create context with default implementation that delegates to global signal
const RangeSliderContext = createContext<RangeSliderContextValue>({
  value: computed(() => globalRangeSliderContextSignal()?.value() ?? { min: 0, max: 100 }),
  get min() { return globalRangeSliderContextSignal()?.min ?? 0; },
  get max() { return globalRangeSliderContextSignal()?.max ?? 100; },
  get step() { return globalRangeSliderContextSignal()?.step ?? 1; },
  get orientation() { return globalRangeSliderContextSignal()?.orientation ?? 'horizontal'; },
  get disabled() { return globalRangeSliderContextSignal()?.disabled ?? false; },
  get minDistance() { return globalRangeSliderContextSignal()?.minDistance ?? 0; },
  setMinValue: (value) => globalRangeSliderContextSignal()?.setMinValue(value),
  setMaxValue: (value) => globalRangeSliderContextSignal()?.setMaxValue(value),
  getPercentage: (value) => globalRangeSliderContextSignal()?.getPercentage(value) ?? 0,
  getValueFromPercentage: (percentage) => globalRangeSliderContextSignal()?.getValueFromPercentage(percentage) ?? 0,
}, 'RangeSlider');

const useRangeSliderContext = (): RangeSliderContextValue => useContext(RangeSliderContext);

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

  // Helper to round and clamp initial values
  const normalizeValue = (value: RangeValue): RangeValue => ({
    min: clamp(roundToStep(value.min, step), min, max),
    max: clamp(roundToStep(value.max, step), min, max),
  });

  // State - use controlled signal if provided, otherwise create internal one
  const defaultValue = props.defaultValue ? normalizeValue(props.defaultValue) : { min, max };
  const valueSignal: WritableSignal<RangeValue> = props.value || signal<RangeValue>(defaultValue);

  const setValue = (newValue: RangeValue) => {
    valueSignal.set(newValue);
    props.onValueChange?.(newValue);
  };

  const setMinValue = (value: number) => {
    const current = valueSignal();
    const clampedValue = clamp(
      roundToStep(value, step),
      min,
      current.max - minDistance,
    );
    setValue({ min: clampedValue, max: current.max });
  };

  const setMaxValue = (value: number) => {
    const current = valueSignal();
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
    value: valueSignal as Signal<RangeValue>,
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

  // CRITICAL FIX: Set global context signal so children can access it
  // Using a signal makes this reactive - effects will rerun when it updates!
  globalRangeSliderContextSignal.set(contextValue);

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

export const RangeSliderTrack = defineComponent<RangeSliderTrackProps>((props) => () => {
    // ✅ CORRECT: Access context in render phase
    const context = useRangeSliderContext();
    const { children, ...rest } = props;

    return jsx('div', {
      'data-range-slider-track': '',
      'data-orientation': context.orientation,
      role: 'presentation',
      ...rest,
      children,
    });
  });

// ============================================================================
// RangeSlider Range
// ============================================================================

export const RangeSliderRange = defineComponent<RangeSliderRangeProps>((props) => () => {
    // ✅ CORRECT: Access context in render phase
    const context = useRangeSliderContext();
    const { children, ...rest } = props;

    const calculateStyle = () => {
      const value = context.value();
      const minPercent = context.getPercentage(value.min);
      const maxPercent = context.getPercentage(value.max);

      return context.orientation === 'horizontal'
        ? {
            left: `${minPercent}%`,
            width: `${maxPercent - minPercent}%`,
          }
        : {
            bottom: `${minPercent}%`,
            height: `${maxPercent - minPercent}%`,
          };
    };

    const initialStyle = calculateStyle();

    const div = jsx('div', {
      'data-range-slider-range': '',
      'data-orientation': context.orientation,
      role: 'presentation',
      style: initialStyle,
      ...rest,
      children,
    }) as HTMLElement;

    // Set up reactive effect to update style
    effect(() => {
      const newStyle = calculateStyle();
      Object.assign(div.style, newStyle);
    });

    return div;
  });

// ============================================================================
// RangeSlider Thumb
// ============================================================================

export const RangeSliderThumb = defineComponent<RangeSliderThumbProps>((props) => {
  const thumbRef: { current: HTMLDivElement | null } = { current: null };

  return () => {
    // ✅ CORRECT: Access context in render phase
    const context = useRangeSliderContext();
    const { position, children, ...rest } = props;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (context.disabled) return;

      const current = context.value();
      const currentValue = position === 'min' ? current.min : current.max;
      const setValue = position === 'min' ? context.setMinValue : context.setMaxValue;

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
          newValue = position === 'min' ? context.min : current.min + context.minDistance;
          break;
        case 'End':
          e.preventDefault();
          newValue = position === 'max' ? context.max : current.max - context.minDistance;
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

      const setValue = position === 'min' ? context.setMinValue : context.setMaxValue;

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

    const calculateStyle = () => {
      const value = context.value();
      const currentValue = position === 'min' ? value.min : value.max;
      const percentage = context.getPercentage(currentValue);

      return context.orientation === 'horizontal'
        ? { left: `${percentage}%` }
        : { bottom: `${percentage}%` };
    };

    const value = context.value();
    const currentValue = position === 'min' ? value.min : value.max;
    const initialStyle = calculateStyle();

    const div = jsx('div', {
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
      style: initialStyle,
      onKeyDown: handleKeyDown,
      onPointerDown: handlePointerDown,
      ...rest,
      children,
    }) as HTMLElement;

    // Set up reactive effect to update ALL context-dependent attributes and style
    effect(() => {
      const value = context.value();
      const currentValue = position === 'min' ? value.min : value.max;
      const newStyle = calculateStyle();

      // Update reactive attributes
      div.setAttribute('aria-valuemin', String(context.min));
      div.setAttribute('aria-valuemax', String(context.max));
      div.setAttribute('aria-valuenow', String(currentValue));
      div.setAttribute('aria-orientation', context.orientation);
      div.setAttribute('data-orientation', context.orientation);

      if (context.disabled) {
        div.setAttribute('aria-disabled', 'true');
        div.setAttribute('tabindex', '-1');
      } else {
        div.removeAttribute('aria-disabled');
        div.setAttribute('tabindex', '0');
      }

      Object.assign(div.style, newStyle);
    });

    return div;
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
