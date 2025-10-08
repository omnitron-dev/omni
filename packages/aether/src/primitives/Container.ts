/**
 * Container - Responsive content width container
 *
 * Features:
 * - Responsive max-width constraints
 * - Centered content with auto margins
 * - Configurable padding
 * - Size variants (xs, sm, md, lg, xl, 2xl)
 * - Fluid mode for full-width
 */

import { defineComponent } from '../core/component/index.js';
import { jsx } from '../jsx-runtime.js';

// ============================================================================
// Types
// ============================================================================

export type ContainerSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full';

export interface ContainerProps {
  /** Container max-width size (default: 'lg') */
  size?: ContainerSize;
  /** Center the container (default: true) */
  centerContent?: boolean;
  /** Disable max-width constraint (full width) */
  fluid?: boolean;
  /** Horizontal padding (px or string) */
  px?: number | string;
  /** Vertical padding (px or string) */
  py?: number | string;
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
// Constants
// ============================================================================

const SIZE_MAP: Record<ContainerSize, string> = {
  xs: '480px',
  sm: '640px',
  md: '768px',
  lg: '1024px',
  xl: '1280px',
  '2xl': '1536px',
  full: '100%',
};

// ============================================================================
// Container Component
// ============================================================================

/**
 * Container centers content and constrains its maximum width for better readability.
 *
 * @example
 * ```tsx
 * // Default container (lg size)
 * <Container>
 *   <h1>Page Title</h1>
 *   <p>Content goes here...</p>
 * </Container>
 *
 * // Small container with padding
 * <Container size="sm" px={24} py={32}>
 *   <article>Narrow article content</article>
 * </Container>
 *
 * // Fluid container (no max-width)
 * <Container fluid>
 *   <div>Full-width content</div>
 * </Container>
 *
 * // Extra large container
 * <Container size="2xl">
 *   <div>Wide dashboard content</div>
 * </Container>
 * ```
 */
export const Container = defineComponent<ContainerProps>((props) => () => {
    const size = props.size ?? 'lg';
    const centerContent = props.centerContent ?? true;
    const fluid = props.fluid ?? false;

    const {
      size: _size,
      centerContent: _center,
      fluid: _fluid,
      px,
      py,
      children,
      class: className,
      style,
      ...restProps
    } = props;

    const maxWidth = fluid ? '100%' : SIZE_MAP[size];
    const margin = centerContent ? '0 auto' : undefined;
    const paddingX = px !== undefined ? (typeof px === 'number' ? `${px}px` : px) : '16px';
    const paddingY = py !== undefined ? (typeof py === 'number' ? `${py}px` : py) : undefined;

    const containerStyles: Record<string, any> = {
      width: '100%',
      maxWidth,
      ...(margin && { margin }),
      ...(paddingX && { paddingLeft: paddingX, paddingRight: paddingX }),
      ...(paddingY && { paddingTop: paddingY, paddingBottom: paddingY }),
      ...style,
    };

    return jsx('div', {
      class: className,
      style: containerStyles,
      ...restProps,
      children,
    });
  });
