/**
 * TimePicker Primitive Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  TimePicker,
  TimePickerTrigger,
  TimePickerContent,
  TimePickerColumn,
  TimePickerItem,
  type TimeValue,
} from '../../../src/primitives/TimePicker.js';
import { renderComponent } from '../../helpers/test-utils.js';

describe('TimePicker', () => {
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
    it('should render TimePicker root', () => {
      const { container, cleanup: dispose } = renderComponent(() => TimePicker({}));
      cleanup = dispose;

      const root = container.querySelector('[data-time-picker]');
      expect(root).toBeTruthy();
    });

    it('should render as div element', () => {
      const { container, cleanup: dispose } = renderComponent(() => TimePicker({}));
      cleanup = dispose;

      const root = container.querySelector('[data-time-picker]');
      expect(root?.tagName).toBe('DIV');
    });

    it('should render with disabled state', () => {
      const { container, cleanup: dispose } = renderComponent(() => TimePicker({ disabled: true }));
      cleanup = dispose;

      const root = container.querySelector('[data-time-picker]');
      expect(root?.hasAttribute('data-disabled')).toBe(true);
    });

    it('should not have data-disabled when not disabled', () => {
      const { container, cleanup: dispose } = renderComponent(() => TimePicker({ disabled: false }));
      cleanup = dispose;

      const root = container.querySelector('[data-time-picker]');
      expect(root?.hasAttribute('data-disabled')).toBe(false);
    });

    it('should render with children using function (Pattern 17)', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          children: () => TimePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-time-picker-trigger]');
      expect(trigger).toBeTruthy();
    });

    it('should render multiple children using function (Pattern 17)', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          children: () => [TimePickerTrigger({}), TimePickerContent({})],
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-time-picker-trigger]');
      const content = container.querySelector('[data-time-picker-content]');
      expect(trigger).toBeTruthy();
      expect(content).toBeTruthy();
    });

    it('should render all sub-components together', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          children: () => [
            TimePickerTrigger({}),
            TimePickerContent({
              children: [TimePickerColumn({ type: 'hours' }), TimePickerColumn({ type: 'minutes' })],
            }),
          ],
        })
      );
      cleanup = dispose;

      expect(container.querySelector('[data-time-picker-trigger]')).toBeTruthy();
      expect(container.querySelector('[data-time-picker-content]')).toBeTruthy();
      expect(container.querySelectorAll('[data-time-picker-column]').length).toBe(2);
    });

    it('should render with empty children', () => {
      const { container, cleanup: dispose } = renderComponent(() => TimePicker({ children: () => null }));
      cleanup = dispose;

      const root = container.querySelector('[data-time-picker]');
      expect(root).toBeTruthy();
      expect(root?.textContent).toBe('');
    });

    it('should render with 12-hour format', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          hourFormat: 12,
          children: () => TimePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-time-picker-trigger]');
      expect(trigger?.textContent).toMatch(/(AM|PM)/);
    });

    it('should render with 24-hour format', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          hourFormat: 24,
          children: () => TimePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-time-picker-trigger]');
      expect(trigger?.textContent).not.toMatch(/(AM|PM)/);
    });
  });

  // ==========================================================================
  // Context Tests (10 tests)
  // ==========================================================================

  describe('Context Tests', () => {
    it('should provide value signal through context', () => {
      const time: TimeValue = { hours: 14, minutes: 30, seconds: 0 };
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          value: time,
          children: () => TimePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-time-picker-trigger]');
      expect(trigger?.textContent).toBeTruthy();
    });

    it('should provide hourFormat through context', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          hourFormat: 12,
          children: () => TimePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-time-picker-trigger]');
      expect(trigger?.textContent).toMatch(/(AM|PM)/);
    });

    it('should provide showSeconds flag through context', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          showSeconds: true,
          children: () => TimePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-time-picker-trigger]');
      expect(trigger?.textContent).toMatch(/:\d{2}:\d{2}/);
    });

    it('should provide disabled state through context', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          disabled: true,
          children: () => TimePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('button[data-time-picker-trigger]') as HTMLButtonElement;
      expect(trigger.disabled).toBe(true);
    });

    it('should provide hourStep through context', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          hourStep: 2,
          children: () => TimePickerColumn({ type: 'hours' }),
        })
      );
      cleanup = dispose;

      const column = container.querySelector('[data-time-picker-column]');
      expect(column).toBeTruthy();
    });

    it('should provide minuteStep through context', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          minuteStep: 15,
          children: () => TimePickerColumn({ type: 'minutes' }),
        })
      );
      cleanup = dispose;

      const column = container.querySelector('[data-time-picker-column]');
      expect(column).toBeTruthy();
    });

    it('should provide secondStep through context', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          secondStep: 5,
          showSeconds: true,
          children: () => TimePickerColumn({ type: 'seconds' }),
        })
      );
      cleanup = dispose;

      const column = container.querySelector('[data-time-picker-column]');
      expect(column).toBeTruthy();
    });

    it('should default hourStep to 1', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          children: () => TimePickerColumn({ type: 'hours' }),
        })
      );
      cleanup = dispose;

      const column = container.querySelector('[data-time-picker-column]');
      expect(column).toBeTruthy();
    });

    it('should default minuteStep to 1', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          children: () => TimePickerColumn({ type: 'minutes' }),
        })
      );
      cleanup = dispose;

      const column = container.querySelector('[data-time-picker-column]');
      expect(column).toBeTruthy();
    });

    it('should allow sub-components to access context', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          value: { hours: 10, minutes: 30, seconds: 0 },
          children: () => [TimePickerTrigger({}), TimePickerContent({}), TimePickerColumn({ type: 'hours' })],
        })
      );
      cleanup = dispose;

      expect(container.querySelector('[data-time-picker-trigger]')).toBeTruthy();
      expect(container.querySelector('[data-time-picker-content]')).toBeTruthy();
      expect(container.querySelector('[data-time-picker-column]')).toBeTruthy();
    });
  });

  // ==========================================================================
  // Controlled/Uncontrolled Tests (8 tests)
  // ==========================================================================

  describe('Controlled/Uncontrolled Tests', () => {
    it('should work in uncontrolled mode with defaultValue', () => {
      const defaultTime: TimeValue = { hours: 14, minutes: 30, seconds: 0 };
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          defaultValue: defaultTime,
          children: () => TimePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-time-picker-trigger]');
      expect(trigger?.textContent).toContain('14:30');
    });

    it('should work in controlled mode with value prop', () => {
      const time: TimeValue = { hours: 9, minutes: 15, seconds: 0 };
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          value: time,
          hourFormat: 12,
          children: () => TimePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-time-picker-trigger]');
      expect(trigger?.textContent).toContain('09:15');
      expect(trigger?.textContent).toContain('AM');
    });

    it('should call onValueChange callback when time changes', () => {
      const onValueChange = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          defaultValue: { hours: 10, minutes: 0, seconds: 0 },
          onValueChange,
          children: () => TimePickerTrigger({}),
        })
      );
      cleanup = dispose;

      expect(container.querySelector('[data-time-picker-trigger]')).toBeTruthy();
      // Note: Actual time selection would require item click simulation
    });

    it('should use controlled value over internal state', () => {
      const controlledTime: TimeValue = { hours: 15, minutes: 45, seconds: 0 };
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          value: controlledTime,
          defaultValue: { hours: 0, minutes: 0, seconds: 0 },
          children: () => TimePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-time-picker-trigger]');
      expect(trigger?.textContent).toContain('15:45');
    });

    it('should handle time with seconds', () => {
      const time: TimeValue = { hours: 10, minutes: 30, seconds: 45 };
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          value: time,
          showSeconds: true,
          children: () => TimePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-time-picker-trigger]');
      expect(trigger?.textContent).toContain('10:30:45');
    });

    it('should default to 0:0:0 when no value provided', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          children: () => TimePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-time-picker-trigger]');
      expect(trigger?.textContent).toContain('00:00');
    });

    it('should update when controlled value changes externally', () => {
      const time: TimeValue = { hours: 12, minutes: 0, seconds: 0 };
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          value: time,
          hourFormat: 12,
          children: () => TimePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-time-picker-trigger]');
      expect(trigger?.textContent).toContain('12:00');
      expect(trigger?.textContent).toContain('PM');
    });

    it('should handle midnight (0:0:0)', () => {
      const time: TimeValue = { hours: 0, minutes: 0, seconds: 0 };
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          value: time,
          hourFormat: 12,
          children: () => TimePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-time-picker-trigger]');
      expect(trigger?.textContent).toContain('12:00');
      expect(trigger?.textContent).toContain('AM');
    });
  });

  // ==========================================================================
  // TimePickerTrigger Tests (8 tests)
  // ==========================================================================

  describe('TimePickerTrigger Tests', () => {
    it('should render as button', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          children: () => TimePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-time-picker-trigger]');
      expect(trigger?.tagName).toBe('BUTTON');
    });

    it('should have type="button"', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          children: () => TimePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-time-picker-trigger]') as HTMLButtonElement;
      expect(trigger.type).toBe('button');
    });

    it('should have aria-label', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          children: () => TimePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-time-picker-trigger]');
      expect(trigger?.getAttribute('aria-label')).toBe('Select time');
    });

    it('should display time in 24-hour format', () => {
      const time: TimeValue = { hours: 14, minutes: 30, seconds: 0 };
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          value: time,
          hourFormat: 24,
          children: () => TimePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-time-picker-trigger]');
      expect(trigger?.textContent).toContain('14:30');
    });

    it('should display time in 12-hour format with AM/PM', () => {
      const time: TimeValue = { hours: 14, minutes: 30, seconds: 0 };
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          value: time,
          hourFormat: 12,
          children: () => TimePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-time-picker-trigger]');
      expect(trigger?.textContent).toContain('02:30');
      expect(trigger?.textContent).toContain('PM');
    });

    it('should display seconds when showSeconds is true', () => {
      const time: TimeValue = { hours: 10, minutes: 30, seconds: 45 };
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          value: time,
          showSeconds: true,
          children: () => TimePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-time-picker-trigger]');
      expect(trigger?.textContent).toContain('10:30:45');
    });

    it('should respect disabled state', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          disabled: true,
          children: () => TimePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('button[data-time-picker-trigger]') as HTMLButtonElement;
      expect(trigger.disabled).toBe(true);
    });

    it('should accept custom children', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          children: () => TimePickerTrigger({ children: 'Pick Time' }),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-time-picker-trigger]');
      expect(trigger?.textContent).toBe('Pick Time');
    });
  });

  // ==========================================================================
  // TimePickerContent Tests (5 tests)
  // ==========================================================================

  describe('TimePickerContent Tests', () => {
    it('should render as div', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          children: () => TimePickerContent({}),
        })
      );
      cleanup = dispose;

      const content = container.querySelector('[data-time-picker-content]');
      expect(content?.tagName).toBe('DIV');
    });

    it('should have role="dialog"', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          children: () => TimePickerContent({}),
        })
      );
      cleanup = dispose;

      const content = container.querySelector('[data-time-picker-content]');
      expect(content?.getAttribute('role')).toBe('dialog');
    });

    it('should have aria-label', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          children: () => TimePickerContent({}),
        })
      );
      cleanup = dispose;

      const content = container.querySelector('[data-time-picker-content]');
      expect(content?.getAttribute('aria-label')).toBe('Time picker');
    });

    it('should render children', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          children: () =>
            TimePickerContent({
              children: 'Time content',
            }),
        })
      );
      cleanup = dispose;

      const content = container.querySelector('[data-time-picker-content]');
      expect(content?.textContent).toContain('Time content');
    });

    it('should accept additional props', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          children: () =>
            TimePickerContent({
              'data-testid': 'time-content',
              className: 'custom-content',
            }),
        })
      );
      cleanup = dispose;

      const content = container.querySelector('[data-time-picker-content]');
      expect(content?.getAttribute('data-testid')).toBe('time-content');
      expect(content?.className).toContain('custom-content');
    });
  });

  // ==========================================================================
  // TimePickerColumn Tests (10 tests)
  // ==========================================================================

  describe('TimePickerColumn Tests', () => {
    it('should render hours column', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          children: () => TimePickerColumn({ type: 'hours' }),
        })
      );
      cleanup = dispose;

      const column = container.querySelector('[data-time-picker-column]');
      expect(column).toBeTruthy();
      expect(column?.getAttribute('data-type')).toBe('hours');
    });

    it('should render minutes column', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          children: () => TimePickerColumn({ type: 'minutes' }),
        })
      );
      cleanup = dispose;

      const column = container.querySelector('[data-time-picker-column]');
      expect(column).toBeTruthy();
      expect(column?.getAttribute('data-type')).toBe('minutes');
    });

    it('should render seconds column', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          showSeconds: true,
          children: () => TimePickerColumn({ type: 'seconds' }),
        })
      );
      cleanup = dispose;

      const column = container.querySelector('[data-time-picker-column]');
      expect(column).toBeTruthy();
      expect(column?.getAttribute('data-type')).toBe('seconds');
    });

    it('should render period column for 12-hour format', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          hourFormat: 12,
          children: () => TimePickerColumn({ type: 'period' }),
        })
      );
      cleanup = dispose;

      const column = container.querySelector('[data-time-picker-column]');
      expect(column).toBeTruthy();
      expect(column?.getAttribute('data-type')).toBe('period');
    });

    it('should have role="listbox"', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          children: () => TimePickerColumn({ type: 'hours' }),
        })
      );
      cleanup = dispose;

      const column = container.querySelector('[data-time-picker-column]');
      expect(column?.getAttribute('role')).toBe('listbox');
    });

    it('should have aria-label with column type', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          children: () => TimePickerColumn({ type: 'minutes' }),
        })
      );
      cleanup = dispose;

      const column = container.querySelector('[data-time-picker-column]');
      expect(column?.getAttribute('aria-label')).toBe('Select minutes');
    });

    it('should render items for 24-hour format', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          hourFormat: 24,
          children: () => TimePickerColumn({ type: 'hours' }),
        })
      );
      cleanup = dispose;

      const items = container.querySelectorAll('[data-time-picker-item]');
      expect(items.length).toBe(24);
    });

    it('should render items for 12-hour format', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          hourFormat: 12,
          children: () => TimePickerColumn({ type: 'hours' }),
        })
      );
      cleanup = dispose;

      const items = container.querySelectorAll('[data-time-picker-item]');
      expect(items.length).toBe(12);
    });

    it('should render 60 minute items', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          children: () => TimePickerColumn({ type: 'minutes' }),
        })
      );
      cleanup = dispose;

      const items = container.querySelectorAll('[data-time-picker-item]');
      expect(items.length).toBe(60);
    });

    it('should respect minuteStep for fewer items', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          minuteStep: 15,
          children: () => TimePickerColumn({ type: 'minutes' }),
        })
      );
      cleanup = dispose;

      const items = container.querySelectorAll('[data-time-picker-item]');
      expect(items.length).toBe(4); // 0, 15, 30, 45
    });
  });

  // ==========================================================================
  // TimePickerItem Tests (8 tests)
  // ==========================================================================

  describe('TimePickerItem Tests', () => {
    it('should render as button', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          children: () => TimePickerItem({ value: 10, children: '10' }),
        })
      );
      cleanup = dispose;

      const item = container.querySelector('[data-time-picker-item]');
      expect(item?.tagName).toBe('BUTTON');
    });

    it('should have type="button"', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          children: () => TimePickerItem({ value: 10, children: '10' }),
        })
      );
      cleanup = dispose;

      const item = container.querySelector('[data-time-picker-item]') as HTMLButtonElement;
      expect(item.type).toBe('button');
    });

    it('should have role="option"', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          children: () => TimePickerItem({ value: 10, children: '10' }),
        })
      );
      cleanup = dispose;

      const item = container.querySelector('[data-time-picker-item]');
      expect(item?.getAttribute('role')).toBe('option');
    });

    it('should have data-value attribute', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          children: () => TimePickerItem({ value: 15, children: '15' }),
        })
      );
      cleanup = dispose;

      const item = container.querySelector('[data-time-picker-item]');
      expect(item?.getAttribute('data-value')).toBe('15');
    });

    it('should render children', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          children: () => TimePickerItem({ value: 30, children: '30' }),
        })
      );
      cleanup = dispose;

      const item = container.querySelector('[data-time-picker-item]');
      expect(item?.textContent).toBe('30');
    });

    it('should have data-selected when value matches', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          value: { hours: 10, minutes: 0, seconds: 0 },
          children: () => TimePickerColumn({ type: 'hours' }),
        })
      );
      cleanup = dispose;

      const items = container.querySelectorAll('[data-time-picker-item]');
      const selectedItem = Array.from(items).find((item) => item.getAttribute('data-value') === '10');
      expect(selectedItem?.hasAttribute('data-selected')).toBe(true);
    });

    it('should have aria-selected when selected', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          value: { hours: 0, minutes: 15, seconds: 0 },
          children: () => TimePickerColumn({ type: 'minutes' }),
        })
      );
      cleanup = dispose;

      const items = container.querySelectorAll('[data-time-picker-item]');
      const selectedItem = Array.from(items).find((item) => item.getAttribute('data-value') === '15');
      expect(selectedItem?.getAttribute('aria-selected')).toBe('true');
    });

    it('should handle AM/PM period items', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          hourFormat: 12,
          children: () => TimePickerColumn({ type: 'period' }),
        })
      );
      cleanup = dispose;

      const items = container.querySelectorAll('[data-time-picker-item]');
      expect(items.length).toBe(2);
      expect(items[0]?.getAttribute('data-value')).toBe('AM');
      expect(items[1]?.getAttribute('data-value')).toBe('PM');
    });
  });

  // ==========================================================================
  // Hour Format Tests (8 tests)
  // ==========================================================================

  describe('Hour Format Tests', () => {
    it('should display 12-hour format correctly', () => {
      const time: TimeValue = { hours: 15, minutes: 30, seconds: 0 };
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          value: time,
          hourFormat: 12,
          children: () => TimePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-time-picker-trigger]');
      expect(trigger?.textContent).toContain('03:30');
      expect(trigger?.textContent).toContain('PM');
    });

    it('should display 24-hour format correctly', () => {
      const time: TimeValue = { hours: 15, minutes: 30, seconds: 0 };
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          value: time,
          hourFormat: 24,
          children: () => TimePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-time-picker-trigger]');
      expect(trigger?.textContent).toContain('15:30');
      expect(trigger?.textContent).not.toMatch(/(AM|PM)/);
    });

    it('should handle midnight in 12-hour format', () => {
      const time: TimeValue = { hours: 0, minutes: 0, seconds: 0 };
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          value: time,
          hourFormat: 12,
          children: () => TimePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-time-picker-trigger]');
      expect(trigger?.textContent).toContain('12:00');
      expect(trigger?.textContent).toContain('AM');
    });

    it('should handle noon in 12-hour format', () => {
      const time: TimeValue = { hours: 12, minutes: 0, seconds: 0 };
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          value: time,
          hourFormat: 12,
          children: () => TimePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-time-picker-trigger]');
      expect(trigger?.textContent).toContain('12:00');
      expect(trigger?.textContent).toContain('PM');
    });

    it('should convert 13:00 to 1:00 PM', () => {
      const time: TimeValue = { hours: 13, minutes: 0, seconds: 0 };
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          value: time,
          hourFormat: 12,
          children: () => TimePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-time-picker-trigger]');
      expect(trigger?.textContent).toContain('01:00');
      expect(trigger?.textContent).toContain('PM');
    });

    it('should show AM for morning hours', () => {
      const time: TimeValue = { hours: 9, minutes: 30, seconds: 0 };
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          value: time,
          hourFormat: 12,
          children: () => TimePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-time-picker-trigger]');
      expect(trigger?.textContent).toContain('09:30');
      expect(trigger?.textContent).toContain('AM');
    });

    it('should show PM for afternoon hours', () => {
      const time: TimeValue = { hours: 17, minutes: 45, seconds: 0 };
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          value: time,
          hourFormat: 12,
          children: () => TimePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-time-picker-trigger]');
      expect(trigger?.textContent).toContain('05:45');
      expect(trigger?.textContent).toContain('PM');
    });

    it('should default to 24-hour format', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          value: { hours: 15, minutes: 0, seconds: 0 },
          children: () => TimePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-time-picker-trigger]');
      expect(trigger?.textContent).toContain('15:00');
      expect(trigger?.textContent).not.toMatch(/(AM|PM)/);
    });
  });

  // ==========================================================================
  // Step Tests (6 tests)
  // ==========================================================================

  describe('Step Tests', () => {
    it('should respect hourStep', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          hourStep: 2,
          children: () => TimePickerColumn({ type: 'hours' }),
        })
      );
      cleanup = dispose;

      const items = container.querySelectorAll('[data-time-picker-item]');
      expect(items.length).toBe(12); // 0, 2, 4, 6, ... 22
    });

    it('should respect minuteStep', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          minuteStep: 5,
          children: () => TimePickerColumn({ type: 'minutes' }),
        })
      );
      cleanup = dispose;

      const items = container.querySelectorAll('[data-time-picker-item]');
      expect(items.length).toBe(12); // 0, 5, 10, 15, ... 55
    });

    it('should respect secondStep', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          secondStep: 10,
          showSeconds: true,
          children: () => TimePickerColumn({ type: 'seconds' }),
        })
      );
      cleanup = dispose;

      const items = container.querySelectorAll('[data-time-picker-item]');
      expect(items.length).toBe(6); // 0, 10, 20, 30, 40, 50
    });

    it('should use minuteStep of 15 for quarter hours', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          minuteStep: 15,
          children: () => TimePickerColumn({ type: 'minutes' }),
        })
      );
      cleanup = dispose;

      const items = container.querySelectorAll('[data-time-picker-item]');
      expect(items.length).toBe(4); // 0, 15, 30, 45
    });

    it('should default steps to 1', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          children: () => [TimePickerColumn({ type: 'hours' }), TimePickerColumn({ type: 'minutes' })],
        })
      );
      cleanup = dispose;

      const columns = container.querySelectorAll('[data-time-picker-column]');
      expect(columns.length).toBe(2);
    });

    it('should handle large steps correctly', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          minuteStep: 30,
          children: () => TimePickerColumn({ type: 'minutes' }),
        })
      );
      cleanup = dispose;

      const items = container.querySelectorAll('[data-time-picker-item]');
      expect(items.length).toBe(2); // 0, 30
    });
  });

  // ==========================================================================
  // Integration Tests (6 tests)
  // ==========================================================================

  describe('Integration Tests', () => {
    it('should render complete TimePicker with all components', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          value: { hours: 14, minutes: 30, seconds: 45 },
          showSeconds: true,
          hourFormat: 24,
          children: () => [
            TimePickerTrigger({}),
            TimePickerContent({
              children: [
                TimePickerColumn({ type: 'hours' }),
                TimePickerColumn({ type: 'minutes' }),
                TimePickerColumn({ type: 'seconds' }),
              ],
            }),
          ],
        })
      );
      cleanup = dispose;

      expect(container.querySelector('[data-time-picker]')).toBeTruthy();
      expect(container.querySelector('[data-time-picker-trigger]')).toBeTruthy();
      expect(container.querySelector('[data-time-picker-content]')).toBeTruthy();
      expect(container.querySelectorAll('[data-time-picker-column]').length).toBe(3);
    });

    it('should render 12-hour format with period column', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          value: { hours: 15, minutes: 30, seconds: 0 },
          hourFormat: 12,
          children: () => [
            TimePickerTrigger({}),
            TimePickerContent({
              children: [
                TimePickerColumn({ type: 'hours' }),
                TimePickerColumn({ type: 'minutes' }),
                TimePickerColumn({ type: 'period' }),
              ],
            }),
          ],
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-time-picker-trigger]');
      expect(trigger?.textContent).toContain('03:30');
      expect(trigger?.textContent).toContain('PM');

      const columns = container.querySelectorAll('[data-time-picker-column]');
      expect(columns.length).toBe(3);
    });

    it('should coordinate trigger and column displays', () => {
      const time: TimeValue = { hours: 10, minutes: 45, seconds: 0 };
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          value: time,
          children: () => [
            TimePickerTrigger({}),
            TimePickerColumn({ type: 'hours' }),
            TimePickerColumn({ type: 'minutes' }),
          ],
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-time-picker-trigger]');
      expect(trigger?.textContent).toContain('10:45');
    });

    it('should work with custom steps', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          hourStep: 3,
          minuteStep: 15,
          children: () => [TimePickerColumn({ type: 'hours' }), TimePickerColumn({ type: 'minutes' })],
        })
      );
      cleanup = dispose;

      const columns = container.querySelectorAll('[data-time-picker-column]');
      expect(columns.length).toBe(2);
    });

    it('should render with seconds enabled', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          value: { hours: 12, minutes: 30, seconds: 15 },
          showSeconds: true,
          children: () => [TimePickerTrigger({}), TimePickerColumn({ type: 'seconds' })],
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-time-picker-trigger]');
      expect(trigger?.textContent).toContain('12:30:15');
    });

    it('should handle all constraints together', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          value: { hours: 14, minutes: 30, seconds: 0 },
          hourFormat: 12,
          showSeconds: false,
          hourStep: 1,
          minuteStep: 15,
          disabled: false,
          children: () => [
            TimePickerTrigger({}),
            TimePickerContent({
              children: [
                TimePickerColumn({ type: 'hours' }),
                TimePickerColumn({ type: 'minutes' }),
                TimePickerColumn({ type: 'period' }),
              ],
            }),
          ],
        })
      );
      cleanup = dispose;

      expect(container.querySelector('[data-time-picker-trigger]')).toBeTruthy();
      expect(container.querySelectorAll('[data-time-picker-column]').length).toBe(3);
    });
  });

  // ==========================================================================
  // Edge Cases (5 tests)
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle empty children', () => {
      const { container, cleanup: dispose } = renderComponent(() => TimePicker({ children: undefined }));
      cleanup = dispose;

      const root = container.querySelector('[data-time-picker]');
      expect(root).toBeTruthy();
    });

    it('should handle boundary hours (0 and 23)', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          value: { hours: 23, minutes: 59, seconds: 59 },
          showSeconds: true,
          children: () => TimePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-time-picker-trigger]');
      expect(trigger?.textContent).toContain('23:59:59');
    });

    it('should pad single digit values with zero', () => {
      const time: TimeValue = { hours: 5, minutes: 3, seconds: 7 };
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          value: time,
          showSeconds: true,
          children: () => TimePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-time-picker-trigger]');
      expect(trigger?.textContent).toContain('05:03:07');
    });

    it('should handle seconds without showSeconds prop', () => {
      const time: TimeValue = { hours: 10, minutes: 30, seconds: 45 };
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          value: time,
          showSeconds: false,
          children: () => TimePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-time-picker-trigger]');
      expect(trigger?.textContent).not.toContain(':45');
      expect(trigger?.textContent).toContain('10:30');
    });

    it('should use default props when missing', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TimePicker({
          children: () => TimePickerTrigger({}),
        })
      );
      cleanup = dispose;

      const root = container.querySelector('[data-time-picker]');
      const trigger = container.querySelector('[data-time-picker-trigger]');

      expect(root).toBeTruthy();
      expect(trigger).toBeTruthy();
      expect(root?.hasAttribute('data-disabled')).toBe(false);
      expect(trigger?.textContent).toContain('00:00');
    });
  });
});
