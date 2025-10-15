/**
 * Server Components
 *
 * Zero-JavaScript server-only components that render on the server
 * and never hydrate on the client
 */

import type { Component, ComponentSetup } from '../core/component/types.js';
import type { ServerComponent, ClientComponent, ServerContext } from './types.js';

/**
 * Current server context (only available during SSR)
 */
let currentServerContext: ServerContext | undefined;

/**
 * Set the server context for SSR
 *
 * @internal
 */
export function setServerContext(context: ServerContext): void {
  currentServerContext = context;
}

/**
 * Get the current server context
 *
 * @throws Error if called outside of SSR
 */
export function getServerContext(): ServerContext {
  if (!currentServerContext) {
    throw new Error('[Aether Islands] getServerContext() can only be called during SSR');
  }
  return currentServerContext;
}

/**
 * Clear the server context
 *
 * @internal
 */
export function clearServerContext(): void {
  currentServerContext = undefined;
}

/**
 * Mark a component as server-only
 *
 * Server components:
 * - Only render on the server
 * - Never ship JavaScript to the client
 * - Can use server-only APIs (database, file system, etc.)
 * - Cannot have interactivity
 *
 * @param component - Component to mark as server-only
 * @returns Server component
 *
 * @example
 * ```typescript
 * const UserList = serverOnly(defineComponent(async () => {
 *   const users = await db.users.findMany();
 *
 *   return () => (
 *     <ul>
 *       {users.map(user => (
 *         <li key={user.id}>{user.name}</li>
 *       ))}
 *     </ul>
 *   );
 * }));
 * ```
 */
export function serverOnly<P = any>(component: Component<P>): ServerComponent<P> {
  const serverComp = component as ServerComponent<P>;
  serverComp.__serverOnly = true;
  return serverComp;
}

/**
 * Mark a component as client-only
 *
 * Client components:
 * - Only render on the client
 * - Skip SSR entirely
 * - Can use browser APIs freely
 * - Can provide fallback content for SSR
 *
 * @param component - Component to mark as client-only
 * @param options - Client component options
 * @returns Client component
 *
 * @example
 * ```typescript
 * const Map = clientOnly(defineComponent(() => {
 *   // Uses browser-only map library
 *   return () => <div id="map"></div>;
 * }), {
 *   fallback: <div>Loading map...</div>
 * });
 * ```
 */
export function clientOnly<P = any>(
  component: Component<P>,
  options?: {
    fallback?: any;
  }
): ClientComponent<P> {
  const clientComp = component as ClientComponent<P>;
  clientComp.__clientOnly = true;
  if (options?.fallback) {
    clientComp.__fallback = options.fallback;
  }
  return clientComp;
}

/**
 * Check if running in SSR environment
 */
export function isSSR(): boolean {
  return typeof window === 'undefined' || (import.meta.env && (import.meta.env as any).SSR === true);
}

/**
 * Check if running in browser
 */
export function isBrowser(): boolean {
  return !isSSR();
}

/**
 * Server-only hook for accessing request data
 *
 * @throws Error if called outside of SSR
 *
 * @example
 * ```typescript
 * const UserProfile = serverOnly(defineComponent(() => {
 *   const ctx = useServerContext();
 *   const userId = ctx.cookies['user_id'];
 *
 *   return () => <div>User ID: {userId}</div>;
 * }));
 * ```
 */
export function useServerContext(): ServerContext {
  return getServerContext();
}

/**
 * Server-only hook for accessing request URL
 *
 * @throws Error if called outside of SSR
 */
export function useRequestURL(): URL {
  return getServerContext().url;
}

/**
 * Server-only hook for accessing request headers
 *
 * @throws Error if called outside of SSR
 */
export function useHeaders(): Record<string, string> {
  return getServerContext().headers;
}

/**
 * Server-only hook for accessing cookies
 *
 * @throws Error if called outside of SSR
 */
export function useCookies(): Record<string, string> {
  return getServerContext().cookies;
}

/**
 * Server-only hook for accessing session
 *
 * @throws Error if called outside of SSR
 */
export function useSession<T = any>(): T | undefined {
  return getServerContext().session;
}

/**
 * Create an async server component
 *
 * Async server components can fetch data during render
 *
 * @param setup - Async setup function
 * @returns Server component
 *
 * @example
 * ```typescript
 * const BlogPost = asyncServerComponent(async ({ slug }) => {
 *   const post = await db.posts.findUnique({ where: { slug } });
 *
 *   return () => (
 *     <article>
 *       <h1>{post.title}</h1>
 *       <div innerHTML={post.content} />
 *     </article>
 *   );
 * });
 * ```
 */
export function asyncServerComponent<P = any>(setup: ComponentSetup<P>): ServerComponent<P> {
  const component: Component<P> = setup as any;
  return serverOnly(component);
}

/**
 * Server-only data fetching
 *
 * Fetch data during SSR with automatic error handling
 *
 * @param fetcher - Async function that fetches data
 * @returns Data or throws error
 *
 * @example
 * ```typescript
 * const UserList = serverOnly(defineComponent(async () => {
 *   const users = await serverFetch(async () => {
 *     return await db.users.findMany();
 *   });
 *
 *   return () => (
 *     <ul>
 *       {users.map(user => <li key={user.id}>{user.name}</li>)}
 *     </ul>
 *   );
 * }));
 * ```
 */
export async function serverFetch<T>(fetcher: () => Promise<T>): Promise<T> {
  if (!isSSR()) {
    throw new Error('[Aether Islands] serverFetch() can only be called during SSR');
  }

  try {
    return await fetcher();
  } catch (error) {
    console.error('[Aether Islands] Server fetch failed:', error);
    throw error;
  }
}

/**
 * Server-only utilities
 */
export const server = {
  /**
   * Check if running in SSR
   */
  isSSR,

  /**
   * Check if running in browser
   */
  isBrowser,

  /**
   * Get server context
   */
  getContext: getServerContext,

  /**
   * Fetch data on server
   */
  fetch: serverFetch,

  /**
   * Access request URL
   */
  useURL: useRequestURL,

  /**
   * Access request headers
   */
  useHeaders,

  /**
   * Access cookies
   */
  useCookies,

  /**
   * Access session
   */
  useSession,
} as const;

/**
 * Serialize data for hydration
 *
 * Safely serializes data to be embedded in HTML
 *
 * @param data - Data to serialize
 * @returns Serialized string
 */
export function serializeData(data: any): string {
  // Use JSON.stringify with replacer to handle circular references
  const seen = new WeakSet();
  const json = JSON.stringify(data, (key, value) => {
    // Skip functions
    if (typeof value === 'function') {
      return undefined;
    }
    // Skip symbols
    if (typeof value === 'symbol') {
      return undefined;
    }
    // Handle circular references
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return '[Circular]';
      }
      seen.add(value);
    }
    return value;
  });

  return json
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/'/g, '\\u0027');
}

/**
 * Deserialize data from HTML
 *
 * @param serialized - Serialized data string
 * @returns Deserialized data
 */
export function deserializeData<T = any>(serialized: string): T {
  return JSON.parse(serialized);
}

/**
 * Create server context from request
 *
 * @param request - HTTP request
 * @returns Server context
 */
export function createServerContextFromRequest(
  request: Request,
  options?: {
    session?: any;
    data?: Map<string, any>;
  }
): ServerContext {
  const url = new URL(request.url);

  // Parse headers
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });

  // Parse cookies
  const cookies: Record<string, string> = {};
  const cookieHeader = request.headers.get('cookie');
  if (cookieHeader) {
    cookieHeader.split(';').forEach((cookie) => {
      const [key, value] = cookie.trim().split('=');
      if (key && value) {
        cookies[key] = decodeURIComponent(value);
      }
    });
  }

  return {
    url,
    headers,
    cookies,
    session: options?.session,
    data: options?.data || new Map(),
  };
}

/**
 * Check if component is async
 */
export function isAsyncComponent(component: Component): boolean {
  return component.constructor.name === 'AsyncFunction';
}

/**
 * Render server component to HTML
 *
 * @param component - Server component
 * @param props - Component props
 * @returns Rendered HTML
 */
export async function renderServerComponent(component: ServerComponent, props: any = {}): Promise<string> {
  if (!isSSR()) {
    throw new Error('[Aether Islands] Server components can only be rendered during SSR');
  }

  try {
    // Execute component
    const result = component(props);

    // If async, await result
    if (result instanceof Promise) {
      const resolved = await result;
      return typeof resolved === 'function' ? resolved() : resolved;
    }

    // If function, execute it
    if (typeof result === 'function') {
      return result();
    }

    return result;
  } catch (error) {
    console.error('[Aether Islands] Server component render failed:', error);
    throw error;
  }
}
