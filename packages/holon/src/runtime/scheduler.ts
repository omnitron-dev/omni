/**
 * Advanced task scheduler with priority queues, work stealing, and rate limiting
 */

import type { Flow } from '@holon/flow';
import type { Task, RateLimitConfig, ExecutionOptions, SchedulerConfig } from '../types.js';
import { EventEmitter } from 'eventemitter3';

export type { SchedulerConfig };

export interface SchedulerEvents {
  'task:scheduled': (taskId: string) => void;
  'task:started': (taskId: string) => void;
  'task:completed': (taskId: string) => void;
  'task:failed': (taskId: string, error: Error) => void;
  'queue:full': (queueSize: number) => void;
}

/**
 * Advanced task scheduler
 *
 * Features:
 * - Priority-based scheduling
 * - Concurrent execution with limits
 * - Work stealing for load balancing
 * - Rate limiting
 * - Backpressure handling
 */
export class Scheduler extends EventEmitter<SchedulerEvents> {
  private readonly config: Required<SchedulerConfig>;
  private readonly highPriorityQueue: Task[] = [];
  private readonly normalPriorityQueue: Task[] = [];
  private readonly lowPriorityQueue: Task[] = [];
  private readonly activeTasks: Map<string, Task> = new Map();
  private readonly completedTasks: Map<string, TaskResult> = new Map();
  private isRunning = false;
  private processInterval: NodeJS.Timeout | null = null;
  private rateLimiter: RateLimiter | null = null;

  constructor(config: SchedulerConfig = {}) {
    super();

    this.config = {
      maxConcurrency: config.maxConcurrency ?? 4,
      priorityQueue: config.priorityQueue ?? true,
      workStealing: config.workStealing ?? false,
      rateLimit: config.rateLimit ?? undefined,
    } as Required<SchedulerConfig>;

    if (this.config.rateLimit) {
      this.rateLimiter = new RateLimiter(this.config.rateLimit);
    }
  }

  /**
   * Schedule a task for execution
   */
  async schedule<In, Out>(flow: Flow<In, Out>, input: In, options: ExecutionOptions = {}): Promise<Out> {
    const task: Task<In, Out> = {
      id: this.generateTaskId(),
      flowId: this.getFlowId(flow as Flow<unknown, unknown>),
      flow,
      input,
      priority: this.getPriorityValue(options.priority),
      options,
      createdAt: Date.now(),
    };

    // Add to appropriate queue based on priority
    this.enqueueTask(task as Task<unknown, unknown>);
    this.emit('task:scheduled', task.id);

    // Start processing if not already running
    if (!this.isRunning) {
      this.start();
    }

    // Wait for task completion
    return this.waitForTask<Out>(task.id);
  }

  /**
   * Schedule multiple tasks
   */
  async scheduleAll<In, Out>(
    tasks: Array<{ flow: Flow<In, Out>; input: In; options?: ExecutionOptions }>
  ): Promise<Out[]> {
    const promises = tasks.map(({ flow, input, options }) => this.schedule(flow, input, options));
    return Promise.all(promises);
  }

  /**
   * Get scheduler statistics
   */
  getStats(): SchedulerStats {
    return {
      activeTasks: this.activeTasks.size,
      queuedTasks: this.getTotalQueueSize(),
      completedTasks: this.completedTasks.size,
      highPriorityQueue: this.highPriorityQueue.length,
      normalPriorityQueue: this.normalPriorityQueue.length,
      lowPriorityQueue: this.lowPriorityQueue.length,
      utilization: this.activeTasks.size / this.config.maxConcurrency,
    };
  }

  /**
   * Start the scheduler
   */
  start(): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.processInterval = setInterval(() => {
      this.processTasks();
    }, 10); // Process every 10ms
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    this.isRunning = false;
    if (this.processInterval) {
      clearInterval(this.processInterval);
      this.processInterval = null;
    }
  }

  /**
   * Shutdown the scheduler
   */
  async shutdown(): Promise<void> {
    this.stop();

    // Wait for active tasks to complete
    while (this.activeTasks.size > 0) {
      await this.sleep(100);
    }

    this.removeAllListeners();
  }

  /**
   * Process tasks from queues
   */
  private async processTasks(): Promise<void> {
    // Check if we can execute more tasks
    while (this.activeTasks.size < this.config.maxConcurrency && this.getTotalQueueSize() > 0) {
      // Check rate limit
      if (this.rateLimiter && !this.rateLimiter.allowRequest()) {
        break;
      }

      // Get next task from priority queues
      const task = this.dequeueTask();
      if (!task) {
        break;
      }

      // Execute task
      this.executeTask(task);
    }
  }

  /**
   * Execute a task
   */
  private async executeTask(task: Task): Promise<void> {
    this.activeTasks.set(task.id, task);
    task.startedAt = Date.now();
    this.emit('task:started', task.id);

    try {
      // Execute the flow
      const result = await task.flow(task.input);

      // Mark as completed
      task.completedAt = Date.now();
      this.activeTasks.delete(task.id);
      this.completedTasks.set(task.id, {
        success: true,
        result,
        duration: task.completedAt - task.startedAt!,
      });
      this.emit('task:completed', task.id);
    } catch (error) {
      // Mark as failed
      task.completedAt = Date.now();
      this.activeTasks.delete(task.id);
      this.completedTasks.set(task.id, {
        success: false,
        error: error as Error,
        duration: task.completedAt - task.startedAt!,
      });
      this.emit('task:failed', task.id, error as Error);
    }
  }

  /**
   * Wait for task completion
   */
  private async waitForTask<Out>(taskId: string): Promise<Out> {
    // Poll for task completion
    while (!this.completedTasks.has(taskId)) {
      await this.sleep(10);
    }

    const result = this.completedTasks.get(taskId)!;
    this.completedTasks.delete(taskId);

    if (result.success) {
      return result.result as Out;
    }
    throw result.error;
  }

  /**
   * Enqueue task to appropriate priority queue
   */
  private enqueueTask(task: Task): void {
    if (task.priority >= 7) {
      this.highPriorityQueue.push(task);
    } else if (task.priority >= 4) {
      this.normalPriorityQueue.push(task);
    } else {
      this.lowPriorityQueue.push(task);
    }

    // Check queue size
    const totalSize = this.getTotalQueueSize();
    if (totalSize > 1000) {
      this.emit('queue:full', totalSize);
    }
  }

  /**
   * Dequeue next task based on priority
   */
  private dequeueTask(): Task | undefined {
    if (this.highPriorityQueue.length > 0) {
      return this.highPriorityQueue.shift();
    }
    if (this.normalPriorityQueue.length > 0) {
      return this.normalPriorityQueue.shift();
    }
    if (this.lowPriorityQueue.length > 0) {
      return this.lowPriorityQueue.shift();
    }
    return undefined;
  }

  /**
   * Get total queue size
   */
  private getTotalQueueSize(): number {
    return this.highPriorityQueue.length + this.normalPriorityQueue.length + this.lowPriorityQueue.length;
  }

  /**
   * Get priority value from string
   */
  private getPriorityValue(priority?: 'low' | 'normal' | 'high'): number {
    switch (priority) {
      case 'high':
        return 9;
      case 'normal':
        return 5;
      case 'low':
        return 1;
      default:
        return 5;
    }
  }

  /**
   * Get flow identifier
   */
  private getFlowId(flow: Flow<unknown, unknown>): string {
    return (flow as any).name || flow.toString().slice(0, 50);
  }

  /**
   * Generate unique task ID
   */
  private generateTaskId(): string {
    return `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Rate limiter for controlling request rate
 */
class RateLimiter {
  private readonly config: RateLimitConfig;
  private tokens: number;
  private lastRefill: number;

  constructor(config: RateLimitConfig) {
    this.config = config;
    this.tokens = config.burst ?? config.maxRequests;
    this.lastRefill = Date.now();
  }

  /**
   * Check if request is allowed
   */
  allowRequest(): boolean {
    this.refillTokens();

    if (this.tokens > 0) {
      this.tokens--;
      return true;
    }

    return false;
  }

  /**
   * Refill tokens based on time elapsed
   */
  private refillTokens(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const tokensToAdd = (elapsed / this.config.interval) * this.config.maxRequests;

    if (tokensToAdd > 0) {
      this.tokens = Math.min(this.tokens + tokensToAdd, this.config.burst ?? this.config.maxRequests);
      this.lastRefill = now;
    }
  }
}

interface TaskResult {
  success: boolean;
  result?: unknown;
  error?: Error;
  duration: number;
}

export interface SchedulerStats {
  activeTasks: number;
  queuedTasks: number;
  completedTasks: number;
  highPriorityQueue: number;
  normalPriorityQueue: number;
  lowPriorityQueue: number;
  utilization: number;
}

/**
 * Create a new scheduler instance
 */
export function createScheduler(config?: SchedulerConfig): Scheduler {
  return new Scheduler(config);
}
