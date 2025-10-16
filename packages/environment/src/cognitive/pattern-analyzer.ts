/**
 * Pattern Analyzer
 * Analyzes usage patterns for optimization suggestions
 */

export interface AccessPattern {
  key: string;
  count: number;
  lastAccess: number;
  avgInterval: number;
}

export interface Pattern {
  type: 'frequent' | 'rare' | 'sequential' | 'temporal';
  keys: string[];
  confidence: number;
  metadata?: Record<string, unknown>;
}

export class PatternAnalyzer {
  private accessLog: Map<string, number[]>;
  private patterns: Pattern[];

  constructor() {
    this.accessLog = new Map();
    this.patterns = [];
  }

  /**
   * Record an access
   */
  recordAccess(key: string): void {
    const timestamps = this.accessLog.get(key) || [];
    timestamps.push(Date.now());
    this.accessLog.set(key, timestamps);
  }

  /**
   * Analyze patterns
   */
  analyze(): Pattern[] {
    this.patterns = [];

    // Find frequent accesses
    this.patterns.push(...this.findFrequentPatterns());

    // Find sequential patterns
    this.patterns.push(...this.findSequentialPatterns());

    return this.patterns;
  }

  /**
   * Get patterns
   */
  getPatterns(): Pattern[] {
    return [...this.patterns];
  }

  /**
   * Get access patterns for keys
   */
  getAccessPatterns(): AccessPattern[] {
    const patterns: AccessPattern[] = [];

    for (const [key, timestamps] of this.accessLog) {
      if (timestamps.length === 0) continue;

      const intervals = [];
      for (let i = 1; i < timestamps.length; i++) {
        intervals.push(timestamps[i] - timestamps[i - 1]);
      }

      const avgInterval =
        intervals.length > 0
          ? intervals.reduce((a, b) => a + b, 0) / intervals.length
          : 0;

      patterns.push({
        key,
        count: timestamps.length,
        lastAccess: timestamps[timestamps.length - 1],
        avgInterval,
      });
    }

    return patterns.sort((a, b) => b.count - a.count);
  }

  /**
   * Clear analysis data
   */
  clear(): void {
    this.accessLog.clear();
    this.patterns = [];
  }

  private findFrequentPatterns(): Pattern[] {
    const patterns: Pattern[] = [];
    const threshold = 10; // Minimum accesses to be considered frequent

    for (const [key, timestamps] of this.accessLog) {
      if (timestamps.length >= threshold) {
        patterns.push({
          type: 'frequent',
          keys: [key],
          confidence: Math.min(timestamps.length / 100, 1),
        });
      }
    }

    return patterns;
  }

  private findSequentialPatterns(): Pattern[] {
    // Simplified sequential pattern detection
    return [];
  }
}
