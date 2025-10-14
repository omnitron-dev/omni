/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Center } from '../../../src/primitives/Center.js';
import { renderComponent } from '../../helpers/test-utils.js';

describe('Center', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('Basic functionality', () => {
    it('should render a div element', () => {
      const component = () => Center({});

      const { container } = renderComponent(component);

      const centerEl = container.querySelector('div');
      expect(centerEl).toBeTruthy();
    });

    it('should render children', () => {
      const component = () =>
        Center({
          children: 'Centered content',
        });

      const { container } = renderComponent(component);

      expect(container.textContent).toBe('Centered content');
    });

    it('should apply custom class name', () => {
      const component = () =>
        Center({
          class: 'custom-center',
        });

      const { container } = renderComponent(component);

      const centerEl = container.querySelector('.custom-center');
      expect(centerEl).toBeTruthy();
    });

    it('should forward additional props', () => {
      const component = () =>
        Center({
          id: 'test-center',
          'data-testid': 'center-element',
        });

      const { container } = renderComponent(component);

      const centerEl = container.querySelector('#test-center') as HTMLElement;
      expect(centerEl).toBeTruthy();
      expect(centerEl.getAttribute('data-testid')).toBe('center-element');
    });
  });

  describe('Display mode', () => {
    it('should use flex display by default', () => {
      const component = () => Center({});

      const { container } = renderComponent(component);

      const centerEl = container.querySelector('div') as HTMLElement;
      expect(centerEl.style.display).toBe('flex');
    });

    it('should use inline-flex when inline prop is true', () => {
      const component = () =>
        Center({
          inline: true,
        });

      const { container } = renderComponent(component);

      const centerEl = container.querySelector('div') as HTMLElement;
      expect(centerEl.style.display).toBe('inline-flex');
    });

    it('should use flex when inline prop is false', () => {
      const component = () =>
        Center({
          inline: false,
        });

      const { container } = renderComponent(component);

      const centerEl = container.querySelector('div') as HTMLElement;
      expect(centerEl.style.display).toBe('flex');
    });
  });

  describe('Flexbox alignment', () => {
    it('should center content horizontally with justifyContent', () => {
      const component = () => Center({});

      const { container } = renderComponent(component);

      const centerEl = container.querySelector('div') as HTMLElement;
      expect(centerEl.style.justifyContent).toBe('center');
    });

    it('should center content vertically with alignItems', () => {
      const component = () => Center({});

      const { container } = renderComponent(component);

      const centerEl = container.querySelector('div') as HTMLElement;
      expect(centerEl.style.alignItems).toBe('center');
    });
  });

  describe('Width prop', () => {
    it('should not set width when prop is undefined', () => {
      const component = () => Center({});

      const { container } = renderComponent(component);

      const centerEl = container.querySelector('div') as HTMLElement;
      expect(centerEl.style.width).toBe('');
    });

    it('should convert number width to pixels', () => {
      const component = () =>
        Center({
          width: 400,
        });

      const { container } = renderComponent(component);

      const centerEl = container.querySelector('div') as HTMLElement;
      expect(centerEl.style.width).toBe('400px');
    });

    it('should use string width as-is', () => {
      const component = () =>
        Center({
          width: '50%',
        });

      const { container } = renderComponent(component);

      const centerEl = container.querySelector('div') as HTMLElement;
      expect(centerEl.style.width).toBe('50%');
    });

    it('should support CSS units in string width', () => {
      const component = () =>
        Center({
          width: '20rem',
        });

      const { container } = renderComponent(component);

      const centerEl = container.querySelector('div') as HTMLElement;
      expect(centerEl.style.width).toBe('20rem');
    });

    it('should support viewport width units', () => {
      const component = () =>
        Center({
          width: '80vw',
        });

      const { container } = renderComponent(component);

      const centerEl = container.querySelector('div') as HTMLElement;
      expect(centerEl.style.width).toBe('80vw');
    });

    it('should handle width value of 0', () => {
      const component = () =>
        Center({
          width: 0,
        });

      const { container } = renderComponent(component);

      const centerEl = container.querySelector('div') as HTMLElement;
      expect(centerEl.style.width).toBe('0px');
    });
  });

  describe('Height prop', () => {
    it('should not set height when prop is undefined', () => {
      const component = () => Center({});

      const { container } = renderComponent(component);

      const centerEl = container.querySelector('div') as HTMLElement;
      expect(centerEl.style.height).toBe('');
    });

    it('should convert number height to pixels', () => {
      const component = () =>
        Center({
          height: 300,
        });

      const { container } = renderComponent(component);

      const centerEl = container.querySelector('div') as HTMLElement;
      expect(centerEl.style.height).toBe('300px');
    });

    it('should use string height as-is', () => {
      const component = () =>
        Center({
          height: '100vh',
        });

      const { container } = renderComponent(component);

      const centerEl = container.querySelector('div') as HTMLElement;
      expect(centerEl.style.height).toBe('100vh');
    });

    it('should support CSS units in string height', () => {
      const component = () =>
        Center({
          height: '15rem',
        });

      const { container } = renderComponent(component);

      const centerEl = container.querySelector('div') as HTMLElement;
      expect(centerEl.style.height).toBe('15rem');
    });

    it('should support percentage heights', () => {
      const component = () =>
        Center({
          height: '75%',
        });

      const { container } = renderComponent(component);

      const centerEl = container.querySelector('div') as HTMLElement;
      expect(centerEl.style.height).toBe('75%');
    });

    it('should handle height value of 0', () => {
      const component = () =>
        Center({
          height: 0,
        });

      const { container } = renderComponent(component);

      const centerEl = container.querySelector('div') as HTMLElement;
      expect(centerEl.style.height).toBe('0px');
    });
  });

  describe('Combined width and height', () => {
    it('should apply both width and height when provided', () => {
      const component = () =>
        Center({
          width: 400,
          height: 300,
        });

      const { container } = renderComponent(component);

      const centerEl = container.querySelector('div') as HTMLElement;
      expect(centerEl.style.width).toBe('400px');
      expect(centerEl.style.height).toBe('300px');
    });

    it('should handle mixed number and string dimensions', () => {
      const component = () =>
        Center({
          width: 500,
          height: '50vh',
        });

      const { container } = renderComponent(component);

      const centerEl = container.querySelector('div') as HTMLElement;
      expect(centerEl.style.width).toBe('500px');
      expect(centerEl.style.height).toBe('50vh');
    });
  });

  describe('Custom styles', () => {
    it('should merge custom styles with default styles', () => {
      const component = () =>
        Center({
          style: {
            backgroundColor: 'red',
            padding: '20px',
          },
        });

      const { container } = renderComponent(component);

      const centerEl = container.querySelector('div') as HTMLElement;
      expect(centerEl.style.display).toBe('flex');
      expect(centerEl.style.justifyContent).toBe('center');
      expect(centerEl.style.alignItems).toBe('center');
      expect(centerEl.style.backgroundColor).toBe('red');
      expect(centerEl.style.padding).toBe('20px');
    });

    it('should allow overriding default styles', () => {
      const component = () =>
        Center({
          style: {
            justifyContent: 'flex-start',
            alignItems: 'flex-end',
          },
        });

      const { container } = renderComponent(component);

      const centerEl = container.querySelector('div') as HTMLElement;
      expect(centerEl.style.justifyContent).toBe('flex-start');
      expect(centerEl.style.alignItems).toBe('flex-end');
    });

    it('should allow overriding display mode via styles', () => {
      const component = () =>
        Center({
          style: {
            display: 'grid',
          },
        });

      const { container } = renderComponent(component);

      const centerEl = container.querySelector('div') as HTMLElement;
      expect(centerEl.style.display).toBe('grid');
    });
  });

  describe('Complex children', () => {
    it('should center multiple child elements', () => {
      const component = () =>
        Center({
          children: [document.createTextNode('First'), document.createTextNode(' Second')],
        });

      const { container } = renderComponent(component);

      expect(container.textContent).toContain('First');
      expect(container.textContent).toContain('Second');
    });

    it('should center nested elements', () => {
      const child = document.createElement('div');
      child.className = 'child';
      child.textContent = 'Nested content';

      const component = () =>
        Center({
          children: child,
        });

      const { container } = renderComponent(component);

      const childEl = container.querySelector('.child');
      expect(childEl).toBeTruthy();
      expect(childEl?.textContent).toBe('Nested content');
    });
  });

  describe('Real-world use cases', () => {
    it('should work for full viewport centering', () => {
      const component = () =>
        Center({
          height: '100vh',
          width: '100vw',
          children: 'Welcome',
        });

      const { container } = renderComponent(component);

      const centerEl = container.querySelector('div') as HTMLElement;
      expect(centerEl.style.height).toBe('100vh');
      expect(centerEl.style.width).toBe('100vw');
      expect(centerEl.style.display).toBe('flex');
      expect(container.textContent).toBe('Welcome');
    });

    it('should work for card centering', () => {
      const component = () =>
        Center({
          width: 400,
          height: 300,
          style: {
            border: '1px solid #ccc',
            borderRadius: '8px',
          },
        });

      const { container } = renderComponent(component);

      const centerEl = container.querySelector('div') as HTMLElement;
      expect(centerEl.style.border).toBe('1px solid #ccc');
      expect(centerEl.style.borderRadius).toBe('8px');
    });

    it('should work for inline icon centering', () => {
      const component = () =>
        Center({
          inline: true,
          width: 24,
          height: 24,
        });

      const { container } = renderComponent(component);

      const centerEl = container.querySelector('div') as HTMLElement;
      expect(centerEl.style.display).toBe('inline-flex');
      expect(centerEl.style.width).toBe('24px');
      expect(centerEl.style.height).toBe('24px');
    });

    it('should work for loading spinner centering', () => {
      const spinner = document.createElement('div');
      spinner.className = 'spinner';

      const component = () =>
        Center({
          height: '100vh',
          children: spinner,
        });

      const { container } = renderComponent(component);

      const spinnerEl = container.querySelector('.spinner');
      expect(spinnerEl).toBeTruthy();

      const centerEl = container.querySelector('div') as HTMLElement;
      expect(centerEl.style.height).toBe('100vh');
    });
  });

  describe('Accessibility', () => {
    it('should be a generic div with no semantic meaning', () => {
      const component = () => Center({});

      const { container } = renderComponent(component);

      const centerEl = container.querySelector('div') as HTMLElement;
      expect(centerEl.tagName).toBe('DIV');
      expect(centerEl.getAttribute('role')).toBeNull();
    });

    it('should allow adding ARIA attributes', () => {
      const component = () =>
        Center({
          'aria-label': 'Centered content',
          role: 'region',
        });

      const { container } = renderComponent(component);

      const centerEl = container.querySelector('div') as HTMLElement;
      expect(centerEl.getAttribute('aria-label')).toBe('Centered content');
      expect(centerEl.getAttribute('role')).toBe('region');
    });

    it('should not interfere with child element accessibility', () => {
      const button = document.createElement('button');
      button.textContent = 'Click me';
      button.setAttribute('aria-label', 'Action button');

      const component = () =>
        Center({
          children: button,
        });

      const { container } = renderComponent(component);

      const buttonEl = container.querySelector('button') as HTMLElement;
      expect(buttonEl.getAttribute('aria-label')).toBe('Action button');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty children', () => {
      const component = () =>
        Center({
          children: '',
        });

      const { container } = renderComponent(component);

      expect(container.textContent).toBe('');
    });

    it('should handle null children', () => {
      const component = () =>
        Center({
          children: null,
        });

      const { container } = renderComponent(component);

      expect(container.textContent).toBe('');
    });

    it('should handle undefined children', () => {
      const component = () =>
        Center({
          children: undefined,
        });

      const { container } = renderComponent(component);

      expect(container.textContent).toBe('');
    });

    it('should handle numeric children', () => {
      const component = () =>
        Center({
          children: 42,
        });

      const { container } = renderComponent(component);

      expect(container.textContent).toBe('42');
    });

    it('should handle boolean children', () => {
      const component = () =>
        Center({
          children: false,
        });

      const { container } = renderComponent(component);

      // Boolean children typically don't render
      expect(container.querySelector('div')).toBeTruthy();
    });
  });

  describe('Style priority', () => {
    it('should allow custom styles to override default center styles', () => {
      const component = () =>
        Center({
          width: 200,
          height: 150,
          style: {
            width: '300px',
            height: '250px',
          },
        });

      const { container } = renderComponent(component);

      const centerEl = container.querySelector('div') as HTMLElement;
      // Custom styles should take precedence
      expect(centerEl.style.width).toBe('300px');
      expect(centerEl.style.height).toBe('250px');
    });

    it('should maintain flex styles even with custom styles', () => {
      const component = () =>
        Center({
          style: {
            border: '1px solid blue',
            padding: '10px',
          },
        });

      const { container } = renderComponent(component);

      const centerEl = container.querySelector('div') as HTMLElement;
      expect(centerEl.style.display).toBe('flex');
      expect(centerEl.style.justifyContent).toBe('center');
      expect(centerEl.style.alignItems).toBe('center');
      expect(centerEl.style.border).toBe('1px solid blue');
      expect(centerEl.style.padding).toBe('10px');
    });
  });
});
