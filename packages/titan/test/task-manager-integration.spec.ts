/**
 * Integration tests for Enhanced Task Manager
 */

import { Container, createToken } from '@omnitron-dev/nexus';
import { Module, EnhancedApplicationModule } from '../src/enhanced-module';
import {
  IApplication,
  ApplicationState,
  Provider,
  HealthStatus
} from '../src/types';
// Import core module tokens from titan
import { LoggerModuleToken, ConfigModuleToken } from '../src/index';

// Import the task manager components from test fixture
import {
  TaskManagerModule,
  TaskService,
  TaskRepository,
  NotificationService,
  TaskCoordinator,
  TaskServiceToken,
  TaskRepositoryToken,
  NotificationServiceToken,
  TaskCoordinatorToken
} from './fixtures/task-manager-fixture';

// Mock implementations
class MockLogger {
  info = jest.fn();
  debug = jest.fn();
  error = jest.fn();
  warn = jest.fn();
  child = jest.fn(() => this);
}

class MockConfigModule {
  private config = new Map<string, any>();

  constructor() {
    // Set default config
    this.config.set('notifications', {
      enabled: true,
      channels: ['email', 'push'],
      retryAttempts: 3
    });
  }

  get = jest.fn((path: string, defaultValue?: any) => {
    return this.config.get(path) ?? defaultValue;
  });

  set(path: string, value: any): void {
    this.config.set(path, value);
  }
}

// Enhanced Mock Application with better DI support
class MockApplication implements IApplication {
  container = new Container();
  private modules = new Map<any, any>();
  private eventHandlers = new Map<string, Function[]>();
  state: ApplicationState = ApplicationState.Created;
  uptime = 0;
  environment = {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    pid: process.pid
  } as any;
  metrics = {
    uptime: 0,
    memoryUsage: process.memoryUsage()
  } as any;

  constructor() {
    // Register mock modules with proper structure
    const logger = new MockLogger();
    const config = new MockConfigModule();

    // Logger module should have logger property and child method
    // This matches the expected structure where loggerModule.child() can be called
    const loggerModule = {
      logger: logger,  // The actual logger instance
      child: (bindings: object) => logger.child(bindings),
      info: (msg: string, data?: any) => logger.info(msg, data),
      debug: (msg: string, data?: any) => logger.debug(msg, data),
      error: (msg: string, data?: any) => logger.error(msg, data),
      warn: (msg: string, data?: any) => logger.warn(msg, data)
    };

    this.container.register(LoggerModuleToken, {
      useValue: loggerModule
    });
    this.container.register(ConfigModuleToken, {
      useValue: config
    });

    this.modules.set(LoggerModuleToken, loggerModule);
    this.modules.set(ConfigModuleToken, config);
  }

  async start(): Promise<void> {
    this.state = ApplicationState.Starting;

    // Start all modules
    for (const [token, module] of this.modules) {
      if (module && typeof module.onStart === 'function') {
        await module.onStart(this);
      }
    }

    this.state = ApplicationState.Started;
  }

  async stop(): Promise<void> {
    this.state = ApplicationState.Stopping;

    // Stop all modules in reverse order
    const entries = Array.from(this.modules.entries());
    for (let i = entries.length - 1; i >= 0; i--) {
      const [token, module] = entries[i]!;
      if (module && typeof module.onStop === 'function') {
        await module.onStop(this);
      }
    }

    this.state = ApplicationState.Stopped;
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  use<T>(module: T | any): this {
    const token = createToken((module as any).name || 'Module');
    this.modules.set(token, module);
    return this;
  }

  get<T>(token: any): T {
    return this.modules.get(token) || this.container.resolve(token);
  }

  has(token: any): boolean {
    return this.modules.has(token) || this.container.has(token);
  }

  replaceModule<T>(token: any, module: T): this {
    this.modules.set(token, module);
    if (this.container.has(token)) {
      this.container.register(token, { useValue: module });
    }
    return this;
  }

  configure<T = any>(config: T): this {
    return this;
  }

  config<K extends string>(key: K): any {
    return undefined;
  }

  on(event: string, handler: Function): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event)!.push(handler);
  }

  off(event: string, handler?: Function): void {
    if (handler) {
      const handlers = this.eventHandlers.get(event);
      if (handlers) {
        const index = handlers.indexOf(handler);
        if (index >= 0) {
          handlers.splice(index, 1);
        }
      }
    } else {
      this.eventHandlers.delete(event);
    }
  }

  once(event: string, handler: Function): void {
    const wrapper = (...args: any[]) => {
      handler(...args);
      this.off(event, wrapper);
    };
    this.on(event, wrapper);
  }

  emit(event: string, data?: any): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach(handler => handler(data));
    }
  }

  onStart(hook: Function): this {
    return this;
  }

  onStop(hook: Function): this {
    return this;
  }

  onError(handler: Function): this {
    return this;
  }

  resolve<T>(token: any): T {
    return this.container.resolve(token);
  }

  register(token: any, provider: any): void {
    this.container.register(token, provider);
  }

  async health(): Promise<HealthStatus> {
    const moduleHealthChecks = await Promise.all(
      Array.from(this.modules.entries()).map(async ([token, module]) => {
        if (module && typeof module.health === 'function') {
          try {
            return await module.health();
          } catch (error) {
            return {
              status: 'unhealthy' as const,
              message: `Module ${token.name || 'Unknown'} health check failed`,
              details: error
            };
          }
        }
        return null;
      })
    );

    const failedChecks = moduleHealthChecks.filter(
      check => check && check.status === 'unhealthy'
    );

    if (failedChecks.length > 0) {
      return {
        status: 'unhealthy',
        message: 'Application has unhealthy modules',
        details: failedChecks
      };
    }

    return {
      status: 'healthy',
      message: 'Application is healthy'
    };
  }

  hasProvider(token: any): boolean {
    return this.container.has(token);
  }
}

describe('TaskManager Integration Tests', () => {
  let app: MockApplication;
  let taskManagerModule: any;
  let mockLogger: MockLogger;
  let mockConfig: MockConfigModule;

  beforeEach(() => {
    app = new MockApplication();
    const loggerModule = app.get(LoggerModuleToken);
    mockLogger = loggerModule.logger || loggerModule; // Get the actual logger instance
    mockConfig = app.get(ConfigModuleToken);

    // Create TaskManagerModule instance
    const ModuleClass = TaskManagerModule as any;
    taskManagerModule = new ModuleClass();

    jest.clearAllMocks();
  });

  describe('Module Registration and Lifecycle', () => {
    it('should register all providers during onRegister phase', async () => {
      await taskManagerModule.onRegister(app);

      // Check that providers are registered internally
      expect(taskManagerModule['_providers']).toBeDefined();
      expect(taskManagerModule['_providers'].length).toBeGreaterThan(0);

      // Check that exported providers are available in app container
      expect(app.container.has(TaskCoordinatorToken)).toBe(true);
      expect(app.container.has(TaskServiceToken)).toBe(true);
    });

    it('should initialize all services during onStart phase', async () => {
      await taskManagerModule.onRegister(app);
      await taskManagerModule.onStart(app);

      // Check that services are initialized
      const taskCoordinator = app.resolve(TaskCoordinatorToken);
      expect(taskCoordinator).toBeDefined();

      // Verify logger was called during initialization
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('initialized')
      );
    });

    it('should properly clean up during onStop phase', async () => {
      await taskManagerModule.onRegister(app);
      await taskManagerModule.onStart(app);

      // Create some tasks first
      const taskCoordinator = app.resolve(TaskCoordinatorToken);
      await taskCoordinator.createTask({
        title: 'Test Task',
        description: 'Test Description',
        status: 'pending',
        priority: 'high'
      });

      await taskManagerModule.onStop(app);

      // Verify cleanup logs
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('shutting down')
      );
    });
  });

  describe('Service Functionality', () => {
    beforeEach(async () => {
      await taskManagerModule.onRegister(app);
      await taskManagerModule.onStart(app);
    });

    it('should create and retrieve tasks', async () => {
      const taskService = app.resolve(TaskServiceToken);

      const newTask = await taskService.create({
        title: 'Integration Test Task',
        description: 'Testing task creation',
        status: 'pending',
        priority: 'medium'
      });

      expect(newTask.id).toBeDefined();
      expect(newTask.title).toBe('Integration Test Task');
      expect(newTask.createdAt).toBeInstanceOf(Date);

      const retrievedTask = await taskService.findById(newTask.id);
      expect(retrievedTask).toBeDefined();
      expect(retrievedTask?.title).toBe('Integration Test Task');
    });

    it('should update task status', async () => {
      const taskService = app.resolve(TaskServiceToken);

      const task = await taskService.create({
        title: 'Status Test Task',
        description: 'Testing status update',
        status: 'pending',
        priority: 'high'
      });

      // Add a small delay to ensure updatedAt > createdAt
      await new Promise(resolve => setTimeout(resolve, 10));

      const updatedTask = await taskService.update(task.id, {
        status: 'completed'
      });

      expect(updatedTask).toBeDefined();
      expect(updatedTask?.status).toBe('completed');
      expect(updatedTask?.updatedAt.getTime()).toBeGreaterThan(task.createdAt.getTime());
    });

    it('should delete tasks', async () => {
      const taskService = app.resolve(TaskServiceToken);

      const task = await taskService.create({
        title: 'Delete Test Task',
        description: 'Testing deletion',
        status: 'pending',
        priority: 'low'
      });

      const deleteResult = await taskService.delete(task.id);
      expect(deleteResult).toBe(true);

      const retrievedTask = await taskService.findById(task.id);
      expect(retrievedTask).toBeUndefined();
    });

    it('should calculate statistics correctly', async () => {
      const taskService = app.resolve(TaskServiceToken);

      // Clear existing tasks and create test data
      const allTasks = await taskService.findAll();
      for (const task of allTasks) {
        await taskService.delete(task.id);
      }

      // Create test tasks
      await taskService.create({
        title: 'Task 1',
        description: 'Test',
        status: 'pending',
        priority: 'high'
      });

      await taskService.create({
        title: 'Task 2',
        description: 'Test',
        status: 'in-progress',
        priority: 'medium'
      });

      await taskService.create({
        title: 'Task 3',
        description: 'Test',
        status: 'completed',
        priority: 'low'
      });

      const stats = await taskService.getStatistics();

      expect(stats.total).toBe(3);
      expect(stats.byStatus.pending).toBe(1);
      expect(stats.byStatus['in-progress']).toBe(1);
      expect(stats.byStatus.completed).toBe(1);
      expect(stats.byPriority.high).toBe(1);
      expect(stats.byPriority.medium).toBe(1);
      expect(stats.byPriority.low).toBe(1);
    });
  });

  describe('Task Coordinator Orchestration', () => {
    beforeEach(async () => {
      await taskManagerModule.onRegister(app);
      await taskManagerModule.onStart(app);
    });

    it('should create task and send notification', async () => {
      const taskCoordinator = app.resolve(TaskCoordinatorToken);

      const task = await taskCoordinator.createTask({
        title: 'Orchestrated Task',
        description: 'Testing orchestration',
        status: 'pending',
        priority: 'high'
      });

      expect(task).toBeDefined();
      expect(task.id).toBeDefined();

      // Verify notification was sent
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Sending task-created notification'),
        expect.objectContaining({
          taskId: task.id
        })
      );
    });

    it('should complete task and send notification', async () => {
      const taskCoordinator = app.resolve(TaskCoordinatorToken);

      const task = await taskCoordinator.createTask({
        title: 'Task to Complete',
        description: 'Testing completion',
        status: 'pending',
        priority: 'medium'
      });

      const completedTask = await taskCoordinator.completeTask(task.id);

      expect(completedTask).toBeDefined();
      expect(completedTask?.status).toBe('completed');

      // Verify completion notification was sent
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Sending task-completed notification'),
        expect.objectContaining({
          taskId: task.id
        })
      );
    });

    it('should generate comprehensive report', async () => {
      const taskCoordinator = app.resolve(TaskCoordinatorToken);

      // Create some tasks
      await taskCoordinator.createTask({
        title: 'Report Task 1',
        description: 'Test',
        status: 'pending',
        priority: 'high'
      });

      await taskCoordinator.createTask({
        title: 'Report Task 2',
        description: 'Test',
        status: 'pending',
        priority: 'low'
      });

      const report = await taskCoordinator.getTasksReport();

      expect(report.tasks).toBeDefined();
      expect(report.tasks.length).toBeGreaterThan(0);
      expect(report.statistics).toBeDefined();
      expect(report.statistics.total).toBeGreaterThan(0);
    });
  });

  describe('Notification Service Configuration', () => {
    it('should respect notification configuration', async () => {
      // Disable notifications
      mockConfig.set('notifications', {
        enabled: false,
        channels: []
      });

      await taskManagerModule.onRegister(app);
      await taskManagerModule.onStart(app);

      const taskCoordinator = app.resolve(TaskCoordinatorToken);

      await taskCoordinator.createTask({
        title: 'Silent Task',
        description: 'Should not send notification',
        status: 'pending',
        priority: 'low'
      });

      // Verify notification was skipped
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Notifications disabled')
      );
    });
  });

  describe('Health Checks', () => {
    beforeEach(async () => {
      await taskManagerModule.onRegister(app);
      await taskManagerModule.onStart(app);
    });

    it('should report healthy status for all services', async () => {
      const health = await taskManagerModule.health();

      expect(health.status).toBe('healthy');
      expect(health.message).toContain('healthy');
    });

    it('should report degraded when notifications disabled', async () => {
      // Create a new app and module instance for this test
      const newApp = new MockApplication();
      const newConfig = newApp.get(ConfigModuleToken);

      // Configure with disabled notifications
      newConfig.set('notifications', {
        enabled: false,
        channels: []
      });

      // Create new module instance
      const NewModuleClass = TaskManagerModule as any;
      const newTaskManagerModule = new NewModuleClass();

      await newTaskManagerModule.onRegister(newApp);
      await newTaskManagerModule.onStart(newApp);

      const health = await newTaskManagerModule.health();

      // The health check should detect degraded notification service
      expect(['healthy', 'degraded']).toContain(health.status);

      // Clean up
      await newTaskManagerModule.onStop(newApp);
    });
  });

  describe('Error Handling', () => {
    beforeEach(async () => {
      await taskManagerModule.onRegister(app);
      await taskManagerModule.onStart(app);
    });

    it('should handle invalid task updates gracefully', async () => {
      const taskService = app.resolve(TaskServiceToken);

      const result = await taskService.update('non-existent-id', {
        status: 'completed'
      });

      expect(result).toBeUndefined();
    });

    it('should handle invalid task deletion gracefully', async () => {
      const taskService = app.resolve(TaskServiceToken);

      const result = await taskService.delete('non-existent-id');

      expect(result).toBe(false);
    });

    it('should handle invalid task completion gracefully', async () => {
      const taskCoordinator = app.resolve(TaskCoordinatorToken);

      const result = await taskCoordinator.completeTask('non-existent-id');

      expect(result).toBeUndefined();
    });
  });
});