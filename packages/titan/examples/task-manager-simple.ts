/**
 * Task Manager Application - Demonstrates improved Titan DI architecture
 *
 * This example shows:
 * - Proper dependency injection through constructors
 * - Module-based architecture with providers
 * - Automatic lifecycle management
 * - Clean separation of concerns
 * - Type-safe dependency resolution
 * - NEW: Public container API instead of private access
 * - NEW: Class reference module registration (no 'new' needed)
 */

import { createToken } from '@omnitron-dev/nexus';
import {
  TitanApplication,
  Service,
  Injectable,
  Inject,
  Singleton,
  OnInit,
  OnDestroy,
  Logger,
  LoggerModule,
  LoggerModuleToken,
  ConfigModule,
  ConfigModuleToken,
  EnhancedApplicationModule,
  type ModuleMetadata as EnhancedModuleMetadata,
  type Module as IModule,
  type IApplication
} from '../src/index';

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

// ============================
// Services with Proper DI
// ============================

/**
 * Task Service - Core business logic with proper DI
 */
@Injectable()
@Singleton()
@Service('TaskService@1.0.0')
class TaskService implements OnInit, OnDestroy {
  private tasks: Map<string, Task> = new Map();
  private logger!: Logger;

  constructor(
    @Inject(LoggerModuleToken) private loggerModule: LoggerModule
  ) {
    // Logger is properly injected with correct type
    this.logger = this.loggerModule.logger.child({ service: 'TaskService' });
  }

  async onInit(): Promise<void> {
    this.logger.info('TaskService initialized');
    await this.loadMockTasks();
  }

  async onDestroy(): Promise<void> {
    this.logger.info('TaskService shutting down');
    // Save tasks or perform cleanup
  }

  private async loadMockTasks(): Promise<void> {
    const mockTasks: Task[] = [
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

    mockTasks.forEach(task => this.tasks.set(task.id, task));
    this.logger.debug(`Loaded ${this.tasks.size} tasks`);
  }

  async create(taskData: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>): Promise<Task> {
    const task: Task = {
      ...taskData,
      id: this.generateId(),
      createdAt: new Date(),
      updatedAt: new Date()
    };

    this.tasks.set(task.id, task);
    this.logger.info(`Task created: ${task.title}`);
    return task;
  }

  async findById(id: string): Promise<Task | undefined> {
    return this.tasks.get(id);
  }

  async findAll(): Promise<Task[]> {
    return Array.from(this.tasks.values());
  }

  async update(id: string, updates: Partial<Task>): Promise<Task | undefined> {
    const task = this.tasks.get(id);
    if (!task) return undefined;

    const updatedTask = {
      ...task,
      ...updates,
      id: task.id,
      createdAt: task.createdAt,
      updatedAt: new Date()
    };

    this.tasks.set(id, updatedTask);
    this.logger.info(`Task updated: ${updatedTask.title}`);
    return updatedTask;
  }

  async delete(id: string): Promise<boolean> {
    const task = this.tasks.get(id);
    if (!task) return false;

    this.tasks.delete(id);
    this.logger.info(`Task deleted: ${task.title}`);
    return true;
  }

  private generateId(): string {
    return Math.random().toString(36).substr(2, 9);
  }

  async getStatistics(): Promise<{
    total: number;
    byStatus: Record<Task['status'], number>;
    byPriority: Record<Task['priority'], number>;
  }> {
    const tasks = Array.from(this.tasks.values());

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
}

/**
 * Notification Service with proper DI
 */
@Injectable()
@Singleton()
@Service('NotificationService@1.0.0')
class NotificationService implements OnInit {
  private logger!: Logger;

  constructor(
    @Inject(LoggerModuleToken) private loggerModule: LoggerModule,
    @Inject(ConfigModuleToken) private configModule: ConfigModule
  ) {
    // Dependencies are properly injected with correct types
    this.logger = this.loggerModule.logger.child({ service: 'NotificationService' });
  }

  async onInit(): Promise<void> {
    const notificationConfig = this.configModule.get('notifications', {
      enabled: true,
      channels: ['email', 'push']
    });
    this.logger.info({ config: notificationConfig }, 'NotificationService initialized');
  }

  async sendNotification(type: string, data: any): Promise<void> {
    this.logger.info(`Sending ${type} notification`, data);
    // In a real app, this would send emails, push notifications, etc.

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
}

/**
 * Task Coordinator - Orchestrates task operations with proper DI
 */
@Injectable()
@Singleton()
class TaskCoordinator implements OnInit {
  private logger!: Logger;

  constructor(
    @Inject(TaskServiceToken) private taskService: TaskService,
    @Inject(NotificationServiceToken) private notificationService: NotificationService,
    @Inject(LoggerModuleToken) private loggerModule: LoggerModule
  ) {
    // All dependencies are properly injected with correct types
    this.logger = this.loggerModule.logger.child({ service: 'TaskCoordinator' });
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
}

// ============================
// Task Manager Module
// ============================

/**
 * TaskManagerModule - Properly structured module with automatic provider management
 * Uses EnhancedApplicationModule for proper module-scoped registration
 */
class TaskManagerModule extends EnhancedApplicationModule {
  constructor() {
    super({
      name: 'task-manager',
      version: '1.0.0',
      dependencies: [LoggerModuleToken, ConfigModuleToken],
      providers: [
        [TaskServiceToken, { useClass: TaskService, scope: 'singleton' }],
        [NotificationServiceToken, { useClass: NotificationService, scope: 'singleton' }],
        [TaskCoordinatorToken, { useClass: TaskCoordinator, scope: 'singleton' }]
      ],
      // Export these services so other modules can use them
      exports: [TaskServiceToken, NotificationServiceToken, TaskCoordinatorToken]
    });
  }

  /**
   * Module-specific startup logic
   * The EnhancedApplicationModule handles provider initialization automatically
   */
  protected override async onModuleStart(app: IApplication): Promise<void> {
    const logger = app.get(LoggerModuleToken).logger;
    logger.info({ module: this.name }, 'TaskManagerModule started successfully');

    // Any additional module-specific startup logic can go here
    // Provider initialization (OnInit) is handled automatically by the base class
  }

  /**
   * Module-specific cleanup logic
   * The EnhancedApplicationModule handles provider cleanup automatically
   */
  protected override async onModuleStop(app: IApplication): Promise<void> {
    const logger = app.get(LoggerModuleToken).logger;
    logger.info({ module: this.name }, 'TaskManagerModule stopping...');

    // Any additional module-specific cleanup logic can go here
    // Provider cleanup (OnDestroy) is handled automatically by the base class
  }
}

// ============================
// Application Configuration
// ============================

const appConfig = {
  name: 'TaskManagerApp',
  version: '1.0.0',
  debug: true,
  // Configuration for core modules
  config: {
    app: {
      name: 'TaskManager',
      environment: process.env['NODE_ENV'] || 'development'
    },
    database: {
      host: 'localhost',
      port: 5432
    },
    notifications: {
      enabled: true,
      channels: ['email', 'push', 'sms']
    }
  },
  logging: {
    level: 'debug',
    prettyPrint: true
  },
  // Register our custom module - now can use class reference instead of instance!
  modules: [TaskManagerModule]  // Improved: no need for 'new TaskManagerModule()'
};

// ============================
// Application Bootstrap
// ============================

async function bootstrap() {
  console.log('Starting Task Manager Application...\n');

  // Create application with proper module registration
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

  // Start the application - this will initialize all modules and their providers
  await app.start();

  console.log('\n=== Task Manager Application Started ===\n');

  // Get services from DI container using the public API
  const taskCoordinator = app.resolve(TaskCoordinatorToken);
  const taskService = app.resolve(TaskServiceToken);

  // Demo: Create a new task
  console.log('Creating a new task...');
  const newTask = await taskCoordinator.createTask({
    title: 'Implement caching',
    description: 'Add Redis caching layer',
    status: 'pending',
    priority: 'high'
  });
  console.log('Task created:', newTask);

  // Demo: Complete a task
  console.log('\nCompleting task...');
  const completedTask = await taskCoordinator.completeTask(newTask.id);
  console.log('Task completed:', completedTask);

  // Demo: Get all tasks
  console.log('\nAll tasks:');
  const allTasks = await taskService.findAll();
  allTasks.forEach(task => {
    console.log(`  - ${task.title} (${task.status})`);
  });

  // Demo: Get full report
  console.log('\nTask Report:');
  const report = await taskCoordinator.getTasksReport();
  console.log('Total tasks:', report.statistics.total);
  console.log('By status:', report.statistics.byStatus);
  console.log('By priority:', report.statistics.byPriority);

  console.log('\n=== Demo Complete ===');
  console.log('Application is running. Press Ctrl+C to stop.\n');
}

// Run when executed directly
if (require.main === module) {
  bootstrap().catch(error => {
    console.error('Failed to start application:', error);
    process.exit(1);
  });
}

// Export for testing
export {
  bootstrap,
  TaskManagerModule,
  TaskService,
  NotificationService,
  TaskCoordinator,
  TaskServiceToken,
  NotificationServiceToken,
  TaskCoordinatorToken
};