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
} from './types.js';

// Router
export { createRouter, getRouter, setRouter } from './router.js';

// Route Matching
export {
  parseRoutePattern,
  matchRoute,
  findBestMatch,
  buildPath,
  normalizePath,
} from './route-matcher.js';

// Hooks
export {
  useRouter,
  useParams,
  useNavigate,
  useLocation,
  useSearchParams,
  useIsActive,
} from './hooks.js';

// Components
export { Link } from './Link.js';
export type { LinkProps } from './Link.js';

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
} from './data.js';
export type { Fetcher } from './data.js';
