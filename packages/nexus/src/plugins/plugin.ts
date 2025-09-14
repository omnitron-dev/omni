/**
 * Plugin system for Nexus DI Container
 */

import { IContainer, ResolutionContext, InjectionToken } from '../types/core';

/**
 * Plugin lifecycle hooks
 */
export interface PluginHooks {
  /**
   * Called before a dependency is resolved
   */
  beforeResolve?: <T>(token: InjectionToken<T>, context: ResolutionContext) => void | Promise<void>;
  
  /**
   * Called after a dependency is resolved
   */
  afterResolve?: <T>(token: InjectionToken<T>, instance: T, context: ResolutionContext) => void | Promise<void>;
  
  /**
   * Called before a dependency is registered
   */
  beforeRegister?: <T>(token: InjectionToken<T>, provider: any) => void | Promise<void>;
  
  /**
   * Called after a dependency is registered
   */
  afterRegister?: <T>(token: InjectionToken<T>) => void | Promise<void>;
  
  /**
   * Called when an error occurs during resolution
   */
  onError?: (error: Error, token?: InjectionToken<any>, context?: ResolutionContext) => void | Promise<void>;
  
  /**
   * Called when container is being disposed
   */
  onDispose?: () => void | Promise<void>;
  
  /**
   * Called when cache is cleared
   */
  onCacheClear?: () => void | Promise<void>;
}

/**
 * Plugin interface
 */
export interface Plugin {
  /**
   * Plugin name
   */
  name: string;
  
  /**
   * Plugin version
   */
  version: string;
  
  /**
   * Plugin description
   */
  description?: string;
  
  /**
   * Install the plugin into container
   */
  install(container: IContainer): void;
  
  /**
   * Uninstall the plugin from container
   */
  uninstall?(container: IContainer): void;
  
  /**
   * Plugin hooks
   */
  hooks?: PluginHooks;
  
  /**
   * Plugin dependencies (other plugin names)
   */
  dependencies?: string[];
  
  /**
   * Plugin configuration
   */
  config?: Record<string, any>;
}

/**
 * Plugin manager for managing plugins
 */
export class PluginManager {
  private plugins = new Map<string, Plugin>();
  private hooks = new Map<keyof PluginHooks, Array<Function>>();
  private container: IContainer;
  
  constructor(container: IContainer) {
    this.container = container;
  }
  
  /**
   * Install a plugin
   */
  install(plugin: Plugin): void {
    // Check if already installed
    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin ${plugin.name} is already installed`);
    }
    
    // Check dependencies
    if (plugin.dependencies) {
      for (const dep of plugin.dependencies) {
        if (!this.plugins.has(dep)) {
          throw new Error(`Plugin ${plugin.name} requires ${dep} to be installed first`);
        }
      }
    }
    
    // Install the plugin
    plugin.install(this.container);
    
    // Register hooks
    if (plugin.hooks) {
      for (const [hookName, hookFn] of Object.entries(plugin.hooks)) {
        this.addHook(hookName as keyof PluginHooks, hookFn);
      }
    }
    
    // Store plugin
    this.plugins.set(plugin.name, plugin);
  }
  
  /**
   * Uninstall a plugin
   */
  uninstall(pluginName: string): void {
    const plugin = this.plugins.get(pluginName);
    if (!plugin) {
      throw new Error(`Plugin ${pluginName} is not installed`);
    }
    
    // Check if other plugins depend on this
    for (const [name, p] of this.plugins) {
      if (p.dependencies?.includes(pluginName)) {
        throw new Error(`Cannot uninstall ${pluginName}: ${name} depends on it`);
      }
    }
    
    // Uninstall the plugin
    if (plugin.uninstall) {
      plugin.uninstall(this.container);
    }
    
    // Remove hooks
    if (plugin.hooks) {
      for (const [hookName, hookFn] of Object.entries(plugin.hooks)) {
        this.removeHook(hookName as keyof PluginHooks, hookFn);
      }
    }
    
    // Remove from registry
    this.plugins.delete(pluginName);
  }
  
  /**
   * Check if a plugin is installed
   */
  has(pluginName: string): boolean {
    return this.plugins.has(pluginName);
  }
  
  /**
   * Get a plugin
   */
  get(pluginName: string): Plugin | undefined {
    return this.plugins.get(pluginName);
  }
  
  /**
   * Get all installed plugins
   */
  getAll(): Plugin[] {
    return Array.from(this.plugins.values());
  }
  
  /**
   * Add a hook
   */
  addHook(name: keyof PluginHooks, fn: Function): void {
    const hooks = this.hooks.get(name) || [];
    hooks.push(fn);
    this.hooks.set(name, hooks);
  }
  
  /**
   * Remove a hook
   */
  removeHook(name: keyof PluginHooks, fn: Function): void {
    const hooks = this.hooks.get(name);
    if (hooks) {
      const index = hooks.indexOf(fn);
      if (index !== -1) {
        hooks.splice(index, 1);
      }
    }
  }
  
  /**
   * Execute hooks
   */
  async executeHooks(name: keyof PluginHooks, ...args: any[]): Promise<void> {
    const hooks = this.hooks.get(name);
    if (hooks) {
      for (const hook of hooks) {
        await hook(...args);
      }
    }
  }
  
  /**
   * Execute hooks synchronously
   */
  executeHooksSync(name: keyof PluginHooks, ...args: any[]): void {
    const hooks = this.hooks.get(name);
    if (hooks) {
      for (const hook of hooks) {
        hook(...args);
      }
    }
  }
  
  /**
   * Dispose all plugins
   */
  async dispose(): Promise<void> {
    // Execute dispose hooks
    await this.executeHooks('onDispose');
    
    // Uninstall all plugins in reverse order
    const plugins = Array.from(this.plugins.keys()).reverse();
    for (const pluginName of plugins) {
      try {
        this.uninstall(pluginName);
      } catch (error) {
        console.error(`Failed to uninstall plugin ${pluginName}:`, error);
      }
    }
    
    // Clear all state
    this.plugins.clear();
    this.hooks.clear();
  }
}

/**
 * Create a plugin
 */
export function createPlugin(config: Plugin): Plugin {
  return config;
}

/**
 * Built-in validation plugin
 */
export const ValidationPlugin = createPlugin({
  name: 'validation',
  version: '1.0.0',
  description: 'Provides validation for registered providers',
  
  install(container: IContainer) {
    // Add validation logic
    console.log('Validation plugin installed');
  },
  
  hooks: {
    beforeResolve: (token, context) => {
      // Validate token metadata
      if (token && typeof token === 'object' && 'metadata' in token) {
        const metadata = (token as any).metadata;
        if (metadata.validate) {
          metadata.validate(context);
        }
      }
    }
  }
});

/**
 * Built-in metrics plugin
 */
export const MetricsPlugin = createPlugin({
  name: 'metrics',
  version: '1.0.0',
  description: 'Collects metrics about dependency resolution',
  
  install(container: IContainer) {
    const metrics = new Map<string, number>();
    (container as any).__metrics = metrics;
    
    // Store reference for hooks to access
    (MetricsPlugin as any).__container = container;
  },
  
  hooks: {
    afterResolve: (token, instance, context) => {
      const container = (MetricsPlugin as any).__container;
      if (container && container.__metrics) {
        const name = typeof token === 'string' ? token : 
                     typeof token === 'symbol' ? token.toString() :
                     token?.name || 'unknown';
        const count = container.__metrics.get(name) || 0;
        container.__metrics.set(name, count + 1);
      }
    }
  }
});

/**
 * Built-in logging plugin
 */
export const LoggingPlugin = createPlugin({
  name: 'logging',
  version: '1.0.0',
  description: 'Logs dependency resolution',
  
  config: {
    logLevel: 'info'
  },
  
  install(container: IContainer) {
    console.log('[Nexus] Logging plugin installed');
  },
  
  hooks: {
    beforeResolve: (token) => {
      const name = typeof token === 'string' ? token :
                   typeof token === 'symbol' ? token.toString() :
                   token?.name || 'unknown';
      console.log(`[Nexus] Resolving: ${name}`);
    },
    
    afterResolve: (token, instance) => {
      const name = typeof token === 'string' ? token :
                   typeof token === 'symbol' ? token.toString() :
                   token?.name || 'unknown';
      console.log(`[Nexus] Resolved: ${name}`, instance?.constructor?.name || typeof instance);
    },
    
    onError: (error, token) => {
      const name = token ? (typeof token === 'string' ? token :
                           typeof token === 'symbol' ? token.toString() :
                           token?.name || 'unknown') : 'unknown';
      console.error(`[Nexus] Error resolving ${name}:`, error);
    }
  }
});

/**
 * Performance monitoring plugin
 */
export const PerformancePlugin = createPlugin({
  name: 'performance',
  version: '1.0.0',
  description: 'Monitors resolution performance',
  
  install(container: IContainer) {
    const timings = new Map<string, number[]>();
    (container as any).__timings = timings;
    (container as any).__activeTimers = new Map<string, number>();
  },
  
  hooks: {
    beforeResolve: (token) => {
      const container = this as any;
      if (container.__activeTimers) {
        const name = typeof token === 'string' ? token :
                     typeof token === 'symbol' ? token.toString() :
                     token?.name || 'unknown';
        container.__activeTimers.set(name, Date.now());
      }
    },
    
    afterResolve: (token) => {
      const container = this as any;
      if (container.__activeTimers && container.__timings) {
        const name = typeof token === 'string' ? token :
                     typeof token === 'symbol' ? token.toString() :
                     token?.name || 'unknown';
        const start = container.__activeTimers.get(name);
        if (start) {
          const duration = Date.now() - start;
          const timings = container.__timings.get(name) || [];
          timings.push(duration);
          container.__timings.set(name, timings);
          container.__activeTimers.delete(name);
          
          if (duration > 100) {
            console.warn(`[Nexus] Slow resolution: ${name} took ${duration}ms`);
          }
        }
      }
    }
  }
});

/**
 * Caching plugin for aggressive caching strategies
 */
export const CachingPlugin = createPlugin({
  name: 'caching',
  version: '1.0.0',
  description: 'Advanced caching strategies',
  
  config: {
    ttl: 60000, // 1 minute default
    maxSize: 1000
  },
  
  install(container: IContainer) {
    const cache = new Map<string, { value: any; timestamp: number }>();
    const config = this.config!;
    
    (container as any).__cache = cache;
    (container as any).__cacheConfig = config;
    
    // Periodic cleanup
    const interval = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of cache.entries()) {
        if (now - entry.timestamp > config.ttl) {
          cache.delete(key);
        }
      }
      
      // Size limit
      if (cache.size > config.maxSize) {
        const toDelete = cache.size - config.maxSize;
        const keys = Array.from(cache.keys());
        for (let i = 0; i < toDelete; i++) {
          cache.delete(keys[i]);
        }
      }
    }, 30000); // Check every 30 seconds
    
    (container as any).__cacheInterval = interval;
  },
  
  uninstall(container: IContainer) {
    const interval = (container as any).__cacheInterval;
    if (interval) {
      clearInterval(interval);
    }
    delete (container as any).__cache;
    delete (container as any).__cacheConfig;
    delete (container as any).__cacheInterval;
  },
  
  hooks: {
    onDispose: () => {
      const container = this as any;
      if (container.__cacheInterval) {
        clearInterval(container.__cacheInterval);
      }
    },
    
    onCacheClear: () => {
      const container = this as any;
      if (container.__cache) {
        container.__cache.clear();
      }
    }
  }
});