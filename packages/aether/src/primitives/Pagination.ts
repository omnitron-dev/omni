/**
 * Pagination Component
 *
 * A pagination component for navigating through pages.
 *
 * @example
 * ```tsx
 * <Pagination
 *   currentPage={currentPage()}
 *   totalPages={10}
 *   onPageChange={(page) => currentPage.set(page)}
 * >
 *   <Pagination.Previous />
 *   <Pagination.Items />
 *   <Pagination.Next />
 * </Pagination>
 * ```
 */

import { jsx } from '../jsx-runtime.js';
import { defineComponent } from '../core/component/index.js';
import { createContext, useContext, provideContext } from '../core/component/context.js';
import { effect } from '../core/reactivity/effect.js';
import { createRef } from '../core/component/refs.js';

export interface PaginationProps {
  /**
   * Current active page (1-indexed)
   */
  currentPage: number;

  /**
   * Total number of pages
   */
  totalPages: number;

  /**
   * Number of page buttons to show on each side of current page
   */
  siblingCount?: number;

  /**
   * Always show first and last page
   */
  showFirstLast?: boolean;

  /**
   * Show previous/next buttons
   */
  showPrevNext?: boolean;

  /**
   * Page change handler
   */
  onPageChange?: (page: number) => void;

  /**
   * Children content
   */
  children?: any;

  /**
   * Additional HTML attributes
   */
  [key: string]: any;
}

export interface PaginationItemsProps {
  /**
   * Render function for page button
   */
  renderItem?: (page: number, isCurrent: boolean) => any;

  /**
   * Render function for ellipsis
   */
  renderEllipsis?: () => any;

  [key: string]: any;
}

export interface PaginationPreviousProps {
  /**
   * Children or label
   */
  children?: any;

  [key: string]: any;
}

export interface PaginationNextProps {
  /**
   * Children or label
   */
  children?: any;

  [key: string]: any;
}

export interface PaginationContextValue {
  currentPage: () => number;
  totalPages: () => number;
  siblingCount: () => number;
  showFirstLast: () => boolean;
  goToPage: (page: number) => void;
  canGoToPrevious: () => boolean;
  canGoToNext: () => boolean;
  getPageNumbers: () => (number | 'ellipsis')[];
}

const PaginationContext = createContext<PaginationContextValue>({
  currentPage: () => 1,
  totalPages: () => 1,
  siblingCount: () => 1,
  showFirstLast: () => true,
  goToPage: () => {},
  canGoToPrevious: () => false,
  canGoToNext: () => false,
  getPageNumbers: () => [1],
});

/**
 * Generate page numbers with ellipsis
 */
function generatePageNumbers(
  currentPage: number,
  totalPages: number,
  siblingCount: number,
  showFirstLast: boolean,
): (number | 'ellipsis')[] {
  // Total page numbers to show
  const totalNumbers = siblingCount * 2 + 3; // current + siblings on each side + first + last
  const totalBlocks = totalNumbers + 2; // + 2 ellipsis

  if (totalPages <= totalBlocks) {
    // Show all pages
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  const leftSiblingIndex = Math.max(currentPage - siblingCount, 1);
  const rightSiblingIndex = Math.min(currentPage + siblingCount, totalPages);

  const shouldShowLeftEllipsis = leftSiblingIndex > 2;
  const shouldShowRightEllipsis = rightSiblingIndex < totalPages - 1;

  if (!shouldShowLeftEllipsis && shouldShowRightEllipsis) {
    // Show left side pages
    const leftItemCount = 3 + 2 * siblingCount;
    const leftRange = Array.from({ length: leftItemCount }, (_, i) => i + 1);

    if (showFirstLast) {
      return [...leftRange, 'ellipsis', totalPages];
    }
    return [...leftRange, 'ellipsis'];
  }

  if (shouldShowLeftEllipsis && !shouldShowRightEllipsis) {
    // Show right side pages
    const rightItemCount = 3 + 2 * siblingCount;
    const rightRange = Array.from({ length: rightItemCount }, (_, i) => totalPages - rightItemCount + i + 1);

    if (showFirstLast) {
      return [1, 'ellipsis', ...rightRange];
    }
    return ['ellipsis', ...rightRange];
  }

  // Show both ellipsis
  const middleRange = Array.from(
    { length: rightSiblingIndex - leftSiblingIndex + 1 },
    (_, i) => leftSiblingIndex + i,
  );

  if (showFirstLast) {
    return [1, 'ellipsis', ...middleRange, 'ellipsis', totalPages];
  }
  return ['ellipsis', ...middleRange, 'ellipsis'];
}

/**
 * Pagination Root
 */
export const Pagination = defineComponent<PaginationProps>((props) => {
  const currentPage = () => props.currentPage;
  const totalPages = () => props.totalPages;
  const siblingCount = () => props.siblingCount ?? 1;
  const showFirstLast = () => props.showFirstLast ?? true;

  const canGoToPrevious = () => currentPage() > 1;
  const canGoToNext = () => currentPage() < totalPages();

  const goToPage = (page: number) => {
    if (page < 1 || page > totalPages()) return;
    if (page === currentPage()) return;
    props.onPageChange?.(page);
  };

  const getPageNumbers = () => generatePageNumbers(currentPage(), totalPages(), siblingCount(), showFirstLast());

  const contextValue: PaginationContextValue = {
    currentPage,
    totalPages,
    siblingCount,
    showFirstLast,
    goToPage,
    canGoToPrevious,
    canGoToNext,
    getPageNumbers,
  };

  // Provide context before return
  provideContext(PaginationContext, contextValue);

  // Create ref to nav element and set up reactive updates
  const navRef = createRef<HTMLElement>();

  const refCallback = (element: HTMLElement | null) => {
    navRef.current = element || undefined;
    if (!element) return;

    // Set up effect to update DOM attributes when signals change
    effect(() => {
      element.setAttribute('data-current-page', String(currentPage()));
    });
  };

  return () => {
    const { children, onPageChange, ...restProps } = props;
    const resolvedChildren = typeof children === 'function' ? children() : children;

    return jsx('nav', {
      ...restProps,
      ref: refCallback,
      'data-pagination': '',
      'data-current-page': String(currentPage()),
      'aria-label': 'Pagination',
      role: 'navigation',
      children: resolvedChildren,
    });
  };
});

/**
 * Pagination Items
 *
 * Renders page number buttons with ellipsis.
 */
export const PaginationItems = defineComponent<PaginationItemsProps>((props) => {
  return () => {
    // Get context at render time, after Provider is set up
    const ctx = useContext(PaginationContext);

    const pageNumbers = ctx.getPageNumbers();
    const currentPage = ctx.currentPage();

    const renderItem = props.renderItem;
    const renderEllipsis = props.renderEllipsis;

    const items: any[] = [];

    for (const page of pageNumbers) {
      if (page === 'ellipsis') {
        if (renderEllipsis) {
          items.push(renderEllipsis());
        } else {
          items.push(
            jsx('span', {
              'data-pagination-ellipsis': '',
              'aria-hidden': 'true',
              children: '...',
            })
          );
        }
      } else {
        const isCurrent = page === currentPage;

        if (renderItem) {
          items.push(renderItem(page, isCurrent));
        } else {
          const buttonRef = createRef<HTMLButtonElement>();

          const buttonRefCallback = (element: HTMLButtonElement | null) => {
            buttonRef.current = element || undefined;
            if (!element) return;

            // Set up effect to update button attributes when current page changes
            effect(() => {
              const isCurrentPage = ctx.currentPage() === page;
              element.setAttribute('data-state', isCurrentPage ? 'active' : 'inactive');
              if (isCurrentPage) {
                element.setAttribute('data-current', '');
                element.setAttribute('aria-current', 'page');
                element.disabled = true;
              } else {
                element.removeAttribute('data-current');
                element.removeAttribute('aria-current');
                element.disabled = false;
              }
            });
          };

          items.push(
            jsx('button', {
              ref: buttonRefCallback,
              'data-pagination-item': '',
              'data-current': isCurrent ? '' : undefined,
              'data-state': isCurrent ? 'active' : 'inactive',
              'aria-current': isCurrent ? 'page' : undefined,
              'aria-label': `Page ${page}`,
              onClick: () => ctx.goToPage(page),
              disabled: isCurrent,
              children: page,
            })
          );
        }
      }
    }

    const { ...restProps } = props;

    return jsx('div', {
      ...restProps,
      'data-pagination-items': '',
      children: items,
    });
  };
});

/**
 * Pagination Previous
 *
 * Previous page button.
 */
export const PaginationPrevious = defineComponent<PaginationPreviousProps>((props) => {
  // Create ref to button element and set up reactive updates
  const buttonRef = createRef<HTMLButtonElement>();

  return () => {
    // Get context at render time
    const ctx = useContext(PaginationContext);

    const handleClick = () => {
      ctx.goToPage(ctx.currentPage() - 1);
    };

    const refCallback = (element: HTMLButtonElement | null) => {
      buttonRef.current = element || undefined;
      if (!element) return;

      // Set up effect to update disabled state when current page changes
      effect(() => {
        const canGoPrevious = ctx.canGoToPrevious();
        if (canGoPrevious) {
          element.removeAttribute('disabled');
          element.disabled = false;
        } else {
          element.setAttribute('disabled', '');
          element.disabled = true;
        }
      });
    };

    const { children = 'Previous', ...restProps } = props;
    const canGoPrevious = ctx.canGoToPrevious();

    return jsx('button', {
      ...restProps,
      ref: refCallback,
      'data-pagination-previous': '',
      'aria-label': 'Go to previous page',
      onClick: handleClick,
      disabled: !canGoPrevious,
      children,
    });
  };
});

/**
 * Pagination Next
 *
 * Next page button.
 */
export const PaginationNext = defineComponent<PaginationNextProps>((props) => {
  // Create ref to button element and set up reactive updates
  const buttonRef = createRef<HTMLButtonElement>();

  return () => {
    // Get context at render time
    const ctx = useContext(PaginationContext);

    const handleClick = () => {
      ctx.goToPage(ctx.currentPage() + 1);
    };

    const refCallback = (element: HTMLButtonElement | null) => {
      buttonRef.current = element || undefined;
      if (!element) return;

      // Set up effect to update disabled state when current page changes
      effect(() => {
        const canGoNext = ctx.canGoToNext();
        if (canGoNext) {
          element.removeAttribute('disabled');
          element.disabled = false;
        } else {
          element.setAttribute('disabled', '');
          element.disabled = true;
        }
      });
    };

    const { children = 'Next', ...restProps } = props;
    const canGoNext = ctx.canGoToNext();

    return jsx('button', {
      ...restProps,
      ref: refCallback,
      'data-pagination-next': '',
      'aria-label': 'Go to next page',
      onClick: handleClick,
      disabled: !canGoNext,
      children,
    });
  };
});

// Attach sub-components
(Pagination as any).Items = PaginationItems;
(Pagination as any).Previous = PaginationPrevious;
(Pagination as any).Next = PaginationNext;

// Display names
Pagination.displayName = 'Pagination';
PaginationItems.displayName = 'Pagination.Items';
PaginationPrevious.displayName = 'Pagination.Previous';
PaginationNext.displayName = 'Pagination.Next';
