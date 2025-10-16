import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { TaskConfig, TaskResult, TaskStep } from '../types/layers.js';

const execAsync = promisify(exec);

export interface ExecutorContext {
  workdir?: string;
  env?: Record<string, string>;
  variables?: Record<string, any>;
  interpolate?: (template: string) => Promise<string>;
  executeTask?: (name: string, params?: Record<string, any>) => Promise<TaskResult>;
  executeOnTarget?: (target: string, command: string, options?: any) => Promise<TaskResult>;
}

/**
 * Task executor - executes task commands and steps
 */
export class TaskExecutor {
  private context: ExecutorContext;

  constructor(context: ExecutorContext) {
    this.context = context;
  }

  /**
   * Execute a task
   */
  async execute(config: TaskConfig, params?: Record<string, any>): Promise<TaskResult> {
    const startTime = Date.now();

    try {
      // Check condition
      if (config.when) {
        const shouldRun = await this.evaluateCondition(config.when);
        if (!shouldRun) {
          return {
            success: true,
            output: 'Task skipped due to condition',
            duration: Date.now() - startTime,
          };
        }
      }

      // Execute based on type
      if (config.steps) {
        return await this.executeSteps(config.steps, params);
      } else if (config.command) {
        return await this.executeCommand(config.command, config);
      } else if (config.script) {
        return await this.executeScript(config.script, config);
      }

      throw new Error('Invalid task configuration');
    } catch (error: any) {
      const duration = Date.now() - startTime;

      // Handle error based on onError strategy
      if (config.onError === 'continue') {
        return {
          success: false,
          error: error.message,
          duration,
          exitCode: 1,
        };
      }

      // Execute error handler steps
      if (Array.isArray(config.onError)) {
        await this.executeSteps(config.onError, params);
      }

      return {
        success: false,
        error: error.message,
        duration,
        exitCode: 1,
      };
    }
  }

  /**
   * Execute a single command
   */
  private async executeCommand(command: string, config: TaskConfig): Promise<TaskResult> {
    const startTime = Date.now();

    // Interpolate command
    const interpolatedCommand = this.context.interpolate ? await this.context.interpolate(command) : command;

    try {
      const { stdout } = await execAsync(interpolatedCommand, {
        cwd: config.workdir || this.context.workdir,
        env: { ...process.env, ...this.context.env, ...config.env },
        timeout: config.timeout,
      });

      return {
        success: true,
        output: stdout,
        duration: Date.now() - startTime,
        exitCode: 0,
      };
    } catch (error: any) {
      return {
        success: false,
        output: error.stdout || '',
        error: error.stderr || error.message,
        exitCode: error.code || 1,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Execute a script
   */
  private async executeScript(script: string, config: TaskConfig): Promise<TaskResult> {
    // For now, treat script same as command
    // In future, could support inline scripts
    return this.executeCommand(script, config);
  }

  /**
   * Execute multiple steps
   */
  private async executeSteps(steps: TaskStep[], params?: Record<string, any>): Promise<TaskResult> {
    const startTime = Date.now();
    const stepResults: Array<{
      name: string;
      success: boolean;
      output?: string;
      error?: string;
    }> = [];

    for (const step of steps) {
      // Check condition
      if (step.when) {
        const shouldRun = await this.evaluateCondition(step.when);
        if (!shouldRun) {
          stepResults.push({
            name: step.name,
            success: true,
            output: 'Skipped due to condition',
          });
          continue;
        }
      }

      try {
        let result: TaskResult;

        if (step.command) {
          // Execute command on target(s)
          if (step.targets && step.parallel) {
            // Execute on multiple targets in parallel
            const results = await Promise.all(
              step.targets.map((target) => this.executeOnTarget(target, step.command!, {}))
            );

            // Aggregate results
            const allSucceeded = results.every((r) => r.success);
            const outputs = results
              .map((r) => r.output)
              .filter(Boolean)
              .join('\n');
            const errors = results
              .map((r) => r.error)
              .filter(Boolean)
              .join('\n');

            result = {
              success: allSucceeded,
              output: outputs,
              error: errors || undefined,
              duration: Math.max(...results.map((r) => r.duration)),
            };
          } else if (step.target) {
            // Execute on single target
            result = await this.executeOnTarget(step.target, step.command, {});
          } else {
            // Execute locally
            result = await this.executeCommand(step.command, {});
          }
        } else if (step.task) {
          // Execute sub-task
          if (!this.context.executeTask) {
            throw new Error('Task execution not supported in this context');
          }
          result = await this.context.executeTask(step.task, params);
        } else {
          throw new Error(`Step '${step.name}' has no command or task`);
        }

        stepResults.push({
          name: step.name,
          success: result.success,
          output: result.output,
          error: result.error,
        });

        // Handle failure
        if (!result.success) {
          if (step.onFailure === 'continue') {
            continue;
          }

          if (typeof step.onFailure === 'object' && 'retry' in step.onFailure) {
            // Retry logic
            let retries = step.onFailure.retry;
            while (retries > 0) {
              await this.delay(this.parseDelay(step.onFailure.delay || '1s'));

              const retryResult = await this.executeCommand(step.command!, {});
              if (retryResult.success) {
                stepResults[stepResults.length - 1] = {
                  name: step.name,
                  success: true,
                  output: retryResult.output,
                };
                break;
              }

              retries--;
            }

            if (retries === 0) {
              throw new Error(`Step '${step.name}' failed after retries`);
            }
          } else {
            // Abort
            throw new Error(`Step '${step.name}' failed: ${result.error}`);
          }
        }
      } catch (error: any) {
        stepResults.push({
          name: step.name,
          success: false,
          error: error.message,
        });

        if (step.onFailure !== 'continue') {
          break;
        }
      }
    }

    const allSucceeded = stepResults.every((r) => r.success);
    const output = stepResults
      .map((r) => r.output)
      .filter(Boolean)
      .join('\n');
    const error = stepResults
      .filter((r) => !r.success)
      .map((r) => r.error)
      .join('\n');

    return {
      success: allSucceeded,
      output,
      error: error || undefined,
      duration: Date.now() - startTime,
      steps: stepResults,
    };
  }

  /**
   * Execute command on a target
   */
  private async executeOnTarget(target: string, command: string, options: any): Promise<TaskResult> {
    if (!this.context.executeOnTarget) {
      throw new Error('Target execution not supported in this context');
    }

    return this.context.executeOnTarget(target, command, options);
  }

  /**
   * Evaluate a condition
   */
  private async evaluateCondition(condition: string): Promise<boolean> {
    if (!this.context.interpolate) {
      return true;
    }

    const interpolated = await this.context.interpolate(condition);

    // Simple boolean evaluation
    return interpolated === 'true' || interpolated === '1';
  }

  /**
   * Parse delay string (e.g., "5s", "1m", "500ms")
   */
  private parseDelay(delay: string): number {
    const match = delay.match(/^(\d+)(ms|s|m|h)?$/);
    if (!match) {
      return 1000; // Default 1 second
    }

    const value = parseInt(match[1], 10);
    const unit = match[2] || 's';

    switch (unit) {
      case 'ms':
        return value;
      case 's':
        return value * 1000;
      case 'm':
        return value * 60 * 1000;
      case 'h':
        return value * 60 * 60 * 1000;
      default:
        return value * 1000;
    }
  }

  /**
   * Delay execution
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
