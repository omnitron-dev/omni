/**
 * Combobox Primitive Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  Combobox,
  ComboboxTrigger,
  ComboboxInput,
  ComboboxIcon,
  ComboboxContent,
  ComboboxViewport,
  ComboboxItem,
  ComboboxEmpty,
} from '../../../src/primitives/Combobox.js';
import { renderComponent } from '../../helpers/test-utils.js';

describe('Combobox', () => {
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
    it('should render Combobox root', () => {
      const { container, cleanup: dispose } = renderComponent(() => Combobox({}));
      cleanup = dispose;

      const root = container.querySelector('[data-combobox]');
      expect(root).toBeTruthy();
    });

    it('should render as div element', () => {
      const { container, cleanup: dispose } = renderComponent(() => Combobox({}));
      cleanup = dispose;

      const root = container.querySelector('[data-combobox]');
      expect(root?.tagName).toBe('DIV');
    });

    it('should render with disabled state', () => {
      const { container, cleanup: dispose } = renderComponent(() => Combobox({ disabled: true }));
      cleanup = dispose;

      const root = container.querySelector('[data-combobox]');
      expect(root?.hasAttribute('data-disabled')).toBe(true);
    });

    it('should not have data-disabled when not disabled', () => {
      const { container, cleanup: dispose } = renderComponent(() => Combobox({ disabled: false }));
      cleanup = dispose;

      const root = container.querySelector('[data-combobox]');
      expect(root?.hasAttribute('data-disabled')).toBe(false);
    });

    it('should render with children using function (Pattern 17)', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          children: () => ComboboxTrigger({ children: 'Select' }),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-combobox-trigger]');
      expect(trigger).toBeTruthy();
    });

    it('should render multiple children using function (Pattern 17)', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          defaultOpen: true,
          children: () => [
            ComboboxTrigger({ children: ComboboxInput({}) }),
            ComboboxContent({ portal: false, children: 'Content' }),
          ],
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-combobox-trigger]');
      const content = container.querySelector('[data-combobox-content]');
      expect(trigger).toBeTruthy();
      expect(content).toBeTruthy();
    });

    it('should render all sub-components together', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          defaultOpen: true,
          children: () => [
            ComboboxTrigger({ children: ComboboxInput({}) }),
            ComboboxContent({
              portal: false,
              children: [
                ComboboxViewport({
                  children: [
                    ComboboxItem({ value: 'item1', children: 'Item 1' }),
                    ComboboxEmpty({ children: 'No results' }),
                  ],
                }),
              ],
            }),
          ],
        })
      );
      cleanup = dispose;

      expect(container.querySelector('[data-combobox-trigger]')).toBeTruthy();
      expect(container.querySelector('[data-combobox-input]')).toBeTruthy();
      expect(container.querySelector('[data-combobox-content]')).toBeTruthy();
      expect(container.querySelector('[data-combobox-viewport]')).toBeTruthy();
      expect(container.querySelector('[data-combobox-item]')).toBeTruthy();
      expect(container.querySelector('[data-combobox-empty]')).toBeTruthy();
    });

    it('should render with empty children', () => {
      const { container, cleanup: dispose } = renderComponent(() => Combobox({ children: () => null }));
      cleanup = dispose;

      const root = container.querySelector('[data-combobox]');
      expect(root).toBeTruthy();
      expect(root?.textContent).toBe('');
    });

    it('should render with closed state by default', () => {
      const { container, cleanup: dispose } = renderComponent(() => Combobox({}));
      cleanup = dispose;

      const root = container.querySelector('[data-combobox]');
      expect(root?.getAttribute('data-state')).toBe('closed');
    });

    it('should render with open state when defaultOpen is true', () => {
      const { container, cleanup: dispose } = renderComponent(() => Combobox({ defaultOpen: true }));
      cleanup = dispose;

      const root = container.querySelector('[data-combobox]');
      expect(root?.getAttribute('data-state')).toBe('open');
    });

    it('should render with custom className', () => {
      const { container, cleanup: dispose } = renderComponent(() => Combobox({ class: 'custom-combobox' }));
      cleanup = dispose;

      const root = container.querySelector('[data-combobox]');
      expect(root?.className).toContain('custom-combobox');
    });

    it('should render ComboboxIcon', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          children: () =>
            ComboboxTrigger({
              children: [ComboboxInput({}), ComboboxIcon({ children: '▼' })],
            }),
        })
      );
      cleanup = dispose;

      const icon = container.querySelector('[data-combobox-icon]');
      expect(icon).toBeTruthy();
      expect(icon?.textContent).toBe('▼');
    });
  });

  // ==========================================================================
  // Context Tests (8 tests)
  // ==========================================================================

  describe('Context Tests', () => {
    it('should provide value signal through context', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          defaultValue: 'test',
          defaultOpen: true,
          children: () =>
            ComboboxContent({
              portal: false,
              children: ComboboxItem({ value: 'test', children: 'Test' }),
            }),
        })
      );
      cleanup = dispose;

      const item = container.querySelector('[data-combobox-item]');
      expect(item?.hasAttribute('aria-selected')).toBe(true);
    });

    it('should provide open state through context', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          defaultOpen: true,
          children: () => ComboboxTrigger({ children: ComboboxInput({}) }),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-combobox-trigger]');
      expect(trigger?.getAttribute('data-state')).toBe('open');
    });

    it('should provide disabled state through context', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          disabled: true,
          children: () => ComboboxTrigger({ children: ComboboxInput({}) }),
        })
      );
      cleanup = dispose;

      const input = container.querySelector('[data-combobox-input]') as HTMLInputElement;
      expect(input.disabled).toBe(true);
    });

    it('should allow sub-components to access context', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          defaultOpen: true,
          children: () => [
            ComboboxTrigger({ children: ComboboxInput({}) }),
            ComboboxContent({
              portal: false,
              children: ComboboxItem({ value: 'test', children: 'Test' }),
            }),
          ],
        })
      );
      cleanup = dispose;

      expect(container.querySelector('[data-combobox-trigger]')).toBeTruthy();
      expect(container.querySelector('[data-combobox-input]')).toBeTruthy();
      expect(container.querySelector('[data-combobox-content]')).toBeTruthy();
      expect(container.querySelector('[data-combobox-item]')).toBeTruthy();
    });

    it('should provide trigger ID through context', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          children: () => ComboboxTrigger({ children: ComboboxInput({}) }),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-combobox-trigger]');
      expect(trigger?.id).toBeTruthy();
      expect(trigger?.id).toMatch(/combobox-trigger-/);
    });

    it('should provide content ID through context', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          defaultOpen: true,
          children: () => ComboboxContent({ portal: false }),
        })
      );
      cleanup = dispose;

      const content = container.querySelector('[data-combobox-content]');
      expect(content?.id).toBeTruthy();
      expect(content?.id).toMatch(/combobox-content-/);
    });

    it('should link input to content via aria-controls', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          defaultOpen: true,
          children: () => [ComboboxTrigger({ children: ComboboxInput({}) }), ComboboxContent({ portal: false })],
        })
      );
      cleanup = dispose;

      const input = container.querySelector('[data-combobox-input]');
      const content = container.querySelector('[data-combobox-content]');
      expect(input?.getAttribute('aria-controls')).toBe(content?.id);
    });

    it('should register and track item values', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          defaultOpen: true,
          children: () =>
            ComboboxContent({
              portal: false,
              children: [
                ComboboxItem({ value: 'item1', children: 'Item 1' }),
                ComboboxItem({ value: 'item2', children: 'Item 2' }),
                ComboboxItem({ value: 'item3', children: 'Item 3' }),
              ],
            }),
        })
      );
      cleanup = dispose;

      const items = container.querySelectorAll('[data-combobox-item]');
      expect(items.length).toBe(3);
    });
  });

  // ==========================================================================
  // Controlled/Uncontrolled Tests (7 tests)
  // ==========================================================================

  describe('Controlled/Uncontrolled Tests', () => {
    it('should work in uncontrolled mode with defaultValue', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          defaultValue: 'test',
          defaultOpen: true,
          children: () =>
            ComboboxContent({
              portal: false,
              children: ComboboxItem({ value: 'test', children: 'Test' }),
            }),
        })
      );
      cleanup = dispose;

      const item = container.querySelector('[data-combobox-item]');
      expect(item?.getAttribute('data-state')).toBe('checked');
    });

    it('should work in controlled mode with value prop', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          value: 'controlled',
          defaultOpen: true,
          children: () =>
            ComboboxContent({
              portal: false,
              children: ComboboxItem({ value: 'controlled', children: 'Controlled' }),
            }),
        })
      );
      cleanup = dispose;

      const item = container.querySelector('[data-combobox-item]');
      expect(item?.hasAttribute('aria-selected')).toBe(true);
    });

    it('should call onValueChange callback when value changes', () => {
      const onValueChange = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          defaultOpen: true,
          onValueChange,
          children: () =>
            ComboboxContent({
              portal: false,
              children: ComboboxItem({ value: 'test', children: 'Test' }),
            }),
        })
      );
      cleanup = dispose;

      const item = container.querySelector('[data-combobox-item]') as HTMLElement;
      item.click();

      expect(onValueChange).toHaveBeenCalledWith('test');
    });

    it('should use controlled value over internal state', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          value: 'controlled',
          defaultValue: 'default',
          defaultOpen: true,
          children: () =>
            ComboboxContent({
              portal: false,
              children: [
                ComboboxItem({ value: 'controlled', children: 'Controlled' }),
                ComboboxItem({ value: 'default', children: 'Default' }),
              ],
            }),
        })
      );
      cleanup = dispose;

      const items = container.querySelectorAll('[data-combobox-item]');
      expect(items[0]?.hasAttribute('aria-selected')).toBe(true);
      expect(items[1]?.hasAttribute('aria-selected')).toBe(false);
    });

    it('should work in controlled open state', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          open: true,
          children: () => ComboboxContent({ portal: false }),
        })
      );
      cleanup = dispose;

      const content = container.querySelector('[data-combobox-content]');
      expect(content).toBeTruthy();
    });

    it('should call onOpenChange callback when open state changes', () => {
      const onOpenChange = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          onOpenChange,
          children: () => ComboboxTrigger({ children: ComboboxInput({}) }),
        })
      );
      cleanup = dispose;

      const input = container.querySelector('[data-combobox-input]') as HTMLInputElement;
      input.focus();

      expect(onOpenChange).toHaveBeenCalledWith(true);
    });

    it('should default to null value when no value provided', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          defaultOpen: true,
          children: () =>
            ComboboxContent({
              portal: false,
              children: ComboboxItem({ value: 'test', children: 'Test' }),
            }),
        })
      );
      cleanup = dispose;

      const item = container.querySelector('[data-combobox-item]');
      expect(item?.hasAttribute('aria-selected')).toBe(false);
    });
  });

  // ==========================================================================
  // ComboboxTrigger Tests (6 tests)
  // ==========================================================================

  describe('ComboboxTrigger Tests', () => {
    it('should render as div', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          children: () => ComboboxTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-combobox-trigger]');
      expect(trigger?.tagName).toBe('DIV');
    });

    it('should have data-state attribute', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          defaultOpen: true,
          children: () => ComboboxTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-combobox-trigger]');
      expect(trigger?.getAttribute('data-state')).toBe('open');
    });

    it('should have data-disabled when combobox is disabled', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          disabled: true,
          children: () => ComboboxTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-combobox-trigger]');
      expect(trigger?.hasAttribute('data-disabled')).toBe(true);
    });

    it('should render children', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          children: () => ComboboxTrigger({ children: 'Select item' }),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-combobox-trigger]');
      expect(trigger?.textContent).toBe('Select item');
    });

    it('should have unique ID', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          children: () => ComboboxTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-combobox-trigger]');
      expect(trigger?.id).toMatch(/combobox-trigger-/);
    });

    it('should accept additional props', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          children: () =>
            ComboboxTrigger({
              'data-testid': 'custom-trigger',
              className: 'custom-class',
            }),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-combobox-trigger]');
      expect(trigger?.getAttribute('data-testid')).toBe('custom-trigger');
      expect(trigger?.className).toContain('custom-class');
    });
  });

  // ==========================================================================
  // ComboboxInput Tests (10 tests)
  // ==========================================================================

  describe('ComboboxInput Tests', () => {
    it('should render as input element', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          children: () => ComboboxTrigger({ children: ComboboxInput({}) }),
        })
      );
      cleanup = dispose;

      const input = container.querySelector('[data-combobox-input]');
      expect(input?.tagName).toBe('INPUT');
    });

    it('should have role="combobox"', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          children: () => ComboboxTrigger({ children: ComboboxInput({}) }),
        })
      );
      cleanup = dispose;

      const input = container.querySelector('[data-combobox-input]');
      expect(input?.getAttribute('role')).toBe('combobox');
    });

    it('should have aria-expanded attribute', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          open: true,
          children: () => ComboboxTrigger({ children: ComboboxInput({}) }),
        })
      );
      cleanup = dispose;

      const input = container.querySelector('[data-combobox-input]');
      expect(input?.hasAttribute('aria-expanded')).toBe(true);
    });

    it('should have aria-autocomplete="list"', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          children: () => ComboboxTrigger({ children: ComboboxInput({}) }),
        })
      );
      cleanup = dispose;

      const input = container.querySelector('[data-combobox-input]');
      expect(input?.getAttribute('aria-autocomplete')).toBe('list');
    });

    it('should be disabled when combobox is disabled', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          disabled: true,
          children: () => ComboboxTrigger({ children: ComboboxInput({}) }),
        })
      );
      cleanup = dispose;

      const input = container.querySelector('[data-combobox-input]') as HTMLInputElement;
      expect(input.disabled).toBe(true);
    });

    it('should open combobox on focus', () => {
      const onOpenChange = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          onOpenChange,
          children: () => ComboboxTrigger({ children: ComboboxInput({}) }),
        })
      );
      cleanup = dispose;

      const input = container.querySelector('[data-combobox-input]') as HTMLInputElement;
      input.focus();

      expect(onOpenChange).toHaveBeenCalledWith(true);
    });

    it('should call onInput callback', () => {
      const onInput = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          children: () => ComboboxTrigger({ children: ComboboxInput({ onInput }) }),
        })
      );
      cleanup = dispose;

      const input = container.querySelector('[data-combobox-input]') as HTMLInputElement;
      const event = new Event('input', { bubbles: true });
      input.value = 'test';
      input.dispatchEvent(event);

      expect(onInput).toHaveBeenCalled();
    });

    it('should have value prop', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          children: () => ComboboxTrigger({ children: ComboboxInput({ value: 'search' }) }),
        })
      );
      cleanup = dispose;

      const input = container.querySelector('[data-combobox-input]') as HTMLInputElement;
      expect(input.value).toBe('search');
    });

    it('should have data-state attribute', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          defaultOpen: true,
          children: () => ComboboxTrigger({ children: ComboboxInput({}) }),
        })
      );
      cleanup = dispose;

      const input = container.querySelector('[data-combobox-input]');
      expect(input?.getAttribute('data-state')).toBe('open');
    });

    it('should have type="text"', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          children: () => ComboboxTrigger({ children: ComboboxInput({}) }),
        })
      );
      cleanup = dispose;

      const input = container.querySelector('[data-combobox-input]') as HTMLInputElement;
      expect(input.type).toBe('text');
    });
  });

  // ==========================================================================
  // ComboboxContent Tests (8 tests)
  // ==========================================================================

  describe('ComboboxContent Tests', () => {
    it('should render when open', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          defaultOpen: true,
          children: () => ComboboxContent({ portal: false }),
        })
      );
      cleanup = dispose;

      const content = container.querySelector('[data-combobox-content]');
      expect(content).toBeTruthy();
    });

    it('should not render when closed', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          defaultOpen: false,
          children: () => ComboboxContent({}),
        })
      );
      cleanup = dispose;

      const content = container.querySelector('[data-combobox-content]');
      expect(content).toBeNull();
    });

    it('should have role="listbox"', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          defaultOpen: true,
          children: () => ComboboxContent({ portal: false }),
        })
      );
      cleanup = dispose;

      const content = container.querySelector('[data-combobox-content]');
      expect(content?.getAttribute('role')).toBe('listbox');
    });

    it('should have data-state="open"', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          defaultOpen: true,
          children: () => ComboboxContent({ portal: false }),
        })
      );
      cleanup = dispose;

      const content = container.querySelector('[data-combobox-content]');
      expect(content?.getAttribute('data-state')).toBe('open');
    });

    it('should render in portal by default', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          defaultOpen: true,
          children: () => ComboboxContent({ children: 'Content' }),
        })
      );
      cleanup = dispose;

      // Content should be in portal (body), not in the combobox root
      const content = document.body.querySelector('[data-combobox-content]');
      expect(content).toBeTruthy();
    });

    it('should not render in portal when portal=false', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          defaultOpen: true,
          children: () => ComboboxContent({ portal: false, children: 'Content' }),
        })
      );
      cleanup = dispose;

      const root = container.querySelector('[data-combobox]');
      const content = root?.querySelector('[data-combobox-content]');
      expect(content).toBeTruthy();
    });

    it('should apply zIndex style', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          defaultOpen: true,
          children: () => ComboboxContent({ portal: false, zIndex: 100 }),
        })
      );
      cleanup = dispose;

      const content = container.querySelector('[data-combobox-content]') as HTMLElement;
      expect(content?.style.zIndex).toBe('100');
    });

    it('should have absolute position', () => {
      const { cleanup: dispose } = renderComponent(() =>
        Combobox({
          defaultOpen: true,
          children: () => ComboboxContent({}),
        })
      );
      cleanup = dispose;

      const content = document.body.querySelector('[data-combobox-content]') as HTMLElement;
      expect(content?.style.position).toBe('absolute');
    });
  });

  // ==========================================================================
  // ComboboxViewport Tests (3 tests)
  // ==========================================================================

  describe('ComboboxViewport Tests', () => {
    it('should render as div', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          defaultOpen: true,
          children: () => ComboboxContent({ portal: false, children: ComboboxViewport({}) }),
        })
      );
      cleanup = dispose;

      const viewport = container.querySelector('[data-combobox-viewport]');
      expect(viewport?.tagName).toBe('DIV');
    });

    it('should render children', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          defaultOpen: true,
          children: () =>
            ComboboxContent({
              portal: false,
              children: ComboboxViewport({ children: 'Viewport content' }),
            }),
        })
      );
      cleanup = dispose;

      const viewport = container.querySelector('[data-combobox-viewport]');
      expect(viewport?.textContent).toBe('Viewport content');
    });

    it('should accept additional props', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          defaultOpen: true,
          children: () =>
            ComboboxContent({
              portal: false,
              children: ComboboxViewport({
                'data-testid': 'viewport',
                className: 'custom-viewport',
              }),
            }),
        })
      );
      cleanup = dispose;

      const viewport = container.querySelector('[data-combobox-viewport]');
      expect(viewport?.getAttribute('data-testid')).toBe('viewport');
      expect(viewport?.className).toContain('custom-viewport');
    });
  });

  // ==========================================================================
  // ComboboxItem Tests (10 tests)
  // ==========================================================================

  describe('ComboboxItem Tests', () => {
    it('should render as div', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          defaultOpen: true,
          children: () => ComboboxContent({ portal: false, children: ComboboxItem({ value: 'test' }) }),
        })
      );
      cleanup = dispose;

      const item = container.querySelector('[data-combobox-item]');
      expect(item?.tagName).toBe('DIV');
    });

    it('should have role="option"', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          defaultOpen: true,
          children: () => ComboboxContent({ portal: false, children: ComboboxItem({ value: 'test' }) }),
        })
      );
      cleanup = dispose;

      const item = container.querySelector('[data-combobox-item]');
      expect(item?.getAttribute('role')).toBe('option');
    });

    it('should have aria-selected when selected', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          defaultValue: 'test',
          defaultOpen: true,
          children: () => ComboboxContent({ portal: false, children: ComboboxItem({ value: 'test' }) }),
        })
      );
      cleanup = dispose;

      const item = container.querySelector('[data-combobox-item]');
      expect(item?.hasAttribute('aria-selected')).toBe(true);
    });

    it('should have data-state="checked" when selected', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          defaultValue: 'test',
          defaultOpen: true,
          children: () => ComboboxContent({ portal: false, children: ComboboxItem({ value: 'test' }) }),
        })
      );
      cleanup = dispose;

      const item = container.querySelector('[data-combobox-item]');
      expect(item?.getAttribute('data-state')).toBe('checked');
    });

    it('should have data-state="unchecked" when not selected', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          defaultOpen: true,
          children: () => ComboboxContent({ portal: false, children: ComboboxItem({ value: 'test' }) }),
        })
      );
      cleanup = dispose;

      const item = container.querySelector('[data-combobox-item]');
      expect(item?.getAttribute('data-state')).toBe('unchecked');
    });

    it('should call selectItem on click', () => {
      const onValueChange = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          defaultOpen: true,
          onValueChange,
          children: () =>
            ComboboxContent({
              portal: false,
              children: ComboboxItem({ value: 'test', children: 'Test' }),
            }),
        })
      );
      cleanup = dispose;

      const item = container.querySelector('[data-combobox-item]') as HTMLElement;
      item.click();

      expect(onValueChange).toHaveBeenCalledWith('test');
    });

    it('should not call selectItem when disabled', () => {
      const onValueChange = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          defaultOpen: true,
          onValueChange,
          children: () =>
            ComboboxContent({
              portal: false,
              children: ComboboxItem({ value: 'test', disabled: true }),
            }),
        })
      );
      cleanup = dispose;

      const item = container.querySelector('[data-combobox-item]') as HTMLElement;
      item.click();

      expect(onValueChange).not.toHaveBeenCalled();
    });

    it('should have data-disabled when disabled', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          defaultOpen: true,
          children: () =>
            ComboboxContent({
              portal: false,
              children: ComboboxItem({ value: 'test', disabled: true }),
            }),
        })
      );
      cleanup = dispose;

      const item = container.querySelector('[data-combobox-item]');
      expect(item?.hasAttribute('data-disabled')).toBe(true);
    });

    it('should have data-highlighted when mouse enters', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          defaultOpen: true,
          children: () =>
            ComboboxContent({
              portal: false,
              children: [
                ComboboxItem({ value: 'item1', children: 'Item 1' }),
                ComboboxItem({ value: 'item2', children: 'Item 2' }),
              ],
            }),
        })
      );
      cleanup = dispose;

      const items = container.querySelectorAll('[data-combobox-item]');
      const item = items[0] as HTMLElement;
      const event = new MouseEvent('mouseenter', { bubbles: true });
      item.dispatchEvent(event);

      expect(item.hasAttribute('data-highlighted')).toBe(true);
    });

    it('should render children', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          defaultOpen: true,
          children: () =>
            ComboboxContent({
              portal: false,
              children: ComboboxItem({ value: 'test', children: 'Test Item' }),
            }),
        })
      );
      cleanup = dispose;

      const item = container.querySelector('[data-combobox-item]');
      expect(item?.textContent).toBe('Test Item');
    });
  });

  // ==========================================================================
  // ComboboxEmpty Tests (3 tests)
  // ==========================================================================

  describe('ComboboxEmpty Tests', () => {
    it('should render as div', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          defaultOpen: true,
          children: () => ComboboxContent({ portal: false, children: ComboboxEmpty({}) }),
        })
      );
      cleanup = dispose;

      const empty = container.querySelector('[data-combobox-empty]');
      expect(empty?.tagName).toBe('DIV');
    });

    it('should have role="status"', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          defaultOpen: true,
          children: () => ComboboxContent({ portal: false, children: ComboboxEmpty({}) }),
        })
      );
      cleanup = dispose;

      const empty = container.querySelector('[data-combobox-empty]');
      expect(empty?.getAttribute('role')).toBe('status');
    });

    it('should render children', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          defaultOpen: true,
          children: () =>
            ComboboxContent({
              portal: false,
              children: ComboboxEmpty({ children: 'No results found' }),
            }),
        })
      );
      cleanup = dispose;

      const empty = container.querySelector('[data-combobox-empty]');
      expect(empty?.textContent).toBe('No results found');
    });
  });

  // ==========================================================================
  // Keyboard Navigation Tests (10 tests)
  // ==========================================================================

  describe('Keyboard Navigation Tests', () => {
    it('should open on ArrowDown', () => {
      const onOpenChange = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          onOpenChange,
          children: () => ComboboxTrigger({ children: ComboboxInput({}) }),
        })
      );
      cleanup = dispose;

      const input = container.querySelector('[data-combobox-input]') as HTMLInputElement;
      const event = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true });
      input.dispatchEvent(event);

      expect(onOpenChange).toHaveBeenCalledWith(true);
    });

    it('should open on ArrowUp', () => {
      const onOpenChange = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          onOpenChange,
          children: () => ComboboxTrigger({ children: ComboboxInput({}) }),
        })
      );
      cleanup = dispose;

      const input = container.querySelector('[data-combobox-input]') as HTMLInputElement;
      const event = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true });
      input.dispatchEvent(event);

      expect(onOpenChange).toHaveBeenCalledWith(true);
    });

    it('should close on Escape', () => {
      const onOpenChange = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          defaultOpen: true,
          onOpenChange,
          children: () => ComboboxTrigger({ children: ComboboxInput({}) }),
        })
      );
      cleanup = dispose;

      const input = container.querySelector('[data-combobox-input]') as HTMLInputElement;
      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
      input.dispatchEvent(event);

      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('should prevent default on ArrowDown', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          children: () => ComboboxTrigger({ children: ComboboxInput({}) }),
        })
      );
      cleanup = dispose;

      const input = container.querySelector('[data-combobox-input]') as HTMLInputElement;
      const event = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true });
      const spy = vi.spyOn(event, 'preventDefault');
      input.dispatchEvent(event);

      expect(spy).toHaveBeenCalled();
    });

    it('should prevent default on ArrowUp', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          children: () => ComboboxTrigger({ children: ComboboxInput({}) }),
        })
      );
      cleanup = dispose;

      const input = container.querySelector('[data-combobox-input]') as HTMLInputElement;
      const event = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true });
      const spy = vi.spyOn(event, 'preventDefault');
      input.dispatchEvent(event);

      expect(spy).toHaveBeenCalled();
    });

    it('should prevent default on Enter', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          defaultOpen: true,
          children: () => [
            ComboboxTrigger({ children: ComboboxInput({}) }),
            ComboboxContent({
              portal: false,
              children: ComboboxItem({ value: 'test' }),
            }),
          ],
        })
      );
      cleanup = dispose;

      const input = container.querySelector('[data-combobox-input]') as HTMLInputElement;
      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
      const spy = vi.spyOn(event, 'preventDefault');
      input.dispatchEvent(event);

      expect(spy).toHaveBeenCalled();
    });

    it('should prevent default on Escape', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          children: () => ComboboxTrigger({ children: ComboboxInput({}) }),
        })
      );
      cleanup = dispose;

      const input = container.querySelector('[data-combobox-input]') as HTMLInputElement;
      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
      const spy = vi.spyOn(event, 'preventDefault');
      input.dispatchEvent(event);

      expect(spy).toHaveBeenCalled();
    });

    it('should navigate down through items with ArrowDown', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          defaultOpen: true,
          children: () => [
            ComboboxTrigger({ children: ComboboxInput({}) }),
            ComboboxContent({
              portal: false,
              children: [
                ComboboxItem({ value: 'item1', children: 'Item 1' }),
                ComboboxItem({ value: 'item2', children: 'Item 2' }),
                ComboboxItem({ value: 'item3', children: 'Item 3' }),
              ],
            }),
          ],
        })
      );
      cleanup = dispose;

      const input = container.querySelector('[data-combobox-input]') as HTMLInputElement;

      // First ArrowDown should highlight first item
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));

      const items = container.querySelectorAll('[data-combobox-item]');
      expect(items[0]?.hasAttribute('data-highlighted')).toBe(true);
    });

    it('should wrap to first item when pressing ArrowDown on last item', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          defaultOpen: true,
          children: () => [
            ComboboxTrigger({ children: ComboboxInput({}) }),
            ComboboxContent({
              portal: false,
              children: [
                ComboboxItem({ value: 'item1', children: 'Item 1' }),
                ComboboxItem({ value: 'item2', children: 'Item 2' }),
                ComboboxItem({ value: 'item3', children: 'Item 3' }),
              ],
            }),
          ],
        })
      );
      cleanup = dispose;

      const input = container.querySelector('[data-combobox-input]') as HTMLInputElement;

      // Navigate to last item
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      // Wrap around
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));

      const items = container.querySelectorAll('[data-combobox-item]');
      expect(items[0]?.hasAttribute('data-highlighted')).toBe(true);
    });

    it('should select item on Enter when item is highlighted', () => {
      const onValueChange = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          defaultOpen: true,
          onValueChange,
          children: () => [
            ComboboxTrigger({ children: ComboboxInput({}) }),
            ComboboxContent({
              portal: false,
              children: ComboboxItem({ value: 'test', children: 'Test' }),
            }),
          ],
        })
      );
      cleanup = dispose;

      const input = container.querySelector('[data-combobox-input]') as HTMLInputElement;

      // Highlight first item
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      // Select it
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      expect(onValueChange).toHaveBeenCalledWith('test');
    });
  });

  // ==========================================================================
  // Edge Cases (5 tests)
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle empty children', () => {
      const { container, cleanup: dispose } = renderComponent(() => Combobox({ children: undefined }));
      cleanup = dispose;

      const root = container.querySelector('[data-combobox]');
      expect(root).toBeTruthy();
    });

    it('should not open when disabled', () => {
      const onOpenChange = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          disabled: true,
          onOpenChange,
          children: () => ComboboxTrigger({ children: ComboboxInput({}) }),
        })
      );
      cleanup = dispose;

      const input = container.querySelector('[data-combobox-input]') as HTMLInputElement;
      input.focus();

      expect(onOpenChange).not.toHaveBeenCalled();
    });

    it('should handle clicking disabled items', () => {
      const onValueChange = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          defaultOpen: true,
          onValueChange,
          children: () =>
            ComboboxContent({
              portal: false,
              children: ComboboxItem({ value: 'test', disabled: true }),
            }),
        })
      );
      cleanup = dispose;

      const item = container.querySelector('[data-combobox-item]') as HTMLElement;
      item.click();

      expect(onValueChange).not.toHaveBeenCalled();
    });

    it('should focus input after item selection', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          defaultOpen: true,
          children: () => [
            ComboboxTrigger({ children: ComboboxInput({}) }),
            ComboboxContent({
              portal: false,
              children: ComboboxItem({ value: 'test' }),
            }),
          ],
        })
      );
      cleanup = dispose;

      const input = container.querySelector('[data-combobox-input]') as HTMLInputElement;
      const item = container.querySelector('[data-combobox-item]') as HTMLElement;

      // Mock focus for happy-dom
      input.focus = vi.fn();
      item.click();

      expect(input.focus).toHaveBeenCalled();
    });

    it('should reset highlighted index on input', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Combobox({
          defaultOpen: true,
          children: () => [
            ComboboxTrigger({ children: ComboboxInput({}) }),
            ComboboxContent({
              portal: false,
              children: [ComboboxItem({ value: 'item1' }), ComboboxItem({ value: 'item2' })],
            }),
          ],
        })
      );
      cleanup = dispose;

      const input = container.querySelector('[data-combobox-input]') as HTMLInputElement;

      // Highlight an item
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));

      // Type something
      input.value = 'test';
      input.dispatchEvent(new Event('input', { bubbles: true }));

      // Highlighted index should be reset (no items should be highlighted)
      const items = container.querySelectorAll('[data-combobox-item]');
      items.forEach((item) => {
        expect(item.hasAttribute('data-highlighted')).toBe(false);
      });
    });
  });
});
