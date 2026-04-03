'use client';

/**
 * useTabs Hook
 *
 * Manages tab state for tab components with proper memoization.
 * Compatible with MUI Tabs and custom tab implementations.
 *
 * @module @omnitron-dev/prism/core/hooks
 */

import { useState, useCallback, useMemo } from 'react';
import type { SyntheticEvent } from 'react';

/**
 * Return type for useTabs hook.
 */
export interface UseTabsReturn<T extends string | number | false> {
  /** Current tab value */
  value: T;
  /** Set tab value directly */
  setValue: (value: T) => void;
  /** MUI Tabs onChange handler */
  onChange: (event: SyntheticEvent, newValue: T) => void;
  /** Reset to initial value */
  reset: () => void;
  /** Check if a specific tab is selected */
  isSelected: (tabValue: T) => boolean;
  /** Select next tab (for array-based tabs) */
  selectNext: (tabs: readonly T[]) => void;
  /** Select previous tab (for array-based tabs) */
  selectPrevious: (tabs: readonly T[]) => void;
}

/**
 * Options for useTabs hook.
 */
export interface UseTabsOptions<T> {
  /**
   * Callback when tab changes.
   */
  onChange?: (value: T) => void;
}

/**
 * Hook to manage tab state with proper memoization.
 *
 * @template T - Type of tab value (string, number, or false)
 * @param {T} defaultValue - Initial tab value
 * @param {UseTabsOptions<T>} options - Hook options
 * @returns {UseTabsReturn<T>} Tab state and handlers
 *
 * @example
 * ```tsx
 * function MyTabs() {
 *   const tabs = useTabs('overview');
 *
 *   return (
 *     <>
 *       <Tabs value={tabs.value} onChange={tabs.onChange}>
 *         <Tab label="Overview" value="overview" />
 *         <Tab label="Details" value="details" />
 *         <Tab label="Settings" value="settings" />
 *       </Tabs>
 *       {tabs.value === 'overview' && <Overview />}
 *       {tabs.value === 'details' && <Details />}
 *       {tabs.value === 'settings' && <Settings />}
 *     </>
 *   );
 * }
 * ```
 *
 * @example
 * ```tsx
 * // With keyboard navigation
 * const TABS = ['overview', 'details', 'settings'] as const;
 *
 * function MyTabs() {
 *   const tabs = useTabs<typeof TABS[number]>('overview');
 *
 *   useKeyboardShortcut({ key: 'ArrowRight' }, () => tabs.selectNext(TABS));
 *   useKeyboardShortcut({ key: 'ArrowLeft' }, () => tabs.selectPrevious(TABS));
 *
 *   return <Tabs value={tabs.value} onChange={tabs.onChange}>...</Tabs>;
 * }
 * ```
 */
export function useTabs<T extends string | number | false = string>(
  defaultValue: T,
  options?: UseTabsOptions<T>
): UseTabsReturn<T> {
  const [value, setValueInternal] = useState<T>(defaultValue);

  const setValue = useCallback(
    (newValue: T) => {
      setValueInternal(newValue);
      options?.onChange?.(newValue);
    },
    [options]
  );

  const onChange = useCallback(
    (_event: SyntheticEvent, newValue: T) => {
      setValue(newValue);
    },
    [setValue]
  );

  const reset = useCallback(() => {
    setValue(defaultValue);
  }, [defaultValue, setValue]);

  const isSelected = useCallback((tabValue: T) => value === tabValue, [value]);

  const selectNext = useCallback(
    (tabs: readonly T[]) => {
      const currentIndex = tabs.indexOf(value);
      if (currentIndex < tabs.length - 1) {
        setValue(tabs[currentIndex + 1]);
      }
    },
    [value, setValue]
  );

  const selectPrevious = useCallback(
    (tabs: readonly T[]) => {
      const currentIndex = tabs.indexOf(value);
      if (currentIndex > 0) {
        setValue(tabs[currentIndex - 1]);
      }
    },
    [value, setValue]
  );

  // Memoize the return value to prevent unnecessary re-renders
  // This is a key pattern from minimal-shared
  return useMemo(
    () => ({
      value,
      setValue,
      onChange,
      reset,
      isSelected,
      selectNext,
      selectPrevious,
    }),
    [value, setValue, onChange, reset, isSelected, selectNext, selectPrevious]
  );
}
