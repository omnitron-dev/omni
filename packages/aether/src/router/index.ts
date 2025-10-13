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
} from './types.js';

// Router
export { createRouter, getRouter, setRouter } from './router.js';

// Route Matching
export { parseRoutePattern, matchRoute, findBestMatch, buildPath, normalizePath } from './route-matcher.js';

// Hooks
export { useRouter, useParams, useNavigate, useLocation, useSearchParams, useIsActive } from './hooks.js';

// Components
export { Link } from './Link.js';
export type { LinkProps } from './Link.js';
export { RouterView } from './RouterView.js';
export type { RouterProps } from './RouterView.js';

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

// Prefetching
export { prefetchRoute, clearPrefetchCache, isPrefetched } from './prefetch.js';

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
