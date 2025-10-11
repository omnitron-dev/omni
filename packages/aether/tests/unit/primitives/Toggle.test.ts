/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { signal } from '../../../src/core/reactivity/signal.js';
import { Toggle } from '../../../src/primitives/Toggle.js';
import { renderComponent, createSpy } from '../../helpers/test-utils.js';

describe('Toggle', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('Component Exports', () => {
    it('should export Toggle component', () => {
      expect(Toggle).toBeDefined();
      expect(typeof Toggle).toBe('function');
    });
  });

  describe('Basic Rendering', () => {
    it('should render a button element', () => {
      const component = () => Toggle({ children: 'Bold' });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');
      expect(button).toBeTruthy();
      expect(button?.tagName).toBe('BUTTON');
    });

    it('should have role="button"', () => {
      const component = () => Toggle({ children: 'Bold' });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');
      expect(button?.getAttribute('role')).toBe('button');
    });

    it('should have type="button"', () => {
      const component = () => Toggle({ children: 'Bold' });
      const { container } = renderComponent(component);

      const button = container.querySelector('button') as HTMLButtonElement;
      expect(button?.type).toBe('button');
    });

    it('should render with children', () => {
      const component = () => Toggle({ children: 'Bold Text' });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');
      expect(button?.textContent).toBe('Bold Text');
    });

    it('should render with custom class', () => {
      const component = () => Toggle({ class: 'custom-toggle', children: 'B' });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');
      expect(button?.classList.contains('custom-toggle')).toBe(true);
    });

    it('should generate an id if not provided', () => {
      const component = () => Toggle({ children: 'B' });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');
      expect(button?.id).toBeTruthy();
    });

    it('should use provided id', () => {
      const component = () => Toggle({ id: 'bold-toggle', children: 'B' });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');
      expect(button?.id).toBe('bold-toggle');
    });
  });

  describe('Uncontrolled Mode', () => {
    it('should render with defaultPressed=false', () => {
      const component = () => Toggle({ defaultPressed: false, children: 'B' });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');
      expect(button?.getAttribute('aria-pressed')).toBe('false');
      expect(button?.getAttribute('data-state')).toBe('off');
    });

    it('should render with defaultPressed=true', () => {
      const component = () => Toggle({ defaultPressed: true, children: 'B' });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');
      expect(button?.getAttribute('aria-pressed')).toBe('true');
      expect(button?.getAttribute('data-state')).toBe('on');
    });

    it('should toggle on click', () => {
      const component = () => Toggle({ defaultPressed: false, children: 'B' });
      const { container } = renderComponent(component);

      const button = container.querySelector('button') as HTMLButtonElement;

      // Initially not pressed
      expect(button.getAttribute('aria-pressed')).toBe('false');

      // Click to toggle
      button.click();

      // Should be pressed now
      expect(button.getAttribute('aria-pressed')).toBe('true');
      expect(button.getAttribute('data-state')).toBe('on');

      // Click again
      button.click();

      // Should be not pressed again
      expect(button.getAttribute('aria-pressed')).toBe('false');
      expect(button.getAttribute('data-state')).toBe('off');
    });
  });

  describe('Controlled Mode', () => {
    it('should support controlled state with signal', () => {
      const pressed = signal(false);
      const component = () => Toggle({ pressed, children: 'B' });
      const { container } = renderComponent(component);

      const button = container.querySelector('button') as HTMLButtonElement;

      // Initially not pressed
      expect(button.getAttribute('aria-pressed')).toBe('false');

      // Update signal
      pressed.set(true);

      // Should be pressed now
      expect(button.getAttribute('aria-pressed')).toBe('true');
      expect(button.getAttribute('data-state')).toBe('on');

      // Update signal back
      pressed.set(false);

      // Should be not pressed again
      expect(button.getAttribute('aria-pressed')).toBe('false');
      expect(button.getAttribute('data-state')).toBe('off');
    });

    it('should call onPressedChange in controlled mode', () => {
      const pressed = signal(false);
      const onPressedChange = createSpy();
      const component = () => Toggle({ pressed, onPressedChange, children: 'B' });
      const { container } = renderComponent(component);

      const button = container.querySelector('button') as HTMLButtonElement;

      // Click button
      button.click();

      // onPressedChange should be called with new state
      expect(onPressedChange.callCount).toBe(1);
      expect(onPressedChange.calls[0][0]).toBe(true);

      // Update external signal
      pressed.set(true);

      // Click again
      button.click();

      // Should call with false
      expect(onPressedChange.callCount).toBe(2);
      expect(onPressedChange.calls[1][0]).toBe(false);
    });
  });

  describe('onPressedChange Callback', () => {
    it('should call onPressedChange when toggled', () => {
      const onPressedChange = createSpy();
      const component = () => Toggle({ defaultPressed: false, onPressedChange, children: 'B' });
      const { container } = renderComponent(component);

      const button = container.querySelector('button') as HTMLButtonElement;

      // Click button
      button.click();

      // Callback should be called
      expect(onPressedChange.callCount).toBe(1);
      expect(onPressedChange.calls[0][0]).toBe(true);

      // Click again
      button.click();

      // Callback should be called again
      expect(onPressedChange.callCount).toBe(2);
      expect(onPressedChange.calls[1][0]).toBe(false);
    });

    it('should work with vi.fn() spy', () => {
      const onPressedChange = vi.fn();
      const component = () => Toggle({ defaultPressed: false, onPressedChange, children: 'B' });
      const { container } = renderComponent(component);

      const button = container.querySelector('button') as HTMLButtonElement;

      button.click();

      expect(onPressedChange).toHaveBeenCalledTimes(1);
      expect(onPressedChange).toHaveBeenCalledWith(true);
    });
  });

  describe('Disabled State', () => {
    it('should render as disabled', () => {
      const component = () => Toggle({ disabled: true, children: 'B' });
      const { container } = renderComponent(component);

      const button = container.querySelector('button') as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      expect(button.hasAttribute('data-disabled')).toBe(true);
    });

    it('should not toggle when disabled', () => {
      const onPressedChange = createSpy();
      const component = () =>
        Toggle({ disabled: true, defaultPressed: false, onPressedChange, children: 'B' });
      const { container } = renderComponent(component);

      const button = container.querySelector('button') as HTMLButtonElement;

      // Try to click
      button.click();

      // Should not toggle (button disabled attribute prevents click)
      expect(button.getAttribute('aria-pressed')).toBe('false');
      // onPressedChange should not be called
      expect(onPressedChange.callCount).toBe(0);
    });

    it('should not have data-disabled when not disabled', () => {
      const component = () => Toggle({ disabled: false, children: 'B' });
      const { container } = renderComponent(component);

      const button = container.querySelector('button') as HTMLButtonElement;
      expect(button.disabled).toBe(false);
      expect(button.hasAttribute('data-disabled')).toBe(false);
    });
  });

  describe('Keyboard Interaction', () => {
    it('should toggle on Space key', () => {
      const component = () => Toggle({ defaultPressed: false, children: 'B' });
      const { container } = renderComponent(component);

      const button = container.querySelector('button') as HTMLButtonElement;

      // Initially not pressed
      expect(button.getAttribute('aria-pressed')).toBe('false');

      // Press Space
      const spaceEvent = new KeyboardEvent('keydown', { key: ' ', bubbles: true });
      button.dispatchEvent(spaceEvent);

      // Should be pressed
      expect(button.getAttribute('aria-pressed')).toBe('true');
    });

    it('should toggle on Enter key', () => {
      const component = () => Toggle({ defaultPressed: false, children: 'B' });
      const { container } = renderComponent(component);

      const button = container.querySelector('button') as HTMLButtonElement;

      // Initially not pressed
      expect(button.getAttribute('aria-pressed')).toBe('false');

      // Press Enter
      const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
      button.dispatchEvent(enterEvent);

      // Should be pressed
      expect(button.getAttribute('aria-pressed')).toBe('true');
    });

    it('should prevent default on Space key', () => {
      const component = () => Toggle({ defaultPressed: false, children: 'B' });
      const { container } = renderComponent(component);

      const button = container.querySelector('button') as HTMLButtonElement;

      const spaceEvent = new KeyboardEvent('keydown', { key: ' ', bubbles: true });
      const preventDefaultSpy = vi.spyOn(spaceEvent, 'preventDefault');

      button.dispatchEvent(spaceEvent);

      expect(preventDefaultSpy).toHaveBeenCalled();
    });

    it('should prevent default on Enter key', () => {
      const component = () => Toggle({ defaultPressed: false, children: 'B' });
      const { container } = renderComponent(component);

      const button = container.querySelector('button') as HTMLButtonElement;

      const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
      const preventDefaultSpy = vi.spyOn(enterEvent, 'preventDefault');

      button.dispatchEvent(enterEvent);

      expect(preventDefaultSpy).toHaveBeenCalled();
    });

    it('should not toggle on other keys', () => {
      const component = () => Toggle({ defaultPressed: false, children: 'B' });
      const { container } = renderComponent(component);

      const button = container.querySelector('button') as HTMLButtonElement;

      // Press a random key
      const keyEvent = new KeyboardEvent('keydown', { key: 'a', bubbles: true });
      button.dispatchEvent(keyEvent);

      // Should still not be pressed
      expect(button.getAttribute('aria-pressed')).toBe('false');
    });

    it('should not toggle on keyboard when disabled', () => {
      const component = () => Toggle({ disabled: true, defaultPressed: false, children: 'B' });
      const { container } = renderComponent(component);

      const button = container.querySelector('button') as HTMLButtonElement;

      // Try Space key
      const spaceEvent = new KeyboardEvent('keydown', { key: ' ', bubbles: true });
      button.dispatchEvent(spaceEvent);

      // Should still not be pressed
      expect(button.getAttribute('aria-pressed')).toBe('false');
    });
  });

  describe('ARIA Attributes', () => {
    it('should have aria-pressed="false" when not pressed', () => {
      const component = () => Toggle({ defaultPressed: false, children: 'B' });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');
      expect(button?.getAttribute('aria-pressed')).toBe('false');
    });

    it('should have aria-pressed="true" when pressed', () => {
      const component = () => Toggle({ defaultPressed: true, children: 'B' });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');
      expect(button?.getAttribute('aria-pressed')).toBe('true');
    });

    it('should update aria-pressed on toggle', () => {
      const component = () => Toggle({ defaultPressed: false, children: 'B' });
      const { container } = renderComponent(component);

      const button = container.querySelector('button') as HTMLButtonElement;

      expect(button.getAttribute('aria-pressed')).toBe('false');

      button.click();

      expect(button.getAttribute('aria-pressed')).toBe('true');
    });

    it('should support custom aria-label', () => {
      const component = () =>
        Toggle({ 'aria-label': 'Toggle bold formatting', children: 'B' });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');
      expect(button?.getAttribute('aria-label')).toBe('Toggle bold formatting');
    });
  });

  describe('Data Attributes', () => {
    it('should have data-state="off" when not pressed', () => {
      const component = () => Toggle({ defaultPressed: false, children: 'B' });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');
      expect(button?.getAttribute('data-state')).toBe('off');
    });

    it('should have data-state="on" when pressed', () => {
      const component = () => Toggle({ defaultPressed: true, children: 'B' });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');
      expect(button?.getAttribute('data-state')).toBe('on');
    });

    it('should update data-state on toggle', () => {
      const component = () => Toggle({ defaultPressed: false, children: 'B' });
      const { container } = renderComponent(component);

      const button = container.querySelector('button') as HTMLButtonElement;

      expect(button.getAttribute('data-state')).toBe('off');

      button.click();

      expect(button.getAttribute('data-state')).toBe('on');

      button.click();

      expect(button.getAttribute('data-state')).toBe('off');
    });

    it('should have data-disabled when disabled', () => {
      const component = () => Toggle({ disabled: true, children: 'B' });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');
      expect(button?.hasAttribute('data-disabled')).toBe(true);
      expect(button?.getAttribute('data-disabled')).toBe('');
    });
  });

  describe('Custom Props Pass-through', () => {
    it('should pass custom data attributes', () => {
      const component = () =>
        Toggle({ 'data-testid': 'bold-toggle', 'data-cy': 'toggle-bold', children: 'B' });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');
      expect(button?.getAttribute('data-testid')).toBe('bold-toggle');
      expect(button?.getAttribute('data-cy')).toBe('toggle-bold');
    });

    it('should pass style attribute', () => {
      const component = () => Toggle({ style: 'color: red;', children: 'B' });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');
      expect(button?.getAttribute('style')).toBe('color: red;');
    });

    it('should pass title attribute', () => {
      const component = () => Toggle({ title: 'Toggle bold text', children: 'B' });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');
      expect(button?.getAttribute('title')).toBe('Toggle bold text');
    });
  });

  describe('Edge Cases', () => {
    it('should handle rapid toggling', () => {
      const component = () => Toggle({ defaultPressed: false, children: 'B' });
      const { container } = renderComponent(component);

      const button = container.querySelector('button') as HTMLButtonElement;

      // Click multiple times rapidly
      button.click();
      button.click();
      button.click();
      button.click();

      // Should be in correct state (even number of clicks = off)
      expect(button.getAttribute('aria-pressed')).toBe('false');
    });

    it('should handle undefined defaultPressed', () => {
      const component = () => Toggle({ children: 'B' });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');
      // Should default to false
      expect(button?.getAttribute('aria-pressed')).toBe('false');
    });

    it('should handle mixed click and keyboard events', () => {
      const component = () => Toggle({ defaultPressed: false, children: 'B' });
      const { container } = renderComponent(component);

      const button = container.querySelector('button') as HTMLButtonElement;

      // Click
      button.click();
      expect(button.getAttribute('aria-pressed')).toBe('true');

      // Space key
      const spaceEvent = new KeyboardEvent('keydown', { key: ' ', bubbles: true });
      button.dispatchEvent(spaceEvent);
      expect(button.getAttribute('aria-pressed')).toBe('false');

      // Enter key
      const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
      button.dispatchEvent(enterEvent);
      expect(button.getAttribute('aria-pressed')).toBe('true');
    });
  });

  describe('Real-world Scenarios', () => {
    it('should work as a text formatting toggle', () => {
      const isBold = signal(false);
      const component = () =>
        Toggle({
          pressed: isBold,
          'aria-label': 'Bold',
          onPressedChange: (pressed) => isBold.set(pressed),
          children: 'B',
        });
      const { container } = renderComponent(component);

      const button = container.querySelector('button') as HTMLButtonElement;

      expect(button.getAttribute('aria-pressed')).toBe('false');

      button.click();

      expect(button.getAttribute('aria-pressed')).toBe('true');
      expect(isBold()).toBe(true);
    });

    it('should work as a notification toggle', () => {
      const notificationsEnabled = signal(true);
      const component = () =>
        Toggle({
          pressed: notificationsEnabled,
          'aria-label': 'Enable notifications',
          children: 'Notifications',
        });
      const { container } = renderComponent(component);

      const button = container.querySelector('button') as HTMLButtonElement;

      expect(button.getAttribute('aria-pressed')).toBe('true');

      button.click();

      expect(button.getAttribute('aria-pressed')).toBe('false');
    });

    it('should work in a toolbar with multiple toggles', () => {
      const isBold = signal(false);
      const isItalic = signal(false);

      const component = () => [
        Toggle({ pressed: isBold, 'aria-label': 'Bold', children: 'B' }),
        Toggle({ pressed: isItalic, 'aria-label': 'Italic', children: 'I' }),
      ];

      const { container } = renderComponent(component);

      const buttons = container.querySelectorAll('button');
      expect(buttons.length).toBe(2);

      // Toggle first button
      (buttons[0] as HTMLButtonElement).click();
      expect(buttons[0]?.getAttribute('aria-pressed')).toBe('true');
      expect(buttons[1]?.getAttribute('aria-pressed')).toBe('false');
    });
  });
});
