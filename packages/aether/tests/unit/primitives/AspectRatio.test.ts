// @vitest-environment happy-dom

/**
 * AspectRatio Primitive Tests
 */

import { describe, it, expect, afterEach } from 'vitest';
import { AspectRatio } from '../../../src/primitives/AspectRatio.js';
import { renderComponent } from '../../helpers/test-utils.js';

describe('AspectRatio', () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  describe('Structure Tests', () => {
    it('should render outer container with data-aspect-ratio attribute', () => {
      const { container, cleanup: cleanupFn } = renderComponent(() =>
        AspectRatio({
          ratio: 16 / 9,
        })
      );
      cleanup = cleanupFn;

      const outerContainer = container.querySelector('div[data-aspect-ratio]');
      expect(outerContainer).toBeTruthy();
      expect(outerContainer?.hasAttribute('data-aspect-ratio')).toBe(true);
    });

    it('should render three-div structure (container, padding spacer, content)', () => {
      const { container, cleanup: cleanupFn } = renderComponent(() =>
        AspectRatio({
          ratio: 16 / 9,
        })
      );
      cleanup = cleanupFn;

      const outerContainer = container.querySelector('div[data-aspect-ratio]');
      expect(outerContainer).toBeTruthy();

      const children = outerContainer?.children;
      expect(children?.length).toBe(2); // padding spacer + content container

      // First child is padding spacer
      const paddingSpacer = children?.[0] as HTMLElement;
      expect(paddingSpacer.tagName).toBe('DIV');
      expect(paddingSpacer.style.paddingBottom).toBeTruthy();

      // Second child is content container
      const contentContainer = children?.[1] as HTMLElement;
      expect(contentContainer.tagName).toBe('DIV');
      expect(contentContainer.style.position).toBe('absolute');
    });

    it('should set position relative on outer container', () => {
      const { container, cleanup: cleanupFn } = renderComponent(() =>
        AspectRatio({
          ratio: 16 / 9,
        })
      );
      cleanup = cleanupFn;

      const outerContainer = container.querySelector('div[data-aspect-ratio]') as HTMLElement;
      expect(outerContainer.style.position).toBe('relative');
    });

    it('should set width 100% on outer container', () => {
      const { container, cleanup: cleanupFn } = renderComponent(() =>
        AspectRatio({
          ratio: 16 / 9,
        })
      );
      cleanup = cleanupFn;

      const outerContainer = container.querySelector('div[data-aspect-ratio]') as HTMLElement;
      expect(outerContainer.style.width).toBe('100%');
    });

    it('should set absolute positioning on content container', () => {
      const { container, cleanup: cleanupFn } = renderComponent(() =>
        AspectRatio({
          ratio: 16 / 9,
        })
      );
      cleanup = cleanupFn;

      const outerContainer = container.querySelector('div[data-aspect-ratio]');
      const contentContainer = outerContainer?.children[1] as HTMLElement;

      expect(contentContainer.style.position).toBe('absolute');
      expect(contentContainer.style.top).toBe('0px');
      expect(contentContainer.style.left).toBe('0px');
      expect(contentContainer.style.right).toBe('0px');
      expect(contentContainer.style.bottom).toBe('0px');
    });
  });

  describe('Ratio Calculation Tests', () => {
    it('should calculate correct padding-bottom for 16/9 ratio', () => {
      const { container, cleanup: cleanupFn } = renderComponent(() =>
        AspectRatio({
          ratio: 16 / 9,
        })
      );
      cleanup = cleanupFn;

      const outerContainer = container.querySelector('div[data-aspect-ratio]');
      const paddingSpacer = outerContainer?.children[0] as HTMLElement;

      const expectedPadding = (1 / (16 / 9)) * 100 + '%';
      expect(paddingSpacer.style.paddingBottom).toBe(expectedPadding);
    });

    it('should calculate correct padding-bottom for 4/3 ratio', () => {
      const { container, cleanup: cleanupFn } = renderComponent(() =>
        AspectRatio({
          ratio: 4 / 3,
        })
      );
      cleanup = cleanupFn;

      const outerContainer = container.querySelector('div[data-aspect-ratio]');
      const paddingSpacer = outerContainer?.children[0] as HTMLElement;

      const expectedPadding = (1 / (4 / 3)) * 100 + '%';
      expect(paddingSpacer.style.paddingBottom).toBe(expectedPadding);
    });

    it('should calculate correct padding-bottom for 1/1 (square) ratio', () => {
      const { container, cleanup: cleanupFn } = renderComponent(() =>
        AspectRatio({
          ratio: 1 / 1,
        })
      );
      cleanup = cleanupFn;

      const outerContainer = container.querySelector('div[data-aspect-ratio]');
      const paddingSpacer = outerContainer?.children[0] as HTMLElement;

      const expectedPadding = (1 / (1 / 1)) * 100 + '%';
      expect(paddingSpacer.style.paddingBottom).toBe(expectedPadding);
      expect(paddingSpacer.style.paddingBottom).toBe('100%');
    });

    it('should calculate correct padding-bottom for 3/2 ratio', () => {
      const { container, cleanup: cleanupFn } = renderComponent(() =>
        AspectRatio({
          ratio: 3 / 2,
        })
      );
      cleanup = cleanupFn;

      const outerContainer = container.querySelector('div[data-aspect-ratio]');
      const paddingSpacer = outerContainer?.children[0] as HTMLElement;

      const expectedPadding = (1 / (3 / 2)) * 100 + '%';
      expect(paddingSpacer.style.paddingBottom).toBe(expectedPadding);
    });

    it('should calculate correct padding-bottom for 21/9 (ultrawide) ratio', () => {
      const { container, cleanup: cleanupFn } = renderComponent(() =>
        AspectRatio({
          ratio: 21 / 9,
        })
      );
      cleanup = cleanupFn;

      const outerContainer = container.querySelector('div[data-aspect-ratio]');
      const paddingSpacer = outerContainer?.children[0] as HTMLElement;

      const expectedPadding = (1 / (21 / 9)) * 100 + '%';
      expect(paddingSpacer.style.paddingBottom).toBe(expectedPadding);
    });

    it('should handle ratio of 2 (2:1)', () => {
      const { container, cleanup: cleanupFn } = renderComponent(() =>
        AspectRatio({
          ratio: 2,
        })
      );
      cleanup = cleanupFn;

      const outerContainer = container.querySelector('div[data-aspect-ratio]');
      const paddingSpacer = outerContainer?.children[0] as HTMLElement;

      const expectedPadding = (1 / 2) * 100 + '%';
      expect(paddingSpacer.style.paddingBottom).toBe(expectedPadding);
      expect(paddingSpacer.style.paddingBottom).toBe('50%');
    });

    it('should handle ratio of 0.5 (1:2)', () => {
      const { container, cleanup: cleanupFn } = renderComponent(() =>
        AspectRatio({
          ratio: 0.5,
        })
      );
      cleanup = cleanupFn;

      const outerContainer = container.querySelector('div[data-aspect-ratio]');
      const paddingSpacer = outerContainer?.children[0] as HTMLElement;

      const expectedPadding = (1 / 0.5) * 100 + '%';
      expect(paddingSpacer.style.paddingBottom).toBe(expectedPadding);
      expect(paddingSpacer.style.paddingBottom).toBe('200%');
    });

    it('should handle very large ratio (100)', () => {
      const { container, cleanup: cleanupFn } = renderComponent(() =>
        AspectRatio({
          ratio: 100,
        })
      );
      cleanup = cleanupFn;

      const outerContainer = container.querySelector('div[data-aspect-ratio]');
      const paddingSpacer = outerContainer?.children[0] as HTMLElement;

      const expectedPadding = (1 / 100) * 100 + '%';
      expect(paddingSpacer.style.paddingBottom).toBe(expectedPadding);
      expect(paddingSpacer.style.paddingBottom).toBe('1%');
    });
  });

  describe('Props & Styling Tests', () => {
    it('should merge custom styles with default styles', () => {
      const { container, cleanup: cleanupFn } = renderComponent(() =>
        AspectRatio({
          ratio: 16 / 9,
          style: { backgroundColor: 'red', border: '1px solid black' },
        })
      );
      cleanup = cleanupFn;

      const outerContainer = container.querySelector('div[data-aspect-ratio]') as HTMLElement;
      expect(outerContainer.style.backgroundColor).toBe('red');
      expect(outerContainer.style.border).toBe('1px solid black');
      // Should still have default styles
      expect(outerContainer.style.position).toBe('relative');
      expect(outerContainer.style.width).toBe('100%');
    });

    it('should preserve custom position style if provided', () => {
      const { container, cleanup: cleanupFn } = renderComponent(() =>
        AspectRatio({
          ratio: 16 / 9,
          style: { position: 'absolute' },
        })
      );
      cleanup = cleanupFn;

      const outerContainer = container.querySelector('div[data-aspect-ratio]') as HTMLElement;
      // Custom style should override default
      expect(outerContainer.style.position).toBe('absolute');
    });

    it('should preserve custom width style if provided', () => {
      const { container, cleanup: cleanupFn } = renderComponent(() =>
        AspectRatio({
          ratio: 16 / 9,
          style: { width: '50%' },
        })
      );
      cleanup = cleanupFn;

      const outerContainer = container.querySelector('div[data-aspect-ratio]') as HTMLElement;
      // Custom style should override default
      expect(outerContainer.style.width).toBe('50%');
    });

    it('should spread additional props to outer container', () => {
      const { container, cleanup: cleanupFn } = renderComponent(() =>
        AspectRatio({
          ratio: 16 / 9,
          'data-custom': 'test-value',
          role: 'img',
        })
      );
      cleanup = cleanupFn;

      const outerContainer = container.querySelector('div[data-aspect-ratio]');
      expect(outerContainer?.getAttribute('data-custom')).toBe('test-value');
      expect(outerContainer?.getAttribute('role')).toBe('img');
    });

    it('should accept className prop', () => {
      const { container, cleanup: cleanupFn } = renderComponent(() =>
        AspectRatio({
          ratio: 16 / 9,
          className: 'custom-aspect-ratio',
        })
      );
      cleanup = cleanupFn;

      const outerContainer = container.querySelector('div[data-aspect-ratio]');
      expect(outerContainer?.className).toBe('custom-aspect-ratio');
    });

    it('should accept id prop', () => {
      const { container, cleanup: cleanupFn } = renderComponent(() =>
        AspectRatio({
          ratio: 16 / 9,
          id: 'my-aspect-ratio',
        })
      );
      cleanup = cleanupFn;

      const outerContainer = container.querySelector('div[data-aspect-ratio]');
      expect(outerContainer?.id).toBe('my-aspect-ratio');
    });

    it('should accept data attributes', () => {
      const { container, cleanup: cleanupFn } = renderComponent(() =>
        AspectRatio({
          ratio: 16 / 9,
          'data-testid': 'aspect-ratio-test',
          'data-state': 'active',
        })
      );
      cleanup = cleanupFn;

      const outerContainer = container.querySelector('div[data-aspect-ratio]');
      expect(outerContainer?.getAttribute('data-testid')).toBe('aspect-ratio-test');
      expect(outerContainer?.getAttribute('data-state')).toBe('active');
    });
  });

  describe('Children Tests', () => {
    it('should render children in absolute content container', () => {
      const { container, cleanup: cleanupFn } = renderComponent(() =>
        AspectRatio({
          ratio: 16 / 9,
          children: 'Test content',
        })
      );
      cleanup = cleanupFn;

      const outerContainer = container.querySelector('div[data-aspect-ratio]');
      const contentContainer = outerContainer?.children[1] as HTMLElement;

      expect(contentContainer.textContent).toBe('Test content');
      expect(contentContainer.style.position).toBe('absolute');
    });

    it('should render multiple children', () => {
      const { container, cleanup: cleanupFn } = renderComponent(() =>
        AspectRatio({
          ratio: 16 / 9,
          children: ['Child 1', 'Child 2', 'Child 3'],
        })
      );
      cleanup = cleanupFn;

      const outerContainer = container.querySelector('div[data-aspect-ratio]');
      const contentContainer = outerContainer?.children[1] as HTMLElement;

      expect(contentContainer.textContent).toContain('Child 1');
      expect(contentContainer.textContent).toContain('Child 2');
      expect(contentContainer.textContent).toContain('Child 3');
    });

    it('should handle no children (undefined)', () => {
      const { container, cleanup: cleanupFn } = renderComponent(() =>
        AspectRatio({
          ratio: 16 / 9,
          children: undefined,
        })
      );
      cleanup = cleanupFn;

      const outerContainer = container.querySelector('div[data-aspect-ratio]');
      expect(outerContainer).toBeTruthy();

      const contentContainer = outerContainer?.children[1] as HTMLElement;
      expect(contentContainer.textContent).toBe('');
    });
  });

  describe('Edge Cases', () => {
    it('should handle very small ratio (0.01)', () => {
      const { container, cleanup: cleanupFn } = renderComponent(() =>
        AspectRatio({
          ratio: 0.01,
        })
      );
      cleanup = cleanupFn;

      const outerContainer = container.querySelector('div[data-aspect-ratio]');
      const paddingSpacer = outerContainer?.children[0] as HTMLElement;

      const expectedPadding = (1 / 0.01) * 100 + '%';
      expect(paddingSpacer.style.paddingBottom).toBe(expectedPadding);
      expect(paddingSpacer.style.paddingBottom).toBe('10000%');
    });

    it('should handle ratio of 1 exactly (square)', () => {
      const { container, cleanup: cleanupFn } = renderComponent(() =>
        AspectRatio({
          ratio: 1,
        })
      );
      cleanup = cleanupFn;

      const outerContainer = container.querySelector('div[data-aspect-ratio]');
      const paddingSpacer = outerContainer?.children[0] as HTMLElement;

      const expectedPadding = (1 / 1) * 100 + '%';
      expect(paddingSpacer.style.paddingBottom).toBe(expectedPadding);
      expect(paddingSpacer.style.paddingBottom).toBe('100%');
    });

    it('should handle fractional ratios (16/9 vs 1.777...)', () => {
      const ratio1 = 16 / 9;
      const ratio2 = 1.7777777777777777;

      const { container: container1, cleanup: cleanup1Fn } = renderComponent(() =>
        AspectRatio({
          ratio: ratio1,
        })
      );

      const { container: container2, cleanup: cleanup2Fn } = renderComponent(() =>
        AspectRatio({
          ratio: ratio2,
        })
      );

      const paddingSpacer1 = container1.querySelector('div[data-aspect-ratio]')?.children[0] as HTMLElement;
      const paddingSpacer2 = container2.querySelector('div[data-aspect-ratio]')?.children[0] as HTMLElement;

      // Both should produce the same padding (or very close)
      const padding1 = parseFloat(paddingSpacer1.style.paddingBottom);
      const padding2 = parseFloat(paddingSpacer2.style.paddingBottom);

      // Allow small floating point difference
      expect(Math.abs(padding1 - padding2)).toBeLessThan(0.01);

      cleanup1Fn();
      cleanup2Fn();
    });

    it('should handle style prop as undefined', () => {
      const { container, cleanup: cleanupFn } = renderComponent(() =>
        AspectRatio({
          ratio: 16 / 9,
          style: undefined,
        })
      );
      cleanup = cleanupFn;

      const outerContainer = container.querySelector('div[data-aspect-ratio]') as HTMLElement;
      // Should still have default styles
      expect(outerContainer.style.position).toBe('relative');
      expect(outerContainer.style.width).toBe('100%');
    });
  });
});
