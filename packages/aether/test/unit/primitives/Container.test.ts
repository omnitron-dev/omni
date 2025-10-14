/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Container } from '../../../src/primitives/Container.js';
import { renderComponent } from '../../helpers/test-utils.js';

describe('Container', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('Basic Rendering', () => {
    it('should render as a div by default', () => {
      const component = () => Container({ children: 'Container content' });

      const { container } = renderComponent(component);

      const containerEl = container.querySelector('div');
      expect(containerEl).toBeTruthy();
      expect(containerEl?.textContent).toBe('Container content');
    });

    it('should render with no children', () => {
      const component = () => Container({});

      const { container } = renderComponent(component);

      const containerEl = container.querySelector('div');
      expect(containerEl).toBeTruthy();
      expect(containerEl?.textContent).toBe('');
    });

    it('should render with multiple children', () => {
      const component = () =>
        Container({
          children: ['Child 1', 'Child 2', 'Child 3'],
        });

      const { container } = renderComponent(component);

      const containerEl = container.querySelector('div');
      expect(containerEl?.textContent).toContain('Child 1');
      expect(containerEl?.textContent).toContain('Child 2');
      expect(containerEl?.textContent).toContain('Child 3');
    });

    it('should render with string children', () => {
      const component = () => Container({ children: 'Hello World' });

      const { container } = renderComponent(component);

      const containerEl = container.querySelector('div');
      expect(containerEl?.textContent).toBe('Hello World');
    });

    it('should render with number children', () => {
      const component = () => Container({ children: 42 });

      const { container } = renderComponent(component);

      const containerEl = container.querySelector('div');
      expect(containerEl?.textContent).toBe('42');
    });
  });

  describe('Size Variants', () => {
    it('should default to lg size (1024px)', () => {
      const component = () => Container({ children: 'Content' });

      const { container } = renderComponent(component);

      const containerEl = container.querySelector('div') as HTMLElement;
      expect(containerEl.style.maxWidth).toBe('1024px');
    });

    it('should apply xs size (480px)', () => {
      const component = () => Container({ size: 'xs', children: 'Content' });

      const { container } = renderComponent(component);

      const containerEl = container.querySelector('div') as HTMLElement;
      expect(containerEl.style.maxWidth).toBe('480px');
    });

    it('should apply sm size (640px)', () => {
      const component = () => Container({ size: 'sm', children: 'Content' });

      const { container } = renderComponent(component);

      const containerEl = container.querySelector('div') as HTMLElement;
      expect(containerEl.style.maxWidth).toBe('640px');
    });

    it('should apply md size (768px)', () => {
      const component = () => Container({ size: 'md', children: 'Content' });

      const { container } = renderComponent(component);

      const containerEl = container.querySelector('div') as HTMLElement;
      expect(containerEl.style.maxWidth).toBe('768px');
    });

    it('should apply lg size (1024px)', () => {
      const component = () => Container({ size: 'lg', children: 'Content' });

      const { container } = renderComponent(component);

      const containerEl = container.querySelector('div') as HTMLElement;
      expect(containerEl.style.maxWidth).toBe('1024px');
    });

    it('should apply xl size (1280px)', () => {
      const component = () => Container({ size: 'xl', children: 'Content' });

      const { container } = renderComponent(component);

      const containerEl = container.querySelector('div') as HTMLElement;
      expect(containerEl.style.maxWidth).toBe('1280px');
    });

    it('should apply 2xl size (1536px)', () => {
      const component = () => Container({ size: '2xl', children: 'Content' });

      const { container } = renderComponent(component);

      const containerEl = container.querySelector('div') as HTMLElement;
      expect(containerEl.style.maxWidth).toBe('1536px');
    });

    it('should apply full size (100%)', () => {
      const component = () => Container({ size: 'full', children: 'Content' });

      const { container } = renderComponent(component);

      const containerEl = container.querySelector('div') as HTMLElement;
      expect(containerEl.style.maxWidth).toBe('100%');
    });
  });

  describe('Fluid Mode', () => {
    it('should apply full width when fluid is true', () => {
      const component = () => Container({ fluid: true, children: 'Content' });

      const { container } = renderComponent(component);

      const containerEl = container.querySelector('div') as HTMLElement;
      expect(containerEl.style.maxWidth).toBe('100%');
    });

    it('should override size when fluid is true', () => {
      const component = () => Container({ size: 'sm', fluid: true, children: 'Content' });

      const { container } = renderComponent(component);

      const containerEl = container.querySelector('div') as HTMLElement;
      expect(containerEl.style.maxWidth).toBe('100%');
    });

    it('should respect size when fluid is false', () => {
      const component = () => Container({ size: 'md', fluid: false, children: 'Content' });

      const { container } = renderComponent(component);

      const containerEl = container.querySelector('div') as HTMLElement;
      expect(containerEl.style.maxWidth).toBe('768px');
    });

    it('should default to non-fluid mode', () => {
      const component = () => Container({ size: 'lg', children: 'Content' });

      const { container } = renderComponent(component);

      const containerEl = container.querySelector('div') as HTMLElement;
      expect(containerEl.style.maxWidth).toBe('1024px');
      expect(containerEl.style.maxWidth).not.toBe('100%');
    });
  });

  describe('Center Content', () => {
    it('should center content by default', () => {
      const component = () => Container({ children: 'Content' });

      const { container } = renderComponent(component);

      const containerEl = container.querySelector('div') as HTMLElement;
      expect(containerEl.style.margin).toContain('auto');
    });

    it('should center content when centerContent is true', () => {
      const component = () => Container({ centerContent: true, children: 'Content' });

      const { container } = renderComponent(component);

      const containerEl = container.querySelector('div') as HTMLElement;
      expect(containerEl.style.margin).toContain('auto');
    });

    it('should not center content when centerContent is false', () => {
      const component = () => Container({ centerContent: false, children: 'Content' });

      const { container } = renderComponent(component);

      const containerEl = container.querySelector('div') as HTMLElement;
      expect(containerEl.style.margin).toBe('');
    });
  });

  describe('Horizontal Padding (px)', () => {
    it('should apply default horizontal padding (16px)', () => {
      const component = () => Container({ children: 'Content' });

      const { container } = renderComponent(component);

      const containerEl = container.querySelector('div') as HTMLElement;
      expect(containerEl.style.paddingLeft).toBe('16px');
      expect(containerEl.style.paddingRight).toBe('16px');
    });

    it('should apply custom horizontal padding as number (24px)', () => {
      const component = () => Container({ px: 24, children: 'Content' });

      const { container } = renderComponent(component);

      const containerEl = container.querySelector('div') as HTMLElement;
      expect(containerEl.style.paddingLeft).toBe('24px');
      expect(containerEl.style.paddingRight).toBe('24px');
    });

    it('should apply horizontal padding as string (2rem)', () => {
      const component = () => Container({ px: '2rem', children: 'Content' });

      const { container } = renderComponent(component);

      const containerEl = container.querySelector('div') as HTMLElement;
      expect(containerEl.style.paddingLeft).toBe('2rem');
      expect(containerEl.style.paddingRight).toBe('2rem');
    });

    it('should apply zero horizontal padding', () => {
      const component = () => Container({ px: 0, children: 'Content' });

      const { container } = renderComponent(component);

      const containerEl = container.querySelector('div') as HTMLElement;
      expect(containerEl.style.paddingLeft).toBe('0px');
      expect(containerEl.style.paddingRight).toBe('0px');
    });

    it('should handle large horizontal padding values', () => {
      const component = () => Container({ px: 100, children: 'Content' });

      const { container } = renderComponent(component);

      const containerEl = container.querySelector('div') as HTMLElement;
      expect(containerEl.style.paddingLeft).toBe('100px');
      expect(containerEl.style.paddingRight).toBe('100px');
    });

    it('should handle percentage-based horizontal padding', () => {
      const component = () => Container({ px: '5%', children: 'Content' });

      const { container } = renderComponent(component);

      const containerEl = container.querySelector('div') as HTMLElement;
      expect(containerEl.style.paddingLeft).toBe('5%');
      expect(containerEl.style.paddingRight).toBe('5%');
    });
  });

  describe('Vertical Padding (py)', () => {
    it('should not apply vertical padding by default', () => {
      const component = () => Container({ children: 'Content' });

      const { container } = renderComponent(component);

      const containerEl = container.querySelector('div') as HTMLElement;
      expect(containerEl.style.paddingTop).toBe('');
      expect(containerEl.style.paddingBottom).toBe('');
    });

    it('should apply vertical padding as number (32px)', () => {
      const component = () => Container({ py: 32, children: 'Content' });

      const { container } = renderComponent(component);

      const containerEl = container.querySelector('div') as HTMLElement;
      expect(containerEl.style.paddingTop).toBe('32px');
      expect(containerEl.style.paddingBottom).toBe('32px');
    });

    it('should apply vertical padding as string (4rem)', () => {
      const component = () => Container({ py: '4rem', children: 'Content' });

      const { container } = renderComponent(component);

      const containerEl = container.querySelector('div') as HTMLElement;
      expect(containerEl.style.paddingTop).toBe('4rem');
      expect(containerEl.style.paddingBottom).toBe('4rem');
    });

    it('should apply zero vertical padding', () => {
      const component = () => Container({ py: 0, children: 'Content' });

      const { container } = renderComponent(component);

      const containerEl = container.querySelector('div') as HTMLElement;
      expect(containerEl.style.paddingTop).toBe('0px');
      expect(containerEl.style.paddingBottom).toBe('0px');
    });

    it('should combine horizontal and vertical padding', () => {
      const component = () => Container({ px: 24, py: 48, children: 'Content' });

      const { container } = renderComponent(component);

      const containerEl = container.querySelector('div') as HTMLElement;
      expect(containerEl.style.paddingLeft).toBe('24px');
      expect(containerEl.style.paddingRight).toBe('24px');
      expect(containerEl.style.paddingTop).toBe('48px');
      expect(containerEl.style.paddingBottom).toBe('48px');
    });
  });

  describe('Width Behavior', () => {
    it('should always set width to 100%', () => {
      const component = () => Container({ children: 'Content' });

      const { container } = renderComponent(component);

      const containerEl = container.querySelector('div') as HTMLElement;
      expect(containerEl.style.width).toBe('100%');
    });

    it('should set width to 100% even with custom size', () => {
      const component = () => Container({ size: 'sm', children: 'Content' });

      const { container } = renderComponent(component);

      const containerEl = container.querySelector('div') as HTMLElement;
      expect(containerEl.style.width).toBe('100%');
    });

    it('should set width to 100% in fluid mode', () => {
      const component = () => Container({ fluid: true, children: 'Content' });

      const { container } = renderComponent(component);

      const containerEl = container.querySelector('div') as HTMLElement;
      expect(containerEl.style.width).toBe('100%');
    });
  });

  describe('Styling', () => {
    it('should apply class name', () => {
      const component = () =>
        Container({
          class: 'custom-container',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const containerEl = container.querySelector('.custom-container');
      expect(containerEl).toBeTruthy();
    });

    it('should apply multiple class names', () => {
      const component = () =>
        Container({
          class: 'container page-wrapper shadow',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const containerEl = container.querySelector('div') as HTMLElement;
      expect(containerEl.classList.contains('container')).toBe(true);
      expect(containerEl.classList.contains('page-wrapper')).toBe(true);
      expect(containerEl.classList.contains('shadow')).toBe(true);
    });

    it('should merge inline styles with container styles', () => {
      const component = () =>
        Container({
          style: { background: '#f0f0f0', border: '1px solid #ccc' },
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const containerEl = container.querySelector('div') as HTMLElement;
      expect(containerEl.style.background).toBe('#f0f0f0');
      expect(containerEl.style.border).toBe('1px solid #ccc');
      expect(containerEl.style.maxWidth).toBe('1024px'); // Default size still applied
    });

    it('should override container styles with inline styles', () => {
      const component = () =>
        Container({
          size: 'lg',
          style: { maxWidth: '500px' },
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const containerEl = container.querySelector('div') as HTMLElement;
      // Inline styles override computed styles
      expect(containerEl.style.maxWidth).toBe('500px');
    });

    it('should combine class and style', () => {
      const component = () =>
        Container({
          class: 'custom',
          style: { padding: '20px' },
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const containerEl = container.querySelector('.custom') as HTMLElement;
      expect(containerEl).toBeTruthy();
      expect(containerEl.style.padding).toBe('20px');
    });
  });

  describe('Props Forwarding', () => {
    it('should forward data attributes', () => {
      const component = () =>
        Container({
          'data-testid': 'main-container',
          'data-section': 'hero',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const containerEl = container.querySelector('div') as HTMLElement;
      expect(containerEl.getAttribute('data-testid')).toBe('main-container');
      expect(containerEl.getAttribute('data-section')).toBe('hero');
    });

    it('should forward id attribute', () => {
      const component = () =>
        Container({
          id: 'page-container',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const containerEl = container.querySelector('#page-container');
      expect(containerEl).toBeTruthy();
    });

    it('should forward aria attributes', () => {
      const component = () =>
        Container({
          role: 'main',
          'aria-label': 'Main content area',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const containerEl = container.querySelector('div') as HTMLElement;
      expect(containerEl.getAttribute('role')).toBe('main');
      expect(containerEl.getAttribute('aria-label')).toBe('Main content area');
    });

    it('should forward event handlers', () => {
      let clicked = false;
      const handleClick = () => {
        clicked = true;
      };

      const component = () =>
        Container({
          onClick: handleClick,
          children: 'Clickable container',
        });

      const { container } = renderComponent(component);

      const containerEl = container.querySelector('div') as HTMLElement;
      containerEl.click();

      expect(clicked).toBe(true);
    });

    it('should not forward internal props to DOM', () => {
      const component = () =>
        Container({
          size: 'lg',
          centerContent: true,
          fluid: false,
          px: 24,
          py: 32,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const containerEl = container.querySelector('div') as HTMLElement;
      expect(containerEl.hasAttribute('size')).toBe(false);
      expect(containerEl.hasAttribute('centerContent')).toBe(false);
      expect(containerEl.hasAttribute('fluid')).toBe(false);
      expect(containerEl.hasAttribute('px')).toBe(false);
      expect(containerEl.hasAttribute('py')).toBe(false);
    });
  });

  describe('Accessibility', () => {
    it('should support semantic role attributes', () => {
      const component = () =>
        Container({
          role: 'region',
          'aria-label': 'Content region',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const containerEl = container.querySelector('[role="region"]') as HTMLElement;
      expect(containerEl).toBeTruthy();
      expect(containerEl.getAttribute('aria-label')).toBe('Content region');
    });

    it('should support aria-labelledby', () => {
      const component = () =>
        Container({
          'aria-labelledby': 'section-title',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const containerEl = container.querySelector('div') as HTMLElement;
      expect(containerEl.getAttribute('aria-labelledby')).toBe('section-title');
    });

    it('should support tabindex for keyboard navigation', () => {
      const component = () =>
        Container({
          tabindex: '0',
          children: 'Focusable container',
        });

      const { container } = renderComponent(component);

      const containerEl = container.querySelector('div') as HTMLElement;
      expect(containerEl.getAttribute('tabindex')).toBe('0');
    });
  });

  describe('Edge Cases', () => {
    it('should handle undefined children', () => {
      const component = () => Container({ children: undefined });

      const { container } = renderComponent(component);

      const containerEl = container.querySelector('div');
      expect(containerEl).toBeTruthy();
    });

    it('should handle null children', () => {
      const component = () => Container({ children: null });

      const { container } = renderComponent(component);

      const containerEl = container.querySelector('div');
      expect(containerEl).toBeTruthy();
    });

    it('should handle empty string children', () => {
      const component = () => Container({ children: '' });

      const { container } = renderComponent(component);

      const containerEl = container.querySelector('div');
      expect(containerEl?.textContent).toBe('');
    });

    it('should handle zero as children', () => {
      const component = () => Container({ children: 0 });

      const { container } = renderComponent(component);

      const containerEl = container.querySelector('div');
      expect(containerEl?.textContent).toBe('0');
    });

    it('should handle boolean children', () => {
      const component = () => Container({ children: [true, false, 'text'] });

      const { container } = renderComponent(component);

      const containerEl = container.querySelector('div');
      expect(containerEl?.textContent).toContain('text');
    });

    it('should handle empty array children', () => {
      const component = () => Container({ children: [] });

      const { container } = renderComponent(component);

      const containerEl = container.querySelector('div');
      expect(containerEl).toBeTruthy();
    });

    it('should handle special characters in content', () => {
      const component = () => Container({ children: '<div>HTML</div>' });

      const { container } = renderComponent(component);

      const containerEl = container.querySelector('div');
      expect(containerEl?.textContent).toBe('<div>HTML</div>');
    });
  });

  describe('Complex Scenarios', () => {
    it('should handle all props combined', () => {
      const component = () =>
        Container({
          size: 'xl',
          centerContent: true,
          fluid: false,
          px: 32,
          py: 64,
          class: 'hero-section',
          style: { background: '#f9fafb' },
          'data-testid': 'hero',
          children: 'Hero content',
        });

      const { container } = renderComponent(component);

      const containerEl = container.querySelector('.hero-section') as HTMLElement;
      expect(containerEl).toBeTruthy();
      expect(containerEl.style.maxWidth).toBe('1280px');
      expect(containerEl.style.margin).toContain('auto');
      expect(containerEl.style.paddingLeft).toBe('32px');
      expect(containerEl.style.paddingRight).toBe('32px');
      expect(containerEl.style.paddingTop).toBe('64px');
      expect(containerEl.style.paddingBottom).toBe('64px');
      expect(containerEl.style.background).toBe('#f9fafb');
      expect(containerEl.getAttribute('data-testid')).toBe('hero');
    });

    it('should work in nested container scenarios', () => {
      const component = () =>
        Container({
          size: '2xl',
          children: Container({
            size: 'md',
            class: 'inner',
            children: 'Nested content',
          }),
        });

      const { container } = renderComponent(component);

      const outerEl = container.querySelector('div') as HTMLElement;
      const innerEl = container.querySelector('.inner') as HTMLElement;

      expect(outerEl.style.maxWidth).toBe('1536px');
      expect(innerEl.style.maxWidth).toBe('768px');
      expect(innerEl.textContent).toBe('Nested content');
    });

    it('should handle dynamic children array', () => {
      const items = ['Item 1', 'Item 2', 'Item 3'];
      const component = () =>
        Container({
          children: items.map((item) => item),
        });

      const { container } = renderComponent(component);

      const containerEl = container.querySelector('div');
      expect(containerEl?.textContent).toContain('Item 1');
      expect(containerEl?.textContent).toContain('Item 2');
      expect(containerEl?.textContent).toContain('Item 3');
    });
  });

  describe('Performance', () => {
    it('should handle large content efficiently', () => {
      const largeContent = Array.from({ length: 100 }, (_, i) => `Item ${i}`).join(' ');

      const component = () => Container({ children: largeContent });

      const { container } = renderComponent(component);

      const containerEl = container.querySelector('div');
      expect(containerEl?.textContent).toContain('Item 0');
      expect(containerEl?.textContent).toContain('Item 99');
    });

    it('should render quickly with minimal props', () => {
      const component = () => Container({ children: 'Fast render' });

      const { container } = renderComponent(component);

      const containerEl = container.querySelector('div');
      expect(containerEl).toBeTruthy();
      expect(containerEl?.textContent).toBe('Fast render');
    });
  });
});
