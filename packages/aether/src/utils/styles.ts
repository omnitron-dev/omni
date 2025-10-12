/**
 * Style Utilities
 *
 * Utilities for managing inline styles with support for reactive
 * values and CSS custom properties
 */

/**
 * CSS property value - string, number, or reactive function
 */
export type StyleValue = string | number | (() => string | number) | undefined | null;

/**
 * Style object with support for reactive values
 */
export type StyleObject = Record<string, StyleValue>;

/**
 * JSX CSSProperties type
 */
export type CSSProperties = Record<string, string | number>;

/**
 * Create style object from reactive style values
 *
 * @param styleObj - Object mapping CSS properties to values
 * @returns Style object for JSX
 *
 * @example
 * ```typescript
 * const color = signal('red');
 * const fontSize = signal(16);
 *
 * <div style={styles({
 *   color: color,
 *   fontSize: () => `${fontSize()}px`,
 *   padding: '10px'
 * })}>
 *   Content
 * </div>
 * ```
 */
export function styles(styleObj: StyleObject): CSSProperties {
  const result: CSSProperties = {};

  for (const [key, value] of Object.entries(styleObj)) {
    if (value === undefined || value === null) continue;

    const resolved = typeof value === 'function' ? value() : value;

    // Convert camelCase to kebab-case for CSS custom properties
    const cssKey = key.startsWith('--') ? key : camelToKebab(key);

    result[cssKey] = typeof resolved === 'number' ? String(resolved) : resolved;
  }

  return result;
}

/**
 * Create reactive style object
 *
 * @param fn - Function that returns style object
 * @returns Style object for JSX
 *
 * @example
 * ```typescript
 * const theme = signal({ primary: 'blue', secondary: 'gray' });
 *
 * <div style={reactiveStyles(() => ({
 *   color: theme().primary,
 *   backgroundColor: theme().secondary
 * }))}>
 *   Content
 * </div>
 * ```
 */
export function reactiveStyles(fn: () => StyleObject): CSSProperties {
  return styles(fn());
}

/**
 * Merge multiple style objects
 *
 * Later styles override earlier ones
 *
 * @param styleObjects - Array of style objects
 * @returns Merged style object
 *
 * @example
 * ```typescript
 * const baseStyles = { color: 'red', padding: '10px' };
 * const overrides = { color: 'blue' };
 *
 * <div style={mergeStyles(baseStyles, overrides)}>
 *   Content (blue color, 10px padding)
 * </div>
 * ```
 */
export function mergeStyles(...styleObjects: (StyleObject | undefined | null)[]): CSSProperties {
  const merged: StyleObject = {};

  for (const obj of styleObjects) {
    if (!obj) continue;

    for (const [key, value] of Object.entries(obj)) {
      merged[key] = value;
    }
  }

  return styles(merged);
}

/**
 * Convert camelCase to kebab-case
 *
 * @param str - camelCase string
 * @returns kebab-case string
 *
 * @example
 * ```typescript
 * camelToKebab('fontSize') // 'font-size'
 * camelToKebab('backgroundColor') // 'background-color'
 * ```
 */
function camelToKebab(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/**
 * Create CSS custom property (CSS variable) style
 *
 * @param name - Custom property name (without --)
 * @param value - Property value
 * @returns Style object
 *
 * @example
 * ```typescript
 * const themeColor = signal('#007bff');
 *
 * <div style={cssVar('theme-color', themeColor)}>
 *   <p style={{ color: 'var(--theme-color)' }}>Text</p>
 * </div>
 * ```
 */
export function cssVar(name: string, value: StyleValue): CSSProperties {
  const varName = name.startsWith('--') ? name : `--${name}`;
  return styles({ [varName]: value });
}

/**
 * Create multiple CSS custom properties
 *
 * @param vars - Object mapping variable names to values
 * @returns Style object
 *
 * @example
 * ```typescript
 * const primaryColor = signal('#007bff');
 * const secondaryColor = signal('#6c757d');
 *
 * <div style={cssVars({
 *   'primary-color': primaryColor,
 *   'secondary-color': secondaryColor
 * })}>
 *   <p style={{ color: 'var(--primary-color)' }}>Primary</p>
 *   <p style={{ color: 'var(--secondary-color)' }}>Secondary</p>
 * </div>
 * ```
 */
export function cssVars(vars: Record<string, StyleValue>): CSSProperties {
  const result: StyleObject = {};

  for (const [name, value] of Object.entries(vars)) {
    const varName = name.startsWith('--') ? name : `--${name}`;
    result[varName] = value;
  }

  return styles(result);
}

/**
 * Create conditional styles
 *
 * @param condition - Condition or function returning boolean
 * @param trueStyles - Styles when condition is true
 * @param falseStyles - Styles when condition is false
 * @returns Style object
 *
 * @example
 * ```typescript
 * const isActive = signal(true);
 *
 * <div style={conditionalStyles(
 *   isActive,
 *   { color: 'green', fontWeight: 'bold' },
 *   { color: 'gray' }
 * )}>
 *   Content
 * </div>
 * ```
 */
export function conditionalStyles(
  condition: boolean | (() => boolean),
  trueStyles: StyleObject,
  falseStyles?: StyleObject
): CSSProperties {
  const isTrue = typeof condition === 'function' ? condition() : condition;
  return styles(isTrue ? trueStyles : falseStyles || {});
}

/**
 * Create size styles (width and height)
 *
 * @param size - Size value or object with width/height
 * @returns Style object
 *
 * @example
 * ```typescript
 * const size = signal(100);
 *
 * // Square
 * <div style={sizeStyles(size)}>Square</div>
 * <div style={sizeStyles(100)}>Square 100x100</div>
 *
 * // Rectangle
 * <div style={sizeStyles({ width: 200, height: 100 })}>Rectangle</div>
 * ```
 */
export function sizeStyles(
  size: number | string | { width?: number | string; height?: number | string } | (() => number | string)
): CSSProperties {
  if (typeof size === 'function') {
    const resolved = size();
    return styles({ width: resolved, height: resolved });
  }

  if (typeof size === 'object' && size !== null) {
    return styles({
      width: size.width,
      height: size.height,
    });
  }

  return styles({ width: size, height: size });
}

/**
 * Create position styles
 *
 * @param position - Position values
 * @returns Style object
 *
 * @example
 * ```typescript
 * const top = signal(10);
 * const left = signal(20);
 *
 * <div style={positionStyles({ top, left, position: 'absolute' })}>
 *   Positioned
 * </div>
 * ```
 */
export function positionStyles(position: {
  position?: 'static' | 'relative' | 'absolute' | 'fixed' | 'sticky';
  top?: StyleValue;
  right?: StyleValue;
  bottom?: StyleValue;
  left?: StyleValue;
}): CSSProperties {
  return styles({
    position: position.position,
    top: position.top,
    right: position.right,
    bottom: position.bottom,
    left: position.left,
  });
}

/**
 * Create flexbox styles
 *
 * @param flex - Flexbox properties
 * @returns Style object
 *
 * @example
 * ```typescript
 * <div style={flexStyles({ direction: 'row', justify: 'center', align: 'center' })}>
 *   Centered content
 * </div>
 * ```
 */
export function flexStyles(flex: {
  direction?: 'row' | 'row-reverse' | 'column' | 'column-reverse';
  wrap?: 'nowrap' | 'wrap' | 'wrap-reverse';
  justify?: 'flex-start' | 'flex-end' | 'center' | 'space-between' | 'space-around' | 'space-evenly';
  align?: 'flex-start' | 'flex-end' | 'center' | 'baseline' | 'stretch';
  gap?: StyleValue;
}): CSSProperties {
  return styles({
    display: 'flex',
    flexDirection: flex.direction,
    flexWrap: flex.wrap,
    justifyContent: flex.justify,
    alignItems: flex.align,
    gap: flex.gap,
  });
}

/**
 * Create grid styles
 *
 * @param grid - Grid properties
 * @returns Style object
 *
 * @example
 * ```typescript
 * <div style={gridStyles({ columns: 3, gap: '1rem' })}>
 *   <div>Item 1</div>
 *   <div>Item 2</div>
 *   <div>Item 3</div>
 * </div>
 * ```
 */
export function gridStyles(grid: {
  columns?: number | string;
  rows?: number | string;
  gap?: StyleValue;
  columnGap?: StyleValue;
  rowGap?: StyleValue;
}): CSSProperties {
  return styles({
    display: 'grid',
    gridTemplateColumns: typeof grid.columns === 'number' ? `repeat(${grid.columns}, 1fr)` : grid.columns,
    gridTemplateRows: typeof grid.rows === 'number' ? `repeat(${grid.rows}, 1fr)` : grid.rows,
    gap: grid.gap,
    columnGap: grid.columnGap,
    rowGap: grid.rowGap,
  });
}
