/**
 * Represents a task function that can be either synchronous or asynchronous.
 * Tasks are the fundamental units of work in the TaskManager system.
 *
 * @typedef {(...args: any[]) => Promise<any> | any} Task
 * @description A function that can be executed by the TaskManager, supporting both
 * synchronous and asynchronous operations with variable arguments and return types.
 */
export type Task = (...args: any[]) => Promise<any> | any;

/**
 * Manages the lifecycle and execution of tasks within the Netron system.
 * This class provides a robust framework for registering, loading, and executing
 * tasks with configurable timeout and conflict resolution strategies.
 *
 * @class TaskManager
 * @description Central task management system for handling both synchronous and
 * asynchronous operations with proper error handling and timeout mechanisms.
 */
export class TaskManager {
  /**
   * Internal storage for registered tasks.
   * Maps task names to their corresponding function implementations.
   *
   * @private
   * @type {Map<string, Task>}
   */
  private tasks: Map<string, Task> = new Map();

  /**
   * Maximum execution time in milliseconds before a task is considered timed out.
   *
   * @private
   * @type {number}
   */
  private timeout: number;

  /**
   * Strategy for handling task registration conflicts.
   *
   * @private
   * @type {'replace' | 'skip' | 'throw'}
   * @description Determines behavior when registering a task with an existing name:
   * - 'replace': Overwrites the existing task
   * - 'skip': Preserves the existing task
   * - 'throw': Raises an error
   */
  private overwriteStrategy: 'replace' | 'skip' | 'throw';

  /**
   * Creates a new TaskManager instance with configurable parameters.
   *
   * @constructor
   * @param {Object} options - Configuration options for the TaskManager
   * @param {number} [options.timeout=5000] - Default timeout in milliseconds
   * @param {'replace' | 'skip' | 'throw'} [options.overwriteStrategy='replace'] - Strategy for handling task conflicts
   */
  constructor({
    timeout = 5000,
    overwriteStrategy = 'replace',
  }: { timeout?: number; overwriteStrategy?: 'replace' | 'skip' | 'throw' } = {}) {
    this.timeout = timeout;
    this.overwriteStrategy = overwriteStrategy;
  }

  /**
   * Registers a new task with the TaskManager.
   * Validates the task function and handles registration according to the configured strategy.
   *
   * @param {Task} fn - The task function to register
   * @throws {Error} If the provided argument is not a function
   * @throws {Error} If the function has no name
   * @throws {Error} If a task with the same name exists and overwriteStrategy is 'throw'
   */
  addTask(fn: Task) {
    if (typeof fn !== 'function') {
      throw new Error('Task must be a function');
    }
    if (!fn.name) {
      throw new Error('Task function must have a name');
    }

    const existingTask = this.tasks.get(fn.name);
    if (existingTask) {
      switch (this.overwriteStrategy) {
        case 'replace':
          this.tasks.set(fn.name, fn);
          break;
        case 'skip':
          return;
        case 'throw':
          throw new Error(`Task already exists: ${fn.name}`);
        default:
          throw new Error(`Unknown overwrite strategy: ${this.overwriteStrategy}`);
      }
    } else {
      this.tasks.set(fn.name, fn);
    }
  }

  /**
   * Executes a registered task with the provided arguments.
   * Implements timeout handling and proper cleanup of resources.
   *
   * @param {string} name - Name of the task to execute
   * @param {...any} args - Arguments to pass to the task
   * @returns {Promise<any>} Result of the task execution
   * @throws {Error} If the task is not found
   * @throws {Error} If the task execution times out
   * @throws {Error} If the task execution fails
   */
  async runTask(name: string, ...args: any[]): Promise<any> {
    const task = this.tasks.get(name);
    if (!task) {
      throw new Error(`Task not found: ${name}`);
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Task timed out: ${name} (${this.timeout}ms)`));
      }, this.timeout);

      try {
        const result = task(...args);
        if (result instanceof Promise) {
          result
            .then(resolve)
            .catch(reject)
            .finally(() => clearTimeout(timer));
        } else {
          clearTimeout(timer);
          resolve(result);
        }
      } catch (error) {
        clearTimeout(timer);
        reject(error);
      }
    });
  }
}
