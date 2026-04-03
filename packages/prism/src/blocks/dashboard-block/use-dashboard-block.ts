/**
 * Dashboard Block Hook
 *
 * Hook for managing dashboard block state and behavior.
 *
 * @module @omnitron/prism/blocks/dashboard-block/use-dashboard-block
 */

'use client';

import { useState, useCallback, useMemo } from 'react';
import type { DashboardBlockProps } from './types.js';

/**
 * Dashboard block state.
 */
export interface DashboardBlockState {
  /** Current collapsed state */
  collapsed: boolean;
  /** Current loading state */
  loading: boolean;
  /** Current error state */
  error: boolean;
  /** Error message */
  errorMessage?: string;
}

/**
 * Dashboard block actions.
 */
export interface DashboardBlockActions {
  /** Toggle collapse state */
  toggleCollapse: () => void;
  /** Set collapsed state */
  setCollapsed: (collapsed: boolean) => void;
  /** Expand block */
  expand: () => void;
  /** Collapse block */
  collapse: () => void;
  /** Set loading state */
  setLoading: (loading: boolean) => void;
  /** Set error state */
  setError: (error: boolean, message?: string) => void;
  /** Clear error state */
  clearError: () => void;
  /** Reset to initial state */
  reset: () => void;
}

/**
 * Dashboard block hook return value.
 */
export interface UseDashboardBlockReturn {
  /** Current state */
  state: DashboardBlockState;
  /** Actions to modify state */
  actions: DashboardBlockActions;
  /** Props to spread on DashboardBlock */
  blockProps: Pick<DashboardBlockProps, 'collapsed' | 'onCollapseChange' | 'loading' | 'error' | 'errorConfig'>;
}

/**
 * Options for useDashboardBlock hook.
 */
export interface UseDashboardBlockOptions {
  /** Initial collapsed state */
  defaultCollapsed?: boolean;
  /** Initial loading state */
  defaultLoading?: boolean;
  /** Retry callback for error state */
  onRetry?: () => void;
}

/**
 * Hook for managing dashboard block state.
 *
 * Provides controlled state management for DashboardBlock component,
 * including collapse, loading, and error states.
 *
 * @example
 * ```tsx
 * function MyWidget() {
 *   const { state, actions, blockProps } = useDashboardBlock({
 *     defaultCollapsed: false,
 *     onRetry: () => fetchData(),
 *   });
 *
 *   useEffect(() => {
 *     actions.setLoading(true);
 *     fetchData()
 *       .then(() => actions.setLoading(false))
 *       .catch((err) => actions.setError(true, err.message));
 *   }, []);
 *
 *   return (
 *     <DashboardBlock title="My Widget" {...blockProps}>
 *       <Content />
 *     </DashboardBlock>
 *   );
 * }
 * ```
 */
export function useDashboardBlock(options: UseDashboardBlockOptions = {}): UseDashboardBlockReturn {
  const { defaultCollapsed = false, defaultLoading = false, onRetry } = options;

  const [state, setState] = useState<DashboardBlockState>({
    collapsed: defaultCollapsed,
    loading: defaultLoading,
    error: false,
    errorMessage: undefined,
  });

  const toggleCollapse = useCallback(() => {
    setState((prev) => ({ ...prev, collapsed: !prev.collapsed }));
  }, []);

  const setCollapsed = useCallback((collapsed: boolean) => {
    setState((prev) => ({ ...prev, collapsed }));
  }, []);

  const expand = useCallback(() => {
    setState((prev) => ({ ...prev, collapsed: false }));
  }, []);

  const collapse = useCallback(() => {
    setState((prev) => ({ ...prev, collapsed: true }));
  }, []);

  const setLoading = useCallback((loading: boolean) => {
    setState((prev) => ({ ...prev, loading }));
  }, []);

  const setError = useCallback((error: boolean, errorMessage?: string) => {
    setState((prev) => ({ ...prev, error, errorMessage, loading: false }));
  }, []);

  const clearError = useCallback(() => {
    setState((prev) => ({ ...prev, error: false, errorMessage: undefined }));
  }, []);

  const reset = useCallback(() => {
    setState({
      collapsed: defaultCollapsed,
      loading: defaultLoading,
      error: false,
      errorMessage: undefined,
    });
  }, [defaultCollapsed, defaultLoading]);

  const actions = useMemo<DashboardBlockActions>(
    () => ({
      toggleCollapse,
      setCollapsed,
      expand,
      collapse,
      setLoading,
      setError,
      clearError,
      reset,
    }),
    [toggleCollapse, setCollapsed, expand, collapse, setLoading, setError, clearError, reset]
  );

  const blockProps = useMemo(
    () => ({
      collapsed: state.collapsed,
      onCollapseChange: setCollapsed,
      loading: state.loading,
      error: state.error,
      errorConfig: state.error
        ? {
            message: state.errorMessage,
            onRetry,
          }
        : undefined,
    }),
    [state.collapsed, state.loading, state.error, state.errorMessage, setCollapsed, onRetry]
  );

  return {
    state,
    actions,
    blockProps,
  };
}
