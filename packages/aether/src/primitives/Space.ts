/**
 * Space - Adds spacing between child elements
 *
 * Features:
 * - Fixed spacing between inline/block elements
 * - Horizontal and vertical spacing modes
 * - Alignment control
 * - Wrapping support
 * - Size variants
 */

import { defineComponent } from '../core/component/index.js';
import { jsx } from '../jsx-runtime.js';

// ============================================================================
// Types
// ============================================================================

export type SpaceDirection = 'horizontal' | 'vertical';
export type SpaceSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | number;
export type SpaceAlign = 'start' | 'center' | 'end' | 'baseline';

export interface SpaceProps {
  /** Spacing direction (default: 'horizontal') */
  direction?: SpaceDirection;
  /** Spacing size */
  size?: SpaceSize;
  /** Spacing value in pixels (overrides size) */
  spacing?: number;
  /** Alignment of items */
  align?: SpaceAlign;
  /** Allow wrapping */
  wrap?: boolean;
  /** Split items equally (justify space-between) */
  split?: boolean;
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

const SIZE_MAP: Record<Exclude<SpaceSize, number>, number> = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

// ============================================================================
// Space Component
// ============================================================================

/**
 * Space adds consistent spacing between child elements.
 *
 * @example
 * ```tsx
 * // Horizontal spacing (default)
 * <Space>
 *   <button>Button 1</button>
 *   <button>Button 2</button>
 *   <button>Button 3</button>
 * </Space>
 *
 * // Vertical spacing
 * <Space direction="vertical" size="lg">
 *   <div>Item 1</div>
 *   <div>Item 2</div>
 *   <div>Item 3</div>
 * </Space>
 *
 * // Custom spacing with wrapping
 * <Space spacing={12} wrap>
 *   <Tag>Tag 1</Tag>
 *   <Tag>Tag 2</Tag>
 *   <Tag>Tag 3</Tag>
 * </Space>
 *
 * // Split items evenly
 * <Space split>
 *   <div>Start</div>
 *   <div>Middle</div>
 *   <div>End</div>
 * </Space>
 * ```
 */
export const Space = defineComponent<SpaceProps>((props) => () => {
  const direction = props.direction ?? 'horizontal';
  const size = props.size ?? 'md';
  const spacing = props.spacing ?? (typeof size === 'number' ? size : SIZE_MAP[size]);
  const isVertical = direction === 'vertical';

  const {
    direction: _direction,
    size: _size,
    spacing: _spacing,
    align,
    wrap,
    split,
    children,
    class: className,
    style,
    ...restProps
  } = props;

  // Convert align to flexbox alignment
  const alignItems = align === 'start' ? 'flex-start' : align === 'end' ? 'flex-end' : align;

  const spaceStyles: Record<string, any> = {
    display: 'inline-flex',
    flexDirection: isVertical ? 'column' : 'row',
    gap: `${spacing}px`,
    ...(alignItems && { alignItems }),
    ...(wrap && { flexWrap: 'wrap' }),
    ...(split && { justifyContent: 'space-between', width: '100%' }),
    ...style,
  };

  return jsx('div', {
    class: className,
    style: spaceStyles,
    ...restProps,
    children,
  });
});
