/**
 * Production Error Monitor
 *
 * Monitors errors in production with aggregation, alerting, and sampling.
 *
 * @module error-tracking/production-monitor
 */

import { signal } from '../core/reactivity/signal.js';
import { computed } from '../core/reactivity/computed.js';
import { getErrorAnalytics } from './error-analytics.js';
import { getErrorReporter } from './error-reporter.js';

export interface AlertRule {
  name: string;
  condition: (metrics: ProductionMetrics) => boolean;
  action: (metrics: ProductionMetrics) => void;
  cooldown?: number;
  lastTriggered?: number;
}

export interface ProductionMetrics {
  totalErrors: number;
  errorRate: number;
  uniqueErrors: number;
  affectedUsers: number;
  criticalErrors: number;
  timestamp: number;
}

export interface MonitorConfig {
  enabled?: boolean;
  sampleRate?: number;
  errorThreshold?: number;
  criticalThreshold?: number;
  aggregationWindow?: number;
  alertRules?: AlertRule[];
}

export class ProductionMonitor {
  private config: Required<MonitorConfig>;
  private metrics = signal<ProductionMetrics>({
    totalErrors: 0,
    errorRate: 0,
    uniqueErrors: 0,
    affectedUsers: 0,
    criticalErrors: 0,
    timestamp: Date.now(),
  });
  private errorCounts = new Map<string, number>();
  private sessionErrors = new Set<string>();
  private enabled = true;
  private metricsTimer?: ReturnType<typeof setInterval>;

  constructor(config: MonitorConfig = {}) {
    this.config = {
      enabled: config.enabled ?? true,
      sampleRate: config.sampleRate ?? 1.0,
      errorThreshold: config.errorThreshold ?? 10,
      criticalThreshold: config.criticalThreshold ?? 5,
      aggregationWindow: config.aggregationWindow ?? 60000,
      alertRules: config.alertRules ?? [],
    };

    this.enabled = this.config.enabled;

    if (this.enabled) {
      this.startMonitoring();
    }
  }

  private startMonitoring(): void {
    this.metricsTimer = setInterval(() => {
      this.updateMetrics();
      this.checkAlerts();
    }, 5000);

    if (typeof window !== 'undefined') {
      window.addEventListener('aether:error', ((e: CustomEvent) => {
        this.handleError(e.detail.error, e.detail.info);
      }) as EventListener);
    }
  }

  private handleError(error: Error, info: any): void {
    if (!this.shouldSample()) return;

    const fingerprint = this.generateFingerprint(error);
    this.errorCounts.set(fingerprint, (this.errorCounts.get(fingerprint) || 0) + 1);
    this.sessionErrors.add(fingerprint);

    const analytics = getErrorAnalytics();
    analytics.trackError(fingerprint, info.user?.id, info.context?.feature);

    if (this.isCriticalError(error, info)) {
      this.handleCriticalError(error, info);
    }
  }

  private shouldSample(): boolean {
    return Math.random() < this.config.sampleRate;
  }

  private generateFingerprint(error: Error): string {
    return `${error.name}:${error.message}`;
  }

  private isCriticalError(error: Error, info: any): boolean {
    return info.severity === 'fatal' || error.name === 'SecurityError' || error.message.includes('critical');
  }

  private handleCriticalError(error: Error, info: any): void {
    const reporter = getErrorReporter();
    if (reporter) {
      reporter.captureError(error, { ...info, level: 'fatal' });
    }

    this.metrics.update((m) => ({
      ...m,
      criticalErrors: m.criticalErrors + 1,
    }));
  }

  private updateMetrics(): void {
    const analytics = getErrorAnalytics();
    const topErrors = analytics.getTopErrors();
    const affectedUsers = analytics.getMostAffectedUsers().length;

    this.metrics.set({
      totalErrors: Array.from(this.errorCounts.values()).reduce((sum, count) => sum + count, 0),
      errorRate: analytics.getErrorRate(),
      uniqueErrors: this.errorCounts.size,
      affectedUsers,
      criticalErrors: this.metrics().criticalErrors,
      timestamp: Date.now(),
    });
  }

  private checkAlerts(): void {
    const metrics = this.metrics();
    const now = Date.now();

    for (const rule of this.config.alertRules) {
      if (rule.lastTriggered && rule.cooldown) {
        if (now - rule.lastTriggered < rule.cooldown) {
          continue;
        }
      }

      if (rule.condition(metrics)) {
        rule.action(metrics);
        rule.lastTriggered = now;
      }
    }

    if (metrics.errorRate > this.config.errorThreshold) {
      console.error('High error rate detected:', metrics.errorRate);
    }

    if (metrics.criticalErrors > this.config.criticalThreshold) {
      console.error('Critical error threshold exceeded:', metrics.criticalErrors);
    }
  }

  getMetrics(): ProductionMetrics {
    return this.metrics();
  }

  getSessionErrors(): string[] {
    return Array.from(this.sessionErrors);
  }

  clearSession(): void {
    this.sessionErrors.clear();
    this.metrics.update((m) => ({
      ...m,
      totalErrors: 0,
      uniqueErrors: 0,
      criticalErrors: 0,
    }));
  }

  addAlertRule(rule: AlertRule): void {
    this.config.alertRules.push(rule);
  }

  removeAlertRule(name: string): void {
    this.config.alertRules = this.config.alertRules.filter((r) => r.name !== name);
  }

  enable(): void {
    this.enabled = true;
    if (!this.metricsTimer) {
      this.startMonitoring();
    }
  }

  disable(): void {
    this.enabled = false;
    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
      this.metricsTimer = undefined;
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  dispose(): void {
    this.disable();
    this.clearSession();
  }
}

let globalMonitor: ProductionMonitor | null = null;

export function getProductionMonitor(config?: MonitorConfig): ProductionMonitor {
  if (!globalMonitor) {
    globalMonitor = new ProductionMonitor(config);
  }
  return globalMonitor;
}

export function resetProductionMonitor(): void {
  if (globalMonitor) {
    globalMonitor.dispose();
    globalMonitor = null;
  }
}

export function createDefaultAlertRules(): AlertRule[] {
  return [
    {
      name: 'high-error-rate',
      condition: (metrics) => metrics.errorRate > 10,
      action: (metrics) => {
        console.error('ALERT: High error rate:', metrics.errorRate);
      },
      cooldown: 300000,
    },
    {
      name: 'critical-errors',
      condition: (metrics) => metrics.criticalErrors > 5,
      action: (metrics) => {
        console.error('ALERT: Critical errors detected:', metrics.criticalErrors);
      },
      cooldown: 300000,
    },
    {
      name: 'many-affected-users',
      condition: (metrics) => metrics.affectedUsers > 100,
      action: (metrics) => {
        console.warn('ALERT: Many users affected:', metrics.affectedUsers);
      },
      cooldown: 600000,
    },
  ];
}
