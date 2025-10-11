/**
 * Rating Primitive
 *
 * A rating component for displaying and capturing user ratings.
 * Supports half ratings, read-only mode, and custom icons.
 *
 * @example
 * ```tsx
 * const rating = signal(3.5);
 *
 * <Rating value={rating()} onValueChange={rating} max={5}>
 *   {(index, filled) => (
 *     <Rating.Item index={index}>
 *       {filled ? '★' : '☆'}
 *     </Rating.Item>
 *   )}
 * </Rating>
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

export interface RatingProps {
  children?: any;
  /** Current rating value */
  value?: number;
  /** Callback when rating changes */
  onValueChange?: (value: number) => void;
  /** Default value (uncontrolled) */
  defaultValue?: number;
  /** Maximum rating */
  max?: number;
  /** Allow half ratings */
  allowHalf?: boolean;
  /** Read-only mode */
  readOnly?: boolean;
  /** Disabled state */
  disabled?: boolean;
  [key: string]: any;
}

export interface RatingItemProps {
  children?: any;
  /** Item index (1-based) */
  index: number;
  [key: string]: any;
}

interface RatingContextValue {
  value: Signal<number>;
  hoverValue: Signal<number>;
  max: number;
  allowHalf: boolean;
  readOnly: boolean;
  disabled: boolean;
  setValue: (value: number) => void;
  setHoverValue: (value: number) => void;
  isFilled: (index: number) => boolean;
  isHalfFilled: (index: number) => boolean;
}

// ============================================================================
// Context
// ============================================================================

const RatingContext = createContext<RatingContextValue | undefined>(undefined);

function useRatingContext(): RatingContextValue {
  const context = useContext(RatingContext);
  if (!context) {
    throw new Error('Rating components must be used within Rating');
  }
  return context;
}

// ============================================================================
// Components
// ============================================================================

/**
 * Rating Root
 */
export const Rating = defineComponent<RatingProps>((props) => {
  const internalValue: WritableSignal<number> = signal<number>(props.defaultValue ?? 0);
  const hoverValue: WritableSignal<number> = signal<number>(0);

  const isControlled = () => props.value !== undefined;
  const currentValue = () => (isControlled() ? props.value ?? 0 : internalValue());

  const setValue = (value: number) => {
    if (props.readOnly || props.disabled) return;

    const max = props.max ?? 5;
    const newValue = Math.max(0, Math.min(value, max));

    if (!isControlled()) {
      internalValue.set(newValue);
    }
    props.onValueChange?.(newValue);
  };

  const setHoverValue = (value: number) => {
    if (!props.readOnly && !props.disabled) {
      hoverValue.set(value);
    }
  };

  const isFilled = (index: number) => {
    const displayValue = hoverValue() || currentValue();
    return index <= displayValue;
  };

  const isHalfFilled = (index: number): boolean => {
    const displayValue = hoverValue() || currentValue();
    return !!(props.allowHalf && index - 0.5 === displayValue);
  };

  const contextValue: RatingContextValue = {
    value: computed(() => currentValue()),
    hoverValue: computed(() => hoverValue()),
    max: props.max ?? 5,
    allowHalf: props.allowHalf ?? false,
    readOnly: props.readOnly ?? false,
    disabled: props.disabled ?? false,
    setValue,
    setHoverValue,
    isFilled,
    isHalfFilled,
  };

  // SETUP PHASE: Provide context
  provideContext(RatingContext, contextValue);

  const handleMouseLeave = () => {
    setHoverValue(0);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (props.readOnly || props.disabled) return;

    const current = currentValue();
    const step = props.allowHalf ? 0.5 : 1;
    const max = props.max ?? 5;

    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      setValue(Math.min(current + step, max));
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      setValue(Math.max(current - step, 0));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setValue(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setValue(max);
    }
  };

  // Set up ref callback for reactive attribute updates
  const refCallback = (element: HTMLDivElement | null) => {
    if (!element) return;

    // Set up effect to update ARIA attributes when value changes
    effect(() => {
      element.setAttribute('aria-valuenow', String(currentValue()));
    });
  };

  return () => {
    const { max = 5 } = props;

    // RENDER PHASE: Evaluate function children
    let content;

    if (typeof props.children === 'function') {
      // Check if it's a generator function (takes index/filled) or simple wrapper
      const firstArg = props.children.length;

      if (firstArg === 0) {
        // Simple wrapper function like () => RatingItem(...)
        content = props.children();
      } else {
        // Generator function like (index, filled) => RatingItem(...)
        const items = [];
        for (let i = 1; i <= max; i++) {
          const filled = isFilled(i);
          items.push(props.children(i, filled));
        }
        content = items;
      }
    } else {
      content = props.children;
    }

    return jsx('div', {
      ref: refCallback,
      'data-rating': '',
      'data-readonly': props.readOnly ? '' : undefined,
      'data-disabled': props.disabled ? '' : undefined,
      role: 'slider',
      'aria-label': 'Rating',
      'aria-valuenow': currentValue(),
      'aria-valuemin': 0,
      'aria-valuemax': max,
      'aria-readonly': props.readOnly ? 'true' : undefined,
      'aria-disabled': props.disabled ? 'true' : undefined,
      tabIndex: props.readOnly || props.disabled ? undefined : 0,
      onMouseLeave: handleMouseLeave,
      onKeyDown: handleKeyDown,
      children: content,
    });
  };
});

/**
 * Rating Item
 * Individual rating item (star, heart, etc.)
 */
export const RatingItem = defineComponent<RatingItemProps>((props) => {
  const context = useRatingContext();

  const handleClick = (e: MouseEvent) => {
    if (context.readOnly || context.disabled) return;

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const half = rect.width / 2;

    let value = props.index;
    if (context.allowHalf && x < half) {
      value = props.index - 0.5;
    }

    context.setValue(value);
    props.onClick?.(e);
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (context.readOnly || context.disabled) return;

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const half = rect.width / 2;

    let value = props.index;
    if (context.allowHalf && x < half) {
      value = props.index - 0.5;
    }

    context.setHoverValue(value);
    props.onMouseMove?.(e);
  };

  return () => {
    const { children, index, ...restProps } = props;
    const filled = context.isFilled(index);
    const halfFilled = context.isHalfFilled(index);

    return jsx('span', {
      ...restProps,
      'data-rating-item': '',
      'data-index': index,
      'data-filled': filled ? '' : undefined,
      'data-half-filled': halfFilled ? '' : undefined,
      onClick: handleClick,
      onMouseMove: handleMouseMove,
      children,
    });
  };
});

// ============================================================================
// Attach sub-components
// ============================================================================

(Rating as any).Item = RatingItem;

// ============================================================================
// Type augmentation
// ============================================================================

export interface RatingComponent {
  (props: RatingProps): any;
  Item: typeof RatingItem;
}
