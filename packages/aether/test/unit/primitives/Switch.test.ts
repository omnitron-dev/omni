/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { signal } from '../../../src/core/reactivity/signal.js';
import { Switch, SwitchThumb } from '../../../src/primitives/Switch.js';
import { renderComponent } from '../../helpers/test-utils.js';

describe('Switch', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('Basic functionality', () => {
    it('should render switch with default state', () => {
      const component = () =>
        Switch({
          defaultChecked: false,
          children: SwitchThumb({}),
        });

      const { container } = renderComponent(component);

      const switchEl = container.querySelector('[role="switch"]') as HTMLElement;
      expect(switchEl).toBeTruthy();
      expect(switchEl.getAttribute('aria-checked')).toBe('false');
      expect(switchEl.getAttribute('data-state')).toBe('unchecked');
    });

    it('should render switch with default checked state', () => {
      const component = () =>
        Switch({
          defaultChecked: true,
          children: SwitchThumb({}),
        });

      const { container } = renderComponent(component);

      const switchEl = container.querySelector('[role="switch"]') as HTMLElement;
      expect(switchEl.getAttribute('aria-checked')).toBe('true');
      expect(switchEl.getAttribute('data-state')).toBe('checked');
    });

    it('should toggle on click', () => {
      const component = () =>
        Switch({
          defaultChecked: false,
          children: SwitchThumb({}),
        });

      const { container } = renderComponent(component);

      const switchEl = container.querySelector('[role="switch"]') as HTMLElement;

      // Initially unchecked
      expect(switchEl.getAttribute('aria-checked')).toBe('false');

      // Click to toggle
      switchEl.click();

      // Should be checked now
      expect(switchEl.getAttribute('aria-checked')).toBe('true');
      expect(switchEl.getAttribute('data-state')).toBe('checked');

      // Click again to toggle back
      switchEl.click();

      // Should be unchecked
      expect(switchEl.getAttribute('aria-checked')).toBe('false');
      expect(switchEl.getAttribute('data-state')).toBe('unchecked');
    });

    it('should support controlled state', () => {
      const checked = signal(false);

      const component = () =>
        Switch({
          checked,
          children: SwitchThumb({}),
        });

      const { container } = renderComponent(component);

      const switchEl = container.querySelector('[role="switch"]') as HTMLElement;

      // Initially unchecked
      expect(switchEl.getAttribute('aria-checked')).toBe('false');

      // Change controlled value
      checked.set(true);

      // Should be checked now
      expect(switchEl.getAttribute('aria-checked')).toBe('true');

      // Change back
      checked.set(false);

      // Should be unchecked
      expect(switchEl.getAttribute('aria-checked')).toBe('false');
    });
  });

  describe('Keyboard interaction', () => {
    it('should toggle on Space key', () => {
      const component = () =>
        Switch({
          defaultChecked: false,
          children: SwitchThumb({}),
        });

      const { container } = renderComponent(component);

      const switchEl = container.querySelector('[role="switch"]') as HTMLElement;

      // Press Space
      const spaceEvent = new KeyboardEvent('keydown', { key: ' ', bubbles: true });
      switchEl.dispatchEvent(spaceEvent);

      // Should be checked
      expect(switchEl.getAttribute('aria-checked')).toBe('true');
    });

    it('should toggle on Enter key', () => {
      const component = () =>
        Switch({
          defaultChecked: false,
          children: SwitchThumb({}),
        });

      const { container } = renderComponent(component);

      const switchEl = container.querySelector('[role="switch"]') as HTMLElement;

      // Press Enter
      const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
      switchEl.dispatchEvent(enterEvent);

      // Should be checked
      expect(switchEl.getAttribute('aria-checked')).toBe('true');
    });
  });

  describe('Disabled state', () => {
    it('should not toggle when disabled', () => {
      const component = () =>
        Switch({
          defaultChecked: false,
          disabled: true,
          children: SwitchThumb({}),
        });

      const { container } = renderComponent(component);

      const switchEl = container.querySelector('[role="switch"]') as HTMLElement;

      expect(switchEl.hasAttribute('disabled')).toBe(true);
      expect(switchEl.getAttribute('data-disabled')).toBe('');

      // Try to click
      switchEl.click();

      // Should still be unchecked (button disabled prevents click)
      expect(switchEl.getAttribute('aria-checked')).toBe('false');
    });
  });

  describe('Required state', () => {
    it('should have aria-required when required', () => {
      const component = () =>
        Switch({
          defaultChecked: false,
          required: true,
          children: SwitchThumb({}),
        });

      const { container } = renderComponent(component);

      const switchEl = container.querySelector('[role="switch"]') as HTMLElement;
      expect(switchEl.getAttribute('aria-required')).toBe('true');
    });
  });

  describe('Form integration', () => {
    it('should include hidden input for forms', () => {
      const component = () =>
        Switch({
          defaultChecked: true,
          name: 'notifications',
          value: 'on',
          children: SwitchThumb({}),
        });

      const { container } = renderComponent(component);

      const hiddenInput = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
      expect(hiddenInput).toBeTruthy();
      expect(hiddenInput.name).toBe('notifications');
      expect(hiddenInput.value).toBe('on');
      expect(hiddenInput.checked).toBe(true);
      expect(hiddenInput.getAttribute('aria-hidden')).toBe('true');
    });

    it('should not include hidden input when name is not provided', () => {
      const component = () =>
        Switch({
          defaultChecked: true,
          children: SwitchThumb({}),
        });

      const { container } = renderComponent(component);

      const hiddenInput = container.querySelector('input[type="checkbox"]');
      expect(hiddenInput).toBeNull();
    });
  });

  describe('Switch.Thumb', () => {
    it('should render thumb with correct data attributes', async () => {
      const component = () =>
        Switch({
          defaultChecked: true,
          children: SwitchThumb({ class: 'custom-thumb' }),
        });

      const { container } = renderComponent(component);

      const thumb = container.querySelector('.custom-thumb') as HTMLElement;
      expect(thumb).toBeTruthy();

      // Wait for microtask to complete
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(thumb.getAttribute('data-state')).toBe('checked');
    });

    it('should update thumb state when switch toggles', async () => {
      const component = () =>
        Switch({
          defaultChecked: false,
          children: SwitchThumb({ class: 'thumb' }),
        });

      const { container } = renderComponent(component);

      const switchEl = container.querySelector('[role="switch"]') as HTMLElement;
      const thumb = container.querySelector('.thumb') as HTMLElement;

      // Wait for microtask to complete
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Initially unchecked
      expect(thumb.getAttribute('data-state')).toBe('unchecked');

      // Toggle
      switchEl.click();

      // Wait for update
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Should be checked
      expect(thumb.getAttribute('data-state')).toBe('checked');
    });

    it('should show disabled state on thumb', async () => {
      const component = () =>
        Switch({
          defaultChecked: false,
          disabled: true,
          children: SwitchThumb({ class: 'thumb' }),
        });

      const { container } = renderComponent(component);

      const thumb = container.querySelector('.thumb') as HTMLElement;

      // Wait for microtask to complete
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(thumb.getAttribute('data-disabled')).toBe('');
    });
  });

  describe('Accessibility', () => {
    it('should have proper ARIA role', () => {
      const component = () =>
        Switch({
          defaultChecked: false,
          children: SwitchThumb({}),
        });

      const { container } = renderComponent(component);

      const switchEl = container.querySelector('[role="switch"]');
      expect(switchEl).toBeTruthy();
    });

    it('should be a button element', () => {
      const component = () =>
        Switch({
          defaultChecked: false,
          children: SwitchThumb({}),
        });

      const { container } = renderComponent(component);

      const switchEl = container.querySelector('[role="switch"]') as HTMLElement;
      expect(switchEl.tagName).toBe('BUTTON');
      expect(switchEl.getAttribute('type')).toBe('button');
    });
  });
});
