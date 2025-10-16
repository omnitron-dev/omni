import { ExecutionOptions, ExecutionResult } from '../../types/layers.js';
import { BaseTargetAdapter } from './base.js';

/**
 * SSH execution adapter (stub implementation)
 * TODO: Implement using xec-core SSH capabilities
 */
export class SSHAdapter extends BaseTargetAdapter {
  getType(): 'ssh' {
    return 'ssh';
  }

  /**
   * Execute a command via SSH
   */
  async execute(_command: string, _options: ExecutionOptions = {}): Promise<ExecutionResult> {
    // TODO: Implement SSH execution using xec-core
    throw new Error('SSHAdapter is not yet implemented');
  }

  /**
   * Check if SSH connection is available
   */
  async isAvailable(): Promise<boolean> {
    // TODO: Implement SSH availability check
    return false;
  }

  /**
   * Close SSH connection
   */
  async close(): Promise<void> {
    // TODO: Implement connection cleanup
  }
}
