/**
 * Router Module
 *
 * File-based routing for Aether
 */

// Types
export type {
  RouteParams,
  RouteComponent,
  RouteLoader,
  RouteAction,
  RouteGuard,
  RedirectResult,
  LoaderContext,
  ActionContext,
  GuardContext,
  RouteDefinition,
  RouteMeta,
  RouteMatch,
  RoutePattern,
  RouteSegment,
  NavigationOptions,
  RouterConfig,
  ScrollBehavior,
  Location,
  Router,
  RouteContext,
  RouteError,
  DeferredData,
  PrefetchStrategy,
  FileRouteConventions,
  FileRouteModule,
  ViewTransitionsConfig,
  PrefetchConfig,
  CodeSplittingConfig,
  ScrollRestorationConfig,
} from './types.js';

// Router
export { createRouter, getRouter, setRouter } from './router.js';

// Route Matching
export { parseRoutePattern, matchRoute, findBestMatch, buildPath, normalizePath } from './route-matcher.js';

// Hooks
export {
  useRouter,
  useParams,
  useNavigate,
  useLocation,
  useSearchParams,
  useIsActive,
  useMatches,
  useRevalidator,
  useSubmit,
  useFormAction,
  useBlocker,
  usePrompt,
} from './hooks.js';
export type { Revalidator, SubmitOptions, BlockerFunction, Blocker } from './hooks.js';

// Components
export { Link } from './Link.js';
export type { LinkProps } from './Link.js';
export { RouterView } from './RouterView.js';
export type { RouterProps } from './RouterView.js';
export { Form } from './Form.js';
export type { FormProps } from './Form.js';

// Layouts
export { Outlet, RouteContextSymbol, useRouteContext } from './Outlet.js';
export {
  buildLayoutChain,
  findErrorBoundary,
  findLoadingComponent,
  createRouteContext,
  renderWithLayouts,
} from './layouts.js';

// Error Boundaries
export { ErrorBoundary, useRouteError, createRouteError, isRouteError, RouteErrorContext } from './error-boundary.js';
export type { ErrorBoundaryProps } from './error-boundary.js';

// Data Loading
export {
  useLoaderData,
  useActionData,
  useNavigation,
  useFetcher,
  setLoaderData,
  setActionData,
  setNavigationState,
  executeLoader,
  executeAction,
  executeLoadersParallel,
  defer,
  isDeferred,
  awaitDeferred,
} from './data.js';
export type { Fetcher } from './data.js';

// Prefetching (Basic)
export { prefetchRoute, clearPrefetchCache, isPrefetched } from './prefetch.js';

// Advanced Prefetching
export { PrefetchManager, PrefetchPriority, getPrefetchManager, setPrefetchManager } from './prefetch.js';
export type { PrefetchOptions, ResourceHints, PrefetchStats, PrefetchManagerConfig, NetworkInfo } from './prefetch.js';

// View Transitions
export {
  ViewTransitionsManager,
  supportsViewTransitions,
  getViewTransitionsManager,
  setViewTransitionsManager,
  injectFallbackStyles,
  setupMorphTransition,
  cleanupMorphTransition,
} from './view-transitions.js';
export type { ViewTransitionConfig, ViewTransitionOptions, ViewTransitionHooks } from './view-transitions.js';

// Code Splitting
export {
  CodeSplittingManager,
  getCodeSplittingManager,
  setCodeSplittingManager,
  lazyRoute,
  preloadRoute,
  webpackChunkName,
  viteGlob,
} from './code-splitting.js';
export type { LazyRouteConfig, ChunkMetadata, BundleStats } from './code-splitting.js';

// Scroll Restoration
export {
  ScrollRestorationManager,
  getScrollRestorationManager,
  setScrollRestorationManager,
  saveScrollPosition,
  restoreScrollPosition,
  scrollToTop,
  scrollToElement,
  scrollToHash,
} from './scroll.js';
export type { ScrollPosition, ScrollBehaviorType, ScrollOptions } from './scroll.js';

// File-Based Routing
export {
  filePathToRoutePath,
  extractParams,
  groupRouteFiles,
  buildRouteFromModules,
  createRouteTree,
  generateRoutesFromFiles,
  validateRoute,
  validateRoutes,
  defaultConventions,
} from './file-based.js';

// Module integration
export {
  ModuleAwareRouter,
  createModuleAwareRouter,
  RouterLifecycleManager,
  createRouteGroup,
  extractRoutesFromModules,
  getModuleRouter,
  setModuleRouter,
  resetModuleRouter,
} from './module-integration.js';
export type {
  ModuleRouteMetadata,
  ModuleRouteDefinition,
  ModuleAwareRouterConfig,
  RouteGroup,
} from './module-integration.js';
