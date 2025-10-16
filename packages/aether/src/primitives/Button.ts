/**
 * Button Primitive Component
 *
 * A versatile, headless button component following Aether's design philosophy.
 * Supports text, icons, loading states, and polymorphic rendering.
 *
 * Based on WAI-ARIA Button pattern:
 * https://www.w3.org/WAI/ARIA/apg/patterns/button/
 *
 * @philosophy
 * - Headless/unstyled with data-attributes for styling
 * - WAI-ARIA compliant with full keyboard support
 * - Supports both Signal and static values for reactive props
 * - Composable with IconProvider for icon integration
 * - Polymorphic rendering (button, a, span)
 * - Loading and disabled states with proper accessibility
 */

import { defineComponent } from '../core/component/define.js';
import { signal, type WritableSignal } from '../core/reactivity/signal.js';
import { computed } from '../core/reactivity/computed.js';
import { effect } from '../core/reactivity/effect.js';
import { createRef } from '../core/component/refs.js';
import { jsx } from '../jsx-runtime.js';
import { generateId } from './utils/index.js';
import { Icon } from '../svg/components/Icon.js';
import type { IconProp, IconPreset, IconSize, IconAnimation } from '../svg/icons/types.js';
import { resolveIconSize } from '../svg/icons/utils.js';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Button visual variants
 */
export type ButtonVariant = 'default' | 'primary' | 'secondary' | 'danger' | 'ghost' | 'link';

/**
 * Button size presets
 */
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

/**
 * Valid button element types
 */
export type ButtonElement = 'button' | 'a' | 'span';

/**
 * HTML button type attribute
 */
export type ButtonType = 'button' | 'submit' | 'reset';

/**
 * Icon position in button
 */
export type IconPosition = 'left' | 'right';

// ============================================================================
// Props Interface
// ============================================================================

export interface ButtonProps {
  // Content
  children?: any;

  // Icon support - use the new IconProp type (string | IconConfig)
  icon?: IconProp;              // Main icon (icon-only or with text)
  leftIcon?: IconProp;          // Left-positioned icon
  rightIcon?: IconProp;         // Right-positioned icon
  loadingIcon?: IconProp;       // Loading state icon

  // Icon configuration - default settings applied to all icons
  iconPreset?: IconPreset;      // Default preset for all icons (stroke, duotone, twotone)
  iconSize?: IconSize;          // Default size for all icons (xs, sm, md, lg, xl, or number)
  iconAnimation?: IconAnimation; // Default animation for all icons

  // Appearance
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;

  // State
  loading?: boolean | WritableSignal<boolean>;
  disabled?: boolean | WritableSignal<boolean>;

  // Polymorphic rendering
  as?: ButtonElement;
  type?: ButtonType;
  href?: string;
  target?: string;
  rel?: string;

  // Events
  onClick?: (e: MouseEvent) => void | Promise<void>;
  onFocus?: (e: FocusEvent) => void;
  onBlur?: (e: FocusEvent) => void;
  onKeyDown?: (e: KeyboardEvent) => void;
  onKeyUp?: (e: KeyboardEvent) => void;
  onMouseEnter?: (e: MouseEvent) => void;
  onMouseLeave?: (e: MouseEvent) => void;

  // Accessibility
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  'aria-expanded'?: boolean | WritableSignal<boolean>;
  'aria-controls'?: string;
  'aria-haspopup'?: boolean | 'menu' | 'dialog' | 'listbox' | 'tree' | 'grid';
  'aria-pressed'?: boolean | WritableSignal<boolean> | 'mixed';

  // HTML Attributes
  id?: string;
  className?: string;
  style?: any;
  tabIndex?: number;
  form?: string;
  formAction?: string;
  formEnctype?: string;
  formMethod?: 'get' | 'post';
  formNoValidate?: boolean;
  formTarget?: string;

  // Data attributes and other props
  [key: string]: any;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Resolve value from signal or static value
 */
function resolveValue<T>(value: T | WritableSignal<T> | undefined): T | undefined {
  if (value === undefined) return undefined;
  return typeof value === 'function' ? (value as WritableSignal<T>)() : value;
}

/**
 * Check if value is a signal
 */
function isSignal<T>(value: any): value is WritableSignal<T> {
  return typeof value === 'function' && 'peek' in value;
}

// ============================================================================
// Component Implementation
// ============================================================================

/**
 * Button component
 *
 * Versatile button with support for icons, loading states, and polymorphic rendering.
 * Fully accessible with WAI-ARIA support and keyboard navigation.
 * Integrates with Aether's new minimalist Icon API for powerful icon support.
 *
 * @example Basic button
 * ```tsx
 * <Button onClick={handleClick}>Click me</Button>
 * ```
 *
 * @example Primary button with simple icon
 * ```tsx
 * <Button variant="primary" leftIcon="check" onClick={save}>
 *   Save Changes
 * </Button>
 * ```
 *
 * @example Icon with preset and animation
 * ```tsx
 * <Button icon={{ name: "heart", preset: "duotone", animation: "pulse" }}>
 *   Like
 * </Button>
 * ```
 *
 * @example Icon-only button
 * ```tsx
 * <Button icon="trash" aria-label="Delete" onClick={handleDelete} />
 * ```
 *
 * @example Left and right icons
 * ```tsx
 * <Button leftIcon="arrow-left" rightIcon="arrow-right">
 *   Navigate
 * </Button>
 * ```
 *
 * @example All icons with duotone preset
 * ```tsx
 * <Button
 *   leftIcon="check"
 *   rightIcon="arrow-right"
 *   iconPreset="duotone"
 * >
 *   Continue
 * </Button>
 * ```
 *
 * @example Loading button with custom icon
 * ```tsx
 * const isLoading = signal(false);
 *
 * <Button
 *   loading={isLoading}
 *   loadingIcon={{ name: "spinner", animation: "spin" }}
 *   onClick={async () => {
 *     isLoading.set(true);
 *     await performAction();
 *     isLoading.set(false);
 *   }}
 * >
 *   Submit
 * </Button>
 * ```
 *
 * @example Icon with custom size and color
 * ```tsx
 * <Button
 *   icon={{ name: "star", size: 32, color: "gold" }}
 *   aria-label="Star"
 * />
 * ```
 *
 * @example Animated refresh button
 * ```tsx
 * <Button
 *   icon={{ name: "refresh", animation: "spin" }}
 *   onClick={handleRefresh}
 * >
 *   Refresh
 * </Button>
 * ```
 */
export const Button = defineComponent<ButtonProps>((props) => {
  // Generate unique ID
  const buttonId = props.id || generateId();

  // Internal state
  const initialWidth = signal<number | null>(null);

  // Resolve loading and disabled states
  const isLoading = computed(() => resolveValue(props.loading) || false);
  const isDisabled = computed(() => resolveValue(props.disabled) || false);

  // Check if button is icon-only
  const isIconOnly = computed(() => !!props.icon && !props.children);

  // Determine variant and size
  const variant = computed(() => props.variant || 'default');
  const size = computed(() => props.size || 'md');

  // Determine which element to render
  const elementType = computed(() => props.as || 'button');

  // Warning for icon-only buttons without aria-label
  if (process.env.NODE_ENV !== 'production') {
    effect(() => {
      if (isIconOnly() && !props['aria-label'] && !props['aria-labelledby']) {
        console.warn(
          '[Button] Icon-only buttons require an aria-label or aria-labelledby for accessibility.',
          { id: buttonId }
        );
      }
    });
  }

  // Create ref for the button element
  const buttonRef = createRef<HTMLElement>();

  // Set up reactive DOM updates
  const refCallback = (element: HTMLElement | null) => {
    buttonRef.current = element || undefined;
    if (!element) return;

    // Capture initial width for loading state
    if (initialWidth() === null && element.offsetWidth > 0) {
      initialWidth.set(element.offsetWidth);
    }

    // Set up effect to update DOM attributes when signals change
    effect(() => {
      const loading = isLoading();
      const disabled = isDisabled();
      const expanded = resolveValue(props['aria-expanded']);
      const pressed = resolveValue(props['aria-pressed']);

      // Data attributes for styling
      element.setAttribute('data-button', '');
      element.setAttribute('data-variant', variant());
      element.setAttribute('data-size', size());

      if (loading) {
        element.setAttribute('data-loading', '');
        element.setAttribute('aria-busy', 'true');

        // Preserve button width during loading to prevent layout shift
        const width = initialWidth();
        if (width !== null && width > 0) {
          element.style.minWidth = `${width}px`;
        }
      } else {
        element.removeAttribute('data-loading');
        element.removeAttribute('aria-busy');
        element.style.minWidth = '';
      }

      if (disabled) {
        element.setAttribute('data-disabled', '');
        element.setAttribute('aria-disabled', 'true');

        // Set disabled attribute for button elements
        if (elementType() === 'button') {
          element.setAttribute('disabled', '');
          (element as HTMLButtonElement).disabled = true;
        }
      } else {
        element.removeAttribute('data-disabled');
        element.removeAttribute('aria-disabled');

        if (elementType() === 'button') {
          element.removeAttribute('disabled');
          (element as HTMLButtonElement).disabled = false;
        }
      }

      if (props.fullWidth) {
        element.setAttribute('data-full-width', '');
      } else {
        element.removeAttribute('data-full-width');
      }

      if (isIconOnly()) {
        element.setAttribute('data-icon-only', '');
      } else {
        element.removeAttribute('data-icon-only');
      }

      if (props.leftIcon || props.rightIcon || props.icon) {
        element.setAttribute('data-with-icon', '');
      } else {
        element.removeAttribute('data-with-icon');
      }

      // ARIA attributes
      if (expanded !== undefined) {
        element.setAttribute('aria-expanded', String(expanded));
      } else {
        element.removeAttribute('aria-expanded');
      }

      if (pressed !== undefined) {
        element.setAttribute('aria-pressed', String(pressed));
      } else {
        element.removeAttribute('aria-pressed');
      }
    });
  };

  // Event handlers
  const handleClick = (e: MouseEvent) => {
    const loading = isLoading();
    const disabled = isDisabled();

    // Prevent interaction when loading or disabled
    if (loading || disabled) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    // Call user's onClick handler
    props.onClick?.(e);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    const loading = isLoading();
    const disabled = isDisabled();

    // Don't handle if loading or disabled
    if (loading || disabled) {
      e.preventDefault();
      return;
    }

    // Space and Enter should trigger click for non-button elements
    if (elementType() !== 'button' && (e.key === ' ' || e.key === 'Enter')) {
      e.preventDefault();
      handleClick(e as any);
    }

    // Call user's onKeyDown handler
    props.onKeyDown?.(e);
  };

  /**
   * Render icon using the new Icon API
   *
   * Supports both string and IconConfig for maximum flexibility.
   * Inherits default settings from iconPreset, iconSize, and iconAnimation props.
   *
   * @param iconProp - Icon name (string) or full IconConfig object
   * @param position - Icon position for data attribute
   * @returns Icon component wrapped in span with position data attribute
   *
   * @example
   * // Simple string icon
   * renderIcon('save', 'left')
   *
   * // Icon with custom config
   * renderIcon({ name: 'heart', preset: 'duotone', animation: 'pulse' }, 'right')
   *
   * // Loading icon with automatic spin animation
   * renderIcon('spinner', 'loading') // automatically gets 'spin' animation
   */
  const renderIcon = (iconProp: IconProp | undefined, position?: 'left' | 'right' | 'loading') => {
    if (!iconProp) return null;

    // Determine icon size based on button size or explicit iconSize prop
    const defaultSize = props.iconSize || size();
    const sizeInPixels = resolveIconSize(defaultSize);

    // Determine animation
    // Loading icons automatically get spin animation unless overridden
    const defaultAnimation = position === 'loading' ? 'spin' : props.iconAnimation;

    // Build icon configuration
    // If iconProp is a string, create a simple config
    // If iconProp is already a config, merge with defaults
    const iconConfig = typeof iconProp === 'string'
      ? {
          name: iconProp,
          preset: props.iconPreset,
          size: sizeInPixels,
          animation: defaultAnimation,
        }
      : {
          preset: props.iconPreset,
          size: sizeInPixels,
          animation: defaultAnimation,
          ...iconProp, // Icon-specific config overrides defaults
        };

    // Data attribute for position
    const dataPosition = position ? `data-icon-${position}` : 'data-icon';

    return jsx('span', {
      [dataPosition]: '',
      className: `button-icon button-icon-${position || 'main'}`,
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      },
      children: jsx(Icon, iconConfig),
    });
  };

  // Build base element props
  const buildElementProps = () => {
    const loading = isLoading();
    const disabled = isDisabled();
    const elType = elementType();

    const baseProps: any = {
      ref: refCallback,
      id: buttonId,
      className: props.className,
      style: props.style,
      tabIndex: props.tabIndex ?? 0,
      onClick: handleClick,
      onFocus: props.onFocus,
      onBlur: props.onBlur,
      onKeyDown: handleKeyDown,
      onKeyUp: props.onKeyUp,
      onMouseEnter: props.onMouseEnter,
      onMouseLeave: props.onMouseLeave,
      'aria-label': props['aria-label'],
      'aria-labelledby': props['aria-labelledby'],
      'aria-describedby': props['aria-describedby'],
      'aria-controls': props['aria-controls'],
      'aria-haspopup': props['aria-haspopup'],
    };

    // Add data attributes
    baseProps['data-button'] = '';
    baseProps['data-variant'] = variant();
    baseProps['data-size'] = size();

    if (loading) {
      baseProps['data-loading'] = '';
      baseProps['aria-busy'] = 'true';
    }

    if (disabled) {
      baseProps['data-disabled'] = '';
      baseProps['aria-disabled'] = 'true';
    }

    if (props.fullWidth) {
      baseProps['data-full-width'] = '';
    }

    if (isIconOnly()) {
      baseProps['data-icon-only'] = '';
    }

    if (props.leftIcon || props.rightIcon || props.icon) {
      baseProps['data-with-icon'] = '';
    }

    // Element-specific attributes
    if (elType === 'button') {
      baseProps.type = props.type || 'button';
      baseProps.disabled = disabled;
      baseProps.form = props.form;
      baseProps.formAction = props.formAction;
      baseProps.formEnctype = props.formEnctype;
      baseProps.formMethod = props.formMethod;
      baseProps.formNoValidate = props.formNoValidate;
      baseProps.formTarget = props.formTarget;
    } else if (elType === 'a') {
      baseProps.href = props.href;
      baseProps.target = props.target;
      baseProps.rel = props.rel;
      baseProps.role = 'button';
    } else if (elType === 'span') {
      baseProps.role = props.role || 'button';
    }

    // Copy over any data-* attributes or other custom props
    Object.keys(props).forEach((key) => {
      if (key.startsWith('data-') && !(key in baseProps)) {
        baseProps[key] = props[key];
      }
    });

    return baseProps;
  };

  // Render function
  return () => {
    const loading = isLoading();
    const elType = elementType();
    const elementProps = buildElementProps();

    // Determine which icon to show
    const displayIcon = loading
      ? props.loadingIcon || 'loader'
      : props.icon;

    const displayLeftIcon = loading ? null : props.leftIcon;
    const displayRightIcon = loading ? null : props.rightIcon;

    // Build children array
    const children: any[] = [];

    // Loading spinner (replaces all icons)
    if (loading) {
      children.push(renderIcon(displayIcon, 'loading'));
    } else {
      // Left icon
      if (displayLeftIcon) {
        children.push(renderIcon(displayLeftIcon, 'left'));
      }

      // Icon-only mode
      if (displayIcon) {
        children.push(renderIcon(displayIcon));
      }

      // Right icon
      if (displayRightIcon) {
        children.push(renderIcon(displayRightIcon, 'right'));
      }
    }

    // Text content (not shown during loading if we want to preserve width)
    if (props.children) {
      children.push(
        jsx('span', {
          className: 'button-content',
          'data-button-content': '',
          children: props.children,
        })
      );
    }

    // Render the appropriate element
    return jsx(elType, {
      ...elementProps,
      children,
    });
  };
});
