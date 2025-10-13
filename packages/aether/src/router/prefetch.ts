/**
 * Advanced Route Prefetching
 *
 * Provides intelligent prefetching with priority queues, network adaptation,
 * and resource hints for optimal performance
 */

import { executeLoader, setLoaderData } from './data.js';
import type { Router } from './types.js';

/**
 * Prefetch priority levels
 */
export enum PrefetchPriority {
  LOW = 0,
  MEDIUM = 1,
  HIGH = 2,
  CRITICAL = 3,
}

/**
 * Network connection quality
 */
export interface NetworkInfo {
  effectiveType?: '4g' | '3g' | '2g' | 'slow-2g';
  downlink?: number;
  rtt?: number;
  saveData?: boolean;
}

/**
 * Prefetch options
 */
export interface PrefetchOptions {
  /** Force prefetch even if already cached */
  force?: boolean;
  /** Priority level */
  priority?: PrefetchPriority;
  /** Delay before prefetch (ms) */
  delay?: number;
  /** Resource hints to add */
  hints?: ResourceHints;
}

/**
 * Resource hints configuration
 */
export interface ResourceHints {
  /** Add prefetch link */
  prefetch?: boolean;
  /** Add preconnect link */
  preconnect?: string[];
  /** Add dns-prefetch link */
  dnsPrefetch?: string[];
  /** Add preload link */
  preload?: Array<{ href: string; as: string; type?: string }>;
}

/**
 * Prefetch queue item
 */
interface PrefetchQueueItem {
  path: string;
  priority: PrefetchPriority;
  options: PrefetchOptions;
  addedAt: number;
}

/**
 * Prefetch statistics
 */
export interface PrefetchStats {
  totalPrefetched: number;
  cacheHits: number;
  cacheMisses: number;
  failedPrefetches: number;
  averagePrefetchTime: number;
  queueSize: number;
}

/**
 * Advanced Prefetch Manager
 */
export class PrefetchManager {
  private router: Router;
  private cache = new Map<string, { data: any; timestamp: number }>();
  private prefetchQueue: PrefetchQueueItem[] = [];
  private processing = false;
  private observers = new Map<string, IntersectionObserver>();
  private stats: PrefetchStats = {
    totalPrefetched: 0,
    cacheHits: 0,
    cacheMisses: 0,
    failedPrefetches: 0,
    averagePrefetchTime: 0,
    queueSize: 0,
  };

  // Configuration
  private maxCacheSize = 50;
  private maxCacheAge = 5 * 60 * 1000; // 5 minutes
  private maxConcurrent = 3;
  private activeRequests = 0;
  private adaptToNetwork = true;

  constructor(router: Router, config: Partial<PrefetchManagerConfig> = {}) {
    this.router = router;
    this.maxCacheSize = config.maxCacheSize ?? this.maxCacheSize;
    this.maxCacheAge = config.maxCacheAge ?? this.maxCacheAge;
    this.maxConcurrent = config.maxConcurrent ?? this.maxConcurrent;
    this.adaptToNetwork = config.adaptToNetwork ?? this.adaptToNetwork;

    // Start processing queue
    this.processQueue();
  }

  /**
   * Prefetch a route
   */
  async prefetch(path: string, options: PrefetchOptions = {}): Promise<void> {
    const { force = false, priority = PrefetchPriority.MEDIUM, delay = 0 } = options;

    // Check if prefetching is allowed based on network
    if (!this.shouldPrefetch()) {
      return;
    }

    // Check cache
    if (!force && this.cache.has(path)) {
      const cached = this.cache.get(path)!;
      const age = Date.now() - cached.timestamp;

      if (age < this.maxCacheAge) {
        this.stats.cacheHits++;
        return; // Use cached data
      }
    }

    this.stats.cacheMisses++;

    // Add to queue with optional delay
    if (delay > 0) {
      setTimeout(() => {
        this.addToQueue(path, priority, options);
      }, delay);
    } else {
      this.addToQueue(path, priority, options);
    }
  }

  /**
   * Prefetch on viewport intersection
   */
  prefetchOnViewport(element: Element, path: string, options: PrefetchOptions = {}): () => void {
    if (typeof IntersectionObserver === 'undefined') {
      return () => {}; // Not supported
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            this.prefetch(path, options);
            observer.disconnect();
          }
        }
      },
      {
        rootMargin: '50px',
      }
    );

    observer.observe(element);
    this.observers.set(path, observer);

    // Return cleanup function
    return () => {
      observer.disconnect();
      this.observers.delete(path);
    };
  }

  /**
   * Prefetch on hover with delay
   */
  prefetchOnHover(
    element: Element,
    path: string,
    options: PrefetchOptions & { hoverDelay?: number } = {}
  ): () => void {
    const { hoverDelay = 100 } = options;
    let timeoutId: NodeJS.Timeout | null = null;

    const handleMouseEnter = () => {
      timeoutId = setTimeout(() => {
        this.prefetch(path, options);
      }, hoverDelay);
    };

    const handleMouseLeave = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    };

    element.addEventListener('mouseenter', handleMouseEnter);
    element.addEventListener('mouseleave', handleMouseLeave);

    // Return cleanup function
    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      element.removeEventListener('mouseenter', handleMouseEnter);
      element.removeEventListener('mouseleave', handleMouseLeave);
    };
  }

  /**
   * Add resource hints to document
   */
  addResourceHints(hints: ResourceHints): void {
    if (typeof document === 'undefined') {
      return;
    }

    // Add preconnect hints
    if (hints.preconnect) {
      for (const origin of hints.preconnect) {
        this.addLinkHint('preconnect', origin);
      }
    }

    // Add dns-prefetch hints
    if (hints.dnsPrefetch) {
      for (const origin of hints.dnsPrefetch) {
        this.addLinkHint('dns-prefetch', origin);
      }
    }

    // Add preload hints
    if (hints.preload) {
      for (const resource of hints.preload) {
        const attrs: Record<string, string> = {
          as: resource.as,
        };
        if (resource.type) {
          attrs.type = resource.type;
        }
        this.addLinkHint('preload', resource.href, attrs);
      }
    }
  }

  /**
   * Get prefetch statistics
   */
  getStats(): PrefetchStats {
    return { ...this.stats, queueSize: this.prefetchQueue.length };
  }

  /**
   * Clear prefetch cache
   */
  clearCache(path?: string): void {
    if (path) {
      this.cache.delete(path);
    } else {
      this.cache.clear();
    }
  }

  /**
   * Dispose and cleanup
   */
  dispose(): void {
    this.prefetchQueue = [];
    this.cache.clear();
    this.observers.forEach((observer) => observer.disconnect());
    this.observers.clear();
  }

  /**
   * Add item to prefetch queue
   */
  private addToQueue(path: string, priority: PrefetchPriority, options: PrefetchOptions): void {
    // Check if already in queue
    if (this.prefetchQueue.some((item) => item.path === path)) {
      return;
    }

    // Add to queue
    this.prefetchQueue.push({
      path,
      priority,
      options,
      addedAt: Date.now(),
    });

    // Sort by priority (higher priority first)
    this.prefetchQueue.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Process prefetch queue
   */
  private async processQueue(): Promise<void> {
    if (this.processing) {
      return;
    }

    this.processing = true;

    while (this.prefetchQueue.length > 0) {
      // Wait if too many concurrent requests
      while (this.activeRequests >= this.maxConcurrent) {
        await this.delay(50);
      }

      // Get next item
      const item = this.prefetchQueue.shift();
      if (!item) {
        break;
      }

      // Execute prefetch
      this.activeRequests++;
      this.executePrefetch(item)
        .catch((error) => {
          console.warn(`Prefetch failed for ${item.path}:`, error);
          this.stats.failedPrefetches++;
        })
        .finally(() => {
          this.activeRequests--;
        });
    }

    this.processing = false;

    // Schedule next processing cycle if queue is not empty
    if (this.prefetchQueue.length > 0) {
      setTimeout(() => this.processQueue(), 100);
    }
  }

  /**
   * Execute individual prefetch
   */
  private async executePrefetch(item: PrefetchQueueItem): Promise<void> {
    const startTime = Date.now();

    // Find matching route
      
      const match = this.router.match(item.path);
      if (!match || !match.route.loader) {
        return; // No loader to prefetch
      }

      // Add resource hints if provided
      if (item.options.hints) {
        this.addResourceHints(item.options.hints);
      }

      // Execute loader
      const url = new URL(item.path, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
      const loaderData = await executeLoader(match.route.loader, {
        params: match.params,
        url,
        request: typeof window !== 'undefined' ? new Request(url.href) : undefined,
        netron: this.router.config.netron,
      });

      // Store in cache
      this.cache.set(item.path, {
        data: loaderData,
        timestamp: Date.now(),
      });

      // Store in loader data
      setLoaderData(item.path, loaderData);

      // Update statistics
      this.stats.totalPrefetched++;
      const prefetchTime = Date.now() - startTime;
      this.stats.averagePrefetchTime =
        (this.stats.averagePrefetchTime * (this.stats.totalPrefetched - 1) + prefetchTime) /
        this.stats.totalPrefetched;

      // Evict old entries if cache is too large
      this.evictCache();
  }

  /**
   * Check if prefetching should be allowed based on network
   */
  private shouldPrefetch(): boolean {
    if (!this.adaptToNetwork) {
      return true;
    }

    const networkInfo = this.getNetworkInfo();

    // Don't prefetch on slow connections or data saver mode
    if (networkInfo.saveData) {
      return false;
    }

    if (networkInfo.effectiveType === 'slow-2g' || networkInfo.effectiveType === '2g') {
      return false;
    }

    return true;
  }

  /**
   * Get network information
   */
  private getNetworkInfo(): NetworkInfo {
    if (typeof navigator === 'undefined' || !(navigator as any).connection) {
      return {};
    }

    const connection = (navigator as any).connection;
    return {
      effectiveType: connection.effectiveType,
      downlink: connection.downlink,
      rtt: connection.rtt,
      saveData: connection.saveData,
    };
  }

  /**
   * Evict old cache entries
   */
  private evictCache(): void {
    if (this.cache.size <= this.maxCacheSize) {
      return;
    }

    // Sort by timestamp and remove oldest entries
    const entries = Array.from(this.cache.entries()).sort((a, b) => a[1].timestamp - b[1].timestamp);

    const toRemove = entries.slice(0, this.cache.size - this.maxCacheSize);
    for (const [path] of toRemove) {
      this.cache.delete(path);
    }
  }

  /**
   * Add link hint to document head
   */
  private addLinkHint(rel: string, href: string, attrs: Record<string, string> = {}): void {
    if (typeof document === 'undefined') {
      return;
    }

    // Check if hint already exists
    const existing = document.querySelector(`link[rel="${rel}"][href="${href}"]`);
    if (existing) {
      return;
    }

    // Create link element
    const link = document.createElement('link');
    link.rel = rel;
    link.href = href;

    // Add additional attributes
    for (const [key, value] of Object.entries(attrs)) {
      link.setAttribute(key, value);
    }

    document.head.appendChild(link);
  }

  /**
   * Helper to delay execution
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Prefetch manager configuration
 */
export interface PrefetchManagerConfig {
  /** Maximum cache size */
  maxCacheSize?: number;
  /** Maximum cache age (ms) */
  maxCacheAge?: number;
  /** Maximum concurrent prefetch requests */
  maxConcurrent?: number;
  /** Adapt prefetching to network conditions */
  adaptToNetwork?: boolean;
}

/**
 * Default prefetch manager instance
 */
let defaultManager: PrefetchManager | null = null;

/**
 * Get or create default prefetch manager
 */
export function getPrefetchManager(router: Router, config?: PrefetchManagerConfig): PrefetchManager {
  if (!defaultManager) {
    defaultManager = new PrefetchManager(router, config);
  }
  return defaultManager;
}

/**
 * Set default prefetch manager
 */
export function setPrefetchManager(manager: PrefetchManager): void {
  defaultManager = manager;
}

/**
 * Simple prefetch function (for backward compatibility)
 */
export async function prefetchRoute(router: Router, path: string, options: { force?: boolean } = {}): Promise<void> {
  const manager = getPrefetchManager(router);
  await manager.prefetch(path, {
    force: options.force,
    priority: PrefetchPriority.MEDIUM,
  });
}

/**
 * Clear prefetch cache (for backward compatibility)
 */
export function clearPrefetchCache(path?: string): void {
  if (defaultManager) {
    defaultManager.clearCache(path);
  }
}

/**
 * Check if path has been prefetched (for backward compatibility)
 */
export function isPrefetched(_path: string): boolean {
  if (!defaultManager) {
    return false;
  }
  const stats = defaultManager.getStats();
  return stats.totalPrefetched > 0;
}
