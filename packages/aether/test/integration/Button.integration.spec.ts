/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { signal } from '../../src/core/reactivity/signal.js';
import { Button } from '../../src/primitives/Button.js';
import { IconProvider } from '../../src/svg/icons/IconProvider.js';
import { renderComponent, nextTick } from '../helpers/test-utils.js';

describe('Button Integration Tests', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('Icon integration with IconProvider', () => {
    it('should render icons from registry', () => {
      // Mock icon registry
      const mockRegistry = {
        trash: () => '<svg><path d="M3 6h18"></path></svg>',
        check: () => '<svg><path d="M20 6L9 17l-5-5"></path></svg>',
      };

      const component = () =>
        Button({
          icon: 'trash',
          'aria-label': 'Delete',
        });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');
      const icon = button?.querySelector('[data-icon]');
      expect(icon).toBeTruthy();
    });

    it('should scale icons with button size', () => {
      const sizes = [
        { size: 'xs' as const, expectedSize: 14 },
        { size: 'sm' as const, expectedSize: 16 },
        { size: 'md' as const, expectedSize: 20 },
        { size: 'lg' as const, expectedSize: 24 },
        { size: 'xl' as const, expectedSize: 28 },
      ];

      sizes.forEach(({ size, expectedSize }) => {
        const component = () =>
          Button({
            size,
            icon: 'check',
            'aria-label': 'Check',
          });
        const { container } = renderComponent(component);

        const button = container.querySelector('button');
        const icon = button?.querySelector('[data-icon]');
        const svg = icon?.querySelector('svg');

        expect(svg?.getAttribute('width')).toBe(String(expectedSize));
        expect(svg?.getAttribute('height')).toBe(String(expectedSize));
      });
    });

    it('should replace icon with loading icon', async () => {
      const loading = signal(false);

      const component = () =>
        Button({
          icon: 'check',
          loading,
          'aria-label': 'Check',
        });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');

      // Initially shows regular icon
      let regularIcon = button?.querySelector('[data-icon]');
      let loadingIcon = button?.querySelector('[data-icon-loading]');
      expect(regularIcon).toBeTruthy();
      expect(loadingIcon).toBeNull();

      // When loading, shows loading icon
      loading.set(true);
      await nextTick();

      regularIcon = button?.querySelector('[data-icon]');
      loadingIcon = button?.querySelector('[data-icon-loading]');
      expect(regularIcon).toBeNull();
      expect(loadingIcon).toBeTruthy();

      // Back to regular icon
      loading.set(false);
      await nextTick();

      regularIcon = button?.querySelector('[data-icon]');
      loadingIcon = button?.querySelector('[data-icon-loading]');
      expect(regularIcon).toBeTruthy();
      expect(loadingIcon).toBeNull();
    });

    it('should handle multiple icons with different sizes', () => {
      const component = () =>
        Button({
          size: 'lg',
          leftIcon: 'arrow-left',
          rightIcon: 'arrow-right',
          children: 'Navigate',
        });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');
      const leftIcon = button?.querySelector('[data-icon-left]');
      const rightIcon = button?.querySelector('[data-icon-right]');

      expect(leftIcon).toBeTruthy();
      expect(rightIcon).toBeTruthy();

      const leftSvg = leftIcon?.querySelector('svg');
      const rightSvg = rightIcon?.querySelector('svg');

      // Both should use the same size (24 for lg)
      expect(leftSvg?.getAttribute('width')).toBe('24');
      expect(rightSvg?.getAttribute('width')).toBe('24');
    });
  });

  describe('Form integration', () => {
    it('should submit form when type="submit"', () => {
      // Create a form
      const form = document.createElement('form');
      form.id = 'test-form';
      document.body.appendChild(form);

      const submitHandler = vi.fn((e) => {
        e.preventDefault();
      });
      form.addEventListener('submit', submitHandler);

      const component = () =>
        Button({
          type: 'submit',
          children: 'Submit',
        });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');
      form.appendChild(button!);

      button?.click();

      expect(submitHandler).toHaveBeenCalledTimes(1);
    });

    it('should reset form when type="reset"', () => {
      // Create a form with an input
      const form = document.createElement('form');
      form.id = 'test-form';
      const input = document.createElement('input');
      input.type = 'text';
      input.value = 'test value';
      form.appendChild(input);
      document.body.appendChild(form);

      const component = () =>
        Button({
          type: 'reset',
          children: 'Reset',
        });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');
      form.appendChild(button!);

      button?.click();

      expect(input.value).toBe('');
    });

    it('should work with formAction attribute', () => {
      const form = document.createElement('form');
      form.id = 'test-form';
      document.body.appendChild(form);

      const submitHandler = vi.fn((e) => {
        e.preventDefault();
      });
      form.addEventListener('submit', submitHandler);

      const component = () =>
        Button({
          type: 'submit',
          formAction: '/custom-action',
          formMethod: 'post',
          children: 'Submit to custom action',
        });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');
      form.appendChild(button!);

      expect(button?.getAttribute('formAction')).toBe('/custom-action');
      expect(button?.getAttribute('formMethod')).toBe('post');
    });

    it('should prevent form submission when disabled', () => {
      const form = document.createElement('form');
      form.id = 'test-form';
      document.body.appendChild(form);

      const submitHandler = vi.fn((e) => {
        e.preventDefault();
      });
      form.addEventListener('submit', submitHandler);

      const component = () =>
        Button({
          type: 'submit',
          disabled: true,
          children: 'Submit',
        });
      const { container } = renderComponent(component);

      const button = container.querySelector('button') as HTMLButtonElement;
      form.appendChild(button);

      // Disabled button should not submit form
      button?.click();

      expect(submitHandler).not.toHaveBeenCalled();
    });

    it('should prevent click handler when loading', () => {
      const form = document.createElement('form');
      form.id = 'test-form';
      document.body.appendChild(form);

      const submitHandler = vi.fn((e) => {
        e.preventDefault();
      });
      form.addEventListener('submit', submitHandler);

      const clickHandler = vi.fn();

      const component = () =>
        Button({
          type: 'submit',
          loading: true,
          onClick: clickHandler,
          children: 'Submit',
        });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');
      form.appendChild(button!);

      // Try to click the button while loading
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      // The click handler should be prevented
      expect(clickHandler).not.toHaveBeenCalled();
    });

    it('should work with form attribute to target external form', () => {
      const form = document.createElement('form');
      form.id = 'external-form';
      document.body.appendChild(form);

      const submitHandler = vi.fn((e) => {
        e.preventDefault();
      });
      form.addEventListener('submit', submitHandler);

      const component = () =>
        Button({
          type: 'submit',
          form: 'external-form',
          children: 'Submit External Form',
        });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');
      document.body.appendChild(button!);

      expect(button?.getAttribute('form')).toBe('external-form');
    });
  });

  describe('Link integration', () => {
    it('should render as link with href', () => {
      const component = () =>
        Button({
          as: 'a',
          href: '/dashboard',
          children: 'Go to Dashboard',
        });
      const { container } = renderComponent(component);

      const link = container.querySelector('a');
      expect(link?.getAttribute('href')).toBe('/dashboard');
      expect(link?.getAttribute('role')).toBe('button');
    });

    it('should open link in new tab with target="_blank"', () => {
      const component = () =>
        Button({
          as: 'a',
          href: 'https://example.com',
          target: '_blank',
          children: 'External Link',
        });
      const { container } = renderComponent(component);

      const link = container.querySelector('a');
      expect(link?.getAttribute('target')).toBe('_blank');
    });

    it('should apply rel attribute for security', () => {
      const component = () =>
        Button({
          as: 'a',
          href: 'https://example.com',
          target: '_blank',
          rel: 'noopener noreferrer',
          children: 'External Link',
        });
      const { container } = renderComponent(component);

      const link = container.querySelector('a');
      expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
    });

    it('should handle click event on link', () => {
      const handleClick = vi.fn((e) => {
        e.preventDefault();
      });

      const component = () =>
        Button({
          as: 'a',
          href: '/page',
          onClick: handleClick,
          children: 'Link Button',
        });
      const { container } = renderComponent(component);

      const link = container.querySelector('a');
      link?.click();

      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('should prevent navigation when disabled', () => {
      const handleClick = vi.fn((e) => {
        e.preventDefault();
      });

      const component = () =>
        Button({
          as: 'a',
          href: '/page',
          disabled: true,
          onClick: handleClick,
          children: 'Disabled Link',
        });
      const { container } = renderComponent(component);

      const link = container.querySelector('a');
      link?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(handleClick).not.toHaveBeenCalled();
    });
  });

  describe('Real-world scenarios', () => {
    it('should handle async form submission with loading state', async () => {
      const loading = signal(false);
      const submitted = signal(false);

      const handleSubmit = vi.fn(async () => {
        loading.set(true);
        await new Promise((resolve) => setTimeout(resolve, 50));
        submitted.set(true);
        loading.set(false);
      });

      const component = () =>
        Button({
          type: 'submit',
          loading,
          onClick: handleSubmit,
          children: 'Submit Form',
        });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');

      // Initially not loading
      expect(button?.getAttribute('data-loading')).toBeNull();

      // Click button
      button?.click();

      // Should show loading
      await nextTick();
      expect(button?.getAttribute('data-loading')).toBe('');

      // Wait for async operation
      await new Promise((resolve) => setTimeout(resolve, 60));

      // Should no longer be loading
      expect(button?.getAttribute('data-loading')).toBeNull();
      expect(submitted()).toBe(true);
    });

    it('should prevent double-click during loading', async () => {
      const loading = signal(false);
      let clickCount = 0;

      const handleClick = vi.fn(async () => {
        clickCount++;
        loading.set(true);
        await new Promise((resolve) => setTimeout(resolve, 50));
        loading.set(false);
      });

      const component = () =>
        Button({
          loading,
          onClick: handleClick,
          children: 'Submit',
        });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');

      // First click
      button?.click();
      await nextTick();

      // Second click while loading (should be prevented)
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(handleClick).toHaveBeenCalledTimes(1);
      expect(clickCount).toBe(1);
    });

    it('should work as toggle button with aria-pressed', async () => {
      const pressed = signal(false);

      const handleToggle = vi.fn(() => {
        pressed.set(!pressed());
      });

      const component = () =>
        Button({
          'aria-pressed': pressed,
          onClick: handleToggle,
          children: 'Toggle',
        });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');

      await nextTick();
      expect(button?.getAttribute('aria-pressed')).toBe('false');

      // Toggle on
      button?.click();
      await nextTick();
      expect(button?.getAttribute('aria-pressed')).toBe('true');

      // Toggle off
      button?.click();
      await nextTick();
      expect(button?.getAttribute('aria-pressed')).toBe('false');
    });

    it('should work as menu trigger with aria-expanded', async () => {
      const expanded = signal(false);

      const handleToggleMenu = vi.fn(() => {
        expanded.set(!expanded());
      });

      const component = () =>
        Button({
          'aria-expanded': expanded,
          'aria-controls': 'menu-panel',
          'aria-haspopup': 'menu',
          onClick: handleToggleMenu,
          children: 'Menu',
        });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');

      await nextTick();
      expect(button?.getAttribute('aria-expanded')).toBe('false');
      expect(button?.getAttribute('aria-controls')).toBe('menu-panel');
      expect(button?.getAttribute('aria-haspopup')).toBe('menu');

      // Open menu
      button?.click();
      await nextTick();
      expect(button?.getAttribute('aria-expanded')).toBe('true');

      // Close menu
      button?.click();
      await nextTick();
      expect(button?.getAttribute('aria-expanded')).toBe('false');
    });

    it('should handle complex icon + loading + disabled state transitions', async () => {
      const loading = signal(false);
      const disabled = signal(false);

      const component = () =>
        Button({
          leftIcon: 'save',
          loading,
          disabled,
          children: 'Save Changes',
        });
      const { container } = renderComponent(component);

      const button = container.querySelector('button') as HTMLButtonElement;

      // Initial state
      expect(button.querySelector('[data-icon-left]')).toBeTruthy();
      expect(button.getAttribute('data-loading')).toBeNull();
      expect(button.disabled).toBe(false);

      // Start loading
      loading.set(true);
      await nextTick();

      expect(button.querySelector('[data-icon-left]')).toBeNull(); // Left icon hidden
      expect(button.querySelector('[data-icon-loading]')).toBeTruthy(); // Loading icon shown
      expect(button.getAttribute('data-loading')).toBe('');

      // Disable while loading
      disabled.set(true);
      await nextTick();

      expect(button.getAttribute('data-loading')).toBe('');
      expect(button.getAttribute('data-disabled')).toBe('');
      expect(button.disabled).toBe(true);

      // Finish loading
      loading.set(false);
      await nextTick();

      expect(button.querySelector('[data-icon-left]')).toBeTruthy(); // Left icon back
      expect(button.querySelector('[data-icon-loading]')).toBeNull();
      expect(button.getAttribute('data-loading')).toBeNull();
      expect(button.getAttribute('data-disabled')).toBe('');
      expect(button.disabled).toBe(true);

      // Re-enable
      disabled.set(false);
      await nextTick();

      expect(button.querySelector('[data-icon-left]')).toBeTruthy();
      expect(button.getAttribute('data-disabled')).toBeNull();
      expect(button.disabled).toBe(false);
    });

    it('should work in a button group scenario', () => {
      const selected = signal('left');

      const createAlignButton = (value: string, icon: string, label: string) => {
        return Button({
          'aria-pressed': signal(selected() === value),
          'aria-label': label,
          icon,
          onClick: () => selected.set(value),
        });
      };

      // Simulating a button group
      const components = [
        createAlignButton('left', 'align-left', 'Align Left'),
        createAlignButton('center', 'align-center', 'Align Center'),
        createAlignButton('right', 'align-right', 'Align Right'),
      ];

      components.forEach((component) => {
        const { container } = renderComponent(() => component);
        const button = container.querySelector('button');
        expect(button).toBeTruthy();
        expect(button?.getAttribute('aria-label')).toBeTruthy();
      });
    });

    it('should work with keyboard navigation in a toolbar', () => {
      const toolbar = document.createElement('div');
      toolbar.setAttribute('role', 'toolbar');
      document.body.appendChild(toolbar);

      const buttons = ['bold', 'italic', 'underline'].map((format) => {
        const component = () =>
          Button({
            'aria-label': `Format ${format}`,
            icon: format,
          });
        const { container } = renderComponent(component);
        const button = container.querySelector('button');
        toolbar.appendChild(button!);
        return button;
      });

      // All buttons should be focusable
      buttons.forEach((button) => {
        expect(button?.getAttribute('tabIndex')).toBe('0');
      });

      // Simulate keyboard navigation
      buttons[0]?.focus();
      expect(document.activeElement).toBe(buttons[0]);

      // Tab to next button
      buttons[1]?.focus();
      expect(document.activeElement).toBe(buttons[1]);
    });

    it('should handle conditional rendering based on permissions', async () => {
      const hasPermission = signal(false);
      const disabled = signal(true); // Start as disabled

      const component = () =>
        Button({
          disabled,
          children: 'Delete',
          variant: 'danger',
        });
      const { container } = renderComponent(component);

      const button = container.querySelector('button') as HTMLButtonElement;

      // Initially disabled (no permission)
      await nextTick();
      expect(button.disabled).toBe(true);
      expect(button.getAttribute('data-disabled')).toBe('');

      // Grant permission
      hasPermission.set(true);
      disabled.set(false);
      await nextTick();

      expect(button.disabled).toBe(false);
      expect(button.getAttribute('data-disabled')).toBeNull();

      // Revoke permission
      hasPermission.set(false);
      disabled.set(true);
      await nextTick();

      expect(button.disabled).toBe(true);
      expect(button.getAttribute('data-disabled')).toBe('');
    });
  });

  describe('Performance and cleanup', () => {
    it('should not cause memory leaks with signal updates', async () => {
      const loading = signal(false);
      const disabled = signal(false);

      const component = () =>
        Button({
          loading,
          disabled,
          children: 'Button',
        });
      const { container, cleanup } = renderComponent(component);

      // Perform many updates
      for (let i = 0; i < 100; i++) {
        loading.set(i % 2 === 0);
        disabled.set(i % 3 === 0);
        await nextTick();
      }

      const button = container.querySelector('button');
      expect(button).toBeTruthy();

      cleanup();
    });

    it('should handle rapid state changes correctly', async () => {
      const loading = signal(false);

      const component = () =>
        Button({
          loading,
          children: 'Submit',
        });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');

      // Rapid state changes
      loading.set(true);
      loading.set(false);
      loading.set(true);
      loading.set(false);

      await nextTick();

      expect(button?.getAttribute('data-loading')).toBeNull();
    });
  });

  describe('Accessibility integration', () => {
    it('should work with screen reader announcements', async () => {
      const loading = signal(false);

      const component = () =>
        Button({
          loading,
          'aria-label': 'Save document',
          children: 'Save',
        });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');

      await nextTick();
      expect(button?.getAttribute('aria-label')).toBe('Save document');

      loading.set(true);
      await nextTick();

      expect(button?.getAttribute('aria-busy')).toBe('true');
      expect(button?.getAttribute('aria-label')).toBe('Save document');
    });

    it('should support role="menuitem" for menu contexts', () => {
      const component = () =>
        Button({
          as: 'span',
          role: 'menuitem',
          children: 'Menu Item',
        });
      const { container } = renderComponent(component);

      const element = container.querySelector('span');
      expect(element?.getAttribute('role')).toBe('menuitem');
    });
  });
});
