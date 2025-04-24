import { Host } from '../inventory/host';
import { OrbitError } from '../errors/error';
import { OrbitResult, OrbitContext } from '../../types/common';
import { OrbitEvent, OrbitEvents, TaskEventPayload } from '../events/orbitEvents';

export interface TaskOptions {
  name?: string;
  timeout?: number;
  retries?: number;
}

export abstract class Task {
  public readonly name: string;
  public readonly timeout: number;
  public readonly retries: number;

  constructor(options?: TaskOptions) {
    this.name = options?.name || this.constructor.name;
    this.timeout = options?.timeout ?? 30000;
    this.retries = options?.retries ?? 0;
  }

  protected abstract execute(host: Host, context: OrbitContext): Promise<OrbitResult>;

  public abstract rollback(host: Host, context: OrbitContext): Promise<OrbitResult>;

  public async executeWithRetry(host: Host, context: OrbitContext): Promise<OrbitResult> {
    let attempts = 0;
    let lastError: OrbitError | undefined;

    while (attempts <= this.retries) {
      const payload: TaskEventPayload = {
        task: this,
        host,
        timestamp: new Date(),
        dryRun: context.config.dryRun
      };

      try {
        OrbitEvents.emit(OrbitEvent.TaskStart, payload);
        context.logger.info(`Task "${this.name}" started on "${host.hostname}"`, {
          dryRun: context.config.dryRun,
          attempt: attempts + 1,
          maxAttempts: this.retries + 1,
        });

        if (context.config.dryRun) {
          OrbitEvents.emit(OrbitEvent.TaskComplete, payload);
          context.logger.info(`[DRY-RUN] Task "${this.name}" simulated successfully on "${host.hostname}"`);
          return { success: true, data: 'dry-run' };
        }

        const result = await this.execute(host, context);

        if (result.success) {
          OrbitEvents.emit(OrbitEvent.TaskComplete, payload);
          context.logger.info(`Task "${this.name}" completed successfully on "${host.hostname}"`);
          return result;
        } else {
          throw result.error || new OrbitError('TASK_EXECUTION_FAILED', `Task "${this.name}" failed without specific error`);
        }

      } catch (error: any) {
        attempts += 1;

        lastError = error instanceof OrbitError
          ? error
          : new OrbitError('UNHANDLED_TASK_EXCEPTION', error.message, { stack: error.stack });

        context.errorHandler.handleError(lastError, {
          task: this.name,
          host: host.hostname,
          attempt: attempts,
          retries: this.retries,
        });

        OrbitEvents.emit(OrbitEvent.TaskError, {
          ...payload,
          error: lastError,
        });

        if (attempts > this.retries) {
          context.logger.warn(`Retries exhausted for task "${this.name}" on host "${host.hostname}". Initiating rollback.`);
          await this.rollback(host, context);
          return { success: false, error: lastError };
        } else {
          context.logger.warn(`Retrying task "${this.name}" on host "${host.hostname}" (attempt ${attempts + 1}/${this.retries + 1})`);
        }
      }
    }

    return {
      success: false,
      error: lastError || new OrbitError('UNKNOWN_TASK_FAILURE', `Unknown error occurred in task "${this.name}"`),
    };
  }
}
