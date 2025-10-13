/**
 * Calendar Primitive
 *
 * A standalone calendar component with month navigation and date selection.
 * Can be used independently or within DatePicker.
 *
 * @example
 * ```tsx
 * const selected = signal<Date>(new Date());
 *
 * <Calendar value={selected()} onValueChange={selected}>
 *   <Calendar.Header>
 *     <Calendar.PrevButton>←</Calendar.PrevButton>
 *     <Calendar.Heading />
 *     <Calendar.NextButton>→</Calendar.NextButton>
 *   </Calendar.Header>
 *   <Calendar.Grid>
 *     <Calendar.GridHead>
 *       <Calendar.HeadCell>Su</Calendar.HeadCell>
 *       <Calendar.HeadCell>Mo</Calendar.HeadCell>
 *       // ... other days
 *     </Calendar.GridHead>
 *     <Calendar.GridBody />
 *   </Calendar.Grid>
 * </Calendar>
 * ```
 */

import { defineComponent } from '../core/component/index.js';
import { createContext, useContext, provideContext } from '../core/component/context.js';
import { signal, computed, effect, type WritableSignal, type Signal } from '../core/reactivity/index.js';
import { jsx } from '../jsx-runtime.js';
import { useControlledState } from '../utils/controlled-state.js';

// ============================================================================
// Types
// ============================================================================

export interface CalendarProps {
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
  /** Default month to display */
  defaultMonth?: Date;
  /** Minimum selectable date */
  minDate?: Date;
  /** Maximum selectable date */
  maxDate?: Date;
  /** Function to determine if a date is disabled */
  isDateDisabled?: (date: Date) => boolean;
  /** Whether the calendar is disabled */
  disabled?: boolean;
  /** Week starts on (0 = Sunday, 1 = Monday) */
  weekStartsOn?: 0 | 1;
  [key: string]: any;
}

export interface CalendarHeaderProps {
  children?: any;
  [key: string]: any;
}

export interface CalendarPrevButtonProps {
  children?: any;
  [key: string]: any;
}

export interface CalendarNextButtonProps {
  children?: any;
  [key: string]: any;
}

export interface CalendarHeadingProps {
  children?: any;
  [key: string]: any;
}

export interface CalendarGridProps {
  children?: any;
  [key: string]: any;
}

export interface CalendarGridHeadProps {
  children?: any;
  [key: string]: any;
}

export interface CalendarHeadCellProps {
  children?: any;
  [key: string]: any;
}

export interface CalendarGridBodyProps {
  children?: any;
  [key: string]: any;
}

export interface CalendarCellProps {
  children?: any;
  date: Date;
  [key: string]: any;
}

interface DayInfo {
  date: Date;
  isCurrentMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  isDisabled: boolean;
}

interface CalendarContextValue {
  value: Signal<Date | null>;
  currentMonth: WritableSignal<Date>;
  minDate?: Date;
  maxDate?: Date;
  isDateDisabled?: (date: Date) => boolean;
  disabled: boolean;
  weekStartsOn: 0 | 1;
  monthName: Signal<string>;
  year: Signal<number>;
  days: Signal<DayInfo[]>;
  setValue: (date: Date | null) => void;
  goToPrevMonth: () => void;
  goToNextMonth: () => void;
  selectDate: (date: Date) => void;
  isDateSelected: (date: Date) => boolean;
  isDateInCurrentMonth: (date: Date) => boolean;
  isToday: (date: Date) => boolean;
}

// ============================================================================
// Context
// ============================================================================

const CalendarContext = createContext<CalendarContextValue | undefined>(undefined);

function useCalendarContext(): CalendarContextValue {
  const context = useContext(CalendarContext);
  if (!context) {
    throw new Error('Calendar components must be used within a Calendar component');
  }
  return context;
}

// ============================================================================
// Date Utilities
// ============================================================================

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function isSameDay(date1: Date, date2: Date): boolean {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  );
}

function isSameMonth(date1: Date, date2: Date): boolean {
  return date1.getFullYear() === date2.getFullYear() && date1.getMonth() === date2.getMonth();
}

function addMonths(date: Date, months: number): Date {
  const newDate = new Date(date);
  newDate.setMonth(newDate.getMonth() + months);
  return newDate;
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function generateCalendarDays(
  year: number,
  month: number,
  weekStartsOn: 0 | 1
): { date: Date; isCurrentMonth: boolean }[] {
  const days: { date: Date; isCurrentMonth: boolean }[] = [];
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();

  // Get the day of week for the first day of the month
  let firstDayOfWeek = firstDay.getDay();
  if (weekStartsOn === 1) {
    firstDayOfWeek = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1;
  }

  // Add days from previous month
  const prevMonthYear = month === 0 ? year - 1 : year;
  const prevMonth = month === 0 ? 11 : month - 1;
  const daysInPrevMonth = getDaysInMonth(prevMonthYear, prevMonth);

  for (let i = firstDayOfWeek - 1; i >= 0; i--) {
    const day = daysInPrevMonth - i;
    days.push({
      date: new Date(prevMonthYear, prevMonth, day),
      isCurrentMonth: false,
    });
  }

  // Add days from current month
  for (let day = 1; day <= daysInMonth; day++) {
    days.push({
      date: new Date(year, month, day),
      isCurrentMonth: true,
    });
  }

  // Add days from next month to complete the grid (6 weeks = 42 days)
  const remainingDays = 42 - days.length;
  const nextMonthYear = month === 11 ? year + 1 : year;
  const nextMonth = month === 11 ? 0 : month + 1;

  for (let day = 1; day <= remainingDays; day++) {
    days.push({
      date: new Date(nextMonthYear, nextMonth, day),
      isCurrentMonth: false,
    });
  }

  return days;
}

// ============================================================================
// Components
// ============================================================================

/**
 * Calendar Root
 * Container with state management and date logic
 */
export const Calendar = defineComponent<CalendarProps>((props) => {
  // Pattern 19: Use controlled state helper for signal/value normalization
  const [getValue, setValue] = useControlledState<Date | null>(
    props.value,
    props.defaultValue ?? null,
    props.onValueChange
  );

  // Calculate defaultMonth safely
  const getDefaultMonth = (): Date => {
    if (props.defaultMonth) return props.defaultMonth;

    const currentValue = getValue();
    if (currentValue) return currentValue;

    return new Date();
  };

  const currentMonth: WritableSignal<Date> = signal<Date>(getDefaultMonth());

  const goToPrevMonth = () => {
    currentMonth.set(addMonths(currentMonth(), -1));
  };

  const goToNextMonth = () => {
    currentMonth.set(addMonths(currentMonth(), 1));
  };

  const selectDate = (date: Date) => {
    if (!props.disabled) {
      // Create new Date instance to trigger reactivity
      setValue(new Date(date));
    }
  };

  const isDateSelected = (date: Date) => {
    const selected = getValue();
    return selected ? isSameDay(date, selected) : false;
  };

  const isDateInCurrentMonth = (date: Date) => isSameMonth(date, currentMonth());

  const isToday = (date: Date) => isSameDay(date, new Date());

  const isDateDisabledFn = (date: Date) => {
    if (props.disabled) return true;
    if (props.isDateDisabled?.(date)) return true;
    if (props.minDate && date < props.minDate) return true;
    if (props.maxDate && date > props.maxDate) return true;
    return false;
  };

  const monthName = computed(() => MONTH_NAMES[currentMonth().getMonth()] || 'January');

  const year = computed(() => currentMonth().getFullYear());

  const days = computed(() => {
    const month = currentMonth();
    const generatedDays = generateCalendarDays(month.getFullYear(), month.getMonth(), props.weekStartsOn ?? 0);

    return generatedDays.map(
      (day): DayInfo => ({
        date: day.date,
        isCurrentMonth: day.isCurrentMonth,
        isToday: isToday(day.date),
        isSelected: isDateSelected(day.date),
        isDisabled: isDateDisabledFn(day.date),
      })
    );
  });

  const contextValue: CalendarContextValue = {
    value: computed(() => getValue()),
    currentMonth,
    minDate: props.minDate,
    maxDate: props.maxDate,
    isDateDisabled: props.isDateDisabled,
    disabled: props.disabled ?? false,
    weekStartsOn: props.weekStartsOn ?? 0,
    monthName,
    year,
    days,
    setValue,
    goToPrevMonth,
    goToNextMonth,
    selectDate,
    isDateSelected,
    isDateInCurrentMonth,
    isToday,
  };

  // Provide context during setup phase (Pattern 17)
  provideContext(CalendarContext, contextValue);

  return () => {
    const { children, class: className, ...restProps } = props;

    // Evaluate function children during render (Pattern 17)
    const evaluatedChildren = typeof children === 'function' ? children() : children;

    return jsx('div', {
      ...restProps,
      class: className,
      'data-calendar': '',
      'data-disabled': props.disabled ? '' : undefined,
      role: 'application',
      'aria-label': 'Calendar',
      children: evaluatedChildren,
    });
  };
});

/**
 * Calendar Header
 * Container for navigation buttons and heading
 */
export const CalendarHeader = defineComponent<CalendarHeaderProps>((props) => () => {
  const { children, ...restProps } = props;

  return jsx('div', {
    ...restProps,
    'data-calendar-header': '',
    children,
  });
});

/**
 * Calendar Prev Button
 * Navigate to previous month
 */
export const CalendarPrevButton = defineComponent<CalendarPrevButtonProps>((props) => {
  const context = useCalendarContext();

  const handleClick = (e: MouseEvent) => {
    context.goToPrevMonth();
    props.onClick?.(e);
  };

  return () => {
    const { children, ...restProps } = props;

    return jsx('button', {
      ...restProps,
      type: 'button',
      'data-calendar-prev-button': '',
      'aria-label': 'Previous month',
      onClick: handleClick,
      disabled: context.disabled,
      children,
    });
  };
});

/**
 * Calendar Next Button
 * Navigate to next month
 */
export const CalendarNextButton = defineComponent<CalendarNextButtonProps>((props) => {
  const context = useCalendarContext();

  const handleClick = (e: MouseEvent) => {
    context.goToNextMonth();
    props.onClick?.(e);
  };

  return () => {
    const { children, ...restProps } = props;

    return jsx('button', {
      ...restProps,
      type: 'button',
      'data-calendar-next-button': '',
      'aria-label': 'Next month',
      onClick: handleClick,
      disabled: context.disabled,
      children,
    });
  };
});

/**
 * Calendar Heading
 * Displays current month and year
 */
export const CalendarHeading = defineComponent<CalendarHeadingProps>((props) => {
  const context = useCalendarContext();

  // Set up reactive text updates (Pattern 18)
  const refCallback = (element: HTMLDivElement | null) => {
    if (!element) return;

    // Only set up effect if using default children (month/year display)
    if (!props.children) {
      effect(() => {
        element.textContent = `${context.monthName()} ${context.year()}`;
      });
    }
  };

  return () => {
    const { children, ...restProps } = props;

    return jsx('div', {
      ...restProps,
      ref: refCallback,
      'data-calendar-heading': '',
      'aria-live': 'polite',
      'aria-atomic': 'true',
      children: children,
    });
  };
});

/**
 * Calendar Grid
 * Container for the calendar grid
 */
export const CalendarGrid = defineComponent<CalendarGridProps>((props) => () => {
  const { children, ...restProps } = props;

  return jsx('div', {
    ...restProps,
    'data-calendar-grid': '',
    role: 'grid',
    children,
  });
});

/**
 * Calendar Grid Head
 * Header row with day names
 */
export const CalendarGridHead = defineComponent<CalendarGridHeadProps>((props) => () => {
  const { children, ...restProps } = props;

  return jsx('div', {
    ...restProps,
    'data-calendar-grid-head': '',
    role: 'row',
    children,
  });
});

/**
 * Calendar Head Cell
 * Day name header cell
 */
export const CalendarHeadCell = defineComponent<CalendarHeadCellProps>((props) => () => {
  const { children, ...restProps } = props;

  return jsx('div', {
    ...restProps,
    'data-calendar-head-cell': '',
    role: 'columnheader',
    children,
  });
});

/**
 * Calendar Grid Body
 * Auto-generates date cells for the current month
 */
export const CalendarGridBody = defineComponent<CalendarGridBodyProps>((props) => {
  const context = useCalendarContext();

  return () => {
    const { children, ...restProps } = props;
    const days = context.days();

    // Split days into weeks (7 days per row)
    const weeks: DayInfo[][] = [];
    for (let i = 0; i < days.length; i += 7) {
      weeks.push(days.slice(i, i + 7));
    }

    return jsx('div', {
      ...restProps,
      'data-calendar-grid-body': '',
      children: weeks.map((week, weekIdx) =>
        jsx('div', {
          key: weekIdx,
          'data-calendar-week': '',
          role: 'row',
          children: week.map((day, dayIdx) =>
            jsx(CalendarCell, {
              key: `${weekIdx}-${dayIdx}`,
              date: day.date,
              'data-current-month': day.isCurrentMonth ? '' : undefined,
              'data-today': day.isToday ? '' : undefined,
              'data-selected': day.isSelected ? '' : undefined,
              disabled: day.isDisabled,
              children: day.date.getDate(),
            })
          ),
        })
      ),
    });
  };
});

/**
 * Calendar Cell
 * Individual date cell
 */
export const CalendarCell = defineComponent<CalendarCellProps>((props) => {
  const context = useCalendarContext();

  const handleClick = (e: MouseEvent) => {
    if (!props.disabled) {
      context.selectDate(props.date);
    }
    props.onClick?.(e);
  };

  // Set up reactive updates (Pattern 18)
  const refCallback = (element: HTMLButtonElement | null) => {
    if (!element) return;

    // Set up effect to update aria-selected when selection changes
    effect(() => {
      const isSelected = context.isDateSelected(props.date);
      element.setAttribute('aria-selected', String(isSelected));
    });
  };

  return () => {
    const { children, date, ...restProps } = props;

    return jsx('button', {
      ...restProps,
      ref: refCallback,
      type: 'button',
      role: 'gridcell',
      'data-calendar-cell': '',
      'aria-label': date.toLocaleDateString(),
      onClick: handleClick,
      children,
    });
  };
});

// ============================================================================
// Attach sub-components
// ============================================================================

(Calendar as any).Header = CalendarHeader;
(Calendar as any).PrevButton = CalendarPrevButton;
(Calendar as any).NextButton = CalendarNextButton;
(Calendar as any).Heading = CalendarHeading;
(Calendar as any).Grid = CalendarGrid;
(Calendar as any).GridHead = CalendarGridHead;
(Calendar as any).HeadCell = CalendarHeadCell;
(Calendar as any).GridBody = CalendarGridBody;
(Calendar as any).Cell = CalendarCell;

// ============================================================================
// Type augmentation for sub-components
// ============================================================================

export interface CalendarComponent {
  (props: CalendarProps): any;
  Header: typeof CalendarHeader;
  PrevButton: typeof CalendarPrevButton;
  NextButton: typeof CalendarNextButton;
  Heading: typeof CalendarHeading;
  Grid: typeof CalendarGrid;
  GridHead: typeof CalendarGridHead;
  HeadCell: typeof CalendarHeadCell;
  GridBody: typeof CalendarGridBody;
  Cell: typeof CalendarCell;
  [key: string]: any;
}
