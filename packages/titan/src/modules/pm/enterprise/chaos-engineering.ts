/**
 * Chaos Engineering Implementation
 *
 * Provides controlled failure injection and resilience testing
 */

import { EventEmitter } from 'events';

import { Errors } from '../../../errors/index.js';
/**
 * Chaos Experiment
 */
export interface ChaosExperiment {
  id: string;
  name: string;
  description: string;
  hypothesis: string;
  steadyState: SteadyStateDefinition;
  method: ChaosMethod[];
  rollback?: () => Promise<void>;
}

/**
 * Steady State Definition
 */
export interface SteadyStateDefinition {
  metrics: MetricCondition[];
  validate: () => Promise<boolean>;
}

/**
 * Metric Condition
 */
export interface MetricCondition {
  name: string;
  operator: 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte' | 'between';
  value: number | [number, number];
}

/**
 * Chaos Method
 */
export interface ChaosMethod {
  type: ChaosType;
  target: ChaosTarget;
  parameters: Record<string, unknown>;
  duration?: number;
  probability?: number;
}

/**
 * Chaos Type
 */
export enum ChaosType {
  LATENCY = 'latency',
  ERROR = 'error',
  KILL = 'kill',
  CPU_SPIKE = 'cpu-spike',
  MEMORY_LEAK = 'memory-leak',
  NETWORK_PARTITION = 'network-partition',
  CLOCK_SKEW = 'clock-skew',
  IO_DELAY = 'io-delay',
  CUSTOM = 'custom',
}

/**
 * Chaos Target
 */
export interface ChaosTarget {
  type: 'process' | 'service' | 'node' | 'network';
  selector: string | ((item: unknown) => boolean);
  percentage?: number;
}

/**
 * Chaos Result
 */
export interface ChaosResult {
  experimentId: string;
  startTime: number;
  endTime: number;
  steadyStateBefore: boolean;
  steadyStateAfter: boolean;
  success: boolean;
  observations: ChaosObservation[];
  errors: Error[];
}

/**
 * Chaos Observation
 */
export interface ChaosObservation {
  time: number;
  type: string;
  value?: unknown;
  method?: string;
  target?: ChaosTarget;
  reason?: string;
}

/**
 * Chaos Monkey Configuration
 */
export interface ChaosMonkeyConfig {
  enabled?: boolean;
  probability?: number;
  minInterval?: number;
  maxInterval?: number;
  types?: ChaosType[];
  safetyLimits?: {
    maxConcurrentChaos?: number;
    excludeTargets?: string[];
    allowedHours?: [number, number];
    maxDuration?: number;
  };
  blastRadius?: {
    maxTargets?: number;
    maxPercentage?: number;
  };
}

/**
 * Chaos Monkey
 * Random failure injector with safety controls
 */
export class ChaosMonkey extends EventEmitter {
  private static readonly MAX_CHAOS_HISTORY = 1000;

  private active = false;
  private experiments: ChaosExperiment[] = [];
  private activeExperiments = new Map<string, NodeJS.Timeout>();
  private activeChaosCount = 0;
  private chaosHistory: Array<{ type: ChaosType; target: unknown; timestamp: number }> = [];
  private chaosTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private config: ChaosMonkeyConfig = {}) {
    super();
    this.config = {
      enabled: false,
      probability: 0.1,
      minInterval: 60000,
      maxInterval: 300000,
      types: [ChaosType.LATENCY, ChaosType.ERROR],
      safetyLimits: {
        maxConcurrentChaos: 3,
        excludeTargets: [],
        allowedHours: [9, 17],
        maxDuration: 300000,
      },
      blastRadius: {
        maxTargets: 5,
        maxPercentage: 25,
      },
      ...config,
    };
  }

  /**
   * Start chaos monkey
   */
  start(): void {
    if (this.active || !this.config.enabled) return;

    this.active = true;
    this.scheduleNextChaos();
    this.emit('started');
  }

  /**
   * Stop chaos monkey
   */
  stop(): void {
    this.active = false;

    // Clear chaos timer
    if (this.chaosTimer) {
      clearTimeout(this.chaosTimer);
      this.chaosTimer = null;
    }

    // Clear all active experiments
    this.activeExperiments.forEach((timer) => clearTimeout(timer));
    this.activeExperiments.clear();

    this.emit('stopped');
  }

  /**
   * Schedule next chaos event
   */
  private scheduleNextChaos(): void {
    if (!this.active) return;

    const interval = this.randomInterval();
    this.chaosTimer = setTimeout(() => {
      if (this.active && Math.random() < this.config.probability!) {
        this.injectChaos();
      }
      this.scheduleNextChaos();
    }, interval).unref();
  }

  /**
   * Inject random chaos with safety checks
   */
  private async injectChaos(): Promise<void> {
    // Safety check: max concurrent chaos
    if (this.activeChaosCount >= (this.config.safetyLimits?.maxConcurrentChaos ?? 3)) {
      this.emit('chaos:skipped', { reason: 'max-concurrent-reached' });
      return;
    }

    // Safety check: time window
    if (!this.isInAllowedTimeWindow()) {
      this.emit('chaos:skipped', { reason: 'outside-allowed-hours' });
      return;
    }

    const type = this.randomChaosType();
    const target = this.randomTarget();

    // Safety check: excluded targets
    if (this.isTargetExcluded(target)) {
      this.emit('chaos:skipped', { reason: 'target-excluded', target });
      return;
    }

    this.activeChaosCount++;
    this.emit('chaos:injected', { type, target });

    try {
      await this.applyChaos(type, target);
      this.chaosHistory.push({ type, target, timestamp: Date.now() });

      // Cleanup old history entries if limit exceeded
      if (this.chaosHistory.length > ChaosMonkey.MAX_CHAOS_HISTORY) {
        this.chaosHistory = this.chaosHistory.slice(-ChaosMonkey.MAX_CHAOS_HISTORY);
      }
    } catch (error) {
      this.emit('chaos:error', error);
    } finally {
      this.activeChaosCount--;
    }
  }

  /**
   * Check if current time is within allowed hours
   */
  private isInAllowedTimeWindow(): boolean {
    if (!this.config.safetyLimits?.allowedHours) {
      return true;
    }

    const hour = new Date().getHours();
    const [start, end] = this.config.safetyLimits.allowedHours;
    return hour >= start && hour < end;
  }

  /**
   * Check if target is excluded
   */
  private isTargetExcluded(target: unknown): boolean {
    if (!this.config.safetyLimits?.excludeTargets) {
      return false;
    }

    const targetId =
      typeof target === 'object' && target !== null && 'id' in target ? (target as { id: string }).id : String(target);

    return this.config.safetyLimits.excludeTargets.some((excluded) => targetId.includes(excluded));
  }

  /**
   * Apply chaos effect
   */
  private async applyChaos(type: ChaosType, target: unknown): Promise<void> {
    const maxDuration = this.config.safetyLimits?.maxDuration ?? 300000;

    switch (type) {
      case ChaosType.LATENCY:
        await this.injectLatency(target, Math.min(5000, maxDuration));
        break;
      case ChaosType.ERROR:
        await this.injectError(target);
        break;
      case ChaosType.KILL:
        await this.killProcess(target);
        break;
      case ChaosType.CPU_SPIKE:
        await this.spikeCPU(target, Math.min(10000, maxDuration));
        break;
      case ChaosType.MEMORY_LEAK:
        await this.leakMemory(target);
        break;
      case ChaosType.NETWORK_PARTITION:
        await this.injectNetworkPartition(target);
        break;
      case ChaosType.IO_DELAY:
        await this.injectIODelay(target);
        break;
      default:
        break;
    }
  }

  private async injectLatency(target: unknown, duration = 5000): Promise<void> {
    this.emit('latency:injected', { target, duration });
    await new Promise((resolve) => setTimeout(resolve, duration));
    this.emit('latency:removed', { target });
  }

  private async injectError(target: unknown): Promise<void> {
    this.emit('error:injected', { target });
  }

  private async killProcess(target: unknown): Promise<void> {
    this.emit('process:killed', { target });
  }

  private async spikeCPU(target: unknown, duration = 10000): Promise<void> {
    this.emit('cpu:spiked', { target, duration });

    const endTime = Date.now() + duration;
    while (Date.now() < endTime) {
      // Busy loop to spike CPU
      Math.sqrt(Math.random());
    }

    this.emit('cpu:normal', { target });
  }

  private async leakMemory(target: unknown, size = 10 * 1024 * 1024): Promise<void> {
    this.emit('memory:leaked', { target, size });

    const leak: unknown[] = [];
    for (let i = 0; i < size / 1024; i++) {
      leak.push(new Array(1024).fill(Math.random()));
    }

    // Hold reference for a while
    setTimeout(() => {
      leak.length = 0;
      this.emit('memory:freed', { target });
    }, 60000);
  }

  private async injectNetworkPartition(target: unknown): Promise<void> {
    this.emit('network:partitioned', { target });
    // In a real implementation, this would manipulate network rules
  }

  private async injectIODelay(target: unknown, delay = 1000): Promise<void> {
    this.emit('io:delayed', { target, delay });
    await new Promise((resolve) => setTimeout(resolve, delay));
    this.emit('io:restored', { target });
  }

  private randomInterval(): number {
    return Math.random() * (this.config.maxInterval! - this.config.minInterval!) + this.config.minInterval!;
  }

  private randomChaosType(): ChaosType {
    const types = this.config.types!;
    return types[Math.floor(Math.random() * types.length)] || ChaosType.LATENCY;
  }

  private randomTarget(): unknown {
    // In real implementation, would select from available targets
    return { id: `target-${Math.random().toString(36).slice(2, 11)}` };
  }

  /**
   * Get chaos history
   */
  getChaosHistory(): Array<{ type: ChaosType; target: unknown; timestamp: number }> {
    return [...this.chaosHistory];
  }

  /**
   * Get active chaos count
   */
  getActiveChaosCount(): number {
    return this.activeChaosCount;
  }

  /**
   * Get configuration
   */
  getConfig(): ChaosMonkeyConfig {
    return { ...this.config };
  }

  /**
   * Clear chaos history
   */
  clearHistory(): void {
    this.chaosHistory = [];
  }
}

/**
 * Chaos Orchestrator
 * Manages and executes chaos experiments
 */
export class ChaosOrchestrator extends EventEmitter {
  private experiments = new Map<string, ChaosExperiment>();
  private results = new Map<string, ChaosResult[]>();
  private running = new Set<string>();

  constructor() {
    super();
  }

  /**
   * Register experiment
   */
  registerExperiment(experiment: ChaosExperiment): void {
    this.experiments.set(experiment.id, experiment);
    this.emit('experiment:registered', experiment);
  }

  /**
   * Run experiment
   */
  async runExperiment(experimentId: string): Promise<ChaosResult> {
    const experiment = this.experiments.get(experimentId);
    if (!experiment) {
      throw Errors.notFound(`Experiment ${experimentId} not found`);
    }

    if (this.running.has(experimentId)) {
      throw Errors.notFound(`Experiment ${experimentId} is already running`);
    }

    this.running.add(experimentId);
    this.emit('experiment:started', experiment);

    const result: ChaosResult = {
      experimentId,
      startTime: Date.now(),
      endTime: 0,
      steadyStateBefore: false,
      steadyStateAfter: false,
      success: false,
      observations: [],
      errors: [],
    };

    try {
      // Check steady state before
      result.steadyStateBefore = await this.checkSteadyState(experiment);
      result.observations.push({
        time: Date.now(),
        type: 'steady-state-before',
        value: result.steadyStateBefore,
      });

      if (!result.steadyStateBefore) {
        const error = Errors.notFound('Steady state not achieved before experiment');
        result.errors.push(error);
        result.endTime = Date.now();
        this.running.delete(experimentId);

        // Store failed result
        if (!this.results.has(experimentId)) {
          this.results.set(experimentId, []);
        }
        this.results.get(experimentId)!.push(result);

        this.emit('experiment:completed', { experiment, result });
        throw error;
      }

      // Execute chaos methods
      for (const method of experiment.method) {
        await this.executeMethod(method, result);
      }

      // Wait for system to stabilize
      await this.delay(100);

      // Check steady state after
      result.steadyStateAfter = await this.checkSteadyState(experiment);
      result.observations.push({
        time: Date.now(),
        type: 'steady-state-after',
        value: result.steadyStateAfter,
      });

      result.success = result.steadyStateAfter;
    } catch (error) {
      result.errors.push(error as Error);

      // Execute rollback if available
      if (experiment.rollback) {
        try {
          await experiment.rollback();
          result.observations.push({
            time: Date.now(),
            type: 'rollback',
            value: 'success',
          });
        } catch (rollbackError) {
          result.errors.push(rollbackError as Error);
        }
      }
    } finally {
      result.endTime = Date.now();
      this.running.delete(experimentId);

      // Store result
      if (!this.results.has(experimentId)) {
        this.results.set(experimentId, []);
      }
      this.results.get(experimentId)!.push(result);

      this.emit('experiment:completed', { experiment, result });
    }

    return result;
  }

  /**
   * Check steady state
   */
  private async checkSteadyState(experiment: ChaosExperiment): Promise<boolean> {
    try {
      return await experiment.steadyState.validate();
    } catch {
      return false;
    }
  }

  /**
   * Execute chaos method
   */
  private async executeMethod(method: ChaosMethod, result: ChaosResult): Promise<void> {
    // Check probability
    if (method.probability && Math.random() > method.probability) {
      result.observations.push({
        time: Date.now(),
        type: 'method-skipped',
        method: method.type,
        reason: 'probability',
      });
      return;
    }

    result.observations.push({
      time: Date.now(),
      type: 'method-start',
      method: method.type,
      target: method.target,
    });

    // Apply chaos based on type
    const handler = this.getMethodHandler(method.type);
    await handler(method);

    // Wait for duration if specified
    if (method.duration) {
      await this.delay(method.duration);
    }

    result.observations.push({
      time: Date.now(),
      type: 'method-end',
      method: method.type,
    });
  }

  /**
   * Get method handler
   */
  private getMethodHandler(type: ChaosType): (method: ChaosMethod) => Promise<void> {
    const handlers: Record<ChaosType, (method: ChaosMethod) => Promise<void>> = {
      [ChaosType.LATENCY]: async (method) => {
        this.emit('chaos:latency', method);
      },
      [ChaosType.ERROR]: async (method) => {
        this.emit('chaos:error', method);
      },
      [ChaosType.KILL]: async (method) => {
        this.emit('chaos:kill', method);
      },
      [ChaosType.CPU_SPIKE]: async (method) => {
        this.emit('chaos:cpu-spike', method);
      },
      [ChaosType.MEMORY_LEAK]: async (method) => {
        this.emit('chaos:memory-leak', method);
      },
      [ChaosType.NETWORK_PARTITION]: async (method) => {
        this.emit('chaos:network-partition', method);
      },
      [ChaosType.CLOCK_SKEW]: async (method) => {
        this.emit('chaos:clock-skew', method);
      },
      [ChaosType.IO_DELAY]: async (method) => {
        this.emit('chaos:io-delay', method);
      },
      [ChaosType.CUSTOM]: async (method) => {
        const handler = method.parameters['handler'];
        if (typeof handler === 'function') {
          await handler();
        }
      },
    };

    return handlers[type] || (async () => {});
  }

  /**
   * Get experiment results
   */
  getResults(experimentId: string): ChaosResult[] {
    return this.results.get(experimentId) || [];
  }

  /**
   * Get all experiments
   */
  getExperiments(): ChaosExperiment[] {
    return Array.from(this.experiments.values());
  }

  /**
   * Clear results
   */
  clearResults(experimentId?: string): void {
    if (experimentId) {
      this.results.delete(experimentId);
    } else {
      this.results.clear();
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Chaos Schedule
 */
export interface ChaosSchedule {
  experimentId: string;
  cron?: string;
  interval?: number;
  enabled: boolean;
}

/**
 * Chaos Report
 */
export interface ChaosReport {
  period: { start: number; end: number };
  totalExperiments: number;
  successfulExperiments: number;
  failedExperiments: number;
  experiments: Array<{
    id: string;
    name: string;
    runs: number;
    successRate: number;
    avgDuration: number;
  }>;
  recommendations: string[];
}

/**
 * Chaos Testing Framework Configuration
 */
export interface ChaosTestingFrameworkConfig {
  monkey?: ChaosMonkeyConfig;
  reporting?: {
    enabled?: boolean;
    interval?: number;
  };
}

/**
 * Chaos Testing Framework
 */
export class ChaosTestingFramework {
  private orchestrator = new ChaosOrchestrator();
  private monkey: ChaosMonkey;
  private schedules = new Map<string, NodeJS.Timeout>();
  private reportData: ChaosResult[] = [];

  constructor(private config: ChaosTestingFrameworkConfig = {}) {
    this.monkey = new ChaosMonkey(config.monkey);
    this.setupDefaultExperiments();
    this.setupReporting();
  }

  /**
   * Setup default experiments
   */
  private setupDefaultExperiments(): void {
    // Latency test
    this.orchestrator.registerExperiment({
      id: 'latency-test',
      name: 'Network Latency Test',
      description: 'Test system behavior under network latency',
      hypothesis: 'System should remain responsive with 500ms latency',
      steadyState: {
        metrics: [
          { name: 'response-time', operator: 'lt', value: 1000 },
          { name: 'error-rate', operator: 'lt', value: 0.01 },
        ],
        validate: async () => true, // Would check actual metrics
      },
      method: [
        {
          type: ChaosType.LATENCY,
          target: { type: 'network', selector: '*' },
          parameters: { delay: 500 },
          duration: 30000,
        },
      ],
    });

    // Process failure test
    this.orchestrator.registerExperiment({
      id: 'process-failure',
      name: 'Process Failure Test',
      description: 'Test system recovery from process failures',
      hypothesis: 'System should recover within 10 seconds',
      steadyState: {
        metrics: [{ name: 'availability', operator: 'gte', value: 0.99 }],
        validate: async () => true,
      },
      method: [
        {
          type: ChaosType.KILL,
          target: { type: 'process', selector: 'worker-*', percentage: 25 },
          parameters: {},
          probability: 1,
        },
      ],
    });

    // Resource exhaustion test
    this.orchestrator.registerExperiment({
      id: 'resource-exhaustion',
      name: 'Resource Exhaustion Test',
      description: 'Test system behavior under resource pressure',
      hypothesis: 'System should degrade gracefully',
      steadyState: {
        metrics: [
          { name: 'cpu-usage', operator: 'lt', value: 90 },
          { name: 'memory-usage', operator: 'lt', value: 90 },
        ],
        validate: async () => true,
      },
      method: [
        {
          type: ChaosType.CPU_SPIKE,
          target: { type: 'node', selector: '*' },
          parameters: { load: 80 },
          duration: 60000,
        },
        {
          type: ChaosType.MEMORY_LEAK,
          target: { type: 'process', selector: '*' },
          parameters: { size: 100 * 1024 * 1024 },
          duration: 60000,
        },
      ],
    });
  }

  /**
   * Setup reporting
   */
  private setupReporting(): void {
    if (!this.config.reporting?.enabled) {
      return;
    }

    this.orchestrator.on('experiment:completed', ({ result }) => {
      this.reportData.push(result);
    });
  }

  /**
   * Run experiment
   */
  async runExperiment(experimentId: string): Promise<ChaosResult> {
    const result = await this.orchestrator.runExperiment(experimentId);
    return result;
  }

  /**
   * Schedule experiment
   */
  scheduleExperiment(schedule: ChaosSchedule): void {
    if (!schedule.enabled) {
      return;
    }

    if (schedule.interval) {
      const timer = setInterval(async () => {
        try {
          await this.runExperiment(schedule.experimentId);
        } catch (error) {
          // Log error but continue schedule
        }
      }, schedule.interval);

      this.schedules.set(schedule.experimentId, timer);
    }
  }

  /**
   * Unschedule experiment
   */
  unscheduleExperiment(experimentId: string): void {
    const timer = this.schedules.get(experimentId);
    if (timer) {
      clearInterval(timer);
      this.schedules.delete(experimentId);
    }
  }

  /**
   * Generate chaos report
   */
  generateReport(period?: { start: number; end: number }): ChaosReport {
    const filteredResults = period
      ? this.reportData.filter((r) => r.startTime >= period.start && r.endTime <= period.end)
      : this.reportData;

    const experimentStats = new Map<string, { runs: number; successes: number; totalDuration: number }>();

    for (const result of filteredResults) {
      const stats = experimentStats.get(result.experimentId) ?? {
        runs: 0,
        successes: 0,
        totalDuration: 0,
      };

      stats.runs++;
      if (result.success) stats.successes++;
      stats.totalDuration += result.endTime - result.startTime;

      experimentStats.set(result.experimentId, stats);
    }

    const experiments = Array.from(experimentStats.entries()).map(([id, stats]) => {
      const experiment = this.orchestrator.getExperiments().find((e) => e.id === id);
      return {
        id,
        name: experiment?.name ?? 'Unknown',
        runs: stats.runs,
        successRate: stats.runs > 0 ? stats.successes / stats.runs : 0,
        avgDuration: stats.runs > 0 ? stats.totalDuration / stats.runs : 0,
      };
    });

    const recommendations = this.generateRecommendations(experiments);

    return {
      period: period ?? { start: 0, end: Date.now() },
      totalExperiments: filteredResults.length,
      successfulExperiments: filteredResults.filter((r) => r.success).length,
      failedExperiments: filteredResults.filter((r) => !r.success).length,
      experiments,
      recommendations,
    };
  }

  /**
   * Generate recommendations based on experiment results
   */
  private generateRecommendations(
    experiments: Array<{ id: string; successRate: number; avgDuration: number }>
  ): string[] {
    const recommendations: string[] = [];

    for (const exp of experiments) {
      if (exp.successRate < 0.5) {
        recommendations.push(
          `Experiment "${exp.id}" has low success rate (${(exp.successRate * 100).toFixed(1)}%). Consider reviewing system resilience.`
        );
      }

      if (exp.avgDuration > 60000) {
        recommendations.push(
          `Experiment "${exp.id}" takes long to complete (avg ${(exp.avgDuration / 1000).toFixed(1)}s). Consider optimizing recovery time.`
        );
      }
    }

    if (recommendations.length === 0) {
      recommendations.push('All experiments are performing well. System shows good resilience.');
    }

    return recommendations;
  }

  /**
   * Clear report data
   */
  clearReportData(): void {
    this.reportData = [];
  }

  /**
   * Start chaos monkey
   */
  startChaosMonkey(config?: ChaosMonkeyConfig): void {
    if (config) {
      this.monkey = new ChaosMonkey(config);
    }
    this.monkey.start();
  }

  /**
   * Stop chaos monkey
   */
  stopChaosMonkey(): void {
    this.monkey.stop();
  }

  /**
   * Shutdown framework
   */
  shutdown(): void {
    this.stopChaosMonkey();
    for (const [id] of this.schedules) {
      this.unscheduleExperiment(id);
    }
  }

  /**
   * Get orchestrator
   */
  getOrchestrator(): ChaosOrchestrator {
    return this.orchestrator;
  }

  /**
   * Get monkey
   */
  getChaosMonkey(): ChaosMonkey {
    return this.monkey;
  }

  /**
   * Get scheduled experiments
   */
  getScheduledExperiments(): string[] {
    return Array.from(this.schedules.keys());
  }
}
