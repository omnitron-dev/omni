/**
 * Enhanced Task Manager Application - Demonstrates improved Titan module architecture
 *
 * Key improvements:
 * - Module decorator with declarative provider configuration
 * - Automatic lifecycle management for all providers
 * - Type-safe dependency resolution
 * - Proper separation of registration and initialization phases
 * - No manual provider registration or lifecycle calls
 */

import { createToken } from '@nexus';
import {
  TitanApplication,
  Injectable,
  Inject,
  Singleton,
  OnInit,
  OnDestroy,
  Logger,
  LOGGER_SERVICE_TOKEN,
  CONFIG_SERVICE_TOKEN,
  IApplication,
  HealthStatus,
} from '../src/index';
import { Module, EnhancedApplicationModule } from '../src/enhanced-module';

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

const TaskServiceToken = createToken<TaskService>('TaskService');
const NotificationServiceToken = createToken<NotificationService>('NotificationService');
const TaskCoordinatorToken = createToken<TaskCoordinator>('TaskCoordinator');
const TaskRepositoryToken = createToken<TaskRepository>('TaskRepository');

// ============================
// Repository Layer (New)
// ============================

/**
 * Task Repository - Data access layer
 */
@Injectable()
@Singleton()
class TaskRepository implements OnInit, OnDestroy {
  private tasks: Map<string, Task> = new Map();
  private logger!: Logger;

  constructor(@Inject(LOGGER_SERVICE_TOKEN) private loggerModule: any) {
    this.logger = this.loggerModule.child({ service: 'TaskRepository' });
  }

  async onInit(): Promise<void> {
    this.logger.info('TaskRepository initialized');
    await this.seedData();
  }

  async onDestroy(): Promise<void> {
    this.logger.info('TaskRepository shutting down, saving data...');
    // In production, this would persist to database
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
        updatedAt: new Date('2024-01-02'),
      },
      {
        id: '2',
        title: 'Implement features',
        description: 'Build core functionality',
        status: 'in-progress',
        priority: 'high',
        createdAt: new Date('2024-01-03'),
        updatedAt: new Date('2024-01-10'),
      },
    ];

    seedTasks.forEach((task) => this.tasks.set(task.id, task));
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
      details: { taskCount: this.tasks.size },
    };
  }
}

// ============================
// Service Layer
// ============================

/**
 * Task Service - Business logic layer
 */
@Injectable()
@Singleton()
class TaskService implements OnInit {
  private logger!: Logger;

  constructor(
    @Inject(TaskRepositoryToken) private repository: TaskRepository,
    @Inject(LOGGER_SERVICE_TOKEN) private loggerModule: any
  ) {
    this.logger = this.loggerModule.child({ service: 'TaskService' });
  }

  async onInit(): Promise<void> {
    this.logger.info('TaskService initialized');
  }

  async create(taskData: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>): Promise<Task> {
    const task: Task = {
      ...taskData,
      id: this.generateId(),
      createdAt: new Date(),
      updatedAt: new Date(),
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
      updatedAt: new Date(),
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
        completed: 0,
      },
      byPriority: {
        low: 0,
        medium: 0,
        high: 0,
      },
    };

    tasks.forEach((task) => {
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
      details: stats,
    };
  }
}

/**
 * Notification Service
 */
@Injectable()
@Singleton()
class NotificationService implements OnInit {
  private logger!: Logger;
  private config: any = {};

  constructor(
    @Inject(LOGGER_SERVICE_TOKEN) private loggerModule: any,
    @Inject(CONFIG_SERVICE_TOKEN) private configModule: any
  ) {
    this.logger = this.loggerModule.child({ service: 'NotificationService' });
  }

  async onInit(): Promise<void> {
    this.config = this.configModule.get('notifications', {
      enabled: true,
      channels: ['email', 'push'],
    });
    this.logger.info('NotificationService initialized', this.config);
  }

  async sendNotification(type: string, data: any): Promise<void> {
    if (!this.config.enabled) {
      this.logger.debug(`Notifications disabled, skipping ${type}`);
      return;
    }

    this.logger.info(`Sending ${type} notification`, data);
    // Simulate async operation
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  async notifyTaskCreated(task: Task): Promise<void> {
    await this.sendNotification('task-created', {
      taskId: task.id,
      title: task.title,
    });
  }

  async notifyTaskCompleted(task: Task): Promise<void> {
    await this.sendNotification('task-completed', {
      taskId: task.id,
      title: task.title,
    });
  }

  async health(): Promise<HealthStatus> {
    return {
      status: this.config.enabled ? 'healthy' : 'degraded',
      message: this.config.enabled ? 'NotificationService is operational' : 'NotificationService is disabled',
      details: this.config,
    };
  }
}

/**
 * Task Coordinator - Orchestration layer
 */
@Injectable()
@Singleton()
class TaskCoordinator implements OnInit {
  private logger!: Logger;

  constructor(
    @Inject(TaskServiceToken) private taskService: TaskService,
    @Inject(NotificationServiceToken) private notificationService: NotificationService,
    @Inject(LOGGER_SERVICE_TOKEN) private loggerModule: any
  ) {
    this.logger = this.loggerModule.child({ service: 'TaskCoordinator' });
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
      status: 'completed',
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
      message: 'TaskCoordinator is operational',
    };
  }
}

// ============================
// Enhanced Task Manager Module
// ============================

/**
 * TaskManagerModule - Using new enhanced module architecture
 *
 * Key improvements:
 * - Declarative provider configuration
 * - Automatic lifecycle management
 * - Clear dependencies declaration
 * - Export control for public API
 */
@Module({
  name: 'task-manager',
  version: '2.0.0',
  dependencies: [LOGGER_SERVICE_TOKEN, CONFIG_SERVICE_TOKEN],
  providers: [
    [TaskRepositoryToken, { useClass: TaskRepository, scope: 'singleton' }],
    [TaskServiceToken, { useClass: TaskService, scope: 'singleton' }],
    [NotificationServiceToken, { useClass: NotificationService, scope: 'singleton' }],
    [TaskCoordinatorToken, { useClass: TaskCoordinator, scope: 'singleton' }],
  ],
  exports: [TaskCoordinatorToken, TaskServiceToken], // Only expose public API
})
class TaskManagerModule {
  private logger?: Logger;

  /**
   * Optional: Additional module-level initialization
   */
  async onStart(app: IApplication): Promise<void> {
    const loggerModule = app.get(LOGGER_SERVICE_TOKEN);
    this.logger = loggerModule.child({ module: 'TaskManager' });
    this.logger.info('TaskManagerModule started with enhanced architecture');
  }

  /**
   * Optional: Module-level cleanup
   */
  async onStop(app: IApplication): Promise<void> {
    this.logger?.info('TaskManagerModule stopping');
  }
}

// ============================
// Application Configuration
// ============================

const appConfig = {
  name: 'EnhancedTaskManagerApp',
  version: '2.0.0',
  debug: true,
  config: {
    app: {
      name: 'Enhanced Task Manager',
      environment: process.env['NODE_ENV'] || 'development',
    },
    database: {
      host: 'localhost',
      port: 5432,
    },
    notifications: {
      enabled: true,
      channels: ['email', 'push', 'sms'],
      retryAttempts: 3,
    },
  },
  logging: {
    level: 'debug',
    prettyPrint: true,
  },
  // Module registration is now cleaner
  modules: [TaskManagerModule],
};

// ============================
// Application Bootstrap
// ============================

async function bootstrap() {
  console.log('Starting Enhanced Task Manager Application...\n');

  // Create application with enhanced module
  const app = await TitanApplication.create(appConfig);

  // Setup error handling
  app.onError((error: Error) => {
    console.error('Application error:', error);
  });

  // Setup graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('\nSIGTERM received, shutting down gracefully...');
    await app.stop();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    console.log('\nSIGINT received, shutting down gracefully...');
    await app.stop();
    process.exit(0);
  });

  // Start the application
  await app.start();

  console.log('\n=== Enhanced Task Manager Application Started ===\n');

  // Access services through proper DI resolution
  // Note: Only exported services are accessible
  const taskCoordinator = app.resolve(TaskCoordinatorToken);
  const taskService = app.resolve(TaskServiceToken);

  // Demo: Create a new task
  console.log('Creating a new task...');
  const newTask = await taskCoordinator.createTask({
    title: 'Implement enhanced module system',
    description: 'Add automatic provider management',
    status: 'pending',
    priority: 'high',
  });
  console.log('Task created:', newTask);

  // Demo: Complete the task
  console.log('\nCompleting task...');
  const completedTask = await taskCoordinator.completeTask(newTask.id);
  console.log('Task completed:', completedTask);

  // Demo: Get all tasks
  console.log('\nAll tasks:');
  const allTasks = await taskService.findAll();
  allTasks.forEach((task) => {
    console.log(`  - [${task.status}] ${task.title} (Priority: ${task.priority})`);
  });

  // Demo: Get task report
  console.log('\nTask Report:');
  const report = await taskCoordinator.getTasksReport();
  console.log('Statistics:');
  console.log('  Total tasks:', report.statistics.total);
  console.log('  By status:', report.statistics.byStatus);
  console.log('  By priority:', report.statistics.byPriority);

  // Demo: Health check
  console.log('\nPerforming health check...');
  const healthCheck = await app.health();
  console.log('Application health:', healthCheck);

  console.log('\n=== Demo Complete ===');
  console.log('Enhanced application is running. Press Ctrl+C to stop.\n');
}

// Run when executed directly
if (require.main === module) {
  bootstrap().catch((error) => {
    console.error('Failed to start application:', error);
    process.exit(1);
  });
}

// Export for testing
export {
  bootstrap,
  TaskManagerModule,
  TaskService,
  TaskRepository,
  NotificationService,
  TaskCoordinator,
  TaskServiceToken,
  TaskRepositoryToken,
  NotificationServiceToken,
  TaskCoordinatorToken,
};
