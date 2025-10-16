import {
  ExecutionOptions,
  ExecutionResult,
  ITargetsLayer,
  ResolvedTarget,
  TargetConfig
} from '../types/layers.js';
import { CommandExecutor } from './executor.js';

/**
 * Targets layer implementation
 */
export class TargetsLayer implements ITargetsLayer {
  private targets = new Map<string, TargetConfig>();
  private executor = new CommandExecutor();

  /**
   * Define a target
   */
  define(name: string, config: TargetConfig): void {
    this.targets.set(name, config);
  }

  /**
   * Get a target configuration
   */
  get(name: string): ResolvedTarget | null {
    const config = this.targets.get(name);
    if (!config) {
      return null;
    }

    return {
      name,
      type: config.type,
      config
    };
  }

  /**
   * Check if target exists
   */
  has(name: string): boolean {
    return this.targets.has(name);
  }

  /**
   * Delete a target
   */
  delete(name: string): void {
    this.targets.delete(name);
  }

  /**
   * Resolve a target reference
   */
  async resolve(reference: string): Promise<ResolvedTarget> {
    // Simple resolution - just lookup by name
    const target = this.get(reference);
    if (!target) {
      throw new Error(`Target '${reference}' not found`);
    }

    return target;
  }

  /**
   * Find targets matching a pattern
   */
  async find(pattern: string): Promise<ResolvedTarget[]> {
    const regex = new RegExp(pattern.replace(/\*/g, '.*'));
    const matches: ResolvedTarget[] = [];

    for (const [name, config] of this.targets.entries()) {
      if (regex.test(name)) {
        matches.push({
          name,
          type: config.type,
          config
        });
      }
    }

    return matches;
  }

  /**
   * List all targets
   */
  async list(): Promise<ResolvedTarget[]> {
    const targets: ResolvedTarget[] = [];

    for (const [name, config] of this.targets.entries()) {
      targets.push({
        name,
        type: config.type,
        config
      });
    }

    return targets;
  }

  /**
   * Execute a command on a target
   */
  async execute(
    targetName: string,
    command: string,
    options: ExecutionOptions = {}
  ): Promise<ExecutionResult> {
    const target = await this.resolve(targetName);
    return this.executor.execute(target, command, options);
  }

  /**
   * Auto-detect target configuration
   */
  async autoDetect(name: string): Promise<ResolvedTarget | null> {
    // Try to detect local target
    if (name === 'local' || name === 'localhost') {
      const config: TargetConfig = {
        type: 'local'
      };

      this.define(name, config);

      return {
        name,
        type: 'local',
        config
      };
    }

    // TODO: Implement more sophisticated auto-detection
    // - Check if it's a hostname (SSH)
    // - Check if it's a Docker container
    // - Check if it's a Kubernetes pod

    return null;
  }

  /**
   * Close all target connections
   */
  async closeAll(): Promise<void> {
    await this.executor.closeAll();
  }
}
