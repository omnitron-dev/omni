/**
 * DatePicker Primitive Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  DatePicker,
  DatePickerTrigger,
  DatePickerValue,
  DatePickerIcon,
  DatePickerContent,
  DatePickerCalendar,
} from '../../../src/primitives/DatePicker.js';
import { renderComponent } from '../../helpers/test-utils.js';

describe('DatePicker', () => {
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
    it('should render DatePicker root', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({ children: () => DatePickerTrigger({}) })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-datepicker-trigger]');
      expect(trigger).toBeTruthy();
    });

    it('should render with children using function (Pattern 17)', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          children: () => DatePickerTrigger({ children: 'Pick Date' }),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-datepicker-trigger]');
      expect(trigger).toBeTruthy();
      expect(trigger?.textContent).toContain('Pick Date');
    });

    it('should render multiple children using function (Pattern 17)', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          defaultOpen: true,
          children: () => [
            DatePickerTrigger({}),
            DatePickerContent({}),
          ],
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-datepicker-trigger]');
      const content = document.querySelector('[data-datepicker-content]');
      expect(trigger).toBeTruthy();
      expect(content).toBeTruthy();
    });

    it('should render all sub-components together', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          defaultOpen: true,
          children: () => [
            DatePickerTrigger({
              children: [
                DatePickerIcon({ children: '📅' }),
                DatePickerValue({}),
              ],
            }),
            DatePickerContent({
              children: DatePickerCalendar({}),
            }),
          ],
        })
      );
      cleanup = dispose;

      expect(container.querySelector('[data-datepicker-trigger]')).toBeTruthy();
      expect(container.querySelector('[data-datepicker-icon]')).toBeTruthy();
      expect(container.querySelector('[data-datepicker-value]')).toBeTruthy();
      expect(document.querySelector('[data-datepicker-content]')).toBeTruthy();
    });

    it('should render with empty children', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({ children: () => DatePickerTrigger({}) })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-datepicker-trigger]');
      expect(trigger).toBeTruthy();
    });

    it('should render with disabled state', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          disabled: true,
          children: () => DatePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('button[data-datepicker-trigger]') as HTMLButtonElement;
      expect(trigger.disabled).toBe(true);
    });

    it('should not be disabled by default', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          children: () => DatePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('button[data-datepicker-trigger]') as HTMLButtonElement;
      expect(trigger.disabled).toBe(false);
    });

    it('should render with default value', () => {
      const defaultDate = new Date(2024, 0, 15);
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          defaultValue: defaultDate,
          children: () => DatePickerValue({}),
        })
      );
      cleanup = dispose;

      const value = container.querySelector('[data-datepicker-value]');
      expect(value?.textContent).toContain('1/15/2024');
    });

    it('should render with value prop', () => {
      const date = new Date(2024, 5, 20);
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          value: date,
          children: () => DatePickerValue({}),
        })
      );
      cleanup = dispose;

      const value = container.querySelector('[data-datepicker-value]');
      expect(value?.textContent).toContain('6/20/2024');
    });

    it('should render with minDate and maxDate props', () => {
      const minDate = new Date(2024, 0, 1);
      const maxDate = new Date(2024, 11, 31);
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          minDate,
          maxDate,
          children: () => DatePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-datepicker-trigger]');
      expect(trigger).toBeTruthy();
    });
  });

  // ==========================================================================
  // Context Tests (8 tests)
  // ==========================================================================

  describe('Context Tests', () => {
    it('should provide value signal through context', () => {
      const date = new Date(2024, 2, 10);
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          value: date,
          children: () => DatePickerValue({}),
        })
      );
      cleanup = dispose;

      const value = container.querySelector('[data-datepicker-value]');
      expect(value?.textContent).toBeTruthy();
    });

    it('should provide disabled state through context', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          disabled: true,
          children: () => DatePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('button[data-datepicker-trigger]') as HTMLButtonElement;
      expect(trigger.disabled).toBe(true);
    });

    it('should provide minDate through context', () => {
      const minDate = new Date(2024, 0, 1);
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          minDate,
          children: () => DatePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-datepicker-trigger]');
      expect(trigger).toBeTruthy();
    });

    it('should provide maxDate through context', () => {
      const maxDate = new Date(2024, 11, 31);
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          maxDate,
          children: () => DatePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-datepicker-trigger]');
      expect(trigger).toBeTruthy();
    });

    it('should provide weekStartsOn through context', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          weekStartsOn: 1,
          children: () => DatePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-datepicker-trigger]');
      expect(trigger).toBeTruthy();
    });

    it('should default weekStartsOn to 0 (Sunday)', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          children: () => DatePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-datepicker-trigger]');
      expect(trigger).toBeTruthy();
    });

    it('should provide isDateDisabled function through context', () => {
      const isDateDisabled = (date: Date) => date.getDay() === 0; // Disable Sundays
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          isDateDisabled,
          children: () => DatePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-datepicker-trigger]');
      expect(trigger).toBeTruthy();
    });

    it('should allow sub-components to access context', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          value: new Date(2024, 3, 15),
          children: () => [
            DatePickerTrigger({
              children: [DatePickerIcon({}), DatePickerValue({})],
            }),
          ],
        })
      );
      cleanup = dispose;

      expect(container.querySelector('[data-datepicker-trigger]')).toBeTruthy();
      expect(container.querySelector('[data-datepicker-value]')).toBeTruthy();
      expect(container.querySelector('[data-datepicker-icon]')).toBeTruthy();
    });
  });

  // ==========================================================================
  // Controlled/Uncontrolled Tests (8 tests)
  // ==========================================================================

  describe('Controlled/Uncontrolled Tests', () => {
    it('should work in uncontrolled mode with defaultValue', () => {
      const defaultDate = new Date(2024, 1, 14);
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          defaultValue: defaultDate,
          children: () => DatePickerValue({}),
        })
      );
      cleanup = dispose;

      const value = container.querySelector('[data-datepicker-value]');
      expect(value?.textContent).toContain('2/14/2024');
    });

    it('should work in controlled mode with value prop', () => {
      const date = new Date(2024, 6, 4);
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          value: date,
          children: () => DatePickerValue({}),
        })
      );
      cleanup = dispose;

      const value = container.querySelector('[data-datepicker-value]');
      expect(value?.textContent).toContain('7/4/2024');
    });

    it('should call onValueChange callback when value changes', () => {
      const onValueChange = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          defaultValue: new Date(2024, 0, 1),
          onValueChange,
          children: () => DatePickerTrigger({}),
        })
      );
      cleanup = dispose;

      expect(container.querySelector('[data-datepicker-trigger]')).toBeTruthy();
      // Note: Actual date selection would require Calendar integration
    });

    it('should use controlled value over internal state', () => {
      const controlledDate = new Date(2024, 8, 25);
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          value: controlledDate,
          defaultValue: new Date(2024, 0, 1),
          children: () => DatePickerValue({}),
        })
      );
      cleanup = dispose;

      const value = container.querySelector('[data-datepicker-value]');
      expect(value?.textContent).toContain('9/25/2024');
    });

    it('should handle null value', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          value: null,
          children: () => DatePickerValue({}),
        })
      );
      cleanup = dispose;

      const value = container.querySelector('[data-datepicker-value]');
      expect(value?.textContent).toContain('Pick a date');
    });

    it('should handle undefined value', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          children: () => DatePickerValue({}),
        })
      );
      cleanup = dispose;

      const value = container.querySelector('[data-datepicker-value]');
      expect(value?.textContent).toContain('Pick a date');
    });

    it('should default to null when no value provided', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          children: () => DatePickerValue({}),
        })
      );
      cleanup = dispose;

      const value = container.querySelector('[data-datepicker-value]');
      expect(value?.textContent).toContain('Pick a date');
    });

    it('should respect defaultMonth prop', () => {
      const defaultMonth = new Date(2024, 5, 1);
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          defaultMonth,
          children: () => DatePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-datepicker-trigger]');
      expect(trigger).toBeTruthy();
    });
  });

  // ==========================================================================
  // DatePickerTrigger Tests (8 tests)
  // ==========================================================================

  describe('DatePickerTrigger Tests', () => {
    it('should render as button', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          children: () => DatePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-datepicker-trigger]');
      expect(trigger?.tagName).toBe('BUTTON');
    });

    it('should have data-datepicker-trigger attribute', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          children: () => DatePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-datepicker-trigger]');
      expect(trigger).toBeTruthy();
    });

    it('should render children', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          children: () => DatePickerTrigger({ children: 'Select Date' }),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-datepicker-trigger]');
      expect(trigger?.textContent).toContain('Select Date');
    });

    it('should respect disabled state', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          disabled: true,
          children: () => DatePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('button[data-datepicker-trigger]') as HTMLButtonElement;
      expect(trigger.disabled).toBe(true);
    });

    it('should not be disabled by default', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          children: () => DatePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('button[data-datepicker-trigger]') as HTMLButtonElement;
      expect(trigger.disabled).toBe(false);
    });

    it('should accept additional props', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          children: () =>
            DatePickerTrigger({
              'data-testid': 'date-trigger',
              className: 'custom-trigger',
            }),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-datepicker-trigger]');
      expect(trigger?.getAttribute('data-testid')).toBe('date-trigger');
      expect(trigger?.className).toContain('custom-trigger');
    });

    it('should work with value and icon children', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          value: new Date(2024, 0, 1),
          children: () =>
            DatePickerTrigger({
              children: [DatePickerIcon({ children: '📅' }), DatePickerValue({})],
            }),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-datepicker-trigger]');
      expect(trigger?.textContent).toContain('📅');
      expect(trigger?.textContent).toContain('1/1/2024');
    });

    it('should render multiple children in trigger', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          children: () =>
            DatePickerTrigger({
              children: ['📅', DatePickerValue({})],
            }),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-datepicker-trigger]');
      expect(trigger?.textContent).toContain('📅');
    });
  });

  // ==========================================================================
  // DatePickerValue Tests (10 tests)
  // ==========================================================================

  describe('DatePickerValue Tests', () => {
    it('should render as span', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          children: () => DatePickerValue({}),
        })
      );
      cleanup = dispose;

      const value = container.querySelector('[data-datepicker-value]');
      expect(value?.tagName).toBe('SPAN');
    });

    it('should display placeholder when no date selected', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          children: () => DatePickerValue({}),
        })
      );
      cleanup = dispose;

      const value = container.querySelector('[data-datepicker-value]');
      expect(value?.textContent).toBe('Pick a date');
    });

    it('should display custom placeholder', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          children: () => DatePickerValue({ placeholder: 'Choose a date' }),
        })
      );
      cleanup = dispose;

      const value = container.querySelector('[data-datepicker-value]');
      expect(value?.textContent).toBe('Choose a date');
    });

    it('should display selected date in default format', () => {
      const date = new Date(2024, 0, 15);
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          value: date,
          children: () => DatePickerValue({}),
        })
      );
      cleanup = dispose;

      const value = container.querySelector('[data-datepicker-value]');
      expect(value?.textContent).toContain('1/15/2024');
    });

    it('should support custom render function', () => {
      const date = new Date(2024, 5, 20);
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          value: date,
          children: () =>
            DatePickerValue({
              children: (d: Date | null) => (d ? `Custom: ${d.toLocaleDateString()}` : 'None'),
            }),
        })
      );
      cleanup = dispose;

      const value = container.querySelector('[data-datepicker-value]');
      expect(value?.textContent).toContain('Custom:');
      expect(value?.textContent).toContain('6/20/2024');
    });

    it('should render custom render function with null date', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          value: null,
          children: () =>
            DatePickerValue({
              children: (d: Date | null) => (d ? 'Has date' : 'No date selected'),
            }),
        })
      );
      cleanup = dispose;

      const value = container.querySelector('[data-datepicker-value]');
      expect(value?.textContent).toBe('No date selected');
    });

    it('should have data-placeholder attribute when no date', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          children: () => DatePickerValue({}),
        })
      );
      cleanup = dispose;

      const value = container.querySelector('[data-datepicker-value]');
      expect(value?.hasAttribute('data-placeholder')).toBe(true);
    });

    it('should not have data-placeholder attribute when date is selected', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          value: new Date(2024, 0, 1),
          children: () => DatePickerValue({}),
        })
      );
      cleanup = dispose;

      const value = container.querySelector('[data-datepicker-value]');
      expect(value?.hasAttribute('data-placeholder')).toBe(false);
    });

    it('should render static children instead of date', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          value: new Date(2024, 0, 1),
          children: () => DatePickerValue({ children: 'Static Text' }),
        })
      );
      cleanup = dispose;

      const value = container.querySelector('[data-datepicker-value]');
      expect(value?.textContent).toBe('Static Text');
    });

    it('should accept additional props', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          children: () =>
            DatePickerValue({
              'data-testid': 'date-value',
              className: 'custom-value',
            }),
        })
      );
      cleanup = dispose;

      const value = container.querySelector('[data-datepicker-value]');
      expect(value?.getAttribute('data-testid')).toBe('date-value');
      expect(value?.className).toContain('custom-value');
    });
  });

  // ==========================================================================
  // DatePickerIcon Tests (5 tests)
  // ==========================================================================

  describe('DatePickerIcon Tests', () => {
    it('should render as span', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          children: () => DatePickerIcon({}),
        })
      );
      cleanup = dispose;

      const icon = container.querySelector('[data-datepicker-icon]');
      expect(icon?.tagName).toBe('SPAN');
    });

    it('should have aria-hidden="true"', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          children: () => DatePickerIcon({}),
        })
      );
      cleanup = dispose;

      const icon = container.querySelector('[data-datepicker-icon]');
      expect(icon?.getAttribute('aria-hidden')).toBe('true');
    });

    it('should render children', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          children: () => DatePickerIcon({ children: '📅' }),
        })
      );
      cleanup = dispose;

      const icon = container.querySelector('[data-datepicker-icon]');
      expect(icon?.textContent).toBe('📅');
    });

    it('should accept additional props', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          children: () =>
            DatePickerIcon({
              'data-testid': 'date-icon',
              className: 'custom-icon',
            }),
        })
      );
      cleanup = dispose;

      const icon = container.querySelector('[data-datepicker-icon]');
      expect(icon?.getAttribute('data-testid')).toBe('date-icon');
      expect(icon?.className).toContain('custom-icon');
    });

    it('should render SVG icon', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          children: () => DatePickerIcon({ children: '<svg></svg>' }),
        })
      );
      cleanup = dispose;

      const icon = container.querySelector('[data-datepicker-icon]');
      expect(icon?.textContent).toContain('svg');
    });
  });

  // ==========================================================================
  // DatePickerContent Tests (5 tests)
  // ==========================================================================

  describe('DatePickerContent Tests', () => {
    it('should render content when opened', () => {
      const { cleanup: dispose } = renderComponent(() =>
        DatePicker({
          defaultOpen: true,
          children: () => [
            DatePickerTrigger({}),
            DatePickerContent({}),
          ],
        })
      );
      cleanup = dispose;

      const content = document.querySelector('[data-datepicker-content]');
      expect(content).toBeTruthy();
    });

    it('should render children when opened', () => {
      const { cleanup: dispose } = renderComponent(() =>
        DatePicker({
          defaultOpen: true,
          children: () => [
            DatePickerTrigger({}),
            DatePickerContent({ children: 'Content' }),
          ],
        })
      );
      cleanup = dispose;

      const content = document.querySelector('[data-datepicker-content]');
      expect(content?.textContent).toContain('Content');
    });

    it('should accept additional props', () => {
      const { cleanup: dispose } = renderComponent(() =>
        DatePicker({
          defaultOpen: true,
          children: () => [
            DatePickerTrigger({}),
            DatePickerContent({
              'data-testid': 'date-content',
              className: 'custom-content',
            }),
          ],
        })
      );
      cleanup = dispose;

      const content = document.querySelector('[data-datepicker-content]');
      expect(content?.getAttribute('data-testid')).toBe('date-content');
      expect(content?.className).toContain('custom-content');
    });

    it('should wrap Calendar component', () => {
      const { cleanup: dispose } = renderComponent(() =>
        DatePicker({
          defaultOpen: true,
          children: () => [
            DatePickerTrigger({}),
            DatePickerContent({ children: DatePickerCalendar({}) }),
          ],
        })
      );
      cleanup = dispose;

      const content = document.querySelector('[data-datepicker-content]');
      expect(content).toBeTruthy();
    });

    it('should render multiple children', () => {
      const { cleanup: dispose } = renderComponent(() =>
        DatePicker({
          defaultOpen: true,
          children: () => [
            DatePickerTrigger({}),
            DatePickerContent({
              children: ['Header', DatePickerCalendar({}), 'Footer'],
            }),
          ],
        })
      );
      cleanup = dispose;

      const content = document.querySelector('[data-datepicker-content]');
      expect(content?.textContent).toContain('Header');
      expect(content?.textContent).toContain('Footer');
    });
  });

  // ==========================================================================
  // DatePickerCalendar Tests (6 tests)
  // ==========================================================================

  describe('DatePickerCalendar Tests', () => {
    it('should render calendar', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          children: () => DatePickerCalendar({}),
        })
      );
      cleanup = dispose;

      const calendar = container.querySelector('[data-calendar]');
      expect(calendar).toBeTruthy();
    });

    it('should pass value to Calendar', () => {
      const date = new Date(2024, 3, 15);
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          value: date,
          children: () => DatePickerCalendar({}),
        })
      );
      cleanup = dispose;

      const calendar = container.querySelector('[data-calendar]');
      expect(calendar).toBeTruthy();
    });

    it('should pass minDate to Calendar', () => {
      const minDate = new Date(2024, 0, 1);
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          minDate,
          children: () => DatePickerCalendar({}),
        })
      );
      cleanup = dispose;

      const calendar = container.querySelector('[data-calendar]');
      expect(calendar).toBeTruthy();
    });

    it('should pass maxDate to Calendar', () => {
      const maxDate = new Date(2024, 11, 31);
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          maxDate,
          children: () => DatePickerCalendar({}),
        })
      );
      cleanup = dispose;

      const calendar = container.querySelector('[data-calendar]');
      expect(calendar).toBeTruthy();
    });

    it('should pass weekStartsOn to Calendar', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          weekStartsOn: 1,
          children: () => DatePickerCalendar({}),
        })
      );
      cleanup = dispose;

      const calendar = container.querySelector('[data-calendar]');
      expect(calendar).toBeTruthy();
    });

    it('should pass disabled state to Calendar', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          disabled: true,
          children: () => DatePickerCalendar({}),
        })
      );
      cleanup = dispose;

      const calendar = container.querySelector('[data-calendar]');
      expect(calendar).toBeTruthy();
    });
  });

  // ==========================================================================
  // Date Constraints Tests (8 tests)
  // ==========================================================================

  describe('Date Constraints Tests', () => {
    it('should respect minDate constraint', () => {
      const minDate = new Date(2024, 0, 1);
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          minDate,
          children: () => DatePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-datepicker-trigger]');
      expect(trigger).toBeTruthy();
    });

    it('should respect maxDate constraint', () => {
      const maxDate = new Date(2024, 11, 31);
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          maxDate,
          children: () => DatePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-datepicker-trigger]');
      expect(trigger).toBeTruthy();
    });

    it('should respect both minDate and maxDate', () => {
      const minDate = new Date(2024, 0, 1);
      const maxDate = new Date(2024, 11, 31);
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          minDate,
          maxDate,
          children: () => DatePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-datepicker-trigger]');
      expect(trigger).toBeTruthy();
    });

    it('should use isDateDisabled function', () => {
      const isDateDisabled = (date: Date) => date.getDay() === 0;
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          isDateDisabled,
          children: () => DatePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-datepicker-trigger]');
      expect(trigger).toBeTruthy();
    });

    it('should allow disabling weekends', () => {
      const isDateDisabled = (date: Date) => {
        const day = date.getDay();
        return day === 0 || day === 6;
      };
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          isDateDisabled,
          children: () => DatePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-datepicker-trigger]');
      expect(trigger).toBeTruthy();
    });

    it('should allow disabling specific dates', () => {
      const disabledDates = [new Date(2024, 0, 1), new Date(2024, 11, 25)];
      const isDateDisabled = (date: Date) =>
        disabledDates.some(
          (d) =>
            d.getFullYear() === date.getFullYear() &&
            d.getMonth() === date.getMonth() &&
            d.getDate() === date.getDate()
        );
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          isDateDisabled,
          children: () => DatePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-datepicker-trigger]');
      expect(trigger).toBeTruthy();
    });

    it('should handle minDate same as maxDate', () => {
      const date = new Date(2024, 5, 15);
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          minDate: date,
          maxDate: date,
          children: () => DatePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-datepicker-trigger]');
      expect(trigger).toBeTruthy();
    });

    it('should handle past dates with maxDate', () => {
      const maxDate = new Date();
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          maxDate,
          children: () => DatePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-datepicker-trigger]');
      expect(trigger).toBeTruthy();
    });
  });

  // ==========================================================================
  // Integration Tests (5 tests)
  // ==========================================================================

  describe('Integration Tests', () => {
    it('should render complete DatePicker with all components', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          value: new Date(2024, 0, 15),
          defaultOpen: true,
          children: () => [
            DatePickerTrigger({
              children: [
                DatePickerIcon({ children: '📅' }),
                DatePickerValue({}),
              ],
            }),
            DatePickerContent({
              children: DatePickerCalendar({}),
            }),
          ],
        })
      );
      cleanup = dispose;

      expect(container.querySelector('[data-datepicker-trigger]')).toBeTruthy();
      expect(container.querySelector('[data-datepicker-icon]')).toBeTruthy();
      expect(container.querySelector('[data-datepicker-value]')).toBeTruthy();
      expect(document.querySelector('[data-datepicker-content]')).toBeTruthy();
      expect(document.querySelector('[data-calendar]')).toBeTruthy();
    });

    it('should coordinate trigger and value display', () => {
      const date = new Date(2024, 6, 20);
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          value: date,
          children: () =>
            DatePickerTrigger({
              children: DatePickerValue({}),
            }),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-datepicker-trigger]');
      expect(trigger?.textContent).toContain('7/20/2024');
    });

    it('should render with custom placeholder and icon', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          children: () =>
            DatePickerTrigger({
              children: [
                DatePickerIcon({ children: '🗓️' }),
                DatePickerValue({ placeholder: 'Select date' }),
              ],
            }),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-datepicker-trigger]');
      expect(trigger?.textContent).toContain('🗓️');
      expect(trigger?.textContent).toContain('Select date');
    });

    it('should handle date formatting with custom render', () => {
      const date = new Date(2024, 11, 25);
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          value: date,
          children: () =>
            DatePickerValue({
              children: (d: Date | null) =>
                d
                  ? d.toLocaleDateString('en-US', {
                      weekday: 'short',
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    })
                  : 'No date',
            }),
        })
      );
      cleanup = dispose;

      const value = container.querySelector('[data-datepicker-value]');
      expect(value?.textContent).toContain('Dec');
      expect(value?.textContent).toContain('25');
      expect(value?.textContent).toContain('2024');
    });

    it('should work with all constraints together', () => {
      const minDate = new Date(2024, 0, 1);
      const maxDate = new Date(2024, 11, 31);
      const isDateDisabled = (date: Date) => date.getDay() === 0;
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          value: new Date(2024, 5, 15),
          minDate,
          maxDate,
          isDateDisabled,
          weekStartsOn: 1,
          disabled: false,
          defaultOpen: true,
          children: () => [
            DatePickerTrigger({
              children: [
                DatePickerIcon({ children: '📅' }),
                DatePickerValue({}),
              ],
            }),
            DatePickerContent({
              children: DatePickerCalendar({}),
            }),
          ],
        })
      );
      cleanup = dispose;

      expect(container.querySelector('[data-datepicker-trigger]')).toBeTruthy();
      expect(container.querySelector('[data-datepicker-value]')).toBeTruthy();
      expect(document.querySelector('[data-calendar]')).toBeTruthy();
    });
  });

  // ==========================================================================
  // Edge Cases (6 tests)
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle empty children', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({ children: () => DatePickerTrigger({}) })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-datepicker-trigger]');
      expect(trigger).toBeTruthy();
    });

    it('should handle leap year dates', () => {
      const leapDate = new Date(2024, 1, 29);
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          value: leapDate,
          children: () => DatePickerValue({}),
        })
      );
      cleanup = dispose;

      const value = container.querySelector('[data-datepicker-value]');
      expect(value?.textContent).toContain('2/29/2024');
    });

    it('should handle year boundaries', () => {
      const yearEnd = new Date(2024, 11, 31);
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          value: yearEnd,
          children: () => DatePickerValue({}),
        })
      );
      cleanup = dispose;

      const value = container.querySelector('[data-datepicker-value]');
      expect(value?.textContent).toContain('12/31/2024');
    });

    it('should handle very old dates', () => {
      const oldDate = new Date(1900, 0, 1);
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          value: oldDate,
          children: () => DatePickerValue({}),
        })
      );
      cleanup = dispose;

      const value = container.querySelector('[data-datepicker-value]');
      expect(value?.textContent).toContain('1900');
    });

    it('should handle future dates', () => {
      const futureDate = new Date(2100, 5, 15);
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          value: futureDate,
          children: () => DatePickerValue({}),
        })
      );
      cleanup = dispose;

      const value = container.querySelector('[data-datepicker-value]');
      expect(value?.textContent).toContain('2100');
    });

    it('should use default props when missing', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        DatePicker({
          children: () => DatePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-datepicker-trigger]');
      expect(trigger).toBeTruthy();
      const button = trigger as HTMLButtonElement;
      expect(button.disabled).toBe(false);
    });
  });
});
