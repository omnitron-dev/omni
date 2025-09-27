import { EventEmitter } from 'eventemitter3';
import { OrchestronEngine } from './engine.js';
import {
  Node,
  NodeId,
  TaskNode,
  TaskStatus,
  DevelopmentNodeType,
  DevelopmentEdgeType,
  Priority,
  DevelopmentMetadata,
} from './types.js';

export interface MLPrediction {
  confidence: number;
  value: any;
  factors: string[];
  reasoning?: string;
}

export interface TaskCompletionPrediction extends MLPrediction {
  estimatedDate: Date;
  estimatedHours: number;
  riskFactors: string[];
  blockers: string[];
}

export interface AnomalyDetection {
  isAnomaly: boolean;
  anomalyScore: number;
  type?: string;
  description?: string;
  affectedNodes: NodeId[];
}

export interface BugPrediction extends MLPrediction {
  bugProbability: number;
  bugTypes: string[];
  affectedFiles: string[];
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface BurnoutRiskAssessment {
  developerName: string;
  riskLevel: 'none' | 'low' | 'medium' | 'high' | 'critical';
  riskScore: number;
  indicators: string[];
  recommendations: string[];
}

export interface SprintOptimization {
  recommendedTasks: NodeId[];
  estimatedVelocity: number;
  riskAdjustedVelocity: number;
  optimizationReasons: string[];
  alternativeScenarios: SprintScenario[];
}

export interface SprintScenario {
  tasks: NodeId[];
  probability: number;
  velocity: number;
  risks: string[];
}

export interface CodeQualityPrediction extends MLPrediction {
  qualityScore: number;
  issues: QualityIssue[];
  mergeReadiness: boolean;
  recommendations: string[];
}

export interface QualityIssue {
  type: string;
  severity: 'low' | 'medium' | 'high';
  description: string;
  file?: string;
  line?: number;
}

interface DeveloperProfile {
  name: string;
  averageVelocity: number;
  taskCompletionRate: number;
  bugRate: number;
  workingHours: number[];
  specializations: string[];
  recentPerformance: number[];
}

interface PatternCache {
  taskPatterns: Map<string, TaskPattern>;
  developerPatterns: Map<string, DeveloperPattern>;
  codePatterns: Map<string, CodePattern>;
  lastUpdated: Date;
}

interface TaskPattern {
  averageDuration: number;
  variance: number;
  complexity: number;
  dependencies: number;
  historicalAccuracy: number;
}

interface DeveloperPattern {
  productivityByHour: number[];
  taskPreferences: Map<string, number>;
  errorRate: number;
  velocityTrend: number[];
  stressIndicators: number;
}

interface CodePattern {
  complexity: number;
  churn: number;
  coupledFiles: string[];
  bugHistory: number;
  testCoverage: number;
}

export class MLPredictor extends EventEmitter {
  private engine: OrchestronEngine;
  private patternCache: PatternCache;
  private developerProfiles: Map<string, DeveloperProfile>;

  constructor(engine: OrchestronEngine) {
    super();
    this.engine = engine;
    this.developerProfiles = new Map();
    this.patternCache = {
      taskPatterns: new Map(),
      developerPatterns: new Map(),
      codePatterns: new Map(),
      lastUpdated: new Date(),
    };
  }

  async predictTaskCompletion(taskId: NodeId): Promise<TaskCompletionPrediction | null> {
    const task = await this.engine.getNode(taskId);
    if (!task || !this.isTaskNode(task)) return null;

    const taskNode = task as TaskNode;

    // Return null for completed tasks
    if (taskNode.payload.status === TaskStatus.DONE ||
        taskNode.payload.status === TaskStatus.CANCELLED) {
      return null;
    }

    const historicalTasks = await this.getHistoricalSimilarTasks(taskNode);
    const developerProfile = await this.getDeveloperProfile(taskNode.payload.assignee || 'unknown');
    const dependencies = await this.getTaskDependencies(taskId);
    const currentProgress = taskNode.payload.progress || 0;

    const features = this.extractTaskFeatures(taskNode, historicalTasks, developerProfile);
    const prediction = this.runCompletionModel(features);

    const remainingHours = this.calculateRemainingHours(
      taskNode,
      historicalTasks,
      developerProfile,
      prediction.confidence
    );

    const estimatedDate = this.calculateEstimatedDate(remainingHours, developerProfile);

    const riskFactors = this.identifyRiskFactors(taskNode, dependencies, developerProfile);
    const blockers = await this.identifyBlockers(taskId, dependencies);

    return {
      confidence: prediction.confidence,
      value: estimatedDate,
      factors: prediction.factors,
      reasoning: prediction.reasoning,
      estimatedDate,
      estimatedHours: remainingHours,
      riskFactors,
      blockers,
    };
  }

  async detectAnomalies(windowHours: number = 24): Promise<AnomalyDetection[]> {
    const recentNodes = await this.getRecentNodes(windowHours);
    const anomalies: AnomalyDetection[] = [];

    const velocityAnomaly = await this.detectVelocityAnomaly(recentNodes);
    if (velocityAnomaly) anomalies.push(velocityAnomaly);

    const patternAnomalies = await this.detectPatternAnomalies(recentNodes);
    anomalies.push(...patternAnomalies);

    const workloadAnomaly = await this.detectWorkloadAnomaly(recentNodes);
    if (workloadAnomaly) anomalies.push(workloadAnomaly);

    const errorRateAnomaly = await this.detectErrorRateAnomaly(recentNodes);
    if (errorRateAnomaly) anomalies.push(errorRateAnomaly);

    return anomalies;
  }

  async predictBugs(changeNodes: NodeId[]): Promise<BugPrediction> {
    const changes = await this.getCodeChanges(changeNodes);
    const historicalBugs = await this.getHistoricalBugs();

    const complexity = this.calculateCodeComplexity(changes);
    const churn = this.calculateCodeChurn(changes);
    const coupling = await this.calculateFileCoupling(changes);
    const testCoverage = await this.getTestCoverage(changes.map(c => c.file));

    const features = {
      complexity,
      churn,
      coupling,
      testCoverage,
      historicalBugRate: this.calculateHistoricalBugRate(changes, historicalBugs),
      developerExperience: await this.getDeveloperExperience(changes),
      recentBugCount: this.getRecentBugCount(historicalBugs),
    };

    const prediction = this.runBugPredictionModel(features);

    return {
      confidence: prediction.confidence,
      value: prediction.probability,
      factors: prediction.factors,
      bugProbability: prediction.probability,
      bugTypes: prediction.types,
      affectedFiles: changes.map(c => c.file),
      severity: this.calculateBugSeverity(prediction.probability, complexity),
    };
  }

  async detectBurnoutRisk(developerName: string): Promise<BurnoutRiskAssessment> {
    const profile = await this.getDeveloperProfile(developerName);
    const recentActivity = await this.getDeveloperActivity(developerName, 14);

    const workingHoursVariance = this.calculateWorkingHoursVariance(recentActivity);
    const overtimeHours = this.calculateOvertimeHours(recentActivity);
    const taskSwitching = this.calculateTaskSwitching(recentActivity);
    const errorRate = this.calculateRecentErrorRate(recentActivity);
    const velocityDecline = this.calculateVelocityDecline(profile);

    const indicators: string[] = [];
    let riskScore = 0;

    if (workingHoursVariance > 2) {
      indicators.push('Irregular working hours');
      riskScore += 20;
    }
    if (overtimeHours > 10) {
      indicators.push('Excessive overtime');
      riskScore += 30;
    }
    if (taskSwitching > 5) {
      indicators.push('High task switching');
      riskScore += 15;
    }
    if (errorRate > profile.bugRate * 1.5) {
      indicators.push('Increased error rate');
      riskScore += 25;
    }
    if (velocityDecline > 0.2) {
      indicators.push('Declining velocity');
      riskScore += 20;
    }

    const riskLevel = this.calculateRiskLevel(riskScore);
    const recommendations = this.generateBurnoutRecommendations(indicators, riskLevel);

    return {
      developerName,
      riskLevel,
      riskScore,
      indicators,
      recommendations,
    };
  }

  async optimizeSprintPlanning(
    sprintCapacity: number,
    availableTasks: NodeId[],
    teamSize: number
  ): Promise<SprintOptimization> {
    const tasks = await this.getTaskDetails(availableTasks);
    const teamProfiles = await this.getTeamProfiles(teamSize);

    const taskFeatures = tasks.map(task => this.extractOptimizationFeatures(task));
    const teamCapabilities = this.aggregateTeamCapabilities(teamProfiles);

    const scenarios = this.generateSprintScenarios(
      tasks,
      sprintCapacity,
      teamCapabilities
    );

    const optimalScenario = this.selectOptimalScenario(scenarios);
    const alternativeScenarios = this.selectAlternatives(scenarios, 3);

    const estimatedVelocity = this.calculateScenarioVelocity(optimalScenario);
    const riskAdjustedVelocity = this.adjustForRisk(estimatedVelocity, optimalScenario);

    return {
      recommendedTasks: optimalScenario.tasks,
      estimatedVelocity,
      riskAdjustedVelocity,
      optimizationReasons: optimalScenario.reasons,
      alternativeScenarios,
    };
  }

  async predictCodeQuality(changeNodes: NodeId[]): Promise<CodeQualityPrediction> {
    const changes = await this.getCodeChanges(changeNodes);
    const existingIssues = await this.getExistingQualityIssues(changes.map(c => c.file));

    const complexity = this.calculateCodeComplexity(changes);
    const duplication = await this.detectCodeDuplication(changes);
    const standards = await this.checkCodingStandards(changes);
    const testCoverage = await this.getTestCoverage(changes.map(c => c.file));

    const qualityScore = this.calculateQualityScore({
      complexity,
      duplication,
      standards,
      testCoverage,
      existingIssues: existingIssues.length,
    });

    const issues = this.identifyQualityIssues(changes, {
      complexity,
      duplication,
      standards,
      testCoverage,
    });

    const mergeReadiness = qualityScore > 0.7 && !issues.some(i => i.severity === 'high');
    const recommendations = this.generateQualityRecommendations(issues, qualityScore);

    return {
      confidence: 0.85,
      value: qualityScore,
      factors: [
        `Complexity: ${complexity.toFixed(2)}`,
        `Duplication: ${(duplication * 100).toFixed(1)}%`,
        `Test Coverage: ${(testCoverage * 100).toFixed(1)}%`,
      ],
      qualityScore,
      issues,
      mergeReadiness,
      recommendations,
    };
  }

  // Private helper methods

  private isTaskNode(node: Node): boolean {
    const taskTypes = [
      DevelopmentNodeType.TASK,
      DevelopmentNodeType.EPIC,
      DevelopmentNodeType.STORY,
      DevelopmentNodeType.SUBTASK,
      DevelopmentNodeType.TODO,
    ];
    return taskTypes.includes(node.nodeType);
  }

  private async getHistoricalSimilarTasks(task: TaskNode): Promise<TaskNode[]> {
    const allTasks = await this.engine.queryByType(task.nodeType);
    return allTasks
      .filter(t => {
        const taskNode = t as TaskNode;
        return taskNode.payload.status === TaskStatus.DONE &&
               Math.abs((taskNode.payload.estimatedHours || 0) - (task.payload.estimatedHours || 0)) < 10;
      })
      .map(t => t as TaskNode)
      .slice(-20);
  }

  private async getDeveloperProfile(name: string): Promise<DeveloperProfile> {
    if (!this.developerProfiles.has(name)) {
      const profile = await this.buildDeveloperProfile(name);
      this.developerProfiles.set(name, profile);
    }
    return this.developerProfiles.get(name)!;
  }

  private async buildDeveloperProfile(name: string): Promise<DeveloperProfile> {
    const tasks = await this.engine.getAllNodes();
    const developerTasks = tasks.filter(t =>
      this.isTaskNode(t) && (t as TaskNode).payload.assignee === name
    ) as TaskNode[];

    const completedTasks = developerTasks.filter(t => t.payload.status === TaskStatus.DONE);
    const velocities = completedTasks.map(t =>
      (t.payload.estimatedHours || 0) / (t.payload.actualHours || 1)
    );

    return {
      name,
      averageVelocity: velocities.length > 0
        ? velocities.reduce((a, b) => a + b, 0) / velocities.length
        : 1,
      taskCompletionRate: completedTasks.length / (developerTasks.length || 1),
      bugRate: 0.1,
      workingHours: [9, 10, 11, 14, 15, 16, 17],
      specializations: [],
      recentPerformance: velocities.slice(-10),
    };
  }

  private async getTaskDependencies(taskId: NodeId): Promise<NodeId[]> {
    // Get edges where this task is blocked by others (task is target)
    const edges = await this.engine.getEdgesByTarget(taskId);
    const blockedByEdges = edges
      .filter(e => e.edgeType === DevelopmentEdgeType.BLOCKS)
      .map(e => e.sourceNodeId);

    // Also check if task has explicit dependencies in payload
    const task = await this.engine.getNode(taskId);
    if (task && this.isTaskNode(task)) {
      const taskNode = task as TaskNode;
      const payloadDeps = taskNode.payload.blockedBy || [];
      // Combine both sources of dependencies
      return [...new Set([...blockedByEdges, ...payloadDeps])];
    }

    return blockedByEdges;
  }

  private extractTaskFeatures(
    task: TaskNode,
    historicalTasks: TaskNode[],
    profile: DeveloperProfile
  ): any {
    return {
      estimatedHours: task.payload.estimatedHours || 0,
      actualHours: task.payload.actualHours || 0,
      progress: task.payload.progress || 0,
      priority: this.priorityToNumber(task.payload.priority),
      developerVelocity: profile.averageVelocity,
      historicalAccuracy: this.calculateHistoricalAccuracy(historicalTasks),
      complexity: task.payload.estimatedHours || 0,
    };
  }

  private runCompletionModel(features: any): any {
    const baseConfidence = 0.75;

    // Ensure all multipliers have valid defaults
    const historicalAccuracy = features.historicalAccuracy || 0.85;
    const progressFactor = features.progress > 0 ? 1.1 : 1.0;
    const developerFactor = features.developerVelocity > 0 ?
      Math.min(Math.max(features.developerVelocity, 0.9), 1.3) : 1.0;

    const adjustedConfidence = baseConfidence *
      historicalAccuracy *
      progressFactor *
      developerFactor;

    // Ensure minimum confidence is slightly above 0.5 for valid predictions
    return {
      confidence: Math.min(Math.max(adjustedConfidence, 0.55), 0.95),
      factors: ['Historical accuracy', 'Developer velocity', 'Task progress'],
      reasoning: 'Based on historical task completion patterns and developer performance',
    };
  }

  private calculateRemainingHours(
    task: TaskNode,
    historicalTasks: TaskNode[],
    profile: DeveloperProfile,
    confidence: number
  ): number {
    const estimatedTotal = task.payload.estimatedHours || 0;
    const actualSoFar = task.payload.actualHours || 0;
    const progress = (task.payload.progress || 0) / 100;

    if (progress === 0) {
      return estimatedTotal / profile.averageVelocity;
    }

    const projectedTotal = actualSoFar / progress;
    const weightedEstimate =
      (projectedTotal * progress * confidence) +
      (estimatedTotal * (1 - progress) * (1 - confidence));

    return Math.max(0, weightedEstimate - actualSoFar);
  }

  private calculateEstimatedDate(remainingHours: number, profile: DeveloperProfile): Date {
    const hoursPerDay = profile.workingHours.length;
    const days = Math.ceil(remainingHours / hoursPerDay);

    const date = new Date();
    let addedDays = 0;

    while (addedDays < days) {
      date.setDate(date.getDate() + 1);
      if (date.getDay() !== 0 && date.getDay() !== 6) {
        addedDays++;
      }
    }

    return date;
  }

  private identifyRiskFactors(
    task: TaskNode,
    dependencies: NodeId[],
    profile: DeveloperProfile
  ): string[] {
    const risks: string[] = [];

    if (task.payload.priority === Priority.CRITICAL) {
      risks.push('Critical priority task');
    }
    if (dependencies.length > 2) {
      risks.push(`High dependency count (${dependencies.length})`);
    }
    if (profile.averageVelocity < 0.8) {
      risks.push('Below average developer velocity');
    }
    if ((task.payload.estimatedHours || 0) > 40) {
      risks.push('Large task size');
    }

    return risks;
  }

  private async identifyBlockers(
    taskId: NodeId,
    dependencies: NodeId[]
  ): Promise<string[]> {
    const blockers: string[] = [];

    for (const depId of dependencies) {
      const dep = await this.engine.getNode(depId);
      if (dep && this.isTaskNode(dep)) {
        const depTask = dep as TaskNode;
        if (depTask.payload.status !== TaskStatus.DONE) {
          blockers.push(`Blocked by: ${depTask.payload.title}`);
        }
      }
    }

    return blockers;
  }

  private async getRecentNodes(windowHours: number): Promise<Node[]> {
    const cutoff = new Date();
    cutoff.setHours(cutoff.getHours() - windowHours);

    const allNodes = await this.engine.getAllNodes();
    // Include nodes created within the window (>=) not just after (>)
    return allNodes.filter(n => n.timestamp >= cutoff);
  }

  private async detectVelocityAnomaly(nodes: Node[]): Promise<AnomalyDetection | null> {
    const taskNodes = nodes.filter(n => this.isTaskNode(n)) as TaskNode[];
    const completedTasks = taskNodes.filter(t => t.payload.status === TaskStatus.DONE);

    // Allow detection with at least 2 completed tasks
    if (completedTasks.length < 2) return null;

    const velocities = completedTasks.map(t => {
      const estimated = t.payload.estimatedHours || 1;
      const actual = t.payload.actualHours || estimated;
      return estimated / actual;
    });

    const avgVelocity = velocities.reduce((a, b) => a + b, 0) / velocities.length;

    // Calculate standard deviation
    const variance = velocities.reduce((sum, v) => sum + Math.pow(v - avgVelocity, 2), 0) / velocities.length;
    const stdDev = Math.sqrt(variance);

    // Check for high variance or extreme outliers
    const hasHighVariance = stdDev > avgVelocity * 0.3;
    const hasOutlier = velocities.some(v => Math.abs(v - avgVelocity) > avgVelocity * 0.8);

    if (hasHighVariance || hasOutlier) {
      return {
        isAnomaly: true,
        anomalyScore: stdDev / Math.max(avgVelocity, 0.1),
        type: 'velocity_variance',
        description: 'Unusual variance in task completion velocity',
        affectedNodes: completedTasks.map(t => t.nodeId),
      };
    }

    return null;
  }

  private async detectPatternAnomalies(nodes: Node[]): Promise<AnomalyDetection[]> {
    const anomalies: AnomalyDetection[] = [];

    // Check all types of development nodes for unusual patterns
    const developmentNodes = nodes.filter(n =>
      n.nodeType === DevelopmentNodeType.MODULE ||
      n.nodeType === DevelopmentNodeType.FEATURE ||
      n.nodeType === DevelopmentNodeType.COMMIT ||
      n.nodeType === DevelopmentNodeType.FIX ||
      n.nodeType === DevelopmentNodeType.REFACTOR
    );

    const commitsByHour = new Map<number, number>();
    developmentNodes.forEach(n => {
      const hour = n.timestamp.getHours();
      commitsByHour.set(hour, (commitsByHour.get(hour) || 0) + 1);
    });

    // Check for unusual working hours (late night or very early morning)
    for (const [hour, count] of commitsByHour.entries()) {
      if ((hour < 6 || hour > 22) && count > 0) {
        anomalies.push({
          isAnomaly: true,
          anomalyScore: count / Math.max(developmentNodes.length, 1),
          type: 'unusual_hours',
          description: `Unusual activity at ${hour}:00`,
          affectedNodes: developmentNodes.filter(n => n.timestamp.getHours() === hour).map(n => n.nodeId),
        });
      }
    }

    return anomalies;
  }

  private async detectWorkloadAnomaly(nodes: Node[]): Promise<AnomalyDetection | null> {
    const taskNodes = nodes.filter(n => this.isTaskNode(n)) as TaskNode[];
    const assigneeCounts = new Map<string, number>();

    taskNodes.forEach(t => {
      const assignee = t.payload.assignee || 'unassigned';
      assigneeCounts.set(assignee, (assigneeCounts.get(assignee) || 0) + 1);
    });

    const counts = Array.from(assigneeCounts.values());
    if (counts.length < 2) return null;

    const avgCount = counts.reduce((a, b) => a + b, 0) / counts.length;
    const maxCount = Math.max(...counts);

    if (maxCount > avgCount * 2) {
      const overloadedDev = Array.from(assigneeCounts.entries())
        .find(([_, count]) => count === maxCount)?.[0];

      return {
        isAnomaly: true,
        anomalyScore: maxCount / avgCount,
        type: 'workload_imbalance',
        description: `Developer ${overloadedDev} is overloaded`,
        affectedNodes: taskNodes
          .filter(t => t.payload.assignee === overloadedDev)
          .map(t => t.nodeId),
      };
    }

    return null;
  }

  private async detectErrorRateAnomaly(nodes: Node[]): Promise<AnomalyDetection | null> {
    const errorNodes = nodes.filter(n =>
      n.nodeType === DevelopmentNodeType.ERROR ||
      n.nodeType === DevelopmentNodeType.BUG
    );

    const totalNodes = nodes.length;
    const errorRate = errorNodes.length / totalNodes;

    if (errorRate > 0.1) {
      return {
        isAnomaly: true,
        anomalyScore: errorRate * 10,
        type: 'high_error_rate',
        description: `Error rate is ${(errorRate * 100).toFixed(1)}%`,
        affectedNodes: errorNodes.map(n => n.nodeId),
      };
    }

    return null;
  }

  private async getCodeChanges(changeNodes: NodeId[]): Promise<any[]> {
    const changes: any[] = [];

    for (const nodeId of changeNodes) {
      const node = await this.engine.getNode(nodeId);
      if (node && node.metadata.filesModified) {
        node.metadata.filesModified.forEach((file: string) => {
          changes.push({
            file,
            nodeId,
            timestamp: node.timestamp,
            type: node.nodeType,
          });
        });
      }
    }

    return changes;
  }

  private async getHistoricalBugs(): Promise<Node[]> {
    return this.engine.queryByType(DevelopmentNodeType.BUG);
  }

  private calculateCodeComplexity(changes: any[]): number {
    return Math.min(10, changes.length * 0.5 + Math.random() * 3);
  }

  private calculateCodeChurn(changes: any[]): number {
    const fileChangeCounts = new Map<string, number>();
    changes.forEach(c => {
      fileChangeCounts.set(c.file, (fileChangeCounts.get(c.file) || 0) + 1);
    });

    const maxChurn = Math.max(...Array.from(fileChangeCounts.values()));
    return Math.min(1, maxChurn / 10);
  }

  private async calculateFileCoupling(changes: any[]): Promise<number> {
    const filePairs = new Set<string>();

    for (let i = 0; i < changes.length - 1; i++) {
      for (let j = i + 1; j < changes.length; j++) {
        if (changes[i].nodeId === changes[j].nodeId) {
          filePairs.add(`${changes[i].file}:${changes[j].file}`);
        }
      }
    }

    return Math.min(1, filePairs.size / (changes.length * 2));
  }

  private async getTestCoverage(files: string[]): Promise<number> {
    // Count files with tests
    const testFiles = files.filter(f =>
      f.includes('.test.') ||
      f.includes('.spec.') ||
      f.includes('test/') ||
      f.includes('tests/') ||
      f.includes('__tests__/')
    );

    // Count source files (excluding tests)
    const sourceFiles = files.filter(f =>
      !f.includes('.test.') &&
      !f.includes('.spec.') &&
      !f.includes('test/') &&
      !f.includes('tests/') &&
      !f.includes('__tests__/') &&
      (f.endsWith('.ts') || f.endsWith('.js') || f.endsWith('.tsx') || f.endsWith('.jsx'))
    );

    if (sourceFiles.length === 0) {
      // If no source files, assume good coverage
      return 0.9;
    }

    // Calculate coverage based on ratio of test files to source files
    const ratio = testFiles.length / sourceFiles.length;

    // Convert ratio to coverage percentage (0-1)
    // Having 1 test file per source file = ~80% coverage
    // Having more test files = higher coverage
    return Math.min(0.95, 0.3 + ratio * 0.5);
  }

  private calculateHistoricalBugRate(changes: any[], bugs: Node[]): number {
    const filesWithBugs = new Set(
      bugs.flatMap(b => b.metadata.filesModified || [])
    );

    const affectedFiles = new Set(changes.map(c => c.file));
    const intersection = new Set(
      [...affectedFiles].filter(f => filesWithBugs.has(f))
    );

    return intersection.size / (affectedFiles.size || 1);
  }

  private async getDeveloperExperience(changes: any[]): Promise<number> {
    return 0.5 + Math.random() * 0.5;
  }

  private getRecentBugCount(bugs: Node[]): number {
    const recentCutoff = new Date();
    recentCutoff.setDate(recentCutoff.getDate() - 7);

    return bugs.filter(b => b.timestamp > recentCutoff).length;
  }

  private runBugPredictionModel(features: any): any {
    const probability =
      features.complexity * 0.2 +
      features.churn * 0.15 +
      features.coupling * 0.15 +
      (1 - features.testCoverage) * 0.2 +
      features.historicalBugRate * 0.15 +
      (1 - features.developerExperience) * 0.1 +
      Math.min(1, features.recentBugCount / 10) * 0.05;

    const types = [];
    if (features.complexity > 7) types.push('Logic error');
    if (features.churn > 0.5) types.push('Regression');
    if (features.coupling > 0.3) types.push('Integration issue');
    if (features.testCoverage < 0.5) types.push('Untested edge case');

    return {
      confidence: 0.75 + features.historicalBugRate * 0.15,
      probability: Math.min(1, probability),
      types,
      factors: Object.keys(features).map(k => `${k}: ${features[k].toFixed(2)}`),
    };
  }

  private calculateBugSeverity(probability: number, complexity: number): 'low' | 'medium' | 'high' | 'critical' {
    const score = probability * complexity / 10;
    if (score > 0.7) return 'critical';
    if (score > 0.5) return 'high';
    if (score > 0.3) return 'medium';
    return 'low';
  }

  private async getDeveloperActivity(name: string, days: number): Promise<Node[]> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const allNodes = await this.engine.getAllNodes();
    return allNodes.filter(n => {
      if (n.timestamp <= cutoff) return false;

      // Check if developer is author
      if (n.metadata.author === name) return true;

      // Check if developer is assignee (for tasks)
      if (this.isTaskNode(n)) {
        const task = n as TaskNode;
        if (task.payload.assignee === name) return true;
      }

      return false;
    });
  }

  private calculateWorkingHoursVariance(activity: Node[]): number {
    const hourCounts = new Map<number, number>();
    activity.forEach(n => {
      const hour = n.timestamp.getHours();
      hourCounts.set(hour, (hourCounts.get(hour) || 0) + 1);
    });

    const counts = Array.from(hourCounts.values());
    if (counts.length === 0) return 0;

    const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
    const variance = counts.reduce((sum, c) => sum + Math.pow(c - avg, 2), 0) / counts.length;

    return Math.sqrt(variance);
  }

  private calculateOvertimeHours(activity: Node[]): number {
    return activity.filter(n => {
      const hour = n.timestamp.getHours();
      return hour < 8 || hour > 18;
    }).length;
  }

  private calculateTaskSwitching(activity: Node[]): number {
    const taskSequence = activity
      .filter(n => this.isTaskNode(n))
      .map(n => (n as TaskNode).nodeId);

    let switches = 0;
    for (let i = 1; i < taskSequence.length; i++) {
      if (taskSequence[i] !== taskSequence[i - 1]) {
        switches++;
      }
    }

    return switches;
  }

  private calculateRecentErrorRate(activity: Node[]): number {
    const errors = activity.filter(n =>
      n.nodeType === DevelopmentNodeType.ERROR ||
      n.nodeType === DevelopmentNodeType.BUG
    ).length;

    return errors / (activity.length || 1);
  }

  private calculateVelocityDecline(profile: DeveloperProfile): number {
    const recent = profile.recentPerformance;
    if (recent.length < 2) return 0;

    const firstHalf = recent.slice(0, Math.floor(recent.length / 2));
    const secondHalf = recent.slice(Math.floor(recent.length / 2));

    const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

    return Math.max(0, (firstAvg - secondAvg) / firstAvg);
  }

  private calculateRiskLevel(score: number): 'none' | 'low' | 'medium' | 'high' | 'critical' {
    if (score >= 80) return 'critical';
    if (score >= 60) return 'high';
    if (score >= 40) return 'medium';
    if (score >= 20) return 'low';
    return 'none';
  }

  private generateBurnoutRecommendations(indicators: string[], riskLevel: string): string[] {
    const recommendations: string[] = [];

    if (indicators.includes('Excessive overtime')) {
      recommendations.push('Consider redistributing workload');
      recommendations.push('Enforce work-life balance policies');
    }
    if (indicators.includes('High task switching')) {
      recommendations.push('Reduce context switching by batching similar tasks');
      recommendations.push('Allow focused work time');
    }
    if (indicators.includes('Increased error rate')) {
      recommendations.push('Provide additional support or pair programming');
      recommendations.push('Review recent work for quality issues');
    }
    if (indicators.includes('Declining velocity')) {
      recommendations.push('Schedule a 1-on-1 to discuss challenges');
      recommendations.push('Consider a short break or reduced workload');
    }

    if (riskLevel === 'critical' || riskLevel === 'high') {
      recommendations.push('Immediate intervention recommended');
      recommendations.push('Consider mandatory time off');
    }

    return recommendations;
  }

  private async getTaskDetails(taskIds: NodeId[]): Promise<TaskNode[]> {
    const tasks: TaskNode[] = [];

    for (const id of taskIds) {
      const node = await this.engine.getNode(id);
      if (node && this.isTaskNode(node)) {
        tasks.push(node as TaskNode);
      }
    }

    return tasks;
  }

  private async getTeamProfiles(teamSize: number): Promise<DeveloperProfile[]> {
    const profiles: DeveloperProfile[] = [];

    for (let i = 0; i < teamSize; i++) {
      profiles.push({
        name: `dev${i + 1}`,
        averageVelocity: 0.8 + Math.random() * 0.4,
        taskCompletionRate: 0.7 + Math.random() * 0.3,
        bugRate: 0.05 + Math.random() * 0.1,
        workingHours: [9, 10, 11, 14, 15, 16, 17],
        specializations: ['frontend', 'backend'][Math.floor(Math.random() * 2)] ? ['frontend'] : ['backend'],
        recentPerformance: Array(10).fill(0).map(() => 0.7 + Math.random() * 0.4),
      });
    }

    return profiles;
  }

  private extractOptimizationFeatures(task: TaskNode): any {
    return {
      estimatedHours: task.payload.estimatedHours || 0,
      priority: this.priorityToNumber(task.payload.priority),
      dependencies: 0, // Will be fetched separately if needed
      complexity: task.payload.estimatedHours || 0,
    };
  }

  private aggregateTeamCapabilities(profiles: DeveloperProfile[]): any {
    return {
      totalVelocity: profiles.reduce((sum, p) => sum + p.averageVelocity, 0),
      avgCompletionRate: profiles.reduce((sum, p) => sum + p.taskCompletionRate, 0) / profiles.length,
      specializations: new Set(profiles.flatMap(p => p.specializations)),
    };
  }

  private generateSprintScenarios(
    tasks: TaskNode[],
    capacity: number,
    teamCapabilities: any
  ): SprintScenario[] {
    const scenarios: SprintScenario[] = [];

    const sortedByPriority = [...tasks].sort((a, b) =>
      this.priorityToNumber(b.payload.priority) - this.priorityToNumber(a.payload.priority)
    );

    const priorityScenario: SprintScenario = {
      tasks: [],
      probability: 0.8,
      velocity: 0,
      risks: [],
    };

    let totalHours = 0;
    for (const task of sortedByPriority) {
      const hours = task.payload.estimatedHours || 0;
      if (totalHours + hours <= capacity) {
        priorityScenario.tasks.push(task.nodeId);
        totalHours += hours;
      }
    }
    priorityScenario.velocity = totalHours * teamCapabilities.avgCompletionRate;
    scenarios.push(priorityScenario);

    const balancedScenario: SprintScenario = {
      tasks: [],
      probability: 0.7,
      velocity: 0,
      risks: ['Balanced approach may delay critical items'],
    };

    const critical = tasks.filter(t => t.payload.priority === Priority.CRITICAL);
    const high = tasks.filter(t => t.payload.priority === Priority.HIGH);
    const medium = tasks.filter(t => t.payload.priority === Priority.MEDIUM);

    totalHours = 0;
    for (const groups of [critical, high, medium]) {
      for (const task of groups) {
        const hours = task.payload.estimatedHours || 0;
        if (totalHours + hours <= capacity * 0.9) {
          balancedScenario.tasks.push(task.nodeId);
          totalHours += hours;
        }
      }
    }
    balancedScenario.velocity = totalHours * teamCapabilities.avgCompletionRate * 1.1;
    scenarios.push(balancedScenario);

    return scenarios;
  }

  private selectOptimalScenario(scenarios: SprintScenario[]): any {
    const scored = scenarios.map(s => ({
      ...s,
      score: s.velocity * s.probability - s.risks.length * 0.1,
      reasons: [
        `Expected velocity: ${s.velocity.toFixed(1)}`,
        `Success probability: ${(s.probability * 100).toFixed(0)}%`,
        ...s.risks.map(r => `Risk: ${r}`),
      ],
    }));

    return scored.reduce((best, current) =>
      current.score > best.score ? current : best
    );
  }

  private selectAlternatives(scenarios: SprintScenario[], count: number): SprintScenario[] {
    return scenarios.slice(1, count + 1);
  }

  private calculateScenarioVelocity(scenario: any): number {
    return scenario.velocity || 0;
  }

  private adjustForRisk(velocity: number, scenario: any): number {
    const riskFactor = 1 - (scenario.risks?.length || 0) * 0.05;
    return velocity * riskFactor;
  }

  private async getExistingQualityIssues(files: string[]): Promise<any[]> {
    return [];
  }

  private async detectCodeDuplication(changes: any[]): Promise<number> {
    return Math.random() * 0.2;
  }

  private async checkCodingStandards(changes: any[]): Promise<number> {
    return 0.8 + Math.random() * 0.2;
  }

  private calculateQualityScore(metrics: any): number {
    return (
      (1 - Math.min(1, metrics.complexity / 10)) * 0.3 +
      (1 - metrics.duplication) * 0.2 +
      metrics.standards * 0.2 +
      metrics.testCoverage * 0.2 +
      (1 - Math.min(1, metrics.existingIssues / 10)) * 0.1
    );
  }

  private identifyQualityIssues(changes: any[], metrics: any): QualityIssue[] {
    const issues: QualityIssue[] = [];

    if (metrics.complexity > 7) {
      issues.push({
        type: 'complexity',
        severity: 'high',
        description: 'High cyclomatic complexity detected',
      });
    }

    if (metrics.duplication > 0.15) {
      issues.push({
        type: 'duplication',
        severity: 'medium',
        description: `Code duplication: ${(metrics.duplication * 100).toFixed(1)}%`,
      });
    }

    if (metrics.testCoverage < 0.6) {
      issues.push({
        type: 'coverage',
        severity: 'medium',
        description: `Low test coverage: ${(metrics.testCoverage * 100).toFixed(1)}%`,
      });
    }

    return issues;
  }

  private generateQualityRecommendations(issues: QualityIssue[], score: number): string[] {
    const recommendations: string[] = [];

    issues.forEach(issue => {
      switch (issue.type) {
        case 'complexity':
          recommendations.push('Refactor complex methods into smaller functions');
          break;
        case 'duplication':
          recommendations.push('Extract common code into shared utilities');
          break;
        case 'coverage':
          recommendations.push('Add unit tests for uncovered code paths');
          break;
      }
    });

    if (score < 0.5) {
      recommendations.push('Consider code review before merging');
    }

    return recommendations;
  }

  private priorityToNumber(priority: Priority): number {
    switch (priority) {
      case Priority.CRITICAL: return 5;
      case Priority.HIGH: return 4;
      case Priority.MEDIUM: return 3;
      case Priority.LOW: return 2;
      case Priority.TRIVIAL: return 1;
      default: return 3;
    }
  }

  private calculateHistoricalAccuracy(tasks: TaskNode[]): number {
    if (tasks.length === 0) return 0.5;

    const accuracies = tasks.map(t => {
      const estimated = t.payload.estimatedHours || 1;
      const actual = t.payload.actualHours || estimated;
      return 1 - Math.abs(estimated - actual) / estimated;
    });

    return Math.max(0, accuracies.reduce((a, b) => a + b, 0) / accuracies.length);
  }

  /**
   * Predict the impact of an improvement
   */
  async predictImpact(improvement: any): Promise<number> {
    // Simple impact prediction based on improvement type
    const baseImpact = Math.random() * 0.5 + 0.3; // 0.3 to 0.8

    // Adjust based on improvement type
    if (improvement.type === 'optimization') {
      return Math.min(0.9, baseImpact * 1.2);
    } else if (improvement.type === 'bug_fix') {
      return Math.min(0.95, baseImpact * 1.3);
    }

    return baseImpact;
  }
}