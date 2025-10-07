/**
 * Progress Primitive
 *
 * Display progress indicators for tasks, uploads, etc.
 * Supports determinate and indeterminate states.
 *
 * Based on WAI-ARIA progressbar pattern:
 * https://www.w3.org/WAI/ARIA/apg/patterns/meter/
 */

import { defineComponent } from '../core/component/define.js';
import { createContext, useContext } from '../core/component/context.js';
import { jsx } from '../jsx-runtime.js';
import { generateId } from './utils/index.js';

// ============================================================================
// Types
// ============================================================================

export interface ProgressProps {
  /**
   * Current value (0-100)
   */
  value?: number | null;

  /**
   * Maximum value
   * @default 100
   */
  max?: number;

  /**
   * Get value label for screen readers
   */
  getValueLabel?: (value: number, max: number) => string;

  /**
   * Children
   */
  children?: any;

  /**
   * Additional props
   */
  [key: string]: any;
}

export interface ProgressIndicatorProps {
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

export interface ProgressContextValue {
  value: () => number | null;
  max: () => number;
  progressId: string;
}

const noopGetter = () => null;
const maxGetter = () => 100;

export const ProgressContext = createContext<ProgressContextValue>(
  {
    value: noopGetter,
    max: maxGetter,
    progressId: '',
  },
  'Progress'
);

// ============================================================================
// Components
// ============================================================================

/**
 * Progress root component
 *
 * @example
 * ```tsx
 * // Determinate progress
 * <Progress value={progress()}>
 *   <Progress.Indicator />
 * </Progress>
 *
 * // Indeterminate progress (loading)
 * <Progress value={null}>
 *   <Progress.Indicator />
 * </Progress>
 * ```
 */
export const Progress = defineComponent<ProgressProps>((props) => {
  const progressId = generateId('progress');
  const max = () => props.max ?? 100;
  const value = () => {
    if (props.value === null || props.value === undefined) return null;
    // Clamp value between 0 and max
    return Math.max(0, Math.min(props.value, max()));
  };

  const getValueLabel = () => {
    const v = value();
    if (v === null) return undefined;

    if (props.getValueLabel) {
      return props.getValueLabel(v, max());
    }

    return `${Math.round((v / max()) * 100)}%`;
  };

  const contextValue: ProgressContextValue = {
    value,
    max,
    progressId,
  };

  return () =>
    jsx(ProgressContext.Provider, {
      value: contextValue,
      children: jsx('div', {
        ...props,
        id: progressId,
        role: 'progressbar',
        'aria-valuemin': 0,
        'aria-valuemax': max(),
        'aria-valuenow': value(),
        'aria-valuetext': getValueLabel(),
        'data-state': value() === null ? 'indeterminate' : 'determinate',
        'data-value': value(),
        'data-max': max(),
      }),
    });
});

/**
 * Progress Indicator component
 *
 * Visual indicator showing progress.
 * Style based on data-state attribute.
 */
export const ProgressIndicator = defineComponent<ProgressIndicatorProps>((props) => {
  const ctx = useContext(ProgressContext);

  return () => {
    const v = ctx.value();
    const max = ctx.max();

    // Calculate percentage
    const percentage = v === null ? null : (v / max) * 100;

    return jsx('div', {
      ...props,
      'data-progress-indicator': '',
      'data-state': v === null ? 'indeterminate' : 'determinate',
      style: {
        ...props.style,
        // Set transform for visual indicator
        ...(percentage !== null && {
          transform: `translateX(-${100 - percentage}%)`,
        }),
      },
    });
  };
});
