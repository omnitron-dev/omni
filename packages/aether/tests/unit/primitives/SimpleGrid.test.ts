/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SimpleGrid } from '../../../src/primitives/SimpleGrid.js';
import { renderComponent } from '../../helpers/test-utils.js';

describe('SimpleGrid', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('Basic functionality', () => {
    it('should render with default props', () => {
      const component = () => SimpleGrid({ children: 'Content' });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl).toBeTruthy();
      expect(gridEl.textContent).toBe('Content');
      expect(gridEl.style.display).toBe('grid');
    });

    it('should render children correctly', () => {
      const component = () =>
        SimpleGrid({
          children: ['Child 1', document.createElement('div'), 'Child 2'],
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.childNodes.length).toBe(3);
    });

    it('should apply custom class', () => {
      const component = () =>
        SimpleGrid({
          class: 'custom-grid',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('.custom-grid') as HTMLElement;
      expect(gridEl).toBeTruthy();
    });

    it('should merge custom styles with grid styles', () => {
      const component = () =>
        SimpleGrid({
          style: { backgroundColor: 'red', padding: '10px' },
          columns: 3,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.display).toBe('grid');
      expect(gridEl.style.gridTemplateColumns).toBe('repeat(3, 1fr)');
      expect(gridEl.style.backgroundColor).toBe('red');
      expect(gridEl.style.padding).toBe('10px');
    });
  });

  describe('Fixed columns', () => {
    it('should apply single column by default', () => {
      const component = () => SimpleGrid({ children: 'Content' });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.gridTemplateColumns).toBe('1fr');
    });

    it('should apply 2 columns', () => {
      const component = () =>
        SimpleGrid({
          columns: 2,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.gridTemplateColumns).toBe('repeat(2, 1fr)');
    });

    it('should apply 3 columns', () => {
      const component = () =>
        SimpleGrid({
          columns: 3,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.gridTemplateColumns).toBe('repeat(3, 1fr)');
    });

    it('should apply 4 columns', () => {
      const component = () =>
        SimpleGrid({
          columns: 4,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.gridTemplateColumns).toBe('repeat(4, 1fr)');
    });

    it('should apply 5 columns', () => {
      const component = () =>
        SimpleGrid({
          columns: 5,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.gridTemplateColumns).toBe('repeat(5, 1fr)');
    });

    it('should apply 6 columns', () => {
      const component = () =>
        SimpleGrid({
          columns: 6,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.gridTemplateColumns).toBe('repeat(6, 1fr)');
    });

    it('should apply 1 column explicitly', () => {
      const component = () =>
        SimpleGrid({
          columns: 1,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.gridTemplateColumns).toBe('repeat(1, 1fr)');
    });
  });

  describe('Responsive with minChildWidth', () => {
    it('should apply numeric minChildWidth with auto-fill', () => {
      const component = () =>
        SimpleGrid({
          minChildWidth: 200,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.gridTemplateColumns).toBe('repeat(auto-fill, minmax(200px, 1fr))');
    });

    it('should apply string minChildWidth with auto-fill', () => {
      const component = () =>
        SimpleGrid({
          minChildWidth: '250px',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.gridTemplateColumns).toBe('repeat(auto-fill, minmax(250px, 1fr))');
    });

    it('should apply minChildWidth with rem units', () => {
      const component = () =>
        SimpleGrid({
          minChildWidth: '20rem',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.gridTemplateColumns).toBe('repeat(auto-fill, minmax(20rem, 1fr))');
    });

    it('should apply small minChildWidth', () => {
      const component = () =>
        SimpleGrid({
          minChildWidth: 100,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.gridTemplateColumns).toBe('repeat(auto-fill, minmax(100px, 1fr))');
    });

    it('should apply large minChildWidth', () => {
      const component = () =>
        SimpleGrid({
          minChildWidth: 400,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.gridTemplateColumns).toBe('repeat(auto-fill, minmax(400px, 1fr))');
    });
  });

  describe('Behavior: auto-fit vs auto-fill', () => {
    it('should use auto-fill by default', () => {
      const component = () =>
        SimpleGrid({
          minChildWidth: 200,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.gridTemplateColumns).toContain('auto-fill');
    });

    it('should apply auto-fill behavior explicitly', () => {
      const component = () =>
        SimpleGrid({
          minChildWidth: 200,
          behavior: 'fill',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.gridTemplateColumns).toBe('repeat(auto-fill, minmax(200px, 1fr))');
    });

    it('should apply auto-fit behavior', () => {
      const component = () =>
        SimpleGrid({
          minChildWidth: 200,
          behavior: 'fit',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.gridTemplateColumns).toBe('repeat(auto-fit, minmax(200px, 1fr))');
    });

    it('should apply auto-fit with string minChildWidth', () => {
      const component = () =>
        SimpleGrid({
          minChildWidth: '250px',
          behavior: 'fit',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.gridTemplateColumns).toBe('repeat(auto-fit, minmax(250px, 1fr))');
    });
  });

  describe('minChildWidth takes precedence over columns', () => {
    it('should use minChildWidth when both columns and minChildWidth are provided', () => {
      const component = () =>
        SimpleGrid({
          columns: 3,
          minChildWidth: 200,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      // minChildWidth takes precedence
      expect(gridEl.style.gridTemplateColumns).toBe('repeat(auto-fill, minmax(200px, 1fr))');
    });

    it('should use minChildWidth and ignore columns', () => {
      const component = () =>
        SimpleGrid({
          columns: 4,
          minChildWidth: 300,
          behavior: 'fit',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      // minChildWidth with behavior takes precedence over columns
      expect(gridEl.style.gridTemplateColumns).toBe('repeat(auto-fit, minmax(300px, 1fr))');
    });

    it('should use columns only when minChildWidth is not provided', () => {
      const component = () =>
        SimpleGrid({
          columns: 3,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.gridTemplateColumns).toBe('repeat(3, 1fr)');
    });
  });

  describe('Spacing - uniform gap', () => {
    it('should apply numeric spacing as pixels', () => {
      const component = () =>
        SimpleGrid({
          spacing: 16,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.columnGap).toBe('16px');
      expect(gridEl.style.rowGap).toBe('16px');
    });

    it('should apply string spacing directly', () => {
      const component = () =>
        SimpleGrid({
          spacing: '1rem',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.columnGap).toBe('1rem');
      expect(gridEl.style.rowGap).toBe('1rem');
    });

    it('should apply zero spacing', () => {
      const component = () =>
        SimpleGrid({
          spacing: 0,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.columnGap).toBe('0px');
      expect(gridEl.style.rowGap).toBe('0px');
    });

    it('should apply large spacing', () => {
      const component = () =>
        SimpleGrid({
          spacing: 48,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.columnGap).toBe('48px');
      expect(gridEl.style.rowGap).toBe('48px');
    });

    it('should apply spacing with em units', () => {
      const component = () =>
        SimpleGrid({
          spacing: '2em',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.columnGap).toBe('2em');
      expect(gridEl.style.rowGap).toBe('2em');
    });
  });

  describe('Spacing - separate X and Y', () => {
    it('should apply numeric spacingX as pixels', () => {
      const component = () =>
        SimpleGrid({
          spacingX: 24,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.columnGap).toBe('24px');
    });

    it('should apply string spacingX directly', () => {
      const component = () =>
        SimpleGrid({
          spacingX: '2rem',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.columnGap).toBe('2rem');
    });

    it('should apply numeric spacingY as pixels', () => {
      const component = () =>
        SimpleGrid({
          spacingY: 16,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.rowGap).toBe('16px');
    });

    it('should apply string spacingY directly', () => {
      const component = () =>
        SimpleGrid({
          spacingY: '1.5rem',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.rowGap).toBe('1.5rem');
    });

    it('should apply both spacingX and spacingY', () => {
      const component = () =>
        SimpleGrid({
          spacingX: 24,
          spacingY: 16,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.columnGap).toBe('24px');
      expect(gridEl.style.rowGap).toBe('16px');
    });

    it('should apply mixed numeric and string spacing', () => {
      const component = () =>
        SimpleGrid({
          spacingX: 20,
          spacingY: '2rem',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.columnGap).toBe('20px');
      expect(gridEl.style.rowGap).toBe('2rem');
    });
  });

  describe('Spacing precedence', () => {
    it('should use spacingX over spacing for column gap', () => {
      const component = () =>
        SimpleGrid({
          spacing: 16,
          spacingX: 24,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.columnGap).toBe('24px');
      expect(gridEl.style.rowGap).toBe('16px');
    });

    it('should use spacingY over spacing for row gap', () => {
      const component = () =>
        SimpleGrid({
          spacing: 16,
          spacingY: 32,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.columnGap).toBe('16px');
      expect(gridEl.style.rowGap).toBe('32px');
    });

    it('should use both spacingX and spacingY over spacing', () => {
      const component = () =>
        SimpleGrid({
          spacing: 16,
          spacingX: 24,
          spacingY: 8,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.columnGap).toBe('24px');
      expect(gridEl.style.rowGap).toBe('8px');
    });
  });

  describe('No spacing', () => {
    it('should not apply spacing when no spacing props provided', () => {
      const component = () => SimpleGrid({ children: 'Content' });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.columnGap).toBe('');
      expect(gridEl.style.rowGap).toBe('');
    });

    it('should apply zero spacing explicitly', () => {
      const component = () =>
        SimpleGrid({
          spacing: 0,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.columnGap).toBe('0px');
      expect(gridEl.style.rowGap).toBe('0px');
    });
  });

  describe('Complex layouts', () => {
    it('should create fixed 3-column grid with spacing', () => {
      const component = () =>
        SimpleGrid({
          columns: 3,
          spacing: 16,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.display).toBe('grid');
      expect(gridEl.style.gridTemplateColumns).toBe('repeat(3, 1fr)');
      expect(gridEl.style.columnGap).toBe('16px');
      expect(gridEl.style.rowGap).toBe('16px');
    });

    it('should create responsive grid with auto-fit', () => {
      const component = () =>
        SimpleGrid({
          minChildWidth: 200,
          behavior: 'fit',
          spacing: 20,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.gridTemplateColumns).toBe('repeat(auto-fit, minmax(200px, 1fr))');
      expect(gridEl.style.columnGap).toBe('20px');
      expect(gridEl.style.rowGap).toBe('20px');
    });

    it('should create grid with different X/Y spacing', () => {
      const component = () =>
        SimpleGrid({
          columns: 4,
          spacingX: 24,
          spacingY: 16,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.gridTemplateColumns).toBe('repeat(4, 1fr)');
      expect(gridEl.style.columnGap).toBe('24px');
      expect(gridEl.style.rowGap).toBe('16px');
    });

    it('should create responsive grid with string units', () => {
      const component = () =>
        SimpleGrid({
          minChildWidth: '15rem',
          spacing: '1.5rem',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.gridTemplateColumns).toBe('repeat(auto-fill, minmax(15rem, 1fr))');
      expect(gridEl.style.columnGap).toBe('1.5rem');
      expect(gridEl.style.rowGap).toBe('1.5rem');
    });
  });

  describe('Additional props', () => {
    it('should pass through additional HTML attributes', () => {
      const component = () =>
        SimpleGrid({
          id: 'simple-grid',
          'data-testid': 'grid',
          'aria-label': 'Simple grid layout',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.id).toBe('simple-grid');
      expect(gridEl.getAttribute('data-testid')).toBe('grid');
      expect(gridEl.getAttribute('aria-label')).toBe('Simple grid layout');
    });

    it('should support event handlers', () => {
      let clicked = false;
      const handleClick = () => {
        clicked = true;
      };

      const component = () =>
        SimpleGrid({
          onClick: handleClick,
          children: 'Click me',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      gridEl.click();

      expect(clicked).toBe(true);
    });

    it('should support title attribute', () => {
      const component = () =>
        SimpleGrid({
          title: 'This is a simple grid',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.title).toBe('This is a simple grid');
    });
  });

  describe('Accessibility', () => {
    it('should support ARIA attributes', () => {
      const component = () =>
        SimpleGrid({
          role: 'list',
          'aria-label': 'Product grid',
          children: 'Products',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.getAttribute('role')).toBe('list');
      expect(gridEl.getAttribute('aria-label')).toBe('Product grid');
    });

    it('should not add SimpleGrid-specific ARIA attributes automatically', () => {
      const component = () => SimpleGrid({ children: 'Content' });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.getAttribute('role')).toBeNull();
      expect(gridEl.getAttribute('aria-label')).toBeNull();
    });

    it('should support aria-labelledby', () => {
      const component = () =>
        SimpleGrid({
          'aria-labelledby': 'grid-heading',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.getAttribute('aria-labelledby')).toBe('grid-heading');
    });
  });

  describe('Edge cases', () => {
    it('should handle null children', () => {
      const component = () => SimpleGrid({ children: null });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl).toBeTruthy();
      expect(gridEl.childNodes.length).toBe(0);
    });

    it('should handle undefined children', () => {
      const component = () => SimpleGrid({ children: undefined });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl).toBeTruthy();
      expect(gridEl.childNodes.length).toBe(0);
    });

    it('should handle empty string children', () => {
      const component = () => SimpleGrid({ children: '' });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl).toBeTruthy();
      expect(gridEl.textContent).toBe('');
    });

    it('should handle single child', () => {
      const component = () => SimpleGrid({ children: 'Single child' });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.textContent).toBe('Single child');
    });

    it('should handle very small minChildWidth', () => {
      const component = () =>
        SimpleGrid({
          minChildWidth: 50,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.gridTemplateColumns).toBe('repeat(auto-fill, minmax(50px, 1fr))');
    });

    it('should handle very large minChildWidth', () => {
      const component = () =>
        SimpleGrid({
          minChildWidth: 1000,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.gridTemplateColumns).toBe('repeat(auto-fill, minmax(1000px, 1fr))');
    });

    it('should handle large column count', () => {
      const component = () =>
        SimpleGrid({
          columns: 12,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.gridTemplateColumns).toBe('repeat(12, 1fr)');
    });
  });

  describe('Performance', () => {
    it('should not apply spacing styles when no spacing props provided', () => {
      const component = () => SimpleGrid({ children: 'Content' });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.columnGap).toBe('');
      expect(gridEl.style.rowGap).toBe('');
    });

    it('should only apply provided style properties', () => {
      const component = () =>
        SimpleGrid({
          columns: 3,
          spacing: 16,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.gridTemplateColumns).toBe('repeat(3, 1fr)');
      expect(gridEl.style.columnGap).toBe('16px');
      expect(gridEl.style.rowGap).toBe('16px');
    });
  });

  describe('Style combinations', () => {
    it('should combine all props correctly', () => {
      const component = () =>
        SimpleGrid({
          minChildWidth: 200,
          behavior: 'fit',
          spacingX: 24,
          spacingY: 16,
          style: { backgroundColor: 'lightgray', padding: '20px' },
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.display).toBe('grid');
      expect(gridEl.style.gridTemplateColumns).toBe('repeat(auto-fit, minmax(200px, 1fr))');
      expect(gridEl.style.columnGap).toBe('24px');
      expect(gridEl.style.rowGap).toBe('16px');
      expect(gridEl.style.backgroundColor).toBe('lightgray');
      expect(gridEl.style.padding).toBe('20px');
    });

    it('should merge styles without conflicts', () => {
      const component = () =>
        SimpleGrid({
          columns: 4,
          spacing: 20,
          style: { border: '1px solid blue', borderRadius: '8px' },
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.gridTemplateColumns).toBe('repeat(4, 1fr)');
      expect(gridEl.style.columnGap).toBe('20px');
      expect(gridEl.style.rowGap).toBe('20px');
      expect(gridEl.style.border).toBe('1px solid blue');
      expect(gridEl.style.borderRadius).toBe('8px');
    });
  });
});
