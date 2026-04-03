'use client';

/**
 * NavigationProgress
 *
 * NProgress-based top-of-page progress bar for route transitions.
 * Starts on internal anchor clicks and history changes, completes on pathname change.
 *
 * Framework-agnostic: accepts `pathname` as a prop (pass from your router).
 *
 * @module @omnitron-dev/prism/components/navigation-progress
 */

import NProgress from 'nprogress';
import { useRef, useEffect } from 'react';

// ---------------------------------------------------------------------------
// Styles (injected via <style> tag to avoid CSS import requirement)
// ---------------------------------------------------------------------------

const PRIMARY = 'var(--prism-palette-primary-main, var(--palette-primary-main, #1976d2))';

const STYLES = `
#nprogress {
  top: 0;
  left: 0;
  width: 100%;
  height: 2.5px;
  z-index: 9999;
  position: fixed;
  pointer-events: none;
}
#nprogress .bar {
  height: 100%;
  background-color: ${PRIMARY};
  box-shadow: 0 0 2.5px ${PRIMARY};
}
#nprogress .peg {
  right: 0;
  opacity: 1;
  width: 100px;
  height: 100%;
  display: block;
  position: absolute;
  transform: rotate(3deg) translate(0px, -4px);
  box-shadow:
    0 0 10px ${PRIMARY},
    0 0 5px ${PRIMARY};
}
`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NavigationProgressProps {
  /** Current route pathname. Triggers NProgress.done() on change. */
  pathname: string;
  /** Completion delay in ms (avoids flashing on fast transitions). Default: 100 */
  delay?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Check if an anchor should trigger the progress bar. */
function isValidAnchor(element: HTMLAnchorElement): boolean {
  const href = element.getAttribute('href')?.trim() ?? '';
  const target = element.getAttribute('target');
  return href.startsWith('/') && target !== '_blank';
}

/** Compare two URLs ignoring hash. */
function isSamePath(a: string, b: string): boolean {
  try {
    const urlA = new URL(a, window.location.origin);
    const urlB = new URL(b, window.location.origin);
    return urlA.pathname === urlB.pathname && urlA.search === urlB.search;
  } catch {
    return a === b;
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

function useProgressBar(pathname: string, delay: number) {
  const currentUrlRef = useRef('');

  // Initialize
  useEffect(() => {
    currentUrlRef.current = window.location.href;
  }, []);

  // Start on navigation
  useEffect(() => {
    const handleNavigation = (newUrl: string) => {
      if (newUrl && !isSamePath(newUrl, currentUrlRef.current)) {
        currentUrlRef.current = newUrl;
        NProgress.start();
      }
    };

    // Click delegation for anchor tags
    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const anchor = target.closest('a[href]') as HTMLAnchorElement | null;
      if (anchor && isValidAnchor(anchor)) {
        handleNavigation(anchor.href);
      }
    };

    // Browser back/forward
    const handlePopState = () => {
      handleNavigation(window.location.href);
    };

    // Patch history methods for programmatic navigation
    const patchHistory = (method: 'pushState' | 'replaceState') => {
      const original = window.history[method];
      window.history[method] = new Proxy(original, {
        apply: (target, thisArg, args: [data: unknown, unused: string, url?: string | URL | null]) => {
          const newUrl = args[2];
          if (typeof newUrl === 'string') {
            handleNavigation(new URL(newUrl, window.location.origin).href);
          }
          return target.apply(thisArg, args);
        },
      });
    };

    patchHistory('pushState');
    patchHistory('replaceState');

    document.addEventListener('click', handleClick);
    window.addEventListener('popstate', handlePopState);

    return () => {
      document.removeEventListener('click', handleClick);
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  // Done on pathname change
  useEffect(() => {
    const timeout = setTimeout(() => NProgress.done(), delay);
    return () => clearTimeout(timeout);
  }, [pathname, delay]);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * NavigationProgress - Top-of-page progress bar for route transitions.
 *
 * @example
 * ```tsx
 * import { useLocation } from 'react-router-dom';
 * import { NavigationProgress } from '@omnitron-dev/prism';
 *
 * function App() {
 *   const { pathname } = useLocation();
 *   return (
 *     <>
 *       <NavigationProgress pathname={pathname} />
 *       <Routes>...</Routes>
 *     </>
 *   );
 * }
 * ```
 */
export function NavigationProgress({ pathname, delay = 100 }: NavigationProgressProps) {
  useEffect(() => {
    NProgress.configure({ showSpinner: false });
    return () => {
      NProgress.done();
    };
  }, []);

  useProgressBar(pathname, delay);

  return <style>{STYLES}</style>;
}
