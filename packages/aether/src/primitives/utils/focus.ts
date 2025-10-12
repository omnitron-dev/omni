/**
 * Focus Management Utilities
 *
 * Utilities for managing focus in accessible components
 */

/**
 * Get all focusable elements within a container
 *
 * @param container - Container element to search within
 * @returns Array of focusable elements
 */
export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const selector = [
    'a[href]',
    'button:not([disabled])',
    'textarea:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');

  return Array.from(container.querySelectorAll<HTMLElement>(selector)).filter(
    (el) => !el.hasAttribute('disabled') && !el.getAttribute('aria-hidden') && el.getAttribute('tabindex') !== '-1'
  );
}

/**
 * Get first and last focusable elements
 *
 * @param container - Container element
 * @returns Object with first and last focusable elements
 */
export function getFocusableBounds(container: HTMLElement): {
  first: HTMLElement | null;
  last: HTMLElement | null;
} {
  const elements = getFocusableElements(container);
  return {
    first: elements[0] || null,
    last: elements[elements.length - 1] || null,
  };
}

/**
 * Focus first focusable element in container
 *
 * @param container - Container element
 * @returns True if focus was successful
 */
export function focusFirst(container: HTMLElement): boolean {
  const { first } = getFocusableBounds(container);
  if (first) {
    first.focus();
    return true;
  }
  return false;
}

/**
 * Save current focused element
 *
 * @returns Currently focused element or null
 */
export function saveFocus(): HTMLElement | null {
  return document.activeElement as HTMLElement | null;
}

/**
 * Restore focus to previously saved element
 *
 * @param element - Element to restore focus to
 */
export function restoreFocus(element: HTMLElement | null): void {
  if (element && element.focus) {
    element.focus();
  }
}

/**
 * Trap focus within container
 *
 * Returns cleanup function to remove trap
 *
 * @param container - Container to trap focus within
 * @returns Cleanup function
 */
export function trapFocus(container: HTMLElement): () => void {
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Tab') return;

    const { first, last } = getFocusableBounds(container);
    if (!first || !last) return;

    // Shift + Tab (backwards)
    if (event.shiftKey) {
      if (document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    }
    // Tab (forwards)
    else {
      if (document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  container.addEventListener('keydown', handleKeyDown);

  // Focus first element on mount
  focusFirst(container);

  // Return cleanup function
  return () => {
    container.removeEventListener('keydown', handleKeyDown);
  };
}
