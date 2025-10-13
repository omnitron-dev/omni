/**
 * Scroll Restoration
 *
 * Advanced scroll position management with per-route behavior,
 * smooth scrolling, and hash-based navigation
 */

/**
 * Scroll position
 */
export interface ScrollPosition {
  left: number;
  top: number;
}

/**
 * Scroll behavior type
 */
export type ScrollBehaviorType = 'auto' | 'smooth' | 'instant';

/**
 * Scroll restoration configuration
 */
export interface ScrollRestorationConfig {
  /** Enable scroll restoration */
  enabled?: boolean;
  /** Default scroll behavior */
  behavior?: ScrollBehaviorType;
  /** Scroll to top on navigation */
  scrollToTop?: boolean;
  /** Save scroll positions */
  savePosition?: boolean;
  /** Maximum saved positions */
  maxSavedPositions?: number;
  /** Delay before restoring scroll (ms) */
  restoreDelay?: number;
  /** Enable hash scrolling */
  hashScrolling?: boolean;
  /** Hash scroll offset (px) */
  hashScrollOffset?: number;
}

/**
 * Scroll options for navigation
 */
export interface ScrollOptions {
  /** Target position */
  position?: ScrollPosition;
  /** Target element selector */
  selector?: string;
  /** Scroll behavior */
  behavior?: ScrollBehaviorType;
  /** Offset from target (px) */
  offset?: number;
  /** Skip scroll restoration */
  skip?: boolean;
}

/**
 * Saved scroll state
 */
interface ScrollState {
  position: ScrollPosition;
  timestamp: number;
  pathname: string;
}

/**
 * Scroll Restoration Manager
 */
export class ScrollRestorationManager {
  private config: Required<ScrollRestorationConfig>;
  private savedPositions = new Map<string, ScrollState>();
  private currentPath: string = '';
  private isRestoring = false;
  private scrollElements = new Map<string, Element>();

  constructor(config: ScrollRestorationConfig = {}) {
    this.config = {
      enabled: config.enabled ?? true,
      behavior: config.behavior ?? 'smooth',
      scrollToTop: config.scrollToTop ?? true,
      savePosition: config.savePosition ?? true,
      maxSavedPositions: config.maxSavedPositions ?? 50,
      restoreDelay: config.restoreDelay ?? 0,
      hashScrolling: config.hashScrolling ?? true,
      hashScrollOffset: config.hashScrollOffset ?? 0,
    };

    this.initialize();
  }

  /**
   * Initialize scroll restoration
   */
  private initialize(): void {
    if (typeof window === 'undefined' || !this.config.enabled) {
      return;
    }

    // Disable browser's automatic scroll restoration
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual';
    }

    // Save current path
    this.currentPath = window.location.pathname;

    // Save scroll position before navigation
    window.addEventListener('beforeunload', () => {
      this.saveCurrentPosition();
    });

    // Listen to scroll events to update saved position
    let scrollTimeout: NodeJS.Timeout;
    window.addEventListener(
      'scroll',
      () => {
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
          if (!this.isRestoring) {
            this.saveCurrentPosition();
          }
        }, 100);
      },
      { passive: true }
    );
  }

  /**
   * Handle navigation scroll behavior
   */
  async handleNavigation(
    from: string,
    to: string,
    options: ScrollOptions = {},
    isPop: boolean = false
  ): Promise<void> {
    if (!this.config.enabled || options.skip) {
      return;
    }

    // Save current position before navigation
    this.savePosition(from);

    // Wait for delay if configured
    if (this.config.restoreDelay > 0) {
      await this.delay(this.config.restoreDelay);
    }

    // Determine scroll behavior
    if (isPop && this.config.savePosition) {
      // Restore saved position for back/forward navigation
      await this.restorePosition(to, options);
    } else if (options.position) {
      // Scroll to specific position
      await this.scrollTo(options.position, options.behavior);
    } else if (options.selector) {
      // Scroll to specific element
      await this.scrollToElement(options.selector, options);
    } else if (this.config.hashScrolling && window.location.hash) {
      // Scroll to hash target
      await this.scrollToHash(window.location.hash, options);
    } else if (this.config.scrollToTop) {
      // Scroll to top
      await this.scrollTo({ left: 0, top: 0 }, options.behavior);
    }

    this.currentPath = to;
  }

  /**
   * Save current scroll position
   */
  saveCurrentPosition(): void {
    if (!this.config.savePosition || typeof window === 'undefined') {
      return;
    }

    this.savePosition(this.currentPath);
  }

  /**
   * Save scroll position for a path
   */
  savePosition(path: string): void {
    if (!this.config.savePosition || typeof window === 'undefined') {
      return;
    }

    const position: ScrollPosition = {
      left: window.scrollX || window.pageXOffset || 0,
      top: window.scrollY || window.pageYOffset || 0,
    };

    this.savedPositions.set(path, {
      position,
      timestamp: Date.now(),
      pathname: path,
    });

    // Evict old positions if too many
    this.evictOldPositions();
  }

  /**
   * Restore scroll position for a path
   */
  async restorePosition(path: string, options: ScrollOptions = {}): Promise<void> {
    const saved = this.savedPositions.get(path);
    if (!saved) {
      // No saved position, scroll to top if configured
      if (this.config.scrollToTop) {
        await this.scrollTo({ left: 0, top: 0 }, options.behavior);
      }
      return;
    }

    this.isRestoring = true;
    await this.scrollTo(saved.position, options.behavior);
    this.isRestoring = false;
  }

  /**
   * Scroll to a specific position
   */
  async scrollTo(position: ScrollPosition, behavior?: ScrollBehaviorType): Promise<void> {
    if (typeof window === 'undefined') {
      return;
    }

    const scrollBehavior = behavior || this.config.behavior;

    window.scrollTo({
      left: position.left,
      top: position.top,
      behavior: scrollBehavior,
    });

    // Wait for smooth scroll to complete
    if (scrollBehavior === 'smooth') {
      await this.waitForScrollEnd();
    }
  }

  /**
   * Scroll to an element by selector
   */
  async scrollToElement(selector: string, options: ScrollOptions = {}): Promise<void> {
    if (typeof document === 'undefined') {
      return;
    }

    const element = document.querySelector(selector);
    if (!element) {
      console.warn(`Scroll target not found: ${selector}`);
      return;
    }

    const rect = element.getBoundingClientRect();
    const offset = options.offset ?? 0;
    const behavior = options.behavior || this.config.behavior;

    const top = window.scrollY + rect.top - offset;

    await this.scrollTo({ left: 0, top }, behavior);
  }

  /**
   * Scroll to hash target
   */
  async scrollToHash(hash: string, options: ScrollOptions = {}): Promise<void> {
    if (!hash || hash === '#') {
      return;
    }

    // Remove leading #
    const id = hash.slice(1);

    // Try to find element by id or name
    const element = document.getElementById(id) || document.querySelector(`[name="${id}"]`);

    if (!element) {
      console.warn(`Hash target not found: ${hash}`);
      return;
    }

    const offset = options.offset ?? this.config.hashScrollOffset;
    await this.scrollToElement(`#${id}`, { ...options, offset });
  }

  /**
   * Register a scrollable element
   */
  registerScrollElement(name: string, element: Element): void {
    this.scrollElements.set(name, element);
  }

  /**
   * Unregister a scrollable element
   */
  unregisterScrollElement(name: string): void {
    this.scrollElements.delete(name);
  }

  /**
   * Scroll a registered element
   */
  async scrollElement(
    name: string,
    position: ScrollPosition,
    behavior?: ScrollBehaviorType
  ): Promise<void> {
    const element = this.scrollElements.get(name);
    if (!element) {
      console.warn(`Scroll element not found: ${name}`);
      return;
    }

    const scrollBehavior = behavior || this.config.behavior;

    element.scrollTo({
      left: position.left,
      top: position.top,
      behavior: scrollBehavior,
    });

    // Wait for smooth scroll to complete
    if (scrollBehavior === 'smooth') {
      await this.waitForScrollEnd(element);
    }
  }

  /**
   * Get saved position for a path
   */
  getSavedPosition(path: string): ScrollPosition | null {
    const saved = this.savedPositions.get(path);
    return saved ? saved.position : null;
  }

  /**
   * Clear saved positions
   */
  clearSavedPositions(path?: string): void {
    if (path) {
      this.savedPositions.delete(path);
    } else {
      this.savedPositions.clear();
    }
  }

  /**
   * Get all saved positions
   */
  getSavedPositions(): Map<string, ScrollState> {
    return new Map(this.savedPositions);
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ScrollRestorationConfig>): void {
    Object.assign(this.config, config);

    // Re-enable/disable browser scroll restoration
    if (typeof window !== 'undefined' && 'scrollRestoration' in window.history) {
      window.history.scrollRestoration = this.config.enabled ? 'manual' : 'auto';
    }
  }

  /**
   * Dispose and cleanup
   */
  dispose(): void {
    this.savedPositions.clear();
    this.scrollElements.clear();

    // Re-enable browser scroll restoration
    if (typeof window !== 'undefined' && 'scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'auto';
    }
  }

  /**
   * Wait for scroll animation to complete
   */
  private async waitForScrollEnd(element: Element | Window = window): Promise<void> {
    return new Promise<void>((resolve) => {
      let lastScrollTop = element === window ? window.scrollY : (element as Element).scrollTop;
      let scrollTimeout: NodeJS.Timeout;

      const checkScroll = () => {
        const currentScrollTop = element === window ? window.scrollY : (element as Element).scrollTop;

        if (Math.abs(currentScrollTop - lastScrollTop) < 1) {
          // Scroll has stopped
          resolve();
        } else {
          lastScrollTop = currentScrollTop;
          scrollTimeout = setTimeout(checkScroll, 50);
        }
      };

      scrollTimeout = setTimeout(checkScroll, 50);

      // Failsafe timeout
      setTimeout(() => {
        clearTimeout(scrollTimeout);
        resolve();
      }, 2000);
    });
  }

  /**
   * Evict old saved positions
   */
  private evictOldPositions(): void {
    if (this.savedPositions.size <= this.config.maxSavedPositions) {
      return;
    }

    // Sort by timestamp and remove oldest
    const entries = Array.from(this.savedPositions.entries()).sort(
      (a, b) => a[1].timestamp - b[1].timestamp
    );

    const toRemove = entries.slice(0, this.savedPositions.size - this.config.maxSavedPositions);
    for (const [path] of toRemove) {
      this.savedPositions.delete(path);
    }
  }

  /**
   * Helper to delay execution
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Default scroll restoration manager
 */
let defaultManager: ScrollRestorationManager | null = null;

/**
 * Get or create default scroll restoration manager
 */
export function getScrollRestorationManager(config?: ScrollRestorationConfig): ScrollRestorationManager {
  if (!defaultManager) {
    defaultManager = new ScrollRestorationManager(config);
  }
  return defaultManager;
}

/**
 * Set default scroll restoration manager
 */
export function setScrollRestorationManager(manager: ScrollRestorationManager): void {
  defaultManager = manager;
}

/**
 * Save current scroll position (helper)
 */
export function saveScrollPosition(path?: string): void {
  const manager = getScrollRestorationManager();
  if (path) {
    manager.savePosition(path);
  } else {
    manager.saveCurrentPosition();
  }
}

/**
 * Restore scroll position (helper)
 */
export async function restoreScrollPosition(path: string, options?: ScrollOptions): Promise<void> {
  const manager = getScrollRestorationManager();
  await manager.restorePosition(path, options);
}

/**
 * Scroll to top (helper)
 */
export async function scrollToTop(behavior?: ScrollBehaviorType): Promise<void> {
  const manager = getScrollRestorationManager();
  await manager.scrollTo({ left: 0, top: 0 }, behavior);
}

/**
 * Scroll to element (helper)
 */
export async function scrollToElement(selector: string, options?: ScrollOptions): Promise<void> {
  const manager = getScrollRestorationManager();
  await manager.scrollToElement(selector, options);
}

/**
 * Scroll to hash (helper)
 */
export async function scrollToHash(hash: string, options?: ScrollOptions): Promise<void> {
  const manager = getScrollRestorationManager();
  await manager.scrollToHash(hash, options);
}
