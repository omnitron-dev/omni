/**
 * Feature Flags Implementation
 *
 * Provides feature toggles and progressive delivery capabilities
 */

import { EventEmitter } from 'events';

/**
 * Feature Flag
 */
export interface FeatureFlag {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  conditions?: FlagCondition[];
  variants?: FlagVariant[];
  rollout?: RolloutConfig;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Flag Condition
 */
export interface FlagCondition {
  type: 'user' | 'group' | 'percentage' | 'time' | 'custom';
  operator: 'in' | 'not-in' | 'eq' | 'ne' | 'gt' | 'lt' | 'matches';
  value: any;
  evaluate?: (context: EvaluationContext) => boolean;
}

/**
 * Flag Variant
 */
export interface FlagVariant {
  id: string;
  name: string;
  value: any;
  weight: number;
  overrides?: VariantOverride[];
}

/**
 * Variant Override
 */
export interface VariantOverride {
  condition: FlagCondition;
  variantId: string;
}

/**
 * Rollout Configuration
 */
export interface RolloutConfig {
  strategy: 'percentage' | 'gradual' | 'canary' | 'blue-green';
  percentage?: number;
  stages?: RolloutStage[];
  startTime?: Date;
  endTime?: Date;
}

/**
 * Rollout Stage
 */
export interface RolloutStage {
  percentage: number;
  startTime: Date;
  duration: number;
}

/**
 * Evaluation Context
 */
export interface EvaluationContext {
  userId?: string;
  groupId?: string;
  properties?: Record<string, any>;
  timestamp?: number;
}

/**
 * Evaluation Result
 */
export interface EvaluationResult {
  flagId: string;
  enabled: boolean;
  variant?: string;
  value?: any;
  reason: string;
}

/**
 * Feature Flag Manager
 */
export class FeatureFlagManager extends EventEmitter {
  private flags = new Map<string, FeatureFlag>();
  private evaluationCache = new Map<string, { result: EvaluationResult; expiry: number }>();
  private cacheTTL = 60000; // 1 minute

  constructor(private config: {
    cacheTTL?: number;
    defaultEnabled?: boolean;
  } = {}) {
    super();
    this.cacheTTL = config.cacheTTL || 60000;
  }

  /**
   * Create or update a feature flag
   */
  upsertFlag(flag: Partial<FeatureFlag> & { id: string; name: string }): FeatureFlag {
    const existing = this.flags.get(flag.id);

    const fullFlag: FeatureFlag = {
      ...existing,
      ...flag,
      enabled: flag.enabled ?? existing?.enabled ?? false,
      updatedAt: new Date(),
      createdAt: existing?.createdAt || new Date()
    };

    this.flags.set(flag.id, fullFlag);
    this.invalidateCache(flag.id);
    this.emit('flag:upserted', fullFlag);

    return fullFlag;
  }

  /**
   * Get a feature flag
   */
  getFlag(flagId: string): FeatureFlag | undefined {
    return this.flags.get(flagId);
  }

  /**
   * Delete a feature flag
   */
  deleteFlag(flagId: string): boolean {
    const deleted = this.flags.delete(flagId);
    if (deleted) {
      this.invalidateCache(flagId);
      this.emit('flag:deleted', flagId);
    }
    return deleted;
  }

  /**
   * Evaluate a feature flag
   */
  evaluate(flagId: string, context: EvaluationContext = {}): EvaluationResult {
    // Check cache
    const cacheKey = this.getCacheKey(flagId, context);
    const cached = this.evaluationCache.get(cacheKey);
    if (cached && cached.expiry > Date.now()) {
      return cached.result;
    }

    const flag = this.flags.get(flagId);

    if (!flag) {
      return {
        flagId,
        enabled: this.config.defaultEnabled ?? false,
        reason: 'Flag not found'
      };
    }

    const result = this.evaluateFlag(flag, context);

    // Cache result
    this.evaluationCache.set(cacheKey, {
      result,
      expiry: Date.now() + this.cacheTTL
    });

    this.emit('flag:evaluated', { flagId, context, result });
    return result;
  }

  /**
   * Evaluate a flag with conditions and rollout
   */
  private evaluateFlag(flag: FeatureFlag, context: EvaluationContext): EvaluationResult {
    // Check if globally disabled
    if (!flag.enabled) {
      return {
        flagId: flag.id,
        enabled: false,
        reason: 'Flag is globally disabled'
      };
    }

    // Check conditions
    if (flag.conditions && flag.conditions.length > 0) {
      const conditionsMet = this.evaluateConditions(flag.conditions, context);
      if (!conditionsMet) {
        return {
          flagId: flag.id,
          enabled: false,
          reason: 'Conditions not met'
        };
      }
    }

    // Check rollout
    if (flag.rollout) {
      const rolloutEnabled = this.evaluateRollout(flag.rollout, context);
      if (!rolloutEnabled) {
        return {
          flagId: flag.id,
          enabled: false,
          reason: 'Not included in rollout'
        };
      }
    }

    // Select variant if available
    if (flag.variants && flag.variants.length > 0) {
      const variant = this.selectVariant(flag.variants, context);
      return {
        flagId: flag.id,
        enabled: true,
        variant: variant.id,
        value: variant.value,
        reason: 'Flag enabled with variant'
      };
    }

    return {
      flagId: flag.id,
      enabled: true,
      reason: 'Flag enabled'
    };
  }

  /**
   * Evaluate conditions
   */
  private evaluateConditions(conditions: FlagCondition[], context: EvaluationContext): boolean {
    return conditions.every(condition => this.evaluateCondition(condition, context));
  }

  /**
   * Evaluate a single condition
   */
  private evaluateCondition(condition: FlagCondition, context: EvaluationContext): boolean {
    if (condition.evaluate) {
      return condition.evaluate(context);
    }

    switch (condition.type) {
      case 'user':
        return this.evaluateUserCondition(condition, context);
      case 'group':
        return this.evaluateGroupCondition(condition, context);
      case 'percentage':
        return this.evaluatePercentageCondition(condition, context);
      case 'time':
        return this.evaluateTimeCondition(condition, context);
      case 'custom':
        return this.evaluateCustomCondition(condition, context);
      default:
        return false;
    }
  }

  private evaluateUserCondition(condition: FlagCondition, context: EvaluationContext): boolean {
    if (!context.userId) return false;

    switch (condition.operator) {
      case 'in':
        return Array.isArray(condition.value) && condition.value.includes(context.userId);
      case 'not-in':
        return Array.isArray(condition.value) && !condition.value.includes(context.userId);
      case 'eq':
        return context.userId === condition.value;
      case 'ne':
        return context.userId !== condition.value;
      default:
        return false;
    }
  }

  private evaluateGroupCondition(condition: FlagCondition, context: EvaluationContext): boolean {
    if (!context.groupId) return false;

    switch (condition.operator) {
      case 'in':
        return Array.isArray(condition.value) && condition.value.includes(context.groupId);
      case 'not-in':
        return Array.isArray(condition.value) && !condition.value.includes(context.groupId);
      case 'eq':
        return context.groupId === condition.value;
      case 'ne':
        return context.groupId !== condition.value;
      default:
        return false;
    }
  }

  private evaluatePercentageCondition(condition: FlagCondition, context: EvaluationContext): boolean {
    const hash = this.hash(context.userId || context.groupId || '');
    const percentage = (hash % 100) / 100;
    return percentage < condition.value;
  }

  private evaluateTimeCondition(condition: FlagCondition, context: EvaluationContext): boolean {
    const now = context.timestamp || Date.now();

    switch (condition.operator) {
      case 'gt':
        return now > condition.value;
      case 'lt':
        return now < condition.value;
      default:
        return false;
    }
  }

  private evaluateCustomCondition(condition: FlagCondition, context: EvaluationContext): boolean {
    if (!context.properties) return false;

    const property = context.properties[condition.type];
    if (property === undefined) return false;

    switch (condition.operator) {
      case 'eq':
        return property === condition.value;
      case 'ne':
        return property !== condition.value;
      case 'gt':
        return property > condition.value;
      case 'lt':
        return property < condition.value;
      case 'matches':
        return new RegExp(condition.value).test(String(property));
      default:
        return false;
    }
  }

  /**
   * Evaluate rollout
   */
  private evaluateRollout(rollout: RolloutConfig, context: EvaluationContext): boolean {
    switch (rollout.strategy) {
      case 'percentage':
        return this.evaluatePercentageRollout(rollout, context);
      case 'gradual':
        return this.evaluateGradualRollout(rollout, context);
      case 'canary':
        return this.evaluateCanaryRollout(rollout, context);
      case 'blue-green':
        return this.evaluateBlueGreenRollout(rollout, context);
      default:
        return false;
    }
  }

  private evaluatePercentageRollout(rollout: RolloutConfig, context: EvaluationContext): boolean {
    const hash = this.hash(context.userId || context.groupId || '');
    const percentage = (hash % 100) / 100;
    return percentage < (rollout.percentage || 0) / 100;
  }

  private evaluateGradualRollout(rollout: RolloutConfig, context: EvaluationContext): boolean {
    if (!rollout.stages || rollout.stages.length === 0) return false;

    const now = Date.now();
    let currentPercentage = 0;

    for (const stage of rollout.stages) {
      const stageEnd = stage.startTime.getTime() + stage.duration;
      if (now >= stage.startTime.getTime() && now < stageEnd) {
        // Currently in this stage
        const progress = (now - stage.startTime.getTime()) / stage.duration;
        currentPercentage = stage.percentage * progress;
        break;
      } else if (now >= stageEnd) {
        // Past this stage
        currentPercentage = stage.percentage;
      }
    }

    const hash = this.hash(context.userId || context.groupId || '');
    const userPercentage = (hash % 100) / 100;
    return userPercentage < currentPercentage / 100;
  }

  private evaluateCanaryRollout(rollout: RolloutConfig, context: EvaluationContext): boolean {
    // Canary: small percentage of users get the feature
    const canaryPercentage = rollout.percentage || 5;
    const hash = this.hash(context.userId || context.groupId || '');
    const percentage = (hash % 100) / 100;
    return percentage < canaryPercentage / 100;
  }

  private evaluateBlueGreenRollout(rollout: RolloutConfig, context: EvaluationContext): boolean {
    // Blue-Green: switch all users at once based on time
    if (!rollout.startTime) return false;
    return Date.now() >= rollout.startTime.getTime();
  }

  /**
   * Select variant based on weights
   */
  private selectVariant(variants: FlagVariant[], context: EvaluationContext): FlagVariant {
    // Check for overrides first
    for (const variant of variants) {
      if (variant.overrides) {
        for (const override of variant.overrides) {
          if (this.evaluateCondition(override.condition, context)) {
            const overrideVariant = variants.find(v => v.id === override.variantId);
            if (overrideVariant) return overrideVariant;
          }
        }
      }
    }

    // Select based on weights
    const totalWeight = variants.reduce((sum, v) => sum + v.weight, 0);
    const hash = this.hash(context.userId || context.groupId || '');
    const random = (hash % 1000) / 1000;

    let cumulativeWeight = 0;
    for (const variant of variants) {
      cumulativeWeight += variant.weight / totalWeight;
      if (random < cumulativeWeight) {
        return variant;
      }
    }

    return variants[0] || {
      id: 'default',
      name: 'Default',
      value: null,
      weight: 1,
      overrides: []
    };
  }

  /**
   * Get cache key
   */
  private getCacheKey(flagId: string, context: EvaluationContext): string {
    return `${flagId}:${context.userId || ''}:${context.groupId || ''}:${JSON.stringify(context.properties || {})}`;
  }

  /**
   * Invalidate cache for a flag
   */
  private invalidateCache(flagId: string): void {
    const keysToDelete: string[] = [];
    for (const key of this.evaluationCache.keys()) {
      if (key.startsWith(`${flagId}:`)) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach(key => this.evaluationCache.delete(key));
  }

  /**
   * Simple hash function
   */
  private hash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  /**
   * Bulk evaluate flags
   */
  evaluateAll(context: EvaluationContext = {}): Map<string, EvaluationResult> {
    const results = new Map<string, EvaluationResult>();

    for (const [flagId] of this.flags) {
      results.set(flagId, this.evaluate(flagId, context));
    }

    return results;
  }

  /**
   * Get all flags
   */
  getAllFlags(): FeatureFlag[] {
    return Array.from(this.flags.values());
  }

  /**
   * Export flags configuration
   */
  exportFlags(): any {
    return {
      flags: Array.from(this.flags.values()),
      metadata: {
        exportedAt: new Date(),
        flagCount: this.flags.size
      }
    };
  }

  /**
   * Import flags configuration
   */
  importFlags(data: any): void {
    if (!data.flags || !Array.isArray(data.flags)) {
      throw new Error('Invalid import data');
    }

    for (const flag of data.flags) {
      this.upsertFlag(flag);
    }

    this.emit('flags:imported', data);
  }

  /**
   * Clear all flags
   */
  clearFlags(): void {
    this.flags.clear();
    this.evaluationCache.clear();
    this.emit('flags:cleared');
  }
}

/**
 * Feature Flag Decorator
 */
export function FeatureFlag(flagId: string, options: { fallback?: any } = {}) {
  return function(target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function(...args: any[]) {
      // Get flag manager from context (would be injected)
      const manager = (this as any).featureFlagManager;
      if (!manager) {
        // No manager, use original method
        return originalMethod.apply(this, args);
      }

      // Get context (would be from request/session)
      const context = (this as any).getEvaluationContext?.() || {};

      const result = manager.evaluate(flagId, context);

      if (!result.enabled) {
        if (options.fallback !== undefined) {
          return typeof options.fallback === 'function'
            ? options.fallback.apply(this, args)
            : options.fallback;
        }
        throw new Error(`Feature ${flagId} is disabled`);
      }

      // If variant value is a function, use it instead
      if (result.value && typeof result.value === 'function') {
        return result.value.apply(this, args);
      }

      return originalMethod.apply(this, args);
    };

    return descriptor;
  };
}

/**
 * A/B Testing Framework
 */
export class ABTestingFramework {
  private manager: FeatureFlagManager;
  private metrics = new Map<string, any[]>();

  constructor() {
    this.manager = new FeatureFlagManager();
  }

  /**
   * Create A/B test
   */
  createABTest(config: {
    id: string;
    name: string;
    variants: Array<{ id: string; name: string; weight: number; implementation: any }>;
    metrics: string[];
  }): void {
    const flag: Partial<FeatureFlag> = {
      id: config.id,
      name: config.name,
      enabled: true,
      variants: config.variants.map(v => ({
        id: v.id,
        name: v.name,
        value: v.implementation,
        weight: v.weight,
        overrides: []
      }))
    };

    this.manager.upsertFlag(flag as FeatureFlag);

    // Initialize metrics collection
    config.metrics.forEach(metric => {
      if (!this.metrics.has(metric)) {
        this.metrics.set(metric, []);
      }
    });
  }

  /**
   * Get variant for user
   */
  getVariant(testId: string, userId: string): any {
    const result = this.manager.evaluate(testId, { userId });
    return result.value;
  }

  /**
   * Record metric
   */
  recordMetric(metric: string, value: any, context: { testId: string; userId: string; variant?: string }): void {
    const metrics = this.metrics.get(metric) || [];
    metrics.push({
      ...context,
      value,
      timestamp: Date.now()
    });
    this.metrics.set(metric, metrics);
  }

  /**
   * Get test results
   */
  getTestResults(testId: string): any {
    const results: any = {
      testId,
      variants: {},
      metrics: {}
    };

    // Aggregate metrics by variant
    for (const [metric, values] of this.metrics) {
      const byVariant: any = {};

      values.filter(v => v.testId === testId).forEach(v => {
        if (!byVariant[v.variant || 'control']) {
          byVariant[v.variant || 'control'] = [];
        }
        byVariant[v.variant || 'control'].push(v.value);
      });

      // Calculate statistics
      for (const [variant, variantValues] of Object.entries(byVariant)) {
        if (!results.variants[variant]) {
          results.variants[variant] = {};
        }

        results.variants[variant][metric] = {
          count: (variantValues as any[]).length,
          mean: this.mean(variantValues as number[]),
          median: this.median(variantValues as number[]),
          stdDev: this.stdDev(variantValues as number[])
        };
      }
    }

    return results;
  }

  private mean(values: number[]): number {
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }

  private median(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2
      ? sorted[mid] ?? 0
      : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  }

  private stdDev(values: number[]): number {
    const m = this.mean(values);
    const variance = values.reduce((sum, v) => sum + Math.pow(v - m, 2), 0) / values.length;
    return Math.sqrt(variance);
  }
}