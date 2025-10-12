/**
 * Calendar Primitive Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  Calendar,
  CalendarHeader,
  CalendarPrevButton,
  CalendarNextButton,
  CalendarHeading,
  CalendarGrid,
  CalendarGridHead,
  CalendarHeadCell,
  CalendarGridBody,
  CalendarCell,
} from '../../../src/primitives/Calendar.js';
import { renderComponent, nextTick } from '../../helpers/test-utils.js';

describe('Calendar', () => {
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
  // Calendar Root Rendering Tests (10 tests)
  // ==========================================================================

  describe('Calendar Root Rendering Tests', () => {
    it('should render Calendar root', () => {
      const { container, cleanup: dispose } = renderComponent(() => Calendar({}));
      cleanup = dispose;

      const root = container.querySelector('[data-calendar]');
      expect(root).toBeTruthy();
    });

    it('should render as div element', () => {
      const { container, cleanup: dispose } = renderComponent(() => Calendar({}));
      cleanup = dispose;

      const root = container.querySelector('[data-calendar]');
      expect(root?.tagName).toBe('DIV');
    });

    it('should have role="application"', () => {
      const { container, cleanup: dispose } = renderComponent(() => Calendar({}));
      cleanup = dispose;

      const root = container.querySelector('[data-calendar]');
      expect(root?.getAttribute('role')).toBe('application');
    });

    it('should have aria-label="Calendar"', () => {
      const { container, cleanup: dispose } = renderComponent(() => Calendar({}));
      cleanup = dispose;

      const root = container.querySelector('[data-calendar]');
      expect(root?.getAttribute('aria-label')).toBe('Calendar');
    });

    it('should render with disabled state', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({ disabled: true })
      );
      cleanup = dispose;

      const root = container.querySelector('[data-calendar]');
      expect(root?.hasAttribute('data-disabled')).toBe(true);
    });

    it('should not have data-disabled when not disabled', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({ disabled: false })
      );
      cleanup = dispose;

      const root = container.querySelector('[data-calendar]');
      expect(root?.hasAttribute('data-disabled')).toBe(false);
    });

    it('should render with function children (Pattern 17)', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          children: () => CalendarHeader({ children: 'Header' }),
        })
      );
      cleanup = dispose;

      const header = container.querySelector('[data-calendar-header]');
      expect(header).toBeTruthy();
      expect(header?.textContent).toBe('Header');
    });

    it('should render multiple children using function (Pattern 17)', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          children: () => [
            CalendarHeader({ children: 'Header' }),
            CalendarGrid({ children: 'Grid' }),
          ],
        })
      );
      cleanup = dispose;

      const header = container.querySelector('[data-calendar-header]');
      const grid = container.querySelector('[data-calendar-grid]');
      expect(header).toBeTruthy();
      expect(grid).toBeTruthy();
    });

    it('should render with empty children', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({ children: () => null })
      );
      cleanup = dispose;

      const root = container.querySelector('[data-calendar]');
      expect(root).toBeTruthy();
    });

    it('should accept custom class', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({ class: 'custom-calendar' })
      );
      cleanup = dispose;

      const root = container.querySelector('[data-calendar]');
      expect(root?.className).toContain('custom-calendar');
    });
  });

  // ==========================================================================
  // Calendar Context Tests (8 tests)
  // ==========================================================================

  describe('Calendar Context Tests', () => {
    it('should provide currentMonth signal through context', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          defaultMonth: new Date(2024, 0, 15),
          children: () => CalendarHeading({}),
        })
      );
      cleanup = dispose;

      const heading = container.querySelector('[data-calendar-heading]');
      expect(heading?.textContent).toContain('January');
      expect(heading?.textContent).toContain('2024');
    });

    it('should provide value signal through context', () => {
      const testDate = new Date(2024, 5, 15);
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          defaultValue: testDate,
          children: () => CalendarGridBody({}),
        })
      );
      cleanup = dispose;

      const gridBody = container.querySelector('[data-calendar-grid-body]');
      expect(gridBody).toBeTruthy();
    });

    it('should provide disabled state through context', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          disabled: true,
          children: () => CalendarPrevButton({ children: 'Prev' }),
        })
      );
      cleanup = dispose;

      const button = container.querySelector('button[data-calendar-prev-button]') as HTMLButtonElement;
      expect(button.disabled).toBe(true);
    });

    it('should provide weekStartsOn through context', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          weekStartsOn: 1,
          defaultMonth: new Date(2024, 0, 1),
          children: () => CalendarGridBody({}),
        })
      );
      cleanup = dispose;

      const gridBody = container.querySelector('[data-calendar-grid-body]');
      expect(gridBody).toBeTruthy();
    });

    it('should provide navigation functions through context', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          children: () => [
            CalendarPrevButton({ children: 'Prev' }),
            CalendarNextButton({ children: 'Next' }),
          ],
        })
      );
      cleanup = dispose;

      const prevButton = container.querySelector('[data-calendar-prev-button]');
      const nextButton = container.querySelector('[data-calendar-next-button]');
      expect(prevButton).toBeTruthy();
      expect(nextButton).toBeTruthy();
    });

    it('should provide monthName computed signal', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          defaultMonth: new Date(2024, 6, 15),
          children: () => CalendarHeading({}),
        })
      );
      cleanup = dispose;

      const heading = container.querySelector('[data-calendar-heading]');
      expect(heading?.textContent).toContain('July');
    });

    it('should provide year computed signal', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          defaultMonth: new Date(2025, 0, 1),
          children: () => CalendarHeading({}),
        })
      );
      cleanup = dispose;

      const heading = container.querySelector('[data-calendar-heading]');
      expect(heading?.textContent).toContain('2025');
    });

    it('should allow all sub-components to access context', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          children: () => [
            CalendarHeader({}),
            CalendarPrevButton({}),
            CalendarNextButton({}),
            CalendarHeading({}),
            CalendarGrid({}),
          ],
        })
      );
      cleanup = dispose;

      expect(container.querySelector('[data-calendar-header]')).toBeTruthy();
      expect(container.querySelector('[data-calendar-prev-button]')).toBeTruthy();
      expect(container.querySelector('[data-calendar-next-button]')).toBeTruthy();
      expect(container.querySelector('[data-calendar-heading]')).toBeTruthy();
      expect(container.querySelector('[data-calendar-grid]')).toBeTruthy();
    });
  });

  // ==========================================================================
  // Controlled/Uncontrolled Tests (8 tests)
  // ==========================================================================

  describe('Controlled/Uncontrolled Tests', () => {
    it('should work in uncontrolled mode with defaultValue', () => {
      const testDate = new Date(2024, 3, 10);
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          defaultValue: testDate,
          children: () => CalendarGridBody({}),
        })
      );
      cleanup = dispose;

      const gridBody = container.querySelector('[data-calendar-grid-body]');
      expect(gridBody).toBeTruthy();
    });

    it('should work in controlled mode with value prop', () => {
      const controlledDate = new Date(2024, 7, 20);
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          value: controlledDate,
          children: () => CalendarGridBody({}),
        })
      );
      cleanup = dispose;

      const gridBody = container.querySelector('[data-calendar-grid-body]');
      expect(gridBody).toBeTruthy();
    });

    it('should call onValueChange when date is selected', () => {
      const onValueChange = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          defaultMonth: new Date(2024, 0, 1),
          onValueChange,
          children: () => CalendarGridBody({}),
        })
      );
      cleanup = dispose;

      const cell = container.querySelector('[data-calendar-cell]') as HTMLButtonElement;
      cell?.click();

      expect(onValueChange).toHaveBeenCalled();
    });

    it('should use controlled value over internal state', () => {
      const controlledDate = new Date(2024, 11, 25);
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          value: controlledDate,
          defaultValue: new Date(2024, 0, 1),
          children: () => CalendarGridBody({}),
        })
      );
      cleanup = dispose;

      const gridBody = container.querySelector('[data-calendar-grid-body]');
      expect(gridBody).toBeTruthy();
    });

    it('should default to current date when no value provided', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          children: () => CalendarHeading({}),
        })
      );
      cleanup = dispose;

      const heading = container.querySelector('[data-calendar-heading]');
      expect(heading?.textContent).toBeTruthy();
    });

    it('should use defaultMonth when provided', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          defaultMonth: new Date(2023, 5, 1),
          children: () => CalendarHeading({}),
        })
      );
      cleanup = dispose;

      const heading = container.querySelector('[data-calendar-heading]');
      expect(heading?.textContent).toContain('June');
      expect(heading?.textContent).toContain('2023');
    });

    it('should not call onValueChange when disabled', () => {
      const onValueChange = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          disabled: true,
          defaultMonth: new Date(2024, 0, 1),
          onValueChange,
          children: () => CalendarGridBody({}),
        })
      );
      cleanup = dispose;

      const cell = container.querySelector('[data-calendar-cell]') as HTMLButtonElement;
      cell?.click();

      expect(onValueChange).not.toHaveBeenCalled();
    });

    it('should handle null value', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          value: null,
          children: () => CalendarGridBody({}),
        })
      );
      cleanup = dispose;

      const gridBody = container.querySelector('[data-calendar-grid-body]');
      expect(gridBody).toBeTruthy();
    });
  });

  // ==========================================================================
  // CalendarHeader Tests (5 tests)
  // ==========================================================================

  describe('CalendarHeader Tests', () => {
    it('should render as div', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          children: () => CalendarHeader({}),
        })
      );
      cleanup = dispose;

      const header = container.querySelector('[data-calendar-header]');
      expect(header?.tagName).toBe('DIV');
    });

    it('should render children', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          children: () => CalendarHeader({ children: 'Header Content' }),
        })
      );
      cleanup = dispose;

      const header = container.querySelector('[data-calendar-header]');
      expect(header?.textContent).toBe('Header Content');
    });

    it('should accept additional props', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          children: () => CalendarHeader({ 'data-testid': 'custom-header' }),
        })
      );
      cleanup = dispose;

      const header = container.querySelector('[data-calendar-header]');
      expect(header?.getAttribute('data-testid')).toBe('custom-header');
    });

    it('should render multiple navigation elements', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          children: () =>
            CalendarHeader({
              children: [
                CalendarPrevButton({ children: '<' }),
                CalendarHeading({}),
                CalendarNextButton({ children: '>' }),
              ],
            }),
        })
      );
      cleanup = dispose;

      expect(container.querySelector('[data-calendar-prev-button]')).toBeTruthy();
      expect(container.querySelector('[data-calendar-heading]')).toBeTruthy();
      expect(container.querySelector('[data-calendar-next-button]')).toBeTruthy();
    });

    it('should render with empty children', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          children: () => CalendarHeader({}),
        })
      );
      cleanup = dispose;

      const header = container.querySelector('[data-calendar-header]');
      expect(header).toBeTruthy();
    });
  });

  // ==========================================================================
  // CalendarPrevButton Tests (7 tests)
  // ==========================================================================

  describe('CalendarPrevButton Tests', () => {
    it('should render as button', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          children: () => CalendarPrevButton({}),
        })
      );
      cleanup = dispose;

      const button = container.querySelector('[data-calendar-prev-button]');
      expect(button?.tagName).toBe('BUTTON');
    });

    it('should have type="button"', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          children: () => CalendarPrevButton({}),
        })
      );
      cleanup = dispose;

      const button = container.querySelector('[data-calendar-prev-button]') as HTMLButtonElement;
      expect(button.type).toBe('button');
    });

    it('should have aria-label', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          children: () => CalendarPrevButton({}),
        })
      );
      cleanup = dispose;

      const button = container.querySelector('[data-calendar-prev-button]');
      expect(button?.getAttribute('aria-label')).toBe('Previous month');
    });

    it('should navigate to previous month on click', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          defaultMonth: new Date(2024, 1, 1),
          children: () => [
            CalendarPrevButton({ children: 'Prev' }),
            CalendarHeading({}),
          ],
        })
      );
      cleanup = dispose;

      const button = container.querySelector('[data-calendar-prev-button]') as HTMLButtonElement;
      const heading = container.querySelector('[data-calendar-heading]');

      expect(heading?.textContent).toContain('February');
      button.click();

      // After clicking, should show January
      expect(heading?.textContent).toContain('January');
    });

    it('should be disabled when calendar is disabled', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          disabled: true,
          children: () => CalendarPrevButton({}),
        })
      );
      cleanup = dispose;

      const button = container.querySelector('[data-calendar-prev-button]') as HTMLButtonElement;
      expect(button.disabled).toBe(true);
    });

    it('should render children', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          children: () => CalendarPrevButton({ children: '←' }),
        })
      );
      cleanup = dispose;

      const button = container.querySelector('[data-calendar-prev-button]');
      expect(button?.textContent).toBe('←');
    });

    it('should call custom onClick handler', () => {
      const onClick = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          children: () => CalendarPrevButton({ onClick }),
        })
      );
      cleanup = dispose;

      const button = container.querySelector('[data-calendar-prev-button]') as HTMLButtonElement;
      button.click();

      expect(onClick).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // CalendarNextButton Tests (7 tests)
  // ==========================================================================

  describe('CalendarNextButton Tests', () => {
    it('should render as button', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          children: () => CalendarNextButton({}),
        })
      );
      cleanup = dispose;

      const button = container.querySelector('[data-calendar-next-button]');
      expect(button?.tagName).toBe('BUTTON');
    });

    it('should have type="button"', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          children: () => CalendarNextButton({}),
        })
      );
      cleanup = dispose;

      const button = container.querySelector('[data-calendar-next-button]') as HTMLButtonElement;
      expect(button.type).toBe('button');
    });

    it('should have aria-label', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          children: () => CalendarNextButton({}),
        })
      );
      cleanup = dispose;

      const button = container.querySelector('[data-calendar-next-button]');
      expect(button?.getAttribute('aria-label')).toBe('Next month');
    });

    it('should navigate to next month on click', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          defaultMonth: new Date(2024, 0, 1),
          children: () => [
            CalendarNextButton({ children: 'Next' }),
            CalendarHeading({}),
          ],
        })
      );
      cleanup = dispose;

      const button = container.querySelector('[data-calendar-next-button]') as HTMLButtonElement;
      const heading = container.querySelector('[data-calendar-heading]');

      expect(heading?.textContent).toContain('January');
      button.click();

      // After clicking, should show February
      expect(heading?.textContent).toContain('February');
    });

    it('should be disabled when calendar is disabled', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          disabled: true,
          children: () => CalendarNextButton({}),
        })
      );
      cleanup = dispose;

      const button = container.querySelector('[data-calendar-next-button]') as HTMLButtonElement;
      expect(button.disabled).toBe(true);
    });

    it('should render children', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          children: () => CalendarNextButton({ children: '→' }),
        })
      );
      cleanup = dispose;

      const button = container.querySelector('[data-calendar-next-button]');
      expect(button?.textContent).toBe('→');
    });

    it('should call custom onClick handler', () => {
      const onClick = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          children: () => CalendarNextButton({ onClick }),
        })
      );
      cleanup = dispose;

      const button = container.querySelector('[data-calendar-next-button]') as HTMLButtonElement;
      button.click();

      expect(onClick).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // CalendarHeading Tests (6 tests)
  // ==========================================================================

  describe('CalendarHeading Tests', () => {
    it('should render as div', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          children: () => CalendarHeading({}),
        })
      );
      cleanup = dispose;

      const heading = container.querySelector('[data-calendar-heading]');
      expect(heading?.tagName).toBe('DIV');
    });

    it('should display current month and year', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          defaultMonth: new Date(2024, 5, 1),
          children: () => CalendarHeading({}),
        })
      );
      cleanup = dispose;

      const heading = container.querySelector('[data-calendar-heading]');
      expect(heading?.textContent).toContain('June');
      expect(heading?.textContent).toContain('2024');
    });

    it('should have aria-live="polite"', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          children: () => CalendarHeading({}),
        })
      );
      cleanup = dispose;

      const heading = container.querySelector('[data-calendar-heading]');
      expect(heading?.getAttribute('aria-live')).toBe('polite');
    });

    it('should have aria-atomic="true"', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          children: () => CalendarHeading({}),
        })
      );
      cleanup = dispose;

      const heading = container.querySelector('[data-calendar-heading]');
      expect(heading?.getAttribute('aria-atomic')).toBe('true');
    });

    it('should allow custom children to override default display', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          children: () => CalendarHeading({ children: 'Custom Heading' }),
        })
      );
      cleanup = dispose;

      const heading = container.querySelector('[data-calendar-heading]');
      expect(heading?.textContent).toBe('Custom Heading');
    });

    it('should update when month changes', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          defaultMonth: new Date(2024, 2, 1),
          children: () => [
            CalendarNextButton({}),
            CalendarHeading({}),
          ],
        })
      );
      cleanup = dispose;

      const heading = container.querySelector('[data-calendar-heading]');
      const button = container.querySelector('[data-calendar-next-button]') as HTMLButtonElement;

      expect(heading?.textContent).toContain('March');
      button.click();
      expect(heading?.textContent).toContain('April');
    });
  });

  // ==========================================================================
  // CalendarGrid Tests (5 tests)
  // ==========================================================================

  describe('CalendarGrid Tests', () => {
    it('should render as div', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          children: () => CalendarGrid({}),
        })
      );
      cleanup = dispose;

      const grid = container.querySelector('[data-calendar-grid]');
      expect(grid?.tagName).toBe('DIV');
    });

    it('should have role="grid"', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          children: () => CalendarGrid({}),
        })
      );
      cleanup = dispose;

      const grid = container.querySelector('[data-calendar-grid]');
      expect(grid?.getAttribute('role')).toBe('grid');
    });

    it('should render children', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          children: () => CalendarGrid({ children: CalendarGridHead({}) }),
        })
      );
      cleanup = dispose;

      const gridHead = container.querySelector('[data-calendar-grid-head]');
      expect(gridHead).toBeTruthy();
    });

    it('should accept additional props', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          children: () => CalendarGrid({ 'data-testid': 'custom-grid' }),
        })
      );
      cleanup = dispose;

      const grid = container.querySelector('[data-calendar-grid]');
      expect(grid?.getAttribute('data-testid')).toBe('custom-grid');
    });

    it('should render both GridHead and GridBody', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          children: () =>
            CalendarGrid({
              children: [CalendarGridHead({}), CalendarGridBody({})],
            }),
        })
      );
      cleanup = dispose;

      expect(container.querySelector('[data-calendar-grid-head]')).toBeTruthy();
      expect(container.querySelector('[data-calendar-grid-body]')).toBeTruthy();
    });
  });

  // ==========================================================================
  // CalendarGridHead Tests (5 tests)
  // ==========================================================================

  describe('CalendarGridHead Tests', () => {
    it('should render as div', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          children: () => CalendarGridHead({}),
        })
      );
      cleanup = dispose;

      const gridHead = container.querySelector('[data-calendar-grid-head]');
      expect(gridHead?.tagName).toBe('DIV');
    });

    it('should have role="row"', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          children: () => CalendarGridHead({}),
        })
      );
      cleanup = dispose;

      const gridHead = container.querySelector('[data-calendar-grid-head]');
      expect(gridHead?.getAttribute('role')).toBe('row');
    });

    it('should render children', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          children: () =>
            CalendarGridHead({
              children: CalendarHeadCell({ children: 'Sun' }),
            }),
        })
      );
      cleanup = dispose;

      const headCell = container.querySelector('[data-calendar-head-cell]');
      expect(headCell?.textContent).toBe('Sun');
    });

    it('should render multiple head cells', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          children: () =>
            CalendarGridHead({
              children: [
                CalendarHeadCell({ children: 'Su' }),
                CalendarHeadCell({ children: 'Mo' }),
                CalendarHeadCell({ children: 'Tu' }),
              ],
            }),
        })
      );
      cleanup = dispose;

      const cells = container.querySelectorAll('[data-calendar-head-cell]');
      expect(cells.length).toBe(3);
    });

    it('should accept additional props', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          children: () => CalendarGridHead({ className: 'custom-head' }),
        })
      );
      cleanup = dispose;

      const gridHead = container.querySelector('[data-calendar-grid-head]');
      expect(gridHead?.className).toContain('custom-head');
    });
  });

  // ==========================================================================
  // CalendarHeadCell Tests (4 tests)
  // ==========================================================================

  describe('CalendarHeadCell Tests', () => {
    it('should render as div', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          children: () => CalendarHeadCell({}),
        })
      );
      cleanup = dispose;

      const cell = container.querySelector('[data-calendar-head-cell]');
      expect(cell?.tagName).toBe('DIV');
    });

    it('should have role="columnheader"', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          children: () => CalendarHeadCell({}),
        })
      );
      cleanup = dispose;

      const cell = container.querySelector('[data-calendar-head-cell]');
      expect(cell?.getAttribute('role')).toBe('columnheader');
    });

    it('should render children', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          children: () => CalendarHeadCell({ children: 'Monday' }),
        })
      );
      cleanup = dispose;

      const cell = container.querySelector('[data-calendar-head-cell]');
      expect(cell?.textContent).toBe('Monday');
    });

    it('should accept additional props', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          children: () => CalendarHeadCell({ 'data-day': 'monday' }),
        })
      );
      cleanup = dispose;

      const cell = container.querySelector('[data-calendar-head-cell]');
      expect(cell?.getAttribute('data-day')).toBe('monday');
    });
  });

  // ==========================================================================
  // CalendarGridBody Tests (8 tests)
  // ==========================================================================

  describe('CalendarGridBody Tests', () => {
    it('should render grid body', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          defaultMonth: new Date(2024, 0, 1),
          children: () => CalendarGridBody({}),
        })
      );
      cleanup = dispose;

      const gridBody = container.querySelector('[data-calendar-grid-body]');
      expect(gridBody).toBeTruthy();
    });

    it('should generate calendar cells for the month', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          defaultMonth: new Date(2024, 0, 1),
          children: () => CalendarGridBody({}),
        })
      );
      cleanup = dispose;

      const cells = container.querySelectorAll('[data-calendar-cell]');
      expect(cells.length).toBe(42); // 6 weeks * 7 days
    });

    it('should organize days into weeks', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          defaultMonth: new Date(2024, 0, 1),
          children: () => CalendarGridBody({}),
        })
      );
      cleanup = dispose;

      const weeks = container.querySelectorAll('[data-calendar-week]');
      expect(weeks.length).toBe(6); // Always 6 weeks
    });

    it('should mark cells from current month', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          defaultMonth: new Date(2024, 0, 15),
          children: () => CalendarGridBody({}),
        })
      );
      cleanup = dispose;

      const currentMonthCells = container.querySelectorAll('[data-current-month]');
      expect(currentMonthCells.length).toBeGreaterThan(0);
    });

    it('should mark today', () => {
      const today = new Date();
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          defaultMonth: today,
          children: () => CalendarGridBody({}),
        })
      );
      cleanup = dispose;

      const todayCell = container.querySelector('[data-today]');
      expect(todayCell).toBeTruthy();
    });

    it('should mark selected date', () => {
      const selectedDate = new Date(2024, 0, 15);
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          defaultMonth: new Date(2024, 0, 1),
          defaultValue: selectedDate,
          children: () => CalendarGridBody({}),
        })
      );
      cleanup = dispose;

      const selectedCell = container.querySelector('[data-selected]');
      expect(selectedCell).toBeTruthy();
    });

    it('should disable cells based on minDate', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          defaultMonth: new Date(2024, 0, 1),
          minDate: new Date(2024, 0, 15),
          children: () => CalendarGridBody({}),
        })
      );
      cleanup = dispose;

      const disabledCells = container.querySelectorAll('[data-calendar-cell][disabled]');
      expect(disabledCells.length).toBeGreaterThan(0);
    });

    it('should disable cells based on maxDate', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          defaultMonth: new Date(2024, 0, 1),
          maxDate: new Date(2024, 0, 15),
          children: () => CalendarGridBody({}),
        })
      );
      cleanup = dispose;

      const disabledCells = container.querySelectorAll('[data-calendar-cell][disabled]');
      expect(disabledCells.length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // CalendarCell Tests (10 tests)
  // ==========================================================================

  describe('CalendarCell Tests', () => {
    it('should render as button', () => {
      const testDate = new Date(2024, 0, 15);
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          children: () => CalendarCell({ date: testDate }),
        })
      );
      cleanup = dispose;

      const cell = container.querySelector('[data-calendar-cell]');
      expect(cell?.tagName).toBe('BUTTON');
    });

    it('should have type="button"', () => {
      const testDate = new Date(2024, 0, 15);
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          children: () => CalendarCell({ date: testDate }),
        })
      );
      cleanup = dispose;

      const cell = container.querySelector('[data-calendar-cell]') as HTMLButtonElement;
      expect(cell.type).toBe('button');
    });

    it('should have role="gridcell"', () => {
      const testDate = new Date(2024, 0, 15);
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          children: () => CalendarCell({ date: testDate }),
        })
      );
      cleanup = dispose;

      const cell = container.querySelector('[data-calendar-cell]');
      expect(cell?.getAttribute('role')).toBe('gridcell');
    });

    it('should have aria-label with date', () => {
      const testDate = new Date(2024, 0, 15);
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          children: () => CalendarCell({ date: testDate }),
        })
      );
      cleanup = dispose;

      const cell = container.querySelector('[data-calendar-cell]');
      expect(cell?.getAttribute('aria-label')).toBeTruthy();
    });

    it('should have aria-selected when selected', async () => {
      const testDate = new Date(2024, 0, 15);
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          defaultValue: testDate,
          children: () => CalendarCell({ date: testDate }),
        })
      );
      cleanup = dispose;

      const cell = container.querySelector('[data-calendar-cell]');
      expect(cell?.getAttribute('aria-selected')).toBe('true');
    });

    it('should not have aria-selected="true" when not selected', async () => {
      const testDate = new Date(2024, 0, 15);
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          defaultValue: new Date(2024, 0, 20),
          children: () => CalendarCell({ date: testDate }),
        })
      );
      cleanup = dispose;

      const cell = container.querySelector('[data-calendar-cell]');
      expect(cell?.getAttribute('aria-selected')).toBe('false');
    });

    it('should render children (date number)', () => {
      const testDate = new Date(2024, 0, 15);
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          children: () => CalendarCell({ date: testDate, children: '15' }),
        })
      );
      cleanup = dispose;

      const cell = container.querySelector('[data-calendar-cell]');
      expect(cell?.textContent).toBe('15');
    });

    it('should call selectDate on click', () => {
      const onValueChange = vi.fn();
      const testDate = new Date(2024, 0, 15);
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          onValueChange,
          children: () => CalendarCell({ date: testDate }),
        })
      );
      cleanup = dispose;

      const cell = container.querySelector('[data-calendar-cell]') as HTMLButtonElement;
      cell.click();

      expect(onValueChange).toHaveBeenCalledWith(testDate);
    });

    it('should not call selectDate when disabled', () => {
      const onValueChange = vi.fn();
      const testDate = new Date(2024, 0, 15);
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          onValueChange,
          children: () => CalendarCell({ date: testDate, disabled: true }),
        })
      );
      cleanup = dispose;

      const cell = container.querySelector('[data-calendar-cell]') as HTMLButtonElement;
      cell.click();

      expect(onValueChange).not.toHaveBeenCalled();
    });

    it('should call custom onClick handler', () => {
      const onClick = vi.fn();
      const testDate = new Date(2024, 0, 15);
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          children: () => CalendarCell({ date: testDate, onClick }),
        })
      );
      cleanup = dispose;

      const cell = container.querySelector('[data-calendar-cell]') as HTMLButtonElement;
      cell.click();

      expect(onClick).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Date Utilities Tests (10 tests)
  // ==========================================================================

  describe('Date Utilities Tests', () => {
    it('should handle leap years correctly', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          defaultMonth: new Date(2024, 1, 1), // February 2024 (leap year)
          children: () => CalendarGridBody({}),
        })
      );
      cleanup = dispose;

      const gridBody = container.querySelector('[data-calendar-grid-body]');
      expect(gridBody).toBeTruthy();
    });

    it('should handle non-leap years correctly', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          defaultMonth: new Date(2023, 1, 1), // February 2023 (non-leap year)
          children: () => CalendarGridBody({}),
        })
      );
      cleanup = dispose;

      const gridBody = container.querySelector('[data-calendar-grid-body]');
      expect(gridBody).toBeTruthy();
    });

    it('should handle year transitions', async () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          defaultMonth: new Date(2023, 11, 1),
          children: () => [CalendarNextButton({}), CalendarHeading({})],
        })
      );
      cleanup = dispose;

      const heading = container.querySelector('[data-calendar-heading]');
      const button = container.querySelector('[data-calendar-next-button]') as HTMLButtonElement;

      expect(heading?.textContent).toContain('December');
      expect(heading?.textContent).toContain('2023');

      button.click();
      await nextTick();

      expect(heading?.textContent).toContain('January');
      expect(heading?.textContent).toContain('2024');
    });

    it('should handle weekStartsOn=0 (Sunday)', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          weekStartsOn: 0,
          defaultMonth: new Date(2024, 0, 1),
          children: () => CalendarGridBody({}),
        })
      );
      cleanup = dispose;

      const gridBody = container.querySelector('[data-calendar-grid-body]');
      expect(gridBody).toBeTruthy();
    });

    it('should handle weekStartsOn=1 (Monday)', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          weekStartsOn: 1,
          defaultMonth: new Date(2024, 0, 1),
          children: () => CalendarGridBody({}),
        })
      );
      cleanup = dispose;

      const gridBody = container.querySelector('[data-calendar-grid-body]');
      expect(gridBody).toBeTruthy();
    });

    it('should generate correct number of days in month', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          defaultMonth: new Date(2024, 0, 1), // January has 31 days
          children: () => CalendarGridBody({}),
        })
      );
      cleanup = dispose;

      const currentMonthCells = container.querySelectorAll('[data-current-month]');
      expect(currentMonthCells.length).toBe(31);
    });

    it('should include days from previous month', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          defaultMonth: new Date(2024, 0, 1),
          children: () => CalendarGridBody({}),
        })
      );
      cleanup = dispose;

      const allCells = container.querySelectorAll('[data-calendar-cell]');
      const currentMonthCells = container.querySelectorAll('[data-current-month]');

      expect(allCells.length).toBe(42);
      expect(currentMonthCells.length).toBeLessThan(allCells.length);
    });

    it('should include days from next month', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          defaultMonth: new Date(2024, 0, 1),
          children: () => CalendarGridBody({}),
        })
      );
      cleanup = dispose;

      const allCells = container.querySelectorAll('[data-calendar-cell]');
      expect(allCells.length).toBe(42); // Always 6 weeks
    });

    it('should handle month with 28 days', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          defaultMonth: new Date(2023, 1, 1), // February 2023 (28 days)
          children: () => CalendarGridBody({}),
        })
      );
      cleanup = dispose;

      const currentMonthCells = container.querySelectorAll('[data-current-month]');
      expect(currentMonthCells.length).toBe(28);
    });

    it('should handle month with 30 days', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          defaultMonth: new Date(2024, 3, 1), // April 2024 (30 days)
          children: () => CalendarGridBody({}),
        })
      );
      cleanup = dispose;

      const currentMonthCells = container.querySelectorAll('[data-current-month]');
      expect(currentMonthCells.length).toBe(30);
    });
  });

  // ==========================================================================
  // Date Constraints Tests (6 tests)
  // ==========================================================================

  describe('Date Constraints Tests', () => {
    it('should disable dates before minDate', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          defaultMonth: new Date(2024, 0, 1),
          minDate: new Date(2024, 0, 15),
          children: () => CalendarGridBody({}),
        })
      );
      cleanup = dispose;

      const disabledCells = container.querySelectorAll('[data-calendar-cell][disabled]');
      expect(disabledCells.length).toBeGreaterThan(0);
    });

    it('should disable dates after maxDate', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          defaultMonth: new Date(2024, 0, 1),
          maxDate: new Date(2024, 0, 15),
          children: () => CalendarGridBody({}),
        })
      );
      cleanup = dispose;

      const disabledCells = container.querySelectorAll('[data-calendar-cell][disabled]');
      expect(disabledCells.length).toBeGreaterThan(0);
    });

    it('should use isDateDisabled function', () => {
      const isDateDisabled = (date: Date) => date.getDay() === 0 || date.getDay() === 6;
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          defaultMonth: new Date(2024, 0, 1),
          isDateDisabled,
          children: () => CalendarGridBody({}),
        })
      );
      cleanup = dispose;

      const disabledCells = container.querySelectorAll('[data-calendar-cell][disabled]');
      expect(disabledCells.length).toBeGreaterThan(0);
    });

    it('should disable all dates when disabled prop is true', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          disabled: true,
          defaultMonth: new Date(2024, 0, 1),
          children: () => CalendarGridBody({}),
        })
      );
      cleanup = dispose;

      const disabledCells = container.querySelectorAll('[data-calendar-cell][disabled]');
      expect(disabledCells.length).toBe(42);
    });

    it('should combine minDate, maxDate, and isDateDisabled', () => {
      const isDateDisabled = (date: Date) => date.getDate() === 10;
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          defaultMonth: new Date(2024, 0, 1),
          minDate: new Date(2024, 0, 5),
          maxDate: new Date(2024, 0, 25),
          isDateDisabled,
          children: () => CalendarGridBody({}),
        })
      );
      cleanup = dispose;

      const disabledCells = container.querySelectorAll('[data-calendar-cell][disabled]');
      expect(disabledCells.length).toBeGreaterThan(0);
    });

    it('should allow clicking enabled dates within constraints', () => {
      const onValueChange = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          defaultMonth: new Date(2024, 0, 1),
          minDate: new Date(2024, 0, 10),
          maxDate: new Date(2024, 0, 20),
          onValueChange,
          children: () => CalendarGridBody({}),
        })
      );
      cleanup = dispose;

      const cells = Array.from(container.querySelectorAll('[data-calendar-cell]'));
      const enabledCell = cells.find(
        (cell) => !cell.hasAttribute('disabled')
      ) as HTMLButtonElement;

      if (enabledCell) {
        enabledCell.click();
        expect(onValueChange).toHaveBeenCalled();
      }
    });
  });

  // ==========================================================================
  // Integration Tests (6 tests)
  // ==========================================================================

  describe('Integration Tests', () => {
    it('should render complete calendar with all components', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          defaultMonth: new Date(2024, 0, 1),
          children: () => [
            CalendarHeader({
              children: [
                CalendarPrevButton({ children: '←' }),
                CalendarHeading({}),
                CalendarNextButton({ children: '→' }),
              ],
            }),
            CalendarGrid({
              children: [
                CalendarGridHead({
                  children: [
                    CalendarHeadCell({ children: 'Su' }),
                    CalendarHeadCell({ children: 'Mo' }),
                    CalendarHeadCell({ children: 'Tu' }),
                    CalendarHeadCell({ children: 'We' }),
                    CalendarHeadCell({ children: 'Th' }),
                    CalendarHeadCell({ children: 'Fr' }),
                    CalendarHeadCell({ children: 'Sa' }),
                  ],
                }),
                CalendarGridBody({}),
              ],
            }),
          ],
        })
      );
      cleanup = dispose;

      expect(container.querySelector('[data-calendar]')).toBeTruthy();
      expect(container.querySelector('[data-calendar-header]')).toBeTruthy();
      expect(container.querySelector('[data-calendar-prev-button]')).toBeTruthy();
      expect(container.querySelector('[data-calendar-next-button]')).toBeTruthy();
      expect(container.querySelector('[data-calendar-heading]')).toBeTruthy();
      expect(container.querySelector('[data-calendar-grid]')).toBeTruthy();
      expect(container.querySelector('[data-calendar-grid-head]')).toBeTruthy();
      expect(container.querySelector('[data-calendar-grid-body]')).toBeTruthy();
      expect(container.querySelectorAll('[data-calendar-head-cell]').length).toBe(7);
      expect(container.querySelectorAll('[data-calendar-cell]').length).toBe(42);
    });

    it('should navigate months and update cells', async () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          defaultMonth: new Date(2024, 0, 1),
          children: () => [
            CalendarNextButton({}),
            CalendarHeading({}),
            CalendarGridBody({}),
          ],
        })
      );
      cleanup = dispose;

      const heading = container.querySelector('[data-calendar-heading]');
      const button = container.querySelector('[data-calendar-next-button]') as HTMLButtonElement;

      expect(heading?.textContent).toContain('January');

      button.click();
      await nextTick();

      expect(heading?.textContent).toContain('February');
    });

    it('should select date and mark as selected', async () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          defaultMonth: new Date(2024, 0, 1),
          children: () => CalendarGridBody({}),
        })
      );
      cleanup = dispose;

      const cell = container.querySelector('[data-calendar-cell]') as HTMLButtonElement;

      expect(cell.getAttribute('aria-selected')).toBe('false');

      cell.click();
      await nextTick();

      expect(cell.getAttribute('aria-selected')).toBe('true');
    });

    it('should handle controlled mode updates', () => {
      let controlledDate = new Date(2024, 0, 10);
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          value: controlledDate,
          defaultMonth: new Date(2024, 0, 1),
          children: () => CalendarGridBody({}),
        })
      );
      cleanup = dispose;

      const selectedCell = container.querySelector('[data-selected]');
      expect(selectedCell).toBeTruthy();
    });

    it('should disable navigation buttons when calendar is disabled', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          disabled: true,
          children: () => [
            CalendarPrevButton({}),
            CalendarNextButton({}),
          ],
        })
      );
      cleanup = dispose;

      const prevButton = container.querySelector('[data-calendar-prev-button]') as HTMLButtonElement;
      const nextButton = container.querySelector('[data-calendar-next-button]') as HTMLButtonElement;

      expect(prevButton.disabled).toBe(true);
      expect(nextButton.disabled).toBe(true);
    });

    it('should work with date constraints and navigation', async () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Calendar({
          defaultMonth: new Date(2024, 0, 1),
          minDate: new Date(2024, 0, 10),
          maxDate: new Date(2024, 0, 20),
          children: () => [
            CalendarNextButton({}),
            CalendarHeading({}),
            CalendarGridBody({}),
          ],
        })
      );
      cleanup = dispose;

      const button = container.querySelector('[data-calendar-next-button]') as HTMLButtonElement;
      const heading = container.querySelector('[data-calendar-heading]');

      button.click();
      await nextTick();

      // Should navigate even with constraints
      expect(heading?.textContent).toContain('February');
    });
  });
});
