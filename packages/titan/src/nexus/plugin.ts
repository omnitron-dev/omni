/**
 * Plugin system for Nexus DI Container
 *
 * The plugin system allows extending container functionality with custom behaviors,
 * middleware, hooks, and integrations. Plugins can intercept resolution, registration,
 * and lifecycle events.
 *
 * @experimental
 * @since 0.1.0
 */

import { createMiddleware } from './middleware.js';
import { IContainer, InjectionToken, ResolutionContext } from './types.js';
import { Errors, ValidationError } from '../errors/index.js';

/**
 * Plugin hook function type.
 *
 * @experimental
 * @since 0.1.0
 */
export type PluginHookFunction = (...args: unknown[]) => void | Promise<void>;

/**
 * Plugin lifecycle hooks.
 * Define callbacks for various container events.
 *
 * @experimental
 * @since 0.1.0
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
 * Plugin interface.
 * Defines the structure for container plugins.
 *
 * @experimental
 * @since 0.1.0
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
   * Plugin requirements (version ranges)
   */
  requires?: Record<string, string>;

  /**
   * Plugin configuration
   */
  config?: Record<string, any>;
}

/**
 * Plugin manager for managing plugins.
 *
 * @experimental
 * @since 0.1.0
 */
export class PluginManager {
  private plugins = new Map<string, Plugin>();
  private hooks = new Map<keyof PluginHooks, Array<(...args: any[]) => any>>();
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
      throw Errors.conflict(`Plugin already installed`, { plugin: plugin.name });
    }

    // Check requirements (compatibility)
    if (plugin.requires) {
      for (const [requirement, versionRange] of Object.entries(plugin.requires)) {
        if (requirement === 'nexus') {
          // Check nexus version compatibility
          const nexusVersion = '2.0.0'; // Current version
          if (!this.isCompatibleVersion(nexusVersion, versionRange)) {
            throw Errors.badRequest(`Plugin version incompatible`, {
              plugin: plugin.name,
              required: versionRange,
              actual: nexusVersion,
            });
          }
        }
        // Add other requirement checks as needed
      }
    }

    // Check dependencies
    if (plugin.dependencies) {
      for (const dep of plugin.dependencies) {
        if (!this.plugins.has(dep)) {
          throw Errors.notFound('Plugin dependency', dep);
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
      throw Errors.notFound('Plugin', pluginName);
    }

    // Check if other plugins depend on this
    for (const [name, p] of this.plugins) {
      if (p.dependencies?.includes(pluginName)) {
        throw Errors.conflict(`Cannot uninstall plugin`, { plugin: pluginName, dependentPlugin: name });
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
  addHook(name: keyof PluginHooks, fn: PluginHookFunction): void {
    const hooks = this.hooks.get(name) || [];
    hooks.push(fn);
    this.hooks.set(name, hooks);
  }

  /**
   * Remove a hook
   */
  removeHook(name: keyof PluginHooks, fn: PluginHookFunction): void {
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
   * For afterResolve hooks, returns the potentially modified value
   */
  executeHooksSync(name: keyof PluginHooks, ...args: any[]): any {
    const hooks = this.hooks.get(name);
    if (hooks) {
      // Special handling for afterResolve to allow value modification
      if (name === 'afterResolve' && args.length >= 2) {
        let value = args[1]; // The resolved instance is the second argument
        for (const hook of hooks) {
          const result = hook(args[0], value, ...args.slice(2));
          // If hook returns a value, use it as the new value
          if (result !== undefined) {
            value = result;
          }
        }
        return value;
      }

      // Regular hook execution
      for (const hook of hooks) {
        hook(...args);
      }
    }

    // For afterResolve, return the original value if no hooks
    if (name === 'afterResolve' && args.length >= 2) {
      return args[1];
    }

    // For other hooks, return undefined
    return undefined;
  }

  /**
   * Check if a plugin is installed
   */
  hasPlugin(pluginName: string): boolean {
    return this.plugins.has(pluginName);
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

  /**
   * Check if a version satisfies a version range
   */
  private isCompatibleVersion(version: string, range: string): boolean {
    // Simple version compatibility check
    // This is a basic implementation - in production, use a proper semver library
    if (range.startsWith('^')) {
      const requiredVersion = range.substring(1);
      const [reqMajor, reqMinor = '0', reqPatch = '0'] = requiredVersion.split('.');
      const [curMajor, curMinor = '0', curPatch = '0'] = version.split('.');

      // Major version must match, minor and patch can be higher
      return (
        parseInt(curMajor || '0') === parseInt(reqMajor || '0') &&
        (parseInt(curMinor || '0') > parseInt(reqMinor || '0') ||
          (parseInt(curMinor || '0') === parseInt(reqMinor || '0') &&
            parseInt(curPatch || '0') >= parseInt(reqPatch || '0')))
      );
    }

    // Exact version match
    return version === range;
  }
}

/**
 * Create a plugin
 */
export function createPlugin(config: Plugin): Plugin {
  return config;
}

/**
 * Built-in validation plugin factory
 */
export function ValidationPlugin(options: { validators?: Record<string, (value: any) => boolean> } = {}): Plugin {
  return createPlugin({
    name: 'validation',
    version: '1.0.0',
    description: 'Provides validation for registered providers',

    install(container: IContainer) {
      // Add validation middleware that checks for provider-level validation
      const validationMiddleware = createMiddleware({
        name: 'validation-plugin',
        priority: 95,

        execute: (context, next) => {
          const result = next();

          // Helper function to validate result
          const validateResult = (value: any) => {
            // Get the registration to check for validation
            const registration = (container as any).getRegistration?.(context.token);
            if (registration) {
              // Check provider-level validation
              if ((registration.provider as any).validate) {
                (registration.provider as any).validate(value);
              }
              // Check options-level validation
              if (registration.options?.validate) {
                registration.options.validate(value);
              }
            }
            return value;
          };

          // Handle both sync and async results
          if (result instanceof Promise) {
            return result.then(validateResult);
          }

          return validateResult(result);
        },
      });

      container.addMiddleware(validationMiddleware);
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
        // Apply custom validators if provided
        if (options.validators) {
          for (const [key, validator] of Object.entries(options.validators)) {
            if (context && context[key]) {
              if (!validator(context[key])) {
                throw ValidationError.fromFieldErrors([{ field: key, message: 'Validation failed' }]);
              }
            }
          }
        }
      },
    },
  });
}

/**
 * Built-in metrics plugin factory
 */
export function MetricsPlugin(options: { enabled?: boolean } = {}): Plugin {
  const metrics = new Map<string, number>();

  const plugin = createPlugin({
    name: 'metrics',
    version: '1.0.0',
    description: 'Collects metrics about dependency resolution',

    install(container: IContainer) {
      if (options.enabled !== false) {
        console.log('[Nexus] Metrics plugin installed');
      }
    },

    hooks: {
      afterResolve: (token, instance, context) => {
        const name =
          typeof token === 'string' ? token : typeof token === 'symbol' ? token.toString() : token?.name || 'unknown';
        const count = metrics.get(name) || 0;
        metrics.set(name, count + 1);
      },
    },
  });

  // Add getMetrics method to the plugin
  (plugin as any).getMetrics = () => ({
    totalResolutions: Array.from(metrics.values()).reduce((a, b) => a + b, 0),
    resolutionCounts: Object.fromEntries(metrics),
    cacheHits: 0,
    cacheMisses: 0,
  });

  return plugin;
}

/**
 * Built-in logging plugin factory
 */
export function LoggingPlugin(options: { level?: 'debug' | 'info' | 'warn' | 'error' } = {}): Plugin {
  const level = options.level || 'info';

  return createPlugin({
    name: 'logging',
    version: '1.0.0',
    description: 'Logs dependency resolution',

    config: {
      logLevel: level,
    },

    install(container: IContainer) {
      if (level === 'debug' || level === 'info') {
        console.log('[Nexus] Logging plugin installed');
      }
    },

    hooks: {
      beforeResolve: (token) => {
        if (level === 'debug') {
          const name =
            typeof token === 'string' ? token : typeof token === 'symbol' ? token.toString() : token?.name || 'unknown';
          console.log(`[Nexus] Resolving: ${name}`);
        }
      },

      afterResolve: (token, instance) => {
        if (level === 'debug' || level === 'info') {
          const name =
            typeof token === 'string' ? token : typeof token === 'symbol' ? token.toString() : token?.name || 'unknown';
          console.log(`[Nexus] Resolved: ${name}`, instance?.constructor?.name || typeof instance);
        }
      },

      onError: (error, token) => {
        const name = token
          ? typeof token === 'string'
            ? token
            : typeof token === 'symbol'
              ? token.toString()
              : token?.name || 'unknown'
          : 'unknown';
        console.error(`[Nexus] Error resolving ${name}:`, error);
      },
    },
  });
}

/**
 * Performance monitoring plugin factory
 */
export function PerformancePlugin(options: { threshold?: number } = {}): Plugin {
  const threshold = options.threshold || 100;
  const timings = new Map<any, number>();

  return createPlugin({
    name: 'performance',
    version: '1.0.0',
    description: 'Monitors resolution performance',

    install(container: IContainer) {
      console.log('[Nexus] Performance plugin installed');
    },

    hooks: {
      beforeResolve: (token, context) => {
        // Track resolution start time
        timings.set(token, performance.now());
      },

      afterResolve: (token, instance, context) => {
        // Calculate resolution time
        const startTime = timings.get(token);
        if (startTime) {
          const duration = performance.now() - startTime;
          const name =
            typeof token === 'string' ? token : typeof token === 'symbol' ? token.toString() : token?.name || 'unknown';

          if (duration > threshold) {
            console.warn(`[Nexus] Slow resolution: ${name} took ${duration.toFixed(2)}ms`);
          }
          timings.delete(token);
        }
      },
    },
  });
}

/**
 * Caching plugin factory
 */
export function CachingPlugin(options: { ttl?: number; maxSize?: number } = {}): Plugin {
  const ttl = options.ttl || 60000;
  const maxSize = options.maxSize || 1000;
  const cache = new Map<any, { value: any; timestamp: number }>();
  let interval: any;

  const plugin = createPlugin({
    name: 'caching',
    version: '1.0.0',
    description: 'Advanced caching strategies',

    config: {
      ttl,
      maxSize,
    },

    install(container: IContainer) {
      console.log('[Nexus] Caching plugin installed');

      // Periodic cleanup
      interval = setInterval(() => {
        const now = Date.now();
        for (const [key, entry] of cache.entries()) {
          if (now - entry.timestamp > ttl) {
            cache.delete(key);
          }
        }

        // Size limit
        if (cache.size > maxSize) {
          const toDelete = cache.size - maxSize;
          const keys = Array.from(cache.keys());
          for (let i = 0; i < toDelete; i++) {
            cache.delete(keys[i]);
          }
        }
      }, 30000); // Check every 30 seconds
    },

    uninstall(container: IContainer) {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
      cache.clear();
    },

    hooks: {
      beforeResolve: (token, context) => {
        // Check cache for token
        const cached = cache.get(token);
        if (cached && Date.now() - cached.timestamp < ttl) {
          // Return cached value by setting it in context
          (context as any).__cached = cached.value;
        }
      },

      afterResolve: (token, instance, context) => {
        // Only cache if not already cached
        if (!(context as any).__cached) {
          cache.set(token, { value: instance, timestamp: Date.now() });
        }
      },

      onDispose: () => {
        if (interval) {
          clearInterval(interval);
        }
      },
    },
  });

  // Add clearCache method
  (plugin as any).clearCache = () => {
    cache.clear();
  };

  // Add getCacheStats method
  (plugin as any).getCacheStats = () => ({
    size: cache.size,
    entries: Array.from(cache.keys()),
  });

  return plugin;
}

/**
 * Strict validation plugin factory
 */
export function StrictValidationPlugin(options: { strict?: boolean } = {}): Plugin {
  return createPlugin({
    name: 'strict-validation',
    version: '1.0.0',
    description: 'Provider validation with strict mode',

    install(container: IContainer) {
      console.log('[Nexus] Strict validation plugin installed');
    },

    hooks: {
      afterResolve: (token, instance, context) => {
        // Check if provider has validation
        const registration = (context as any).registration;
        if (registration?.provider?.validate) {
          registration.provider.validate(instance);
        }
      },
    },
  });
}
