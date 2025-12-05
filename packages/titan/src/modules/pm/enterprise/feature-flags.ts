/**
 * Feature Flags Implementation
 *
 * Provides feature toggles and progressive delivery capabilities
 */

import { EventEmitter } from 'events';

import { Errors } from '../../../errors/index.js';

/**
 * Audit log entry for flag changes
 */
export interface AuditLogEntry {
  id: string;
  flagId: string;
  action: 'created' | 'updated' | 'deleted' | 'evaluated' | 'killed' | 'restored';
  actor?: string;
  changes?: Record<string, { old: unknown; new: unknown }>;
  context?: EvaluationContext;
  result?: EvaluationResult;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

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
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  // Kill switch functionality
  killed?: boolean;
  killReason?: string;
  killedAt?: Date;
  killedBy?: string;
  // Inheritance and overrides
  parentId?: string;
  overrides?: FlagOverride[];
}

/**
 * Flag Override - allows child flags to override parent settings
 */
export interface FlagOverride {
  condition: FlagCondition;
  enabled?: boolean;
  variant?: string;
  rollout?: RolloutConfig;
}

/**
 * Flag Condition
 */
export interface FlagCondition {
  type: 'user' | 'group' | 'percentage' | 'time' | 'custom';
  operator: 'in' | 'not-in' | 'eq' | 'ne' | 'gt' | 'lt' | 'matches';
  value: unknown;
  evaluate?: (context: EvaluationContext) => boolean;
}

/**
 * Flag Variant
 */
export interface FlagVariant {
  id: string;
  name: string;
  value: unknown;
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
  properties?: Record<string, unknown>;
  timestamp?: number;
}

/**
 * Evaluation Result
 */
export interface EvaluationResult {
  flagId: string;
  enabled: boolean;
  variant?: string;
  value?: unknown;
  reason: string;
  inheritedFrom?: string;
}

/**
 * Feature Flag Manager
 */
export class FeatureFlagManager extends EventEmitter {
  private flags = new Map<string, FeatureFlag>();
  private evaluationCache = new Map<string, { result: EvaluationResult; expiry: number }>();
  private auditLog: AuditLogEntry[] = [];
  private cacheTTL = 60000; // 1 minute
  private maxAuditLogSize = 10000;

  constructor(
    private config: {
      cacheTTL?: number;
      defaultEnabled?: boolean;
      maxAuditLogSize?: number;
      enableAuditLog?: boolean;
    } = {}
  ) {
    super();
    this.cacheTTL = config.cacheTTL || 60000;
    this.maxAuditLogSize = config.maxAuditLogSize || 10000;
  }

  /**
   * Create or update a feature flag
   */
  upsertFlag(
    flag: Partial<FeatureFlag> & { id: string; name: string },
    actor?: string
  ): FeatureFlag {
    const existing = this.flags.get(flag.id);
    const isCreate = !existing;

    const fullFlag: FeatureFlag = {
      ...existing,
      ...flag,
      enabled: flag.enabled ?? existing?.enabled ?? false,
      updatedAt: new Date(),
      createdAt: existing?.createdAt || new Date(),
    };

    this.flags.set(flag.id, fullFlag);
    this.invalidateCache(flag.id);
    this.emit('flag:upserted', fullFlag);

    // Audit log
    this.addAuditLog({
      id: this.generateId(),
      flagId: flag.id,
      action: isCreate ? 'created' : 'updated',
      actor,
      changes: this.computeChanges(existing, fullFlag),
      timestamp: Date.now(),
    });

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
  deleteFlag(flagId: string, actor?: string): boolean {
    const flag = this.flags.get(flagId);
    const deleted = this.flags.delete(flagId);
    if (deleted) {
      this.invalidateCache(flagId);
      this.emit('flag:deleted', flagId);

      // Audit log
      this.addAuditLog({
        id: this.generateId(),
        flagId,
        action: 'deleted',
        actor,
        timestamp: Date.now(),
        metadata: { flag },
      });
    }
    return deleted;
  }

  /**
   * Kill switch - immediately disable a flag for emergency situations
   */
  killFlag(flagId: string, reason: string, actor?: string): void {
    const flag = this.flags.get(flagId);
    if (!flag) {
      throw Errors.notFound('Feature flag', flagId);
    }

    const updatedFlag: FeatureFlag = {
      ...flag,
      killed: true,
      killReason: reason,
      killedAt: new Date(),
      killedBy: actor,
      updatedAt: new Date(),
    };

    this.flags.set(flagId, updatedFlag);
    this.invalidateCache(flagId);
    this.emit('flag:killed', { flagId, reason, actor });

    // Audit log
    this.addAuditLog({
      id: this.generateId(),
      flagId,
      action: 'killed',
      actor,
      timestamp: Date.now(),
      metadata: { reason },
    });
  }

  /**
   * Restore a killed flag
   */
  restoreFlag(flagId: string, actor?: string): void {
    const flag = this.flags.get(flagId);
    if (!flag) {
      throw Errors.notFound('Feature flag', flagId);
    }

    if (!flag.killed) {
      throw Errors.badRequest('Flag is not killed');
    }

    const updatedFlag: FeatureFlag = {
      ...flag,
      killed: false,
      killReason: undefined,
      killedAt: undefined,
      killedBy: undefined,
      updatedAt: new Date(),
    };

    this.flags.set(flagId, updatedFlag);
    this.invalidateCache(flagId);
    this.emit('flag:restored', { flagId, actor });

    // Audit log
    this.addAuditLog({
      id: this.generateId(),
      flagId,
      action: 'restored',
      actor,
      timestamp: Date.now(),
    });
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
        reason: 'Flag not found',
      };
    }

    const result = this.evaluateFlagWithInheritance(flag, context);

    // Cache result
    this.evaluationCache.set(cacheKey, {
      result,
      expiry: Date.now() + this.cacheTTL,
    });

    this.emit('flag:evaluated', { flagId, context, result });

    // Audit log (optional, can be expensive)
    if (this.config.enableAuditLog) {
      this.addAuditLog({
        id: this.generateId(),
        flagId,
        action: 'evaluated',
        context,
        result,
        timestamp: Date.now(),
      });
    }

    return result;
  }

  /**
   * Evaluate a flag with inheritance support
   */
  private evaluateFlagWithInheritance(flag: FeatureFlag, context: EvaluationContext): EvaluationResult {
    // Check kill switch first (highest priority)
    if (flag.killed) {
      return {
        flagId: flag.id,
        enabled: false,
        reason: `Flag killed: ${flag.killReason || 'No reason provided'}`,
      };
    }

    // Check for parent flag inheritance
    let effectiveFlag = flag;
    let inheritedFrom: string | undefined;

    if (flag.parentId) {
      const parent = this.flags.get(flag.parentId);
      if (parent) {
        // Inherit from parent, but allow overrides
        effectiveFlag = this.mergeWithParent(flag, parent);
        inheritedFrom = parent.id;
      }
    }

    // Check for flag-level overrides based on context
    if (flag.overrides && flag.overrides.length > 0) {
      for (const override of flag.overrides) {
        if (this.evaluateCondition(override.condition, context)) {
          // Apply override
          if (override.enabled !== undefined) {
            effectiveFlag = { ...effectiveFlag, enabled: override.enabled };
          }
          if (override.rollout) {
            effectiveFlag = { ...effectiveFlag, rollout: override.rollout };
          }
          if (override.variant && effectiveFlag.variants) {
            const variant = effectiveFlag.variants.find((v) => v.id === override.variant);
            if (variant) {
              return {
                flagId: flag.id,
                enabled: true,
                variant: variant.id,
                value: variant.value,
                reason: 'Flag enabled with override variant',
                inheritedFrom,
              };
            }
          }
        }
      }
    }

    const result = this.evaluateFlag(effectiveFlag, context);
    return { ...result, inheritedFrom };
  }

  /**
   * Merge flag with parent, allowing child to override parent settings
   */
  private mergeWithParent(child: FeatureFlag, parent: FeatureFlag): FeatureFlag {
    // Determine effective enabled state
    // If child explicitly sets enabled (even to false), use that
    // Otherwise use parent's enabled state
    const hasExplicitEnabled = Object.prototype.hasOwnProperty.call(child, 'enabled');

    return {
      ...parent,
      ...child,
      // Child can override parent's enabled state
      enabled: hasExplicitEnabled ? child.enabled : parent.enabled,
      // Merge conditions (child conditions have priority)
      conditions: child.conditions || parent.conditions,
      // Merge variants (child variants override parent variants)
      variants: child.variants || parent.variants,
      // Child rollout overrides parent rollout
      rollout: child.rollout || parent.rollout,
      // Merge metadata
      metadata: { ...parent.metadata, ...child.metadata },
    };
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
        reason: 'Flag is globally disabled',
      };
    }

    // Check conditions
    if (flag.conditions && flag.conditions.length > 0) {
      const conditionsMet = this.evaluateConditions(flag.conditions, context);
      if (!conditionsMet) {
        return {
          flagId: flag.id,
          enabled: false,
          reason: 'Conditions not met',
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
          reason: 'Not included in rollout',
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
        reason: 'Flag enabled with variant',
      };
    }

    return {
      flagId: flag.id,
      enabled: true,
      reason: 'Flag enabled',
    };
  }

  /**
   * Evaluate conditions
   */
  private evaluateConditions(conditions: FlagCondition[], context: EvaluationContext): boolean {
    return conditions.every((condition) => this.evaluateCondition(condition, context));
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
    return percentage < (condition.value as number);
  }

  private evaluateTimeCondition(condition: FlagCondition, context: EvaluationContext): boolean {
    const now = context.timestamp || Date.now();
    const conditionValue = typeof condition.value === 'number' ? condition.value : Number(condition.value);

    switch (condition.operator) {
      case 'gt':
        return now > conditionValue;
      case 'lt':
        return now < conditionValue;
      default:
        return false;
    }
  }

  private evaluateCustomCondition(condition: FlagCondition, context: EvaluationContext): boolean {
    if (!context.properties) return false;

    // For custom conditions, we look for the property key in properties
    // The condition.type should be 'custom', so we need a different way to identify the property
    // For now, we'll use a simple approach: check all properties
    const property = context.properties?.['custom'];
    if (property === undefined) return false;

    switch (condition.operator) {
      case 'eq':
        return property === condition.value;
      case 'ne':
        return property !== condition.value;
      case 'gt':
        return (property as number) > (condition.value as number);
      case 'lt':
        return (property as number) < (condition.value as number);
      case 'matches':
        return new RegExp(String(condition.value)).test(String(property));
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
            const overrideVariant = variants.find((v) => v.id === override.variantId);
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

    return (
      variants[0] || {
        id: 'default',
        name: 'Default',
        value: null,
        weight: 1,
        overrides: [],
      }
    );
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
    keysToDelete.forEach((key) => this.evaluationCache.delete(key));
  }

  /**
   * Simple hash function
   */
  private hash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
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
        flagCount: this.flags.size,
      },
    };
  }

  /**
   * Import flags configuration
   */
  importFlags(data: any): void {
    if (!data.flags || !Array.isArray(data.flags)) {
      throw Errors.notFound('Invalid import data');
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

  /**
   * Get audit log entries
   */
  getAuditLog(filters?: {
    flagId?: string;
    action?: AuditLogEntry['action'];
    actor?: string;
    fromTimestamp?: number;
    toTimestamp?: number;
    limit?: number;
  }): AuditLogEntry[] {
    let filtered = this.auditLog;

    if (filters) {
      if (filters.flagId) {
        filtered = filtered.filter((entry) => entry.flagId === filters.flagId);
      }
      if (filters.action) {
        filtered = filtered.filter((entry) => entry.action === filters.action);
      }
      if (filters.actor) {
        filtered = filtered.filter((entry) => entry.actor === filters.actor);
      }
      if (filters.fromTimestamp) {
        filtered = filtered.filter((entry) => entry.timestamp >= filters.fromTimestamp!);
      }
      if (filters.toTimestamp) {
        filtered = filtered.filter((entry) => entry.timestamp <= filters.toTimestamp!);
      }
      if (filters.limit) {
        filtered = filtered.slice(-filters.limit);
      }
    }

    return filtered;
  }

  /**
   * Clear audit log
   */
  clearAuditLog(): void {
    this.auditLog = [];
    this.emit('audit:cleared');
  }

  /**
   * Add entry to audit log
   */
  private addAuditLog(entry: AuditLogEntry): void {
    this.auditLog.push(entry);

    // Trim audit log if it exceeds max size
    if (this.auditLog.length > this.maxAuditLogSize) {
      this.auditLog = this.auditLog.slice(-this.maxAuditLogSize);
    }

    this.emit('audit:logged', entry);
  }

  /**
   * Compute changes between two flags
   */
  private computeChanges(
    oldFlag: FeatureFlag | undefined,
    newFlag: FeatureFlag
  ): Record<string, { old: unknown; new: unknown }> | undefined {
    if (!oldFlag) return undefined;

    const changes: Record<string, { old: unknown; new: unknown }> = {};

    // Compare key fields
    const fieldsToCompare: Array<keyof FeatureFlag> = [
      'enabled',
      'name',
      'description',
      'killed',
      'killReason',
      'parentId',
    ];

    for (const field of fieldsToCompare) {
      if (oldFlag[field] !== newFlag[field]) {
        changes[field] = { old: oldFlag[field], new: newFlag[field] };
      }
    }

    // Compare complex fields using JSON
    const complexFields: Array<keyof FeatureFlag> = ['conditions', 'variants', 'rollout', 'metadata', 'overrides'];

    for (const field of complexFields) {
      const oldValue = JSON.stringify(oldFlag[field]);
      const newValue = JSON.stringify(newFlag[field]);
      if (oldValue !== newValue) {
        changes[field] = { old: oldFlag[field], new: newFlag[field] };
      }
    }

    return Object.keys(changes).length > 0 ? changes : undefined;
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Get flag hierarchy (parent and children)
   */
  getFlagHierarchy(flagId: string): { parent?: FeatureFlag; children: FeatureFlag[] } {
    const flag = this.flags.get(flagId);
    if (!flag) {
      throw Errors.notFound('Feature flag', flagId);
    }

    const parent = flag.parentId ? this.flags.get(flag.parentId) : undefined;
    const children = Array.from(this.flags.values()).filter((f) => f.parentId === flagId);

    return { parent, children };
  }

  /**
   * Bulk kill flags (kill switch for multiple flags)
   */
  bulkKillFlags(flagIds: string[], reason: string, actor?: string): void {
    for (const flagId of flagIds) {
      try {
        this.killFlag(flagId, reason, actor);
      } catch (error) {
        // Continue with other flags
        this.emit('flag:kill-failed', { flagId, error });
      }
    }
  }

  /**
   * Get flags by tag/metadata
   */
  getFlagsByMetadata(key: string, value: unknown): FeatureFlag[] {
    return Array.from(this.flags.values()).filter((flag) => flag.metadata?.[key] === value);
  }
}

/**
 * Feature Flag Decorator
 */
export function FeatureFlag(flagId: string, options: { fallback?: any } = {}) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
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
          return typeof options.fallback === 'function' ? options.fallback.apply(this, args) : options.fallback;
        }
        throw Errors.notFound(`Feature ${flagId} is disabled`);
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
 * Metric entry for A/B testing
 */
export interface MetricEntry {
  testId: string;
  userId: string;
  variant?: string;
  value: number;
  timestamp: number;
}

/**
 * Test results interface
 */
export interface TestResults {
  testId: string;
  variants: Record<
    string,
    Record<
      string,
      {
        count: number;
        mean: number;
        median: number;
        stdDev: number;
      }
    >
  >;
}

/**
 * A/B Testing Framework
 */
export class ABTestingFramework {
  private manager: FeatureFlagManager;
  private metrics = new Map<string, MetricEntry[]>();

  constructor(manager?: FeatureFlagManager) {
    this.manager = manager || new FeatureFlagManager();
  }

  /**
   * Get the underlying flag manager
   */
  getManager(): FeatureFlagManager {
    return this.manager;
  }

  /**
   * Create A/B test
   */
  createABTest(config: {
    id: string;
    name: string;
    variants: Array<{ id: string; name: string; weight: number; implementation: unknown }>;
    metrics: string[];
  }): void {
    const flag: Partial<FeatureFlag> & { id: string; name: string } = {
      id: config.id,
      name: config.name,
      enabled: true,
      variants: config.variants.map((v) => ({
        id: v.id,
        name: v.name,
        value: v.implementation,
        weight: v.weight,
        overrides: [],
      })),
    };

    this.manager.upsertFlag(flag);

    // Initialize metrics collection
    config.metrics.forEach((metric) => {
      if (!this.metrics.has(metric)) {
        this.metrics.set(metric, []);
      }
    });
  }

  /**
   * Get variant for user
   */
  getVariant(testId: string, userId: string): unknown {
    const result = this.manager.evaluate(testId, { userId });
    return result.value;
  }

  /**
   * Record metric
   */
  recordMetric(metric: string, value: number, context: { testId: string; userId: string; variant?: string }): void {
    const metrics = this.metrics.get(metric) || [];
    metrics.push({
      ...context,
      value,
      timestamp: Date.now(),
    });
    this.metrics.set(metric, metrics);
  }

  /**
   * Get test results
   */
  getTestResults(testId: string): TestResults {
    const results: TestResults = {
      testId,
      variants: {},
    };

    // Aggregate metrics by variant
    for (const [metric, values] of this.metrics) {
      const byVariant: Record<string, number[]> = {};

      values
        .filter((v) => v.testId === testId)
        .forEach((v) => {
          const variantKey = v.variant || 'control';
          if (!byVariant[variantKey]) {
            byVariant[variantKey] = [];
          }
          byVariant[variantKey].push(v.value);
        });

      // Calculate statistics
      for (const [variant, variantValues] of Object.entries(byVariant)) {
        if (!results.variants[variant]) {
          results.variants[variant] = {};
        }

        results.variants[variant][metric] = {
          count: variantValues.length,
          mean: this.mean(variantValues),
          median: this.median(variantValues),
          stdDev: this.stdDev(variantValues),
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
    return sorted.length % 2 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  }

  private stdDev(values: number[]): number {
    const m = this.mean(values);
    const variance = values.reduce((sum, v) => sum + Math.pow(v - m, 2), 0) / values.length;
    return Math.sqrt(variance);
  }
}
