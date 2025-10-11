/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Space } from '../../../src/primitives/Space.js';
import { renderComponent } from '../../helpers/test-utils.js';

describe('Space', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('Basic functionality', () => {
    it('should render with default props', () => {
      const component = () => Space({ children: 'Content' });

      const { container } = renderComponent(component);

      const spaceEl = container.querySelector('div') as HTMLElement;
      expect(spaceEl).toBeTruthy();
      expect(spaceEl.textContent).toBe('Content');
      expect(spaceEl.style.display).toBe('inline-flex');
    });

    it('should render children correctly', () => {
      const component = () =>
        Space({
          children: ['Child 1', document.createElement('span'), 'Child 2'],
        });

      const { container } = renderComponent(component);

      const spaceEl = container.querySelector('div') as HTMLElement;
      expect(spaceEl.childNodes.length).toBe(3);
    });

    it('should apply custom class', () => {
      const component = () =>
        Space({
          class: 'custom-space',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const spaceEl = container.querySelector('.custom-space') as HTMLElement;
      expect(spaceEl).toBeTruthy();
    });

    it('should merge custom styles with space styles', () => {
      const component = () =>
        Space({
          style: { backgroundColor: 'red', padding: '10px' },
          size: 'md',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const spaceEl = container.querySelector('div') as HTMLElement;
      expect(spaceEl.style.display).toBe('inline-flex');
      expect(spaceEl.style.gap).toBe('16px');
      expect(spaceEl.style.backgroundColor).toBe('red');
      expect(spaceEl.style.padding).toBe('10px');
    });
  });

  describe('Direction', () => {
    it('should apply horizontal direction by default', () => {
      const component = () => Space({ children: 'Content' });

      const { container } = renderComponent(component);

      const spaceEl = container.querySelector('div') as HTMLElement;
      expect(spaceEl.style.flexDirection).toBe('row');
    });

    it('should apply horizontal direction explicitly', () => {
      const component = () =>
        Space({
          direction: 'horizontal',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const spaceEl = container.querySelector('div') as HTMLElement;
      expect(spaceEl.style.flexDirection).toBe('row');
    });

    it('should apply vertical direction', () => {
      const component = () =>
        Space({
          direction: 'vertical',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const spaceEl = container.querySelector('div') as HTMLElement;
      expect(spaceEl.style.flexDirection).toBe('column');
    });
  });

  describe('Size variants', () => {
    it('should apply xs size (4px)', () => {
      const component = () =>
        Space({
          size: 'xs',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const spaceEl = container.querySelector('div') as HTMLElement;
      expect(spaceEl.style.gap).toBe('4px');
    });

    it('should apply sm size (8px)', () => {
      const component = () =>
        Space({
          size: 'sm',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const spaceEl = container.querySelector('div') as HTMLElement;
      expect(spaceEl.style.gap).toBe('8px');
    });

    it('should apply md size (16px) by default', () => {
      const component = () => Space({ children: 'Content' });

      const { container } = renderComponent(component);

      const spaceEl = container.querySelector('div') as HTMLElement;
      expect(spaceEl.style.gap).toBe('16px');
    });

    it('should apply md size explicitly', () => {
      const component = () =>
        Space({
          size: 'md',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const spaceEl = container.querySelector('div') as HTMLElement;
      expect(spaceEl.style.gap).toBe('16px');
    });

    it('should apply lg size (24px)', () => {
      const component = () =>
        Space({
          size: 'lg',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const spaceEl = container.querySelector('div') as HTMLElement;
      expect(spaceEl.style.gap).toBe('24px');
    });

    it('should apply xl size (32px)', () => {
      const component = () =>
        Space({
          size: 'xl',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const spaceEl = container.querySelector('div') as HTMLElement;
      expect(spaceEl.style.gap).toBe('32px');
    });

    it('should apply custom numeric size', () => {
      const component = () =>
        Space({
          size: 20,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const spaceEl = container.querySelector('div') as HTMLElement;
      expect(spaceEl.style.gap).toBe('20px');
    });

    it('should apply zero spacing', () => {
      const component = () =>
        Space({
          size: 0,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const spaceEl = container.querySelector('div') as HTMLElement;
      expect(spaceEl.style.gap).toBe('0px');
    });
  });

  describe('Custom spacing prop', () => {
    it('should override size with spacing prop', () => {
      const component = () =>
        Space({
          size: 'lg',
          spacing: 12,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const spaceEl = container.querySelector('div') as HTMLElement;
      expect(spaceEl.style.gap).toBe('12px');
    });

    it('should apply custom numeric spacing', () => {
      const component = () =>
        Space({
          spacing: 20,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const spaceEl = container.querySelector('div') as HTMLElement;
      expect(spaceEl.style.gap).toBe('20px');
    });

    it('should apply zero spacing', () => {
      const component = () =>
        Space({
          spacing: 0,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const spaceEl = container.querySelector('div') as HTMLElement;
      expect(spaceEl.style.gap).toBe('0px');
    });

    it('should apply large custom spacing', () => {
      const component = () =>
        Space({
          spacing: 100,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const spaceEl = container.querySelector('div') as HTMLElement;
      expect(spaceEl.style.gap).toBe('100px');
    });
  });

  describe('Alignment', () => {
    it('should not apply alignment by default', () => {
      const component = () => Space({ children: 'Content' });

      const { container } = renderComponent(component);

      const spaceEl = container.querySelector('div') as HTMLElement;
      expect(spaceEl.style.alignItems).toBe('');
    });

    it('should apply start alignment', () => {
      const component = () =>
        Space({
          align: 'start',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const spaceEl = container.querySelector('div') as HTMLElement;
      expect(spaceEl.style.alignItems).toBe('flex-start');
    });

    it('should apply center alignment', () => {
      const component = () =>
        Space({
          align: 'center',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const spaceEl = container.querySelector('div') as HTMLElement;
      expect(spaceEl.style.alignItems).toBe('center');
    });

    it('should apply end alignment', () => {
      const component = () =>
        Space({
          align: 'end',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const spaceEl = container.querySelector('div') as HTMLElement;
      expect(spaceEl.style.alignItems).toBe('flex-end');
    });

    it('should apply baseline alignment', () => {
      const component = () =>
        Space({
          align: 'baseline',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const spaceEl = container.querySelector('div') as HTMLElement;
      expect(spaceEl.style.alignItems).toBe('baseline');
    });
  });

  describe('Wrapping', () => {
    it('should not wrap by default', () => {
      const component = () => Space({ children: 'Content' });

      const { container } = renderComponent(component);

      const spaceEl = container.querySelector('div') as HTMLElement;
      expect(spaceEl.style.flexWrap).toBe('');
    });

    it('should apply wrap when wrap is true', () => {
      const component = () =>
        Space({
          wrap: true,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const spaceEl = container.querySelector('div') as HTMLElement;
      expect(spaceEl.style.flexWrap).toBe('wrap');
    });

    it('should not apply wrap when wrap is false', () => {
      const component = () =>
        Space({
          wrap: false,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const spaceEl = container.querySelector('div') as HTMLElement;
      expect(spaceEl.style.flexWrap).toBe('');
    });

    it('should combine wrap with direction', () => {
      const component = () =>
        Space({
          direction: 'vertical',
          wrap: true,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const spaceEl = container.querySelector('div') as HTMLElement;
      expect(spaceEl.style.flexDirection).toBe('column');
      expect(spaceEl.style.flexWrap).toBe('wrap');
    });
  });

  describe('Split mode', () => {
    it('should not apply split by default', () => {
      const component = () => Space({ children: 'Content' });

      const { container } = renderComponent(component);

      const spaceEl = container.querySelector('div') as HTMLElement;
      expect(spaceEl.style.justifyContent).toBe('');
      expect(spaceEl.style.width).toBe('');
    });

    it('should apply space-between and width when split is true', () => {
      const component = () =>
        Space({
          split: true,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const spaceEl = container.querySelector('div') as HTMLElement;
      expect(spaceEl.style.justifyContent).toBe('space-between');
      expect(spaceEl.style.width).toBe('100%');
    });

    it('should not apply split when split is false', () => {
      const component = () =>
        Space({
          split: false,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const spaceEl = container.querySelector('div') as HTMLElement;
      expect(spaceEl.style.justifyContent).toBe('');
      expect(spaceEl.style.width).toBe('');
    });

    it('should combine split with other props', () => {
      const component = () =>
        Space({
          split: true,
          align: 'center',
          size: 'md',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const spaceEl = container.querySelector('div') as HTMLElement;
      expect(spaceEl.style.justifyContent).toBe('space-between');
      expect(spaceEl.style.width).toBe('100%');
      expect(spaceEl.style.alignItems).toBe('center');
      expect(spaceEl.style.gap).toBe('16px');
    });
  });

  describe('Complex layouts', () => {
    it('should create horizontal button group', () => {
      const component = () =>
        Space({
          direction: 'horizontal',
          size: 'sm',
          align: 'center',
          children: ['Button 1', 'Button 2', 'Button 3'],
        });

      const { container } = renderComponent(component);

      const spaceEl = container.querySelector('div') as HTMLElement;
      expect(spaceEl.style.flexDirection).toBe('row');
      expect(spaceEl.style.gap).toBe('8px');
      expect(spaceEl.style.alignItems).toBe('center');
    });

    it('should create vertical stack with large spacing', () => {
      const component = () =>
        Space({
          direction: 'vertical',
          size: 'xl',
          children: ['Item 1', 'Item 2', 'Item 3'],
        });

      const { container } = renderComponent(component);

      const spaceEl = container.querySelector('div') as HTMLElement;
      expect(spaceEl.style.flexDirection).toBe('column');
      expect(spaceEl.style.gap).toBe('32px');
    });

    it('should create wrapping tag list', () => {
      const component = () =>
        Space({
          wrap: true,
          size: 'sm',
          align: 'center',
          children: ['Tag1', 'Tag2', 'Tag3', 'Tag4'],
        });

      const { container } = renderComponent(component);

      const spaceEl = container.querySelector('div') as HTMLElement;
      expect(spaceEl.style.flexWrap).toBe('wrap');
      expect(spaceEl.style.gap).toBe('8px');
      expect(spaceEl.style.alignItems).toBe('center');
    });

    it('should create navigation with split layout', () => {
      const component = () =>
        Space({
          split: true,
          align: 'center',
          children: ['Logo', 'Nav', 'Actions'],
        });

      const { container } = renderComponent(component);

      const spaceEl = container.querySelector('div') as HTMLElement;
      expect(spaceEl.style.justifyContent).toBe('space-between');
      expect(spaceEl.style.width).toBe('100%');
      expect(spaceEl.style.alignItems).toBe('center');
    });
  });

  describe('Additional props', () => {
    it('should pass through additional HTML attributes', () => {
      const component = () =>
        Space({
          id: 'space-container',
          'data-testid': 'space',
          'aria-label': 'Space layout',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const spaceEl = container.querySelector('div') as HTMLElement;
      expect(spaceEl.id).toBe('space-container');
      expect(spaceEl.getAttribute('data-testid')).toBe('space');
      expect(spaceEl.getAttribute('aria-label')).toBe('Space layout');
    });

    it('should support event handlers', () => {
      let clicked = false;
      const handleClick = () => {
        clicked = true;
      };

      const component = () =>
        Space({
          onClick: handleClick,
          children: 'Click me',
        });

      const { container } = renderComponent(component);

      const spaceEl = container.querySelector('div') as HTMLElement;
      spaceEl.click();

      expect(clicked).toBe(true);
    });

    it('should support title attribute', () => {
      const component = () =>
        Space({
          title: 'This is a space container',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const spaceEl = container.querySelector('div') as HTMLElement;
      expect(spaceEl.title).toBe('This is a space container');
    });
  });

  describe('Accessibility', () => {
    it('should support ARIA attributes', () => {
      const component = () =>
        Space({
          role: 'toolbar',
          'aria-label': 'Button toolbar',
          children: 'Buttons',
        });

      const { container } = renderComponent(component);

      const spaceEl = container.querySelector('div') as HTMLElement;
      expect(spaceEl.getAttribute('role')).toBe('toolbar');
      expect(spaceEl.getAttribute('aria-label')).toBe('Button toolbar');
    });

    it('should not add Space-specific ARIA attributes automatically', () => {
      const component = () => Space({ children: 'Content' });

      const { container } = renderComponent(component);

      const spaceEl = container.querySelector('div') as HTMLElement;
      expect(spaceEl.getAttribute('role')).toBeNull();
      expect(spaceEl.getAttribute('aria-label')).toBeNull();
    });

    it('should support aria-orientation for accessibility', () => {
      const component = () =>
        Space({
          direction: 'vertical',
          role: 'group',
          'aria-orientation': 'vertical',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const spaceEl = container.querySelector('div') as HTMLElement;
      expect(spaceEl.getAttribute('aria-orientation')).toBe('vertical');
    });
  });

  describe('Edge cases', () => {
    it('should handle null children', () => {
      const component = () => Space({ children: null });

      const { container } = renderComponent(component);

      const spaceEl = container.querySelector('div') as HTMLElement;
      expect(spaceEl).toBeTruthy();
      expect(spaceEl.childNodes.length).toBe(0);
    });

    it('should handle undefined children', () => {
      const component = () => Space({ children: undefined });

      const { container } = renderComponent(component);

      const spaceEl = container.querySelector('div') as HTMLElement;
      expect(spaceEl).toBeTruthy();
      expect(spaceEl.childNodes.length).toBe(0);
    });

    it('should handle empty string children', () => {
      const component = () => Space({ children: '' });

      const { container } = renderComponent(component);

      const spaceEl = container.querySelector('div') as HTMLElement;
      expect(spaceEl).toBeTruthy();
      expect(spaceEl.textContent).toBe('');
    });

    it('should handle single child', () => {
      const component = () => Space({ children: 'Single child' });

      const { container } = renderComponent(component);

      const spaceEl = container.querySelector('div') as HTMLElement;
      expect(spaceEl.textContent).toBe('Single child');
    });

    it('should handle very large spacing', () => {
      const component = () =>
        Space({
          spacing: 999,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const spaceEl = container.querySelector('div') as HTMLElement;
      expect(spaceEl.style.gap).toBe('999px');
    });

    it('should handle conflicting size and spacing props', () => {
      const component = () =>
        Space({
          size: 'xl',
          spacing: 10,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const spaceEl = container.querySelector('div') as HTMLElement;
      // spacing should override size
      expect(spaceEl.style.gap).toBe('10px');
    });
  });

  describe('Performance', () => {
    it('should not apply optional styles when props are undefined', () => {
      const component = () => Space({ children: 'Content' });

      const { container } = renderComponent(component);

      const spaceEl = container.querySelector('div') as HTMLElement;
      expect(spaceEl.style.alignItems).toBe('');
      expect(spaceEl.style.flexWrap).toBe('');
      expect(spaceEl.style.justifyContent).toBe('');
      expect(spaceEl.style.width).toBe('');
    });

    it('should only apply provided style properties', () => {
      const component = () =>
        Space({
          direction: 'vertical',
          size: 'lg',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const spaceEl = container.querySelector('div') as HTMLElement;
      expect(spaceEl.style.flexDirection).toBe('column');
      expect(spaceEl.style.gap).toBe('24px');
      expect(spaceEl.style.alignItems).toBe('');
      expect(spaceEl.style.flexWrap).toBe('');
    });
  });

  describe('Style combinations', () => {
    it('should combine all props correctly', () => {
      const component = () =>
        Space({
          direction: 'vertical',
          size: 'md',
          align: 'center',
          wrap: true,
          split: true,
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const spaceEl = container.querySelector('div') as HTMLElement;
      expect(spaceEl.style.display).toBe('inline-flex');
      expect(spaceEl.style.flexDirection).toBe('column');
      expect(spaceEl.style.gap).toBe('16px');
      expect(spaceEl.style.alignItems).toBe('center');
      expect(spaceEl.style.flexWrap).toBe('wrap');
      expect(spaceEl.style.justifyContent).toBe('space-between');
      expect(spaceEl.style.width).toBe('100%');
    });

    it('should merge styles without conflicts', () => {
      const component = () =>
        Space({
          size: 'sm',
          align: 'end',
          style: { backgroundColor: 'blue', border: '1px solid red' },
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const spaceEl = container.querySelector('div') as HTMLElement;
      expect(spaceEl.style.gap).toBe('8px');
      expect(spaceEl.style.alignItems).toBe('flex-end');
      expect(spaceEl.style.backgroundColor).toBe('blue');
      expect(spaceEl.style.border).toBe('1px solid red');
    });
  });
});
