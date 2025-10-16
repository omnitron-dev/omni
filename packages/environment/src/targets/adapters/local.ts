import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { ExecutionOptions, ExecutionResult } from '../../types/layers.js';
import { BaseTargetAdapter } from './base.js';

const execAsync = promisify(exec);

/**
 * Local execution adapter
 * Executes commands on the local machine using child_process
 */
export class LocalAdapter extends BaseTargetAdapter {
  getType(): 'local' {
    return 'local';
  }

  /**
   * Execute a command locally
   */
  async execute(command: string, options: ExecutionOptions = {}): Promise<ExecutionResult> {
    const startTime = Date.now();

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: options.workdir || this.config.workdir || process.cwd(),
        env: {
          ...process.env,
          ...this.config.env,
          ...options.env
        },
        timeout: options.timeout,
        shell: options.shell || '/bin/bash'
      });

      return {
        success: true,
        stdout: stdout,
        stderr: stderr,
        exitCode: 0,
        duration: Date.now() - startTime
      };
    } catch (error: any) {
      return {
        success: false,
        stdout: error.stdout || '',
        stderr: error.stderr || error.message,
        exitCode: error.code || 1,
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * Check if local execution is available (always true)
   */
  async isAvailable(): Promise<boolean> {
    return true;
  }
}
