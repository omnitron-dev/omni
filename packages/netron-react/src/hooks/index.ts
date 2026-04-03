/**
 * Hooks module exports
 */

// Core hooks
export { useQuery, default as useQueryDefault } from './useQuery.js';
export { useQueries, default as useQueriesDefault } from './useQueries.js';
export { useMutation, default as useMutationDefault } from './useMutation.js';
export { useSubscription, default as useSubscriptionDefault } from './useSubscription.js';
export { useInfiniteQuery, default as useInfiniteQueryDefault } from './useInfiniteQuery.js';

// Service hook
export { useService, createServiceHook, default as useServiceDefault } from './useService.js';

// Re-export context hooks for convenience
export {
  useNetronClient,
  useNetronClientSafe,
  useNetronConnection,
  useDefaults,
  useHydration,
} from '../core/context.js';

// Types
export type {
  QueryOptions,
  QueryResult,
  QueryKey,
  QueryStatus,
  QueryFunctionContext,
  MutationOptions,
  MutationResult,
  MutationStatus,
  SubscriptionOptions,
  SubscriptionResult,
  StreamOptions,
  StreamResult,
  InfiniteQueryOptions,
  InfiniteQueryResult,
} from '../core/types.js';

// useQueries types
export type { QueryObserverResult, QueriesOptions, UseQueriesOptions } from './useQueries.js';

// useInfiniteQuery types
export type {
  InfiniteQueryFunctionContext,
  InfiniteQueryOptions as UseInfiniteQueryOptions,
  InfiniteData,
  InfiniteQueryResult as UseInfiniteQueryResult,
} from './useInfiniteQuery.js';
