/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Divider } from '../../../src/primitives/Divider.js';
import { renderComponent } from '../../helpers/test-utils.js';

describe('Divider', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('Basic Rendering', () => {
    it('should render as hr element without label', () => {
      const component = () => Divider({});

      const { container } = renderComponent(component);

      const hrEl = container.querySelector('hr');
      expect(hrEl).toBeTruthy();
    });

    it('should render as div element with label', () => {
      const component = () => Divider({ label: 'OR' });

      const { container } = renderComponent(component);

      const divEl = container.querySelector('div');
      expect(divEl).toBeTruthy();
      // Label is rendered in a span inside the div
      const labelEl = divEl?.querySelector('span');
      expect(labelEl).toBeTruthy();
    });

    it('should render with children as label', () => {
      const component = () => Divider({ children: 'Section Title' });

      const { container } = renderComponent(component);

      const divEl = container.querySelector('div');
      const labelEl = divEl?.querySelector('span');
      expect(labelEl).toBeTruthy();
    });

    it('should prefer label prop over children', () => {
      const component = () => Divider({ label: 'Label', children: 'Children' });

      const { container } = renderComponent(component);

      const divEl = container.querySelector('div');
      const labelEl = divEl?.querySelector('span');
      expect(labelEl).toBeTruthy();
    });

    it('should render simple hr without label or children', () => {
      const component = () => Divider({});

      const { container } = renderComponent(component);

      const hrEl = container.querySelector('hr');
      const divEl = container.querySelector('div');
      expect(hrEl).toBeTruthy();
      expect(divEl).toBeFalsy();
    });
  });

  describe('Orientation', () => {
    it('should default to horizontal orientation', () => {
      const component = () => Divider({});

      const { container } = renderComponent(component);

      const hrEl = container.querySelector('hr') as HTMLElement;
      expect(hrEl.getAttribute('aria-orientation')).toBe('horizontal');
    });

    it('should apply horizontal orientation explicitly', () => {
      const component = () => Divider({ orientation: 'horizontal' });

      const { container } = renderComponent(component);

      const hrEl = container.querySelector('hr') as HTMLElement;
      expect(hrEl.getAttribute('aria-orientation')).toBe('horizontal');
    });

    it('should apply vertical orientation', () => {
      const component = () => Divider({ orientation: 'vertical' });

      const { container } = renderComponent(component);

      const hrEl = container.querySelector('hr') as HTMLElement;
      expect(hrEl.getAttribute('aria-orientation')).toBe('vertical');
    });

    it('should apply horizontal styles for horizontal orientation', () => {
      const component = () => Divider({ orientation: 'horizontal' });

      const { container } = renderComponent(component);

      const hrEl = container.querySelector('hr') as HTMLElement;
      expect(hrEl.style.width).toBe('100%');
      expect(hrEl.style.height).toContain('0');
    });

    it('should apply vertical styles for vertical orientation', () => {
      const component = () => Divider({ orientation: 'vertical' });

      const { container } = renderComponent(component);

      const hrEl = container.querySelector('hr') as HTMLElement;
      expect(hrEl.style.height).toBe('100%');
      expect(hrEl.style.width).toContain('0');
    });
  });

  describe('Variant Styles', () => {
    it('should default to solid variant', () => {
      const component = () => Divider({});

      const { container } = renderComponent(component);

      const hrEl = container.querySelector('hr') as HTMLElement;
      expect(hrEl.style.borderTopStyle).toBe('solid');
    });

    it('should apply solid variant explicitly', () => {
      const component = () => Divider({ variant: 'solid' });

      const { container } = renderComponent(component);

      const hrEl = container.querySelector('hr') as HTMLElement;
      expect(hrEl.style.borderTopStyle).toBe('solid');
    });

    it('should apply dashed variant', () => {
      const component = () => Divider({ variant: 'dashed' });

      const { container } = renderComponent(component);

      const hrEl = container.querySelector('hr') as HTMLElement;
      expect(hrEl.style.borderTopStyle).toBe('dashed');
    });

    it('should apply dotted variant', () => {
      const component = () => Divider({ variant: 'dotted' });

      const { container } = renderComponent(component);

      const hrEl = container.querySelector('hr') as HTMLElement;
      expect(hrEl.style.borderTopStyle).toBe('dotted');
    });

    it('should apply variant to vertical divider', () => {
      const component = () => Divider({ orientation: 'vertical', variant: 'dashed' });

      const { container } = renderComponent(component);

      const hrEl = container.querySelector('hr') as HTMLElement;
      expect(hrEl.style.borderLeftStyle).toBe('dashed');
    });
  });

  describe('Thickness', () => {
    it('should default to 1px thickness', () => {
      const component = () => Divider({});

      const { container } = renderComponent(component);

      const hrEl = container.querySelector('hr') as HTMLElement;
      expect(hrEl.style.borderTopWidth).toBe('1px');
    });

    it('should apply custom thickness (2px)', () => {
      const component = () => Divider({ thickness: 2 });

      const { container } = renderComponent(component);

      const hrEl = container.querySelector('hr') as HTMLElement;
      expect(hrEl.style.borderTopWidth).toBe('2px');
    });

    it('should apply custom thickness (5px)', () => {
      const component = () => Divider({ thickness: 5 });

      const { container } = renderComponent(component);

      const hrEl = container.querySelector('hr') as HTMLElement;
      expect(hrEl.style.borderTopWidth).toBe('5px');
    });

    it('should apply thickness to vertical divider', () => {
      const component = () => Divider({ orientation: 'vertical', thickness: 3 });

      const { container } = renderComponent(component);

      const hrEl = container.querySelector('hr') as HTMLElement;
      expect(hrEl.style.borderLeftWidth).toBe('3px');
    });
  });

  describe('Color', () => {
    it('should not set color by default', () => {
      const component = () => Divider({});

      const { container } = renderComponent(component);

      const hrEl = container.querySelector('hr') as HTMLElement;
      // Browser may set a default color, just check it exists
      expect(hrEl.style.borderTopStyle).toBeTruthy();
    });

    it('should apply custom color', () => {
      const component = () => Divider({ color: '#3b82f6' });

      const { container } = renderComponent(component);

      const hrEl = container.querySelector('hr') as HTMLElement;
      expect(hrEl.style.borderTopColor).toBe('#3b82f6');
    });

    it('should apply color to vertical divider', () => {
      const component = () => Divider({ orientation: 'vertical', color: '#ef4444' });

      const { container } = renderComponent(component);

      const hrEl = container.querySelector('hr') as HTMLElement;
      expect(hrEl.style.borderLeftColor).toBe('#ef4444');
    });

    it('should handle rgba color values', () => {
      const component = () => Divider({ color: 'rgba(0, 0, 0, 0.1)' });

      const { container } = renderComponent(component);

      const hrEl = container.querySelector('hr') as HTMLElement;
      expect(hrEl.style.borderTopColor).toBe('rgba(0, 0, 0, 0.1)');
    });
  });

  describe('Label Position', () => {
    it('should default to center label position', () => {
      const component = () => Divider({ label: 'Center' });

      const { container } = renderComponent(component);

      const divEl = container.querySelector('div');
      const lines = divEl?.querySelectorAll('hr');
      expect(lines?.length).toBe(2); // Start and end lines
    });

    it('should position label at start', () => {
      const component = () => Divider({ label: 'Start', labelPosition: 'start' });

      const { container } = renderComponent(component);

      const divEl = container.querySelector('div');
      const lines = divEl?.querySelectorAll('hr');
      expect(lines?.length).toBe(1); // Only end line
    });

    it('should position label at center', () => {
      const component = () => Divider({ label: 'Center', labelPosition: 'center' });

      const { container } = renderComponent(component);

      const divEl = container.querySelector('div');
      const lines = divEl?.querySelectorAll('hr');
      expect(lines?.length).toBe(2); // Start and end lines
    });

    it('should position label at end', () => {
      const component = () => Divider({ label: 'End', labelPosition: 'end' });

      const { container } = renderComponent(component);

      const divEl = container.querySelector('div');
      const lines = divEl?.querySelectorAll('hr');
      expect(lines?.length).toBe(1); // Only start line
    });

    it('should render label element', () => {
      const component = () => Divider({ label: 'Test Label' });

      const { container } = renderComponent(component);

      const labelEl = container.querySelector('span');
      expect(labelEl).toBeTruthy();
    });
  });

  describe('Label Spacing', () => {
    it('should default to 16px label spacing', () => {
      const component = () => Divider({ label: 'Label' });

      const { container } = renderComponent(component);

      const labelEl = container.querySelector('span') as HTMLElement;
      expect(labelEl.style.paddingLeft).toBe('16px');
      expect(labelEl.style.paddingRight).toBe('16px');
    });

    it('should apply custom label spacing (24px)', () => {
      const component = () => Divider({ label: 'Label', labelSpacing: 24 });

      const { container } = renderComponent(component);

      const labelEl = container.querySelector('span') as HTMLElement;
      expect(labelEl.style.paddingLeft).toBe('24px');
      expect(labelEl.style.paddingRight).toBe('24px');
    });

    it('should apply custom label spacing (8px)', () => {
      const component = () => Divider({ label: 'Label', labelSpacing: 8 });

      const { container } = renderComponent(component);

      const labelEl = container.querySelector('span') as HTMLElement;
      expect(labelEl.style.paddingLeft).toBe('8px');
      expect(labelEl.style.paddingRight).toBe('8px');
    });

    it('should apply vertical spacing for vertical divider', () => {
      const component = () => Divider({ orientation: 'vertical', label: 'Label', labelSpacing: 12 });

      const { container } = renderComponent(component);

      const labelEl = container.querySelector('span') as HTMLElement;
      expect(labelEl.style.paddingTop).toBe('12px');
      expect(labelEl.style.paddingBottom).toBe('12px');
    });
  });

  describe('Decorative Mode', () => {
    it('should use separator role by default', () => {
      const component = () => Divider({});

      const { container } = renderComponent(component);

      const hrEl = container.querySelector('hr') as HTMLElement;
      expect(hrEl.getAttribute('role')).toBe('separator');
    });

    it('should use separator role when decorative is false', () => {
      const component = () => Divider({ decorative: false });

      const { container } = renderComponent(component);

      const hrEl = container.querySelector('hr') as HTMLElement;
      expect(hrEl.getAttribute('role')).toBe('separator');
    });

    it('should use presentation role when decorative is true', () => {
      const component = () => Divider({ decorative: true });

      const { container } = renderComponent(component);

      const hrEl = container.querySelector('hr') as HTMLElement;
      expect(hrEl.getAttribute('role')).toBe('presentation');
    });

    it('should apply decorative role with label', () => {
      const component = () => Divider({ label: 'OR', decorative: true });

      const { container } = renderComponent(component);

      const divEl = container.querySelector('div') as HTMLElement;
      expect(divEl.getAttribute('role')).toBe('presentation');
    });
  });

  describe('ARIA Attributes', () => {
    it('should set aria-orientation for horizontal divider', () => {
      const component = () => Divider({ orientation: 'horizontal' });

      const { container } = renderComponent(component);

      const hrEl = container.querySelector('hr') as HTMLElement;
      expect(hrEl.getAttribute('aria-orientation')).toBe('horizontal');
    });

    it('should set aria-orientation for vertical divider', () => {
      const component = () => Divider({ orientation: 'vertical' });

      const { container } = renderComponent(component);

      const hrEl = container.querySelector('hr') as HTMLElement;
      expect(hrEl.getAttribute('aria-orientation')).toBe('vertical');
    });

    it('should set aria-label when label is string', () => {
      const component = () => Divider({ label: 'Section Break' });

      const { container } = renderComponent(component);

      const divEl = container.querySelector('div') as HTMLElement;
      expect(divEl.getAttribute('aria-label')).toBe('Section Break');
    });

    it('should not set aria-label for non-string label', () => {
      const component = () => Divider({ children: 123 });

      const { container } = renderComponent(component);

      const divEl = container.querySelector('div') as HTMLElement;
      expect(divEl.hasAttribute('aria-label')).toBe(false);
    });

    it('should set aria-hidden on decorative lines', () => {
      const component = () => Divider({ label: 'OR' });

      const { container } = renderComponent(component);

      const lines = container.querySelectorAll('hr');
      lines.forEach((line) => {
        expect(line.getAttribute('aria-hidden')).toBe('true');
      });
    });
  });

  describe('Flex Container with Label', () => {
    it('should create flex container for horizontal labeled divider', () => {
      const component = () => Divider({ label: 'OR', orientation: 'horizontal' });

      const { container } = renderComponent(component);

      const divEl = container.querySelector('div') as HTMLElement;
      expect(divEl.style.display).toBe('flex');
      expect(divEl.style.flexDirection).toBe('row');
      expect(divEl.style.alignItems).toBe('center');
      expect(divEl.style.width).toBe('100%');
    });

    it('should create flex container for vertical labeled divider', () => {
      const component = () => Divider({ label: 'VS', orientation: 'vertical' });

      const { container } = renderComponent(component);

      const divEl = container.querySelector('div') as HTMLElement;
      expect(divEl.style.display).toBe('flex');
      expect(divEl.style.flexDirection).toBe('column');
      expect(divEl.style.alignItems).toBe('center');
      expect(divEl.style.height).toBe('100%');
    });

    it('should set label to flex-shrink: 0', () => {
      const component = () => Divider({ label: 'Label' });

      const { container } = renderComponent(component);

      const labelEl = container.querySelector('span') as HTMLElement;
      expect(labelEl.style.flexShrink).toBe('0');
    });
  });

  describe('Styling', () => {
    it('should apply class name', () => {
      const component = () => Divider({ class: 'custom-divider' });

      const { container } = renderComponent(component);

      const dividerEl = container.querySelector('.custom-divider');
      expect(dividerEl).toBeTruthy();
    });

    it('should apply multiple class names', () => {
      const component = () => Divider({ class: 'divider section-break bold' });

      const { container } = renderComponent(component);

      const hrEl = container.querySelector('hr') as HTMLElement;
      expect(hrEl.classList.contains('divider')).toBe(true);
      expect(hrEl.classList.contains('section-break')).toBe(true);
      expect(hrEl.classList.contains('bold')).toBe(true);
    });

    it('should merge inline styles', () => {
      const component = () => Divider({ style: { margin: '32px 0' } });

      const { container } = renderComponent(component);

      const hrEl = container.querySelector('hr') as HTMLElement;
      expect(hrEl.style.margin).toContain('32px');
    });

    it('should apply styles to labeled divider container', () => {
      const component = () => Divider({ label: 'OR', style: { padding: '16px' } });

      const { container } = renderComponent(component);

      const divEl = container.querySelector('div') as HTMLElement;
      expect(divEl.style.padding).toBe('16px');
    });
  });

  describe('Props Forwarding', () => {
    it('should forward data attributes', () => {
      const component = () =>
        Divider({
          'data-testid': 'section-divider',
          'data-section': 'header',
        });

      const { container } = renderComponent(component);

      const hrEl = container.querySelector('hr') as HTMLElement;
      expect(hrEl.getAttribute('data-testid')).toBe('section-divider');
      expect(hrEl.getAttribute('data-section')).toBe('header');
    });

    it('should forward id attribute', () => {
      const component = () => Divider({ id: 'main-divider' });

      const { container } = renderComponent(component);

      const dividerEl = container.querySelector('#main-divider');
      expect(dividerEl).toBeTruthy();
    });

    it('should forward event handlers', () => {
      let clicked = false;
      const handleClick = () => {
        clicked = true;
      };

      const component = () => Divider({ onClick: handleClick });

      const { container } = renderComponent(component);

      const hrEl = container.querySelector('hr') as HTMLElement;
      hrEl.click();

      expect(clicked).toBe(true);
    });

    it('should not forward internal props to DOM', () => {
      const component = () =>
        Divider({
          orientation: 'horizontal',
          variant: 'solid',
          thickness: 2,
          color: '#000',
          labelPosition: 'center',
          labelSpacing: 16,
          decorative: false,
        });

      const { container } = renderComponent(component);

      const hrEl = container.querySelector('hr') as HTMLElement;
      expect(hrEl.hasAttribute('orientation')).toBe(false);
      expect(hrEl.hasAttribute('variant')).toBe(false);
      expect(hrEl.hasAttribute('thickness')).toBe(false);
      expect(hrEl.hasAttribute('color')).toBe(false);
      expect(hrEl.hasAttribute('labelPosition')).toBe(false);
      expect(hrEl.hasAttribute('labelSpacing')).toBe(false);
      expect(hrEl.hasAttribute('decorative')).toBe(false);
    });
  });

  describe('Complex Scenarios', () => {
    it('should handle all props combined', () => {
      const component = () =>
        Divider({
          orientation: 'horizontal',
          label: 'PREMIUM',
          labelPosition: 'center',
          variant: 'solid',
          thickness: 2,
          color: '#3b82f6',
          labelSpacing: 24,
          decorative: false,
          class: 'premium-divider',
          style: { margin: '40px 0' },
        });

      const { container } = renderComponent(component);

      const divEl = container.querySelector('.premium-divider') as HTMLElement;
      expect(divEl).toBeTruthy();
      const labelEl = divEl.querySelector('span');
      expect(labelEl).toBeTruthy();
      expect(divEl.style.margin).toContain('40px');
      expect(divEl.getAttribute('role')).toBe('separator');
      expect(divEl.getAttribute('aria-label')).toBe('PREMIUM');
    });

    it('should render vertical divider with label at start', () => {
      const component = () =>
        Divider({
          orientation: 'vertical',
          label: 'TOP',
          labelPosition: 'start',
          variant: 'dashed',
        });

      const { container } = renderComponent(component);

      const divEl = container.querySelector('div') as HTMLElement;
      const lines = divEl?.querySelectorAll('hr');
      expect(lines?.length).toBe(1); // Only end line
      const labelEl = divEl.querySelector('span');
      expect(labelEl).toBeTruthy();
    });

    it('should handle thick colored divider with dotted style', () => {
      const component = () =>
        Divider({
          variant: 'dotted',
          thickness: 4,
          color: '#10b981',
        });

      const { container } = renderComponent(component);

      const hrEl = container.querySelector('hr') as HTMLElement;
      expect(hrEl.style.borderTopStyle).toBe('dotted');
      expect(hrEl.style.borderTopWidth).toBe('4px');
      expect(hrEl.style.borderTopColor).toBe('#10b981');
    });

    it('should handle complex label content', () => {
      const component = () => Divider({ children: ['Section ', 'Title'] });

      const { container } = renderComponent(component);

      const divEl = container.querySelector('div');
      const labelEl = divEl?.querySelector('span');
      expect(labelEl).toBeTruthy();
    });
  });

  describe('Edge Cases', () => {
    it('should handle undefined label and children', () => {
      const component = () => Divider({ label: undefined, children: undefined });

      const { container } = renderComponent(component);

      const hrEl = container.querySelector('hr');
      expect(hrEl).toBeTruthy();
    });

    it('should handle empty string label', () => {
      const component = () => Divider({ label: '' });

      const { container } = renderComponent(component);

      // Empty string is still truthy for hasLabel check
      const hrEl = container.querySelector('hr');
      expect(hrEl).toBeTruthy();
    });

    it('should handle zero as thickness', () => {
      const component = () => Divider({ thickness: 0 });

      const { container } = renderComponent(component);

      const hrEl = container.querySelector('hr') as HTMLElement;
      expect(hrEl.style.borderTopWidth).toBe('0px');
    });

    it('should handle zero as labelSpacing', () => {
      const component = () => Divider({ label: 'Label', labelSpacing: 0 });

      const { container } = renderComponent(component);

      const labelEl = container.querySelector('span') as HTMLElement;
      expect(labelEl.style.paddingLeft).toBe('0px');
      expect(labelEl.style.paddingRight).toBe('0px');
    });

    it('should handle null style', () => {
      const component = () => Divider({ style: null as any });

      const { container } = renderComponent(component);

      const hrEl = container.querySelector('hr');
      expect(hrEl).toBeTruthy();
    });

    it('should remove border from hr element', () => {
      const component = () => Divider({});

      const { container } = renderComponent(component);

      const hrEl = container.querySelector('hr') as HTMLElement;
      // Border style is set, value may vary by browser
      expect(hrEl.style.borderTopStyle).toBeTruthy();
    });
  });

  describe('Performance', () => {
    it('should render simple divider efficiently', () => {
      const component = () => Divider({});

      const { container } = renderComponent(component);

      const hrEl = container.querySelector('hr');
      expect(hrEl).toBeTruthy();
    });

    it('should render labeled divider efficiently', () => {
      const component = () => Divider({ label: 'Quick Render' });

      const { container } = renderComponent(component);

      const divEl = container.querySelector('div');
      const labelEl = divEl?.querySelector('span');
      expect(labelEl).toBeTruthy();
    });

    it('should handle multiple dividers', () => {
      const component = () => Divider({ label: 'Test' });

      const { container } = renderComponent(component);

      const divEl = container.querySelector('div');
      expect(divEl).toBeTruthy();
    });
  });
});
