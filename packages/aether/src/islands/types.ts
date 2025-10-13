/**
 * Islands Architecture Types
 *
 * Type definitions for islands, hydration strategies, and server components
 */

import type { Component } from '../core/component/types.js';

/**
 * Hydration strategy for an island
 */
export type HydrationStrategy =
  | 'immediate' // Hydrate immediately on page load
  | 'visible' // Hydrate when visible in viewport
  | 'interaction' // Hydrate on first interaction
  | 'idle' // Hydrate when browser is idle
  | 'media' // Hydrate when media query matches
  | 'custom'; // Custom hydration condition

/**
 * Options for island configuration
 */
export interface IslandOptions {
  /**
   * Hydration strategy
   * @default 'immediate'
   */
  hydrate?: HydrationStrategy;

  /**
   * Root margin for IntersectionObserver (for 'visible' strategy)
   * @default '0px'
   */
  rootMargin?: string;

  /**
   * Events that trigger hydration (for 'interaction' strategy)
   * @default ['click', 'focus', 'touchstart']
   */
  events?: string[];

  /**
   * Timeout in milliseconds (for 'idle' strategy)
   * @default 2000
   */
  timeout?: number;

  /**
   * Media query (for 'media' strategy)
   * @example '(max-width: 768px)'
   */
  query?: string;

  /**
   * Custom condition function (for 'custom' strategy)
   */
  shouldHydrate?: () => boolean;

  /**
   * Preload strategy
   * - 'intent': Preload on hover/focus
   * - 'viewport': Preload when near viewport
   */
  preload?: 'intent' | 'viewport';

  /**
   * Prefetch data before hydration
   */
  prefetch?: () => Promise<any>;

  /**
   * Island name for debugging and manifest generation
   */
  name?: string;
}

/**
 * Island component with metadata
 */
export interface IslandComponent<P = any> extends Component<P> {
  /**
   * Marks this component as an island
   */
  __island: true;

  /**
   * Island options
   */
  __islandOptions: IslandOptions;

  /**
   * Island ID for tracking
   */
  __islandId: string;
}

/**
 * Interactivity detection result
 */
export interface InteractivityDetection {
  /**
   * Is the component interactive?
   */
  isInteractive: boolean;

  /**
   * Detected interactivity signals
   */
  signals: InteractivitySignal[];

  /**
   * Recommended hydration strategy
   */
  recommendedStrategy?: HydrationStrategy;
}

/**
 * Types of interactivity signals
 */
export type InteractivitySignal =
  | 'event-handler' // Component has event handlers
  | 'reactive-state' // Component uses signals/stores
  | 'lifecycle-hook' // Component has lifecycle hooks
  | 'browser-api' // Component uses browser APIs
  | 'timer' // Component uses timers
  | 'websocket' // Component uses WebSocket
  | 'custom'; // Custom interactivity

/**
 * Island manifest entry
 */
export interface IslandManifestEntry {
  /**
   * Island ID
   */
  id: string;

  /**
   * Island name
   */
  name: string;

  /**
   * Island file path
   */
  path: string;

  /**
   * Bundle chunk name
   */
  chunk: string;

  /**
   * Hydration strategy
   */
  strategy: HydrationStrategy;

  /**
   * Dependencies (other islands or modules)
   */
  dependencies: string[];

  /**
   * Estimated bundle size in bytes
   */
  size?: number;

  /**
   * Is this island used in the current page?
   */
  used: boolean;
}

/**
 * Island manifest for build-time analysis
 */
export interface IslandManifest {
  /**
   * Islands by ID
   */
  islands: Record<string, IslandManifestEntry>;

  /**
   * Routes that use islands
   */
  routes: Record<string, string[]>; // route path -> island IDs

  /**
   * Build timestamp
   */
  timestamp: number;

  /**
   * Version
   */
  version: string;
}

/**
 * Server component marker
 */
export interface ServerComponent<P = any> extends Component<P> {
  /**
   * Marks this component as server-only
   */
  __serverOnly: true;
}

/**
 * Client component marker
 */
export interface ClientComponent<P = any> extends Component<P> {
  /**
   * Marks this component as client-only
   */
  __clientOnly: true;

  /**
   * Fallback content for SSR
   */
  __fallback?: any;
}

/**
 * Hydration state
 */
export type HydrationState = 'pending' | 'hydrating' | 'hydrated' | 'error';

/**
 * Island instance on the client
 */
export interface IslandInstance {
  /**
   * Island ID
   */
  id: string;

  /**
   * Island component
   */
  component: IslandComponent;

  /**
   * DOM element
   */
  element: HTMLElement;

  /**
   * Props passed to the island
   */
  props: any;

  /**
   * Hydration state
   */
  state: HydrationState;

  /**
   * Error if hydration failed
   */
  error?: Error;

  /**
   * Hydrate the island
   */
  hydrate: () => Promise<void>;

  /**
   * Cleanup function
   */
  cleanup?: () => void;
}

/**
 * Island boundary markers in HTML
 */
export interface IslandBoundary {
  /**
   * Island ID
   */
  id: string;

  /**
   * Island name
   */
  name: string;

  /**
   * Hydration strategy
   */
  strategy: HydrationStrategy;

  /**
   * Serialized props
   */
  props: string;

  /**
   * Start marker
   */
  startMarker: string;

  /**
   * End marker
   */
  endMarker: string;
}

/**
 * Options for hydrateOn directive
 */
export interface HydrateOnOptions {
  /**
   * Trigger event
   */
  trigger: 'click' | 'focus' | 'visible' | 'hover';

  /**
   * Fallback content while not hydrated
   */
  fallback?: any;
}

/**
 * Server context for server components
 */
export interface ServerContext {
  /**
   * Request URL
   */
  url: URL;

  /**
   * Request headers
   */
  headers: Record<string, string>;

  /**
   * Cookies
   */
  cookies: Record<string, string>;

  /**
   * User session
   */
  session?: any;

  /**
   * Custom context data
   */
  data: Map<string, any>;
}

/**
 * Island detection config
 */
export interface IslandDetectionConfig {
  /**
   * Enable automatic island detection
   * @default true
   */
  autoDetect?: boolean;

  /**
   * Minimum interactivity signals to consider a component an island
   * @default 1
   */
  threshold?: number;

  /**
   * Custom detection rules
   */
  customRules?: ((component: Component) => boolean)[];

  /**
   * Exclude patterns
   */
  exclude?: RegExp[];
}

/**
 * Island rendering result
 */
export interface IslandRenderResult {
  /**
   * Rendered HTML with island boundaries
   */
  html: string;

  /**
   * Islands found in this render
   */
  islands: IslandBoundary[];

  /**
   * Hydration script
   */
  hydrationScript: string;
}
