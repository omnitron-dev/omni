import { CSPEngine } from './engine';
import { TaskManager } from './task-manager';
import { SprintManager } from './sprint-manager';
import {
  Statistics,
  DevelopmentNodeType,
  DevelopmentEdgeType,
  TaskStatus,
  Priority,
  Node,
  TaskNode,
  SprintNode,
} from './types';

export interface TrendData {
  dates: Date[];
  values: number[];
  trend: 'up' | 'down' | 'stable';
  prediction?: number[];
}

export interface Bottleneck {
  nodeId: string;
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  impact: string;
  suggestion: string;
}

export interface TeamMetrics {
  teamSize: number;
  velocity: number;
  throughput: number;
  efficiency: number;
  collaboration: number;
}

export interface IndividualMetrics {
  assignee: string;
  tasksCompleted: number;
  averageCycleTime: number;
  productivity: number;
  quality: number;
  workload: number;
}

export interface QualityMetrics {
  codeQualityScore: number;
  testCoverage: number;
  bugDensity: number;
  technicalDebtRatio: number;
  codeChurn: number;
  duplicateCodePercentage: number;
}

export interface TestMetrics {
  totalTests: number;
  passingTests: number;
  failingTests: number;
  skippedTests: number;
  coverage: number;
  averageExecutionTime: number;
}

export interface TechDebtMetrics {
  totalDebt: number;
  debtByComponent: Record<string, number>;
  criticalIssues: number;
  estimatedEffort: number;
  debtRatio: number;
}

export class Analytics {
  private engine: CSPEngine;
  private taskManager: TaskManager;
  private sprintManager: SprintManager;

  constructor(
    engine: CSPEngine,
    taskManager: TaskManager,
    sprintManager: SprintManager
  ) {
    this.engine = engine;
    this.taskManager = taskManager;
    this.sprintManager = sprintManager;
  }

  // Real-time statistics
  async getStats(): Promise<Statistics> {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const lastWeek = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    const lastMonth = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Task statistics
    const taskStats = await this.taskManager.getTaskStatistics();

    // Get all nodes for comprehensive stats
    const allNodes = await this.engine.getAllNodes();

    // Code metrics
    let linesAdded = 0;
    let linesRemoved = 0;
    const filesChanged = new Set<string>();
    let totalCoverage = 0;
    let coverageCount = 0;

    for (const node of allNodes) {
      if (node.timestamp >= lastWeek) {
        linesAdded += node.metadata.linesAdded || 0;
        linesRemoved += node.metadata.linesRemoved || 0;
        if (node.metadata.filesModified) {
          node.metadata.filesModified.forEach((f) => filesChanged.add(f));
        }
      }
      if (node.metadata.testCoverage !== undefined) {
        totalCoverage += node.metadata.testCoverage;
        coverageCount++;
      }
    }

    // Calculate velocity and cycle time
    const velocity = await this.calculateVelocity(lastWeek);
    const cycleTime = await this.calculateCycleTime(lastMonth);
    const leadTime = await this.calculateLeadTime(lastMonth);
    const throughput = await this.calculateThroughput(lastWeek);

    // Error metrics
    const errorRate = await this.calculateErrorRate(lastWeek);
    const bugFixTime = await this.calculateBugFixTime(lastMonth);

    // Deployment frequency
    const deploymentFrequency = await this.calculateDeploymentFrequency(
      lastMonth
    );

    return {
      totalTasks: taskStats.total,
      completedToday: taskStats.completedToday,
      inProgress: taskStats.byStatus[TaskStatus.IN_PROGRESS] || 0,
      blocked: taskStats.byStatus[TaskStatus.BLOCKED] || 0,
      overdue: taskStats.overdue,

      velocity,
      cycleTime,
      leadTime,
      throughput,

      codeMetrics: {
        linesAdded,
        linesRemoved,
        filesChanged: filesChanged.size,
        testCoverage: coverageCount > 0 ? totalCoverage / coverageCount : 0,
      },

      errorRate,
      bugFixTime,
      deploymentFrequency,
    };
  }

  // Trend analysis
  async getTrends(
    metric: string,
    period: { from: Date; to: Date }
  ): Promise<TrendData> {
    const dates: Date[] = [];
    const values: number[] = [];

    // Generate daily data points
    const current = new Date(period.from);
    while (current <= period.to) {
      dates.push(new Date(current));

      // Get metric value for this date
      const value = await this.getMetricValue(metric, current);
      values.push(value);

      current.setDate(current.getDate() + 1);
    }

    // Calculate trend
    const trend = this.calculateTrend(values);

    // Generate prediction
    const prediction = this.predictFuture(values, 7); // Predict 7 days

    return {
      dates,
      values,
      trend,
      prediction,
    };
  }

  async predictCompletion(taskId: string): Promise<Date | null> {
    const task = await this.engine.getNode(taskId);
    if (!task) return null;

    const taskNode = task as TaskNode;
    const progress = taskNode.payload.progress || 0;
    const actualHours = taskNode.payload.actualHours || 0;
    const estimatedHours = taskNode.payload.estimatedHours || 0;

    if (progress === 100 || taskNode.payload.status === TaskStatus.DONE) {
      return null;
    }

    if (progress === 0) {
      return null;
    }

    // Calculate velocity
    const hoursPerPercent = actualHours / progress;
    const remainingPercent = 100 - progress;
    const remainingHours = hoursPerPercent * remainingPercent;

    // Assume 6 hours of work per day
    const remainingDays = Math.ceil(remainingHours / 6);

    const predictedDate = new Date();
    predictedDate.setDate(predictedDate.getDate() + remainingDays);

    // Skip weekends
    while (
      predictedDate.getDay() === 0 ||
      predictedDate.getDay() === 6
    ) {
      predictedDate.setDate(predictedDate.getDate() + 1);
    }

    return predictedDate;
  }

  async identifyBottlenecks(): Promise<Bottleneck[]> {
    const bottlenecks: Bottleneck[] = [];

    // 1. Check for long-running tasks
    const tasks = await this.engine.queryByType(DevelopmentNodeType.TASK);
    for (const task of tasks) {
      const taskNode = task as TaskNode;
      if (
        taskNode.payload.status === TaskStatus.IN_PROGRESS &&
        taskNode.payload.startDate
      ) {
        const daysInProgress =
          (new Date().getTime() -
            new Date(taskNode.payload.startDate).getTime()) /
          (1000 * 60 * 60 * 24);

        if (daysInProgress > 5) {
          bottlenecks.push({
            nodeId: taskNode.nodeId,
            type: 'long_running_task',
            severity: daysInProgress > 10 ? 'critical' : 'high',
            description: `Task in progress for ${Math.floor(
              daysInProgress
            )} days`,
            impact: 'Blocking sprint progress',
            suggestion: 'Break down into smaller tasks or add resources',
          });
        }
      }
    }

    // 2. Check for dependency chains
    const blockedTasks = await this.taskManager.getBlockedTasks();
    const blockingMap = new Map<string, number>();

    for (const task of blockedTasks) {
      for (const blockerId of task.payload.blockedBy || []) {
        blockingMap.set(
          blockerId,
          (blockingMap.get(blockerId) || 0) + 1
        );
      }
    }

    for (const [nodeId, count] of blockingMap.entries()) {
      if (count >= 3) {
        bottlenecks.push({
          nodeId,
          type: 'critical_dependency',
          severity: count >= 5 ? 'critical' : 'high',
          description: `Blocking ${count} other tasks`,
          impact: 'Multiple tasks waiting',
          suggestion: 'Prioritize completion or provide alternative path',
        });
      }
    }

    // 3. Check for resource contention
    const assigneeWorkload = new Map<string, number>();
    for (const task of tasks) {
      const taskNode = task as TaskNode;
      if (
        taskNode.payload.assignee &&
        taskNode.payload.status === TaskStatus.IN_PROGRESS
      ) {
        const assignee = taskNode.payload.assignee;
        assigneeWorkload.set(
          assignee,
          (assigneeWorkload.get(assignee) || 0) + 1
        );
      }
    }

    for (const [assignee, count] of assigneeWorkload.entries()) {
      if (count > 3) {
        bottlenecks.push({
          nodeId: assignee,
          type: 'resource_overload',
          severity: count > 5 ? 'critical' : 'medium',
          description: `${assignee} has ${count} tasks in progress`,
          impact: 'Context switching and delays',
          suggestion: 'Redistribute workload or limit WIP',
        });
      }
    }

    // 4. Check for high bug rate areas
    const bugsByComponent = new Map<string, number>();
    const bugs = await this.engine.queryByType(DevelopmentNodeType.BUG);

    for (const bug of bugs) {
      const component = bug.metadata.filesModified?.[0] || 'unknown';
      bugsByComponent.set(
        component,
        (bugsByComponent.get(component) || 0) + 1
      );
    }

    for (const [component, count] of bugsByComponent.entries()) {
      if (count > 5) {
        bottlenecks.push({
          nodeId: component,
          type: 'quality_issue',
          severity: count > 10 ? 'high' : 'medium',
          description: `${count} bugs in ${component}`,
          impact: 'High maintenance overhead',
          suggestion: 'Refactor or increase test coverage',
        });
      }
    }

    return bottlenecks;
  }

  // Team metrics
  async getTeamProductivity(): Promise<TeamMetrics> {
    // Get all tasks to determine the date range
    const tasks = await this.engine.queryByType(DevelopmentNodeType.TASK);

    // Find the earliest task date to use as baseline
    let earliestDate = new Date();
    for (const task of tasks) {
      const taskNode = task as TaskNode;
      if (taskNode.timestamp < earliestDate) {
        earliestDate = taskNode.timestamp;
      }
    }

    // Use 30 days from the earliest task date, or last month if no tasks
    const baselineDate = tasks.length > 0
      ? new Date(earliestDate.getTime() - 30 * 24 * 60 * 60 * 1000)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Get all assignees
    const assignees = new Set<string>();
    for (const task of tasks) {
      const taskNode = task as TaskNode;
      if (taskNode.payload.assignee) {
        assignees.add(taskNode.payload.assignee);
      }
    }

    const teamSize = assignees.size;
    const velocity = await this.calculateVelocity(baselineDate);
    const throughput = await this.calculateThroughput(baselineDate);

    // Calculate efficiency (completed vs started)
    let started = 0;
    let completed = 0;

    for (const task of tasks) {
      const taskNode = task as TaskNode;
      if (taskNode.timestamp >= baselineDate) {
        started++;
        if (taskNode.payload.status === TaskStatus.DONE) {
          completed++;
        }
      }
    }

    const efficiency = started > 0 ? completed / started : 0;

    // Calculate collaboration (tasks with multiple assignees/reviewers)
    let collaborativeTasks = 0;
    for (const task of tasks) {
      const taskNode = task as TaskNode;
      if (
        taskNode.payload.reviewers &&
        taskNode.payload.reviewers.length > 0
      ) {
        collaborativeTasks++;
      }
    }

    const collaboration = tasks.length > 0
      ? collaborativeTasks / tasks.length
      : 0;

    return {
      teamSize,
      velocity,
      throughput,
      efficiency,
      collaboration,
    };
  }

  async getIndividualMetrics(assignee: string): Promise<IndividualMetrics> {
    const allTasks = await this.engine.getAllNodes();
    const tasks = allTasks.filter(node => {
      const taskNode = node as TaskNode;
      return taskNode.payload && taskNode.payload.assignee === assignee;
    });

    // Find the earliest task date for this assignee to use as baseline
    let earliestDate = new Date();
    for (const task of tasks) {
      if (task.timestamp < earliestDate) {
        earliestDate = task.timestamp;
      }
    }

    // Use 30 days from earliest task, or last month if no tasks
    const lastMonth = tasks.length > 0
      ? new Date(earliestDate.getTime() - 30 * 24 * 60 * 60 * 1000)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    let tasksCompleted = 0;
    let totalCycleTime = 0;
    let cycleTimeCount = 0;
    let totalEstimated = 0;
    let totalActual = 0;

    for (const task of tasks) {
      const taskNode = task as TaskNode;

      if (
        taskNode.payload.status === TaskStatus.DONE &&
        taskNode.payload.completedDate &&
        new Date(taskNode.payload.completedDate) >= lastMonth
      ) {
        tasksCompleted++;

        if (taskNode.payload.startDate) {
          const cycleTime =
            (new Date(taskNode.payload.completedDate).getTime() -
              new Date(taskNode.payload.startDate).getTime()) /
            (1000 * 60 * 60 * 24); // days
          totalCycleTime += cycleTime;
          cycleTimeCount++;
        }

        totalEstimated += taskNode.payload.estimatedHours || 0;
        totalActual += taskNode.payload.actualHours || 0;
      }
    }

    const averageCycleTime =
      cycleTimeCount > 0 ? totalCycleTime / cycleTimeCount : 0;

    // Productivity: actual vs estimated
    const productivity =
      totalEstimated > 0 ? totalEstimated / totalActual : 1;

    // Quality: inverse of bugs created
    const allBugs = await this.engine.queryByType(DevelopmentNodeType.BUG);
    const bugs = allBugs.filter(b => b.metadata.assignee === assignee);
    const quality = 1 / (bugs.length + 1);

    // Workload: current tasks in progress
    const inProgress = tasks.filter(
      (t) => (t as TaskNode).payload.status === TaskStatus.IN_PROGRESS
    );
    const workload = inProgress.length;

    return {
      assignee,
      tasksCompleted,
      averageCycleTime,
      productivity,
      quality,
      workload,
    };
  }

  // Quality metrics
  async getCodeQuality(): Promise<QualityMetrics> {
    const nodes = await this.engine.getAllNodes();

    let totalComplexity = 0;
    let complexityCount = 0;
    let totalCoverage = 0;
    let coverageCount = 0;
    let codeSmells = 0;
    let duplicateLines = 0;
    let totalLines = 0;

    for (const node of nodes) {
      if (node.metadata.complexity !== undefined) {
        totalComplexity += node.metadata.complexity;
        complexityCount++;
      }

      if (node.metadata.testCoverage !== undefined) {
        totalCoverage += node.metadata.testCoverage;
        coverageCount++;
      }

      codeSmells += node.metadata.codeSmells || 0;
      duplicateLines += node.metadata.duplicateLines || 0;
      totalLines += (node.metadata.linesAdded || 0);
    }

    const bugs = await this.engine.queryByType(DevelopmentNodeType.BUG);
    const features = await this.engine.queryByType(
      DevelopmentNodeType.FEATURE
    );

    const bugDensity = features.length > 0 ? bugs.length / features.length : 0;

    // If no nodes have any quality-related metadata, return 0
    const hasQualityData = complexityCount > 0 || coverageCount > 0 || codeSmells > 0 || bugs.length > 0 || features.length > 0;

    const codeQualityScore = !hasQualityData ? 0 : this.calculateCodeQualityScore({
      complexity: complexityCount > 0 ? totalComplexity / complexityCount : 0,
      coverage: coverageCount > 0 ? totalCoverage / coverageCount : 0,
      bugDensity,
      codeSmells,
    });

    const technicalDebtRatio = await this.calculateTechnicalDebtRatio();
    const codeChurn = await this.calculateCodeChurn();
    const duplicateCodePercentage = totalLines > 0
      ? (duplicateLines / totalLines) * 100
      : 0;

    return {
      codeQualityScore,
      testCoverage: coverageCount > 0 ? totalCoverage / coverageCount : 0,
      bugDensity,
      technicalDebtRatio,
      codeChurn,
      duplicateCodePercentage,
    };
  }

  async getTestMetrics(): Promise<TestMetrics> {
    const testNodes = await this.engine.queryByType(DevelopmentNodeType.TEST);

    let totalTests = testNodes.length;
    let passingTests = 0;
    let failingTests = 0;
    let skippedTests = 0;
    let totalCoverage = 0;
    let coverageCount = 0;
    let totalExecutionTime = 0;
    let executionCount = 0;

    for (const node of testNodes) {
      const status = node.metadata.status;
      if (status === TaskStatus.DONE) passingTests++;
      else if (status === TaskStatus.CANCELLED) failingTests++;
      else if (status === TaskStatus.BLOCKED) skippedTests++;

      if (node.metadata.testCoverage !== undefined) {
        totalCoverage += node.metadata.testCoverage;
        coverageCount++;
      }

      if (node.metadata.executionTime !== undefined) {
        totalExecutionTime += node.metadata.executionTime;
        executionCount++;
      }
    }

    return {
      totalTests,
      passingTests,
      failingTests,
      skippedTests,
      coverage: coverageCount > 0 ? totalCoverage / coverageCount : 0,
      averageExecutionTime:
        executionCount > 0 ? totalExecutionTime / executionCount : 0,
    };
  }

  async getTechnicalDebt(): Promise<TechDebtMetrics> {
    const todos = await this.engine.queryByType(DevelopmentNodeType.TODO);
    const refactors = await this.engine.queryByType(
      DevelopmentNodeType.REFACTOR
    );

    const debtByComponent = new Map<string, number>();
    let criticalIssues = 0;
    let estimatedEffort = 0;

    for (const todo of todos) {
      const taskNode = todo as TaskNode;
      const component = taskNode.payload.component || 'unknown';
      const effort = taskNode.payload.estimatedHours || 1;

      debtByComponent.set(
        component,
        (debtByComponent.get(component) || 0) + effort
      );

      estimatedEffort += effort;

      if (taskNode.payload.priority === Priority.CRITICAL) {
        criticalIssues++;
      }
    }

    for (const refactor of refactors) {
      const taskNode = refactor as TaskNode;
      if (taskNode.payload.status !== TaskStatus.DONE) {
        const component = taskNode.payload.component || 'unknown';
        const effort = taskNode.payload.estimatedHours || 8;

        debtByComponent.set(
          component,
          (debtByComponent.get(component) || 0) + effort
        );

        estimatedEffort += effort;
      }
    }

    const totalDebt = estimatedEffort;
    const debtRatio = await this.calculateTechnicalDebtRatio();

    return {
      totalDebt,
      debtByComponent: Object.fromEntries(debtByComponent),
      criticalIssues,
      estimatedEffort,
      debtRatio,
    };
  }

  // Helper methods
  private async calculateVelocity(since: Date): Promise<number> {
    const allTasks = await this.engine.getAllNodes();
    const completedTasks = allTasks.filter(node => {
      const taskNode = node as TaskNode;
      return taskNode.payload && taskNode.payload.status === TaskStatus.DONE;
    });

    let points = 0;
    for (const task of completedTasks) {
      const taskNode = task as TaskNode;
      if (
        taskNode.payload.completedDate &&
        new Date(taskNode.payload.completedDate) >= since
      ) {
        points += taskNode.payload.estimatedHours || 0;
      }
    }

    const days = Math.max(
      1,
      (new Date().getTime() - since.getTime()) / (1000 * 60 * 60 * 24)
    );

    return points / days;
  }

  private async calculateCycleTime(since: Date): Promise<number> {
    const allTasks = await this.engine.getAllNodes();
    const completedTasks = allTasks.filter(node => {
      const taskNode = node as TaskNode;
      return taskNode.payload && taskNode.payload.status === TaskStatus.DONE;
    });

    let totalTime = 0;
    let count = 0;

    for (const task of completedTasks) {
      const taskNode = task as TaskNode;
      if (
        taskNode.payload.startDate &&
        taskNode.payload.completedDate &&
        new Date(taskNode.payload.completedDate) >= since
      ) {
        const cycleTime =
          (new Date(taskNode.payload.completedDate).getTime() -
            new Date(taskNode.payload.startDate).getTime()) /
          (1000 * 60 * 60); // hours
        totalTime += cycleTime;
        count++;
      }
    }

    return count > 0 ? totalTime / count : 0;
  }

  private async calculateLeadTime(since: Date): Promise<number> {
    const allTasks = await this.engine.getAllNodes();
    const completedTasks = allTasks.filter(node => {
      const taskNode = node as TaskNode;
      return taskNode.payload && taskNode.payload.status === TaskStatus.DONE;
    });

    let totalTime = 0;
    let count = 0;

    for (const task of completedTasks) {
      const taskNode = task as TaskNode;
      if (
        taskNode.payload.completedDate &&
        new Date(taskNode.payload.completedDate) >= since
      ) {
        const leadTime =
          (new Date(taskNode.payload.completedDate).getTime() -
            taskNode.timestamp.getTime()) /
          (1000 * 60 * 60); // hours
        totalTime += leadTime;
        count++;
      }
    }

    return count > 0 ? totalTime / count : 0;
  }

  private async calculateThroughput(since: Date): Promise<number> {
    const allTasks = await this.engine.getAllNodes();
    const completedTasks = allTasks.filter(node => {
      const taskNode = node as TaskNode;
      return taskNode.payload && taskNode.payload.status === TaskStatus.DONE;
    });

    let count = 0;
    for (const task of completedTasks) {
      const taskNode = task as TaskNode;
      if (
        taskNode.payload.completedDate &&
        new Date(taskNode.payload.completedDate) >= since
      ) {
        count++;
      }
    }

    const days = Math.max(
      1,
      (new Date().getTime() - since.getTime()) / (1000 * 60 * 60 * 24)
    );

    return count / days;
  }

  private async calculateErrorRate(since: Date): Promise<number> {
    const errors = await this.engine.queryByType(DevelopmentNodeType.ERROR);
    const recentErrors = errors.filter((e) => e.timestamp >= since);

    const days = Math.max(
      1,
      (new Date().getTime() - since.getTime()) / (1000 * 60 * 60 * 24)
    );

    return recentErrors.length / days;
  }

  private async calculateBugFixTime(since: Date): Promise<number> {
    const bugs = await this.engine.queryByType(DevelopmentNodeType.BUG);
    const fixes = await this.engine.queryByType(DevelopmentNodeType.FIX);

    let totalTime = 0;
    let count = 0;

    for (const fix of fixes) {
      if (fix.timestamp >= since) {
        // Find corresponding bug
        const edges = await this.engine.getEdgesByTarget(fix.nodeId);
        for (const edge of edges) {
          if (edge.edgeType === DevelopmentEdgeType.FIXES) {
            const bug = bugs.find((b) => b.nodeId === edge.sourceNodeId);
            if (bug) {
              const fixTime =
                (fix.timestamp.getTime() - bug.timestamp.getTime()) /
                (1000 * 60 * 60); // hours
              totalTime += fixTime;
              count++;
            }
          }
        }
      }
    }

    return count > 0 ? totalTime / count : 0;
  }

  private async calculateDeploymentFrequency(since: Date): Promise<number> {
    const milestones = await this.engine.queryByType(
      DevelopmentNodeType.MILESTONE
    );
    const recentDeployments = milestones.filter(
      (m) => m.timestamp >= since && m.metadata.status === TaskStatus.DONE
    );

    const days = Math.max(
      1,
      (new Date().getTime() - since.getTime()) / (1000 * 60 * 60 * 24)
    );

    return recentDeployments.length / days;
  }

  private async getMetricValue(
    metric: string,
    date: Date
  ): Promise<number> {
    // Get all nodes up to this date
    const nodes = await this.engine.getAllNodes();
    const relevantNodes = nodes.filter((n) => n.timestamp <= date);

    switch (metric) {
      case 'velocity':
        return this.calculateVelocityAtDate(relevantNodes, date);
      case 'bugs':
        return relevantNodes.filter(
          (n) => n.nodeType === DevelopmentNodeType.BUG
        ).length;
      case 'coverage':
        return this.calculateCoverageAtDate(relevantNodes);
      default:
        return 0;
    }
  }

  private calculateVelocityAtDate(nodes: Node[], date: Date): number {
    const weekAgo = new Date(date.getTime() - 7 * 24 * 60 * 60 * 1000);
    const completedInWeek = nodes.filter((n) => {
      const task = n as TaskNode;
      return (
        task.payload?.status === TaskStatus.DONE &&
        task.payload?.completedDate &&
        new Date(task.payload.completedDate) >= weekAgo &&
        new Date(task.payload.completedDate) <= date
      );
    });

    return completedInWeek.reduce((sum, task) => {
      return sum + ((task as TaskNode).payload.estimatedHours || 0);
    }, 0);
  }

  private calculateCoverageAtDate(nodes: Node[]): number {
    const withCoverage = nodes.filter(
      (n) => n.metadata.testCoverage !== undefined
    );

    if (withCoverage.length === 0) return 0;

    return (
      withCoverage.reduce((sum, n) => sum + (n.metadata.testCoverage || 0), 0) /
      withCoverage.length
    );
  }

  private calculateTrend(values: number[]): 'up' | 'down' | 'stable' {
    if (values.length < 2) return 'stable';

    const firstHalf = values.slice(0, Math.floor(values.length / 2));
    const secondHalf = values.slice(Math.floor(values.length / 2));

    const firstAvg =
      firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const secondAvg =
      secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

    const change = (secondAvg - firstAvg) / firstAvg;

    if (change > 0.1) return 'up';
    if (change < -0.1) return 'down';
    return 'stable';
  }

  private predictFuture(values: number[], days: number): number[] {
    if (values.length < 3) return [];

    // Simple linear regression
    const n = values.length;
    const x = Array.from({ length: n }, (_, i) => i);
    const y = values;

    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
    const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    const predictions: number[] = [];
    for (let i = 0; i < days; i++) {
      const predictedValue = slope * (n + i) + intercept;
      predictions.push(Math.max(0, predictedValue));
    }

    return predictions;
  }

  private calculateCodeQualityScore(metrics: {
    complexity: number;
    coverage: number;
    bugDensity: number;
    codeSmells: number;
  }): number {
    // Weighted score calculation
    const complexityScore = Math.max(0, 100 - metrics.complexity * 5);
    const coverageScore = metrics.coverage;
    const bugScore = Math.max(0, 100 - metrics.bugDensity * 20);
    const smellScore = Math.max(0, 100 - metrics.codeSmells * 2);

    return (
      complexityScore * 0.25 +
      coverageScore * 0.35 +
      bugScore * 0.25 +
      smellScore * 0.15
    );
  }

  private async calculateTechnicalDebtRatio(): Promise<number> {
    const todos = await this.engine.queryByType(DevelopmentNodeType.TODO);
    const features = await this.engine.queryByType(
      DevelopmentNodeType.FEATURE
    );

    const todoHours = todos.reduce((sum, t) => {
      return sum + ((t as TaskNode).payload?.estimatedHours || 0);
    }, 0);

    const featureHours = features.reduce((sum, f) => {
      return sum + ((f as TaskNode).payload?.estimatedHours || 0);
    }, 0);

    return featureHours > 0 ? todoHours / featureHours : 0;
  }

  private async calculateCodeChurn(): Promise<number> {
    const lastMonth = new Date();
    lastMonth.setMonth(lastMonth.getMonth() - 1);

    const nodes = await this.engine.getAllNodes();
    const recentNodes = nodes.filter((n) => n.timestamp >= lastMonth);

    let totalAdded = 0;
    let totalRemoved = 0;

    for (const node of recentNodes) {
      totalAdded += node.metadata.linesAdded || 0;
      totalRemoved += node.metadata.linesRemoved || 0;
    }

    return totalAdded + totalRemoved;
  }

  async getMetricData(metric: string, period: any): Promise<any> {
    // This is a generic method to get metric data for any metric type
    const endDate = new Date();
    const startDate = new Date();

    // Parse period
    if (typeof period === 'number') {
      startDate.setDate(startDate.getDate() - period);
    } else if (period && period.from) {
      startDate.setTime(period.from);
    }

    // Get nodes in period
    const nodes = await this.engine.getAllNodes();
    const nodesInPeriod = nodes.filter(n =>
      n.timestamp >= startDate && n.timestamp <= endDate
    );

    // Calculate metric based on type
    switch (metric) {
      case 'velocity':
        return this.calculateVelocity(startDate);

      case 'cycleTime':
        return this.calculateCycleTime(startDate);

      case 'leadTime':
        return this.calculateLeadTime(startDate);

      case 'throughput':
        return this.calculateThroughput(startDate);

      case 'commits':
        return nodesInPeriod.filter(n => n.nodeType === DevelopmentNodeType.MODULE).length;

      case 'errors':
        return nodesInPeriod.filter(n => n.nodeType === DevelopmentNodeType.ERROR).length;

      default:
        return null;
    }
  }
}