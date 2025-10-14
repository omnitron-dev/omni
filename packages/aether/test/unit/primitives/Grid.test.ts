/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Grid, GridItem } from '../../../src/primitives/Grid.js';
import { renderComponent } from '../../helpers/test-utils.js';

describe('Grid', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('Basic functionality', () => {
    it('should render with default props', () => {
      const component = () => Grid({ children: 'Content' });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl).toBeTruthy();
      expect(gridEl.textContent).toBe('Content');
      expect(gridEl.style.display).toBe('grid');
    });

    it('should render children correctly', () => {
      const component = () =>
        Grid({
          children: ['Child 1', document.createElement('div'), 'Child 2'],
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.childNodes.length).toBe(3);
    });

    it('should apply custom class', () => {
      const component = () =>
        Grid({
          class: 'custom-grid',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('.custom-grid') as HTMLElement;
      expect(gridEl).toBeTruthy();
    });

    it('should merge custom styles with grid styles', () => {
      const component = () =>
        Grid({
          style: { backgroundColor: 'red', padding: '10px' },
          gap: 16,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.display).toBe('grid');
      expect(gridEl.style.gap).toBe('16px');
      expect(gridEl.style.backgroundColor).toBe('red');
      expect(gridEl.style.padding).toBe('10px');
    });
  });

  describe('Element rendering', () => {
    it('should render as div by default', () => {
      const component = () => Grid({ children: 'Content' });

      const { container } = renderComponent(component);

      const gridEl = container.firstElementChild as HTMLElement;
      expect(gridEl.tagName).toBe('DIV');
    });

    it('should render as custom element when as prop is provided', () => {
      const component = () => Grid({ as: 'section', children: 'Content' });

      const { container } = renderComponent(component);

      const gridEl = container.firstElementChild as HTMLElement;
      expect(gridEl.tagName).toBe('SECTION');
    });

    it('should support semantic HTML elements', () => {
      const elements = ['main', 'article', 'aside', 'section'];

      elements.forEach((tag) => {
        const component = () => Grid({ as: tag, children: 'Content' });
        const { container, cleanup } = renderComponent(component);

        const gridEl = container.firstElementChild as HTMLElement;
        expect(gridEl.tagName).toBe(tag.toUpperCase());

        cleanup();
      });
    });
  });

  describe('Template columns', () => {
    it('should apply template columns with repeat notation', () => {
      const component = () =>
        Grid({
          templateColumns: 'repeat(3, 1fr)',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.gridTemplateColumns).toBe('repeat(3, 1fr)');
    });

    it('should apply template columns with explicit values', () => {
      const component = () =>
        Grid({
          templateColumns: '200px 1fr 2fr',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.gridTemplateColumns).toBe('200px 1fr 2fr');
    });

    it('should apply responsive template columns with auto-fit', () => {
      const component = () =>
        Grid({
          templateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.gridTemplateColumns).toBe('repeat(auto-fit, minmax(200px, 1fr))');
    });

    it('should apply responsive template columns with auto-fill', () => {
      const component = () =>
        Grid({
          templateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.gridTemplateColumns).toBe('repeat(auto-fill, minmax(150px, 1fr))');
    });
  });

  describe('Template rows', () => {
    it('should apply template rows with repeat notation', () => {
      const component = () =>
        Grid({
          templateRows: 'repeat(3, 100px)',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.gridTemplateRows).toBe('repeat(3, 100px)');
    });

    it('should apply template rows with explicit values', () => {
      const component = () =>
        Grid({
          templateRows: 'auto 1fr auto',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.gridTemplateRows).toBe('auto 1fr auto');
    });

    it('should apply both template columns and rows', () => {
      const component = () =>
        Grid({
          templateColumns: 'repeat(3, 1fr)',
          templateRows: 'repeat(2, 150px)',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.gridTemplateColumns).toBe('repeat(3, 1fr)');
      expect(gridEl.style.gridTemplateRows).toBe('repeat(2, 150px)');
    });
  });

  describe('Template areas', () => {
    it('should apply template areas', () => {
      const component = () =>
        Grid({
          templateAreas: `
            "header header"
            "sidebar main"
            "footer footer"
          `,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.gridTemplateAreas).toContain('header');
    });

    it('should apply template areas with columns and rows', () => {
      const component = () =>
        Grid({
          templateAreas: '"header header" "sidebar main"',
          templateColumns: '200px 1fr',
          templateRows: 'auto 1fr',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.gridTemplateAreas).toContain('header');
      expect(gridEl.style.gridTemplateColumns).toBe('200px 1fr');
      expect(gridEl.style.gridTemplateRows).toBe('auto 1fr');
    });
  });

  describe('Auto flow', () => {
    it('should apply row auto flow', () => {
      const component = () =>
        Grid({
          autoFlow: 'row',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.gridAutoFlow).toBe('row');
    });

    it('should apply column auto flow', () => {
      const component = () =>
        Grid({
          autoFlow: 'column',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.gridAutoFlow).toBe('column');
    });

    it('should apply dense auto flow', () => {
      const component = () =>
        Grid({
          autoFlow: 'dense',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.gridAutoFlow).toBe('dense');
    });

    it('should apply row dense auto flow', () => {
      const component = () =>
        Grid({
          autoFlow: 'row dense',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.gridAutoFlow).toBe('row dense');
    });

    it('should apply column dense auto flow', () => {
      const component = () =>
        Grid({
          autoFlow: 'column dense',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.gridAutoFlow).toBe('column dense');
    });
  });

  describe('Auto columns and rows', () => {
    it('should apply auto columns', () => {
      const component = () =>
        Grid({
          autoColumns: 'minmax(100px, 1fr)',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.gridAutoColumns).toBe('minmax(100px, 1fr)');
    });

    it('should apply auto rows', () => {
      const component = () =>
        Grid({
          autoRows: 'minmax(50px, auto)',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.gridAutoRows).toBe('minmax(50px, auto)');
    });

    it('should apply fixed auto columns', () => {
      const component = () =>
        Grid({
          autoColumns: '200px',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.gridAutoColumns).toBe('200px');
    });

    it('should apply fixed auto rows', () => {
      const component = () =>
        Grid({
          autoRows: '100px',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.gridAutoRows).toBe('100px');
    });
  });

  describe('Gap spacing', () => {
    it('should apply numeric gap as pixels', () => {
      const component = () =>
        Grid({
          gap: 16,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.gap).toBe('16px');
    });

    it('should apply string gap directly', () => {
      const component = () =>
        Grid({
          gap: '1rem',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.gap).toBe('1rem');
    });

    it('should apply zero gap', () => {
      const component = () =>
        Grid({
          gap: 0,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.gap).toBe('0px');
    });

    it('should apply numeric rowGap as pixels', () => {
      const component = () =>
        Grid({
          rowGap: 24,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.rowGap).toBe('24px');
    });

    it('should apply string rowGap directly', () => {
      const component = () =>
        Grid({
          rowGap: '2rem',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.rowGap).toBe('2rem');
    });

    it('should apply numeric columnGap as pixels', () => {
      const component = () =>
        Grid({
          columnGap: 12,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.columnGap).toBe('12px');
    });

    it('should apply string columnGap directly', () => {
      const component = () =>
        Grid({
          columnGap: '0.5rem',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.columnGap).toBe('0.5rem');
    });

    it('should apply both rowGap and columnGap', () => {
      const component = () =>
        Grid({
          rowGap: 16,
          columnGap: '1rem',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.rowGap).toBe('16px');
      expect(gridEl.style.columnGap).toBe('1rem');
    });
  });

  describe('Justify items', () => {
    it('should apply start justify items', () => {
      const component = () =>
        Grid({
          justifyItems: 'start',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.justifyItems).toBe('start');
    });

    it('should apply end justify items', () => {
      const component = () =>
        Grid({
          justifyItems: 'end',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.justifyItems).toBe('end');
    });

    it('should apply center justify items', () => {
      const component = () =>
        Grid({
          justifyItems: 'center',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.justifyItems).toBe('center');
    });

    it('should apply stretch justify items', () => {
      const component = () =>
        Grid({
          justifyItems: 'stretch',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.justifyItems).toBe('stretch');
    });
  });

  describe('Align items', () => {
    it('should apply start align items', () => {
      const component = () =>
        Grid({
          alignItems: 'start',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.alignItems).toBe('start');
    });

    it('should apply end align items', () => {
      const component = () =>
        Grid({
          alignItems: 'end',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.alignItems).toBe('end');
    });

    it('should apply center align items', () => {
      const component = () =>
        Grid({
          alignItems: 'center',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.alignItems).toBe('center');
    });

    it('should apply stretch align items', () => {
      const component = () =>
        Grid({
          alignItems: 'stretch',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.alignItems).toBe('stretch');
    });

    it('should apply baseline align items', () => {
      const component = () =>
        Grid({
          alignItems: 'baseline',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.alignItems).toBe('baseline');
    });
  });

  describe('Justify content', () => {
    it('should apply start justify content', () => {
      const component = () =>
        Grid({
          justifyContent: 'start',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.justifyContent).toBe('start');
    });

    it('should apply end justify content', () => {
      const component = () =>
        Grid({
          justifyContent: 'end',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.justifyContent).toBe('end');
    });

    it('should apply center justify content', () => {
      const component = () =>
        Grid({
          justifyContent: 'center',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.justifyContent).toBe('center');
    });

    it('should apply stretch justify content', () => {
      const component = () =>
        Grid({
          justifyContent: 'stretch',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.justifyContent).toBe('stretch');
    });

    it('should apply space-around justify content', () => {
      const component = () =>
        Grid({
          justifyContent: 'space-around',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.justifyContent).toBe('space-around');
    });

    it('should apply space-between justify content', () => {
      const component = () =>
        Grid({
          justifyContent: 'space-between',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.justifyContent).toBe('space-between');
    });

    it('should apply space-evenly justify content', () => {
      const component = () =>
        Grid({
          justifyContent: 'space-evenly',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.justifyContent).toBe('space-evenly');
    });
  });

  describe('Align content', () => {
    it('should apply start align content', () => {
      const component = () =>
        Grid({
          alignContent: 'start',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.alignContent).toBe('start');
    });

    it('should apply end align content', () => {
      const component = () =>
        Grid({
          alignContent: 'end',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.alignContent).toBe('end');
    });

    it('should apply center align content', () => {
      const component = () =>
        Grid({
          alignContent: 'center',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.alignContent).toBe('center');
    });

    it('should apply stretch align content', () => {
      const component = () =>
        Grid({
          alignContent: 'stretch',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.alignContent).toBe('stretch');
    });

    it('should apply space-around align content', () => {
      const component = () =>
        Grid({
          alignContent: 'space-around',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.alignContent).toBe('space-around');
    });

    it('should apply space-between align content', () => {
      const component = () =>
        Grid({
          alignContent: 'space-between',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.alignContent).toBe('space-between');
    });

    it('should apply space-evenly align content', () => {
      const component = () =>
        Grid({
          alignContent: 'space-evenly',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.alignContent).toBe('space-evenly');
    });
  });

  describe('Display mode', () => {
    it('should use grid display by default', () => {
      const component = () => Grid({ children: 'Content' });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.display).toBe('grid');
    });

    it('should use inline-grid display when inline is true', () => {
      const component = () =>
        Grid({
          inline: true,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.display).toBe('inline-grid');
    });

    it('should use grid display when inline is false', () => {
      const component = () =>
        Grid({
          inline: false,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.display).toBe('grid');
    });
  });

  describe('Complex layouts', () => {
    it('should create basic 3-column grid', () => {
      const component = () =>
        Grid({
          templateColumns: 'repeat(3, 1fr)',
          gap: 16,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.display).toBe('grid');
      expect(gridEl.style.gridTemplateColumns).toBe('repeat(3, 1fr)');
      expect(gridEl.style.gap).toBe('16px');
    });

    it('should create dashboard layout with areas', () => {
      const component = () =>
        Grid({
          templateAreas: '"header header" "sidebar main"',
          templateColumns: '200px 1fr',
          templateRows: 'auto 1fr',
          gap: 16,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.gridTemplateColumns).toBe('200px 1fr');
      expect(gridEl.style.gridTemplateRows).toBe('auto 1fr');
      expect(gridEl.style.gap).toBe('16px');
    });

    it('should create responsive auto-fit grid', () => {
      const component = () =>
        Grid({
          templateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 20,
          justifyItems: 'center',
          alignItems: 'center',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.gridTemplateColumns).toBe('repeat(auto-fit, minmax(200px, 1fr))');
      expect(gridEl.style.gap).toBe('20px');
      expect(gridEl.style.justifyItems).toBe('center');
      expect(gridEl.style.alignItems).toBe('center');
    });
  });

  describe('Additional props', () => {
    it('should pass through additional HTML attributes', () => {
      const component = () =>
        Grid({
          id: 'grid-container',
          'data-testid': 'grid',
          'aria-label': 'Grid layout',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.id).toBe('grid-container');
      expect(gridEl.getAttribute('data-testid')).toBe('grid');
      expect(gridEl.getAttribute('aria-label')).toBe('Grid layout');
    });

    it('should support event handlers', () => {
      let clicked = false;
      const handleClick = () => {
        clicked = true;
      };

      const component = () =>
        Grid({
          onClick: handleClick,
          children: 'Click me',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      gridEl.click();

      expect(clicked).toBe(true);
    });
  });

  describe('Accessibility', () => {
    it('should support ARIA attributes', () => {
      const component = () =>
        Grid({
          role: 'grid',
          'aria-label': 'Data grid',
          children: 'Grid content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.getAttribute('role')).toBe('grid');
      expect(gridEl.getAttribute('aria-label')).toBe('Data grid');
    });

    it('should support semantic elements', () => {
      const component = () =>
        Grid({
          as: 'main',
          'aria-label': 'Main content',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('main') as HTMLElement;
      expect(gridEl).toBeTruthy();
      expect(gridEl.getAttribute('aria-label')).toBe('Main content');
    });
  });

  describe('Edge cases', () => {
    it('should handle null children', () => {
      const component = () => Grid({ children: null });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl).toBeTruthy();
      expect(gridEl.childNodes.length).toBe(0);
    });

    it('should handle undefined children', () => {
      const component = () => Grid({ children: undefined });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl).toBeTruthy();
      expect(gridEl.childNodes.length).toBe(0);
    });

    it('should handle empty string children', () => {
      const component = () => Grid({ children: '' });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl).toBeTruthy();
      expect(gridEl.textContent).toBe('');
    });
  });

  describe('Performance', () => {
    it('should not apply styles for undefined props', () => {
      const component = () => Grid({ children: 'Content' });

      const { container } = renderComponent(component);

      const gridEl = container.querySelector('div') as HTMLElement;
      expect(gridEl.style.gridTemplateColumns).toBe('');
      expect(gridEl.style.gridTemplateRows).toBe('');
      expect(gridEl.style.gridAutoFlow).toBe('');
    });
  });
});

describe('GridItem', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('Basic functionality', () => {
    it('should render with default props', () => {
      const component = () => GridItem({ children: 'Content' });

      const { container } = renderComponent(component);

      const itemEl = container.querySelector('div') as HTMLElement;
      expect(itemEl).toBeTruthy();
      expect(itemEl.textContent).toBe('Content');
    });

    it('should apply custom class', () => {
      const component = () =>
        GridItem({
          class: 'custom-item',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const itemEl = container.querySelector('.custom-item') as HTMLElement;
      expect(itemEl).toBeTruthy();
    });
  });

  describe('Element rendering', () => {
    it('should render as div by default', () => {
      const component = () => GridItem({ children: 'Content' });

      const { container } = renderComponent(component);

      const itemEl = container.firstElementChild as HTMLElement;
      expect(itemEl.tagName).toBe('DIV');
    });

    it('should render as custom element when as prop is provided', () => {
      const component = () => GridItem({ as: 'article', children: 'Content' });

      const { container } = renderComponent(component);

      const itemEl = container.firstElementChild as HTMLElement;
      expect(itemEl.tagName).toBe('ARTICLE');
    });
  });

  describe('Column placement', () => {
    it('should apply column shorthand', () => {
      const component = () =>
        GridItem({
          column: '1 / 3',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const itemEl = container.querySelector('div') as HTMLElement;
      expect(itemEl.style.gridColumn).toBe('1 / 3');
    });

    it('should apply column span notation', () => {
      const component = () =>
        GridItem({
          column: 'span 2',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const itemEl = container.querySelector('div') as HTMLElement;
      expect(itemEl.style.gridColumn).toBe('span 2');
    });

    it('should apply numeric columnStart', () => {
      const component = () =>
        GridItem({
          columnStart: 1,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const itemEl = container.querySelector('div') as HTMLElement;
      expect(itemEl.style.gridColumnStart).toBe('1');
    });

    it('should apply string columnStart', () => {
      const component = () =>
        GridItem({
          columnStart: 'span 2',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const itemEl = container.querySelector('div') as HTMLElement;
      expect(itemEl.style.gridColumnStart).toBe('span 2');
    });

    it('should apply numeric columnEnd', () => {
      const component = () =>
        GridItem({
          columnEnd: 3,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const itemEl = container.querySelector('div') as HTMLElement;
      expect(itemEl.style.gridColumnEnd).toBe('3');
    });

    it('should apply string columnEnd', () => {
      const component = () =>
        GridItem({
          columnEnd: 'span 2',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const itemEl = container.querySelector('div') as HTMLElement;
      expect(itemEl.style.gridColumnEnd).toBe('span 2');
    });

    it('should apply both columnStart and columnEnd', () => {
      const component = () =>
        GridItem({
          columnStart: 1,
          columnEnd: 3,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const itemEl = container.querySelector('div') as HTMLElement;
      expect(itemEl.style.gridColumnStart).toBe('1');
      expect(itemEl.style.gridColumnEnd).toBe('3');
    });
  });

  describe('Row placement', () => {
    it('should apply row shorthand', () => {
      const component = () =>
        GridItem({
          row: '1 / 3',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const itemEl = container.querySelector('div') as HTMLElement;
      expect(itemEl.style.gridRow).toBe('1 / 3');
    });

    it('should apply row span notation', () => {
      const component = () =>
        GridItem({
          row: 'span 2',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const itemEl = container.querySelector('div') as HTMLElement;
      expect(itemEl.style.gridRow).toBe('span 2');
    });

    it('should apply numeric rowStart', () => {
      const component = () =>
        GridItem({
          rowStart: 1,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const itemEl = container.querySelector('div') as HTMLElement;
      expect(itemEl.style.gridRowStart).toBe('1');
    });

    it('should apply string rowStart', () => {
      const component = () =>
        GridItem({
          rowStart: 'span 2',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const itemEl = container.querySelector('div') as HTMLElement;
      expect(itemEl.style.gridRowStart).toBe('span 2');
    });

    it('should apply numeric rowEnd', () => {
      const component = () =>
        GridItem({
          rowEnd: 3,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const itemEl = container.querySelector('div') as HTMLElement;
      expect(itemEl.style.gridRowEnd).toBe('3');
    });

    it('should apply string rowEnd', () => {
      const component = () =>
        GridItem({
          rowEnd: 'span 2',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const itemEl = container.querySelector('div') as HTMLElement;
      expect(itemEl.style.gridRowEnd).toBe('span 2');
    });

    it('should apply both rowStart and rowEnd', () => {
      const component = () =>
        GridItem({
          rowStart: 1,
          rowEnd: 3,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const itemEl = container.querySelector('div') as HTMLElement;
      expect(itemEl.style.gridRowStart).toBe('1');
      expect(itemEl.style.gridRowEnd).toBe('3');
    });
  });

  describe('Grid area', () => {
    it('should apply grid area', () => {
      const component = () =>
        GridItem({
          area: 'header',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const itemEl = container.querySelector('div') as HTMLElement;
      expect(itemEl.style.gridArea).toBe('header');
    });

    it('should apply complex grid area name', () => {
      const component = () =>
        GridItem({
          area: 'main-content',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const itemEl = container.querySelector('div') as HTMLElement;
      expect(itemEl.style.gridArea).toBe('main-content');
    });
  });

  describe('Complex placement', () => {
    it('should apply both column and row placement', () => {
      const component = () =>
        GridItem({
          column: '1 / 3',
          row: '2 / 4',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const itemEl = container.querySelector('div') as HTMLElement;
      expect(itemEl.style.gridColumn).toBe('1 / 3');
      expect(itemEl.style.gridRow).toBe('2 / 4');
    });

    it('should apply all positioning props together', () => {
      const component = () =>
        GridItem({
          columnStart: 1,
          columnEnd: 3,
          rowStart: 2,
          rowEnd: 4,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const itemEl = container.querySelector('div') as HTMLElement;
      expect(itemEl.style.gridColumnStart).toBe('1');
      expect(itemEl.style.gridColumnEnd).toBe('3');
      expect(itemEl.style.gridRowStart).toBe('2');
      expect(itemEl.style.gridRowEnd).toBe('4');
    });
  });

  describe('Additional props', () => {
    it('should pass through additional HTML attributes', () => {
      const component = () =>
        GridItem({
          id: 'grid-item',
          'data-testid': 'item',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const itemEl = container.querySelector('div') as HTMLElement;
      expect(itemEl.id).toBe('grid-item');
      expect(itemEl.getAttribute('data-testid')).toBe('item');
    });

    it('should merge custom styles', () => {
      const component = () =>
        GridItem({
          column: 'span 2',
          style: { backgroundColor: 'blue', padding: '10px' },
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const itemEl = container.querySelector('div') as HTMLElement;
      expect(itemEl.style.gridColumn).toBe('span 2');
      expect(itemEl.style.backgroundColor).toBe('blue');
      expect(itemEl.style.padding).toBe('10px');
    });
  });

  describe('Edge cases', () => {
    it('should handle null children', () => {
      const component = () => GridItem({ children: null });

      const { container } = renderComponent(component);

      const itemEl = container.querySelector('div') as HTMLElement;
      expect(itemEl).toBeTruthy();
      expect(itemEl.childNodes.length).toBe(0);
    });

    it('should handle undefined placement props', () => {
      const component = () => GridItem({ children: 'Content' });

      const { container } = renderComponent(component);

      const itemEl = container.querySelector('div') as HTMLElement;
      expect(itemEl.style.gridColumn).toBe('');
      expect(itemEl.style.gridRow).toBe('');
      expect(itemEl.style.gridArea).toBe('');
    });
  });
});
