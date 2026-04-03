/**
 * NetronReactClient - Central client for React integration
 */

import {
  NetronClient,
  HttpClient,
  WebSocketClient,
  AuthenticationClient,
  ConnectionState,
  type ConnectionMetrics,
} from '@omnitron-dev/netron-browser';

import type {
  NetronReactClientConfig,
  QueryKey,
  QueryFilters,
  Query,
  DehydratedState,
  Unsubscribe,
  EventHandler,
  ServiceOptions,
  TypedServiceProxy,
} from './types.js';
import { QueryCache } from '../cache/query-cache.js';
import { MutationCache } from '../cache/mutation-cache.js';
import { SubscriptionManager } from '../cache/subscription-manager.js';
import { ServiceRegistry } from '../service/registry.js';

/**
 * Default client configuration
 */
const DEFAULT_CONFIG: Partial<NetronReactClientConfig> = {
  transport: 'auto',
  timeout: 30000,
  defaults: {
    staleTime: 0,
    cacheTime: 5 * 60 * 1000, // 5 minutes
    retry: 3,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  },
};

/**
 * NetronReactClient
 *
 * Central client managing connections, caching, subscriptions,
 * and service access for React applications.
 */
export class NetronReactClient {
  private config: Required<NetronReactClientConfig>;
  private netronClient: NetronClient | null = null;
  private httpClient: HttpClient | null = null;
  private wsClient: WebSocketClient | null = null;
  private authClient: AuthenticationClient | null = null;

  private queryCache: QueryCache;
  private mutationCache: MutationCache;
  private subscriptionManager: SubscriptionManager | null = null;
  private serviceRegistry: ServiceRegistry;

  private connectionState: ConnectionState = ConnectionState.DISCONNECTED;
  private listeners = new Map<string, Set<EventHandler>>();

  constructor(config: NetronReactClientConfig) {
    this.config = this.mergeConfig(config);
    this.queryCache = new QueryCache({
      maxEntries: this.config.cache?.maxEntries,
      defaultCacheTime: this.config.defaults.cacheTime,
    });
    this.mutationCache = new MutationCache();
    this.serviceRegistry = new ServiceRegistry(this);

    // Initialize auth client if configured
    if (this.config.auth) {
      this.initializeAuth();
    }
  }

  /**
   * Merge user config with defaults
   */
  private mergeConfig(config: NetronReactClientConfig): Required<NetronReactClientConfig> {
    return {
      ...DEFAULT_CONFIG,
      ...config,
      defaults: {
        ...DEFAULT_CONFIG.defaults,
        ...config.defaults,
      },
      cache: {
        ...config.cache,
      },
      devTools: config.devTools ?? process.env.NODE_ENV === 'development',
      ssr: config.ssr ?? { enabled: false },
      auth: config.auth ?? {},
      timeout: config.timeout ?? DEFAULT_CONFIG.timeout!,
      transport: config.transport ?? DEFAULT_CONFIG.transport!,
      protocols: config.protocols,
    } as Required<NetronReactClientConfig>;
  }

  /**
   * Initialize authentication client
   */
  private initializeAuth(): void {
    if (this.config.auth.client) {
      this.authClient = this.config.auth.client;
    } else {
      this.authClient = new AuthenticationClient({
        storage:
          this.config.auth.storage === 'session'
            ? undefined // Use session storage
            : this.config.auth.storage === 'memory'
              ? undefined // Use memory storage
              : undefined, // Use local storage (default)
        autoRefresh: this.config.auth.autoRefresh ?? true,
        refreshThreshold: this.config.auth.refreshThreshold ?? 5 * 60 * 1000,
        refreshConfig: this.config.auth.refreshEndpoint ? { endpoint: this.config.auth.refreshEndpoint } : undefined,
        logoutConfig: this.config.auth.logoutEndpoint ? { endpoint: this.config.auth.logoutEndpoint } : undefined,
      });
    }
  }

  // ============================================================================
  // Connection Management
  // ============================================================================

  /**
   * Connect to the server
   */
  async connect(): Promise<void> {
    if (this.connectionState === ConnectionState.CONNECTED) {
      return;
    }

    this.setConnectionState(ConnectionState.CONNECTING);

    try {
      const transport = this.determineTransport();

      if (transport === 'websocket' || transport === 'auto') {
        this.wsClient = new WebSocketClient({
          url: this.config.url,
          timeout: this.config.timeout,
          protocols: this.config.protocols,
          auth: this.authClient ?? undefined,
        });

        await this.wsClient.connect();
        this.setupWebSocketHandlers();
        this.subscriptionManager = new SubscriptionManager(this.wsClient);
      }

      if (transport === 'http' || transport === 'auto') {
        this.httpClient = new HttpClient({
          url: this.config.url,
          timeout: this.config.timeout,
          auth: this.authClient ?? undefined,
        });
        await this.httpClient.connect();
      }

      // Create unified netron client
      this.netronClient = new NetronClient({
        url: this.config.url,
        transport: transport === 'auto' ? 'http' : transport,
        timeout: this.config.timeout,
      });

      this.setConnectionState(ConnectionState.CONNECTED);
      this.emit('connect');
    } catch (error) {
      this.setConnectionState(ConnectionState.FAILED);
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Disconnect from the server
   */
  async disconnect(): Promise<void> {
    if (this.connectionState === ConnectionState.DISCONNECTED) {
      return;
    }

    // Clean up subscriptions
    this.subscriptionManager?.cleanup();

    // Disconnect clients
    await this.wsClient?.disconnect();
    await this.httpClient?.disconnect();

    this.wsClient = null;
    this.httpClient = null;
    this.netronClient = null;
    this.subscriptionManager = null;

    this.setConnectionState(ConnectionState.DISCONNECTED);
    this.emit('disconnect');
  }

  /**
   * Get current connection state
   */
  getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connectionState === ConnectionState.CONNECTED;
  }

  /**
   * Get connection metrics
   */
  getMetrics(): ConnectionMetrics | null {
    return this.wsClient?.getMetrics() ?? this.httpClient?.getMetrics() ?? null;
  }

  // ============================================================================
  // Service Access
  // ============================================================================

  /**
   * Get typed service proxy
   */
  service<T>(name: string, options?: ServiceOptions): TypedServiceProxy<T> {
    return this.serviceRegistry.getService<T>(name, options);
  }

  /**
   * Invoke a service method directly
   */
  async invoke<T = unknown>(
    service: string,
    method: string,
    args: unknown[],
    options?: { timeout?: number }
  ): Promise<T> {
    const client = this.getActiveClient();
    return client.invoke(service, method, args, {
      hints: { timeout: options?.timeout },
    }) as Promise<T>;
  }

  // ============================================================================
  // Query Cache Operations
  // ============================================================================

  /**
   * Get query data from cache
   */
  getQueryData<T>(queryKey: QueryKey): T | undefined {
    return this.queryCache.get<T>(queryKey);
  }

  /**
   * Set query data in cache
   */
  setQueryData<T>(queryKey: QueryKey, updater: T | ((prev: T | undefined) => T)): void {
    const prev = this.queryCache.get<T>(queryKey);
    const data = typeof updater === 'function' ? (updater as (prev: T | undefined) => T)(prev) : updater;
    this.queryCache.set(queryKey, data);
    this.emit('queryUpdated', { queryKey, data });
  }

  /**
   * Get query state
   */
  getQueryState<T, E = unknown>(queryKey: QueryKey): Query<T, E> | undefined {
    return this.queryCache.getQuery<T, E>(queryKey);
  }

  /**
   * Invalidate queries
   */
  async invalidateQueries(filters?: QueryFilters): Promise<void> {
    const queries = this.queryCache.findAll(filters);
    for (const query of queries) {
      this.queryCache.invalidate(query.queryKey);
    }
    this.emit('queriesInvalidated', { filters, count: queries.length });
  }

  /**
   * Remove queries from cache
   */
  removeQueries(filters?: QueryFilters): void {
    const queries = this.queryCache.findAll(filters);
    for (const query of queries) {
      this.queryCache.remove(query.queryKey);
    }
  }

  /**
   * Prefetch a query
   *
   * Uses the same deduplication mechanism as useQuery.
   * If there's already an in-flight request for this queryKey, it will wait for that instead.
   */
  async prefetchQuery<T>(
    queryKey: QueryKey,
    fetcher: () => Promise<T>,
    options?: { staleTime?: number }
  ): Promise<void> {
    const existing = this.queryCache.get<T>(queryKey);
    if (existing !== undefined && !this.queryCache.isStale(queryKey, options?.staleTime)) {
      return;
    }

    // Check if there's already an in-flight request
    const inFlight = this.queryCache.getInFlightPromise<T>(queryKey);
    if (inFlight) {
      try {
        await inFlight;
      } catch {
        // Prefetch errors are silent
      }
      return;
    }

    try {
      // Use deduplication - the fetcher doesn't use signal for prefetch
      await this.queryCache.getOrCreateFetch(queryKey, async () => fetcher());
    } catch (error) {
      // Prefetch errors are silent
      console.warn('Prefetch failed:', error);
    }
  }

  /**
   * Cancel queries
   */
  cancelQueries(filters?: QueryFilters): void {
    this.queryCache.cancelAll(filters);
  }

  /**
   * Clear all caches
   */
  clear(): void {
    this.queryCache.clear();
    this.mutationCache.clear();
  }

  // ============================================================================
  // Subscriptions
  // ============================================================================

  /**
   * Subscribe to an event
   */
  subscribe<T>(event: string, handler: EventHandler<T>): Unsubscribe {
    if (!this.subscriptionManager) {
      throw new Error('WebSocket connection required for subscriptions');
    }
    return this.subscriptionManager.subscribe(event, handler as EventHandler);
  }

  // ============================================================================
  // Authentication
  // ============================================================================

  /**
   * Get auth client
   */
  getAuth(): AuthenticationClient | null {
    return this.authClient;
  }

  // ============================================================================
  // Cache Access
  // ============================================================================

  /**
   * Get query cache instance
   */
  getQueryCache(): QueryCache {
    return this.queryCache;
  }

  /**
   * Get mutation cache instance
   */
  getMutationCache(): MutationCache {
    return this.mutationCache;
  }

  // ============================================================================
  // SSR Support
  // ============================================================================

  /**
   * Dehydrate state for SSR
   */
  dehydrate(): DehydratedState {
    return {
      queries: this.queryCache.dehydrate(),
      mutations: this.mutationCache.dehydrate(),
    };
  }

  /**
   * Hydrate state from SSR
   */
  hydrate(state: DehydratedState): void {
    this.queryCache.hydrate(state.queries);
    this.mutationCache.hydrate(state.mutations);
  }

  // ============================================================================
  // Event Emitter
  // ============================================================================

  /**
   * Add event listener
   */
  on<T>(event: string, handler: EventHandler<T>): Unsubscribe {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler as EventHandler);

    return () => {
      this.listeners.get(event)?.delete(handler as EventHandler);
    };
  }

  /**
   * Emit event
   */
  private emit(event: string, data?: unknown): void {
    this.listeners.get(event)?.forEach((handler) => {
      try {
        handler(data);
      } catch (error) {
        console.error(`Error in event handler for "${event}":`, error);
      }
    });
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  /**
   * Determine which transport to use
   */
  private determineTransport(): 'http' | 'websocket' | 'auto' {
    if (this.config.transport !== 'auto') {
      return this.config.transport;
    }

    // In browser, prefer WebSocket for real-time support
    if (typeof window !== 'undefined') {
      return 'auto';
    }

    // In SSR, use HTTP only
    return 'http';
  }

  /**
   * Get the active transport client
   */
  private getActiveClient(): HttpClient | WebSocketClient {
    if (this.wsClient?.isConnected()) {
      return this.wsClient as any; // Type compatibility handled
    }
    if (this.httpClient) {
      return this.httpClient as any;
    }
    throw new Error('No active client connection');
  }

  /**
   * Set connection state and emit event
   */
  private setConnectionState(state: ConnectionState): void {
    const prev = this.connectionState;
    this.connectionState = state;
    if (prev !== state) {
      this.emit('connectionStateChange', { from: prev, to: state });
    }
  }

  /**
   * Setup WebSocket event handlers
   */
  private setupWebSocketHandlers(): void {
    if (!this.wsClient) return;

    this.wsClient.on('disconnect', () => {
      this.setConnectionState(ConnectionState.DISCONNECTED);
      this.emit('disconnect');
    });

    this.wsClient.on('reconnect', () => {
      this.setConnectionState(ConnectionState.CONNECTED);
      this.emit('reconnect');

      // Re-fetch stale queries on reconnect
      if (this.config.defaults.refetchOnReconnect) {
        this.invalidateQueries({ stale: true });
      }
    });

    this.wsClient.on('error', (error: Error) => {
      this.emit('error', error);
    });
  }

  /**
   * Get the underlying NetronClient
   */
  getNetronClient(): NetronClient | null {
    return this.netronClient;
  }

  /**
   * Get configuration
   */
  getConfig(): Readonly<Required<NetronReactClientConfig>> {
    return this.config;
  }

  /**
   * Get default options
   */
  getDefaultOptions(): Required<NetronReactClientConfig>['defaults'] {
    return this.config.defaults;
  }
}

/**
 * Create a new NetronReactClient
 */
export function createNetronClient(config: NetronReactClientConfig): NetronReactClient {
  return new NetronReactClient(config);
}
