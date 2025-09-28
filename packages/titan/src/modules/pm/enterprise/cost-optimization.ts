/**
 * Cost Optimization and Resource Management Implementation
 *
 * Provides intelligent cost optimization, resource management, and auto-scaling capabilities
 */

import { EventEmitter } from 'events';

/**
 * Cost Configuration
 */
export interface CostConfig {
  budget?: BudgetConfig;
  optimization?: OptimizationConfig;
  monitoring?: CostMonitoringConfig;
}

/**
 * Budget Configuration
 */
export interface BudgetConfig {
  monthly?: number;
  daily?: number;
  hourly?: number;
  alert?: number; // Alert threshold percentage (e.g., 0.8 for 80%)
  actions?: BudgetAction[];
}

/**
 * Budget Action
 */
export interface BudgetAction {
  threshold: number;
  action: 'alert' | 'throttle' | 'stop' | 'scale-down';
  target?: string;
}

/**
 * Optimization Configuration
 */
export interface OptimizationConfig {
  spotInstances?: boolean;
  autoScaleDown?: 'conservative' | 'balanced' | 'aggressive';
  idleShutdown?: string; // e.g., '5m', '1h'
  serverless?: ServerlessConfig;
  resourcePacking?: boolean;
  predictiveScaling?: boolean;
}

/**
 * Serverless Configuration
 */
export interface ServerlessConfig {
  enabled: boolean;
  coldStart?: 'fast' | 'normal';
  memory?: 'auto' | number;
  timeout?: number;
  concurrency?: number;
}

/**
 * Cost Monitoring Configuration
 */
export interface CostMonitoringConfig {
  enabled: boolean;
  interval?: string;
  metrics?: string[];
  export?: 'cloudwatch' | 'prometheus' | 'custom';
}

/**
 * Resource Usage
 */
export interface ResourceUsage {
  cpu: number;
  memory: number;
  network: number;
  storage: number;
  requests?: number;
  duration?: number;
}

/**
 * Cost Metrics
 */
export interface CostMetrics {
  timestamp: number;
  period: 'hourly' | 'daily' | 'monthly';
  compute: number;
  storage: number;
  network: number;
  total: number;
  projection?: number;
  savings?: number;
}

/**
 * Instance Type
 */
export interface InstanceType {
  id: string;
  name: string;
  cpu: number;
  memory: number;
  cost: number; // Per hour
  type: 'on-demand' | 'spot' | 'reserved';
  availability?: number;
}

/**
 * Cost Optimizer
 */
export class CostOptimizer extends EventEmitter {
  private currentCost = 0;
  private projectedCost = 0;
  private savings = 0;
  private resourceUsage = new Map<string, ResourceUsage>();
  private instanceTypes: InstanceType[] = [
    { id: 't3.micro', name: 'T3 Micro', cpu: 2, memory: 1024, cost: 0.01, type: 'on-demand' },
    { id: 't3.small', name: 'T3 Small', cpu: 2, memory: 2048, cost: 0.02, type: 'on-demand' },
    { id: 't3.medium', name: 'T3 Medium', cpu: 2, memory: 4096, cost: 0.04, type: 'on-demand' },
    { id: 't3.large', name: 'T3 Large', cpu: 2, memory: 8192, cost: 0.08, type: 'on-demand' },
    { id: 't3.xlarge', name: 'T3 XLarge', cpu: 4, memory: 16384, cost: 0.16, type: 'on-demand' },
    // Spot instances (cheaper)
    { id: 't3.micro-spot', name: 'T3 Micro Spot', cpu: 2, memory: 1024, cost: 0.003, type: 'spot', availability: 0.95 },
    { id: 't3.small-spot', name: 'T3 Small Spot', cpu: 2, memory: 2048, cost: 0.006, type: 'spot', availability: 0.95 },
  ];

  constructor(private config: CostConfig) {
    super();
    this.startMonitoring();
  }

  /**
   * Start cost monitoring
   */
  private startMonitoring(): void {
    if (!this.config.monitoring?.enabled) return;

    const interval = this.parseInterval(this.config.monitoring.interval || '1h');

    setInterval(() => {
      this.collectMetrics();
      this.analyzeUsage();
      this.checkBudget();
      this.optimizeResources();
    }, interval);
  }

  /**
   * Collect cost metrics
   */
  private collectMetrics(): void {
    const metrics = this.calculateCurrentMetrics();

    this.currentCost = metrics.total;
    this.projectedCost = this.projectCost(metrics);

    this.emit('metrics:collected', metrics);

    // Check for budget alerts
    if (this.config.budget) {
      this.checkBudgetThresholds(metrics);
    }
  }

  /**
   * Calculate current metrics
   */
  private calculateCurrentMetrics(): CostMetrics {
    let computeCost = 0;
    let storageCost = 0;
    let networkCost = 0;

    // Calculate compute costs
    for (const [id, usage] of this.resourceUsage) {
      computeCost += this.calculateComputeCost(usage);
      storageCost += this.calculateStorageCost(usage);
      networkCost += this.calculateNetworkCost(usage);
    }

    return {
      timestamp: Date.now(),
      period: 'hourly',
      compute: computeCost,
      storage: storageCost,
      network: networkCost,
      total: computeCost + storageCost + networkCost,
      savings: this.savings
    };
  }

  /**
   * Calculate compute cost
   */
  private calculateComputeCost(usage: ResourceUsage): number {
    // Simplified cost calculation
    const cpuCost = usage.cpu * 0.01; // $0.01 per CPU hour
    const memoryCost = (usage.memory / 1024) * 0.005; // $0.005 per GB hour
    return cpuCost + memoryCost;
  }

  /**
   * Calculate storage cost
   */
  private calculateStorageCost(usage: ResourceUsage): number {
    // $0.02 per GB month = ~$0.000027 per GB hour
    return usage.storage * 0.000027;
  }

  /**
   * Calculate network cost
   */
  private calculateNetworkCost(usage: ResourceUsage): number {
    // $0.01 per GB transferred
    return (usage.network / 1024) * 0.01;
  }

  /**
   * Project future cost
   */
  private projectCost(current: CostMetrics): number {
    // Simple linear projection
    const hoursInMonth = 730;
    return current.total * hoursInMonth;
  }

  /**
   * Check budget thresholds
   */
  private checkBudgetThresholds(metrics: CostMetrics): void {
    if (!this.config.budget) return;

    const { monthly, alert = 0.8, actions = [] } = this.config.budget;

    if (monthly && this.projectedCost > monthly * alert) {
      this.emit('budget:alert', {
        current: this.currentCost,
        projected: this.projectedCost,
        budget: monthly,
        percentage: this.projectedCost / monthly
      });

      // Execute budget actions
      for (const action of actions) {
        if (this.projectedCost > monthly * action.threshold) {
          this.executeBudgetAction(action);
        }
      }
    }
  }

  /**
   * Execute budget action
   */
  private executeBudgetAction(action: BudgetAction): void {
    this.emit('budget:action', action);

    switch (action.action) {
      case 'alert':
        // Already emitted alert
        break;
      case 'throttle':
        this.throttleResources(action.target);
        break;
      case 'scale-down':
        this.scaleDownResources(action.target);
        break;
      case 'stop':
        this.stopResources(action.target);
        break;
    }
  }

  /**
   * Analyze resource usage
   */
  private analyzeUsage(): void {
    const recommendations: Recommendation[] = [];

    for (const [id, usage] of this.resourceUsage) {
      // Check for idle resources
      if (usage.cpu < 10 && usage.requests === 0) {
        recommendations.push({
          type: 'idle-resource',
          resource: id,
          action: 'shutdown',
          savings: this.calculateComputeCost(usage)
        });
      }

      // Check for over-provisioned resources
      if (usage.cpu < 30 && usage.memory < 50) {
        recommendations.push({
          type: 'over-provisioned',
          resource: id,
          action: 'downsize',
          savings: this.calculateComputeCost(usage) * 0.3
        });
      }

      // Check for spot instance opportunities
      if (this.config.optimization?.spotInstances) {
        const spotSavings = this.calculateSpotSavings(usage);
        if (spotSavings > 0) {
          recommendations.push({
            type: 'spot-opportunity',
            resource: id,
            action: 'convert-to-spot',
            savings: spotSavings
          });
        }
      }
    }

    if (recommendations.length > 0) {
      this.emit('recommendations', recommendations);
      this.applyOptimizations(recommendations);
    }
  }

  /**
   * Calculate spot instance savings
   */
  private calculateSpotSavings(usage: ResourceUsage): number {
    const onDemandCost = this.calculateComputeCost(usage);
    const spotCost = onDemandCost * 0.3; // Spot is typically 70% cheaper
    return onDemandCost - spotCost;
  }

  /**
   * Apply optimizations
   */
  private applyOptimizations(recommendations: Recommendation[]): void {
    for (const rec of recommendations) {
      if (this.shouldApplyOptimization(rec)) {
        this.applyOptimization(rec);
        this.savings += rec.savings;
      }
    }
  }

  /**
   * Check if optimization should be applied
   */
  private shouldApplyOptimization(rec: Recommendation): boolean {
    const mode = this.config.optimization?.autoScaleDown || 'balanced';

    switch (mode) {
      case 'aggressive':
        return true;
      case 'balanced':
        return rec.savings > 0.01; // At least $0.01/hour savings
      case 'conservative':
        return rec.savings > 0.1; // At least $0.10/hour savings
      default:
        return false;
    }
  }

  /**
   * Apply single optimization
   */
  private applyOptimization(rec: Recommendation): void {
    switch (rec.action) {
      case 'shutdown':
        this.shutdownResource(rec.resource);
        break;
      case 'downsize':
        this.downsizeResource(rec.resource);
        break;
      case 'convert-to-spot':
        this.convertToSpot(rec.resource);
        break;
    }

    this.emit('optimization:applied', rec);
  }

  /**
   * Optimize resources
   */
  private optimizeResources(): void {
    if (this.config.optimization?.resourcePacking) {
      this.packResources();
    }

    if (this.config.optimization?.predictiveScaling) {
      this.predictiveScale();
    }

    if (this.config.optimization?.serverless?.enabled) {
      this.optimizeServerless();
    }
  }

  /**
   * Pack resources for better utilization
   */
  private packResources(): void {
    // Bin packing algorithm to consolidate workloads
    const resources = Array.from(this.resourceUsage.entries());
    const bins: any[] = [];

    for (const [id, usage] of resources) {
      let placed = false;

      for (const bin of bins) {
        if (bin.cpu + usage.cpu <= 100 && bin.memory + usage.memory <= 100) {
          bin.cpu += usage.cpu;
          bin.memory += usage.memory;
          bin.resources.push(id);
          placed = true;
          break;
        }
      }

      if (!placed) {
        bins.push({
          cpu: usage.cpu,
          memory: usage.memory,
          resources: [id]
        });
      }
    }

    // Consolidate bins if beneficial
    if (bins.length < resources.length * 0.7) {
      this.emit('packing:optimized', { before: resources.length, after: bins.length });
    }
  }

  /**
   * Predictive scaling based on patterns
   */
  private predictiveScale(): void {
    const hour = new Date().getHours();
    const dayOfWeek = new Date().getDay();

    // Simple pattern recognition
    const isBusinessHours = hour >= 9 && hour <= 17 && dayOfWeek >= 1 && dayOfWeek <= 5;
    const isPeakHour = hour >= 12 && hour <= 14;

    if (isPeakHour) {
      this.emit('scaling:predictive', { action: 'scale-up', reason: 'peak-hour' });
    } else if (!isBusinessHours) {
      this.emit('scaling:predictive', { action: 'scale-down', reason: 'off-hours' });
    }
  }

  /**
   * Optimize serverless functions
   */
  private optimizeServerless(): void {
    const config = this.config.optimization?.serverless;
    if (!config) return;

    // Auto-adjust memory based on usage patterns
    if (config.memory === 'auto') {
      for (const [id, usage] of this.resourceUsage) {
        const optimalMemory = this.calculateOptimalMemory(usage);
        this.emit('serverless:optimize', { resource: id, memory: optimalMemory });
      }
    }
  }

  /**
   * Calculate optimal memory for serverless
   */
  private calculateOptimalMemory(usage: ResourceUsage): number {
    // Balance between cost and performance
    const minMemory = 128;
    const maxMemory = 3008;
    const optimalMemory = Math.min(maxMemory, Math.max(minMemory, usage.memory));

    // Round to nearest 64MB increment (Lambda requirement)
    return Math.ceil(optimalMemory / 64) * 64;
  }

  /**
   * Track resource usage
   */
  trackUsage(resourceId: string, usage: ResourceUsage): void {
    this.resourceUsage.set(resourceId, usage);

    // Check for immediate optimization opportunities
    if (this.config.optimization?.idleShutdown) {
      this.checkIdleShutdown(resourceId, usage);
    }
  }

  /**
   * Check for idle shutdown
   */
  private checkIdleShutdown(resourceId: string, usage: ResourceUsage): void {
    const idleThreshold = this.parseInterval(this.config.optimization?.idleShutdown || '5m');

    if (usage.cpu < 1 && usage.requests === 0) {
      // Schedule shutdown after idle period
      setTimeout(() => {
        const currentUsage = this.resourceUsage.get(resourceId);
        if (currentUsage && currentUsage.cpu < 1 && currentUsage.requests === 0) {
          this.shutdownResource(resourceId);
        }
      }, idleThreshold);
    }
  }

  /**
   * Select optimal instance type
   */
  selectOptimalInstance(requirements: {
    cpu: number;
    memory: number;
    spot?: boolean;
  }): InstanceType | null {
    const candidates = this.instanceTypes
      .filter(i => i.cpu >= requirements.cpu && i.memory >= requirements.memory)
      .filter(i => !requirements.spot || i.type === 'spot');

    if (candidates.length === 0) return null;

    // Select cheapest option that meets requirements
    return candidates.sort((a, b) => a.cost - b.cost)[0] || null;
  }

  /**
   * Batch processing optimization
   */
  optimizeBatch(jobs: any[]): BatchOptimization {
    const totalWork = jobs.reduce((sum, job) => sum + (job.work || 1), 0);
    const spotPrice = 0.003; // Price per work unit on spot
    const onDemandPrice = 0.01; // Price per work unit on demand

    // Use spot for large batches with flexible deadlines
    const useSpot = totalWork > 1000 && !jobs.some(j => j.urgent);

    return {
      strategy: useSpot ? 'spot' : 'on-demand',
      estimatedCost: totalWork * (useSpot ? spotPrice : onDemandPrice),
      estimatedTime: totalWork * (useSpot ? 1.2 : 1), // Spot might be slower
      instances: Math.ceil(totalWork / 100) // 100 work units per instance
    };
  }

  /**
   * Get cost report
   */
  getCostReport(): CostReport {
    return {
      current: {
        hourly: this.currentCost,
        daily: this.currentCost * 24,
        monthly: this.projectedCost
      },
      breakdown: {
        compute: this.currentCost * 0.7,
        storage: this.currentCost * 0.2,
        network: this.currentCost * 0.1
      },
      savings: {
        realized: this.savings,
        potential: this.calculatePotentialSavings()
      },
      recommendations: this.getTopRecommendations()
    };
  }

  /**
   * Calculate potential savings
   */
  private calculatePotentialSavings(): number {
    let potential = 0;

    // Spot instances
    if (!this.config.optimization?.spotInstances) {
      potential += this.currentCost * 0.5; // Could save 50% with spot
    }

    // Idle resources
    for (const [, usage] of this.resourceUsage) {
      if (usage.cpu < 10) {
        potential += this.calculateComputeCost(usage) * 0.8;
      }
    }

    return potential;
  }

  /**
   * Get top recommendations
   */
  private getTopRecommendations(): string[] {
    const recommendations = [];

    if (!this.config.optimization?.spotInstances) {
      recommendations.push('Enable spot instances for 50-70% cost savings');
    }

    if (!this.config.optimization?.resourcePacking) {
      recommendations.push('Enable resource packing to improve utilization');
    }

    if (!this.config.optimization?.serverless?.enabled) {
      recommendations.push('Consider serverless for variable workloads');
    }

    return recommendations;
  }

  // Resource management methods
  private throttleResources(target?: string): void {
    this.emit('resources:throttled', { target });
  }

  private scaleDownResources(target?: string): void {
    this.emit('resources:scaled-down', { target });
  }

  private stopResources(target?: string): void {
    this.emit('resources:stopped', { target });
  }

  private shutdownResource(resourceId: string): void {
    this.resourceUsage.delete(resourceId);
    this.emit('resource:shutdown', { resourceId });
  }

  private downsizeResource(resourceId: string): void {
    const usage = this.resourceUsage.get(resourceId);
    if (usage) {
      usage.cpu *= 0.5;
      usage.memory *= 0.5;
    }
    this.emit('resource:downsized', { resourceId });
  }

  private convertToSpot(resourceId: string): void {
    this.emit('resource:converted-to-spot', { resourceId });
  }

  private parseInterval(interval: string): number {
    const match = interval.match(/^(\d+)([smh])$/);
    if (!match) return 3600000; // Default 1 hour

    const [, value, unit] = match;
    const num = parseInt(value || '0', 10);

    switch (unit) {
      case 's': return num * 1000;
      case 'm': return num * 60 * 1000;
      case 'h': return num * 60 * 60 * 1000;
      default: return 3600000;
    }
  }

  private checkBudget(): void {
    // Implementation handled in checkBudgetThresholds
  }
}

/**
 * Recommendation
 */
export interface Recommendation {
  type: string;
  resource: string;
  action: string;
  savings: number;
}

/**
 * Batch Optimization
 */
export interface BatchOptimization {
  strategy: 'spot' | 'on-demand';
  estimatedCost: number;
  estimatedTime: number;
  instances: number;
}

/**
 * Cost Report
 */
export interface CostReport {
  current: {
    hourly: number;
    daily: number;
    monthly: number;
  };
  breakdown: {
    compute: number;
    storage: number;
    network: number;
  };
  savings: {
    realized: number;
    potential: number;
  };
  recommendations: string[];
}

