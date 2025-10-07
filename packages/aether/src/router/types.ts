/**
 * Router - Type Definitions
 *
 * Core types for the Aether routing system
 */

/**
 * Route parameters extracted from URL
 */
export type RouteParams = Record<string, string | string[]>;

/**
 * Route component type
 */
export type RouteComponent = any; // Will be properly typed with Component later

/**
 * Route loader function (SSR data fetching)
 */
export type RouteLoader<T = any> = (context: LoaderContext) => T | Promise<T>;

/**
 * Route action function (form mutations)
 */
export type RouteAction<T = any> = (context: ActionContext) => T | Promise<T>;

/**
 * Route guard function (authorization, validation)
 */
export type RouteGuard = (context: GuardContext) => boolean | Promise<boolean> | RedirectResult;

/**
 * Redirect result from guard
 */
export interface RedirectResult {
  redirect: string;
  status?: number;
}

/**
 * Loader context
 */
export interface LoaderContext {
  params: RouteParams;
  url: URL;
  request?: Request;
}

/**
 * Action context
 */
export interface ActionContext {
  params: RouteParams;
  request: Request;
  formData: FormData;
}

/**
 * Guard context
 */
export interface GuardContext {
  params: RouteParams;
  url: URL;
  from?: string;
}

/**
 * Route definition
 */
export interface RouteDefinition {
  path: string;
  component?: RouteComponent;
  layout?: RouteComponent;
  errorBoundary?: RouteComponent;
  loading?: RouteComponent;
  loader?: RouteLoader;
  action?: RouteAction;
  guards?: RouteGuard[];
  children?: RouteDefinition[];
  meta?: RouteMeta;
}

/**
 * Route metadata
 */
export interface RouteMeta {
  title?: string;
  description?: string;
  [key: string]: any;
}

/**
 * Matched route
 */
export interface RouteMatch {
  route: RouteDefinition;
  params: RouteParams;
  path: string;
  score: number;
}

/**
 * Route pattern types
 */
export type RoutePattern = {
  type: 'static' | 'dynamic' | 'catchall' | 'optional';
  name?: string;
  value?: string;
};

/**
 * Parsed route segment
 */
export interface RouteSegment {
  type: 'static' | 'dynamic' | 'catchall' | 'optional-catchall' | 'optional-param';
  name?: string;
  value?: string;
}

/**
 * Navigation options
 */
export interface NavigationOptions {
  replace?: boolean;
  state?: any;
  scroll?: boolean | { top?: number; left?: number };
}

/**
 * Router configuration
 */
export interface RouterConfig {
  mode?: 'history' | 'hash' | 'memory';
  base?: string;
  routes?: RouteDefinition[];
  scrollBehavior?: ScrollBehavior;
}

/**
 * Scroll behavior function
 */
export type ScrollBehavior = (
  to: RouteMatch,
  from: RouteMatch | null,
  savedPosition: { top: number; left: number } | null
) => { top?: number; left?: number } | null;

/**
 * Location state
 */
export interface Location {
  pathname: string;
  search: string;
  hash: string;
  state: any;
}

/**
 * Router instance
 */
export interface Router {
  readonly config: RouterConfig;
  readonly current: Location;

  match(pathname: string): RouteMatch | null;
  navigate(to: string, options?: NavigationOptions): Promise<void>;
  back(): void;
  forward(): void;
  go(delta: number): void;

  beforeEach(guard: RouteGuard): () => void;
  afterEach(hook: (to: RouteMatch, from: RouteMatch | null) => void): () => void;

  ready(): Promise<void>;
  dispose(): void;
}

/**
 * Route context for nested routes
 */
export interface RouteContext {
  route: RouteMatch;
  layouts: RouteComponent[];
  errorBoundary?: RouteComponent;
  loading?: RouteComponent;
}

/**
 * Route error context
 */
export interface RouteError {
  message: string;
  stack?: string;
  statusCode?: number;
  error?: Error;
}
