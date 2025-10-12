/**
 * Task Manager Application - Demonstrates improved Titan DI architecture
 *
 * This example shows:
 * - New module API with class references and forRoot patterns
 * - Public container API instead of private access
 * - Dynamic modules with providers
 * - Automatic provider registration and lifecycle management
 * - Clean separation of concerns with improved DX
 */

import { createToken } from '@nexus';
import {
  TitanApplication,
  Service,
  Injectable,
  Inject,
  Singleton,
  LOGGER_SERVICE_TOKEN,
  CONFIG_SERVICE_TOKEN,
  type IModule as AbstractModule,
  type DynamicModule,
  type Provider,
  type IOnInit as OnInit,
  type IOnDestroy as OnDestroy,
} from '../src/index';

interface Logger {
  info(msg: string): void;
  debug(msg: string): void;
}

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

interface TaskManagerConfig {
  enableNotifications?: boolean;
  notificationChannels?: string[];
  maxTasksPerUser?: number;
  defaultPriority?: Task['priority'];
}

// ============================
// Service Tokens
// ============================

const TaskServiceToken = createToken<TaskService>('TaskService');
const NotificationServiceToken = createToken<NotificationService>('NotificationService');
const TaskCoordinatorToken = createToken<TaskCoordinator>('TaskCoordinator');
const TaskConfigToken = createToken<TaskManagerConfig>('TaskConfig');

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
  private maxTasks: number;
  private defaultPriority: Task['priority'];

  constructor(
    @Inject(LOGGER_SERVICE_TOKEN) private loggerModule: any,
    @Inject(TaskConfigToken) private config: TaskManagerConfig
  ) {
    this.logger = this.loggerModule.child({ service: 'TaskService' });
    this.maxTasks = config.maxTasksPerUser || 100;
    this.defaultPriority = config.defaultPriority || 'medium';
  }

  async onInit(): Promise<void> {
    this.logger.info('TaskService initialized');
    await this.loadMockTasks();
  }

  async onDestroy(): Promise<void> {
    this.logger.info('TaskService shutting down');
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

    mockTasks.forEach((task) => this.tasks.set(task.id, task));
    this.logger.debug(`Loaded ${this.tasks.size} tasks`);
  }

  async create(taskData: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>): Promise<Task> {
    if (this.tasks.size >= this.maxTasks) {
      throw new Error(`Maximum number of tasks (${this.maxTasks}) reached`);
    }

    const task: Task = {
      ...taskData,
      id: this.generateId(),
      priority: taskData.priority || this.defaultPriority,
      createdAt: new Date(),
      updatedAt: new Date(),
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
      updatedAt: new Date(),
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
}

/**
 * Notification Service with proper DI
 */
@Injectable()
@Singleton()
@Service('NotificationService@1.0.0')
class NotificationService implements OnInit {
  private logger!: Logger;
  private enabled: boolean;
  private channels: string[];

  constructor(
    @Inject(LOGGER_SERVICE_TOKEN) private loggerModule: any,
    @Inject(TaskConfigToken) private config: TaskManagerConfig
  ) {
    this.logger = this.loggerModule.child({ service: 'NotificationService' });
    this.enabled = config.enableNotifications ?? true;
    this.channels = config.notificationChannels ?? ['email', 'push'];
  }

  async onInit(): Promise<void> {
    this.logger.info('NotificationService initialized', {
      enabled: this.enabled,
      channels: this.channels,
    });
  }

  async sendNotification(type: string, data: any): Promise<void> {
    if (!this.enabled) {
      this.logger.debug(`Notifications disabled, skipping ${type}`);
      return;
    }

    this.logger.info(`Sending ${type} notification`, data);
    // In a real app, this would send emails, push notifications, etc.
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
}

// ============================
// Improved Task Manager Module with forRoot pattern
// ============================

/**
 * TaskManagerModule - Now with static forRoot method and automatic provider registration
 */
class TaskManagerModule extends AbstractModule {
  override readonly name = 'task-manager';
  override readonly version = '1.0.0';
  override readonly dependencies = [LOGGER_SERVICE_TOKEN, CONFIG_SERVICE_TOKEN];

  /**
   * Static forRoot method for dynamic module configuration
   * This is the new pattern that allows: modules: [TaskManagerModule.forRoot(config)]
   */
  static forRoot(config?: TaskManagerConfig): DynamicModule {
    const providers: Provider[] = [
      // Configuration provider
      [
        TaskConfigToken,
        {
          useValue: config || {
            enableNotifications: true,
            notificationChannels: ['email', 'push', 'sms'],
            maxTasksPerUser: 100,
            defaultPriority: 'medium',
          },
        },
      ],
      // Service providers
      [TaskServiceToken, { useClass: TaskService }],
      [NotificationServiceToken, { useClass: NotificationService }],
      [TaskCoordinatorToken, { useClass: TaskCoordinator }],
    ];

    return {
      module: TaskManagerModule,
      name: 'task-manager',
      version: '1.0.0',
      providers,
      exports: [TaskServiceToken, TaskCoordinatorToken],
      global: false,
    };
  }

  /**
   * Alternative async configuration pattern
   */
  static forRootAsync(options: {
    useFactory: (...args: any[]) => TaskManagerConfig | Promise<TaskManagerConfig>;
    inject?: any[];
  }): DynamicModule {
    const providers: Provider[] = [
      // Async configuration provider
      [
        TaskConfigToken,
        {
          useFactory: options.useFactory,
          inject: options.inject || [],
        },
      ],
      // Service providers
      [TaskServiceToken, { useClass: TaskService }],
      [NotificationServiceToken, { useClass: NotificationService }],
      [TaskCoordinatorToken, { useClass: TaskCoordinator }],
    ];

    return {
      module: TaskManagerModule,
      name: 'task-manager',
      version: '1.0.0',
      providers,
      exports: [TaskServiceToken, TaskCoordinatorToken],
    };
  }

  override async onStart(app: any): Promise<void> {
    const logger = app.resolve(LOGGER_SERVICE_TOKEN).child({ module: this.name });
    logger.info('TaskManagerModule starting...');

    // With the new API, providers are automatically registered and initialized
    // We just need to resolve and call onInit for services that need it
    const taskService = app.resolve(TaskServiceToken);
    const notificationService = app.resolve(NotificationServiceToken);
    const taskCoordinator = app.resolve(TaskCoordinatorToken);

    // Initialize services that implement OnInit
    if (taskService.onInit) {
      await taskService.onInit();
    }
    if (notificationService.onInit) {
      await notificationService.onInit();
    }
    if (taskCoordinator.onInit) {
      await taskCoordinator.onInit();
    }

    logger.info('TaskManagerModule started successfully');
  }

  override async onStop(app: any): Promise<void> {
    const logger = app.resolve(LOGGER_SERVICE_TOKEN).child({ module: this.name });
    logger.info('TaskManagerModule stopping...');

    // Clean up services that implement OnDestroy
    if (app.hasProvider(TaskServiceToken)) {
      const taskService = app.resolve(TaskServiceToken);
      if (taskService.onDestroy) {
        await taskService.onDestroy();
      }
    }

    logger.info('TaskManagerModule stopped');
  }
}

// ============================
// Application Configuration
// ============================

const appConfig = {
  name: 'TaskManagerApp',
  version: '1.0.0',
  debug: true,
  config: {
    app: {
      name: 'TaskManager',
      environment: process.env['NODE_ENV'] || 'development',
    },
  },
  logging: {
    level: 'debug',
    prettyPrint: true,
  },
};

// ============================
// Application Bootstrap - Showcasing Different Module Registration Patterns
// ============================

async function bootstrapWithForRoot() {
  console.log('Starting Task Manager Application with forRoot pattern...\n');

  // Create application with the new improved API
  // Notice: We can now use TaskManagerModule.forRoot() instead of new TaskManagerModule()
  const app = await TitanApplication.create({
    ...appConfig,
    modules: [
      // Using the forRoot pattern with custom config
      TaskManagerModule.forRoot({
        enableNotifications: true,
        notificationChannels: ['email', 'webhook'],
        maxTasksPerUser: 50,
        defaultPriority: 'high',
      }),
    ],
  });

  // Setup error handling
  app.onError((error: Error) => {
    console.error('Application error:', error);
  });

  // Start the application
  await app.start();

  console.log('\n=== Task Manager Application Started (forRoot) ===\n');

  // Access services using the improved public container API
  const taskCoordinator = app.resolve(TaskCoordinatorToken);
  const taskService = app.resolve(TaskServiceToken);

  // Demo operations
  console.log('Creating a new task...');
  const newTask = await taskCoordinator.createTask({
    title: 'Test forRoot pattern',
    description: 'Verify the new module API works',
    status: 'pending',
    priority: 'high',
  });
  console.log('Task created:', newTask);

  // Get all tasks
  console.log('\nAll tasks:');
  const allTasks = await taskService.findAll();
  allTasks.forEach((task) => {
    console.log(`  - ${task.title} (${task.status})`);
  });

  return app;
}

async function bootstrapWithClassReference() {
  console.log('\nStarting Task Manager Application with class reference...\n');

  // Create application with just the class reference
  // This shows backward compatibility - the module will use default config
  const app = await TitanApplication.create({
    ...appConfig,
    modules: [TaskManagerModule], // Just pass the class, not an instance!
  });

  await app.start();

  console.log('\n=== Task Manager Application Started (Class Reference) ===\n');

  // Note: With class reference, we need to manually provide config
  // So we register the config provider before resolving services
  app.register(TaskConfigToken, {
    useValue: {
      enableNotifications: false,
      maxTasksPerUser: 10,
      defaultPriority: 'low',
    },
  });

  // Then register our services
  app.register(TaskServiceToken, { useClass: TaskService });
  app.register(NotificationServiceToken, { useClass: NotificationService });
  app.register(TaskCoordinatorToken, { useClass: TaskCoordinator });

  // Initialize services
  const taskService = app.resolve(TaskServiceToken);
  await taskService.onInit?.();

  console.log('Creating a task with class reference pattern...');
  const task = await taskService.create({
    title: 'Test class reference',
    description: 'Verify class reference pattern works',
    status: 'pending',
    priority: 'low',
  });
  console.log('Task created:', task);

  return app;
}

async function bootstrapWithAsyncConfig() {
  console.log('\nStarting Task Manager Application with async config...\n');

  // Create application with async configuration
  const app = await TitanApplication.create({
    ...appConfig,
    modules: [
      TaskManagerModule.forRootAsync({
        useFactory: async (configModule: any) => {
          // Simulate async config loading
          await new Promise((resolve) => setTimeout(resolve, 100));

          const config = configModule.get('taskManager', {});
          return {
            enableNotifications: config.enableNotifications ?? true,
            notificationChannels: config.channels ?? ['email'],
            maxTasksPerUser: config.maxTasks ?? 25,
            defaultPriority: config.defaultPriority ?? 'medium',
          };
        },
        inject: [CONFIG_SERVICE_TOKEN],
      }),
    ],
  });

  await app.start();

  console.log('\n=== Task Manager Application Started (Async Config) ===\n');

  const taskCoordinator = app.resolve(TaskCoordinatorToken);

  // Create and complete a task
  const task = await taskCoordinator.createTask({
    title: 'Test async config',
    description: 'Verify async configuration works',
    status: 'pending',
    priority: 'medium',
  });

  console.log('Task created:', task);

  const completed = await taskCoordinator.completeTask(task.id);
  console.log('Task completed:', completed);

  // Get report
  const report = await taskCoordinator.getTasksReport();
  console.log('\nTask Report:');
  console.log('Total tasks:', report.statistics.total);
  console.log('By status:', report.statistics.byStatus);

  return app;
}

// ============================
// Main Entry Point
// ============================

async function main() {
  console.log('=== Titan Framework - Improved Module API Demo ===\n');

  try {
    // Demo 1: forRoot pattern
    const app1 = await bootstrapWithForRoot();
    await app1.stop();

    console.log('\n' + '='.repeat(50) + '\n');

    // Demo 2: Class reference pattern
    const app2 = await bootstrapWithClassReference();
    await app2.stop();

    console.log('\n' + '='.repeat(50) + '\n');

    // Demo 3: Async configuration pattern
    const app3 = await bootstrapWithAsyncConfig();
    await app3.stop();

    console.log('\n=== All demos completed successfully ===');
  } catch (error) {
    console.error('Demo failed:', error);
    process.exit(1);
  }
}

// Run when executed directly
if (require.main === module) {
  main().catch((error) => {
    console.error('Failed to run demo:', error);
    process.exit(1);
  });
}

// Export for testing
export {
  TaskManagerModule,
  TaskService,
  NotificationService,
  TaskCoordinator,
  TaskServiceToken,
  NotificationServiceToken,
  TaskCoordinatorToken,
  TaskConfigToken,
};
