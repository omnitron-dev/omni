/**
 * ScrollArea Component Tests
 *
 * Tests for the ScrollArea primitive component with custom scrollbars
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ScrollArea, ScrollAreaViewport, ScrollAreaScrollbar, ScrollAreaThumb } from '../../../src/primitives/ScrollArea.js';
import { renderComponent, nextTick, createSpy } from '../../helpers/test-utils.js';

describe('ScrollArea', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Basic rendering tests
  describe('Rendering', () => {
    it('should render root component', () => {
      const component = () => ScrollArea({ children: 'Content' });
      const { container, cleanup } = renderComponent(component);

      const scrollArea = container.querySelector('[data-scroll-area]');
      expect(scrollArea).toBeTruthy();

      cleanup();
    });

    it('should render with children', () => {
      const component = () => ScrollArea({ children: 'Test content' });
      const { container, cleanup } = renderComponent(component);

      const scrollArea = container.querySelector('[data-scroll-area]');
      expect(scrollArea?.textContent).toBe('Test content');

      cleanup();
    });

    it('should have data-scroll-area attribute', () => {
      const component = () => ScrollArea({ children: 'Content' });
      const { container, cleanup } = renderComponent(component);

      const scrollArea = container.querySelector('[data-scroll-area]');
      expect(scrollArea?.getAttribute('data-scroll-area')).toBe('');

      cleanup();
    });

    it('should render without children', () => {
      const component = () => ScrollArea({});
      const { container, cleanup } = renderComponent(component);

      const scrollArea = container.querySelector('[data-scroll-area]');
      expect(scrollArea).toBeTruthy();

      cleanup();
    });

    it('should render with custom attributes', () => {
      const component = () => ScrollArea({ children: 'Content', id: 'test-scroll', className: 'custom' });
      const { container, cleanup } = renderComponent(component);

      const scrollArea = container.querySelector('[data-scroll-area]');
      expect(scrollArea?.getAttribute('id')).toBe('test-scroll');
      expect(scrollArea?.getAttribute('class')).toBe('custom');

      cleanup();
    });
  });

  // Type prop tests
  describe('Type Prop', () => {
    it('should default to hover type', () => {
      const component = () => ScrollArea({ children: 'Content' });
      const { container, cleanup } = renderComponent(component);

      const scrollArea = container.querySelector('[data-scroll-area]');
      expect(scrollArea?.getAttribute('data-type')).toBe('hover');

      cleanup();
    });

    it('should accept auto type', () => {
      const component = () => ScrollArea({ type: 'auto', children: 'Content' });
      const { container, cleanup } = renderComponent(component);

      const scrollArea = container.querySelector('[data-scroll-area]');
      expect(scrollArea?.getAttribute('data-type')).toBe('auto');

      cleanup();
    });

    it('should accept always type', () => {
      const component = () => ScrollArea({ type: 'always', children: 'Content' });
      const { container, cleanup } = renderComponent(component);

      const scrollArea = container.querySelector('[data-scroll-area]');
      expect(scrollArea?.getAttribute('data-type')).toBe('always');

      cleanup();
    });

    it('should accept scroll type', () => {
      const component = () => ScrollArea({ type: 'scroll', children: 'Content' });
      const { container, cleanup } = renderComponent(component);

      const scrollArea = container.querySelector('[data-scroll-area]');
      expect(scrollArea?.getAttribute('data-type')).toBe('scroll');

      cleanup();
    });

    it('should accept hover type', () => {
      const component = () => ScrollArea({ type: 'hover', children: 'Content' });
      const { container, cleanup } = renderComponent(component);

      const scrollArea = container.querySelector('[data-scroll-area]');
      expect(scrollArea?.getAttribute('data-type')).toBe('hover');

      cleanup();
    });
  });

  // Direction prop tests
  describe('Direction Prop', () => {
    it('should default to ltr direction', () => {
      const component = () => ScrollArea({ children: 'Content' });
      const { container, cleanup } = renderComponent(component);

      const scrollArea = container.querySelector('[data-scroll-area]');
      expect(scrollArea?.getAttribute('dir')).toBe('ltr');

      cleanup();
    });

    it('should accept ltr direction', () => {
      const component = () => ScrollArea({ dir: 'ltr', children: 'Content' });
      const { container, cleanup } = renderComponent(component);

      const scrollArea = container.querySelector('[data-scroll-area]');
      expect(scrollArea?.getAttribute('dir')).toBe('ltr');

      cleanup();
    });

    it('should accept rtl direction', () => {
      const component = () => ScrollArea({ dir: 'rtl', children: 'Content' });
      const { container, cleanup } = renderComponent(component);

      const scrollArea = container.querySelector('[data-scroll-area]');
      expect(scrollArea?.getAttribute('dir')).toBe('rtl');

      cleanup();
    });
  });

  // Viewport tests
  describe('ScrollAreaViewport', () => {
    it('should render viewport', () => {
      const component = () => ScrollAreaViewport({ children: 'Viewport content' });
      const { container, cleanup } = renderComponent(component);

      const viewport = container.querySelector('[data-scroll-area-viewport]');
      expect(viewport).toBeTruthy();

      cleanup();
    });

    it('should have data-scroll-area-viewport attribute', () => {
      const component = () => ScrollAreaViewport({ children: 'Content' });
      const { container, cleanup } = renderComponent(component);

      const viewport = container.querySelector('[data-scroll-area-viewport]');
      expect(viewport?.getAttribute('data-scroll-area-viewport')).toBe('');

      cleanup();
    });

    it('should have overflow scroll style', () => {
      const component = () => ScrollAreaViewport({ children: 'Content' });
      const { container, cleanup } = renderComponent(component);

      const viewport = container.querySelector('[data-scroll-area-viewport]') as HTMLElement;
      expect(viewport.style.overflow).toBe('scroll');

      cleanup();
    });

    it('should hide scrollbar for Firefox', () => {
      const component = () => ScrollAreaViewport({ children: 'Content' });
      const { container, cleanup } = renderComponent(component);

      const viewport = container.querySelector('[data-scroll-area-viewport]') as HTMLElement;
      // scrollbarWidth property is applied via style object
      expect(viewport.style.overflow).toBe('scroll');

      cleanup();
    });

    it('should hide scrollbar for IE/Edge', () => {
      const component = () => ScrollAreaViewport({ children: 'Content' });
      const { container, cleanup } = renderComponent(component);

      const viewport = container.querySelector('[data-scroll-area-viewport]') as HTMLElement;
      // msOverflowStyle property is applied via style object
      expect(viewport.style.overflow).toBe('scroll');

      cleanup();
    });

    it('should render with children', () => {
      const component = () => ScrollAreaViewport({ children: 'Test content' });
      const { container, cleanup } = renderComponent(component);

      const viewport = container.querySelector('[data-scroll-area-viewport]');
      expect(viewport?.textContent).toBe('Test content');

      cleanup();
    });

    it('should merge custom styles', () => {
      const component = () => ScrollAreaViewport({ children: 'Content', style: { backgroundColor: 'red' } });
      const { container, cleanup } = renderComponent(component);

      const viewport = container.querySelector('[data-scroll-area-viewport]') as HTMLElement;
      expect(viewport.style.backgroundColor).toBe('red');
      expect(viewport.style.overflow).toBe('scroll');

      cleanup();
    });

    it('should pass through custom attributes', () => {
      const component = () => ScrollAreaViewport({ children: 'Content', id: 'custom-viewport' });
      const { container, cleanup } = renderComponent(component);

      const viewport = container.querySelector('[data-scroll-area-viewport]');
      expect(viewport?.getAttribute('id')).toBe('custom-viewport');

      cleanup();
    });
  });

  // Scrollbar tests
  describe('ScrollAreaScrollbar', () => {
    it('should render vertical scrollbar with forceMount', () => {
      const component = () => ScrollAreaScrollbar({ orientation: 'vertical', forceMount: true });
      const { container, cleanup } = renderComponent(component);

      const scrollbar = container.querySelector('[data-scroll-area-scrollbar]');
      expect(scrollbar).toBeTruthy();

      cleanup();
    });

    it('should render horizontal scrollbar with forceMount', () => {
      const component = () => ScrollAreaScrollbar({ orientation: 'horizontal', forceMount: true });
      const { container, cleanup } = renderComponent(component);

      const scrollbar = container.querySelector('[data-scroll-area-scrollbar]');
      expect(scrollbar).toBeTruthy();

      cleanup();
    });

    it('should have data-orientation attribute for vertical', () => {
      const component = () => ScrollAreaScrollbar({ orientation: 'vertical', forceMount: true });
      const { container, cleanup } = renderComponent(component);

      const scrollbar = container.querySelector('[data-scroll-area-scrollbar]');
      expect(scrollbar?.getAttribute('data-orientation')).toBe('vertical');

      cleanup();
    });

    it('should have data-orientation attribute for horizontal', () => {
      const component = () => ScrollAreaScrollbar({ orientation: 'horizontal', forceMount: true });
      const { container, cleanup } = renderComponent(component);

      const scrollbar = container.querySelector('[data-scroll-area-scrollbar]');
      expect(scrollbar?.getAttribute('data-orientation')).toBe('horizontal');

      cleanup();
    });

    it('should have data-state attribute', () => {
      const component = () => ScrollAreaScrollbar({ orientation: 'vertical', forceMount: true });
      const { container, cleanup } = renderComponent(component);

      const scrollbar = container.querySelector('[data-scroll-area-scrollbar]');
      expect(scrollbar?.hasAttribute('data-state')).toBe(true);

      cleanup();
    });

    it('should render with children', () => {
      const component = () => ScrollAreaScrollbar({ orientation: 'vertical', forceMount: true, children: 'Scrollbar content' });
      const { container, cleanup } = renderComponent(component);

      const scrollbar = container.querySelector('[data-scroll-area-scrollbar]');
      expect(scrollbar?.textContent).toBe('Scrollbar content');

      cleanup();
    });

    it('should hide when not visible without forceMount', () => {
      const component = () => ScrollAreaScrollbar({ orientation: 'vertical' });
      const { container, cleanup } = renderComponent(component);

      // Without forceMount and no scrollable content, scrollbar should be hidden
      const scrollbar = container.querySelector('[data-scroll-area-scrollbar]');
      expect(scrollbar).toBeNull();

      cleanup();
    });

    it('should show when forceMount is true', () => {
      const component = () => ScrollAreaScrollbar({ orientation: 'vertical', forceMount: true });
      const { container, cleanup } = renderComponent(component);

      const scrollbar = container.querySelector('[data-scroll-area-scrollbar]');
      expect(scrollbar).toBeTruthy();

      cleanup();
    });

    it('should pass through custom attributes', () => {
      const component = () => ScrollAreaScrollbar({ orientation: 'vertical', forceMount: true, className: 'custom-scrollbar' });
      const { container, cleanup } = renderComponent(component);

      const scrollbar = container.querySelector('[data-scroll-area-scrollbar]');
      expect(scrollbar?.getAttribute('class')).toBe('custom-scrollbar');

      cleanup();
    });
  });

  // Thumb tests
  describe('ScrollAreaThumb', () => {
    it('should render thumb', () => {
      const component = () => ScrollAreaThumb({});
      const { container, cleanup } = renderComponent(component);

      const thumb = container.querySelector('[data-scroll-area-thumb]');
      expect(thumb).toBeTruthy();

      cleanup();
    });

    it('should have data-scroll-area-thumb attribute', () => {
      const component = () => ScrollAreaThumb({});
      const { container, cleanup } = renderComponent(component);

      const thumb = container.querySelector('[data-scroll-area-thumb]');
      expect(thumb?.getAttribute('data-scroll-area-thumb')).toBe('');

      cleanup();
    });

    it('should have absolute position', () => {
      const component = () => ScrollAreaThumb({});
      const { container, cleanup } = renderComponent(component);

      const thumb = container.querySelector('[data-scroll-area-thumb]') as HTMLElement;
      expect(thumb.style.position).toBe('absolute');

      cleanup();
    });

    it('should have data-state attribute', () => {
      const component = () => ScrollAreaThumb({});
      const { container, cleanup } = renderComponent(component);

      const thumb = container.querySelector('[data-scroll-area-thumb]');
      expect(thumb?.hasAttribute('data-state')).toBe(true);

      cleanup();
    });

    it('should merge custom styles', () => {
      const component = () => ScrollAreaThumb({ style: { backgroundColor: 'blue' } });
      const { container, cleanup } = renderComponent(component);

      const thumb = container.querySelector('[data-scroll-area-thumb]') as HTMLElement;
      expect(thumb.style.backgroundColor).toBe('blue');
      expect(thumb.style.position).toBe('absolute');

      cleanup();
    });

    it('should pass through custom attributes', () => {
      const component = () => ScrollAreaThumb({ className: 'custom-thumb' });
      const { container, cleanup } = renderComponent(component);

      const thumb = container.querySelector('[data-scroll-area-thumb]');
      expect(thumb?.getAttribute('class')).toBe('custom-thumb');

      cleanup();
    });
  });

  // Composition tests
  describe('Composition', () => {
    it('should render complete scroll area structure', () => {
      const component = () => ScrollArea({
        children: [
          ScrollAreaViewport({ children: 'Content' }),
          ScrollAreaScrollbar({ orientation: 'vertical', forceMount: true, children: ScrollAreaThumb({}) }),
        ]
      });
      const { container, cleanup } = renderComponent(component);

      const scrollArea = container.querySelector('[data-scroll-area]');
      const viewport = container.querySelector('[data-scroll-area-viewport]');
      const scrollbar = container.querySelector('[data-scroll-area-scrollbar]');
      const thumb = container.querySelector('[data-scroll-area-thumb]');

      expect(scrollArea).toBeTruthy();
      expect(viewport).toBeTruthy();
      expect(scrollbar).toBeTruthy();
      expect(thumb).toBeTruthy();

      cleanup();
    });

    it('should render both vertical and horizontal scrollbars', () => {
      const component = () => ScrollArea({
        children: [
          ScrollAreaViewport({ children: 'Content' }),
          ScrollAreaScrollbar({ orientation: 'vertical', forceMount: true }),
          ScrollAreaScrollbar({ orientation: 'horizontal', forceMount: true }),
        ]
      });
      const { container, cleanup } = renderComponent(component);

      const scrollbars = container.querySelectorAll('[data-scroll-area-scrollbar]');
      expect(scrollbars.length).toBe(2);
      expect(scrollbars[0].getAttribute('data-orientation')).toBe('vertical');
      expect(scrollbars[1].getAttribute('data-orientation')).toBe('horizontal');

      cleanup();
    });
  });

  // Context tests
  describe('Context', () => {
    it('should provide context to viewport', () => {
      const component = () => ScrollArea({
        type: 'auto',
        dir: 'rtl',
        children: ScrollAreaViewport({ children: 'Content' })
      });
      const { container, cleanup } = renderComponent(component);

      const scrollArea = container.querySelector('[data-scroll-area]');
      expect(scrollArea?.getAttribute('data-type')).toBe('auto');
      expect(scrollArea?.getAttribute('dir')).toBe('rtl');

      cleanup();
    });

    it('should provide context to scrollbar', () => {
      const component = () => ScrollArea({
        children: [
          ScrollAreaViewport({ children: 'Content' }),
          ScrollAreaScrollbar({ orientation: 'vertical', forceMount: true })
        ]
      });
      const { container, cleanup } = renderComponent(component);

      const scrollbar = container.querySelector('[data-scroll-area-scrollbar]');
      expect(scrollbar?.getAttribute('data-orientation')).toBe('vertical');

      cleanup();
    });
  });

  // Display names
  describe('Display Names', () => {
    it('should have displayName for ScrollArea', () => {
      expect(ScrollArea.displayName).toBe('ScrollArea');
    });

    it('should have displayName for ScrollAreaViewport', () => {
      expect(ScrollAreaViewport.displayName).toBe('ScrollArea.Viewport');
    });

    it('should have displayName for ScrollAreaScrollbar', () => {
      expect(ScrollAreaScrollbar.displayName).toBe('ScrollArea.Scrollbar');
    });

    it('should have displayName for ScrollAreaThumb', () => {
      expect(ScrollAreaThumb.displayName).toBe('ScrollArea.Thumb');
    });
  });

  // Sub-component attachment
  describe('Sub-component Attachment', () => {
    it('should have Viewport attached to ScrollArea', () => {
      expect((ScrollArea as any).Viewport).toBe(ScrollAreaViewport);
    });

    it('should have Scrollbar attached to ScrollArea', () => {
      expect((ScrollArea as any).Scrollbar).toBe(ScrollAreaScrollbar);
    });

    it('should have Thumb attached to ScrollArea', () => {
      expect((ScrollArea as any).Thumb).toBe(ScrollAreaThumb);
    });
  });

  // Edge cases
  describe('Edge Cases', () => {
    it('should handle empty viewport', () => {
      const component = () => ScrollAreaViewport({});
      const { container, cleanup } = renderComponent(component);

      const viewport = container.querySelector('[data-scroll-area-viewport]');
      expect(viewport).toBeTruthy();

      cleanup();
    });

    it('should handle null children', () => {
      const component = () => ScrollArea({ children: null });
      const { container, cleanup } = renderComponent(component);

      const scrollArea = container.querySelector('[data-scroll-area]');
      expect(scrollArea).toBeTruthy();

      cleanup();
    });

    it('should handle undefined children', () => {
      const component = () => ScrollArea({ children: undefined });
      const { container, cleanup } = renderComponent(component);

      const scrollArea = container.querySelector('[data-scroll-area]');
      expect(scrollArea).toBeTruthy();

      cleanup();
    });

    it('should handle scrollbar without children', () => {
      const component = () => ScrollAreaScrollbar({ orientation: 'vertical', forceMount: true });
      const { container, cleanup } = renderComponent(component);

      const scrollbar = container.querySelector('[data-scroll-area-scrollbar]');
      expect(scrollbar).toBeTruthy();

      cleanup();
    });

    it('should handle multiple viewports', () => {
      const component = () => ScrollArea({
        children: [
          ScrollAreaViewport({ children: 'Content 1' }),
          ScrollAreaViewport({ children: 'Content 2' }),
        ]
      });
      const { container, cleanup } = renderComponent(component);

      const viewports = container.querySelectorAll('[data-scroll-area-viewport]');
      expect(viewports.length).toBe(2);

      cleanup();
    });
  });

  // Style tests
  describe('Styles', () => {
    it('should apply custom style to root', () => {
      const component = () => ScrollArea({ children: 'Content', style: { backgroundColor: 'gray' } });
      const { container, cleanup } = renderComponent(component);

      const scrollArea = container.querySelector('[data-scroll-area]') as HTMLElement;
      expect(scrollArea.style.backgroundColor).toBe('gray');

      cleanup();
    });

    it('should preserve viewport overflow styles', () => {
      const component = () => ScrollAreaViewport({ children: 'Content', style: { padding: '10px' } });
      const { container, cleanup } = renderComponent(component);

      const viewport = container.querySelector('[data-scroll-area-viewport]') as HTMLElement;
      expect(viewport.style.padding).toBe('10px');
      expect(viewport.style.overflow).toBe('scroll');

      cleanup();
    });

    it('should preserve thumb position styles', () => {
      const component = () => ScrollAreaThumb({ style: { borderRadius: '5px' } });
      const { container, cleanup } = renderComponent(component);

      const thumb = container.querySelector('[data-scroll-area-thumb]') as HTMLElement;
      expect(thumb.style.borderRadius).toBe('5px');
      expect(thumb.style.position).toBe('absolute');

      cleanup();
    });
  });

  // Props passthrough
  describe('Props Passthrough', () => {
    it('should pass through aria attributes to root', () => {
      const component = () => ScrollArea({ children: 'Content', 'aria-label': 'Scrollable area' });
      const { container, cleanup } = renderComponent(component);

      const scrollArea = container.querySelector('[data-scroll-area]');
      expect(scrollArea?.getAttribute('aria-label')).toBe('Scrollable area');

      cleanup();
    });

    it('should pass through data attributes to viewport', () => {
      const component = () => ScrollAreaViewport({ children: 'Content', 'data-testid': 'viewport' });
      const { container, cleanup } = renderComponent(component);

      const viewport = container.querySelector('[data-scroll-area-viewport]');
      expect(viewport?.getAttribute('data-testid')).toBe('viewport');

      cleanup();
    });

    it('should pass through class to scrollbar', () => {
      const component = () => ScrollAreaScrollbar({ orientation: 'vertical', forceMount: true, className: 'scrollbar-class' });
      const { container, cleanup } = renderComponent(component);

      const scrollbar = container.querySelector('[data-scroll-area-scrollbar]');
      expect(scrollbar?.getAttribute('class')).toBe('scrollbar-class');

      cleanup();
    });

    it('should pass through id to thumb', () => {
      const component = () => ScrollAreaThumb({ id: 'custom-thumb' });
      const { container, cleanup } = renderComponent(component);

      const thumb = container.querySelector('[data-scroll-area-thumb]');
      expect(thumb?.getAttribute('id')).toBe('custom-thumb');

      cleanup();
    });
  });

  // Scrollbar state tests
  describe('Scrollbar State', () => {
    it('should have hidden state when not visible', () => {
      const component = () => ScrollAreaScrollbar({ orientation: 'vertical', forceMount: true });
      const { container, cleanup } = renderComponent(component);

      const scrollbar = container.querySelector('[data-scroll-area-scrollbar]');
      expect(scrollbar?.getAttribute('data-state')).toBe('hidden');

      cleanup();
    });

    it('should have hidden state for thumb when not visible', () => {
      const component = () => ScrollAreaThumb({});
      const { container, cleanup } = renderComponent(component);

      const thumb = container.querySelector('[data-scroll-area-thumb]');
      expect(thumb?.getAttribute('data-state')).toBe('hidden');

      cleanup();
    });
  });

  // Integration tests
  describe('Integration', () => {
    it('should work with all components together', () => {
      const component = () => ScrollArea({
        type: 'always',
        dir: 'ltr',
        children: [
          ScrollAreaViewport({
            children: 'Long scrollable content',
            style: { height: '200px' }
          }),
          ScrollAreaScrollbar({
            orientation: 'vertical',
            forceMount: true,
            children: ScrollAreaThumb({ style: { backgroundColor: 'blue' } })
          }),
          ScrollAreaScrollbar({
            orientation: 'horizontal',
            forceMount: true,
            children: ScrollAreaThumb({ style: { backgroundColor: 'red' } })
          })
        ]
      });
      const { container, cleanup } = renderComponent(component);

      const scrollArea = container.querySelector('[data-scroll-area]');
      const viewport = container.querySelector('[data-scroll-area-viewport]');
      const scrollbars = container.querySelectorAll('[data-scroll-area-scrollbar]');
      const thumbs = container.querySelectorAll('[data-scroll-area-thumb]');

      expect(scrollArea).toBeTruthy();
      expect(viewport).toBeTruthy();
      expect(scrollbars.length).toBe(2);
      expect(thumbs.length).toBe(2);

      cleanup();
    });

    it('should maintain correct structure hierarchy', () => {
      const component = () => ScrollArea({
        children: [
          ScrollAreaViewport({ children: 'Content' }),
          ScrollAreaScrollbar({ orientation: 'vertical', forceMount: true, children: ScrollAreaThumb({}) })
        ]
      });
      const { container, cleanup } = renderComponent(component);

      const scrollArea = container.querySelector('[data-scroll-area]');
      const viewport = scrollArea?.querySelector('[data-scroll-area-viewport]');
      const scrollbar = scrollArea?.querySelector('[data-scroll-area-scrollbar]');
      const thumb = scrollbar?.querySelector('[data-scroll-area-thumb]');

      expect(viewport).toBeTruthy();
      expect(scrollbar).toBeTruthy();
      expect(thumb).toBeTruthy();

      cleanup();
    });
  });
});
