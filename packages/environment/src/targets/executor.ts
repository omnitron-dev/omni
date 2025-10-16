import { ExecutionOptions, ExecutionResult, ResolvedTarget } from '../types/layers.js';
import { BaseTargetAdapter } from './adapters/base.js';
import { DockerAdapter } from './adapters/docker.js';
import { KubernetesAdapter } from './adapters/k8s.js';
import { LocalAdapter } from './adapters/local.js';
import { SSHAdapter } from './adapters/ssh.js';

/**
 * Command executor - creates appropriate adapter and executes commands
 */
export class CommandExecutor {
  private adapters = new Map<string, BaseTargetAdapter>();

  /**
   * Execute a command on a target
   */
  async execute(
    target: ResolvedTarget,
    command: string,
    options: ExecutionOptions = {}
  ): Promise<ExecutionResult> {
    const adapter = this.getAdapter(target);
    return adapter.execute(command, options);
  }

  /**
   * Get or create adapter for target
   */
  private getAdapter(target: ResolvedTarget): BaseTargetAdapter {
    // Check cache
    if (this.adapters.has(target.name)) {
      return this.adapters.get(target.name)!;
    }

    // Create new adapter
    let adapter: BaseTargetAdapter;

    switch (target.type) {
      case 'local':
        adapter = new LocalAdapter(target.config);
        break;
      case 'ssh':
        adapter = new SSHAdapter(target.config);
        break;
      case 'docker':
        adapter = new DockerAdapter(target.config);
        break;
      case 'kubernetes':
        adapter = new KubernetesAdapter(target.config);
        break;
      default:
        throw new Error(`Unknown target type: ${target.type}`);
    }

    this.adapters.set(target.name, adapter);
    return adapter;
  }

  /**
   * Check if a target is available
   */
  async isAvailable(target: ResolvedTarget): Promise<boolean> {
    const adapter = this.getAdapter(target);
    return adapter.isAvailable();
  }

  /**
   * Close all adapters
   */
  async closeAll(): Promise<void> {
    for (const adapter of this.adapters.values()) {
      await adapter.close();
    }
    this.adapters.clear();
  }
}
