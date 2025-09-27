import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TaskManager } from '../../src/core/task-manager';
import {
  createTestContext,
  cleanupTestContext,
  createSampleTask,
  createTaskWithDependencies,
  TestContext,
  expectTaskToMatch,
  mockDate,
  waitFor,
} from '../fixtures/test-helpers';
import {
  DevelopmentNodeType,
  TaskStatus,
  Priority,
  Author,
} from '../../src/core/types';

describe('TaskManager', () => {
  let context: TestContext;
  let taskManager: TaskManager;

  beforeEach(async () => {
    context = await createTestContext();
    taskManager = context.taskManager;
  });

  afterEach(async () => {
    await cleanupTestContext(context);
  });

  describe('Task Creation', () => {
    it('should create a basic task', async () => {
      const task = await taskManager.createTask({
        title: 'Test Task',
        description: 'This is a test task',
        priority: Priority.HIGH,
        estimatedHours: 8,
      });

      expect(task.nodeId).toBeTruthy();
      expect(task.nodeType).toBe(DevelopmentNodeType.TASK);
      expect(task.author).toBe(Author.HUMAN);
      expectTaskToMatch(task, {
        title: 'Test Task',
        description: 'This is a test task',
        status: TaskStatus.TODO,
        priority: Priority.HIGH,
        estimatedHours: 8,
        progress: 0,
      });
      expect(task.payload.checkpoints).toEqual([]);
      expect(task.payload.blockedBy).toEqual([]);
      expect(task.payload.blocking).toEqual([]);
    });

    it('should create task with different types', async () => {
      const epic = await taskManager.createTask({
        type: DevelopmentNodeType.EPIC,
        title: 'Epic Task',
        priority: Priority.HIGH,
      });

      const story = await taskManager.createTask({
        type: DevelopmentNodeType.STORY,
        title: 'Story Task',
        priority: Priority.MEDIUM,
      });

      const subtask = await taskManager.createTask({
        type: DevelopmentNodeType.SUBTASK,
        title: 'Subtask',
        priority: Priority.LOW,
      });

      expect(epic.nodeType).toBe(DevelopmentNodeType.EPIC);
      expect(story.nodeType).toBe(DevelopmentNodeType.STORY);
      expect(subtask.nodeType).toBe(DevelopmentNodeType.SUBTASK);
    });

    it('should create task with parent', async () => {
      const parentTask = await createSampleTask(context);

      const childTask = await taskManager.createTask({
        title: 'Child Task',
        parent: parentTask.nodeId,
        priority: Priority.MEDIUM,
      });

      expect(childTask.parentIds).toContain(parentTask.nodeId);
    });

    it('should default to TASK type for invalid types', async () => {
      const task = await taskManager.createTask({
        type: DevelopmentNodeType.FEATURE as any, // Invalid task type
        title: 'Invalid Type Task',
        priority: Priority.MEDIUM,
      });

      expect(task.nodeType).toBe(DevelopmentNodeType.TASK);
    });

    it('should create task with all optional parameters', async () => {
      const dueDate = new Date('2024-12-31');

      const task = await taskManager.createTask({
        title: 'Complete Task',
        description: 'Task with all parameters',
        priority: Priority.CRITICAL,
        assignee: 'john.doe',
        dueDate,
        labels: ['frontend', 'urgent'],
        estimatedHours: 16,
        component: 'user-service',
      });

      expectTaskToMatch(task, {
        title: 'Complete Task',
        description: 'Task with all parameters',
        priority: Priority.CRITICAL,
        assignee: 'john.doe',
        dueDate,
        labels: ['frontend', 'urgent'],
        estimatedHours: 16,
        component: 'user-service',
      });
    });
  });

  describe('Task Status Management', () => {
    it('should update task status successfully', async () => {
      const task = await createSampleTask(context);

      await taskManager.updateTaskStatus(task.nodeId, TaskStatus.IN_PROGRESS);

      const updatedTask = await context.engine.getNode(task.nodeId);
      expect(updatedTask).toBeTruthy();
      expect((updatedTask as any).payload?.status).toBe(TaskStatus.IN_PROGRESS);
    });

    it('should set start date when moving to IN_PROGRESS', async () => {
      const fixedDate = new Date('2024-01-15T10:00:00Z');
      const restoreDate = mockDate(fixedDate);

      try {
        const task = await createSampleTask(context);
        await taskManager.updateTaskStatus(task.nodeId, TaskStatus.IN_PROGRESS);

        // Get the latest version of the task
        const history = await context.engine.getRecentNodes(5);
        const updatedTask = history.find(n =>
          n.nodeType === DevelopmentNodeType.TASK &&
          n.parentIds.includes(task.nodeId)
        );

        expect(updatedTask).toBeTruthy();
        expect((updatedTask as any).payload?.startDate).toBeTruthy();
      } finally {
        restoreDate();
      }
    });

    it('should set completion date when moving to DONE', async () => {
      const fixedDate = new Date('2024-01-15T10:00:00Z');
      const restoreDate = mockDate(fixedDate);

      try {
        const task = await createSampleTask(context);
        await taskManager.updateTaskStatus(task.nodeId, TaskStatus.IN_PROGRESS);
        await taskManager.updateTaskStatus(task.nodeId, TaskStatus.DONE);

        // Get the latest version of the task
        const history = await context.engine.getRecentNodes(10);
        const completedTask = history.find(n =>
          n.nodeType === DevelopmentNodeType.TASK &&
          (n.payload as any)?.status === TaskStatus.DONE
        );

        expect(completedTask).toBeTruthy();
        expect((completedTask as any).payload?.completedDate).toBeTruthy();
        expect((completedTask as any).payload?.progress).toBe(100);
      } finally {
        restoreDate();
      }
    });

    it('should validate status transitions', async () => {
      const task = await createSampleTask(context);

      // Valid transition: TODO -> IN_PROGRESS
      await expect(
        taskManager.updateTaskStatus(task.nodeId, TaskStatus.IN_PROGRESS)
      ).resolves.not.toThrow();

      // Invalid transition: Skip to DONE from TODO directly is invalid
      // (Need to go through IN_PROGRESS first according to workflow)
      const task2 = await createSampleTask(context);
      await expect(
        taskManager.updateTaskStatus(task2.nodeId, TaskStatus.DONE)
      ).rejects.toThrow('Invalid status transition');
    });

    it('should throw error for non-existent task', async () => {
      await expect(
        taskManager.updateTaskStatus('non-existent-id', TaskStatus.IN_PROGRESS)
      ).rejects.toThrow('Task non-existent-id not found');
    });
  });

  describe('Task Progress Management', () => {
    it('should update task progress', async () => {
      const task = await createSampleTask(context);

      await taskManager.updateTaskProgress(task.nodeId, 50);

      const history = await context.engine.getRecentNodes(5);
      const updatedTask = history.find(n =>
        n.nodeType === DevelopmentNodeType.TASK &&
        n.parentIds.includes(task.nodeId)
      );

      expect(updatedTask).toBeTruthy();
      expect((updatedTask as any).payload?.progress).toBe(50);
    });

    it('should add checkpoint when updating progress', async () => {
      const task = await createSampleTask(context);

      await taskManager.updateTaskProgress(task.nodeId, 25, 'Initial setup complete');

      const history = await context.engine.getRecentNodes(5);
      const updatedTask = history.find(n =>
        n.nodeType === DevelopmentNodeType.TASK &&
        n.parentIds.includes(task.nodeId)
      );

      expect(updatedTask).toBeTruthy();
      const checkpoints = (updatedTask as any).payload?.checkpoints || [];
      expect(checkpoints).toHaveLength(1);
      expect(checkpoints[0].name).toBe('Initial setup complete');
      expect(checkpoints[0].completed).toBe(true);
      expect(checkpoints[0].timestamp).toBeTruthy();
    });

    it('should auto-update status based on progress', async () => {
      const task = await createSampleTask(context);

      // Progress to 50% should move from TODO to IN_PROGRESS
      await taskManager.updateTaskProgress(task.nodeId, 50);

      let history = await context.engine.getRecentNodes(5);
      let updatedTask = history.find(n =>
        n.nodeType === DevelopmentNodeType.TASK &&
        n.parentIds.includes(task.nodeId)
      );

      expect((updatedTask as any).payload?.status).toBe(TaskStatus.IN_PROGRESS);

      // Progress to 100% should move to TESTING
      await taskManager.updateTaskProgress(task.nodeId, 100);

      history = await context.engine.getRecentNodes(5);
      updatedTask = history.find(n =>
        n.nodeType === DevelopmentNodeType.TASK &&
        n.parentIds.includes(task.nodeId)
      );

      expect((updatedTask as any).payload?.status).toBe(TaskStatus.TESTING);
    });

    it('should clamp progress between 0 and 100', async () => {
      const task = await createSampleTask(context);

      await taskManager.updateTaskProgress(task.nodeId, 150);

      const history = await context.engine.getRecentNodes(5);
      const updatedTask = history.find(n =>
        n.nodeType === DevelopmentNodeType.TASK &&
        n.parentIds.includes(task.nodeId)
      );

      expect((updatedTask as any).payload?.progress).toBe(100);

      await taskManager.updateTaskProgress(task.nodeId, -10);

      const history2 = await context.engine.getRecentNodes(5);
      const updatedTask2 = history2.find(n =>
        n.nodeType === DevelopmentNodeType.TASK &&
        n.parentIds.includes(task.nodeId)
      );

      expect((updatedTask2 as any).payload?.progress).toBe(0);
    });
  });

  describe('Task Assignment', () => {
    it('should assign task to user', async () => {
      const task = await createSampleTask(context);

      await taskManager.assignTask(task.nodeId, 'jane.doe');

      const history = await context.engine.getRecentNodes(5);
      const updatedTask = history.find(n =>
        n.nodeType === DevelopmentNodeType.TASK &&
        n.parentIds.includes(task.nodeId)
      );

      expect(updatedTask).toBeTruthy();
      expect((updatedTask as any).payload?.assignee).toBe('jane.doe');
    });

    it('should create assignment edge', async () => {
      const task = await createSampleTask(context);

      await taskManager.assignTask(task.nodeId, 'jane.doe');

      // Check that an assignment edge was created
      const edges = await context.engine.getAllEdges();
      const assignmentEdge = edges.find(e =>
        e.targetNodeId === 'jane.doe' &&
        e.sourceNodeId === task.nodeId
      );

      expect(assignmentEdge).toBeTruthy();
    });

    it('should throw error for non-existent task', async () => {
      await expect(
        taskManager.assignTask('non-existent-id', 'user')
      ).rejects.toThrow('Task non-existent-id not found');
    });
  });

  describe('TODO Management', () => {
    it('should create TODO item', async () => {
      const todo = await taskManager.addTodo('Fix login bug');

      expect(todo.nodeType).toBe(DevelopmentNodeType.TODO);
      expectTaskToMatch(todo, {
        title: 'Fix login bug',
        priority: Priority.LOW,
        status: TaskStatus.TODO,
      });
    });

    it('should create TODO with context', async () => {
      const todo = await taskManager.addTodo('Update documentation', 'auth-service');

      expectTaskToMatch(todo, {
        title: 'Update documentation',
        component: 'auth-service',
        priority: Priority.LOW,
      });
    });

    it('should convert TODO to task', async () => {
      const todo = await taskManager.addTodo('Refactor authentication');

      const task = await taskManager.convertTodoToTask(todo.nodeId, {
        title: 'Refactor authentication system',
        description: 'Complete rewrite of auth module',
        priority: Priority.HIGH,
        estimatedHours: 24,
      });

      expect(task.nodeType).toBe(DevelopmentNodeType.TASK);
      expect(task.parentIds).toContain(todo.nodeId);
      expectTaskToMatch(task, {
        title: 'Refactor authentication system',
        description: 'Complete rewrite of auth module',
        priority: Priority.HIGH,
        estimatedHours: 24,
        status: TaskStatus.TODO,
      });
    });

    it('should get filtered TODOs', async () => {
      await taskManager.addTodo('Backend TODO', 'backend');
      await taskManager.addTodo('Frontend TODO', 'frontend');
      await taskManager.addTodo('General TODO');

      const backendTodos = await taskManager.getTodos({ context: 'backend' });
      const frontendTodos = await taskManager.getTodos({ context: 'frontend' });
      const allTodos = await taskManager.getTodos();

      expect(backendTodos).toHaveLength(1);
      expect(frontendTodos).toHaveLength(1);
      expect(allTodos.length).toBeGreaterThanOrEqual(3);

      expect(backendTodos[0].payload.component).toBe('backend');
      expect(frontendTodos[0].payload.component).toBe('frontend');
    });

    it('should filter out completed TODOs', async () => {
      const todo = await taskManager.addTodo('Complete this TODO');
      // Transition through valid states to reach DONE
      await taskManager.updateTaskStatus(todo.nodeId, TaskStatus.IN_PROGRESS);
      await taskManager.updateTaskStatus(todo.nodeId, TaskStatus.DONE);

      const activeTodos = await taskManager.getTodos();
      expect(activeTodos.every(t => t.payload.status !== TaskStatus.DONE)).toBe(true);
    });
  });

  describe('Task Dependencies', () => {
    it('should add dependency between tasks', async () => {
      const { parentTask, childTask1 } = await createTaskWithDependencies(context);

      // Verify dependency was added
      const updatedChild = await context.engine.getRecentNodes(10);
      const childTaskUpdate = updatedChild.find(n =>
        n.nodeType === DevelopmentNodeType.TASK &&
        n.parentIds.includes(childTask1.nodeId)
      );

      expect(childTaskUpdate).toBeTruthy();
      expect((childTaskUpdate as any).payload?.blockedBy).toContain(parentTask.nodeId);
    });

    it('should mark dependent task as blocked', async () => {
      const parentTask = await createSampleTask(context, {
        title: 'Blocking Task',
        status: TaskStatus.TODO,
      });

      const childTask = await createSampleTask(context, {
        title: 'Dependent Task',
      });

      await taskManager.addDependency(childTask.nodeId, parentTask.nodeId);

      // Get updated child task
      const history = await context.engine.getRecentNodes(10);
      const updatedChild = history.find(n =>
        n.nodeType === DevelopmentNodeType.TASK &&
        n.parentIds.includes(childTask.nodeId)
      );

      expect((updatedChild as any).payload?.status).toBe(TaskStatus.BLOCKED);
    });

    it('should remove dependency', async () => {
      const { parentTask, childTask1 } = await createTaskWithDependencies(context);

      await taskManager.removeDependency(childTask1.nodeId, parentTask.nodeId);

      const history = await context.engine.getRecentNodes(10);
      const updatedChild = history.find(n =>
        n.nodeType === DevelopmentNodeType.TASK &&
        n.parentIds.includes(childTask1.nodeId)
      );

      expect(updatedChild).toBeTruthy();
      const blockedBy = (updatedChild as any).payload?.blockedBy || [];
      expect(blockedBy).not.toContain(parentTask.nodeId);
    });

    it('should unblock task when dependencies are removed', async () => {
      const parentTask = await createSampleTask(context);
      const childTask = await createSampleTask(context);

      await taskManager.addDependency(childTask.nodeId, parentTask.nodeId);

      // Verify task is blocked
      let history = await context.engine.getRecentNodes(10);
      let updatedChild = history.find(n =>
        n.nodeType === DevelopmentNodeType.TASK &&
        n.parentIds.includes(childTask.nodeId)
      );
      expect((updatedChild as any).payload?.status).toBe(TaskStatus.BLOCKED);

      // Remove dependency
      await taskManager.removeDependency(childTask.nodeId, parentTask.nodeId);

      // Verify task is unblocked
      history = await context.engine.getRecentNodes(10);
      updatedChild = history.find(n =>
        n.nodeType === DevelopmentNodeType.TASK &&
        n.parentIds.includes(childTask.nodeId)
      );
      expect((updatedChild as any).payload?.status).toBe(TaskStatus.TODO);
    });

    it('should get blocked tasks', async () => {
      const { parentTask, childTask1, childTask2 } = await createTaskWithDependencies(context);

      const blockedTasks = await taskManager.getBlockedTasks();

      expect(blockedTasks.length).toBeGreaterThanOrEqual(2);
      const blockedIds = blockedTasks.map(t => t.nodeId);
      expect(blockedIds).toContain(childTask1.nodeId);
      expect(blockedIds).toContain(childTask2.nodeId);
    });

    it('should calculate critical path', async () => {
      const epic = await taskManager.createTask({
        type: DevelopmentNodeType.EPIC,
        title: 'Epic with Dependencies',
        priority: Priority.HIGH,
      });

      const task1 = await createSampleTask(context, { title: 'Task 1', parent: epic.nodeId });
      const task2 = await createSampleTask(context, { title: 'Task 2', parent: epic.nodeId });
      const task3 = await createSampleTask(context, { title: 'Task 3', parent: epic.nodeId });

      // Create dependency chain: task1 -> task2 -> task3
      await taskManager.addDependency(task2.nodeId, task1.nodeId);
      await taskManager.addDependency(task3.nodeId, task2.nodeId);

      const criticalPath = await taskManager.getCriticalPath(epic.nodeId);

      expect(criticalPath).toBeTruthy();
      expect(criticalPath.length).toBeGreaterThan(0);
      expect(criticalPath).toContain(epic.nodeId);
    });
  });

  describe('Time Tracking', () => {
    it('should start and stop timer', async () => {
      const task = await createSampleTask(context);

      taskManager.startTimer(task.nodeId, 'john.doe');

      // Wait a small amount to ensure measurable time difference
      await new Promise(resolve => setTimeout(resolve, 10));

      const duration = await taskManager.stopTimer(task.nodeId);

      expect(duration).toBeGreaterThan(0);
      expect(duration).toBeLessThan(1); // Should be very small for this test
    });

    it('should throw error when starting timer for task that already has one', async () => {
      const task = await createSampleTask(context);

      taskManager.startTimer(task.nodeId, 'john.doe');

      expect(() => {
        taskManager.startTimer(task.nodeId, 'jane.doe');
      }).toThrow('Timer already running for task');
    });

    it('should throw error when stopping non-existent timer', async () => {
      const task = await createSampleTask(context);

      await expect(
        taskManager.stopTimer(task.nodeId)
      ).rejects.toThrow('No active timer for task');
    });

    it('should log time manually', async () => {
      const task = await createSampleTask(context);

      await taskManager.logTime(task.nodeId, 4.5);

      const history = await context.engine.getRecentNodes(10);
      const updatedTask = history.find(n =>
        n.nodeType === DevelopmentNodeType.TASK &&
        n.parentIds.includes(task.nodeId)
      );

      expect(updatedTask).toBeTruthy();
      expect((updatedTask as any).payload?.actualHours).toBe(4.5);
      expect((updatedTask as any).metadata?.timeSpent).toBe(4.5);
    });

    it('should accumulate logged time', async () => {
      const task = await createSampleTask(context);

      await taskManager.logTime(task.nodeId, 2);
      await taskManager.logTime(task.nodeId, 3);

      const history = await context.engine.getRecentNodes(10);
      const updatedTask = history.find(n =>
        n.nodeType === DevelopmentNodeType.TASK &&
        n.parentIds.includes(task.nodeId)
      );

      expect((updatedTask as any).payload?.actualHours).toBe(5);
    });

    it('should generate timesheet', async () => {
      const fixedDate = new Date('2024-01-15T10:00:00Z');
      const restoreDate = mockDate(fixedDate);

      try {
        const task1 = await createSampleTask(context, { assignee: 'john.doe' });
        const task2 = await createSampleTask(context, { assignee: 'john.doe' });

        await taskManager.logTime(task1.nodeId, 4);
        await taskManager.logTime(task2.nodeId, 3.5);

        const timesheet = await taskManager.getTimesheet('john.doe', {
          from: new Date('2024-01-01'),
          to: new Date('2024-01-31'),
        });

        expect(timesheet).toHaveLength(1);
        expect(timesheet[0].totalHours).toBe(7.5);
        expect(timesheet[0].entries).toHaveLength(2);
      } finally {
        restoreDate();
      }
    });
  });

  describe('Bulk Operations', () => {
    it('should bulk update task status', async () => {
      const task1 = await createSampleTask(context);
      const task2 = await createSampleTask(context);
      const task3 = await createSampleTask(context);

      await taskManager.bulkUpdateStatus(
        [task1.nodeId, task2.nodeId, task3.nodeId],
        TaskStatus.IN_PROGRESS
      );

      // Verify all tasks were updated
      const history = await context.engine.getRecentNodes(20);
      const updatedTasks = history.filter(n =>
        n.nodeType === DevelopmentNodeType.TASK &&
        (n.payload as any)?.status === TaskStatus.IN_PROGRESS
      );

      expect(updatedTasks.length).toBeGreaterThanOrEqual(3);
    });

    it('should bulk assign tasks', async () => {
      const task1 = await createSampleTask(context);
      const task2 = await createSampleTask(context);

      await taskManager.bulkAssign(
        [task1.nodeId, task2.nodeId],
        'team-lead'
      );

      const history = await context.engine.getRecentNodes(15);
      const assignedTasks = history.filter(n =>
        n.nodeType === DevelopmentNodeType.TASK &&
        (n.payload as any)?.assignee === 'team-lead'
      );

      expect(assignedTasks.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Task Statistics', () => {
    beforeEach(async () => {
      // Create sample data for statistics
      const fixedDate = new Date('2024-01-15T10:00:00Z');
      const restoreDate = mockDate(fixedDate);

      try {
        // Create tasks with different statuses and priorities
        await taskManager.createTask({
          title: 'High Priority Task',
          priority: Priority.HIGH,
          dueDate: new Date('2024-01-10'), // Overdue
        });

        const completedTask = await taskManager.createTask({
          title: 'Completed Task',
          priority: Priority.MEDIUM,
        });
        await taskManager.updateTaskStatus(completedTask.nodeId, TaskStatus.IN_PROGRESS);
        await taskManager.updateTaskStatus(completedTask.nodeId, TaskStatus.DONE);

        await taskManager.createTask({
          title: 'In Progress Task',
          priority: Priority.LOW,
        });

        await taskManager.createTask({
          title: 'Critical Task',
          priority: Priority.CRITICAL,
        });
      } finally {
        restoreDate();
      }
    });

    it('should get task statistics', async () => {
      // Mock the date to match the test data
      const fixedDate = new Date('2024-01-15T10:00:00Z');
      const restoreDate = mockDate(fixedDate);

      try {
        const stats = await taskManager.getTaskStatistics();

        expect(stats.total).toBeGreaterThanOrEqual(4);
        expect(stats.byStatus[TaskStatus.DONE]).toBeGreaterThanOrEqual(1);
        expect(stats.byPriority[Priority.HIGH]).toBeGreaterThanOrEqual(1);
        expect(stats.byPriority[Priority.CRITICAL]).toBeGreaterThanOrEqual(1);
        expect(stats.overdue).toBeGreaterThanOrEqual(1);
        expect(stats.completedToday).toBeGreaterThanOrEqual(1);
      } finally {
        restoreDate();
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid task updates gracefully', async () => {
      await expect(
        taskManager.updateTaskProgress('invalid-id', 50)
      ).rejects.toThrow('Task invalid-id not found');
    });

    it('should handle dependency operations on non-existent tasks', async () => {
      const realTask = await createSampleTask(context);

      await expect(
        taskManager.addDependency('invalid-id', realTask.nodeId)
      ).rejects.toThrow('Task or dependency not found');

      await expect(
        taskManager.addDependency(realTask.nodeId, 'invalid-id')
      ).rejects.toThrow('Task or dependency not found');
    });

    it('should handle time logging for non-existent task', async () => {
      await expect(
        taskManager.logTime('invalid-id', 5)
      ).rejects.toThrow('Task invalid-id not found');
    });
  });

  describe('Edge Cases', () => {
    it('should handle circular dependencies gracefully', async () => {
      const task1 = await createSampleTask(context);
      const task2 = await createSampleTask(context);

      await taskManager.addDependency(task1.nodeId, task2.nodeId);

      // Attempting to create circular dependency should not break the system
      await taskManager.addDependency(task2.nodeId, task1.nodeId);

      // Both tasks should exist and be valid
      const savedTask1 = await context.engine.getNode(task1.nodeId);
      const savedTask2 = await context.engine.getNode(task2.nodeId);

      expect(savedTask1).toBeTruthy();
      expect(savedTask2).toBeTruthy();
    });

    it('should handle multiple checkpoints', async () => {
      const task = await createSampleTask(context);

      await taskManager.updateTaskProgress(task.nodeId, 25, 'First checkpoint');
      await taskManager.updateTaskProgress(task.nodeId, 50, 'Second checkpoint');
      await taskManager.updateTaskProgress(task.nodeId, 75, 'Third checkpoint');

      const history = await context.engine.getRecentNodes(15);
      const latestTask = history.find(n =>
        n.nodeType === DevelopmentNodeType.TASK &&
        n.parentIds.includes(task.nodeId)
      );

      const checkpoints = (latestTask as any)?.payload?.checkpoints || [];
      expect(checkpoints).toHaveLength(3);
      expect(checkpoints.map((c: any) => c.name)).toEqual([
        'First checkpoint',
        'Second checkpoint',
        'Third checkpoint'
      ]);
    });
  });
});