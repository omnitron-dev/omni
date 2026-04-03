/**
 * Class Name Utility
 *
 * Combines clsx for conditional classes with optional Tailwind merge.
 * Inspired by shadcn/ui's cn() utility and minimal-shared's mergeClasses.
 *
 * @module @omnitron-dev/prism/utils/cn
 */

import { clsx, type ClassValue } from 'clsx';

/**
 * Combines class names using clsx.
 *
 * This is a simplified version without tailwind-merge since Prism
 * primarily uses MUI's sx prop for styling. For Tailwind projects,
 * consider adding tailwind-merge.
 *
 * @example
 * ```tsx
 * // Basic usage
 * cn('px-4 py-2', 'bg-blue-500')
 *
 * // Conditional classes
 * cn('base-class', isActive && 'active', isDisabled && 'disabled')
 *
 * // With objects
 * cn('base', { active: isActive, disabled: isDisabled })
 *
 * // With arrays
 * cn(['class1', 'class2'], condition && 'class3')
 * ```
 */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}

/**
 * Type for class value inputs.
 * Re-exported for convenience.
 */
export type { ClassValue };

// =============================================================================
// STATE-BASED CLASS MERGING (minimal-shared pattern)
// =============================================================================

/**
 * State props for mergeClasses.
 * Values can be:
 * - boolean: includes key as class name if true
 * - undefined: excluded
 * - [boolean, string]: includes string as class name if boolean is true
 */
export type StateProps = {
  [key: string]: boolean | undefined | [boolean, string];
};

/**
 * Merges class names with state-based class names.
 *
 * This utility provides an alternative API for state-based class toggling,
 * particularly useful when class names differ from state keys.
 *
 * @param className - Base class name(s)
 * @param state - State object with boolean or [boolean, className] values
 * @returns Merged class names string
 *
 * @example
 * ```tsx
 * // Basic state-based merging
 * mergeClasses('item', {
 *   'item--active': isActive,
 *   'item--disabled': isDisabled,
 * });
 * // Output: 'item item--active' (if isActive is true)
 *
 * // With tuple format for different class names
 * mergeClasses('btn', {
 *   primary: [isPrimary, 'btn-primary'],
 *   secondary: [isSecondary, 'btn-secondary'],
 * });
 *
 * // With array of base classes
 * mergeClasses(['nav', 'nav--main'], {
 *   'nav--open': isOpen,
 * });
 * ```
 */
export function mergeClasses(className?: string | (string | undefined)[] | null, state?: StateProps): string {
  const classList = className ? (Array.isArray(className) ? className.filter(Boolean) : [className]) : [];

  if (!state) {
    return classList.join(' ');
  }

  const stateClasses = Object.entries(state)
    .filter(([, value]) => value !== undefined && value !== false)
    .map(([key, value]) => {
      if (Array.isArray(value)) {
        return value[0] ? value[1] : '';
      }
      return value ? key : '';
    })
    .filter(Boolean);

  return [...classList, ...stateClasses].join(' ');
}
