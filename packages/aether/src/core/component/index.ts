/**
 * Component System
 *
 * Complete component architecture with lifecycle, props, context, and refs
 */

// Component definition
export { defineComponent, component } from './define.js';

// Lifecycle hooks
export { onMount, onError } from './lifecycle.js';

// Props utilities
export { mergeProps, splitProps, reactiveProps } from './props.js';

// Context API
export { createContext, useContext, provideContext, type Context } from './context.js';

// Refs
export {
  createRef,
  useRef,
  reactiveRef,
  mergeRefs,
  type Ref,
} from './refs.js';

// Lazy loading
export { lazy, preloadComponent, type ComponentLoader } from './lazy.js';

// Error Boundary
export {
  ErrorBoundary,
  useErrorBoundary,
  withErrorBoundary,
  ErrorBoundaryContext,
  type ErrorInfo,
  type ErrorBoundaryContext as ErrorBoundaryContextType,
  type ErrorBoundaryProps,
} from './error-boundary.js';

// Types
export type {
  Component,
  ComponentSetup,
  RenderFunction,
  CleanupFunction,
  MountCallback,
  ErrorCallback,
  ComponentContext,
} from './types.js';

// Re-export onCleanup from reactivity for convenience
export { onCleanup } from '../reactivity/context.js';
