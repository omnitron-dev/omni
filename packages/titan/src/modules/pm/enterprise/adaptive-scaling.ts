/**
 * Adaptive Scaling Implementation
 *
 * Provides intelligent auto-scaling based on metrics and predictions
 */

import { EventEmitter } from 'events';

/**
 * Scaling Metrics
 */
export interface ScalingMetrics {
  cpu: number;
  memory: number;
  requestRate: number;
  responseTime: number;
  errorRate: number;
  queueDepth: number;
  customMetrics?: Record<string, number>;
}

/**
 * Scaling Policy
 */
export interface ScalingPolicy {
  name: string;
  type: 'cpu' | 'memory' | 'request' | 'response' | 'error' | 'queue' | 'custom' | 'composite';
  metric?: string;
  thresholdUp: number;
  thresholdDown: number;
  scaleUpBy: number;
  scaleDownBy: number;
  cooldownUp: number;
  cooldownDown: number;
  evaluate?: (metrics: ScalingMetrics) => ScalingDecision;
}

/**
 * Scaling Decision
 */
export interface ScalingDecision {
  action: 'scale-up' | 'scale-down' | 'maintain';
  amount: number;
  reason: string;
  confidence: number;
}

/**
 * Prediction Model
 */
export interface PredictionModel {
  predict(history: ScalingMetrics[], horizon: number): ScalingMetrics[];
  train(data: ScalingMetrics[]): void;
}

/**
 * Scaling State
 */
export interface ScalingState {
  currentInstances: number;
  targetInstances: number;
  minInstances: number;
  maxInstances: number;
  metricsCount: number;
  lastMetrics?: ScalingMetrics;
  lastDecision?: ScalingDecision;
}

/**
 * Circular buffer for efficient O(1) operations
 */
class CircularBuffer<T> {
  private readonly buffer: (T | undefined)[];
  private head = 0;
  private count = 0;

  constructor(private readonly maxSize: number) {
    this.buffer = new Array(maxSize);
  }

  push(item: T): void {
    const index = (this.head + this.count) % this.maxSize;
    this.buffer[index] = item;

    if (this.count < this.maxSize) {
      this.count++;
    } else {
      // Buffer is full, advance head
      this.head = (this.head + 1) % this.maxSize;
    }
  }

  get length(): number {
    return this.count;
  }

  toArray(): T[] {
    const result: T[] = [];
    for (let i = 0; i < this.count; i++) {
      const index = (this.head + i) % this.maxSize;
      const item = this.buffer[index];
      if (item !== undefined) {
        result.push(item);
      }
    }
    return result;
  }

  getLast(): T | undefined {
    if (this.count === 0) return undefined;
    const index = (this.head + this.count - 1) % this.maxSize;
    return this.buffer[index];
  }
}

/**
 * Adaptive Scaling Controller
 */
export class AdaptiveScalingController extends EventEmitter {
  private readonly metricsHistory = new CircularBuffer<ScalingMetrics>(1000);
  private readonly scalingHistory = new CircularBuffer<ScalingDecision>(100);
  private readonly lastScaleTime = new Map<string, number>();
  private currentInstances = 0;
  private targetInstances = 0;

  constructor(
    private minInstances: number = 1,
    private maxInstances: number = 10,
    private policies: ScalingPolicy[] = [],
    private predictionModel?: PredictionModel
  ) {
    super();
    this.currentInstances = minInstances;
    this.targetInstances = minInstances;
    this.initializeDefaultPolicies();
  }

  private initializeDefaultPolicies(): void {
    if (this.policies.length === 0) {
      this.policies = [
        {
          name: 'cpu-policy',
          type: 'cpu',
          thresholdUp: 80,
          thresholdDown: 20,
          scaleUpBy: 2,
          scaleDownBy: 1,
          cooldownUp: 60000,
          cooldownDown: 300000,
        },
        {
          name: 'memory-policy',
          type: 'memory',
          thresholdUp: 85,
          thresholdDown: 30,
          scaleUpBy: 1,
          scaleDownBy: 1,
          cooldownUp: 60000,
          cooldownDown: 300000,
        },
        {
          name: 'response-time-policy',
          type: 'response',
          thresholdUp: 1000, // 1 second
          thresholdDown: 100, // 100ms
          scaleUpBy: 3,
          scaleDownBy: 1,
          cooldownUp: 30000,
          cooldownDown: 180000,
        },
      ];
    }
  }

  /**
   * Update metrics and evaluate scaling
   */
  async updateMetrics(metrics: ScalingMetrics): Promise<ScalingDecision> {
    // Circular buffer handles bounds automatically - O(1) operation
    this.metricsHistory.push({
      ...metrics,
      customMetrics: { ...metrics.customMetrics },
    });

    // Predict future metrics if model available
    let predictedMetrics: ScalingMetrics | undefined;
    if (this.predictionModel && this.metricsHistory.length > 10) {
      const historyArray = this.metricsHistory.toArray();
      const predictions = this.predictionModel.predict(historyArray, 5);
      predictedMetrics = predictions[predictions.length - 1];
    }

    // Evaluate all policies
    const decisions = this.policies.map((policy) => this.evaluatePolicy(policy, metrics, predictedMetrics));

    // Combine decisions
    const finalDecision = this.combineDecisions(decisions);

    // Apply decision
    if (finalDecision.action !== 'maintain') {
      await this.applyScalingDecision(finalDecision);
    }

    this.scalingHistory.push(finalDecision);
    this.emit('decision', finalDecision);

    return finalDecision;
  }

  /**
   * Evaluate a single policy
   */
  private evaluatePolicy(policy: ScalingPolicy, current: ScalingMetrics, predicted?: ScalingMetrics): ScalingDecision {
    // Check cooldown
    const lastScale = this.lastScaleTime.get(policy.name) || 0;
    const now = Date.now();

    // Custom evaluation function
    if (policy.evaluate) {
      return policy.evaluate(current);
    }

    // Get metric value
    let value: number;
    switch (policy.type) {
      case 'cpu':
        value = predicted?.cpu || current.cpu;
        break;
      case 'memory':
        value = predicted?.memory || current.memory;
        break;
      case 'request':
        value = predicted?.requestRate || current.requestRate;
        break;
      case 'response':
        value = predicted?.responseTime || current.responseTime;
        break;
      case 'error':
        value = predicted?.errorRate || current.errorRate;
        break;
      case 'queue':
        value = predicted?.queueDepth || current.queueDepth;
        break;
      case 'custom':
        value = current.customMetrics?.[policy.metric!] || 0;
        break;
      default:
        value = 0;
    }

    // Evaluate thresholds
    if (value > policy.thresholdUp) {
      const cooldown = lastScale + policy.cooldownUp;
      if (now < cooldown) {
        return {
          action: 'maintain',
          amount: 0,
          reason: `Cooling down (${Math.ceil((cooldown - now) / 1000)}s remaining)`,
          confidence: 0.5,
        };
      }

      return {
        action: 'scale-up',
        amount: policy.scaleUpBy,
        reason: `${policy.type} at ${value.toFixed(2)} > ${policy.thresholdUp}`,
        confidence: Math.min(1, (value - policy.thresholdUp) / policy.thresholdUp),
      };
    }

    if (value < policy.thresholdDown) {
      const cooldown = lastScale + policy.cooldownDown;
      if (now < cooldown) {
        return {
          action: 'maintain',
          amount: 0,
          reason: `Cooling down (${Math.ceil((cooldown - now) / 1000)}s remaining)`,
          confidence: 0.5,
        };
      }

      return {
        action: 'scale-down',
        amount: policy.scaleDownBy,
        reason: `${policy.type} at ${value.toFixed(2)} < ${policy.thresholdDown}`,
        confidence: Math.min(1, (policy.thresholdDown - value) / policy.thresholdDown),
      };
    }

    return {
      action: 'maintain',
      amount: 0,
      reason: `${policy.type} at ${value.toFixed(2)} within thresholds`,
      confidence: 0.8,
    };
  }

  /**
   * Combine multiple scaling decisions
   */
  private combineDecisions(decisions: ScalingDecision[]): ScalingDecision {
    // Filter out maintain decisions
    const activeDecisions = decisions.filter((d) => d.action !== 'maintain');

    if (activeDecisions.length === 0) {
      return {
        action: 'maintain',
        amount: 0,
        reason: 'All metrics within thresholds',
        confidence: 0.9,
      };
    }

    // Separate scale up and down decisions
    const scaleUpDecisions = activeDecisions.filter((d) => d.action === 'scale-up');
    const scaleDownDecisions = activeDecisions.filter((d) => d.action === 'scale-down');

    // Prioritize scale up (safety first)
    if (scaleUpDecisions.length > 0) {
      const maxAmount = Math.max(...scaleUpDecisions.map((d) => d.amount));
      const totalConfidence = scaleUpDecisions.reduce((sum, d) => sum + d.confidence, 0);
      const avgConfidence = totalConfidence / scaleUpDecisions.length;
      const reasons = scaleUpDecisions.map((d) => d.reason).join('; ');

      return {
        action: 'scale-up',
        amount: maxAmount,
        reason: reasons,
        confidence: avgConfidence,
      };
    }

    // All are scale down (we already checked scaleDownDecisions.length > 0 via activeDecisions)
    const minAmount = Math.min(...scaleDownDecisions.map((d) => d.amount));
    const totalDownConfidence = scaleDownDecisions.reduce((sum, d) => sum + d.confidence, 0);
    const avgConfidence = scaleDownDecisions.length > 0 ? totalDownConfidence / scaleDownDecisions.length : 0;
    const reasons = scaleDownDecisions.map((d) => d.reason).join('; ');

    return {
      action: 'scale-down',
      amount: minAmount,
      reason: reasons,
      confidence: avgConfidence,
    };
  }

  /**
   * Apply scaling decision
   */
  private async applyScalingDecision(decision: ScalingDecision): Promise<void> {
    const previousInstances = this.currentInstances;

    if (decision.action === 'scale-up') {
      this.targetInstances = Math.min(this.currentInstances + decision.amount, this.maxInstances);
    } else if (decision.action === 'scale-down') {
      this.targetInstances = Math.max(this.currentInstances - decision.amount, this.minInstances);
    }

    // Update last scale time for all policies
    const now = Date.now();
    this.policies.forEach((policy) => {
      this.lastScaleTime.set(policy.name, now);
    });

    // Emit scaling event
    this.emit('scaling', {
      from: previousInstances,
      to: this.targetInstances,
      decision,
    });

    // Simulate scaling (in real implementation, this would trigger actual scaling)
    this.currentInstances = this.targetInstances;
  }

  /**
   * Get current scaling state
   */
  getState(): ScalingState {
    return {
      currentInstances: this.currentInstances,
      targetInstances: this.targetInstances,
      minInstances: this.minInstances,
      maxInstances: this.maxInstances,
      metricsCount: this.metricsHistory.length,
      lastMetrics: this.metricsHistory.getLast(),
      lastDecision: this.scalingHistory.getLast(),
    };
  }

  /**
   * Update scaling limits
   */
  updateLimits(min: number, max: number): void {
    this.minInstances = min;
    this.maxInstances = max;

    // Adjust current instances if needed
    if (this.currentInstances < min) {
      this.currentInstances = min;
      this.targetInstances = min;
    } else if (this.currentInstances > max) {
      this.currentInstances = max;
      this.targetInstances = max;
    }
  }

  /**
   * Add or update policy
   */
  addPolicy(policy: ScalingPolicy): void {
    const index = this.policies.findIndex((p) => p.name === policy.name);
    if (index !== -1) {
      this.policies[index] = policy;
    } else {
      this.policies.push(policy);
    }
  }

  /**
   * Remove policy
   */
  removePolicy(name: string): void {
    this.policies = this.policies.filter((p) => p.name !== name);
    this.lastScaleTime.delete(name);
  }

  /**
   * Train prediction model
   */
  trainModel(): void {
    if (this.predictionModel && this.metricsHistory.length > 100) {
      this.predictionModel.train(this.metricsHistory.toArray());
      this.emit('model:trained');
    }
  }
}

/**
 * Simple Moving Average Prediction Model
 */
export class MovingAveragePredictionModel implements PredictionModel {
  private windowSize = 10;

  predict(history: ScalingMetrics[], horizon: number): ScalingMetrics[] {
    if (history.length < this.windowSize) {
      // Not enough data, return last known values
      const last = history[history.length - 1];
      return Array(horizon)
        .fill(null)
        .map(() => ({
          cpu: last?.cpu ?? 0,
          memory: last?.memory ?? 0,
          requestRate: last?.requestRate ?? 0,
          responseTime: last?.responseTime ?? 0,
          errorRate: last?.errorRate ?? 0,
          queueDepth: last?.queueDepth ?? 0,
          customMetrics: last?.customMetrics ?? {},
        }));
    }

    const predictions: ScalingMetrics[] = [];
    const window = history.slice(-this.windowSize);

    for (let i = 0; i < horizon; i++) {
      const prediction: ScalingMetrics = {
        cpu: this.average(window.map((m) => m.cpu)),
        memory: this.average(window.map((m) => m.memory)),
        requestRate: this.average(window.map((m) => m.requestRate)),
        responseTime: this.average(window.map((m) => m.responseTime)),
        errorRate: this.average(window.map((m) => m.errorRate)),
        queueDepth: this.average(window.map((m) => m.queueDepth)),
        customMetrics: {},
      };

      predictions.push(prediction);

      // Shift window for next prediction
      window.shift();
      window.push(prediction);
    }

    return predictions;
  }

  train(data: ScalingMetrics[]): void {
    // Simple model, no training needed
    // Could calculate optimal window size here
    this.windowSize = Math.min(20, Math.floor(data.length / 10));
  }

  private average(values: number[]): number {
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }
}

/**
 * Exponential Smoothing Prediction Model
 */
export class ExponentialSmoothingModel implements PredictionModel {
  private alpha = 0.3; // Smoothing factor
  private beta = 0.1; // Trend smoothing factor
  private level: ScalingMetrics | null = null;
  private trend: ScalingMetrics | null = null;

  predict(history: ScalingMetrics[], horizon: number): ScalingMetrics[] {
    if (history.length < 2) {
      const last = history[history.length - 1];
      return Array(horizon)
        .fill(null)
        .map(() => ({
          cpu: last?.cpu ?? 0,
          memory: last?.memory ?? 0,
          requestRate: last?.requestRate ?? 0,
          responseTime: last?.responseTime ?? 0,
          errorRate: last?.errorRate ?? 0,
          queueDepth: last?.queueDepth ?? 0,
          customMetrics: last?.customMetrics ?? {},
        }));
    }

    // Initialize if needed
    if (!this.level || !this.trend) {
      this.initialize(history);
    }

    const predictions: ScalingMetrics[] = [];

    for (let h = 1; h <= horizon; h++) {
      const prediction: ScalingMetrics = {
        cpu: this.level!.cpu + h * this.trend!.cpu,
        memory: this.level!.memory + h * this.trend!.memory,
        requestRate: this.level!.requestRate + h * this.trend!.requestRate,
        responseTime: this.level!.responseTime + h * this.trend!.responseTime,
        errorRate: this.level!.errorRate + h * this.trend!.errorRate,
        queueDepth: this.level!.queueDepth + h * this.trend!.queueDepth,
        customMetrics: {},
      };

      predictions.push(prediction);
    }

    return predictions;
  }

  train(data: ScalingMetrics[]): void {
    if (data.length < 2) return;

    // Optimize smoothing parameters using MSE
    let bestAlpha = this.alpha;
    let bestBeta = this.beta;
    let bestMSE = Infinity;

    for (let alpha = 0.1; alpha <= 0.9; alpha += 0.1) {
      for (let beta = 0.1; beta <= 0.5; beta += 0.1) {
        this.alpha = alpha;
        this.beta = beta;
        this.initialize(data.slice(0, 10));

        let mse = 0;
        for (let i = 10; i < data.length; i++) {
          const prevData = data[i - 1];
          if (!prevData) continue;

          const predicted = this.predict([prevData], 1)[0];
          const actual = data[i];
          if (predicted && actual) {
            mse += Math.pow(predicted.cpu - actual.cpu, 2);
            mse += Math.pow(predicted.memory - actual.memory, 2);
          }
        }

        if (mse < bestMSE) {
          bestMSE = mse;
          bestAlpha = alpha;
          bestBeta = beta;
        }
      }
    }

    this.alpha = bestAlpha;
    this.beta = bestBeta;
    this.initialize(data);
  }

  private initialize(data: ScalingMetrics[]): void {
    if (data.length < 2) return;

    const first = data[0];
    const second = data[1];

    // Initialize level as first observation
    this.level = {
      cpu: first?.cpu ?? 0,
      memory: first?.memory ?? 0,
      requestRate: first?.requestRate ?? 0,
      responseTime: first?.responseTime ?? 0,
      errorRate: first?.errorRate ?? 0,
      queueDepth: first?.queueDepth ?? 0,
      customMetrics: first?.customMetrics ?? {},
    };

    // Initialize trend as difference between first two observations
    this.trend = {
      cpu: (second?.cpu ?? 0) - (first?.cpu ?? 0),
      memory: (second?.memory ?? 0) - (first?.memory ?? 0),
      requestRate: (second?.requestRate ?? 0) - (first?.requestRate ?? 0),
      responseTime: (second?.responseTime ?? 0) - (first?.responseTime ?? 0),
      errorRate: (second?.errorRate ?? 0) - (first?.errorRate ?? 0),
      queueDepth: (second?.queueDepth ?? 0) - (first?.queueDepth ?? 0),
      customMetrics: {},
    };

    // Apply exponential smoothing to rest of data
    for (let i = 1; i < data.length; i++) {
      const item = data[i];
      if (item) {
        this.update(item);
      }
    }
  }

  private update(observation: ScalingMetrics): void {
    if (!this.level || !this.trend) return;

    const newLevel: ScalingMetrics = {
      cpu: this.alpha * observation.cpu + (1 - this.alpha) * (this.level.cpu + this.trend.cpu),
      memory: this.alpha * observation.memory + (1 - this.alpha) * (this.level.memory + this.trend.memory),
      requestRate:
        this.alpha * observation.requestRate + (1 - this.alpha) * (this.level.requestRate + this.trend.requestRate),
      responseTime:
        this.alpha * observation.responseTime + (1 - this.alpha) * (this.level.responseTime + this.trend.responseTime),
      errorRate: this.alpha * observation.errorRate + (1 - this.alpha) * (this.level.errorRate + this.trend.errorRate),
      queueDepth:
        this.alpha * observation.queueDepth + (1 - this.alpha) * (this.level.queueDepth + this.trend.queueDepth),
      customMetrics: {},
    };

    const newTrend: ScalingMetrics = {
      cpu: this.beta * (newLevel.cpu - this.level.cpu) + (1 - this.beta) * this.trend.cpu,
      memory: this.beta * (newLevel.memory - this.level.memory) + (1 - this.beta) * this.trend.memory,
      requestRate:
        this.beta * (newLevel.requestRate - this.level.requestRate) + (1 - this.beta) * this.trend.requestRate,
      responseTime:
        this.beta * (newLevel.responseTime - this.level.responseTime) + (1 - this.beta) * this.trend.responseTime,
      errorRate: this.beta * (newLevel.errorRate - this.level.errorRate) + (1 - this.beta) * this.trend.errorRate,
      queueDepth: this.beta * (newLevel.queueDepth - this.level.queueDepth) + (1 - this.beta) * this.trend.queueDepth,
      customMetrics: {},
    };

    this.level = newLevel;
    this.trend = newTrend;
  }
}
