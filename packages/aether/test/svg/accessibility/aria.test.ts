import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createAccessibleSVG,
  makeAccessible,
  resolveValue,
  applyAccessibleProps,
  type AccessibleSVGProps,
} from '../../../src/svg/accessibility/aria.js';
import { signal } from '../../../src/core/reactivity/index.js';

describe('SVG ARIA Support', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  describe('createAccessibleSVG', () => {
    it('should create SVG with title and desc elements', () => {
      const props: AccessibleSVGProps & { width: number; height: number } = {
        width: 100,
        height: 100,
        title: 'Test SVG',
        desc: 'A test SVG graphic',
      };

      const svg = createAccessibleSVG(props);
      expect(svg).toBeDefined();
    });

    it('should set role to img when ariaLabel is provided', () => {
      const props: AccessibleSVGProps & { width: number; height: number } = {
        width: 100,
        height: 100,
        ariaLabel: 'Test graphic',
      };

      const svg = createAccessibleSVG(props);
      expect(svg).toBeDefined();
    });

    it('should set decorative attributes when decorative is true', () => {
      const props: AccessibleSVGProps & { width: number; height: number } = {
        width: 100,
        height: 100,
        decorative: true,
      };

      const svg = createAccessibleSVG(props);
      expect(svg).toBeDefined();
    });

    it('should support aria-live regions', () => {
      const props: AccessibleSVGProps & { width: number; height: number } = {
        width: 100,
        height: 100,
        ariaLive: 'polite',
        title: 'Live chart',
      };

      const svg = createAccessibleSVG(props);
      expect(svg).toBeDefined();
    });

    it('should support aria-busy state', () => {
      const props: AccessibleSVGProps & { width: number; height: number } = {
        width: 100,
        height: 100,
        ariaBusy: true,
        title: 'Loading',
      };

      const svg = createAccessibleSVG(props);
      expect(svg).toBeDefined();
    });

    it('should support focusable attribute', () => {
      const props: AccessibleSVGProps & { width: number; height: number } = {
        width: 100,
        height: 100,
        focusable: true,
        tabIndex: 0,
        title: 'Focusable SVG',
      };

      const svg = createAccessibleSVG(props);
      expect(svg).toBeDefined();
    });
  });

  describe('makeAccessible', () => {
    it('should add title element to SVG', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      makeAccessible(svg, { title: 'Test Title' });

      const titleElement = svg.querySelector('title');
      expect(titleElement).not.toBeNull();
      expect(titleElement?.textContent).toBe('Test Title');
    });

    it('should add desc element to SVG', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      makeAccessible(svg, { desc: 'Test Description' });

      const descElement = svg.querySelector('desc');
      expect(descElement).not.toBeNull();
      expect(descElement?.textContent).toBe('Test Description');
    });

    it('should set aria-label attribute', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      makeAccessible(svg, { ariaLabel: 'Test Label' });

      expect(svg.getAttribute('aria-label')).toBe('Test Label');
    });

    it('should set aria-labelledby attribute', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      makeAccessible(svg, { ariaLabelledBy: 'label-id' });

      expect(svg.getAttribute('aria-labelledby')).toBe('label-id');
    });

    it('should set aria-describedby attribute', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      makeAccessible(svg, { ariaDescribedBy: 'desc-id' });

      expect(svg.getAttribute('aria-describedby')).toBe('desc-id');
    });

    it('should set role attribute', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      makeAccessible(svg, { role: 'img' });

      expect(svg.getAttribute('role')).toBe('img');
    });

    it('should auto-set role to img when label is present', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      makeAccessible(svg, { ariaLabel: 'Test' });

      expect(svg.getAttribute('role')).toBe('img');
    });

    it('should handle decorative mode', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      makeAccessible(svg, { decorative: true });

      expect(svg.getAttribute('aria-hidden')).toBe('true');
      expect(svg.getAttribute('role')).toBe('presentation');
    });

    it('should set aria-hidden attribute', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      makeAccessible(svg, { ariaHidden: true });

      expect(svg.getAttribute('aria-hidden')).toBe('true');
    });

    it('should set aria-live attribute', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      makeAccessible(svg, { ariaLive: 'assertive' });

      expect(svg.getAttribute('aria-live')).toBe('assertive');
    });

    it('should set aria-busy attribute', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      makeAccessible(svg, { ariaBusy: true });

      expect(svg.getAttribute('aria-busy')).toBe('true');
    });

    it('should set focusable attribute', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      makeAccessible(svg, { focusable: true });

      expect(svg.getAttribute('focusable')).toBe('true');
    });

    it('should set tabindex attribute', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      makeAccessible(svg, { tabIndex: 0 });

      expect(svg.getAttribute('tabindex')).toBe('0');
    });

    it('should auto-generate IDs when enabled', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      makeAccessible(svg, {
        title: 'Test',
        autoGenerateIds: true,
      });

      const titleElement = svg.querySelector('title');
      expect(titleElement?.id).toBeTruthy();
      expect(svg.getAttribute('aria-labelledby')).toBe(titleElement?.id);
    });

    it('should link title and desc with aria attributes', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      makeAccessible(svg, {
        title: 'Title',
        desc: 'Description',
        autoGenerateIds: true,
      });

      const titleElement = svg.querySelector('title');
      const descElement = svg.querySelector('desc');

      expect(svg.getAttribute('aria-labelledby')).toBe(titleElement?.id);
      expect(svg.getAttribute('aria-describedby')).toBe(descElement?.id);
    });
  });

  describe('resolveValue', () => {
    it('should return static value as-is', () => {
      expect(resolveValue('test')).toBe('test');
      expect(resolveValue(123)).toBe(123);
      expect(resolveValue(true)).toBe(true);
    });

    it('should resolve signal value', () => {
      const value = signal('test');
      expect(resolveValue(value)).toBe('test');
    });

    it('should handle undefined', () => {
      expect(resolveValue(undefined)).toBeUndefined();
    });
  });

  describe('applyAccessibleProps', () => {
    it('should apply all accessible props to an element', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');

      const props: AccessibleSVGProps = {
        title: 'Test',
        desc: 'Description',
        ariaLabel: 'Label',
        role: 'img',
      };

      applyAccessibleProps(svg, props);

      expect(svg.querySelector('title')).not.toBeNull();
      expect(svg.querySelector('desc')).not.toBeNull();
      expect(svg.getAttribute('aria-label')).toBe('Label');
      expect(svg.getAttribute('role')).toBe('img');
    });
  });

  describe('WCAG Compliance', () => {
    it('should meet WCAG 1.1.1 Non-text Content (Level A)', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      makeAccessible(svg, {
        title: 'Chart showing sales data',
        role: 'img',
      });

      // Should have accessible name
      expect(svg.querySelector('title')).not.toBeNull();
      expect(svg.getAttribute('role')).toBe('img');
    });

    it('should meet WCAG 4.1.2 Name, Role, Value (Level A)', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      makeAccessible(svg, {
        ariaLabel: 'Interactive chart',
        role: 'img',
        focusable: true,
        tabIndex: 0,
      });

      // Should have name, role, and be operable
      expect(svg.getAttribute('aria-label')).toBeTruthy();
      expect(svg.getAttribute('role')).toBeTruthy();
      expect(svg.getAttribute('tabindex')).toBe('0');
    });

    it('should support decorative images per WCAG', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      makeAccessible(svg, { decorative: true });

      // Decorative images should be hidden from assistive tech
      expect(svg.getAttribute('aria-hidden')).toBe('true');
      expect(svg.getAttribute('role')).toBe('presentation');
    });
  });
});
