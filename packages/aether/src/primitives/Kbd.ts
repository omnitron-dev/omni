/**
 * Kbd Component
 *
 * Represents keyboard input or keyboard shortcut.
 *
 * @example
 * ```tsx
 * <p>
 *   Press <Kbd>Ctrl</Kbd> + <Kbd>C</Kbd> to copy
 * </p>
 *
 * <Kbd>
 *   <Kbd>⌘</Kbd>
 *   <Kbd>K</Kbd>
 * </Kbd>
 * ```
 */

import { jsx } from '../jsx-runtime.js';
import { defineComponent } from '../core/component/index.js';

export interface KbdProps {
  /**
   * Children content (key text or nested Kbd components)
   */
  children?: any;

  /**
   * Additional HTML attributes
   */
  [key: string]: any;
}

/**
 * Kbd
 *
 * Represents user input from a keyboard, voice input, or any other text entry device.
 *
 * Features:
 * - Semantic HTML with <kbd> element
 * - Can be nested for key combinations
 * - Accessible to screen readers
 * - Customizable via CSS
 *
 * Use cases:
 * - Keyboard shortcuts (Ctrl+C, ⌘K)
 * - Documentation and help text
 * - Interactive tutorials
 * - Key binding displays
 */
export const Kbd = defineComponent<KbdProps>((props) => () => {
  const { children, ...restProps } = props;

  return jsx('kbd', {
    ...restProps,
    'data-kbd': '',
    children,
  });
});

// Attach display name
Kbd.displayName = 'Kbd';
