/**
 * Aether Framework
 *
 * Minimalist, high-performance frontend framework with fine-grained reactivity.
 *
 * @module @omnitron-dev/aether
 */

// Core reactivity exports (most commonly used)
export {
  // Core primitives
  signal,
  computed,
  effect,
  store,
  resource,
  // Batch operations
  batch,
  untrack,
  createRoot,
  // Lifecycle
  onCleanup,
  getOwner,
  // Advanced
  asyncComputed,
  // Type utilities
  isSignal,
  // Types
  type Signal,
  type WritableSignal,
  type ComputedSignal,
  type Store,
  type Resource,
  type Owner,
  type Computation,
  type Disposable,
  type EffectOptions,
  type ComputedOptions,
  type ResourceOptions,
  type StoreOptions,
  type BatchOptions,
  type AsyncComputed,
  type AsyncComputedState,
  type AsyncComputedOptions,
} from './core/index.js';

// Component system exports (commonly used)
export {
  // Component definition
  defineComponent,
  component,
  // Lifecycle
  onMount,
  onError,
  // Props
  mergeProps,
  splitProps,
  reactiveProps,
  // Context
  createContext,
  useContext,
  // Refs
  createRef,
  useRef,
  reactiveRef,
  mergeRefs,
  // Lazy loading
  lazy,
  preloadComponent,
  // Types
  type Component,
  type ComponentSetup,
  type RenderFunction,
  type ComponentLoader,
  type Context,
  type Ref,
} from './core/index.js';

// Utility exports (template syntax enhancements)
export {
  // Event handlers
  prevent,
  stop,
  stopImmediate,
  preventStop,
  self,
  trusted,
  debounce,
  throttle,
  passive,
  capture,
  once,
  compose,
  // Bindings
  bindValue,
  bindNumber,
  bindTrimmed,
  bindDebounced,
  bindThrottled,
  bindLazy,
  bindChecked,
  bindGroup,
  bindSelect,
  composeBinding,
  // Classes
  classNames,
  cx,
  classes,
  reactiveClasses,
  toggleClass,
  conditionalClasses,
  variantClasses,
  mergeClasses,
  // Styles
  styles,
  reactiveStyles,
  mergeStyles,
  cssVar,
  cssVars,
  conditionalStyles,
  sizeStyles,
  positionStyles,
  flexStyles,
  gridStyles,
  // Directives
  createDirective,
  createUpdatableDirective,
  combineDirectives,
  autoFocus,
  clickOutside,
  intersectionObserver,
  resizeObserver,
  longPress,
  portal,
  draggable,
  // Types
  type InputBinding,
  type CheckboxBinding,
  type ClassValue,
  type StyleValue,
  type StyleObject,
  type CSSProperties,
  type DirectiveFunction,
  type DirectiveWithUpdate,
  type DirectiveResult,
} from './utils/index.js';

// Re-export everything from core for convenience
export * from './core/index.js';
