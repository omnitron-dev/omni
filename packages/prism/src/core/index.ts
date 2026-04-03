/**
 * Prism Core Module
 *
 * Core providers, hooks, and utilities for the Prism design system.
 *
 * @module @omnitron-dev/prism/core
 */

// Provider
export { PrismProvider } from './provider.js';
export type { PrismProviderProps } from './provider.js';

// Provider Stack (composable providers)
export {
  composeProviders,
  createProviderStack,
  ProviderStack,
  withProviderProps,
  conditionalProvider,
  filterProviders,
} from './provider-stack.js';
export type {
  ProviderEntry,
  SimpleProvider,
  ProviderConfig,
  ProviderStackOptions,
  ProviderStackProps,
} from './provider-stack.js';

// Context
export { PrismContext, usePrismContext } from './context.js';

// Hooks - State Management
export { useBoolean } from './hooks/use-boolean.js';
export { useSetState } from './hooks/use-set-state.js';
export type { SetState, UseSetStateReturn } from './hooks/use-set-state.js';
export { useMultiSelect } from './hooks/use-multi-select.js';
export type { UseMultiSelectOptions, UseMultiSelectReturn } from './hooks/use-multi-select.js';

// Hooks - Storage & Browser
export { useLocalStorage } from './hooks/use-local-storage.js';
export { useCopyToClipboard } from './hooks/use-copy-to-clipboard.js';
export type { CopyState, UseCopyToClipboardReturn, UseCopyToClipboardOptions } from './hooks/use-copy-to-clipboard.js';

// Hooks - Timing & Scheduling
export { useDebounce, useDebounceCallback } from './hooks/use-debounce.js';
export { useCountdown } from './hooks/use-countdown.js';
export type {
  CountdownState,
  CountdownControls,
  UseCountdownReturn,
  UseCountdownOptions,
} from './hooks/use-countdown.js';

// Hooks - Responsive
export { useBreakpoints } from './hooks/use-breakpoints.js';
export { useMediaQuery } from './hooks/use-media-query.js';

// Hooks - SSR & Lifecycle
export { useIsClient } from './hooks/use-is-client.js';
export { useMounted } from './hooks/use-mounted.js';
export type { UseMountedReturn } from './hooks/use-mounted.js';
export { usePrevious } from './hooks/use-previous.js';

// Hooks - Events & DOM
export { useEventListener } from './hooks/use-event-listener.js';
export { useClickOutside } from './hooks/use-click-outside.js';

// Hooks - Timers
export { useInterval } from './hooks/use-interval.js';
export { useTimeout } from './hooks/use-timeout.js';
export type { UseTimeoutReturn } from './hooks/use-timeout.js';

// Note: useTabs is exported from @omnitron-dev/prism/hooks (not core)
// to avoid duplicate exports in the main index

// Accessibility
export {
  SkipLink,
  generateAriaId,
  combineAriaDescribedBy,
  srOnly,
  focusVisibleStyles,
  handleListKeyDown,
  ARIA_LABELS,
  getAriaExpanded,
  announceToScreenReader,
} from './accessibility/index.js';
export type { SkipLinkProps, AriaExpandedProps } from './accessibility/index.js';
