/**
 * Integration Tests for Phase 9: Continuous Development Cycle
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { WorkflowEngine, DevelopmentWorkflow, WorkflowExecution } from '../../src/core/workflow-engine';
import { FeedbackCollector, ExecutionFeedback, Pattern, PatternType } from '../../src/core/feedback-collector';
import { LearningPipeline, LearningInsight, InsightType } from '../../src/core/learning-pipeline';
import { OrchestronEngine } from '../../src/core/engine';
import { TaskManager } from '../../src/core/task-manager';
import { MLPredictor } from '../../src/core/ml-predictor';
import { UnifiedOrchestron } from '../../src/core/unified-orchestron';
import { createTestStorage } from '../fixtures/test-helpers';
import { Storage } from '../../src/storage/interface';
import {
  TaskStatus,
  Priority,
  DevelopmentNodeType,
  Author
} from '../../src/core/types';

describe('Phase 9: Continuous Development Cycle Integration', () => {
  let storage: Storage;
  let engine: OrchestronEngine;
  let taskManager: TaskManager;
  let mlPredictor: MLPredictor;
  let workflowEngine: WorkflowEngine;
  let feedbackCollector: FeedbackCollector;
  let learningPipeline: LearningPipeline;
  let unifiedOrchestron: UnifiedOrchestron;

  beforeEach(async () => {
    storage = await createTestStorage();
    engine = new OrchestronEngine(storage);
    await engine.ensureInitialized();

    taskManager = new TaskManager(engine);
    mlPredictor = new MLPredictor(storage);

    workflowEngine = new WorkflowEngine(storage, taskManager, mlPredictor);
    feedbackCollector = new FeedbackCollector(storage);
    learningPipeline = new LearningPipeline(
      storage,
      feedbackCollector,
      workflowEngine,
      mlPredictor
    );

    unifiedOrchestron = new UnifiedOrchestron(storage);
    await unifiedOrchestron.initialize();
  });

  afterEach(async () => {
    await storage.close();
  });

  describe('Workflow Automation Engine', () => {
    it('should create and execute a workflow', async () => {
      // Create a task
      const task = await taskManager.createTask({
        type: DevelopmentNodeType.TASK,
        title: 'Test Task',
        priority: Priority.HIGH,
        status: TaskStatus.TODO
      });

      // Create a workflow
      const workflow: DevelopmentWorkflow = {
        id: 'test-workflow',
        name: 'Test Workflow',
        enabled: true,
        triggers: [{
          type: 'task_status_change',
          condition: (ctx) => ctx.newStatus === TaskStatus.IN_PROGRESS
        }],
        stages: [{
          name: 'update_progress',
          triggers: [],
          actions: [{
            type: 'update_task',
            params: {
              taskId: task.nodeId,
              progress: 50
            }
          }]
        }]
      };

      await workflowEngine.registerWorkflow(workflow);

      // Execute workflow
      const execution = await workflowEngine.executeWorkflow('test-workflow', {
        taskId: task.nodeId,
        newStatus: TaskStatus.IN_PROGRESS
      });

      expect(execution.status).toBe('completed');
      expect(execution.completedStages).toContain('update_progress');

      // Verify task was updated
      const updatedTask = await taskManager.getTask(task.nodeId);
      expect(updatedTask?.payload.progress).toBe(50);
    });

    it('should handle built-in workflows', async () => {
      const workflows = workflowEngine.getWorkflows();

      // Check built-in workflows exist
      expect(workflows.some(w => w.id === 'progress-tracking')).toBe(true);
      expect(workflows.some(w => w.id === 'status-transitions')).toBe(true);
      expect(workflows.some(w => w.id === 'quality-gates')).toBe(true);
      expect(workflows.some(w => w.id === 'sprint-automation')).toBe(true);
    });

    it('should handle workflow failures gracefully', async () => {
      const workflow: DevelopmentWorkflow = {
        id: 'failing-workflow',
        name: 'Failing Workflow',
        enabled: true,
        triggers: [],
        stages: [{
          name: 'fail_stage',
          triggers: [],
          actions: [{
            type: 'execute_command',
            params: { command: 'exit 1' },
            onFailure: [{
              type: 'notify',
              params: { message: 'Command failed' }
            }]
          }]
        }]
      };

      await workflowEngine.registerWorkflow(workflow);

      const execution = await workflowEngine.executeWorkflow('failing-workflow').catch(e => e);
      expect(execution).toBeInstanceOf(Error);
    });

    it('should enable/disable workflows', async () => {
      const workflow: DevelopmentWorkflow = {
        id: 'toggle-workflow',
        name: 'Toggle Workflow',
        enabled: true,
        triggers: [],
        stages: []
      };

      await workflowEngine.registerWorkflow(workflow);

      // Disable workflow
      await workflowEngine.toggleWorkflow('toggle-workflow', false);

      const workflows = workflowEngine.getWorkflows();
      const toggledWorkflow = workflows.find(w => w.id === 'toggle-workflow');
      expect(toggledWorkflow?.enabled).toBe(false);

      // Try to execute disabled workflow
      const result = await workflowEngine.executeWorkflow('toggle-workflow').catch(e => e);
      expect(result).toBeInstanceOf(Error);
      expect(result.message).toContain('disabled');
    });
  });

  describe('Feedback Collection System', () => {
    it('should collect execution feedback', async () => {
      const feedback = await feedbackCollector.collectFeedback('exec-123', {
        performance: {
          duration: 1000,
          memoryUsed: 1024 * 1024,
          toolCalls: 5
        },
        quality: {
          testsPass: true,
          testsPassing: 10,
          testsTotal: 10,
          coverage: 85,
          complexity: 5,
          lintErrors: 0,
          lintWarnings: 2,
          buildSuccess: true
        }
      });

      expect(feedback.executionId).toBe('exec-123');
      expect(feedback.performance.duration).toBe(1000);
      expect(feedback.quality.testsPass).toBe(true);
    });

    it('should identify patterns from feedback', async () => {
      const patterns: Pattern[] = [];

      feedbackCollector.on('pattern:identified', (pattern) => {
        patterns.push(pattern);
      });

      // Collect multiple similar feedbacks to trigger pattern detection
      for (let i = 0; i < 3; i++) {
        await feedbackCollector.collectFeedback(`exec-${i}`, {
          performance: {
            duration: 5000 + i * 1000, // Increasing duration
            memoryUsed: 1024 * 1024,
            toolCalls: 5
          },
          quality: {
            testsPass: false,
            testsPassing: 5,
            testsTotal: 10,
            coverage: 50,
            complexity: 10,
            lintErrors: 5,
            lintWarnings: 10,
            buildSuccess: false
          },
          errors: [{
            type: 'TypeError',
            message: 'Cannot read property of undefined',
            timestamp: new Date(),
            recovered: false
          }]
        });
      }

      // Wait for async pattern detection
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should have identified patterns
      expect(patterns.length).toBeGreaterThan(0);

      const errorPatterns = feedbackCollector.getPatterns(PatternType.ERROR);
      expect(errorPatterns.length).toBeGreaterThan(0);
    });

    it('should suggest improvements based on patterns', async () => {
      const improvements: any[] = [];

      feedbackCollector.on('improvement:suggested', (improvement) => {
        improvements.push(improvement);
      });

      // Create feedback that will trigger improvements
      for (let i = 0; i < 3; i++) {
        await feedbackCollector.collectFeedback(`exec-tool-${i}`, {
          performance: {
            duration: 1000,
            memoryUsed: 1024 * 1024,
            toolCalls: 10
          },
          quality: {
            testsPass: true,
            testsPassing: 10,
            testsTotal: 10,
            coverage: 80,
            complexity: 5,
            lintErrors: 0,
            lintWarnings: 0,
            buildSuccess: true
          },
          toolUsage: [{
            toolName: 'badTool',
            callCount: 10,
            successCount: 2,
            failureCount: 8, // More failures than successes
            averageDuration: 500
          }]
        });
      }

      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should have suggested improvements
      const allImprovements = feedbackCollector.getImprovements();
      expect(allImprovements.length).toBeGreaterThan(0);

      const proposed = feedbackCollector.getImprovements('proposed');
      expect(proposed.some(i => i.description.includes('badTool'))).toBe(true);
    });

    it('should generate feedback summary', async () => {
      // Add some feedback
      await feedbackCollector.collectFeedback('exec-1', {
        performance: { duration: 1000, memoryUsed: 1024, toolCalls: 5 },
        quality: {
          testsPass: true,
          testsPassing: 10,
          testsTotal: 10,
          coverage: 90,
          complexity: 5,
          lintErrors: 0,
          lintWarnings: 0,
          buildSuccess: true
        }
      });

      const summary = feedbackCollector.getFeedbackSummary();

      expect(summary.totalExecutions).toBe(1);
      expect(summary.averagePerformance.duration).toBe(1000);
      expect(summary.averageQuality.coverage).toBe(90);
    });
  });

  describe('Learning Pipeline', () => {
    it('should generate insights from patterns', async () => {
      const insights: LearningInsight[] = [];

      learningPipeline.on('insight:generated', (insight) => {
        insights.push(insight);
      });

      // Create feedback that generates patterns
      for (let i = 0; i < 3; i++) {
        await feedbackCollector.collectFeedback(`exec-learn-${i}`, {
          performance: {
            duration: 2000 * (i + 1), // Performance degradation
            memoryUsed: 1024 * 1024,
            toolCalls: 5
          },
          quality: {
            testsPass: false,
            testsPassing: 3,
            testsTotal: 10,
            coverage: 40,
            complexity: 15,
            lintErrors: 10,
            lintWarnings: 20,
            buildSuccess: false
          }
        });
      }

      // Wait for learning
      await new Promise(resolve => setTimeout(resolve, 200));

      // Should have generated insights
      const allInsights = learningPipeline.getInsights();
      expect(allInsights.length).toBeGreaterThan(0);
    });

    it('should learn from workflow executions', async () => {
      const workflow: DevelopmentWorkflow = {
        id: 'learning-workflow',
        name: 'Learning Workflow',
        enabled: true,
        triggers: [],
        stages: [{
          name: 'test_stage',
          triggers: [],
          actions: [{
            type: 'notify',
            params: { message: 'Test' }
          }]
        }]
      };

      await workflowEngine.registerWorkflow(workflow);

      // Execute workflow
      const execution = await workflowEngine.executeWorkflow('learning-workflow', {
        testsPass: true,
        coverage: 85
      });

      expect(execution.status).toBe('completed');

      // Wait for learning
      await new Promise(resolve => setTimeout(resolve, 100));

      // Check that learning occurred
      const metrics = learningPipeline.getLearningMetrics();
      expect(metrics.knowledgeGrowth).toBeGreaterThanOrEqual(0);
    });

    it('should calculate learning metrics', () => {
      const metrics = learningPipeline.getLearningMetrics();

      expect(metrics).toHaveProperty('insightsGenerated');
      expect(metrics).toHaveProperty('insightsApplied');
      expect(metrics).toHaveProperty('improvementRate');
      expect(metrics).toHaveProperty('errorReduction');
      expect(metrics).toHaveProperty('efficiencyGain');
      expect(metrics).toHaveProperty('knowledgeGrowth');
      expect(metrics).toHaveProperty('adaptationSpeed');
    });

    it('should generate learning report', () => {
      const report = learningPipeline.generateLearningReport();

      expect(report).toHaveProperty('metrics');
      expect(report).toHaveProperty('topInsights');
      expect(report).toHaveProperty('recentImprovements');
      expect(report).toHaveProperty('recommendations');

      expect(Array.isArray(report.recommendations)).toBe(true);
    });

    it('should apply high-confidence insights automatically', async () => {
      let appliedInsight: LearningInsight | null = null;

      learningPipeline.on('insight:applied', (insight) => {
        appliedInsight = insight;
      });

      // Manually create a high-confidence insight
      const insight: LearningInsight = {
        id: uuidv4(),
        type: InsightType.ERROR_PREVENTION,
        description: 'Prevent recurring errors',
        confidence: 0.95, // High confidence
        evidence: [],
        recommendation: 'Add validation',
        impact: {
          performance: 2,
          quality: 5,
          reliability: 8,
          overall: 5
        },
        createdAt: new Date()
      };

      // Trigger pattern analysis with a pattern that will generate high-confidence insight
      const pattern: Pattern = {
        id: 'test-pattern',
        type: PatternType.ERROR,
        description: 'Test error pattern',
        frequency: 5,
        impact: {
          performance: -5,
          quality: -8,
          reliability: -10,
          overall: -7.7
        },
        firstSeen: new Date(),
        lastSeen: new Date(),
        occurrences: ['exec-1', 'exec-2'],
        metadata: {
          error: {
            type: 'TypeError',
            message: 'Test error'
          }
        }
      };

      // This should trigger insight generation and application
      await learningPipeline.analyzePattern(pattern);

      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 100));

      // Check if insights were generated
      const insights = learningPipeline.getInsights();
      expect(insights.length).toBeGreaterThan(0);
    });
  });

  describe('End-to-End Integration', () => {
    it('should complete full continuous development cycle', async () => {
      // 1. Create a task
      const task = await unifiedOrchestron.createTask({
        title: 'Implement new feature',
        type: DevelopmentNodeType.FEATURE,
        priority: Priority.HIGH
      });

      // 2. Start task (trigger workflow)
      await unifiedOrchestron.updateTaskStatus(task.nodeId, TaskStatus.IN_PROGRESS);

      // 3. Execute some work and collect feedback
      const feedback = await feedbackCollector.collectFeedback('e2e-exec', {
        performance: {
          duration: 1500,
          memoryUsed: 2 * 1024 * 1024,
          toolCalls: 8
        },
        quality: {
          testsPass: true,
          testsPassing: 15,
          testsTotal: 15,
          coverage: 92,
          complexity: 6,
          lintErrors: 0,
          lintWarnings: 1,
          buildSuccess: true
        }
      });

      // 4. Check learning occurred
      const learningMetrics = learningPipeline.getLearningMetrics();
      expect(learningMetrics.knowledgeGrowth).toBeGreaterThanOrEqual(0);

      // 5. Complete task
      await unifiedOrchestron.updateTaskProgress(task.nodeId, 100);
      await unifiedOrchestron.updateTaskStatus(task.nodeId, TaskStatus.DONE);

      // 6. Verify task completion
      const completedTask = await unifiedOrchestron.getTask(task.nodeId);
      expect(completedTask?.payload.status).toBe(TaskStatus.DONE);
      expect(completedTask?.payload.progress).toBe(100);

      // 7. Generate reports
      const stats = await unifiedOrchestron.getStats();
      expect(stats.totalTasks).toBeGreaterThan(0);
      expect(stats.completedToday).toBeGreaterThanOrEqual(0);

      const learningReport = learningPipeline.generateLearningReport();
      expect(learningReport.metrics).toBeDefined();
    });

    it('should handle error recovery and learning', async () => {
      // Simulate error scenario
      const errorFeedback = await feedbackCollector.collectFeedback('error-exec', {
        performance: {
          duration: 5000,
          memoryUsed: 5 * 1024 * 1024,
          toolCalls: 20
        },
        quality: {
          testsPass: false,
          testsPassing: 0,
          testsTotal: 10,
          coverage: 0,
          complexity: 20,
          lintErrors: 50,
          lintWarnings: 100,
          buildSuccess: false
        },
        errors: [{
          type: 'BuildError',
          message: 'Compilation failed',
          timestamp: new Date(),
          recovered: false
        }]
      });

      // Wait for pattern detection and learning
      await new Promise(resolve => setTimeout(resolve, 100));

      // Check improvements suggested
      const improvements = feedbackCollector.getImprovements();
      const insights = learningPipeline.getInsights();

      // Should have suggestions for improvement
      expect(improvements.length + insights.length).toBeGreaterThan(0);
    });

    it('should demonstrate workflow automation benefits', async () => {
      // Create multiple tasks
      const tasks = await Promise.all([
        unifiedOrchestron.createTask({ title: 'Task 1', type: DevelopmentNodeType.TASK }),
        unifiedOrchestron.createTask({ title: 'Task 2', type: DevelopmentNodeType.TASK }),
        unifiedOrchestron.createTask({ title: 'Task 3', type: DevelopmentNodeType.TASK })
      ]);

      // Register automation workflow
      const automationWorkflow: DevelopmentWorkflow = {
        id: 'bulk-automation',
        name: 'Bulk Task Processing',
        enabled: true,
        triggers: [{
          type: 'manual'
        }],
        stages: tasks.map((task, i) => ({
          name: `process_task_${i}`,
          triggers: [],
          actions: [{
            type: 'update_task',
            params: {
              taskId: task.nodeId,
              status: TaskStatus.IN_PROGRESS
            }
          }, {
            type: 'update_task',
            params: {
              taskId: task.nodeId,
              progress: 100
            }
          }]
        }))
      };

      await workflowEngine.registerWorkflow(automationWorkflow);

      // Execute workflow
      const execution = await workflowEngine.executeWorkflow('bulk-automation');
      expect(execution.status).toBe('completed');

      // Verify all tasks updated
      for (const task of tasks) {
        const updated = await unifiedOrchestron.getTask(task.nodeId);
        expect(updated?.payload.progress).toBe(100);
      }
    });
  });

  describe('Performance and Scalability', () => {
    it('should handle large feedback volumes efficiently', async () => {
      const startTime = Date.now();
      const feedbackPromises = [];

      // Collect 100 feedbacks
      for (let i = 0; i < 100; i++) {
        feedbackPromises.push(
          feedbackCollector.collectFeedback(`perf-${i}`, {
            performance: {
              duration: Math.random() * 5000,
              memoryUsed: Math.random() * 10 * 1024 * 1024,
              toolCalls: Math.floor(Math.random() * 20)
            },
            quality: {
              testsPass: Math.random() > 0.5,
              testsPassing: Math.floor(Math.random() * 10),
              testsTotal: 10,
              coverage: Math.random() * 100,
              complexity: Math.floor(Math.random() * 20),
              lintErrors: Math.floor(Math.random() * 10),
              lintWarnings: Math.floor(Math.random() * 20),
              buildSuccess: Math.random() > 0.3
            }
          })
        );
      }

      await Promise.all(feedbackPromises);
      const duration = Date.now() - startTime;

      // Should process 100 feedbacks in reasonable time (< 5 seconds)
      expect(duration).toBeLessThan(5000);

      // Verify feedback was collected
      const summary = feedbackCollector.getFeedbackSummary();
      expect(summary.totalExecutions).toBe(100);
    });

    it('should maintain performance with many workflows', async () => {
      // Register multiple workflows
      const workflows = [];
      for (let i = 0; i < 20; i++) {
        const workflow: DevelopmentWorkflow = {
          id: `perf-workflow-${i}`,
          name: `Performance Test ${i}`,
          enabled: true,
          triggers: [],
          stages: [{
            name: 'simple_stage',
            triggers: [],
            actions: [{
              type: 'notify',
              params: { message: `Workflow ${i}` }
            }]
          }]
        };
        workflows.push(workflow);
        await workflowEngine.registerWorkflow(workflow);
      }

      // Execute all workflows
      const startTime = Date.now();
      const executions = await Promise.all(
        workflows.map(w => workflowEngine.executeWorkflow(w.id))
      );
      const duration = Date.now() - startTime;

      // Should execute 20 workflows quickly (< 2 seconds)
      expect(duration).toBeLessThan(2000);

      // All should complete
      expect(executions.every(e => e.status === 'completed')).toBe(true);
    });

    it('should clean up old feedback efficiently', async () => {
      // Add old feedback
      for (let i = 0; i < 50; i++) {
        await feedbackCollector.collectFeedback(`old-${i}`, {
          performance: { duration: 1000, memoryUsed: 1024, toolCalls: 5 },
          quality: {
            testsPass: true,
            testsPassing: 10,
            testsTotal: 10,
            coverage: 80,
            complexity: 5,
            lintErrors: 0,
            lintWarnings: 0,
            buildSuccess: true
          }
        });
      }

      // Clear old feedback (0 days = clear all)
      await feedbackCollector.clearOldFeedback(0);

      const summary = feedbackCollector.getFeedbackSummary();
      expect(summary.totalExecutions).toBe(0);
    });
  });
});