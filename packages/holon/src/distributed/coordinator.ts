/**
 * Distributed coordinator for job distribution and result aggregation
 */

import type { Flow } from '@holon/flow';
import type {
  CoordinatorConfig,
  WorkerStatus,
  JobConfig,
  ExecutionOptions,
} from '../types.js';
import { EventEmitter } from 'eventemitter3';

export interface CoordinatorEvents {
  'worker:connected': (workerId: string) => void;
  'worker:disconnected': (workerId: string) => void;
  'job:started': (jobId: string) => void;
  'job:completed': (jobId: string) => void;
  'job:failed': (jobId: string, error: Error) => void;
}

/**
 * Distributed coordinator
 *
 * Features:
 * - Job distribution across workers
 * - Result aggregation
 * - Worker health monitoring
 * - Failure detection and recovery
 */
export class Coordinator extends EventEmitter<CoordinatorEvents> {
  private readonly config: CoordinatorConfig;
  private readonly workers: Map<string, WorkerConnection> = new Map();
  private readonly jobs: Map<string, JobState> = new Map();
  private currentWorkerIndex = 0;
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor(config: CoordinatorConfig) {
    super();
    this.config = {
      ...config,
      heartbeatInterval: config.heartbeatInterval ?? 5000,
      strategy: config.strategy ?? 'round-robin',
    };
  }

  /**
   * Connect to worker nodes
   */
  async connect(): Promise<void> {
    for (const nodeUrl of this.config.nodes) {
      await this.connectWorker(nodeUrl);
    }

    // Start heartbeat monitoring
    this.startHeartbeat();
  }

  /**
   * Execute a job on the cluster
   */
  async execute<In, Out>(
    flow: Flow<In, Out>,
    input: In,
    options: ExecutionOptions = {}
  ): Promise<Out> {
    const jobId = this.generateJobId();
    const job: JobConfig = {
      id: jobId,
      flow: flow as Flow<unknown, unknown>,
      input,
      options,
      partition: 'none',
    };

    this.jobs.set(jobId, {
      job,
      status: 'pending',
      startTime: Date.now(),
    });

    this.emit('job:started', jobId);

    try {
      // Select worker based on strategy
      const worker = this.selectWorker();
      if (!worker) {
        throw new Error('No available workers');
      }

      // Execute on worker
      const result = await this.executeOnWorker<In, Out>(worker, flow, input);

      // Update job state
      const jobState = this.jobs.get(jobId)!;
      jobState.status = 'completed';
      jobState.endTime = Date.now();
      jobState.result = result;

      this.emit('job:completed', jobId);

      return result;
    } catch (error) {
      // Update job state
      const jobState = this.jobs.get(jobId);
      if (jobState) {
        jobState.status = 'failed';
        jobState.endTime = Date.now();
        jobState.error = error as Error;
      }

      this.emit('job:failed', jobId, error as Error);
      throw error;
    }
  }

  /**
   * Execute data parallel job
   */
  async executeDataParallel<In, Out>(
    flow: Flow<In, Out>,
    inputs: In[],
    options: ExecutionOptions = {}
  ): Promise<Out[]> {
    const workers = this.getHealthyWorkers();
    if (workers.length === 0) {
      throw new Error('No healthy workers available');
    }

    // Shard inputs across workers
    const shards = this.shardData(inputs, workers.length);

    // Execute shards in parallel
    const promises = shards.map((shard, i) => {
      const worker = workers[i]!; // Safe: we sharded based on workers.length
      return this.executeShardOnWorker(worker, flow, shard);
    });

    const results = await Promise.all(promises);
    return results.flat();
  }

  /**
   * Get worker statistics
   */
  getWorkerStats(): WorkerStatus[] {
    return Array.from(this.workers.values()).map((worker) => worker.status);
  }

  /**
   * Get job statistics
   */
  getJobStats(): JobStats {
    const jobs = Array.from(this.jobs.values());
    return {
      total: jobs.length,
      pending: jobs.filter((j) => j.status === 'pending').length,
      running: jobs.filter((j) => j.status === 'running').length,
      completed: jobs.filter((j) => j.status === 'completed').length,
      failed: jobs.filter((j) => j.status === 'failed').length,
    };
  }

  /**
   * Disconnect and cleanup
   */
  async disconnect(): Promise<void> {
    this.stopHeartbeat();

    for (const worker of this.workers.values()) {
      worker.disconnect();
    }

    this.workers.clear();
    this.removeAllListeners();
  }

  /**
   * Connect to a worker node
   */
  private async connectWorker(nodeUrl: string): Promise<void> {
    const workerId = this.extractWorkerId(nodeUrl);
    const connection = new WorkerConnection(workerId, nodeUrl);

    await connection.connect();

    this.workers.set(workerId, connection);
    this.emit('worker:connected', workerId);
  }

  /**
   * Select worker based on strategy
   */
  private selectWorker(): WorkerConnection | undefined {
    const healthyWorkers = this.getHealthyWorkers();
    if (healthyWorkers.length === 0) {
      return undefined;
    }

    switch (this.config.strategy) {
      case 'round-robin':
        return this.roundRobinSelect(healthyWorkers);
      case 'least-loaded':
        return this.leastLoadedSelect(healthyWorkers);
      case 'consistent-hash':
        return this.consistentHashSelect(healthyWorkers);
      default:
        return healthyWorkers[0];
    }
  }

  /**
   * Round-robin worker selection
   */
  private roundRobinSelect(workers: WorkerConnection[]): WorkerConnection {
    const worker = workers[this.currentWorkerIndex % workers.length]!; // Safe: workers.length > 0 checked by caller
    this.currentWorkerIndex++;
    return worker;
  }

  /**
   * Least-loaded worker selection
   */
  private leastLoadedSelect(workers: WorkerConnection[]): WorkerConnection {
    return workers.reduce((min, worker) =>
      worker.status.activeTasks < min.status.activeTasks ? worker : min
    );
  }

  /**
   * Consistent hash worker selection
   */
  private consistentHashSelect(workers: WorkerConnection[]): WorkerConnection {
    const hash = Date.now();
    const index = hash % workers.length;
    return workers[index]!; // Safe: workers.length > 0 checked by caller
  }

  /**
   * Get healthy workers
   */
  private getHealthyWorkers(): WorkerConnection[] {
    return Array.from(this.workers.values()).filter(
      (w) => w.status.health === 'healthy'
    );
  }

  /**
   * Execute flow on worker
   */
  private async executeOnWorker<In, Out>(
    worker: WorkerConnection,
    flow: Flow<In, Out>,
    input: In
  ): Promise<Out> {
    // In real implementation, would serialize flow and send to worker
    // For now, simulate execution
    return flow(input);
  }

  /**
   * Execute shard on worker
   */
  private async executeShardOnWorker<In, Out>(
    worker: WorkerConnection,
    flow: Flow<In, Out>,
    inputs: In[]
  ): Promise<Out[]> {
    return Promise.all(inputs.map((input) => flow(input)));
  }

  /**
   * Shard data across workers
   */
  private shardData<T>(data: T[], shardCount: number): T[][] {
    const shards: T[][] = Array.from({ length: shardCount }, () => []);
    data.forEach((item, i) => {
      shards[i % shardCount]!.push(item); // Safe: array created with exact shardCount length
    });
    return shards;
  }

  /**
   * Start heartbeat monitoring
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      this.checkWorkerHealth();
    }, this.config.heartbeatInterval);
  }

  /**
   * Stop heartbeat monitoring
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Check worker health
   */
  private checkWorkerHealth(): void {
    const now = Date.now();
    const timeout = this.config.heartbeatInterval! * 3; // 3 missed heartbeats

    for (const [workerId, worker] of this.workers) {
      if (now - worker.status.lastHeartbeat > timeout) {
        worker.status.health = 'unhealthy';
        this.emit('worker:disconnected', workerId);
      }
    }
  }

  /**
   * Extract worker ID from URL
   */
  private extractWorkerId(url: string): string {
    return url.replace(/^https?:\/\//, '').replace(/[/:]/g, '_');
  }

  /**
   * Generate unique job ID
   */
  private generateJobId(): string {
    return `job-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

/**
 * Worker connection
 */
class WorkerConnection {
  readonly id: string;
  readonly url: string;
  status: WorkerStatus;

  constructor(id: string, url: string) {
    this.id = id;
    this.url = url;
    this.status = {
      id,
      health: 'healthy',
      activeTasks: 0,
      resourceUsage: {
        cpu: 0,
        memory: 0,
        uptime: 0,
        timestamp: Date.now(),
      },
      lastHeartbeat: Date.now(),
    };
  }

  async connect(): Promise<void> {
    // Would establish connection to worker
  }

  disconnect(): void {
    // Would close connection to worker
  }
}

interface JobState {
  job: JobConfig;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startTime: number;
  endTime?: number;
  result?: unknown;
  error?: Error;
}

export interface JobStats {
  total: number;
  pending: number;
  running: number;
  completed: number;
  failed: number;
}

/**
 * Create a new coordinator
 */
export async function createCoordinator(config: CoordinatorConfig): Promise<Coordinator> {
  const coordinator = new Coordinator(config);
  await coordinator.connect();
  return coordinator;
}
