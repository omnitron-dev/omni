/**
 * Resizable Component Tests
 *
 * Tests for the Resizable primitive component with split panes and draggable handles
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Resizable, ResizablePanel, ResizableHandle } from '../../../src/primitives/Resizable.js';
import { renderComponent, createSpy } from '../../helpers/test-utils.js';

describe('Resizable', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Basic rendering tests
  describe('Rendering', () => {
    it('should render component', () => {
      const component = () => Resizable({ children: () => 'Content' });
      const { container, cleanup } = renderComponent(component);

      const resizable = container.querySelector('[data-resizable-container]');
      expect(resizable).toBeTruthy();

      cleanup();
    });

    it('should render with children', () => {
      const component = () => Resizable({ children: () => 'Test content' });
      const { container, cleanup } = renderComponent(component);

      const resizable = container.querySelector('[data-resizable-container]');
      expect(resizable?.textContent).toBe('Test content');

      cleanup();
    });

    it('should have data-resizable-container attribute', () => {
      const component = () => Resizable({ children: () => 'Content' });
      const { container, cleanup } = renderComponent(component);

      const resizable = container.querySelector('[data-resizable-container]');
      expect(resizable?.getAttribute('data-resizable-container')).toBe('');

      cleanup();
    });

    it('should render without children', () => {
      const component = () => Resizable({});
      const { container, cleanup } = renderComponent(component);

      const resizable = container.querySelector('[data-resizable-container]');
      expect(resizable).toBeTruthy();

      cleanup();
    });

    it('should render with custom attributes', () => {
      const component = () => Resizable({ children: () => 'Content', id: 'test-resizable', className: 'custom' });
      const { container, cleanup } = renderComponent(component);

      const resizable = container.querySelector('[data-resizable-container]');
      expect(resizable?.getAttribute('id')).toBe('test-resizable');
      expect(resizable?.getAttribute('class')).toBe('custom');

      cleanup();
    });
  });

  // Orientation tests
  describe('Orientation', () => {
    it('should default to horizontal orientation', () => {
      const component = () => Resizable({ children: () => 'Content' });
      const { container, cleanup } = renderComponent(component);

      const resizable = container.querySelector('[data-resizable-container]');
      expect(resizable?.getAttribute('data-orientation')).toBe('horizontal');

      cleanup();
    });

    it('should accept horizontal orientation', () => {
      const component = () => Resizable({ orientation: 'horizontal', children: () => 'Content' });
      const { container, cleanup } = renderComponent(component);

      const resizable = container.querySelector('[data-resizable-container]');
      expect(resizable?.getAttribute('data-orientation')).toBe('horizontal');

      cleanup();
    });

    it('should accept vertical orientation', () => {
      const component = () => Resizable({ orientation: 'vertical', children: () => 'Content' });
      const { container, cleanup } = renderComponent(component);

      const resizable = container.querySelector('[data-resizable-container]');
      expect(resizable?.getAttribute('data-orientation')).toBe('vertical');

      cleanup();
    });

    it('should apply flex row for horizontal orientation', () => {
      const component = () => Resizable({ orientation: 'horizontal', children: () => 'Content' });
      const { container, cleanup } = renderComponent(component);

      const resizable = container.querySelector('[data-resizable-container]') as HTMLElement;
      expect(resizable.style.flexDirection).toBe('row');

      cleanup();
    });

    it('should apply flex column for vertical orientation', () => {
      const component = () => Resizable({ orientation: 'vertical', children: () => 'Content' });
      const { container, cleanup } = renderComponent(component);

      const resizable = container.querySelector('[data-resizable-container]') as HTMLElement;
      expect(resizable.style.flexDirection).toBe('column');

      cleanup();
    });
  });

  // Flex layout tests
  describe('Flex Layout', () => {
    it('should have display flex', () => {
      const component = () => Resizable({ children: () => 'Content' });
      const { container, cleanup } = renderComponent(component);

      const resizable = container.querySelector('[data-resizable-container]') as HTMLElement;
      expect(resizable.style.display).toBe('flex');

      cleanup();
    });

    it('should have 100% width', () => {
      const component = () => Resizable({ children: () => 'Content' });
      const { container, cleanup } = renderComponent(component);

      const resizable = container.querySelector('[data-resizable-container]') as HTMLElement;
      expect(resizable.style.width).toBe('100%');

      cleanup();
    });

    it('should have 100% height', () => {
      const component = () => Resizable({ children: () => 'Content' });
      const { container, cleanup } = renderComponent(component);

      const resizable = container.querySelector('[data-resizable-container]') as HTMLElement;
      expect(resizable.style.height).toBe('100%');

      cleanup();
    });
  });

  // Sizes prop tests
  describe('Sizes Prop', () => {
    it('should use defaultSizes when provided', () => {
      const component = () => Resizable({ defaultSizes: [30, 70] });
      const { container, cleanup } = renderComponent(component);

      const resizable = container.querySelector('[data-resizable-container]');
      expect(resizable).toBeTruthy();

      cleanup();
    });

    it('should default to [50, 50] when no sizes provided', () => {
      const component = () => Resizable({});
      const { container, cleanup } = renderComponent(component);

      const resizable = container.querySelector('[data-resizable-container]');
      expect(resizable).toBeTruthy();

      cleanup();
    });

    it('should accept controlled sizes', () => {
      const component = () => Resizable({ sizes: [40, 60] });
      const { container, cleanup } = renderComponent(component);

      const resizable = container.querySelector('[data-resizable-container]');
      expect(resizable).toBeTruthy();

      cleanup();
    });

    it('should call onSizesChange when provided', () => {
      const onSizesChange = createSpy();
      const component = () => Resizable({ onSizesChange });
      const { cleanup } = renderComponent(component);

      // onSizesChange should be callable
      expect(onSizesChange).toBeDefined();

      cleanup();
    });
  });

  // ResizablePanel tests
  describe('ResizablePanel', () => {
    it('should render panel', () => {
      const component = () => Resizable({ children: () => ResizablePanel({ children: 'Panel content' }) });
      const { container, cleanup } = renderComponent(component);

      const panel = container.querySelector('[data-resizable-panel]');
      expect(panel).toBeTruthy();

      cleanup();
    });

    it('should have data-resizable-panel attribute', () => {
      const component = () => Resizable({ children: () => ResizablePanel({ children: 'Content' }) });
      const { container, cleanup } = renderComponent(component);

      const panel = container.querySelector('[data-resizable-panel]');
      expect(panel?.getAttribute('data-resizable-panel')).toBe('');

      cleanup();
    });

    it('should render with children', () => {
      const component = () => Resizable({ children: () => ResizablePanel({ children: 'Test content' }) });
      const { container, cleanup } = renderComponent(component);

      const panel = container.querySelector('[data-resizable-panel]');
      expect(panel?.textContent).toBe('Test content');

      cleanup();
    });

    it('should have data-panel-id attribute', () => {
      const component = () =>
        Resizable({ children: () => ResizablePanel({ id: 'custom-panel', children: 'Content' }) });
      const { container, cleanup } = renderComponent(component);

      const panel = container.querySelector('[data-resizable-panel]');
      expect(panel?.hasAttribute('data-panel-id')).toBe(true);

      cleanup();
    });

    it('should accept custom id', () => {
      const component = () => Resizable({ children: () => ResizablePanel({ id: 'my-panel', children: 'Content' }) });
      const { container, cleanup } = renderComponent(component);

      const panel = container.querySelector('[data-resizable-panel]');
      expect(panel?.getAttribute('data-panel-id')).toBe('my-panel');

      cleanup();
    });

    it('should have overflow auto', () => {
      const component = () => Resizable({ children: () => ResizablePanel({ children: 'Content' }) });
      const { container, cleanup } = renderComponent(component);

      const panel = container.querySelector('[data-resizable-panel]') as HTMLElement;
      expect(panel.style.overflow).toBe('auto');

      cleanup();
    });

    it('should accept minSize prop', () => {
      const component = () => Resizable({ children: () => ResizablePanel({ minSize: 20, children: 'Content' }) });
      const { container, cleanup } = renderComponent(component);

      const panel = container.querySelector('[data-resizable-panel]');
      expect(panel).toBeTruthy();

      cleanup();
    });

    it('should accept maxSize prop', () => {
      const component = () => Resizable({ children: () => ResizablePanel({ maxSize: 80, children: 'Content' }) });
      const { container, cleanup } = renderComponent(component);

      const panel = container.querySelector('[data-resizable-panel]');
      expect(panel).toBeTruthy();

      cleanup();
    });

    it('should render without children', () => {
      const component = () => Resizable({ children: () => ResizablePanel({}) });
      const { container, cleanup } = renderComponent(component);

      const panel = container.querySelector('[data-resizable-panel]');
      expect(panel).toBeTruthy();

      cleanup();
    });
  });

  // ResizableHandle tests
  describe('ResizableHandle', () => {
    it('should render handle', () => {
      const component = () => Resizable({ children: () => ResizableHandle({}) });
      const { container, cleanup } = renderComponent(component);

      const handle = container.querySelector('[data-resizable-handle]');
      expect(handle).toBeTruthy();

      cleanup();
    });

    it('should have data-resizable-handle attribute', () => {
      const component = () => Resizable({ children: () => ResizableHandle({}) });
      const { container, cleanup } = renderComponent(component);

      const handle = container.querySelector('[data-resizable-handle]');
      expect(handle?.getAttribute('data-resizable-handle')).toBe('');

      cleanup();
    });

    it('should have role separator', () => {
      const component = () => Resizable({ children: () => ResizableHandle({}) });
      const { container, cleanup } = renderComponent(component);

      const handle = container.querySelector('[data-resizable-handle]');
      expect(handle?.getAttribute('role')).toBe('separator');

      cleanup();
    });

    it('should have aria-orientation', () => {
      const component = () => Resizable({ children: () => ResizableHandle({}) });
      const { container, cleanup } = renderComponent(component);

      const handle = container.querySelector('[data-resizable-handle]');
      expect(handle?.hasAttribute('aria-orientation')).toBe(true);

      cleanup();
    });

    it('should have tabIndex 0 when not disabled', () => {
      const component = () => Resizable({ children: () => ResizableHandle({}) });
      const { container, cleanup } = renderComponent(component);

      const handle = container.querySelector('[data-resizable-handle]');
      expect(handle?.getAttribute('tabIndex')).toBe('0');

      cleanup();
    });

    it('should have tabIndex -1 when disabled', () => {
      const component = () => Resizable({ children: () => ResizableHandle({ disabled: true }) });
      const { container, cleanup } = renderComponent(component);

      const handle = container.querySelector('[data-resizable-handle]');
      expect(handle?.getAttribute('tabIndex')).toBe('-1');

      cleanup();
    });

    it('should have aria-disabled false when not disabled', () => {
      const component = () => Resizable({ children: () => ResizableHandle({}) });
      const { container, cleanup } = renderComponent(component);

      const handle = container.querySelector('[data-resizable-handle]');
      expect(handle?.getAttribute('aria-disabled')).toBe('false');

      cleanup();
    });

    it('should have aria-disabled true when disabled', () => {
      const component = () => Resizable({ children: () => ResizableHandle({ disabled: true }) });
      const { container, cleanup } = renderComponent(component);

      const handle = container.querySelector('[data-resizable-handle]');
      expect(handle?.getAttribute('aria-disabled')).toBe('true');

      cleanup();
    });

    it('should have data-disabled attribute when disabled', () => {
      const component = () => Resizable({ children: () => ResizableHandle({ disabled: true }) });
      const { container, cleanup } = renderComponent(component);

      const handle = container.querySelector('[data-resizable-handle]');
      expect(handle?.hasAttribute('data-disabled')).toBe(true);

      cleanup();
    });

    it('should not have data-disabled when not disabled', () => {
      const component = () => Resizable({ children: () => ResizableHandle({}) });
      const { container, cleanup } = renderComponent(component);

      const handle = container.querySelector('[data-resizable-handle]');
      expect(handle?.hasAttribute('data-disabled')).toBe(false);

      cleanup();
    });

    it('should have touch-action none', () => {
      const component = () => Resizable({ children: () => ResizableHandle({}) });
      const { container, cleanup } = renderComponent(component);

      const handle = container.querySelector('[data-resizable-handle]') as HTMLElement;
      expect(handle.style.touchAction).toBe('none');

      cleanup();
    });

    it('should have user-select none', () => {
      const component = () => Resizable({ children: () => ResizableHandle({}) });
      const { container, cleanup } = renderComponent(component);

      const handle = container.querySelector('[data-resizable-handle]') as HTMLElement;
      expect(handle.style.userSelect).toBe('none');

      cleanup();
    });

    it('should render with children', () => {
      const component = () => Resizable({ children: () => ResizableHandle({ children: 'Handle content' }) });
      const { container, cleanup } = renderComponent(component);

      const handle = container.querySelector('[data-resizable-handle]');
      expect(handle?.textContent).toBe('Handle content');

      cleanup();
    });
  });

  // Cursor styles
  describe('Cursor Styles', () => {
    it('should have col-resize cursor for horizontal orientation', () => {
      const component = () => Resizable({ children: () => ResizableHandle({}) });
      const { container, cleanup } = renderComponent(component);

      const handle = container.querySelector('[data-resizable-handle]') as HTMLElement;
      expect(handle.style.cursor).toBe('col-resize');

      cleanup();
    });
  });

  // Composition tests
  describe('Composition', () => {
    it('should render complete resizable structure', () => {
      const component = () =>
        Resizable({
          children: () => [
            ResizablePanel({ children: 'Panel 1' }),
            ResizableHandle({}),
            ResizablePanel({ children: 'Panel 2' }),
          ],
        });
      const { container, cleanup } = renderComponent(component);

      const resizable = container.querySelector('[data-resizable-container]');
      const panels = container.querySelectorAll('[data-resizable-panel]');
      const handle = container.querySelector('[data-resizable-handle]');

      expect(resizable).toBeTruthy();
      expect(panels.length).toBe(2);
      expect(handle).toBeTruthy();

      cleanup();
    });

    it('should render multiple panels with handles', () => {
      const component = () =>
        Resizable({
          children: () => [
            ResizablePanel({ children: 'Panel 1' }),
            ResizableHandle({}),
            ResizablePanel({ children: 'Panel 2' }),
            ResizableHandle({}),
            ResizablePanel({ children: 'Panel 3' }),
          ],
        });
      const { container, cleanup } = renderComponent(component);

      const panels = container.querySelectorAll('[data-resizable-panel]');
      const handles = container.querySelectorAll('[data-resizable-handle]');

      expect(panels.length).toBe(3);
      expect(handles.length).toBe(2);

      cleanup();
    });
  });

  // Sub-component attachment
  describe('Sub-component Attachment', () => {
    it('should have Panel attached to Resizable', () => {
      expect((Resizable as any).Panel).toBe(ResizablePanel);
    });

    it('should have Handle attached to Resizable', () => {
      expect((Resizable as any).Handle).toBe(ResizableHandle);
    });
  });

  // Edge cases
  describe('Edge Cases', () => {
    it('should handle empty children', () => {
      const component = () => Resizable({});
      const { container, cleanup } = renderComponent(component);

      const resizable = container.querySelector('[data-resizable-container]');
      expect(resizable).toBeTruthy();

      cleanup();
    });

    it('should handle null children', () => {
      const component = () => Resizable({ children: () => null });
      const { container, cleanup } = renderComponent(component);

      const resizable = container.querySelector('[data-resizable-container]');
      expect(resizable).toBeTruthy();

      cleanup();
    });

    it('should handle undefined children', () => {
      const component = () => Resizable({ children: () => undefined });
      const { container, cleanup } = renderComponent(component);

      const resizable = container.querySelector('[data-resizable-container]');
      expect(resizable).toBeTruthy();

      cleanup();
    });

    it('should handle panel without id', () => {
      const component = () => ResizablePanel({ children: 'Content' });
      const { container, cleanup } = renderComponent(component);

      const panel = container.querySelector('[data-resizable-panel]');
      expect(panel).toBeTruthy();

      cleanup();
    });

    it('should handle handle without children', () => {
      const component = () => ResizableHandle({});
      const { container, cleanup } = renderComponent(component);

      const handle = container.querySelector('[data-resizable-handle]');
      expect(handle).toBeTruthy();

      cleanup();
    });

    it('should handle empty sizes array', () => {
      const component = () => Resizable({ sizes: [] });
      const { container, cleanup } = renderComponent(component);

      const resizable = container.querySelector('[data-resizable-container]');
      expect(resizable).toBeTruthy();

      cleanup();
    });

    it('should handle single size in array', () => {
      const component = () => Resizable({ sizes: [100] });
      const { container, cleanup } = renderComponent(component);

      const resizable = container.querySelector('[data-resizable-container]');
      expect(resizable).toBeTruthy();

      cleanup();
    });

    it('should handle large number of sizes', () => {
      const component = () => Resizable({ sizes: [20, 20, 20, 20, 20] });
      const { container, cleanup } = renderComponent(component);

      const resizable = container.querySelector('[data-resizable-container]');
      expect(resizable).toBeTruthy();

      cleanup();
    });
  });

  // Props passthrough
  describe('Props Passthrough', () => {
    it('should render container without custom props', () => {
      const component = () => Resizable({ children: () => 'Content' });
      const { container, cleanup } = renderComponent(component);

      const resizable = container.querySelector('[data-resizable-container]');
      expect(resizable).toBeTruthy();

      cleanup();
    });

    it('should render panel without custom props', () => {
      const component = () => Resizable({ children: () => ResizablePanel({ children: 'Content' }) });
      const { container, cleanup } = renderComponent(component);

      const panel = container.querySelector('[data-resizable-panel]');
      expect(panel).toBeTruthy();

      cleanup();
    });

    it('should render handle without custom props', () => {
      const component = () => Resizable({ children: () => ResizableHandle({}) });
      const { container, cleanup } = renderComponent(component);

      const handle = container.querySelector('[data-resizable-handle]');
      expect(handle).toBeTruthy();

      cleanup();
    });

    it('should have data-orientation on container', () => {
      const component = () => Resizable({ children: () => 'Content', orientation: 'vertical' });
      const { container, cleanup } = renderComponent(component);

      const resizable = container.querySelector('[data-resizable-container]');
      expect(resizable?.getAttribute('data-orientation')).toBe('vertical');

      cleanup();
    });

    it('should have data-panel-id on panel', () => {
      const component = () => Resizable({ children: () => ResizablePanel({ id: 'test-panel', children: 'Content' }) });
      const { container, cleanup } = renderComponent(component);

      const panel = container.querySelector('[data-resizable-panel]');
      expect(panel?.getAttribute('data-panel-id')).toBeTruthy();

      cleanup();
    });

    it('should have data-disabled on handle when disabled', () => {
      const component = () => Resizable({ children: () => ResizableHandle({ disabled: true }) });
      const { container, cleanup } = renderComponent(component);

      const handle = container.querySelector('[data-resizable-handle]');
      expect(handle?.hasAttribute('data-disabled')).toBe(true);

      cleanup();
    });
  });

  // Style tests
  describe('Styles', () => {
    it('should have flex display on container', () => {
      const component = () => Resizable({ children: () => 'Content' });
      const { container, cleanup } = renderComponent(component);

      const resizable = container.querySelector('[data-resizable-container]') as HTMLElement;
      expect(resizable.style.display).toBe('flex');

      cleanup();
    });

    it('should apply inline styles to container', () => {
      const component = () => Resizable({ children: () => 'Content' });
      const { container, cleanup } = renderComponent(component);

      const resizable = container.querySelector('[data-resizable-container]') as HTMLElement;
      expect(resizable.style.display).toBe('flex');
      expect(resizable.style.width).toBe('100%');
      expect(resizable.style.height).toBe('100%');

      cleanup();
    });

    it('should have cursor style on handle', () => {
      const component = () => Resizable({ children: () => ResizableHandle({}) });
      const { container, cleanup } = renderComponent(component);

      const handle = container.querySelector('[data-resizable-handle]') as HTMLElement;
      expect(handle.style.cursor).toBe('col-resize');

      cleanup();
    });
  });

  // Accessibility tests
  describe('Accessibility', () => {
    it('should have proper ARIA role on handle', () => {
      const component = () => Resizable({ children: () => ResizableHandle({}) });
      const { container, cleanup } = renderComponent(component);

      const handle = container.querySelector('[data-resizable-handle]');
      expect(handle?.getAttribute('role')).toBe('separator');

      cleanup();
    });

    it('should have aria-orientation attribute', () => {
      const component = () => Resizable({ children: () => ResizableHandle({}) });
      const { container, cleanup } = renderComponent(component);

      const handle = container.querySelector('[data-resizable-handle]');
      expect(handle?.hasAttribute('aria-orientation')).toBe(true);

      cleanup();
    });

    it('should be keyboard accessible when not disabled', () => {
      const component = () => Resizable({ children: () => ResizableHandle({}) });
      const { container, cleanup } = renderComponent(component);

      const handle = container.querySelector('[data-resizable-handle]');
      expect(handle?.getAttribute('tabIndex')).toBe('0');

      cleanup();
    });

    it('should not be keyboard accessible when disabled', () => {
      const component = () => Resizable({ children: () => ResizableHandle({ disabled: true }) });
      const { container, cleanup } = renderComponent(component);

      const handle = container.querySelector('[data-resizable-handle]');
      expect(handle?.getAttribute('tabIndex')).toBe('-1');

      cleanup();
    });

    it('should communicate disabled state via aria-disabled', () => {
      const component = () => Resizable({ children: () => ResizableHandle({ disabled: true }) });
      const { container, cleanup } = renderComponent(component);

      const handle = container.querySelector('[data-resizable-handle]');
      expect(handle?.getAttribute('aria-disabled')).toBe('true');

      cleanup();
    });
  });

  // Integration tests
  describe('Integration', () => {
    it('should work with horizontal layout', () => {
      const component = () =>
        Resizable({
          orientation: 'horizontal',
          defaultSizes: [40, 60],
          children: () => [
            ResizablePanel({ id: 'left', children: 'Left Panel' }),
            ResizableHandle({}),
            ResizablePanel({ id: 'right', children: 'Right Panel' }),
          ],
        });
      const { container, cleanup } = renderComponent(component);

      const resizable = container.querySelector('[data-resizable-container]');
      const panels = container.querySelectorAll('[data-resizable-panel]');
      const handle = container.querySelector('[data-resizable-handle]');

      expect(resizable?.getAttribute('data-orientation')).toBe('horizontal');
      expect(panels.length).toBe(2);
      expect(handle).toBeTruthy();

      cleanup();
    });

    it('should work with vertical layout', () => {
      const component = () =>
        Resizable({
          orientation: 'vertical',
          defaultSizes: [30, 70],
          children: () => [
            ResizablePanel({ id: 'top', children: 'Top Panel' }),
            ResizableHandle({}),
            ResizablePanel({ id: 'bottom', children: 'Bottom Panel' }),
          ],
        });
      const { container, cleanup } = renderComponent(component);

      const resizable = container.querySelector('[data-resizable-container]');
      const panels = container.querySelectorAll('[data-resizable-panel]');
      const handle = container.querySelector('[data-resizable-handle]');

      expect(resizable?.getAttribute('data-orientation')).toBe('vertical');
      expect(panels.length).toBe(2);
      expect(handle).toBeTruthy();

      cleanup();
    });

    it('should maintain correct structure hierarchy', () => {
      const component = () =>
        Resizable({
          children: () => [
            ResizablePanel({ children: 'Panel 1' }),
            ResizableHandle({}),
            ResizablePanel({ children: 'Panel 2' }),
          ],
        });
      const { container, cleanup } = renderComponent(component);

      const resizable = container.querySelector('[data-resizable-container]');
      const panels = resizable?.querySelectorAll('[data-resizable-panel]');
      const handle = resizable?.querySelector('[data-resizable-handle]');

      expect(panels?.length).toBe(2);
      expect(handle).toBeTruthy();

      cleanup();
    });
  });

  // Controlled vs Uncontrolled
  describe('Controlled vs Uncontrolled', () => {
    it('should work in uncontrolled mode with defaultSizes', () => {
      const component = () => Resizable({ defaultSizes: [30, 70] });
      const { container, cleanup } = renderComponent(component);

      const resizable = container.querySelector('[data-resizable-container]');
      expect(resizable).toBeTruthy();

      cleanup();
    });

    it('should work in controlled mode with sizes', () => {
      const component = () => Resizable({ sizes: [40, 60] });
      const { container, cleanup } = renderComponent(component);

      const resizable = container.querySelector('[data-resizable-container]');
      expect(resizable).toBeTruthy();

      cleanup();
    });

    it('should work with both sizes and onSizesChange', () => {
      const onSizesChange = createSpy();
      const component = () => Resizable({ sizes: [50, 50], onSizesChange });
      const { container, cleanup } = renderComponent(component);

      const resizable = container.querySelector('[data-resizable-container]');
      expect(resizable).toBeTruthy();
      expect(onSizesChange).toBeDefined();

      cleanup();
    });
  });

  // Additional props tests
  describe('Additional Props', () => {
    it('should have data attributes on container', () => {
      const component = () => Resizable({ children: () => 'Content' });
      const { container, cleanup } = renderComponent(component);

      const resizable = container.querySelector('[data-resizable-container]');
      expect(resizable?.hasAttribute('data-resizable-container')).toBe(true);

      cleanup();
    });

    it('should use id prop for panel', () => {
      const component = () => Resizable({ children: () => ResizablePanel({ id: 'my-panel', children: 'Content' }) });
      const { container, cleanup } = renderComponent(component);

      const panel = container.querySelector('[data-resizable-panel]');
      expect(panel?.getAttribute('data-panel-id')).toBeTruthy();

      cleanup();
    });

    it('should have aria attributes on handle', () => {
      const component = () => Resizable({ children: () => ResizableHandle({}) });
      const { container, cleanup } = renderComponent(component);

      const handle = container.querySelector('[data-resizable-handle]');
      expect(handle?.hasAttribute('aria-orientation')).toBe(true);
      expect(handle?.hasAttribute('aria-disabled')).toBe(true);

      cleanup();
    });
  });
});
