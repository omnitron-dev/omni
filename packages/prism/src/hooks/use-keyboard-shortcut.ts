'use client';

/**
 * useKeyboardShortcut Hook
 *
 * Handle keyboard shortcuts with modifier key support.
 *
 * @module @omnitron/prism/hooks/use-keyboard-shortcut
 */

import { useCallback, useEffect, useRef } from 'react';

// =============================================================================
// TYPES
// =============================================================================

export interface KeyboardShortcut {
  /** Main key (e.g., 'k', 'Enter', 'Escape') */
  key: string;
  /** Require Ctrl/Cmd key */
  ctrl?: boolean;
  /** Require Shift key */
  shift?: boolean;
  /** Require Alt key */
  alt?: boolean;
  /** Require Meta key (Cmd on Mac) */
  meta?: boolean;
}

export interface UseKeyboardShortcutOptions {
  /** Whether the shortcut is enabled (default: true) */
  enabled?: boolean;
  /** Prevent default browser behavior (default: true) */
  preventDefault?: boolean;
  /** Stop event propagation (default: false) */
  stopPropagation?: boolean;
  /** Target element (default: document) */
  target?: EventTarget | null;
  /** Event type (default: 'keydown') */
  event?: 'keydown' | 'keyup' | 'keypress';
  /** Ignore when focus is in input/textarea/contenteditable (default: false) */
  ignoreInputs?: boolean;
}

// =============================================================================
// HELPERS
// =============================================================================

function isInputElement(element: EventTarget | null): boolean {
  if (!element || !(element instanceof HTMLElement)) {
    return false;
  }

  const tagName = element.tagName.toLowerCase();
  if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
    return true;
  }

  return element.isContentEditable;
}

function matchesShortcut(event: KeyboardEvent, shortcut: KeyboardShortcut): boolean {
  // Normalize key comparison (case-insensitive for letters)
  const eventKey = event.key.toLowerCase();
  const shortcutKey = shortcut.key.toLowerCase();

  if (eventKey !== shortcutKey) {
    return false;
  }

  // Check modifier keys
  const ctrlOrMeta = event.ctrlKey || event.metaKey;

  if (shortcut.ctrl && !ctrlOrMeta) return false;
  if (shortcut.meta && !event.metaKey) return false;
  if (shortcut.shift && !event.shiftKey) return false;
  if (shortcut.alt && !event.altKey) return false;

  // Ensure no extra modifiers unless specified
  if (!shortcut.ctrl && !shortcut.meta && ctrlOrMeta) return false;
  if (!shortcut.shift && event.shiftKey) return false;
  if (!shortcut.alt && event.altKey) return false;

  return true;
}

// =============================================================================
// HOOK
// =============================================================================

/**
 * useKeyboardShortcut - Handle keyboard shortcuts.
 *
 * Listens for keyboard events matching the specified shortcut
 * and invokes the callback when matched.
 *
 * @example
 * ```tsx
 * // Simple shortcut
 * function SearchDialog() {
 *   const [open, setOpen] = useState(false);
 *
 *   useKeyboardShortcut({ key: 'k', ctrl: true }, () => {
 *     setOpen(true);
 *   });
 *
 *   return <Dialog open={open} onClose={() => setOpen(false)} />;
 * }
 * ```
 *
 * @example
 * ```tsx
 * // Save with Ctrl+S
 * function Editor({ onSave }) {
 *   useKeyboardShortcut(
 *     { key: 's', ctrl: true },
 *     () => onSave(),
 *     { preventDefault: true }
 *   );
 *
 *   return <TextField multiline />;
 * }
 * ```
 *
 * @example
 * ```tsx
 * // Escape to close
 * function Modal({ onClose }) {
 *   useKeyboardShortcut({ key: 'Escape' }, onClose);
 *
 *   return <div>Modal content</div>;
 * }
 * ```
 *
 * @example
 * ```tsx
 * // Multiple shortcuts
 * function App() {
 *   useKeyboardShortcut({ key: 'k', ctrl: true }, openSearch);
 *   useKeyboardShortcut({ key: 'n', ctrl: true }, createNew);
 *   useKeyboardShortcut({ key: '/', ctrl: true }, toggleHelp);
 *
 *   return <div>...</div>;
 * }
 * ```
 *
 * @param shortcut - Keyboard shortcut definition
 * @param callback - Function to call when shortcut is triggered
 * @param options - Hook options
 */
export function useKeyboardShortcut(
  shortcut: KeyboardShortcut,
  callback: (event: KeyboardEvent) => void,
  options: UseKeyboardShortcutOptions = {}
): void {
  const {
    enabled = true,
    preventDefault = true,
    stopPropagation = false,
    target = typeof document !== 'undefined' ? document : null,
    event = 'keydown',
    ignoreInputs = false,
  } = options;

  const callbackRef = useRef(callback);

  // Update callback ref
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  const handleKeyEvent = useCallback(
    (e: Event) => {
      if (!enabled) return;

      const keyEvent = e as KeyboardEvent;

      // Ignore if focused on input element
      if (ignoreInputs && isInputElement(keyEvent.target)) {
        return;
      }

      if (matchesShortcut(keyEvent, shortcut)) {
        if (preventDefault) {
          keyEvent.preventDefault();
        }
        if (stopPropagation) {
          keyEvent.stopPropagation();
        }
        callbackRef.current(keyEvent);
      }
    },
    [enabled, shortcut, preventDefault, stopPropagation, ignoreInputs]
  );

  useEffect(() => {
    if (!target || !enabled) return undefined;

    target.addEventListener(event, handleKeyEvent);
    return () => {
      target.removeEventListener(event, handleKeyEvent);
    };
  }, [target, event, handleKeyEvent, enabled]);
}

// =============================================================================
// UTILITY HOOKS
// =============================================================================

/**
 * useEscapeKey - Convenience hook for Escape key handling.
 *
 * @example
 * ```tsx
 * function Modal({ onClose }) {
 *   useEscapeKey(onClose);
 *   return <div>Modal content</div>;
 * }
 * ```
 */
export function useEscapeKey(
  callback: (event: KeyboardEvent) => void,
  options: Omit<UseKeyboardShortcutOptions, 'ignoreInputs'> = {}
): void {
  useKeyboardShortcut({ key: 'Escape' }, callback, {
    ...options,
    ignoreInputs: false, // Escape should work even in inputs
  });
}

/**
 * useEnterKey - Convenience hook for Enter key handling.
 *
 * @example
 * ```tsx
 * function SearchField({ onSearch }) {
 *   useEnterKey(onSearch, { ignoreInputs: false });
 *   return <TextField />;
 * }
 * ```
 */
export function useEnterKey(callback: (event: KeyboardEvent) => void, options: UseKeyboardShortcutOptions = {}): void {
  useKeyboardShortcut({ key: 'Enter' }, callback, options);
}
