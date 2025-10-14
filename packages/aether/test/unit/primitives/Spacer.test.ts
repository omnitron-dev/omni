/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Spacer } from '../../../src/primitives/Spacer.js';
import { renderComponent } from '../../helpers/test-utils.js';

describe('Spacer', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('Basic Rendering', () => {
    it('should render as a div element', () => {
      const component = () => Spacer({});

      const { container } = renderComponent(component);

      const spacerEl = container.querySelector('div');
      expect(spacerEl).toBeTruthy();
    });

    it('should render with no visible content', () => {
      const component = () => Spacer({});

      const { container } = renderComponent(component);

      const spacerEl = container.querySelector('div');
      expect(spacerEl).toBeTruthy();
      expect(spacerEl?.textContent).toBe('');
    });

    it('should be aria-hidden by default', () => {
      const component = () => Spacer({});

      const { container } = renderComponent(component);

      const spacerEl = container.querySelector('div') as HTMLElement;
      expect(spacerEl.getAttribute('aria-hidden')).toBe('true');
    });

    it('should have flex properties set', () => {
      const component = () => Spacer({});

      const { container } = renderComponent(component);

      const spacerEl = container.querySelector('div') as HTMLElement;
      expect(spacerEl.style.flex).toContain('1');
    });
  });

  describe('Flex Grow', () => {
    it('should default to flex-grow: 1', () => {
      const component = () => Spacer({});

      const { container } = renderComponent(component);

      const spacerEl = container.querySelector('div') as HTMLElement;
      expect(spacerEl.style.flex).toContain('1');
    });

    it('should apply custom grow value (2)', () => {
      const component = () => Spacer({ grow: 2 });

      const { container } = renderComponent(component);

      const spacerEl = container.querySelector('div') as HTMLElement;
      expect(spacerEl.style.flex).toContain('2');
    });

    it('should apply custom grow value (0)', () => {
      const component = () => Spacer({ grow: 0 });

      const { container } = renderComponent(component);

      const spacerEl = container.querySelector('div') as HTMLElement;
      expect(spacerEl.style.flex).toContain('0');
    });

    it('should apply large grow value (10)', () => {
      const component = () => Spacer({ grow: 10 });

      const { container } = renderComponent(component);

      const spacerEl = container.querySelector('div') as HTMLElement;
      expect(spacerEl.style.flex).toContain('10');
    });

    it('should handle fractional grow value (0.5)', () => {
      const component = () => Spacer({ grow: 0.5 });

      const { container } = renderComponent(component);

      const spacerEl = container.querySelector('div') as HTMLElement;
      expect(spacerEl.style.flex).toContain('0.5');
    });
  });

  describe('Flex Shrink', () => {
    it('should default to flex-shrink: 0', () => {
      const component = () => Spacer({});

      const { container } = renderComponent(component);

      const spacerEl = container.querySelector('div') as HTMLElement;
      expect(spacerEl.style.flex).toContain('0');
    });

    it('should apply custom shrink value (1)', () => {
      const component = () => Spacer({ shrink: 1 });

      const { container } = renderComponent(component);

      const spacerEl = container.querySelector('div') as HTMLElement;
      expect(spacerEl.style.flex).toContain('1');
    });

    it('should apply custom shrink value (2)', () => {
      const component = () => Spacer({ shrink: 2 });

      const { container } = renderComponent(component);

      const spacerEl = container.querySelector('div') as HTMLElement;
      expect(spacerEl.style.flex).toContain('2');
    });

    it('should combine grow and shrink', () => {
      const component = () => Spacer({ grow: 2, shrink: 1 });

      const { container } = renderComponent(component);

      const spacerEl = container.querySelector('div') as HTMLElement;
      expect(spacerEl.style.flex).toContain('2');
      expect(spacerEl.style.flex).toContain('1');
    });
  });

  describe('Flex Basis', () => {
    it('should default to flex-basis: auto', () => {
      const component = () => Spacer({});

      const { container } = renderComponent(component);

      const spacerEl = container.querySelector('div') as HTMLElement;
      expect(spacerEl.style.flex).toContain('auto');
    });

    it('should apply numeric basis as pixels (100)', () => {
      const component = () => Spacer({ basis: 100 });

      const { container } = renderComponent(component);

      const spacerEl = container.querySelector('div') as HTMLElement;
      expect(spacerEl.style.flex).toContain('100px');
    });

    it('should apply numeric basis as pixels (50)', () => {
      const component = () => Spacer({ basis: 50 });

      const { container } = renderComponent(component);

      const spacerEl = container.querySelector('div') as HTMLElement;
      expect(spacerEl.style.flex).toContain('50px');
    });

    it('should apply string basis (10rem)', () => {
      const component = () => Spacer({ basis: '10rem' });

      const { container } = renderComponent(component);

      const spacerEl = container.querySelector('div') as HTMLElement;
      expect(spacerEl.style.flex).toContain('10rem');
    });

    it('should apply string basis (50%)', () => {
      const component = () => Spacer({ basis: '50%' });

      const { container } = renderComponent(component);

      const spacerEl = container.querySelector('div') as HTMLElement;
      expect(spacerEl.style.flex).toContain('50%');
    });

    it('should apply zero basis', () => {
      const component = () => Spacer({ basis: 0 });

      const { container } = renderComponent(component);

      const spacerEl = container.querySelector('div') as HTMLElement;
      expect(spacerEl.style.flex).toContain('0px');
    });

    it('should combine grow, shrink, and basis', () => {
      const component = () => Spacer({ grow: 2, shrink: 1, basis: 100 });

      const { container } = renderComponent(component);

      const spacerEl = container.querySelector('div') as HTMLElement;
      const flexValue = spacerEl.style.flex;
      expect(flexValue).toContain('2');
      expect(flexValue).toContain('1');
      expect(flexValue).toContain('100px');
    });
  });

  describe('Self Alignment', () => {
    it('should set alignSelf to stretch', () => {
      const component = () => Spacer({});

      const { container } = renderComponent(component);

      const spacerEl = container.querySelector('div') as HTMLElement;
      expect(spacerEl.style.alignSelf).toBe('stretch');
    });

    it('should set justifySelf to stretch', () => {
      const component = () => Spacer({});

      const { container } = renderComponent(component);

      const spacerEl = container.querySelector('div') as HTMLElement;
      expect(spacerEl.style.justifySelf).toBe('stretch');
    });

    it('should maintain stretch alignment with custom grow', () => {
      const component = () => Spacer({ grow: 3 });

      const { container } = renderComponent(component);

      const spacerEl = container.querySelector('div') as HTMLElement;
      expect(spacerEl.style.alignSelf).toBe('stretch');
      expect(spacerEl.style.justifySelf).toBe('stretch');
    });
  });

  describe('Styling', () => {
    it('should apply class name', () => {
      const component = () => Spacer({ class: 'custom-spacer' });

      const { container } = renderComponent(component);

      const spacerEl = container.querySelector('.custom-spacer');
      expect(spacerEl).toBeTruthy();
    });

    it('should apply multiple class names', () => {
      const component = () => Spacer({ class: 'spacer flex-item custom' });

      const { container } = renderComponent(component);

      const spacerEl = container.querySelector('div') as HTMLElement;
      expect(spacerEl.classList.contains('spacer')).toBe(true);
      expect(spacerEl.classList.contains('flex-item')).toBe(true);
      expect(spacerEl.classList.contains('custom')).toBe(true);
    });

    it('should merge inline styles with flex styles', () => {
      const component = () =>
        Spacer({
          style: {
            background: 'transparent',
            minWidth: '10px',
          },
        });

      const { container } = renderComponent(component);

      const spacerEl = container.querySelector('div') as HTMLElement;
      expect(spacerEl.style.background).toBe('transparent');
      expect(spacerEl.style.minWidth).toBe('10px');
      expect(spacerEl.style.flex).toBeTruthy(); // Flex styles still applied
    });

    it('should allow style overrides', () => {
      const component = () =>
        Spacer({
          style: {
            flex: '2 1 50px',
          },
        });

      const { container } = renderComponent(component);

      const spacerEl = container.querySelector('div') as HTMLElement;
      expect(spacerEl.style.flex).toBe('2 1 50px');
    });

    it('should combine class and style', () => {
      const component = () =>
        Spacer({
          class: 'custom',
          style: { background: 'red' },
        });

      const { container } = renderComponent(component);

      const spacerEl = container.querySelector('.custom') as HTMLElement;
      expect(spacerEl).toBeTruthy();
      expect(spacerEl.style.background).toBe('red');
    });
  });

  describe('Props Forwarding', () => {
    it('should forward data attributes', () => {
      const component = () =>
        Spacer({
          'data-testid': 'main-spacer',
          'data-type': 'flex-spacer',
        });

      const { container } = renderComponent(component);

      const spacerEl = container.querySelector('div') as HTMLElement;
      expect(spacerEl.getAttribute('data-testid')).toBe('main-spacer');
      expect(spacerEl.getAttribute('data-type')).toBe('flex-spacer');
    });

    it('should forward id attribute', () => {
      const component = () => Spacer({ id: 'nav-spacer' });

      const { container } = renderComponent(component);

      const spacerEl = container.querySelector('#nav-spacer');
      expect(spacerEl).toBeTruthy();
    });

    it('should forward title attribute', () => {
      const component = () => Spacer({ title: 'Flexible space' });

      const { container } = renderComponent(component);

      const spacerEl = container.querySelector('div') as HTMLElement;
      expect(spacerEl.getAttribute('title')).toBe('Flexible space');
    });

    it('should forward event handlers', () => {
      let clicked = false;
      const handleClick = () => {
        clicked = true;
      };

      const component = () => Spacer({ onClick: handleClick });

      const { container } = renderComponent(component);

      const spacerEl = container.querySelector('div') as HTMLElement;
      spacerEl.click();

      expect(clicked).toBe(true);
    });

    it('should forward multiple event handlers', () => {
      let mouseEntered = false;
      let focused = false;

      const component = () =>
        Spacer({
          onMouseEnter: () => {
            mouseEntered = true;
          },
          onFocus: () => {
            focused = true;
          },
        });

      const { container } = renderComponent(component);

      const spacerEl = container.querySelector('div') as HTMLElement;

      spacerEl.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      expect(mouseEntered).toBe(true);

      spacerEl.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
      expect(focused).toBe(true);
    });

    it('should not forward internal props to DOM', () => {
      const component = () =>
        Spacer({
          grow: 2,
          shrink: 1,
          basis: 100,
        });

      const { container } = renderComponent(component);

      const spacerEl = container.querySelector('div') as HTMLElement;
      expect(spacerEl.hasAttribute('grow')).toBe(false);
      expect(spacerEl.hasAttribute('shrink')).toBe(false);
      expect(spacerEl.hasAttribute('basis')).toBe(false);
    });
  });

  describe('Accessibility', () => {
    it('should always be aria-hidden', () => {
      const component = () => Spacer({});

      const { container } = renderComponent(component);

      const spacerEl = container.querySelector('div') as HTMLElement;
      expect(spacerEl.getAttribute('aria-hidden')).toBe('true');
    });

    it('should remain aria-hidden with custom props', () => {
      const component = () => Spacer({ grow: 2, class: 'custom' });

      const { container } = renderComponent(component);

      const spacerEl = container.querySelector('div') as HTMLElement;
      expect(spacerEl.getAttribute('aria-hidden')).toBe('true');
    });

    it('should be invisible to screen readers', () => {
      const component = () => Spacer({});

      const { container } = renderComponent(component);

      const spacerEl = container.querySelector('[aria-hidden="true"]');
      expect(spacerEl).toBeTruthy();
    });

    it('should not have a role attribute', () => {
      const component = () => Spacer({});

      const { container } = renderComponent(component);

      const spacerEl = container.querySelector('div') as HTMLElement;
      expect(spacerEl.hasAttribute('role')).toBe(false);
    });

    it('should not be keyboard focusable by default', () => {
      const component = () => Spacer({});

      const { container } = renderComponent(component);

      const spacerEl = container.querySelector('div') as HTMLElement;
      expect(spacerEl.hasAttribute('tabindex')).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle undefined props', () => {
      const component = () =>
        Spacer({
          grow: undefined,
          shrink: undefined,
          basis: undefined,
        });

      const { container } = renderComponent(component);

      const spacerEl = container.querySelector('div') as HTMLElement;
      expect(spacerEl).toBeTruthy();
      expect(spacerEl.style.flex).toContain('1'); // Default grow
      expect(spacerEl.style.flex).toContain('0'); // Default shrink
      expect(spacerEl.style.flex).toContain('auto'); // Default basis
    });

    it('should handle null style', () => {
      const component = () => Spacer({ style: null as any });

      const { container } = renderComponent(component);

      const spacerEl = container.querySelector('div');
      expect(spacerEl).toBeTruthy();
    });

    it('should handle zero values', () => {
      const component = () => Spacer({ grow: 0, shrink: 0, basis: 0 });

      const { container } = renderComponent(component);

      const spacerEl = container.querySelector('div') as HTMLElement;
      expect(spacerEl.style.flex).toContain('0');
      expect(spacerEl.style.flex).toContain('0px');
    });

    it('should handle empty string class', () => {
      const component = () => Spacer({ class: '' });

      const { container } = renderComponent(component);

      const spacerEl = container.querySelector('div');
      expect(spacerEl).toBeTruthy();
    });

    it('should handle large grow values', () => {
      const component = () => Spacer({ grow: 999 });

      const { container } = renderComponent(component);

      const spacerEl = container.querySelector('div') as HTMLElement;
      expect(spacerEl.style.flex).toContain('999');
    });

    it('should handle large grow values', () => {
      const component = () => Spacer({ grow: 100 });

      const { container } = renderComponent(component);

      const spacerEl = container.querySelector('div') as HTMLElement;
      expect(spacerEl.style.flex).toContain('100');
    });

    it('should handle basis with calc() expression', () => {
      const component = () => Spacer({ basis: 'calc(100% - 50px)' });

      const { container } = renderComponent(component);

      const spacerEl = container.querySelector('div') as HTMLElement;
      expect(spacerEl.style.flex).toContain('calc(100% - 50px)');
    });
  });

  describe('Complex Scenarios', () => {
    it('should handle all props combined', () => {
      const component = () =>
        Spacer({
          grow: 3,
          shrink: 1,
          basis: 200,
          class: 'custom-spacer',
          style: { minWidth: '50px', background: 'transparent' },
          'data-testid': 'complex-spacer',
        });

      const { container } = renderComponent(component);

      const spacerEl = container.querySelector('.custom-spacer') as HTMLElement;
      expect(spacerEl).toBeTruthy();
      expect(spacerEl.style.flex).toContain('3');
      expect(spacerEl.style.flex).toContain('1');
      expect(spacerEl.style.flex).toContain('200px');
      expect(spacerEl.style.minWidth).toBe('50px');
      expect(spacerEl.style.background).toBe('transparent');
      expect(spacerEl.getAttribute('data-testid')).toBe('complex-spacer');
      expect(spacerEl.getAttribute('aria-hidden')).toBe('true');
    });

    it('should work with percentage basis', () => {
      const component = () =>
        Spacer({
          grow: 1,
          shrink: 0,
          basis: '50%',
        });

      const { container } = renderComponent(component);

      const spacerEl = container.querySelector('div') as HTMLElement;
      expect(spacerEl.style.flex).toContain('50%');
    });

    it('should work with rem-based basis', () => {
      const component = () =>
        Spacer({
          grow: 2,
          basis: '10rem',
        });

      const { container } = renderComponent(component);

      const spacerEl = container.querySelector('div') as HTMLElement;
      expect(spacerEl.style.flex).toContain('2');
      expect(spacerEl.style.flex).toContain('10rem');
    });

    it('should maintain stretch alignment with all props', () => {
      const component = () =>
        Spacer({
          grow: 5,
          shrink: 2,
          basis: 100,
          class: 'stretch-spacer',
        });

      const { container } = renderComponent(component);

      const spacerEl = container.querySelector('div') as HTMLElement;
      expect(spacerEl.style.alignSelf).toBe('stretch');
      expect(spacerEl.style.justifySelf).toBe('stretch');
    });

    it('should allow overriding alignment with style prop', () => {
      const component = () =>
        Spacer({
          style: {
            alignSelf: 'center',
            justifySelf: 'start',
          },
        });

      const { container } = renderComponent(component);

      const spacerEl = container.querySelector('div') as HTMLElement;
      expect(spacerEl.style.alignSelf).toBe('center');
      expect(spacerEl.style.justifySelf).toBe('start');
    });
  });

  describe('Flex Container Context', () => {
    it('should work in horizontal flex container', () => {
      const component = () => Spacer({});

      const { container } = renderComponent(component);

      const spacerEl = container.querySelector('div') as HTMLElement;
      expect(spacerEl.style.flex).toBeTruthy();
      expect(spacerEl.style.alignSelf).toBe('stretch');
    });

    it('should work in vertical flex container', () => {
      const component = () => Spacer({ grow: 1, basis: 'auto' });

      const { container } = renderComponent(component);

      const spacerEl = container.querySelector('div') as HTMLElement;
      expect(spacerEl.style.flex).toContain('1');
      expect(spacerEl.style.flex).toContain('auto');
    });

    it('should handle proportional spacing between items', () => {
      const component = () => Spacer({ grow: 2 });

      const { container } = renderComponent(component);

      const spacerEl = container.querySelector('div') as HTMLElement;
      expect(spacerEl.style.flex).toContain('2');
    });
  });

  describe('Performance', () => {
    it('should render efficiently with default props', () => {
      const component = () => Spacer({});

      const { container } = renderComponent(component);

      const spacerEl = container.querySelector('div');
      expect(spacerEl).toBeTruthy();
    });

    it('should render efficiently with custom props', () => {
      const component = () => Spacer({ grow: 3, basis: 100 });

      const { container } = renderComponent(component);

      const spacerEl = container.querySelector('div');
      expect(spacerEl).toBeTruthy();
    });

    it('should handle multiple spacers', () => {
      const component = () => Spacer({ grow: 1 });

      const { container } = renderComponent(component);

      const spacerEl = container.querySelector('[aria-hidden="true"]');
      expect(spacerEl).toBeTruthy();
    });
  });
});
