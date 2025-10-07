/**
 * Skeleton Primitive
 *
 * Loading placeholder for content.
 * Shows a shimmer animation while content loads.
 */

import { defineComponent } from '../core/component/define.js';
import { jsx } from '../jsx-runtime.js';

// ============================================================================
// Types
// ============================================================================

export interface SkeletonProps {
  /**
   * Width (CSS value)
   */
  width?: string | number;

  /**
   * Height (CSS value)
   */
  height?: string | number;

  /**
   * Border radius (CSS value)
   * @default 4px
   */
  radius?: string | number;

  /**
   * Whether to animate
   * @default true
   */
  animate?: boolean;

  /**
   * Children (optional)
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
 * Skeleton component
 *
 * Simple div with skeleton styles.
 * Use CSS to add shimmer animation.
 *
 * @example
 * ```tsx
 * // Simple skeleton
 * <Skeleton width="100%" height="20px" />
 *
 * // Avatar skeleton
 * <Skeleton width="40px" height="40px" radius="50%" />
 *
 * // Text skeleton
 * <Skeleton width="200px" height="1em" />
 *
 * // Multiple lines
 * <>
 *   <Skeleton width="100%" height="20px" />
 *   <Skeleton width="80%" height="20px" />
 *   <Skeleton width="60%" height="20px" />
 * </>
 * ```
 */
export const Skeleton = defineComponent<SkeletonProps>((props) => () => {
    const { width, height, radius, animate = true, style, ...restProps } = props;

    return jsx('div', {
      ...restProps,
      'data-skeleton': '',
      'data-animate': animate ? '' : undefined,
      'aria-busy': 'true',
      'aria-live': 'polite',
      style: {
        ...style,
        width: typeof width === 'number' ? `${width}px` : width,
        height: typeof height === 'number' ? `${height}px` : height,
        borderRadius: typeof radius === 'number' ? `${radius}px` : radius || '4px',
      },
    });
  });
