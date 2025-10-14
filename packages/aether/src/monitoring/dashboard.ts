/**
 * Performance Dashboard
 *
 * Real-time performance monitoring dashboard with metrics visualization.
 *
 * @module monitoring/dashboard
 */

import { signal } from '../core/reactivity/signal.js';
import { computed } from '../core/reactivity/computed.js';
import { getPerformanceMonitor } from './performance.js';
import { getComponentTracker } from './component-tracking.js';
import { getSignalTracker } from './signal-tracking.js';
import { getMemoryProfiler } from './memory-profiler.js';
import { getNetworkMonitor } from './network-monitor.js';

export interface DashboardMetrics {
  performance: {
    totalMarks: number;
    totalMeasures: number;
    totalViolations: number;
    averageDuration: number;
  };
  components: {
    totalComponents: number;
    topRerendering: Array<{ name: string; renderCount: number }>;
    slowest: Array<{ name: string; averageDuration: number }>;
  };
  signals: {
    mostUpdated: Array<{ signalId: string; updateCount: number }>;
    mostSubscribed: Array<{ signalId: string; subscriptionCount: number }>;
    circularDependencies: number;
  };
  memory: {
    currentUsage: number;
    percentage: number;
    totalDOMNodes: number;
    totalEventListeners: number;
    leaksDetected: number;
  };
  network: {
    totalRequests: number;
    successRate: number;
    cacheHitRate: number;
    averageDuration: number;
  };
}

export interface DashboardConfig {
  enabled?: boolean;
  updateInterval?: number;
  enablePerformance?: boolean;
  enableComponents?: boolean;
  enableSignals?: boolean;
  enableMemory?: boolean;
  enableNetwork?: boolean;
}

export class PerformanceDashboard {
  private config: Required<DashboardConfig>;
  private updateTimer?: ReturnType<typeof setInterval>;
  private enabled = true;

  public metrics = signal<DashboardMetrics>({
    performance: { totalMarks: 0, totalMeasures: 0, totalViolations: 0, averageDuration: 0 },
    components: { totalComponents: 0, topRerendering: [], slowest: [] },
    signals: { mostUpdated: [], mostSubscribed: [], circularDependencies: 0 },
    memory: { currentUsage: 0, percentage: 0, totalDOMNodes: 0, totalEventListeners: 0, leaksDetected: 0 },
    network: { totalRequests: 0, successRate: 0, cacheHitRate: 0, averageDuration: 0 },
  });

  public healthScore = computed(() => {
    const m = this.metrics();
    let score = 100;

    if (m.performance.totalViolations > 0) score -= m.performance.totalViolations * 2;
    if (m.memory.percentage > 80) score -= 20;
    if (m.network.successRate < 95) score -= 10;
    if (m.signals.circularDependencies > 0) score -= 15;

    return Math.max(0, Math.min(100, score));
  });

  constructor(config: DashboardConfig = {}) {
    this.config = {
      enabled: config.enabled ?? true,
      updateInterval: config.updateInterval ?? 1000,
      enablePerformance: config.enablePerformance ?? true,
      enableComponents: config.enableComponents ?? true,
      enableSignals: config.enableSignals ?? true,
      enableMemory: config.enableMemory ?? true,
      enableNetwork: config.enableNetwork ?? true,
    };

    this.enabled = this.config.enabled;

    if (this.enabled) {
      this.startUpdates();
    }
  }

  private startUpdates(): void {
    this.updateTimer = setInterval(() => {
      this.updateMetrics();
    }, this.config.updateInterval);

    this.updateMetrics();
  }

  private updateMetrics(): void {
    const metrics: DashboardMetrics = {
      performance: this.getPerformanceMetrics(),
      components: this.getComponentMetrics(),
      signals: this.getSignalMetrics(),
      memory: this.getMemoryMetrics(),
      network: this.getNetworkMetrics(),
    };

    this.metrics.set(metrics);
  }

  private getPerformanceMetrics() {
    if (!this.config.enablePerformance) {
      return { totalMarks: 0, totalMeasures: 0, totalViolations: 0, averageDuration: 0 };
    }

    const monitor = getPerformanceMonitor();
    const summary = monitor.getSummary();

    return {
      totalMarks: summary.totalMarks,
      totalMeasures: summary.totalMeasures,
      totalViolations: summary.totalViolations,
      averageDuration: summary.averageDuration,
    };
  }

  private getComponentMetrics() {
    if (!this.config.enableComponents) {
      return { totalComponents: 0, topRerendering: [], slowest: [] };
    }

    const tracker = getComponentTracker();

    return {
      totalComponents: tracker.getAllComponents().length,
      topRerendering: tracker.getTopRerenderingComponents(5),
      slowest: tracker.getSlowestComponents(5),
    };
  }

  private getSignalMetrics() {
    if (!this.config.enableSignals) {
      return { mostUpdated: [], mostSubscribed: [], circularDependencies: 0 };
    }

    const tracker = getSignalTracker();

    return {
      mostUpdated: tracker.getMostUpdatedSignals(5),
      mostSubscribed: tracker.getMostSubscribedSignals(5),
      circularDependencies: tracker.getCircularDependencies().length,
    };
  }

  private getMemoryMetrics() {
    if (!this.config.enableMemory) {
      return { currentUsage: 0, percentage: 0, totalDOMNodes: 0, totalEventListeners: 0, leaksDetected: 0 };
    }

    const profiler = getMemoryProfiler();
    const snapshot = profiler.getLatestSnapshot();

    return {
      currentUsage: snapshot?.usedJSHeapSize || 0,
      percentage: snapshot?.percentage || 0,
      totalDOMNodes: profiler.getTotalDOMNodes(),
      totalEventListeners: profiler.getTotalEventListeners(),
      leaksDetected: profiler.getDetectedLeaks().length,
    };
  }

  private getNetworkMetrics() {
    if (!this.config.enableNetwork) {
      return { totalRequests: 0, successRate: 0, cacheHitRate: 0, averageDuration: 0 };
    }

    const monitor = getNetworkMonitor();
    const stats = monitor.getStats();

    return {
      totalRequests: stats.totalRequests,
      successRate: stats.totalRequests > 0 ? (stats.successfulRequests / stats.totalRequests) * 100 : 100,
      cacheHitRate: monitor.getCacheHitRate(),
      averageDuration: stats.averageDuration,
    };
  }

  enable(): void {
    this.enabled = true;
    if (!this.updateTimer) {
      this.startUpdates();
    }
  }

  disable(): void {
    this.enabled = false;
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = undefined;
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  dispose(): void {
    this.disable();
  }
}

let globalDashboard: PerformanceDashboard | null = null;

export function getPerformanceDashboard(config?: DashboardConfig): PerformanceDashboard {
  if (!globalDashboard) {
    globalDashboard = new PerformanceDashboard(config);
  }
  return globalDashboard;
}

export function resetPerformanceDashboard(): void {
  if (globalDashboard) {
    globalDashboard.dispose();
    globalDashboard = null;
  }
}
