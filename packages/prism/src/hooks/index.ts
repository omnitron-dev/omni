/**
 * Prism Hooks
 *
 * Comprehensive React hooks for common patterns.
 * Combines core hooks with additional utility hooks.
 *
 * @module @omnitron-dev/prism/hooks
 */

// =============================================================================
// RE-EXPORTS FROM CORE (for convenience)
// =============================================================================

// These are re-exported so users can import from @omnitron-dev/prism/hooks
export {
  // State Management
  useBoolean,
  useSetState,
  useMultiSelect,
  // Storage & Browser
  useLocalStorage,
  useCopyToClipboard,
  // Timing & Scheduling
  useDebounce,
  useDebounceCallback,
  useCountdown,
  // Responsive
  useBreakpoints,
  useMediaQuery,
  // SSR & Lifecycle
  useIsClient,
  useMounted,
  usePrevious,
  // Events & DOM
  useEventListener,
  useClickOutside,
  // Timers
  useInterval,
  useTimeout,
} from '../core/index.js';

export type {
  SetState,
  UseSetStateReturn,
  UseMultiSelectOptions,
  UseMultiSelectReturn,
  CopyState,
  UseCopyToClipboardReturn,
  UseCopyToClipboardOptions,
  CountdownState,
  CountdownControls,
  UseCountdownReturn,
  UseCountdownOptions,
  UseMountedReturn,
  UseTimeoutReturn,
} from '../core/index.js';

// Note: useTabs is exported from @omnitron-dev/prism/components/tabs
// The core/hooks/use-tabs.ts version is for MUI Tabs integration
// and can be imported directly: import { useTabs } from '@omnitron-dev/prism/core/hooks/use-tabs'

// =============================================================================
// ASYNC OPERATIONS (unique to hooks module)
// =============================================================================

export {
  useAsync,
  useAsyncFn,
  type AsyncState,
  type UseAsyncReturn,
  type UseAsyncOptions,
  type UseAsyncFnReturn,
} from './use-async.js';

// =============================================================================
// SCROLL & WINDOW (unique to hooks module)
// =============================================================================

export {
  useScrollPosition,
  useScrollToTop,
  useScrollLock,
  type ScrollPosition,
  type UseScrollPositionOptions,
} from './use-scroll-position.js';

export {
  useWindowSize,
  useResponsiveQuery,
  useBreakpoint,
  useBreakpointChecks,
  type WindowSize,
  type Breakpoints,
  type UseWindowSizeOptions,
  type UseResponsiveQueryReturn,
  type BreakpointChecks,
} from './use-window-size.js';

// =============================================================================
// DOM MEASUREMENTS (unique to hooks module)
// =============================================================================

export { useClientRect, type UseClientRectReturn, type DOMRectValue, type ScrollElValue } from './use-client-rect.js';

// =============================================================================
// POPOVER/MENU (unique to hooks module)
// =============================================================================

export { usePopoverHover, type UsePopoverHoverReturn } from './use-popover-hover.js';

// Re-export click-based usePopover from components for discoverability
export { usePopover, type UsePopoverReturn } from '../components/popover/index.js';

// =============================================================================
// COOKIES STATE (unique to hooks module)
// =============================================================================

export { useCookies, type UseCookiesOptions, type UseCookiesReturn } from './use-cookies.js';

// =============================================================================
// CLICK HANDLING (unique to hooks module)
// =============================================================================

export { useDoubleClick, type UseDoubleClickProps, type UseDoubleClickReturn } from './use-double-click.js';

// =============================================================================
// BACK TO TOP (unique to hooks module)
// =============================================================================

export { useBackToTop, type UseBackToTopReturn } from './use-back-to-top.js';

// =============================================================================
// COUNTDOWN SECONDS (unique to hooks module)
// =============================================================================

export { useCountdownSeconds, type UseCountdownSecondsReturn } from './use-countdown-seconds.js';

// =============================================================================
// COUNTDOWN DATE (unique to hooks module)
// =============================================================================

export { useCountdownDate, type UseCountdownDateReturn } from './use-countdown-date.js';

// =============================================================================
// SCROLL OFFSET TOP (unique to hooks module)
// =============================================================================

export { useScrollOffsetTop, type UseScrollOffsetTopReturn } from './use-scroll-offset-top.js';

// =============================================================================
// CONFIG FROM URL (unique to hooks module)
// =============================================================================

export {
  useConfigFromQuery,
  type UrlConfigValues,
  type UseConfigFromQueryOptions,
  type UseConfigFromQueryReturn,
} from './use-config-from-query.js';

// =============================================================================
// IMAGE DIMENSIONS (unique to hooks module)
// =============================================================================

export {
  useImageDimensions,
  useMultipleImageDimensions,
  type ImageDimensions,
  type UseImageDimensionsReturn,
  type UseImageDimensionsOptions,
} from './use-image-dimensions.js';

// =============================================================================
// PASSWORD VISIBILITY (unique to hooks module)
// =============================================================================

export {
  usePasswordVisibility,
  type UsePasswordVisibilityReturn,
  type UsePasswordVisibilityOptions,
} from './use-password-visibility.js';

// =============================================================================
// THROTTLE (unique to hooks module)
// =============================================================================

export { useThrottle, useThrottleCallback, type UseThrottleOptions } from './use-throttle.js';

// =============================================================================
// NETWORK STATUS (unique to hooks module)
// =============================================================================

export { useOnlineStatus, type UseOnlineStatusReturn } from './use-online-status.js';

// =============================================================================
// INTERSECTION OBSERVER (unique to hooks module)
// =============================================================================

export {
  useIntersectionObserver,
  type UseIntersectionObserverOptions,
  type UseIntersectionObserverReturn,
} from './use-intersection-observer.js';

// =============================================================================
// KEYBOARD SHORTCUTS (unique to hooks module)
// =============================================================================

export {
  useKeyboardShortcut,
  useEscapeKey,
  useEnterKey,
  type KeyboardShortcut,
  type UseKeyboardShortcutOptions,
} from './use-keyboard-shortcut.js';

// =============================================================================
// FOCUS MANAGEMENT (unique to hooks module)
// =============================================================================

export { useFocusTrap, type UseFocusTrapOptions, type UseFocusTrapReturn } from './use-focus-trap.js';

// =============================================================================
// UPDATE EFFECT (unique to hooks module)
// =============================================================================

export { useUpdateEffect, useUpdateLayoutEffect } from './use-update-effect.js';

// =============================================================================
// ISOMORPHIC LAYOUT EFFECT (unique to hooks module)
// =============================================================================

export { useIsomorphicLayoutEffect } from './use-isomorphic-layout-effect.js';

// =============================================================================
// SESSION STORAGE (unique to hooks module)
// =============================================================================

export {
  useSessionStorage,
  type UseSessionStorageReturn,
  type UseSessionStorageOptions,
} from './use-session-storage.js';

// =============================================================================
// ARRAY STATE MANAGEMENT (unique to hooks module)
// =============================================================================

export { useArray, type UseArrayReturn } from './use-array.js';

// =============================================================================
// MUTATION (unique to hooks module)
// =============================================================================

export { useMutation, type MutationState, type UseMutationOptions, type UseMutationReturn } from './use-mutation.js';

// =============================================================================
// LAZY QUERY (unique to hooks module)
// =============================================================================

export {
  useLazyQuery,
  type LazyQueryState,
  type UseLazyQueryOptions,
  type UseLazyQueryReturn,
} from './use-lazy-query.js';

// =============================================================================
// INFINITE SCROLL (unique to hooks module)
// =============================================================================

export {
  useInfiniteScroll,
  type PageInfo,
  type InfinitePage,
  type InfiniteScrollState,
  type UseInfiniteScrollOptions,
  type UseInfiniteScrollReturn,
  type InfiniteFetchFn,
} from './use-infinite-scroll.js';
