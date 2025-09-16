import { Application } from '../../src/application';
import {
  TaskManagerModule,
  TaskService,
  NotificationService,
  TaskCoordinator,
  TaskServiceToken,
  NotificationServiceToken,
  TaskCoordinatorToken
} from '../../examples/task-manager-simple';

describe('TaskManagerSimple Example', () => {
  let app: any;

  beforeEach(async () => {
    // Create test application
    app = await Application.create({
      name: 'TestTaskManager',
      version: '1.0.0',
      config: {
        notifications: {
          enabled: true,
          channels: ['test']
        }
      },
      logging: {
        level: 'error' // Quiet for tests
      },
      modules: [new TaskManagerModule()]
    });
  });

  afterEach(async () => {
    if (app) {
      await app.stop();
    }
  });

  describe('Module Registration', () => {
    it('should register TaskManagerModule', async () => {
      await app.start();

      const modules = Array.from((app as any)._modules.values());
      const taskManager = modules.find(m => m.name === 'task-manager');

      expect(taskManager).toBeDefined();
      expect(taskManager?.version).toBe('1.0.0');
    });

    it('should register services in DI container', async () => {
      await app.start();

      const container = (app as any)._container;

      expect(container.has(TaskServiceToken)).toBe(true);
      expect(container.has(NotificationServiceToken)).toBe(true);
      expect(container.has(TaskCoordinatorToken)).toBe(true);
    });
  });

  describe('Service Functionality', () => {
    it('should create and manage tasks', async () => {
      await app.start();

      const container = (app as any)._container;
      const taskService = container.resolve(TaskServiceToken);

      // Create task
      const task = await taskService.create({
        title: 'Test Task',
        description: 'Test Description',
        status: 'pending',
        priority: 'high'
      });

      expect(task).toBeDefined();
      expect(task.title).toBe('Test Task');
      expect(task.status).toBe('pending');

      // Find task
      const foundTask = await taskService.findById(task.id);
      expect(foundTask).toEqual(task);

      // Update task
      const updated = await taskService.update(task.id, {
        status: 'completed'
      });

      expect(updated?.status).toBe('completed');

      // Delete task
      const deleted = await taskService.delete(task.id);
      expect(deleted).toBe(true);

      const notFound = await taskService.findById(task.id);
      expect(notFound).toBeUndefined();
    });

    it('should calculate statistics correctly', async () => {
      await app.start();

      const container = (app as any)._container;
      const taskService = container.resolve(TaskServiceToken);

      // Create multiple tasks
      await taskService.create({
        title: 'Task 1',
        description: 'Desc 1',
        status: 'pending',
        priority: 'high'
      });

      await taskService.create({
        title: 'Task 2',
        description: 'Desc 2',
        status: 'in-progress',
        priority: 'medium'
      });

      const stats = await taskService.getStatistics();

      expect(stats.total).toBeGreaterThanOrEqual(2);
      expect(stats.byStatus['pending']).toBeGreaterThanOrEqual(1);
      expect(stats.byStatus['in-progress']).toBeGreaterThanOrEqual(1);
      expect(stats.byPriority['high']).toBeGreaterThanOrEqual(1);
      expect(stats.byPriority['medium']).toBeGreaterThanOrEqual(1);
    });
  });

  describe('TaskCoordinator Integration', () => {
    it('should coordinate task operations', async () => {
      await app.start();

      const container = (app as any)._container;
      const coordinator = container.resolve(TaskCoordinatorToken);

      // Create task via coordinator
      const task = await coordinator.createTask({
        title: 'Coordinated Task',
        description: 'Created via coordinator',
        status: 'pending',
        priority: 'high'
      });

      expect(task).toBeDefined();
      expect(task.title).toBe('Coordinated Task');

      // Complete task via coordinator
      const completed = await coordinator.completeTask(task.id);
      expect(completed?.status).toBe('completed');

      // Get report
      const report = await coordinator.getTasksReport();
      expect(report.tasks).toBeDefined();
      expect(report.statistics).toBeDefined();
      expect(report.statistics.total).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Lifecycle Management', () => {
    it('should initialize services with OnInit', async () => {
      const onInitSpy = jest.fn();

      // Mock TaskService onInit
      const originalOnInit = TaskService.prototype.onInit;
      TaskService.prototype.onInit = async function() {
        onInitSpy();
        return originalOnInit?.call(this);
      };

      await app.start();

      expect(onInitSpy).toHaveBeenCalled();

      // Restore original
      TaskService.prototype.onInit = originalOnInit;
    });

    it('should cleanup services with OnDestroy', async () => {
      const onDestroySpy = jest.fn();

      // Mock TaskService onDestroy
      const originalOnDestroy = TaskService.prototype.onDestroy;
      TaskService.prototype.onDestroy = async function() {
        onDestroySpy();
        return originalOnDestroy?.call(this);
      };

      await app.start();
      await app.stop();

      expect(onDestroySpy).toHaveBeenCalled();

      // Restore original
      TaskService.prototype.onDestroy = originalOnDestroy;
    });
  });
});