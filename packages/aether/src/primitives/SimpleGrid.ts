/**
 * SimpleGrid - Responsive equal-width grid
 *
 * Features:
 * - Equal-width columns grid
 * - Responsive column count
 * - Min/max child width constraints
 * - Gap control
 * - Auto-fit or auto-fill
 * - Simpler than Grid for common cases
 */

import { defineComponent } from '../core/component/index.js';
import { jsx } from '../jsx-runtime.js';

// ============================================================================
// Types
// ============================================================================

export type SimpleGridBehavior = 'fit' | 'fill';

export interface SimpleGridProps {
  /** Number of columns */
  columns?: number;
  /** Minimum column width (triggers auto-responsive behavior) */
  minChildWidth?: number | string;
  /** Spacing between items */
  spacing?: number | string;
  /** Row spacing */
  spacingX?: number | string;
  /** Column spacing */
  spacingY?: number | string;
  /** Auto-fit or auto-fill behavior (default: 'fill') */
  behavior?: SimpleGridBehavior;
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
// SimpleGrid Component
// ============================================================================

/**
 * SimpleGrid creates a responsive grid with equal-width columns.
 *
 * @example
 * ```tsx
 * // Fixed 3 columns
 * <SimpleGrid columns={3} spacing={16}>
 *   <div>Card 1</div>
 *   <div>Card 2</div>
 *   <div>Card 3</div>
 *   <div>Card 4</div>
 * </SimpleGrid>
 *
 * // Responsive grid with min child width
 * <SimpleGrid minChildWidth={200} spacing={24}>
 *   <div>Card 1</div>
 *   <div>Card 2</div>
 *   <div>Card 3</div>
 * </SimpleGrid>
 *
 * // Auto-fit (columns collapse when empty)
 * <SimpleGrid minChildWidth="250px" behavior="fit" spacing={16}>
 *   <div>Item 1</div>
 *   <div>Item 2</div>
 * </SimpleGrid>
 *
 * // Different horizontal/vertical spacing
 * <SimpleGrid columns={4} spacingX={24} spacingY={16}>
 *   <div>1</div>
 *   <div>2</div>
 *   <div>3</div>
 *   <div>4</div>
 * </SimpleGrid>
 * ```
 */
export const SimpleGrid = defineComponent<SimpleGridProps>((props) => () => {
    const {
      columns,
      minChildWidth,
      spacing,
      spacingX,
      spacingY,
      behavior,
      children,
      class: className,
      style,
      ...restProps
    } = props;

    const behaviorType = behavior ?? 'fill';

    // Determine grid template columns
    let templateColumns: string;

    if (minChildWidth) {
      // Auto-responsive based on min child width
      const minWidth = typeof minChildWidth === 'number' ? `${minChildWidth}px` : minChildWidth;
      templateColumns = `repeat(auto-${behaviorType}, minmax(${minWidth}, 1fr))`;
    } else if (columns) {
      // Fixed number of columns
      templateColumns = `repeat(${columns}, 1fr)`;
    } else {
      // Default to single column
      templateColumns = '1fr';
    }

    // Handle spacing
    const gap = spacing !== undefined ? (typeof spacing === 'number' ? `${spacing}px` : spacing) : undefined;
    const columnGap = spacingX !== undefined ? (typeof spacingX === 'number' ? `${spacingX}px` : spacingX) : gap;
    const rowGap = spacingY !== undefined ? (typeof spacingY === 'number' ? `${spacingY}px` : spacingY) : gap;

    const gridStyles: Record<string, any> = {
      display: 'grid',
      gridTemplateColumns: templateColumns,
      ...(columnGap && { columnGap }),
      ...(rowGap && { rowGap }),
      ...style,
    };

    return jsx('div', {
      class: className,
      style: gridStyles,
      ...restProps,
      children,
    });
  });
