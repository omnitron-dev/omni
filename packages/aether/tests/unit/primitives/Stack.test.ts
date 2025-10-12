/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Stack, VStack, HStack } from '../../../src/primitives/Stack.js';
import { renderComponent } from '../../helpers/test-utils.js';

describe('Stack', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('Basic rendering', () => {
    it('should render stack with default props', () => {
      const component = () =>
        Stack({
          children: [document.createTextNode('Item 1'), document.createTextNode('Item 2')],
        });

      const { container } = renderComponent(component);

      const stackEl = container.querySelector('div') as HTMLElement;
      expect(stackEl).toBeTruthy();
      expect(stackEl.textContent).toContain('Item 1');
      expect(stackEl.textContent).toContain('Item 2');
    });

    it('should render with vertical direction by default', () => {
      const component = () =>
        Stack({
          children: [document.createTextNode('Item 1')],
        });

      const { container } = renderComponent(component);

      const stackEl = container.querySelector('div') as HTMLElement;
      expect(stackEl.style.flexDirection).toBe('column');
      expect(stackEl.style.display).toBe('flex');
    });

    it('should render with horizontal direction', () => {
      const component = () =>
        Stack({
          direction: 'horizontal',
          children: [document.createTextNode('Item 1')],
        });

      const { container } = renderComponent(component);

      const stackEl = container.querySelector('div') as HTMLElement;
      expect(stackEl.style.flexDirection).toBe('row');
    });

    it('should apply custom className', () => {
      const component = () =>
        Stack({
          class: 'custom-stack',
          children: [document.createTextNode('Item')],
        });

      const { container } = renderComponent(component);

      const stackEl = container.querySelector('.custom-stack');
      expect(stackEl).toBeTruthy();
    });

    it('should merge custom styles', () => {
      const component = () =>
        Stack({
          style: { backgroundColor: 'red', padding: '10px' },
          children: [document.createTextNode('Item')],
        });

      const { container } = renderComponent(component);

      const stackEl = container.querySelector('div') as HTMLElement;
      expect(stackEl.style.backgroundColor).toBe('red');
      expect(stackEl.style.padding).toBe('10px');
      expect(stackEl.style.display).toBe('flex'); // Stack styles preserved
    });

    it('should pass through additional props', () => {
      const component = () =>
        Stack({
          'data-testid': 'test-stack',
          'aria-label': 'Test stack',
          children: [document.createTextNode('Item')],
        });

      const { container } = renderComponent(component);

      const stackEl = container.querySelector('div') as HTMLElement;
      expect(stackEl.getAttribute('data-testid')).toBe('test-stack');
      expect(stackEl.getAttribute('aria-label')).toBe('Test stack');
    });
  });

  describe('Spacing', () => {
    it('should apply numeric spacing as pixels', () => {
      const component = () =>
        Stack({
          spacing: 16,
          children: [document.createTextNode('Item 1'), document.createTextNode('Item 2')],
        });

      const { container } = renderComponent(component);

      const stackEl = container.querySelector('div') as HTMLElement;
      expect(stackEl.style.gap).toBe('16px');
    });

    it('should apply string spacing as-is', () => {
      const component = () =>
        Stack({
          spacing: '2rem',
          children: [document.createTextNode('Item 1'), document.createTextNode('Item 2')],
        });

      const { container } = renderComponent(component);

      const stackEl = container.querySelector('div') as HTMLElement;
      expect(stackEl.style.gap).toBe('2rem');
    });

    it('should use 0 spacing by default', () => {
      const component = () =>
        Stack({
          children: [document.createTextNode('Item 1')],
        });

      const { container } = renderComponent(component);

      const stackEl = container.querySelector('div') as HTMLElement;
      expect(stackEl.style.gap).toBe('0px');
    });
  });

  describe('Alignment', () => {
    it('should align items to start', () => {
      const component = () =>
        Stack({
          align: 'start',
          children: [document.createTextNode('Item')],
        });

      const { container } = renderComponent(component);

      const stackEl = container.querySelector('div') as HTMLElement;
      expect(stackEl.style.alignItems).toBe('flex-start');
    });

    it('should align items to center', () => {
      const component = () =>
        Stack({
          align: 'center',
          children: [document.createTextNode('Item')],
        });

      const { container } = renderComponent(component);

      const stackEl = container.querySelector('div') as HTMLElement;
      expect(stackEl.style.alignItems).toBe('center');
    });

    it('should align items to end', () => {
      const component = () =>
        Stack({
          align: 'end',
          children: [document.createTextNode('Item')],
        });

      const { container } = renderComponent(component);

      const stackEl = container.querySelector('div') as HTMLElement;
      expect(stackEl.style.alignItems).toBe('flex-end');
    });

    it('should stretch items', () => {
      const component = () =>
        Stack({
          align: 'stretch',
          children: [document.createTextNode('Item')],
        });

      const { container } = renderComponent(component);

      const stackEl = container.querySelector('div') as HTMLElement;
      expect(stackEl.style.alignItems).toBe('stretch');
    });

    it('should align items to baseline', () => {
      const component = () =>
        Stack({
          align: 'baseline',
          children: [document.createTextNode('Item')],
        });

      const { container } = renderComponent(component);

      const stackEl = container.querySelector('div') as HTMLElement;
      expect(stackEl.style.alignItems).toBe('baseline');
    });
  });

  describe('Justification', () => {
    it('should justify content to start', () => {
      const component = () =>
        Stack({
          justify: 'start',
          children: [document.createTextNode('Item')],
        });

      const { container } = renderComponent(component);

      const stackEl = container.querySelector('div') as HTMLElement;
      expect(stackEl.style.justifyContent).toBe('flex-start');
    });

    it('should justify content to center', () => {
      const component = () =>
        Stack({
          justify: 'center',
          children: [document.createTextNode('Item')],
        });

      const { container } = renderComponent(component);

      const stackEl = container.querySelector('div') as HTMLElement;
      expect(stackEl.style.justifyContent).toBe('center');
    });

    it('should justify content to end', () => {
      const component = () =>
        Stack({
          justify: 'end',
          children: [document.createTextNode('Item')],
        });

      const { container } = renderComponent(component);

      const stackEl = container.querySelector('div') as HTMLElement;
      expect(stackEl.style.justifyContent).toBe('flex-end');
    });

    it('should justify with space-between', () => {
      const component = () =>
        Stack({
          justify: 'space-between',
          children: [document.createTextNode('Item')],
        });

      const { container } = renderComponent(component);

      const stackEl = container.querySelector('div') as HTMLElement;
      expect(stackEl.style.justifyContent).toBe('space-between');
    });

    it('should justify with space-around', () => {
      const component = () =>
        Stack({
          justify: 'space-around',
          children: [document.createTextNode('Item')],
        });

      const { container } = renderComponent(component);

      const stackEl = container.querySelector('div') as HTMLElement;
      expect(stackEl.style.justifyContent).toBe('space-around');
    });

    it('should justify with space-evenly', () => {
      const component = () =>
        Stack({
          justify: 'space-evenly',
          children: [document.createTextNode('Item')],
        });

      const { container } = renderComponent(component);

      const stackEl = container.querySelector('div') as HTMLElement;
      expect(stackEl.style.justifyContent).toBe('space-evenly');
    });
  });

  describe('Wrapping', () => {
    it('should enable wrapping when wrap is true', () => {
      const component = () =>
        Stack({
          wrap: true,
          children: [document.createTextNode('Item')],
        });

      const { container } = renderComponent(component);

      const stackEl = container.querySelector('div') as HTMLElement;
      expect(stackEl.style.flexWrap).toBe('wrap');
    });

    it('should not set flexWrap when wrap is false', () => {
      const component = () =>
        Stack({
          wrap: false,
          children: [document.createTextNode('Item')],
        });

      const { container } = renderComponent(component);

      const stackEl = container.querySelector('div') as HTMLElement;
      expect(stackEl.style.flexWrap).toBe('');
    });

    it('should not set flexWrap by default', () => {
      const component = () =>
        Stack({
          children: [document.createTextNode('Item')],
        });

      const { container } = renderComponent(component);

      const stackEl = container.querySelector('div') as HTMLElement;
      expect(stackEl.style.flexWrap).toBe('');
    });
  });

  describe('Divider support', () => {
    it('should render dividers between children', () => {
      // Use a function to create new divider each time
      const divider = document.createElement('hr');
      divider.setAttribute('data-divider', '');

      const item1 = document.createElement('div');
      item1.className = 'item-1';
      item1.textContent = 'Item 1';
      const item2 = document.createElement('div');
      item2.className = 'item-2';
      item2.textContent = 'Item 2';
      const item3 = document.createElement('div');
      item3.className = 'item-3';
      item3.textContent = 'Item 3';

      const component = () =>
        Stack({
          divider,
          children: [item1, item2, item3],
        });

      const { container } = renderComponent(component);

      const stackEl = container.querySelector('div') as HTMLElement;

      // Verify that we have 3 items
      expect(container.querySelectorAll('.item-1').length).toBe(1);
      expect(container.querySelectorAll('.item-2').length).toBe(1);
      expect(container.querySelectorAll('.item-3').length).toBe(1);

      // The stack should have 5 direct children (3 items + 2 divider wrappers)
      expect(stackEl.children.length).toBe(5);

      // Verify the order: item, divider wrapper, item, divider wrapper, item
      const children = Array.from(stackEl.children);
      expect(children[0].classList.contains('item-1')).toBe(true);
      expect(children[2].classList.contains('item-2')).toBe(true);
      expect(children[4].classList.contains('item-3')).toBe(true);
    });

    it('should not render divider with single child', () => {
      const divider = document.createElement('hr');
      divider.className = 'divider';

      const item = document.createElement('div');
      item.textContent = 'Item';

      const component = () =>
        Stack({
          divider,
          children: [item],
        });

      const { container } = renderComponent(component);

      const dividers = container.querySelectorAll('.divider');
      expect(dividers.length).toBe(0);
    });

    it('should not render divider when children is not an array', () => {
      const divider = document.createElement('hr');
      divider.className = 'divider';

      const item = document.createElement('div');
      item.textContent = 'Single Item';

      const component = () =>
        Stack({
          divider,
          children: item,
        });

      const { container } = renderComponent(component);

      const dividers = container.querySelectorAll('.divider');
      expect(dividers.length).toBe(0);
    });

    it('should render dividers with display: contents wrapper', () => {
      const divider = document.createElement('hr');

      const item1 = document.createElement('div');
      item1.textContent = 'Item 1';
      const item2 = document.createElement('div');
      item2.textContent = 'Item 2';

      const component = () =>
        Stack({
          divider,
          children: [item1, item2],
        });

      const { container } = renderComponent(component);

      const stackEl = container.querySelector('div') as HTMLElement;
      const dividerWrapper = stackEl.children[1] as HTMLElement;

      expect(dividerWrapper.style.display).toBe('contents');
    });
  });

  describe('Combined props', () => {
    it('should handle all layout props together', () => {
      const component = () =>
        Stack({
          direction: 'horizontal',
          spacing: 24,
          align: 'center',
          justify: 'space-between',
          wrap: true,
          children: [document.createTextNode('Item 1'), document.createTextNode('Item 2')],
        });

      const { container } = renderComponent(component);

      const stackEl = container.querySelector('div') as HTMLElement;
      expect(stackEl.style.flexDirection).toBe('row');
      expect(stackEl.style.gap).toBe('24px');
      expect(stackEl.style.alignItems).toBe('center');
      expect(stackEl.style.justifyContent).toBe('space-between');
      expect(stackEl.style.flexWrap).toBe('wrap');
    });
  });
});

describe('VStack', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('should render as vertical stack', () => {
    const component = () =>
      VStack({
        spacing: 16,
        children: [document.createTextNode('Item 1'), document.createTextNode('Item 2')],
      });

    const { container } = renderComponent(component);

    const stackEl = container.querySelector('div') as HTMLElement;
    expect(stackEl.style.flexDirection).toBe('column');
    expect(stackEl.style.gap).toBe('16px');
  });

  it('should pass through all Stack props except direction', () => {
    const component = () =>
      VStack({
        spacing: 20,
        align: 'center',
        justify: 'center',
        class: 'vstack-test',
        children: [document.createTextNode('Item')],
      });

    const { container } = renderComponent(component);

    const stackEl = container.querySelector('.vstack-test') as HTMLElement;
    expect(stackEl.style.flexDirection).toBe('column');
    expect(stackEl.style.gap).toBe('20px');
    expect(stackEl.style.alignItems).toBe('center');
    expect(stackEl.style.justifyContent).toBe('center');
  });
});

describe('HStack', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('should render as horizontal stack', () => {
    const component = () =>
      HStack({
        spacing: 8,
        children: [document.createTextNode('Item 1'), document.createTextNode('Item 2')],
      });

    const { container } = renderComponent(component);

    const stackEl = container.querySelector('div') as HTMLElement;
    expect(stackEl.style.flexDirection).toBe('row');
    expect(stackEl.style.gap).toBe('8px');
  });

  it('should pass through all Stack props except direction', () => {
    const component = () =>
      HStack({
        spacing: 12,
        align: 'baseline',
        justify: 'end',
        wrap: true,
        class: 'hstack-test',
        children: [document.createTextNode('Item')],
      });

    const { container } = renderComponent(component);

    const stackEl = container.querySelector('.hstack-test') as HTMLElement;
    expect(stackEl.style.flexDirection).toBe('row');
    expect(stackEl.style.gap).toBe('12px');
    expect(stackEl.style.alignItems).toBe('baseline');
    expect(stackEl.style.justifyContent).toBe('flex-end');
    expect(stackEl.style.flexWrap).toBe('wrap');
  });
});

describe('Accessibility', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('should allow ARIA attributes', () => {
    const component = () =>
      Stack({
        'aria-label': 'Navigation menu',
        role: 'navigation',
        children: [document.createTextNode('Item')],
      });

    const { container } = renderComponent(component);

    const stackEl = container.querySelector('div') as HTMLElement;
    expect(stackEl.getAttribute('aria-label')).toBe('Navigation menu');
    expect(stackEl.getAttribute('role')).toBe('navigation');
  });

  it('should maintain visual and DOM order for screen readers', () => {
    const item1 = document.createElement('div');
    item1.textContent = 'First';
    const item2 = document.createElement('div');
    item2.textContent = 'Second';
    const item3 = document.createElement('div');
    item3.textContent = 'Third';

    const component = () =>
      Stack({
        children: [item1, item2, item3],
      });

    const { container } = renderComponent(component);

    const stackEl = container.querySelector('div') as HTMLElement;
    const textContent = stackEl.textContent;

    expect(textContent).toBe('FirstSecondThird');
  });
});
