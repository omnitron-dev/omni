/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Spinner } from '../../../src/primitives/Spinner.js';
import { renderComponent } from '../../helpers/test-utils.js';

describe('Spinner', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('Basic rendering', () => {
    it('should render spinner with default props', () => {
      const component = () => Spinner({});

      const { container } = renderComponent(component);

      const spinnerEl = container.querySelector('[data-spinner]') as HTMLElement;
      expect(spinnerEl).toBeTruthy();
      expect(spinnerEl.getAttribute('data-size')).toBe('md');
      expect(spinnerEl.getAttribute('data-variant')).toBe('circular');
      expect(spinnerEl.getAttribute('data-speed')).toBe('normal');
    });

    it('should apply custom props', () => {
      const component = () =>
        Spinner({
          'data-testid': 'custom-spinner',
          class: 'custom-class',
        });

      const { container } = renderComponent(component);

      const spinnerEl = container.querySelector('[data-spinner]') as HTMLElement;
      expect(spinnerEl.getAttribute('data-testid')).toBe('custom-spinner');
      expect(spinnerEl.classList.contains('custom-class')).toBe(true);
    });
  });

  describe('Sizes', () => {
    it('should render with xs size', () => {
      const component = () => Spinner({ size: 'xs' });

      const { container } = renderComponent(component);

      const spinnerEl = container.querySelector('[data-spinner]') as HTMLElement;
      expect(spinnerEl.getAttribute('data-size')).toBe('xs');
    });

    it('should render with sm size', () => {
      const component = () => Spinner({ size: 'sm' });

      const { container } = renderComponent(component);

      const spinnerEl = container.querySelector('[data-spinner]') as HTMLElement;
      expect(spinnerEl.getAttribute('data-size')).toBe('sm');
    });

    it('should render with md size (default)', () => {
      const component = () => Spinner({});

      const { container } = renderComponent(component);

      const spinnerEl = container.querySelector('[data-spinner]') as HTMLElement;
      expect(spinnerEl.getAttribute('data-size')).toBe('md');
    });

    it('should render with lg size', () => {
      const component = () => Spinner({ size: 'lg' });

      const { container } = renderComponent(component);

      const spinnerEl = container.querySelector('[data-spinner]') as HTMLElement;
      expect(spinnerEl.getAttribute('data-size')).toBe('lg');
    });

    it('should render with xl size', () => {
      const component = () => Spinner({ size: 'xl' });

      const { container } = renderComponent(component);

      const spinnerEl = container.querySelector('[data-spinner]') as HTMLElement;
      expect(spinnerEl.getAttribute('data-size')).toBe('xl');
    });
  });

  describe('Variants', () => {
    it('should render circular variant (default)', () => {
      const component = () => Spinner({});

      const { container } = renderComponent(component);

      const spinnerEl = container.querySelector('[data-spinner]') as HTMLElement;
      expect(spinnerEl.getAttribute('data-variant')).toBe('circular');

      const svg = spinnerEl.querySelector('[data-spinner-svg]');
      expect(svg).toBeTruthy();
      expect(svg?.tagName).toBe('svg');

      const circle = svg?.querySelector('[data-spinner-circle]');
      expect(circle).toBeTruthy();
      expect(circle?.tagName).toBe('circle');
      expect(circle?.getAttribute('cx')).toBe('25');
      expect(circle?.getAttribute('cy')).toBe('25');
      expect(circle?.getAttribute('r')).toBe('20');
      expect(circle?.getAttribute('fill')).toBe('none');
      expect(circle?.getAttribute('strokeWidth')).toBe('4');
    });

    it('should render dots variant', () => {
      const component = () => Spinner({ variant: 'dots' });

      const { container } = renderComponent(component);

      const spinnerEl = container.querySelector('[data-spinner]') as HTMLElement;
      expect(spinnerEl.getAttribute('data-variant')).toBe('dots');

      const dotsContainer = spinnerEl.querySelector('[data-spinner-dots]');
      expect(dotsContainer).toBeTruthy();

      const dots = spinnerEl.querySelectorAll('[data-spinner-dot]');
      expect(dots.length).toBe(3);
    });

    it('should render bars variant', () => {
      const component = () => Spinner({ variant: 'bars' });

      const { container } = renderComponent(component);

      const spinnerEl = container.querySelector('[data-spinner]') as HTMLElement;
      expect(spinnerEl.getAttribute('data-variant')).toBe('bars');

      const barsContainer = spinnerEl.querySelector('[data-spinner-bars]');
      expect(barsContainer).toBeTruthy();

      const bars = spinnerEl.querySelectorAll('[data-spinner-bar]');
      expect(bars.length).toBe(4);
    });

    it('should only render one variant at a time', () => {
      const component = () => Spinner({ variant: 'dots' });

      const { container } = renderComponent(component);

      const spinnerEl = container.querySelector('[data-spinner]') as HTMLElement;

      // Should have dots
      const dots = spinnerEl.querySelector('[data-spinner-dots]');
      expect(dots).toBeTruthy();

      // Should not have circular or bars
      const svg = spinnerEl.querySelector('[data-spinner-svg]');
      const bars = spinnerEl.querySelector('[data-spinner-bars]');
      expect(svg).toBeFalsy();
      expect(bars).toBeFalsy();
    });
  });

  describe('Speed', () => {
    it('should render with slow speed', () => {
      const component = () => Spinner({ speed: 'slow' });

      const { container } = renderComponent(component);

      const spinnerEl = container.querySelector('[data-spinner]') as HTMLElement;
      expect(spinnerEl.getAttribute('data-speed')).toBe('slow');
    });

    it('should render with normal speed (default)', () => {
      const component = () => Spinner({});

      const { container } = renderComponent(component);

      const spinnerEl = container.querySelector('[data-spinner]') as HTMLElement;
      expect(spinnerEl.getAttribute('data-speed')).toBe('normal');
    });

    it('should render with fast speed', () => {
      const component = () => Spinner({ speed: 'fast' });

      const { container } = renderComponent(component);

      const spinnerEl = container.querySelector('[data-spinner]') as HTMLElement;
      expect(spinnerEl.getAttribute('data-speed')).toBe('fast');
    });
  });

  describe('Label support', () => {
    it('should use default label "Loading..."', () => {
      const component = () => Spinner({});

      const { container } = renderComponent(component);

      const spinnerEl = container.querySelector('[data-spinner]') as HTMLElement;
      expect(spinnerEl.getAttribute('aria-label')).toBe('Loading...');
    });

    it('should use custom label', () => {
      const component = () => Spinner({ label: 'Processing request...' });

      const { container } = renderComponent(component);

      const spinnerEl = container.querySelector('[data-spinner]') as HTMLElement;
      expect(spinnerEl.getAttribute('aria-label')).toBe('Processing request...');
    });

    it('should render screen reader only label by default', () => {
      const component = () => Spinner({ label: 'Custom loading' });

      const { container } = renderComponent(component);

      const srLabel = container.querySelector('[data-spinner-label-sr]') as HTMLElement;
      expect(srLabel).toBeTruthy();
      expect(srLabel.textContent).toBe('Custom loading');

      // Check visually hidden styles
      expect(srLabel.style.position).toBe('absolute');
      expect(srLabel.style.width).toBe('1px');
      expect(srLabel.style.height).toBe('1px');
      expect(srLabel.style.padding).toBe('0px');
      expect(srLabel.style.margin).toBe('-1px');
      expect(srLabel.style.overflow).toBe('hidden');
      expect(srLabel.style.clip).toBe('rect(0, 0, 0, 0)');
      expect(srLabel.style.whiteSpace).toBe('nowrap');
      expect(srLabel.style.borderWidth).toBe('0px');
    });

    it('should render visible label when showLabel is true', () => {
      const component = () =>
        Spinner({
          label: 'Loading data...',
          showLabel: true,
        });

      const { container } = renderComponent(component);

      const visibleLabel = container.querySelector('[data-spinner-label]') as HTMLElement;
      expect(visibleLabel).toBeTruthy();
      expect(visibleLabel.textContent).toBe('Loading data...');

      // Should not have screen reader only label
      const srLabel = container.querySelector('[data-spinner-label-sr]');
      expect(srLabel).toBeFalsy();
    });

    it('should not render screen reader label when showLabel is true', () => {
      const component = () =>
        Spinner({
          label: 'Loading...',
          showLabel: true,
        });

      const { container } = renderComponent(component);

      const srLabel = container.querySelector('[data-spinner-label-sr]');
      expect(srLabel).toBeFalsy();
    });
  });

  describe('Accessibility - ARIA attributes', () => {
    it('should have role="status"', () => {
      const component = () => Spinner({});

      const { container } = renderComponent(component);

      const spinnerEl = container.querySelector('[data-spinner]') as HTMLElement;
      expect(spinnerEl.getAttribute('role')).toBe('status');
    });

    it('should have aria-label', () => {
      const component = () => Spinner({ label: 'Loading content' });

      const { container } = renderComponent(component);

      const spinnerEl = container.querySelector('[data-spinner]') as HTMLElement;
      expect(spinnerEl.getAttribute('aria-label')).toBe('Loading content');
    });

    it('should have aria-live="polite"', () => {
      const component = () => Spinner({});

      const { container } = renderComponent(component);

      const spinnerEl = container.querySelector('[data-spinner]') as HTMLElement;
      expect(spinnerEl.getAttribute('aria-live')).toBe('polite');
    });

    it('should have aria-busy="true"', () => {
      const component = () => Spinner({});

      const { container } = renderComponent(component);

      const spinnerEl = container.querySelector('[data-spinner]') as HTMLElement;
      expect(spinnerEl.getAttribute('aria-busy')).toBe('true');
    });

    it('should have all required ARIA attributes together', () => {
      const component = () =>
        Spinner({
          label: 'Saving changes...',
        });

      const { container } = renderComponent(component);

      const spinnerEl = container.querySelector('[data-spinner]') as HTMLElement;
      expect(spinnerEl.getAttribute('role')).toBe('status');
      expect(spinnerEl.getAttribute('aria-label')).toBe('Saving changes...');
      expect(spinnerEl.getAttribute('aria-live')).toBe('polite');
      expect(spinnerEl.getAttribute('aria-busy')).toBe('true');
    });
  });

  describe('SVG structure for circular variant', () => {
    it('should have correct SVG viewBox', () => {
      const component = () => Spinner({ variant: 'circular' });

      const { container } = renderComponent(component);

      const svg = container.querySelector('[data-spinner-svg]');
      expect(svg?.getAttribute('viewBox')).toBe('0 0 50 50');
    });

    it('should have circle with correct attributes', () => {
      const component = () => Spinner({ variant: 'circular' });

      const { container } = renderComponent(component);

      const circle = container.querySelector('[data-spinner-circle]');
      expect(circle?.getAttribute('cx')).toBe('25');
      expect(circle?.getAttribute('cy')).toBe('25');
      expect(circle?.getAttribute('r')).toBe('20');
      expect(circle?.getAttribute('fill')).toBe('none');
      expect(circle?.getAttribute('strokeWidth')).toBe('4');
    });
  });

  describe('Combined props', () => {
    it('should handle all props together', () => {
      const component = () =>
        Spinner({
          size: 'lg',
          variant: 'dots',
          label: 'Processing...',
          speed: 'fast',
          showLabel: true,
          class: 'custom-spinner',
          'data-testid': 'test-spinner',
        });

      const { container } = renderComponent(component);

      const spinnerEl = container.querySelector('[data-spinner]') as HTMLElement;

      // Check all attributes
      expect(spinnerEl.getAttribute('data-size')).toBe('lg');
      expect(spinnerEl.getAttribute('data-variant')).toBe('dots');
      expect(spinnerEl.getAttribute('data-speed')).toBe('fast');
      expect(spinnerEl.getAttribute('aria-label')).toBe('Processing...');
      expect(spinnerEl.getAttribute('role')).toBe('status');
      expect(spinnerEl.getAttribute('data-testid')).toBe('test-spinner');
      expect(spinnerEl.classList.contains('custom-spinner')).toBe(true);

      // Check variant rendered
      const dots = spinnerEl.querySelector('[data-spinner-dots]');
      expect(dots).toBeTruthy();

      // Check visible label
      const label = spinnerEl.querySelector('[data-spinner-label]');
      expect(label).toBeTruthy();
      expect(label?.textContent).toBe('Processing...');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty label gracefully', () => {
      const component = () => Spinner({ label: '' });

      const { container } = renderComponent(component);

      const spinnerEl = container.querySelector('[data-spinner]') as HTMLElement;
      expect(spinnerEl.getAttribute('aria-label')).toBe('');

      const srLabel = container.querySelector('[data-spinner-label-sr]') as HTMLElement;
      expect(srLabel.textContent).toBe('');
    });

    it('should render without children content', () => {
      const component = () => Spinner({});

      const { container } = renderComponent(component);

      const spinnerEl = container.querySelector('[data-spinner]') as HTMLElement;

      // Should only have variant element and label
      const children = spinnerEl.children;
      expect(children.length).toBeGreaterThan(0);

      // Should have circular SVG and screen reader label
      expect(spinnerEl.querySelector('[data-spinner-svg]')).toBeTruthy();
      expect(spinnerEl.querySelector('[data-spinner-label-sr]')).toBeTruthy();
    });

    it('should maintain ARIA attributes with all variants', () => {
      const variants: Array<'circular' | 'dots' | 'bars'> = ['circular', 'dots', 'bars'];

      variants.forEach((variant) => {
        document.body.innerHTML = '';

        const component = () => Spinner({ variant });
        const { container } = renderComponent(component);

        const spinnerEl = container.querySelector('[data-spinner]') as HTMLElement;

        expect(spinnerEl.getAttribute('role')).toBe('status');
        expect(spinnerEl.getAttribute('aria-live')).toBe('polite');
        expect(spinnerEl.getAttribute('aria-busy')).toBe('true');
        expect(spinnerEl.getAttribute('aria-label')).toBe('Loading...');
      });
    });

    it('should maintain ARIA attributes with all sizes', () => {
      const sizes: Array<'xs' | 'sm' | 'md' | 'lg' | 'xl'> = ['xs', 'sm', 'md', 'lg', 'xl'];

      sizes.forEach((size) => {
        document.body.innerHTML = '';

        const component = () => Spinner({ size });
        const { container } = renderComponent(component);

        const spinnerEl = container.querySelector('[data-spinner]') as HTMLElement;

        expect(spinnerEl.getAttribute('role')).toBe('status');
        expect(spinnerEl.getAttribute('aria-live')).toBe('polite');
        expect(spinnerEl.getAttribute('aria-busy')).toBe('true');
      });
    });
  });

  describe('Integration scenarios', () => {
    it('should work as loading indicator for buttons', () => {
      const component = () =>
        Spinner({
          size: 'sm',
          variant: 'dots',
          label: 'Saving...',
        });

      const { container } = renderComponent(component);

      const spinnerEl = container.querySelector('[data-spinner]') as HTMLElement;

      expect(spinnerEl.getAttribute('data-size')).toBe('sm');
      expect(spinnerEl.getAttribute('data-variant')).toBe('dots');
      expect(spinnerEl.getAttribute('aria-label')).toBe('Saving...');
    });

    it('should work as full-page loader', () => {
      const component = () =>
        Spinner({
          size: 'xl',
          variant: 'circular',
          label: 'Loading application...',
          showLabel: true,
        });

      const { container } = renderComponent(component);

      const spinnerEl = container.querySelector('[data-spinner]') as HTMLElement;

      expect(spinnerEl.getAttribute('data-size')).toBe('xl');

      const visibleLabel = spinnerEl.querySelector('[data-spinner-label]');
      expect(visibleLabel).toBeTruthy();
      expect(visibleLabel?.textContent).toBe('Loading application...');
    });

    it('should work with data loading scenarios', () => {
      const component = () =>
        Spinner({
          size: 'lg',
          variant: 'bars',
          label: 'Loading data...',
          speed: 'normal',
        });

      const { container } = renderComponent(component);

      const spinnerEl = container.querySelector('[data-spinner]') as HTMLElement;

      expect(spinnerEl.getAttribute('data-size')).toBe('lg');
      expect(spinnerEl.getAttribute('data-variant')).toBe('bars');

      const bars = spinnerEl.querySelectorAll('[data-spinner-bar]');
      expect(bars.length).toBe(4);
    });
  });
});
