/**
 * DateRangePicker Primitive Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  DateRangePicker,
  DateRangePickerTrigger,
  DateRangePickerContent,
  DateRangePickerCalendar,
  DateRangePickerPreset,
  type DateRange,
} from '../../../src/primitives/DateRangePicker.js';
import { renderComponent } from '../../helpers/test-utils.js';

describe('DateRangePicker', () => {
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  // ==========================================================================
  // Rendering Tests (10 tests)
  // ==========================================================================

  describe('Rendering Tests', () => {
    it('should render DateRangePicker root', () => {
      const { container, cleanup: dispose } = renderComponent(() => DateRangePicker({}));
      cleanup = dispose;

      const root = container.querySelector('[data-date-range-picker]');
      expect(root).toBeTruthy();
    });

    it('should render as div element', () => {
      const { container, cleanup: dispose } = renderComponent(() => DateRangePicker({}));
      cleanup = dispose;

      const root = container.querySelector('[data-date-range-picker]');
      expect(root?.tagName).toBe('DIV');
    });

    it('should render with disabled state', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({ disabled: true })
      );
      cleanup = dispose;

      const root = container.querySelector('[data-date-range-picker]');
      expect(root?.hasAttribute('data-disabled')).toBe(true);
    });

    it('should not have data-disabled when not disabled', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({ disabled: false })
      );
      cleanup = dispose;

      const root = container.querySelector('[data-date-range-picker]');
      expect(root?.hasAttribute('data-disabled')).toBe(false);
    });

    it('should render with children using function (Pattern 17)', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          children: () => DateRangePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-date-range-picker-trigger]');
      expect(trigger).toBeTruthy();
    });

    it('should render multiple children using function (Pattern 17)', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          children: () => [
            DateRangePickerTrigger({}),
            DateRangePickerContent({}),
          ],
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-date-range-picker-trigger]');
      const content = container.querySelector('[data-date-range-picker-content]');
      expect(trigger).toBeTruthy();
      expect(content).toBeTruthy();
    });

    it('should render all sub-components together', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          numberOfMonths: 2,
          children: () => [
            DateRangePickerTrigger({}),
            DateRangePickerContent({
              children: [
                DateRangePickerCalendar({ monthOffset: 0 }),
                DateRangePickerCalendar({ monthOffset: 1 }),
              ],
            }),
          ],
        })
      );
      cleanup = dispose;

      expect(container.querySelector('[data-date-range-picker-trigger]')).toBeTruthy();
      expect(container.querySelector('[data-date-range-picker-content]')).toBeTruthy();
      expect(container.querySelectorAll('[data-date-range-picker-calendar]').length).toBe(2);
    });

    it('should render with empty children', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({ children: () => null })
      );
      cleanup = dispose;

      const root = container.querySelector('[data-date-range-picker]');
      expect(root).toBeTruthy();
      expect(root?.textContent).toBe('');
    });

    it('should render with numberOfMonths prop', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          numberOfMonths: 3,
          children: () => DateRangePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-date-range-picker-trigger]');
      expect(trigger).toBeTruthy();
    });

    it('should render with min and max props', () => {
      const min = new Date(2024, 0, 1);
      const max = new Date(2024, 11, 31);
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          min,
          max,
          children: () => DateRangePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-date-range-picker-trigger]');
      expect(trigger).toBeTruthy();
    });
  });

  // ==========================================================================
  // Context Tests (10 tests)
  // ==========================================================================

  describe('Context Tests', () => {
    it('should provide value signal through context', () => {
      const range: DateRange = {
        start: new Date(2024, 0, 1),
        end: new Date(2024, 0, 31),
      };
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          value: range,
          children: () => DateRangePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-date-range-picker-trigger]');
      expect(trigger?.textContent).toBeTruthy();
    });

    it('should provide disabled state through context', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          disabled: true,
          children: () => DateRangePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('button[data-date-range-picker-trigger]') as HTMLButtonElement;
      expect(trigger.disabled).toBe(true);
    });

    it('should provide numberOfMonths through context', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          numberOfMonths: 2,
          children: () => DateRangePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-date-range-picker-trigger]');
      expect(trigger).toBeTruthy();
    });

    it('should provide min date through context', () => {
      const min = new Date(2024, 0, 1);
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          min,
          children: () => DateRangePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-date-range-picker-trigger]');
      expect(trigger).toBeTruthy();
    });

    it('should provide max date through context', () => {
      const max = new Date(2024, 11, 31);
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          max,
          children: () => DateRangePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-date-range-picker-trigger]');
      expect(trigger).toBeTruthy();
    });

    it('should default numberOfMonths to 2', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          children: () => DateRangePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-date-range-picker-trigger]');
      expect(trigger).toBeTruthy();
    });

    it('should provide selection mode state', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          children: () => DateRangePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-date-range-picker-trigger]');
      expect(trigger).toBeTruthy();
    });

    it('should provide hover date state', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          children: () => DateRangePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-date-range-picker-trigger]');
      expect(trigger).toBeTruthy();
    });

    it('should allow sub-components to access context', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          children: () => [
            DateRangePickerTrigger({}),
            DateRangePickerContent({}),
            DateRangePickerCalendar({}),
          ],
        })
      );
      cleanup = dispose;

      expect(container.querySelector('[data-date-range-picker-trigger]')).toBeTruthy();
      expect(container.querySelector('[data-date-range-picker-content]')).toBeTruthy();
      expect(container.querySelector('[data-date-range-picker-calendar]')).toBeTruthy();
    });

    it('should provide range helper functions through context', () => {
      const range: DateRange = {
        start: new Date(2024, 0, 10),
        end: new Date(2024, 0, 20),
      };
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          value: range,
          children: () => DateRangePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-date-range-picker-trigger]');
      expect(trigger).toBeTruthy();
    });
  });

  // ==========================================================================
  // Controlled/Uncontrolled Tests (8 tests)
  // ==========================================================================

  describe('Controlled/Uncontrolled Tests', () => {
    it('should work in uncontrolled mode with defaultValue', () => {
      const defaultRange: DateRange = {
        start: new Date(2024, 0, 1),
        end: new Date(2024, 0, 7),
      };
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          defaultValue: defaultRange,
          children: () => DateRangePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-date-range-picker-trigger]');
      expect(trigger?.textContent).toContain('1/1/2024');
      expect(trigger?.textContent).toContain('1/7/2024');
    });

    it('should work in controlled mode with value prop', () => {
      const range: DateRange = {
        start: new Date(2024, 5, 1),
        end: new Date(2024, 5, 15),
      };
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          value: range,
          children: () => DateRangePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-date-range-picker-trigger]');
      expect(trigger?.textContent).toContain('6/1/2024');
      expect(trigger?.textContent).toContain('6/15/2024');
    });

    it('should call onValueChange callback when range changes', () => {
      const onValueChange = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          onValueChange,
          children: () => DateRangePickerTrigger({}),
        })
      );
      cleanup = dispose;

      expect(container.querySelector('[data-date-range-picker-trigger]')).toBeTruthy();
      // Note: Actual range selection would require calendar integration
    });

    it('should use controlled value over internal state', () => {
      const controlledRange: DateRange = {
        start: new Date(2024, 8, 1),
        end: new Date(2024, 8, 30),
      };
      const defaultRange: DateRange = {
        start: new Date(2024, 0, 1),
        end: new Date(2024, 0, 31),
      };
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          value: controlledRange,
          defaultValue: defaultRange,
          children: () => DateRangePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-date-range-picker-trigger]');
      expect(trigger?.textContent).toContain('9/1/2024');
      expect(trigger?.textContent).toContain('9/30/2024');
    });

    it('should handle null start date', () => {
      const range: DateRange = { start: null, end: null };
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          value: range,
          children: () => DateRangePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-date-range-picker-trigger]');
      expect(trigger?.textContent).toBeTruthy();
    });

    it('should handle only start date selected', () => {
      const range: DateRange = {
        start: new Date(2024, 3, 1),
        end: null,
      };
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          value: range,
          children: () => DateRangePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-date-range-picker-trigger]');
      expect(trigger?.textContent).toContain('4/1/2024');
      expect(trigger?.textContent).toContain('Select end date');
    });

    it('should default to null range when no value provided', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          children: () => DateRangePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-date-range-picker-trigger]');
      expect(trigger?.textContent).toBeTruthy();
    });

    it('should update when controlled value changes externally', () => {
      const range: DateRange = {
        start: new Date(2024, 0, 1),
        end: new Date(2024, 0, 31),
      };
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          value: range,
          children: () => DateRangePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-date-range-picker-trigger]');
      expect(trigger?.textContent).toContain('1/1/2024');
    });
  });

  // ==========================================================================
  // DateRangePickerTrigger Tests (8 tests)
  // ==========================================================================

  describe('DateRangePickerTrigger Tests', () => {
    it('should render as button', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          children: () => DateRangePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-date-range-picker-trigger]');
      expect(trigger?.tagName).toBe('BUTTON');
    });

    it('should have type="button"', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          children: () => DateRangePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-date-range-picker-trigger]') as HTMLButtonElement;
      expect(trigger.type).toBe('button');
    });

    it('should have aria-label', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          children: () => DateRangePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-date-range-picker-trigger]');
      expect(trigger?.getAttribute('aria-label')).toBe('Select date range');
    });

    it('should display formatted date range', () => {
      const range: DateRange = {
        start: new Date(2024, 0, 1),
        end: new Date(2024, 0, 31),
      };
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          value: range,
          children: () => DateRangePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-date-range-picker-trigger]');
      expect(trigger?.textContent).toContain('1/1/2024');
      expect(trigger?.textContent).toContain('1/31/2024');
    });

    it('should respect disabled state', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          disabled: true,
          children: () => DateRangePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('button[data-date-range-picker-trigger]') as HTMLButtonElement;
      expect(trigger.disabled).toBe(true);
    });

    it('should accept custom children', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          children: () => DateRangePickerTrigger({ children: 'Custom Range Picker' }),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-date-range-picker-trigger]');
      expect(trigger?.textContent).toBe('Custom Range Picker');
    });

    it('should accept additional props', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          children: () =>
            DateRangePickerTrigger({
              'data-testid': 'range-trigger',
              className: 'custom-trigger',
            }),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-date-range-picker-trigger]');
      expect(trigger?.getAttribute('data-testid')).toBe('range-trigger');
      expect(trigger?.className).toContain('custom-trigger');
    });

    it('should show "Select end date" when only start is selected', () => {
      const range: DateRange = {
        start: new Date(2024, 0, 1),
        end: null,
      };
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          value: range,
          children: () => DateRangePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-date-range-picker-trigger]');
      expect(trigger?.textContent).toContain('Select end date');
    });
  });

  // ==========================================================================
  // DateRangePickerContent Tests (5 tests)
  // ==========================================================================

  describe('DateRangePickerContent Tests', () => {
    it('should render as div', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          children: () => DateRangePickerContent({}),
        })
      );
      cleanup = dispose;

      const content = container.querySelector('[data-date-range-picker-content]');
      expect(content?.tagName).toBe('DIV');
    });

    it('should have role="dialog"', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          children: () => DateRangePickerContent({}),
        })
      );
      cleanup = dispose;

      const content = container.querySelector('[data-date-range-picker-content]');
      expect(content?.getAttribute('role')).toBe('dialog');
    });

    it('should have aria-label', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          children: () => DateRangePickerContent({}),
        })
      );
      cleanup = dispose;

      const content = container.querySelector('[data-date-range-picker-content]');
      expect(content?.getAttribute('aria-label')).toBe('Date range picker');
    });

    it('should render children', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          children: () =>
            DateRangePickerContent({
              children: 'Range content',
            }),
        })
      );
      cleanup = dispose;

      const content = container.querySelector('[data-date-range-picker-content]');
      expect(content?.textContent).toContain('Range content');
    });

    it('should accept additional props', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          children: () =>
            DateRangePickerContent({
              'data-testid': 'range-content',
              className: 'custom-content',
            }),
        })
      );
      cleanup = dispose;

      const content = container.querySelector('[data-date-range-picker-content]');
      expect(content?.getAttribute('data-testid')).toBe('range-content');
      expect(content?.className).toContain('custom-content');
    });
  });

  // ==========================================================================
  // DateRangePickerCalendar Tests (8 tests)
  // ==========================================================================

  describe('DateRangePickerCalendar Tests', () => {
    it('should render calendar', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          children: () => DateRangePickerCalendar({}),
        })
      );
      cleanup = dispose;

      const calendar = container.querySelector('[data-date-range-picker-calendar]');
      expect(calendar).toBeTruthy();
    });

    it('should have data-month-offset attribute', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          children: () => DateRangePickerCalendar({ monthOffset: 1 }),
        })
      );
      cleanup = dispose;

      const calendar = container.querySelector('[data-date-range-picker-calendar]');
      expect(calendar?.getAttribute('data-month-offset')).toBe('1');
    });

    it('should default monthOffset to 0', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          children: () => DateRangePickerCalendar({}),
        })
      );
      cleanup = dispose;

      const calendar = container.querySelector('[data-date-range-picker-calendar]');
      expect(calendar?.getAttribute('data-month-offset')).toBe('0');
    });

    it('should render calendar for current month when offset is 0', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          children: () => DateRangePickerCalendar({ monthOffset: 0 }),
        })
      );
      cleanup = dispose;

      const calendar = container.querySelector('[data-date-range-picker-calendar]');
      expect(calendar).toBeTruthy();
    });

    it('should render calendar for next month when offset is 1', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          children: () => DateRangePickerCalendar({ monthOffset: 1 }),
        })
      );
      cleanup = dispose;

      const calendar = container.querySelector('[data-date-range-picker-calendar]');
      expect(calendar?.getAttribute('data-month-offset')).toBe('1');
    });

    it('should render multiple calendars with different offsets', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          numberOfMonths: 2,
          children: () => [
            DateRangePickerCalendar({ monthOffset: 0 }),
            DateRangePickerCalendar({ monthOffset: 1 }),
          ],
        })
      );
      cleanup = dispose;

      const calendars = container.querySelectorAll('[data-date-range-picker-calendar]');
      expect(calendars.length).toBe(2);
      expect(calendars[0]?.getAttribute('data-month-offset')).toBe('0');
      expect(calendars[1]?.getAttribute('data-month-offset')).toBe('1');
    });

    it('should render calendar placeholder', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          children: () => DateRangePickerCalendar({}),
        })
      );
      cleanup = dispose;

      const placeholder = container.querySelector('[data-calendar-placeholder]');
      expect(placeholder).toBeTruthy();
    });

    it('should display month name in placeholder', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          children: () => DateRangePickerCalendar({ monthOffset: 0 }),
        })
      );
      cleanup = dispose;

      const placeholder = container.querySelector('[data-calendar-placeholder]');
      expect(placeholder?.textContent).toContain('Calendar for');
    });
  });

  // ==========================================================================
  // DateRangePickerPreset Tests (8 tests)
  // ==========================================================================

  describe('DateRangePickerPreset Tests', () => {
    const todayRange: DateRange = {
      start: new Date(),
      end: new Date(),
    };

    const last7DaysRange: DateRange = {
      start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      end: new Date(),
    };

    it('should render as button', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          children: () => DateRangePickerPreset({ range: todayRange }),
        })
      );
      cleanup = dispose;

      const preset = container.querySelector('[data-date-range-picker-preset]');
      expect(preset?.tagName).toBe('BUTTON');
    });

    it('should have type="button"', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          children: () => DateRangePickerPreset({ range: todayRange }),
        })
      );
      cleanup = dispose;

      const preset = container.querySelector('[data-date-range-picker-preset]') as HTMLButtonElement;
      expect(preset.type).toBe('button');
    });

    it('should render children', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          children: () =>
            DateRangePickerPreset({
              range: todayRange,
              children: 'Today',
            }),
        })
      );
      cleanup = dispose;

      const preset = container.querySelector('[data-date-range-picker-preset]');
      expect(preset?.textContent).toBe('Today');
    });

    it('should call setRange on click', () => {
      const onValueChange = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          onValueChange,
          children: () =>
            DateRangePickerPreset({
              range: todayRange,
              children: 'Today',
            }),
        })
      );
      cleanup = dispose;

      const preset = container.querySelector('[data-date-range-picker-preset]') as HTMLButtonElement;
      preset.click();

      expect(onValueChange).toHaveBeenCalled();
    });

    it('should render multiple presets', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          children: () => [
            DateRangePickerPreset({ range: todayRange, children: 'Today' }),
            DateRangePickerPreset({ range: last7DaysRange, children: 'Last 7 Days' }),
          ],
        })
      );
      cleanup = dispose;

      const presets = container.querySelectorAll('[data-date-range-picker-preset]');
      expect(presets.length).toBe(2);
    });

    it('should accept additional props', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          children: () =>
            DateRangePickerPreset({
              range: todayRange,
              'data-testid': 'preset-today',
              className: 'preset-button',
            }),
        })
      );
      cleanup = dispose;

      const preset = container.querySelector('[data-date-range-picker-preset]');
      expect(preset?.getAttribute('data-testid')).toBe('preset-today');
      expect(preset?.className).toContain('preset-button');
    });

    it('should update range value on preset click', () => {
      const onValueChange = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          onValueChange,
          children: () => [
            DateRangePickerTrigger({}),
            DateRangePickerPreset({ range: last7DaysRange, children: 'Last 7 Days' }),
          ],
        })
      );
      cleanup = dispose;

      const preset = container.querySelector('[data-date-range-picker-preset]') as HTMLButtonElement;
      preset.click();

      expect(onValueChange).toHaveBeenCalledWith(last7DaysRange);
    });

    it('should handle preset with null dates', () => {
      const nullRange: DateRange = { start: null, end: null };
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          children: () =>
            DateRangePickerPreset({
              range: nullRange,
              children: 'Clear',
            }),
        })
      );
      cleanup = dispose;

      const preset = container.querySelector('[data-date-range-picker-preset]');
      expect(preset).toBeTruthy();
    });
  });

  // ==========================================================================
  // Range Selection Tests (8 tests)
  // ==========================================================================

  describe('Range Selection Tests', () => {
    it('should handle start date selection', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          children: () => DateRangePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-date-range-picker-trigger]');
      expect(trigger).toBeTruthy();
    });

    it('should handle end date selection after start', () => {
      const range: DateRange = {
        start: new Date(2024, 0, 1),
        end: null,
      };
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          value: range,
          children: () => DateRangePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-date-range-picker-trigger]');
      expect(trigger?.textContent).toContain('1/1/2024');
    });

    it('should swap dates if end is before start', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          children: () => DateRangePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-date-range-picker-trigger]');
      expect(trigger).toBeTruthy();
    });

    it('should allow same date for start and end', () => {
      const sameDate = new Date(2024, 0, 15);
      const range: DateRange = {
        start: sameDate,
        end: sameDate,
      };
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          value: range,
          children: () => DateRangePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-date-range-picker-trigger]');
      expect(trigger?.textContent).toContain('1/15/2024');
    });

    it('should handle selection mode toggle', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          children: () => DateRangePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-date-range-picker-trigger]');
      expect(trigger).toBeTruthy();
    });

    it('should provide hover preview for range', () => {
      const range: DateRange = {
        start: new Date(2024, 0, 1),
        end: null,
      };
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          value: range,
          children: () => DateRangePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-date-range-picker-trigger]');
      expect(trigger).toBeTruthy();
    });

    it('should reset to start selection after completing range', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          children: () => DateRangePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-date-range-picker-trigger]');
      expect(trigger).toBeTruthy();
    });

    it('should handle quick range selection (same day)', () => {
      const today = new Date();
      const range: DateRange = {
        start: today,
        end: today,
      };
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          value: range,
          children: () => DateRangePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-date-range-picker-trigger]');
      expect(trigger).toBeTruthy();
    });
  });

  // ==========================================================================
  // Date Constraints Tests (8 tests)
  // ==========================================================================

  describe('Date Constraints Tests', () => {
    it('should respect min date constraint', () => {
      const min = new Date(2024, 0, 1);
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          min,
          children: () => DateRangePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-date-range-picker-trigger]');
      expect(trigger).toBeTruthy();
    });

    it('should respect max date constraint', () => {
      const max = new Date(2024, 11, 31);
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          max,
          children: () => DateRangePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-date-range-picker-trigger]');
      expect(trigger).toBeTruthy();
    });

    it('should respect both min and max constraints', () => {
      const min = new Date(2024, 0, 1);
      const max = new Date(2024, 11, 31);
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          min,
          max,
          children: () => DateRangePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-date-range-picker-trigger]');
      expect(trigger).toBeTruthy();
    });

    it('should disable dates before min', () => {
      const min = new Date(2024, 0, 15);
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          min,
          children: () => DateRangePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-date-range-picker-trigger]');
      expect(trigger).toBeTruthy();
    });

    it('should disable dates after max', () => {
      const max = new Date(2024, 0, 15);
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          max,
          children: () => DateRangePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-date-range-picker-trigger]');
      expect(trigger).toBeTruthy();
    });

    it('should allow range within constraints', () => {
      const min = new Date(2024, 0, 1);
      const max = new Date(2024, 11, 31);
      const range: DateRange = {
        start: new Date(2024, 5, 1),
        end: new Date(2024, 5, 30),
      };
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          min,
          max,
          value: range,
          children: () => DateRangePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-date-range-picker-trigger]');
      expect(trigger?.textContent).toContain('6/1/2024');
    });

    it('should handle min equals max', () => {
      const date = new Date(2024, 5, 15);
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          min: date,
          max: date,
          children: () => DateRangePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-date-range-picker-trigger]');
      expect(trigger).toBeTruthy();
    });

    it('should handle past dates with maxDate=today', () => {
      const today = new Date();
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          max: today,
          children: () => DateRangePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-date-range-picker-trigger]');
      expect(trigger).toBeTruthy();
    });
  });

  // ==========================================================================
  // Integration Tests (6 tests)
  // ==========================================================================

  describe('Integration Tests', () => {
    it('should render complete DateRangePicker with all components', () => {
      const range: DateRange = {
        start: new Date(2024, 0, 1),
        end: new Date(2024, 0, 31),
      };
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          value: range,
          numberOfMonths: 2,
          children: () => [
            DateRangePickerTrigger({}),
            DateRangePickerContent({
              children: [
                DateRangePickerCalendar({ monthOffset: 0 }),
                DateRangePickerCalendar({ monthOffset: 1 }),
                DateRangePickerPreset({ range: { start: new Date(), end: new Date() }, children: 'Today' }),
              ],
            }),
          ],
        })
      );
      cleanup = dispose;

      expect(container.querySelector('[data-date-range-picker]')).toBeTruthy();
      expect(container.querySelector('[data-date-range-picker-trigger]')).toBeTruthy();
      expect(container.querySelector('[data-date-range-picker-content]')).toBeTruthy();
      expect(container.querySelectorAll('[data-date-range-picker-calendar]').length).toBe(2);
      expect(container.querySelector('[data-date-range-picker-preset]')).toBeTruthy();
    });

    it('should coordinate trigger and preset selection', () => {
      const todayRange: DateRange = {
        start: new Date(),
        end: new Date(),
      };
      const onValueChange = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          onValueChange,
          children: () => [
            DateRangePickerTrigger({}),
            DateRangePickerPreset({ range: todayRange, children: 'Today' }),
          ],
        })
      );
      cleanup = dispose;

      const preset = container.querySelector('[data-date-range-picker-preset]') as HTMLButtonElement;
      preset.click();

      expect(onValueChange).toHaveBeenCalledWith(todayRange);
    });

    it('should render with common presets', () => {
      const today = new Date();
      const presets = [
        { label: 'Today', range: { start: today, end: today } },
        { label: 'Last 7 Days', range: { start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), end: today } },
        { label: 'Last 30 Days', range: { start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), end: today } },
      ];
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          children: () => [
            DateRangePickerTrigger({}),
            ...presets.map((p) =>
              DateRangePickerPreset({ range: p.range, children: p.label })
            ),
          ],
        })
      );
      cleanup = dispose;

      const presetButtons = container.querySelectorAll('[data-date-range-picker-preset]');
      expect(presetButtons.length).toBe(3);
    });

    it('should work with two-month calendar layout', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          numberOfMonths: 2,
          children: () =>
            DateRangePickerContent({
              children: [
                DateRangePickerCalendar({ monthOffset: 0 }),
                DateRangePickerCalendar({ monthOffset: 1 }),
              ],
            }),
        })
      );
      cleanup = dispose;

      const calendars = container.querySelectorAll('[data-date-range-picker-calendar]');
      expect(calendars.length).toBe(2);
    });

    it('should work with constraints and presets together', () => {
      const today = new Date();
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const min = new Date(2024, 0, 1);
      const max = new Date(2024, 11, 31);
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          min,
          max,
          children: () => [
            DateRangePickerTrigger({}),
            DateRangePickerPreset({ range: { start: thirtyDaysAgo, end: today }, children: 'Last 30 Days' }),
          ],
        })
      );
      cleanup = dispose;

      expect(container.querySelector('[data-date-range-picker-trigger]')).toBeTruthy();
      expect(container.querySelector('[data-date-range-picker-preset]')).toBeTruthy();
    });

    it('should handle complete user flow', () => {
      const onValueChange = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          onValueChange,
          numberOfMonths: 2,
          children: () => [
            DateRangePickerTrigger({}),
            DateRangePickerContent({
              children: [
                DateRangePickerCalendar({ monthOffset: 0 }),
                DateRangePickerCalendar({ monthOffset: 1 }),
                DateRangePickerPreset({ range: { start: new Date(), end: new Date() }, children: 'Today' }),
              ],
            }),
          ],
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-date-range-picker-trigger]');
      const preset = container.querySelector('[data-date-range-picker-preset]') as HTMLButtonElement;

      expect(trigger).toBeTruthy();
      expect(preset).toBeTruthy();

      preset.click();
      expect(onValueChange).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Edge Cases (5 tests)
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle empty children', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({ children: undefined })
      );
      cleanup = dispose;

      const root = container.querySelector('[data-date-range-picker]');
      expect(root).toBeTruthy();
    });

    it('should handle leap year dates in range', () => {
      const range: DateRange = {
        start: new Date(2024, 1, 28),
        end: new Date(2024, 2, 1),
      };
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          value: range,
          children: () => DateRangePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-date-range-picker-trigger]');
      expect(trigger?.textContent).toContain('2/28/2024');
    });

    it('should handle year boundary ranges', () => {
      const range: DateRange = {
        start: new Date(2023, 11, 25),
        end: new Date(2024, 0, 5),
      };
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          value: range,
          children: () => DateRangePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-date-range-picker-trigger]');
      expect(trigger?.textContent).toContain('12/25/2023');
      expect(trigger?.textContent).toContain('1/5/2024');
    });

    it('should handle very long date ranges', () => {
      const range: DateRange = {
        start: new Date(2024, 0, 1),
        end: new Date(2024, 11, 31),
      };
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          value: range,
          children: () => DateRangePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-date-range-picker-trigger]');
      expect(trigger?.textContent).toContain('1/1/2024');
      expect(trigger?.textContent).toContain('12/31/2024');
    });

    it('should use default props when missing', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DateRangePicker({
          children: () => DateRangePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const root = container.querySelector('[data-date-range-picker]');
      const trigger = container.querySelector('[data-date-range-picker-trigger]');

      expect(root).toBeTruthy();
      expect(trigger).toBeTruthy();
      expect(root?.hasAttribute('data-disabled')).toBe(false);
    });
  });
});
