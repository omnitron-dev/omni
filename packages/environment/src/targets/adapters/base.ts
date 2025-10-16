import { ExecutionOptions, ExecutionResult, TargetConfig } from '../../types/layers.js';

/**
 * Base adapter interface for target execution
 */
export abstract class BaseTargetAdapter {
  protected config: TargetConfig;

  constructor(config: TargetConfig) {
    this.config = config;
  }

  /**
   * Execute a command on the target
   */
  abstract execute(command: string, options?: ExecutionOptions): Promise<ExecutionResult>;

  /**
   * Check if the target is available
   */
  abstract isAvailable(): Promise<boolean>;

  /**
   * Get target type
   */
  abstract getType(): 'local' | 'ssh' | 'docker' | 'kubernetes';

  /**
   * Close/cleanup the adapter
   */
  async close(): Promise<void> {
    // Default: no cleanup needed
  }
}
