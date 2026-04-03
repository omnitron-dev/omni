/**
 * Task Manager for Netron Browser
 *
 * Manages registration and execution of named tasks with:
 * - Timeout handling for long-running tasks
 * - Conflict resolution strategies for duplicate task names
 * - Both synchronous and asynchronous task support
 *
 * @module netron-browser/core/task-manager
 */

import { Errors } from '../errors/index.js';

/**
 * Task function type - can be sync or async
 */
export type Task = (...args: any[]) => Promise<any> | any;

/**
 * Strategy for handling task name conflicts
 */
export type OverwriteStrategy = 'replace' | 'skip' | 'throw';

/**
 * Configuration options for TaskManager
 */
export interface TaskManagerOptions {
  /**
   * Default timeout in milliseconds for task execution
   * @default 5000
   */
  timeout?: number;

  /**
   * Strategy when adding a task with an existing name
   * - 'replace': Overwrite the existing task
   * - 'skip': Keep the existing task, ignore the new one
   * - 'throw': Throw an error
   * @default 'replace'
   */
  overwriteStrategy?: OverwriteStrategy;
}

/**
 * Default task manager options
 */
export const DEFAULT_TASK_MANAGER_OPTIONS: Required<TaskManagerOptions> = {
  timeout: 5000,
  overwriteStrategy: 'replace',
};

/**
 * Task Manager for Netron Browser
 *
 * Manages named tasks that can be executed by peers. Tasks are typically
 * used for core Netron operations like service discovery, authentication,
 * and cache management.
 *
 * @example
 * ```typescript
 * const manager = new TaskManager({ timeout: 10000 });
 *
 * // Register a task
 * manager.addTask(async function fetchData(id: string) {
 *   const response = await fetch(`/api/data/${id}`);
 *   return response.json();
 * });
 *
 * // Execute a task
 * const data = await manager.runTask('fetchData', '123');
 * ```
 */
export class TaskManager {
  private tasks = new Map<string, Task>();
  private readonly timeout: number;
  private readonly overwriteStrategy: OverwriteStrategy;

  constructor(options: TaskManagerOptions = {}) {
    this.timeout = options.timeout ?? DEFAULT_TASK_MANAGER_OPTIONS.timeout;
    this.overwriteStrategy = options.overwriteStrategy ?? DEFAULT_TASK_MANAGER_OPTIONS.overwriteStrategy;
  }

  /**
   * Register a task with the manager.
   *
   * The task must be a named function. The function's name becomes the task identifier.
   *
   * @param fn - The task function to register (must be named)
   * @throws Error if fn is not a function or has no name
   * @throws Error if task name exists and strategy is 'throw'
   *
   * @example
   * ```typescript
   * // Named function
   * manager.addTask(function myTask() { return 'result'; });
   *
   * // Named async function
   * manager.addTask(async function fetchUser(id: string) {
   *   return await api.getUser(id);
   * });
   * ```
   */
  addTask(fn: Task): void {
    if (typeof fn !== 'function') {
      throw Errors.badRequest('Task must be a function');
    }

    if (!fn.name) {
      throw Errors.badRequest('Task function must have a name');
    }

    const taskName = fn.name;

    // Handle name conflicts based on strategy
    if (this.tasks.has(taskName)) {
      switch (this.overwriteStrategy) {
        case 'skip':
          return; // Silently skip
        case 'throw':
          throw Errors.conflict(`Task "${taskName}" already exists`);
        case 'replace':
        default:
          // Continue and overwrite
          break;
      }
    }

    this.tasks.set(taskName, fn);
  }

  /**
   * Execute a registered task by name.
   *
   * @param name - The name of the task to execute
   * @param args - Arguments to pass to the task
   * @returns Promise resolving to the task result
   * @throws Error if task not found
   * @throws Error if task execution times out
   *
   * @example
   * ```typescript
   * // Execute with arguments
   * const result = await manager.runTask('fetchUser', '123');
   *
   * // Execute without arguments
   * const status = await manager.runTask('getStatus');
   * ```
   */
  async runTask(name: string, ...args: any[]): Promise<any> {
    const task = this.tasks.get(name);
    if (!task) {
      throw Errors.notFound(`Task "${name}" not found`);
    }

    // Create a timeout promise
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(Errors.timeout(`Task "${name}"`, this.timeout));
      }, this.timeout);
    });

    try {
      // Execute task and race against timeout
      const result = task(...args);

      // Handle both sync and async tasks
      if (result instanceof Promise) {
        return await Promise.race([result, timeoutPromise]);
      } else {
        // Sync task completed, no timeout
        return result;
      }
    } finally {
      // Always clear timeout
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }
  }

  /**
   * Check if a task is registered.
   *
   * @param name - The task name to check
   * @returns true if the task exists
   */
  hasTask(name: string): boolean {
    return this.tasks.has(name);
  }

  /**
   * Remove a registered task.
   *
   * @param name - The task name to remove
   * @returns true if the task was removed
   */
  removeTask(name: string): boolean {
    return this.tasks.delete(name);
  }

  /**
   * Get all registered task names.
   *
   * @returns Array of task names
   */
  getTaskNames(): string[] {
    return Array.from(this.tasks.keys());
  }

  /**
   * Get the number of registered tasks.
   */
  get size(): number {
    return this.tasks.size;
  }

  /**
   * Clear all registered tasks.
   */
  clear(): void {
    this.tasks.clear();
  }
}
