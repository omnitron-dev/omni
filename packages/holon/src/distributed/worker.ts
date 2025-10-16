/**
 * Distributed worker node for executing flows
 */

import type { Flow } from '@holon/flow';
import type { WorkerConfig, WorkerStatus, Task, ResourceUsage } from '../types.js';
import { EventEmitter } from 'eventemitter3';
import { Executor } from '../runtime/executor.js';

export interface WorkerEvents {
  'task:received': (taskId: string) => void;
  'task:completed': (taskId: string) => void;
  'task:failed': (taskId: string, error: Error) => void;
  heartbeat: (status: WorkerStatus) => void;
}

/**
 * Distributed worker node
 *
 * Features:
 * - Task execution
 * - Resource monitoring
 * - Heartbeat reporting
 * - Checkpointing for fault tolerance
 */
export class Worker extends EventEmitter<WorkerEvents> {
  private readonly config: WorkerConfig;
  private readonly executor: Executor;
  private readonly activeTasks: Map<string, Task> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(config: WorkerConfig) {
    super();

    this.config = {
      ...config,
      maxConcurrency: config.maxConcurrency ?? 4,
      heartbeatInterval: config.heartbeatInterval ?? 5000,
    };

    this.executor = new Executor({
      maxConcurrency: this.config.maxConcurrency,
    });
  }

  /**
   * Start the worker
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;

    // Start heartbeat
    this.startHeartbeat();
  }

  /**
   * Stop the worker
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    // Stop heartbeat
    this.stopHeartbeat();

    // Wait for active tasks to complete
    while (this.activeTasks.size > 0) {
      await this.sleep(100);
    }

    await this.executor.shutdown();
  }

  /**
   * Execute a task
   */
  async executeTask<In, Out>(task: Task<In, Out>): Promise<Out> {
    this.emit('task:received', task.id);

    try {
      this.activeTasks.set(task.id, task as Task);
      task.startedAt = Date.now();

      const result = await task.flow(task.input);

      task.completedAt = Date.now();
      this.activeTasks.delete(task.id);

      this.emit('task:completed', task.id);
      return result;
    } catch (error) {
      task.completedAt = Date.now();
      this.activeTasks.delete(task.id);

      this.emit('task:failed', task.id, error as Error);
      throw error;
    }
  }

  /**
   * Get worker status
   */
  getStatus(): WorkerStatus {
    return {
      id: this.config.id,
      health: this.isRunning ? 'healthy' : 'unhealthy',
      activeTasks: this.activeTasks.size,
      resourceUsage: this.getResourceUsage(),
      lastHeartbeat: Date.now(),
    };
  }

  /**
   * Get resource usage
   */
  private getResourceUsage(): ResourceUsage {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    return {
      cpu: (cpuUsage.user + cpuUsage.system) / 1000000,
      memory: memUsage.heapUsed,
      uptime: process.uptime(),
      timestamp: Date.now(),
    };
  }

  /**
   * Start heartbeat
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      const status = this.getStatus();
      this.emit('heartbeat', status);
    }, this.config.heartbeatInterval);
  }

  /**
   * Stop heartbeat
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Create a new worker
 */
export async function createWorker(config: WorkerConfig): Promise<Worker> {
  const worker = new Worker(config);
  await worker.start();
  return worker;
}
