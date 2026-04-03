/**
 * Class Name Factory
 *
 * Creates prefixed CSS class names for consistent component styling.
 * Uses a configurable prefix to avoid collisions with other libraries.
 *
 * @module @omnitron/prism/utils/create-classes
 */

// =============================================================================
// CONFIGURATION
// =============================================================================

/**
 * Default class prefix for Prism components.
 * Can be overridden via PRISM_CLASS_PREFIX environment variable.
 */
export const DEFAULT_CLASS_PREFIX = 'prism';

let classPrefix = DEFAULT_CLASS_PREFIX;

/**
 * Set the global class prefix for all Prism components.
 *
 * @param prefix - New class prefix to use
 *
 * @example
 * ```ts
 * setClassPrefix('my-app');
 * createClasses('button__root'); // => "my-app__button__root"
 * ```
 */
export function setClassPrefix(prefix: string): void {
  classPrefix = prefix;
}

/**
 * Get the current class prefix.
 *
 * @returns Current class prefix
 */
export function getClassPrefix(): string {
  return classPrefix;
}

// =============================================================================
// CLASS FACTORY
// =============================================================================

/**
 * Create a prefixed CSS class name.
 *
 * @param className - Class name suffix (e.g., "button__root")
 * @returns Prefixed class name (e.g., "prism__button__root")
 *
 * @example
 * ```ts
 * createClasses('chart__root')
 * // => "prism__chart__root"
 *
 * createClasses('chart__loading')
 * // => "prism__chart__loading"
 * ```
 */
export function createClasses(className: string): string {
  return `${classPrefix}__${className}`;
}

/**
 * Create multiple prefixed CSS class names.
 *
 * @param classNames - Array of class name suffixes
 * @returns Object mapping original names to prefixed names
 *
 * @example
 * ```ts
 * const classes = createClassesObject(['root', 'loading', 'label']);
 * // => { root: "prism__root", loading: "prism__loading", label: "prism__label" }
 * ```
 */
export function createClassesObject<T extends string>(classNames: readonly T[]): Record<T, string> {
  return classNames.reduce(
    (acc, name) => {
      acc[name] = createClasses(name);
      return acc;
    },
    {} as Record<T, string>
  );
}

/**
 * Create a class name factory for a specific component.
 *
 * @param componentName - Component name (e.g., "chart", "button")
 * @returns Function that creates prefixed class names for that component
 *
 * @example
 * ```ts
 * const chartClass = createComponentClasses('chart');
 * chartClass('root');    // => "prism__chart__root"
 * chartClass('loading'); // => "prism__chart__loading"
 * ```
 */
export function createComponentClasses(componentName: string): (suffix: string) => string;

/**
 * Create a class name object for a specific component with predefined suffixes.
 *
 * @param componentName - Component name (e.g., "chart", "button")
 * @param suffixes - Array of class name suffixes
 * @returns Object mapping suffix names to prefixed class names
 *
 * @example
 * ```ts
 * const chartClasses = createComponentClasses('chart', ['root', 'loading', 'label'] as const);
 * chartClasses.root;    // => "prism__chart__root"
 * chartClasses.loading; // => "prism__chart__loading"
 * ```
 */
export function createComponentClasses<T extends string>(
  componentName: string,
  suffixes: readonly T[]
): Record<T, string>;

export function createComponentClasses<T extends string>(
  componentName: string,
  suffixes?: readonly T[]
): ((suffix: string) => string) | Record<T, string> {
  if (suffixes) {
    return suffixes.reduce(
      (acc, suffix) => {
        acc[suffix] = createClasses(`${componentName}__${suffix}`);
        return acc;
      },
      {} as Record<T, string>
    );
  }
  return (suffix: string) => createClasses(`${componentName}__${suffix}`);
}
