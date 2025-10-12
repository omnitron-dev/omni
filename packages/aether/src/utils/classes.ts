/**
 * Class Utilities
 *
 * Utilities for managing CSS classes with support for conditional
 * and reactive classes, providing directive-like convenience
 */

/**
 * Class value type - string, array of strings, or undefined
 */
export type ClassValue = string | string[] | undefined | null | false | Record<string, boolean | (() => boolean)>;

/**
 * Combine multiple class values into a single string
 *
 * @param values - Array of class values
 * @returns Combined class string
 *
 * @example
 * ```typescript
 * classNames('base', 'active') // 'base active'
 * classNames('base', undefined, 'active') // 'base active'
 * classNames('base', ['foo', 'bar']) // 'base foo bar'
 * ```
 */
export function classNames(...values: ClassValue[]): string {
  const classes: string[] = [];

  for (const value of values) {
    if (!value) continue;

    if (typeof value === 'string') {
      classes.push(value);
    } else if (Array.isArray(value)) {
      classes.push(...value);
    } else if (typeof value === 'object') {
      for (const [className, condition] of Object.entries(value)) {
        const isActive = typeof condition === 'function' ? condition() : condition;
        if (isActive) {
          classes.push(className);
        }
      }
    }
  }

  return classes.join(' ');
}

/**
 * Alias for classNames
 */
export const cx = classNames;

/**
 * Create conditional classes from object
 *
 * @param base - Base class(es)
 * @param conditional - Object mapping class names to conditions
 * @returns Combined class string
 *
 * @example
 * ```typescript
 * const isActive = signal(true);
 * const isDisabled = signal(false);
 *
 * classes('base', {
 *   active: isActive,
 *   disabled: () => isDisabled(),
 *   hidden: false
 * })
 * // Returns: 'base active'
 * ```
 */
export function classes(base: string | string[], conditional: Record<string, boolean | (() => boolean)>): string {
  const baseClasses = Array.isArray(base) ? base.join(' ') : base;
  const conditionalClasses: string[] = [];

  for (const [className, condition] of Object.entries(conditional)) {
    const isActive = typeof condition === 'function' ? condition() : condition;
    if (isActive) {
      conditionalClasses.push(className);
    }
  }

  const allClasses = [baseClasses, ...conditionalClasses].filter(Boolean).join(' ');

  return allClasses;
}

/**
 * Create a reactive class string that updates when signals change
 *
 * This is a helper for creating class strings in reactive contexts
 *
 * @param fn - Function that returns class values
 * @returns Class string
 *
 * @example
 * ```typescript
 * const isActive = signal(true);
 * const theme = signal('dark');
 *
 * // In component render function
 * <div className={reactiveClasses(() => classNames(
 *   'base',
 *   { active: isActive() },
 *   theme()
 * ))}>
 *   Content
 * </div>
 * ```
 */
export function reactiveClasses(fn: () => ClassValue): string {
  return classNames(fn());
}

/**
 * Toggle a class name based on condition
 *
 * @param className - Class name to toggle
 * @param condition - Boolean or function returning boolean
 * @returns Class name or empty string
 *
 * @example
 * ```typescript
 * const isActive = signal(true);
 *
 * <div className={toggleClass('active', isActive)}>
 *   Content
 * </div>
 * ```
 */
export function toggleClass(className: string, condition: boolean | (() => boolean)): string {
  const isActive = typeof condition === 'function' ? condition() : condition;
  return isActive ? className : '';
}

/**
 * Create multiple conditional classes
 *
 * @param conditions - Object mapping class names to conditions
 * @returns Combined class string
 *
 * @example
 * ```typescript
 * const isActive = signal(true);
 * const isDisabled = signal(false);
 * const isHidden = signal(false);
 *
 * <div className={conditionalClasses({
 *   active: isActive,
 *   disabled: () => isDisabled(),
 *   hidden: () => isHidden()
 * })}>
 *   Content
 * </div>
 * ```
 */
export function conditionalClasses(conditions: Record<string, boolean | (() => boolean)>): string {
  const classes: string[] = [];

  for (const [className, condition] of Object.entries(conditions)) {
    const isActive = typeof condition === 'function' ? condition() : condition;
    if (isActive) {
      classes.push(className);
    }
  }

  return classes.join(' ');
}

/**
 * Create variant-based classes
 *
 * Useful for component variants (primary, secondary, etc.)
 *
 * @param base - Base class(es)
 * @param variants - Object mapping variant names to class names
 * @param activeVariant - Currently active variant(s)
 * @returns Combined class string
 *
 * @example
 * ```typescript
 * const variant = signal<'primary' | 'secondary'>('primary');
 * const size = signal<'sm' | 'md' | 'lg'>('md');
 *
 * <button className={variantClasses(
 *   'btn',
 *   {
 *     primary: 'btn-primary',
 *     secondary: 'btn-secondary',
 *     sm: 'btn-sm',
 *     md: 'btn-md',
 *     lg: 'btn-lg'
 *   },
 *   [variant(), size()]
 * )}>
 *   Button
 * </button>
 * // Returns: 'btn btn-primary btn-md'
 * ```
 */
export function variantClasses(
  base: string | string[],
  variants: Record<string, string>,
  activeVariant: string | string[] | (() => string | string[])
): string {
  const baseClasses = Array.isArray(base) ? base.join(' ') : base;
  const active = typeof activeVariant === 'function' ? activeVariant() : activeVariant;
  const activeVariants = Array.isArray(active) ? active : [active];

  const variantClasses = activeVariants.map((v) => variants[v]).filter(Boolean);

  return [baseClasses, ...variantClasses].join(' ');
}

/**
 * Merge multiple class strings, removing duplicates
 *
 * @param classes - Array of class strings
 * @returns Merged class string without duplicates
 *
 * @example
 * ```typescript
 * mergeClasses('base active', 'active hover', 'base')
 * // Returns: 'base active hover'
 * ```
 */
export function mergeClasses(...classes: (string | undefined | null)[]): string {
  const classSet = new Set<string>();

  for (const cls of classes) {
    if (!cls) continue;

    const parts = cls.split(' ').filter(Boolean);
    for (const part of parts) {
      classSet.add(part);
    }
  }

  return Array.from(classSet).join(' ');
}
