/**
 * Learning Pipeline for Orchestron
 * Phase 9: Continuous Development Cycle
 * Learns from feedback patterns and continuously improves the system
 */

import { EventEmitter } from 'eventemitter3';
import { Storage } from '../storage/interface.js';
import { v4 as uuidv4 } from 'uuid';
import {
  FeedbackCollector,
  ExecutionFeedback,
  Pattern,
  PatternType,
  Improvement,
  ImprovementType,
  ImpactScore
} from './feedback-collector.js';
import { WorkflowEngine, DevelopmentWorkflow } from './workflow-engine.js';
import { MLPredictor } from './ml-predictor.js';

export interface LearningInsight {
  id: string;
  type: InsightType;
  description: string;
  confidence: number; // 0-1
  evidence: string[]; // pattern IDs or feedback IDs
  recommendation?: string;
  impact: ImpactScore;
  createdAt: Date;
  appliedAt?: Date;
}

export enum InsightType {
  WORKFLOW_OPTIMIZATION = 'workflow_optimization',
  ERROR_PREVENTION = 'error_prevention',
  PERFORMANCE_IMPROVEMENT = 'performance_improvement',
  QUALITY_ENHANCEMENT = 'quality_enhancement',
  TOOL_OPTIMIZATION = 'tool_optimization',
  PROCESS_IMPROVEMENT = 'process_improvement'
}

export interface LearningMetrics {
  insightsGenerated: number;
  insightsApplied: number;
  improvementRate: number; // percentage improvement
  errorReduction: number; // percentage reduction
  efficiencyGain: number; // percentage gain
  knowledgeGrowth: number; // number of patterns learned
  adaptationSpeed: number; // time to apply improvements (ms)
}

export interface ProcessImprovement {
  id: string;
  type: 'workflow' | 'configuration' | 'automation' | 'optimization';
  description: string;
  before: any;
  after: any;
  impact: ImpactScore;
  appliedAt: Date;
  success: boolean;
}

export interface LearningEvents {
  'insight:generated': (insight: LearningInsight) => void;
  'insight:applied': (insight: LearningInsight) => void;
  'improvement:validated': (improvement: Improvement) => void;
  'process:improved': (improvement: ProcessImprovement) => void;
  'learning:milestone': (metrics: LearningMetrics) => void;
}

export class LearningPipeline extends EventEmitter<LearningEvents> {
  private storage: Storage;
  private feedbackCollector: FeedbackCollector;
  private workflowEngine: WorkflowEngine;
  private mlPredictor: MLPredictor;

  private insights: Map<string, LearningInsight> = new Map();
  private processImprovements: Map<string, ProcessImprovement> = new Map();
  private learningHistory: any[] = [];

  // Learning parameters
  private readonly INSIGHT_CONFIDENCE_THRESHOLD = 0.7;
  private readonly IMPROVEMENT_SUCCESS_THRESHOLD = 0.8;
  private readonly PATTERN_CORRELATION_THRESHOLD = 0.6;

  constructor(
    storage: Storage,
    feedbackCollector: FeedbackCollector,
    workflowEngine: WorkflowEngine,
    mlPredictor: MLPredictor
  ) {
    super();
    this.storage = storage;
    this.feedbackCollector = feedbackCollector;
    this.workflowEngine = workflowEngine;
    this.mlPredictor = mlPredictor;

    this.initializeListeners();
    this.loadHistory();
  }

  private initializeListeners(): void {
    // Listen for new patterns from feedback collector
    this.feedbackCollector.on('pattern:identified', (pattern) => {
      this.analyzePattern(pattern);
    });

    // Listen for workflow completions
    this.workflowEngine.on('workflow:completed', (execution) => {
      this.learnFromExecution(execution);
    });

    // Listen for improvements from feedback collector
    this.feedbackCollector.on('improvement:suggested', (improvement) => {
      this.evaluateImprovement(improvement);
    });
  }

  private async loadHistory(): Promise<void> {
    try {
      const history = this.storage.getData ? await this.storage.getData('learning:history') : null;
      if (history) {
        this.learningHistory = JSON.parse(history);
      }

      const insights = this.storage.getData ? await this.storage.getData('learning:insights') : null;
      if (insights) {
        const parsed = JSON.parse(insights);
        for (const insight of parsed) {
          this.insights.set(insight.id, insight);
        }
      }
    } catch (error) {
      console.error('Error loading learning history:', error);
    }
  }

  /**
   * Analyze a pattern to generate insights
   */
  async analyzePattern(pattern: Pattern): Promise<void> {
    // Find correlated patterns
    const correlatedPatterns = this.findCorrelatedPatterns(pattern);

    // Generate insights based on pattern type
    let insight: LearningInsight | null = null;

    switch (pattern.type) {
      case PatternType.ERROR:
        insight = await this.generateErrorPreventionInsight(pattern, correlatedPatterns);
        break;

      case PatternType.PERFORMANCE:
        insight = await this.generatePerformanceInsight(pattern, correlatedPatterns);
        break;

      case PatternType.TOOL_USAGE:
        insight = await this.generateToolOptimizationInsight(pattern, correlatedPatterns);
        break;

      case PatternType.WORKFLOW:
        insight = await this.generateWorkflowInsight(pattern, correlatedPatterns);
        break;

      default:
        insight = await this.generateGenericInsight(pattern, correlatedPatterns);
    }

    if (insight && insight.confidence >= this.INSIGHT_CONFIDENCE_THRESHOLD) {
      this.insights.set(insight.id, insight);
      this.emit('insight:generated', insight);

      // Automatically apply high-confidence insights
      if (insight.confidence > 0.9) {
        await this.applyInsight(insight);
      }
    }
  }

  /**
   * Find patterns that correlate with the given pattern
   */
  private findCorrelatedPatterns(pattern: Pattern): Pattern[] {
    const patterns = this.feedbackCollector.getPatterns();
    const correlated: Pattern[] = [];

    for (const p of patterns) {
      if (p.id === pattern.id) continue;

      // Check for temporal correlation
      const timeCorrelation = this.calculateTemporalCorrelation(pattern, p);

      // Check for occurrence correlation
      const occurrenceCorrelation = this.calculateOccurrenceCorrelation(pattern, p);

      const overallCorrelation = (timeCorrelation + occurrenceCorrelation) / 2;

      if (overallCorrelation >= this.PATTERN_CORRELATION_THRESHOLD) {
        correlated.push(p);
      }
    }

    return correlated;
  }

  /**
   * Calculate temporal correlation between patterns
   */
  private calculateTemporalCorrelation(p1: Pattern, p2: Pattern): number {
    const timeDiff = Math.abs(p1.firstSeen.getTime() - p2.firstSeen.getTime());
    const maxDiff = 24 * 60 * 60 * 1000; // 24 hours

    if (timeDiff > maxDiff) return 0;
    return 1 - (timeDiff / maxDiff);
  }

  /**
   * Calculate occurrence correlation between patterns
   */
  private calculateOccurrenceCorrelation(p1: Pattern, p2: Pattern): number {
    const commonOccurrences = p1.occurrences.filter(o => p2.occurrences.includes(o)).length;
    const totalOccurrences = new Set([...p1.occurrences, ...p2.occurrences]).size;

    if (totalOccurrences === 0) return 0;
    return commonOccurrences / totalOccurrences;
  }

  /**
   * Generate error prevention insight
   */
  private async generateErrorPreventionInsight(
    pattern: Pattern,
    correlated: Pattern[]
  ): Promise<LearningInsight> {
    const error = pattern.metadata?.error;
    const recommendation = this.generateErrorRecommendation(error, correlated);

    return {
      id: uuidv4(),
      type: InsightType.ERROR_PREVENTION,
      description: `Prevent ${pattern.description} by ${recommendation}`,
      confidence: 0.85,
      evidence: [pattern.id, ...correlated.map(p => p.id)],
      recommendation,
      impact: {
        performance: 2,
        quality: 5,
        reliability: 8,
        overall: 5
      },
      createdAt: new Date()
    };
  }

  /**
   * Generate error recommendation
   */
  private generateErrorRecommendation(error: any, correlated: Pattern[]): string {
    if (!error) return 'implementing better error handling';

    const recommendations = [];

    if (error.type === 'TypeError') {
      recommendations.push('add type validation');
    }

    if (error.type === 'NetworkError') {
      recommendations.push('implement retry logic');
    }

    if (error.type === 'TimeoutError') {
      recommendations.push('optimize performance or increase timeout');
    }

    // Check correlated patterns for additional context
    const hasPerformanceIssue = correlated.some(p => p.type === PatternType.PERFORMANCE);
    if (hasPerformanceIssue) {
      recommendations.push('address performance bottlenecks');
    }

    return recommendations.join(' and ');
  }

  /**
   * Generate performance optimization insight
   */
  private async generatePerformanceInsight(
    pattern: Pattern,
    correlated: Pattern[]
  ): Promise<LearningInsight> {
    const degradation = pattern.metadata?.degradation || 0;
    const recommendation = `Optimize performance by ${Math.round(degradation * 100)}%`;

    return {
      id: uuidv4(),
      type: InsightType.PERFORMANCE_IMPROVEMENT,
      description: pattern.description,
      confidence: 0.75,
      evidence: [pattern.id],
      recommendation,
      impact: {
        performance: 8,
        quality: 2,
        reliability: 3,
        overall: 4.3
      },
      createdAt: new Date()
    };
  }

  /**
   * Generate tool optimization insight
   */
  private async generateToolOptimizationInsight(
    pattern: Pattern,
    correlated: Pattern[]
  ): Promise<LearningInsight> {
    const tool = pattern.metadata?.tool;
    const recommendation = tool ?
      `Optimize ${tool.toolName} by validating parameters and handling errors` :
      'Optimize tool usage patterns';

    return {
      id: uuidv4(),
      type: InsightType.TOOL_OPTIMIZATION,
      description: pattern.description,
      confidence: 0.8,
      evidence: [pattern.id],
      recommendation,
      impact: {
        performance: 4,
        quality: 3,
        reliability: 5,
        overall: 4
      },
      createdAt: new Date()
    };
  }

  /**
   * Generate workflow optimization insight
   */
  private async generateWorkflowInsight(
    pattern: Pattern,
    correlated: Pattern[]
  ): Promise<LearningInsight> {
    return {
      id: uuidv4(),
      type: InsightType.WORKFLOW_OPTIMIZATION,
      description: `Optimize workflow based on pattern: ${pattern.description}`,
      confidence: 0.7,
      evidence: [pattern.id],
      recommendation: 'Adjust workflow stages or add automation',
      impact: {
        performance: 5,
        quality: 4,
        reliability: 4,
        overall: 4.3
      },
      createdAt: new Date()
    };
  }

  /**
   * Generate generic insight
   */
  private async generateGenericInsight(
    pattern: Pattern,
    correlated: Pattern[]
  ): Promise<LearningInsight> {
    return {
      id: uuidv4(),
      type: InsightType.PROCESS_IMPROVEMENT,
      description: pattern.description,
      confidence: 0.6,
      evidence: [pattern.id],
      impact: pattern.impact,
      createdAt: new Date()
    };
  }

  /**
   * Learn from workflow execution
   */
  async learnFromExecution(execution: any): Promise<void> {
    // Collect feedback from execution
    const feedback = await this.collectExecutionFeedback(execution);

    // Update ML models with new data
    await this.updateMLModels(feedback);

    // Check for improvements
    await this.checkForImprovements(execution);
  }

  /**
   * Collect feedback from execution
   */
  private async collectExecutionFeedback(execution: any): Promise<ExecutionFeedback> {
    const performance = {
      duration: execution.endTime ?
        execution.endTime.getTime() - execution.startTime.getTime() : 0,
      memoryUsed: process.memoryUsage().heapUsed,
      toolCalls: execution.context?.toolCalls || 0
    };

    const quality = {
      testsPass: execution.context?.testsPass || false,
      testsPassing: execution.context?.testsPassing || 0,
      testsTotal: execution.context?.testsTotal || 0,
      coverage: execution.context?.coverage || 0,
      complexity: execution.context?.complexity || 0,
      lintErrors: execution.context?.lintErrors || 0,
      lintWarnings: execution.context?.lintWarnings || 0,
      buildSuccess: execution.context?.buildSuccess || false
    };

    return await this.feedbackCollector.collectFeedback(
      execution.id,
      { performance, quality, context: execution.context }
    );
  }

  /**
   * Update ML models with new data
   */
  private async updateMLModels(feedback: ExecutionFeedback): Promise<void> {
    // Update predictor with new data points
    const dataPoint = {
      features: {
        duration: feedback.performance.duration,
        memoryUsed: feedback.performance.memoryUsed,
        toolCalls: feedback.performance.toolCalls,
        complexity: feedback.quality.complexity
      },
      label: feedback.quality.testsPass ? 1 : 0
    };

    // This would normally update the ML model
    // For now, just store for future training
    this.learningHistory.push(dataPoint);
  }

  /**
   * Check for potential improvements
   */
  private async checkForImprovements(execution: any): Promise<void> {
    if (execution.status === 'failed' && execution.errors) {
      // Learn from failures
      for (const error of execution.errors) {
        await this.learnFromError(error);
      }
    }

    if (execution.status === 'completed') {
      // Learn from successes
      await this.learnFromSuccess(execution);
    }
  }

  /**
   * Learn from error
   */
  private async learnFromError(error: Error): Promise<void> {
    const improvement: ProcessImprovement = {
      id: uuidv4(),
      type: 'automation',
      description: `Prevent error: ${error.message}`,
      before: 'No error handling',
      after: 'Add error handling and recovery',
      impact: {
        performance: 0,
        quality: 3,
        reliability: 5,
        overall: 2.7
      },
      appliedAt: new Date(),
      success: false
    };

    this.processImprovements.set(improvement.id, improvement);
    this.emit('process:improved', improvement);
  }

  /**
   * Learn from success
   */
  private async learnFromSuccess(execution: any): Promise<void> {
    const improvement: ProcessImprovement = {
      id: uuidv4(),
      type: 'workflow',
      description: `Successful pattern from execution ${execution.id}`,
      before: execution.context?.previousDuration || 0,
      after: execution.endTime.getTime() - execution.startTime.getTime(),
      impact: {
        performance: 3,
        quality: 2,
        reliability: 1,
        overall: 2
      },
      appliedAt: new Date(),
      success: true
    };

    this.processImprovements.set(improvement.id, improvement);
  }

  /**
   * Evaluate an improvement suggestion
   */
  async evaluateImprovement(improvement: Improvement): Promise<void> {
    // Use ML predictor to evaluate potential impact
    const predictionConfidence = await this.mlPredictor.predictImpact({
      type: improvement.type,
      expectedBenefit: improvement.expectedBenefit,
      confidence: improvement.confidence
    });

    if (predictionConfidence > this.IMPROVEMENT_SUCCESS_THRESHOLD) {
      this.emit('improvement:validated', improvement);

      // Apply if high confidence
      if (predictionConfidence > 0.95) {
        await this.applyImprovement(improvement);
      }
    }
  }

  /**
   * Apply an insight
   */
  async applyInsight(insight: LearningInsight): Promise<void> {
    insight.appliedAt = new Date();

    // Create workflow based on insight type
    const workflow = await this.createWorkflowFromInsight(insight);
    if (workflow) {
      await this.workflowEngine.registerWorkflow(workflow);
    }

    this.emit('insight:applied', insight);
    await this.saveInsights();
  }

  /**
   * Create workflow from insight
   */
  private async createWorkflowFromInsight(
    insight: LearningInsight
  ): Promise<DevelopmentWorkflow | null> {
    switch (insight.type) {
      case InsightType.ERROR_PREVENTION:
        return {
          id: `insight-workflow-${insight.id}`,
          name: `Error Prevention: ${insight.description}`,
          description: insight.recommendation,
          enabled: true,
          triggers: [{
            type: 'event',
            event: 'task:started'
          }],
          stages: [{
            name: 'validate',
            triggers: [],
            actions: [{
              type: 'execute_command',
              params: { command: 'npm run validate' }
            }]
          }]
        };

      case InsightType.PERFORMANCE_IMPROVEMENT:
        return {
          id: `insight-workflow-${insight.id}`,
          name: `Performance: ${insight.description}`,
          enabled: true,
          triggers: [{
            type: 'time_based',
            schedule: '0 * * * *' // Every hour
          }],
          stages: [{
            name: 'optimize',
            triggers: [],
            actions: [{
              type: 'execute_command',
              params: { command: 'npm run optimize' }
            }]
          }]
        };

      default:
        return null;
    }
  }

  /**
   * Apply an improvement
   */
  private async applyImprovement(improvement: Improvement): Promise<void> {
    await this.feedbackCollector.applyImprovement(improvement.id);
  }

  /**
   * Get learning metrics
   */
  getLearningMetrics(): LearningMetrics {
    const insights = Array.from(this.insights.values());
    const improvements = Array.from(this.processImprovements.values());

    const appliedInsights = insights.filter(i => i.appliedAt).length;
    const successfulImprovements = improvements.filter(i => i.success).length;

    return {
      insightsGenerated: insights.length,
      insightsApplied: appliedInsights,
      improvementRate: improvements.length > 0 ?
        (successfulImprovements / improvements.length) * 100 : 0,
      errorReduction: this.calculateErrorReduction(),
      efficiencyGain: this.calculateEfficiencyGain(),
      knowledgeGrowth: this.feedbackCollector.getPatterns().length,
      adaptationSpeed: this.calculateAdaptationSpeed()
    };
  }

  /**
   * Calculate error reduction
   */
  private calculateErrorReduction(): number {
    const recentFeedback = this.feedbackCollector.getFeedbackSummary();
    // This would compare error rates over time
    // For now, return a placeholder
    return 25; // 25% reduction
  }

  /**
   * Calculate efficiency gain
   */
  private calculateEfficiencyGain(): number {
    const improvements = Array.from(this.processImprovements.values());
    if (improvements.length === 0) return 0;

    const gains = improvements
      .filter(i => i.success)
      .map(i => i.impact.performance);

    return gains.length > 0 ?
      gains.reduce((sum, g) => sum + g, 0) / gains.length * 10 : 0;
  }

  /**
   * Calculate adaptation speed
   */
  private calculateAdaptationSpeed(): number {
    const insights = Array.from(this.insights.values());
    const appliedInsights = insights.filter(i => i.appliedAt);

    if (appliedInsights.length === 0) return 0;

    const speeds = appliedInsights.map(i =>
      i.appliedAt!.getTime() - i.createdAt.getTime()
    );

    return speeds.reduce((sum, s) => sum + s, 0) / speeds.length;
  }

  /**
   * Get insights
   */
  getInsights(type?: InsightType): LearningInsight[] {
    const insights = Array.from(this.insights.values());
    if (type) {
      return insights.filter(i => i.type === type);
    }
    return insights;
  }

  /**
   * Get process improvements
   */
  getProcessImprovements(): ProcessImprovement[] {
    return Array.from(this.processImprovements.values());
  }

  /**
   * Save insights to storage
   */
  private async saveInsights(): Promise<void> {
    const insightsArray = Array.from(this.insights.values());
    if (this.storage.saveData) {
      await this.storage.saveData('learning:insights', JSON.stringify(insightsArray));
      await this.storage.saveData('learning:history', JSON.stringify(this.learningHistory));
    }
  }

  /**
   * Generate learning report
   */
  generateLearningReport(): {
    metrics: LearningMetrics;
    topInsights: LearningInsight[];
    recentImprovements: ProcessImprovement[];
    recommendations: string[];
  } {
    const metrics = this.getLearningMetrics();
    const topInsights = this.getInsights()
      .sort((a, b) => b.impact.overall - a.impact.overall)
      .slice(0, 5);

    const recentImprovements = this.getProcessImprovements()
      .sort((a, b) => b.appliedAt.getTime() - a.appliedAt.getTime())
      .slice(0, 5);

    const recommendations = this.generateRecommendations(metrics, topInsights);

    return {
      metrics,
      topInsights,
      recentImprovements,
      recommendations
    };
  }

  /**
   * Generate recommendations based on learning
   */
  private generateRecommendations(
    metrics: LearningMetrics,
    insights: LearningInsight[]
  ): string[] {
    const recommendations: string[] = [];

    if (metrics.errorReduction < 20) {
      recommendations.push('Focus on error prevention strategies');
    }

    if (metrics.efficiencyGain < 10) {
      recommendations.push('Implement performance optimizations');
    }

    if (metrics.insightsApplied < metrics.insightsGenerated * 0.5) {
      recommendations.push('Apply more generated insights to improve');
    }

    if (insights.some(i => i.type === InsightType.WORKFLOW_OPTIMIZATION)) {
      recommendations.push('Review and optimize workflow patterns');
    }

    return recommendations;
  }

  /**
   * Check if learning milestones are reached
   */
  async checkMilestones(): Promise<void> {
    const metrics = this.getLearningMetrics();

    // Check for significant milestones
    if (metrics.insightsGenerated % 10 === 0 && metrics.insightsGenerated > 0) {
      this.emit('learning:milestone', metrics);
    }

    if (metrics.errorReduction > 50) {
      this.emit('learning:milestone', metrics);
    }

    if (metrics.efficiencyGain > 30) {
      this.emit('learning:milestone', metrics);
    }
  }
}