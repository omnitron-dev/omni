/**
 * Button Component
 *
 * A versatile button component with multiple variants, sizes, and states.
 *
 * @example
 * ```tsx
 * <Button variant="primary" size="md" onClick={handleClick}>
 *   Click Me
 * </Button>
 * ```
 */

import { defineComponent, signal } from '@omnitron-dev/aether';
import { jsx } from '@omnitron-dev/aether/jsx-runtime';

// ============================================================================
// Types
// ============================================================================

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'success'
  | 'warning'
  | 'danger'
  | 'ghost'
  | 'link';

export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export interface ButtonProps {
  /** Button variant */
  variant?: ButtonVariant;

  /** Button size */
  size?: ButtonSize;

  /** Whether button is disabled */
  disabled?: boolean;

  /** Whether button is loading */
  loading?: boolean;

  /** Whether button takes full width */
  fullWidth?: boolean;

  /** Button type */
  type?: 'button' | 'submit' | 'reset';

  /** Click handler */
  onClick?: (event: MouseEvent) => void;

  /** Children content */
  children?: any;

  /** Additional CSS class */
  class?: string;

  /** ARIA label */
  'aria-label'?: string;

  /** Additional props */
  [key: string]: any;
}

// ============================================================================
// Button Component
// ============================================================================

export const Button = defineComponent<ButtonProps>((props) => {
  const isPressed = signal(false);

  return () => {
    const {
      variant = 'primary',
      size = 'md',
      disabled = false,
      loading = false,
      fullWidth = false,
      type = 'button',
      onClick,
      children,
      class: className = '',
      'aria-label': ariaLabel,
      ...rest
    } = props;

    const handleClick = (event: MouseEvent) => {
      if (disabled || loading) {
        event.preventDefault();
        return;
      }
      onClick?.(event);
    };

    const handleMouseDown = () => {
      if (!disabled && !loading) {
        isPressed.set(true);
      }
    };

    const handleMouseUp = () => {
      isPressed.set(false);
    };

    const handleMouseLeave = () => {
      isPressed.set(false);
    };

    return jsx('button', {
      ...rest,
      type,
      'data-button': '',
      'data-variant': variant,
      'data-size': size,
      'data-full-width': fullWidth || undefined,
      'data-loading': loading || undefined,
      'data-pressed': isPressed() || undefined,
      class: `button ${className}`,
      disabled: disabled || loading,
      'aria-label': ariaLabel,
      'aria-disabled': disabled || loading,
      'aria-busy': loading,
      onClick: handleClick,
      onMouseDown: handleMouseDown,
      onMouseUp: handleMouseUp,
      onMouseLeave: handleMouseLeave,
      children: [
        // Loading spinner
        loading &&
          jsx('span', {
            'data-button-spinner': '',
            'aria-hidden': 'true',
            children: jsx('svg', {
              viewBox: '0 0 50 50',
              width: '1em',
              height: '1em',
              children: jsx('circle', {
                cx: '25',
                cy: '25',
                r: '20',
                fill: 'none',
                stroke: 'currentColor',
                strokeWidth: '4',
                strokeDasharray: '80, 200',
                strokeDashoffset: '0',
                style: {
                  animation: 'button-spin 1s linear infinite',
                },
              }),
            }),
          }),

        // Button content
        jsx('span', {
          'data-button-content': '',
          style: loading ? { opacity: 0.5 } : undefined,
          children,
        }),
      ],
    });
  };
});

// Display name
Button.displayName = 'Button';
