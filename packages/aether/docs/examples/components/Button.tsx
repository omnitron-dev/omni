/**
 * Button Component Example
 *
 * Demonstrates:
 * - Variant-based styling with variantClasses()
 * - Event handling with prevent()
 * - Conditional classes
 * - TypeScript prop types
 * - Composition with children
 *
 * Usage:
 * ```tsx
 * <Button variant="primary" size="md" onClick={handleClick}>
 *   Click Me
 * </Button>
 * ```
 */

import { defineComponent } from '@omnitron-dev/aether';
import { variantClasses, classes } from '@omnitron-dev/aether/utils';
import { signal } from '@omnitron-dev/aether/reactivity';

/**
 * Button Props
 */
export interface ButtonProps {
  /** Button visual variant */
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';

  /** Button size */
  size?: 'sm' | 'md' | 'lg';

  /** Whether button is disabled */
  disabled?: boolean;

  /** Whether button is in loading state */
  loading?: boolean;

  /** Whether button takes full width */
  fullWidth?: boolean;

  /** Click handler */
  onClick?: () => void;

  /** Button type */
  type?: 'button' | 'submit' | 'reset';

  /** Button children */
  children?: any;

  /** Additional CSS class names */
  className?: string;
}

/**
 * Button Component
 *
 * A fully-featured button component demonstrating Aether utilities.
 */
export const Button = defineComponent<ButtonProps>((props) => {
  // Local state for loading animation
  const isPressed = signal(false);

  const handleClick = () => {
    if (props.disabled || props.loading) return;

    // Visual feedback
    isPressed.set(true);
    setTimeout(() => isPressed.set(false), 150);

    // Call handler
    props.onClick?.();
  };

  return () => {
    const variant = props.variant ?? 'primary';
    const size = props.size ?? 'md';

    return (
      <button
        type={props.type ?? 'button'}
        disabled={props.disabled || props.loading}
        onClick={handleClick}
        className={classes(
          variantClasses(
            'btn',
            {
              // Variants
              primary: 'btn-primary',
              secondary: 'btn-secondary',
              danger: 'btn-danger',
              ghost: 'btn-ghost',
              // Sizes
              sm: 'btn-sm',
              md: 'btn-md',
              lg: 'btn-lg',
            },
            [variant, size]
          ),
          {
            'btn-disabled': props.disabled,
            'btn-loading': props.loading,
            'btn-full-width': props.fullWidth,
            'btn-pressed': isPressed(),
          }
        ) + (props.className ? ` ${props.className}` : '')}
      >
        {props.loading && (
          <span className="btn-spinner" aria-hidden="true">
            ⟳
          </span>
        )}
        <span className={props.loading ? 'btn-content-loading' : 'btn-content'}>
          {props.children}
        </span>
      </button>
    );
  };
});

/**
 * CSS Styles (would typically be in a separate .css file)
 *
 * ```css
 * .btn {
 *   display: inline-flex;
 *   align-items: center;
 *   justify-content: center;
 *   gap: 0.5rem;
 *   font-weight: 500;
 *   border-radius: 0.375rem;
 *   border: 1px solid transparent;
 *   cursor: pointer;
 *   transition: all 0.15s ease;
 *   font-family: inherit;
 * }
 *
 * .btn:focus-visible {
 *   outline: 2px solid #3b82f6;
 *   outline-offset: 2px;
 * }
 *
 * .btn:disabled {
 *   opacity: 0.6;
 *   cursor: not-allowed;
 * }
 *
 * // Variants
 * .btn-primary {
 *   background-color: #3b82f6;
 *   color: white;
 * }
 *
 * .btn-primary:hover:not(:disabled) {
 *   background-color: #2563eb;
 * }
 *
 * .btn-secondary {
 *   background-color: #6b7280;
 *   color: white;
 * }
 *
 * .btn-secondary:hover:not(:disabled) {
 *   background-color: #4b5563;
 * }
 *
 * .btn-danger {
 *   background-color: #ef4444;
 *   color: white;
 * }
 *
 * .btn-danger:hover:not(:disabled) {
 *   background-color: #dc2626;
 * }
 *
 * .btn-ghost {
 *   background-color: transparent;
 *   color: #374151;
 *   border-color: #d1d5db;
 * }
 *
 * .btn-ghost:hover:not(:disabled) {
 *   background-color: #f3f4f6;
 * }
 *
 * // Sizes
 * .btn-sm {
 *   padding: 0.375rem 0.75rem;
 *   font-size: 0.875rem;
 * }
 *
 * .btn-md {
 *   padding: 0.5rem 1rem;
 *   font-size: 1rem;
 * }
 *
 * .btn-lg {
 *   padding: 0.75rem 1.5rem;
 *   font-size: 1.125rem;
 * }
 *
 * // States
 * .btn-full-width {
 *   width: 100%;
 * }
 *
 * .btn-pressed {
 *   transform: scale(0.98);
 * }
 *
 * .btn-spinner {
 *   animation: spin 1s linear infinite;
 * }
 *
 * .btn-content-loading {
 *   opacity: 0.7;
 * }
 *
 * @keyframes spin {
 *   from { transform: rotate(0deg); }
 *   to { transform: rotate(360deg); }
 * }
 * ```
 */

/**
 * Usage Examples
 */

// Basic usage
export const BasicButtonExample = defineComponent(() => {
  return () => (
    <div>
      <Button onClick={() => console.log('clicked')}>
        Click Me
      </Button>
    </div>
  );
});

// All variants
export const VariantsExample = defineComponent(() => {
  return () => (
    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
      <Button variant="primary">Primary</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="danger">Danger</Button>
      <Button variant="ghost">Ghost</Button>
    </div>
  );
});

// All sizes
export const SizesExample = defineComponent(() => {
  return () => (
    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
      <Button size="sm">Small</Button>
      <Button size="md">Medium</Button>
      <Button size="lg">Large</Button>
    </div>
  );
});

// States
export const StatesExample = defineComponent(() => {
  const loading = signal(false);

  const handleClick = () => {
    loading.set(true);
    setTimeout(() => loading.set(false), 2000);
  };

  return () => (
    <div style={{ display: 'flex', gap: '1rem', flexDirection: 'column', maxWidth: '300px' }}>
      <Button onClick={handleClick} loading={loading()}>
        {loading() ? 'Loading...' : 'Click to Load'}
      </Button>

      <Button disabled>Disabled Button</Button>

      <Button fullWidth>Full Width Button</Button>
    </div>
  );
});

// Form submit button
export const FormSubmitExample = defineComponent(() => {
  const handleSubmit = () => {
    console.log('Form submitted!');
  };

  return () => (
    <form onSubmit={(e) => {
      e.preventDefault();
      handleSubmit();
    }}>
      <input type="text" placeholder="Enter text..." style={{ marginRight: '0.5rem' }} />
      <Button type="submit" variant="primary">
        Submit
      </Button>
    </form>
  );
});

/**
 * Key Takeaways:
 *
 * 1. **Variant Classes**: Using variantClasses() for clean variant handling
 * 2. **Conditional Classes**: Using classes() for state-based styling
 * 3. **Type Safety**: Full TypeScript props with optional/required types
 * 4. **Composability**: Children prop allows any content
 * 5. **Accessibility**: Proper disabled state, keyboard support
 * 6. **User Feedback**: Loading spinner, pressed animation
 * 7. **No Magic**: Pure TypeScript/JSX, no custom compiler
 */
