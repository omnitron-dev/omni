/**
 * Computed variables - variables that are dynamically calculated
 */

export type ComputedFunction = () => any;

export class ComputedVariable {
  private fn: ComputedFunction;
  private cached: boolean;
  private cachedValue?: any;
  private cacheTtl?: number;
  private lastComputed?: number;

  constructor(fn: ComputedFunction, options?: { cache?: boolean; ttl?: number }) {
    this.fn = fn;
    this.cached = options?.cache || false;
    this.cacheTtl = options?.ttl;
  }

  /**
   * Get the computed value
   */
  get(): any {
    if (this.cached && this.cachedValue !== undefined) {
      // Check TTL
      if (this.cacheTtl && this.lastComputed) {
        const elapsed = Date.now() - this.lastComputed;
        if (elapsed > this.cacheTtl) {
          // Cache expired, recompute
          return this.compute();
        }
      }

      return this.cachedValue;
    }

    return this.compute();
  }

  /**
   * Compute the value
   */
  private compute(): any {
    const value = this.fn();

    if (this.cached) {
      this.cachedValue = value;
      this.lastComputed = Date.now();
    }

    return value;
  }

  /**
   * Clear cached value
   */
  clearCache(): void {
    this.cachedValue = undefined;
    this.lastComputed = undefined;
  }
}

/**
 * Registry for computed variables
 */
export class ComputedRegistry {
  private computed = new Map<string, ComputedVariable>();

  /**
   * Define a computed variable
   */
  define(name: string, fn: ComputedFunction, options?: { cache?: boolean; ttl?: number }): void {
    this.computed.set(name, new ComputedVariable(fn, options));
  }

  /**
   * Get a computed variable value
   */
  get(name: string): any {
    const computed = this.computed.get(name);
    return computed ? computed.get() : undefined;
  }

  /**
   * Check if a computed variable exists
   */
  has(name: string): boolean {
    return this.computed.has(name);
  }

  /**
   * Delete a computed variable
   */
  delete(name: string): void {
    this.computed.delete(name);
  }

  /**
   * List all computed variable names
   */
  list(): string[] {
    return Array.from(this.computed.keys());
  }

  /**
   * Clear all caches
   */
  clearCaches(): void {
    for (const computed of this.computed.values()) {
      computed.clearCache();
    }
  }
}
