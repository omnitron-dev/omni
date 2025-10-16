import { ISecretsLayer } from '../types/layers.js';
import { ComputedRegistry } from './computed.js';
import { detectCircularDependencies, Interpolator } from './interpolation.js';

export interface VariablesLayerOptions {
  secrets?: ISecretsLayer;
}

/**
 * Variables layer implementation
 */
export class VariablesLayer {
  private variables = new Map<string, any>();
  private computed = new ComputedRegistry();
  private secrets?: ISecretsLayer;

  constructor(options: VariablesLayerOptions = {}) {
    this.secrets = options.secrets;
  }

  /**
   * Define a variable
   */
  define(name: string, value: any): void {
    this.variables.set(name, value);
  }

  /**
   * Get a variable value
   */
  get(name: string): any {
    // Check computed variables first
    if (this.computed.has(name)) {
      return this.computed.get(name);
    }

    // Then regular variables
    return this.variables.get(name);
  }

  /**
   * Check if a variable exists
   */
  has(name: string): boolean {
    return this.variables.has(name) || this.computed.has(name);
  }

  /**
   * Delete a variable
   */
  delete(name: string): void {
    this.variables.delete(name);
    this.computed.delete(name);
  }

  /**
   * Define a computed variable
   */
  defineComputed(name: string, fn: () => any): void {
    this.computed.define(name, fn);
  }

  /**
   * Interpolate a template string synchronously
   */
  interpolate(template: string): string {
    const interpolator = new Interpolator({
      variables: this.export(),
      env: process.env as Record<string, string>
    });

    return interpolator.interpolate(template);
  }

  /**
   * Interpolate a template string asynchronously
   */
  async interpolateAsync(template: string): Promise<string> {
    const interpolator = new Interpolator({
      variables: this.export(),
      env: process.env as Record<string, string>,
      secrets: this.secrets ? (key) => this.secrets!.get(key) : undefined
    });

    return interpolator.interpolateAsync(template);
  }

  /**
   * Resolve all variable references
   */
  async resolve(): Promise<void> {
    // Check for circular dependencies
    const variableObj: Record<string, any> = {};
    for (const [key, value] of this.variables.entries()) {
      variableObj[key] = value;
    }

    const { circular, cycles } = detectCircularDependencies(variableObj);
    if (circular) {
      throw new Error(
        `Circular dependency detected in variables: ${cycles.map((c) => c.join(' -> ')).join(', ')}`
      );
    }

    // Resolve all variables
    const resolved = new Map<string, any>();

    for (const [key, value] of this.variables.entries()) {
      if (typeof value === 'string') {
        const resolvedValue = await this.interpolateAsync(value);
        resolved.set(key, resolvedValue);
      } else {
        resolved.set(key, value);
      }
    }

    // Update variables with resolved values
    this.variables = resolved;
  }

  /**
   * List all variable names
   */
  list(): string[] {
    const regularVars = Array.from(this.variables.keys());
    const computedVars = this.computed.list();
    return [...regularVars, ...computedVars];
  }

  /**
   * Export all variables as an object
   */
  export(): Record<string, any> {
    const exported: Record<string, any> = {};

    // Export regular variables
    for (const [key, value] of this.variables.entries()) {
      exported[key] = value;
    }

    // Export computed variables
    for (const key of this.computed.list()) {
      exported[key] = this.computed.get(key);
    }

    return exported;
  }

  /**
   * Import variables from an object
   */
  import(vars: Record<string, any>): void {
    for (const [key, value] of Object.entries(vars)) {
      this.variables.set(key, value);
    }
  }

  /**
   * Clear all variables
   */
  clear(): void {
    this.variables.clear();
    this.computed.clearCaches();
  }
}
