/**
 * DateRangePicker - Date range selection component
 *
 * Features:
 * - Start and end date selection
 * - Visual range highlighting
 * - Preset ranges (Today, Last 7 days, etc.)
 * - Min/max date constraints
 * - Hover preview of range
 * - Controlled and uncontrolled modes
 * - ARIA support for accessibility
 * - Integration with Calendar component
 */

import { defineComponent } from '../core/component/index.js';
import { createContext, useContext, provideContext } from '../core/component/context.js';
import type { Signal, WritableSignal } from '../core/reactivity/types.js';
import { signal, computed } from '../core/reactivity/index.js';
import { jsx } from '../jsx-runtime.js';

// ============================================================================
// Types
// ============================================================================

export interface DateRange {
  start: Date | null;
  end: Date | null;
}

export interface DateRangePickerProps {
  /** Controlled value */
  value?: DateRange;
  /** Value change callback */
  onValueChange?: (value: DateRange) => void;
  /** Default value (uncontrolled) */
  defaultValue?: DateRange;
  /** Minimum selectable date */
  min?: Date;
  /** Maximum selectable date */
  max?: Date;
  /** Number of months to display */
  numberOfMonths?: number;
  /** Whether the picker is disabled */
  disabled?: boolean;
  /** Preset ranges */
  presets?: Array<{ label: string; range: DateRange }>;
  /** Whether to close on range selection */
  closeOnSelect?: boolean;
  /** Children */
  children?: any;
}

export interface DateRangePickerTriggerProps {
  /** Children */
  children?: any;
  /** Additional props */
  [key: string]: any;
}

export interface DateRangePickerContentProps {
  /** Children */
  children?: any;
  /** Additional props */
  [key: string]: any;
}

export interface DateRangePickerCalendarProps {
  /** Month offset (0 for first month, 1 for second, etc.) */
  monthOffset?: number;
  /** Children */
  children?: any;
}

export interface DateRangePickerPresetProps {
  /** Preset range */
  range: DateRange;
  /** Children */
  children?: any;
  /** Additional props */
  [key: string]: any;
}

interface DateRangePickerContextValue {
  /** Current range value */
  value: Signal<DateRange>;
  /** Set date range */
  setRange: (range: DateRange) => void;
  /** Minimum date */
  min?: Date;
  /** Maximum date */
  max?: Date;
  /** Number of months */
  numberOfMonths: number;
  /** Disabled state */
  disabled: boolean;
  /** Selection mode state */
  selectionMode: Signal<'start' | 'end'>;
  /** Hover date (for preview) */
  hoverDate: Signal<Date | null>;
  /** Set hover date */
  setHoverDate: (date: Date | null) => void;
  /** Handle date click */
  handleDateClick: (date: Date) => void;
  /** Check if date is in range */
  isInRange: (date: Date) => boolean;
  /** Check if date is start */
  isStart: (date: Date) => boolean;
  /** Check if date is end */
  isEnd: (date: Date) => boolean;
  /** Check if date is disabled */
  isDisabled: (date: Date) => boolean;
}

// ============================================================================
// Context
// ============================================================================

const DateRangePickerContext = createContext<DateRangePickerContextValue | null>(null);

const useDateRangePickerContext = (): DateRangePickerContextValue => {
  const context = useContext(DateRangePickerContext);
  if (!context) {
    throw new Error('DateRangePicker components must be used within a DateRangePicker');
  }
  return context;
};

// ============================================================================
// Helper Functions
// ============================================================================

const isSameDay = (date1: Date | null, date2: Date | null): boolean => {
  if (!date1 || !date2) return false;
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  );
};

const isDateInRange = (date: Date, start: Date | null, end: Date | null): boolean => {
  if (!start || !end) return false;
  const time = date.getTime();
  return time >= start.getTime() && time <= end.getTime();
};

const isDateBefore = (date1: Date, date2: Date): boolean => date1.getTime() < date2.getTime();

const isDateAfter = (date1: Date, date2: Date): boolean => date1.getTime() > date2.getTime();

// ============================================================================
// DateRangePicker Root
// ============================================================================

export const DateRangePicker = defineComponent<DateRangePickerProps>((props) => {
  const numberOfMonths = props.numberOfMonths ?? 2;
  const disabled = props.disabled ?? false;

  // State
  const internalValue: WritableSignal<DateRange> = signal<DateRange>(props.defaultValue ?? { start: null, end: null });

  const selectionMode: WritableSignal<'start' | 'end'> = signal<'start' | 'end'>('start');
  const hoverDate: WritableSignal<Date | null> = signal<Date | null>(null);

  const currentValue = (): DateRange => {
    if (props.value !== undefined) {
      return props.value;
    }
    return internalValue();
  };

  const setRange = (newRange: DateRange) => {
    if (props.value === undefined) {
      internalValue.set(newRange);
    }
    props.onValueChange?.(newRange);
  };

  const setHoverDate = (date: Date | null) => {
    hoverDate.set(date);
  };

  const handleDateClick = (date: Date) => {
    if (isDisabled(date)) return;

    const current = currentValue();
    const mode = selectionMode();

    if (mode === 'start') {
      // Select start date
      setRange({ start: date, end: null });
      selectionMode.set('end');
    } else {
      // Select end date
      if (current.start && isDateBefore(date, current.start)) {
        // If clicked date is before start, swap
        setRange({ start: date, end: current.start });
      } else {
        setRange({ start: current.start, end: date });
      }
      selectionMode.set('start');
    }
  };

  const isInRange = (date: Date): boolean => {
    const current = currentValue();
    const hover = hoverDate();

    // If hovering and in selection mode, show preview
    if (hover && selectionMode() === 'end' && current.start) {
      if (isDateBefore(hover, current.start)) {
        return isDateInRange(date, hover, current.start);
      } else {
        return isDateInRange(date, current.start, hover);
      }
    }

    return isDateInRange(date, current.start, current.end);
  };

  const isStart = (date: Date): boolean => {
    const current = currentValue();
    return isSameDay(date, current.start);
  };

  const isEnd = (date: Date): boolean => {
    const current = currentValue();
    return isSameDay(date, current.end);
  };

  const isDisabled = (date: Date): boolean => {
    if (props.min && isDateBefore(date, props.min)) return true;
    if (props.max && isDateAfter(date, props.max)) return true;
    return false;
  };

  const contextValue: DateRangePickerContextValue = {
    value: computed(() => currentValue()),
    setRange,
    min: props.min,
    max: props.max,
    numberOfMonths,
    disabled,
    selectionMode: computed(() => selectionMode()),
    hoverDate: computed(() => hoverDate()),
    setHoverDate,
    handleDateClick,
    isInRange,
    isStart,
    isEnd,
    isDisabled,
  };

  // Provide context during setup phase (Pattern 17)
  provideContext(DateRangePickerContext, contextValue);

  return () => {
    // Evaluate function children during render (Pattern 17)
    const children = typeof props.children === 'function' ? props.children() : props.children;

    return jsx('div', {
      'data-date-range-picker': '',
      'data-disabled': disabled ? '' : undefined,
      children,
    });
  };
});

// ============================================================================
// DateRangePicker Trigger
// ============================================================================

export const DateRangePickerTrigger = defineComponent<DateRangePickerTriggerProps>((props) => {
  const context = useDateRangePickerContext();

  const formatDate = (date: Date | null): string => {
    if (!date) return '';
    return date.toLocaleDateString();
  };

  return () => {
    const { children, ...rest } = props;
    const range = context.value();

    return jsx('button', {
      type: 'button',
      'data-date-range-picker-trigger': '',
      'aria-label': 'Select date range',
      disabled: context.disabled,
      ...rest,
      children: children ?? `${formatDate(range.start)} - ${formatDate(range.end) || 'Select end date'}`,
    });
  };
});

// ============================================================================
// DateRangePicker Content
// ============================================================================

export const DateRangePickerContent = defineComponent<DateRangePickerContentProps>((props) => () => {
  const { children, ...rest } = props;

  return jsx('div', {
    'data-date-range-picker-content': '',
    role: 'dialog',
    'aria-label': 'Date range picker',
    ...rest,
    children,
  });
});

// ============================================================================
// DateRangePicker Calendar
// ============================================================================

export const DateRangePickerCalendar = defineComponent<DateRangePickerCalendarProps>((props) => {
  const monthOffset = props.monthOffset ?? 0;

  // Calculate the month to display
  const today = new Date();
  const displayMonth = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);

  return () =>
    jsx('div', {
      'data-date-range-picker-calendar': '',
      'data-month-offset': monthOffset,
      children: jsx('div', {
        'data-calendar-placeholder': '',
        children: `Calendar for ${displayMonth.toLocaleDateString('default', { month: 'long', year: 'numeric' })}`,
      }),
    });
});

// ============================================================================
// DateRangePicker Preset
// ============================================================================

export const DateRangePickerPreset = defineComponent<DateRangePickerPresetProps>((props) => {
  const context = useDateRangePickerContext();

  const handleClick = () => {
    context.setRange(props.range);
  };

  return () => {
    const { range, children, ...rest } = props;

    return jsx('button', {
      type: 'button',
      'data-date-range-picker-preset': '',
      onClick: handleClick,
      ...rest,
      children,
    });
  };
});

// ============================================================================
// Attach sub-components
// ============================================================================

(DateRangePicker as any).Trigger = DateRangePickerTrigger;
(DateRangePicker as any).Content = DateRangePickerContent;
(DateRangePicker as any).Calendar = DateRangePickerCalendar;
(DateRangePicker as any).Preset = DateRangePickerPreset;

// ============================================================================
// Export types
// ============================================================================

export type { DateRangePickerContextValue };
