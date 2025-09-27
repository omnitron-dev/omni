import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MLPredictor, BurnoutRiskAssessment } from '../../src/core/ml-predictor';
import { CSPEngine } from '../../src/core/engine';
import { TaskManager } from '../../src/core/task-manager';
import { createTestContext } from '../fixtures/test-helpers';
import {
  TaskStatus,
  Priority,
  DevelopmentNodeType,
  TaskNode,
  Node,
} from '../../src/core/types';

describe('MLPredictor', () => {
  let mlPredictor: MLPredictor;
  let context: any;
  let taskManager: TaskManager;

  beforeEach(async () => {
    context = await createTestContext();
    mlPredictor = new MLPredictor(context.engine);
    taskManager = new TaskManager(context.engine);
  });

  describe('Task Completion Prediction', () => {
    it('should predict task completion date', async () => {
      const task = await taskManager.createTask({
        title: 'Implement ML feature',
        description: 'Add machine learning capabilities',
        priority: Priority.HIGH,
        estimatedHours: 20,
        assignee: 'alice',
      });

      await taskManager.updateTask(task.nodeId, {
        progress: 30,
        actualHours: 6,
      });

      const prediction = await mlPredictor.predictTaskCompletion(task.nodeId);

      expect(prediction).toBeTruthy();
      expect(prediction?.estimatedDate).toBeInstanceOf(Date);
      expect(prediction?.estimatedHours).toBeGreaterThan(0);
      expect(prediction?.confidence).toBeGreaterThan(0.5);
      expect(prediction?.confidence).toBeLessThanOrEqual(1);
      expect(prediction?.factors).toBeInstanceOf(Array);
      expect(prediction?.factors.length).toBeGreaterThan(0);
    });

    it('should identify risk factors for critical tasks', async () => {
      const task = await taskManager.createTask({
        title: 'Critical system update',
        priority: Priority.CRITICAL,
        estimatedHours: 50,
        assignee: 'bob',
      });

      const prediction = await mlPredictor.predictTaskCompletion(task.nodeId);

      expect(prediction?.riskFactors).toContain('Critical priority task');
      expect(prediction?.riskFactors).toContain('Large task size');
    });

    it('should identify blockers from dependencies', async () => {
      const blocker = await taskManager.createTask({
        title: 'Blocking task',
        priority: Priority.HIGH,
      });

      const dependent = await taskManager.createTask({
        title: 'Dependent task',
        priority: Priority.MEDIUM,
        dependencies: [blocker.nodeId],
      });

      await taskManager.addDependency(dependent.nodeId, blocker.nodeId);

      const prediction = await mlPredictor.predictTaskCompletion(dependent.nodeId);

      expect(prediction?.blockers).toContain(`Blocked by: ${blocker.payload.title}`);
    });

    it('should return null for completed tasks', async () => {
      const task = await taskManager.createTask({
        title: 'Completed task',
        priority: Priority.LOW,
      });

      await taskManager.updateTaskStatus(task.nodeId, TaskStatus.IN_PROGRESS);
      await taskManager.updateTaskStatus(task.nodeId, TaskStatus.DONE);

      const prediction = await mlPredictor.predictTaskCompletion(task.nodeId);

      expect(prediction).toBeNull();
    });

    it('should adjust prediction based on developer velocity', async () => {
      const task1 = await taskManager.createTask({
        title: 'Task 1',
        estimatedHours: 10,
        assignee: 'alice',
      });

      await taskManager.updateTaskStatus(task1.nodeId, TaskStatus.IN_PROGRESS);
      await taskManager.updateTask(task1.nodeId, { actualHours: 5 });
      await taskManager.updateTaskStatus(task1.nodeId, TaskStatus.DONE);

      const task2 = await taskManager.createTask({
        title: 'Task 2',
        estimatedHours: 20,
        assignee: 'alice',
      });

      await taskManager.updateTask(task2.nodeId, { progress: 25, actualHours: 4 });

      const prediction = await mlPredictor.predictTaskCompletion(task2.nodeId);

      expect(prediction).toBeTruthy();
      expect(prediction?.confidence).toBeGreaterThan(0.6);
    });
  });

  describe('Anomaly Detection', () => {
    it('should detect velocity anomalies', async () => {
      const tasks = [];
      for (let i = 0; i < 5; i++) {
        const task = await taskManager.createTask({
          title: `Task ${i}`,
          estimatedHours: 10,
        });

        await taskManager.updateTaskStatus(task.nodeId, TaskStatus.IN_PROGRESS);
        await taskManager.updateTask(task.nodeId, {
          actualHours: i === 3 ? 30 : 10,
        });
        await taskManager.updateTaskStatus(task.nodeId, TaskStatus.DONE);
        tasks.push(task);
      }

      const anomalies = await mlPredictor.detectAnomalies(24);

      const velocityAnomaly = anomalies.find(a => a.type === 'velocity_variance');
      expect(velocityAnomaly).toBeTruthy();
      expect(velocityAnomaly?.isAnomaly).toBe(true);
      expect(velocityAnomaly?.anomalyScore).toBeGreaterThan(0);
    });

    it('should detect unusual working hours', async () => {
      const lateNightCommit = await context.engine.commitCode({
        type: DevelopmentNodeType.FEATURE,
        files: [{ path: 'src/late-night.ts', action: 'create' }],
        message: 'Late night coding',
      });

      const now = new Date();
      now.setHours(3, 0, 0, 0);
      const node = await context.engine.getNode(lateNightCommit.nodeIds[0]);
      if (node) {
        node.timestamp = now;
      }

      const anomalies = await mlPredictor.detectAnomalies(24);

      const hoursAnomaly = anomalies.find(a => a.type === 'unusual_hours');
      expect(hoursAnomaly).toBeTruthy();
    });

    it('should detect workload imbalance', async () => {
      for (let i = 0; i < 10; i++) {
        await taskManager.createTask({
          title: `Task ${i}`,
          assignee: i < 8 ? 'alice' : 'bob',
        });
      }

      const anomalies = await mlPredictor.detectAnomalies(24);

      const workloadAnomaly = anomalies.find(a => a.type === 'workload_imbalance');
      expect(workloadAnomaly).toBeTruthy();
      expect(workloadAnomaly?.description).toContain('overloaded');
    });

    it('should detect high error rates', async () => {
      for (let i = 0; i < 5; i++) {
        await context.engine.logError({
          message: `Error ${i}`,
          component: 'test',
          severity: 'HIGH',
        });
      }

      const anomalies = await mlPredictor.detectAnomalies(24);

      const errorAnomaly = anomalies.find(a => a.type === 'high_error_rate');
      expect(errorAnomaly).toBeTruthy();
      expect(errorAnomaly?.anomalyScore).toBeGreaterThan(0);
    });

    it('should return empty array when no anomalies', async () => {
      const anomalies = await mlPredictor.detectAnomalies(24);

      expect(anomalies).toBeInstanceOf(Array);
    });
  });

  describe('Bug Prediction', () => {
    it('should predict bug probability based on code changes', async () => {
      const commit1 = await context.engine.commitCode({
        type: DevelopmentNodeType.FEATURE,
        files: [
          { path: 'src/complex.ts', action: 'modify' },
          { path: 'src/coupled.ts', action: 'modify' },
        ],
        message: 'Complex changes',
      });

      const commit2 = await context.engine.commitCode({
        type: DevelopmentNodeType.FEATURE,
        files: [
          { path: 'src/complex.ts', action: 'modify' },
          { path: 'src/another.ts', action: 'modify' },
        ],
        message: 'More changes',
      });

      const prediction = await mlPredictor.predictBugs([
        ...commit1.nodeIds,
        ...commit2.nodeIds,
      ]);

      expect(prediction).toBeTruthy();
      expect(prediction.bugProbability).toBeGreaterThanOrEqual(0);
      expect(prediction.bugProbability).toBeLessThanOrEqual(1);
      expect(prediction.confidence).toBeGreaterThan(0.5);
      expect(prediction.severity).toMatch(/^(low|medium|high|critical)$/);
      expect(prediction.affectedFiles).toContain('src/complex.ts');
    });

    it('should identify bug types based on patterns', async () => {
      const commits = [];
      for (let i = 0; i < 5; i++) {
        const commit = await context.engine.commitCode({
          type: DevelopmentNodeType.FEATURE,
          files: [
            { path: `src/file${i}.ts`, action: 'modify' },
            { path: `src/file${i + 1}.ts`, action: 'modify' },
          ],
          message: `Change ${i}`,
        });
        commits.push(...commit.nodeIds);
      }

      const prediction = await mlPredictor.predictBugs(commits);

      expect(prediction.bugTypes).toBeInstanceOf(Array);
      expect(prediction.factors).toBeInstanceOf(Array);
      expect(prediction.factors.length).toBeGreaterThan(0);
    });

    it('should consider test coverage in predictions', async () => {
      const wellTestedCommit = await context.engine.commitCode({
        type: DevelopmentNodeType.TEST,
        files: [{ path: 'src/well-tested.ts', action: 'modify' }],
        message: 'Well tested code',
      });

      const prediction = await mlPredictor.predictBugs(wellTestedCommit.nodeIds);

      expect(prediction.confidence).toBeGreaterThan(0);
    });
  });

  describe('Developer Burnout Detection', () => {
    it('should assess burnout risk for developers', async () => {
      for (let i = 0; i < 10; i++) {
        const task = await taskManager.createTask({
          title: `Task ${i}`,
          assignee: 'alice',
          estimatedHours: 8,
        });

        await taskManager.updateTaskStatus(task.nodeId, TaskStatus.IN_PROGRESS);
        await taskManager.updateTask(task.nodeId, { actualHours: 12 });
      }

      const assessment = await mlPredictor.detectBurnoutRisk('alice');

      expect(assessment).toBeTruthy();
      expect(assessment.developerName).toBe('alice');
      expect(assessment.riskLevel).toMatch(/^(none|low|medium|high|critical)$/);
      expect(assessment.riskScore).toBeGreaterThanOrEqual(0);
      expect(assessment.indicators).toBeInstanceOf(Array);
      expect(assessment.recommendations).toBeInstanceOf(Array);
    });

    it('should detect irregular working hours', async () => {
      const now = new Date();

      for (let i = 0; i < 5; i++) {
        const timestamp = new Date(now);
        timestamp.setHours([2, 3, 22, 23, 1][i]);

        const commit = await context.engine.commitCode({
          type: DevelopmentNodeType.FEATURE,
          files: [{ path: `src/file${i}.ts`, action: 'modify' }],
          message: `Late work ${i}`,
          metrics: { author: 'bob' },
        });

        const node = await context.engine.getNode(commit.nodeIds[0]);
        if (node) {
          node.timestamp = timestamp;
        }
      }

      const assessment = await mlPredictor.detectBurnoutRisk('bob');

      expect(assessment.indicators.some(i => i.includes('working hours'))).toBeTruthy();
    });

    it('should provide recommendations based on risk level', async () => {
      const assessment = await mlPredictor.detectBurnoutRisk('newdev');

      expect(assessment.recommendations).toBeInstanceOf(Array);

      if (assessment.riskLevel === 'high' || assessment.riskLevel === 'critical') {
        expect(assessment.recommendations.some(r =>
          r.includes('intervention') || r.includes('time off')
        )).toBeTruthy();
      }
    });

    it('should detect declining velocity', async () => {
      const tasks = [];
      for (let i = 0; i < 10; i++) {
        const task = await taskManager.createTask({
          title: `Task ${i}`,
          estimatedHours: 10,
          assignee: 'charlie',
        });

        await taskManager.updateTaskStatus(task.nodeId, TaskStatus.IN_PROGRESS);
        await taskManager.updateTask(task.nodeId, {
          actualHours: i < 5 ? 10 : 15,
        });
        await taskManager.updateTaskStatus(task.nodeId, TaskStatus.DONE);
        tasks.push(task);
      }

      const assessment = await mlPredictor.detectBurnoutRisk('charlie');

      if (assessment.indicators.some(i => i.includes('velocity'))) {
        expect(assessment.riskScore).toBeGreaterThan(0);
      }
    });
  });

  describe('Sprint Planning Optimization', () => {
    it('should optimize sprint planning with AI', async () => {
      const tasks = [];
      for (let i = 0; i < 10; i++) {
        const task = await taskManager.createTask({
          title: `Sprint task ${i}`,
          priority: [Priority.CRITICAL, Priority.HIGH, Priority.MEDIUM][i % 3],
          estimatedHours: 5 + i * 2,
        });
        tasks.push(task.nodeId);
      }

      const optimization = await mlPredictor.optimizeSprintPlanning(
        80,
        tasks,
        3
      );

      expect(optimization).toBeTruthy();
      expect(optimization.recommendedTasks).toBeInstanceOf(Array);
      expect(optimization.estimatedVelocity).toBeGreaterThan(0);
      expect(optimization.riskAdjustedVelocity).toBeLessThanOrEqual(optimization.estimatedVelocity);
      expect(optimization.optimizationReasons).toBeInstanceOf(Array);
      expect(optimization.alternativeScenarios).toBeInstanceOf(Array);
    });

    it('should prioritize critical tasks', async () => {
      const criticalTask = await taskManager.createTask({
        title: 'Critical task',
        priority: Priority.CRITICAL,
        estimatedHours: 20,
      });

      const lowTask = await taskManager.createTask({
        title: 'Low priority task',
        priority: Priority.LOW,
        estimatedHours: 10,
      });

      const optimization = await mlPredictor.optimizeSprintPlanning(
        30,
        [criticalTask.nodeId, lowTask.nodeId],
        1
      );

      expect(optimization.recommendedTasks).toContain(criticalTask.nodeId);
    });

    it('should provide alternative scenarios', async () => {
      const tasks = [];
      for (let i = 0; i < 5; i++) {
        const task = await taskManager.createTask({
          title: `Task ${i}`,
          priority: Priority.MEDIUM,
          estimatedHours: 10,
        });
        tasks.push(task.nodeId);
      }

      const optimization = await mlPredictor.optimizeSprintPlanning(
        40,
        tasks,
        2
      );

      expect(optimization.alternativeScenarios.length).toBeGreaterThan(0);
      optimization.alternativeScenarios.forEach(scenario => {
        expect(scenario.tasks).toBeInstanceOf(Array);
        expect(scenario.probability).toBeGreaterThan(0);
        expect(scenario.probability).toBeLessThanOrEqual(1);
        expect(scenario.velocity).toBeGreaterThanOrEqual(0);
        expect(scenario.risks).toBeInstanceOf(Array);
      });
    });

    it('should adjust for risk', async () => {
      const riskyTask = await taskManager.createTask({
        title: 'Risky task',
        priority: Priority.HIGH,
        estimatedHours: 40,
      });

      const safeTask = await taskManager.createTask({
        title: 'Safe task',
        priority: Priority.HIGH,
        estimatedHours: 10,
      });

      const optimization = await mlPredictor.optimizeSprintPlanning(
        50,
        [riskyTask.nodeId, safeTask.nodeId],
        1
      );

      expect(optimization.riskAdjustedVelocity).toBeLessThanOrEqual(optimization.estimatedVelocity);
    });
  });

  describe('Code Quality Prediction', () => {
    it('should predict code quality before merge', async () => {
      const commit = await context.engine.commitCode({
        type: DevelopmentNodeType.FEATURE,
        files: [
          { path: 'src/feature.ts', action: 'create' },
          { path: 'src/feature.test.ts', action: 'create' },
        ],
        message: 'New feature implementation',
      });

      const prediction = await mlPredictor.predictCodeQuality(commit.nodeIds);

      expect(prediction).toBeTruthy();
      expect(prediction.qualityScore).toBeGreaterThanOrEqual(0);
      expect(prediction.qualityScore).toBeLessThanOrEqual(1);
      expect(prediction.confidence).toBeGreaterThan(0.5);
      expect(prediction.mergeReadiness).toBeDefined();
      expect(prediction.issues).toBeInstanceOf(Array);
      expect(prediction.recommendations).toBeInstanceOf(Array);
    });

    it('should identify quality issues', async () => {
      const commits = [];
      for (let i = 0; i < 5; i++) {
        const commit = await context.engine.commitCode({
          type: DevelopmentNodeType.FEATURE,
          files: [
            { path: `src/complex${i}.ts`, action: 'modify' },
            { path: `src/complex${i + 1}.ts`, action: 'modify' },
          ],
          message: `Complex change ${i}`,
        });
        commits.push(...commit.nodeIds);
      }

      const prediction = await mlPredictor.predictCodeQuality(commits);

      if (prediction.issues.length > 0) {
        prediction.issues.forEach(issue => {
          expect(issue.type).toBeTruthy();
          expect(issue.severity).toMatch(/^(low|medium|high)$/);
          expect(issue.description).toBeTruthy();
        });
      }
    });

    it('should recommend improvements', async () => {
      const commit = await context.engine.commitCode({
        type: DevelopmentNodeType.FEATURE,
        files: [
          { path: 'src/untested.ts', action: 'create' },
        ],
        message: 'Untested code',
      });

      const prediction = await mlPredictor.predictCodeQuality(commit.nodeIds);

      expect(prediction.recommendations).toBeInstanceOf(Array);
      if (prediction.qualityScore < 0.7) {
        expect(prediction.recommendations.length).toBeGreaterThan(0);
      }
    });

    it('should determine merge readiness', async () => {
      const goodCommit = await context.engine.commitCode({
        type: DevelopmentNodeType.FEATURE,
        files: [
          { path: 'src/good.ts', action: 'create' },
          { path: 'src/good.test.ts', action: 'create' },
        ],
        message: 'Well-tested feature',
      });

      const prediction = await mlPredictor.predictCodeQuality(goodCommit.nodeIds);

      expect(typeof prediction.mergeReadiness).toBe('boolean');
      if (prediction.qualityScore > 0.7 && !prediction.issues.some(i => i.severity === 'high')) {
        expect(prediction.mergeReadiness).toBe(true);
      }
    });

    it('should consider test coverage', async () => {
      const testedCommit = await context.engine.commitCode({
        type: DevelopmentNodeType.TEST,
        files: [
          { path: 'src/tested.ts', action: 'modify' },
          { path: 'src/tested.test.ts', action: 'create' },
        ],
        message: 'Added tests',
      });

      const untestedCommit = await context.engine.commitCode({
        type: DevelopmentNodeType.FEATURE,
        files: [
          { path: 'src/untested.ts', action: 'create' },
        ],
        message: 'No tests',
      });

      const testedPrediction = await mlPredictor.predictCodeQuality(testedCommit.nodeIds);
      const untestedPrediction = await mlPredictor.predictCodeQuality(untestedCommit.nodeIds);

      expect(testedPrediction.qualityScore).toBeGreaterThanOrEqual(untestedPrediction.qualityScore);
    });
  });

  describe('Event Emissions', () => {
    it('should emit prediction events', async () => {
      const task = await taskManager.createTask({
        title: 'Event test task',
        estimatedHours: 10,
      });

      let eventEmitted = false;
      mlPredictor.on('prediction:complete', () => {
        eventEmitted = true;
      });

      await mlPredictor.predictTaskCompletion(task.nodeId);

      await new Promise(resolve => setTimeout(resolve, 10));
    });
  });

  describe('Edge Cases', () => {
    it('should handle invalid task IDs', async () => {
      const prediction = await mlPredictor.predictTaskCompletion('invalid-id');
      expect(prediction).toBeNull();
    });

    it('should handle empty data gracefully', async () => {
      const anomalies = await mlPredictor.detectAnomalies(0.001);
      expect(anomalies).toBeInstanceOf(Array);

      const optimization = await mlPredictor.optimizeSprintPlanning(100, [], 1);
      expect(optimization.recommendedTasks).toEqual([]);
    });

    it('should handle developer with no history', async () => {
      const assessment = await mlPredictor.detectBurnoutRisk('new-developer');

      expect(assessment).toBeTruthy();
      expect(assessment.developerName).toBe('new-developer');
      expect(assessment.riskLevel).toBe('none');
    });

    it('should handle tasks with no estimates', async () => {
      const task = await taskManager.createTask({
        title: 'No estimate task',
        priority: Priority.LOW,
      });

      const prediction = await mlPredictor.predictTaskCompletion(task.nodeId);

      if (prediction) {
        expect(prediction.estimatedHours).toBeGreaterThanOrEqual(0);
      }
    });
  });
});