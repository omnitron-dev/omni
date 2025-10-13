/**
 * DatePicker Primitive
 *
 * A date input with calendar popup using Popover.
 * Wraps the Calendar component for date selection.
 *
 * @example
 * ```tsx
 * const date = signal<Date | null>(null);
 *
 * <DatePicker value={date()} onValueChange={date}>
 *   <DatePicker.Trigger>
 *     <DatePicker.Icon>📅</DatePicker.Icon>
 *     <DatePicker.Value placeholder="Pick a date">
 *       {(d) => d?.toLocaleDateString()}
 *     </DatePicker.Value>
 *   </DatePicker.Trigger>
 *   <DatePicker.Content>
 *     <DatePicker.Calendar>
 *       <Calendar.Header>
 *         <Calendar.PrevButton>←</Calendar.PrevButton>
 *         <Calendar.Heading />
 *         <Calendar.NextButton>→</Calendar.NextButton>
 *       </Calendar.Header>
 *       <Calendar.Grid>
 *         <Calendar.GridHead>
 *           <Calendar.HeadCell>Su</Calendar.HeadCell>
 *           // ... other days
 *         </Calendar.GridHead>
 *         <Calendar.GridBody />
 *       </Calendar.Grid>
 *     </DatePicker.Calendar>
 *   </DatePicker.Content>
 * </DatePicker>
 * ```
 */

import { defineComponent } from '../core/component/index.js';
import { createContext, useContext, provideContext } from '../core/component/context.js';
import { signal, computed, type WritableSignal, type Signal } from '../core/reactivity/index.js';
import { jsx } from '../jsx-runtime.js';
import { Popover, PopoverContext } from './Popover.js';
import { Calendar } from './Calendar.js';
import { useControlledState } from '../utils/controlled-state.js';

// ============================================================================
// Types
// ============================================================================

export interface DatePickerProps {
  children?: any;
  /**
   * Selected date
   * Pattern 19: Controlled state - accepts WritableSignal or plain value
   */
  value?: WritableSignal<Date | null> | Date | null;
  /** Callback when date changes */
  onValueChange?: (date: Date | null) => void;
  /** Default value (uncontrolled) */
  defaultValue?: Date | null;
  /** Default open state */
  defaultOpen?: boolean;
  /** Default month to display */
  defaultMonth?: Date;
  /** Minimum selectable date */
  minDate?: Date;
  /** Maximum selectable date */
  maxDate?: Date;
  /** Function to determine if a date is disabled */
  isDateDisabled?: (date: Date) => boolean;
  /** Whether the datepicker is disabled */
  disabled?: boolean;
  /** Week starts on (0 = Sunday, 1 = Monday) */
  weekStartsOn?: 0 | 1;
  [key: string]: any;
}

export interface DatePickerTriggerProps {
  children?: any;
  [key: string]: any;
}

export interface DatePickerValueProps {
  children?: any | ((date: Date | null) => any);
  /** Placeholder text when no date is selected */
  placeholder?: string;
  [key: string]: any;
}

export interface DatePickerIconProps {
  children?: any;
  [key: string]: any;
}

export interface DatePickerContentProps {
  children?: any;
  [key: string]: any;
}

export interface DatePickerCalendarProps {
  children?: any;
  [key: string]: any;
}

interface DatePickerContextValue {
  value: Signal<Date | null>;
  open: WritableSignal<boolean>;
  disabled: boolean;
  minDate?: Date;
  maxDate?: Date;
  isDateDisabled?: (date: Date) => boolean;
  weekStartsOn: 0 | 1;
  defaultMonth: Date;
  setValue: (date: Date | null) => void;
  setOpen: (open: boolean) => void;
}

// ============================================================================
// Context
// ============================================================================

const DatePickerContext = createContext<DatePickerContextValue | undefined>(undefined);

function useDatePickerContext(): DatePickerContextValue {
  const context = useContext(DatePickerContext);
  if (!context) {
    throw new Error('DatePicker components must be used within a DatePicker component');
  }
  return context;
}

// ============================================================================
// Components
// ============================================================================

/**
 * DatePicker Root
 * Container with state management
 */
export const DatePicker = defineComponent<DatePickerProps>((props) => {
  // Pattern 19: Use controlled state helper for signal/value normalization
  const [getValue, setValue] = useControlledState<Date | null>(
    props.value,
    props.defaultValue ?? null,
    props.onValueChange
  );

  // Wrap setValue to create new Date instance for reactivity
  const setValueWithDateCopy = (date: Date | null) => {
    // Create new Date instance to trigger reactivity
    setValue(date ? new Date(date) : null);
    // Note: popover closing is handled in DatePickerCalendar
  };

  // Calculate defaultMonth safely
  const getDefaultMonth = (): Date => {
    if (props.defaultMonth) return props.defaultMonth;

    const currentValue = getValue();
    if (currentValue) return currentValue;

    return new Date();
  };

  const contextValue: DatePickerContextValue = {
    value: computed(() => getValue()),
    open: signal(false), // Not used, Popover manages its own state
    disabled: props.disabled ?? false,
    minDate: props.minDate,
    maxDate: props.maxDate,
    isDateDisabled: props.isDateDisabled,
    weekStartsOn: props.weekStartsOn ?? 0,
    defaultMonth: getDefaultMonth(),
    setValue: setValueWithDateCopy,
    setOpen: () => {}, // Not used, Popover manages its own state
  };

  // Provide context during setup phase (Pattern 17)
  provideContext(DatePickerContext, contextValue);

  return () => 
    // Don't evaluate children here - pass directly to Popover
    // so Popover can evaluate them AFTER providing PopoverContext (Pattern 17)
     jsx(Popover, {
      defaultOpen: props.defaultOpen,
      children: props.children,  // Pass function through, don't evaluate!
    })
  ;
});

/**
 * DatePicker Trigger
 * Button to open the calendar popover
 */
export const DatePickerTrigger = defineComponent<DatePickerTriggerProps>((props) => () => {
  const context = useDatePickerContext();
  const { children, ...restProps } = props;

  return jsx((Popover as any).Trigger, {
    ...restProps,
    'data-datepicker-trigger': '',
    disabled: context.disabled,
    asChild: false,
    children,
  });
});

/**
 * DatePicker Value
 * Displays the selected date or placeholder
 */
export const DatePickerValue = defineComponent<DatePickerValueProps>((props) => () => {
  const context = useDatePickerContext();
  const { children, placeholder, ...restProps } = props;
  const date = context.value();

  let content: any;

  if (typeof children === 'function') {
    content = children(date);
  } else if (children) {
    content = children;
  } else if (date) {
    content = date.toLocaleDateString();
  } else {
    content = placeholder ?? 'Pick a date';
  }

  return jsx('span', {
    ...restProps,
    'data-datepicker-value': '',
    'data-placeholder': !date ? '' : undefined,
    children: content,
  });
});

/**
 * DatePicker Icon
 * Icon next to the value (usually calendar icon)
 */
export const DatePickerIcon = defineComponent<DatePickerIconProps>((props) => () => {
  const { children, ...restProps } = props;

  return jsx('span', {
    ...restProps,
    'data-datepicker-icon': '',
    'aria-hidden': 'true',
    children,
  });
});

/**
 * DatePicker Content
 * Popover content containing the calendar
 */
export const DatePickerContent = defineComponent<DatePickerContentProps>((props) => {
  const popoverContext = useContext(PopoverContext);

  // Capture props in setup phase
  const { children, ...restProps } = props;

  return () => {
    // Only render when popover is open
    if (!popoverContext.isOpen()) {
      return null;
    }

    // Evaluate function children in render phase (Pattern 17)
    const evaluatedChildren = typeof children === 'function' ? children() : children;

    // DEBUG: Render without Portal to test if Portal is the issue
    return jsx('div', {
      ...restProps,
      id: popoverContext.contentId,
      role: 'dialog',
      'aria-modal': 'false',
      'data-datepicker-content': '',
      tabIndex: -1,
      children: evaluatedChildren,
    });
  };
});

/**
 * DatePicker Calendar
 * Embedded Calendar component with datepicker integration
 */
export const DatePickerCalendar = defineComponent<DatePickerCalendarProps>((props) => {
  const context = useDatePickerContext();
  const popoverContext = useContext(PopoverContext);

  // Wrap setValue to also close the popover
  const handleValueChange = (date: Date | null) => {
    context.setValue(date);
    // Close popover after date selection
    popoverContext.close();
  };

  return () => {
    const { children } = props;

    return jsx(Calendar, {
      value: context.value(),
      onValueChange: handleValueChange,
      defaultMonth: context.defaultMonth,
      minDate: context.minDate,
      maxDate: context.maxDate,
      isDateDisabled: context.isDateDisabled,
      disabled: context.disabled,
      weekStartsOn: context.weekStartsOn,
      children,
    });
  };
});

// ============================================================================
// Attach sub-components
// ============================================================================

(DatePicker as any).Trigger = DatePickerTrigger;
(DatePicker as any).Value = DatePickerValue;
(DatePicker as any).Icon = DatePickerIcon;
(DatePicker as any).Content = DatePickerContent;
(DatePicker as any).Calendar = DatePickerCalendar;

// ============================================================================
// Type augmentation for sub-components
// ============================================================================

export interface DatePickerComponent {
  (props: DatePickerProps): any;
  Trigger: typeof DatePickerTrigger;
  Value: typeof DatePickerValue;
  Icon: typeof DatePickerIcon;
  Content: typeof DatePickerContent;
  Calendar: typeof DatePickerCalendar;
  [key: string]: any;
}
