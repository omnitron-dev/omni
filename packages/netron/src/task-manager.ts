import { pathToFileURL } from 'url';
import { readdir } from 'fs/promises';

// Define a type for tasks, which can be either asynchronous or synchronous functions
export type Task = (...args: any[]) => Promise<any> | any;

// Class for managing tasks
export class TaskManager {
  // Map to store tasks, where the key is the task name and the value is the task function
  private tasks: Map<string, Task> = new Map();
  // Timeout for task execution in milliseconds
  private timeout: number;
  // Strategy for overwriting tasks: 'replace' - replace, 'skip' - skip, 'throw' - throw an error
  private overwriteStrategy: 'replace' | 'skip' | 'throw';

  // Constructor for the TaskManager class
  constructor({
    timeout = 5000,
    overwriteStrategy = 'replace',
  }: { timeout?: number; overwriteStrategy?: 'replace' | 'skip' | 'throw' } = {}) {
    this.timeout = timeout; // Set the timeout
    this.overwriteStrategy = overwriteStrategy; // Set the overwrite strategy
  }

  // Method to add a new task
  addTask(fn: Task) {
    // Check if the provided argument is a function
    if (typeof fn !== 'function') {
      throw new Error('Task must be a function');
    }
    // Check if the function has a name
    if (!fn.name) {
      throw new Error('Task function must have a name');
    }

    // Check if a task with the same name already exists
    const existingTask = this.tasks.get(fn.name);
    if (existingTask) {
      // Actions based on the overwrite strategy
      switch (this.overwriteStrategy) {
        case 'replace':
          this.tasks.set(fn.name, fn); // Replace the existing task
          break;
        case 'skip':
          return; // Skip adding
        case 'throw':
          throw new Error(`Task already exists: ${fn.name}`); // Throw an error
        default:
          throw new Error(`Unknown overwrite strategy: ${this.overwriteStrategy}`); // Handle unexpected strategy
      }
    } else {
      this.tasks.set(fn.name, fn); // Add the new task
    }
  }

  // Method to load tasks from `.js` files in the specified directory
  async loadTasksFromDir(directory: string) {
    try {
      // Read files from the directory and filter only `.js` files
      const files = (await readdir(directory)).filter((f) => f.endsWith('.js'));

      for (const file of files) {
        let fileUrl = `${directory}/${file}`;
        // Convert the file path to a URL if `require` is not available
        if (typeof require !== 'function') {
          fileUrl = pathToFileURL(`${directory}/${file}`).href;
        }
        // Import the module
        const module = await import(fileUrl);

        // Register tasks from the module
        this._registerModule(module);
      }
    } catch (error: any) {
      // Handle errors when loading tasks
      throw new Error(`Failed to load tasks from directory (${directory}): ${error.message || error}`);
    }
  }

  // Method to execute a task with a timeout
  async runTask(name: string, ...args: any[]): Promise<any> {
    // Retrieve the task by name
    const task = this.tasks.get(name);
    if (!task) {
      throw new Error(`Task not found: ${name}`); // Throw an error if the task is not found
    }

    // Return a promise that executes the task with a timeout
    return new Promise((resolve, reject) => {
      // Set a timer for the timeout
      const timer = setTimeout(() => {
        reject(new Error(`Task timed out: ${name} (${this.timeout}ms)`)); // Reject the promise if the time is up
      }, this.timeout);

      try {
        // Execute the task
        const result = task(...args);
        if (result instanceof Promise) {
          // If the task returns a promise, handle it
          result
            .then(resolve)
            .catch(reject)
            .finally(() => clearTimeout(timer));
        } else {
          // If the task is synchronous, resolve the promise immediately
          clearTimeout(timer);
          resolve(result);
        }
      } catch (error) {
        // Handle errors during task execution
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  // Helper method to register modules
  private _registerModule(module: Record<string, unknown>) {
    // Iterate over all exports of the module
    for (const [name, fn] of Object.entries(module)) {
      // If the export is a function, add it as a task
      if (typeof fn === 'function') {
        this.addTask(fn as Task);
      }
    }
  }
}
