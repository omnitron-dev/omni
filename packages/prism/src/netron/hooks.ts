'use client';

/**
 * Netron React Hooks — Prism re-exports
 *
 * All data-fetching hooks from @omnitron-dev/netron-react.
 * Prism consumers import from `@omnitron-dev/prism/netron`.
 *
 * @module @omnitron-dev/prism/netron
 */

export {
  // Data fetching
  useQuery as useNetronQuery,
  useMutation as useNetronMutation,
  useSubscription as useNetronSubscription,

  // Service proxy
  useService as useNetronService,
  createServiceHook as createNetronServiceHook,
} from '@omnitron-dev/netron-react';
