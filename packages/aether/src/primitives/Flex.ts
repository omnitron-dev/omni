/**
 * Flex - Flexbox layout container
 *
 * Features:
 * - Flexbox layout with shorthand props
 * - Direction control (row, column)
 * - Alignment (justify, align, alignSelf)
 * - Gap/spacing support
 * - Wrapping control
 * - Responsive values
 */

import { defineComponent } from '../core/component/index.js';
import { jsx } from '../jsx-runtime.js';

// ============================================================================
// Types
// ============================================================================

export type FlexDirection = 'row' | 'row-reverse' | 'column' | 'column-reverse';
export type FlexWrap = 'nowrap' | 'wrap' | 'wrap-reverse';
export type JustifyContent = 'flex-start' | 'flex-end' | 'center' | 'space-between' | 'space-around' | 'space-evenly';
export type AlignItems = 'flex-start' | 'flex-end' | 'center' | 'baseline' | 'stretch';
export type AlignContent = 'flex-start' | 'flex-end' | 'center' | 'space-between' | 'space-around' | 'stretch';

export interface FlexProps {
  /** Element to render as (default: 'div') */
  as?: string;
  /** Flex direction */
  direction?: FlexDirection;
  /** Justify content (main axis) */
  justify?: JustifyContent;
  /** Align items (cross axis) */
  align?: AlignItems;
  /** Align content (when wrapping) */
  alignContent?: AlignContent;
  /** Flex wrap */
  wrap?: FlexWrap;
  /** Gap between items (CSS gap property) */
  gap?: number | string;
  /** Row gap */
  rowGap?: number | string;
  /** Column gap */
  columnGap?: number | string;
  /** Flex grow */
  grow?: number;
  /** Flex shrink */
  shrink?: number;
  /** Flex basis */
  basis?: number | string;
  /** Inline flex */
  inline?: boolean;
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
// Flex Component
// ============================================================================

/**
 * Flex is a layout component that provides flexbox functionality with convenient props.
 *
 * @example
 * ```tsx
 * // Basic horizontal flex
 * <Flex gap={16}>
 *   <div>Item 1</div>
 *   <div>Item 2</div>
 * </Flex>
 *
 * // Centered column
 * <Flex direction="column" align="center" justify="center">
 *   <div>Centered content</div>
 * </Flex>
 *
 * // Space between with wrapping
 * <Flex justify="space-between" wrap="wrap" gap="1rem">
 *   <div>Item 1</div>
 *   <div>Item 2</div>
 *   <div>Item 3</div>
 * </Flex>
 * ```
 */
export const Flex = defineComponent<FlexProps>((props) => {
  return () => {
    const element = props.as ?? 'div';
    const {
      as,
      direction,
      justify,
      align,
      alignContent,
      wrap,
      gap,
      rowGap,
      columnGap,
      grow,
      shrink,
      basis,
      inline,
      children,
      class: className,
      style,
      ...restProps
    } = props;

    const flexStyles: Record<string, any> = {
      display: inline ? 'inline-flex' : 'flex',
      ...(direction && { flexDirection: direction }),
      ...(justify && { justifyContent: justify }),
      ...(align && { alignItems: align }),
      ...(alignContent && { alignContent }),
      ...(wrap && { flexWrap: wrap }),
      ...(gap !== undefined && { gap: typeof gap === 'number' ? `${gap}px` : gap }),
      ...(rowGap !== undefined && { rowGap: typeof rowGap === 'number' ? `${rowGap}px` : rowGap }),
      ...(columnGap !== undefined && { columnGap: typeof columnGap === 'number' ? `${columnGap}px` : columnGap }),
      ...(grow !== undefined && { flexGrow: grow }),
      ...(shrink !== undefined && { flexShrink: shrink }),
      ...(basis !== undefined && { flexBasis: typeof basis === 'number' ? `${basis}px` : basis }),
      ...style,
    };

    return jsx(element as any, {
      class: className,
      style: flexStyles,
      ...restProps,
      children,
    });
  };
});
