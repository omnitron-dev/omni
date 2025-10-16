/**
 * LazyLoadExtension - Lazy loading for heavy extensions
 *
 * Provides:
 * - Dynamic extension registration
 * - Code splitting integration
 * - Extension preloading strategies
 * - Loading state management
 * - Fallback for loading failures
 *
 * Performance benefits:
 * - Reduced initial bundle size
 * - Faster initial render
 * - Load extensions on demand
 */

import { Extension } from '../core/Extension.js';
import type { IExtension, ExtensionConfig, EditorContext } from '../core/types.js';

/**
 * Extension loader function type
 */
export type ExtensionLoader = () => Promise<IExtension>;

/**
 * Loading state for an extension
 */
export interface ExtensionLoadingState {
  name: string;
  status: 'pending' | 'loading' | 'loaded' | 'error';
  error?: Error;
  extension?: IExtension;
}

/**
 * Preload strategy
 */
export type PreloadStrategy =
  | 'eager' // Load immediately
  | 'idle' // Load during idle time
  | 'visible' // Load when editor is visible
  | 'interaction' // Load on first user interaction
  | 'manual'; // Load manually via API

/**
 * Lazy extension configuration
 */
export interface LazyExtensionConfig {
  /** Extension name */
  name: string;

  /** Loader function */
  loader: ExtensionLoader;

  /** Preload strategy */
  preload?: PreloadStrategy;

  /** Fallback extension if loading fails */
  fallback?: IExtension;

  /** Timeout for loading (ms) */
  timeout?: number;

  /** Retry attempts */
  retries?: number;
}

/**
 * LazyLoad extension configuration
 */
export interface LazyLoadConfig extends ExtensionConfig {
  /** Lazy extensions to manage */
  lazyExtensions?: LazyExtensionConfig[];

  /** Global preload strategy */
  defaultPreloadStrategy?: PreloadStrategy;

  /** Global timeout */
  defaultTimeout?: number;

  /** Enable loading indicators */
  showLoadingIndicators?: boolean;
}

/**
 * LazyLoadExtension class
 *
 * Manages lazy loading of heavy extensions to reduce initial bundle size
 */
export class LazyLoadExtension extends Extension<LazyLoadConfig> {
  name = 'lazyLoad';

  /** Loading states for lazy extensions */
  private loadingStates = new Map<string, ExtensionLoadingState>();

  /** Loaded extension instances */
  private loadedExtensions = new Map<string, IExtension>();

  /** Pending load operations */
  private pendingLoads = new Map<string, Promise<IExtension>>();

  /** Idle callback ID */
  private idleCallbackId?: number;

  /** Intersection observer for visibility detection */
  private intersectionObserver?: IntersectionObserver;

  /** Has user interacted */
  private hasInteracted = false;

  configure(config: Partial<LazyLoadConfig>): this {
    this.config = { ...this.config, ...config };
    return this;
  }

  onCreate(context: EditorContext): void {
    const lazyExtensions = this.config.lazyExtensions || [];

    // Initialize loading states
    for (const lazyConfig of lazyExtensions) {
      this.loadingStates.set(lazyConfig.name, {
        name: lazyConfig.name,
        status: 'pending',
      });
    }

    // Start preloading based on strategies
    this.initializePreloading(context);
  }

  /**
   * Initialize preloading based on strategies
   */
  private initializePreloading(context: EditorContext): void {
    const lazyExtensions = this.config.lazyExtensions || [];
    const defaultStrategy = this.config.defaultPreloadStrategy || 'idle';

    for (const lazyConfig of lazyExtensions) {
      const strategy = lazyConfig.preload || defaultStrategy;

      switch (strategy) {
        case 'eager':
          this.loadExtension(lazyConfig.name);
          break;

        case 'idle':
          this.preloadOnIdle(lazyConfig.name);
          break;

        case 'visible':
          this.preloadOnVisible(lazyConfig.name, context);
          break;

        case 'interaction':
          this.preloadOnInteraction(lazyConfig.name, context);
          break;

        case 'manual':
          // Do nothing, wait for manual trigger
          break;

        default:
          // Unknown strategy, use idle as fallback
          this.preloadOnIdle(lazyConfig.name);
          break;
      }
    }
  }

  /**
   * Preload extension during idle time
   */
  private preloadOnIdle(name: string): void {
    if (typeof requestIdleCallback !== 'undefined') {
      this.idleCallbackId = requestIdleCallback(
        () => {
          this.loadExtension(name);
        },
        { timeout: 2000 }
      );
    } else {
      // Fallback for browsers without requestIdleCallback
      setTimeout(() => this.loadExtension(name), 1000);
    }
  }

  /**
   * Preload extension when editor is visible
   */
  private preloadOnVisible(name: string, context: EditorContext): void {
    if (typeof IntersectionObserver === 'undefined') {
      // Fallback: load immediately
      this.loadExtension(name);
      return;
    }

    if (!this.intersectionObserver) {
      this.intersectionObserver = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              // Editor is visible, load all visible-strategy extensions
              const visibleExtensions = this.getExtensionsByStrategy('visible');
              for (const extName of visibleExtensions) {
                this.loadExtension(extName);
              }
              // Unobserve after loading
              if (entry.target) {
                this.intersectionObserver?.unobserve(entry.target);
              }
            }
          }
        },
        { threshold: 0.1 }
      );
    }

    // Observe editor element
    const editorElement = context.view?.dom;
    if (editorElement) {
      this.intersectionObserver.observe(editorElement);
    } else {
      // Fallback: load immediately
      this.loadExtension(name);
    }
  }

  /**
   * Preload extension on first user interaction
   */
  private preloadOnInteraction(name: string, context: EditorContext): void {
    if (this.hasInteracted) {
      this.loadExtension(name);
      return;
    }

    const editorElement = context.view?.dom;
    if (!editorElement) {
      // Fallback: load immediately
      this.loadExtension(name);
      return;
    }

    const loadOnInteraction = (): void => {
      if (!this.hasInteracted) {
        this.hasInteracted = true;

        // Load all interaction-strategy extensions
        const interactionExtensions = this.getExtensionsByStrategy('interaction');
        for (const extName of interactionExtensions) {
          this.loadExtension(extName);
        }

        // Remove listeners
        editorElement.removeEventListener('keydown', loadOnInteraction);
        editorElement.removeEventListener('mousedown', loadOnInteraction);
        editorElement.removeEventListener('touchstart', loadOnInteraction);
      }
    };

    editorElement.addEventListener('keydown', loadOnInteraction, { once: true });
    editorElement.addEventListener('mousedown', loadOnInteraction, { once: true });
    editorElement.addEventListener('touchstart', loadOnInteraction, { once: true });
  }

  /**
   * Get extensions by preload strategy
   */
  private getExtensionsByStrategy(strategy: PreloadStrategy): string[] {
    const lazyExtensions = this.config.lazyExtensions || [];
    const defaultStrategy = this.config.defaultPreloadStrategy || 'idle';

    return lazyExtensions
      .filter((config) => (config.preload || defaultStrategy) === strategy)
      .map((config) => config.name);
  }

  /**
   * Load an extension by name
   */
  async loadExtension(name: string): Promise<IExtension | null> {
    // Check if already loaded
    const loaded = this.loadedExtensions.get(name);
    if (loaded) {
      return loaded;
    }

    // Check if loading is in progress
    const pending = this.pendingLoads.get(name);
    if (pending) {
      return pending;
    }

    // Find lazy config
    const lazyConfig = this.config.lazyExtensions?.find((c) => c.name === name);
    if (!lazyConfig) {
      throw new Error(`Lazy extension "${name}" not found`);
    }

    // Update state
    this.updateLoadingState(name, { status: 'loading' });

    // Start loading
    const loadPromise = this.performLoad(lazyConfig);
    this.pendingLoads.set(name, loadPromise);

    try {
      const extension = await loadPromise;
      this.loadedExtensions.set(name, extension);
      this.updateLoadingState(name, { status: 'loaded', extension });
      this.pendingLoads.delete(name);
      return extension;
    } catch (error) {
      this.updateLoadingState(name, {
        status: 'error',
        error: error instanceof Error ? error : new Error(String(error)),
      });
      this.pendingLoads.delete(name);

      // Use fallback if available
      if (lazyConfig.fallback) {
        this.loadedExtensions.set(name, lazyConfig.fallback);
        return lazyConfig.fallback;
      }

      return null;
    }
  }

  /**
   * Perform the actual loading with timeout and retries
   */
  private async performLoad(config: LazyExtensionConfig): Promise<IExtension> {
    const timeout = config.timeout || this.config.defaultTimeout || 10000;
    const retries = config.retries || 0;

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const extension = await this.loadWithTimeout(config.loader, timeout);
        return extension;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Wait before retry (exponential backoff)
        if (attempt < retries) {
          await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 100));
        }
      }
    }

    throw lastError || new Error(`Failed to load extension ${config.name}`);
  }

  /**
   * Load with timeout
   */
  private async loadWithTimeout(loader: ExtensionLoader, timeout: number): Promise<IExtension> {
    return Promise.race([
      loader(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Extension load timeout')), timeout)
      ),
    ]);
  }

  /**
   * Update loading state
   */
  private updateLoadingState(name: string, updates: Partial<ExtensionLoadingState>): void {
    const current = this.loadingStates.get(name);
    if (current) {
      this.loadingStates.set(name, { ...current, ...updates });
    }
  }

  /**
   * Get loading state for an extension
   */
  getLoadingState(name: string): ExtensionLoadingState | undefined {
    return this.loadingStates.get(name);
  }

  /**
   * Get all loading states
   */
  getAllLoadingStates(): ExtensionLoadingState[] {
    return Array.from(this.loadingStates.values());
  }

  /**
   * Check if extension is loaded
   */
  isLoaded(name: string): boolean {
    return this.loadedExtensions.has(name);
  }

  /**
   * Get loaded extension
   */
  getLoadedExtension(name: string): IExtension | undefined {
    return this.loadedExtensions.get(name);
  }

  /**
   * Preload all pending extensions
   */
  async preloadAll(): Promise<void> {
    const pending = Array.from(this.loadingStates.values()).filter(
      (state) => state.status === 'pending'
    );

    await Promise.all(pending.map((state) => this.loadExtension(state.name)));
  }

  /**
   * Cleanup
   */
  onDestroy(): void {
    // Cancel idle callback
    if (this.idleCallbackId !== undefined) {
      cancelIdleCallback(this.idleCallbackId);
    }

    // Disconnect intersection observer
    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect();
    }

    // Clear maps
    this.loadingStates.clear();
    this.loadedExtensions.clear();
    this.pendingLoads.clear();
  }
}
