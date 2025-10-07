/**
 * Separator Primitive
 *
 * Visually or semantically separates content.
 *
 * Based on WAI-ARIA Separator pattern:
 * https://www.w3.org/WAI/ARIA/apg/patterns/separator/
 */

import { defineComponent } from '../core/component/define.js';
import { jsx } from '../jsx-runtime.js';

// ============================================================================
// Types
// ============================================================================

export interface SeparatorProps {
  /**
   * Orientation
   * @default 'horizontal'
   */
  orientation?: 'horizontal' | 'vertical';

  /**
   * Whether the separator is decorative (no semantic meaning)
   * @default true
   */
  decorative?: boolean;

  /**
   * Additional props
   */
  [key: string]: any;
}

// ============================================================================
// Component
// ============================================================================

/**
 * Separator component
 *
 * A simple separator for visually dividing content.
 *
 * @example
 * ```tsx
 * <div>
 *   <p>Content above</p>
 *   <Separator />
 *   <p>Content below</p>
 * </div>
 * ```
 *
 * @example Vertical separator
 * ```tsx
 * <div style={{ display: 'flex' }}>
 *   <span>Left</span>
 *   <Separator orientation="vertical" />
 *   <span>Right</span>
 * </div>
 * ```
 */
export const Separator = defineComponent<SeparatorProps>((props) => {
  const orientation = () => props.orientation || 'horizontal';
  const decorative = () => props.decorative !== false; // default true

  return () =>
    jsx('div', {
      ...props,
      role: decorative() ? 'none' : 'separator',
      'aria-orientation': !decorative() ? orientation() : undefined,
      'data-orientation': orientation(),
    });
});
