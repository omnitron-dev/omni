'use client';

/**
 * useMultiSelect Hook
 *
 * Multi-selection state management with keyboard support.
 *
 * @module @omnitron-dev/prism/core/hooks/use-multi-select
 */

import { useCallback, useMemo, useState } from 'react';

/**
 * Options for useMultiSelect.
 */
export interface UseMultiSelectOptions<T> {
  /** Initial selected items */
  initial?: T[];
  /** Maximum selection count */
  maxSelections?: number;
  /** Callback when selection changes */
  onChange?: (selected: T[]) => void;
}

/**
 * Return type for useMultiSelect.
 */
export interface UseMultiSelectReturn<T> {
  /** Currently selected items */
  selected: T[];
  /** Number of selected items */
  count: number;
  /** Whether nothing is selected */
  isEmpty: boolean;
  /** Check if item is selected */
  isSelected: (item: T) => boolean;
  /** Toggle item selection */
  toggle: (item: T) => void;
  /** Select an item */
  select: (item: T) => void;
  /** Deselect an item */
  deselect: (item: T) => void;
  /** Select multiple items */
  selectMany: (items: T[]) => void;
  /** Deselect multiple items */
  deselectMany: (items: T[]) => void;
  /** Clear all selections */
  clear: () => void;
  /** Replace all selections */
  setSelected: (items: T[]) => void;
  /** Select all items from a list */
  selectAll: (allItems: T[]) => void;
  /** Check if all items are selected */
  isAllSelected: (allItems: T[]) => boolean;
  /** Check if some items are selected (for indeterminate state) */
  isPartiallySelected: (allItems: T[]) => boolean;
}

/**
 * useMultiSelect - Multi-selection state management.
 *
 * @example
 * ```tsx
 * function UserList() {
 *   const users = ['Alice', 'Bob', 'Charlie'];
 *   const selection = useMultiSelect<string>();
 *
 *   return (
 *     <>
 *       <Checkbox
 *         checked={selection.isAllSelected(users)}
 *         indeterminate={selection.isPartiallySelected(users)}
 *         onChange={() => {
 *           if (selection.isAllSelected(users)) {
 *             selection.clear();
 *           } else {
 *             selection.selectAll(users);
 *           }
 *         }}
 *       />
 *       {users.map((user) => (
 *         <Checkbox
 *           key={user}
 *           checked={selection.isSelected(user)}
 *           onChange={() => selection.toggle(user)}
 *         />
 *       ))}
 *       <Button disabled={selection.isEmpty}>
 *         Delete ({selection.count})
 *       </Button>
 *     </>
 *   );
 * }
 * ```
 *
 * @example
 * ```tsx
 * // With objects and custom max
 * interface Item {
 *   id: string;
 *   name: string;
 * }
 *
 * function ItemPicker() {
 *   const items: Item[] = [...];
 *   const selection = useMultiSelect<string>({
 *     maxSelections: 5,
 *     onChange: (selected) => console.log('Selected:', selected),
 *   });
 *
 *   return items.map((item) => (
 *     <Chip
 *       key={item.id}
 *       selected={selection.isSelected(item.id)}
 *       onClick={() => selection.toggle(item.id)}
 *     >
 *       {item.name}
 *     </Chip>
 *   ));
 * }
 * ```
 *
 * @param options - Hook options
 * @returns Selection state and controls
 */
export function useMultiSelect<T>(options: UseMultiSelectOptions<T> = {}): UseMultiSelectReturn<T> {
  const { initial = [], maxSelections, onChange } = options;

  const [selected, setInternalSelected] = useState<T[]>(initial);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const setSelected = useCallback(
    (items: T[]) => {
      const limited = maxSelections ? items.slice(0, maxSelections) : items;
      setInternalSelected(limited);
      onChange?.(limited);
    },
    [maxSelections, onChange]
  );

  const isSelected = useCallback((item: T) => selectedSet.has(item), [selectedSet]);

  const select = useCallback(
    (item: T) => {
      if (selectedSet.has(item)) return;
      if (maxSelections && selected.length >= maxSelections) return;

      const newSelected = [...selected, item];
      setInternalSelected(newSelected);
      onChange?.(newSelected);
    },
    [selected, selectedSet, maxSelections, onChange]
  );

  const deselect = useCallback(
    (item: T) => {
      if (!selectedSet.has(item)) return;

      const newSelected = selected.filter((s) => s !== item);
      setInternalSelected(newSelected);
      onChange?.(newSelected);
    },
    [selected, selectedSet, onChange]
  );

  const toggle = useCallback(
    (item: T) => {
      if (selectedSet.has(item)) {
        deselect(item);
      } else {
        select(item);
      }
    },
    [selectedSet, select, deselect]
  );

  const selectMany = useCallback(
    (items: T[]) => {
      const toAdd = items.filter((item) => !selectedSet.has(item));
      if (toAdd.length === 0) return;

      let newSelected = [...selected, ...toAdd];
      if (maxSelections) {
        newSelected = newSelected.slice(0, maxSelections);
      }

      setInternalSelected(newSelected);
      onChange?.(newSelected);
    },
    [selected, selectedSet, maxSelections, onChange]
  );

  const deselectMany = useCallback(
    (items: T[]) => {
      const toRemove = new Set(items);
      const newSelected = selected.filter((s) => !toRemove.has(s));

      if (newSelected.length === selected.length) return;

      setInternalSelected(newSelected);
      onChange?.(newSelected);
    },
    [selected, onChange]
  );

  const clear = useCallback(() => {
    if (selected.length === 0) return;
    setInternalSelected([]);
    onChange?.([]);
  }, [selected.length, onChange]);

  const selectAll = useCallback(
    (allItems: T[]) => {
      const limited = maxSelections ? allItems.slice(0, maxSelections) : allItems;
      setInternalSelected(limited);
      onChange?.(limited);
    },
    [maxSelections, onChange]
  );

  const isAllSelected = useCallback(
    (allItems: T[]) => {
      if (allItems.length === 0) return false;
      return allItems.every((item) => selectedSet.has(item));
    },
    [selectedSet]
  );

  const isPartiallySelected = useCallback(
    (allItems: T[]) => {
      if (allItems.length === 0) return false;
      const selectedCount = allItems.filter((item) => selectedSet.has(item)).length;
      return selectedCount > 0 && selectedCount < allItems.length;
    },
    [selectedSet]
  );

  return {
    selected,
    count: selected.length,
    isEmpty: selected.length === 0,
    isSelected,
    toggle,
    select,
    deselect,
    selectMany,
    deselectMany,
    clear,
    setSelected,
    selectAll,
    isAllSelected,
    isPartiallySelected,
  };
}
