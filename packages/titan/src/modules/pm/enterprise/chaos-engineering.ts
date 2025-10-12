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
  parameters: any;
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
  selector: string | ((item: any) => boolean);
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
  observations: any[];
  errors: Error[];
}

/**
 * Chaos Monkey
 * Random failure injector
 */
export class ChaosMonkey extends EventEmitter {
  private active = false;
  private experiments: ChaosExperiment[] = [];
  private activeExperiments = new Map<string, NodeJS.Timeout>();

  constructor(
    private config: {
      enabled?: boolean;
      probability?: number;
      minInterval?: number;
      maxInterval?: number;
      types?: ChaosType[];
    } = {}
  ) {
    super();
    this.config = {
      enabled: false,
      probability: 0.1,
      minInterval: 60000,
      maxInterval: 300000,
      types: [ChaosType.LATENCY, ChaosType.ERROR],
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
    setTimeout(() => {
      if (this.active && Math.random() < this.config.probability!) {
        this.injectChaos();
      }
      this.scheduleNextChaos();
    }, interval);
  }

  /**
   * Inject random chaos
   */
  private async injectChaos(): Promise<void> {
    const type = this.randomChaosType();
    const target = this.randomTarget();

    this.emit('chaos:injected', { type, target });

    try {
      await this.applyChaos(type, target);
    } catch (error) {
      this.emit('chaos:error', error);
    }
  }

  /**
   * Apply chaos effect
   */
  private async applyChaos(type: ChaosType, target: any): Promise<void> {
    switch (type) {
      case ChaosType.LATENCY:
        await this.injectLatency(target);
        break;
      case ChaosType.ERROR:
        await this.injectError(target);
        break;
      case ChaosType.KILL:
        await this.killProcess(target);
        break;
      case ChaosType.CPU_SPIKE:
        await this.spikeCPU(target);
        break;
      case ChaosType.MEMORY_LEAK:
        await this.leakMemory(target);
        break;
      default:
        break;
    }
  }

  private async injectLatency(target: any, duration = 5000): Promise<void> {
    // Simulate latency injection
    this.emit('latency:injected', { target, duration });
    await new Promise((resolve) => setTimeout(resolve, duration));
    this.emit('latency:removed', { target });
  }

  private async injectError(target: any): Promise<void> {
    // Simulate error injection
    this.emit('error:injected', { target });
  }

  private async killProcess(target: any): Promise<void> {
    // Simulate process kill
    this.emit('process:killed', { target });
  }

  private async spikeCPU(target: any, duration = 10000): Promise<void> {
    // Simulate CPU spike
    this.emit('cpu:spiked', { target, duration });

    const endTime = Date.now() + duration;
    while (Date.now() < endTime) {
      // Busy loop to spike CPU
      Math.sqrt(Math.random());
    }

    this.emit('cpu:normal', { target });
  }

  private async leakMemory(target: any, size = 10 * 1024 * 1024): Promise<void> {
    // Simulate memory leak
    this.emit('memory:leaked', { target, size });

    const leak: any[] = [];
    for (let i = 0; i < size / 1024; i++) {
      leak.push(new Array(1024).fill(Math.random()));
    }

    // Hold reference for a while
    setTimeout(() => {
      leak.length = 0;
      this.emit('memory:freed', { target });
    }, 60000);
  }

  private randomInterval(): number {
    return Math.random() * (this.config.maxInterval! - this.config.minInterval!) + this.config.minInterval!;
  }

  private randomChaosType(): ChaosType {
    const types = this.config.types!;
    return types[Math.floor(Math.random() * types.length)] || ChaosType.LATENCY;
  }

  private randomTarget(): any {
    // In real implementation, would select from available targets
    return { id: `target-${Math.random().toString(36).substr(2, 9)}` };
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
        throw Errors.notFound('Steady state not achieved before experiment');
      }

      // Execute chaos methods
      for (const method of experiment.method) {
        await this.executeMethod(method, result);
      }

      // Wait for system to stabilize
      await this.delay(5000);

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
        if (method.parameters.handler) {
          await method.parameters.handler();
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
 * Chaos Testing Framework
 */
export class ChaosTestingFramework {
  private orchestrator = new ChaosOrchestrator();
  private monkey = new ChaosMonkey();

  constructor(private config: any = {}) {
    this.setupDefaultExperiments();
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
   * Run experiment
   */
  async runExperiment(experimentId: string): Promise<ChaosResult> {
    return this.orchestrator.runExperiment(experimentId);
  }

  /**
   * Start chaos monkey
   */
  startChaosMonkey(config?: any): void {
    this.monkey = new ChaosMonkey(config || this.config.monkey);
    this.monkey.start();
  }

  /**
   * Stop chaos monkey
   */
  stopChaosMonkey(): void {
    this.monkey.stop();
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
}
