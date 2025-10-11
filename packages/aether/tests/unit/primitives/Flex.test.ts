/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Flex } from '../../../src/primitives/Flex.js';
import { renderComponent } from '../../helpers/test-utils.js';

describe('Flex', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('Basic functionality', () => {
    it('should render with default props', () => {
      const component = () => Flex({ children: 'Content' });

      const { container } = renderComponent(component);

      const flexEl = container.querySelector('div') as HTMLElement;
      expect(flexEl).toBeTruthy();
      expect(flexEl.textContent).toBe('Content');
      expect(flexEl.style.display).toBe('flex');
    });

    it('should render children correctly', () => {
      const component = () =>
        Flex({
          children: [
            'Child 1',
            document.createElement('span'),
            'Child 2',
          ],
        });

      const { container } = renderComponent(component);

      const flexEl = container.querySelector('div') as HTMLElement;
      expect(flexEl.childNodes.length).toBe(3);
    });

    it('should apply custom class', () => {
      const component = () =>
        Flex({
          class: 'custom-flex',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const flexEl = container.querySelector('.custom-flex') as HTMLElement;
      expect(flexEl).toBeTruthy();
    });

    it('should merge custom styles with flex styles', () => {
      const component = () =>
        Flex({
          style: { backgroundColor: 'red', padding: '10px' },
          gap: 16,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const flexEl = container.querySelector('div') as HTMLElement;
      expect(flexEl.style.display).toBe('flex');
      expect(flexEl.style.gap).toBe('16px');
      expect(flexEl.style.backgroundColor).toBe('red');
      expect(flexEl.style.padding).toBe('10px');
    });
  });

  describe('Element rendering', () => {
    it('should render as div by default', () => {
      const component = () => Flex({ children: 'Content' });

      const { container } = renderComponent(component);

      const flexEl = container.firstElementChild as HTMLElement;
      expect(flexEl.tagName).toBe('DIV');
    });

    it('should render as custom element when as prop is provided', () => {
      const component = () => Flex({ as: 'section', children: 'Content' });

      const { container } = renderComponent(component);

      const flexEl = container.firstElementChild as HTMLElement;
      expect(flexEl.tagName).toBe('SECTION');
    });

    it('should support semantic HTML elements', () => {
      const elements = ['nav', 'header', 'footer', 'main', 'aside', 'article'];

      elements.forEach((tag) => {
        const component = () => Flex({ as: tag, children: 'Content' });
        const { container, cleanup } = renderComponent(component);

        const flexEl = container.firstElementChild as HTMLElement;
        expect(flexEl.tagName).toBe(tag.toUpperCase());

        cleanup();
      });
    });
  });

  describe('Flex direction', () => {
    it('should apply row direction', () => {
      const component = () =>
        Flex({
          direction: 'row',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const flexEl = container.querySelector('div') as HTMLElement;
      expect(flexEl.style.flexDirection).toBe('row');
    });

    it('should apply column direction', () => {
      const component = () =>
        Flex({
          direction: 'column',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const flexEl = container.querySelector('div') as HTMLElement;
      expect(flexEl.style.flexDirection).toBe('column');
    });

    it('should apply row-reverse direction', () => {
      const component = () =>
        Flex({
          direction: 'row-reverse',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const flexEl = container.querySelector('div') as HTMLElement;
      expect(flexEl.style.flexDirection).toBe('row-reverse');
    });

    it('should apply column-reverse direction', () => {
      const component = () =>
        Flex({
          direction: 'column-reverse',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const flexEl = container.querySelector('div') as HTMLElement;
      expect(flexEl.style.flexDirection).toBe('column-reverse');
    });
  });

  describe('Justify content', () => {
    it('should apply flex-start justify', () => {
      const component = () =>
        Flex({
          justify: 'flex-start',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const flexEl = container.querySelector('div') as HTMLElement;
      expect(flexEl.style.justifyContent).toBe('flex-start');
    });

    it('should apply flex-end justify', () => {
      const component = () =>
        Flex({
          justify: 'flex-end',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const flexEl = container.querySelector('div') as HTMLElement;
      expect(flexEl.style.justifyContent).toBe('flex-end');
    });

    it('should apply center justify', () => {
      const component = () =>
        Flex({
          justify: 'center',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const flexEl = container.querySelector('div') as HTMLElement;
      expect(flexEl.style.justifyContent).toBe('center');
    });

    it('should apply space-between justify', () => {
      const component = () =>
        Flex({
          justify: 'space-between',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const flexEl = container.querySelector('div') as HTMLElement;
      expect(flexEl.style.justifyContent).toBe('space-between');
    });

    it('should apply space-around justify', () => {
      const component = () =>
        Flex({
          justify: 'space-around',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const flexEl = container.querySelector('div') as HTMLElement;
      expect(flexEl.style.justifyContent).toBe('space-around');
    });

    it('should apply space-evenly justify', () => {
      const component = () =>
        Flex({
          justify: 'space-evenly',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const flexEl = container.querySelector('div') as HTMLElement;
      expect(flexEl.style.justifyContent).toBe('space-evenly');
    });
  });

  describe('Align items', () => {
    it('should apply flex-start align', () => {
      const component = () =>
        Flex({
          align: 'flex-start',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const flexEl = container.querySelector('div') as HTMLElement;
      expect(flexEl.style.alignItems).toBe('flex-start');
    });

    it('should apply flex-end align', () => {
      const component = () =>
        Flex({
          align: 'flex-end',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const flexEl = container.querySelector('div') as HTMLElement;
      expect(flexEl.style.alignItems).toBe('flex-end');
    });

    it('should apply center align', () => {
      const component = () =>
        Flex({
          align: 'center',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const flexEl = container.querySelector('div') as HTMLElement;
      expect(flexEl.style.alignItems).toBe('center');
    });

    it('should apply baseline align', () => {
      const component = () =>
        Flex({
          align: 'baseline',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const flexEl = container.querySelector('div') as HTMLElement;
      expect(flexEl.style.alignItems).toBe('baseline');
    });

    it('should apply stretch align', () => {
      const component = () =>
        Flex({
          align: 'stretch',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const flexEl = container.querySelector('div') as HTMLElement;
      expect(flexEl.style.alignItems).toBe('stretch');
    });
  });

  describe('Align content', () => {
    it('should apply flex-start alignContent', () => {
      const component = () =>
        Flex({
          alignContent: 'flex-start',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const flexEl = container.querySelector('div') as HTMLElement;
      expect(flexEl.style.alignContent).toBe('flex-start');
    });

    it('should apply flex-end alignContent', () => {
      const component = () =>
        Flex({
          alignContent: 'flex-end',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const flexEl = container.querySelector('div') as HTMLElement;
      expect(flexEl.style.alignContent).toBe('flex-end');
    });

    it('should apply center alignContent', () => {
      const component = () =>
        Flex({
          alignContent: 'center',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const flexEl = container.querySelector('div') as HTMLElement;
      expect(flexEl.style.alignContent).toBe('center');
    });

    it('should apply space-between alignContent', () => {
      const component = () =>
        Flex({
          alignContent: 'space-between',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const flexEl = container.querySelector('div') as HTMLElement;
      expect(flexEl.style.alignContent).toBe('space-between');
    });

    it('should apply space-around alignContent', () => {
      const component = () =>
        Flex({
          alignContent: 'space-around',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const flexEl = container.querySelector('div') as HTMLElement;
      expect(flexEl.style.alignContent).toBe('space-around');
    });

    it('should apply stretch alignContent', () => {
      const component = () =>
        Flex({
          alignContent: 'stretch',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const flexEl = container.querySelector('div') as HTMLElement;
      expect(flexEl.style.alignContent).toBe('stretch');
    });
  });

  describe('Flex wrap', () => {
    it('should apply nowrap', () => {
      const component = () =>
        Flex({
          wrap: 'nowrap',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const flexEl = container.querySelector('div') as HTMLElement;
      expect(flexEl.style.flexWrap).toBe('nowrap');
    });

    it('should apply wrap', () => {
      const component = () =>
        Flex({
          wrap: 'wrap',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const flexEl = container.querySelector('div') as HTMLElement;
      expect(flexEl.style.flexWrap).toBe('wrap');
    });

    it('should apply wrap-reverse', () => {
      const component = () =>
        Flex({
          wrap: 'wrap-reverse',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const flexEl = container.querySelector('div') as HTMLElement;
      expect(flexEl.style.flexWrap).toBe('wrap-reverse');
    });
  });

  describe('Gap spacing', () => {
    it('should apply numeric gap as pixels', () => {
      const component = () =>
        Flex({
          gap: 16,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const flexEl = container.querySelector('div') as HTMLElement;
      expect(flexEl.style.gap).toBe('16px');
    });

    it('should apply string gap directly', () => {
      const component = () =>
        Flex({
          gap: '1rem',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const flexEl = container.querySelector('div') as HTMLElement;
      expect(flexEl.style.gap).toBe('1rem');
    });

    it('should apply zero gap', () => {
      const component = () =>
        Flex({
          gap: 0,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const flexEl = container.querySelector('div') as HTMLElement;
      expect(flexEl.style.gap).toBe('0px');
    });

    it('should apply numeric rowGap as pixels', () => {
      const component = () =>
        Flex({
          rowGap: 24,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const flexEl = container.querySelector('div') as HTMLElement;
      expect(flexEl.style.rowGap).toBe('24px');
    });

    it('should apply string rowGap directly', () => {
      const component = () =>
        Flex({
          rowGap: '2rem',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const flexEl = container.querySelector('div') as HTMLElement;
      expect(flexEl.style.rowGap).toBe('2rem');
    });

    it('should apply numeric columnGap as pixels', () => {
      const component = () =>
        Flex({
          columnGap: 12,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const flexEl = container.querySelector('div') as HTMLElement;
      expect(flexEl.style.columnGap).toBe('12px');
    });

    it('should apply string columnGap directly', () => {
      const component = () =>
        Flex({
          columnGap: '0.5rem',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const flexEl = container.querySelector('div') as HTMLElement;
      expect(flexEl.style.columnGap).toBe('0.5rem');
    });

    it('should apply both rowGap and columnGap', () => {
      const component = () =>
        Flex({
          rowGap: 16,
          columnGap: '1rem',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const flexEl = container.querySelector('div') as HTMLElement;
      expect(flexEl.style.rowGap).toBe('16px');
      expect(flexEl.style.columnGap).toBe('1rem');
    });
  });

  describe('Flex properties', () => {
    it('should apply grow value', () => {
      const component = () =>
        Flex({
          grow: 1,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const flexEl = container.querySelector('div') as HTMLElement;
      expect(flexEl.style.flexGrow).toBe('1');
    });

    it('should apply grow value of 0', () => {
      const component = () =>
        Flex({
          grow: 0,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const flexEl = container.querySelector('div') as HTMLElement;
      expect(flexEl.style.flexGrow).toBe('0');
    });

    it('should apply shrink value', () => {
      const component = () =>
        Flex({
          shrink: 1,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const flexEl = container.querySelector('div') as HTMLElement;
      expect(flexEl.style.flexShrink).toBe('1');
    });

    it('should apply shrink value of 0', () => {
      const component = () =>
        Flex({
          shrink: 0,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const flexEl = container.querySelector('div') as HTMLElement;
      expect(flexEl.style.flexShrink).toBe('0');
    });

    it('should apply numeric basis as pixels', () => {
      const component = () =>
        Flex({
          basis: 200,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const flexEl = container.querySelector('div') as HTMLElement;
      expect(flexEl.style.flexBasis).toBe('200px');
    });

    it('should apply string basis directly', () => {
      const component = () =>
        Flex({
          basis: 'auto',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const flexEl = container.querySelector('div') as HTMLElement;
      expect(flexEl.style.flexBasis).toBe('auto');
    });

    it('should apply percentage basis', () => {
      const component = () =>
        Flex({
          basis: '50%',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const flexEl = container.querySelector('div') as HTMLElement;
      expect(flexEl.style.flexBasis).toBe('50%');
    });

    it('should apply all flex properties together', () => {
      const component = () =>
        Flex({
          grow: 1,
          shrink: 0,
          basis: 'auto',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const flexEl = container.querySelector('div') as HTMLElement;
      expect(flexEl.style.flexGrow).toBe('1');
      expect(flexEl.style.flexShrink).toBe('0');
      expect(flexEl.style.flexBasis).toBe('auto');
    });
  });

  describe('Display mode', () => {
    it('should use flex display by default', () => {
      const component = () => Flex({ children: 'Content' });

      const { container } = renderComponent(component);

      const flexEl = container.querySelector('div') as HTMLElement;
      expect(flexEl.style.display).toBe('flex');
    });

    it('should use inline-flex display when inline is true', () => {
      const component = () =>
        Flex({
          inline: true,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const flexEl = container.querySelector('div') as HTMLElement;
      expect(flexEl.style.display).toBe('inline-flex');
    });

    it('should use flex display when inline is false', () => {
      const component = () =>
        Flex({
          inline: false,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const flexEl = container.querySelector('div') as HTMLElement;
      expect(flexEl.style.display).toBe('flex');
    });
  });

  describe('Complex layouts', () => {
    it('should create centered layout', () => {
      const component = () =>
        Flex({
          direction: 'column',
          justify: 'center',
          align: 'center',
          children: 'Centered',
        });

      const { container } = renderComponent(component);

      const flexEl = container.querySelector('div') as HTMLElement;
      expect(flexEl.style.display).toBe('flex');
      expect(flexEl.style.flexDirection).toBe('column');
      expect(flexEl.style.justifyContent).toBe('center');
      expect(flexEl.style.alignItems).toBe('center');
    });

    it('should create space-between layout with wrapping', () => {
      const component = () =>
        Flex({
          justify: 'space-between',
          wrap: 'wrap',
          gap: 16,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const flexEl = container.querySelector('div') as HTMLElement;
      expect(flexEl.style.justifyContent).toBe('space-between');
      expect(flexEl.style.flexWrap).toBe('wrap');
      expect(flexEl.style.gap).toBe('16px');
    });

    it('should create nested flex layout', () => {
      const component = () =>
        Flex({
          direction: 'column',
          gap: 24,
          children: Flex({
            direction: 'row',
            gap: 16,
            children: 'Nested',
          }),
        });

      const { container } = renderComponent(component);

      const outerFlex = container.querySelector('div') as HTMLElement;
      expect(outerFlex.style.flexDirection).toBe('column');
      expect(outerFlex.style.gap).toBe('24px');

      const innerFlex = outerFlex.querySelector('div') as HTMLElement;
      expect(innerFlex.style.flexDirection).toBe('row');
      expect(innerFlex.style.gap).toBe('16px');
    });

    it('should support all alignment options together', () => {
      const component = () =>
        Flex({
          direction: 'column',
          justify: 'space-between',
          align: 'stretch',
          alignContent: 'center',
          wrap: 'wrap',
          gap: '1rem',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const flexEl = container.querySelector('div') as HTMLElement;
      expect(flexEl.style.flexDirection).toBe('column');
      expect(flexEl.style.justifyContent).toBe('space-between');
      expect(flexEl.style.alignItems).toBe('stretch');
      expect(flexEl.style.alignContent).toBe('center');
      expect(flexEl.style.flexWrap).toBe('wrap');
      expect(flexEl.style.gap).toBe('1rem');
    });
  });

  describe('Additional props', () => {
    it('should pass through additional HTML attributes', () => {
      const component = () =>
        Flex({
          id: 'flex-container',
          'data-testid': 'flex',
          'aria-label': 'Flex layout',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const flexEl = container.querySelector('div') as HTMLElement;
      expect(flexEl.id).toBe('flex-container');
      expect(flexEl.getAttribute('data-testid')).toBe('flex');
      expect(flexEl.getAttribute('aria-label')).toBe('Flex layout');
    });

    it('should support event handlers', () => {
      let clicked = false;
      const handleClick = () => {
        clicked = true;
      };

      const component = () =>
        Flex({
          onClick: handleClick,
          children: 'Click me',
        });

      const { container } = renderComponent(component);

      const flexEl = container.querySelector('div') as HTMLElement;
      flexEl.click();

      expect(clicked).toBe(true);
    });

    it('should support title attribute', () => {
      const component = () =>
        Flex({
          title: 'This is a flex container',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const flexEl = container.querySelector('div') as HTMLElement;
      expect(flexEl.title).toBe('This is a flex container');
    });
  });

  describe('Accessibility', () => {
    it('should support ARIA attributes', () => {
      const component = () =>
        Flex({
          role: 'navigation',
          'aria-label': 'Main navigation',
          children: 'Nav content',
        });

      const { container } = renderComponent(component);

      const flexEl = container.querySelector('div') as HTMLElement;
      expect(flexEl.getAttribute('role')).toBe('navigation');
      expect(flexEl.getAttribute('aria-label')).toBe('Main navigation');
    });

    it('should support landmark roles with semantic elements', () => {
      const component = () =>
        Flex({
          as: 'nav',
          'aria-label': 'Site navigation',
          children: 'Navigation',
        });

      const { container } = renderComponent(component);

      const flexEl = container.querySelector('nav') as HTMLElement;
      expect(flexEl).toBeTruthy();
      expect(flexEl.getAttribute('aria-label')).toBe('Site navigation');
    });

    it('should not add Flex-specific ARIA attributes automatically', () => {
      const component = () => Flex({ children: 'Content' });

      const { container } = renderComponent(component);

      const flexEl = container.querySelector('div') as HTMLElement;
      expect(flexEl.getAttribute('role')).toBeNull();
      expect(flexEl.getAttribute('aria-label')).toBeNull();
    });
  });

  describe('Edge cases', () => {
    it('should handle null children', () => {
      const component = () => Flex({ children: null });

      const { container } = renderComponent(component);

      const flexEl = container.querySelector('div') as HTMLElement;
      expect(flexEl).toBeTruthy();
      expect(flexEl.childNodes.length).toBe(0);
    });

    it('should handle undefined children', () => {
      const component = () => Flex({ children: undefined });

      const { container } = renderComponent(component);

      const flexEl = container.querySelector('div') as HTMLElement;
      expect(flexEl).toBeTruthy();
      expect(flexEl.childNodes.length).toBe(0);
    });

    it('should handle empty string children', () => {
      const component = () => Flex({ children: '' });

      const { container } = renderComponent(component);

      const flexEl = container.querySelector('div') as HTMLElement;
      expect(flexEl).toBeTruthy();
      expect(flexEl.textContent).toBe('');
    });

    it('should handle very large gap values', () => {
      const component = () =>
        Flex({
          gap: 999,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const flexEl = container.querySelector('div') as HTMLElement;
      expect(flexEl.style.gap).toBe('999px');
    });

    it('should handle mixed numeric and string gap values', () => {
      const component = () =>
        Flex({
          rowGap: 16,
          columnGap: '2em',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const flexEl = container.querySelector('div') as HTMLElement;
      expect(flexEl.style.rowGap).toBe('16px');
      expect(flexEl.style.columnGap).toBe('2em');
    });

    it('should handle multiple style conflicts gracefully', () => {
      const component = () =>
        Flex({
          gap: 16,
          style: { gap: '32px' },
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const flexEl = container.querySelector('div') as HTMLElement;
      // Custom style should override prop
      expect(flexEl.style.gap).toBe('32px');
    });
  });

  describe('Performance', () => {
    it('should not apply styles for undefined props', () => {
      const component = () =>
        Flex({
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const flexEl = container.querySelector('div') as HTMLElement;
      expect(flexEl.style.flexDirection).toBe('');
      expect(flexEl.style.justifyContent).toBe('');
      expect(flexEl.style.alignItems).toBe('');
      expect(flexEl.style.flexWrap).toBe('');
    });

    it('should only apply provided style properties', () => {
      const component = () =>
        Flex({
          direction: 'row',
          gap: 16,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const flexEl = container.querySelector('div') as HTMLElement;
      expect(flexEl.style.flexDirection).toBe('row');
      expect(flexEl.style.gap).toBe('16px');
      expect(flexEl.style.justifyContent).toBe('');
      expect(flexEl.style.alignItems).toBe('');
    });
  });
});
