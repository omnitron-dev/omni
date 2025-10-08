/**
 * Spacer - Flexible space component
 *
 * Features:
 * - Creates flexible space in flex layouts
 * - Pushes adjacent elements apart
 * - Automatically grows to fill available space
 * - Works in both horizontal and vertical layouts
 */

import { defineComponent } from '../core/component/index.js';
import { jsx } from '../jsx-runtime.js';

// ============================================================================
// Types
// ============================================================================

export interface SpacerProps {
  /** Flex grow value (default: 1) */
  grow?: number;
  /** Flex shrink value (default: 0) */
  shrink?: number;
  /** Flex basis value */
  basis?: number | string;
  /** Additional CSS class */
  class?: string;
  /** Inline styles */
  style?: Record<string, any>;
  /** Additional props */
  [key: string]: any;
}

// ============================================================================
// Spacer Component
// ============================================================================

/**
 * Spacer creates flexible space in flex layouts, pushing adjacent elements apart.
 *
 * @example
 * ```tsx
 * // Push items to edges
 * <Flex>
 *   <button>Left</button>
 *   <Spacer />
 *   <button>Right</button>
 * </Flex>
 *
 * // Multiple spacers
 * <Flex>
 *   <div>Start</div>
 *   <Spacer />
 *   <div>Middle</div>
 *   <Spacer />
 *   <div>End</div>
 * </Flex>
 *
 * // Custom grow value
 * <Flex>
 *   <div>Item 1</div>
 *   <Spacer grow={2} />
 *   <div>Item 2</div>
 *   <Spacer grow={1} />
 *   <div>Item 3</div>
 * </Flex>
 * ```
 */
export const Spacer = defineComponent<SpacerProps>((props) => () => {
    const grow = props.grow ?? 1;
    const shrink = props.shrink ?? 0;

    const {
      grow: _grow,
      shrink: _shrink,
      basis,
      class: className,
      style,
      ...restProps
    } = props;

    const spacerStyles: Record<string, any> = {
      flex: `${grow} ${shrink} ${basis !== undefined ? (typeof basis === 'number' ? `${basis}px` : basis) : 'auto'}`,
      alignSelf: 'stretch',
      justifySelf: 'stretch',
      ...style,
    };

    return jsx('div', {
      class: className,
      style: spacerStyles,
      ...restProps,
      'aria-hidden': 'true',
    });
  });
