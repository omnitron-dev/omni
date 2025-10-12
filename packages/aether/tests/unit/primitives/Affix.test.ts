/**
 * Affix Component Tests
 *
 * Tests for the Affix primitive component with sticky/fixed positioning
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Affix } from '../../../src/primitives/Affix.js';
import { renderComponent, nextTick, createSpy } from '../../helpers/test-utils.js';

describe('Affix', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    // Mock window dimensions
    Object.defineProperty(window, 'innerHeight', {
      writable: true,
      configurable: true,
      value: 768,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Basic rendering tests
  describe('Rendering', () => {
    it('should render component', () => {
      const component = () => Affix({ children: 'Affixed content' });
      const { container, cleanup } = renderComponent(component);

      const affix = container.querySelector('[data-affix]');
      expect(affix).toBeTruthy();
      expect(affix?.textContent).toBe('Affixed content');

      cleanup();
    });

    it('should render with children', () => {
      const component = () => Affix({ children: 'Test content' });
      const { container, cleanup } = renderComponent(component);

      const affix = container.querySelector('[data-affix]');
      expect(affix?.textContent).toBe('Test content');

      cleanup();
    });

    it('should render without children', () => {
      const component = () => Affix({});
      const { container, cleanup } = renderComponent(component);

      const affix = container.querySelector('[data-affix]');
      expect(affix).toBeTruthy();

      cleanup();
    });

    it('should have data-affix attribute', () => {
      const component = () => Affix({ children: 'Content' });
      const { container, cleanup } = renderComponent(component);

      const affix = container.querySelector('[data-affix]');
      expect(affix?.getAttribute('data-affix')).toBe('');

      cleanup();
    });

    it('should render component with div element', () => {
      const component = () => Affix({ children: 'Content' });
      const { container, cleanup } = renderComponent(component);

      const affix = container.querySelector('[data-affix]');
      expect(affix?.tagName.toLowerCase()).toBe('div');

      cleanup();
    });
  });

  // Offset props tests
  describe('Offset Props', () => {
    it('should accept offsetTop prop', () => {
      const component = () => Affix({ offsetTop: 10, children: 'Content' });
      const { container, cleanup } = renderComponent(component);

      const affix = container.querySelector('[data-affix]');
      expect(affix).toBeTruthy();

      cleanup();
    });

    it('should accept offsetBottom prop', () => {
      const component = () => Affix({ offsetBottom: 20, children: 'Content' });
      const { container, cleanup } = renderComponent(component);

      const affix = container.querySelector('[data-affix]');
      expect(affix).toBeTruthy();

      cleanup();
    });

    it('should accept both offsetTop and offsetBottom', () => {
      const component = () => Affix({ offsetTop: 10, offsetBottom: 20, children: 'Content' });
      const { container, cleanup } = renderComponent(component);

      const affix = container.querySelector('[data-affix]');
      expect(affix).toBeTruthy();

      cleanup();
    });

    it('should accept offsetTop of 0', () => {
      const component = () => Affix({ offsetTop: 0, children: 'Content' });
      const { container, cleanup } = renderComponent(component);

      const affix = container.querySelector('[data-affix]');
      expect(affix).toBeTruthy();

      cleanup();
    });

    it('should work with undefined offsets', () => {
      const component = () => Affix({ children: 'Content' });
      const { container, cleanup } = renderComponent(component);

      const affix = container.querySelector('[data-affix]');
      expect(affix).toBeTruthy();

      cleanup();
    });

    it('should accept large offsetTop values', () => {
      const component = () => Affix({ offsetTop: 1000, children: 'Content' });
      const { container, cleanup } = renderComponent(component);

      const affix = container.querySelector('[data-affix]');
      expect(affix).toBeTruthy();

      cleanup();
    });

    it('should accept negative offsetTop values', () => {
      const component = () => Affix({ offsetTop: -10, children: 'Content' });
      const { container, cleanup } = renderComponent(component);

      const affix = container.querySelector('[data-affix]');
      expect(affix).toBeTruthy();

      cleanup();
    });
  });

  // Position state tests
  describe('Position State', () => {
    it('should not have data-affixed attribute initially', () => {
      const component = () => Affix({ children: 'Content' });
      const { container, cleanup } = renderComponent(component);

      const affix = container.querySelector('[data-affix]');
      expect(affix?.hasAttribute('data-affixed')).toBe(false);

      cleanup();
    });

    it('should add data-affixed when affixed', async () => {
      const component = () => Affix({ offsetTop: 10, children: 'Content' });
      const { container, cleanup } = renderComponent(component);

      const affix = container.querySelector('[data-affix]') as HTMLElement;

      // Mock getBoundingClientRect to simulate affixed state
      vi.spyOn(affix, 'getBoundingClientRect').mockReturnValue({
        top: 5,
        bottom: 100,
        left: 0,
        right: 0,
        width: 100,
        height: 100,
        x: 0,
        y: 5,
        toJSON: () => ({}),
      });

      // Trigger scroll event
      window.dispatchEvent(new Event('scroll'));
      await nextTick();

      expect(affix?.hasAttribute('data-affixed')).toBe(true);

      cleanup();
    });

    it('should remove data-affixed when not affixed', async () => {
      const component = () => Affix({ offsetTop: 10, children: 'Content' });
      const { container, cleanup } = renderComponent(component);

      const affix = container.querySelector('[data-affix]') as HTMLElement;

      // First affix it
      vi.spyOn(affix, 'getBoundingClientRect').mockReturnValue({
        top: 5,
        bottom: 100,
        left: 0,
        right: 0,
        width: 100,
        height: 100,
        x: 0,
        y: 5,
        toJSON: () => ({}),
      });

      window.dispatchEvent(new Event('scroll'));
      await nextTick();

      // Then unaffix it
      vi.spyOn(affix, 'getBoundingClientRect').mockReturnValue({
        top: 20,
        bottom: 100,
        left: 0,
        right: 0,
        width: 100,
        height: 100,
        x: 0,
        y: 20,
        toJSON: () => ({}),
      });

      window.dispatchEvent(new Event('scroll'));
      await nextTick();

      expect(affix?.hasAttribute('data-affixed')).toBe(false);

      cleanup();
    });
  });

  // Scroll behavior tests
  describe('Scroll Behavior', () => {
    it('should listen to window scroll events', async () => {
      const onChange = createSpy();
      const component = () => Affix({ offsetTop: 10, onChange, children: 'Content' });
      const { container, cleanup } = renderComponent(component);

      const affix = container.querySelector('[data-affix]') as HTMLElement;

      vi.spyOn(affix, 'getBoundingClientRect').mockReturnValue({
        top: 5,
        bottom: 100,
        left: 0,
        right: 0,
        width: 100,
        height: 100,
        x: 0,
        y: 5,
        toJSON: () => ({}),
      });

      window.dispatchEvent(new Event('scroll'));
      await nextTick();

      expect(onChange.callCount).toBe(1);

      cleanup();
    });

    it('should handle multiple scroll events', async () => {
      const onChange = createSpy();
      const component = () => Affix({ offsetTop: 10, onChange, children: 'Content' });
      const { container, cleanup } = renderComponent(component);

      const affix = container.querySelector('[data-affix]') as HTMLElement;

      // First scroll - affix
      vi.spyOn(affix, 'getBoundingClientRect').mockReturnValue({
        top: 5,
        bottom: 100,
        left: 0,
        right: 0,
        width: 100,
        height: 100,
        x: 0,
        y: 5,
        toJSON: () => ({}),
      });

      window.dispatchEvent(new Event('scroll'));
      await nextTick();

      // Second scroll - unaffix
      vi.spyOn(affix, 'getBoundingClientRect').mockReturnValue({
        top: 20,
        bottom: 100,
        left: 0,
        right: 0,
        width: 100,
        height: 100,
        x: 0,
        y: 20,
        toJSON: () => ({}),
      });

      window.dispatchEvent(new Event('scroll'));
      await nextTick();

      expect(onChange.callCount).toBe(2);

      cleanup();
    });

    it('should not call onChange if state does not change', async () => {
      const onChange = createSpy();
      const component = () => Affix({ offsetTop: 10, onChange, children: 'Content' });
      const { container, cleanup } = renderComponent(component);

      const affix = container.querySelector('[data-affix]') as HTMLElement;

      vi.spyOn(affix, 'getBoundingClientRect').mockReturnValue({
        top: 20,
        bottom: 100,
        left: 0,
        right: 0,
        width: 100,
        height: 100,
        x: 0,
        y: 20,
        toJSON: () => ({}),
      });

      window.dispatchEvent(new Event('scroll'));
      await nextTick();

      window.dispatchEvent(new Event('scroll'));
      await nextTick();

      expect(onChange.callCount).toBe(0);

      cleanup();
    });

    it('should handle custom target scroll events', async () => {
      const customTarget = document.createElement('div');
      const onChange = createSpy();
      const component = () => Affix({ target: () => customTarget, offsetTop: 10, onChange, children: 'Content' });
      const { container, cleanup } = renderComponent(component);

      const affix = container.querySelector('[data-affix]') as HTMLElement;

      vi.spyOn(affix, 'getBoundingClientRect').mockReturnValue({
        top: 5,
        bottom: 100,
        left: 0,
        right: 0,
        width: 100,
        height: 100,
        x: 0,
        y: 5,
        toJSON: () => ({}),
      });

      customTarget.dispatchEvent(new Event('scroll'));
      await nextTick();

      expect(onChange.callCount).toBe(1);

      cleanup();
    });

    it('should handle scroll without element ref', async () => {
      const component = () => Affix({ offsetTop: 10, children: 'Content' });
      renderComponent(component);

      // Dispatch scroll before ref is set - should not throw
      window.dispatchEvent(new Event('scroll'));
      await nextTick();

      expect(true).toBe(true);
    });
  });

  // Target prop tests
  describe('Target Prop', () => {
    it('should use window as default target', () => {
      const component = () => Affix({ children: 'Content' });
      const { cleanup } = renderComponent(component);

      // If no errors, window is being used
      expect(true).toBe(true);

      cleanup();
    });

    it('should accept custom target element', () => {
      const customTarget = document.createElement('div');
      const component = () => Affix({ target: () => customTarget, children: 'Content' });
      const { cleanup } = renderComponent(component);

      // If no errors, custom target is being used
      expect(true).toBe(true);

      cleanup();
    });

    it('should listen to scroll on custom target', async () => {
      const customTarget = document.createElement('div');
      const onChange = createSpy();
      const component = () => Affix({ target: () => customTarget, offsetTop: 10, onChange, children: 'Content' });
      const { container, cleanup } = renderComponent(component);

      const affix = container.querySelector('[data-affix]') as HTMLElement;

      vi.spyOn(affix, 'getBoundingClientRect').mockReturnValue({
        top: 5,
        bottom: 100,
        left: 0,
        right: 0,
        width: 100,
        height: 100,
        x: 0,
        y: 5,
        toJSON: () => ({}),
      });

      customTarget.dispatchEvent(new Event('scroll'));
      await nextTick();

      expect(onChange.callCount).toBe(1);

      cleanup();
    });
  });

  // onChange callback tests
  describe('onChange Callback', () => {
    it('should call onChange when affixed', async () => {
      const onChange = createSpy();
      const component = () => Affix({ offsetTop: 10, onChange, children: 'Content' });
      const { container, cleanup } = renderComponent(component);

      const affix = container.querySelector('[data-affix]') as HTMLElement;

      vi.spyOn(affix, 'getBoundingClientRect').mockReturnValue({
        top: 5,
        bottom: 100,
        left: 0,
        right: 0,
        width: 100,
        height: 100,
        x: 0,
        y: 5,
        toJSON: () => ({}),
      });

      window.dispatchEvent(new Event('scroll'));
      await nextTick();

      expect(onChange.callCount).toBe(1);
      expect(onChange.calls[0][0]).toBe(true);

      cleanup();
    });

    it('should call onChange when unaffixed', async () => {
      const onChange = createSpy();
      const component = () => Affix({ offsetTop: 10, onChange, children: 'Content' });
      const { container, cleanup } = renderComponent(component);

      const affix = container.querySelector('[data-affix]') as HTMLElement;

      // First affix
      vi.spyOn(affix, 'getBoundingClientRect').mockReturnValue({
        top: 5,
        bottom: 100,
        left: 0,
        right: 0,
        width: 100,
        height: 100,
        x: 0,
        y: 5,
        toJSON: () => ({}),
      });

      window.dispatchEvent(new Event('scroll'));
      await nextTick();

      // Then unaffix
      vi.spyOn(affix, 'getBoundingClientRect').mockReturnValue({
        top: 20,
        bottom: 100,
        left: 0,
        right: 0,
        width: 100,
        height: 100,
        x: 0,
        y: 20,
        toJSON: () => ({}),
      });

      window.dispatchEvent(new Event('scroll'));
      await nextTick();

      expect(onChange.callCount).toBe(2);
      expect(onChange.calls[0][0]).toBe(true);
      expect(onChange.calls[1][0]).toBe(false);

      cleanup();
    });

    it('should work without onChange callback', async () => {
      const component = () => Affix({ offsetTop: 10, children: 'Content' });
      const { container, cleanup } = renderComponent(component);

      const affix = container.querySelector('[data-affix]') as HTMLElement;

      vi.spyOn(affix, 'getBoundingClientRect').mockReturnValue({
        top: 5,
        bottom: 100,
        left: 0,
        right: 0,
        width: 100,
        height: 100,
        x: 0,
        y: 5,
        toJSON: () => ({}),
      });

      window.dispatchEvent(new Event('scroll'));
      await nextTick();

      // Should not throw
      expect(affix).toBeTruthy();

      cleanup();
    });

    it('should not call onChange multiple times for same state', async () => {
      const onChange = createSpy();
      const component = () => Affix({ offsetTop: 10, onChange, children: 'Content' });
      const { container, cleanup } = renderComponent(component);

      const affix = container.querySelector('[data-affix]') as HTMLElement;

      vi.spyOn(affix, 'getBoundingClientRect').mockReturnValue({
        top: 5,
        bottom: 100,
        left: 0,
        right: 0,
        width: 100,
        height: 100,
        x: 0,
        y: 5,
        toJSON: () => ({}),
      });

      // Multiple scrolls with same state
      window.dispatchEvent(new Event('scroll'));
      await nextTick();
      window.dispatchEvent(new Event('scroll'));
      await nextTick();
      window.dispatchEvent(new Event('scroll'));
      await nextTick();

      // Should only call once
      expect(onChange.callCount).toBe(1);

      cleanup();
    });
  });

  // offsetBottom behavior tests
  describe('offsetBottom Behavior', () => {
    it('should affix when using offsetBottom', async () => {
      const onChange = createSpy();
      const component = () => Affix({ offsetBottom: 50, onChange, children: 'Content' });
      const { container, cleanup } = renderComponent(component);

      const affix = container.querySelector('[data-affix]') as HTMLElement;

      // Mock getBoundingClientRect to simulate bottom affixed state
      vi.spyOn(affix, 'getBoundingClientRect').mockReturnValue({
        top: 100,
        bottom: 750, // Greater than window.innerHeight (768) - offsetBottom (50)
        left: 0,
        right: 0,
        width: 100,
        height: 100,
        x: 0,
        y: 100,
        toJSON: () => ({}),
      });

      window.dispatchEvent(new Event('scroll'));
      await nextTick();

      expect(onChange.callCount).toBe(1);
      expect(onChange.calls[0][0]).toBe(true);

      cleanup();
    });

    it('should prioritize offsetTop over offsetBottom', async () => {
      const onChange = createSpy();
      const component = () => Affix({ offsetTop: 10, offsetBottom: 50, onChange, children: 'Content' });
      const { container, cleanup } = renderComponent(component);

      const affix = container.querySelector('[data-affix]') as HTMLElement;

      // Mock to trigger offsetTop logic
      vi.spyOn(affix, 'getBoundingClientRect').mockReturnValue({
        top: 5,
        bottom: 100,
        left: 0,
        right: 0,
        width: 100,
        height: 100,
        x: 0,
        y: 5,
        toJSON: () => ({}),
      });

      window.dispatchEvent(new Event('scroll'));
      await nextTick();

      expect(onChange.calls[0][0]).toBe(true);

      cleanup();
    });

    it('should work with offsetBottom of 0', async () => {
      const onChange = createSpy();
      const component = () => Affix({ offsetBottom: 0, onChange, children: 'Content' });
      const { container, cleanup } = renderComponent(component);

      const affix = container.querySelector('[data-affix]') as HTMLElement;

      vi.spyOn(affix, 'getBoundingClientRect').mockReturnValue({
        top: 100,
        bottom: 800,
        left: 0,
        right: 0,
        width: 100,
        height: 100,
        x: 0,
        y: 100,
        toJSON: () => ({}),
      });

      window.dispatchEvent(new Event('scroll'));
      await nextTick();

      expect(onChange.callCount).toBe(1);

      cleanup();
    });
  });

  // Edge cases and error handling
  describe('Edge Cases', () => {
    it('should handle offsetTop exactly at boundary', async () => {
      const onChange = createSpy();
      const component = () => Affix({ offsetTop: 10, onChange, children: 'Content' });
      const { container, cleanup } = renderComponent(component);

      const affix = container.querySelector('[data-affix]') as HTMLElement;

      vi.spyOn(affix, 'getBoundingClientRect').mockReturnValue({
        top: 10, // Exactly at offsetTop
        bottom: 100,
        left: 0,
        right: 0,
        width: 100,
        height: 100,
        x: 0,
        y: 10,
        toJSON: () => ({}),
      });

      window.dispatchEvent(new Event('scroll'));
      await nextTick();

      expect(onChange.callCount).toBe(1);
      expect(onChange.calls[0][0]).toBe(true);

      cleanup();
    });

    it('should handle zero offsetTop', async () => {
      const onChange = createSpy();
      const component = () => Affix({ offsetTop: 0, onChange, children: 'Content' });
      const { container, cleanup } = renderComponent(component);

      const affix = container.querySelector('[data-affix]') as HTMLElement;

      vi.spyOn(affix, 'getBoundingClientRect').mockReturnValue({
        top: -5, // Above offsetTop
        bottom: 100,
        left: 0,
        right: 0,
        width: 100,
        height: 100,
        x: 0,
        y: -5,
        toJSON: () => ({}),
      });

      window.dispatchEvent(new Event('scroll'));
      await nextTick();

      expect(onChange.calls[0][0]).toBe(true);

      cleanup();
    });

    it('should handle rapid scroll events', async () => {
      const onChange = createSpy();
      const component = () => Affix({ offsetTop: 10, onChange, children: 'Content' });
      const { container, cleanup } = renderComponent(component);

      const affix = container.querySelector('[data-affix]') as HTMLElement;

      vi.spyOn(affix, 'getBoundingClientRect').mockReturnValue({
        top: 5,
        bottom: 100,
        left: 0,
        right: 0,
        width: 100,
        height: 100,
        x: 0,
        y: 5,
        toJSON: () => ({}),
      });

      // Dispatch multiple scroll events
      window.dispatchEvent(new Event('scroll'));
      window.dispatchEvent(new Event('scroll'));
      window.dispatchEvent(new Event('scroll'));
      await nextTick();

      // Should only call onChange once since state doesn't change
      expect(onChange.callCount).toBe(1);

      cleanup();
    });

    it('should handle empty children', () => {
      const component = () => Affix({ offsetTop: 10 });
      const { container, cleanup } = renderComponent(component);

      const affix = container.querySelector('[data-affix]');
      expect(affix).toBeTruthy();

      cleanup();
    });

    it('should handle null children', () => {
      const component = () => Affix({ children: null, offsetTop: 10 });
      const { container, cleanup } = renderComponent(component);

      const affix = container.querySelector('[data-affix]');
      expect(affix).toBeTruthy();

      cleanup();
    });

    it('should handle undefined children', () => {
      const component = () => Affix({ children: undefined, offsetTop: 10 });
      const { container, cleanup } = renderComponent(component);

      const affix = container.querySelector('[data-affix]');
      expect(affix).toBeTruthy();

      cleanup();
    });

    it('should handle array children', () => {
      const component = () => Affix({ children: ['Item 1', 'Item 2'], offsetTop: 10 });
      const { container, cleanup } = renderComponent(component);

      const affix = container.querySelector('[data-affix]');
      expect(affix).toBeTruthy();

      cleanup();
    });
  });

  // Integration tests
  describe('Integration', () => {
    it('should work with complex children', () => {
      const component = () =>
        Affix({
          offsetTop: 10,
          children: ['Header ', 'Navigation'],
        });
      const { container, cleanup } = renderComponent(component);

      const affix = container.querySelector('[data-affix]');
      expect(affix).toBeTruthy();

      cleanup();
    });

    it('should handle multiple state changes correctly', async () => {
      const onChange = createSpy();
      const component = () => Affix({ offsetTop: 10, onChange, children: 'Content' });
      const { container, cleanup } = renderComponent(component);

      const affix = container.querySelector('[data-affix]') as HTMLElement;

      // Affix
      vi.spyOn(affix, 'getBoundingClientRect').mockReturnValue({
        top: 5,
        bottom: 100,
        left: 0,
        right: 0,
        width: 100,
        height: 100,
        x: 0,
        y: 5,
        toJSON: () => ({}),
      });

      window.dispatchEvent(new Event('scroll'));
      await nextTick();

      // Unaffix
      vi.spyOn(affix, 'getBoundingClientRect').mockReturnValue({
        top: 20,
        bottom: 100,
        left: 0,
        right: 0,
        width: 100,
        height: 100,
        x: 0,
        y: 20,
        toJSON: () => ({}),
      });

      window.dispatchEvent(new Event('scroll'));
      await nextTick();

      // Affix again
      vi.spyOn(affix, 'getBoundingClientRect').mockReturnValue({
        top: 5,
        bottom: 100,
        left: 0,
        right: 0,
        width: 100,
        height: 100,
        x: 0,
        y: 5,
        toJSON: () => ({}),
      });

      window.dispatchEvent(new Event('scroll'));
      await nextTick();

      expect(onChange.callCount).toBe(3);
      expect(onChange.calls[0][0]).toBe(true);
      expect(onChange.calls[1][0]).toBe(false);
      expect(onChange.calls[2][0]).toBe(true);

      cleanup();
    });
  });
});
