/**
 * Toggle Primitive
 *
 * A two-state button for binary options (e.g., bold/italic formatting).
 *
 * Based on WAI-ARIA Button pattern with pressed state:
 * https://www.w3.org/WAI/ARIA/apg/patterns/button/
 */

import { defineComponent } from '../core/component/define.js';
import { signal, type WritableSignal } from '../core/reactivity/signal.js';
import { jsx } from '../jsx-runtime.js';
import { generateId } from './utils/index.js';

// ============================================================================
// Types
// ============================================================================

export interface ToggleProps {
  /**
   * Controlled pressed state
   */
  pressed?: WritableSignal<boolean>;

  /**
   * Initial pressed state (uncontrolled)
   */
  defaultPressed?: boolean;

  /**
   * Callback when pressed state changes
   */
  onPressedChange?: (pressed: boolean) => void;

  /**
   * Disabled state
   */
  disabled?: boolean;

  /**
   * ID for the toggle button
   */
  id?: string;

  /**
   * Children
   */
  children?: any;

  /**
   * Additional props
   */
  [key: string]: any;
}

// ============================================================================
// Component
// ============================================================================

/**
 * Toggle button component
 *
 * Two-state button for binary options like text formatting.
 * Uses aria-pressed for state indication.
 *
 * @example
 * ```tsx
 * <Toggle pressed={isBold} onPressedChange={setIsBold} aria-label="Bold">
 *   <BoldIcon />
 * </Toggle>
 * ```
 */
export const Toggle = defineComponent<ToggleProps>((props) => {
  const toggleId = props.id || generateId();

  // Use controlled or uncontrolled pressed state
  const internalPressed = signal(props.defaultPressed ?? false);
  const pressedSignal = props.pressed || internalPressed;

  const disabled = () => !!props.disabled;

  const handleClick = (e: MouseEvent) => {
    if (disabled()) {
      e.preventDefault();
      return;
    }

    const nextPressed = !pressedSignal();
    pressedSignal.set(nextPressed);
    props.onPressedChange?.(nextPressed);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (disabled()) return;

    // Space and Enter toggle the button
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      handleClick(e as any);
    }
  };

  return () =>
    jsx('button', {
      ...props,
      id: toggleId,
      type: 'button',
      role: 'button',
      'aria-pressed': pressedSignal() ? 'true' : 'false',
      'data-state': pressedSignal() ? 'on' : 'off',
      'data-disabled': disabled() ? '' : undefined,
      disabled: disabled(),
      onClick: handleClick,
      onKeyDown: handleKeyDown,
    });
});
