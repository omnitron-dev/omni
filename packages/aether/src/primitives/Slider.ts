/**
 * Slider Primitive
 *
 * An input for selecting a value or range from a continuous set of values.
 *
 * Based on WAI-ARIA Slider pattern:
 * https://www.w3.org/WAI/ARIA/apg/patterns/slider/
 */

import { defineComponent } from '../core/component/define.js';
import { createContext, useContext } from '../core/component/context.js';
import { signal, type WritableSignal } from '../core/reactivity/signal.js';
import { computed } from '../core/reactivity/computed.js';
import { effect } from '../core/reactivity/effect.js';
import { jsx } from '../jsx-runtime.js';
import { generateId } from './utils/index.js';

// ============================================================================
// Types
// ============================================================================

export interface SliderProps {
  /**
   * Controlled value (single or range)
   */
  value?: WritableSignal<number | number[]>;

  /**
   * Initial value (uncontrolled)
   */
  defaultValue?: number | number[];

  /**
   * Callback when value changes (during drag)
   */
  onValueChange?: (value: number | number[]) => void;

  /**
   * Callback when value is committed (on release)
   */
  onValueCommit?: (value: number | number[]) => void;

  /**
   * Minimum value
   * @default 0
   */
  min?: number;

  /**
   * Maximum value
   * @default 100
   */
  max?: number;

  /**
   * Step increment
   * @default 1
   */
  step?: number;

  /**
   * Minimum steps between thumbs (for range sliders)
   * @default 0
   */
  minStepsBetweenThumbs?: number;

  /**
   * Orientation
   * @default 'horizontal'
   */
  orientation?: 'horizontal' | 'vertical';

  /**
   * Disabled state
   */
  disabled?: boolean;

  /**
   * Invert slider direction
   */
  inverted?: boolean;

  /**
   * ID for the slider
   */
  id?: string;

  /**
   * Children
   */
  children: any;

  /**
   * Additional props
   */
  [key: string]: any;
}

export interface SliderThumbProps {
  /**
   * Thumb index (for range sliders)
   */
  index?: number;

  /**
   * Children
   */
  children?: any;

  /**
   * Additional props
   */
  [key: string]: any;
}

// ============================================================================
// Context
// ============================================================================

export interface SliderContextValue {
  value: () => number | number[];
  setValue: (value: number | number[], commit?: boolean) => void;
  min: number;
  max: number;
  step: number;
  orientation: 'horizontal' | 'vertical';
  disabled: boolean;
  inverted: boolean;
  sliderId: string;
  thumbCount: number;
  getThumbValue: (index: number) => number;
  setThumbValue: (index: number, value: number, commit?: boolean) => void;
  getPercentage: (value: number) => number;
}

// Global reactive context signal that will be updated during Slider setup
// This allows children to access the context even if they're evaluated before the parent
// Using a SIGNAL makes the context reactive, so effects will rerun when it updates
const globalSliderContextSignal = signal<SliderContextValue | null>(null);

// Create context with default implementation that delegates to global signal
export const SliderContext = createContext<SliderContextValue>({
  value: () => globalSliderContextSignal()?.value() ?? 0,
  setValue: (value, commit) => globalSliderContextSignal()?.setValue(value, commit),
  get min() { return globalSliderContextSignal()?.min ?? 0; },
  get max() { return globalSliderContextSignal()?.max ?? 100; },
  get step() { return globalSliderContextSignal()?.step ?? 1; },
  get orientation() { return globalSliderContextSignal()?.orientation ?? 'horizontal'; },
  get disabled() { return globalSliderContextSignal()?.disabled ?? false; },
  get inverted() { return globalSliderContextSignal()?.inverted ?? false; },
  get sliderId() { return globalSliderContextSignal()?.sliderId ?? ''; },
  get thumbCount() { return globalSliderContextSignal()?.thumbCount ?? 1; },
  getThumbValue: (index) => globalSliderContextSignal()?.getThumbValue(index) ?? 0,
  setThumbValue: (index, value, commit) => globalSliderContextSignal()?.setThumbValue(index, value, commit),
  getPercentage: (value) => globalSliderContextSignal()?.getPercentage(value) ?? 0,
}, 'Slider');

// ============================================================================
// Helpers
// ============================================================================

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function roundToStep(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function getClosestValueIndex(values: number[], targetValue: number): number {
  if (values.length === 0) return 0;
  return values.reduce(
    (closestIndex, currentValue, currentIndex) => {
      const currentDistance = Math.abs(currentValue - targetValue);
      const closestDistance = Math.abs(values[closestIndex]! - targetValue);
      return currentDistance < closestDistance ? currentIndex : closestIndex;
    },
    0
  );
}

// ============================================================================
// Components
// ============================================================================

/**
 * Slider root component
 *
 * @example
 * ```tsx
 * <Slider value={volume} onValueChange={setVolume} min={0} max={100}>
 *   <Slider.Track>
 *     <Slider.Range />
 *   </Slider.Track>
 *   <Slider.Thumb />
 * </Slider>
 * ```
 */
export const Slider = defineComponent<SliderProps>((props) => {
  const sliderId = props.id || generateId();

  // Defaults
  const min = () => props.min ?? 0;
  const max = () => props.max ?? 100;
  const step = () => props.step ?? 1;
  const orientation = () => props.orientation || 'horizontal';
  const disabled = () => !!props.disabled;
  const inverted = () => !!props.inverted;

  // Initialize value with clamping and rounding
  const rawDefaultValue = props.defaultValue ?? min();
  const clampAndRound = (val: number | number[]): number | number[] => {
    if (Array.isArray(val)) {
      return val.map(v => clamp(roundToStep(v, step()), min(), max()));
    }
    return clamp(roundToStep(val, step()), min(), max());
  };
  const defaultValue = clampAndRound(rawDefaultValue);
  const internalValue = signal<number | number[]>(defaultValue);
  const valueSignal = props.value || internalValue;

  // Normalize value to array for internal handling
  const valuesArray = computed(() => {
    const val = valueSignal();
    return Array.isArray(val) ? val : [val];
  });

  const thumbCount = () => valuesArray().length;

  const getPercentage = (value: number) => {
    const minVal = min();
    const maxVal = max();
    return ((value - minVal) / (maxVal - minVal)) * 100;
  };

  const getThumbValue = (index: number): number => valuesArray()[index] || min();

  const setThumbValue = (index: number, newValue: number, commit = false) => {
    const values = [...valuesArray()];
    values[index] = clamp(roundToStep(newValue, step()), min(), max());

    const finalValue = thumbCount() === 1 ? values[0]! : values;
    valueSignal.set(finalValue as any);

    if (commit) {
      props.onValueCommit?.(finalValue as number | number[]);
    } else {
      props.onValueChange?.(finalValue as number | number[]);
    }
  };

  const setValue = (value: number | number[], commit = false) => {
    valueSignal.set(value as any);
    if (commit) {
      props.onValueCommit?.(value);
    } else {
      props.onValueChange?.(value);
    }
  };

  const contextValue: SliderContextValue = {
    value: () => valueSignal(),
    setValue,
    get min() { return min(); },
    get max() { return max(); },
    get step() { return step(); },
    get orientation() { return orientation(); },
    get disabled() { return disabled(); },
    get inverted() { return inverted(); },
    sliderId,
    get thumbCount() { return thumbCount(); },
    getThumbValue,
    setThumbValue,
    getPercentage,
  };

  // CRITICAL FIX: Set global context signal so children can access it
  // Using a signal makes this reactive - effects will rerun when it updates!
  globalSliderContextSignal.set(contextValue);

  // Extract component-specific props to avoid spreading them onto DOM
  const {
    children,
    value: _value,
    defaultValue: _defaultValue,
    onValueChange: _onValueChange,
    onValueCommit: _onValueCommit,
    min: _min,
    max: _max,
    step: _step,
    minStepsBetweenThumbs: _minStepsBetweenThumbs,
    orientation: _orientation,
    disabled: _disabled,
    inverted: _inverted,
    id: _id,
    ...restProps
  } = props;

  return () =>
    jsx(SliderContext.Provider, {
      value: contextValue,
      children: jsx('div', {
        ...restProps,
        id: sliderId,
        role: 'group',
        'data-orientation': orientation(),
        'data-disabled': disabled() ? '' : undefined,
        children,
      }),
    });
});

/**
 * Slider Track component
 */
export const SliderTrack = defineComponent<{ children?: any; [key: string]: any }>((props) => {
  let trackRef: HTMLElement | null = null;

  return () => {
    // ✅ CORRECT: Access context in render phase
    const slider = useContext(SliderContext);

    const handleClick = (e: MouseEvent) => {
      if (slider.disabled || !trackRef) return;

      const rect = trackRef.getBoundingClientRect();
      const isHorizontal = slider.orientation === 'horizontal';

      let percentage: number;
      if (isHorizontal) {
        percentage = ((e.clientX - rect.left) / rect.width) * 100;
      } else {
        percentage = ((rect.bottom - e.clientY) / rect.height) * 100;
      }

      if (slider.inverted) {
        percentage = 100 - percentage;
      }

      const newValue = slider.min + (percentage / 100) * (slider.max - slider.min);

      // For single thumb, just set the value
      if (slider.thumbCount === 1) {
        slider.setThumbValue(0, newValue, true);
      } else {
        // For multiple thumbs, find closest thumb
        const values = Array.isArray(slider.value()) ? slider.value() as number[] : [slider.value() as number];
        const closestIndex = getClosestValueIndex(values, newValue);
        slider.setThumbValue(closestIndex, newValue, true);
      }
    };

    return jsx('div', {
      ...props,
      ref: ((el: HTMLElement) => (trackRef = el)) as any,
      'data-slider-track': '',
      onClick: handleClick,
    });
  };
});

/**
 * Slider Range component (filled portion)
 */
export const SliderRange = defineComponent<{ children?: any; [key: string]: any }>((props) => {
  return () => {
    // ✅ CORRECT: Access context in render phase
    const slider = useContext(SliderContext);

    // Calculate initial style
    const calculateStyle = () => {
      const values = Array.isArray(slider.value()) ? slider.value() as number[] : [slider.value() as number];
      const isHorizontal = slider.orientation === 'horizontal';

      if (values.length === 1) {
        // Single value: from min to value
        const percentage = slider.getPercentage(values[0]!);
        return isHorizontal
          ? { left: '0%', width: `${percentage}%` }
          : { bottom: '0%', height: `${percentage}%` };
      } else {
        // Range: from min value to max value
        const minVal = Math.min(...values);
        const maxVal = Math.max(...values);
        const startPercentage = slider.getPercentage(minVal);
        const endPercentage = slider.getPercentage(maxVal);

        return isHorizontal
          ? { left: `${startPercentage}%`, width: `${endPercentage - startPercentage}%` }
          : { bottom: `${startPercentage}%`, height: `${endPercentage - startPercentage}%` };
      }
    };

    const initialStyle = calculateStyle();

    const div = jsx('div', {
      ...props,
      'data-slider-range': '',
      style: initialStyle,
    }) as HTMLElement;

    // Set up reactive effect to update style
    effect(() => {
      const newStyle = calculateStyle();
      Object.assign(div.style, newStyle);
    });

    return div;
  };
});

/**
 * Slider Thumb component
 */
export const SliderThumb = defineComponent<SliderThumbProps>((props) => {
  const thumbIndex = props.index ?? 0;
  let isDragging = false;

  return () => {
    // ✅ CORRECT: Access context in render phase
    const slider = useContext(SliderContext);

    const getValue = () => slider.getThumbValue(thumbIndex);

    const calculateStyle = () => {
      const currentValue = getValue();
      const percentage = slider.getPercentage(currentValue);
      const isHorizontal = slider.orientation === 'horizontal';

      return isHorizontal
        ? { left: `${percentage}%` }
        : { bottom: `${percentage}%` };
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (slider.disabled) return;

      const currentValue = getValue();
      let newValue = currentValue;

      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowUp':
          e.preventDefault();
          newValue = currentValue + slider.step;
          break;
        case 'ArrowLeft':
        case 'ArrowDown':
          e.preventDefault();
          newValue = currentValue - slider.step;
          break;
        case 'PageUp':
          e.preventDefault();
          newValue = currentValue + slider.step * 10;
          break;
        case 'PageDown':
          e.preventDefault();
          newValue = currentValue - slider.step * 10;
          break;
        case 'Home':
          e.preventDefault();
          newValue = slider.min;
          break;
        case 'End':
          e.preventDefault();
          newValue = slider.max;
          break;
      }

      if (newValue !== currentValue) {
        slider.setThumbValue(thumbIndex, newValue, true);
      }
    };

    const handlePointerDown = (e: PointerEvent) => {
      if (slider.disabled) return;

      isDragging = true;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (!isDragging || slider.disabled) return;

      const target = e.currentTarget as HTMLElement;
      const parent = target.parentElement;
      if (!parent) return;

      const rect = parent.getBoundingClientRect();
      const isHorizontal = slider.orientation === 'horizontal';

      let percentage: number;
      if (isHorizontal) {
        percentage = ((e.clientX - rect.left) / rect.width) * 100;
      } else {
        percentage = ((rect.bottom - e.clientY) / rect.height) * 100;
      }

      if (slider.inverted) {
        percentage = 100 - percentage;
      }

      const newValue = slider.min + (percentage / 100) * (slider.max - slider.min);
      slider.setThumbValue(thumbIndex, newValue, false);
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (!isDragging) return;

      isDragging = false;
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);

      // Commit the final value
      slider.setThumbValue(thumbIndex, getValue(), true);
    };

    // Extract component-specific props to avoid spreading them onto DOM
    const {
      children,
      index: _index,
      ...restProps
    } = props;

    const initialValue = getValue();
    const initialStyle = calculateStyle();

    const div = jsx('div', {
      ...restProps,
      role: 'slider',
      'aria-valuemin': slider.min,
      'aria-valuemax': slider.max,
      'aria-valuenow': initialValue,
      'aria-orientation': slider.orientation,
      'aria-disabled': slider.disabled ? 'true' : undefined,
      'data-slider-thumb': '',
      'data-disabled': slider.disabled ? '' : undefined,
      tabIndex: slider.disabled ? -1 : 0,
      style: initialStyle,
      onKeyDown: handleKeyDown,
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerUp,
      children,
    }) as HTMLElement;

    // Set up reactive effect to update ALL context-dependent attributes and style
    effect(() => {
      const currentValue = getValue();
      const newStyle = calculateStyle();

      // Update reactive attributes
      div.setAttribute('aria-valuemin', String(slider.min));
      div.setAttribute('aria-valuemax', String(slider.max));
      div.setAttribute('aria-valuenow', String(currentValue));
      div.setAttribute('aria-orientation', slider.orientation);

      if (slider.disabled) {
        div.setAttribute('aria-disabled', 'true');
        div.setAttribute('data-disabled', '');
        div.setAttribute('tabindex', '-1');
      } else {
        div.removeAttribute('aria-disabled');
        div.removeAttribute('data-disabled');
        div.setAttribute('tabindex', '0');
      }

      Object.assign(div.style, newStyle);
    });

    return div;
  };
});

// Export sub-components
(Slider as any).Track = SliderTrack;
(Slider as any).Range = SliderRange;
(Slider as any).Thumb = SliderThumb;
