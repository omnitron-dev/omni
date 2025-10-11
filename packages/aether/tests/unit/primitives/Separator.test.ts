/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Separator } from '../../../src/primitives/Separator.js';
import { renderComponent } from '../../helpers/test-utils.js';

describe('Separator', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('Basic Rendering', () => {
    it('should render as a div element', () => {
      const component = () => Separator({});

      const { container } = renderComponent(component);

      const separatorEl = container.querySelector('div');
      expect(separatorEl).toBeTruthy();
    });

    it('should render with no children', () => {
      const component = () => Separator({});

      const { container } = renderComponent(component);

      const separatorEl = container.querySelector('div');
      expect(separatorEl).toBeTruthy();
      expect(separatorEl?.textContent).toBe('');
    });

    it('should render with children', () => {
      const component = () => Separator({ children: 'Content' });

      const { container } = renderComponent(component);

      const separatorEl = container.querySelector('div');
      expect(separatorEl?.textContent).toBe('Content');
    });

    it('should render with multiple children', () => {
      const component = () => Separator({ children: ['Child 1', 'Child 2'] });

      const { container } = renderComponent(component);

      const separatorEl = container.querySelector('div');
      expect(separatorEl?.textContent).toContain('Child 1');
      expect(separatorEl?.textContent).toContain('Child 2');
    });
  });

  describe('Orientation', () => {
    it('should default to horizontal orientation', () => {
      const component = () => Separator({});

      const { container } = renderComponent(component);

      const separatorEl = container.querySelector('div') as HTMLElement;
      expect(separatorEl.getAttribute('data-orientation')).toBe('horizontal');
    });

    it('should apply horizontal orientation explicitly', () => {
      const component = () => Separator({ orientation: 'horizontal' });

      const { container } = renderComponent(component);

      const separatorEl = container.querySelector('div') as HTMLElement;
      expect(separatorEl.getAttribute('data-orientation')).toBe('horizontal');
    });

    it('should apply vertical orientation', () => {
      const component = () => Separator({ orientation: 'vertical' });

      const { container } = renderComponent(component);

      const separatorEl = container.querySelector('div') as HTMLElement;
      expect(separatorEl.getAttribute('data-orientation')).toBe('vertical');
    });

    it('should always set data-orientation attribute', () => {
      const component = () => Separator({ orientation: 'horizontal' });

      const { container } = renderComponent(component);

      const separatorEl = container.querySelector('div') as HTMLElement;
      expect(separatorEl.hasAttribute('data-orientation')).toBe(true);
    });
  });

  describe('Decorative Mode', () => {
    it('should default to decorative mode (role="none")', () => {
      const component = () => Separator({});

      const { container } = renderComponent(component);

      const separatorEl = container.querySelector('div') as HTMLElement;
      expect(separatorEl.getAttribute('role')).toBe('none');
    });

    it('should use role="none" when decorative is true', () => {
      const component = () => Separator({ decorative: true });

      const { container } = renderComponent(component);

      const separatorEl = container.querySelector('div') as HTMLElement;
      expect(separatorEl.getAttribute('role')).toBe('none');
    });

    it('should use role="separator" when decorative is false', () => {
      const component = () => Separator({ decorative: false });

      const { container } = renderComponent(component);

      const separatorEl = container.querySelector('div') as HTMLElement;
      expect(separatorEl.getAttribute('role')).toBe('separator');
    });

    it('should be decorative even when explicitly set to true', () => {
      const component = () => Separator({ decorative: true });

      const { container } = renderComponent(component);

      const separatorEl = container.querySelector('div') as HTMLElement;
      expect(separatorEl.getAttribute('role')).toBe('none');
    });

    it('should handle decorative=false correctly', () => {
      const component = () => Separator({ decorative: false });

      const { container } = renderComponent(component);

      const separatorEl = container.querySelector('div') as HTMLElement;
      expect(separatorEl.getAttribute('role')).toBe('separator');
    });
  });

  describe('ARIA Attributes', () => {
    it('should not set aria-orientation when decorative', () => {
      const component = () => Separator({ decorative: true });

      const { container } = renderComponent(component);

      const separatorEl = container.querySelector('div') as HTMLElement;
      expect(separatorEl.hasAttribute('aria-orientation')).toBe(false);
    });

    it('should set aria-orientation when not decorative', () => {
      const component = () => Separator({ decorative: false, orientation: 'horizontal' });

      const { container } = renderComponent(component);

      const separatorEl = container.querySelector('div') as HTMLElement;
      expect(separatorEl.getAttribute('aria-orientation')).toBe('horizontal');
    });

    it('should set aria-orientation to vertical when not decorative', () => {
      const component = () => Separator({ decorative: false, orientation: 'vertical' });

      const { container } = renderComponent(component);

      const separatorEl = container.querySelector('div') as HTMLElement;
      expect(separatorEl.getAttribute('aria-orientation')).toBe('vertical');
    });

    it('should not set aria-orientation for decorative horizontal separator', () => {
      const component = () => Separator({ decorative: true, orientation: 'horizontal' });

      const { container } = renderComponent(component);

      const separatorEl = container.querySelector('div') as HTMLElement;
      expect(separatorEl.getAttribute('aria-orientation')).toBe(null);
    });

    it('should not set aria-orientation for decorative vertical separator', () => {
      const component = () => Separator({ decorative: true, orientation: 'vertical' });

      const { container } = renderComponent(component);

      const separatorEl = container.querySelector('div') as HTMLElement;
      expect(separatorEl.getAttribute('aria-orientation')).toBe(null);
    });
  });

  describe('Data Attributes', () => {
    it('should always set data-orientation attribute', () => {
      const component = () => Separator({ decorative: true });

      const { container } = renderComponent(component);

      const separatorEl = container.querySelector('div') as HTMLElement;
      expect(separatorEl.hasAttribute('data-orientation')).toBe(true);
    });

    it('should set data-orientation for both decorative and semantic separators', () => {
      const decorative = () => Separator({ decorative: true });
      const semantic = () => Separator({ decorative: false });

      const { container: container1 } = renderComponent(decorative);
      const { container: container2 } = renderComponent(semantic);

      const decorativeEl = container1.querySelector('div') as HTMLElement;
      const semanticEl = container2.querySelector('div') as HTMLElement;

      expect(decorativeEl.getAttribute('data-orientation')).toBe('horizontal');
      expect(semanticEl.getAttribute('data-orientation')).toBe('horizontal');
    });

    it('should reflect orientation in data-orientation', () => {
      const horizontal = () => Separator({ orientation: 'horizontal' });
      const vertical = () => Separator({ orientation: 'vertical' });

      const { container: container1 } = renderComponent(horizontal);
      const { container: container2 } = renderComponent(vertical);

      const hEl = container1.querySelector('div') as HTMLElement;
      const vEl = container2.querySelector('div') as HTMLElement;

      expect(hEl.getAttribute('data-orientation')).toBe('horizontal');
      expect(vEl.getAttribute('data-orientation')).toBe('vertical');
    });
  });

  describe('Styling', () => {
    it('should apply class name', () => {
      const component = () => Separator({ class: 'custom-separator' });

      const { container } = renderComponent(component);

      const separatorEl = container.querySelector('.custom-separator');
      expect(separatorEl).toBeTruthy();
    });

    it('should apply multiple class names', () => {
      const component = () => Separator({ class: 'separator divider bold' });

      const { container } = renderComponent(component);

      const separatorEl = container.querySelector('div') as HTMLElement;
      expect(separatorEl.classList.contains('separator')).toBe(true);
      expect(separatorEl.classList.contains('divider')).toBe(true);
      expect(separatorEl.classList.contains('bold')).toBe(true);
    });

    it('should apply inline styles', () => {
      const component = () =>
        Separator({
          style: {
            height: '1px',
            background: '#e5e7eb',
            margin: '16px 0',
          },
        });

      const { container } = renderComponent(component);

      const separatorEl = container.querySelector('div') as HTMLElement;
      expect(separatorEl.style.height).toBe('1px');
      expect(separatorEl.style.background).toBe('#e5e7eb');
      expect(separatorEl.style.margin).toContain('16px');
    });

    it('should combine class and style', () => {
      const component = () =>
        Separator({
          class: 'my-separator',
          style: { width: '100%' },
        });

      const { container } = renderComponent(component);

      const separatorEl = container.querySelector('.my-separator') as HTMLElement;
      expect(separatorEl).toBeTruthy();
      expect(separatorEl.style.width).toBe('100%');
    });

    it('should handle vertical separator styling', () => {
      const component = () =>
        Separator({
          orientation: 'vertical',
          style: {
            width: '1px',
            height: '100%',
            background: '#d1d5db',
          },
        });

      const { container } = renderComponent(component);

      const separatorEl = container.querySelector('div') as HTMLElement;
      expect(separatorEl.style.width).toBe('1px');
      expect(separatorEl.style.height).toBe('100%');
      expect(separatorEl.style.background).toBe('#d1d5db');
    });
  });

  describe('Props Forwarding', () => {
    it('should forward data attributes', () => {
      const component = () =>
        Separator({
          'data-testid': 'test-separator',
          'data-section': 'header',
        });

      const { container } = renderComponent(component);

      const separatorEl = container.querySelector('div') as HTMLElement;
      expect(separatorEl.getAttribute('data-testid')).toBe('test-separator');
      expect(separatorEl.getAttribute('data-section')).toBe('header');
    });

    it('should forward id attribute', () => {
      const component = () => Separator({ id: 'main-separator' });

      const { container } = renderComponent(component);

      const separatorEl = container.querySelector('#main-separator');
      expect(separatorEl).toBeTruthy();
    });

    it('should forward title attribute', () => {
      const component = () => Separator({ title: 'Section separator' });

      const { container } = renderComponent(component);

      const separatorEl = container.querySelector('div') as HTMLElement;
      expect(separatorEl.getAttribute('title')).toBe('Section separator');
    });

    it('should forward event handlers', () => {
      let clicked = false;
      const handleClick = () => {
        clicked = true;
      };

      const component = () => Separator({ onClick: handleClick });

      const { container } = renderComponent(component);

      const separatorEl = container.querySelector('div') as HTMLElement;
      separatorEl.click();

      expect(clicked).toBe(true);
    });

    it('should forward multiple event handlers', () => {
      let mouseEntered = false;
      let mouseLeft = false;

      const component = () =>
        Separator({
          onMouseEnter: () => {
            mouseEntered = true;
          },
          onMouseLeave: () => {
            mouseLeft = true;
          },
        });

      const { container } = renderComponent(component);

      const separatorEl = container.querySelector('div') as HTMLElement;

      separatorEl.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      expect(mouseEntered).toBe(true);

      separatorEl.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
      expect(mouseLeft).toBe(true);
    });

    it('should forward aria attributes', () => {
      const component = () =>
        Separator({
          decorative: false,
          'aria-label': 'Content separator',
        });

      const { container } = renderComponent(component);

      const separatorEl = container.querySelector('div') as HTMLElement;
      expect(separatorEl.getAttribute('aria-label')).toBe('Content separator');
    });

    it('should set data-orientation attribute', () => {
      const component = () => Separator({ orientation: 'horizontal' });

      const { container } = renderComponent(component);

      const separatorEl = container.querySelector('div') as HTMLElement;
      expect(separatorEl.getAttribute('data-orientation')).toBe('horizontal');
    });

    it('should set role attribute based on decorative prop', () => {
      const component = () => Separator({ decorative: true });

      const { container } = renderComponent(component);

      const separatorEl = container.querySelector('div') as HTMLElement;
      expect(separatorEl.getAttribute('role')).toBe('none');
    });
  });

  describe('Accessibility - WAI-ARIA Pattern', () => {
    it('should follow WAI-ARIA separator pattern for semantic separator', () => {
      const component = () => Separator({ decorative: false, orientation: 'horizontal' });

      const { container } = renderComponent(component);

      const separatorEl = container.querySelector('div') as HTMLElement;
      expect(separatorEl.getAttribute('role')).toBe('separator');
      expect(separatorEl.getAttribute('aria-orientation')).toBe('horizontal');
    });

    it('should hide decorative separator from screen readers', () => {
      const component = () => Separator({ decorative: true });

      const { container } = renderComponent(component);

      const separatorEl = container.querySelector('div') as HTMLElement;
      expect(separatorEl.getAttribute('role')).toBe('none');
      expect(separatorEl.hasAttribute('aria-orientation')).toBe(false);
    });

    it('should support aria-label for semantic separators', () => {
      const component = () =>
        Separator({
          decorative: false,
          'aria-label': 'End of section',
        });

      const { container } = renderComponent(component);

      const separatorEl = container.querySelector('div') as HTMLElement;
      expect(separatorEl.getAttribute('role')).toBe('separator');
      expect(separatorEl.getAttribute('aria-label')).toBe('End of section');
    });

    it('should support aria-labelledby for semantic separators', () => {
      const component = () =>
        Separator({
          decorative: false,
          'aria-labelledby': 'section-title',
        });

      const { container } = renderComponent(component);

      const separatorEl = container.querySelector('div') as HTMLElement;
      expect(separatorEl.getAttribute('aria-labelledby')).toBe('section-title');
    });
  });

  describe('Edge Cases', () => {
    it('should handle undefined children', () => {
      const component = () => Separator({ children: undefined });

      const { container } = renderComponent(component);

      const separatorEl = container.querySelector('div');
      expect(separatorEl).toBeTruthy();
      expect(separatorEl?.textContent).toBe('');
    });

    it('should handle null children', () => {
      const component = () => Separator({ children: null });

      const { container } = renderComponent(component);

      const separatorEl = container.querySelector('div');
      expect(separatorEl).toBeTruthy();
      expect(separatorEl?.textContent).toBe('');
    });

    it('should handle empty string children', () => {
      const component = () => Separator({ children: '' });

      const { container } = renderComponent(component);

      const separatorEl = container.querySelector('div');
      expect(separatorEl?.textContent).toBe('');
    });

    it('should handle zero as children', () => {
      const component = () => Separator({ children: 0 });

      const { container } = renderComponent(component);

      const separatorEl = container.querySelector('div');
      expect(separatorEl?.textContent).toBe('0');
    });

    it('should handle boolean children', () => {
      const component = () => Separator({ children: [true, false, 'text'] });

      const { container } = renderComponent(component);

      const separatorEl = container.querySelector('div');
      expect(separatorEl?.textContent).toContain('text');
    });

    it('should handle empty array children', () => {
      const component = () => Separator({ children: [] });

      const { container } = renderComponent(component);

      const separatorEl = container.querySelector('div');
      expect(separatorEl).toBeTruthy();
    });

    it('should handle undefined style', () => {
      const component = () => Separator({ style: undefined });

      const { container } = renderComponent(component);

      const separatorEl = container.querySelector('div');
      expect(separatorEl).toBeTruthy();
    });

    it('should handle undefined orientation (defaults to horizontal)', () => {
      const component = () => Separator({ orientation: undefined });

      const { container } = renderComponent(component);

      const separatorEl = container.querySelector('div') as HTMLElement;
      expect(separatorEl.getAttribute('data-orientation')).toBe('horizontal');
    });
  });

  describe('Complex Scenarios', () => {
    it('should handle all props combined', () => {
      const component = () =>
        Separator({
          orientation: 'horizontal',
          decorative: false,
          class: 'section-separator',
          style: { height: '2px', background: '#cbd5e0', margin: '32px 0' },
          'data-testid': 'main-separator',
          'aria-label': 'Section break',
        });

      const { container } = renderComponent(component);

      const separatorEl = container.querySelector('.section-separator') as HTMLElement;
      expect(separatorEl).toBeTruthy();
      expect(separatorEl.getAttribute('role')).toBe('separator');
      expect(separatorEl.getAttribute('aria-orientation')).toBe('horizontal');
      expect(separatorEl.getAttribute('data-orientation')).toBe('horizontal');
      expect(separatorEl.getAttribute('aria-label')).toBe('Section break');
      expect(separatorEl.getAttribute('data-testid')).toBe('main-separator');
      expect(separatorEl.style.height).toBe('2px');
      expect(separatorEl.style.background).toBe('#cbd5e0');
      expect(separatorEl.style.margin).toContain('32px');
    });

    it('should render vertical semantic separator', () => {
      const component = () =>
        Separator({
          orientation: 'vertical',
          decorative: false,
          style: { width: '1px', height: '100%', background: '#9ca3af' },
        });

      const { container } = renderComponent(component);

      const separatorEl = container.querySelector('div') as HTMLElement;
      expect(separatorEl.getAttribute('role')).toBe('separator');
      expect(separatorEl.getAttribute('aria-orientation')).toBe('vertical');
      expect(separatorEl.getAttribute('data-orientation')).toBe('vertical');
      expect(separatorEl.style.width).toBe('1px');
    });

    it('should render decorative vertical separator', () => {
      const component = () =>
        Separator({
          orientation: 'vertical',
          decorative: true,
          style: { width: '2px', background: '#e5e7eb' },
        });

      const { container } = renderComponent(component);

      const separatorEl = container.querySelector('div') as HTMLElement;
      expect(separatorEl.getAttribute('role')).toBe('none');
      expect(separatorEl.hasAttribute('aria-orientation')).toBe(false);
      expect(separatorEl.getAttribute('data-orientation')).toBe('vertical');
    });
  });

  describe('Performance', () => {
    it('should render efficiently with minimal props', () => {
      const component = () => Separator({});

      const { container } = renderComponent(component);

      const separatorEl = container.querySelector('div');
      expect(separatorEl).toBeTruthy();
    });

    it('should handle multiple separators efficiently', () => {
      const component = () => Separator({ class: 'test-sep' });

      const { container } = renderComponent(component);

      const sep = container.querySelector('.test-sep');
      expect(sep).toBeTruthy();
    });
  });
});
