'use client';

/**
 * useFocusTrap Hook
 *
 * Traps focus within a container element for accessibility.
 * Essential for modals, dialogs, and dropdown menus.
 *
 * @module @omnitron-dev/prism/hooks
 */

import { useCallback, useEffect, useRef } from 'react';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Options for useFocusTrap hook.
 */
export interface UseFocusTrapOptions {
  /**
   * Whether the focus trap is active.
   * @default true
   */
  enabled?: boolean;
  /**
   * Whether to auto-focus the first focusable element when enabled.
   * @default true
   */
  autoFocus?: boolean;
  /**
   * Whether to restore focus to the previously focused element when disabled.
   * @default true
   */
  restoreFocus?: boolean;
  /**
   * Selector for focusable elements.
   * @default FOCUSABLE_SELECTOR
   */
  focusableSelector?: string;
}

/**
 * Return type for useFocusTrap hook.
 */
export interface UseFocusTrapReturn<T extends HTMLElement = HTMLElement> {
  /**
   * Ref to attach to the container element.
   */
  ref: React.RefCallback<T>;
  /**
   * Focus the first focusable element.
   */
  focusFirst: () => void;
  /**
   * Focus the last focusable element.
   */
  focusLast: () => void;
}

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * Default selector for focusable elements.
 */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',');

// =============================================================================
// HOOK
// =============================================================================

/**
 * Trap focus within a container element.
 *
 * @param options - Hook options
 * @returns Ref and focus control functions
 *
 * @example
 * ```tsx
 * function Modal({ open, onClose, children }) {
 *   const { ref } = useFocusTrap({ enabled: open });
 *
 *   if (!open) return null;
 *
 *   return (
 *     <div ref={ref} role="dialog" aria-modal="true">
 *       {children}
 *       <button onClick={onClose}>Close</button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useFocusTrap<T extends HTMLElement = HTMLElement>(
  options: UseFocusTrapOptions = {}
): UseFocusTrapReturn<T> {
  const { enabled = true, autoFocus = true, restoreFocus = true, focusableSelector = FOCUSABLE_SELECTOR } = options;

  const containerRef = useRef<T | null>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  // Get all focusable elements within the container
  const getFocusableElements = useCallback(() => {
    if (!containerRef.current) return [];
    return Array.from(containerRef.current.querySelectorAll<HTMLElement>(focusableSelector)).filter(
      (el) => el.offsetParent !== null
    ); // Filter out hidden elements
  }, [focusableSelector]);

  // Focus the first focusable element
  const focusFirst = useCallback(() => {
    const elements = getFocusableElements();
    if (elements.length > 0) {
      elements[0].focus();
    }
  }, [getFocusableElements]);

  // Focus the last focusable element
  const focusLast = useCallback(() => {
    const elements = getFocusableElements();
    if (elements.length > 0) {
      elements[elements.length - 1].focus();
    }
  }, [getFocusableElements]);

  // Handle keydown for tab trapping
  useEffect(() => {
    if (!enabled || !containerRef.current) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;

      const elements = getFocusableElements();
      if (elements.length === 0) return;

      const firstElement = elements[0];
      const lastElement = elements[elements.length - 1];
      const activeElement = document.activeElement;

      // Shift + Tab on first element -> go to last
      if (event.shiftKey && activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
        return;
      }

      // Tab on last element -> go to first
      if (!event.shiftKey && activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    const container = containerRef.current;
    container.addEventListener('keydown', handleKeyDown);

    return () => {
      container.removeEventListener('keydown', handleKeyDown);
    };
  }, [enabled, getFocusableElements]);

  // Auto-focus and restore focus
  useEffect(() => {
    if (enabled) {
      // Store the previously focused element
      if (restoreFocus) {
        previousActiveElement.current = document.activeElement as HTMLElement;
      }

      // Auto-focus the first element
      if (autoFocus) {
        // Use setTimeout to ensure the container is rendered
        const timeoutId = setTimeout(focusFirst, 0);
        return () => clearTimeout(timeoutId);
      }
    } else if (restoreFocus && previousActiveElement.current) {
      // Restore focus when disabled
      previousActiveElement.current.focus();
      previousActiveElement.current = null;
    }

    return undefined;
  }, [enabled, autoFocus, restoreFocus, focusFirst]);

  // Callback ref for the container
  const ref = useCallback((node: T | null) => {
    containerRef.current = node;
  }, []);

  return { ref, focusFirst, focusLast };
}
