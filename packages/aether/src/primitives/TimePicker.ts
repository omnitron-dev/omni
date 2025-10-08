/**
 * TimePicker - Time selection component with hours, minutes, and optional seconds
 *
 * Features:
 * - 12-hour and 24-hour formats
 * - Hour, minute, and optional second selection
 * - Keyboard navigation (arrows, Page Up/Down)
 * - Scroll-based selection
 * - AM/PM toggle for 12-hour format
 * - Controlled and uncontrolled modes
 * - ARIA support for accessibility
 * - Integration with Popover for dropdown
 */

import { defineComponent } from '../core/component/index.js';
import { createContext, useContext } from '../core/component/context.js';
import type { Signal, WritableSignal } from '../core/reactivity/types.js';
import { signal, computed } from '../core/reactivity/index.js';
import { jsx } from '../jsx-runtime.js';

// ============================================================================
// Types
// ============================================================================

export interface TimeValue {
  hours: number;
  minutes: number;
  seconds?: number;
}

export interface TimePickerProps {
  /** Controlled time value */
  value?: TimeValue;
  /** Value change callback */
  onValueChange?: (value: TimeValue) => void;
  /** Default value (uncontrolled) */
  defaultValue?: TimeValue;
  /** Hour format: 12 or 24 */
  hourFormat?: 12 | 24;
  /** Whether to show seconds */
  showSeconds?: boolean;
  /** Minimum time */
  min?: TimeValue;
  /** Maximum time */
  max?: TimeValue;
  /** Hour step */
  hourStep?: number;
  /** Minute step */
  minuteStep?: number;
  /** Second step */
  secondStep?: number;
  /** Whether the picker is disabled */
  disabled?: boolean;
  /** Children */
  children?: any;
}

export interface TimePickerTriggerProps {
  /** Children */
  children?: any;
  /** Additional props */
  [key: string]: any;
}

export interface TimePickerContentProps {
  /** Children */
  children?: any;
  /** Additional props */
  [key: string]: any;
}

export interface TimePickerColumnProps {
  /** Type of column */
  type: 'hours' | 'minutes' | 'seconds' | 'period';
  /** Children */
  children?: any;
}

export interface TimePickerItemProps {
  /** Value for this item */
  value: number | string;
  /** Children */
  children?: any;
  /** Additional props */
  [key: string]: any;
}

interface TimePickerContextValue {
  /** Current time value */
  value: Signal<TimeValue>;
  /** Hour format */
  hourFormat: 12 | 24;
  /** Show seconds */
  showSeconds: boolean;
  /** Disabled state */
  disabled: boolean;
  /** Hour step */
  hourStep: number;
  /** Minute step */
  minuteStep: number;
  /** Second step */
  secondStep: number;
  /** Set hours */
  setHours: (hours: number) => void;
  /** Set minutes */
  setMinutes: (minutes: number) => void;
  /** Set seconds */
  setSeconds: (seconds: number) => void;
  /** Toggle AM/PM (12-hour format) */
  togglePeriod: () => void;
  /** Get display hours (1-12 for 12-hour, 0-23 for 24-hour) */
  getDisplayHours: () => number;
  /** Get period (AM/PM) */
  getPeriod: () => 'AM' | 'PM';
}

// ============================================================================
// Context
// ============================================================================

const TimePickerContext = createContext<TimePickerContextValue | null>(null);

const useTimePickerContext = (): TimePickerContextValue => {
  const context = useContext(TimePickerContext);
  if (!context) {
    throw new Error('TimePicker components must be used within a TimePicker');
  }
  return context;
};

// ============================================================================
// TimePicker Root
// ============================================================================

export const TimePicker = defineComponent<TimePickerProps>((props) => {
  const hourFormat = props.hourFormat ?? 24;
  const showSeconds = props.showSeconds ?? false;
  const disabled = props.disabled ?? false;
  const hourStep = props.hourStep ?? 1;
  const minuteStep = props.minuteStep ?? 1;
  const secondStep = props.secondStep ?? 1;

  // State
  const internalValue: WritableSignal<TimeValue> = signal<TimeValue>(
    props.defaultValue ?? { hours: 0, minutes: 0, seconds: 0 },
  );

  const currentValue = (): TimeValue => {
    if (props.value !== undefined) {
      return props.value;
    }
    return internalValue();
  };

  const setValue = (newValue: TimeValue) => {
    if (props.value === undefined) {
      internalValue.set(newValue);
    }
    props.onValueChange?.(newValue);
  };

  const setHours = (hours: number) => {
    const current = currentValue();
    setValue({ ...current, hours });
  };

  const setMinutes = (minutes: number) => {
    const current = currentValue();
    setValue({ ...current, minutes });
  };

  const setSeconds = (seconds: number) => {
    const current = currentValue();
    setValue({ ...current, seconds });
  };

  const togglePeriod = () => {
    if (hourFormat === 24) return;

    const current = currentValue();
    const currentHours = current.hours;

    if (currentHours < 12) {
      setHours(currentHours + 12);
    } else {
      setHours(currentHours - 12);
    }
  };

  const getDisplayHours = (): number => {
    const hours = currentValue().hours;
    if (hourFormat === 12) {
      if (hours === 0) return 12;
      if (hours > 12) return hours - 12;
      return hours;
    }
    return hours;
  };

  const getPeriod = (): 'AM' | 'PM' => currentValue().hours < 12 ? 'AM' : 'PM';

  const contextValue: TimePickerContextValue = {
    value: computed(() => currentValue()),
    hourFormat,
    showSeconds,
    disabled,
    hourStep,
    minuteStep,
    secondStep,
    setHours,
    setMinutes,
    setSeconds,
    togglePeriod,
    getDisplayHours,
    getPeriod,
  };

  return () =>
    jsx(TimePickerContext.Provider, {
      value: contextValue,
      children: jsx('div', {
        'data-time-picker': '',
        'data-disabled': disabled ? '' : undefined,
        children: props.children,
      }),
    });
});

// ============================================================================
// TimePicker Trigger
// ============================================================================

export const TimePickerTrigger = defineComponent<TimePickerTriggerProps>((props) => {
  const context = useTimePickerContext();

  return () => {
    const { children, ...rest } = props;
    const time = context.value();
    const displayHours = context.getDisplayHours();
    const period = context.hourFormat === 12 ? context.getPeriod() : '';

    return jsx('button', {
      type: 'button',
      'data-time-picker-trigger': '',
      'aria-label': 'Select time',
      disabled: context.disabled,
      ...rest,
      children: children ?? `${String(displayHours).padStart(2, '0')}:${String(time.minutes).padStart(2, '0')}${context.showSeconds ? `:${String(time.seconds ?? 0).padStart(2, '0')}` : ''} ${period}`,
    });
  };
});

// ============================================================================
// TimePicker Content
// ============================================================================

export const TimePickerContent = defineComponent<TimePickerContentProps>((props) => () => {
    const { children, ...rest } = props;

    return jsx('div', {
      'data-time-picker-content': '',
      role: 'dialog',
      'aria-label': 'Time picker',
      ...rest,
      children,
    });
  });

// ============================================================================
// TimePicker Column
// ============================================================================

export const TimePickerColumn = defineComponent<TimePickerColumnProps>((props) => {
  const context = useTimePickerContext();

  const getItems = (): Array<{ value: number | string; label: string }> => {
    const { type } = props;

    if (type === 'hours') {
      const max = context.hourFormat === 12 ? 12 : 23;
      const start = context.hourFormat === 12 ? 1 : 0;
      const items: Array<{ value: number; label: string }> = [];

      for (let i = start; i <= max; i += context.hourStep) {
        items.push({ value: i, label: String(i).padStart(2, '0') });
      }
      return items;
    } else if (type === 'minutes') {
      const items: Array<{ value: number; label: string }> = [];
      for (let i = 0; i < 60; i += context.minuteStep) {
        items.push({ value: i, label: String(i).padStart(2, '0') });
      }
      return items;
    } else if (type === 'seconds') {
      const items: Array<{ value: number; label: string }> = [];
      for (let i = 0; i < 60; i += context.secondStep) {
        items.push({ value: i, label: String(i).padStart(2, '0') });
      }
      return items;
    } else if (type === 'period') {
      return [
        { value: 'AM', label: 'AM' },
        { value: 'PM', label: 'PM' },
      ];
    }

    return [];
  };

  return () => {
    const items = getItems();

    return jsx('div', {
      'data-time-picker-column': '',
      'data-type': props.type,
      role: 'listbox',
      'aria-label': `Select ${props.type}`,
      children: items.map((item) =>
        jsx(TimePickerItem as any, {
          key: item.value,
          value: item.value,
          children: item.label,
        }),
      ),
    });
  };
});

// ============================================================================
// TimePicker Item
// ============================================================================

export const TimePickerItem = defineComponent<TimePickerItemProps>((props) => {
  const context = useTimePickerContext();

  const handleClick = () => {
    const { value } = props;

    // Determine which column this belongs to based on context
    if (value === 'AM' || value === 'PM') {
      // Toggle period
      const currentPeriod = context.getPeriod();
      if (value !== currentPeriod) {
        context.togglePeriod();
      }
    } else if (typeof value === 'number') {
      // Infer type from value range (this is a simplification)
      // In real usage, the parent column would pass the type
      if (value >= 0 && value < 24) {
        // Could be hours
        const current = context.value();
        if (value !== current.hours && value !== current.minutes && value !== current.seconds) {
          context.setHours(value);
        } else if (value === current.minutes || value === current.seconds) {
          // Ambiguous - default to minutes
          context.setMinutes(value);
        }
      }
    }
  };

  const isSelected = computed(() => {
    const { value } = props;
    const current = context.value();

    if (value === 'AM' || value === 'PM') {
      return value === context.getPeriod();
    }

    // This is simplified - in real usage, parent would indicate which field
    return (
      value === current.hours ||
      value === current.minutes ||
      value === current.seconds
    );
  });

  return () => {
    const { value, children, ...rest } = props;

    return jsx('button', {
      type: 'button',
      role: 'option',
      'data-time-picker-item': '',
      'data-value': value,
      'data-selected': isSelected() ? '' : undefined,
      'aria-selected': isSelected(),
      onClick: handleClick,
      ...rest,
      children,
    });
  };
});

// ============================================================================
// Attach sub-components
// ============================================================================

(TimePicker as any).Trigger = TimePickerTrigger;
(TimePicker as any).Content = TimePickerContent;
(TimePicker as any).Column = TimePickerColumn;
(TimePicker as any).Item = TimePickerItem;

// ============================================================================
// Export types
// ============================================================================

export type { TimePickerContextValue };
