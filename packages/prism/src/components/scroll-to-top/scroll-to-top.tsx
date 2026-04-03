'use client';

/**
 * ScrollToTop
 *
 * Scrolls the window to the top on pathname change.
 * Framework-agnostic: accepts `pathname` as a prop.
 *
 * @module @omnitron/prism/components/scroll-to-top
 */

import { useEffect } from 'react';

export interface ScrollToTopProps {
  /** Current route pathname. Scrolls to top on change. */
  pathname: string;
}

/**
 * ScrollToTop - Restores scroll position to top on route change.
 *
 * @example
 * ```tsx
 * import { useLocation } from 'react-router-dom';
 * import { ScrollToTop } from '@omnitron/prism';
 *
 * function App() {
 *   const { pathname } = useLocation();
 *   return (
 *     <>
 *       <ScrollToTop pathname={pathname} />
 *       <Routes>...</Routes>
 *     </>
 *   );
 * }
 * ```
 */
export function ScrollToTop({ pathname }: ScrollToTopProps) {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}
