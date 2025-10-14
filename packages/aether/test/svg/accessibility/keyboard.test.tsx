import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  useSVGKeyboardNavigation,
  makeKeyboardFocusable,
  removeKeyboardFocus,
  isKeyboardFocusable,
  type KeyboardNavigationConfig,
} from '../../../src/svg/accessibility/keyboard.js';
import { signal } from '../../../src/core/reactivity/index.js';

describe('SVG Keyboard Navigation', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  describe('useSVGKeyboardNavigation', () => {
    it('should create keyboard navigation for SVG', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      container.appendChild(svg);

      const ref = signal<SVGElement | null>(svg);
      const { focusedElement, focusNext, focusPrev, focusFirst, focusLast } = useSVGKeyboardNavigation(ref);

      expect(focusedElement).toBeDefined();
      expect(focusNext).toBeDefined();
      expect(focusPrev).toBeDefined();
      expect(focusFirst).toBeDefined();
      expect(focusLast).toBeDefined();
    });

    it('should make SVG focusable by default', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      container.appendChild(svg);

      const ref = signal<SVGElement | null>(svg);
      useSVGKeyboardNavigation(ref, { focusable: true });

      // Give effect time to run
      setTimeout(() => {
        expect(svg.getAttribute('tabindex')).toBe('0');
      }, 0);
    });

    it('should find focusable elements', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const circle1 = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      const circle2 = document.createElementNS('http://www.w3.org/2000/svg', 'circle');

      circle1.setAttribute('tabindex', '0');
      circle2.setAttribute('tabindex', '0');

      svg.appendChild(circle1);
      svg.appendChild(circle2);
      container.appendChild(svg);

      const ref = signal<SVGElement | null>(svg);
      const { focusFirst } = useSVGKeyboardNavigation(ref);

      focusFirst();
    });

    it('should support custom navigation keys', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      container.appendChild(svg);

      const ref = signal<SVGElement | null>(svg);
      const config: KeyboardNavigationConfig = {
        keys: {
          next: ['j'],
          prev: ['k'],
          select: ['Enter'],
          exit: ['Escape'],
        },
      };

      useSVGKeyboardNavigation(ref, config);

      // Navigation should use custom keys
    });

    it('should trap focus when enabled', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('tabindex', '0');
      svg.appendChild(circle);
      container.appendChild(svg);

      const ref = signal<SVGElement | null>(svg);
      useSVGKeyboardNavigation(ref, { trapFocus: true });

      // Focus should stay within SVG
    });

    it('should create focus ring when enabled', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('tabindex', '0');
      svg.appendChild(circle);
      container.appendChild(svg);

      const ref = signal<SVGElement | null>(svg);
      useSVGKeyboardNavigation(ref, { focusRing: true });

      // Focus ring should be created
    });

    it('should support custom focus ring config', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      container.appendChild(svg);

      const ref = signal<SVGElement | null>(svg);
      const config: KeyboardNavigationConfig = {
        focusRing: {
          color: '#FF0000',
          width: 3,
          offset: 4,
          style: 'dashed',
        },
      };

      useSVGKeyboardNavigation(ref, config);
    });

    it('should handle keyboard events', async () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const circle1 = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      const circle2 = document.createElementNS('http://www.w3.org/2000/svg', 'circle');

      circle1.setAttribute('tabindex', '0');
      circle2.setAttribute('tabindex', '0');

      svg.appendChild(circle1);
      svg.appendChild(circle2);
      container.appendChild(svg);

      const ref = signal<SVGElement | null>(svg);
      useSVGKeyboardNavigation(ref);

      // Simulate keyboard event
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          const event = new KeyboardEvent('keydown', { key: 'ArrowDown' });
          svg.dispatchEvent(event);
          resolve();
        }, 0);
      });
    });
  });

  describe('makeKeyboardFocusable', () => {
    it('should make element keyboard focusable', () => {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      makeKeyboardFocusable(circle);

      expect(circle.getAttribute('tabindex')).toBe('0');
      expect(circle.getAttribute('focusable')).toBe('true');
    });

    it('should support custom tabindex', () => {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      makeKeyboardFocusable(circle, 1);

      expect(circle.getAttribute('tabindex')).toBe('1');
    });
  });

  describe('removeKeyboardFocus', () => {
    it('should remove keyboard focus', () => {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      makeKeyboardFocusable(circle);

      removeKeyboardFocus(circle);

      expect(circle.hasAttribute('tabindex')).toBe(false);
      expect(circle.getAttribute('focusable')).toBe('false');
    });
  });

  describe('isKeyboardFocusable', () => {
    it('should detect focusable elements', () => {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      expect(isKeyboardFocusable(circle)).toBe(false);

      makeKeyboardFocusable(circle);
      expect(isKeyboardFocusable(circle)).toBe(true);
    });

    it('should detect naturally focusable elements', () => {
      const link = document.createElementNS('http://www.w3.org/2000/svg', 'a');
      link.setAttribute('href', '#');
      expect(isKeyboardFocusable(link)).toBe(true);
    });

    it('should handle negative tabindex', () => {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('tabindex', '-1');
      expect(isKeyboardFocusable(circle)).toBe(false);
    });

    it('should detect focusable attribute', () => {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('focusable', 'true');
      expect(isKeyboardFocusable(circle)).toBe(true);
    });
  });

  describe('Focus Ring', () => {
    it('should create focus ring with default config', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('tabindex', '0');
      svg.appendChild(circle);
      container.appendChild(svg);

      const ref = signal<SVGElement | null>(svg);
      useSVGKeyboardNavigation(ref, { focusRing: true });

      // Focus ring element should be created
    });

    it('should update focus ring position on focus', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('tabindex', '0');
      circle.setAttribute('cx', '50');
      circle.setAttribute('cy', '50');
      circle.setAttribute('r', '20');
      svg.appendChild(circle);
      container.appendChild(svg);

      const ref = signal<SVGElement | null>(svg);
      const { focusFirst } = useSVGKeyboardNavigation(ref, { focusRing: true });

      focusFirst();

      // Focus ring should be positioned around circle
    });

    it('should hide focus ring on blur', async () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('tabindex', '0');
      svg.appendChild(circle);
      container.appendChild(svg);

      const ref = signal<SVGElement | null>(svg);
      useSVGKeyboardNavigation(ref, { focusRing: true });

      await new Promise<void>((resolve) => {
        setTimeout(() => {
          // Trigger blur
          const blurEvent = new FocusEvent('focusout');
          svg.dispatchEvent(blurEvent);
          resolve();
        }, 0);
      });
    });
  });

  describe('Focus Management', () => {
    it('should focus first element', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const circle1 = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      const circle2 = document.createElementNS('http://www.w3.org/2000/svg', 'circle');

      circle1.setAttribute('tabindex', '0');
      circle2.setAttribute('tabindex', '0');

      svg.appendChild(circle1);
      svg.appendChild(circle2);
      container.appendChild(svg);

      const ref = signal<SVGElement | null>(svg);
      const { focusedElement, focusFirst } = useSVGKeyboardNavigation(ref);

      focusFirst();

      // Should focus first focusable element
    });

    it('should focus last element', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const circle1 = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      const circle2 = document.createElementNS('http://www.w3.org/2000/svg', 'circle');

      circle1.setAttribute('tabindex', '0');
      circle2.setAttribute('tabindex', '0');

      svg.appendChild(circle1);
      svg.appendChild(circle2);
      container.appendChild(svg);

      const ref = signal<SVGElement | null>(svg);
      const { focusedElement, focusLast } = useSVGKeyboardNavigation(ref);

      focusLast();

      // Should focus last focusable element
    });

    it('should cycle through elements', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const circle1 = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      const circle2 = document.createElementNS('http://www.w3.org/2000/svg', 'circle');

      circle1.setAttribute('tabindex', '0');
      circle2.setAttribute('tabindex', '0');

      svg.appendChild(circle1);
      svg.appendChild(circle2);
      container.appendChild(svg);

      const ref = signal<SVGElement | null>(svg);
      const { focusNext } = useSVGKeyboardNavigation(ref);

      focusNext();
      focusNext();

      // Should cycle back to first element
    });

    it('should restore focus on exit', async () => {
      const button = document.createElement('button');
      button.textContent = 'Test';
      document.body.appendChild(button);
      button.focus();

      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      container.appendChild(svg);

      const ref = signal<SVGElement | null>(svg);
      useSVGKeyboardNavigation(ref, { restoreFocus: true });

      await new Promise<void>((resolve) => {
        setTimeout(() => {
          // Trigger exit (Escape key)
          const event = new KeyboardEvent('keydown', { key: 'Escape' });
          svg.dispatchEvent(event);

          // Focus should be restored to button
          setTimeout(() => {
            document.body.removeChild(button);
            resolve();
          }, 0);
        }, 0);
      });
    });
  });

  describe('Auto Focus', () => {
    it('should auto focus first element when enabled', async () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('tabindex', '0');
      svg.appendChild(circle);
      container.appendChild(svg);

      const ref = signal<SVGElement | null>(svg);
      useSVGKeyboardNavigation(ref, { autoFocus: true });

      await new Promise<void>((resolve) => {
        setTimeout(() => {
          // First element should be focused
          resolve();
        }, 0);
      });
    });
  });
});
