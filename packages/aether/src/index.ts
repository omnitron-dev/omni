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

// Suspense and async loading (commonly used)
export {
  // Suspense
  Suspense,
  SuspenseList,
  suspend,
  useSuspense,
  createSuspenseResource,
  // Error boundaries
  ErrorBoundary,
  Boundary,
  useErrorBoundary,
  withErrorBoundary,
  withRetry,
  // Async components
  useAsync,
  prefetch,
  asyncComponent,
  createAsyncComponent,
  // Lazy loading
  lazy as lazyComponent,
  preload as preloadLazy,
  isLoaded,
  lazyNamed,
  lazyRoute,
  splitCode,
  // Types
  type SuspenseProps,
  type ErrorBoundaryProps,
  type LazyComponent,
  type LazyOptions,
  type AsyncComponentLoader,
} from './suspense/index.js';

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

// Styling system exports
export {
  // Runtime
  createStyleSheet,
  getGlobalSheet,
  injectStyles,
  extractStyles,
  getSSRStyleTags,
  cleanupStyles,
  // Styled components
  styled,
  createVariant,
  composeStyles,
  // CSS utilities
  css,
  keyframes,
  globalStyles,
  cssReset,
  responsive,
  darkMode,
  mergeCSS,
  cssVariables,
  // Types
  type StyledProps,
  type VariantConfig,
  type VariantProps,
  type StyleConfig,
  type CompoundVariant,
  type DefaultVariants,
  type Keyframe,
} from './styling/index.js';

// Theme system exports
export {
  // Theme definition
  defineTheme,
  getToken,
  createDefaultLightTheme,
  createDefaultDarkTheme,
  // CSS variables
  generateCSSVariables,
  applyTheme,
  removeTheme,
  getCSSVariable,
  createThemeVars,
  // Theme provider
  ThemeProvider,
  useTheme,
  useThemeToken,
  useThemeVar,
  withTheme,
  useThemeToggle,
  // Types
  type Theme,
  type ThemeConfig,
  type ColorTokens,
  type ColorScale,
  type TypographyTokens,
  type SpacingTokens,
  type ThemeContextType,
  type ThemeProviderProps,
} from './theming/index.js';

// SVG system exports
export {
  // Primitives
  SVG,
  Circle,
  Rect,
  Path,
  Line,
  Polygon,
  Polyline,
  Ellipse,
  G,
  Use,
  Symbol,
  Defs,
  Text,
  TSpan,
  TextPath,
  LinearGradient,
  RadialGradient,
  Stop,
  Pattern,
  Mask,
  ClipPath,
  // Components
  SVGIcon,
  // Icon Registry
  IconRegistry,
  getIconRegistry,
  resetIconRegistry,
  // Types
  type SVGProps,
  type CircleProps,
  type RectProps,
  type PathProps,
  type LineProps,
  type PolygonProps,
  type PolylineProps,
  type EllipseProps,
  type GroupProps,
  type UseProps,
  type SymbolProps,
  type DefsProps,
  type TextProps,
  type TSpanProps,
  type TextPathProps,
  type LinearGradientProps,
  type RadialGradientProps,
  type StopProps,
  type PatternProps,
  type MaskProps,
  type ClipPathProps,
  type SVGIconProps,
  type IconDefinition,
  type IconSource,
  type IconSet,
  type IconTransformer,
  type AnimationConfig,
  type TimelineConfig,
  type AnimationController,
} from './svg/index.js';

// Re-export everything from core for convenience
export * from './core/index.js';
