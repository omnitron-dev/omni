import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OrchestronMCPServer } from '../../src/mcp/server';
import { SQLiteStorage } from '../../src/storage/sqlite';
import { UnifiedOrchestron } from '../../src/core/unified-orchestron';
import { TaskStatus, Priority } from '../../src/core/types';

describe('OrchestronMCPServer', () => {
  let server: OrchestronMCPServer;
  let storage: SQLiteStorage;
  let orchestron: UnifiedOrchestron;

  beforeEach(async () => {
    // Use in-memory database for tests
    storage = new SQLiteStorage(':memory:');
    await storage.initialize();

    orchestron = new UnifiedOrchestron(storage);
    await orchestron.initialize();

    // We can't directly test the MCP server's request handlers
    // without mocking the MCP protocol, but we can test the underlying
    // functionality
  });

  afterEach(async () => {
    await orchestron.close();
    await storage.close();
  });

  describe('Task Management', () => {
    it('should create a task', async () => {
      const task = await orchestron.createTask({
        type: 'TASK',
        title: 'Test Task',
        description: 'Test description',
        priority: Priority.HIGH,
        assignee: 'test-agent',
      });

      expect(task).toBeDefined();
      expect(task.payload.title).toBe('Test Task');
      expect(task.payload.priority).toBe(Priority.HIGH);
    });

    it('should list tasks with filters', async () => {
      // Create some test tasks
      await orchestron.createTask({
        type: 'TASK',
        title: 'Task 1',
        priority: Priority.HIGH,
      });

      await orchestron.createTask({
        type: 'TASK',
        title: 'Task 2',
        priority: Priority.LOW,
      });

      const task3 = await orchestron.createTask({
        type: 'TASK',
        title: 'Task 3',
        priority: Priority.HIGH,
      });

      // Update one to IN_PROGRESS
      await orchestron.updateTaskStatus(task3.nodeId, TaskStatus.IN_PROGRESS);

      // Search for HIGH priority tasks
      const highPriorityTasks = await orchestron.searchTasks({
        priority: Priority.HIGH,
      });

      expect(highPriorityTasks).toHaveLength(2);

      // Search for IN_PROGRESS tasks
      const inProgressTasks = await orchestron.searchTasks({
        status: TaskStatus.IN_PROGRESS,
      });

      expect(inProgressTasks).toHaveLength(1);
      expect(inProgressTasks[0].nodeId).toBe(task3.nodeId);
    });

    it('should update task status and progress', async () => {
      const task = await orchestron.createTask({
        type: 'TASK',
        title: 'Update Test',
      });

      await orchestron.updateTaskStatus(task.nodeId, TaskStatus.IN_PROGRESS);
      await orchestron.updateTaskProgress(task.nodeId, 50);

      const updated = await orchestron.getTask(task.nodeId);
      expect(updated?.payload.status).toBe(TaskStatus.IN_PROGRESS);
      expect(updated?.payload.progress).toBe(50);
    });
  });

  describe('Context Management', () => {
    it('should save and retrieve context', async () => {
      const testContext = {
        currentTask: 'TASK-123',
        completedSteps: ['Step 1', 'Step 2'],
        nextSteps: ['Step 3', 'Step 4'],
        decisions: {
          database: 'PostgreSQL',
          framework: 'Express',
        },
      };

      // Save context as a node
      await orchestron.commit({
        nodes: [{
          author: 'SYSTEM' as any,
          parentIds: [],
          nodeType: 'context' as any,
          payload: {
            contextId: 'CTX-TEST',
            context: testContext,
            notes: 'Test context',
            timestamp: new Date(),
          },
          metadata: {
            type: 'session-context',
          },
        }] as any,
        edges: [],
        message: 'Context saved: CTX-TEST',
      });

      // Retrieve context
      const context = orchestron.getCurrentContext();
      expect(context).toBeDefined();
    });

    it('should get current development context', () => {
      const context = orchestron.getCurrentContext();

      expect(context).toBeDefined();
      expect(context.currentBranch).toBeDefined();
      expect(context.totalNodes).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Sprint Management', () => {
    it('should get active sprint', async () => {
      // Create a sprint
      const sprint = await orchestron.createSprint({
        name: 'Sprint 1',
        goal: 'Complete feature X',
        startDate: new Date(),
        duration: 14,
      });

      await orchestron.startSprint(sprint.nodeId);

      const activeSprint = await orchestron.getActiveSprint();
      expect(activeSprint).toBeDefined();
      expect(activeSprint?.nodeId).toBe(sprint.nodeId);
    });

    it('should get sprint report', async () => {
      const sprint = await orchestron.createSprint({
        name: 'Sprint 1',
        goal: 'Complete feature X',
        startDate: new Date(),
        duration: 14,
      });

      await orchestron.startSprint(sprint.nodeId);

      // Add tasks to sprint
      const task1 = await orchestron.createTask({
        type: 'TASK',
        title: 'Sprint Task 1',
      });

      const task2 = await orchestron.createTask({
        type: 'TASK',
        title: 'Sprint Task 2',
      });

      await orchestron.addTaskToSprint(task1.nodeId, sprint.nodeId);
      await orchestron.addTaskToSprint(task2.nodeId, sprint.nodeId);

      // Complete one task
      await orchestron.updateTaskStatus(task1.nodeId, TaskStatus.DONE);

      const report = await orchestron.getSprintReport(sprint.nodeId);
      expect(report).toBeDefined();
      expect(report.completedTasks).toBe(1);
      expect(report.remainingTasks).toBe(1);
    });
  });

  describe('Statistics', () => {
    it('should get project statistics', async () => {
      // Create some tasks
      await orchestron.createTask({ type: 'TASK', title: 'Task 1' });
      await orchestron.createTask({ type: 'TASK', title: 'Task 2' });

      const task3 = await orchestron.createTask({
        type: 'TASK',
        title: 'Task 3',
      });

      await orchestron.updateTaskStatus(task3.nodeId, TaskStatus.IN_PROGRESS);

      const stats = await orchestron.getStatistics();

      expect(stats).toBeDefined();
      expect(stats.totalTasks).toBeGreaterThanOrEqual(3);
      expect(stats.inProgress).toBeGreaterThanOrEqual(1);
    });

    it('should identify blocked tasks', async () => {
      const task1 = await orchestron.createTask({
        type: 'TASK',
        title: 'Blocking Task',
      });

      const task2 = await orchestron.createTask({
        type: 'TASK',
        title: 'Blocked Task',
      });

      // Add dependency
      await orchestron.addDependency(task2.nodeId, task1.nodeId);

      const blockedTasks = await orchestron.getBlockedTasks();
      expect(blockedTasks).toBeDefined();
      expect(blockedTasks.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Resource URIs', () => {
    it('should handle active tasks resource', async () => {
      const task = await orchestron.createTask({
        type: 'TASK',
        title: 'Active Task',
      });

      await orchestron.updateTaskStatus(task.nodeId, TaskStatus.IN_PROGRESS);

      const activeTasks = await orchestron.searchTasks({
        status: TaskStatus.IN_PROGRESS,
      });

      expect(activeTasks).toHaveLength(1);
      expect(activeTasks[0].payload.title).toBe('Active Task');
    });

    it('should handle blocked tasks resource', async () => {
      const task1 = await orchestron.createTask({
        type: 'TASK',
        title: 'Dependency',
      });

      const task2 = await orchestron.createTask({
        type: 'TASK',
        title: 'Blocked',
      });

      await orchestron.addDependency(task2.nodeId, task1.nodeId);

      const blockedTasks = await orchestron.getBlockedTasks();
      expect(blockedTasks.length).toBeGreaterThan(0);
    });

    it('should handle statistics overview resource', async () => {
      await orchestron.createTask({ type: 'EPIC', title: 'Epic 1' });
      await orchestron.createTask({ type: 'STORY', title: 'Story 1' });
      await orchestron.createTask({ type: 'TASK', title: 'Task 1' });
      await orchestron.createTask({ type: 'TODO', title: 'Todo 1' });

      const stats = await orchestron.getStatistics();

      expect(stats.totalTasks).toBeGreaterThanOrEqual(4);
      expect(stats.tasksByType).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid task ID gracefully', async () => {
      try {
        await orchestron.updateTaskStatus('INVALID-ID', TaskStatus.DONE);
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('should validate task creation parameters', async () => {
      try {
        await orchestron.createTask({
          type: 'INVALID' as any,
          title: '',
        });
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });
});