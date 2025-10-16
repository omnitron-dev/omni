/**
 * Fast Refresh for Aether
 *
 * Preserves component state during hot module replacement
 * Similar to React Fast Refresh but for Aether's signal-based components
 */

import type { ComponentState, FastRefreshConfig } from '../types.js';

interface ComponentMetadata {
  id: string;
  file: string;
  lastUpdate: number;
  state: ComponentState;
  signature: string;
}

/**
 * Fast Refresh Runtime
 */
export class FastRefresh {
  private components = new WeakMap<any, ComponentMetadata>();
  private componentsByFile = new Map<string, Set<any>>();
  private config: Required<FastRefreshConfig>;
  private refreshCallbacks = new Set<() => void>();

  constructor(config: FastRefreshConfig = {}) {
    this.config = {
      enabled: true,
      preserveLocalState: true,
      forceReset: false,
      ...config,
    };
  }

  /**
   * Register component for Fast Refresh
   */
  register(component: any, file: string, signature: string): void {
    if (!this.config.enabled) {
      return;
    }

    const metadata: ComponentMetadata = {
      id: this.generateId(file, signature),
      file,
      lastUpdate: Date.now(),
      state: {
        signals: new Map(),
        effects: new Set(),
        memos: new Map(),
      },
      signature,
    };

    this.components.set(component, metadata);

    // Track by file
    const fileComponents = this.componentsByFile.get(file) || new Set();
    fileComponents.add(component);
    this.componentsByFile.set(file, fileComponents);
  }

  /**
   * Preserve component state before update
   */
  preserveState(component: any): ComponentState | null {
    if (!this.config.preserveLocalState) {
      return null;
    }

    const metadata = this.components.get(component);

    if (!metadata) {
      return null;
    }

    const state: ComponentState = {
      signals: new Map(),
      effects: new Set(),
      memos: new Map(),
    };

    try {
      // Extract signal values
      // Note: This requires access to Aether's internal signal system
      if (typeof component.$$signals !== 'undefined') {
        for (const [key, signal] of Object.entries(component.$$signals)) {
          if (typeof (signal as any).get === 'function') {
            state.signals.set(key, (signal as any).get());
          }
        }
      }

      // Store effect subscriptions
      if (typeof component.$$effects !== 'undefined') {
        state.effects = new Set(component.$$effects);
      }

      // Store memo computations
      if (typeof component.$$memos !== 'undefined') {
        for (const [key, memo] of Object.entries(component.$$memos)) {
          if (typeof (memo as any).get === 'function') {
            state.memos.set(key, (memo as any).get());
          }
        }
      }

      metadata.state = state;
    } catch (_error) {
      console.error('[Fast Refresh] Failed to preserve state:', _error);
      return null;
    }

    return state;
  }

  /**
   * Restore component state after update
   */
  restoreState(component: any, state: ComponentState): void {
    if (!this.config.preserveLocalState) {
      return;
    }

    try {
      // Restore signal values
      if (typeof component.$$signals !== 'undefined') {
        for (const [key, value] of state.signals) {
          const signal = component.$$signals[key];

          if (signal && typeof signal.set === 'function') {
            signal.set(value);
          }
        }
      }

      // Restore effect subscriptions
      if (typeof component.$$effects !== 'undefined' && state.effects.size > 0) {
        // Re-run effects if needed
        // This is complex and may not be necessary in all cases
      }

      // Restore memo values
      if (typeof component.$$memos !== 'undefined') {
        for (const [key, value] of state.memos) {
          const memo = component.$$memos[key];

          // Memos recompute automatically, but we can seed the cache
          if (memo && typeof memo.set === 'function') {
            memo.set(value);
          }
        }
      }
    } catch (_error) {
      console.error('[Fast Refresh] Failed to restore state:', _error);
    }
  }

  /**
   * Check if component can be safely refreshed
   */
  canRefresh(file: string, oldModule: any, newModule: any): boolean {
    if (this.config.forceReset) {
      return false;
    }

    // Get old and new signatures
    const oldSignature = this.getModuleSignature(oldModule);
    const newSignature = this.getModuleSignature(newModule);

    if (!oldSignature || !newSignature) {
      // Can't determine signature, assume refresh is safe
      return true;
    }

    // Check if signatures match (safe to refresh)
    return oldSignature === newSignature;
  }

  /**
   * Perform component refresh
   */
  async refresh(file: string, newModule: any): Promise<void> {
    const components = this.componentsByFile.get(file);

    if (!components || components.size === 0) {
      console.log(`[Fast Refresh] No components to refresh for ${file}`);
      return;
    }

    const startTime = performance.now();

    try {
      // Preserve state for all components in this file
      const stateMap = new Map<any, ComponentState | null>();

      for (const component of components) {
        const state = this.preserveState(component);
        stateMap.set(component, state);
      }

      // Get new component definition from module
      const NewComponent = this.extractComponent(newModule);

      if (!NewComponent) {
        console.warn(`[Fast Refresh] Could not extract component from ${file}`);
        return;
      }

      // Update all instances
      for (const component of components) {
        const state = stateMap.get(component);

        // Replace component prototype/methods
        this.updateComponent(component, NewComponent);

        // Restore state if available
        if (state) {
          this.restoreState(component, state);
        }

        // Update metadata
        const metadata = this.components.get(component);

        if (metadata) {
          metadata.lastUpdate = Date.now();
          metadata.signature = this.getModuleSignature(newModule) || '';
        }
      }

      // Trigger re-render
      this.triggerRefresh();

      const duration = performance.now() - startTime;
      console.log(`[Fast Refresh] Refreshed ${components.size} component(s) in ${duration.toFixed(2)}ms`);
    } catch (error) {
      console.error('[Fast Refresh] Refresh failed:', error);
      throw error;
    }
  }

  /**
   * Update component with new definition
   */
  private updateComponent(oldComponent: any, NewComponent: any): void {
    // Copy over new methods and properties
    const prototype = Object.getPrototypeOf(oldComponent);
    const newPrototype = NewComponent.prototype;

    // Copy prototype methods
    for (const key of Object.getOwnPropertyNames(newPrototype)) {
      if (key !== 'constructor') {
        try {
          prototype[key] = newPrototype[key];
        } catch (_error) {
          // Read-only property, skip
        }
      }
    }

    // Copy static properties
    for (const key of Object.getOwnPropertyNames(NewComponent)) {
      if (key !== 'prototype' && key !== 'length' && key !== 'name') {
        try {
          oldComponent.constructor[key] = NewComponent[key];
        } catch (_error) {
          // Read-only property, skip
        }
      }
    }
  }

  /**
   * Extract component from module
   */
  private extractComponent(module: any): any {
    // Try to find the component export
    if (module.default) {
      return module.default;
    }

    // Look for named exports that might be components
    for (const key of Object.keys(module)) {
      const exported = module[key];

      if (typeof exported === 'function' && this.isComponent(exported)) {
        return exported;
      }
    }

    return null;
  }

  /**
   * Check if value is a component
   */
  private isComponent(value: any): boolean {
    // Check for common component patterns
    return (
      typeof value === 'function' &&
      (value.$$component === true || value.prototype?.$$component === true || /^[A-Z]/.test(value.name))
    );
  }

  /**
   * Get module signature for comparison
   */
  private getModuleSignature(module: any): string | null {
    if (!module) {
      return null;
    }

    try {
      // Generate signature from module structure
      const exports = Object.keys(module).sort();
      const signature = exports.join(',');

      // Include component names if available
      const components = exports
        .map((key) => {
          const value = module[key];
          return this.isComponent(value) ? value.name : null;
        })
        .filter(Boolean)
        .join(',');

      return `${signature}:${components}`;
    } catch (_error) {
      return null;
    }
  }

  /**
   * Generate unique component ID
   */
  private generateId(file: string, signature: string): string {
    return `${file}:${signature}`;
  }

  /**
   * Trigger component refresh
   */
  private triggerRefresh(): void {
    for (const callback of this.refreshCallbacks) {
      try {
        callback();
      } catch (error) {
        console.error('[Fast Refresh] Callback error:', error);
      }
    }

    // Dispatch custom event for app-level handling
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('aether:fast-refresh'));
    }
  }

  /**
   * Register refresh callback
   */
  onRefresh(callback: () => void): () => void {
    this.refreshCallbacks.add(callback);

    // Return unsubscribe function
    return () => {
      this.refreshCallbacks.delete(callback);
    };
  }

  /**
   * Clear all component data
   */
  clear(): void {
    this.componentsByFile.clear();
    this.refreshCallbacks.clear();
  }

  /**
   * Get refresh statistics
   */
  getStats(): {
    totalComponents: number;
    fileCount: number;
  } {
    let totalComponents = 0;

    for (const components of this.componentsByFile.values()) {
      totalComponents += components.size;
    }

    return {
      totalComponents,
      fileCount: this.componentsByFile.size,
    };
  }
}

/**
 * Global Fast Refresh instance
 */
let fastRefresh: FastRefresh | null = null;

/**
 * Initialize Fast Refresh
 */
export function initFastRefresh(config?: FastRefreshConfig): FastRefresh {
  if (!fastRefresh) {
    fastRefresh = new FastRefresh(config);
  }

  return fastRefresh;
}

/**
 * Get Fast Refresh instance
 */
export function getFastRefresh(): FastRefresh | null {
  return fastRefresh;
}

/**
 * Fast Refresh decorator for components
 */
export function withFastRefresh<T extends { new (...args: any[]): any }>(Component: T, file: string): T {
  const refresh = getFastRefresh();

  if (!refresh) {
    return Component;
  }

  // Generate signature from component definition
  const signature = Component.toString();

  // Register component
  class FastRefreshComponent extends Component {
    constructor(...args: any[]) {
      super(...args);
      refresh.register(this, file, signature);
    }
  }

  // Preserve original name
  Object.defineProperty(FastRefreshComponent, 'name', {
    value: Component.name,
  });

  return FastRefreshComponent as T;
}
