/**
 * Island Directives and Hints
 *
 * Directives for controlling island behavior and providing hints
 */

import { defineComponent } from '../core/component/define.js';
import type { Component, ComponentSetup } from '../core/component/types.js';
import type { IslandComponent, IslandOptions, HydrateOnOptions } from './types.js';
import { detectInteractivity } from './detector.js';

/**
 * Island ID generator
 */
let islandIdGen = 0;
function generateIslandId(): string {
  return `island-${Date.now()}-${islandIdGen++}`;
}

/**
 * Create an island component
 *
 * Marks a component as an island with optional hydration configuration
 *
 * @param component - Component to make an island
 * @param options - Island options
 * @returns Island component
 *
 * @example
 * ```typescript
 * const Counter = island(defineComponent(() => {
 *   const count = signal(0);
 *   return () => <button onClick={() => count.set(count() + 1)}>{count()}</button>;
 * }), {
 *   hydrate: 'interaction'
 * });
 * ```
 */
export function island<P = any>(component: Component<P>, options: IslandOptions = {}): IslandComponent<P> {
  const islandComp = component as IslandComponent<P>;

  // Auto-detect strategy if not provided
  if (!options.hydrate) {
    const detection = detectInteractivity(component);
    options.hydrate = detection.recommendedStrategy || 'immediate';
  }

  // Mark as island
  islandComp.__island = true;
  islandComp.__islandOptions = options;
  islandComp.__islandId = options.name || generateIslandId();

  return islandComp;
}

/**
 * Hydrate element on specific trigger
 *
 * Creates a lazy-loaded component that hydrates on trigger
 *
 * @param trigger - Trigger event
 * @param component - Component render function
 * @returns Component
 *
 * @example
 * ```typescript
 * <div>
 *   {hydrateOn('click', () => <HeavyWidget />)}
 * </div>
 * ```
 */
export function hydrateOn(trigger: HydrateOnOptions['trigger'], component: () => any): any {
  return defineComponent(() => {
    let hydrated = false;
    let content: any = null;

    const hydrate = () => {
      if (!hydrated) {
        hydrated = true;
        content = component();
      }
    };

    return () => {
      if (hydrated) {
        return content;
      }

      // Placeholder that triggers hydration
      const handlers: Record<string, () => void> = {};

      if (trigger === 'click') {
        handlers.onClick = hydrate;
      } else if (trigger === 'focus') {
        handlers.onFocus = hydrate;
      } else if (trigger === 'hover') {
        handlers.onMouseEnter = hydrate;
      }

      return <div {...handlers}>{content}</div>;
    };
  })();
}

/**
 * Client-only component wrapper
 *
 * Simpler API for clientOnly without full component definition
 *
 * @param component - Component to render
 * @param fallback - Optional fallback for SSR
 * @returns Component
 *
 * @example
 * ```typescript
 * <ClientOnly fallback={<Loading />}>
 *   <MapWidget />
 * </ClientOnly>
 * ```
 */
export const ClientOnly = defineComponent<{
  children: any;
  fallback?: any;
}>((props) => {
  const isSSR = typeof window === 'undefined';

  return () => {
    if (isSSR) {
      return props.fallback || null;
    }
    return props.children;
  };
});

/**
 * Server-only component wrapper
 *
 * Content only rendered on server
 *
 * @example
 * ```typescript
 * <ServerOnly>
 *   <ExpensiveServerComponent />
 * </ServerOnly>
 * ```
 */
export const ServerOnly = defineComponent<{
  children: any;
}>((props) => {
  const isSSR = typeof window === 'undefined';

  return () => {
    if (isSSR) {
      return props.children;
    }
    return null;
  };
});

/**
 * Lazy island wrapper
 *
 * Component that becomes an island with lazy loading
 *
 * @param loader - Async component loader
 * @param options - Island options
 * @returns Island component
 *
 * @example
 * ```typescript
 * const LazyWidget = lazyIsland(
 *   () => import('./Widget'),
 *   { hydrate: 'visible' }
 * );
 * ```
 */
export function lazyIsland<P = any>(
  loader: () => Promise<{ default: Component<P> } | Component<P>>,
  options: IslandOptions = {},
): IslandComponent<P> {
  let loadedComponent: Component<P> | undefined;
  let loading = false;
  let loadPromise: Promise<void> | undefined;

  const loadComponent = async () => {
    if (loadedComponent) return;
    if (loading) {
      await loadPromise;
      return;
    }

    loading = true;
    loadPromise = (async () => {
      const module = await loader();
      loadedComponent = 'default' in module ? module.default : (module as Component<P>);
    })();

    await loadPromise;
  };

  const lazyComp: Component<P> = (props: P) => {
    if (!loadedComponent) {
      throw loadComponent();
    }
    return loadedComponent(props);
  };

  return island(lazyComp, options);
}

/**
 * Island boundary directive
 *
 * Explicitly marks an island boundary for fine-grained control
 *
 * @param name - Island name
 * @param component - Component
 * @param options - Island options
 * @returns Island component
 *
 * @example
 * ```typescript
 * const MyIsland = islandBoundary('my-island', defineComponent(() => {
 *   // component code
 * }), {
 *   hydrate: 'idle'
 * });
 * ```
 */
export function islandBoundary<P = any>(
  name: string,
  component: Component<P>,
  options: IslandOptions = {},
): IslandComponent<P> {
  return island(component, { ...options, name });
}

/**
 * Preload hint directive
 *
 * Provides hints for preloading islands
 *
 * @param islandName - Island name to preload
 * @param trigger - When to preload
 * @returns Component
 *
 * @example
 * ```typescript
 * <PreloadHint island="heavy-widget" trigger="intent" />
 * ```
 */
export const PreloadHint = defineComponent<{
  island: string;
  trigger: 'intent' | 'viewport' | 'immediate';
}>((props) => {
  return () => {
    // This is a hint component that doesn't render anything
    // Build tools can use this to generate preload hints
    return null;
  };
});

/**
 * Static hint directive
 *
 * Explicitly marks component as static (never hydrate)
 *
 * @param component - Component
 * @returns Static component
 *
 * @example
 * ```typescript
 * const StaticHeader = staticHint(defineComponent(() => {
 *   return () => <header>My Site</header>;
 * }));
 * ```
 */
export function staticHint<P = any>(component: Component<P>): Component<P> {
  (component as any).__static = true;
  return component;
}

/**
 * Check if component is marked as static
 */
export function isStaticComponent(component: any): boolean {
  return component && component.__static === true;
}

/**
 * Priority hint for island loading
 *
 * @param priority - Loading priority
 * @returns Decorator
 *
 * @example
 * ```typescript
 * @priorityHint('high')
 * class CriticalWidget extends Component {
 *   // component code
 * }
 * ```
 */
export function priorityHint(priority: 'high' | 'low' | 'auto') {
  return function <T extends Component>(component: T): T {
    (component as any).__priority = priority;
    return component;
  };
}

/**
 * Defer island hydration
 *
 * Similar to island() but always defers hydration
 *
 * @param component - Component
 * @param strategy - Hydration strategy (default: 'idle')
 * @returns Island component
 *
 * @example
 * ```typescript
 * const Widget = defer(defineComponent(() => {
 *   // component code
 * }));
 * ```
 */
export function defer<P = any>(
  component: Component<P>,
  strategy: Exclude<IslandOptions['hydrate'], 'immediate'> = 'idle',
): IslandComponent<P> {
  return island(component, { hydrate: strategy });
}

/**
 * Create conditional island
 *
 * Island that only hydrates if condition is met
 *
 * @param component - Component
 * @param condition - Condition function
 * @returns Island component
 *
 * @example
 * ```typescript
 * const MobileMenu = conditionalIsland(
 *   defineComponent(() => { }),
 *   () => window.innerWidth < 768
 * );
 * ```
 */
export function conditionalIsland<P = any>(
  component: Component<P>,
  condition: () => boolean,
): IslandComponent<P> {
  return island(component, {
    hydrate: 'custom',
    shouldHydrate: condition,
  });
}

/**
 * Media query island
 *
 * Island that hydrates based on media query
 *
 * @param component - Component
 * @param query - Media query
 * @returns Island component
 *
 * @example
 * ```typescript
 * const DesktopNav = mediaIsland(
 *   defineComponent(() => { }),
 *   '(min-width: 1024px)'
 * );
 * ```
 */
export function mediaIsland<P = any>(component: Component<P>, query: string): IslandComponent<P> {
  return island(component, {
    hydrate: 'media',
    query,
  });
}

/**
 * Viewport island
 *
 * Island that hydrates when visible
 *
 * @param component - Component
 * @param rootMargin - Root margin for IntersectionObserver
 * @returns Island component
 *
 * @example
 * ```typescript
 * const LazyImage = viewportIsland(
 *   defineComponent(() => { }),
 *   '100px' // Start loading 100px before visible
 * );
 * ```
 */
export function viewportIsland<P = any>(component: Component<P>, rootMargin = '0px'): IslandComponent<P> {
  return island(component, {
    hydrate: 'visible',
    rootMargin,
  });
}

/**
 * Interaction island
 *
 * Island that hydrates on interaction
 *
 * @param component - Component
 * @param events - Trigger events
 * @returns Island component
 *
 * @example
 * ```typescript
 * const Dialog = interactionIsland(
 *   defineComponent(() => { }),
 *   ['click', 'focus']
 * );
 * ```
 */
export function interactionIsland<P = any>(
  component: Component<P>,
  events = ['click', 'focus', 'touchstart'],
): IslandComponent<P> {
  return island(component, {
    hydrate: 'interaction',
    events,
  });
}

/**
 * Idle island
 *
 * Island that hydrates when browser is idle
 *
 * @param component - Component
 * @param timeout - Timeout in ms
 * @returns Island component
 *
 * @example
 * ```typescript
 * const Analytics = idleIsland(
 *   defineComponent(() => { }),
 *   3000
 * );
 * ```
 */
export function idleIsland<P = any>(component: Component<P>, timeout = 2000): IslandComponent<P> {
  return island(component, {
    hydrate: 'idle',
    timeout,
  });
}
