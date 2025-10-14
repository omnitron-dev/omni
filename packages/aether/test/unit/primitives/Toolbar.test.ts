/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  Toolbar,
  ToolbarGroup,
  ToolbarButton,
  ToolbarLink,
  ToolbarSeparator,
  ToolbarToggleGroup,
  ToolbarToggleItem,
} from '../../../src/primitives/Toolbar.js';
import { renderComponent, createSpy } from '../../helpers/test-utils.js';

describe('Toolbar', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('Toolbar Root - Basic Rendering', () => {
    it('should render as a div element', () => {
      const component = () => Toolbar({ children: 'Toolbar' });
      const { container } = renderComponent(component);

      const toolbarEl = container.querySelector('div[data-toolbar]');
      expect(toolbarEl).toBeTruthy();
    });

    it('should have data-toolbar attribute', () => {
      const component = () => Toolbar({});
      const { container } = renderComponent(component);

      const toolbarEl = container.querySelector('[data-toolbar]');
      expect(toolbarEl).toBeTruthy();
      expect(toolbarEl?.hasAttribute('data-toolbar')).toBe(true);
    });

    it('should have role="toolbar"', () => {
      const component = () => Toolbar({});
      const { container } = renderComponent(component);

      const toolbarEl = container.querySelector('[role="toolbar"]');
      expect(toolbarEl).toBeTruthy();
    });

    it('should render with children', () => {
      const component = () => Toolbar({ children: 'Toolbar content' });
      const { container } = renderComponent(component);

      const toolbarEl = container.querySelector('[data-toolbar]');
      expect(toolbarEl?.textContent).toContain('Toolbar content');
    });

    it('should render without children', () => {
      const component = () => Toolbar({});
      const { container } = renderComponent(component);

      const toolbarEl = container.querySelector('[data-toolbar]');
      expect(toolbarEl).toBeTruthy();
    });
  });

  describe('Toolbar Root - Orientation', () => {
    it('should default to horizontal orientation', () => {
      const component = () => Toolbar({});
      const { container } = renderComponent(component);

      const toolbarEl = container.querySelector('[data-toolbar]') as HTMLElement;
      expect(toolbarEl.getAttribute('data-orientation')).toBe('horizontal');
      expect(toolbarEl.getAttribute('aria-orientation')).toBe('horizontal');
    });

    it('should support horizontal orientation', () => {
      const component = () => Toolbar({ orientation: 'horizontal' });
      const { container } = renderComponent(component);

      const toolbarEl = container.querySelector('[data-toolbar]') as HTMLElement;
      expect(toolbarEl.getAttribute('data-orientation')).toBe('horizontal');
      expect(toolbarEl.getAttribute('aria-orientation')).toBe('horizontal');
    });

    it('should support vertical orientation', () => {
      const component = () => Toolbar({ orientation: 'vertical' });
      const { container } = renderComponent(component);

      const toolbarEl = container.querySelector('[data-toolbar]') as HTMLElement;
      expect(toolbarEl.getAttribute('data-orientation')).toBe('vertical');
      expect(toolbarEl.getAttribute('aria-orientation')).toBe('vertical');
    });
  });

  describe('Toolbar Root - Loop Prop', () => {
    it('should default to loop=true', () => {
      const component = () =>
        Toolbar({
          children: [ToolbarButton({ children: 'Btn1' }), ToolbarButton({ children: 'Btn2' })],
        });
      const { container } = renderComponent(component);

      const toolbarEl = container.querySelector('[data-toolbar]') as HTMLElement;
      const buttons = container.querySelectorAll('button');

      // Focus last button
      buttons[buttons.length - 1]?.focus();

      // Press ArrowRight (should loop to first)
      const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true });
      toolbarEl.dispatchEvent(event);

      expect(document.activeElement).toBe(buttons[0]);
    });

    it('should support loop=false', () => {
      const component = () =>
        Toolbar({
          loop: false,
          children: [ToolbarButton({ children: 'Btn1' }), ToolbarButton({ children: 'Btn2' })],
        });
      const { container } = renderComponent(component);

      const toolbarEl = container.querySelector('[data-toolbar]') as HTMLElement;
      const buttons = container.querySelectorAll('button');

      // Focus last button
      buttons[buttons.length - 1]?.focus();

      // Press ArrowRight (should not loop)
      const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true });
      toolbarEl.dispatchEvent(event);

      expect(document.activeElement).toBe(buttons[buttons.length - 1]);
    });
  });

  describe('Toolbar Root - Keyboard Navigation (Horizontal)', () => {
    it('should navigate with ArrowRight key', () => {
      const component = () =>
        Toolbar({
          children: [
            ToolbarButton({ children: 'Btn1' }),
            ToolbarButton({ children: 'Btn2' }),
            ToolbarButton({ children: 'Btn3' }),
          ],
        });
      const { container } = renderComponent(component);

      const toolbarEl = container.querySelector('[data-toolbar]') as HTMLElement;
      const buttons = container.querySelectorAll('button');

      buttons[0]?.focus();

      const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true });
      toolbarEl.dispatchEvent(event);

      expect(document.activeElement).toBe(buttons[1]);
    });

    it('should navigate with ArrowLeft key', () => {
      const component = () =>
        Toolbar({
          children: [
            ToolbarButton({ children: 'Btn1' }),
            ToolbarButton({ children: 'Btn2' }),
            ToolbarButton({ children: 'Btn3' }),
          ],
        });
      const { container } = renderComponent(component);

      const toolbarEl = container.querySelector('[data-toolbar]') as HTMLElement;
      const buttons = container.querySelectorAll('button');

      buttons[1]?.focus();

      const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true });
      toolbarEl.dispatchEvent(event);

      expect(document.activeElement).toBe(buttons[0]);
    });

    it('should navigate to first item with Home key', () => {
      const component = () =>
        Toolbar({
          children: [
            ToolbarButton({ children: 'Btn1' }),
            ToolbarButton({ children: 'Btn2' }),
            ToolbarButton({ children: 'Btn3' }),
          ],
        });
      const { container } = renderComponent(component);

      const toolbarEl = container.querySelector('[data-toolbar]') as HTMLElement;
      const buttons = container.querySelectorAll('button');

      buttons[2]?.focus();

      const event = new KeyboardEvent('keydown', { key: 'Home', bubbles: true });
      toolbarEl.dispatchEvent(event);

      expect(document.activeElement).toBe(buttons[0]);
    });

    it('should navigate to last item with End key', () => {
      const component = () =>
        Toolbar({
          children: [
            ToolbarButton({ children: 'Btn1' }),
            ToolbarButton({ children: 'Btn2' }),
            ToolbarButton({ children: 'Btn3' }),
          ],
        });
      const { container } = renderComponent(component);

      const toolbarEl = container.querySelector('[data-toolbar]') as HTMLElement;
      const buttons = container.querySelectorAll('button');

      buttons[0]?.focus();

      const event = new KeyboardEvent('keydown', { key: 'End', bubbles: true });
      toolbarEl.dispatchEvent(event);

      expect(document.activeElement).toBe(buttons[2]);
    });

    it('should skip disabled buttons', () => {
      const component = () =>
        Toolbar({
          children: [
            ToolbarButton({ children: 'Btn1' }),
            ToolbarButton({ children: 'Btn2', disabled: true }),
            ToolbarButton({ children: 'Btn3' }),
          ],
        });
      const { container } = renderComponent(component);

      const toolbarEl = container.querySelector('[data-toolbar]') as HTMLElement;
      const buttons = Array.from(container.querySelectorAll('button')).filter((btn) => !btn.disabled);

      buttons[0]?.focus();

      const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true });
      toolbarEl.dispatchEvent(event);

      // Should skip disabled button and focus Btn3
      const allButtons = container.querySelectorAll('button');
      expect(document.activeElement).toBe(allButtons[2]);
    });

    it('should not navigate with ArrowDown in horizontal mode', () => {
      const component = () =>
        Toolbar({
          orientation: 'horizontal',
          children: [ToolbarButton({ children: 'Btn1' }), ToolbarButton({ children: 'Btn2' })],
        });
      const { container } = renderComponent(component);

      const toolbarEl = container.querySelector('[data-toolbar]') as HTMLElement;
      const buttons = container.querySelectorAll('button');

      buttons[0]?.focus();

      const event = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true });
      toolbarEl.dispatchEvent(event);

      // Should remain on first button
      expect(document.activeElement).toBe(buttons[0]);
    });
  });

  describe('Toolbar Root - Keyboard Navigation (Vertical)', () => {
    it('should navigate with ArrowDown key', () => {
      const component = () =>
        Toolbar({
          orientation: 'vertical',
          children: [
            ToolbarButton({ children: 'Btn1' }),
            ToolbarButton({ children: 'Btn2' }),
            ToolbarButton({ children: 'Btn3' }),
          ],
        });
      const { container } = renderComponent(component);

      const toolbarEl = container.querySelector('[data-toolbar]') as HTMLElement;
      const buttons = container.querySelectorAll('button');

      buttons[0]?.focus();

      const event = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true });
      toolbarEl.dispatchEvent(event);

      expect(document.activeElement).toBe(buttons[1]);
    });

    it('should navigate with ArrowUp key', () => {
      const component = () =>
        Toolbar({
          orientation: 'vertical',
          children: [
            ToolbarButton({ children: 'Btn1' }),
            ToolbarButton({ children: 'Btn2' }),
            ToolbarButton({ children: 'Btn3' }),
          ],
        });
      const { container } = renderComponent(component);

      const toolbarEl = container.querySelector('[data-toolbar]') as HTMLElement;
      const buttons = container.querySelectorAll('button');

      buttons[1]?.focus();

      const event = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true });
      toolbarEl.dispatchEvent(event);

      expect(document.activeElement).toBe(buttons[0]);
    });

    it('should not navigate with ArrowRight in vertical mode', () => {
      const component = () =>
        Toolbar({
          orientation: 'vertical',
          children: [ToolbarButton({ children: 'Btn1' }), ToolbarButton({ children: 'Btn2' })],
        });
      const { container } = renderComponent(component);

      const toolbarEl = container.querySelector('[data-toolbar]') as HTMLElement;
      const buttons = container.querySelectorAll('button');

      buttons[0]?.focus();

      const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true });
      toolbarEl.dispatchEvent(event);

      // Should remain on first button
      expect(document.activeElement).toBe(buttons[0]);
    });
  });

  describe('Toolbar Root - Props Forwarding', () => {
    it('should forward id attribute', () => {
      const component = () => Toolbar({ id: 'my-toolbar' });
      const { container } = renderComponent(component);

      const toolbarEl = container.querySelector('#my-toolbar');
      expect(toolbarEl).toBeTruthy();
    });

    it('should forward class attribute', () => {
      const component = () => Toolbar({ class: 'custom-toolbar' });
      const { container } = renderComponent(component);

      const toolbarEl = container.querySelector('.custom-toolbar');
      expect(toolbarEl).toBeTruthy();
    });

    it('should forward style attribute', () => {
      const component = () => Toolbar({ style: { padding: '20px' } });
      const { container } = renderComponent(component);

      const toolbarEl = container.querySelector('[data-toolbar]') as HTMLElement;
      expect(toolbarEl.style.padding).toBe('20px');
    });

    it('should forward data attributes', () => {
      const component = () => Toolbar({ 'data-testid': 'toolbar-test' });
      const { container } = renderComponent(component);

      const toolbarEl = container.querySelector('[data-testid="toolbar-test"]');
      expect(toolbarEl).toBeTruthy();
    });

    it('should forward aria-label attribute', () => {
      const component = () => Toolbar({ 'aria-label': 'Formatting toolbar' });
      const { container } = renderComponent(component);

      const toolbarEl = container.querySelector('[data-toolbar]') as HTMLElement;
      expect(toolbarEl.getAttribute('aria-label')).toBe('Formatting toolbar');
    });
  });

  describe('ToolbarGroup - Basic Rendering', () => {
    it('should render as a div element', () => {
      const component = () => ToolbarGroup({ children: 'Group' });
      const { container } = renderComponent(component);

      const groupEl = container.querySelector('div[data-toolbar-group]');
      expect(groupEl).toBeTruthy();
    });

    it('should have data-toolbar-group attribute', () => {
      const component = () => ToolbarGroup({});
      const { container } = renderComponent(component);

      const groupEl = container.querySelector('[data-toolbar-group]');
      expect(groupEl?.hasAttribute('data-toolbar-group')).toBe(true);
    });

    it('should have role="group"', () => {
      const component = () => ToolbarGroup({});
      const { container } = renderComponent(component);

      const groupEl = container.querySelector('[role="group"]');
      expect(groupEl).toBeTruthy();
    });

    it('should render with children', () => {
      const component = () => ToolbarGroup({ children: 'Group content' });
      const { container } = renderComponent(component);

      const groupEl = container.querySelector('[data-toolbar-group]');
      expect(groupEl?.textContent).toBe('Group content');
    });

    it('should forward class attribute', () => {
      const component = () => ToolbarGroup({ class: 'custom-group' });
      const { container } = renderComponent(component);

      const groupEl = container.querySelector('.custom-group');
      expect(groupEl).toBeTruthy();
    });
  });

  describe('ToolbarButton - Basic Rendering', () => {
    it('should render as a button element', () => {
      const component = () => ToolbarButton({ children: 'Click me' });
      const { container } = renderComponent(component);

      const buttonEl = container.querySelector('button');
      expect(buttonEl).toBeTruthy();
      expect(buttonEl?.textContent).toBe('Click me');
    });

    it('should have data-toolbar-button attribute', () => {
      const component = () => ToolbarButton({ children: 'Button' });
      const { container } = renderComponent(component);

      const buttonEl = container.querySelector('[data-toolbar-button]');
      expect(buttonEl?.hasAttribute('data-toolbar-button')).toBe(true);
    });

    it('should have tabIndex=0 by default', () => {
      const component = () => ToolbarButton({ children: 'Button' });
      const { container } = renderComponent(component);

      const buttonEl = container.querySelector('button') as HTMLElement;
      expect(buttonEl.tabIndex).toBe(0);
    });

    it('should default to type="button"', () => {
      const component = () => ToolbarButton({ children: 'Button' });
      const { container } = renderComponent(component);

      const buttonEl = container.querySelector('button') as HTMLButtonElement;
      expect(buttonEl.type).toBe('button');
    });

    it('should support type="submit"', () => {
      const component = () => ToolbarButton({ type: 'submit', children: 'Submit' });
      const { container } = renderComponent(component);

      const buttonEl = container.querySelector('button') as HTMLButtonElement;
      expect(buttonEl.type).toBe('submit');
    });

    it('should support type="reset"', () => {
      const component = () => ToolbarButton({ type: 'reset', children: 'Reset' });
      const { container } = renderComponent(component);

      const buttonEl = container.querySelector('button') as HTMLButtonElement;
      expect(buttonEl.type).toBe('reset');
    });
  });

  describe('ToolbarButton - Disabled State', () => {
    it('should support disabled prop', () => {
      const component = () => ToolbarButton({ disabled: true, children: 'Disabled' });
      const { container } = renderComponent(component);

      const buttonEl = container.querySelector('button') as HTMLButtonElement;
      expect(buttonEl.disabled).toBe(true);
    });

    it('should have data-disabled attribute when disabled', () => {
      const component = () => ToolbarButton({ disabled: true, children: 'Disabled' });
      const { container } = renderComponent(component);

      const buttonEl = container.querySelector('button') as HTMLElement;
      expect(buttonEl.hasAttribute('data-disabled')).toBe(true);
    });

    it('should have tabIndex=-1 when disabled', () => {
      const component = () => ToolbarButton({ disabled: true, children: 'Disabled' });
      const { container } = renderComponent(component);

      const buttonEl = container.querySelector('button') as HTMLElement;
      expect(buttonEl.tabIndex).toBe(-1);
    });

    it('should not call onClick when disabled', () => {
      const onClick = createSpy();
      const component = () => ToolbarButton({ disabled: true, onClick, children: 'Disabled' });
      const { container } = renderComponent(component);

      const buttonEl = container.querySelector('button') as HTMLElement;
      buttonEl.click();

      expect(onClick.callCount).toBe(0);
    });
  });

  describe('ToolbarButton - Click Handler', () => {
    it('should call onClick when clicked', () => {
      const onClick = createSpy();
      const component = () => ToolbarButton({ onClick, children: 'Click me' });
      const { container } = renderComponent(component);

      const buttonEl = container.querySelector('button') as HTMLElement;
      buttonEl.click();

      expect(onClick.callCount).toBe(1);
    });

    it('should receive event in onClick handler', () => {
      let receivedEvent: Event | null = null;
      const onClick = (e: Event) => {
        receivedEvent = e;
      };

      const component = () => ToolbarButton({ onClick, children: 'Click me' });
      const { container } = renderComponent(component);

      const buttonEl = container.querySelector('button') as HTMLElement;
      buttonEl.click();

      expect(receivedEvent).toBeTruthy();
      expect(receivedEvent?.type).toBe('click');
    });

    it('should support multiple clicks', () => {
      const onClick = createSpy();
      const component = () => ToolbarButton({ onClick, children: 'Click me' });
      const { container } = renderComponent(component);

      const buttonEl = container.querySelector('button') as HTMLElement;
      buttonEl.click();
      buttonEl.click();
      buttonEl.click();

      expect(onClick.callCount).toBe(3);
    });
  });

  describe('ToolbarButton - Props Forwarding', () => {
    it('should forward class attribute', () => {
      const component = () => ToolbarButton({ class: 'custom-button', children: 'Button' });
      const { container } = renderComponent(component);

      const buttonEl = container.querySelector('.custom-button');
      expect(buttonEl).toBeTruthy();
    });

    it('should forward data attributes', () => {
      const component = () => ToolbarButton({ 'data-action': 'save', children: 'Save' });
      const { container } = renderComponent(component);

      const buttonEl = container.querySelector('button') as HTMLElement;
      expect(buttonEl.getAttribute('data-action')).toBe('save');
    });

    it('should forward aria attributes', () => {
      const component = () => ToolbarButton({ 'aria-label': 'Bold text', children: 'B' });
      const { container } = renderComponent(component);

      const buttonEl = container.querySelector('button') as HTMLElement;
      expect(buttonEl.getAttribute('aria-label')).toBe('Bold text');
    });
  });

  describe('ToolbarLink - Basic Rendering', () => {
    it('should render as an anchor element', () => {
      const component = () => ToolbarLink({ href: '#', children: 'Link' });
      const { container } = renderComponent(component);

      const linkEl = container.querySelector('a');
      expect(linkEl).toBeTruthy();
      expect(linkEl?.textContent).toBe('Link');
    });

    it('should have data-toolbar-link attribute', () => {
      const component = () => ToolbarLink({ href: '#', children: 'Link' });
      const { container } = renderComponent(component);

      const linkEl = container.querySelector('[data-toolbar-link]');
      expect(linkEl?.hasAttribute('data-toolbar-link')).toBe(true);
    });

    it('should have tabIndex=0', () => {
      const component = () => ToolbarLink({ href: '#', children: 'Link' });
      const { container } = renderComponent(component);

      const linkEl = container.querySelector('a') as HTMLElement;
      expect(linkEl.tabIndex).toBe(0);
    });

    it('should support href attribute', () => {
      const component = () => ToolbarLink({ href: '/page', children: 'Page' });
      const { container } = renderComponent(component);

      const linkEl = container.querySelector('a') as HTMLAnchorElement;
      expect(linkEl.getAttribute('href')).toBe('/page');
    });

    it('should support target attribute', () => {
      const component = () => ToolbarLink({ href: '/page', target: '_blank', children: 'External' });
      const { container } = renderComponent(component);

      const linkEl = container.querySelector('a') as HTMLAnchorElement;
      expect(linkEl.getAttribute('target')).toBe('_blank');
    });

    it('should forward class attribute', () => {
      const component = () => ToolbarLink({ class: 'custom-link', href: '#', children: 'Link' });
      const { container } = renderComponent(component);

      const linkEl = container.querySelector('.custom-link');
      expect(linkEl).toBeTruthy();
    });
  });

  describe('ToolbarSeparator - Basic Rendering', () => {
    it('should render as a div element', () => {
      const component = () => ToolbarSeparator({});
      const { container } = renderComponent(component);

      const separatorEl = container.querySelector('div[data-toolbar-separator]');
      expect(separatorEl).toBeTruthy();
    });

    it('should have data-toolbar-separator attribute', () => {
      const component = () => ToolbarSeparator({});
      const { container } = renderComponent(component);

      const separatorEl = container.querySelector('[data-toolbar-separator]');
      expect(separatorEl?.hasAttribute('data-toolbar-separator')).toBe(true);
    });

    it('should have role="separator"', () => {
      const component = () => ToolbarSeparator({});
      const { container } = renderComponent(component);

      const separatorEl = container.querySelector('[role="separator"]');
      expect(separatorEl).toBeTruthy();
    });

    it('should have aria-orientation="vertical"', () => {
      const component = () => ToolbarSeparator({});
      const { container } = renderComponent(component);

      const separatorEl = container.querySelector('[data-toolbar-separator]') as HTMLElement;
      expect(separatorEl.getAttribute('aria-orientation')).toBe('vertical');
    });

    it('should forward class attribute', () => {
      const component = () => ToolbarSeparator({ class: 'custom-separator' });
      const { container } = renderComponent(component);

      const separatorEl = container.querySelector('.custom-separator');
      expect(separatorEl).toBeTruthy();
    });
  });

  describe('ToolbarToggleGroup - Basic Rendering', () => {
    it('should render as a div element', () => {
      const component = () => ToolbarToggleGroup({ children: 'Toggle' });
      const { container } = renderComponent(component);

      const groupEl = container.querySelector('div[data-toolbar-toggle-group]');
      expect(groupEl).toBeTruthy();
    });

    it('should have data-toolbar-toggle-group attribute', () => {
      const component = () => ToolbarToggleGroup({});
      const { container } = renderComponent(component);

      const groupEl = container.querySelector('[data-toolbar-toggle-group]');
      expect(groupEl?.hasAttribute('data-toolbar-toggle-group')).toBe(true);
    });

    it('should default to single type', () => {
      const component = () => ToolbarToggleGroup({});
      const { container } = renderComponent(component);

      const groupEl = container.querySelector('[data-toolbar-toggle-group]') as HTMLElement;
      expect(groupEl.getAttribute('data-type')).toBe('single');
    });

    it('should support single type with role="radiogroup"', () => {
      const component = () => ToolbarToggleGroup({ type: 'single' });
      const { container } = renderComponent(component);

      const groupEl = container.querySelector('[data-toolbar-toggle-group]') as HTMLElement;
      expect(groupEl.getAttribute('data-type')).toBe('single');
      expect(groupEl.getAttribute('role')).toBe('radiogroup');
    });

    it('should support multiple type with role="group"', () => {
      const component = () => ToolbarToggleGroup({ type: 'multiple' });
      const { container } = renderComponent(component);

      const groupEl = container.querySelector('[data-toolbar-toggle-group]') as HTMLElement;
      expect(groupEl.getAttribute('data-type')).toBe('multiple');
      expect(groupEl.getAttribute('role')).toBe('group');
    });

    it('should forward class attribute', () => {
      const component = () => ToolbarToggleGroup({ class: 'custom-toggle-group' });
      const { container } = renderComponent(component);

      const groupEl = container.querySelector('.custom-toggle-group');
      expect(groupEl).toBeTruthy();
    });
  });

  describe('ToolbarToggleItem - Basic Rendering', () => {
    it('should render as a button element', () => {
      const component = () => ToolbarToggleItem({ value: 'bold', children: 'B' });
      const { container } = renderComponent(component);

      const itemEl = container.querySelector('button');
      expect(itemEl).toBeTruthy();
      expect(itemEl?.textContent).toBe('B');
    });

    it('should have data-toolbar-toggle-item attribute', () => {
      const component = () => ToolbarToggleItem({ value: 'bold', children: 'B' });
      const { container } = renderComponent(component);

      const itemEl = container.querySelector('[data-toolbar-toggle-item]');
      expect(itemEl?.hasAttribute('data-toolbar-toggle-item')).toBe(true);
    });

    it('should have type="button"', () => {
      const component = () => ToolbarToggleItem({ value: 'bold', children: 'B' });
      const { container } = renderComponent(component);

      const itemEl = container.querySelector('button') as HTMLButtonElement;
      expect(itemEl.type).toBe('button');
    });

    it('should have role="radio"', () => {
      const component = () => ToolbarToggleItem({ value: 'bold', children: 'B' });
      const { container } = renderComponent(component);

      const itemEl = container.querySelector('[role="radio"]');
      expect(itemEl).toBeTruthy();
    });

    it('should have aria-checked="false" by default', () => {
      const component = () => ToolbarToggleItem({ value: 'bold', children: 'B' });
      const { container } = renderComponent(component);

      const itemEl = container.querySelector('button') as HTMLElement;
      expect(itemEl.getAttribute('aria-checked')).toBe('false');
    });

    it('should have data-value attribute', () => {
      const component = () => ToolbarToggleItem({ value: 'bold', children: 'B' });
      const { container } = renderComponent(component);

      const itemEl = container.querySelector('button') as HTMLElement;
      expect(itemEl.getAttribute('data-value')).toBe('bold');
    });

    it('should have tabIndex=0 by default', () => {
      const component = () => ToolbarToggleItem({ value: 'bold', children: 'B' });
      const { container } = renderComponent(component);

      const itemEl = container.querySelector('button') as HTMLElement;
      expect(itemEl.tabIndex).toBe(0);
    });
  });

  describe('ToolbarToggleItem - Disabled State', () => {
    it('should support disabled prop', () => {
      const component = () => ToolbarToggleItem({ value: 'bold', disabled: true, children: 'B' });
      const { container } = renderComponent(component);

      const itemEl = container.querySelector('button') as HTMLButtonElement;
      expect(itemEl.disabled).toBe(true);
    });

    it('should have data-disabled attribute when disabled', () => {
      const component = () => ToolbarToggleItem({ value: 'bold', disabled: true, children: 'B' });
      const { container } = renderComponent(component);

      const itemEl = container.querySelector('button') as HTMLElement;
      expect(itemEl.hasAttribute('data-disabled')).toBe(true);
    });

    it('should have tabIndex=-1 when disabled', () => {
      const component = () => ToolbarToggleItem({ value: 'bold', disabled: true, children: 'B' });
      const { container } = renderComponent(component);

      const itemEl = container.querySelector('button') as HTMLElement;
      expect(itemEl.tabIndex).toBe(-1);
    });
  });

  describe('Sub-component Attachments', () => {
    it('should have Group attached to Toolbar', () => {
      expect((Toolbar as any).Group).toBe(ToolbarGroup);
    });

    it('should have Button attached to Toolbar', () => {
      expect((Toolbar as any).Button).toBe(ToolbarButton);
    });

    it('should have Link attached to Toolbar', () => {
      expect((Toolbar as any).Link).toBe(ToolbarLink);
    });

    it('should have Separator attached to Toolbar', () => {
      expect((Toolbar as any).Separator).toBe(ToolbarSeparator);
    });

    it('should have ToggleGroup attached to Toolbar', () => {
      expect((Toolbar as any).ToggleGroup).toBe(ToolbarToggleGroup);
    });

    it('should have ToggleItem attached to Toolbar', () => {
      expect((Toolbar as any).ToggleItem).toBe(ToolbarToggleItem);
    });
  });

  describe('Display Names', () => {
    it('should have displayName for Toolbar', () => {
      expect(Toolbar.displayName).toBe('Toolbar');
    });

    it('should have displayName for ToolbarGroup', () => {
      expect(ToolbarGroup.displayName).toBe('Toolbar.Group');
    });

    it('should have displayName for ToolbarButton', () => {
      expect(ToolbarButton.displayName).toBe('Toolbar.Button');
    });

    it('should have displayName for ToolbarLink', () => {
      expect(ToolbarLink.displayName).toBe('Toolbar.Link');
    });

    it('should have displayName for ToolbarSeparator', () => {
      expect(ToolbarSeparator.displayName).toBe('Toolbar.Separator');
    });

    it('should have displayName for ToolbarToggleGroup', () => {
      expect(ToolbarToggleGroup.displayName).toBe('Toolbar.ToggleGroup');
    });

    it('should have displayName for ToolbarToggleItem', () => {
      expect(ToolbarToggleItem.displayName).toBe('Toolbar.ToggleItem');
    });
  });

  describe('Complete Toolbar Structure', () => {
    it('should render a complete toolbar with all parts', () => {
      const component = () =>
        Toolbar({
          'aria-label': 'Formatting',
          children: [
            ToolbarGroup({
              children: [ToolbarButton({ children: 'Bold' }), ToolbarButton({ children: 'Italic' })],
            }),
            ToolbarSeparator({}),
            ToolbarGroup({
              children: [ToolbarButton({ children: 'Undo' }), ToolbarButton({ children: 'Redo' })],
            }),
          ],
        });
      const { container } = renderComponent(component);

      expect(container.querySelector('[data-toolbar]')).toBeTruthy();
      expect(container.querySelectorAll('[data-toolbar-group]').length).toBe(2);
      expect(container.querySelectorAll('[data-toolbar-button]').length).toBe(4);
      expect(container.querySelector('[data-toolbar-separator]')).toBeTruthy();
    });

    it('should render toolbar with toggle groups', () => {
      const component = () =>
        Toolbar({
          children: ToolbarToggleGroup({
            type: 'single',
            children: [
              ToolbarToggleItem({ value: 'left', children: 'Left' }),
              ToolbarToggleItem({ value: 'center', children: 'Center' }),
              ToolbarToggleItem({ value: 'right', children: 'Right' }),
            ],
          }),
        });
      const { container } = renderComponent(component);

      expect(container.querySelector('[data-toolbar-toggle-group]')).toBeTruthy();
      expect(container.querySelectorAll('[data-toolbar-toggle-item]').length).toBe(3);
    });

    it('should render toolbar with links', () => {
      const component = () =>
        Toolbar({
          children: [
            ToolbarLink({ href: '/home', children: 'Home' }),
            ToolbarLink({ href: '/settings', children: 'Settings' }),
          ],
        });
      const { container } = renderComponent(component);

      const links = container.querySelectorAll('[data-toolbar-link]');
      expect(links.length).toBe(2);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty toolbar', () => {
      const component = () => Toolbar({});
      const { container } = renderComponent(component);

      const toolbarEl = container.querySelector('[data-toolbar]');
      expect(toolbarEl).toBeTruthy();
    });

    it('should handle toolbar with undefined children', () => {
      const component = () => Toolbar({ children: undefined });
      const { container } = renderComponent(component);

      const toolbarEl = container.querySelector('[data-toolbar]');
      expect(toolbarEl).toBeTruthy();
    });

    it('should handle button with undefined children', () => {
      const component = () => ToolbarButton({ children: undefined });
      const { container } = renderComponent(component);

      const buttonEl = container.querySelector('button');
      expect(buttonEl).toBeTruthy();
    });

    it('should handle button with special characters', () => {
      const component = () => ToolbarButton({ children: '<script>alert("xss")</script>' });
      const { container } = renderComponent(component);

      const buttonEl = container.querySelector('button');
      expect(buttonEl?.textContent).toBe('<script>alert("xss")</script>');
      expect(container.querySelector('script')).toBeNull();
    });

    it('should handle link with empty href', () => {
      const component = () => ToolbarLink({ href: '', children: 'Link' });
      const { container } = renderComponent(component);

      const linkEl = container.querySelector('a') as HTMLAnchorElement;
      expect(linkEl.getAttribute('href')).toBe('');
    });

    it('should handle navigation with no focusable items', () => {
      const component = () => Toolbar({ children: 'Just text' });
      const { container } = renderComponent(component);

      const toolbarEl = container.querySelector('[data-toolbar]') as HTMLElement;
      const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true });

      // Should not throw
      expect(() => toolbarEl.dispatchEvent(event)).not.toThrow();
    });

    it('should handle keyboard events on irrelevant keys', () => {
      const component = () =>
        Toolbar({
          children: ToolbarButton({ children: 'Button' }),
        });
      const { container } = renderComponent(component);

      const toolbarEl = container.querySelector('[data-toolbar]') as HTMLElement;
      const button = container.querySelector('button');
      button?.focus();

      const event = new KeyboardEvent('keydown', { key: 'A', bubbles: true });
      toolbarEl.dispatchEvent(event);

      // Should remain on the same button
      expect(document.activeElement).toBe(button);
    });
  });

  describe('Use Cases', () => {
    it('should work as text formatting toolbar', () => {
      const component = () =>
        Toolbar({
          'aria-label': 'Text formatting',
          children: [
            ToolbarGroup({
              children: [
                ToolbarButton({ 'aria-label': 'Bold', children: 'B' }),
                ToolbarButton({ 'aria-label': 'Italic', children: 'I' }),
                ToolbarButton({ 'aria-label': 'Underline', children: 'U' }),
              ],
            }),
            ToolbarSeparator({}),
            ToolbarToggleGroup({
              type: 'single',
              children: [
                ToolbarToggleItem({ value: 'left', children: 'L' }),
                ToolbarToggleItem({ value: 'center', children: 'C' }),
                ToolbarToggleItem({ value: 'right', children: 'R' }),
              ],
            }),
          ],
        });
      const { container } = renderComponent(component);

      expect(container.querySelector('[aria-label="Text formatting"]')).toBeTruthy();
      expect(container.querySelectorAll('[data-toolbar-button]').length).toBe(3);
      expect(container.querySelectorAll('[data-toolbar-toggle-item]').length).toBe(3);
    });

    it('should work as navigation toolbar', () => {
      const component = () =>
        Toolbar({
          'aria-label': 'Main navigation',
          children: [
            ToolbarLink({ href: '/', children: 'Home' }),
            ToolbarLink({ href: '/about', children: 'About' }),
            ToolbarLink({ href: '/contact', children: 'Contact' }),
          ],
        });
      const { container } = renderComponent(component);

      const links = container.querySelectorAll('[data-toolbar-link]');
      expect(links.length).toBe(3);
      expect(links[0]?.textContent).toBe('Home');
      expect(links[1]?.textContent).toBe('About');
      expect(links[2]?.textContent).toBe('Contact');
    });

    it('should work with mixed buttons and links', () => {
      const component = () =>
        Toolbar({
          children: [
            ToolbarButton({ children: 'Save' }),
            ToolbarSeparator({}),
            ToolbarLink({ href: '/help', children: 'Help' }),
          ],
        });
      const { container } = renderComponent(component);

      expect(container.querySelector('[data-toolbar-button]')).toBeTruthy();
      expect(container.querySelector('[data-toolbar-link]')).toBeTruthy();
      expect(container.querySelector('[data-toolbar-separator]')).toBeTruthy();
    });

    it('should support conditional rendering', () => {
      const showUndo = false;
      const component = () =>
        Toolbar({
          children: [ToolbarButton({ children: 'Save' }), showUndo ? ToolbarButton({ children: 'Undo' }) : null],
        });
      const { container } = renderComponent(component);

      const buttons = container.querySelectorAll('[data-toolbar-button]');
      expect(buttons.length).toBe(1);
      expect(buttons[0]?.textContent).toBe('Save');
    });
  });

  describe('Accessibility', () => {
    it('should have proper semantic structure', () => {
      const component = () =>
        Toolbar({
          'aria-label': 'Tools',
          children: ToolbarGroup({
            children: ToolbarButton({ children: 'Button' }),
          }),
        });
      const { container } = renderComponent(component);

      const toolbar = container.querySelector('[role="toolbar"]');
      const group = container.querySelector('[role="group"]');

      expect(toolbar).toBeTruthy();
      expect(group).toBeTruthy();
    });

    it('should support aria-label on toolbar', () => {
      const component = () =>
        Toolbar({
          'aria-label': 'Formatting options',
        });
      const { container } = renderComponent(component);

      const toolbar = container.querySelector('[data-toolbar]') as HTMLElement;
      expect(toolbar.getAttribute('aria-label')).toBe('Formatting options');
    });

    it('should have proper aria-orientation', () => {
      const component = () =>
        Toolbar({
          orientation: 'vertical',
        });
      const { container } = renderComponent(component);

      const toolbar = container.querySelector('[data-toolbar]') as HTMLElement;
      expect(toolbar.getAttribute('aria-orientation')).toBe('vertical');
    });

    it('should support aria-label on buttons', () => {
      const component = () =>
        Toolbar({
          children: ToolbarButton({ 'aria-label': 'Bold text', children: 'B' }),
        });
      const { container } = renderComponent(component);

      const button = container.querySelector('button') as HTMLElement;
      expect(button.getAttribute('aria-label')).toBe('Bold text');
    });

    it('should have proper role for toggle groups', () => {
      const component = () =>
        Toolbar({
          children: ToolbarToggleGroup({
            type: 'single',
            children: ToolbarToggleItem({ value: 'test', children: 'Test' }),
          }),
        });
      const { container } = renderComponent(component);

      const group = container.querySelector('[data-toolbar-toggle-group]') as HTMLElement;
      expect(group.getAttribute('role')).toBe('radiogroup');
    });

    it('should prevent default on keyboard navigation', () => {
      const component = () =>
        Toolbar({
          children: [ToolbarButton({ children: 'Btn1' }), ToolbarButton({ children: 'Btn2' })],
        });
      const { container } = renderComponent(component);

      const toolbarEl = container.querySelector('[data-toolbar]') as HTMLElement;
      const buttons = container.querySelectorAll('button');
      buttons[0]?.focus();

      const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true });
      const spy = { prevented: false };
      Object.defineProperty(event, 'preventDefault', {
        value: () => {
          spy.prevented = true;
        },
      });

      toolbarEl.dispatchEvent(event);

      expect(spy.prevented).toBe(true);
    });
  });

  describe('Integration Scenarios', () => {
    it('should work with nested groups', () => {
      const component = () =>
        Toolbar({
          children: [
            ToolbarGroup({
              children: [ToolbarButton({ children: 'A' }), ToolbarButton({ children: 'B' })],
            }),
            ToolbarGroup({
              children: [ToolbarButton({ children: 'C' }), ToolbarButton({ children: 'D' })],
            }),
          ],
        });
      const { container } = renderComponent(component);

      const groups = container.querySelectorAll('[data-toolbar-group]');
      expect(groups.length).toBe(2);

      const buttons = container.querySelectorAll('[data-toolbar-button]');
      expect(buttons.length).toBe(4);
    });

    it('should navigate across groups', () => {
      const component = () =>
        Toolbar({
          children: [
            ToolbarGroup({
              children: ToolbarButton({ children: 'Btn1' }),
            }),
            ToolbarGroup({
              children: ToolbarButton({ children: 'Btn2' }),
            }),
          ],
        });
      const { container } = renderComponent(component);

      const toolbarEl = container.querySelector('[data-toolbar]') as HTMLElement;
      const buttons = container.querySelectorAll('button');

      buttons[0]?.focus();

      const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true });
      toolbarEl.dispatchEvent(event);

      expect(document.activeElement).toBe(buttons[1]);
    });

    it('should maintain proper structure with separators', () => {
      const component = () =>
        Toolbar({
          children: [
            ToolbarButton({ children: 'A' }),
            ToolbarSeparator({}),
            ToolbarButton({ children: 'B' }),
            ToolbarSeparator({}),
            ToolbarButton({ children: 'C' }),
          ],
        });
      const { container } = renderComponent(component);

      const buttons = container.querySelectorAll('[data-toolbar-button]');
      const separators = container.querySelectorAll('[data-toolbar-separator]');

      expect(buttons.length).toBe(3);
      expect(separators.length).toBe(2);
    });
  });
});
