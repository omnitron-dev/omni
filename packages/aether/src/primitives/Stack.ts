/**
 * Stack - Vertical/Horizontal stack with consistent spacing
 *
 * Features:
 * - Vertical (VStack) and horizontal (HStack) layouts
 * - Consistent spacing between items
 * - Alignment control
 * - Divider support
 * - Wrapping control
 */

import { defineComponent } from '../core/component/index.js';
import { jsx } from '../jsx-runtime.js';

// ============================================================================
// Types
// ============================================================================

export type StackDirection = 'vertical' | 'horizontal';
export type StackAlign = 'start' | 'center' | 'end' | 'stretch' | 'baseline';
export type StackJustify = 'start' | 'center' | 'end' | 'space-between' | 'space-around' | 'space-evenly';

export interface StackProps {
  /** Stack direction (default: 'vertical') */
  direction?: StackDirection;
  /** Spacing between items (px) */
  spacing?: number | string;
  /** Alignment of items on cross axis */
  align?: StackAlign;
  /** Justification of items on main axis */
  justify?: StackJustify;
  /** Allow wrapping */
  wrap?: boolean;
  /** Divider element to place between items */
  divider?: any;
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
// Stack Component
// ============================================================================

/**
 * Stack is a layout component for stacking elements vertically or horizontally
 * with consistent spacing.
 *
 * @example
 * ```tsx
 * // Vertical stack (default)
 * <Stack spacing={16}>
 *   <div>Item 1</div>
 *   <div>Item 2</div>
 *   <div>Item 3</div>
 * </Stack>
 *
 * // Horizontal stack with center alignment
 * <Stack direction="horizontal" spacing={24} align="center">
 *   <button>Button 1</button>
 *   <button>Button 2</button>
 * </Stack>
 *
 * // Stack with divider
 * <Stack spacing={16} divider={<hr />}>
 *   <div>Section 1</div>
 *   <div>Section 2</div>
 * </Stack>
 * ```
 */
export const Stack = defineComponent<StackProps>((props) => () => {
    const direction = props.direction ?? 'vertical';
    const spacing = props.spacing ?? 0;
    const isVertical = direction === 'vertical';

    const {
      direction: _direction,
      spacing: _spacing,
      align,
      justify,
      wrap,
      divider,
      children,
      class: className,
      style,
      ...restProps
    } = props;

    // Convert align to flexbox alignment
    const alignItems = align === 'start' ? 'flex-start' : align === 'end' ? 'flex-end' : align;
    const justifyContent = justify === 'start' ? 'flex-start' : justify === 'end' ? 'flex-end' : justify;

    const stackStyles: Record<string, any> = {
      display: 'flex',
      flexDirection: isVertical ? 'column' : 'row',
      gap: typeof spacing === 'number' ? `${spacing}px` : spacing,
      ...(alignItems && { alignItems }),
      ...(justifyContent && { justifyContent }),
      ...(wrap && { flexWrap: 'wrap' }),
      ...style,
    };

    // If divider is provided, manually add spacing and dividers
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
            }),
          );
        }
      }
      content = items;
    }

    return jsx('div', {
      class: className,
      style: stackStyles,
      ...restProps,
      children: content,
    });
  });

// ============================================================================
// VStack (Vertical Stack) - Convenience wrapper
// ============================================================================

export interface VStackProps extends Omit<StackProps, 'direction'> {}

/**
 * VStack is a convenience wrapper for vertical Stack.
 *
 * @example
 * ```tsx
 * <VStack spacing={16}>
 *   <div>Item 1</div>
 *   <div>Item 2</div>
 * </VStack>
 * ```
 */
export const VStack = defineComponent<VStackProps>((props) => () => jsx(Stack, { direction: 'vertical', ...props }));

// ============================================================================
// HStack (Horizontal Stack) - Convenience wrapper
// ============================================================================

export interface HStackProps extends Omit<StackProps, 'direction'> {}

/**
 * HStack is a convenience wrapper for horizontal Stack.
 *
 * @example
 * ```tsx
 * <HStack spacing={8} align="center">
 *   <button>Cancel</button>
 *   <button>Submit</button>
 * </HStack>
 * ```
 */
export const HStack = defineComponent<HStackProps>((props) => () => jsx(Stack, { direction: 'horizontal', ...props }));
