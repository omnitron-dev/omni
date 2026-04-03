'use client';

/**
 * useIsClient Hook
 *
 * Detects client-side rendering vs server-side rendering.
 * Returns false during SSR, true after hydration.
 *
 * @module @omnitron-dev/prism/core/hooks
 */

import { useState, useEffect } from 'react';

/**
 * Return type for useIsClient hook.
 */
export type UseIsClientReturn = boolean;

/**
 * Hook to detect client-side rendering.
 *
 * @returns {boolean} True if running on client, false during SSR
 *
 * @example
 * ```tsx
 * function ClientOnlyComponent() {
 *   const isClient = useIsClient();
 *
 *   if (!isClient) {
 *     return <Skeleton />;
 *   }
 *
 *   return <BrowserOnlyFeature />;
 * }
 * ```
 */
export function useIsClient(): UseIsClientReturn {
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  return isClient;
}
