/**
 * Accessibility Utilities
 *
 * WCAG 2.1 compliant accessibility components and utilities.
 *
 * @module @omnitron-dev/prism/core/accessibility
 */

export { SkipLink } from './skip-link.js';
export type { SkipLinkProps } from './skip-link.js';

// =============================================================================
// ARIA HELPERS
// =============================================================================

/**
 * Generate ID for accessibility references.
 */
export function generateAriaId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Combine multiple aria-describedby values.
 */
export function combineAriaDescribedBy(...ids: (string | undefined)[]): string | undefined {
  const validIds = ids.filter(Boolean);
  return validIds.length > 0 ? validIds.join(' ') : undefined;
}

/**
 * Screen reader only styles (visually hidden but accessible).
 */
export const srOnly = {
  position: 'absolute' as const,
  width: '1px',
  height: '1px',
  padding: 0,
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap' as const,
  border: 0,
};

/**
 * Focus visible styles for keyboard navigation.
 */
export const focusVisibleStyles = (theme: { palette: { primary: { main: string } } }) => ({
  '&:focus-visible': {
    outline: `2px solid ${theme.palette.primary.main}`,
    outlineOffset: 2,
  },
});

// =============================================================================
// KEYBOARD NAVIGATION HELPERS
// =============================================================================

/**
 * Handle keyboard navigation for list items.
 */
export function handleListKeyDown(
  event: React.KeyboardEvent,
  options: {
    items: HTMLElement[];
    currentIndex: number;
    onSelect?: (index: number) => void;
    orientation?: 'vertical' | 'horizontal';
  }
): void {
  const { items, currentIndex, onSelect, orientation = 'vertical' } = options;

  const nextKey = orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight';
  const prevKey = orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft';

  let newIndex: number;

  switch (event.key) {
    case nextKey:
      event.preventDefault();
      newIndex = Math.min(currentIndex + 1, items.length - 1);
      break;
    case prevKey:
      event.preventDefault();
      newIndex = Math.max(currentIndex - 1, 0);
      break;
    case 'Home':
      event.preventDefault();
      newIndex = 0;
      break;
    case 'End':
      event.preventDefault();
      newIndex = items.length - 1;
      break;
    case 'Enter':
    case ' ':
      event.preventDefault();
      onSelect?.(currentIndex);
      return;
    default:
      return;
  }

  if (newIndex !== currentIndex && items[newIndex]) {
    items[newIndex].focus();
  }
}

// =============================================================================
// LANDMARK ROLES
// =============================================================================

/**
 * Standard ARIA landmark labels.
 */
export const ARIA_LABELS = {
  /** Main navigation */
  mainNav: 'Main navigation',
  /** Secondary navigation */
  secondaryNav: 'Secondary navigation',
  /** Search */
  search: 'Search',
  /** Main content */
  main: 'Main content',
  /** Header */
  header: 'Header',
  /** Footer */
  footer: 'Footer',
  /** Sidebar */
  sidebar: 'Sidebar',
  /** Breadcrumb navigation */
  breadcrumb: 'Breadcrumb navigation',
  /** User menu */
  userMenu: 'User menu',
  /** Settings */
  settings: 'Settings',
} as const;

/**
 * Common ARIA expanded patterns.
 */
export interface AriaExpandedProps {
  'aria-expanded': boolean;
  'aria-controls'?: string;
}

/**
 * Get aria-expanded props.
 */
export function getAriaExpanded(expanded: boolean, controlsId?: string): AriaExpandedProps {
  return {
    'aria-expanded': expanded,
    ...(controlsId && { 'aria-controls': controlsId }),
  };
}

// =============================================================================
// LIVE REGION HELPERS
// =============================================================================

/**
 * Announce message to screen readers.
 */
export function announceToScreenReader(message: string, priority: 'polite' | 'assertive' = 'polite'): void {
  const announcement = document.createElement('div');
  announcement.setAttribute('role', 'status');
  announcement.setAttribute('aria-live', priority);
  announcement.setAttribute('aria-atomic', 'true');
  Object.assign(announcement.style, srOnly);
  announcement.textContent = message;

  document.body.appendChild(announcement);

  // Remove after announcement is read
  setTimeout(() => {
    document.body.removeChild(announcement);
  }, 1000);
}
