/**
 * Flow execution engine with resource management, scheduling, and error recovery
 */

import type { Flow } from '@holon/flow';
import type {
  ExecutionOptions,
  ExecutionResult,
  ResourceLimits,
  ErrorRecoveryConfig,
  MonitoringConfig,
  ResourceUsage,
  ExecutionTrace,
  TraceSpan,
} from '../types.js';
import { Executor } from './executor.js';
import { Scheduler } from './scheduler.js';
import { EventEmitter } from 'eventemitter3';

export interface EngineConfig {
  /** Maximum concurrent executions */
  maxConcurrency?: number;
  /** Resource limits */
  resourceLimits?: ResourceLimits;
  /** Error recovery configuration */
  errorRecovery?: ErrorRecoveryConfig;
  /** Monitoring configuration */
  monitoring?: MonitoringConfig;
}

export interface EngineEvents {
  'execution:start': (flowId: string, input: unknown) => void;
  'execution:complete': (flowId: string, result: unknown) => void;
  'execution:error': (flowId: string, error: Error) => void;
  'resource:limit': (resource: string, usage: number) => void;
}

/**
 * Main execution engine for Flow-Machine
 *
 * Manages flow execution with:
 * - Resource management (CPU, memory limits)
 * - Concurrent execution with scheduling
 * - Error recovery and retry logic
 * - Performance monitoring and tracing
 */
export class Engine extends EventEmitter<EngineEvents> {
  private readonly config: Required<EngineConfig>;
  private readonly executor: Executor;
  private readonly scheduler: Scheduler;
  private readonly metrics: Map<string, ExecutionMetrics>;
  private resourceMonitor: NodeJS.Timeout | null = null;

  constructor(config: EngineConfig = {}) {
    super();

    this.config = {
      maxConcurrency: config.maxConcurrency ?? 4,
      resourceLimits: config.resourceLimits ?? {},
      errorRecovery: {
        maxRetries: config.errorRecovery?.maxRetries ?? 3,
        backoff: config.errorRecovery?.backoff ?? 'exponential',
        initialDelay: config.errorRecovery?.initialDelay ?? 100,
        maxDelay: config.errorRecovery?.maxDelay ?? 10000,
        multiplier: config.errorRecovery?.multiplier ?? 2,
      },
      monitoring: {
        enabled: config.monitoring?.enabled ?? true,
        samplingRate: config.monitoring?.samplingRate ?? 1.0,
        endpoint: config.monitoring?.endpoint,
        labels: config.monitoring?.labels ?? {},
      },
    };

    this.executor = new Executor({
      maxConcurrency: this.config.maxConcurrency,
    });

    this.scheduler = new Scheduler({
      maxConcurrency: this.config.maxConcurrency,
      priorityQueue: true,
      workStealing: false,
    });

    this.metrics = new Map();

    // Start resource monitoring
    if (this.config.monitoring.enabled) {
      this.startResourceMonitoring();
    }
  }

  /**
   * Execute a flow with given input
   */
  async execute<In, Out>(
    flow: Flow<In, Out>,
    input: In,
    options: ExecutionOptions = {}
  ): Promise<ExecutionResult<Out>> {
    const flowId = this.getFlowId(flow as Flow<unknown, unknown>);
    const startTime = Date.now();
    const trace = options.trace ? this.createTrace(flowId) : undefined;

    // Check resource limits
    await this.checkResourceLimits();

    // Emit start event
    this.emit('execution:start', flowId, input);

    try {
      // Add trace span if enabled
      const span = trace ? this.startSpan(trace, 'execute') : undefined;

      // Execute with retry logic
      const value = await this.executeWithRetry(flow, input, options);

      // Complete span
      if (span) {
        this.endSpan(span);
      }

      // Calculate duration and resource usage
      const duration = Date.now() - startTime;
      const resourceUsage = this.getCurrentResourceUsage();

      // Record metrics
      this.recordMetrics(flowId, duration, true);

      // Emit complete event
      this.emit('execution:complete', flowId, value);

      const result: ExecutionResult<Out> = {
        value,
        duration,
        resourceUsage,
        trace,
        metadata: options.metadata,
      };

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.recordMetrics(flowId, duration, false);
      this.emit('execution:error', flowId, error as Error);
      throw error;
    }
  }

  /**
   * Execute multiple flows in parallel
   */
  async executeParallel<In, Out>(
    flows: Array<{ flow: Flow<In, Out>; input: In; options?: ExecutionOptions }>,
    options: ExecutionOptions = {}
  ): Promise<ExecutionResult<Out>[]> {
    return Promise.all(
      flows.map(({ flow, input, options: itemOptions }) => this.execute(flow, input, { ...options, ...itemOptions }))
    );
  }

  /**
   * Execute flow with retry logic
   */
  private async executeWithRetry<In, Out>(flow: Flow<In, Out>, input: In, options: ExecutionOptions): Promise<Out> {
    const retryConfig = options.retry ?? {
      maxRetries: this.config.errorRecovery.maxRetries ?? 3,
      delay: this.config.errorRecovery.initialDelay ?? 100,
      backoff: this.config.errorRecovery.backoff ?? 'exponential',
    };

    let lastError: Error | undefined;
    let delay = retryConfig.delay ?? 100;

    for (let attempt = 0; attempt <= (retryConfig.maxRetries ?? 3); attempt++) {
      try {
        // Apply timeout if configured
        const timeout = options.timeout ?? this.config.resourceLimits.timeout;

        if (timeout) {
          return await this.executeWithTimeout(flow, input, timeout);
        }

        return await flow(input);
      } catch (error) {
        lastError = error as Error;

        // Check if we should retry
        if (attempt < (retryConfig.maxRetries ?? 3)) {
          const shouldRetry = 'retryOn' in retryConfig && retryConfig.retryOn;
          if (shouldRetry && typeof shouldRetry === 'function' && !shouldRetry(lastError)) {
            throw lastError;
          }

          // Wait before retry
          await this.sleep(delay);

          // Calculate next delay based on backoff strategy
          if ((retryConfig.backoff ?? 'exponential') === 'exponential') {
            delay = Math.min(
              delay * (this.config.errorRecovery.multiplier ?? 2),
              this.config.errorRecovery.maxDelay ?? 10000
            );
          } else if (retryConfig.backoff === 'linear') {
            delay = Math.min(
              delay + (this.config.errorRecovery.initialDelay ?? 100),
              this.config.errorRecovery.maxDelay ?? 10000
            );
          }
        }
      }
    }

    throw lastError;
  }

  /**
   * Execute flow with timeout
   */
  private executeWithTimeout<In, Out>(flow: Flow<In, Out>, input: In, timeout: number): Promise<Out> {
    return Promise.race([
      flow(input),
      this.sleep(timeout).then(() => {
        throw new Error(`Execution timeout after ${timeout}ms`);
      }),
    ]);
  }

  /**
   * Check if resource limits are exceeded
   */
  private async checkResourceLimits(): Promise<void> {
    const usage = this.getCurrentResourceUsage();

    if (this.config.resourceLimits.cpu) {
      const cpuLimit = this.config.resourceLimits.cpu;
      if (usage.cpu > cpuLimit) {
        this.emit('resource:limit', 'cpu', usage.cpu);
        // Wait a bit for CPU to cool down
        await this.sleep(100);
      }
    }

    if (this.config.resourceLimits.memory) {
      const memoryLimit = this.parseMemoryLimit(this.config.resourceLimits.memory);
      if (usage.memory > memoryLimit) {
        this.emit('resource:limit', 'memory', usage.memory);
        // Trigger garbage collection if available
        if (global.gc) {
          global.gc();
        }
      }
    }
  }

  /**
   * Get current resource usage
   */
  private getCurrentResourceUsage(): ResourceUsage {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    return {
      cpu: (cpuUsage.user + cpuUsage.system) / 1000000, // Convert to seconds
      memory: memUsage.heapUsed,
      uptime: process.uptime(),
      timestamp: Date.now(),
    };
  }

  /**
   * Parse memory limit string to bytes
   */
  private parseMemoryLimit(limit: string | undefined): number {
    if (!limit) {
      return Infinity;
    }

    const units: Record<string, number> = {
      B: 1,
      KB: 1024,
      MB: 1024 * 1024,
      GB: 1024 * 1024 * 1024,
    };

    const match = limit.match(/^(\d+(?:\.\d+)?)\s*([KMGT]?B)$/i);
    if (!match || !match[1]) {
      throw new Error(`Invalid memory limit format: ${limit}`);
    }

    const value = parseFloat(match[1]);
    const unit = (match[2] || 'B').toUpperCase();

    return value * (units[unit] ?? 1);
  }

  /**
   * Record execution metrics
   */
  private recordMetrics(flowId: string, duration: number, success: boolean): void {
    if (!this.config.monitoring.enabled) {
      return;
    }

    let metrics = this.metrics.get(flowId);
    if (!metrics) {
      metrics = {
        executions: 0,
        successCount: 0,
        errorCount: 0,
        totalDuration: 0,
        durations: [],
      };
      this.metrics.set(flowId, metrics);
    }

    metrics.executions++;
    if (success) {
      metrics.successCount++;
    } else {
      metrics.errorCount++;
    }
    metrics.totalDuration += duration;
    metrics.durations.push(duration);

    // Keep only last 1000 durations for percentile calculation
    if (metrics.durations.length > 1000) {
      metrics.durations = metrics.durations.slice(-1000);
    }
  }

  /**
   * Get metrics for a specific flow
   */
  getMetrics(flowId: string): ExecutionMetrics | undefined {
    return this.metrics.get(flowId);
  }

  /**
   * Get all metrics
   */
  getAllMetrics(): Map<string, ExecutionMetrics> {
    return new Map(this.metrics);
  }

  /**
   * Create execution trace
   */
  private createTrace(flowId: string): ExecutionTrace {
    return {
      id: this.generateId(),
      flowId,
      startTime: Date.now(),
      endTime: 0,
      duration: 0,
      spans: [],
    };
  }

  /**
   * Start a trace span
   */
  private startSpan(trace: ExecutionTrace, name: string): TraceSpan {
    const span: TraceSpan = {
      name,
      startTime: Date.now(),
      endTime: 0,
      duration: 0,
    };
    trace.spans.push(span);
    return span;
  }

  /**
   * End a trace span
   */
  private endSpan(span: TraceSpan): void {
    span.endTime = Date.now();
    span.duration = span.endTime - span.startTime;
  }

  /**
   * Start resource monitoring
   */
  private startResourceMonitoring(): void {
    this.resourceMonitor = setInterval(() => {
      const usage = this.getCurrentResourceUsage();
      // Could export to monitoring system here
    }, 5000); // Check every 5 seconds
  }

  /**
   * Stop resource monitoring
   */
  private stopResourceMonitoring(): void {
    if (this.resourceMonitor) {
      clearInterval(this.resourceMonitor);
      this.resourceMonitor = null;
    }
  }

  /**
   * Get flow identifier
   */
  private getFlowId(flow: Flow<unknown, unknown>): string {
    // Try to get flow name or use function name
    return (flow as any).name || flow.toString().slice(0, 50);
  }

  /**
   * Generate unique identifier
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Shutdown the engine
   */
  async shutdown(): Promise<void> {
    this.stopResourceMonitoring();
    await this.scheduler.shutdown();
    this.removeAllListeners();
  }
}

interface ExecutionMetrics {
  executions: number;
  successCount: number;
  errorCount: number;
  totalDuration: number;
  durations: number[];
}

/**
 * Create a new engine instance
 */
export function createEngine(config?: EngineConfig): Engine {
  return new Engine(config);
}
