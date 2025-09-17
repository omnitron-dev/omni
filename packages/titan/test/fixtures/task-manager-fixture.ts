/**
 * Task Manager Test Fixture
 * This file contains the task manager components used for testing.
 * It is separated from the examples to maintain clean test boundaries.
 */

import { createToken } from '@omnitron-dev/nexus';
import {
  Injectable,
  Inject,
  Singleton,
  OnInit,
  OnDestroy,
  IApplication,
  HealthStatus
} from '../../src/index';
import { LoggerModuleToken, ILogger as Logger } from '../../src/modules/logger.module';
import { ConfigModuleToken } from '../../src/modules/config.module';
import { Module } from '../../src/enhanced-module';

// ============================
// Domain Models
// ============================

interface Task {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'in-progress' | 'completed';
  priority: 'low' | 'medium' | 'high';
  createdAt: Date;
  updatedAt: Date;
}

// ============================
// Service Tokens
// ============================

export const TaskServiceToken = createToken<TaskService>('TaskService');
export const NotificationServiceToken = createToken<NotificationService>('NotificationService');
export const TaskCoordinatorToken = createToken<TaskCoordinator>('TaskCoordinator');
export const TaskRepositoryToken = createToken<TaskRepository>('TaskRepository');

// ============================
// Repository Layer
// ============================

@Injectable()
@Singleton()
export class TaskRepository implements OnInit, OnDestroy {
  private tasks: Map<string, Task> = new Map();
  private logger!: Logger;

  constructor(
    @Inject(LoggerModuleToken) private loggerModule: any
  ) {
    // Add safety check for tests
    if (this.loggerModule && typeof this.loggerModule.child === 'function') {
      this.logger = this.loggerModule.child({ service: 'TaskRepository' });
    } else {
      console.warn('LoggerModule not properly injected in TaskRepository');
      // Create a mock logger for testing
      this.logger = {
        info: (msg: string) => console.log(`[TaskRepository] ${msg}`),
        debug: (msg: string) => console.debug(`[TaskRepository] ${msg}`),
        warn: (msg: string) => console.warn(`[TaskRepository] ${msg}`),
        error: (msg: string) => console.error(`[TaskRepository] ${msg}`)
      } as any;
    }
  }

  async onInit(): Promise<void> {
    this.logger.info('TaskRepository initialized');
    await this.seedData();
  }

  async onDestroy(): Promise<void> {
    this.logger.info('TaskRepository shutting down, saving data...');
    this.tasks.clear();
  }

  private async seedData(): Promise<void> {
    const seedTasks: Task[] = [
      {
        id: '1',
        title: 'Setup project',
        description: 'Initialize project structure',
        status: 'completed',
        priority: 'high',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-02')
      },
      {
        id: '2',
        title: 'Implement features',
        description: 'Build core functionality',
        status: 'in-progress',
        priority: 'high',
        createdAt: new Date('2024-01-03'),
        updatedAt: new Date('2024-01-10')
      }
    ];

    seedTasks.forEach(task => this.tasks.set(task.id, task));
    this.logger.debug(`Seeded ${this.tasks.size} tasks`);
  }

  async save(task: Task): Promise<void> {
    this.tasks.set(task.id, task);
  }

  async findById(id: string): Promise<Task | undefined> {
    return this.tasks.get(id);
  }

  async findAll(): Promise<Task[]> {
    return Array.from(this.tasks.values());
  }

  async delete(id: string): Promise<boolean> {
    return this.tasks.delete(id);
  }

  async health(): Promise<HealthStatus> {
    return {
      status: 'healthy',
      message: 'Repository is operational',
      details: { taskCount: this.tasks.size }
    };
  }
}

// ============================
// Service Layer
// ============================

@Injectable()
@Singleton()
export class TaskService implements OnInit {
  private logger!: Logger;

  constructor(
    @Inject(TaskRepositoryToken) private repository: TaskRepository,
    @Inject(LoggerModuleToken) private loggerModule: any
  ) {
    // Add safety check for tests
    if (this.loggerModule && typeof this.loggerModule.child === 'function') {
      this.logger = this.loggerModule.child({ service: 'TaskService' });
    } else {
      console.warn('LoggerModule not properly injected in TaskService');
      this.logger = {
        info: (msg: string) => console.log(`[TaskService] ${msg}`),
        debug: (msg: string) => console.debug(`[TaskService] ${msg}`),
        warn: (msg: string) => console.warn(`[TaskService] ${msg}`),
        error: (msg: string) => console.error(`[TaskService] ${msg}`)
      } as any;
    }
  }

  async onInit(): Promise<void> {
    this.logger.info('TaskService initialized');
  }

  async create(taskData: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>): Promise<Task> {
    const task: Task = {
      ...taskData,
      id: this.generateId(),
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await this.repository.save(task);
    this.logger.info(`Task created: ${task.title}`);
    return task;
  }

  async findById(id: string): Promise<Task | undefined> {
    return this.repository.findById(id);
  }

  async findAll(): Promise<Task[]> {
    return this.repository.findAll();
  }

  async update(id: string, updates: Partial<Task>): Promise<Task | undefined> {
    const task = await this.repository.findById(id);
    if (!task) return undefined;

    const updatedTask: Task = {
      ...task,
      ...updates,
      id: task.id,
      createdAt: task.createdAt,
      updatedAt: new Date()
    };

    await this.repository.save(updatedTask);
    this.logger.info(`Task updated: ${updatedTask.title}`);
    return updatedTask;
  }

  async delete(id: string): Promise<boolean> {
    const task = await this.repository.findById(id);
    if (!task) return false;

    const deleted = await this.repository.delete(id);
    if (deleted) {
      this.logger.info(`Task deleted: ${task.title}`);
    }
    return deleted;
  }

  private generateId(): string {
    return Math.random().toString(36).substr(2, 9);
  }

  async getStatistics(): Promise<{
    total: number;
    byStatus: Record<Task['status'], number>;
    byPriority: Record<Task['priority'], number>;
  }> {
    const tasks = await this.repository.findAll();

    const stats = {
      total: tasks.length,
      byStatus: {
        pending: 0,
        'in-progress': 0,
        completed: 0
      },
      byPriority: {
        low: 0,
        medium: 0,
        high: 0
      }
    };

    tasks.forEach(task => {
      stats.byStatus[task.status]++;
      stats.byPriority[task.priority]++;
    });

    return stats;
  }

  async health(): Promise<HealthStatus> {
    const stats = await this.getStatistics();
    return {
      status: 'healthy',
      message: 'TaskService is operational',
      details: stats
    };
  }
}

// ============================
// Notification Service
// ============================

@Injectable()
@Singleton()
export class NotificationService implements OnInit {
  private logger!: Logger;
  private config: any = {};

  constructor(
    @Inject(LoggerModuleToken) private loggerModule: any,
    @Inject(ConfigModuleToken) private configModule: any
  ) {
    // Add safety check for tests
    if (this.loggerModule && typeof this.loggerModule.child === 'function') {
      this.logger = this.loggerModule.child({ service: 'NotificationService' });
    } else {
      console.warn('LoggerModule not properly injected in NotificationService');
      this.logger = {
        info: (msg: string) => console.log(`[NotificationService] ${msg}`),
        debug: (msg: string) => console.debug(`[NotificationService] ${msg}`),
        warn: (msg: string) => console.warn(`[NotificationService] ${msg}`),
        error: (msg: string) => console.error(`[NotificationService] ${msg}`)
      } as any;
    }
  }

  async onInit(): Promise<void> {
    if (this.configModule && typeof this.configModule.get === 'function') {
      this.config = this.configModule.get('notifications', {
        enabled: true,
        channels: ['email', 'push']
      });
    } else {
      console.warn('ConfigModule not properly injected in NotificationService');
      this.config = {
        enabled: true,
        channels: ['email', 'push']
      };
    }
    this.logger.info('NotificationService initialized', this.config);
  }

  async sendNotification(type: string, data: any): Promise<void> {
    if (!this.config.enabled) {
      this.logger.debug(`Notifications disabled, skipping ${type}`);
      return;
    }

    this.logger.info(`Sending ${type} notification`, data);
    // Simulate async operation
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  async notifyTaskCreated(task: Task): Promise<void> {
    await this.sendNotification('task-created', {
      taskId: task.id,
      title: task.title
    });
  }

  async notifyTaskCompleted(task: Task): Promise<void> {
    await this.sendNotification('task-completed', {
      taskId: task.id,
      title: task.title
    });
  }

  async health(): Promise<HealthStatus> {
    return {
      status: this.config.enabled ? 'healthy' : 'degraded',
      message: this.config.enabled ?
        'NotificationService is operational' :
        'NotificationService is disabled',
      details: this.config
    };
  }
}

// ============================
// Task Coordinator
// ============================

@Injectable()
@Singleton()
export class TaskCoordinator implements OnInit {
  private logger!: Logger;

  constructor(
    @Inject(TaskServiceToken) private taskService: TaskService,
    @Inject(NotificationServiceToken) private notificationService: NotificationService,
    @Inject(LoggerModuleToken) private loggerModule: any
  ) {
    // Add safety check for tests
    if (this.loggerModule && typeof this.loggerModule.child === 'function') {
      this.logger = this.loggerModule.child({ service: 'TaskCoordinator' });
    } else {
      console.warn('LoggerModule not properly injected in TaskCoordinator');
      this.logger = {
        info: (msg: string) => console.log(`[TaskCoordinator] ${msg}`),
        debug: (msg: string) => console.debug(`[TaskCoordinator] ${msg}`),
        warn: (msg: string) => console.warn(`[TaskCoordinator] ${msg}`),
        error: (msg: string) => console.error(`[TaskCoordinator] ${msg}`)
      } as any;
    }
  }

  async onInit(): Promise<void> {
    this.logger.info('TaskCoordinator initialized');
  }

  async createTask(taskData: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>): Promise<Task> {
    this.logger.debug('Creating task via coordinator');

    const task = await this.taskService.create(taskData);
    await this.notificationService.notifyTaskCreated(task);

    return task;
  }

  async completeTask(taskId: string): Promise<Task | undefined> {
    this.logger.debug(`Completing task ${taskId}`);

    const task = await this.taskService.update(taskId, {
      status: 'completed'
    });

    if (task) {
      await this.notificationService.notifyTaskCompleted(task);
    }

    return task;
  }

  async getTasksReport(): Promise<{
    tasks: Task[];
    statistics: any;
  }> {
    const tasks = await this.taskService.findAll();
    const statistics = await this.taskService.getStatistics();

    return { tasks, statistics };
  }

  async health(): Promise<HealthStatus> {
    return {
      status: 'healthy',
      message: 'TaskCoordinator is operational'
    };
  }
}

// ============================
// Task Manager Module
// ============================

@Module({
  name: 'task-manager',
  version: '2.0.0',
  dependencies: [LoggerModuleToken, ConfigModuleToken],
  providers: [
    {
      provide: TaskRepositoryToken,
      useFactory: (loggerModule: any) => new TaskRepository(loggerModule),
      inject: [LoggerModuleToken],
      scope: 'singleton'
    },
    {
      provide: TaskServiceToken,
      useFactory: (repository: TaskRepository, loggerModule: any) => new TaskService(repository, loggerModule),
      inject: [TaskRepositoryToken, LoggerModuleToken],
      scope: 'singleton'
    },
    {
      provide: NotificationServiceToken,
      useFactory: (loggerModule: any, configModule: any) => new NotificationService(loggerModule, configModule),
      inject: [LoggerModuleToken, ConfigModuleToken],
      scope: 'singleton'
    },
    {
      provide: TaskCoordinatorToken,
      useFactory: (taskService: TaskService, notificationService: NotificationService, loggerModule: any) =>
        new TaskCoordinator(taskService, notificationService, loggerModule),
      inject: [TaskServiceToken, NotificationServiceToken, LoggerModuleToken],
      scope: 'singleton'
    }
  ],
  exports: [TaskCoordinatorToken, TaskServiceToken] // Only expose public API
})
export class TaskManagerModule {
  private logger?: Logger;

  async onStart(app: IApplication): Promise<void> {
    const loggerModule = app.get(LoggerModuleToken);
    this.logger = loggerModule.child({ module: 'TaskManager' });
    this.logger.info('TaskManagerModule started successfully');
  }

  async onStop(app: IApplication): Promise<void> {
    this.logger?.info('TaskManagerModule stopped');
  }
}