/**
 * DebounceExtension - Debounced operations for performance
 *
 * Provides:
 * - Configurable debounce delays
 * - Debounced search operations
 * - Debounced autosave
 * - Debounced collaboration sync
 * - Smart debouncing (immediate for user-initiated actions)
 *
 * Performance benefits:
 * - Reduced operation frequency
 * - Lower CPU usage
 * - Smoother user experience
 */

import { Extension } from '../core/Extension.js';
import type { ExtensionConfig } from '../core/types.js';

/**
 * Debounce operation type
 */
export type DebounceOperation = 'search' | 'autosave' | 'collaboration' | 'validation' | 'custom';

/**
 * Debounce configuration for an operation
 */
export interface OperationDebounceConfig {
  /** Debounce delay (ms) */
  delay: number;

  /** Maximum wait time (ms) - operation will execute after this time regardless */
  maxWait?: number;

  /** Execute immediately on first call */
  leading?: boolean;

  /** Execute on trailing edge (after delay) */
  trailing?: boolean;
}

/**
 * Debounce extension configuration
 */
export interface DebounceConfig extends ExtensionConfig {
  /** Search debounce config */
  search?: OperationDebounceConfig;

  /** Autosave debounce config */
  autosave?: OperationDebounceConfig;

  /** Collaboration sync debounce config */
  collaboration?: OperationDebounceConfig;

  /** Validation debounce config */
  validation?: OperationDebounceConfig;

  /** Custom operation debounce configs */
  custom?: Record<string, OperationDebounceConfig>;
}

/**
 * Debounced function wrapper
 */
interface DebouncedFunction<T extends (...args: any[]) => any> {
  (...args: Parameters<T>): void;
  cancel: () => void;
  flush: () => void;
  pending: () => boolean;
}

/**
 * DebounceExtension class
 *
 * Manages debouncing for various editor operations
 */
export class DebounceExtension extends Extension<DebounceConfig> {
  name = 'debounce';

  /** Debounced functions registry */
  private debouncedFunctions = new Map<string, DebouncedFunction<any>>();

  /** Pending timeouts */
  private timeouts = new Map<string, ReturnType<typeof setTimeout>>();

  /** Last execution times */
  private lastExecutions = new Map<string, number>();

  configure(config: Partial<DebounceConfig>): this {
    this.config = {
      search: {
        delay: 300,
        maxWait: 1000,
        leading: false,
        trailing: true,
      },
      autosave: {
        delay: 2000,
        maxWait: 10000,
        leading: false,
        trailing: true,
      },
      collaboration: {
        delay: 100,
        maxWait: 500,
        leading: false,
        trailing: true,
      },
      validation: {
        delay: 500,
        maxWait: 2000,
        leading: false,
        trailing: true,
      },
      custom: {},
      ...this.config,
      ...config,
    };
    return this;
  }

  /**
   * Create a debounced function
   */
  debounce<T extends (...args: any[]) => any>(
    operation: DebounceOperation | string,
    fn: T,
    customConfig?: Partial<OperationDebounceConfig>
  ): DebouncedFunction<T> {
    const key = `${operation}:${fn.name || 'anonymous'}`;

    // Return existing if already created
    const existing = this.debouncedFunctions.get(key);
    if (existing) {
      return existing as DebouncedFunction<T>;
    }

    // Get configuration
    const config = this.getOperationConfig(operation, customConfig);

    // Create debounced function
    const debounced = this.createDebouncedFunction(key, fn, config);

    // Store in registry
    this.debouncedFunctions.set(key, debounced);

    return debounced;
  }

  /**
   * Get operation configuration
   */
  private getOperationConfig(
    operation: DebounceOperation | string,
    customConfig?: Partial<OperationDebounceConfig>
  ): OperationDebounceConfig {
    let baseConfig: OperationDebounceConfig;

    switch (operation) {
      case 'search':
        baseConfig = this.config.search!;
        break;
      case 'autosave':
        baseConfig = this.config.autosave!;
        break;
      case 'collaboration':
        baseConfig = this.config.collaboration!;
        break;
      case 'validation':
        baseConfig = this.config.validation!;
        break;
      case 'custom':
        baseConfig = {
          delay: 300,
          maxWait: 1000,
          leading: false,
          trailing: true,
        };
        break;
      default:
        // Check custom configs
        baseConfig = this.config.custom?.[operation] || {
          delay: 300,
          maxWait: 1000,
          leading: false,
          trailing: true,
        };
    }

    return { ...baseConfig, ...customConfig };
  }

  /**
   * Create debounced function with full control
   */
  private createDebouncedFunction<T extends (...args: any[]) => any>(
    key: string,
    fn: T,
    config: OperationDebounceConfig
  ): DebouncedFunction<T> {
    let lastArgs: Parameters<T> | undefined;
    let _result: ReturnType<T> | undefined;

    const invoke = (): void => {
      if (!lastArgs) return;

      const now = Date.now();
      this.lastExecutions.set(key, now);

      _result = fn(...lastArgs);
      lastArgs = undefined;

      // Clear timeout
      const timeout = this.timeouts.get(key);
      if (timeout) {
        clearTimeout(timeout);
        this.timeouts.delete(key);
      }
    };

    const shouldInvokeLeading = (): boolean => {
      if (!config.leading) return false;

      const lastExecution = this.lastExecutions.get(key);
      if (!lastExecution) return true;

      const elapsed = Date.now() - lastExecution;
      return elapsed >= config.delay;
    };

    const shouldInvokeMaxWait = (): boolean => {
      if (!config.maxWait) return false;

      const lastExecution = this.lastExecutions.get(key);
      if (!lastExecution) return false;

      const elapsed = Date.now() - lastExecution;
      return elapsed >= config.maxWait;
    };

    const debounced = ((...args: Parameters<T>): void => {
      lastArgs = args;

      // Check if should invoke immediately (leading edge)
      if (shouldInvokeLeading()) {
        invoke();
        return;
      }

      // Check if max wait exceeded
      if (shouldInvokeMaxWait()) {
        invoke();
        return;
      }

      // Clear existing timeout
      const existingTimeout = this.timeouts.get(key);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
      }

      // Set new timeout
      if (config.trailing) {
        const timeout = setTimeout(() => {
          invoke();
        }, config.delay);

        this.timeouts.set(key, timeout);
      }
    }) as DebouncedFunction<T>;

    // Cancel method
    debounced.cancel = (): void => {
      lastArgs = undefined;
      const timeout = this.timeouts.get(key);
      if (timeout) {
        clearTimeout(timeout);
        this.timeouts.delete(key);
      }
    };

    // Flush method (execute immediately)
    debounced.flush = (): void => {
      if (lastArgs) {
        invoke();
      }
    };

    // Pending check
    debounced.pending = (): boolean => lastArgs !== undefined;

    return debounced;
  }

  /**
   * Cancel a debounced operation
   */
  cancel(operation: DebounceOperation | string): void {
    for (const [key, fn] of this.debouncedFunctions.entries()) {
      if (key.startsWith(`${operation}:`)) {
        fn.cancel();
      }
    }
  }

  /**
   * Flush a debounced operation (execute immediately)
   */
  flush(operation: DebounceOperation | string): void {
    for (const [key, fn] of this.debouncedFunctions.entries()) {
      if (key.startsWith(`${operation}:`)) {
        fn.flush();
      }
    }
  }

  /**
   * Check if operation has pending executions
   */
  isPending(operation: DebounceOperation | string): boolean {
    for (const [key, fn] of this.debouncedFunctions.entries()) {
      if (key.startsWith(`${operation}:`) && fn.pending()) {
        return true;
      }
    }
    return false;
  }

  /**
   * Cancel all debounced operations
   */
  cancelAll(): void {
    for (const fn of this.debouncedFunctions.values()) {
      fn.cancel();
    }
  }

  /**
   * Flush all pending operations
   */
  flushAll(): void {
    for (const fn of this.debouncedFunctions.values()) {
      fn.flush();
    }
  }

  /**
   * Get debounce statistics
   */
  getStats(): {
    totalOperations: number;
    pendingOperations: number;
    operations: Record<string, { pending: boolean; lastExecution?: number }>;
  } {
    const operations: Record<string, { pending: boolean; lastExecution?: number }> = {};

    for (const [key, fn] of this.debouncedFunctions.entries()) {
      operations[key] = {
        pending: fn.pending(),
        lastExecution: this.lastExecutions.get(key),
      };
    }

    const pendingCount = Array.from(this.debouncedFunctions.values()).filter((fn) => fn.pending()).length;

    return {
      totalOperations: this.debouncedFunctions.size,
      pendingOperations: pendingCount,
      operations,
    };
  }

  onDestroy(): void {
    // Cancel all pending operations
    this.cancelAll();

    // Clear all maps
    this.debouncedFunctions.clear();
    this.timeouts.clear();
    this.lastExecutions.clear();
  }
}
