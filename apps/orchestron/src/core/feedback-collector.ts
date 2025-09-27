/**
 * Feedback Collection System for Orchestron
 * Phase 9: Continuous Development Cycle
 * Collects and analyzes feedback from executions to improve system performance
 */

import { EventEmitter } from 'eventemitter3';
import { Storage } from '../storage/interface.js';
import { v4 as uuidv4 } from 'uuid';

export interface ExecutionFeedback {
  id: string;
  executionId: string;
  sessionId?: string;
  timestamp: Date;
  performance: PerformanceMetrics;
  quality: QualityMetrics;
  errors: ErrorInfo[];
  toolUsage: ToolUsageMetrics[];
  context?: any;
}

export interface PerformanceMetrics {
  duration: number; // ms
  memoryUsed: number; // bytes
  cpuUsage?: number; // percentage
  toolCalls: number;
  apiCalls?: number;
  cacheHits?: number;
  cacheMisses?: number;
}

export interface QualityMetrics {
  testsPass: boolean;
  testsPassing: number;
  testsTotal: number;
  coverage: number; // percentage
  complexity: number; // cyclomatic complexity
  lintErrors: number;
  lintWarnings: number;
  buildSuccess: boolean;
}

export interface ErrorInfo {
  type: string;
  message: string;
  stack?: string;
  context?: any;
  timestamp: Date;
  recovered: boolean;
  recoveryStrategy?: string;
}

export interface ToolUsageMetrics {
  toolName: string;
  callCount: number;
  successCount: number;
  failureCount: number;
  averageDuration: number;
  parameters?: any;
}

export interface Pattern {
  id: string;
  type: PatternType;
  description: string;
  frequency: number;
  impact: ImpactScore;
  firstSeen: Date;
  lastSeen: Date;
  occurrences: string[]; // execution IDs
  metadata?: any;
}

export enum PatternType {
  SUCCESS = 'success',
  FAILURE = 'failure',
  PERFORMANCE = 'performance',
  ERROR = 'error',
  TOOL_USAGE = 'tool_usage',
  WORKFLOW = 'workflow',
  QUALITY = 'quality'
}

export interface ImpactScore {
  performance: number; // -10 to +10
  quality: number; // -10 to +10
  reliability: number; // -10 to +10
  overall: number; // calculated average
}

export interface Improvement {
  id: string;
  patternId: string;
  type: ImprovementType;
  description: string;
  expectedBenefit: ImpactScore;
  confidence: number; // 0-1
  implementation?: string;
  status: 'proposed' | 'approved' | 'implemented' | 'rejected';
  appliedAt?: Date;
}

export enum ImprovementType {
  OPTIMIZATION = 'optimization',
  BUG_FIX = 'bug_fix',
  WORKFLOW_CHANGE = 'workflow_change',
  TOOL_CONFIGURATION = 'tool_configuration',
  ERROR_HANDLING = 'error_handling'
}

export interface FeedbackEvents {
  'feedback:collected': (feedback: ExecutionFeedback) => void;
  'pattern:identified': (pattern: Pattern) => void;
  'improvement:suggested': (improvement: Improvement) => void;
  'improvement:applied': (improvement: Improvement) => void;
}

export class FeedbackCollector extends EventEmitter<FeedbackEvents> {
  private storage: Storage;
  private feedbackHistory: Map<string, ExecutionFeedback> = new Map();
  private patterns: Map<string, Pattern> = new Map();
  private improvements: Map<string, Improvement> = new Map();

  // Thresholds for pattern detection
  private readonly PATTERN_FREQUENCY_THRESHOLD = 3;
  private readonly ERROR_PATTERN_THRESHOLD = 2;
  private readonly PERFORMANCE_DEGRADATION_THRESHOLD = 0.2; // 20% slower

  constructor(storage: Storage) {
    super();
    this.storage = storage;
    this.loadHistory();
  }

  private async loadHistory(): Promise<void> {
    try {
      // Load feedback history from storage
      const history = this.storage.getData ? await this.storage.getData('feedback:history') : null;
      if (history) {
        const parsed = JSON.parse(history);
        for (const feedback of parsed) {
          this.feedbackHistory.set(feedback.id, feedback);
        }
      }

      // Load identified patterns
      const patterns = this.storage.getData ? await this.storage.getData('feedback:patterns') : null;
      if (patterns) {
        const parsed = JSON.parse(patterns);
        for (const pattern of parsed) {
          this.patterns.set(pattern.id, pattern);
        }
      }
    } catch (error) {
      console.error('Error loading feedback history:', error);
    }
  }

  /**
   * Collect feedback from an execution
   */
  async collectFeedback(
    executionId: string,
    metrics: {
      performance: PerformanceMetrics;
      quality: QualityMetrics;
      errors?: ErrorInfo[];
      toolUsage?: ToolUsageMetrics[];
      context?: any;
    }
  ): Promise<ExecutionFeedback> {
    const feedback: ExecutionFeedback = {
      id: uuidv4(),
      executionId,
      timestamp: new Date(),
      performance: metrics.performance,
      quality: metrics.quality,
      errors: metrics.errors || [],
      toolUsage: metrics.toolUsage || [],
      context: metrics.context
    };

    this.feedbackHistory.set(feedback.id, feedback);
    this.emit('feedback:collected', feedback);

    // Analyze for patterns
    await this.analyzeForPatterns(feedback);

    // Persist feedback
    await this.saveFeedback();

    return feedback;
  }

  /**
   * Analyze feedback for patterns
   */
  private async analyzeForPatterns(feedback: ExecutionFeedback): Promise<void> {
    // Check for error patterns
    await this.detectErrorPatterns(feedback);

    // Check for performance patterns
    await this.detectPerformancePatterns(feedback);

    // Check for tool usage patterns
    await this.detectToolUsagePatterns(feedback);

    // Check for quality patterns
    await this.detectQualityPatterns(feedback);
  }

  /**
   * Detect error patterns
   */
  private async detectErrorPatterns(feedback: ExecutionFeedback): Promise<void> {
    if (feedback.errors.length === 0) return;

    for (const error of feedback.errors) {
      const similarErrors = this.findSimilarErrors(error);

      if (similarErrors.length >= this.ERROR_PATTERN_THRESHOLD) {
        const pattern = this.createErrorPattern(error, similarErrors);

        if (!this.patterns.has(pattern.id)) {
          this.patterns.set(pattern.id, pattern);
          this.emit('pattern:identified', pattern);

          // Suggest improvement for this pattern
          const improvement = await this.suggestErrorImprovement(pattern);
          if (improvement) {
            this.improvements.set(improvement.id, improvement);
            this.emit('improvement:suggested', improvement);
          }
        }
      }
    }
  }

  /**
   * Find similar errors in history
   */
  private findSimilarErrors(error: ErrorInfo): ExecutionFeedback[] {
    const similar: ExecutionFeedback[] = [];

    for (const feedback of this.feedbackHistory.values()) {
      const hasSimliarError = feedback.errors.some(e =>
        e.type === error.type &&
        this.calculateStringSimilarity(e.message, error.message) > 0.7
      );

      if (hasSimliarError) {
        similar.push(feedback);
      }
    }

    return similar;
  }

  /**
   * Create error pattern from similar errors
   */
  private createErrorPattern(error: ErrorInfo, similar: ExecutionFeedback[]): Pattern {
    return {
      id: `error-${error.type}-${Date.now()}`,
      type: PatternType.ERROR,
      description: `Recurring error: ${error.type} - ${error.message.substring(0, 100)}`,
      frequency: similar.length + 1,
      impact: {
        performance: -2,
        quality: -5,
        reliability: -8,
        overall: -5
      },
      firstSeen: similar[0]?.timestamp || new Date(),
      lastSeen: new Date(),
      occurrences: similar.map(f => f.executionId),
      metadata: { error }
    };
  }

  /**
   * Suggest improvement for error pattern
   */
  private async suggestErrorImprovement(pattern: Pattern): Promise<Improvement | null> {
    const error = pattern.metadata?.error as ErrorInfo;
    if (!error) return null;

    let improvementType = ImprovementType.ERROR_HANDLING;
    let implementation = '';

    // Analyze error type and suggest specific improvements
    if (error.type === 'TypeError') {
      implementation = 'Add type checking and validation before operations';
    } else if (error.type === 'NetworkError') {
      implementation = 'Implement retry logic with exponential backoff';
    } else if (error.type === 'TimeoutError') {
      implementation = 'Increase timeout or optimize operation performance';
    } else {
      implementation = 'Add try-catch block and error recovery logic';
    }

    return {
      id: uuidv4(),
      patternId: pattern.id,
      type: improvementType,
      description: `Fix recurring ${error.type}: ${implementation}`,
      expectedBenefit: {
        performance: 1,
        quality: 3,
        reliability: 5,
        overall: 3
      },
      confidence: 0.8,
      implementation,
      status: 'proposed'
    };
  }

  /**
   * Detect performance patterns
   */
  private async detectPerformancePatterns(feedback: ExecutionFeedback): Promise<void> {
    const recentFeedback = this.getRecentFeedback(10);

    if (recentFeedback.length < 3) return;

    // Calculate average performance metrics
    const avgDuration = recentFeedback.reduce((sum, f) => sum + f.performance.duration, 0) / recentFeedback.length;
    const avgMemory = recentFeedback.reduce((sum, f) => sum + f.performance.memoryUsed, 0) / recentFeedback.length;

    // Check for performance degradation
    if (feedback.performance.duration > avgDuration * (1 + this.PERFORMANCE_DEGRADATION_THRESHOLD)) {
      const pattern: Pattern = {
        id: `perf-degradation-${Date.now()}`,
        type: PatternType.PERFORMANCE,
        description: `Performance degradation detected: ${Math.round((feedback.performance.duration - avgDuration) / avgDuration * 100)}% slower`,
        frequency: 1,
        impact: {
          performance: -7,
          quality: -2,
          reliability: -3,
          overall: -4
        },
        firstSeen: new Date(),
        lastSeen: new Date(),
        occurrences: [feedback.executionId],
        metadata: {
          currentDuration: feedback.performance.duration,
          averageDuration: avgDuration,
          degradation: (feedback.performance.duration - avgDuration) / avgDuration
        }
      };

      this.patterns.set(pattern.id, pattern);
      this.emit('pattern:identified', pattern);
    }
  }

  /**
   * Detect tool usage patterns
   */
  private async detectToolUsagePatterns(feedback: ExecutionFeedback): Promise<void> {
    if (feedback.toolUsage.length === 0) return;

    for (const tool of feedback.toolUsage) {
      // Check for inefficient tool usage
      if (tool.failureCount > tool.successCount) {
        const pattern: Pattern = {
          id: `tool-inefficient-${tool.toolName}-${Date.now()}`,
          type: PatternType.TOOL_USAGE,
          description: `Inefficient use of ${tool.toolName}: ${tool.failureCount} failures vs ${tool.successCount} successes`,
          frequency: tool.callCount,
          impact: {
            performance: -3,
            quality: -4,
            reliability: -5,
            overall: -4
          },
          firstSeen: new Date(),
          lastSeen: new Date(),
          occurrences: [feedback.executionId],
          metadata: { tool }
        };

        this.patterns.set(pattern.id, pattern);
        this.emit('pattern:identified', pattern);

        // Suggest improvement
        const improvement: Improvement = {
          id: uuidv4(),
          patternId: pattern.id,
          type: ImprovementType.TOOL_CONFIGURATION,
          description: `Optimize ${tool.toolName} usage: validate parameters before calling`,
          expectedBenefit: {
            performance: 2,
            quality: 3,
            reliability: 4,
            overall: 3
          },
          confidence: 0.75,
          implementation: `Add validation for ${tool.toolName} parameters`,
          status: 'proposed'
        };

        this.improvements.set(improvement.id, improvement);
        this.emit('improvement:suggested', improvement);
      }
    }
  }

  /**
   * Detect quality patterns
   */
  private async detectQualityPatterns(feedback: ExecutionFeedback): Promise<void> {
    const recentFeedback = this.getRecentFeedback(5);

    // Check for consistent test failures
    const failureRate = recentFeedback.filter(f => !f.quality.testsPass).length / recentFeedback.length;
    if (failureRate > 0.3) {
      const pattern: Pattern = {
        id: `quality-test-failures-${Date.now()}`,
        type: PatternType.FAILURE,
        description: `High test failure rate: ${Math.round(failureRate * 100)}%`,
        frequency: recentFeedback.length,
        impact: {
          performance: -1,
          quality: -8,
          reliability: -6,
          overall: -5
        },
        firstSeen: recentFeedback[0].timestamp,
        lastSeen: new Date(),
        occurrences: recentFeedback.map(f => f.executionId),
        metadata: { failureRate }
      };

      this.patterns.set(pattern.id, pattern);
      this.emit('pattern:identified', pattern);
    }

    // Check for low coverage
    if (feedback.quality.coverage < 70) {
      const pattern: Pattern = {
        id: `quality-low-coverage-${Date.now()}`,
        type: PatternType.QUALITY,
        description: `Low test coverage: ${feedback.quality.coverage}%`,
        frequency: 1,
        impact: {
          performance: 0,
          quality: -6,
          reliability: -4,
          overall: -3.3
        },
        firstSeen: new Date(),
        lastSeen: new Date(),
        occurrences: [feedback.executionId],
        metadata: { coverage: feedback.quality.coverage }
      };

      this.patterns.set(pattern.id, pattern);
      this.emit('pattern:identified', pattern);
    }
  }

  /**
   * Get recent feedback
   */
  private getRecentFeedback(count: number): ExecutionFeedback[] {
    const feedbackArray = Array.from(this.feedbackHistory.values());
    return feedbackArray
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, count);
  }

  /**
   * Calculate string similarity (simple Levenshtein-like)
   */
  private calculateStringSimilarity(str1: string, str2: string): number {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;

    if (longer.length === 0) return 1.0;

    const commonLength = this.getCommonPrefixLength(shorter, longer);
    return commonLength / longer.length;
  }

  private getCommonPrefixLength(str1: string, str2: string): number {
    let i = 0;
    while (i < str1.length && i < str2.length && str1[i] === str2[i]) {
      i++;
    }
    return i;
  }

  /**
   * Apply an improvement
   */
  async applyImprovement(improvementId: string): Promise<void> {
    const improvement = this.improvements.get(improvementId);
    if (!improvement) {
      throw new Error(`Improvement ${improvementId} not found`);
    }

    improvement.status = 'implemented';
    improvement.appliedAt = new Date();

    this.emit('improvement:applied', improvement);
    await this.saveImprovements();
  }

  /**
   * Get all patterns
   */
  getPatterns(type?: PatternType): Pattern[] {
    const patterns = Array.from(this.patterns.values());
    if (type) {
      return patterns.filter(p => p.type === type);
    }
    return patterns;
  }

  /**
   * Get all improvements
   */
  getImprovements(status?: Improvement['status']): Improvement[] {
    const improvements = Array.from(this.improvements.values());
    if (status) {
      return improvements.filter(i => i.status === status);
    }
    return improvements;
  }

  /**
   * Get feedback summary
   */
  getFeedbackSummary(): {
    totalExecutions: number;
    averagePerformance: PerformanceMetrics;
    averageQuality: QualityMetrics;
    topErrors: ErrorInfo[];
    topPatterns: Pattern[];
    proposedImprovements: Improvement[];
  } {
    const feedbackArray = Array.from(this.feedbackHistory.values());

    if (feedbackArray.length === 0) {
      return {
        totalExecutions: 0,
        averagePerformance: {
          duration: 0,
          memoryUsed: 0,
          toolCalls: 0
        },
        averageQuality: {
          testsPass: false,
          testsPassing: 0,
          testsTotal: 0,
          coverage: 0,
          complexity: 0,
          lintErrors: 0,
          lintWarnings: 0,
          buildSuccess: false
        },
        topErrors: [],
        topPatterns: [],
        proposedImprovements: []
      };
    }

    // Calculate averages
    const avgPerformance: PerformanceMetrics = {
      duration: feedbackArray.reduce((sum, f) => sum + f.performance.duration, 0) / feedbackArray.length,
      memoryUsed: feedbackArray.reduce((sum, f) => sum + f.performance.memoryUsed, 0) / feedbackArray.length,
      toolCalls: feedbackArray.reduce((sum, f) => sum + f.performance.toolCalls, 0) / feedbackArray.length
    };

    const avgQuality: QualityMetrics = {
      testsPass: feedbackArray.filter(f => f.quality.testsPass).length > feedbackArray.length / 2,
      testsPassing: feedbackArray.reduce((sum, f) => sum + f.quality.testsPassing, 0) / feedbackArray.length,
      testsTotal: feedbackArray.reduce((sum, f) => sum + f.quality.testsTotal, 0) / feedbackArray.length,
      coverage: feedbackArray.reduce((sum, f) => sum + f.quality.coverage, 0) / feedbackArray.length,
      complexity: feedbackArray.reduce((sum, f) => sum + f.quality.complexity, 0) / feedbackArray.length,
      lintErrors: feedbackArray.reduce((sum, f) => sum + f.quality.lintErrors, 0) / feedbackArray.length,
      lintWarnings: feedbackArray.reduce((sum, f) => sum + f.quality.lintWarnings, 0) / feedbackArray.length,
      buildSuccess: feedbackArray.filter(f => f.quality.buildSuccess).length > feedbackArray.length / 2
    };

    // Get top patterns
    const topPatterns = Array.from(this.patterns.values())
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 5);

    // Get proposed improvements
    const proposedImprovements = this.getImprovements('proposed');

    return {
      totalExecutions: feedbackArray.length,
      averagePerformance: avgPerformance,
      averageQuality: avgQuality,
      topErrors: [],
      topPatterns,
      proposedImprovements
    };
  }

  /**
   * Save feedback to storage
   */
  private async saveFeedback(): Promise<void> {
    const feedbackArray = Array.from(this.feedbackHistory.values());
    if (this.storage.saveData) {
      await this.storage.saveData('feedback:history', JSON.stringify(feedbackArray));
    }

    const patternsArray = Array.from(this.patterns.values());
    if (this.storage.saveData) {
      await this.storage.saveData('feedback:patterns', JSON.stringify(patternsArray));
    }
  }

  /**
   * Save improvements to storage
   */
  private async saveImprovements(): Promise<void> {
    const improvementsArray = Array.from(this.improvements.values());
    if (this.storage.saveData) {
      await this.storage.saveData('feedback:improvements', JSON.stringify(improvementsArray));
    }
  }

  /**
   * Clear old feedback (older than days specified)
   */
  async clearOldFeedback(daysToKeep: number = 30): Promise<void> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    for (const [id, feedback] of this.feedbackHistory) {
      if (feedback.timestamp < cutoffDate) {
        this.feedbackHistory.delete(id);
      }
    }

    await this.saveFeedback();
  }
}