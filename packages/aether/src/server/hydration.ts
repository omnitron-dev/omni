/**
 * Client Hydration System
 *
 * Rehydrates server-rendered HTML on the client with full reactivity:
 * - Preserves server state during hydration
 * - Handles hydration mismatches gracefully
 * - Supports progressive hydration strategies
 * - Implements island architecture for partial hydration
 * - Efficient reconciliation with existing DOM
 */

import type { HydrationOptions, HydrationError, HydrationStrategy, IslandMarker } from './types.js';
import { createRoot } from '../core/reactivity/batch.js';

/**
 * Hydration state
 */
interface HydrationState {
  serverState: Map<string, any>;
  mismatches: HydrationError[];
  hydrated: Set<string>;
  islands: Map<string, IslandMarker>;
}

/**
 * Global hydration state
 */
const hydrationState: HydrationState = {
  serverState: new Map(),
  mismatches: [],
  hydrated: new Set(),
  islands: new Map(),
};

/**
 * Hydrate server-rendered HTML with client-side reactivity
 *
 * Main hydration entry point. Attaches event listeners, restores state,
 * and enables reactivity on server-rendered DOM.
 *
 * @param component - Component to hydrate
 * @param container - DOM container with server HTML
 * @param options - Hydration options
 *
 * @example
 * ```typescript
 * import { hydrate } from '@omnitron-dev/aether/server';
 *
 * hydrate(App, document.getElementById('root'), {
 *   serverState: window.__AETHER_DATA__,
 *   progressive: true,
 *   strategy: 'idle',
 *   onMismatch: (error) => console.warn('Hydration mismatch:', error)
 * });
 * ```
 */
export function hydrate(component: any, container: HTMLElement | null, options: HydrationOptions = {}): void {
  if (!container) {
    throw new Error('Hydration container not found');
  }

  const { serverState = {}, progressive = false, strategy = 'eager', onMismatch, islands = false } = options;

  // Load server state
  loadServerState(serverState);

  // Load islands if enabled
  if (islands) {
    const islandMarkers = loadIslandMarkers(container);
    for (const marker of islandMarkers) {
      hydrationState.islands.set(marker.id, marker);
    }
  }

  // Hydrate based on strategy
  if (progressive) {
    hydrateProgressive(component, container, strategy, onMismatch);
  } else {
    hydrateEager(component, container, onMismatch);
  }
}

/**
 * Hydrate root element eagerly
 *
 * Hydrates the entire component tree immediately.
 *
 * @param component - Component to hydrate
 * @param container - Container element
 * @param onMismatch - Mismatch handler
 */
function hydrateEager(component: any, container: HTMLElement, onMismatch?: (error: HydrationError) => void): void {
  createRoot(() => {
    try {
      hydrateNode(component, container, onMismatch);
    } catch (error) {
      console.error('Hydration failed:', error);
      // Fallback to client-side render
      container.innerHTML = '';
      renderComponent(component, container);
    }
  });
}

/**
 * Hydrate progressively based on strategy
 *
 * Defers hydration based on the chosen strategy:
 * - idle: Hydrate when browser is idle
 * - lazy: Hydrate on first interaction
 * - visible: Hydrate when scrolled into view
 *
 * @param component - Component to hydrate
 * @param container - Container element
 * @param strategy - Hydration strategy
 * @param onMismatch - Mismatch handler
 */
function hydrateProgressive(
  component: any,
  container: HTMLElement,
  strategy: HydrationStrategy,
  onMismatch?: (error: HydrationError) => void
): void {
  switch (strategy) {
    case 'eager':
      hydrateEager(component, container, onMismatch);
      break;

    case 'idle':
      hydrateOnIdle(component, container, onMismatch);
      break;

    case 'lazy':
      hydrateOnInteraction(component, container, onMismatch);
      break;

    case 'visible':
      hydrateOnVisible(component, container, onMismatch);
      break;

    default:
      hydrateEager(component, container, onMismatch);
  }
}

/**
 * Hydrate when browser is idle
 */
function hydrateOnIdle(component: any, container: HTMLElement, onMismatch?: (error: HydrationError) => void): void {
  if ('requestIdleCallback' in window) {
    (window as any).requestIdleCallback(() => {
      hydrateEager(component, container, onMismatch);
    });
  } else {
    // Fallback for browsers without requestIdleCallback
    setTimeout(() => {
      hydrateEager(component, container, onMismatch);
    }, 1);
  }
}

/**
 * Hydrate on first user interaction
 */
function hydrateOnInteraction(
  component: any,
  container: HTMLElement,
  onMismatch?: (error: HydrationError) => void
): void {
  const events = ['mousedown', 'touchstart', 'keydown', 'scroll'];
  const hydrateHandler = () => {
    // Remove event listeners
    events.forEach((event) => {
      container.removeEventListener(event, hydrateHandler);
    });

    hydrateEager(component, container, onMismatch);
  };

  // Add event listeners
  events.forEach((event) => {
    container.addEventListener(event, hydrateHandler, { once: true, passive: true });
  });
}

/**
 * Hydrate when scrolled into view
 */
function hydrateOnVisible(component: any, container: HTMLElement, onMismatch?: (error: HydrationError) => void): void {
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            observer.disconnect();
            hydrateEager(component, container, onMismatch);
          }
        });
      },
      { rootMargin: '50px' }
    );

    observer.observe(container);
  } else {
    // Fallback for browsers without IntersectionObserver
    hydrateEager(component, container, onMismatch);
  }
}

/**
 * Hydrate a node and its children
 */
function hydrateNode(component: any, element: HTMLElement, onMismatch?: (error: HydrationError) => void): void {
  // Check if this is an island
  const islandId = element.getAttribute('data-island');
  if (islandId && hydrationState.islands.has(islandId)) {
    hydrateIsland(islandId, element, onMismatch);
    return;
  }

  // If islands are enabled, check children for islands and hydrate them
  if (hydrationState.islands.size > 0) {
    const children = Array.from((element as any).children || []);
    let hasIslands = false;

    for (const child of children) {
      const childIslandId = (child as HTMLElement).getAttribute?.('data-island');
      if (childIslandId && hydrationState.islands.has(childIslandId)) {
        hydrateIsland(childIslandId, child as HTMLElement, onMismatch);
        hasIslands = true;
      }
    }

    // If we found islands, we're in island architecture mode
    // Don't reconcile the parent component, just mark as hydrated
    if (hasIslands) {
      const path = getElementPath(element);
      hydrationState.hydrated.add(path);
      return;
    }
  }

  // Execute component to get VNode/DOM
  const result = typeof component === 'function' ? component({}) : component;

  // Reconcile with existing DOM
  reconcileServerClient(result, element, onMismatch);

  // Mark as hydrated
  const path = getElementPath(element);
  hydrationState.hydrated.add(path);
}

/**
 * Hydrate an island component
 */
function hydrateIsland(islandId: string, element: HTMLElement, onMismatch?: (error: HydrationError) => void): void {
  const marker = hydrationState.islands.get(islandId);
  if (!marker) {
    console.warn(`Island marker not found: ${islandId}`);
    return;
  }

  // Load component (would need to be registered)
  const component = getRegisteredComponent(marker.component);
  if (!component) {
    console.warn(`Island component not registered: ${marker.component}`);
    return;
  }

  // Hydrate based on island strategy
  hydrateProgressive(component, element, marker.strategy, onMismatch);
}

/**
 * Reconcile server-rendered DOM with client component
 */
function reconcileServerClient(
  clientNode: any,
  serverElement: HTMLElement,
  onMismatch?: (error: HydrationError) => void
): void {
  // Handle null/undefined
  if (clientNode == null) {
    if (serverElement.textContent !== '') {
      reportMismatch(serverElement, 'missing', '', serverElement.textContent || '', onMismatch);
    }
    return;
  }

  // Handle text nodes
  if (typeof clientNode === 'string' || typeof clientNode === 'number') {
    const clientText = String(clientNode);
    const serverText = serverElement.textContent || '';

    if (clientText !== serverText) {
      reportMismatch(serverElement, 'mismatch', clientText, serverText, onMismatch);
      serverElement.textContent = clientText;
    }
    return;
  }

  // Handle component results
  if (typeof clientNode === 'object' && 'nodeType' in clientNode) {
    // DOM node from client
    if (clientNode.nodeName !== serverElement.nodeName) {
      reportMismatch(serverElement, 'mismatch', clientNode.nodeName, serverElement.nodeName, onMismatch);
      serverElement.replaceWith(clientNode);
    }
    return;
  }

  // Handle VNodes
  if (typeof clientNode === 'object' && 'type' in clientNode) {
    // VNode reconciliation would go here
    // For now, we trust server HTML
    return;
  }

  // Handle arrays (fragments)
  if (Array.isArray(clientNode)) {
    // Reconcile children
    const serverChildren = Array.from(serverElement.childNodes);
    clientNode.forEach((child, index) => {
      if (serverChildren[index]) {
        reconcileServerClient(child, serverChildren[index] as HTMLElement, onMismatch);
      }
    });
  }
}

/**
 * Report hydration mismatch
 */
function reportMismatch(
  element: HTMLElement,
  type: HydrationError['type'],
  client: string,
  server: string,
  onMismatch?: (error: HydrationError) => void
): void {
  const error: HydrationError = {
    type,
    path: getElementPath(element),
    server,
    client,
  };

  hydrationState.mismatches.push(error);

  if (onMismatch) {
    onMismatch(error);
  } else {
    console.warn('Hydration mismatch:', error);
  }
}

/**
 * Get element path for debugging
 */
function getElementPath(element: HTMLElement): string {
  const path: string[] = [];
  let current: HTMLElement | null = element;

  while (current && current !== document.body) {
    const index = Array.from(current.parentElement?.children || []).indexOf(current);
    path.unshift(`${current.tagName.toLowerCase()}[${index}]`);
    current = current.parentElement;
  }

  return '/' + path.join('/');
}

/**
 * Load server state from global
 */
function loadServerState(serverState: Record<string, any>): void {
  for (const [key, value] of Object.entries(serverState)) {
    hydrationState.serverState.set(key, value);
  }
}

/**
 * Load island markers from DOM
 */
function loadIslandMarkers(container: HTMLElement): IslandMarker[] {
  const markers: IslandMarker[] = [];

  // Helper to extract marker from element
  const extractMarker = (island: HTMLElement | Element) => {
    const id = island.getAttribute?.('data-island');
    const component = island.getAttribute?.('data-component');
    const propsAttr = island.getAttribute?.('data-props');

    if (id && component) {
      markers.push({
        id,
        component,
        props: propsAttr ? JSON.parse(propsAttr) : {},
        strategy: 'idle',
      });
    }
  };

  // Try querySelectorAll first (real DOM)
  if (typeof (container as any).querySelectorAll === 'function') {
    const islands = container.querySelectorAll('[data-island]');
    islands.forEach(extractMarker);
  } else {
    // Fallback for mock/test environments - scan children
    const scanChildren = (el: any) => {
      if (el.getAttribute?.('data-island')) {
        extractMarker(el);
      }
      if (el.children) {
        for (const child of el.children) {
          scanChildren(child);
        }
      }
    };
    scanChildren(container);
  }

  return markers;
}

/**
 * Preserve server state for later use
 *
 * Returns the server state for a given key.
 *
 * @param key - State key
 * @returns Server state value
 *
 * @example
 * ```typescript
 * const userData = preserveServerState('user');
 * ```
 */
export function preserveServerState<T = any>(key: string): T | undefined {
  return hydrationState.serverState.get(key);
}

/**
 * Get all hydration mismatches
 *
 * Useful for debugging hydration issues.
 *
 * @returns Array of hydration errors
 */
export function getHydrationMismatches(): HydrationError[] {
  return [...hydrationState.mismatches];
}

/**
 * Clear hydration state
 *
 * Resets hydration state. Useful for testing.
 */
export function clearHydrationState(): void {
  hydrationState.serverState.clear();
  hydrationState.mismatches = [];
  hydrationState.hydrated.clear();
  hydrationState.islands.clear();
}

/**
 * Hydrate root element (alias for hydrate)
 *
 * @param container - Container element
 * @param options - Hydration options
 */
export function hydrateRoot(container: HTMLElement, options: HydrationOptions = {}): void {
  // Extract component from container's first child
  const component = container.firstElementChild;
  if (!component) {
    throw new Error('No component found in container');
  }

  hydrate(component, container, options);
}

/**
 * Component registry for islands
 */
const componentRegistry = new Map<string, any>();

/**
 * Register component for island hydration
 *
 * @param name - Component name
 * @param component - Component function
 *
 * @example
 * ```typescript
 * registerComponent('Counter', Counter);
 * ```
 */
export function registerComponent(name: string, component: any): void {
  componentRegistry.set(name, component);
}

/**
 * Get registered component
 */
function getRegisteredComponent(name: string): any {
  return componentRegistry.get(name);
}

/**
 * Render component (fallback for hydration failure)
 */
function renderComponent(component: any, container: HTMLElement): void {
  try {
    const result = typeof component === 'function' ? component({}) : component;

    if (typeof result === 'object' && 'nodeType' in result) {
      container.appendChild(result);
    } else if (typeof result === 'string') {
      container.textContent = result;
    }
  } catch (error) {
    // If even the fallback fails, just clear the container
    console.error('Client render fallback failed:', error);
    container.textContent = '';
  }
}
