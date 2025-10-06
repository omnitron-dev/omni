/**
 * Scroll Lock Utilities
 *
 * Prevent body scroll when modals/overlays are open
 */

let lockCount = 0;
let originalOverflow = '';
let originalPaddingRight = '';

/**
 * Disable body scroll
 *
 * Prevents scrolling on document body. Safe to call multiple times
 * (uses reference counting for nested modals)
 */
export function disableBodyScroll(): void {
  if (lockCount === 0) {
    // Calculate scrollbar width to prevent layout shift
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

    // Save original styles
    originalOverflow = document.body.style.overflow;
    originalPaddingRight = document.body.style.paddingRight;

    // Apply scroll lock
    document.body.style.overflow = 'hidden';

    // Compensate for scrollbar width
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }
  }

  lockCount++;
}

/**
 * Enable body scroll
 *
 * Restores scrolling on document body. Safe to call multiple times
 * (uses reference counting for nested modals)
 */
export function enableBodyScroll(): void {
  lockCount = Math.max(0, lockCount - 1);

  if (lockCount === 0) {
    // Restore original styles
    document.body.style.overflow = originalOverflow;
    document.body.style.paddingRight = originalPaddingRight;
  }
}

/**
 * Check if body scroll is locked
 *
 * @returns True if body scroll is locked
 */
export function isBodyScrollLocked(): boolean {
  return lockCount > 0;
}

/**
 * Force unlock body scroll
 *
 * Immediately unlocks body scroll regardless of lock count.
 * Use with caution - may cause issues with nested modals.
 */
export function forceUnlockBodyScroll(): void {
  lockCount = 0;
  document.body.style.overflow = originalOverflow;
  document.body.style.paddingRight = originalPaddingRight;
}
