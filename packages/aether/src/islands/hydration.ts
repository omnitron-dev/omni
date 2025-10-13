/**
 * Hydration Strategies
 *
 * Different strategies for when and how to hydrate islands
 */

import type { IslandInstance, HydrationStrategy } from './types.js';

/**
 * Hydration strategy implementation
 */
export interface HydrationStrategyImpl {
  /**
   * Initialize the strategy
   */
  init(island: IslandInstance): void;

  /**
   * Cleanup the strategy
   */
  cleanup(): void;
}

/**
 * Immediate hydration - hydrate as soon as possible
 */
export class ImmediateHydration implements HydrationStrategyImpl {
  constructor(private island: IslandInstance) {}

  init(island: IslandInstance): void {
    // Hydrate immediately
    island.hydrate().catch((err) => {
      console.error('[Aether Islands] Immediate hydration failed:', err);
      island.state = 'error';
      island.error = err;
    });
  }

  cleanup(): void {
    // Nothing to cleanup
  }
}

/**
 * Visible hydration - hydrate when visible in viewport
 */
export class VisibleHydration implements HydrationStrategyImpl {
  private observer?: IntersectionObserver;

  constructor(
    private island: IslandInstance,
    private rootMargin = '0px',
  ) {}

  init(island: IslandInstance): void {
    // Use IntersectionObserver
    this.observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            // Element is visible, hydrate
            island
              .hydrate()
              .catch((err) => {
                console.error('[Aether Islands] Visible hydration failed:', err);
                island.state = 'error';
                island.error = err;
              })
              .finally(() => {
                // Disconnect observer after hydration
                this.cleanup();
              });
          }
        });
      },
      {
        rootMargin: this.rootMargin,
      },
    );

    this.observer.observe(island.element);
  }

  cleanup(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = undefined;
    }
  }
}

/**
 * Interaction hydration - hydrate on first interaction
 */
export class InteractionHydration implements HydrationStrategyImpl {
  private listeners: Array<{ event: string; handler: EventListener }> = [];
  private hydrated = false;

  constructor(
    private island: IslandInstance,
    private events = ['click', 'focus', 'touchstart', 'mouseenter'],
  ) {}

  init(island: IslandInstance): void {
    // Add event listeners for trigger events
    this.events.forEach((eventName) => {
      const handler = (event: Event) => {
        if (!this.hydrated) {
          this.hydrated = true;

          // Hydrate on first interaction
          island
            .hydrate()
            .catch((err) => {
              console.error('[Aether Islands] Interaction hydration failed:', err);
              island.state = 'error';
              island.error = err;
            })
            .finally(() => {
              // Cleanup listeners after hydration
              this.cleanup();

              // Re-dispatch event so the hydrated component can handle it
              setTimeout(() => {
                island.element.dispatchEvent(new Event(event.type, event));
              }, 0);
            });
        }
      };

      island.element.addEventListener(eventName, handler, { capture: true, once: false });
      this.listeners.push({ event: eventName, handler });
    });
  }

  cleanup(): void {
    this.listeners.forEach(({ event, handler }) => {
      this.island.element.removeEventListener(event, handler, { capture: true });
    });
    this.listeners = [];
  }
}

/**
 * Idle hydration - hydrate when browser is idle
 */
export class IdleHydration implements HydrationStrategyImpl {
  private handle?: number;
  private timeout?: number;

  constructor(
    private island: IslandInstance,
    private timeoutMs = 2000,
  ) {}

  init(island: IslandInstance): void {
    // Use requestIdleCallback if available
    if ('requestIdleCallback' in window) {
      this.handle = window.requestIdleCallback(
        () => {
          island.hydrate().catch((err) => {
            console.error('[Aether Islands] Idle hydration failed:', err);
            island.state = 'error';
            island.error = err;
          });
        },
        {
          timeout: this.timeoutMs,
        },
      );
    } else {
      // Fallback to setTimeout
      const globalThis = window as any;
      this.timeout = globalThis.setTimeout(() => {
        island.hydrate().catch((err) => {
          console.error('[Aether Islands] Idle hydration failed:', err);
          island.state = 'error';
          island.error = err;
        });
      }, this.timeoutMs);
    }
  }

  cleanup(): void {
    if (this.handle !== undefined) {
      window.cancelIdleCallback(this.handle);
      this.handle = undefined;
    }
    if (this.timeout !== undefined) {
      window.clearTimeout(this.timeout);
      this.timeout = undefined;
    }
  }
}

/**
 * Media query hydration - hydrate when media query matches
 */
export class MediaHydration implements HydrationStrategyImpl {
  private mediaQueryList?: MediaQueryList;
  private handler?: (event: MediaQueryListEvent) => void;

  constructor(
    private island: IslandInstance,
    private query: string,
  ) {}

  init(island: IslandInstance): void {
    this.mediaQueryList = window.matchMedia(this.query);

    // Check initial state
    if (this.mediaQueryList.matches) {
      island.hydrate().catch((err) => {
        console.error('[Aether Islands] Media hydration failed:', err);
        island.state = 'error';
        island.error = err;
      });
      return;
    }

    // Listen for changes
    this.handler = (event) => {
      if (event.matches) {
        island
          .hydrate()
          .catch((err) => {
            console.error('[Aether Islands] Media hydration failed:', err);
            island.state = 'error';
            island.error = err;
          })
          .finally(() => {
            this.cleanup();
          });
      }
    };

    this.mediaQueryList.addEventListener('change', this.handler);
  }

  cleanup(): void {
    if (this.mediaQueryList && this.handler) {
      this.mediaQueryList.removeEventListener('change', this.handler);
      this.handler = undefined;
      this.mediaQueryList = undefined;
    }
  }
}

/**
 * Custom hydration - hydrate based on custom condition
 */
export class CustomHydration implements HydrationStrategyImpl {
  private interval?: number;

  constructor(
    private island: IslandInstance,
    private shouldHydrate: () => boolean,
    private checkInterval = 100,
  ) {}

  init(island: IslandInstance): void {
    // Check immediately
    if (this.shouldHydrate()) {
      island.hydrate().catch((err) => {
        console.error('[Aether Islands] Custom hydration failed:', err);
        island.state = 'error';
        island.error = err;
      });
      return;
    }

    // Poll condition
    this.interval = window.setInterval(() => {
      if (this.shouldHydrate()) {
        island
          .hydrate()
          .catch((err) => {
            console.error('[Aether Islands] Custom hydration failed:', err);
            island.state = 'error';
            island.error = err;
          })
          .finally(() => {
            this.cleanup();
          });
      }
    }, this.checkInterval);
  }

  cleanup(): void {
    if (this.interval !== undefined) {
      window.clearInterval(this.interval);
      this.interval = undefined;
    }
  }
}

/**
 * Create hydration strategy instance
 */
export function createHydrationStrategy(
  island: IslandInstance,
  strategy: HydrationStrategy,
): HydrationStrategyImpl {
  const options = island.component.__islandOptions;

  switch (strategy) {
    case 'immediate':
      return new ImmediateHydration(island);

    case 'visible':
      return new VisibleHydration(island, options.rootMargin || '0px');

    case 'interaction':
      return new InteractionHydration(island, options.events || ['click', 'focus', 'touchstart', 'mouseenter']);

    case 'idle':
      return new IdleHydration(island, options.timeout || 2000);

    case 'media':
      if (!options.query) {
        throw new Error('[Aether Islands] Media hydration requires a query option');
      }
      return new MediaHydration(island, options.query);

    case 'custom':
      if (!options.shouldHydrate) {
        throw new Error('[Aether Islands] Custom hydration requires a shouldHydrate function');
      }
      return new CustomHydration(island, options.shouldHydrate);

    default:
      throw new Error(`[Aether Islands] Unknown hydration strategy: ${strategy}`);
  }
}

/**
 * Preload island code
 *
 * Preloads the JavaScript bundle for an island before hydration
 *
 * @param islandId - Island ID
 * @param manifest - Island manifest
 */
export async function preloadIsland(islandId: string, manifest?: any): Promise<void> {
  if (!manifest || !manifest.islands[islandId]) {
    console.warn(`[Aether Islands] Cannot preload island ${islandId}: not found in manifest`);
    return Promise.resolve();
  }

  const entry = manifest.islands[islandId];
  const chunk = entry.chunk;

  // Create link element for preload
  const link = document.createElement('link');
  link.rel = 'modulepreload';
  link.href = chunk;

  // Add to document
  document.head.appendChild(link);

  // Return promise that resolves when loaded
  return new Promise((resolve, reject) => {
    link.onload = () => resolve();
    link.onerror = () => reject(new Error(`Failed to preload island ${islandId}`));
  });
}

/**
 * Preload on intent (hover/focus)
 */
export function setupPreloadOnIntent(island: IslandInstance, manifest?: any): () => void {
  const listeners: Array<{ event: string; handler: EventListener }> = [];

  const preload = () => {
    preloadIsland(island.id, manifest).catch((err) => {
      console.error('[Aether Islands] Preload failed:', err);
    });

    // Remove listeners after first preload
    cleanup();
  };

  const events = ['mouseenter', 'focus'];
  events.forEach((eventName) => {
    const handler = preload;
    island.element.addEventListener(eventName, handler, { once: true });
    listeners.push({ event: eventName, handler });
  });

  const cleanup = () => {
    listeners.forEach(({ event, handler }) => {
      island.element.removeEventListener(event, handler);
    });
    listeners.length = 0;
  };

  return cleanup;
}

/**
 * Preload when near viewport
 */
export function setupPreloadOnViewport(island: IslandInstance, manifest?: any): () => void {
  let observer: IntersectionObserver | undefined;

  observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          preloadIsland(island.id, manifest).catch((err) => {
            console.error('[Aether Islands] Preload failed:', err);
          });

          // Disconnect after preload
          cleanup();
        }
      });
    },
    {
      rootMargin: '200px', // Preload when within 200px of viewport
    },
  );

  observer.observe(island.element);

  const cleanup = () => {
    if (observer) {
      observer.disconnect();
      observer = undefined;
    }
  };

  return cleanup;
}
