import {
  ITasksLayer,
  ITargetsLayer,
  IVariablesLayer,
  TaskConfig,
  TaskDefinition,
  TaskInfo,
  TaskResult,
} from '../types/layers.js';
import { DependencyGraph, getExecutionOrder } from './dependency-resolver.js';
import { TaskScheduler } from './scheduler.js';
import { extractDependencies, parseTaskDefinition } from './task-definition.js';
import { TaskExecutor } from './task-executor.js';

export interface TasksLayerOptions {
  variables?: IVariablesLayer;
  targets?: ITargetsLayer;
}

/**
 * Tasks layer implementation
 */
export class TasksLayer implements ITasksLayer {
  private tasks = new Map<string, TaskDefinition>();
  private scheduler = new TaskScheduler();
  private variables?: IVariablesLayer;
  private targets?: ITargetsLayer;

  constructor(options: TasksLayerOptions = {}) {
    this.variables = options.variables;
    this.targets = options.targets;
  }

  /**
   * Define a task
   */
  define(name: string, config: TaskConfig): void {
    const definition = parseTaskDefinition(name, config);
    this.tasks.set(name, definition);
  }

  /**
   * Get a task definition
   */
  get(name: string): TaskDefinition | null {
    return this.tasks.get(name) || null;
  }

  /**
   * Check if task exists
   */
  has(name: string): boolean {
    return this.tasks.has(name);
  }

  /**
   * Delete a task
   */
  delete(name: string): void {
    this.tasks.delete(name);
    this.scheduler.unschedule(name);
  }

  /**
   * Run a task
   */
  async run(name: string, params?: Record<string, any>): Promise<TaskResult> {
    const definition = this.tasks.get(name);
    if (!definition) {
      throw new Error(`Task '${name}' not found`);
    }

    // Get execution order (including dependencies)
    const order = this.getExecutionOrder([name]);

    // Execute tasks in order
    let lastResult: TaskResult = {
      success: true,
      output: '',
      duration: 0,
    };

    for (const taskName of order) {
      const taskDef = this.tasks.get(taskName);
      if (!taskDef) {
        throw new Error(`Task '${taskName}' not found`);
      }

      const executor = new TaskExecutor({
        workdir: taskDef.config.workdir,
        env: taskDef.config.env,
        variables: this.variables?.export(),
        interpolate: this.variables ? (template) => this.variables!.interpolateAsync(template) : undefined,
        executeTask: (name, params) => this.run(name, params),
        executeOnTarget: this.targets
          ? (target, command, options) => this.targets!.execute(target, command, options)
          : undefined,
      });

      lastResult = await executor.execute(taskDef.config, params);

      if (!lastResult.success) {
        break;
      }
    }

    return lastResult;
  }

  /**
   * Run a task on a specific target
   */
  async runOn(name: string, target: string, _params?: Record<string, any>): Promise<TaskResult> {
    if (!this.targets) {
      throw new Error('Targets layer not available');
    }

    const definition = this.tasks.get(name);
    if (!definition) {
      throw new Error(`Task '${name}' not found`);
    }

    // For simplicity, we'll execute the command on the target
    if (!definition.config.command) {
      throw new Error(`Task '${name}' does not have a command`);
    }

    return this.targets.execute(target, definition.config.command, {
      workdir: definition.config.workdir,
      env: definition.config.env,
    });
  }

  /**
   * Schedule a task with cron expression
   */
  schedule(name: string, cronExpression: string): void {
    if (!this.tasks.has(name)) {
      throw new Error(`Task '${name}' not found`);
    }

    this.scheduler.schedule(name, cronExpression, async () => {
      await this.run(name);
    });
  }

  /**
   * Unschedule a task
   */
  unschedule(name: string): void {
    this.scheduler.unschedule(name);
  }

  /**
   * Get task dependencies
   */
  getDependencies(name: string): string[] {
    const definition = this.tasks.get(name);
    if (!definition) {
      return [];
    }

    return extractDependencies(definition.config);
  }

  /**
   * Get execution order for tasks
   */
  getExecutionOrder(taskNames: string[]): string[] {
    const graph = this.buildDependencyGraph();
    return getExecutionOrder(taskNames, graph);
  }

  /**
   * List all tasks
   */
  list(): TaskInfo[] {
    const infos: TaskInfo[] = [];

    for (const [name, definition] of this.tasks.entries()) {
      infos.push({
        name,
        description: definition.config.description,
        dependencies: extractDependencies(definition.config),
        hasSteps: Boolean(definition.config.steps),
      });
    }

    return infos;
  }

  /**
   * Explain task execution order
   */
  explain(name: string): string[] {
    const order = this.getExecutionOrder([name]);
    const explanation: string[] = [];

    explanation.push(`Execution order for task '${name}':`);

    for (let i = 0; i < order.length; i++) {
      const taskName = order[i];
      const definition = this.tasks.get(taskName);

      if (definition) {
        const deps = extractDependencies(definition.config);
        const depsStr = deps.length > 0 ? ` (depends on: ${deps.join(', ')})` : '';
        explanation.push(`${i + 1}. ${taskName}${depsStr}`);
      }
    }

    return explanation;
  }

  /**
   * Build dependency graph for all tasks
   */
  private buildDependencyGraph(): DependencyGraph {
    const graph: DependencyGraph = {};

    for (const [name, definition] of this.tasks.entries()) {
      graph[name] = extractDependencies(definition.config);
    }

    return graph;
  }

  /**
   * Stop all scheduled tasks
   */
  stopScheduler(): void {
    this.scheduler.stopAll();
  }
}
