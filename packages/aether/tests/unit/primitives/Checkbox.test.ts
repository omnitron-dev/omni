/**
 * Checkbox Primitive Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Checkbox, CheckboxIndicator } from '../../../src/primitives/Checkbox.js';
import { signal } from '../../../src/core/reactivity/signal.js';
import { renderComponent } from '../../helpers/test-utils.js';

describe('Checkbox', () => {
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  describe('Rendering', () => {
    it('should render a button with role="checkbox"', () => {
      const { container, dispose } = renderComponent(() => Checkbox({}));
      cleanup = dispose;

      const button = container.querySelector('button[role="checkbox"]');
      expect(button).toBeTruthy();
    });

    it('should render with type="button"', () => {
      const { container, dispose } = renderComponent(() => Checkbox({}));
      cleanup = dispose;

      const button = container.querySelector('button') as HTMLButtonElement;
      expect(button.type).toBe('button');
    });

    it('should render children', () => {
      const { container, dispose } = renderComponent(() =>
        Checkbox({
          children: 'Checkbox label',
        })
      );
      cleanup = dispose;

      expect(container.textContent).toContain('Checkbox label');
    });

    it('should generate unique ID when not provided', () => {
      const { container, dispose } = renderComponent(() => Checkbox({}));
      cleanup = dispose;

      const button = container.querySelector('button');
      expect(button?.id).toBeTruthy();
      expect(button?.id).toMatch(/^aether-/);
    });

    it('should use provided ID', () => {
      const { container, dispose } = renderComponent(() =>
        Checkbox({
          id: 'my-checkbox',
        })
      );
      cleanup = dispose;

      const button = container.querySelector('button');
      expect(button?.id).toBe('my-checkbox');
    });
  });

  describe('Checked State - Uncontrolled', () => {
    it('should be unchecked by default', () => {
      const { container, dispose } = renderComponent(() => Checkbox({}));
      cleanup = dispose;

      const button = container.querySelector('button');
      expect(button?.getAttribute('aria-checked')).toBe('false');
      expect(button?.getAttribute('data-state')).toBe('unchecked');
    });

    it('should use defaultChecked=false', () => {
      const { container, dispose } = renderComponent(() =>
        Checkbox({
          defaultChecked: false,
        })
      );
      cleanup = dispose;

      const button = container.querySelector('button');
      expect(button?.getAttribute('aria-checked')).toBe('false');
      expect(button?.getAttribute('data-state')).toBe('unchecked');
    });

    it('should use defaultChecked=true', () => {
      const { container, dispose } = renderComponent(() =>
        Checkbox({
          defaultChecked: true,
        })
      );
      cleanup = dispose;

      const button = container.querySelector('button');
      expect(button?.getAttribute('aria-checked')).toBe('true');
      expect(button?.getAttribute('data-state')).toBe('checked');
    });

    it('should use defaultChecked="indeterminate"', () => {
      const { container, dispose } = renderComponent(() =>
        Checkbox({
          defaultChecked: 'indeterminate',
        })
      );
      cleanup = dispose;

      const button = container.querySelector('button');
      expect(button?.getAttribute('aria-checked')).toBe('mixed');
      expect(button?.getAttribute('data-state')).toBe('indeterminate');
    });

    it('should toggle from unchecked to checked on click', () => {
      const { container, dispose } = renderComponent(() => Checkbox({}));
      cleanup = dispose;

      const button = container.querySelector('button') as HTMLButtonElement;
      expect(button.getAttribute('aria-checked')).toBe('false');

      button.click();

      expect(button.getAttribute('aria-checked')).toBe('true');
      expect(button.getAttribute('data-state')).toBe('checked');
    });

    it('should toggle from checked to unchecked on click', () => {
      const { container, dispose } = renderComponent(() =>
        Checkbox({
          defaultChecked: true,
        })
      );
      cleanup = dispose;

      const button = container.querySelector('button') as HTMLButtonElement;
      expect(button.getAttribute('aria-checked')).toBe('true');

      button.click();

      expect(button.getAttribute('aria-checked')).toBe('false');
      expect(button.getAttribute('data-state')).toBe('unchecked');
    });

    it('should toggle from indeterminate to checked on click', () => {
      const { container, dispose } = renderComponent(() =>
        Checkbox({
          defaultChecked: 'indeterminate',
        })
      );
      cleanup = dispose;

      const button = container.querySelector('button') as HTMLButtonElement;
      expect(button.getAttribute('aria-checked')).toBe('mixed');

      button.click();

      expect(button.getAttribute('aria-checked')).toBe('true');
      expect(button.getAttribute('data-state')).toBe('checked');
    });

    it('should toggle from checked to unchecked after indeterminate', () => {
      const { container, dispose } = renderComponent(() =>
        Checkbox({
          defaultChecked: 'indeterminate',
        })
      );
      cleanup = dispose;

      const button = container.querySelector('button') as HTMLButtonElement;
      button.click(); // indeterminate -> checked
      expect(button.getAttribute('aria-checked')).toBe('true');

      button.click(); // checked -> unchecked

      expect(button.getAttribute('aria-checked')).toBe('false');
      expect(button.getAttribute('data-state')).toBe('unchecked');
    });
  });

  describe('Checked State - Controlled', () => {
    it('should use controlled checked signal', () => {
      const checked = signal(false);
      const { container, dispose } = renderComponent(() =>
        Checkbox({
          checked,
        })
      );
      cleanup = dispose;

      const button = container.querySelector('button');
      expect(button?.getAttribute('aria-checked')).toBe('false');

      checked.set(true);

      expect(button?.getAttribute('aria-checked')).toBe('true');
      expect(button?.getAttribute('data-state')).toBe('checked');
    });

    it('should use controlled indeterminate state', () => {
      const checked = signal<'indeterminate'>('indeterminate');
      const { container, dispose } = renderComponent(() =>
        Checkbox({
          checked,
        })
      );
      cleanup = dispose;

      const button = container.querySelector('button');
      expect(button?.getAttribute('aria-checked')).toBe('mixed');
      expect(button?.getAttribute('data-state')).toBe('indeterminate');
    });

    it('should NOT update controlled signal on click', () => {
      const checked = signal(false);
      const { container, dispose } = renderComponent(() =>
        Checkbox({
          checked,
        })
      );
      cleanup = dispose;

      const button = container.querySelector('button') as HTMLButtonElement;
      button.click();

      // Signal should NOT change (controlled by parent)
      expect(checked()).toBe(false);
    });

    it('should call onCheckedChange on click in controlled mode', () => {
      const checked = signal(false);
      const onCheckedChange = vi.fn();

      const { container, dispose } = renderComponent(() =>
        Checkbox({
          checked,
          onCheckedChange,
        })
      );
      cleanup = dispose;

      const button = container.querySelector('button') as HTMLButtonElement;
      button.click();

      expect(onCheckedChange).toHaveBeenCalledTimes(1);
      expect(onCheckedChange).toHaveBeenCalledWith(true);
    });

    it('should update UI when controlled signal changes', () => {
      const checked = signal(false);
      const { container, dispose } = renderComponent(() =>
        Checkbox({
          checked,
        })
      );
      cleanup = dispose;

      const button = container.querySelector('button');
      expect(button?.getAttribute('aria-checked')).toBe('false');

      checked.set(true);
      expect(button?.getAttribute('aria-checked')).toBe('true');

      checked.set('indeterminate');
      expect(button?.getAttribute('aria-checked')).toBe('mixed');

      checked.set(false);
      expect(button?.getAttribute('aria-checked')).toBe('false');
    });
  });

  describe('onCheckedChange Callback', () => {
    it('should call onCheckedChange when unchecked to checked', () => {
      const onCheckedChange = vi.fn();
      const { container, dispose } = renderComponent(() =>
        Checkbox({
          onCheckedChange,
        })
      );
      cleanup = dispose;

      const button = container.querySelector('button') as HTMLButtonElement;
      button.click();

      expect(onCheckedChange).toHaveBeenCalledTimes(1);
      expect(onCheckedChange).toHaveBeenCalledWith(true);
    });

    it('should call onCheckedChange when checked to unchecked', () => {
      const onCheckedChange = vi.fn();
      const { container, dispose } = renderComponent(() =>
        Checkbox({
          defaultChecked: true,
          onCheckedChange,
        })
      );
      cleanup = dispose;

      const button = container.querySelector('button') as HTMLButtonElement;
      button.click();

      expect(onCheckedChange).toHaveBeenCalledTimes(1);
      expect(onCheckedChange).toHaveBeenCalledWith(false);
    });

    it('should call onCheckedChange when indeterminate to checked', () => {
      const onCheckedChange = vi.fn();
      const { container, dispose } = renderComponent(() =>
        Checkbox({
          defaultChecked: 'indeterminate',
          onCheckedChange,
        })
      );
      cleanup = dispose;

      const button = container.querySelector('button') as HTMLButtonElement;
      button.click();

      expect(onCheckedChange).toHaveBeenCalledTimes(1);
      expect(onCheckedChange).toHaveBeenCalledWith(true);
    });

    it('should not call onCheckedChange on render', () => {
      const onCheckedChange = vi.fn();
      const { dispose } = renderComponent(() =>
        Checkbox({
          defaultChecked: true,
          onCheckedChange,
        })
      );
      cleanup = dispose;

      expect(onCheckedChange).not.toHaveBeenCalled();
    });
  });

  describe('Disabled State', () => {
    it('should not be disabled by default', () => {
      const { container, dispose } = renderComponent(() => Checkbox({}));
      cleanup = dispose;

      const button = container.querySelector('button');
      expect(button?.hasAttribute('disabled')).toBe(false);
      expect(button?.hasAttribute('data-disabled')).toBe(false);
    });

    it('should be disabled when disabled=true', () => {
      const { container, dispose } = renderComponent(() =>
        Checkbox({
          disabled: true,
        })
      );
      cleanup = dispose;

      const button = container.querySelector('button');
      expect(button?.hasAttribute('disabled')).toBe(true);
      expect(button?.hasAttribute('data-disabled')).toBe(true);
    });

    it('should not toggle on click when disabled', () => {
      const onCheckedChange = vi.fn();
      const { container, dispose } = renderComponent(() =>
        Checkbox({
          disabled: true,
          onCheckedChange,
        })
      );
      cleanup = dispose;

      const button = container.querySelector('button') as HTMLButtonElement;
      const initialState = button.getAttribute('aria-checked');

      button.click();

      expect(button.getAttribute('aria-checked')).toBe(initialState);
      expect(onCheckedChange).not.toHaveBeenCalled();
    });

    it('should not toggle on Space key when disabled', () => {
      const onCheckedChange = vi.fn();
      const { container, dispose } = renderComponent(() =>
        Checkbox({
          disabled: true,
          onCheckedChange,
        })
      );
      cleanup = dispose;

      const button = container.querySelector('button') as HTMLButtonElement;
      const initialState = button.getAttribute('aria-checked');

      button.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));

      expect(button.getAttribute('aria-checked')).toBe(initialState);
      expect(onCheckedChange).not.toHaveBeenCalled();
    });
  });

  describe('Required State', () => {
    it('should not be required by default', () => {
      const { container, dispose } = renderComponent(() => Checkbox({}));
      cleanup = dispose;

      const button = container.querySelector('button');
      expect(button?.getAttribute('aria-required')).toBeNull();
    });

    it('should have aria-required when required=true', () => {
      const { container, dispose } = renderComponent(() =>
        Checkbox({
          required: true,
        })
      );
      cleanup = dispose;

      const button = container.querySelector('button');
      expect(button?.getAttribute('aria-required')).toBe('true');
    });
  });

  describe('Keyboard Handling', () => {
    it('should toggle on Space key', () => {
      const { container, dispose } = renderComponent(() => Checkbox({}));
      cleanup = dispose;

      const button = container.querySelector('button') as HTMLButtonElement;
      expect(button.getAttribute('aria-checked')).toBe('false');

      button.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));

      expect(button.getAttribute('aria-checked')).toBe('true');
    });

    it('should toggle on Enter key', () => {
      const { container, dispose } = renderComponent(() => Checkbox({}));
      cleanup = dispose;

      const button = container.querySelector('button') as HTMLButtonElement;
      expect(button.getAttribute('aria-checked')).toBe('false');

      button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

      expect(button.getAttribute('aria-checked')).toBe('true');
    });

    it('should call onCheckedChange on Space key', () => {
      const onCheckedChange = vi.fn();
      const { container, dispose } = renderComponent(() =>
        Checkbox({
          onCheckedChange,
        })
      );
      cleanup = dispose;

      const button = container.querySelector('button') as HTMLButtonElement;
      button.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));

      expect(onCheckedChange).toHaveBeenCalledWith(true);
    });

    it('should not toggle on other keys', () => {
      const onCheckedChange = vi.fn();
      const { container, dispose } = renderComponent(() =>
        Checkbox({
          onCheckedChange,
        })
      );
      cleanup = dispose;

      const button = container.querySelector('button') as HTMLButtonElement;
      button.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));

      expect(onCheckedChange).not.toHaveBeenCalled();
    });
  });

  describe('Form Integration', () => {
    it('should not render hidden input when name is not provided', () => {
      const { container, dispose } = renderComponent(() => Checkbox({}));
      cleanup = dispose;

      const hiddenInput = container.querySelector('input[type="checkbox"]');
      expect(hiddenInput).toBeNull();
    });

    it('should render hidden input when name is provided', () => {
      const { container, dispose } = renderComponent(() =>
        Checkbox({
          name: 'agree',
        })
      );
      cleanup = dispose;

      const hiddenInput = container.querySelector('input[type="checkbox"]');
      expect(hiddenInput).toBeTruthy();
      expect((hiddenInput as HTMLInputElement).name).toBe('agree');
    });

    it('should use default value "on" when value not provided', () => {
      const { container, dispose } = renderComponent(() =>
        Checkbox({
          name: 'agree',
        })
      );
      cleanup = dispose;

      const hiddenInput = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
      expect(hiddenInput.value).toBe('on');
    });

    it('should use provided value', () => {
      const { container, dispose } = renderComponent(() =>
        Checkbox({
          name: 'agree',
          value: 'yes',
        })
      );
      cleanup = dispose;

      const hiddenInput = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
      expect(hiddenInput.value).toBe('yes');
    });

    it('should sync hidden input checked state with checkbox', () => {
      const { container, dispose } = renderComponent(() =>
        Checkbox({
          name: 'agree',
        })
      );
      cleanup = dispose;

      const button = container.querySelector('button') as HTMLButtonElement;
      const hiddenInput = container.querySelector('input[type="checkbox"]') as HTMLInputElement;

      expect(hiddenInput.checked).toBe(false);

      button.click();

      expect(hiddenInput.checked).toBe(true);
    });

    it('should set required on hidden input', () => {
      const { container, dispose } = renderComponent(() =>
        Checkbox({
          name: 'agree',
          required: true,
        })
      );
      cleanup = dispose;

      const hiddenInput = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
      expect(hiddenInput.required).toBe(true);
    });

    it('should set disabled on hidden input', () => {
      const { container, dispose } = renderComponent(() =>
        Checkbox({
          name: 'agree',
          disabled: true,
        })
      );
      cleanup = dispose;

      const hiddenInput = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
      expect(hiddenInput.disabled).toBe(true);
    });

    it('should have aria-hidden on hidden input', () => {
      const { container, dispose } = renderComponent(() =>
        Checkbox({
          name: 'agree',
        })
      );
      cleanup = dispose;

      const hiddenInput = container.querySelector('input[type="checkbox"]');
      expect(hiddenInput?.getAttribute('aria-hidden')).toBe('true');
    });

    it('should have tabIndex=-1 on hidden input', () => {
      const { container, dispose } = renderComponent(() =>
        Checkbox({
          name: 'agree',
        })
      );
      cleanup = dispose;

      const hiddenInput = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
      expect(hiddenInput.tabIndex).toBe(-1);
    });

    it('should hide hidden input with styles', () => {
      const { container, dispose } = renderComponent(() =>
        Checkbox({
          name: 'agree',
        })
      );
      cleanup = dispose;

      const hiddenInput = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
      expect(hiddenInput.style.position).toBe('absolute');
      expect(hiddenInput.style.opacity).toBe('0');
      expect(hiddenInput.style.pointerEvents).toBe('none');
    });

    it('should not check hidden input when indeterminate', () => {
      const { container, dispose } = renderComponent(() =>
        Checkbox({
          name: 'agree',
          defaultChecked: 'indeterminate',
        })
      );
      cleanup = dispose;

      const hiddenInput = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
      expect(hiddenInput.checked).toBe(false);
    });
  });

  describe('Props', () => {
    it('should accept and apply className', () => {
      const { container, dispose } = renderComponent(() =>
        Checkbox({
          className: 'custom-checkbox',
        })
      );
      cleanup = dispose;

      const button = container.querySelector('button');
      expect(button?.className).toBe('custom-checkbox');
    });

    it('should accept and apply style', () => {
      const { container, dispose } = renderComponent(() =>
        Checkbox({
          style: { backgroundColor: 'red' },
        })
      );
      cleanup = dispose;

      const button = container.querySelector('button') as HTMLButtonElement;
      expect(button.style.backgroundColor).toBe('red');
    });

    it('should accept and apply data attributes', () => {
      const { container, dispose } = renderComponent(() =>
        Checkbox({
          'data-testid': 'my-checkbox',
        })
      );
      cleanup = dispose;

      const button = container.querySelector('button');
      expect(button?.getAttribute('data-testid')).toBe('my-checkbox');
    });

    it('should accept and apply aria attributes', () => {
      const { container, dispose } = renderComponent(() =>
        Checkbox({
          'aria-label': 'Accept terms',
        })
      );
      cleanup = dispose;

      const button = container.querySelector('button');
      expect(button?.getAttribute('aria-label')).toBe('Accept terms');
    });
  });
});

describe('CheckboxIndicator', () => {
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  describe('Rendering', () => {
    it('should not render when checkbox is unchecked', () => {
      const { container, dispose } = renderComponent(() =>
        Checkbox({
          children: CheckboxIndicator({
            children: '',
          }),
        })
      );
      cleanup = dispose;

      const indicator = container.querySelector('span[data-state]') as HTMLElement;
      // Indicator exists but is hidden
      expect(indicator).toBeTruthy();
      expect(indicator.style.display).toBe('none');
    });

    it('should render when checkbox is checked', () => {
      const { container, dispose } = renderComponent(() =>
        Checkbox({
          defaultChecked: true,
          children: CheckboxIndicator({
            children: '',
          }),
        })
      );
      cleanup = dispose;

      const indicator = container.querySelector('span[data-state]') as HTMLElement;
      expect(indicator.style.display).not.toBe('none');
      expect(indicator.textContent).toBe('');
    });

    it('should render when checkbox is indeterminate', () => {
      const { container, dispose } = renderComponent(() =>
        Checkbox({
          defaultChecked: 'indeterminate',
          children: CheckboxIndicator({
            children: '',
          }),
        })
      );
      cleanup = dispose;

      const indicator = container.querySelector('span[data-state]') as HTMLElement;
      expect(indicator.style.display).not.toBe('none');
      expect(indicator.textContent).toBe('');
    });

    it('should show/hide when checkbox is toggled', () => {
      const { container, dispose } = renderComponent(() =>
        Checkbox({
          children: CheckboxIndicator({
            children: '',
          }),
        })
      );
      cleanup = dispose;

      const button = container.querySelector('button') as HTMLButtonElement;
      const indicator = container.querySelector('span[data-state]') as HTMLElement;

      expect(indicator.style.display).toBe('none');

      button.click();

      expect(indicator.style.display).not.toBe('none');
    });
  });

  describe('forceMount', () => {
    it('should always render when forceMount=true and unchecked', () => {
      const { container, dispose } = renderComponent(() =>
        Checkbox({
          children: CheckboxIndicator({
            forceMount: true,
            children: '',
          }),
        })
      );
      cleanup = dispose;

      const indicator = container.querySelector('span[data-state]') as HTMLElement;
      expect(indicator).toBeTruthy();
      expect(indicator.style.display).not.toBe('none');
    });

    it('should always render when forceMount=true and checked', () => {
      const { container, dispose } = renderComponent(() =>
        Checkbox({
          defaultChecked: true,
          children: CheckboxIndicator({
            forceMount: true,
            children: '',
          }),
        })
      );
      cleanup = dispose;

      const indicator = container.querySelector('span[data-state]') as HTMLElement;
      expect(indicator).toBeTruthy();
      expect(indicator.style.display).not.toBe('none');
    });
  });

  describe('Data State', () => {
    it('should have data-state="unchecked" when unchecked', () => {
      const { container, dispose } = renderComponent(() =>
        Checkbox({
          children: CheckboxIndicator({}),
        })
      );
      cleanup = dispose;

      const indicator = container.querySelector('span[data-state]');
      expect(indicator?.getAttribute('data-state')).toBe('unchecked');
    });

    it('should have data-state="checked" when checked', () => {
      const { container, dispose } = renderComponent(() =>
        Checkbox({
          defaultChecked: true,
          children: CheckboxIndicator({}),
        })
      );
      cleanup = dispose;

      const indicator = container.querySelector('span[data-state]');
      expect(indicator?.getAttribute('data-state')).toBe('checked');
    });

    it('should have data-state="indeterminate" when indeterminate', () => {
      const { container, dispose } = renderComponent(() =>
        Checkbox({
          defaultChecked: 'indeterminate',
          children: CheckboxIndicator({}),
        })
      );
      cleanup = dispose;

      const indicator = container.querySelector('span[data-state]');
      expect(indicator?.getAttribute('data-state')).toBe('indeterminate');
    });

    it('should update data-state when checkbox state changes', () => {
      const { container, dispose } = renderComponent(() =>
        Checkbox({
          children: CheckboxIndicator({}),
        })
      );
      cleanup = dispose;

      const button = container.querySelector('button') as HTMLButtonElement;
      const indicator = container.querySelector('span[data-state]');

      expect(indicator?.getAttribute('data-state')).toBe('unchecked');

      button.click();

      expect(indicator?.getAttribute('data-state')).toBe('checked');
    });
  });

  describe('Props', () => {
    it('should accept and apply className', () => {
      const { container, dispose } = renderComponent(() =>
        Checkbox({
          defaultChecked: true,
          children: CheckboxIndicator({
            className: 'custom-indicator',
          }),
        })
      );
      cleanup = dispose;

      const indicator = container.querySelector('span[data-state]');
      expect(indicator?.className).toBe('custom-indicator');
    });

    it('should accept and apply style', () => {
      const { container, dispose } = renderComponent(() =>
        Checkbox({
          defaultChecked: true,
          children: CheckboxIndicator({
            style: { color: 'green' },
          }),
        })
      );
      cleanup = dispose;

      const indicator = container.querySelector('span[data-state]') as HTMLElement;
      expect(indicator.style.color).toBe('green');
    });

    it('should accept and apply data attributes', () => {
      const { container, dispose } = renderComponent(() =>
        Checkbox({
          defaultChecked: true,
          children: CheckboxIndicator({
            'data-testid': 'my-indicator',
          }),
        })
      );
      cleanup = dispose;

      const indicator = container.querySelector('span[data-state]');
      expect(indicator?.getAttribute('data-testid')).toBe('my-indicator');
    });
  });
});
