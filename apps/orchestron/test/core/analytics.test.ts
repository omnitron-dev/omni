import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Analytics } from '../../src/core/analytics';
import {
  createTestContext,
  cleanupTestContext,
  createSampleTask,
  createSampleSprint,
  createSampleAnalyticsData,
  TestContext,
  mockDate,
  waitFor,
} from '../fixtures/test-helpers';
import {
  DevelopmentNodeType,
  TaskStatus,
  Priority,
  Author,
} from '../../src/core/types';

describe('Analytics', () => {
  let context: TestContext;
  let analytics: Analytics;

  beforeEach(async () => {
    context = await createTestContext();
    analytics = context.analytics;
  });

  afterEach(async () => {
    await cleanupTestContext(context);
  });

  describe('Basic Statistics', () => {
    beforeEach(async () => {
      await createSampleAnalyticsData(context);
    });

    it('should get comprehensive statistics', async () => {
      const stats = await analytics.getStats();

      expect(stats).toBeTruthy();
      expect(stats.totalTasks).toBeGreaterThanOrEqual(5);
      expect(stats.completedToday).toBeGreaterThanOrEqual(5);
      expect(stats.velocity).toBeGreaterThanOrEqual(0);
      expect(stats.cycleTime).toBeGreaterThanOrEqual(0);
      expect(stats.leadTime).toBeGreaterThanOrEqual(0);
      expect(stats.throughput).toBeGreaterThanOrEqual(0);
      expect(stats.codeMetrics).toBeTruthy();
      expect(stats.errorRate).toBeGreaterThanOrEqual(0);
      expect(stats.bugFixTime).toBeGreaterThanOrEqual(0);
      expect(stats.deploymentFrequency).toBeGreaterThanOrEqual(0);
    });

    it('should calculate code metrics correctly', async () => {
      // Add some nodes with code metrics
      await context.engine.commit({
        nodes: [
          {
            author: Author.HUMAN,
            parentIds: [],
            nodeType: DevelopmentNodeType.FEATURE,
            payload: { title: 'Feature with metrics' },
            metadata: {
              linesAdded: 150,
              linesRemoved: 50,
              filesModified: ['src/component.ts', 'src/utils.ts'],
              testCoverage: 0.85,
            },
          },
          {
            author: Author.HUMAN,
            parentIds: [],
            nodeType: DevelopmentNodeType.FEATURE,
            payload: { title: 'Another feature' },
            metadata: {
              linesAdded: 75,
              linesRemoved: 25,
              filesModified: ['src/service.ts'],
              testCoverage: 0.92,
            },
          },
        ],
        edges: [],
        message: 'Code metrics test data',
      });

      const stats = await analytics.getStats();

      expect(stats.codeMetrics.linesAdded).toBeGreaterThanOrEqual(225);
      expect(stats.codeMetrics.linesRemoved).toBeGreaterThanOrEqual(75);
      expect(stats.codeMetrics.filesChanged).toBeGreaterThanOrEqual(3);
      expect(stats.codeMetrics.testCoverage).toBeGreaterThan(0);
      expect(stats.codeMetrics.testCoverage).toBeLessThanOrEqual(1);
    });

    it('should handle empty statistics gracefully', async () => {
      // Clear existing data
      await context.storage.clear();
      await context.engine.ensureInitialized();

      const stats = await analytics.getStats();

      expect(stats.totalTasks).toBe(0);
      expect(stats.completedToday).toBe(0);
      expect(stats.velocity).toBe(0);
      expect(stats.cycleTime).toBe(0);
      expect(stats.leadTime).toBe(0);
      expect(stats.throughput).toBe(0);
      expect(stats.codeMetrics.linesAdded).toBe(0);
      expect(stats.codeMetrics.linesRemoved).toBe(0);
      expect(stats.codeMetrics.filesChanged).toBe(0);
    });
  });

  describe('Trend Analysis', () => {
    beforeEach(async () => {
      // Create data across multiple days
      const dates = [
        new Date('2024-01-10'),
        new Date('2024-01-11'),
        new Date('2024-01-12'),
        new Date('2024-01-13'),
        new Date('2024-01-14'),
      ];

      for (let i = 0; i < dates.length; i++) {
        const restoreDate = mockDate(dates[i]);
        try {
          // Create tasks with varying completion rates
          for (let j = 0; j < 3 + i; j++) {
            const task = await createSampleTask(context, {
              title: `Day ${i + 1} Task ${j + 1}`,
              estimatedHours: 5 + j,
              assignee: 'test-user',
            });

            if (j < 2 + i) { // Complete more tasks each day
              await context.taskManager.updateTaskStatus(task.nodeId, TaskStatus.IN_PROGRESS);
              await context.taskManager.updateTaskStatus(task.nodeId, TaskStatus.DONE);
            }
          }

          // Add some bugs
          if (i % 2 === 0) {
            await context.engine.commit({
              nodes: [{
                author: Author.SYSTEM,
                parentIds: [],
                nodeType: DevelopmentNodeType.BUG,
                payload: {
                  title: `Bug ${i + 1}`,
                  description: 'Test bug for trends',
                },
                metadata: { severity: 'MEDIUM' },
              }],
              edges: [],
              message: `Bug on day ${i + 1}`,
            });
          }
        } finally {
          restoreDate();
        }
      }
    });

    it('should calculate trends over time period', async () => {
      const trends = await analytics.getTrends('velocity', {
        from: new Date('2024-01-10'),
        to: new Date('2024-01-14'),
      });

      expect(trends.dates).toHaveLength(5);
      expect(trends.values).toHaveLength(5);
      expect(trends.trend).toMatch(/^(up|down|stable)$/);
      expect(trends.prediction).toBeTruthy();
      expect(trends.prediction!.length).toBeGreaterThan(0);
    });

    it('should predict future values', async () => {
      const trends = await analytics.getTrends('velocity', {
        from: new Date('2024-01-10'),
        to: new Date('2024-01-14'),
      });

      expect(trends.prediction).toBeTruthy();
      expect(trends.prediction!.length).toBe(7); // 7 days prediction
      expect(trends.prediction!.every(v => v >= 0)).toBe(true);
    });

    it('should detect upward trends', async () => {
      // Create clear upward trend
      const dates = [
        new Date('2024-01-10'),
        new Date('2024-01-11'),
        new Date('2024-01-12'),
      ];

      for (let i = 0; i < dates.length; i++) {
        const restoreDate = mockDate(dates[i]);
        try {
          // Create increasing number of completed tasks
          for (let j = 0; j < (i + 1) * 3; j++) {
            const task = await createSampleTask(context, {
              title: `Trend Task ${i}-${j}`,
              estimatedHours: 5,
            });
            await context.taskManager.updateTaskStatus(task.nodeId, TaskStatus.IN_PROGRESS);
            await context.taskManager.updateTaskStatus(task.nodeId, TaskStatus.DONE);
          }
        } finally {
          restoreDate();
        }
      }

      const trends = await analytics.getTrends('velocity', {
        from: new Date('2024-01-10'),
        to: new Date('2024-01-12'),
      });

      expect(trends.trend).toBe('up');
    });
  });

  describe('Prediction Capabilities', () => {
    it('should predict task completion', async () => {
      const fixedDate = new Date('2024-01-15T10:00:00Z');
      const restoreDate = mockDate(fixedDate);

      try {
        const task = await createSampleTask(context, {
          title: 'Prediction Task',
          estimatedHours: 20,
          assignee: 'test-user',
        });

        // Start task and make some progress
        await context.taskManager.updateTaskStatus(task.nodeId, TaskStatus.IN_PROGRESS);
        await context.taskManager.updateTaskProgress(task.nodeId, 25);
        await context.taskManager.logTime(task.nodeId, 5); // 5 hours for 25% = 20% velocity

        const prediction = await analytics.predictCompletion(task.nodeId);

        expect(prediction).toBeTruthy();
        expect(prediction instanceof Date).toBe(true);
        expect(prediction!.getTime()).toBeGreaterThan(fixedDate.getTime());
      } finally {
        restoreDate();
      }
    });

    it('should return null for completed tasks', async () => {
      const task = await createSampleTask(context);
      await context.taskManager.updateTaskStatus(task.nodeId, TaskStatus.IN_PROGRESS);
      await context.taskManager.updateTaskStatus(task.nodeId, TaskStatus.DONE);

      const prediction = await analytics.predictCompletion(task.nodeId);

      expect(prediction).toBeNull();
    });

    it('should return null for tasks with no progress', async () => {
      const task = await createSampleTask(context);

      const prediction = await analytics.predictCompletion(task.nodeId);

      expect(prediction).toBeNull();
    });

    it('should handle non-existent tasks', async () => {
      const prediction = await analytics.predictCompletion('non-existent-task');

      expect(prediction).toBeNull();
    });

    it('should skip weekends in predictions', async () => {
      const friday = new Date('2024-01-19T10:00:00Z'); // Friday
      const restoreDate = mockDate(friday);

      try {
        const task = await createSampleTask(context, {
          title: 'Weekend Skip Task',
          estimatedHours: 12,
        });

        await context.taskManager.updateTaskStatus(task.nodeId, TaskStatus.IN_PROGRESS);
        await context.taskManager.updateTaskProgress(task.nodeId, 50);
        await context.taskManager.logTime(task.nodeId, 6);

        const prediction = await analytics.predictCompletion(task.nodeId);

        expect(prediction).toBeTruthy();
        // Should predict completion on Monday (skipping weekend)
        const dayOfWeek = prediction!.getDay();
        expect(dayOfWeek).not.toBe(0); // Not Sunday
        expect(dayOfWeek).not.toBe(6); // Not Saturday
      } finally {
        restoreDate();
      }
    });
  });

  describe('Bottleneck Identification', () => {
    beforeEach(async () => {
      // Create scenario with various bottlenecks
      const fixedDate = new Date('2024-01-15T10:00:00Z');
      const restoreDate = mockDate(fixedDate);

      try {
        // Long-running task (potential bottleneck)
        const longTask = await createSampleTask(context, {
          title: 'Long Running Task',
          assignee: 'slow-worker',
        });
        await context.taskManager.updateTaskStatus(longTask.nodeId, TaskStatus.IN_PROGRESS);

        // Mock start date to be 10 days ago
        const tenDaysAgo = new Date('2024-01-05T10:00:00Z');
        const restoreDateOld = mockDate(tenDaysAgo);
        try {
          const taskNode = await context.engine.getNode(longTask.nodeId);
          if (taskNode) {
            (taskNode as any).payload.startDate = tenDaysAgo;
            await context.storage.saveNode(taskNode);
          }
        } finally {
          restoreDateOld();
        }

        // Overloaded assignee
        for (let i = 0; i < 5; i++) {
          const task = await createSampleTask(context, {
            title: `Overload Task ${i + 1}`,
            assignee: 'overloaded-worker',
          });
          await context.taskManager.updateTaskStatus(task.nodeId, TaskStatus.IN_PROGRESS);
        }

        // Blocking task with many dependents
        const blockingTask = await createSampleTask(context, {
          title: 'Critical Blocking Task',
          priority: Priority.HIGH,
        });

        // Create multiple blocked tasks
        for (let i = 0; i < 4; i++) {
          const blockedTask = await createSampleTask(context, {
            title: `Blocked Task ${i + 1}`,
          });
          await context.taskManager.addDependency(blockedTask.nodeId, blockingTask.nodeId);
        }

        // High bug rate component
        for (let i = 0; i < 6; i++) {
          await context.engine.commit({
            nodes: [{
              author: Author.SYSTEM,
              parentIds: [],
              nodeType: DevelopmentNodeType.BUG,
              payload: {
                title: `Bug ${i + 1} in auth service`,
                component: 'auth-service',
              },
              metadata: {
                filesModified: ['src/auth/service.ts'],
                severity: 'HIGH',
              },
            }],
            edges: [],
            message: `Bug ${i + 1}`,
          });
        }
      } finally {
        restoreDate();
      }
    });

    it('should identify long-running task bottlenecks', async () => {
      const bottlenecks = await analytics.identifyBottlenecks();

      const longRunningBottleneck = bottlenecks.find(b =>
        b.type === 'long_running_task'
      );

      expect(longRunningBottleneck).toBeTruthy();
      expect(longRunningBottleneck!.severity).toMatch(/^(high|critical)$/);
      expect(longRunningBottleneck!.description).toContain('days');
      expect(longRunningBottleneck!.suggestion).toBeTruthy();
    });

    it('should identify critical dependency bottlenecks', async () => {
      const bottlenecks = await analytics.identifyBottlenecks();

      const dependencyBottleneck = bottlenecks.find(b =>
        b.type === 'critical_dependency'
      );

      expect(dependencyBottleneck).toBeTruthy();
      expect(dependencyBottleneck!.severity).toMatch(/^(high|critical)$/);
      expect(dependencyBottleneck!.description).toContain('Blocking');
      expect(dependencyBottleneck!.description).toContain('tasks');
    });

    it('should identify resource overload bottlenecks', async () => {
      const bottlenecks = await analytics.identifyBottlenecks();

      const overloadBottleneck = bottlenecks.find(b =>
        b.type === 'resource_overload'
      );

      expect(overloadBottleneck).toBeTruthy();
      expect(overloadBottleneck!.nodeId).toBe('overloaded-worker');
      expect(overloadBottleneck!.severity).toMatch(/^(medium|critical)$/);
      expect(overloadBottleneck!.description).toContain('tasks in progress');
    });

    it('should identify quality issue bottlenecks', async () => {
      const bottlenecks = await analytics.identifyBottlenecks();

      const qualityBottleneck = bottlenecks.find(b =>
        b.type === 'quality_issue'
      );

      expect(qualityBottleneck).toBeTruthy();
      expect(qualityBottleneck!.nodeId).toContain('auth');
      expect(qualityBottleneck!.description).toContain('bugs');
      expect(qualityBottleneck!.suggestion).toContain('coverage');
    });

    it('should return empty array when no bottlenecks exist', async () => {
      // Clear existing data
      await context.storage.clear();
      await context.engine.ensureInitialized();

      const bottlenecks = await analytics.identifyBottlenecks();

      expect(bottlenecks).toEqual([]);
    });
  });

  describe('Team Productivity Analysis', () => {
    beforeEach(async () => {
      // Create team productivity data
      const assignees = ['alice', 'bob', 'charlie'];
      const fixedDate = new Date('2024-01-15T10:00:00Z');
      const restoreDate = mockDate(fixedDate);

      try {
        for (const assignee of assignees) {
          // Create and complete tasks for each team member
          for (let i = 0; i < 3; i++) {
            const task = await createSampleTask(context, {
              title: `Task ${i + 1} for ${assignee}`,
              assignee,
              estimatedHours: 8,
            });

            await context.taskManager.updateTaskStatus(task.nodeId, TaskStatus.IN_PROGRESS);
            await context.taskManager.updateTaskStatus(task.nodeId, TaskStatus.DONE);

            // Add reviewers for collaboration metric
            if (i === 0) {
              const taskNode = await context.engine.getNode(task.nodeId);
              if (taskNode) {
                (taskNode as any).payload.reviewers = ['reviewer1', 'reviewer2'];
                await context.storage.saveNode(taskNode);
              }
            }
          }

          // Create some in-progress tasks
          const inProgressTask = await createSampleTask(context, {
            title: `In Progress for ${assignee}`,
            assignee,
          });
          await context.taskManager.updateTaskStatus(inProgressTask.nodeId, TaskStatus.IN_PROGRESS);
        }
      } finally {
        restoreDate();
      }
    });

    it('should calculate team productivity metrics', async () => {
      const teamMetrics = await analytics.getTeamProductivity();

      expect(teamMetrics.teamSize).toBe(3);
      expect(teamMetrics.velocity).toBeGreaterThan(0);
      expect(teamMetrics.throughput).toBeGreaterThan(0);
      expect(teamMetrics.efficiency).toBeGreaterThan(0);
      expect(teamMetrics.efficiency).toBeLessThanOrEqual(1);
      expect(teamMetrics.collaboration).toBeGreaterThanOrEqual(0);
      expect(teamMetrics.collaboration).toBeLessThanOrEqual(1);
    });

    it('should calculate individual metrics', async () => {
      const aliceMetrics = await analytics.getIndividualMetrics('alice');

      expect(aliceMetrics.assignee).toBe('alice');
      expect(aliceMetrics.tasksCompleted).toBeGreaterThan(0);
      expect(aliceMetrics.averageCycleTime).toBeGreaterThanOrEqual(0);
      expect(aliceMetrics.productivity).toBeGreaterThan(0);
      expect(aliceMetrics.quality).toBeGreaterThan(0);
      expect(aliceMetrics.quality).toBeLessThanOrEqual(1);
      expect(aliceMetrics.workload).toBeGreaterThanOrEqual(1); // Has in-progress task
    });

    it('should handle non-existent assignee', async () => {
      const metrics = await analytics.getIndividualMetrics('non-existent-user');

      expect(metrics.assignee).toBe('non-existent-user');
      expect(metrics.tasksCompleted).toBe(0);
      expect(metrics.averageCycleTime).toBe(0);
      expect(metrics.productivity).toBe(1); // Default when no data
      expect(metrics.quality).toBeGreaterThan(0); // 1/(0+1) = 1
      expect(metrics.workload).toBe(0);
    });
  });

  describe('Quality Metrics', () => {
    beforeEach(async () => {
      // Create nodes with quality-related metadata
      await context.engine.commit({
        nodes: [
          {
            author: Author.HUMAN,
            parentIds: [],
            nodeType: DevelopmentNodeType.FEATURE,
            payload: { title: 'High Quality Feature' },
            metadata: {
              complexity: 3,
              testCoverage: 0.95,
              codeSmells: 2,
              duplicateLines: 10,
              linesAdded: 200,
            },
          },
          {
            author: Author.HUMAN,
            parentIds: [],
            nodeType: DevelopmentNodeType.FEATURE,
            payload: { title: 'Medium Quality Feature' },
            metadata: {
              complexity: 7,
              testCoverage: 0.70,
              codeSmells: 8,
              duplicateLines: 25,
              linesAdded: 300,
            },
          },
          {
            author: Author.SYSTEM,
            parentIds: [],
            nodeType: DevelopmentNodeType.BUG,
            payload: { title: 'Quality Bug 1' },
            metadata: {},
          },
          {
            author: Author.SYSTEM,
            parentIds: [],
            nodeType: DevelopmentNodeType.BUG,
            payload: { title: 'Quality Bug 2' },
            metadata: {},
          },
        ],
        edges: [],
        message: 'Quality metrics test data',
      });
    });

    it('should calculate code quality metrics', async () => {
      const quality = await analytics.getCodeQuality();

      expect(quality.codeQualityScore).toBeGreaterThan(0);
      expect(quality.codeQualityScore).toBeLessThanOrEqual(100);
      expect(quality.testCoverage).toBeGreaterThan(0);
      expect(quality.testCoverage).toBeLessThanOrEqual(1);
      expect(quality.bugDensity).toBeGreaterThan(0);
      expect(quality.technicalDebtRatio).toBeGreaterThanOrEqual(0);
      expect(quality.codeChurn).toBeGreaterThanOrEqual(0);
      expect(quality.duplicateCodePercentage).toBeGreaterThanOrEqual(0);
      expect(quality.duplicateCodePercentage).toBeLessThanOrEqual(100);
    });

    it('should calculate test metrics', async () => {
      // Create test nodes
      await context.engine.commit({
        nodes: [
          {
            author: Author.HUMAN,
            parentIds: [],
            nodeType: DevelopmentNodeType.TEST,
            payload: { title: 'Passing Test 1' },
            metadata: {
              status: TaskStatus.DONE,
              testCoverage: 0.85,
              executionTime: 150,
            },
          },
          {
            author: Author.HUMAN,
            parentIds: [],
            nodeType: DevelopmentNodeType.TEST,
            payload: { title: 'Passing Test 2' },
            metadata: {
              status: TaskStatus.DONE,
              testCoverage: 0.90,
              executionTime: 200,
            },
          },
          {
            author: Author.HUMAN,
            parentIds: [],
            nodeType: DevelopmentNodeType.TEST,
            payload: { title: 'Failing Test' },
            metadata: {
              status: TaskStatus.CANCELLED,
              executionTime: 100,
            },
          },
        ],
        edges: [],
        message: 'Test metrics data',
      });

      const testMetrics = await analytics.getTestMetrics();

      expect(testMetrics.totalTests).toBe(3);
      expect(testMetrics.passingTests).toBe(2);
      expect(testMetrics.failingTests).toBe(1);
      expect(testMetrics.skippedTests).toBe(0);
      expect(testMetrics.coverage).toBeGreaterThan(0.80);
      expect(testMetrics.averageExecutionTime).toBeGreaterThan(100);
    });

    it('should calculate technical debt metrics', async () => {
      // Create TODO and refactor tasks
      const todo1 = await context.taskManager.addTodo('Fix memory leak', 'auth-service');
      const todo2 = await context.taskManager.addTodo('Update documentation', 'user-service');

      // Set estimated hours on TODOs
      const todoNode1 = await context.engine.getNode(todo1.nodeId);
      const todoNode2 = await context.engine.getNode(todo2.nodeId);

      if (todoNode1) {
        (todoNode1 as any).payload.estimatedHours = 4;
        (todoNode1 as any).payload.priority = Priority.CRITICAL;
        await context.storage.saveNode(todoNode1);
      }

      if (todoNode2) {
        (todoNode2 as any).payload.estimatedHours = 2;
        await context.storage.saveNode(todoNode2);
      }

      // Create refactor task
      await context.engine.commit({
        nodes: [{
          author: Author.HUMAN,
          parentIds: [],
          nodeType: DevelopmentNodeType.REFACTOR,
          payload: {
            title: 'Refactor legacy code',
            status: TaskStatus.TODO,
            component: 'legacy-module',
            estimatedHours: 16,
          },
          metadata: {},
        }],
        edges: [],
        message: 'Technical debt task',
      });

      const techDebt = await analytics.getTechnicalDebt();

      expect(techDebt.totalDebt).toBe(22); // 4 + 2 + 16
      expect(techDebt.estimatedEffort).toBe(22);
      expect(techDebt.criticalIssues).toBe(1);
      expect(techDebt.debtByComponent['auth-service']).toBe(4);
      expect(techDebt.debtByComponent['user-service']).toBe(2);
      expect(techDebt.debtByComponent['legacy-module']).toBe(16);
      expect(techDebt.debtRatio).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Metric Data Retrieval', () => {
    beforeEach(async () => {
      await createSampleAnalyticsData(context);
    });

    it('should get velocity metric data', async () => {
      const velocity = await analytics.getMetricData('velocity', 7);

      expect(velocity).toBeGreaterThanOrEqual(0);
    });

    it('should get cycle time metric data', async () => {
      const cycleTime = await analytics.getMetricData('cycleTime', 7);

      expect(cycleTime).toBeGreaterThanOrEqual(0);
    });

    it('should get lead time metric data', async () => {
      const leadTime = await analytics.getMetricData('leadTime', 7);

      expect(leadTime).toBeGreaterThanOrEqual(0);
    });

    it('should get throughput metric data', async () => {
      const throughput = await analytics.getMetricData('throughput', 7);

      expect(throughput).toBeGreaterThanOrEqual(0);
    });

    it('should get commits metric data', async () => {
      const commits = await analytics.getMetricData('commits', 7);

      expect(commits).toBeGreaterThanOrEqual(0);
    });

    it('should get errors metric data', async () => {
      const errors = await analytics.getMetricData('errors', 7);

      expect(errors).toBeGreaterThanOrEqual(1); // From sample data
    });

    it('should handle unknown metric', async () => {
      const result = await analytics.getMetricData('unknown-metric', 7);

      expect(result).toBeNull();
    });

    it('should handle period object', async () => {
      const velocity = await analytics.getMetricData('velocity', {
        from: new Date('2024-01-01').getTime(),
      });

      expect(velocity).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle empty dataset gracefully', async () => {
      await context.storage.clear();
      await context.engine.ensureInitialized();

      const stats = await analytics.getStats();
      const bottlenecks = await analytics.identifyBottlenecks();
      const teamMetrics = await analytics.getTeamProductivity();

      expect(stats.totalTasks).toBe(0);
      expect(bottlenecks).toEqual([]);
      expect(teamMetrics.teamSize).toBe(0);
      expect(teamMetrics.velocity).toBe(0);
    });

    it('should handle trends with insufficient data', async () => {
      const trends = await analytics.getTrends('velocity', {
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
      });

      expect(trends.dates).toHaveLength(2);
      expect(trends.values).toHaveLength(2);
      expect(trends.trend).toBe('stable'); // Insufficient data for trend
    });

    it('should handle prediction with invalid progress data', async () => {
      const task = await createSampleTask(context, {
        title: 'Invalid Progress Task',
        estimatedHours: 0, // Zero estimated hours
      });

      await context.taskManager.updateTaskProgress(task.nodeId, 50);

      const prediction = await analytics.predictCompletion(task.nodeId);

      expect(prediction).toBeTruthy(); // Should still provide prediction
    });

    it('should handle quality metrics with missing data', async () => {
      await context.storage.clear();
      await context.engine.ensureInitialized();

      const quality = await analytics.getCodeQuality();

      expect(quality.codeQualityScore).toBe(0);
      expect(quality.testCoverage).toBe(0);
      expect(quality.bugDensity).toBe(0);
      expect(quality.duplicateCodePercentage).toBe(0);
    });

    it('should handle team metrics with no assignees', async () => {
      await context.storage.clear();
      await context.engine.ensureInitialized();

      const teamMetrics = await analytics.getTeamProductivity();

      expect(teamMetrics.teamSize).toBe(0);
      expect(teamMetrics.velocity).toBe(0);
      expect(teamMetrics.throughput).toBe(0);
      expect(teamMetrics.efficiency).toBe(0);
      expect(teamMetrics.collaboration).toBe(0);
    });
  });

  describe('Performance Considerations', () => {
    it('should handle large datasets efficiently', async () => {
      // Create a large dataset
      const nodes = Array.from({ length: 100 }, (_, i) => ({
        author: Author.HUMAN,
        parentIds: [],
        nodeType: DevelopmentNodeType.TASK,
        payload: { title: `Bulk Task ${i + 1}` },
        metadata: {
          status: i % 2 === 0 ? TaskStatus.DONE : TaskStatus.TODO,
          estimatedHours: 5 + (i % 10),
          assignee: `user-${i % 5}`,
        },
      }));

      await context.engine.commit({
        nodes,
        edges: [],
        message: 'Bulk data for performance test',
      });

      const start = performance.now();
      const stats = await analytics.getStats();
      const elapsed = performance.now() - start;

      expect(stats.totalTasks).toBeGreaterThanOrEqual(100);
      expect(elapsed).toBeLessThan(2000); // Should complete within 2 seconds
    });

    it('should handle bottleneck analysis efficiently', async () => {
      // Create many tasks for bottleneck analysis
      for (let i = 0; i < 50; i++) {
        await createSampleTask(context, {
          title: `Performance Task ${i + 1}`,
          assignee: `user-${i % 3}`, // 3 users
        });
      }

      const start = performance.now();
      const bottlenecks = await analytics.identifyBottlenecks();
      const elapsed = performance.now() - start;

      expect(Array.isArray(bottlenecks)).toBe(true);
      expect(elapsed).toBeLessThan(3000); // Should complete within 3 seconds
    });
  });
});