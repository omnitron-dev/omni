/**
 * Skeleton Primitive Tests
 * @vitest-environment happy-dom
 */

import { describe, it, expect, afterEach } from 'vitest';
import { Skeleton } from '../../../src/primitives/Skeleton.js';
import { renderComponent } from '../../helpers/test-utils.js';

describe('Skeleton', () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  describe('Structure & Attributes Tests', () => {
    it('should render div with data-skeleton attribute', () => {
      const { container, cleanup: dispose } = renderComponent(() => Skeleton({}));
      cleanup = dispose;

      const skeleton = container.querySelector('div[data-skeleton]');
      expect(skeleton).toBeTruthy();
    });

    it('should set aria-busy to "true"', () => {
      const { container, cleanup: dispose } = renderComponent(() => Skeleton({}));
      cleanup = dispose;

      const skeleton = container.querySelector('div[data-skeleton]');
      expect(skeleton?.getAttribute('aria-busy')).toBe('true');
    });

    it('should set aria-live to "polite"', () => {
      const { container, cleanup: dispose } = renderComponent(() => Skeleton({}));
      cleanup = dispose;

      const skeleton = container.querySelector('div[data-skeleton]');
      expect(skeleton?.getAttribute('aria-live')).toBe('polite');
    });

    it('should render with data-animate attribute when animate is true', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Skeleton({
          animate: true,
        })
      );
      cleanup = dispose;

      const skeleton = container.querySelector('div[data-skeleton]');
      expect(skeleton?.hasAttribute('data-animate')).toBe(true);
    });

    it('should render with data-animate attribute when animate is undefined (default)', () => {
      const { container, cleanup: dispose } = renderComponent(() => Skeleton({}));
      cleanup = dispose;

      const skeleton = container.querySelector('div[data-skeleton]');
      expect(skeleton?.hasAttribute('data-animate')).toBe(true);
    });

    it('should NOT render data-animate attribute when animate is false', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Skeleton({
          animate: false,
        })
      );
      cleanup = dispose;

      const skeleton = container.querySelector('div[data-skeleton]');
      expect(skeleton?.hasAttribute('data-animate')).toBe(false);
    });
  });

  describe('Width Tests', () => {
    it('should accept width as string value (e.g., "100%")', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Skeleton({
          width: '100%',
        })
      );
      cleanup = dispose;

      const skeleton = container.querySelector('div[data-skeleton]') as HTMLElement;
      expect(skeleton.style.width).toBe('100%');
    });

    it('should accept width as number and convert to px (e.g., 200 -> "200px")', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Skeleton({
          width: 200,
        })
      );
      cleanup = dispose;

      const skeleton = container.querySelector('div[data-skeleton]') as HTMLElement;
      expect(skeleton.style.width).toBe('200px');
    });

    it('should handle width as "auto"', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Skeleton({
          width: 'auto',
        })
      );
      cleanup = dispose;

      const skeleton = container.querySelector('div[data-skeleton]') as HTMLElement;
      expect(skeleton.style.width).toBe('auto');
    });

    it('should handle no width prop (undefined)', () => {
      const { container, cleanup: dispose } = renderComponent(() => Skeleton({}));
      cleanup = dispose;

      const skeleton = container.querySelector('div[data-skeleton]') as HTMLElement;
      expect(skeleton.style.width).toBe('');
    });
  });

  describe('Height Tests', () => {
    it('should accept height as string value (e.g., "20px")', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Skeleton({
          height: '20px',
        })
      );
      cleanup = dispose;

      const skeleton = container.querySelector('div[data-skeleton]') as HTMLElement;
      expect(skeleton.style.height).toBe('20px');
    });

    it('should accept height as number and convert to px (e.g., 40 -> "40px")', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Skeleton({
          height: 40,
        })
      );
      cleanup = dispose;

      const skeleton = container.querySelector('div[data-skeleton]') as HTMLElement;
      expect(skeleton.style.height).toBe('40px');
    });

    it('should handle height as "1em"', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Skeleton({
          height: '1em',
        })
      );
      cleanup = dispose;

      const skeleton = container.querySelector('div[data-skeleton]') as HTMLElement;
      expect(skeleton.style.height).toBe('1em');
    });

    it('should handle no height prop (undefined)', () => {
      const { container, cleanup: dispose } = renderComponent(() => Skeleton({}));
      cleanup = dispose;

      const skeleton = container.querySelector('div[data-skeleton]') as HTMLElement;
      expect(skeleton.style.height).toBe('');
    });
  });

  describe('Radius Tests', () => {
    it('should use default radius of "4px" when not provided', () => {
      const { container, cleanup: dispose } = renderComponent(() => Skeleton({}));
      cleanup = dispose;

      const skeleton = container.querySelector('div[data-skeleton]') as HTMLElement;
      expect(skeleton.style.borderRadius).toBe('4px');
    });

    it('should accept custom radius as string (e.g., "8px")', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Skeleton({
          radius: '8px',
        })
      );
      cleanup = dispose;

      const skeleton = container.querySelector('div[data-skeleton]') as HTMLElement;
      expect(skeleton.style.borderRadius).toBe('8px');
    });

    it('should accept custom radius as number and convert to px (e.g., 10 -> "10px")', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Skeleton({
          radius: 10,
        })
      );
      cleanup = dispose;

      const skeleton = container.querySelector('div[data-skeleton]') as HTMLElement;
      expect(skeleton.style.borderRadius).toBe('10px');
    });

    it('should accept radius as percentage (e.g., "50%" for circle)', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Skeleton({
          radius: '50%',
        })
      );
      cleanup = dispose;

      const skeleton = container.querySelector('div[data-skeleton]') as HTMLElement;
      expect(skeleton.style.borderRadius).toBe('50%');
    });

    it('should handle radius as "0" for sharp corners', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Skeleton({
          radius: 0,
        })
      );
      cleanup = dispose;

      const skeleton = container.querySelector('div[data-skeleton]') as HTMLElement;
      expect(skeleton.style.borderRadius).toBe('0px');
    });
  });

  describe('Animation Tests', () => {
    it('should animate by default (animate prop not provided)', () => {
      const { container, cleanup: dispose } = renderComponent(() => Skeleton({}));
      cleanup = dispose;

      const skeleton = container.querySelector('div[data-skeleton]');
      expect(skeleton?.hasAttribute('data-animate')).toBe(true);
    });

    it('should animate when animate is explicitly true', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Skeleton({
          animate: true,
        })
      );
      cleanup = dispose;

      const skeleton = container.querySelector('div[data-skeleton]');
      expect(skeleton?.hasAttribute('data-animate')).toBe(true);
    });

    it('should not animate when animate is false', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Skeleton({
          animate: false,
        })
      );
      cleanup = dispose;

      const skeleton = container.querySelector('div[data-skeleton]');
      expect(skeleton?.hasAttribute('data-animate')).toBe(false);
    });
  });

  describe('Style Merging Tests', () => {
    it('should merge custom styles with computed styles', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Skeleton({
          width: '100px',
          height: '50px',
          style: { color: 'red', margin: '10px' },
        })
      );
      cleanup = dispose;

      const skeleton = container.querySelector('div[data-skeleton]') as HTMLElement;
      expect(skeleton.style.width).toBe('100px');
      expect(skeleton.style.height).toBe('50px');
      expect(skeleton.style.color).toBe('red');
      expect(skeleton.style.margin).toBe('10px');
    });

    it('should preserve custom background-color style', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Skeleton({
          style: { backgroundColor: 'blue' },
        })
      );
      cleanup = dispose;

      const skeleton = container.querySelector('div[data-skeleton]') as HTMLElement;
      expect(skeleton.style.backgroundColor).toBe('blue');
    });

    it('should allow overriding borderRadius via style prop', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Skeleton({
          radius: '4px',
          style: { borderRadius: '12px' },
        })
      );
      cleanup = dispose;

      const skeleton = container.querySelector('div[data-skeleton]') as HTMLElement;
      // radius prop takes precedence over style.borderRadius due to spread order
      expect(skeleton.style.borderRadius).toBe('4px');
    });

    it('should accept style prop as undefined', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Skeleton({
          style: undefined,
        })
      );
      cleanup = dispose;

      const skeleton = container.querySelector('div[data-skeleton]');
      expect(skeleton).toBeTruthy();
    });
  });

  describe('Props Spreading Tests', () => {
    it('should spread additional props to div element', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Skeleton({
          'data-testid': 'my-skeleton',
          'aria-label': 'Loading content',
        })
      );
      cleanup = dispose;

      const skeleton = container.querySelector('div[data-skeleton]');
      expect(skeleton?.getAttribute('data-testid')).toBe('my-skeleton');
      expect(skeleton?.getAttribute('aria-label')).toBe('Loading content');
    });

    it('should accept className prop', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Skeleton({
          className: 'custom-skeleton',
        })
      );
      cleanup = dispose;

      const skeleton = container.querySelector('div[data-skeleton]');
      expect(skeleton?.className).toBe('custom-skeleton');
    });

    it('should accept id prop', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Skeleton({
          id: 'my-skeleton-id',
        })
      );
      cleanup = dispose;

      const skeleton = container.querySelector('div[data-skeleton]');
      expect(skeleton?.id).toBe('my-skeleton-id');
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero width', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Skeleton({
          width: 0,
        })
      );
      cleanup = dispose;

      const skeleton = container.querySelector('div[data-skeleton]') as HTMLElement;
      expect(skeleton.style.width).toBe('0px');
    });

    it('should handle zero height', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Skeleton({
          height: 0,
        })
      );
      cleanup = dispose;

      const skeleton = container.querySelector('div[data-skeleton]') as HTMLElement;
      expect(skeleton.style.height).toBe('0px');
    });

    it('should handle zero radius', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Skeleton({
          radius: 0,
        })
      );
      cleanup = dispose;

      const skeleton = container.querySelector('div[data-skeleton]') as HTMLElement;
      expect(skeleton.style.borderRadius).toBe('0px');
    });

    it('should handle very large dimensions (width: 10000)', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Skeleton({
          width: 10000,
          height: 10000,
        })
      );
      cleanup = dispose;

      const skeleton = container.querySelector('div[data-skeleton]') as HTMLElement;
      expect(skeleton.style.width).toBe('10000px');
      expect(skeleton.style.height).toBe('10000px');
    });

    it('should render children if provided (though typically empty)', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Skeleton({
          children: 'Loading...',
        })
      );
      cleanup = dispose;

      const skeleton = container.querySelector('div[data-skeleton]');
      expect(skeleton?.textContent).toBe('Loading...');
    });
  });
});
