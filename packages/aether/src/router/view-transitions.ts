/**
 * View Transitions API Integration
 *
 * Provides smooth page transitions using the native View Transitions API
 * with fallback animations for unsupported browsers
 */

/**
 * View transition configuration
 */
export interface ViewTransitionConfig {
  /** Enable view transitions */
  enabled?: boolean;
  /** Fallback duration for unsupported browsers (ms) */
  fallbackDuration?: number;
  /** Default transition type */
  defaultType?: 'fade' | 'slide' | 'scale' | 'none';
  /** Custom transition names for elements */
  customNames?: Record<string, string>;
  /** Skip transitions based on condition */
  skipTransition?: (from: string, to: string) => boolean;
}

/**
 * View transition options for specific navigation
 */
export interface ViewTransitionOptions {
  /** Transition type for this navigation */
  type?: 'fade' | 'slide' | 'scale' | 'none';
  /** Custom transition name */
  name?: string;
  /** Skip transition for this navigation */
  skip?: boolean;
}

/**
 * View transition lifecycle hooks
 */
export interface ViewTransitionHooks {
  /** Called before transition starts */
  onBeforeTransition?: (from: string, to: string) => void | Promise<void>;
  /** Called after transition completes */
  onAfterTransition?: (from: string, to: string) => void | Promise<void>;
  /** Called if transition fails */
  onTransitionError?: (error: Error) => void;
}

/**
 * Check if View Transitions API is supported
 */
export function supportsViewTransitions(): boolean {
  if (typeof document === 'undefined') {
    return false;
  }
  return 'startViewTransition' in document;
}

/**
 * View Transitions Manager
 */
export class ViewTransitionsManager {
  private config: Required<ViewTransitionConfig>;
  private hooks: ViewTransitionHooks;
  private currentTransition: any = null;
  private transitionGroups = new Map<string, Set<Element>>();

  constructor(config: ViewTransitionConfig = {}, hooks: ViewTransitionHooks = {}) {
    this.config = {
      enabled: config.enabled ?? true,
      fallbackDuration: config.fallbackDuration ?? 300,
      defaultType: config.defaultType ?? 'fade',
      customNames: config.customNames ?? {},
      skipTransition: config.skipTransition ?? (() => false),
    };
    this.hooks = hooks;
  }

  /**
   * Execute a navigation with view transition
   */
  async executeTransition(
    from: string,
    to: string,
    updateDOM: () => void | Promise<void>,
    options: ViewTransitionOptions = {}
  ): Promise<void> {
    // Check if transitions are enabled
    if (!this.config.enabled || options.skip || this.config.skipTransition(from, to)) {
      await updateDOM();
      return;
    }

    // Call before hook
    if (this.hooks.onBeforeTransition) {
      await this.hooks.onBeforeTransition(from, to);
    }

    try {
      if (supportsViewTransitions()) {
        // Use native View Transitions API
        await this.executeNativeTransition(updateDOM, options);
      } else {
        // Use fallback animation
        await this.executeFallbackTransition(updateDOM, options);
      }

      // Call after hook
      if (this.hooks.onAfterTransition) {
        await this.hooks.onAfterTransition(from, to);
      }
    } catch (error) {
      // Call error hook
      if (this.hooks.onTransitionError && error instanceof Error) {
        this.hooks.onTransitionError(error);
      }
      throw error;
    }
  }

  /**
   * Execute transition using native API
   */
  private async executeNativeTransition(
    updateDOM: () => void | Promise<void>,
    _options: ViewTransitionOptions
  ): Promise<void> {
    const doc = document as any;

    // Start view transition
    this.currentTransition = doc.startViewTransition(async () => {
      await updateDOM();
    });

    // Wait for transition to complete
    await this.currentTransition.finished;
    this.currentTransition = null;
  }

  /**
   * Execute fallback transition for unsupported browsers
   */
  private async executeFallbackTransition(
    updateDOM: () => void | Promise<void>,
    options: ViewTransitionOptions
  ): Promise<void> {
    const type = options.type || this.config.defaultType;
    const duration = this.config.fallbackDuration;

    // Get the root element
    const root = document.getElementById('app') || document.body;

    // Apply exit animation
    this.applyFallbackAnimation(root, type, 'exit');

    // Wait for exit animation
    await this.delay(duration / 2);

    // Update DOM
    await updateDOM();

    // Apply enter animation
    this.applyFallbackAnimation(root, type, 'enter');

    // Wait for enter animation
    await this.delay(duration / 2);

    // Clean up animation classes
    root.style.animation = '';
  }

  /**
   * Apply fallback animation
   */
  private applyFallbackAnimation(element: HTMLElement, type: string, phase: 'enter' | 'exit'): void {
    const duration = this.config.fallbackDuration;

    switch (type) {
      case 'fade':
        if (phase === 'exit') {
          element.style.animation = `fadeOut ${duration / 2}ms ease-out`;
        } else {
          element.style.animation = `fadeIn ${duration / 2}ms ease-in`;
        }
        break;

      case 'slide':
        if (phase === 'exit') {
          element.style.animation = `slideOutLeft ${duration / 2}ms ease-out`;
        } else {
          element.style.animation = `slideInRight ${duration / 2}ms ease-in`;
        }
        break;

      case 'scale':
        if (phase === 'exit') {
          element.style.animation = `scaleOut ${duration / 2}ms ease-out`;
        } else {
          element.style.animation = `scaleIn ${duration / 2}ms ease-in`;
        }
        break;

      case 'none':
      default:
        // No animation
        break;
    }
  }

  /**
   * Set custom transition name for an element
   */
  setTransitionName(element: Element, name: string): void {
    if (supportsViewTransitions()) {
      (element as HTMLElement).style.viewTransitionName = name;
    }
  }

  /**
   * Remove transition name from an element
   */
  removeTransitionName(element: Element): void {
    if (supportsViewTransitions()) {
      (element as HTMLElement).style.viewTransitionName = '';
    }
  }

  /**
   * Register element in a transition group
   */
  addToGroup(groupName: string, element: Element): void {
    if (!this.transitionGroups.has(groupName)) {
      this.transitionGroups.set(groupName, new Set());
    }
    this.transitionGroups.get(groupName)!.add(element);
  }

  /**
   * Remove element from a transition group
   */
  removeFromGroup(groupName: string, element: Element): void {
    const group = this.transitionGroups.get(groupName);
    if (group) {
      group.delete(element);
      if (group.size === 0) {
        this.transitionGroups.delete(groupName);
      }
    }
  }

  /**
   * Apply transition names to all elements in a group
   */
  applyGroupTransitions(groupName: string): void {
    const group = this.transitionGroups.get(groupName);
    if (group && supportsViewTransitions()) {
      group.forEach((element, index) => {
        this.setTransitionName(element, `${groupName}-${index}`);
      });
    }
  }

  /**
   * Skip current transition
   */
  skipCurrentTransition(): void {
    if (this.currentTransition && this.currentTransition.skipTransition) {
      this.currentTransition.skipTransition();
    }
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ViewTransitionConfig>): void {
    Object.assign(this.config, config);
  }

  /**
   * Helper to delay execution
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Create CSS for fallback animations
 */
export function injectFallbackStyles(): void {
  if (typeof document === 'undefined') {
    return;
  }

  // Check if styles are already injected
  if (document.getElementById('aether-view-transitions-fallback')) {
    return;
  }

  const style = document.createElement('style');
  style.id = 'aether-view-transitions-fallback';
  style.textContent = `
    @keyframes fadeOut {
      from { opacity: 1; }
      to { opacity: 0; }
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    @keyframes slideOutLeft {
      from { transform: translateX(0); opacity: 1; }
      to { transform: translateX(-100%); opacity: 0; }
    }

    @keyframes slideInRight {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }

    @keyframes scaleOut {
      from { transform: scale(1); opacity: 1; }
      to { transform: scale(0.8); opacity: 0; }
    }

    @keyframes scaleIn {
      from { transform: scale(1.2); opacity: 0; }
      to { transform: scale(1); opacity: 1; }
    }
  `;

  document.head.appendChild(style);
}

/**
 * Default view transitions manager instance
 */
let defaultManager: ViewTransitionsManager | null = null;

/**
 * Get or create default view transitions manager
 */
export function getViewTransitionsManager(
  config?: ViewTransitionConfig,
  hooks?: ViewTransitionHooks
): ViewTransitionsManager {
  if (!defaultManager) {
    defaultManager = new ViewTransitionsManager(config, hooks);
    injectFallbackStyles();
  }
  return defaultManager;
}

/**
 * Set the default view transitions manager
 */
export function setViewTransitionsManager(manager: ViewTransitionsManager): void {
  defaultManager = manager;
}

/**
 * Morphing transition helper - marks elements for morphing between pages
 */
export function setupMorphTransition(fromElement: Element, toElement: Element, name: string): void {
  const manager = getViewTransitionsManager();
  manager.setTransitionName(fromElement, name);
  manager.setTransitionName(toElement, name);
}

/**
 * Clean up morph transition
 */
export function cleanupMorphTransition(element: Element): void {
  const manager = getViewTransitionsManager();
  manager.removeTransitionName(element);
}
