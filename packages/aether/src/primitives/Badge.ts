/**
 * Badge Primitive
 *
 * Display badges for status indicators, notifications, counts, etc.
 * Simple, headless component for maximum flexibility.
 */

import { defineComponent } from '../core/component/define.js';
import { jsx } from '../jsx-runtime.js';

// ============================================================================
// Types
// ============================================================================

export interface BadgeProps {
  /**
   * Badge content (text, number, or icon)
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
 * Badge component
 *
 * Simple span element with data attributes for styling.
 * Completely headless - you control all styles.
 *
 * @example
 * ```tsx
 * // Simple badge
 * <Badge>New</Badge>
 *
 * // Notification count
 * <Badge>{unreadCount()}</Badge>
 *
 * // Status indicator
 * <Badge data-status="success">Active</Badge>
 * <Badge data-status="error">Failed</Badge>
 * <Badge data-status="warning">Pending</Badge>
 * ```
 */
export const Badge = defineComponent<BadgeProps>((props) => () =>
    jsx('span', {
      ...props,
      'data-badge': '',
      role: 'status',
      'aria-live': 'polite',
    }));
