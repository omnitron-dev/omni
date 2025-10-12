/**
 * Grid - CSS Grid layout container
 *
 * Features:
 * - CSS Grid layout with shorthand props
 * - Template columns/rows
 * - Gap/spacing support
 * - Grid areas support
 * - Auto-flow control
 * - Responsive values
 */

import { defineComponent } from '../core/component/index.js';
import { jsx } from '../jsx-runtime.js';

// ============================================================================
// Types
// ============================================================================

export type GridAutoFlow = 'row' | 'column' | 'dense' | 'row dense' | 'column dense';
export type GridJustifyItems = 'start' | 'end' | 'center' | 'stretch';
export type GridAlignItems = 'start' | 'end' | 'center' | 'stretch' | 'baseline';
export type GridJustifyContent =
  | 'start'
  | 'end'
  | 'center'
  | 'stretch'
  | 'space-around'
  | 'space-between'
  | 'space-evenly';
export type GridAlignContent =
  | 'start'
  | 'end'
  | 'center'
  | 'stretch'
  | 'space-around'
  | 'space-between'
  | 'space-evenly';

export interface GridProps {
  /** Element to render as (default: 'div') */
  as?: string;
  /** Grid template columns (e.g., "1fr 2fr", "repeat(3, 1fr)") */
  templateColumns?: string;
  /** Grid template rows */
  templateRows?: string;
  /** Grid template areas */
  templateAreas?: string;
  /** Grid auto-flow */
  autoFlow?: GridAutoFlow;
  /** Grid auto-columns */
  autoColumns?: string;
  /** Grid auto-rows */
  autoRows?: string;
  /** Gap between items */
  gap?: number | string;
  /** Row gap */
  rowGap?: number | string;
  /** Column gap */
  columnGap?: number | string;
  /** Justify items (horizontal alignment within grid cell) */
  justifyItems?: GridJustifyItems;
  /** Align items (vertical alignment within grid cell) */
  alignItems?: GridAlignItems;
  /** Justify content (grid track alignment horizontal) */
  justifyContent?: GridJustifyContent;
  /** Align content (grid track alignment vertical) */
  alignContent?: GridAlignContent;
  /** Inline grid */
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
// Grid Component
// ============================================================================

/**
 * Grid is a layout component that provides CSS Grid functionality with convenient props.
 *
 * @example
 * ```tsx
 * // Basic 3-column grid
 * <Grid templateColumns="repeat(3, 1fr)" gap={16}>
 *   <div>Item 1</div>
 *   <div>Item 2</div>
 *   <div>Item 3</div>
 * </Grid>
 *
 * // Responsive grid with auto-fit
 * <Grid templateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap="1rem">
 *   <div>Card 1</div>
 *   <div>Card 2</div>
 *   <div>Card 3</div>
 * </Grid>
 *
 * // Grid with named areas
 * <Grid
 *   templateAreas={`
 *     "header header"
 *     "sidebar main"
 *     "footer footer"
 *   `}
 *   templateColumns="200px 1fr"
 *   templateRows="auto 1fr auto"
 *   gap={16}
 * >
 *   <div style={{ gridArea: 'header' }}>Header</div>
 *   <div style={{ gridArea: 'sidebar' }}>Sidebar</div>
 *   <div style={{ gridArea: 'main' }}>Main</div>
 *   <div style={{ gridArea: 'footer' }}>Footer</div>
 * </Grid>
 * ```
 */
export const Grid = defineComponent<GridProps>((props) => () => {
  const element = props.as ?? 'div';
  const {
    as,
    templateColumns,
    templateRows,
    templateAreas,
    autoFlow,
    autoColumns,
    autoRows,
    gap,
    rowGap,
    columnGap,
    justifyItems,
    alignItems,
    justifyContent,
    alignContent,
    inline,
    children,
    class: className,
    style,
    ...restProps
  } = props;

  const gridStyles: Record<string, any> = {
    display: inline ? 'inline-grid' : 'grid',
    ...(templateColumns && { gridTemplateColumns: templateColumns }),
    ...(templateRows && { gridTemplateRows: templateRows }),
    ...(templateAreas && { gridTemplateAreas: templateAreas }),
    ...(autoFlow && { gridAutoFlow: autoFlow }),
    ...(autoColumns && { gridAutoColumns: autoColumns }),
    ...(autoRows && { gridAutoRows: autoRows }),
    ...(gap !== undefined && { gap: typeof gap === 'number' ? `${gap}px` : gap }),
    ...(rowGap !== undefined && { rowGap: typeof rowGap === 'number' ? `${rowGap}px` : rowGap }),
    ...(columnGap !== undefined && { columnGap: typeof columnGap === 'number' ? `${columnGap}px` : columnGap }),
    ...(justifyItems && { justifyItems }),
    ...(alignItems && { alignItems }),
    ...(justifyContent && { justifyContent }),
    ...(alignContent && { alignContent }),
    ...style,
  };

  return jsx(element as any, {
    class: className,
    style: gridStyles,
    ...restProps,
    children,
  });
});

// ============================================================================
// GridItem Component
// ============================================================================

export interface GridItemProps {
  /** Element to render as (default: 'div') */
  as?: string;
  /** Grid column start/end (e.g., "1 / 3", "span 2") */
  column?: string;
  /** Grid column start */
  columnStart?: number | string;
  /** Grid column end */
  columnEnd?: number | string;
  /** Grid row start/end */
  row?: string;
  /** Grid row start */
  rowStart?: number | string;
  /** Grid row end */
  rowEnd?: number | string;
  /** Grid area name */
  area?: string;
  /** Child elements */
  children?: any;
  /** Additional CSS class */
  class?: string;
  /** Inline styles */
  style?: Record<string, any>;
  /** Additional props */
  [key: string]: any;
}

/**
 * GridItem is a child component for Grid that provides placement control.
 *
 * @example
 * ```tsx
 * <Grid templateColumns="repeat(3, 1fr)">
 *   <GridItem column="1 / 3">Spans 2 columns</GridItem>
 *   <GridItem column="span 2">Also spans 2 columns</GridItem>
 *   <GridItem row="1 / 3" column="3">Spans 2 rows</GridItem>
 * </Grid>
 * ```
 */
export const GridItem = defineComponent<GridItemProps>((props) => () => {
  const element = props.as ?? 'div';
  const {
    as,
    column,
    columnStart,
    columnEnd,
    row,
    rowStart,
    rowEnd,
    area,
    children,
    class: className,
    style,
    ...restProps
  } = props;

  const gridItemStyles: Record<string, any> = {
    ...(column && { gridColumn: column }),
    ...(columnStart && { gridColumnStart: columnStart }),
    ...(columnEnd && { gridColumnEnd: columnEnd }),
    ...(row && { gridRow: row }),
    ...(rowStart && { gridRowStart: rowStart }),
    ...(rowEnd && { gridRowEnd: rowEnd }),
    ...(area && { gridArea: area }),
    ...style,
  };

  return jsx(element as any, {
    class: className,
    style: gridItemStyles,
    ...restProps,
    children,
  });
});
