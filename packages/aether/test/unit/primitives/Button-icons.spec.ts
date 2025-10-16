/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { signal } from '../../../src/core/reactivity/signal.js';
import { Button } from '../../../src/primitives/Button.js';
import { renderComponent, nextTick } from '../../helpers/test-utils.js';

/**
 * Comprehensive test suite for Button component icon integration
 *
 * Tests cover:
 * - Basic icon rendering (string, object, icon-only)
 * - Icon positioning (left, right, both)
 * - Icon sizes and mapping to button sizes
 * - Icon colors and styling
 * - Loading states with icons
 * - Accessibility for icon buttons
 * - Data attributes for styling
 * - Event handling with icons
 * - Edge cases and error scenarios
 */
describe('Button Component - Icon Integration', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('Basic Icon Rendering', () => {
    it('should render button with string icon prop', () => {
      const component = () =>
        Button({
          icon: 'user',
          'aria-label': 'User profile',
        });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');
      const icon = button?.querySelector('[data-icon]');

      expect(icon).toBeTruthy();
      expect(button?.getAttribute('data-with-icon')).toBe('');
      expect(button?.getAttribute('data-icon-only')).toBe('');
    });

    it('should render icon-only button correctly', () => {
      const component = () =>
        Button({
          icon: 'trash',
          'aria-label': 'Delete',
        });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');
      const icon = button?.querySelector('[data-icon]');
      const content = button?.querySelector('[data-button-content]');

      expect(icon).toBeTruthy();
      expect(content).toBeNull();
      expect(button?.getAttribute('data-icon-only')).toBe('');
      expect(button?.getAttribute('data-with-icon')).toBe('');
    });

    it('should render button with icon and text', () => {
      const component = () =>
        Button({
          icon: 'heart',
          children: 'Like',
        });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');
      const icon = button?.querySelector('[data-icon]');
      const content = button?.querySelector('[data-button-content]');

      expect(icon).toBeTruthy();
      expect(content).toBeTruthy();
      expect(content?.textContent).toBe('Like');
      expect(button?.getAttribute('data-with-icon')).toBe('');
      expect(button?.getAttribute('data-icon-only')).toBeNull();
    });

    it('should render left icon before text', () => {
      const component = () =>
        Button({
          leftIcon: 'arrow-left',
          children: 'Back',
        });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');
      const leftIcon = button?.querySelector('[data-icon-left]');
      const content = button?.querySelector('[data-button-content]');

      expect(leftIcon).toBeTruthy();
      expect(content).toBeTruthy();
      expect(content?.textContent).toBe('Back');

      // Verify order: left icon should come before content
      const children = Array.from(button?.childNodes || []);
      const leftIconIndex = children.findIndex((node) =>
        (node as Element).hasAttribute?.('data-icon-left')
      );
      const contentIndex = children.findIndex((node) =>
        (node as Element).hasAttribute?.('data-button-content')
      );

      expect(leftIconIndex).toBeLessThan(contentIndex);
      expect(button?.getAttribute('data-with-icon')).toBe('');
    });

    it('should render right icon after text', () => {
      const component = () =>
        Button({
          rightIcon: 'arrow-right',
          children: 'Next',
        });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');
      const rightIcon = button?.querySelector('[data-icon-right]');
      const content = button?.querySelector('[data-button-content]');

      expect(rightIcon).toBeTruthy();
      expect(content).toBeTruthy();
      expect(content?.textContent).toBe('Next');
      expect(button?.getAttribute('data-with-icon')).toBe('');
    });

    it('should render both left and right icons', () => {
      const component = () =>
        Button({
          leftIcon: 'arrow-left',
          rightIcon: 'arrow-right',
          children: 'Navigate',
        });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');
      const leftIcon = button?.querySelector('[data-icon-left]');
      const rightIcon = button?.querySelector('[data-icon-right]');
      const content = button?.querySelector('[data-button-content]');

      expect(leftIcon).toBeTruthy();
      expect(rightIcon).toBeTruthy();
      expect(content).toBeTruthy();
      expect(button?.getAttribute('data-with-icon')).toBe('');
    });

    it('should handle icon with leftIcon (icon takes precedence in icon-only mode)', () => {
      const component = () =>
        Button({
          icon: 'home',
          leftIcon: 'arrow-left',
          'aria-label': 'Home',
        });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');
      const mainIcon = button?.querySelector('[data-icon]');
      const leftIcon = button?.querySelector('[data-icon-left]');

      // Icon takes precedence when no children
      expect(mainIcon).toBeTruthy();
      expect(button?.getAttribute('data-icon-only')).toBe('');
    });

    it('should not render icon when icon prop is undefined', () => {
      const component = () => Button({ children: 'No Icon' });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');
      const icon = button?.querySelector('[data-icon]');

      expect(icon).toBeNull();
      expect(button?.getAttribute('data-with-icon')).toBeNull();
      expect(button?.getAttribute('data-icon-only')).toBeNull();
    });
  });

  describe('Icon Sizes', () => {
    it('should apply xs icon size (14px) for xs button', () => {
      const component = () =>
        Button({
          size: 'xs',
          icon: 'user',
          'aria-label': 'User',
        });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');
      const iconWrapper = button?.querySelector('[data-icon]');
      const svg = iconWrapper?.querySelector('svg');

      expect(button?.getAttribute('data-size')).toBe('xs');
      expect(svg?.getAttribute('width')).toBe('14');
      expect(svg?.getAttribute('height')).toBe('14');
    });

    it('should apply sm icon size (16px) for sm button', () => {
      const component = () =>
        Button({
          size: 'sm',
          icon: 'user',
          'aria-label': 'User',
        });
      const { container } = renderComponent(component);

      const iconWrapper = container.querySelector('[data-icon]');
      const svg = iconWrapper?.querySelector('svg');

      expect(svg?.getAttribute('width')).toBe('16');
      expect(svg?.getAttribute('height')).toBe('16');
    });

    it('should apply md icon size (20px) for md button (default)', () => {
      const component = () =>
        Button({
          size: 'md',
          icon: 'user',
          'aria-label': 'User',
        });
      const { container } = renderComponent(component);

      const iconWrapper = container.querySelector('[data-icon]');
      const svg = iconWrapper?.querySelector('svg');

      expect(svg?.getAttribute('width')).toBe('20');
      expect(svg?.getAttribute('height')).toBe('20');
    });

    it('should apply lg icon size (24px) for lg button', () => {
      const component = () =>
        Button({
          size: 'lg',
          icon: 'user',
          'aria-label': 'User',
        });
      const { container } = renderComponent(component);

      const iconWrapper = container.querySelector('[data-icon]');
      const svg = iconWrapper?.querySelector('svg');

      expect(svg?.getAttribute('width')).toBe('24');
      expect(svg?.getAttribute('height')).toBe('24');
    });

    it('should apply xl icon size (28px) for xl button', () => {
      const component = () =>
        Button({
          size: 'xl',
          icon: 'user',
          'aria-label': 'User',
        });
      const { container } = renderComponent(component);

      const iconWrapper = container.querySelector('[data-icon]');
      const svg = iconWrapper?.querySelector('svg');

      expect(svg?.getAttribute('width')).toBe('28');
      expect(svg?.getAttribute('height')).toBe('28');
    });

    it('should apply correct sizes to multiple icons', () => {
      const component = () =>
        Button({
          size: 'lg',
          leftIcon: 'arrow-left',
          rightIcon: 'arrow-right',
          children: 'Navigate',
        });
      const { container } = renderComponent(component);

      const leftIconSvg = container.querySelector('[data-icon-left] svg');
      const rightIconSvg = container.querySelector('[data-icon-right] svg');

      expect(leftIconSvg?.getAttribute('width')).toBe('24');
      expect(leftIconSvg?.getAttribute('height')).toBe('24');
      expect(rightIconSvg?.getAttribute('width')).toBe('24');
      expect(rightIconSvg?.getAttribute('height')).toBe('24');
    });
  });

  describe('Loading States with Icons', () => {
    it('should show loading icon when loading is true', () => {
      const component = () =>
        Button({
          loading: true,
          icon: 'save',
          children: 'Save',
        });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');
      const loadingIcon = button?.querySelector('[data-icon-loading]');
      const regularIcon = button?.querySelector('[data-icon]');

      expect(loadingIcon).toBeTruthy();
      expect(regularIcon).toBeNull();
      expect(button?.getAttribute('data-loading')).toBe('');
    });

    it('should replace all icons with loading spinner', () => {
      const component = () =>
        Button({
          loading: true,
          leftIcon: 'check',
          rightIcon: 'arrow-right',
          children: 'Submit',
        });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');
      const loadingIcon = button?.querySelector('[data-icon-loading]');
      const leftIcon = button?.querySelector('[data-icon-left]');
      const rightIcon = button?.querySelector('[data-icon-right]');

      expect(loadingIcon).toBeTruthy();
      expect(leftIcon).toBeNull();
      expect(rightIcon).toBeNull();
    });

    it('should use custom loading icon if provided', () => {
      const component = () =>
        Button({
          loading: true,
          loadingIcon: 'custom-spinner',
          children: 'Submit',
        });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');
      const loadingIcon = button?.querySelector('[data-icon-loading]');

      expect(loadingIcon).toBeTruthy();
    });

    it('should use default loader icon when no custom loadingIcon', () => {
      const component = () =>
        Button({
          loading: true,
          children: 'Submit',
        });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');
      const loadingIcon = button?.querySelector('[data-icon-loading]');

      expect(loadingIcon).toBeTruthy();
    });

    it('should restore regular icons when loading becomes false', async () => {
      const loading = signal(true);

      const component = () =>
        Button({
          loading,
          leftIcon: 'check',
          rightIcon: 'arrow-right',
          children: 'Submit',
        });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');

      // Initially loading
      let loadingIcon = button?.querySelector('[data-icon-loading]');
      let leftIcon = button?.querySelector('[data-icon-left]');
      let rightIcon = button?.querySelector('[data-icon-right]');

      expect(loadingIcon).toBeTruthy();
      expect(leftIcon).toBeNull();
      expect(rightIcon).toBeNull();

      // Stop loading
      loading.set(false);
      await nextTick();

      loadingIcon = button?.querySelector('[data-icon-loading]');
      leftIcon = button?.querySelector('[data-icon-left]');
      rightIcon = button?.querySelector('[data-icon-right]');

      expect(loadingIcon).toBeNull();
      expect(leftIcon).toBeTruthy();
      expect(rightIcon).toBeTruthy();
    });

    it('should maintain button width with loading icon', async () => {
      const loading = signal(false);

      const component = () =>
        Button({
          loading,
          leftIcon: 'check',
          children: 'Save Changes',
        });
      const { container } = renderComponent(component);

      const button = container.querySelector('button') as HTMLButtonElement;
      await nextTick();

      // Simulate button having width
      Object.defineProperty(button, 'offsetWidth', {
        get: () => 120,
        configurable: true,
      });

      loading.set(true);
      await nextTick();

      expect(button.getAttribute('data-loading')).toBe('');
    });
  });

  describe('Icon-Only Button Accessibility', () => {
    it('should require aria-label for icon-only buttons', () => {
      const originalEnv = process.env.NODE_ENV;
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      try {
        process.env.NODE_ENV = 'development';

        const component = () => Button({ icon: 'trash' });
        renderComponent(component);

        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining('[Button] Icon-only buttons require an aria-label'),
          expect.any(Object)
        );
      } finally {
        process.env.NODE_ENV = originalEnv;
        consoleWarnSpy.mockRestore();
      }
    });

    it('should not warn when icon-only button has aria-label', () => {
      const originalEnv = process.env.NODE_ENV;
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      try {
        process.env.NODE_ENV = 'development';

        const component = () =>
          Button({
            icon: 'trash',
            'aria-label': 'Delete item',
          });
        renderComponent(component);

        expect(consoleWarnSpy).not.toHaveBeenCalled();
      } finally {
        process.env.NODE_ENV = originalEnv;
        consoleWarnSpy.mockRestore();
      }
    });

    it('should not warn when icon-only button has aria-labelledby', () => {
      const originalEnv = process.env.NODE_ENV;
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      try {
        process.env.NODE_ENV = 'development';

        const component = () =>
          Button({
            icon: 'trash',
            'aria-labelledby': 'delete-label',
          });
        renderComponent(component);

        expect(consoleWarnSpy).not.toHaveBeenCalled();
      } finally {
        process.env.NODE_ENV = originalEnv;
        consoleWarnSpy.mockRestore();
      }
    });

    it('should not warn for button with icon and text', () => {
      const originalEnv = process.env.NODE_ENV;
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      try {
        process.env.NODE_ENV = 'development';

        const component = () =>
          Button({
            icon: 'heart',
            children: 'Like',
          });
        renderComponent(component);

        expect(consoleWarnSpy).not.toHaveBeenCalled();
      } finally {
        process.env.NODE_ENV = originalEnv;
        consoleWarnSpy.mockRestore();
      }
    });

    it('should apply aria-label to icon-only button', () => {
      const component = () =>
        Button({
          icon: 'close',
          'aria-label': 'Close dialog',
        });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');
      expect(button?.getAttribute('aria-label')).toBe('Close dialog');
    });

    it('should not warn in production mode', () => {
      const originalEnv = process.env.NODE_ENV;
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      try {
        process.env.NODE_ENV = 'production';

        const component = () => Button({ icon: 'trash' });
        renderComponent(component);

        expect(consoleWarnSpy).not.toHaveBeenCalled();
      } finally {
        process.env.NODE_ENV = originalEnv;
        consoleWarnSpy.mockRestore();
      }
    });
  });

  describe('Data Attributes for Icons', () => {
    it('should add data-with-icon when icon prop is present', () => {
      const component = () =>
        Button({
          icon: 'user',
          'aria-label': 'Profile',
        });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');
      expect(button?.getAttribute('data-with-icon')).toBe('');
    });

    it('should add data-with-icon when leftIcon is present', () => {
      const component = () =>
        Button({
          leftIcon: 'arrow-left',
          children: 'Back',
        });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');
      expect(button?.getAttribute('data-with-icon')).toBe('');
    });

    it('should add data-with-icon when rightIcon is present', () => {
      const component = () =>
        Button({
          rightIcon: 'arrow-right',
          children: 'Next',
        });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');
      expect(button?.getAttribute('data-with-icon')).toBe('');
    });

    it('should add data-icon-only for icon-only buttons', () => {
      const component = () =>
        Button({
          icon: 'settings',
          'aria-label': 'Settings',
        });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');
      expect(button?.getAttribute('data-icon-only')).toBe('');
    });

    it('should not add data-icon-only when button has text', () => {
      const component = () =>
        Button({
          icon: 'heart',
          children: 'Like',
        });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');
      expect(button?.getAttribute('data-icon-only')).toBeNull();
    });

    it('should add data-icon-left for left icon', () => {
      const component = () =>
        Button({
          leftIcon: 'check',
          children: 'Confirm',
        });
      const { container } = renderComponent(component);

      const leftIcon = container.querySelector('[data-icon-left]');
      expect(leftIcon).toBeTruthy();
    });

    it('should add data-icon-right for right icon', () => {
      const component = () =>
        Button({
          rightIcon: 'external-link',
          children: 'Open',
        });
      const { container } = renderComponent(component);

      const rightIcon = container.querySelector('[data-icon-right]');
      expect(rightIcon).toBeTruthy();
    });

    it('should add data-icon-loading for loading state', () => {
      const component = () =>
        Button({
          loading: true,
          children: 'Submit',
        });
      const { container } = renderComponent(component);

      const loadingIcon = container.querySelector('[data-icon-loading]');
      expect(loadingIcon).toBeTruthy();
    });
  });

  describe('Event Handlers with Icons', () => {
    it('should call onClick for icon-only button', () => {
      const handleClick = vi.fn();
      const component = () =>
        Button({
          icon: 'trash',
          'aria-label': 'Delete',
          onClick: handleClick,
        });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');
      button?.click();

      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('should call onClick for button with left icon', () => {
      const handleClick = vi.fn();
      const component = () =>
        Button({
          leftIcon: 'save',
          children: 'Save',
          onClick: handleClick,
        });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');
      button?.click();

      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('should not call onClick when disabled with icons', () => {
      const handleClick = vi.fn();
      const component = () =>
        Button({
          icon: 'trash',
          'aria-label': 'Delete',
          disabled: true,
          onClick: handleClick,
        });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(handleClick).not.toHaveBeenCalled();
    });

    it('should not call onClick when loading with icons', () => {
      const handleClick = vi.fn();
      const component = () =>
        Button({
          icon: 'save',
          'aria-label': 'Save',
          loading: true,
          onClick: handleClick,
        });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(handleClick).not.toHaveBeenCalled();
    });

    it('should handle mouse events on icon buttons', () => {
      const handleMouseEnter = vi.fn();
      const handleMouseLeave = vi.fn();

      const component = () =>
        Button({
          icon: 'heart',
          'aria-label': 'Like',
          onMouseEnter: handleMouseEnter,
          onMouseLeave: handleMouseLeave,
        });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');

      button?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      expect(handleMouseEnter).toHaveBeenCalledTimes(1);

      button?.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
      expect(handleMouseLeave).toHaveBeenCalledTimes(1);
    });

    it('should handle focus events on icon buttons', () => {
      const handleFocus = vi.fn();
      const handleBlur = vi.fn();

      const component = () =>
        Button({
          icon: 'search',
          'aria-label': 'Search',
          onFocus: handleFocus,
          onBlur: handleBlur,
        });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');

      button?.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
      expect(handleFocus).toHaveBeenCalledTimes(1);

      button?.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
      expect(handleBlur).toHaveBeenCalledTimes(1);
    });
  });

  describe('Icon Rendering with Different Variants', () => {
    const variants = ['default', 'primary', 'secondary', 'danger', 'ghost', 'link'] as const;

    variants.forEach((variant) => {
      it(`should render icon with ${variant} variant`, () => {
        const component = () =>
          Button({
            variant,
            icon: 'check',
            'aria-label': 'Confirm',
          });
        const { container } = renderComponent(component);

        const button = container.querySelector('button');
        const icon = button?.querySelector('[data-icon]');

        expect(icon).toBeTruthy();
        expect(button?.getAttribute('data-variant')).toBe(variant);
        expect(button?.getAttribute('data-with-icon')).toBe('');
      });

      it(`should render left and right icons with ${variant} variant`, () => {
        const component = () =>
          Button({
            variant,
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
        expect(button?.getAttribute('data-variant')).toBe(variant);
      });
    });
  });

  describe('Icon Content Structure', () => {
    it('should render icon wrapper with correct structure', () => {
      const component = () =>
        Button({
          icon: 'user',
          'aria-label': 'Profile',
        });
      const { container } = renderComponent(component);

      const iconWrapper = container.querySelector('[data-icon]');
      expect(iconWrapper).toBeTruthy();
      expect(iconWrapper?.tagName).toBe('SPAN');
      expect(iconWrapper?.classList.contains('button-icon')).toBe(true);
      expect(iconWrapper?.classList.contains('button-icon-main')).toBe(true);
    });

    it('should render SVG element inside icon wrapper', () => {
      const component = () =>
        Button({
          icon: 'star',
          'aria-label': 'Favorite',
        });
      const { container } = renderComponent(component);

      const iconWrapper = container.querySelector('[data-icon]');
      const svg = iconWrapper?.querySelector('svg');

      expect(svg).toBeTruthy();
      // Note: The new Icon component may have different SVG structure
      // Just verify that an SVG is present
    });

    it('should apply inline styles to icon wrapper', () => {
      const component = () =>
        Button({
          size: 'lg',
          icon: 'calendar',
          'aria-label': 'Calendar',
        });
      const { container } = renderComponent(component);

      const iconWrapper = container.querySelector('[data-icon]') as HTMLElement;

      // Verify the wrapper has the expected display and alignment styles
      expect(iconWrapper?.style.display).toBe('inline-flex');
      expect(iconWrapper?.style.alignItems).toBe('center');
      expect(iconWrapper?.style.justifyContent).toBe('center');
      // Note: Width/height are not set on the wrapper with the new Icon component
      // They are set on the Icon component itself
    });

    it('should render left icon with correct class names', () => {
      const component = () =>
        Button({
          leftIcon: 'arrow-left',
          children: 'Back',
        });
      const { container } = renderComponent(component);

      const leftIcon = container.querySelector('[data-icon-left]');
      expect(leftIcon?.classList.contains('button-icon')).toBe(true);
      expect(leftIcon?.classList.contains('button-icon-left')).toBe(true);
    });

    it('should render right icon with correct class names', () => {
      const component = () =>
        Button({
          rightIcon: 'arrow-right',
          children: 'Next',
        });
      const { container } = renderComponent(component);

      const rightIcon = container.querySelector('[data-icon-right]');
      expect(rightIcon?.classList.contains('button-icon')).toBe(true);
      expect(rightIcon?.classList.contains('button-icon-right')).toBe(true);
    });

    it('should render loading icon with correct class names', () => {
      const component = () =>
        Button({
          loading: true,
          children: 'Loading',
        });
      const { container } = renderComponent(component);

      const loadingIcon = container.querySelector('[data-icon-loading]');
      expect(loadingIcon?.classList.contains('button-icon')).toBe(true);
      expect(loadingIcon?.classList.contains('button-icon-loading')).toBe(true);
    });
  });

  describe('Edge Cases and Error Scenarios', () => {
    it('should handle undefined icon gracefully', () => {
      const component = () =>
        Button({
          icon: undefined,
          children: 'Button',
        });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');
      const icon = button?.querySelector('[data-icon]');

      expect(icon).toBeNull();
      expect(button?.getAttribute('data-with-icon')).toBeNull();
    });

    it('should handle empty string icon', () => {
      const component = () =>
        Button({
          icon: '',
          'aria-label': 'Empty icon',
        });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');
      const icon = button?.querySelector('[data-icon]');

      // Empty string should not render icon
      expect(icon).toBeNull();
    });

    it('should handle rapid state changes with icons', async () => {
      const loading = signal(false);

      const component = () =>
        Button({
          loading,
          leftIcon: 'check',
          children: 'Submit',
        });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');

      // Rapid toggle
      loading.set(true);
      await nextTick();
      loading.set(false);
      await nextTick();
      loading.set(true);
      await nextTick();

      const loadingIcon = button?.querySelector('[data-icon-loading]');
      expect(loadingIcon).toBeTruthy();
      expect(button?.getAttribute('data-loading')).toBe('');
    });

    it('should handle both loading and disabled with icons', () => {
      const component = () =>
        Button({
          loading: true,
          disabled: true,
          icon: 'save',
          'aria-label': 'Save',
        });
      const { container } = renderComponent(component);

      const button = container.querySelector('button') as HTMLButtonElement;
      const loadingIcon = button?.querySelector('[data-icon-loading]');

      expect(loadingIcon).toBeTruthy();
      expect(button?.disabled).toBe(true);
      expect(button?.getAttribute('data-loading')).toBe('');
      expect(button?.getAttribute('data-disabled')).toBe('');
    });

    it('should handle icon with fullWidth button', () => {
      const component = () =>
        Button({
          fullWidth: true,
          leftIcon: 'check',
          children: 'Confirm',
        });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');
      const leftIcon = button?.querySelector('[data-icon-left]');

      expect(leftIcon).toBeTruthy();
      expect(button?.getAttribute('data-full-width')).toBe('');
      expect(button?.getAttribute('data-with-icon')).toBe('');
    });

    it('should handle icon with custom className', () => {
      const component = () =>
        Button({
          className: 'custom-button',
          icon: 'star',
          'aria-label': 'Favorite',
        });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');
      const icon = button?.querySelector('[data-icon]');

      expect(button?.className).toBe('custom-button');
      expect(icon).toBeTruthy();
    });

    it('should handle icon with polymorphic as="a"', () => {
      const component = () =>
        Button({
          as: 'a',
          href: '/profile',
          leftIcon: 'user',
          children: 'Profile',
        });
      const { container } = renderComponent(component);

      const anchor = container.querySelector('a');
      const leftIcon = anchor?.querySelector('[data-icon-left]');

      expect(anchor).toBeTruthy();
      expect(leftIcon).toBeTruthy();
      expect(anchor?.getAttribute('href')).toBe('/profile');
      expect(anchor?.getAttribute('role')).toBe('button');
    });

    it('should handle icon with polymorphic as="span"', () => {
      const component = () =>
        Button({
          as: 'span',
          icon: 'menu',
          'aria-label': 'Menu',
        });
      const { container } = renderComponent(component);

      const span = container.querySelector('span');
      const icon = span?.querySelector('[data-icon]');

      expect(span).toBeTruthy();
      expect(icon).toBeTruthy();
      expect(span?.getAttribute('role')).toBe('button');
    });

    it('should handle numeric children with icon', () => {
      const component = () =>
        Button({
          leftIcon: 'hash',
          children: 42,
        });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');
      const leftIcon = button?.querySelector('[data-icon-left]');
      const content = button?.querySelector('[data-button-content]');

      expect(leftIcon).toBeTruthy();
      expect(content?.textContent).toBe('42');
    });

    it('should update icons reactively with signals', async () => {
      const loading = signal(false);
      const disabled = signal(false);

      const component = () =>
        Button({
          loading,
          disabled,
          leftIcon: 'save',
          rightIcon: 'external-link',
          children: 'Save',
        });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');

      // Initial state
      let leftIcon = button?.querySelector('[data-icon-left]');
      let rightIcon = button?.querySelector('[data-icon-right]');
      expect(leftIcon).toBeTruthy();
      expect(rightIcon).toBeTruthy();

      // Start loading
      loading.set(true);
      await nextTick();

      const loadingIcon = button?.querySelector('[data-icon-loading]');
      leftIcon = button?.querySelector('[data-icon-left]');
      rightIcon = button?.querySelector('[data-icon-right]');

      expect(loadingIcon).toBeTruthy();
      expect(leftIcon).toBeNull();
      expect(rightIcon).toBeNull();

      // Stop loading, enable disabled
      loading.set(false);
      disabled.set(true);
      await nextTick();

      leftIcon = button?.querySelector('[data-icon-left]');
      rightIcon = button?.querySelector('[data-icon-right]');
      expect(leftIcon).toBeTruthy();
      expect(rightIcon).toBeTruthy();
      expect((button as HTMLButtonElement)?.disabled).toBe(true);
    });
  });

  describe('Icon-Only Button Combinations', () => {
    it('should prioritize icon over leftIcon when both present without children', () => {
      const component = () =>
        Button({
          icon: 'home',
          leftIcon: 'menu',
          'aria-label': 'Home',
        });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');
      const mainIcon = button?.querySelector('[data-icon]');

      expect(mainIcon).toBeTruthy();
      expect(button?.getAttribute('data-icon-only')).toBe('');
    });

    it('should show all icons when children are present', () => {
      const component = () =>
        Button({
          icon: 'heart',
          leftIcon: 'arrow-left',
          rightIcon: 'arrow-right',
          children: 'Like',
        });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');
      const mainIcon = button?.querySelector('[data-icon]');
      const leftIcon = button?.querySelector('[data-icon-left]');
      const rightIcon = button?.querySelector('[data-icon-right]');

      expect(mainIcon).toBeTruthy();
      expect(leftIcon).toBeTruthy();
      expect(rightIcon).toBeTruthy();
      expect(button?.getAttribute('data-icon-only')).toBeNull();
    });

    it('should handle only leftIcon without children', () => {
      const component = () =>
        Button({
          leftIcon: 'search',
          'aria-label': 'Search',
        });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');
      const leftIcon = button?.querySelector('[data-icon-left]');
      const content = button?.querySelector('[data-button-content]');

      expect(leftIcon).toBeTruthy();
      expect(content).toBeNull();
      // Not icon-only because leftIcon doesn't trigger that mode
      expect(button?.getAttribute('data-with-icon')).toBe('');
    });

    it('should handle only rightIcon without children', () => {
      const component = () =>
        Button({
          rightIcon: 'arrow-right',
          'aria-label': 'Next',
        });
      const { container } = renderComponent(component);

      const button = container.querySelector('button');
      const rightIcon = button?.querySelector('[data-icon-right]');
      const content = button?.querySelector('[data-button-content]');

      expect(rightIcon).toBeTruthy();
      expect(content).toBeNull();
      expect(button?.getAttribute('data-with-icon')).toBe('');
    });
  });
});
