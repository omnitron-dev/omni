/**
 * Error Analytics
 *
 * Analyzes error patterns, trends, and user impact.
 *
 * @module error-tracking/error-analytics
 */

import { signal } from '../core/reactivity/signal.js';
import { computed } from '../core/reactivity/computed.js';

export interface ErrorPattern {
  fingerprint: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
  affectedUsers: Set<string>;
  trend: 'increasing' | 'decreasing' | 'stable';
}

export interface ErrorTrend {
  timestamp: number;
  errorCount: number;
  uniqueErrors: number;
  affectedUsers: number;
}

export interface UserImpact {
  userId: string;
  errorCount: number;
  lastError: number;
  affectedFeatures: Set<string>;
}

export interface AnalyticsConfig {
  enabled?: boolean;
  trendWindow?: number;
  maxPatterns?: number;
}

export class ErrorAnalytics {
  private config: Required<AnalyticsConfig>;
  private patterns = new Map<string, ErrorPattern>();
  private trends: ErrorTrend[] = [];
  private userImpacts = new Map<string, UserImpact>();
  private enabled = true;

  constructor(config: AnalyticsConfig = {}) {
    this.config = {
      enabled: config.enabled ?? true,
      trendWindow: config.trendWindow ?? 3600000,
      maxPatterns: config.maxPatterns ?? 100,
    };

    this.enabled = this.config.enabled;

    if (this.enabled) {
      this.startTracking();
    }
  }

  private startTracking(): void {
    setInterval(() => this.updateTrends(), 60000);
  }

  trackError(fingerprint: string, userId?: string, feature?: string): void {
    if (!this.enabled) return;

    const now = Date.now();

    let pattern = this.patterns.get(fingerprint);
    if (!pattern) {
      pattern = {
        fingerprint,
        count: 0,
        firstSeen: now,
        lastSeen: now,
        affectedUsers: new Set(),
        trend: 'stable',
      };
      this.patterns.set(fingerprint, pattern);
    }

    pattern.count++;
    pattern.lastSeen = now;

    if (userId) {
      pattern.affectedUsers.add(userId);
      this.trackUserImpact(userId, feature);
    }

    this.updatePatternTrend(pattern);
  }

  private trackUserImpact(userId: string, feature?: string): void {
    const now = Date.now();

    let impact = this.userImpacts.get(userId);
    if (!impact) {
      impact = {
        userId,
        errorCount: 0,
        lastError: now,
        affectedFeatures: new Set(),
      };
      this.userImpacts.set(userId, impact);
    }

    impact.errorCount++;
    impact.lastError = now;

    if (feature) {
      impact.affectedFeatures.add(feature);
    }
  }

  private updatePatternTrend(pattern: ErrorPattern): void {
    const timeRange = pattern.lastSeen - pattern.firstSeen;
    if (timeRange < 300000) {
      pattern.trend = 'stable';
      return;
    }

    const recentCount = this.getRecentErrorCount(pattern.fingerprint, 300000);
    const olderCount = this.getRecentErrorCount(pattern.fingerprint, 600000) - recentCount;

    if (recentCount > olderCount * 1.5) {
      pattern.trend = 'increasing';
    } else if (recentCount < olderCount * 0.5) {
      pattern.trend = 'decreasing';
    } else {
      pattern.trend = 'stable';
    }
  }

  private getRecentErrorCount(fingerprint: string, timeRange: number): number {
    const pattern = this.patterns.get(fingerprint);
    if (!pattern) return 0;

    const now = Date.now();
    if (now - pattern.lastSeen > timeRange) return 0;

    return pattern.count;
  }

  private updateTrends(): void {
    const now = Date.now();

    const trend: ErrorTrend = {
      timestamp: now,
      errorCount: Array.from(this.patterns.values()).reduce((sum, p) => sum + p.count, 0),
      uniqueErrors: this.patterns.size,
      affectedUsers: this.userImpacts.size,
    };

    this.trends.push(trend);

    const cutoff = now - this.config.trendWindow;
    this.trends = this.trends.filter((t) => t.timestamp > cutoff);
  }

  getTopErrors(limit: number = 10): ErrorPattern[] {
    return Array.from(this.patterns.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  getIncreasingErrors(): ErrorPattern[] {
    return Array.from(this.patterns.values()).filter((p) => p.trend === 'increasing');
  }

  getMostAffectedUsers(limit: number = 10): UserImpact[] {
    return Array.from(this.userImpacts.values())
      .sort((a, b) => b.errorCount - a.errorCount)
      .slice(0, limit);
  }

  getTrends(): ErrorTrend[] {
    return [...this.trends];
  }

  getErrorRate(): number {
    if (this.trends.length < 2) return 0;

    const recent = this.trends[this.trends.length - 1];
    const previous = this.trends[0];
    const timeRange = (recent.timestamp - previous.timestamp) / 1000;

    return (recent.errorCount - previous.errorCount) / timeRange;
  }

  clear(): void {
    this.patterns.clear();
    this.trends = [];
    this.userImpacts.clear();
  }

  enable(): void {
    this.enabled = true;
  }

  disable(): void {
    this.enabled = false;
  }

  isEnabled(): boolean {
    return this.enabled;
  }
}

let globalAnalytics: ErrorAnalytics | null = null;

export function getErrorAnalytics(config?: AnalyticsConfig): ErrorAnalytics {
  if (!globalAnalytics) {
    globalAnalytics = new ErrorAnalytics(config);
  }
  return globalAnalytics;
}

export function resetErrorAnalytics(): void {
  if (globalAnalytics) {
    globalAnalytics.clear();
    globalAnalytics = null;
  }
}
