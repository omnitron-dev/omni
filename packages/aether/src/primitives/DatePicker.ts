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
import { Popover } from './Popover.js';
import { Calendar } from './Calendar.js';

// ============================================================================
// Types
// ============================================================================

export interface DatePickerProps {
  children?: any;
  /** Selected date */
  value?: Date | null;
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

export interface DatePickerTriggerProps
   {
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

export interface DatePickerContentProps
   {
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
  const internalValue: WritableSignal<Date | null> = signal(
    props.value ?? props.defaultValue ?? null,
  );
  const internalOpen: WritableSignal<boolean> = signal(props.defaultOpen ?? false);

  const isControlled = () => props.value !== undefined;
  const currentValue = () => (isControlled() ? props.value ?? null : internalValue());

  const setValue = (date: Date | null) => {
    if (!isControlled()) {
      internalValue.set(date);
    }
    props.onValueChange?.(date);
    // Close popover after selection
    setOpen(false);
  };

  const setOpen = (open: boolean) => {
    if (!props.disabled) {
      internalOpen.set(open);
    }
  };

  const contextValue: DatePickerContextValue = {
    value: computed(() => currentValue()),
    open: internalOpen,
    disabled: props.disabled ?? false,
    minDate: props.minDate,
    maxDate: props.maxDate,
    isDateDisabled: props.isDateDisabled,
    weekStartsOn: props.weekStartsOn ?? 0,
    defaultMonth: props.defaultMonth ?? props.value ?? props.defaultValue ?? new Date(),
    setValue,
    setOpen,
  };

  // Provide context during setup phase (Pattern 17)
  provideContext(DatePickerContext, contextValue);

  return () => {
    // Evaluate function children during render (Pattern 17)
    const children = typeof props.children === 'function' ? props.children() : props.children;

    return jsx(Popover, {
      open: internalOpen(),
      onOpenChange: setOpen,
      children,
    });
  };
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
export const DatePickerContent = defineComponent<DatePickerContentProps>((props) => () => {
  const { children, ...restProps } = props;

  return jsx((Popover as any).Content, {
    ...restProps,
    'data-datepicker-content': '',
    children,
  });
});

/**
 * DatePicker Calendar
 * Embedded Calendar component with datepicker integration
 */
export const DatePickerCalendar = defineComponent<DatePickerCalendarProps>((props) => {
  const context = useDatePickerContext();

  return () => {
    const { children } = props;

    return jsx(Calendar, {
      value: context.value(),
      onValueChange: context.setValue,
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
