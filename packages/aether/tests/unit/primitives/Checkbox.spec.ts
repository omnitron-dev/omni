/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { signal } from '../../../src/core/reactivity/signal.js';
import { Checkbox, CheckboxIndicator } from '../../../src/primitives/Checkbox.js';
import { renderComponent } from '../../helpers/test-utils.js';

describe('Checkbox', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('Exports', () => {
    it('should export Checkbox component', () => {
      expect(Checkbox).toBeTypeOf('function');
    });

    it('should export CheckboxIndicator component', () => {
      expect(CheckboxIndicator).toBeTypeOf('function');
    });

    it('should attach Indicator as Checkbox.Indicator', () => {
      expect((Checkbox as any).Indicator).toBe(CheckboxIndicator);
    });
  });

  describe('Structure', () => {
    it('should render checkbox as button with type="button"', () => {
      const component = () =>
        Checkbox({
          defaultChecked: false,
          children: CheckboxIndicator({}),
        });

      const { container } = renderComponent(component);

      const checkboxEl = container.querySelector('[role="checkbox"]') as HTMLElement;
      expect(checkboxEl).toBeTruthy();
      expect(checkboxEl.tagName).toBe('BUTTON');
      expect(checkboxEl.getAttribute('type')).toBe('button');
    });

    it('should render with role="checkbox"', () => {
      const component = () =>
        Checkbox({
          defaultChecked: false,
          children: CheckboxIndicator({}),
        });

      const { container } = renderComponent(component);

      const checkboxEl = container.querySelector('[role="checkbox"]');
      expect(checkboxEl).toBeTruthy();
    });

    it('should render with aria-checked attribute', () => {
      const component = () =>
        Checkbox({
          defaultChecked: false,
          children: CheckboxIndicator({}),
        });

      const { container } = renderComponent(component);

      const checkboxEl = container.querySelector('[role="checkbox"]') as HTMLElement;
      expect(checkboxEl.hasAttribute('aria-checked')).toBe(true);
    });

    it('should render with data-state attribute', () => {
      const component = () =>
        Checkbox({
          defaultChecked: false,
          children: CheckboxIndicator({}),
        });

      const { container } = renderComponent(component);

      const checkboxEl = container.querySelector('[role="checkbox"]') as HTMLElement;
      expect(checkboxEl.hasAttribute('data-state')).toBe(true);
    });

    it('should accept custom id', () => {
      const component = () =>
        Checkbox({
          id: 'my-checkbox',
          defaultChecked: false,
          children: CheckboxIndicator({}),
        });

      const { container } = renderComponent(component);

      const checkboxEl = container.querySelector('[role="checkbox"]') as HTMLElement;
      expect(checkboxEl.id).toBe('my-checkbox');
    });
  });

  describe('State - Uncontrolled', () => {
    it('should default to unchecked when defaultChecked is not provided', () => {
      const component = () =>
        Checkbox({
          children: CheckboxIndicator({}),
        });

      const { container } = renderComponent(component);

      const checkboxEl = container.querySelector('[role="checkbox"]') as HTMLElement;
      expect(checkboxEl.getAttribute('aria-checked')).toBe('false');
      expect(checkboxEl.getAttribute('data-state')).toBe('unchecked');
    });

    it('should render unchecked with defaultChecked=false', () => {
      const component = () =>
        Checkbox({
          defaultChecked: false,
          children: CheckboxIndicator({}),
        });

      const { container } = renderComponent(component);

      const checkboxEl = container.querySelector('[role="checkbox"]') as HTMLElement;
      expect(checkboxEl.getAttribute('aria-checked')).toBe('false');
      expect(checkboxEl.getAttribute('data-state')).toBe('unchecked');
    });

    it('should render checked with defaultChecked=true', () => {
      const component = () =>
        Checkbox({
          defaultChecked: true,
          children: CheckboxIndicator({}),
        });

      const { container } = renderComponent(component);

      const checkboxEl = container.querySelector('[role="checkbox"]') as HTMLElement;
      expect(checkboxEl.getAttribute('aria-checked')).toBe('true');
      expect(checkboxEl.getAttribute('data-state')).toBe('checked');
    });

    it('should toggle checked state on click', () => {
      const component = () =>
        Checkbox({
          defaultChecked: false,
          children: CheckboxIndicator({}),
        });

      const { container } = renderComponent(component);

      const checkboxEl = container.querySelector('[role="checkbox"]') as HTMLElement;

      // Initially unchecked
      expect(checkboxEl.getAttribute('aria-checked')).toBe('false');

      // Click to toggle
      checkboxEl.click();

      // Should be checked now
      expect(checkboxEl.getAttribute('aria-checked')).toBe('true');
      expect(checkboxEl.getAttribute('data-state')).toBe('checked');

      // Click again to toggle back
      checkboxEl.click();

      // Should be unchecked
      expect(checkboxEl.getAttribute('aria-checked')).toBe('false');
      expect(checkboxEl.getAttribute('data-state')).toBe('unchecked');
    });

    it('should call onCheckedChange when state changes', () => {
      let capturedValue: boolean | 'indeterminate' | undefined;

      const component = () =>
        Checkbox({
          defaultChecked: false,
          onCheckedChange: (checked) => {
            capturedValue = checked;
          },
          children: CheckboxIndicator({}),
        });

      const { container } = renderComponent(component);

      const checkboxEl = container.querySelector('[role="checkbox"]') as HTMLElement;

      // Click to toggle
      checkboxEl.click();

      // Callback should be called with true
      expect(capturedValue).toBe(true);

      // Click again
      checkboxEl.click();

      // Callback should be called with false
      expect(capturedValue).toBe(false);
    });
  });

  describe('State - Controlled', () => {
    it('should support controlled mode with checked prop', () => {
      const checked = signal<boolean | 'indeterminate'>(false);

      const component = () =>
        Checkbox({
          checked,
          children: CheckboxIndicator({}),
        });

      const { container } = renderComponent(component);

      const checkboxEl = container.querySelector('[role="checkbox"]') as HTMLElement;

      // Initially unchecked
      expect(checkboxEl.getAttribute('aria-checked')).toBe('false');

      // Change controlled value
      checked.set(true);

      // Should be checked now
      expect(checkboxEl.getAttribute('aria-checked')).toBe('true');

      // Change back
      checked.set(false);

      // Should be unchecked
      expect(checkboxEl.getAttribute('aria-checked')).toBe('false');
    });

    it('should update when controlled signal changes', () => {
      const checked = signal<boolean | 'indeterminate'>(false);

      const component = () =>
        Checkbox({
          checked,
          children: CheckboxIndicator({}),
        });

      const { container } = renderComponent(component);

      const checkboxEl = container.querySelector('[role="checkbox"]') as HTMLElement;

      // Toggle via signal
      checked.set(true);
      expect(checkboxEl.getAttribute('data-state')).toBe('checked');

      checked.set(false);
      expect(checkboxEl.getAttribute('data-state')).toBe('unchecked');
    });

    it('should call onCheckedChange in controlled mode', () => {
      const checked = signal<boolean | 'indeterminate'>(false);
      let callbackValue: boolean | 'indeterminate' | undefined;

      const component = () =>
        Checkbox({
          checked,
          onCheckedChange: (value) => {
            callbackValue = value;
            checked.set(value);
          },
          children: CheckboxIndicator({}),
        });

      const { container } = renderComponent(component);

      const checkboxEl = container.querySelector('[role="checkbox"]') as HTMLElement;

      // Click to toggle
      checkboxEl.click();

      // Callback should be called
      expect(callbackValue).toBe(true);
      expect(checked()).toBe(true);
    });
  });

  describe('Indeterminate State', () => {
    it('should render indeterminate state with defaultChecked="indeterminate"', () => {
      const component = () =>
        Checkbox({
          defaultChecked: 'indeterminate',
          children: CheckboxIndicator({}),
        });

      const { container } = renderComponent(component);

      const checkboxEl = container.querySelector('[role="checkbox"]') as HTMLElement;
      expect(checkboxEl.getAttribute('aria-checked')).toBe('mixed');
      expect(checkboxEl.getAttribute('data-state')).toBe('indeterminate');
    });

    it('should support controlled indeterminate state', () => {
      const checked = signal<boolean | 'indeterminate'>('indeterminate');

      const component = () =>
        Checkbox({
          checked,
          children: CheckboxIndicator({}),
        });

      const { container } = renderComponent(component);

      const checkboxEl = container.querySelector('[role="checkbox"]') as HTMLElement;
      expect(checkboxEl.getAttribute('aria-checked')).toBe('mixed');
      expect(checkboxEl.getAttribute('data-state')).toBe('indeterminate');
    });

    it('should transition from indeterminate to checked on click', () => {
      const component = () =>
        Checkbox({
          defaultChecked: 'indeterminate',
          children: CheckboxIndicator({}),
        });

      const { container } = renderComponent(component);

      const checkboxEl = container.querySelector('[role="checkbox"]') as HTMLElement;

      // Initially indeterminate
      expect(checkboxEl.getAttribute('aria-checked')).toBe('mixed');

      // Click to toggle
      checkboxEl.click();

      // Should be checked (not unchecked)
      expect(checkboxEl.getAttribute('aria-checked')).toBe('true');
      expect(checkboxEl.getAttribute('data-state')).toBe('checked');
    });

    it('should call onCheckedChange with true when clicked from indeterminate', () => {
      let capturedValue: boolean | 'indeterminate' | undefined;

      const component = () =>
        Checkbox({
          defaultChecked: 'indeterminate',
          onCheckedChange: (checked) => {
            capturedValue = checked;
          },
          children: CheckboxIndicator({}),
        });

      const { container } = renderComponent(component);

      const checkboxEl = container.querySelector('[role="checkbox"]') as HTMLElement;

      // Click to toggle
      checkboxEl.click();

      // Should transition to true, not false
      expect(capturedValue).toBe(true);
    });
  });

  describe('Disabled State', () => {
    it('should render disabled state', () => {
      const component = () =>
        Checkbox({
          defaultChecked: false,
          disabled: true,
          children: CheckboxIndicator({}),
        });

      const { container } = renderComponent(component);

      const checkboxEl = container.querySelector('[role="checkbox"]') as HTMLElement;
      expect(checkboxEl.hasAttribute('disabled')).toBe(true);
      expect(checkboxEl.getAttribute('data-disabled')).toBe('');
    });

    it('should not toggle when disabled and clicked', () => {
      const component = () =>
        Checkbox({
          defaultChecked: false,
          disabled: true,
          children: CheckboxIndicator({}),
        });

      const { container } = renderComponent(component);

      const checkboxEl = container.querySelector('[role="checkbox"]') as HTMLElement;

      // Try to click (button disabled prevents click from executing handler)
      checkboxEl.click();

      // Should still be unchecked
      expect(checkboxEl.getAttribute('aria-checked')).toBe('false');
    });

    it('should not call onCheckedChange when disabled', () => {
      let callbackCalled = false;

      const component = () =>
        Checkbox({
          defaultChecked: false,
          disabled: true,
          onCheckedChange: () => {
            callbackCalled = true;
          },
          children: CheckboxIndicator({}),
        });

      const { container } = renderComponent(component);

      const checkboxEl = container.querySelector('[role="checkbox"]') as HTMLElement;

      // Try to click
      checkboxEl.click();

      // Callback should not be called (browser prevents click on disabled button)
      expect(callbackCalled).toBe(false);
    });
  });

  describe('Required State', () => {
    it('should have aria-required when required', () => {
      const component = () =>
        Checkbox({
          defaultChecked: false,
          required: true,
          children: CheckboxIndicator({}),
        });

      const { container } = renderComponent(component);

      const checkboxEl = container.querySelector('[role="checkbox"]') as HTMLElement;
      expect(checkboxEl.getAttribute('aria-required')).toBe('true');
    });

    it('should not have aria-required when not required', () => {
      const component = () =>
        Checkbox({
          defaultChecked: false,
          required: false,
          children: CheckboxIndicator({}),
        });

      const { container } = renderComponent(component);

      const checkboxEl = container.querySelector('[role="checkbox"]') as HTMLElement;
      expect(checkboxEl.hasAttribute('aria-required')).toBe(false);
    });
  });

  describe('ARIA & Accessibility', () => {
    it('should set aria-checked to "true" when checked', () => {
      const component = () =>
        Checkbox({
          defaultChecked: true,
          children: CheckboxIndicator({}),
        });

      const { container } = renderComponent(component);

      const checkboxEl = container.querySelector('[role="checkbox"]') as HTMLElement;
      expect(checkboxEl.getAttribute('aria-checked')).toBe('true');
    });

    it('should set aria-checked to "false" when unchecked', () => {
      const component = () =>
        Checkbox({
          defaultChecked: false,
          children: CheckboxIndicator({}),
        });

      const { container } = renderComponent(component);

      const checkboxEl = container.querySelector('[role="checkbox"]') as HTMLElement;
      expect(checkboxEl.getAttribute('aria-checked')).toBe('false');
    });

    it('should set aria-checked to "mixed" when indeterminate', () => {
      const component = () =>
        Checkbox({
          defaultChecked: 'indeterminate',
          children: CheckboxIndicator({}),
        });

      const { container } = renderComponent(component);

      const checkboxEl = container.querySelector('[role="checkbox"]') as HTMLElement;
      expect(checkboxEl.getAttribute('aria-checked')).toBe('mixed');
    });

    it('should set data-state to "checked" when checked', () => {
      const component = () =>
        Checkbox({
          defaultChecked: true,
          children: CheckboxIndicator({}),
        });

      const { container } = renderComponent(component);

      const checkboxEl = container.querySelector('[role="checkbox"]') as HTMLElement;
      expect(checkboxEl.getAttribute('data-state')).toBe('checked');
    });

    it('should set data-state to "unchecked" when unchecked', () => {
      const component = () =>
        Checkbox({
          defaultChecked: false,
          children: CheckboxIndicator({}),
        });

      const { container } = renderComponent(component);

      const checkboxEl = container.querySelector('[role="checkbox"]') as HTMLElement;
      expect(checkboxEl.getAttribute('data-state')).toBe('unchecked');
    });

    it('should set data-state to "indeterminate" when indeterminate', () => {
      const component = () =>
        Checkbox({
          defaultChecked: 'indeterminate',
          children: CheckboxIndicator({}),
        });

      const { container } = renderComponent(component);

      const checkboxEl = container.querySelector('[role="checkbox"]') as HTMLElement;
      expect(checkboxEl.getAttribute('data-state')).toBe('indeterminate');
    });

    it('should set data-disabled when disabled', () => {
      const component = () =>
        Checkbox({
          defaultChecked: false,
          disabled: true,
          children: CheckboxIndicator({}),
        });

      const { container } = renderComponent(component);

      const checkboxEl = container.querySelector('[role="checkbox"]') as HTMLElement;
      expect(checkboxEl.getAttribute('data-disabled')).toBe('');
    });

    it('should not set data-disabled when not disabled', () => {
      const component = () =>
        Checkbox({
          defaultChecked: false,
          disabled: false,
          children: CheckboxIndicator({}),
        });

      const { container } = renderComponent(component);

      const checkboxEl = container.querySelector('[role="checkbox"]') as HTMLElement;
      expect(checkboxEl.hasAttribute('data-disabled')).toBe(false);
    });
  });

  describe('Keyboard Interaction', () => {
    it('should toggle on Space key', () => {
      const component = () =>
        Checkbox({
          defaultChecked: false,
          children: CheckboxIndicator({}),
        });

      const { container } = renderComponent(component);

      const checkboxEl = container.querySelector('[role="checkbox"]') as HTMLElement;

      // Press Space
      const spaceEvent = new KeyboardEvent('keydown', { key: ' ', bubbles: true });
      checkboxEl.dispatchEvent(spaceEvent);

      // Should be checked
      expect(checkboxEl.getAttribute('aria-checked')).toBe('true');
    });

    it('should toggle on Enter key', () => {
      const component = () =>
        Checkbox({
          defaultChecked: false,
          children: CheckboxIndicator({}),
        });

      const { container } = renderComponent(component);

      const checkboxEl = container.querySelector('[role="checkbox"]') as HTMLElement;

      // Press Enter
      const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
      checkboxEl.dispatchEvent(enterEvent);

      // Should be checked
      expect(checkboxEl.getAttribute('aria-checked')).toBe('true');
    });

    it('should not toggle when disabled on Space key', () => {
      const component = () =>
        Checkbox({
          defaultChecked: false,
          disabled: true,
          children: CheckboxIndicator({}),
        });

      const { container } = renderComponent(component);

      const checkboxEl = container.querySelector('[role="checkbox"]') as HTMLElement;

      // Press Space (should not toggle due to disabled state check)
      const spaceEvent = new KeyboardEvent('keydown', { key: ' ', bubbles: true });
      checkboxEl.dispatchEvent(spaceEvent);

      // Should still be unchecked
      expect(checkboxEl.getAttribute('aria-checked')).toBe('false');
    });

    it('should not toggle when disabled on Enter key', () => {
      const component = () =>
        Checkbox({
          defaultChecked: false,
          disabled: true,
          children: CheckboxIndicator({}),
        });

      const { container } = renderComponent(component);

      const checkboxEl = container.querySelector('[role="checkbox"]') as HTMLElement;

      // Press Enter (should not toggle due to disabled state check)
      const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
      checkboxEl.dispatchEvent(enterEvent);

      // Should still be unchecked
      expect(checkboxEl.getAttribute('aria-checked')).toBe('false');
    });

    it('should call onCheckedChange on keyboard toggle', () => {
      let capturedValue: boolean | 'indeterminate' | undefined;

      const component = () =>
        Checkbox({
          defaultChecked: false,
          onCheckedChange: (checked) => {
            capturedValue = checked;
          },
          children: CheckboxIndicator({}),
        });

      const { container } = renderComponent(component);

      const checkboxEl = container.querySelector('[role="checkbox"]') as HTMLElement;

      // Press Space
      const spaceEvent = new KeyboardEvent('keydown', { key: ' ', bubbles: true });
      checkboxEl.dispatchEvent(spaceEvent);

      // Callback should be called
      expect(capturedValue).toBe(true);
    });

    it('should ignore other keys', () => {
      const component = () =>
        Checkbox({
          defaultChecked: false,
          children: CheckboxIndicator({}),
        });

      const { container } = renderComponent(component);

      const checkboxEl = container.querySelector('[role="checkbox"]') as HTMLElement;

      // Press random key
      const keyEvent = new KeyboardEvent('keydown', { key: 'a', bubbles: true });
      checkboxEl.dispatchEvent(keyEvent);

      // Should still be unchecked
      expect(checkboxEl.getAttribute('aria-checked')).toBe('false');
    });
  });

  describe('Form Integration', () => {
    it('should render hidden input with name and value', () => {
      const component = () =>
        Checkbox({
          defaultChecked: true,
          name: 'terms',
          value: 'accepted',
          children: CheckboxIndicator({}),
        });

      const { container } = renderComponent(component);

      const hiddenInput = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
      expect(hiddenInput).toBeTruthy();
      expect(hiddenInput.name).toBe('terms');
      expect(hiddenInput.value).toBe('accepted');
      expect(hiddenInput.checked).toBe(true);
      expect(hiddenInput.getAttribute('aria-hidden')).toBe('true');
    });

    it('should update hidden input value when checked', () => {
      const component = () =>
        Checkbox({
          defaultChecked: false,
          name: 'subscribe',
          value: 'yes',
          children: CheckboxIndicator({}),
        });

      const { container } = renderComponent(component);

      const checkboxEl = container.querySelector('[role="checkbox"]') as HTMLElement;
      const hiddenInput = container.querySelector('input[type="checkbox"]') as HTMLInputElement;

      // Initially unchecked
      expect(hiddenInput.checked).toBe(false);

      // Click to toggle
      checkboxEl.click();

      // Should be checked now
      expect(hiddenInput.checked).toBe(true);
    });

    it('should default value to "on" when value prop not provided', () => {
      const component = () =>
        Checkbox({
          defaultChecked: true,
          name: 'checkbox',
          children: CheckboxIndicator({}),
        });

      const { container } = renderComponent(component);

      const hiddenInput = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
      expect(hiddenInput.value).toBe('on');
    });

    it('should not render hidden input when name is not provided', () => {
      const component = () =>
        Checkbox({
          defaultChecked: true,
          children: CheckboxIndicator({}),
        });

      const { container } = renderComponent(component);

      const hiddenInput = container.querySelector('input[type="checkbox"]');
      expect(hiddenInput).toBeNull();
    });

    it('should set required on hidden input when required', () => {
      const component = () =>
        Checkbox({
          defaultChecked: false,
          name: 'terms',
          required: true,
          children: CheckboxIndicator({}),
        });

      const { container } = renderComponent(component);

      const hiddenInput = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
      expect(hiddenInput.required).toBe(true);
    });

    it('should set disabled on hidden input when disabled', () => {
      const component = () =>
        Checkbox({
          defaultChecked: false,
          name: 'terms',
          disabled: true,
          children: CheckboxIndicator({}),
        });

      const { container } = renderComponent(component);

      const hiddenInput = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
      expect(hiddenInput.disabled).toBe(true);
    });

    it('should not check hidden input when indeterminate', () => {
      const component = () =>
        Checkbox({
          defaultChecked: 'indeterminate',
          name: 'partialSelection',
          children: CheckboxIndicator({}),
        });

      const { container } = renderComponent(component);

      const hiddenInput = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
      expect(hiddenInput.checked).toBe(false);
    });
  });

  describe('Checkbox.Indicator', () => {
    it('should render indicator only when checked', async () => {
      const component = () =>
        Checkbox({
          defaultChecked: true,
          children: CheckboxIndicator({ class: 'indicator' }),
        });

      const { container } = renderComponent(component);

      // Wait for microtask to complete
      await new Promise((resolve) => setTimeout(resolve, 0));

      const indicator = container.querySelector('.indicator');
      expect(indicator).toBeTruthy();
    });

    it('should not render indicator when unchecked', async () => {
      const component = () =>
        Checkbox({
          defaultChecked: false,
          children: CheckboxIndicator({ class: 'indicator' }),
        });

      const { container } = renderComponent(component);

      // Wait for microtask to complete
      await new Promise((resolve) => setTimeout(resolve, 0));

      const indicator = container.querySelector('.indicator') as HTMLElement;
      expect(indicator).toBeTruthy();
      expect(indicator.style.display).toBe('none');
    });

    it('should render indicator when indeterminate', async () => {
      const component = () =>
        Checkbox({
          defaultChecked: 'indeterminate',
          children: CheckboxIndicator({ class: 'indicator' }),
        });

      const { container } = renderComponent(component);

      // Wait for microtask to complete
      await new Promise((resolve) => setTimeout(resolve, 0));

      const indicator = container.querySelector('.indicator');
      expect(indicator).toBeTruthy();
    });

    it('should render indicator with forceMount even when unchecked', async () => {
      const component = () =>
        Checkbox({
          defaultChecked: false,
          children: CheckboxIndicator({ class: 'indicator', forceMount: true }),
        });

      const { container } = renderComponent(component);

      // Wait for microtask to complete
      await new Promise((resolve) => setTimeout(resolve, 0));

      const indicator = container.querySelector('.indicator');
      expect(indicator).toBeTruthy();
    });

    it('should set data-state to "checked" on indicator when checked', async () => {
      const component = () =>
        Checkbox({
          defaultChecked: true,
          children: CheckboxIndicator({ class: 'indicator' }),
        });

      const { container } = renderComponent(component);

      // Wait for microtask to complete
      await new Promise((resolve) => setTimeout(resolve, 0));

      const indicator = container.querySelector('.indicator') as HTMLElement;
      expect(indicator.getAttribute('data-state')).toBe('checked');
    });

    it('should set data-state to "indeterminate" on indicator when indeterminate', async () => {
      const component = () =>
        Checkbox({
          defaultChecked: 'indeterminate',
          children: CheckboxIndicator({ class: 'indicator' }),
        });

      const { container } = renderComponent(component);

      // Wait for microtask to complete
      await new Promise((resolve) => setTimeout(resolve, 0));

      const indicator = container.querySelector('.indicator') as HTMLElement;
      expect(indicator.getAttribute('data-state')).toBe('indeterminate');
    });

    it('should accept custom children (checkmark icon)', async () => {
      const component = () =>
        Checkbox({
          defaultChecked: true,
          children: CheckboxIndicator({
            class: 'indicator',
            children: 'CheckIcon',
          }),
        });

      const { container } = renderComponent(component);

      // Wait for microtask to complete
      await new Promise((resolve) => setTimeout(resolve, 0));

      const indicator = container.querySelector('.indicator') as HTMLElement;
      expect(indicator.textContent).toBe('CheckIcon');
    });

    it('should update indicator visibility when checkbox toggles', async () => {
      const component = () =>
        Checkbox({
          defaultChecked: false,
          children: CheckboxIndicator({ class: 'indicator' }),
        });

      const { container } = renderComponent(component);

      const checkboxEl = container.querySelector('[role="checkbox"]') as HTMLElement;

      // Wait for microtask to complete
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Initially hidden (unchecked)
      let indicator = container.querySelector('.indicator') as HTMLElement;
      expect(indicator).toBeTruthy();
      expect(indicator.style.display).toBe('none');

      // Toggle to checked
      checkboxEl.click();

      // Wait for update
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Should be visible now
      indicator = container.querySelector('.indicator') as HTMLElement;
      expect(indicator).toBeTruthy();
      expect(indicator.style.display).toBe('');

      // Toggle back to unchecked
      checkboxEl.click();

      // Wait for update
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Should be hidden again
      indicator = container.querySelector('.indicator') as HTMLElement;
      expect(indicator).toBeTruthy();
      expect(indicator.style.display).toBe('none');
    });

    it('should keep indicator visible with forceMount during all states', async () => {
      const checked = signal<boolean | 'indeterminate'>(false);

      const component = () =>
        Checkbox({
          checked,
          children: CheckboxIndicator({ class: 'indicator', forceMount: true }),
        });

      const { container } = renderComponent(component);

      // Wait for microtask to complete
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Unchecked - still visible
      let indicator = container.querySelector('.indicator');
      expect(indicator).toBeTruthy();

      // Checked - still visible
      checked.set(true);
      await new Promise((resolve) => setTimeout(resolve, 0));
      indicator = container.querySelector('.indicator');
      expect(indicator).toBeTruthy();

      // Indeterminate - still visible
      checked.set('indeterminate');
      await new Promise((resolve) => setTimeout(resolve, 0));
      indicator = container.querySelector('.indicator');
      expect(indicator).toBeTruthy();
    });
  });
});
