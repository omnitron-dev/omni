import * as cron from 'node-cron';

export interface ScheduledTask {
  name: string;
  cron: string;
  task: cron.ScheduledTask;
}

/**
 * Basic cron scheduler for tasks
 */
export class TaskScheduler {
  private scheduled = new Map<string, ScheduledTask>();

  /**
   * Schedule a task with cron expression
   */
  schedule(name: string, cronExpression: string, handler: () => void | Promise<void>): void {
    // Unschedule if already scheduled
    this.unschedule(name);

    // Validate cron expression
    if (!cron.validate(cronExpression)) {
      throw new Error(`Invalid cron expression: ${cronExpression}`);
    }

    // Schedule task
    const task = cron.schedule(cronExpression, async () => {
      try {
        await handler();
      } catch (error) {
        console.error(`Scheduled task '${name}' failed:`, error);
      }
    });

    this.scheduled.set(name, {
      name,
      cron: cronExpression,
      task,
    });
  }

  /**
   * Unschedule a task
   */
  unschedule(name: string): void {
    const scheduled = this.scheduled.get(name);
    if (scheduled) {
      scheduled.task.stop();
      this.scheduled.delete(name);
    }
  }

  /**
   * Check if a task is scheduled
   */
  isScheduled(name: string): boolean {
    return this.scheduled.has(name);
  }

  /**
   * Get all scheduled tasks
   */
  list(): Array<{ name: string; cron: string }> {
    return Array.from(this.scheduled.values()).map((s) => ({
      name: s.name,
      cron: s.cron,
    }));
  }

  /**
   * Stop all scheduled tasks
   */
  stopAll(): void {
    for (const scheduled of this.scheduled.values()) {
      scheduled.task.stop();
    }
    this.scheduled.clear();
  }
}
