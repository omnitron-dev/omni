/**
 * Center - Centers child elements
 *
 * Features:
 * - Centers content horizontally and vertically
 * - Configurable as inline or block
 * - Optional height constraint
 * - Flex-based centering
 */

import { defineComponent } from '../core/component/index.js';
import { jsx } from '../jsx-runtime.js';

// ============================================================================
// Types
// ============================================================================

export interface CenterProps {
  /** Display as inline element */
  inline?: boolean;
  /** Height of container (if specified, enables vertical centering) */
  height?: number | string;
  /** Width of container */
  width?: number | string;
  /** Child elements */
  children?: any;
  /** Additional CSS class */
  class?: string;
  /** Inline styles */
  style?: Record<string, any>;
  /** Additional props */
  [key: string]: any;
}

// ============================================================================
// Center Component
// ============================================================================

/**
 * Center centers its children both horizontally and vertically.
 *
 * @example
 * ```tsx
 * // Center content in full viewport
 * <Center height="100vh">
 *   <div>Perfectly centered</div>
 * </Center>
 *
 * // Center inline
 * <Center inline>
 *   <button>Centered button</button>
 * </Center>
 *
 * // Center in fixed dimensions
 * <Center width={400} height={300}>
 *   <img src="/logo.png" alt="Logo" />
 * </Center>
 * ```
 */
export const Center = defineComponent<CenterProps>((props) => {
  return () => {
    const {
      inline,
      height,
      width,
      children,
      class: className,
      style,
      ...restProps
    } = props;

    const centerStyles: Record<string, any> = {
      display: inline ? 'inline-flex' : 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      ...(width !== undefined && { width: typeof width === 'number' ? `${width}px` : width }),
      ...(height !== undefined && { height: typeof height === 'number' ? `${height}px` : height }),
      ...style,
    };

    return jsx('div', {
      class: className,
      style: centerStyles,
      ...restProps,
      children,
    });
  };
});
