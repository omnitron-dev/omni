import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createTestContext,
  cleanupTestContext,
  createSampleTask,
  createSampleSprint,
  createSprintWithTasks,
  createTaskWithDependencies,
  TestContext,
  mockDate,
  assertEventEmitted,
  waitFor,
  PerformanceTimer,
} from '../fixtures/test-helpers.js';
import {
  DevelopmentNodeType,
  TaskStatus,
  Priority,
  Author,
  MergeStrategy,
} from '../../src/core/types.js';

describe('Orchestron Phase 1 Integration Tests', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await cleanupTestContext(context);
  });

  describe('Complete Task Lifecycle', () => {
    it('should handle full task lifecycle from creation to completion', async () => {
      const timer = new PerformanceTimer();
      timer.startTimer();

      // 1. Create a task
      timer.mark('task-creation-start');
      const task = await context.unifiedOrchestron.createTask({
        title: 'Complete Integration Task',
        description: 'Test complete task workflow',
        priority: Priority.HIGH,
        assignee: 'integration-user',
        estimatedHours: 16,
        labels: ['integration', 'testing'],
        component: 'task-engine',
      });
      timer.mark('task-creation-end');

      expect(task.nodeId).toBeTruthy();
      expect(task.payload.status).toBe(TaskStatus.TODO);

      // 2. Start working on task
      await context.unifiedOrchestron.updateTaskStatus(task.nodeId, TaskStatus.IN_PROGRESS);
      await context.unifiedOrchestron.startTimer(task.nodeId, 'integration-user');

      // 3. Make progress with checkpoints
      await context.unifiedOrchestron.updateTaskProgress(task.nodeId, 25, 'Initial analysis complete');
      await context.unifiedOrchestron.updateTaskProgress(task.nodeId, 50, 'Core implementation done');
      await context.unifiedOrchestron.updateTaskProgress(task.nodeId, 75, 'Testing phase complete');

      // 4. Log some time
      await context.unifiedOrchestron.stopTimer(task.nodeId);
      await context.taskManager.logTime(task.nodeId, 8); // Additional time

      // 5. Move to review
      await context.unifiedOrchestron.updateTaskStatus(task.nodeId, TaskStatus.IN_REVIEW);

      // 6. Complete the task
      await context.unifiedOrchestron.updateTaskProgress(task.nodeId, 100, 'Final review passed');
      await context.unifiedOrchestron.updateTaskStatus(task.nodeId, TaskStatus.DONE);

      timer.mark('task-lifecycle-complete');

      // Verify final state
      const recentNodes = await context.engine.getRecentNodes(20);
      const finalTask = recentNodes.find(n =>
        n.nodeType === DevelopmentNodeType.TASK &&
        (n.payload as any)?.status === TaskStatus.DONE
      );

      expect(finalTask).toBeTruthy();
      expect((finalTask as any).payload?.progress).toBe(100);
      expect((finalTask as any).payload?.checkpoints).toHaveLength(4);

      // Performance check
      const totalTime = timer.getElapsed();
      expect(totalTime).toBeLessThan(10000); // Should complete in under 10 seconds
    });

    it('should handle task dependencies and blocking', async () => {
      // Create dependent tasks
      const { parentTask, childTask1, childTask2 } = await createTaskWithDependencies(context);

      // Initially, child tasks should be blocked
      const blockedTasks = await context.taskManager.getBlockedTasks();
      expect(blockedTasks.map(t => t.nodeId)).toContain(childTask1.nodeId);
      expect(blockedTasks.map(t => t.nodeId)).toContain(childTask2.nodeId);

      // Complete parent task
      await context.unifiedOrchestron.updateTaskStatus(parentTask.nodeId, TaskStatus.IN_PROGRESS);
      await context.unifiedOrchestron.updateTaskStatus(parentTask.nodeId, TaskStatus.DONE);

      // Child tasks should be unblocked automatically
      const recentNodes = await context.engine.getRecentNodes(20);
      const unblockedTasks = recentNodes.filter(n =>
        [childTask1.nodeId, childTask2.nodeId].includes(n.nodeId) ||
        n.parentIds.some(pid => [childTask1.nodeId, childTask2.nodeId].includes(pid))
      );

      expect(unblockedTasks.length).toBeGreaterThan(0);
    });

    it('should handle TODO to task conversion workflow', async () => {
      // Create TODO
      const todo = await context.unifiedOrchestron.addTodo('Implement authentication', 'auth-service');

      expect(todo.nodeType).toBe(DevelopmentNodeType.TODO);
      expect(todo.payload.priority).toBe(Priority.LOW);

      // Convert to task with more details
      const task = await context.unifiedOrchestron.convertTodoToTask(todo.nodeId, {
        title: 'Implement OAuth 2.0 Authentication',
        description: 'Complete implementation of OAuth 2.0 authentication flow',
        priority: Priority.HIGH,
        estimatedHours: 24,
        assignee: 'auth-specialist',
        labels: ['security', 'backend'],
      });

      expect(task.nodeType).toBe(DevelopmentNodeType.TASK);
      expect(task.payload.title).toBe('Implement OAuth 2.0 Authentication');
      expect(task.payload.priority).toBe(Priority.HIGH);
      expect(task.payload.estimatedHours).toBe(24);
      expect(task.parentIds).toContain(todo.nodeId);

      // Complete the converted task
      await context.unifiedOrchestron.updateTaskStatus(task.nodeId, TaskStatus.IN_PROGRESS);
      await context.unifiedOrchestron.updateTaskProgress(task.nodeId, 100);
      await context.unifiedOrchestron.updateTaskStatus(task.nodeId, TaskStatus.DONE);

      // Verify task completion
      const completedTask = await context.engine.getNode(task.nodeId);
      expect(completedTask).toBeTruthy();
    });
  });

  describe('Complete Sprint Workflow', () => {
    it('should handle full sprint lifecycle with tasks', async () => {
      const timer = new PerformanceTimer();
      timer.startTimer();

      // 1. Create sprint
      timer.mark('sprint-creation-start');
      const sprint = await context.unifiedOrchestron.createSprint({
        name: 'Integration Sprint 1',
        goal: 'Complete Phase 1 integration testing',
        startDate: new Date('2024-01-15'),
        duration: 14,
      });
      timer.mark('sprint-creation-end');

      // 2. Create tasks for the sprint
      const tasks = [];
      for (let i = 0; i < 5; i++) {
        const task = await context.unifiedOrchestron.createTask({
          title: `Sprint Task ${i + 1}`,
          description: `Task ${i + 1} for integration sprint`,
          priority: [Priority.HIGH, Priority.MEDIUM, Priority.LOW][i % 3] as Priority,
          estimatedHours: 8,
          assignee: `dev-${(i % 2) + 1}`,
          labels: ['sprint', 'integration'],
        });
        tasks.push(task);
      }

      // 3. Add tasks to sprint
      timer.mark('sprint-planning-start');
      for (const task of tasks) {
        await context.unifiedOrchestron.addToSprint(task.nodeId, sprint.nodeId);
      }
      timer.mark('sprint-planning-end');

      // 4. Estimate capacity
      await context.sprintManager.estimateCapacity(sprint.nodeId, 3); // 3 team members

      // 5. Start sprint
      await context.unifiedOrchestron.startSprint(sprint.nodeId);
      expect(context.unifiedOrchestron.getActiveSprint()).toBe(sprint.nodeId);

      // 6. Work on tasks during sprint
      timer.mark('sprint-execution-start');
      for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i];

        if (i < 3) {
          // Complete 3 tasks
          await context.unifiedOrchestron.updateTaskStatus(task.nodeId, TaskStatus.IN_PROGRESS);
          await context.unifiedOrchestron.updateTaskProgress(task.nodeId, 50, 'Halfway done');
          await context.unifiedOrchestron.updateTaskProgress(task.nodeId, 100, 'Complete');
          await context.unifiedOrchestron.updateTaskStatus(task.nodeId, TaskStatus.DONE);
        } else if (i === 3) {
          // One task in progress
          await context.unifiedOrchestron.updateTaskStatus(task.nodeId, TaskStatus.IN_PROGRESS);
          await context.unifiedOrchestron.updateTaskProgress(task.nodeId, 60, 'Making progress');
        }
        // One task remains in TODO
      }
      timer.mark('sprint-execution-end');

      // 7. Update burndown during sprint
      await context.sprintManager.updateBurndown(sprint.nodeId);

      // 8. End sprint
      timer.mark('sprint-end-start');
      await context.unifiedOrchestron.endSprint(sprint.nodeId);
      timer.mark('sprint-end-end');

      expect(context.unifiedOrchestron.getActiveSprint()).toBeNull();

      // 9. Get sprint report
      const report = await context.sprintManager.getSprintReport(sprint.nodeId);

      expect(report.completedTasks.length).toBe(3);
      expect(report.incompleteTasks.length).toBe(2);
      expect(report.velocity).toBeGreaterThan(0);
      expect(report.completionRate).toBe(0.6); // 3/5 = 60%

      // 10. Generate velocity chart
      const velocityChart = await context.unifiedOrchestron.getVelocityChart(1);
      expect(velocityChart.labels).toHaveLength(1);
      expect(velocityChart.datasets).toHaveLength(2);

      // Performance check
      const totalTime = timer.getElapsed();
      expect(totalTime).toBeLessThan(15000); // Should complete in under 15 seconds

      // Mark completion
      timer.mark('integration-complete');
      const marks = timer.getAllMarks();

      // Log performance metrics for analysis
      console.log('Sprint Integration Performance:', marks);
    });

    it('should handle sprint with dependencies and critical path', async () => {
      const sprint = await context.unifiedOrchestron.createSprint({
        name: 'Dependency Sprint',
        goal: 'Test dependency handling in sprints',
        startDate: new Date(),
        duration: 14,
      });

      // Create tasks with dependencies
      const setupTask = await context.unifiedOrchestron.createTask({
        title: 'Environment Setup',
        estimatedHours: 4,
        priority: Priority.HIGH,
      });

      const coreTask = await context.unifiedOrchestron.createTask({
        title: 'Core Development',
        estimatedHours: 16,
        priority: Priority.HIGH,
      });

      const testTask = await context.unifiedOrchestron.createTask({
        title: 'Testing',
        estimatedHours: 8,
        priority: Priority.MEDIUM,
      });

      const deployTask = await context.unifiedOrchestron.createTask({
        title: 'Deployment',
        estimatedHours: 4,
        priority: Priority.MEDIUM,
      });

      // Create dependency chain: setup -> core -> test -> deploy
      await context.unifiedOrchestron.addDependency(coreTask.nodeId, setupTask.nodeId);
      await context.unifiedOrchestron.addDependency(testTask.nodeId, coreTask.nodeId);
      await context.unifiedOrchestron.addDependency(deployTask.nodeId, testTask.nodeId);

      // Add tasks to sprint
      const allTasks = [setupTask, coreTask, testTask, deployTask];
      for (const task of allTasks) {
        await context.unifiedOrchestron.addToSprint(task.nodeId, sprint.nodeId);
      }

      await context.unifiedOrchestron.startSprint(sprint.nodeId);

      // Calculate critical path
      const criticalPath = await context.taskManager.getCriticalPath(setupTask.nodeId);
      expect(criticalPath).toBeTruthy();
      expect(criticalPath.length).toBeGreaterThan(1);

      // Work through the dependency chain
      await context.unifiedOrchestron.updateTaskStatus(setupTask.nodeId, TaskStatus.IN_PROGRESS);
      await context.unifiedOrchestron.updateTaskStatus(setupTask.nodeId, TaskStatus.DONE);

      // Core task should now be unblocked
      await context.unifiedOrchestron.updateTaskStatus(coreTask.nodeId, TaskStatus.IN_PROGRESS);
      await context.unifiedOrchestron.updateTaskStatus(coreTask.nodeId, TaskStatus.DONE);

      // Continue the chain
      await context.unifiedOrchestron.updateTaskStatus(testTask.nodeId, TaskStatus.IN_PROGRESS);
      await context.unifiedOrchestron.updateTaskStatus(testTask.nodeId, TaskStatus.DONE);

      await context.unifiedOrchestron.updateTaskStatus(deployTask.nodeId, TaskStatus.IN_PROGRESS);
      await context.unifiedOrchestron.updateTaskStatus(deployTask.nodeId, TaskStatus.DONE);

      await context.unifiedOrchestron.endSprint(sprint.nodeId);

      const report = await context.sprintManager.getSprintReport(sprint.nodeId);
      expect(report.completedTasks.length).toBe(4);
      expect(report.completionRate).toBe(1.0); // 100% completion
    });
  });

  describe('Analytics and Reporting Integration', () => {
    beforeEach(async () => {
      // Create comprehensive test data for analytics
      const fixedDate = new Date('2024-01-15T10:00:00Z');
      const restoreDate = mockDate(fixedDate);

      try {
        // Create multiple sprints with varying success rates
        for (let s = 0; s < 3; s++) {
          const sprint = await context.unifiedOrchestron.createSprint({
            name: `Analytics Sprint ${s + 1}`,
            goal: `Sprint ${s + 1} for analytics testing`,
            startDate: new Date(`2024-01-${(s + 1) * 5}`),
            duration: 14,
          });

          // Create tasks for each sprint
          for (let t = 0; t < 4; t++) {
            const task = await context.unifiedOrchestron.createTask({
              title: `Sprint ${s + 1} Task ${t + 1}`,
              priority: [Priority.HIGH, Priority.MEDIUM, Priority.LOW][t % 3] as Priority,
              assignee: `dev-${(t % 3) + 1}`,
              estimatedHours: 8,
              component: ['frontend', 'backend', 'database'][t % 3],
            });

            await context.unifiedOrchestron.addToSprint(task.nodeId, sprint.nodeId);

            // Complete some tasks (varying completion rates)
            if (t < 2 + s) {
              await context.unifiedOrchestron.updateTaskStatus(task.nodeId, TaskStatus.IN_PROGRESS);
              await context.unifiedOrchestron.updateTaskStatus(task.nodeId, TaskStatus.DONE);
            } else if (t === 2 + s) {
              await context.unifiedOrchestron.updateTaskStatus(task.nodeId, TaskStatus.IN_PROGRESS);
            }
          }

          if (s < 2) {
            await context.unifiedOrchestron.startSprint(sprint.nodeId);
            await context.unifiedOrchestron.endSprint(sprint.nodeId);
          }
        }

        // Create some bugs and errors for quality metrics
        for (let i = 0; i < 5; i++) {
          await context.engine.commit({
            nodes: [{
              author: Author.SYSTEM,
              parentIds: [],
              nodeType: DevelopmentNodeType.BUG,
              payload: {
                title: `Bug ${i + 1}`,
                description: 'Test bug for analytics',
                severity: ['HIGH', 'MEDIUM', 'LOW'][i % 3],
                component: ['frontend', 'backend'][i % 2],
              },
              metadata: {
                filesModified: [`src/${['frontend', 'backend'][i % 2]}/bug${i + 1}.ts`],
              },
            }],
            edges: [],
            message: `Bug ${i + 1}`,
          });
        }

        // Create code commits with metrics
        await context.engine.commitCode({
          type: DevelopmentNodeType.FEATURE,
          files: [{
            path: 'src/analytics/feature.ts',
            action: 'create',
            diff: '+100 lines of new code',
          }],
          message: 'Add analytics feature',
          metrics: {
            linesAdded: 100,
            linesRemoved: 20,
            testCoverage: 0.85,
            complexity: 5,
          },
        });
      } finally {
        restoreDate();
      }
    });

    it('should provide comprehensive analytics across all components', async () => {
      const timer = new PerformanceTimer();
      timer.startTimer();

      // Create and complete some tasks today
      const todayTask1 = await context.unifiedOrchestron.createTask({
        title: 'Today Task 1',
        priority: Priority.HIGH,
      });
      await context.unifiedOrchestron.updateTaskStatus(todayTask1.nodeId, TaskStatus.IN_PROGRESS);
      await context.unifiedOrchestron.updateTaskStatus(todayTask1.nodeId, TaskStatus.DONE);

      const todayTask2 = await context.unifiedOrchestron.createTask({
        title: 'Today Task 2',
        priority: Priority.MEDIUM,
      });
      await context.unifiedOrchestron.updateTaskStatus(todayTask2.nodeId, TaskStatus.IN_PROGRESS);
      await context.unifiedOrchestron.updateTaskStatus(todayTask2.nodeId, TaskStatus.DONE);

      // Get overall statistics
      timer.mark('stats-start');
      const stats = await context.unifiedOrchestron.getStats();
      timer.mark('stats-end');

      expect(stats.totalTasks).toBeGreaterThanOrEqual(12); // 3 sprints * 4 tasks + 2 today
      expect(stats.completedToday).toBeGreaterThanOrEqual(2);
      expect(stats.velocity).toBeGreaterThanOrEqual(0);
      expect(stats.cycleTime).toBeGreaterThanOrEqual(0);
      expect(stats.throughput).toBeGreaterThanOrEqual(0);

      // Identify bottlenecks
      timer.mark('bottlenecks-start');
      const bottlenecks = await context.unifiedOrchestron.identifyBottlenecks();
      timer.mark('bottlenecks-end');

      expect(Array.isArray(bottlenecks)).toBe(true);

      // Get team productivity
      timer.mark('team-productivity-start');
      const teamMetrics = await context.analytics.getTeamProductivity();
      timer.mark('team-productivity-end');

      expect(teamMetrics.teamSize).toBeGreaterThan(0);
      expect(teamMetrics.velocity).toBeGreaterThanOrEqual(0);
      expect(teamMetrics.efficiency).toBeGreaterThanOrEqual(0);

      // Get individual metrics
      timer.mark('individual-metrics-start');
      const dev1Metrics = await context.analytics.getIndividualMetrics('dev-1');
      timer.mark('individual-metrics-end');

      expect(dev1Metrics.assignee).toBe('dev-1');
      expect(dev1Metrics.tasksCompleted).toBeGreaterThanOrEqual(0);

      // Get quality metrics
      timer.mark('quality-metrics-start');
      const qualityMetrics = await context.analytics.getCodeQuality();
      timer.mark('quality-metrics-end');

      expect(qualityMetrics.codeQualityScore).toBeGreaterThanOrEqual(0);
      expect(qualityMetrics.bugDensity).toBeGreaterThanOrEqual(0);

      // Get technical debt
      timer.mark('tech-debt-start');
      const techDebt = await context.analytics.getTechnicalDebt();
      timer.mark('tech-debt-end');

      expect(techDebt.totalDebt).toBeGreaterThanOrEqual(0);

      // Performance check
      const totalTime = timer.getElapsed();
      expect(totalTime).toBeLessThan(5000); // All analytics should complete in under 5 seconds

      const marks = timer.getAllMarks();
      console.log('Analytics Performance:', marks);
    });

    it('should generate comprehensive reports', async () => {
      const timer = new PerformanceTimer();
      timer.startTimer();

      // Generate JSON report
      timer.mark('json-report-start');
      const jsonReport = await context.unifiedOrchestron.generateReport('json');
      timer.mark('json-report-end');

      const parsedJson = JSON.parse(jsonReport);
      expect(parsedJson.stats).toBeTruthy();
      expect(parsedJson.tasks).toBeTruthy();
      expect(parsedJson.sprints).toBeTruthy();

      // Generate markdown report
      timer.mark('markdown-report-start');
      const markdownReport = await context.unifiedOrchestron.generateReport('markdown');
      timer.mark('markdown-report-end');

      expect(markdownReport).toContain('# Development Report');
      expect(markdownReport).toContain('Total Tasks:');
      expect(markdownReport).toContain('Velocity:');

      // Generate HTML report
      timer.mark('html-report-start');
      const htmlReport = await context.unifiedOrchestron.generateReport('html');
      timer.mark('html-report-end');

      expect(htmlReport).toContain('<html>');
      expect(htmlReport).toContain('Development Report');

      // Generate graph
      timer.mark('graph-start');
      const graph = await context.unifiedOrchestron.generateGraph();
      timer.mark('graph-end');

      expect(graph.nodes.length).toBeGreaterThan(0);
      expect(graph.edges.length).toBeGreaterThanOrEqual(0);

      // Generate timeline
      timer.mark('timeline-start');
      const timeline = await context.unifiedOrchestron.generateTimeline();
      timer.mark('timeline-end');

      expect(timeline.length).toBeGreaterThan(0);
      expect(timeline[0].timestamp).toBeInstanceOf(Date);

      // Performance check
      const totalTime = timer.getElapsed();
      expect(totalTime).toBeLessThan(3000); // All reports should generate in under 3 seconds

      const marks = timer.getAllMarks();
      console.log('Report Generation Performance:', marks);
    });
  });

  describe('Branch and Merge Workflows', () => {
    it('should handle feature branch workflow', async () => {
      const timer = new PerformanceTimer();
      timer.startTimer();

      // 1. Create feature branch
      timer.mark('branch-creation-start');
      const branchResponse = await context.engine.branch({
        name: 'feature/integration-test',
        description: 'Feature branch for integration testing',
      });
      timer.mark('branch-creation-end');

      expect(branchResponse.success).toBe(true);

      // 2. Switch to feature branch
      await context.engine.checkout('feature/integration-test');
      expect(context.engine.getCurrentBranch()).toBe('feature/integration-test');

      // 3. Create feature work
      timer.mark('feature-work-start');
      const featureTask = await context.unifiedOrchestron.createTask({
        title: 'Feature Branch Task',
        description: 'Task created on feature branch',
        priority: Priority.HIGH,
      });

      await context.engine.commitCode({
        type: DevelopmentNodeType.FEATURE,
        files: [{
          path: 'src/integration/feature.ts',
          action: 'create',
          content: 'export const integrationFeature = () => { /* implementation */ };',
        }],
        message: 'Add integration feature',
        metrics: {
          linesAdded: 50,
          testCoverage: 0.90,
        },
      });
      timer.mark('feature-work-end');

      // 4. Complete feature task
      await context.unifiedOrchestron.updateTaskStatus(featureTask.nodeId, TaskStatus.IN_PROGRESS);
      await context.unifiedOrchestron.updateTaskStatus(featureTask.nodeId, TaskStatus.DONE);

      // 5. Switch back to main
      await context.engine.checkout('main');
      expect(context.engine.getCurrentBranch()).toBe('main');

      // 6. Create some work on main (simulate parallel development)
      await context.engine.commitCode({
        type: DevelopmentNodeType.FEATURE,
        files: [{
          path: 'src/main/update.ts',
          action: 'modify',
          content: 'export const mainUpdate = () => { /* main update */ };',
        }],
        message: 'Update main branch',
      });

      // 7. Merge feature branch
      timer.mark('merge-start');
      const mergeResponse = await context.engine.merge({
        fromBranch: 'feature/integration-test',
        intoBranch: 'main',
        strategy: MergeStrategy.RECURSIVE,
        message: 'Merge feature/integration-test into main',
      });
      timer.mark('merge-end');

      expect(mergeResponse.success).toBe(true);
      expect(mergeResponse.mergeNodeId).toBeTruthy();

      // 8. Verify merge node
      const mergeNode = await context.engine.getNode(mergeResponse.mergeNodeId!);
      expect(mergeNode).toBeTruthy();
      expect(mergeNode!.nodeType).toBe(DevelopmentNodeType.INTEGRATION);
      expect(mergeNode!.parentIds).toHaveLength(2); // Two parents in recursive merge

      // Performance check
      const totalTime = timer.getElapsed();
      expect(totalTime).toBeLessThan(5000); // Branch workflow should complete in under 5 seconds

      const marks = timer.getAllMarks();
      console.log('Branch Workflow Performance:', marks);
    });

    it('should handle experiment workflow', async () => {
      // Create experiment
      const experiment = await context.engine.experiment(
        'performance-optimization',
        'Test if new caching strategy improves performance by 50%'
      );

      expect(experiment.success).toBe(true);
      expect(experiment.branch.name).toBe('experiment/performance-optimization');

      // Switch to experiment branch
      await context.engine.checkout('experiment/performance-optimization');

      // Create experimental work
      const experimentTask = await context.unifiedOrchestron.createTask({
        title: 'Implement Caching Strategy',
        description: 'Experimental caching implementation',
        priority: Priority.HIGH,
      });

      // Add benchmark data
      await context.engine.commit({
        nodes: [{
          author: Author.HUMAN,
          parentIds: [],
          nodeType: DevelopmentNodeType.BENCHMARK,
          payload: {
            operation: 'cache_performance',
            baseline: 1000,
            optimized: 1500,
            improvement: 50,
          },
          metadata: {
            throughput: 1500,
            performanceImprovement: 0.5,
          },
        }],
        edges: [],
        message: 'Add cache performance benchmark',
      });

      // Complete experiment
      await context.unifiedOrchestron.updateTaskStatus(experimentTask.nodeId, TaskStatus.IN_PROGRESS);
      await context.unifiedOrchestron.updateTaskStatus(experimentTask.nodeId, TaskStatus.DONE);

      // Merge successful experiment
      await context.engine.checkout('main');
      const mergeResponse = await context.engine.merge({
        fromBranch: 'experiment/performance-optimization',
        intoBranch: 'main',
        strategy: MergeStrategy.SQUASH,
        message: 'Adopt successful performance optimization experiment',
      });

      expect(mergeResponse.success).toBe(true);
    });
  });

  describe('Workflow Automation Integration', () => {
    it('should handle automated task assignment and notifications', async () => {
      // Define auto-assignment workflow
      const autoAssignWorkflow = {
        id: 'auto-assign-high-priority',
        name: 'Auto Assign High Priority Tasks',
        triggers: [{
          type: 'task_created' as const,
          config: {},
        }],
        actions: [{
          type: 'assign' as const,
          config: { assignee: 'senior-dev' },
        }],
        conditions: [{
          type: 'if' as const,
          expression: 'priority === "HIGH"',
        }],
        enabled: true,
      };

      await context.unifiedOrchestron.createWorkflow(autoAssignWorkflow);
      await context.unifiedOrchestron.enableWorkflow(autoAssignWorkflow.id);

      // Define notification workflow
      const notificationWorkflow = {
        id: 'completion-notification',
        name: 'Task Completion Notification',
        triggers: [{
          type: 'status_change' as const,
          config: { status: TaskStatus.DONE },
        }],
        actions: [{
          type: 'notify' as const,
          config: {
            message: 'Task completed successfully',
            recipients: ['manager', 'team-lead'],
          },
        }],
        enabled: true,
      };

      await context.unifiedOrchestron.createWorkflow(notificationWorkflow);
      await context.unifiedOrchestron.enableWorkflow(notificationWorkflow.id);

      // Test workflows
      const assignEventPromise = assertEventEmitted(context.unifiedOrchestron, 'task:assigned');
      const notificationEventPromise = assertEventEmitted(context.unifiedOrchestron, 'notification');

      // Create high priority task (should trigger auto-assignment)
      const highPriorityTask = await context.unifiedOrchestron.createTask({
        title: 'Critical Bug Fix',
        priority: Priority.HIGH,
        description: 'Fix critical production issue',
      });

      // Verify auto-assignment
      const assignEvent = await assignEventPromise;
      expect(assignEvent.taskId).toBe(highPriorityTask.nodeId);
      expect(assignEvent.assignee).toBe('senior-dev');

      // Complete task (should trigger notification)
      await context.unifiedOrchestron.updateTaskStatus(highPriorityTask.nodeId, TaskStatus.IN_PROGRESS);
      await context.unifiedOrchestron.updateTaskStatus(highPriorityTask.nodeId, TaskStatus.DONE);

      // Verify notification
      const notificationEvent = await notificationEventPromise;
      expect(notificationEvent.message).toBe('Task completed successfully');
      expect(notificationEvent.recipients).toEqual(['manager', 'team-lead']);

      // Test workflow listing
      const workflows = await context.unifiedOrchestron.listWorkflows();
      expect(workflows).toHaveLength(2);
      expect(workflows.every(w => w.enabled)).toBe(true);
    });
  });

  describe('Performance and Scalability', () => {
    it('should handle large datasets efficiently', async () => {
      const timer = new PerformanceTimer();
      timer.startTimer();

      // Create large dataset
      const TASK_COUNT = 100;
      const SPRINT_COUNT = 10;

      timer.mark('bulk-creation-start');

      // Create sprints
      const sprints = [];
      for (let s = 0; s < SPRINT_COUNT; s++) {
        const sprint = await context.unifiedOrchestron.createSprint({
          name: `Perf Sprint ${s + 1}`,
          goal: `Performance testing sprint ${s + 1}`,
          startDate: new Date(`2024-01-${s + 1}`),
          duration: 14,
        });
        sprints.push(sprint);
      }

      // Create tasks
      const tasks = [];
      for (let t = 0; t < TASK_COUNT; t++) {
        const task = await context.unifiedOrchestron.createTask({
          title: `Perf Task ${t + 1}`,
          priority: [Priority.HIGH, Priority.MEDIUM, Priority.LOW][t % 3] as Priority,
          assignee: `dev-${(t % 10) + 1}`,
          estimatedHours: 4 + (t % 8),
          component: ['frontend', 'backend', 'database', 'devops'][t % 4],
        });
        tasks.push(task);

        // Add tasks to sprints
        const sprintIndex = t % SPRINT_COUNT;
        await context.unifiedOrchestron.addToSprint(task.nodeId, sprints[sprintIndex].nodeId);
      }

      timer.mark('bulk-creation-end');

      // Bulk operations
      timer.mark('bulk-operations-start');

      // Complete half the tasks
      const tasksToComplete = tasks.slice(0, TASK_COUNT / 2);
      for (const task of tasksToComplete) {
        await context.unifiedOrchestron.updateTaskStatus(task.nodeId, TaskStatus.IN_PROGRESS);
        await context.unifiedOrchestron.updateTaskStatus(task.nodeId, TaskStatus.DONE);
      }

      timer.mark('bulk-operations-end');

      // Analytics on large dataset
      timer.mark('analytics-large-start');
      const stats = await context.unifiedOrchestron.getStats();
      const bottlenecks = await context.unifiedOrchestron.identifyBottlenecks();
      timer.mark('analytics-large-end');

      // Queries on large dataset
      timer.mark('queries-large-start');
      const allTasks = await context.engine.getAllNodes();
      const highPriorityTasks = await context.engine.queryByMetadata({ priority: Priority.HIGH });
      const recentNodes = await context.engine.getRecentNodes(50);
      timer.mark('queries-large-end');

      // Verify results
      expect(stats.totalTasks).toBeGreaterThanOrEqual(TASK_COUNT);
      expect(allTasks.length).toBeGreaterThanOrEqual(TASK_COUNT + SPRINT_COUNT);
      expect(highPriorityTasks.length).toBeGreaterThan(0);
      expect(recentNodes).toHaveLength(50);

      // Performance assertions
      const totalTime = timer.getElapsed();
      expect(totalTime).toBeLessThan(30000); // Should complete in under 30 seconds

      const marks = timer.getAllMarks();
      console.log('Performance Test Results:', marks);

      // Specific performance requirements
      const creationTime = marks['bulk-creation-end'] - marks['bulk-creation-start'];
      const operationsTime = marks['bulk-operations-end'] - marks['bulk-operations-start'];
      const analyticsTime = marks['analytics-large-end'] - marks['analytics-large-start'];
      const queriesTime = marks['queries-large-end'] - marks['queries-large-start'];

      expect(creationTime).toBeLessThan(20000); // Bulk creation under 20 seconds
      expect(operationsTime).toBeLessThan(15000); // Bulk operations under 15 seconds
      expect(analyticsTime).toBeLessThan(3000); // Analytics under 3 seconds
      expect(queriesTime).toBeLessThan(2000); // Queries under 2 seconds
    });

    it('should handle concurrent operations safely', async () => {
      const timer = new PerformanceTimer();
      timer.startTimer();

      // Create base sprint
      const sprint = await context.unifiedOrchestron.createSprint({
        name: 'Concurrent Sprint',
        goal: 'Test concurrent operations',
        startDate: new Date(),
        duration: 14,
      });

      await context.unifiedOrchestron.startSprint(sprint.nodeId);

      timer.mark('concurrent-start');

      // Simulate concurrent task creation and updates
      const promises = [];

      // Concurrent task creation
      for (let i = 0; i < 20; i++) {
        promises.push(
          context.unifiedOrchestron.createTask({
            title: `Concurrent Task ${i + 1}`,
            priority: Priority.MEDIUM,
            assignee: `user-${(i % 5) + 1}`,
          }).then(task => {
            // Chain task updates
            return context.unifiedOrchestron.addToSprint(task.nodeId, sprint.nodeId)
              .then(() => context.unifiedOrchestron.updateTaskStatus(task.nodeId, TaskStatus.IN_PROGRESS))
              .then(() => context.unifiedOrchestron.updateTaskProgress(task.nodeId, 50))
              .then(() => task);
          })
        );
      }

      // Concurrent analytics operations
      for (let i = 0; i < 5; i++) {
        promises.push(context.unifiedOrchestron.getStats());
        promises.push(context.unifiedOrchestron.identifyBottlenecks());
      }

      // Concurrent queries
      for (let i = 0; i < 10; i++) {
        promises.push(context.engine.getAllNodes());
        promises.push(context.engine.getRecentNodes(10));
      }

      // Wait for all concurrent operations
      const results = await Promise.all(promises);

      timer.mark('concurrent-end');

      // Verify all operations completed successfully
      const tasks = results.filter(r => r && r.nodeType === DevelopmentNodeType.TASK);
      const stats = results.filter(r => r && r.totalTasks !== undefined);
      const nodeArrays = results.filter(r => Array.isArray(r));

      expect(tasks.length).toBe(20);
      expect(stats.length).toBeGreaterThan(0);
      expect(nodeArrays.length).toBeGreaterThan(0);

      // Performance check
      const concurrentTime = timer.getMark('concurrent-end') - timer.getMark('concurrent-start');
      expect(concurrentTime).toBeLessThan(10000); // All concurrent operations under 10 seconds

      console.log(`Concurrent operations completed in ${concurrentTime}ms`);
    });
  });

  describe('Error Handling and Recovery', () => {
    it('should handle and recover from various error conditions', async () => {
      // Test non-existent resource operations
      await expect(
        context.unifiedOrchestron.updateTaskStatus('non-existent', TaskStatus.DONE)
      ).rejects.toThrow();

      await expect(
        context.unifiedOrchestron.addToSprint('non-existent-task', 'non-existent-sprint')
      ).rejects.toThrow();

      await expect(
        context.sprintManager.getSprintReport('non-existent-sprint')
      ).rejects.toThrow();

      // Test invalid state transitions
      const task = await context.unifiedOrchestron.createTask({
        title: 'Error Test Task',
        priority: Priority.MEDIUM,
      });

      await expect(
        context.unifiedOrchestron.updateTaskStatus(task.nodeId, TaskStatus.DONE) // Skip IN_PROGRESS
      ).rejects.toThrow('Invalid status transition');

      // Test system recovery after errors
      const validTask = await context.unifiedOrchestron.createTask({
        title: 'Recovery Test Task',
        priority: Priority.HIGH,
      });

      await context.unifiedOrchestron.updateTaskStatus(validTask.nodeId, TaskStatus.IN_PROGRESS);
      await context.unifiedOrchestron.updateTaskStatus(validTask.nodeId, TaskStatus.DONE);

      expect(validTask).toBeTruthy();

      // Test analytics with corrupted data
      const stats = await context.unifiedOrchestron.getStats();
      expect(stats.totalTasks).toBeGreaterThanOrEqual(2);
    });

    it('should maintain data consistency during errors', async () => {
      const initialNodeCount = (await context.engine.getAllNodes()).length;
      const initialEdgeCount = (await context.engine.getAllEdges()).length;

      // Attempt operations that should fail
      try {
        await context.engine.commit({
          nodes: [null as any], // Invalid node
          edges: [],
          message: 'Invalid commit',
        });
      } catch (error) {
        // Expected to fail
      }

      // Verify data consistency
      const finalNodeCount = (await context.engine.getAllNodes()).length;
      const finalEdgeCount = (await context.engine.getAllEdges()).length;

      expect(finalNodeCount).toBe(initialNodeCount); // No partial commits
      expect(finalEdgeCount).toBe(initialEdgeCount);

      // Verify system is still functional
      const validTask = await context.unifiedOrchestron.createTask({
        title: 'Consistency Test Task',
        priority: Priority.MEDIUM,
      });

      expect(validTask).toBeTruthy();
    });
  });

  describe('Complete System Integration', () => {
    it('should demonstrate end-to-end Orchestron workflow', async () => {
      const timer = new PerformanceTimer();
      timer.startTimer();

      console.log('Starting comprehensive CSP integration test...');

      // 1. Project Setup Phase
      timer.mark('setup-start');

      // Create project structure
      await context.engine.commitCode({
        type: DevelopmentNodeType.ARCHITECTURE,
        files: [
          { path: 'src/app.ts', action: 'create' },
          { path: 'src/components/index.ts', action: 'create' },
          { path: 'tests/app.test.ts', action: 'create' },
          { path: 'README.md', action: 'create' },
        ],
        message: 'Initialize project structure',
        metrics: { linesAdded: 100 },
      });

      // Create epic for the project
      const projectEpic = await context.unifiedOrchestron.createTask({
        type: DevelopmentNodeType.EPIC,
        title: 'Complete CSP Integration System',
        description: 'End-to-end integration of all CSP components',
        priority: Priority.CRITICAL,
        estimatedHours: 120,
      });

      timer.mark('setup-end');

      // 2. Sprint Planning Phase
      timer.mark('planning-start');

      const sprint1 = await context.unifiedOrchestron.createSprint({
        name: 'Integration Sprint 1',
        goal: 'Core system implementation',
        startDate: new Date('2024-01-15'),
        duration: 14,
      });

      const sprint2 = await context.unifiedOrchestron.createSprint({
        name: 'Integration Sprint 2',
        goal: 'Testing and optimization',
        startDate: new Date('2024-01-29'),
        duration: 14,
      });

      // Create comprehensive task breakdown
      const coreStories = [
        { title: 'User Authentication System', hours: 24, priority: Priority.HIGH },
        { title: 'Task Management Interface', hours: 32, priority: Priority.HIGH },
        { title: 'Sprint Dashboard', hours: 16, priority: Priority.MEDIUM },
        { title: 'Analytics Engine', hours: 20, priority: Priority.MEDIUM },
        { title: 'Reporting System', hours: 12, priority: Priority.LOW },
      ];

      const sprint1Tasks = [];
      const sprint2Tasks = [];

      for (let i = 0; i < coreStories.length; i++) {
        const story = coreStories[i];
        const task = await context.unifiedOrchestron.createTask({
          title: story.title,
          description: `Implementation of ${story.title.toLowerCase()}`,
          priority: story.priority,
          estimatedHours: story.hours,
          assignee: `dev-${(i % 3) + 1}`,
          parent: projectEpic.nodeId,
          component: ['auth', 'tasks', 'dashboard', 'analytics', 'reports'][i],
          labels: ['core', 'integration'],
        });

        if (i < 3) {
          sprint1Tasks.push(task);
          await context.unifiedOrchestron.addToSprint(task.nodeId, sprint1.nodeId);
        } else {
          sprint2Tasks.push(task);
          await context.unifiedOrchestron.addToSprint(task.nodeId, sprint2.nodeId);
        }
      }

      // Add dependencies
      await context.unifiedOrchestron.addDependency(sprint1Tasks[1].nodeId, sprint1Tasks[0].nodeId); // Tasks depend on Auth
      await context.unifiedOrchestron.addDependency(sprint1Tasks[2].nodeId, sprint1Tasks[1].nodeId); // Dashboard depends on Tasks

      timer.mark('planning-end');

      // 3. Sprint 1 Execution
      timer.mark('sprint1-start');

      await context.unifiedOrchestron.startSprint(sprint1.nodeId);

      // Simulate sprint work with realistic patterns
      for (let day = 0; day < 10; day++) {
        const dayDate = new Date(`2024-01-${15 + day}T09:00:00Z`);
        const restoreDate = mockDate(dayDate);

        try {
          // Daily standup simulation - update progress
          for (let i = 0; i < sprint1Tasks.length; i++) {
            const task = sprint1Tasks[i];
            // Adjust formula so all tasks reach 100% by day 9
            const currentProgress = Math.min(100, (day + 1) * 12 + (i * 10));

            if (currentProgress > 0 && currentProgress <= 100) {
              const taskNode = await context.engine.getNode(task.nodeId);
              const currentStatus = (taskNode as any)?.payload?.status || TaskStatus.TODO;

              if (currentStatus === TaskStatus.TODO && currentProgress > 0) {
                await context.unifiedOrchestron.updateTaskStatus(task.nodeId, TaskStatus.IN_PROGRESS);
              }

              await context.unifiedOrchestron.updateTaskProgress(
                task.nodeId,
                currentProgress,
                `Day ${day + 1} progress update`
              );

              if (currentProgress === 100 && currentStatus !== TaskStatus.DONE) {
                await context.unifiedOrchestron.updateTaskStatus(task.nodeId, TaskStatus.IN_REVIEW);
                await context.unifiedOrchestron.updateTaskStatus(task.nodeId, TaskStatus.DONE);
              }
            }
          }

          // Update burndown
          await context.sprintManager.updateBurndown(sprint1.nodeId);

          // Simulate code commits
          if (day % 2 === 0) {
            await context.engine.commitCode({
              type: DevelopmentNodeType.FEATURE,
              files: [{
                path: `src/features/day${day + 1}.ts`,
                action: 'create',
                diff: `+${20 + day * 5} lines added`,
              }],
              message: `Day ${day + 1} development work`,
              metrics: {
                linesAdded: 20 + day * 5,
                linesRemoved: day * 2,
                testCoverage: 0.7 + (day * 0.02),
              },
            });
          }
        } finally {
          restoreDate();
        }
      }

      await context.unifiedOrchestron.endSprint(sprint1.nodeId);
      const sprint1Report = await context.sprintManager.getSprintReport(sprint1.nodeId);

      timer.mark('sprint1-end');

      // 4. Sprint 2 Execution (Abbreviated)
      timer.mark('sprint2-start');

      await context.unifiedOrchestron.startSprint(sprint2.nodeId);

      // Complete sprint 2 tasks quickly for testing
      for (const task of sprint2Tasks) {
        await context.unifiedOrchestron.updateTaskStatus(task.nodeId, TaskStatus.IN_PROGRESS);
        await context.unifiedOrchestron.updateTaskProgress(task.nodeId, 100, 'Completed');
        await context.unifiedOrchestron.updateTaskStatus(task.nodeId, TaskStatus.DONE);
      }

      await context.unifiedOrchestron.endSprint(sprint2.nodeId);
      const sprint2Report = await context.sprintManager.getSprintReport(sprint2.nodeId);

      timer.mark('sprint2-end');

      // 5. Project Completion and Analysis
      timer.mark('analysis-start');

      // Complete the epic
      await context.unifiedOrchestron.updateTaskStatus(projectEpic.nodeId, TaskStatus.IN_PROGRESS);
      await context.unifiedOrchestron.updateTaskProgress(projectEpic.nodeId, 100, 'All stories completed');
      await context.unifiedOrchestron.updateTaskStatus(projectEpic.nodeId, TaskStatus.DONE);

      // Generate comprehensive analytics
      const finalStats = await context.unifiedOrchestron.getStats();
      const finalBottlenecks = await context.unifiedOrchestron.identifyBottlenecks();
      const teamProductivity = await context.analytics.getTeamProductivity();
      const qualityMetrics = await context.analytics.getCodeQuality();

      // Generate reports
      const jsonReport = await context.unifiedOrchestron.generateReport('json');
      const markdownReport = await context.unifiedOrchestron.generateReport('markdown');
      const dashboard = await context.unifiedOrchestron.generateDashboard();

      timer.mark('analysis-end');

      // 6. Verification and Assertions
      timer.mark('verification-start');

      // Verify project completion
      expect(sprint1Report.completionRate).toBeGreaterThan(0.8); // At least 80% completion
      expect(sprint2Report.completionRate).toBe(1.0); // 100% completion
      expect(finalStats.totalTasks).toBeGreaterThanOrEqual(6); // Epic + 5 stories

      // Verify analytics quality
      expect(teamProductivity.teamSize).toBe(3);
      expect(teamProductivity.velocity).toBeGreaterThan(0);
      expect(qualityMetrics.testCoverage).toBeGreaterThan(0.6);

      // Verify reports
      expect(jsonReport).toContain('stats');
      expect(markdownReport).toContain('Development Report');
      expect(dashboard.widgets).toHaveLength(4);

      // Verify timeline and graph
      const timeline = await context.unifiedOrchestron.generateTimeline();
      const graph = await context.unifiedOrchestron.generateGraph();

      expect(timeline.length).toBeGreaterThan(10);
      expect(graph.nodes.length).toBeGreaterThan(15);

      timer.mark('verification-end');

      // 7. Performance Summary
      const totalTime = timer.getElapsed();
      const marks = timer.getAllMarks();

      console.log('CSP Integration Test Performance Summary:');
      console.log(`Total execution time: ${totalTime}ms`);
      console.log('Phase breakdown:');
      console.log(`- Setup: ${marks['setup-end'] - marks['setup-start']}ms`);
      console.log(`- Planning: ${marks['planning-end'] - marks['planning-start']}ms`);
      console.log(`- Sprint 1: ${marks['sprint1-end'] - marks['sprint1-start']}ms`);
      console.log(`- Sprint 2: ${marks['sprint2-end'] - marks['sprint2-start']}ms`);
      console.log(`- Analysis: ${marks['analysis-end'] - marks['analysis-start']}ms`);
      console.log(`- Verification: ${marks['verification-end'] - marks['verification-start']}ms`);

      // Final performance assertion
      expect(totalTime).toBeLessThan(60000); // Complete integration under 60 seconds

      console.log('✅ CSP Phase 1 integration test completed successfully');
    });
  });
});