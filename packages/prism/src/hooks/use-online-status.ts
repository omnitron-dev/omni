'use client';

/**
 * useOnlineStatus Hook
 *
 * Tracks browser online/offline status with event listeners.
 *
 * @module @omnitron/prism/hooks/use-online-status
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

// =============================================================================
// TYPES
// =============================================================================

export interface UseOnlineStatusReturn {
  /** Whether the browser is online */
  isOnline: boolean;
  /** Whether the browser is offline */
  isOffline: boolean;
  /** Time when status last changed (timestamp) */
  lastChanged: number | null;
}

// =============================================================================
// EXTERNAL STORE (for SSR safety)
// =============================================================================

function subscribe(callback: () => void): () => void {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

function getSnapshot(): boolean {
  return navigator.onLine;
}

function getServerSnapshot(): boolean {
  // Assume online during SSR
  return true;
}

// =============================================================================
// HOOK
// =============================================================================

/**
 * useOnlineStatus - Track browser online/offline status.
 *
 * Uses navigator.onLine and online/offline events to track network status.
 * SSR-safe with server-side assumption of online status.
 *
 * @example
 * ```tsx
 * function ConnectionIndicator() {
 *   const { isOnline, isOffline } = useOnlineStatus();
 *
 *   if (isOffline) {
 *     return (
 *       <Alert severity="warning">
 *         You are offline. Changes will sync when you reconnect.
 *       </Alert>
 *     );
 *   }
 *
 *   return null;
 * }
 * ```
 *
 * @example
 * ```tsx
 * // With timestamp tracking
 * function NetworkStatus() {
 *   const { isOnline, lastChanged } = useOnlineStatus();
 *
 *   return (
 *     <Box>
 *       <Typography>
 *         Status: {isOnline ? 'Online' : 'Offline'}
 *       </Typography>
 *       {lastChanged && (
 *         <Typography variant="caption">
 *           Last changed: {new Date(lastChanged).toLocaleTimeString()}
 *         </Typography>
 *       )}
 *     </Box>
 *   );
 * }
 * ```
 *
 * @returns Online status and metadata
 */
export function useOnlineStatus(): UseOnlineStatusReturn {
  const isOnline = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [lastChanged, setLastChanged] = useState<number | null>(null);

  const handleStatusChange = useCallback(() => {
    setLastChanged(Date.now());
  }, []);

  useEffect(() => {
    window.addEventListener('online', handleStatusChange);
    window.addEventListener('offline', handleStatusChange);
    return () => {
      window.removeEventListener('online', handleStatusChange);
      window.removeEventListener('offline', handleStatusChange);
    };
  }, [handleStatusChange]);

  return {
    isOnline,
    isOffline: !isOnline,
    lastChanged,
  };
}
