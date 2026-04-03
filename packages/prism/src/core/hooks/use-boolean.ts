'use client';

/**
 * useBoolean Hook
 *
 * A hook for managing boolean state with convenient toggle methods.
 *
 * @module @omnitron-dev/prism/core/hooks/use-boolean
 */

import { useState, useCallback, useMemo } from 'react';

/**
 * Return type for useBoolean hook.
 */
export interface UseBooleanReturn {
  /** Current boolean value */
  value: boolean;
  /** Set value to true */
  onTrue: () => void;
  /** Set value to false */
  onFalse: () => void;
  /** Toggle the value */
  onToggle: () => void;
  /** Set to specific value */
  setValue: (value: boolean) => void;
}

/**
 * Hook for managing boolean state with convenient toggle methods.
 *
 * @param defaultValue - Initial boolean value (default: false)
 * @returns Boolean state and control methods
 *
 * @example
 * ```tsx
 * function Modal() {
 *   const dialog = useBoolean();
 *
 *   return (
 *     <>
 *       <Button onClick={dialog.onTrue}>Open</Button>
 *       <Dialog open={dialog.value} onClose={dialog.onFalse}>
 *         <DialogContent>...</DialogContent>
 *       </Dialog>
 *     </>
 *   );
 * }
 * ```
 *
 * @example
 * ```tsx
 * function Sidebar() {
 *   const { value: isCollapsed, onToggle } = useBoolean(false);
 *
 *   return (
 *     <nav style={{ width: isCollapsed ? 64 : 240 }}>
 *       <IconButton onClick={onToggle}>
 *         {isCollapsed ? <MenuIcon /> : <CloseIcon />}
 *       </IconButton>
 *     </nav>
 *   );
 * }
 * ```
 */
export function useBoolean(defaultValue = false): UseBooleanReturn {
  const [value, setValue] = useState(defaultValue);

  const onTrue = useCallback(() => {
    setValue(true);
  }, []);

  const onFalse = useCallback(() => {
    setValue(false);
  }, []);

  const onToggle = useCallback(() => {
    setValue((prev) => !prev);
  }, []);

  return useMemo(
    () => ({
      value,
      onTrue,
      onFalse,
      onToggle,
      setValue,
    }),
    [value, onTrue, onFalse, onToggle]
  );
}
