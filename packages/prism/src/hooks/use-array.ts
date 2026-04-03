'use client';

/**
 * useArray Hook
 *
 * A hook for managing array state with convenient CRUD operations.
 *
 * @module @omnitron-dev/prism/hooks/use-array
 */

import { useState, useCallback, useMemo } from 'react';

/**
 * Return type for useArray hook.
 */
export interface UseArrayReturn<T> {
  /** Current array value */
  value: T[];
  /** Set array to new value */
  setValue: React.Dispatch<React.SetStateAction<T[]>>;
  /** Add item to end of array */
  push: (item: T) => void;
  /** Add items to end of array */
  pushMany: (items: T[]) => void;
  /** Remove first occurrence of item (by reference or predicate) */
  remove: (itemOrPredicate: T | ((item: T) => boolean)) => void;
  /** Remove item at index */
  removeAt: (index: number) => void;
  /** Remove items matching predicate */
  removeWhere: (predicate: (item: T) => boolean) => void;
  /** Update item at index */
  updateAt: (index: number, item: T) => void;
  /** Update item at index with partial data (merge) */
  updateAtPartial: (index: number, partial: Partial<T>) => void;
  /** Update items matching predicate */
  updateWhere: (predicate: (item: T) => boolean, update: T | ((item: T) => T)) => void;
  /** Insert item at index */
  insertAt: (index: number, item: T) => void;
  /** Move item from one index to another */
  move: (fromIndex: number, toIndex: number) => void;
  /** Swap items at two indices */
  swap: (indexA: number, indexB: number) => void;
  /** Clear all items */
  clear: () => void;
  /** Reset to initial value */
  reset: () => void;
  /** Reverse array in place */
  reverse: () => void;
  /** Sort array */
  sort: (compareFn?: (a: T, b: T) => number) => void;
  /** Filter array (returns new array, does not modify state) */
  filter: (predicate: (item: T) => boolean) => T[];
  /** Find item (returns item, does not modify state) */
  find: (predicate: (item: T) => boolean) => T | undefined;
  /** Find item index (returns index, does not modify state) */
  findIndex: (predicate: (item: T) => boolean) => number;
  /** Check if array includes item */
  includes: (item: T) => boolean;
  /** Get array length */
  length: number;
  /** Check if array is empty */
  isEmpty: boolean;
  /** Get first item */
  first: T | undefined;
  /** Get last item */
  last: T | undefined;
}

/**
 * Hook for managing array state with CRUD operations.
 *
 * @param initialValue - Initial array value
 * @returns Array value and manipulation methods
 *
 * @example
 * ```tsx
 * function TodoList() {
 *   const todos = useArray<{ id: number; text: string; done: boolean }>([]);
 *
 *   const addTodo = (text: string) => {
 *     todos.push({ id: Date.now(), text, done: false });
 *   };
 *
 *   const toggleTodo = (id: number) => {
 *     todos.updateWhere(
 *       (todo) => todo.id === id,
 *       (todo) => ({ ...todo, done: !todo.done })
 *     );
 *   };
 *
 *   return (
 *     <ul>
 *       {todos.value.map((todo) => (
 *         <li key={todo.id} onClick={() => toggleTodo(todo.id)}>
 *           {todo.text} {todo.done && '✓'}
 *         </li>
 *       ))}
 *     </ul>
 *   );
 * }
 * ```
 *
 * @example
 * ```tsx
 * // Drag and drop reordering
 * function SortableList() {
 *   const items = useArray(['A', 'B', 'C', 'D']);
 *
 *   const handleDragEnd = (fromIndex: number, toIndex: number) => {
 *     items.move(fromIndex, toIndex);
 *   };
 *
 *   return <DraggableList items={items.value} onReorder={handleDragEnd} />;
 * }
 * ```
 *
 * @example
 * ```tsx
 * // With type-safe updates
 * interface User {
 *   id: number;
 *   name: string;
 *   email: string;
 * }
 *
 * function UserList() {
 *   const users = useArray<User>([
 *     { id: 1, name: 'Alice', email: 'alice@example.com' },
 *   ]);
 *
 *   // Partial update (type-safe)
 *   users.updateAtPartial(0, { email: 'alice@newdomain.com' });
 *
 *   return <div>{users.value.map(u => u.name).join(', ')}</div>;
 * }
 * ```
 */
export function useArray<T>(initialValue: T[] = []): UseArrayReturn<T> {
  const [value, setValue] = useState<T[]>(initialValue);

  // Add single item to end
  const push = useCallback((item: T) => {
    setValue((arr) => [...arr, item]);
  }, []);

  // Add multiple items to end
  const pushMany = useCallback((items: T[]) => {
    setValue((arr) => [...arr, ...items]);
  }, []);

  // Remove first occurrence of item
  const remove = useCallback((itemOrPredicate: T | ((item: T) => boolean)) => {
    setValue((arr) => {
      const predicate =
        typeof itemOrPredicate === 'function'
          ? (itemOrPredicate as (item: T) => boolean)
          : (item: T) => item === itemOrPredicate;
      const index = arr.findIndex(predicate);
      if (index === -1) return arr;
      return [...arr.slice(0, index), ...arr.slice(index + 1)];
    });
  }, []);

  // Remove item at specific index
  const removeAt = useCallback((index: number) => {
    setValue((arr) => {
      if (index < 0 || index >= arr.length) return arr;
      return [...arr.slice(0, index), ...arr.slice(index + 1)];
    });
  }, []);

  // Remove all items matching predicate
  const removeWhere = useCallback((predicate: (item: T) => boolean) => {
    setValue((arr) => arr.filter((item) => !predicate(item)));
  }, []);

  // Update item at specific index
  const updateAt = useCallback((index: number, item: T) => {
    setValue((arr) => {
      if (index < 0 || index >= arr.length) return arr;
      return [...arr.slice(0, index), item, ...arr.slice(index + 1)];
    });
  }, []);

  // Update item at index with partial data
  const updateAtPartial = useCallback((index: number, partial: Partial<T>) => {
    setValue((arr) => {
      if (index < 0 || index >= arr.length) return arr;
      const item = arr[index];
      if (typeof item !== 'object' || item === null) {
        console.warn('updateAtPartial only works with object items');
        return arr;
      }
      return [...arr.slice(0, index), { ...item, ...partial }, ...arr.slice(index + 1)];
    });
  }, []);

  // Update all items matching predicate
  const updateWhere = useCallback((predicate: (item: T) => boolean, update: T | ((item: T) => T)) => {
    setValue((arr) =>
      arr.map((item) => {
        if (!predicate(item)) return item;
        return typeof update === 'function' ? (update as (item: T) => T)(item) : update;
      })
    );
  }, []);

  // Insert item at specific index
  const insertAt = useCallback((index: number, item: T) => {
    setValue((arr) => {
      const normalizedIndex = Math.max(0, Math.min(index, arr.length));
      return [...arr.slice(0, normalizedIndex), item, ...arr.slice(normalizedIndex)];
    });
  }, []);

  // Move item from one index to another
  const move = useCallback((fromIndex: number, toIndex: number) => {
    setValue((arr) => {
      if (fromIndex < 0 || fromIndex >= arr.length || toIndex < 0 || toIndex >= arr.length || fromIndex === toIndex) {
        return arr;
      }
      const newArr = [...arr];
      const [item] = newArr.splice(fromIndex, 1);
      newArr.splice(toIndex, 0, item);
      return newArr;
    });
  }, []);

  // Swap two items
  const swap = useCallback((indexA: number, indexB: number) => {
    setValue((arr) => {
      if (indexA < 0 || indexA >= arr.length || indexB < 0 || indexB >= arr.length || indexA === indexB) {
        return arr;
      }
      const newArr = [...arr];
      [newArr[indexA], newArr[indexB]] = [newArr[indexB], newArr[indexA]];
      return newArr;
    });
  }, []);

  // Clear all items
  const clear = useCallback(() => {
    setValue([]);
  }, []);

  // Reset to initial value
  const reset = useCallback(() => {
    setValue(initialValue);
  }, [initialValue]);

  // Reverse array
  const reverse = useCallback(() => {
    setValue((arr) => [...arr].reverse());
  }, []);

  // Sort array
  const sort = useCallback((compareFn?: (a: T, b: T) => number) => {
    setValue((arr) => [...arr].sort(compareFn));
  }, []);

  // Non-mutating operations (memoized for stability)
  const filter = useCallback((predicate: (item: T) => boolean) => value.filter(predicate), [value]);

  const find = useCallback((predicate: (item: T) => boolean) => value.find(predicate), [value]);

  const findIndex = useCallback((predicate: (item: T) => boolean) => value.findIndex(predicate), [value]);

  const includes = useCallback((item: T) => value.includes(item), [value]);

  // Computed properties
  const computed = useMemo(
    () => ({
      length: value.length,
      isEmpty: value.length === 0,
      first: value[0],
      last: value[value.length - 1],
    }),
    [value]
  );

  return {
    value,
    setValue,
    push,
    pushMany,
    remove,
    removeAt,
    removeWhere,
    updateAt,
    updateAtPartial,
    updateWhere,
    insertAt,
    move,
    swap,
    clear,
    reset,
    reverse,
    sort,
    filter,
    find,
    findIndex,
    includes,
    ...computed,
  };
}
