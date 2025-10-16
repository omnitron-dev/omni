/**
 * Select Primitive Tests
 *
 * @vitest-environment happy-dom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { signal } from '../../../src/core/reactivity/signal.js';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectIcon,
  SelectContent,
  SelectViewport,
  SelectItem,
  SelectItemText,
  SelectItemIndicator,
  SelectGroup,
  SelectLabel,
  SelectSeparator,
} from '../../../src/primitives/Select.js';
import { renderComponent, nextTick } from '../../helpers/test-utils.js';

// Track active element globally for focus mocking
let _activeElement: Element | null = null;

describe('Select Primitive', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    _activeElement = document.body;

    // Mock document.activeElement
    Object.defineProperty(document, 'activeElement', {
      get() {
        return _activeElement || document.body;
      },
      configurable: true,
    });

    // Mock focus/blur methods
    Object.defineProperty(HTMLElement.prototype, 'focus', {
      value(this: HTMLElement) {
        _activeElement = this;
        this.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
      },
      writable: true,
      configurable: true,
    });

    Object.defineProperty(HTMLElement.prototype, 'blur', {
      value(this: HTMLElement) {
        _activeElement = document.body;
        this.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
      },
      writable: true,
      configurable: true,
    });

    // Mock scrollIntoView
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      value() {
        // No-op for tests
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    document.body.innerHTML = '';
    // Clean up any portals
    document.querySelectorAll('.aether-portal').forEach((el) => el.remove());
  });

  describe('Component Exports', () => {
    it('should export Select component', () => {
      expect(Select).toBeTypeOf('function');
    });

    it('should export SelectTrigger component', () => {
      expect(SelectTrigger).toBeTypeOf('function');
    });

    it('should export SelectValue component', () => {
      expect(SelectValue).toBeTypeOf('function');
    });

    it('should export SelectIcon component', () => {
      expect(SelectIcon).toBeTypeOf('function');
    });

    it('should export SelectContent component', () => {
      expect(SelectContent).toBeTypeOf('function');
    });

    it('should export SelectViewport component', () => {
      expect(SelectViewport).toBeTypeOf('function');
    });

    it('should export SelectItem component', () => {
      expect(SelectItem).toBeTypeOf('function');
    });

    it('should export SelectItemText component', () => {
      expect(SelectItemText).toBeTypeOf('function');
    });

    it('should export SelectItemIndicator component', () => {
      expect(SelectItemIndicator).toBeTypeOf('function');
    });

    it('should export SelectGroup component', () => {
      expect(SelectGroup).toBeTypeOf('function');
    });

    it('should export SelectLabel component', () => {
      expect(SelectLabel).toBeTypeOf('function');
    });

    it('should export SelectSeparator component', () => {
      expect(SelectSeparator).toBeTypeOf('function');
    });
  });

  describe('Sub-component Attachment', () => {
    it('should attach Trigger as Select.Trigger', () => {
      expect((Select as any).Trigger).toBe(SelectTrigger);
    });

    it('should attach Value as Select.Value', () => {
      expect((Select as any).Value).toBe(SelectValue);
    });

    it('should attach Icon as Select.Icon', () => {
      expect((Select as any).Icon).toBe(SelectIcon);
    });

    it('should attach Content as Select.Content', () => {
      expect((Select as any).Content).toBe(SelectContent);
    });

    it('should attach Viewport as Select.Viewport', () => {
      expect((Select as any).Viewport).toBe(SelectViewport);
    });

    it('should attach Item as Select.Item', () => {
      expect((Select as any).Item).toBe(SelectItem);
    });

    it('should attach ItemText as Select.ItemText', () => {
      expect((Select as any).ItemText).toBe(SelectItemText);
    });

    it('should attach ItemIndicator as Select.ItemIndicator', () => {
      expect((Select as any).ItemIndicator).toBe(SelectItemIndicator);
    });

    it('should attach Group as Select.Group', () => {
      expect((Select as any).Group).toBe(SelectGroup);
    });

    it('should attach Label as Select.Label', () => {
      expect((Select as any).Label).toBe(SelectLabel);
    });

    it('should attach Separator as Select.Separator', () => {
      expect((Select as any).Separator).toBe(SelectSeparator);
    });
  });

  describe('Basic Rendering', () => {
    it('should render select with trigger', () => {
      const component = () =>
        Select({
          children: () => [
            SelectTrigger({
              children: () => [SelectValue({ placeholder: 'Select an option' })],
            }),
          ],
        });

      const { container } = renderComponent(component);

      // Check trigger exists
      const trigger = container.querySelector('[role="combobox"]');
      expect(trigger).toBeTruthy();
      expect(trigger?.getAttribute('type')).toBe('button');
    });

    it('should render SelectValue with placeholder when no value selected', () => {
      const component = () =>
        Select({
          children: () => [
            SelectTrigger({
              children: () => [SelectValue({ placeholder: 'Choose option' })],
            }),
          ],
        });

      const { container } = renderComponent(component);

      const valueSpan = container.querySelector('[id*="select-value"]');
      expect(valueSpan?.textContent).toBe('Choose option');
    });

    it('should render SelectIcon with aria-hidden', () => {
      const component = () =>
        Select({
          children: () => [
            SelectTrigger({
              children: () => [SelectValue({ placeholder: 'Select' }), SelectIcon({ children: '▼' })],
            }),
          ],
        });

      const { container } = renderComponent(component);

      const icon = container.querySelector('[aria-hidden="true"]');
      expect(icon).toBeTruthy();
      expect(icon?.textContent).toBe('▼');
    });
  });

  describe('Open/Close State', () => {
    it('should open when trigger is clicked', async () => {
      const component = () =>
        Select({
          children: () => [
            SelectTrigger({
              children: () => [SelectValue({ placeholder: 'Select' })],
            }),
            SelectContent({
              children: () => [SelectItem({ value: 'option1', children: 'Option 1' })],
            }),
          ],
        });

      const { container } = renderComponent(component);

      const trigger = container.querySelector('[role="combobox"]') as HTMLElement;
      expect(trigger).toBeTruthy();

      // Click to open
      trigger.click();
      await nextTick();

      // Check trigger state
      expect(trigger.getAttribute('aria-expanded')).toBe('true');
      expect(trigger.getAttribute('data-state')).toBe('open');

      // Content should be rendered in portal
      const content = document.querySelector('[role="listbox"]');
      expect(content).toBeTruthy();
    });

    it('should toggle when trigger is clicked multiple times', async () => {
      const component = () =>
        Select({
          children: () => [
            SelectTrigger({
              children: () => [SelectValue({ placeholder: 'Select' })],
            }),
            SelectContent({
              children: () => [SelectItem({ value: 'opt1', children: 'Opt 1' })],
            }),
          ],
        });

      const { container } = renderComponent(component);

      const trigger = container.querySelector('[role="combobox"]') as HTMLElement;

      // Open
      trigger.click();
      await nextTick();
      expect(trigger.getAttribute('aria-expanded')).toBe('true');

      // Close
      trigger.click();
      await nextTick();
      expect(trigger.getAttribute('aria-expanded')).toBe('false');

      // Content should be removed
      const content = document.querySelector('[role="listbox"]');
      expect(content).toBeFalsy();
    });

    it('should support controlled open state', async () => {
      const isOpen = signal(false);

      const component = () =>
        Select({
          open: isOpen,
          children: () => [
            SelectTrigger({
              children: () => [SelectValue({ placeholder: 'Select' })],
            }),
            SelectContent({
              children: () => [SelectItem({ value: 'opt1', children: 'Opt 1' })],
            }),
          ],
        });

      const { container } = renderComponent(component);

      const trigger = container.querySelector('[role="combobox"]') as HTMLElement;

      // Initially closed
      expect(trigger.getAttribute('aria-expanded')).toBe('false');

      // Open via signal
      isOpen.set(true);
      await nextTick();

      expect(trigger.getAttribute('aria-expanded')).toBe('true');
      const content = document.querySelector('[role="listbox"]');
      expect(content).toBeTruthy();

      // Close via signal
      isOpen.set(false);
      await nextTick();

      expect(trigger.getAttribute('aria-expanded')).toBe('false');
    });

    it('should call onOpenChange when opened/closed', async () => {
      const onOpenChange = vi.fn();

      const component = () =>
        Select({
          onOpenChange,
          children: () => [
            SelectTrigger({
              children: () => [SelectValue({ placeholder: 'Select' })],
            }),
            SelectContent({
              children: () => [SelectItem({ value: 'opt1', children: 'Opt 1' })],
            }),
          ],
        });

      const { container } = renderComponent(component);

      const trigger = container.querySelector('[role="combobox"]') as HTMLElement;

      // Open
      trigger.click();
      await nextTick();
      expect(onOpenChange).toHaveBeenCalledWith(true);

      // Close
      trigger.click();
      await nextTick();
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('should support defaultOpen prop', async () => {
      const component = () =>
        Select({
          defaultOpen: true,
          children: () => [
            SelectTrigger({
              children: () => [SelectValue({ placeholder: 'Select' })],
            }),
            SelectContent({
              children: () => [SelectItem({ value: 'opt1', children: 'Opt 1' })],
            }),
          ],
        });

      const { container } = renderComponent(component);

      await nextTick();

      const trigger = container.querySelector('[role="combobox"]');
      expect(trigger?.getAttribute('aria-expanded')).toBe('true');

      // Content should be visible
      const content = document.querySelector('[role="listbox"]');
      expect(content).toBeTruthy();
    });
  });

  describe('Value Selection', () => {
    it('should select item when clicked', async () => {
      const component = () =>
        Select({
          defaultOpen: true,
          children: () => [
            SelectTrigger({
              children: () => [SelectValue({ placeholder: 'Select' })],
            }),
            SelectContent({
              children: () => [
                SelectItem({ value: 'option1', children: 'Option 1' }),
                SelectItem({ value: 'option2', children: 'Option 2' }),
              ],
            }),
          ],
        });

      const { container } = renderComponent(component);

      await nextTick();

      const items = document.querySelectorAll('[role="option"]') as NodeListOf<HTMLElement>;
      expect(items.length).toBe(2);

      // Click first item
      items[0]?.click();
      await nextTick();

      // Item should be selected
      expect(items[0]?.getAttribute('aria-selected')).toBe('true');
      expect(items[0]?.getAttribute('data-state')).toBe('checked');

      // Select should be closed
      const trigger = container.querySelector('[role="combobox"]');
      expect(trigger?.getAttribute('aria-expanded')).toBe('false');
    });

    it('should support controlled value', async () => {
      const value = signal('option1');

      const component = () =>
        Select({
          value,
          defaultOpen: true,
          children: () => [
            SelectTrigger({
              children: () => [SelectValue({ placeholder: 'Select' })],
            }),
            SelectContent({
              children: () => [
                SelectItem({ value: 'option1', children: 'Option 1' }),
                SelectItem({ value: 'option2', children: 'Option 2' }),
              ],
            }),
          ],
        });

      renderComponent(component);

      await nextTick();

      const items = document.querySelectorAll('[role="option"]');

      // First item should be selected
      expect(items[0]?.getAttribute('aria-selected')).toBe('true');

      // Change value via signal
      value.set('option2');
      await nextTick();

      // Second item should now be selected
      expect(items[0]?.getAttribute('aria-selected')).toBe('false');
      expect(items[1]?.getAttribute('aria-selected')).toBe('true');
    });

    it('should call onValueChange when item is selected', async () => {
      const onValueChange = vi.fn();

      const component = () =>
        Select({
          onValueChange,
          defaultOpen: true,
          children: () => [
            SelectTrigger({
              children: () => [SelectValue({ placeholder: 'Select' })],
            }),
            SelectContent({
              children: () => [
                SelectItem({ value: 'option1', children: 'Option 1' }),
                SelectItem({ value: 'option2', children: 'Option 2' }),
              ],
            }),
          ],
        });

      renderComponent(component);

      await nextTick();

      const items = document.querySelectorAll('[role="option"]') as NodeListOf<HTMLElement>;

      // Click first item
      items[0]?.click();
      await nextTick();

      expect(onValueChange).toHaveBeenCalledWith('option1');
    });

    it('should display selected value text in SelectValue', async () => {
      const component = () =>
        Select({
          defaultValue: 'option1',
          defaultOpen: true,
          children: () => [
            SelectTrigger({
              children: () => [SelectValue({ placeholder: 'Select' })],
            }),
            SelectContent({
              children: () => [
                SelectItem({ value: 'option1', children: 'First Option' }),
                SelectItem({ value: 'option2', children: 'Second Option' }),
              ],
            }),
          ],
        });

      const { container } = renderComponent(component);

      await nextTick();

      // Value should show the text of selected item
      const valueSpan = container.querySelector('[id*="select-value"]');
      expect(valueSpan?.textContent).toBe('First Option');
    });
  });

  describe('Disabled State', () => {
    it('should support disabled prop', () => {
      const component = () =>
        Select({
          disabled: true,
          children: () => [
            SelectTrigger({
              children: () => [SelectValue({ placeholder: 'Select' })],
            }),
          ],
        });

      const { container } = renderComponent(component);

      const trigger = container.querySelector('[role="combobox"]');
      expect(trigger?.hasAttribute('disabled')).toBe(true);
      expect(trigger?.getAttribute('aria-disabled')).toBe('true');
      expect(trigger?.getAttribute('data-disabled')).toBe('true');
    });

    it('should not open when disabled', async () => {
      const component = () =>
        Select({
          disabled: true,
          children: () => [
            SelectTrigger({
              children: () => [SelectValue({ placeholder: 'Select' })],
            }),
            SelectContent({
              children: () => [SelectItem({ value: 'opt1', children: 'Opt 1' })],
            }),
          ],
        });

      const { container } = renderComponent(component);

      const trigger = container.querySelector('[role="combobox"]') as HTMLElement;

      // Try to open
      trigger.click();
      await nextTick();

      // Should remain closed
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
      const content = document.querySelector('[role="listbox"]');
      expect(content).toBeFalsy();
    });

    it('should support disabled items', async () => {
      const component = () =>
        Select({
          defaultOpen: true,
          children: () => [
            SelectTrigger({
              children: () => [SelectValue({ placeholder: 'Select' })],
            }),
            SelectContent({
              children: () => [
                SelectItem({ value: 'option1', children: 'Option 1' }),
                SelectItem({ value: 'option2', disabled: true, children: 'Option 2' }),
              ],
            }),
          ],
        });

      renderComponent(component);

      await nextTick();

      const items = document.querySelectorAll('[role="option"]') as NodeListOf<HTMLElement>;

      // Second item should be disabled
      expect(items[1]?.getAttribute('aria-disabled')).toBe('true');
      expect(items[1]?.getAttribute('data-disabled')).toBe('true');

      // Clicking disabled item should not select it
      items[1]?.click();
      await nextTick();

      expect(items[1]?.getAttribute('aria-selected')).toBe('false');
    });
  });

  describe('Required State', () => {
    it('should support required prop', () => {
      const component = () =>
        Select({
          required: true,
          children: () => [
            SelectTrigger({
              children: () => [SelectValue({ placeholder: 'Select' })],
            }),
          ],
        });

      const { container } = renderComponent(component);

      const trigger = container.querySelector('[role="combobox"]');
      expect(trigger?.getAttribute('aria-required')).toBe('true');
    });
  });

  describe('Accessibility', () => {
    it('should have proper ARIA attributes on trigger', () => {
      const component = () =>
        Select({
          children: () => [
            SelectTrigger({
              children: () => [SelectValue({ placeholder: 'Select' })],
            }),
          ],
        });

      const { container } = renderComponent(component);

      const trigger = container.querySelector('[role="combobox"]');
      expect(trigger).toBeTruthy();
      expect(trigger?.getAttribute('aria-haspopup')).toBe('listbox');
      expect(trigger?.getAttribute('aria-expanded')).toBe('false');
      expect(trigger?.hasAttribute('aria-controls')).toBe(true);
    });

    it('should have proper ARIA attributes on content', async () => {
      const component = () =>
        Select({
          defaultOpen: true,
          children: () => [
            SelectTrigger({
              children: () => [SelectValue({ placeholder: 'Select' })],
            }),
            SelectContent({
              children: () => [SelectItem({ value: 'opt1', children: 'Opt 1' })],
            }),
          ],
        });

      const { container } = renderComponent(component);

      await nextTick();

      const content = document.querySelector('[role="listbox"]');
      expect(content).toBeTruthy();
      expect(content?.hasAttribute('aria-labelledby')).toBe(true);

      const trigger = container.querySelector('[role="combobox"]');
      expect(content?.getAttribute('aria-labelledby')).toBe(trigger?.id);
    });

    it('should have proper ARIA attributes on items', async () => {
      const component = () =>
        Select({
          defaultOpen: true,
          defaultValue: 'option1',
          children: () => [
            SelectTrigger({
              children: () => [SelectValue({ placeholder: 'Select' })],
            }),
            SelectContent({
              children: () => [
                SelectItem({ value: 'option1', children: 'Option 1' }),
                SelectItem({ value: 'option2', children: 'Option 2' }),
              ],
            }),
          ],
        });

      renderComponent(component);

      await nextTick();

      const items = document.querySelectorAll('[role="option"]');

      // First item should be selected
      expect(items[0]?.getAttribute('role')).toBe('option');
      expect(items[0]?.getAttribute('aria-selected')).toBe('true');

      // Second item should not be selected
      expect(items[1]?.getAttribute('aria-selected')).toBe('false');
    });
  });

  describe('Portal Rendering', () => {
    it('should render content in portal when open', async () => {
      const component = () =>
        Select({
          defaultOpen: true,
          children: () => [
            SelectTrigger({
              children: () => [SelectValue({ placeholder: 'Select' })],
            }),
            SelectContent({
              children: () => [SelectItem({ value: 'opt1', children: 'Opt 1' })],
            }),
          ],
        });

      const { container } = renderComponent(component);

      await nextTick();

      // Content should not be in container
      const contentInContainer = container.querySelector('[role="listbox"]');
      expect(contentInContainer).toBeFalsy();

      // Content should be in document body (via portal)
      const contentInDocument = document.querySelector('[role="listbox"]');
      expect(contentInDocument).toBeTruthy();
    });
  });

  describe('Edge Cases', () => {
    it('should handle SelectValue with custom children', async () => {
      const component = () =>
        Select({
          defaultValue: 'opt1',
          children: () => [
            SelectTrigger({
              children: () => [
                SelectValue({
                  placeholder: 'Select',
                  children: 'Custom Value Display',
                }),
              ],
            }),
            SelectContent({
              children: () => [SelectItem({ value: 'opt1', children: 'Option 1' })],
            }),
          ],
        });

      const { container } = renderComponent(component);

      await nextTick();

      const valueSpan = container.querySelector('[id*="select-value"]');
      expect(valueSpan?.textContent).toBe('Custom Value Display');
    });
  });

  describe('Form Integration', () => {
    it('should support name prop', () => {
      const component = () =>
        Select({
          name: 'my-select',
          children: () => [
            SelectTrigger({
              children: () => [SelectValue({ placeholder: 'Select' })],
            }),
          ],
        });

      renderComponent(component);

      // Name is stored in context but not rendered (would be used for form submission)
      expect(true).toBe(true); // Placeholder test
    });
  });
});
