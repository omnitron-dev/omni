'use client';

/**
 * Navigation Context
 *
 * Context for managing navigation state (pathname, router).
 *
 * @module @omnitron/prism/components/nav-section
 */

import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Router functions for navigation.
 */
export interface NavRouter {
  /** Navigate to a path */
  push: (path: string) => void;
  /** Replace current path */
  replace?: (path: string) => void;
}

/**
 * Navigation context value.
 */
export interface NavContextValue {
  /** Current pathname */
  pathname: string;
  /** Optional router */
  router?: NavRouter;
}

/**
 * Props for NavProvider.
 */
export interface NavProviderProps {
  /** Current pathname */
  pathname: string;
  /** Optional router */
  router?: NavRouter;
  children: ReactNode;
}

// =============================================================================
// CONTEXT
// =============================================================================

const NavContext = createContext<NavContextValue | undefined>(undefined);

/**
 * NavProvider - Provides navigation context to nav components.
 *
 * @example
 * ```tsx
 * // With Next.js
 * import { usePathname, useRouter } from 'next/navigation';
 *
 * function App() {
 *   const pathname = usePathname();
 *   const router = useRouter();
 *
 *   return (
 *     <NavProvider pathname={pathname} router={router}>
 *       <NavSection data={navConfig} />
 *     </NavProvider>
 *   );
 * }
 *
 * // With React Router
 * import { useLocation, useNavigate } from 'react-router-dom';
 *
 * function App() {
 *   const { pathname } = useLocation();
 *   const navigate = useNavigate();
 *
 *   return (
 *     <NavProvider pathname={pathname} router={{ push: navigate }}>
 *       <NavSection data={navConfig} />
 *     </NavProvider>
 *   );
 * }
 * ```
 */
export function NavProvider({ pathname, router, children }: NavProviderProps): ReactNode {
  const value = useMemo(() => ({ pathname, router }), [pathname, router]);

  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

/**
 * useNav - Hook to access navigation context.
 */
export function useNav(): NavContextValue {
  const context = useContext(NavContext);
  if (context === undefined) {
    throw new Error('useNav must be used within a NavProvider');
  }
  return context;
}

/**
 * useNavPathname - Hook to get current pathname with fallback.
 *
 * Returns pathname from context if available, otherwise returns '/'.
 * This allows components to work without NavProvider for simpler use cases.
 */
export function useNavPathname(): string {
  const context = useContext(NavContext);
  return context?.pathname ?? '/';
}

/**
 * useNavRouter - Hook to get router from context.
 */
export function useNavRouter(): NavRouter | undefined {
  const context = useContext(NavContext);
  return context?.router;
}
