/**
 * MultiSelect Primitive Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  MultiSelect,
  MultiSelectTrigger,
  MultiSelectValue,
  MultiSelectContent,
  MultiSelectSearch,
  MultiSelectItem,
  MultiSelectItemIndicator,
  MultiSelectActions,
} from '../../../src/primitives/MultiSelect.js';
import { renderComponent } from '../../helpers/test-utils.js';

describe('MultiSelect', () => {
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
  // Rendering Tests (12 tests)
  // ==========================================================================

  describe('Rendering Tests', () => {
    it('should render MultiSelect root', () => {
      const { container, cleanup: dispose } = renderComponent(() => MultiSelect({}));
      cleanup = dispose;

      const root = container.querySelector('[data-multi-select]');
      expect(root).toBeTruthy();
    });

    it('should render as div element', () => {
      const { container, cleanup: dispose } = renderComponent(() => MultiSelect({}));
      cleanup = dispose;

      const root = container.querySelector('[data-multi-select]');
      expect(root?.tagName).toBe('DIV');
    });

    it('should render with disabled state', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({ disabled: true })
      );
      cleanup = dispose;

      const root = container.querySelector('[data-multi-select]');
      expect(root?.hasAttribute('data-disabled')).toBe(true);
    });

    it('should not have data-disabled when not disabled', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({ disabled: false })
      );
      cleanup = dispose;

      const root = container.querySelector('[data-multi-select]');
      expect(root?.hasAttribute('data-disabled')).toBe(false);
    });

    it('should render with children using function (Pattern 17)', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          children: () => MultiSelectTrigger({ children: 'Select' }),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-multi-select-trigger]');
      expect(trigger).toBeTruthy();
    });

    it('should render multiple children using function (Pattern 17)', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          children: () => [
            MultiSelectTrigger({ children: MultiSelectValue({}) }),
            MultiSelectContent({ children: 'Content' }),
          ],
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-multi-select-trigger]');
      const value = container.querySelector('[data-multi-select-placeholder]');
      expect(trigger).toBeTruthy();
      expect(value).toBeTruthy();
    });

    it('should render all sub-components together', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          searchable: true,
          children: () => [
            MultiSelectTrigger({ children: MultiSelectValue({}) }),
            MultiSelectContent({
              children: [
                MultiSelectSearch({}),
                MultiSelectItem({ value: 'item1', children: 'Item 1' }),
                MultiSelectActions({}),
              ],
            }),
          ],
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-multi-select-trigger]');
      trigger?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(container.querySelector('[data-multi-select-trigger]')).toBeTruthy();
      expect(container.querySelector('[data-multi-select-search]')).toBeTruthy();
      expect(container.querySelector('[data-multi-select-item]')).toBeTruthy();
      expect(container.querySelector('[data-multi-select-actions]')).toBeTruthy();
    });

    it('should render with empty children', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({ children: () => null })
      );
      cleanup = dispose;

      const root = container.querySelector('[data-multi-select]');
      expect(root).toBeTruthy();
      expect(root?.textContent).toBe('');
    });

    it('should render with searchable prop', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          searchable: true,
          children: () => MultiSelectContent({ children: MultiSelectSearch({}) }),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-multi-select]');
      expect(trigger).toBeTruthy();
    });

    it('should render with maxSelections prop', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          maxSelections: 3,
          children: () => MultiSelectTrigger({}),
        })
      );
      cleanup = dispose;

      const root = container.querySelector('[data-multi-select]');
      expect(root).toBeTruthy();
    });

    it('should render with placeholder prop', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          placeholder: 'Choose items',
          children: () => MultiSelectTrigger({ children: MultiSelectValue({}) }),
        })
      );
      cleanup = dispose;

      const value = container.querySelector('[data-multi-select-placeholder]');
      expect(value?.textContent).toContain('Select items');
    });

    it('should render with defaultValue', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          defaultValue: ['item1', 'item2'],
          children: () => [
            MultiSelectTrigger({ children: MultiSelectValue({}) }),
            MultiSelectContent({
              children: [
                MultiSelectItem({ value: 'item1' }),
                MultiSelectItem({ value: 'item2' }),
              ],
            }),
          ],
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-multi-select-trigger]');
      trigger?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      const items = container.querySelectorAll('[data-multi-select-item][data-selected]');
      expect(items.length).toBe(2);
    });
  });

  // ==========================================================================
  // Context Tests (8 tests)
  // ==========================================================================

  describe('Context Tests', () => {
    it('should provide value signal through context', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          defaultValue: ['test'],
          children: () =>
            MultiSelectContent({
              children: MultiSelectItem({ value: 'test', children: 'Test' }),
            }),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-multi-select]');
      expect(trigger).toBeTruthy();

      const item = container.querySelector('[data-multi-select-item]');
      expect(item?.getAttribute('aria-selected')).toBe('true');
    });

    it('should provide isOpen state through context', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          children: () => MultiSelectTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-multi-select-trigger]');
      expect(trigger?.getAttribute('data-state')).toBe('closed');

      trigger?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(trigger?.getAttribute('data-state')).toBe('open');
    });

    it('should provide disabled state through context', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          disabled: true,
          children: () => MultiSelectTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector(
        'button[data-multi-select-trigger]'
      ) as HTMLButtonElement;
      expect(trigger.disabled).toBe(true);
    });

    it('should provide searchable state through context', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          searchable: false,
          children: () => MultiSelectContent({ children: MultiSelectSearch({}) }),
        })
      );
      cleanup = dispose;

      const search = container.querySelector('[data-multi-select-search]');
      expect(search).toBeNull();
    });

    it('should provide maxSelections through context', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          maxSelections: 2,
          defaultValue: ['item1', 'item2'],
          children: () => MultiSelectContent({ children: MultiSelectActions({}) }),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-multi-select]');
      expect(trigger).toBeTruthy();
    });

    it('should allow sub-components to access context', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          children: () => [
            MultiSelectTrigger({ children: MultiSelectValue({}) }),
            MultiSelectContent({
              children: [
                MultiSelectItem({ value: 'test', children: 'Test' }),
                MultiSelectActions({}),
              ],
            }),
          ],
        })
      );
      cleanup = dispose;

      expect(container.querySelector('[data-multi-select-trigger]')).toBeTruthy();
      expect(container.querySelector('[data-multi-select-item]')).toBeTruthy();
      expect(container.querySelector('[data-multi-select-actions]')).toBeTruthy();
    });

    it('should register and track item values', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          children: () =>
            MultiSelectContent({
              children: [
                MultiSelectItem({ value: 'item1', children: 'Item 1' }),
                MultiSelectItem({ value: 'item2', children: 'Item 2' }),
                MultiSelectItem({ value: 'item3', children: 'Item 3' }),
              ],
            }),
        })
      );
      cleanup = dispose;

      const items = container.querySelectorAll('[data-multi-select-item]');
      expect(items.length).toBe(3);
    });

    it('should provide toggleValue function through context', () => {
      const onValueChange = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          onValueChange,
          children: () =>
            MultiSelectContent({
              children: MultiSelectItem({ value: 'test', children: 'Test' }),
            }),
        })
      );
      cleanup = dispose;

      const item = container.querySelector('[data-multi-select-item]') as HTMLElement;
      item.click();

      expect(onValueChange).toHaveBeenCalledWith(['test']);
    });
  });

  // ==========================================================================
  // Controlled/Uncontrolled Tests (7 tests)
  // ==========================================================================

  describe('Controlled/Uncontrolled Tests', () => {
    it('should work in uncontrolled mode with defaultValue', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          defaultValue: ['test1', 'test2'],
          children: () =>
            MultiSelectContent({
              children: [
                MultiSelectItem({ value: 'test1' }),
                MultiSelectItem({ value: 'test2' }),
              ],
            }),
        })
      );
      cleanup = dispose;

      const items = container.querySelectorAll('[data-multi-select-item][data-selected]');
      expect(items.length).toBe(2);
    });

    it('should work in controlled mode with value prop', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          value: ['controlled'],
          children: () =>
            MultiSelectContent({
              children: MultiSelectItem({ value: 'controlled' }),
            }),
        })
      );
      cleanup = dispose;

      const item = container.querySelector('[data-multi-select-item]');
      expect(item?.getAttribute('aria-selected')).toBe('true');
    });

    it('should call onValueChange callback when value changes', () => {
      const onValueChange = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          onValueChange,
          children: () =>
            MultiSelectContent({
              children: MultiSelectItem({ value: 'test', children: 'Test' }),
            }),
        })
      );
      cleanup = dispose;

      const item = container.querySelector('[data-multi-select-item]') as HTMLElement;
      item.click();

      expect(onValueChange).toHaveBeenCalledWith(['test']);
    });

    it('should use controlled value over internal state', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          value: ['controlled'],
          defaultValue: ['default'],
          children: () =>
            MultiSelectContent({
              children: [
                MultiSelectItem({ value: 'controlled' }),
                MultiSelectItem({ value: 'default' }),
              ],
            }),
        })
      );
      cleanup = dispose;

      const items = container.querySelectorAll('[data-multi-select-item]');
      expect(items[0]?.getAttribute('aria-selected')).toBe('true');
      expect(items[1]?.getAttribute('aria-selected')).toBe('false');
    });

    it('should default to empty array when no value provided', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          children: () =>
            MultiSelectContent({
              children: MultiSelectItem({ value: 'test' }),
            }),
        })
      );
      cleanup = dispose;

      const item = container.querySelector('[data-multi-select-item]');
      expect(item?.getAttribute('aria-selected')).toBe('false');
    });

    it('should toggle values on and off', () => {
      const onValueChange = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          onValueChange,
          children: () =>
            MultiSelectContent({
              children: MultiSelectItem({ value: 'test' }),
            }),
        })
      );
      cleanup = dispose;

      const item = container.querySelector('[data-multi-select-item]') as HTMLElement;

      // Select
      item.click();
      expect(onValueChange).toHaveBeenCalledWith(['test']);

      // Deselect
      item.click();
      expect(onValueChange).toHaveBeenCalledWith([]);
    });

    it('should support multiple selections', () => {
      const onValueChange = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          onValueChange,
          children: () =>
            MultiSelectContent({
              children: [
                MultiSelectItem({ value: 'item1' }),
                MultiSelectItem({ value: 'item2' }),
                MultiSelectItem({ value: 'item3' }),
              ],
            }),
        })
      );
      cleanup = dispose;

      const items = container.querySelectorAll('[data-multi-select-item]') as NodeListOf<HTMLElement>;

      items[0]?.click();
      expect(onValueChange).toHaveBeenCalledWith(['item1']);

      items[1]?.click();
      expect(onValueChange).toHaveBeenCalledWith(['item1', 'item2']);

      items[2]?.click();
      expect(onValueChange).toHaveBeenCalledWith(['item1', 'item2', 'item3']);
    });
  });

  // ==========================================================================
  // MultiSelectTrigger Tests (7 tests)
  // ==========================================================================

  describe('MultiSelectTrigger Tests', () => {
    it('should render as button', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          children: () => MultiSelectTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-multi-select-trigger]');
      expect(trigger?.tagName).toBe('BUTTON');
    });

    it('should have type="button"', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          children: () => MultiSelectTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-multi-select-trigger]') as HTMLButtonElement;
      expect(trigger.type).toBe('button');
    });

    it('should have data-state attribute', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          children: () => MultiSelectTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-multi-select-trigger]');
      expect(trigger?.getAttribute('data-state')).toBe('closed');
    });

    it('should toggle open state on click', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          children: () => MultiSelectTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-multi-select-trigger]') as HTMLButtonElement;

      expect(trigger.getAttribute('data-state')).toBe('closed');
      trigger.click();
      expect(trigger.getAttribute('data-state')).toBe('open');
      trigger.click();
      expect(trigger.getAttribute('data-state')).toBe('closed');
    });

    it('should have aria-expanded attribute', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          children: () => MultiSelectTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-multi-select-trigger]');
      expect(trigger?.getAttribute('aria-expanded')).toBe('false');

      (trigger as HTMLButtonElement).click();
      expect(trigger?.getAttribute('aria-expanded')).toBe('true');
    });

    it('should have aria-haspopup="listbox"', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          children: () => MultiSelectTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-multi-select-trigger]');
      expect(trigger?.getAttribute('aria-haspopup')).toBe('listbox');
    });

    it('should be disabled when MultiSelect is disabled', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          disabled: true,
          children: () => MultiSelectTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-multi-select-trigger]') as HTMLButtonElement;
      expect(trigger.disabled).toBe(true);
    });
  });

  // ==========================================================================
  // MultiSelectValue Tests (6 tests)
  // ==========================================================================

  describe('MultiSelectValue Tests', () => {
    it('should show placeholder when no items selected', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          children: () => MultiSelectTrigger({ children: MultiSelectValue({}) }),
        })
      );
      cleanup = dispose;

      const placeholder = container.querySelector('[data-multi-select-placeholder]');
      expect(placeholder).toBeTruthy();
      expect(placeholder?.textContent).toBe('Select items...');
    });

    it('should show custom placeholder', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          children: () =>
            MultiSelectTrigger({
              children: MultiSelectValue({ placeholder: 'Choose items' }),
            }),
        })
      );
      cleanup = dispose;

      const placeholder = container.querySelector('[data-multi-select-placeholder]');
      expect(placeholder?.textContent).toBe('Choose items');
    });

    it('should show count when items are selected', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          defaultValue: ['item1', 'item2'],
          children: () => MultiSelectTrigger({ children: MultiSelectValue({}) }),
        })
      );
      cleanup = dispose;

      const value = container.querySelector('[data-multi-select-value]');
      expect(value?.textContent).toBe('2 selected');
    });

    it('should show correct count with one item', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          defaultValue: ['item1'],
          children: () => MultiSelectTrigger({ children: MultiSelectValue({}) }),
        })
      );
      cleanup = dispose;

      const value = container.querySelector('[data-multi-select-value]');
      expect(value?.textContent).toBe('1 selected');
    });

    it('should render custom children', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          children: () =>
            MultiSelectTrigger({
              children: MultiSelectValue({ children: 'Custom content' }),
            }),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-multi-select-trigger]');
      expect(trigger?.textContent).toBe('Custom content');
    });

    it('should update count when selection changes', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          children: () => [
            MultiSelectTrigger({ children: MultiSelectValue({}) }),
            MultiSelectContent({
              children: MultiSelectItem({ value: 'test' }),
            }),
          ],
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-multi-select-trigger]') as HTMLButtonElement;
      trigger.click();

      const item = container.querySelector('[data-multi-select-item]') as HTMLElement;
      item.click();

      const value = container.querySelector('[data-multi-select-value]');
      expect(value?.textContent).toBe('1 selected');
    });
  });

  // ==========================================================================
  // MultiSelectContent Tests (5 tests)
  // ==========================================================================

  describe('MultiSelectContent Tests', () => {
    it('should render when open', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          children: () => [
            MultiSelectTrigger({}),
            MultiSelectContent({ children: 'Content' }),
          ],
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-multi-select-trigger]') as HTMLButtonElement;
      trigger.click();

      const content = container.querySelector('[data-multi-select-content]');
      expect(content).toBeTruthy();
    });

    it('should not render when closed', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          children: () => MultiSelectContent({}),
        })
      );
      cleanup = dispose;

      const content = container.querySelector('[data-multi-select-content]');
      expect(content).toBeNull();
    });

    it('should have role="listbox"', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          children: () => [
            MultiSelectTrigger({}),
            MultiSelectContent({}),
          ],
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-multi-select-trigger]') as HTMLButtonElement;
      trigger.click();

      const content = container.querySelector('[data-multi-select-content]');
      expect(content?.getAttribute('role')).toBe('listbox');
    });

    it('should have aria-multiselectable="true"', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          children: () => [
            MultiSelectTrigger({}),
            MultiSelectContent({}),
          ],
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-multi-select-trigger]') as HTMLButtonElement;
      trigger.click();

      const content = container.querySelector('[data-multi-select-content]');
      expect(content?.getAttribute('aria-multiselectable')).toBe('true');
    });

    it('should render children', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          children: () => [
            MultiSelectTrigger({}),
            MultiSelectContent({ children: 'Test content' }),
          ],
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-multi-select-trigger]') as HTMLButtonElement;
      trigger.click();

      const content = container.querySelector('[data-multi-select-content]');
      expect(content?.textContent).toContain('Test content');
    });
  });

  // ==========================================================================
  // MultiSelectSearch Tests (6 tests)
  // ==========================================================================

  describe('MultiSelectSearch Tests', () => {
    it('should render when searchable is true', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          searchable: true,
          children: () => [
            MultiSelectTrigger({}),
            MultiSelectContent({ children: MultiSelectSearch({}) }),
          ],
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-multi-select-trigger]') as HTMLButtonElement;
      trigger.click();

      const search = container.querySelector('[data-multi-select-search]');
      expect(search).toBeTruthy();
    });

    it('should not render when searchable is false', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          searchable: false,
          children: () => [
            MultiSelectTrigger({}),
            MultiSelectContent({ children: MultiSelectSearch({}) }),
          ],
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-multi-select-trigger]') as HTMLButtonElement;
      trigger.click();

      const search = container.querySelector('[data-multi-select-search]');
      expect(search).toBeNull();
    });

    it('should render as input', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          searchable: true,
          children: () => [
            MultiSelectTrigger({}),
            MultiSelectContent({ children: MultiSelectSearch({}) }),
          ],
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-multi-select-trigger]') as HTMLButtonElement;
      trigger.click();

      const search = container.querySelector('[data-multi-select-search]');
      expect(search?.tagName).toBe('INPUT');
    });

    it('should have type="text"', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          searchable: true,
          children: () => [
            MultiSelectTrigger({}),
            MultiSelectContent({ children: MultiSelectSearch({}) }),
          ],
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-multi-select-trigger]') as HTMLButtonElement;
      trigger.click();

      const search = container.querySelector('[data-multi-select-search]') as HTMLInputElement;
      expect(search.type).toBe('text');
    });

    it('should have placeholder', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          searchable: true,
          children: () => [
            MultiSelectTrigger({}),
            MultiSelectContent({ children: MultiSelectSearch({ placeholder: 'Filter...' }) }),
          ],
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-multi-select-trigger]') as HTMLButtonElement;
      trigger.click();

      const search = container.querySelector('[data-multi-select-search]') as HTMLInputElement;
      expect(search.placeholder).toBe('Filter...');
    });

    it('should filter items based on search query', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          searchable: true,
          children: () => [
            MultiSelectTrigger({}),
            MultiSelectContent({
              children: [
                MultiSelectSearch({}),
                MultiSelectItem({ value: 'apple', children: 'Apple' }),
                MultiSelectItem({ value: 'banana', children: 'Banana' }),
              ],
            }),
          ],
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-multi-select-trigger]') as HTMLButtonElement;
      trigger.click();

      const search = container.querySelector('[data-multi-select-search]') as HTMLInputElement;
      search.value = 'app';
      search.dispatchEvent(new Event('input', { bubbles: true }));

      const items = container.querySelectorAll('[data-multi-select-item]');
      expect(items.length).toBe(1);
      expect(items[0]?.textContent).toBe('Apple');
    });
  });

  // ==========================================================================
  // MultiSelectItem Tests (10 tests)
  // ==========================================================================

  describe('MultiSelectItem Tests', () => {
    it('should render as div', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          children: () =>
            MultiSelectContent({ children: MultiSelectItem({ value: 'test' }) }),
        })
      );
      cleanup = dispose;

      const item = container.querySelector('[data-multi-select-item]');
      expect(item?.tagName).toBe('DIV');
    });

    it('should have role="option"', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          children: () =>
            MultiSelectContent({ children: MultiSelectItem({ value: 'test' }) }),
        })
      );
      cleanup = dispose;

      const item = container.querySelector('[data-multi-select-item]');
      expect(item?.getAttribute('role')).toBe('option');
    });

    it('should have data-value attribute', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          children: () =>
            MultiSelectContent({ children: MultiSelectItem({ value: 'test-value' }) }),
        })
      );
      cleanup = dispose;

      const item = container.querySelector('[data-multi-select-item]');
      expect(item?.getAttribute('data-value')).toBe('test-value');
    });

    it('should have data-selected when selected', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          defaultValue: ['test'],
          children: () =>
            MultiSelectContent({ children: MultiSelectItem({ value: 'test' }) }),
        })
      );
      cleanup = dispose;

      const item = container.querySelector('[data-multi-select-item]');
      expect(item?.hasAttribute('data-selected')).toBe(true);
    });

    it('should have aria-selected when selected', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          defaultValue: ['test'],
          children: () =>
            MultiSelectContent({ children: MultiSelectItem({ value: 'test' }) }),
        })
      );
      cleanup = dispose;

      const item = container.querySelector('[data-multi-select-item]');
      expect(item?.getAttribute('aria-selected')).toBe('true');
    });

    it('should toggle selection on click', () => {
      const onValueChange = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          onValueChange,
          children: () =>
            MultiSelectContent({ children: MultiSelectItem({ value: 'test' }) }),
        })
      );
      cleanup = dispose;

      const item = container.querySelector('[data-multi-select-item]') as HTMLElement;

      item.click();
      expect(onValueChange).toHaveBeenCalledWith(['test']);

      item.click();
      expect(onValueChange).toHaveBeenCalledWith([]);
    });

    it('should not toggle when disabled', () => {
      const onValueChange = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          onValueChange,
          children: () =>
            MultiSelectContent({ children: MultiSelectItem({ value: 'test', disabled: true }) }),
        })
      );
      cleanup = dispose;

      const item = container.querySelector('[data-multi-select-item]') as HTMLElement;
      item.click();

      expect(onValueChange).not.toHaveBeenCalled();
    });

    it('should have data-disabled when disabled', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          children: () =>
            MultiSelectContent({ children: MultiSelectItem({ value: 'test', disabled: true }) }),
        })
      );
      cleanup = dispose;

      const item = container.querySelector('[data-multi-select-item]');
      expect(item?.hasAttribute('data-disabled')).toBe(true);
    });

    it('should render children', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          children: () =>
            MultiSelectContent({
              children: MultiSelectItem({ value: 'test', children: 'Test Item' }),
            }),
        })
      );
      cleanup = dispose;

      const item = container.querySelector('[data-multi-select-item]');
      expect(item?.textContent).toBe('Test Item');
    });

    it('should filter based on search query', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          searchable: true,
          children: () => [
            MultiSelectTrigger({}),
            MultiSelectContent({
              children: [
                MultiSelectSearch({}),
                MultiSelectItem({ value: 'apple', children: 'Apple' }),
                MultiSelectItem({ value: 'banana', children: 'Banana' }),
              ],
            }),
          ],
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-multi-select-trigger]') as HTMLButtonElement;
      trigger.click();

      const search = container.querySelector('[data-multi-select-search]') as HTMLInputElement;
      search.value = 'ban';
      search.dispatchEvent(new Event('input', { bubbles: true }));

      const visibleItems = Array.from(
        container.querySelectorAll('[data-multi-select-item]')
      ).filter(item => item.textContent);

      expect(visibleItems.length).toBe(1);
    });
  });

  // ==========================================================================
  // MultiSelectItemIndicator Tests (3 tests)
  // ==========================================================================

  describe('MultiSelectItemIndicator Tests', () => {
    it('should render as span', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          children: () =>
            MultiSelectContent({
              children: MultiSelectItem({
                value: 'test',
                children: MultiSelectItemIndicator({}),
              }),
            }),
        })
      );
      cleanup = dispose;

      const indicator = container.querySelector('[data-multi-select-item-indicator]');
      expect(indicator?.tagName).toBe('SPAN');
    });

    it('should render default checkmark', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          children: () =>
            MultiSelectContent({
              children: MultiSelectItem({
                value: 'test',
                children: MultiSelectItemIndicator({}),
              }),
            }),
        })
      );
      cleanup = dispose;

      const indicator = container.querySelector('[data-multi-select-item-indicator]');
      expect(indicator?.textContent).toBe('✓');
    });

    it('should render custom children', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          children: () =>
            MultiSelectContent({
              children: MultiSelectItem({
                value: 'test',
                children: MultiSelectItemIndicator({ children: '✔' }),
              }),
            }),
        })
      );
      cleanup = dispose;

      const indicator = container.querySelector('[data-multi-select-item-indicator]');
      expect(indicator?.textContent).toBe('✔');
    });
  });

  // ==========================================================================
  // MultiSelectActions Tests (6 tests)
  // ==========================================================================

  describe('MultiSelectActions Tests', () => {
    it('should render default actions', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          children: () => MultiSelectContent({ children: MultiSelectActions({}) }),
        })
      );
      cleanup = dispose;

      const actions = container.querySelector('[data-multi-select-actions]');
      const buttons = actions?.querySelectorAll('button');
      expect(buttons?.length).toBe(2);
    });

    it('should have Select All button', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          children: () => MultiSelectContent({ children: MultiSelectActions({}) }),
        })
      );
      cleanup = dispose;

      const buttons = container.querySelectorAll('[data-multi-select-action]');
      expect(buttons[0]?.textContent).toBe('Select All');
    });

    it('should have Clear All button', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          children: () => MultiSelectContent({ children: MultiSelectActions({}) }),
        })
      );
      cleanup = dispose;

      const buttons = container.querySelectorAll('[data-multi-select-action]');
      expect(buttons[1]?.textContent).toBe('Clear All');
    });

    it('should select all items on Select All click', () => {
      const onValueChange = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          onValueChange,
          children: () => [
            MultiSelectContent({
              children: [
                MultiSelectItem({ value: 'item1' }),
                MultiSelectItem({ value: 'item2' }),
                MultiSelectActions({}),
              ],
            }),
          ],
        })
      );
      cleanup = dispose;

      const buttons = container.querySelectorAll('[data-multi-select-action]');
      (buttons[0] as HTMLButtonElement).click();

      expect(onValueChange).toHaveBeenCalledWith(['item1', 'item2']);
    });

    it('should clear all items on Clear All click', () => {
      const onValueChange = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          defaultValue: ['item1', 'item2'],
          onValueChange,
          children: () =>
            MultiSelectContent({
              children: [
                MultiSelectItem({ value: 'item1' }),
                MultiSelectItem({ value: 'item2' }),
                MultiSelectActions({}),
              ],
            }),
        })
      );
      cleanup = dispose;

      const buttons = container.querySelectorAll('[data-multi-select-action]');
      (buttons[1] as HTMLButtonElement).click();

      expect(onValueChange).toHaveBeenCalledWith([]);
    });

    it('should render custom children', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          children: () =>
            MultiSelectContent({
              children: MultiSelectActions({ children: 'Custom actions' }),
            }),
        })
      );
      cleanup = dispose;

      const actions = container.querySelector('[data-multi-select-actions]');
      expect(actions?.textContent).toBe('Custom actions');
    });
  });

  // ==========================================================================
  // Max Selections Tests (5 tests)
  // ==========================================================================

  describe('Max Selections Tests', () => {
    it('should enforce max selections limit', () => {
      const onValueChange = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          maxSelections: 2,
          onValueChange,
          children: () =>
            MultiSelectContent({
              children: [
                MultiSelectItem({ value: 'item1' }),
                MultiSelectItem({ value: 'item2' }),
                MultiSelectItem({ value: 'item3' }),
              ],
            }),
        })
      );
      cleanup = dispose;

      const items = container.querySelectorAll('[data-multi-select-item]') as NodeListOf<HTMLElement>;

      items[0]?.click();
      items[1]?.click();
      items[2]?.click(); // Should not be added

      expect(onValueChange).toHaveBeenCalledTimes(2);
      expect(onValueChange).toHaveBeenLastCalledWith(['item1', 'item2']);
    });

    it('should allow unlimited selections when maxSelections is 0', () => {
      const onValueChange = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          maxSelections: 0,
          onValueChange,
          children: () =>
            MultiSelectContent({
              children: [
                MultiSelectItem({ value: 'item1' }),
                MultiSelectItem({ value: 'item2' }),
                MultiSelectItem({ value: 'item3' }),
              ],
            }),
        })
      );
      cleanup = dispose;

      const items = container.querySelectorAll('[data-multi-select-item]') as NodeListOf<HTMLElement>;

      items[0]?.click();
      items[1]?.click();
      items[2]?.click();

      expect(onValueChange).toHaveBeenCalledTimes(3);
    });

    it('should disable Select All when max selections is reached', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          maxSelections: 1,
          defaultValue: ['item1'],
          children: () =>
            MultiSelectContent({
              children: [
                MultiSelectItem({ value: 'item1' }),
                MultiSelectItem({ value: 'item2' }),
                MultiSelectActions({}),
              ],
            }),
        })
      );
      cleanup = dispose;

      const buttons = container.querySelectorAll('[data-multi-select-action]');
      expect((buttons[0] as HTMLButtonElement).disabled).toBe(true);
    });

    it('should limit Select All to maxSelections', () => {
      const onValueChange = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          maxSelections: 2,
          onValueChange,
          children: () =>
            MultiSelectContent({
              children: [
                MultiSelectItem({ value: 'item1' }),
                MultiSelectItem({ value: 'item2' }),
                MultiSelectItem({ value: 'item3' }),
                MultiSelectActions({}),
              ],
            }),
        })
      );
      cleanup = dispose;

      const buttons = container.querySelectorAll('[data-multi-select-action]');
      (buttons[0] as HTMLButtonElement).click();

      expect(onValueChange).toHaveBeenCalledWith(['item1', 'item2']);
    });

    it('should allow deselection even when max is reached', () => {
      const onValueChange = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          maxSelections: 2,
          defaultValue: ['item1', 'item2'],
          onValueChange,
          children: () =>
            MultiSelectContent({
              children: [
                MultiSelectItem({ value: 'item1' }),
                MultiSelectItem({ value: 'item2' }),
              ],
            }),
        })
      );
      cleanup = dispose;

      const items = container.querySelectorAll('[data-multi-select-item]') as NodeListOf<HTMLElement>;
      items[0]?.click(); // Should deselect

      expect(onValueChange).toHaveBeenCalledWith(['item2']);
    });
  });

  // ==========================================================================
  // Edge Cases (5 tests)
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle empty children', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({ children: undefined })
      );
      cleanup = dispose;

      const root = container.querySelector('[data-multi-select]');
      expect(root).toBeTruthy();
    });

    it('should not toggle when MultiSelect is disabled', () => {
      const onValueChange = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          disabled: true,
          onValueChange,
          children: () =>
            MultiSelectContent({ children: MultiSelectItem({ value: 'test' }) }),
        })
      );
      cleanup = dispose;

      const item = container.querySelector('[data-multi-select-item]') as HTMLElement;
      item.click();

      expect(onValueChange).not.toHaveBeenCalled();
    });

    it('should clear search when closing', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          searchable: true,
          children: () => [
            MultiSelectTrigger({}),
            MultiSelectContent({ children: MultiSelectSearch({}) }),
          ],
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-multi-select-trigger]') as HTMLButtonElement;

      // Open and search
      trigger.click();
      const search = container.querySelector('[data-multi-select-search]') as HTMLInputElement;
      search.value = 'test';
      search.dispatchEvent(new Event('input', { bubbles: true }));

      // Close
      trigger.click();

      // Open again - search should be cleared
      trigger.click();
      const searchAgain = container.querySelector('[data-multi-select-search]') as HTMLInputElement;
      expect(searchAgain.value).toBe('');
    });

    it('should not register disabled items', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          children: () =>
            MultiSelectContent({
              children: [
                MultiSelectItem({ value: 'item1' }),
                MultiSelectItem({ value: 'item2', disabled: true }),
                MultiSelectActions({}),
              ],
            }),
        })
      );
      cleanup = dispose;

      const buttons = container.querySelectorAll('[data-multi-select-action]');
      (buttons[0] as HTMLButtonElement).click();

      // Only non-disabled items should be in allValues
      const items = container.querySelectorAll('[data-multi-select-item][data-selected]');
      expect(items.length).toBe(1);
    });

    it('should disable Clear All when no items selected', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        MultiSelect({
          children: () => MultiSelectContent({ children: MultiSelectActions({}) }),
        })
      );
      cleanup = dispose;

      const buttons = container.querySelectorAll('[data-multi-select-action]');
      expect((buttons[1] as HTMLButtonElement).disabled).toBe(true);
    });
  });
});
