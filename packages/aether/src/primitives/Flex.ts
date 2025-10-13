/**
 * Flex - Universal flexbox layout container
 *
 * Features:
 * - Flexbox layout with shorthand props
 * - Direction control (row, column, vertical, horizontal)
 * - Alignment (justify, align, alignSelf)
 * - Gap/spacing support
 * - Wrapping control
 * - Divider support (from Stack)
 * - Centering shortcuts (from Center)
 * - Responsive values
 *
 * This component absorbs functionality from Stack, Center, VStack, and HStack
 * to provide a unified flexbox primitive.
 */

import { defineComponent } from '../core/component/index.js';
import { jsx } from '../jsx-runtime.js';

// ============================================================================
// Types
// ============================================================================

export type FlexDirection = 'row' | 'row-reverse' | 'column' | 'column-reverse' | 'vertical' | 'horizontal';
export type FlexWrap = 'nowrap' | 'wrap' | 'wrap-reverse' | boolean;
export type JustifyContent = 'flex-start' | 'flex-end' | 'center' | 'space-between' | 'space-around' | 'space-evenly' | 'start' | 'end';
export type AlignItems = 'flex-start' | 'flex-end' | 'center' | 'baseline' | 'stretch' | 'start' | 'end';
export type AlignContent = 'flex-start' | 'flex-end' | 'center' | 'space-between' | 'space-around' | 'stretch';

export interface FlexProps {
  /** Element to render as (default: 'div') */
  as?: string;
  /** Flex direction - supports 'vertical' and 'horizontal' aliases */
  direction?: FlexDirection;
  /** Justify content (main axis) - supports 'start' and 'end' aliases */
  justify?: JustifyContent;
  /** Align items (cross axis) - supports 'start' and 'end' aliases */
  align?: AlignItems;
  /** Align content (when wrapping) */
  alignContent?: AlignContent;
  /** Flex wrap - supports boolean for convenience */
  wrap?: FlexWrap;
  /** Gap between items (CSS gap property) */
  gap?: number | string;
  /** Spacing between items (alias for gap, from Stack) */
  spacing?: number | string;
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
  /** Divider element to render between children (from Stack) */
  divider?: any;
  /** Width of container (from Center) */
  width?: number | string;
  /** Height of container (from Center) */
  height?: number | string;
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
 * Flex is a universal layout component that provides flexbox functionality with convenient props.
 * It absorbs all functionality from Stack, Center, VStack, and HStack components.
 *
 * @example
 * ```tsx
 * // ===== BASIC FLEX USAGE =====
 *
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
 *
 * // ===== MIGRATION FROM STACK =====
 *
 * // OLD: Stack with vertical direction (default)
 * <Stack spacing={16}>
 *   <div>Item 1</div>
 *   <div>Item 2</div>
 * </Stack>
 *
 * // NEW: Flex with vertical direction
 * <Flex direction="vertical" spacing={16}>
 *   <div>Item 1</div>
 *   <div>Item 2</div>
 * </Flex>
 * // OR using column (original Flex style)
 * <Flex direction="column" gap={16}>
 *   <div>Item 1</div>
 *   <div>Item 2</div>
 * </Flex>
 *
 * // OLD: Stack with horizontal direction
 * <Stack direction="horizontal" spacing={24} align="center">
 *   <button>Button 1</button>
 *   <button>Button 2</button>
 * </Stack>
 *
 * // NEW: Flex with horizontal direction
 * <Flex direction="horizontal" spacing={24} align="center">
 *   <button>Button 1</button>
 *   <button>Button 2</button>
 * </Flex>
 * // OR using row (original Flex style)
 * <Flex direction="row" gap={24} align="center">
 *   <button>Button 1</button>
 *   <button>Button 2</button>
 * </Flex>
 *
 * // OLD: Stack with divider
 * <Stack spacing={16} divider={<hr />}>
 *   <div>Section 1</div>
 *   <div>Section 2</div>
 * </Stack>
 *
 * // NEW: Flex with divider (works identically)
 * <Flex direction="vertical" spacing={16} divider={<hr />}>
 *   <div>Section 1</div>
 *   <div>Section 2</div>
 * </Flex>
 *
 * // OLD: Stack with alignment shortcuts
 * <Stack align="start" justify="space-between">
 *   <div>Item 1</div>
 *   <div>Item 2</div>
 * </Stack>
 *
 * // NEW: Flex supports same shortcuts (and converts to flex-start/flex-end)
 * <Flex direction="vertical" align="start" justify="space-between">
 *   <div>Item 1</div>
 *   <div>Item 2</div>
 * </Flex>
 *
 * // ===== MIGRATION FROM VSTACK =====
 *
 * // OLD: VStack (vertical stack shorthand)
 * <VStack spacing={16}>
 *   <div>Item 1</div>
 *   <div>Item 2</div>
 * </VStack>
 *
 * // NEW: Flex with vertical direction
 * <Flex direction="vertical" spacing={16}>
 *   <div>Item 1</div>
 *   <div>Item 2</div>
 * </Flex>
 * // OR even simpler (vertical is common, use column)
 * <Flex direction="column" gap={16}>
 *   <div>Item 1</div>
 *   <div>Item 2</div>
 * </Flex>
 *
 * // ===== MIGRATION FROM HSTACK =====
 *
 * // OLD: HStack (horizontal stack shorthand)
 * <HStack spacing={8} align="center">
 *   <button>Cancel</button>
 *   <button>Submit</button>
 * </HStack>
 *
 * // NEW: Flex with horizontal direction
 * <Flex direction="horizontal" spacing={8} align="center">
 *   <button>Cancel</button>
 *   <button>Submit</button>
 * </Flex>
 * // OR using row (default is row, so can be omitted)
 * <Flex gap={8} align="center">
 *   <button>Cancel</button>
 *   <button>Submit</button>
 * </Flex>
 *
 * // ===== MIGRATION FROM CENTER =====
 *
 * // OLD: Center with height
 * <Center height="100vh">
 *   <div>Perfectly centered</div>
 * </Center>
 *
 * // NEW: Flex with centering props
 * <Flex justify="center" align="center" height="100vh">
 *   <div>Perfectly centered</div>
 * </Flex>
 *
 * // OLD: Center inline
 * <Center inline>
 *   <button>Centered button</button>
 * </Center>
 *
 * // NEW: Flex with inline and centering
 * <Flex inline justify="center" align="center">
 *   <button>Centered button</button>
 * </Flex>
 *
 * // OLD: Center with dimensions
 * <Center width={400} height={300}>
 *   <img src="/logo.png" alt="Logo" />
 * </Center>
 *
 * // NEW: Flex with dimensions and centering
 * <Flex width={400} height={300} justify="center" align="center">
 *   <img src="/logo.png" alt="Logo" />
 * </Flex>
 * ```
 *
 * @remarks
 * Key enhancements over the original Flex component:
 * - `spacing` prop as an alias for `gap` (Stack compatibility)
 * - `direction="vertical"` and `direction="horizontal"` aliases for `"column"` and `"row"`
 * - `divider` prop support for rendering elements between children
 * - `align` and `justify` now support `"start"` and `"end"` shortcuts (converted to flex-start/flex-end)
 * - `wrap` now accepts boolean values (true = 'wrap', false = 'nowrap')
 * - `width` and `height` props for easy container sizing (Center compatibility)
 *
 * All original Flex functionality remains intact and backward compatible.
 */
export const Flex = defineComponent<FlexProps>((props) => () => {
  const element = props.as ?? 'div';
  const {
    as: _as,
    direction,
    justify,
    align,
    alignContent,
    wrap,
    gap,
    spacing,
    rowGap,
    columnGap,
    grow,
    shrink,
    basis,
    inline,
    divider,
    width,
    height,
    children,
    class: className,
    style,
    ...restProps
  } = props;

  // Normalize direction: 'vertical' -> 'column', 'horizontal' -> 'row'
  let normalizedDirection = direction;
  if (direction === 'vertical') {
    normalizedDirection = 'column';
  } else if (direction === 'horizontal') {
    normalizedDirection = 'row';
  }

  // Normalize align: 'start' -> 'flex-start', 'end' -> 'flex-end'
  let normalizedAlign = align;
  if (align === 'start') {
    normalizedAlign = 'flex-start';
  } else if (align === 'end') {
    normalizedAlign = 'flex-end';
  }

  // Normalize justify: 'start' -> 'flex-start', 'end' -> 'flex-end'
  let normalizedJustify = justify;
  if (justify === 'start') {
    normalizedJustify = 'flex-start';
  } else if (justify === 'end') {
    normalizedJustify = 'flex-end';
  }

  // Normalize wrap: boolean -> 'wrap' or 'nowrap'
  let normalizedWrap = wrap;
  if (typeof wrap === 'boolean') {
    normalizedWrap = wrap ? 'wrap' : 'nowrap';
  }

  // Use spacing as fallback for gap (Stack compatibility)
  const effectiveGap = gap !== undefined ? gap : spacing;

  const flexStyles: Record<string, any> = {
    display: inline ? 'inline-flex' : 'flex',
    ...(normalizedDirection && { flexDirection: normalizedDirection }),
    ...(normalizedJustify && { justifyContent: normalizedJustify }),
    ...(normalizedAlign && { alignItems: normalizedAlign }),
    ...(alignContent && { alignContent }),
    ...(normalizedWrap && { flexWrap: normalizedWrap }),
    ...(effectiveGap !== undefined && { gap: typeof effectiveGap === 'number' ? `${effectiveGap}px` : effectiveGap }),
    ...(rowGap !== undefined && { rowGap: typeof rowGap === 'number' ? `${rowGap}px` : rowGap }),
    ...(columnGap !== undefined && { columnGap: typeof columnGap === 'number' ? `${columnGap}px` : columnGap }),
    ...(grow !== undefined && { flexGrow: grow }),
    ...(shrink !== undefined && { flexShrink: shrink }),
    ...(basis !== undefined && { flexBasis: typeof basis === 'number' ? `${basis}px` : basis }),
    ...(width !== undefined && { width: typeof width === 'number' ? `${width}px` : width }),
    ...(height !== undefined && { height: typeof height === 'number' ? `${height}px` : height }),
    ...style,
  };

  // Handle divider: insert divider elements between children
  let content = children;
  if (divider && Array.isArray(children)) {
    const items = [];
    for (let i = 0; i < children.length; i++) {
      items.push(children[i]);
      if (i < children.length - 1) {
        items.push(
          jsx('div', {
            key: `divider-${i}`,
            style: { display: 'contents' },
            children: divider,
          })
        );
      }
    }
    content = items;
  }

  return jsx(element as any, {
    class: className,
    style: flexStyles,
    ...restProps,
    children: content,
  });
});
