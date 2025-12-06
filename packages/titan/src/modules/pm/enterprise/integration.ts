/**
 * Enterprise Features Integration Layer
 *
 * Provides seamless integration between enterprise modules and core ProcessManager.
 * This module acts as a facade for enabling enterprise capabilities on process pools
 * and individual processes.
 */

import { EventEmitter } from 'events';
import type { IProcessManager, IProcessPool, ServiceProxy } from '../types.js';
import type { ILogger } from '../../logger/logger.types.js';

// Enterprise module imports
import { FeatureFlagManager, type FeatureFlag, type EvaluationContext } from './feature-flags.js';
import { ChaosOrchestrator, ChaosType, type ChaosExperiment } from './chaos-engineering.js';
import { AdaptiveScalingController, type ScalingMetrics, type ScalingPolicy } from './adaptive-scaling.js';
import { TimeTravelDebugger, type TimeTravelOptions } from './time-travel.js';
import { AuditLogger, type AuditConfig } from './compliance.js';
import { Errors } from '../../../errors/index.js';

/**
 * Enterprise features configuration
 */
export interface IEnterpriseConfig {
  /** Enable feature flags integration */
  featureFlags?: {
    enabled: boolean;
    flags?: Array<FeatureFlag>;
    cacheTTL?: number;
  };

  /** Enable chaos engineering */
  chaos?: {
    enabled: boolean;
  };

  /** Enable adaptive scaling beyond basic auto-scale */
  adaptiveScaling?: {
    enabled: boolean;
    policies?: ScalingPolicy[];
    minInstances?: number;
    maxInstances?: number;
  };

  /** Enable time-travel debugging */
  timeTravel?: {
    enabled: boolean;
    maxSnapshots?: number;
    snapshotInterval?: number;
  };

  /** Enable audit logging */
  audit?: {
    enabled: boolean;
    config?: AuditConfig;
  };
}

/**
 * Enterprise Features Manager
 *
 * Integrates enterprise capabilities with the core ProcessManager.
 * Provides a unified API for enabling and managing enterprise features.
 *
 * @example
 * ```typescript
 * const pm = new ProcessManager(logger, config);
 * const enterprise = new EnterpriseFeatures(pm, logger);
 *
 * // Enable feature flags
 * enterprise.enableFeatureFlags({
 *   flags: [{ id: 'new-algorithm', name: 'New Algorithm', enabled: true }]
 * });
 *
 * // Check if feature is enabled
 * const enabled = enterprise.isFeatureEnabled('new-algorithm', { userId: 'user-1' });
 * ```
 */
export class EnterpriseFeatures extends EventEmitter {
  private featureFlagManager?: FeatureFlagManager;
  private chaosOrchestrator?: ChaosOrchestrator;
  private adaptiveScaler?: AdaptiveScalingController;
  private timeTravelDebuggers = new Map<string, TimeTravelDebugger>();
  private auditLogger?: AuditLogger;

  private readonly config: IEnterpriseConfig;

  constructor(
    private readonly processManager: IProcessManager,
    private readonly logger: ILogger,
    config: IEnterpriseConfig = {}
  ) {
    super();
    this.config = config;

    // Initialize enabled features
    if (config.featureFlags?.enabled) {
      this.initFeatureFlags(config.featureFlags);
    }
    if (config.chaos?.enabled) {
      this.initChaosEngineering();
    }
    if (config.adaptiveScaling?.enabled) {
      this.initAdaptiveScaling(config.adaptiveScaling);
    }
    if (config.audit?.enabled) {
      this.initAuditLogging(config.audit);
    }
  }

  // ==========================================================================
  // Feature Flags Integration
  // ==========================================================================

  private initFeatureFlags(config: NonNullable<IEnterpriseConfig['featureFlags']>): void {
    this.featureFlagManager = new FeatureFlagManager({
      cacheTTL: config.cacheTTL ?? 60000,
    });

    // Register initial flags
    if (config.flags) {
      config.flags.forEach((flag) => {
        this.featureFlagManager!.upsertFlag(flag);
      });
    }

    this.logger.info({ flagCount: config.flags?.length ?? 0 }, 'Feature flags initialized');
  }

  /**
   * Enable feature flags integration
   */
  enableFeatureFlags(config: NonNullable<IEnterpriseConfig['featureFlags']>): void {
    this.initFeatureFlags({ ...config, enabled: true });
  }

  /**
   * Check if a feature is enabled
   */
  isFeatureEnabled(flagId: string, context: EvaluationContext = {}): boolean {
    if (!this.featureFlagManager) {
      return false;
    }

    const result = this.featureFlagManager.evaluate(flagId, context);
    return result.enabled;
  }

  /**
   * Get feature flag value/variant
   */
  getFeatureValue<T = unknown>(
    flagId: string,
    context: EvaluationContext,
    defaultValue: T
  ): T {
    if (!this.featureFlagManager) {
      return defaultValue;
    }

    const result = this.featureFlagManager.evaluate(flagId, context);
    return (result.value as T) ?? defaultValue;
  }

  /**
   * Update a feature flag
   */
  updateFeatureFlag(flag: FeatureFlag): void {
    if (!this.featureFlagManager) {
      throw Errors.badRequest('Feature flags not enabled');
    }
    this.featureFlagManager.upsertFlag(flag);
    this.emit('featureFlag:updated', flag);
  }

  /**
   * Get feature flag manager for direct access
   */
  getFeatureFlagManager(): FeatureFlagManager | undefined {
    return this.featureFlagManager;
  }

  // ==========================================================================
  // Chaos Engineering Integration
  // ==========================================================================

  private initChaosEngineering(): void {
    this.chaosOrchestrator = new ChaosOrchestrator();

    this.logger.info('Chaos engineering initialized');
  }

  /**
   * Enable chaos engineering
   */
  enableChaosEngineering(): void {
    this.initChaosEngineering();
  }

  /**
   * Register a chaos experiment
   */
  registerChaosExperiment(experiment: ChaosExperiment): void {
    if (!this.chaosOrchestrator) {
      throw Errors.badRequest('Chaos engineering not enabled');
    }

    this.chaosOrchestrator.registerExperiment(experiment);
    this.emit('chaos:registered', experiment);
  }

  /**
   * Run a chaos experiment
   */
  async runChaosExperiment(experimentId: string): Promise<void> {
    if (!this.chaosOrchestrator) {
      throw Errors.badRequest('Chaos engineering not enabled');
    }

    await this.chaosOrchestrator.runExperiment(experimentId);
    this.emit('chaos:completed', { experimentId });
  }

  /**
   * Get chaos orchestrator for direct access
   */
  getChaosOrchestrator(): ChaosOrchestrator | undefined {
    return this.chaosOrchestrator;
  }

  // ==========================================================================
  // Adaptive Scaling Integration
  // ==========================================================================

  private initAdaptiveScaling(config: NonNullable<IEnterpriseConfig['adaptiveScaling']>): void {
    this.adaptiveScaler = new AdaptiveScalingController(
      config.minInstances ?? 1,
      config.maxInstances ?? 10,
      config.policies ?? []
    );

    this.adaptiveScaler.on('decision', (decision) => {
      this.emit('scaling:decision', decision);
      this.logger.debug({ decision }, 'Scaling decision made');
    });

    this.adaptiveScaler.on('scaling', (event) => {
      this.emit('scaling:executed', event);
      this.logger.info(
        { from: event.from, to: event.to },
        'Adaptive scaling executed'
      );
    });

    this.logger.info('Adaptive scaling initialized');
  }

  /**
   * Enable adaptive scaling
   */
  enableAdaptiveScaling(config: NonNullable<IEnterpriseConfig['adaptiveScaling']>): void {
    this.initAdaptiveScaling({ ...config, enabled: true });
  }

  /**
   * Update metrics for adaptive scaling decision
   */
  async updateScalingMetrics(metrics: ScalingMetrics): Promise<void> {
    if (!this.adaptiveScaler) {
      return;
    }

    await this.adaptiveScaler.updateMetrics(metrics);
  }

  /**
   * Add custom scaling policy
   */
  addScalingPolicy(policy: ScalingPolicy): void {
    if (!this.adaptiveScaler) {
      throw Errors.badRequest('Adaptive scaling not enabled');
    }
    this.adaptiveScaler.addPolicy(policy);
    this.emit('scaling:policyAdded', policy);
  }

  /**
   * Get current scaling state
   */
  getScalingState(): ReturnType<AdaptiveScalingController['getState']> | null {
    return this.adaptiveScaler?.getState() ?? null;
  }

  /**
   * Get adaptive scaler for direct access
   */
  getAdaptiveScaler(): AdaptiveScalingController | undefined {
    return this.adaptiveScaler;
  }

  // ==========================================================================
  // Time-Travel Debugging Integration
  // ==========================================================================

  /**
   * Enable time-travel debugging for a process
   */
  enableTimeTravel(
    processId: string,
    options?: TimeTravelOptions
  ): TimeTravelDebugger {
    const debugger_ = new TimeTravelDebugger(processId, {
      maxSnapshots: this.config.timeTravel?.maxSnapshots ?? 100,
      snapshotInterval: this.config.timeTravel?.snapshotInterval ?? 1000,
      ...options,
    });

    this.timeTravelDebuggers.set(processId, debugger_);

    debugger_.on('snapshot:recorded', (snapshot) => {
      this.emit('timeTravel:snapshot', { processId, snapshot });
    });

    this.logger.info({ processId }, 'Time-travel debugging enabled');
    return debugger_;
  }

  /**
   * Get time-travel debugger for a process
   */
  getTimeTravel(processId: string): TimeTravelDebugger | undefined {
    return this.timeTravelDebuggers.get(processId);
  }

  /**
   * Record state snapshot for a process
   */
  recordSnapshot<T>(processId: string, state: T, metadata?: Record<string, unknown>): void {
    const debugger_ = this.timeTravelDebuggers.get(processId);
    if (debugger_) {
      debugger_.recordSnapshot(state, metadata);
    }
  }

  /**
   * Travel to a specific point in time for a process
   * @param processId - The process ID
   * @param timestamp - The timestamp to travel to (finds closest snapshot before this time)
   */
  travelTo<T>(processId: string, timestamp: number): T | null {
    const debugger_ = this.timeTravelDebuggers.get(processId);
    if (!debugger_) {
      throw Errors.badRequest(`Time-travel not enabled for process ${processId}`);
    }

    const snapshot = debugger_.travelTo(timestamp);
    return snapshot?.state as T | null;
  }

  // ==========================================================================
  // Audit Logging Integration
  // ==========================================================================

  private initAuditLogging(config: NonNullable<IEnterpriseConfig['audit']>): void {
    const defaultConfig: AuditConfig = {
      level: 'standard',
      retention: '7y',
      encryption: false,
      immutable: false,
      redactPII: true,
      standards: [],
    };

    this.auditLogger = new AuditLogger({ ...defaultConfig, ...config.config });

    this.logger.info('Audit logging initialized');
  }

  /**
   * Enable audit logging
   */
  enableAuditLogging(config?: AuditConfig): void {
    this.initAuditLogging({ enabled: true, config });
  }

  /**
   * Log an audit event
   */
  logAuditEvent(
    action: string,
    resourceType: string,
    resourceId: string,
    actor: string,
    details?: Record<string, unknown>
  ): void {
    if (!this.auditLogger) {
      return;
    }

    this.auditLogger.log({
      action,
      resource: { type: resourceType, id: resourceId },
      actor: { id: actor, type: 'user' },
      outcome: 'success',
      metadata: details,
    });
  }

  /**
   * Get audit logger for direct access
   */
  getAuditLogger(): AuditLogger | undefined {
    return this.auditLogger;
  }

  // ==========================================================================
  // Process Lifecycle Integration
  // ==========================================================================

  /**
   * Wrap a process proxy with enterprise features
   */
  wrapProxy<T>(
    proxy: ServiceProxy<T>,
    processId: string,
    features: {
      featureFlags?: boolean;
      timeTravel?: boolean;
      audit?: boolean;
    } = {}
  ): ServiceProxy<T> {
    // Enable time-travel if requested
    if (features.timeTravel && !this.timeTravelDebuggers.has(processId)) {
      this.enableTimeTravel(processId);
    }

    // Create wrapped proxy with enterprise hooks
    const handler: ProxyHandler<ServiceProxy<T>> = {
      get: (target, prop: string | symbol) => {
        const value = Reflect.get(target, prop);

        if (typeof value === 'function' && typeof prop === 'string') {
          return async (...args: unknown[]) => {
            // Pre-call hooks
            if (features.audit) {
              this.logAuditEvent(
                'method_call',
                'process',
                processId,
                'system',
                { method: prop, argsCount: args.length }
              );
            }

            // Feature flag check
            if (features.featureFlags) {
              const methodFlag = `method:${processId}:${prop}`;
              const enabled = this.isFeatureEnabled(methodFlag, {});
              if (!enabled && this.featureFlagManager?.getFlag(methodFlag)) {
                throw Errors.forbidden(`Method ${prop} is disabled by feature flag`);
              }
            }

            // Execute method
            const result = await (value as (...args: unknown[]) => Promise<unknown>).apply(target, args);

            // Post-call hooks - record state for time-travel
            if (features.timeTravel) {
              this.recordSnapshot(processId, { method: prop, result, timestamp: Date.now() });
            }

            return result;
          };
        }

        return value;
      },
    };

    return new Proxy(proxy, handler);
  }

  // ==========================================================================
  // Cleanup
  // ==========================================================================

  /**
   * Shutdown all enterprise features
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down enterprise features');

    // Clear time-travel debuggers
    this.timeTravelDebuggers.clear();

    this.emit('shutdown');
    this.removeAllListeners();
  }
}

// Re-export for convenience
export { ChaosType };
