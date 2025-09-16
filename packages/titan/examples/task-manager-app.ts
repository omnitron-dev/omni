/**
 * Titan Framework Demo: Task Manager Application
 * 
 * This comprehensive example demonstrates all major features of the Titan framework:
 * - Modular architecture with Nexus IoC
 * - Configuration management
 * - Logging system
 * - Event-driven architecture
 * - Service composition
 * - Decorators and metadata
 * 
 * The application is a task management system with:
 * - User authentication
 * - Task CRUD operations
 * - Real-time notifications
 * - Task assignments
 * - Activity logging
 */

import { 
  TitanApplication, 
  Module, 
  Service,
  EventHandler,
  OnInit,
  OnDestroy,
  ConfigValue,
  LoggerService
} from '@omnitron-dev/titan';
import { Injectable, Inject, Singleton } from '@omnitron-dev/nexus';

// ============================
// Domain Models
// ============================

interface User {
  id: string;
  username: string;
  email: string;
  role: 'admin' | 'user';
  createdAt: Date;
}

interface Task {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'in-progress' | 'completed' | 'cancelled';
  priority: 'low' | 'medium' | 'high' | 'critical';
  assignedTo?: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  dueDate?: Date;
  tags: string[];
}

interface TaskEvent {
  taskId: string;
  userId: string;
  action: string;
  timestamp: Date;
  metadata?: any;
}

// ============================
// Configuration
// ============================

const appConfig = {
  app: {
    name: 'TaskManager',
    version: '1.0.0',
    port: 3000,
    environment: process.env.NODE_ENV || 'development'
  },
  database: {
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    username: process.env.DB_USER || 'taskmanager',
    password: process.env.DB_PASS || 'password',
    database: process.env.DB_NAME || 'taskmanager_db'
  },
  auth: {
    jwtSecret: process.env.JWT_SECRET || 'super-secret-key',
    tokenExpiry: '24h',
    passwordSaltRounds: 10
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379')
  },
  notifications: {
    email: {
      enabled: true,
      from: 'noreply@taskmanager.com'
    },
    push: {
      enabled: false
    },
    realtime: {
      enabled: true
    }
  },
  features: {
    taskAssignment: true,
    taskComments: true,
    taskAttachments: false,
    taskReminders: true,
    activityTracking: true
  }
};

// ============================
// Services
// ============================

/**
 * User Service - Manages user operations
 */
@Injectable()
@Singleton()
export class UserService implements OnInit {
  private users: Map<string, User> = new Map();
  
  @Inject(LoggerService)
  private logger!: LoggerService;
  
  @ConfigValue('features.activityTracking')
  private activityTrackingEnabled!: boolean;

  async onInit(): Promise<void> {
    this.logger.info('UserService initialized');
    await this.loadUsers();
  }

  private async loadUsers(): Promise<void> {
    // Mock data - in real app, load from database
    const mockUsers: User[] = [
      {
        id: '1',
        username: 'admin',
        email: 'admin@taskmanager.com',
        role: 'admin',
        createdAt: new Date()
      },
      {
        id: '2',
        username: 'john',
        email: 'john@example.com',
        role: 'user',
        createdAt: new Date()
      },
      {
        id: '3',
        username: 'jane',
        email: 'jane@example.com',
        role: 'user',
        createdAt: new Date()
      }
    ];
    
    mockUsers.forEach(user => this.users.set(user.id, user));
    this.logger.debug(`Loaded ${this.users.size} users`);
  }

  async findById(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async findByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(u => u.username === username);
  }

  async findAll(): Promise<User[]> {
    return Array.from(this.users.values());
  }

  async create(userData: Omit<User, 'id' | 'createdAt'>): Promise<User> {
    const user: User = {
      ...userData,
      id: this.generateId(),
      createdAt: new Date()
    };
    
    this.users.set(user.id, user);
    this.logger.info(`User created: ${user.username}`);
    
    return user;
  }

  private generateId(): string {
    return Math.random().toString(36).substr(2, 9);
  }
}

/**
 * Task Service - Core business logic for tasks
 */
@Injectable()
@Service('TaskService@1.0.0')
export class TaskService implements OnInit, OnDestroy {
  private tasks: Map<string, Task> = new Map();
  private tasksByUser: Map<string, Set<string>> = new Map();
  
  @Inject(LoggerService)
  private logger!: LoggerService;
  
  @Inject(UserService)
  private userService!: UserService;
  
  @ConfigValue('features.taskAssignment')
  private assignmentEnabled!: boolean;

  async onInit(): Promise<void> {
    this.logger.info('TaskService initialized');
    await this.loadTasks();
  }

  async onDestroy(): Promise<void> {
    this.logger.info('TaskService shutting down');
    await this.saveTasks();
  }

  private async loadTasks(): Promise<void> {
    // Mock data
    const mockTasks: Task[] = [
      {
        id: '1',
        title: 'Setup project repository',
        description: 'Initialize git repo and setup initial structure',
        status: 'completed',
        priority: 'high',
        assignedTo: '2',
        createdBy: '1',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-02'),
        tags: ['setup', 'infrastructure']
      },
      {
        id: '2',
        title: 'Implement user authentication',
        description: 'Add JWT-based authentication system',
        status: 'in-progress',
        priority: 'critical',
        assignedTo: '2',
        createdBy: '1',
        createdAt: new Date('2024-01-03'),
        updatedAt: new Date('2024-01-10'),
        dueDate: new Date('2024-01-15'),
        tags: ['security', 'backend']
      },
      {
        id: '3',
        title: 'Design database schema',
        description: 'Create ERD and define all tables',
        status: 'pending',
        priority: 'high',
        assignedTo: '3',
        createdBy: '1',
        createdAt: new Date('2024-01-05'),
        updatedAt: new Date('2024-01-05'),
        tags: ['database', 'architecture']
      }
    ];
    
    mockTasks.forEach(task => {
      this.tasks.set(task.id, task);
      if (task.assignedTo) {
        this.addTaskToUser(task.assignedTo, task.id);
      }
    });
    
    this.logger.debug(`Loaded ${this.tasks.size} tasks`);
  }

  private async saveTasks(): Promise<void> {
    // In real app, save to database
    this.logger.debug(`Saving ${this.tasks.size} tasks`);
  }

  async create(taskData: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>): Promise<Task> {
    const task: Task = {
      ...taskData,
      id: this.generateId(),
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    this.tasks.set(task.id, task);
    
    if (task.assignedTo) {
      this.addTaskToUser(task.assignedTo, task.id);
    }
    
    this.logger.info(`Task created: ${task.title} by user ${task.createdBy}`);
    
    return task;
  }

  async update(id: string, updates: Partial<Task>): Promise<Task | undefined> {
    const task = this.tasks.get(id);
    if (!task) {
      return undefined;
    }
    
    const oldAssignee = task.assignedTo;
    const updatedTask = {
      ...task,
      ...updates,
      id: task.id, // Ensure ID cannot be changed
      createdAt: task.createdAt, // Ensure creation date cannot be changed
      updatedAt: new Date()
    };
    
    // Handle assignee change
    if (oldAssignee !== updatedTask.assignedTo) {
      if (oldAssignee) {
        this.removeTaskFromUser(oldAssignee, id);
      }
      if (updatedTask.assignedTo) {
        this.addTaskToUser(updatedTask.assignedTo, id);
      }
    }
    
    this.tasks.set(id, updatedTask);
    this.logger.info(`Task updated: ${updatedTask.title}`);
    
    return updatedTask;
  }

  async delete(id: string): Promise<boolean> {
    const task = this.tasks.get(id);
    if (!task) {
      return false;
    }
    
    if (task.assignedTo) {
      this.removeTaskFromUser(task.assignedTo, id);
    }
    
    this.tasks.delete(id);
    this.logger.info(`Task deleted: ${task.title}`);
    
    return true;
  }

  async findById(id: string): Promise<Task | undefined> {
    return this.tasks.get(id);
  }

  async findAll(filters?: {
    status?: Task['status'];
    priority?: Task['priority'];
    assignedTo?: string;
    createdBy?: string;
  }): Promise<Task[]> {
    let tasks = Array.from(this.tasks.values());
    
    if (filters) {
      if (filters.status) {
        tasks = tasks.filter(t => t.status === filters.status);
      }
      if (filters.priority) {
        tasks = tasks.filter(t => t.priority === filters.priority);
      }
      if (filters.assignedTo) {
        tasks = tasks.filter(t => t.assignedTo === filters.assignedTo);
      }
      if (filters.createdBy) {
        tasks = tasks.filter(t => t.createdBy === filters.createdBy);
      }
    }
    
    return tasks;
  }

  async findByUser(userId: string): Promise<Task[]> {
    const taskIds = this.tasksByUser.get(userId);
    if (!taskIds) {
      return [];
    }
    
    return Array.from(taskIds)
      .map(id => this.tasks.get(id))
      .filter(task => task !== undefined) as Task[];
  }

  async assignTask(taskId: string, userId: string): Promise<Task | undefined> {
    if (!this.assignmentEnabled) {
      throw new Error('Task assignment feature is disabled');
    }
    
    const user = await this.userService.findById(userId);
    if (!user) {
      throw new Error(`User ${userId} not found`);
    }
    
    return this.update(taskId, { assignedTo: userId });
  }

  async updateStatus(taskId: string, status: Task['status']): Promise<Task | undefined> {
    return this.update(taskId, { status });
  }

  private addTaskToUser(userId: string, taskId: string): void {
    if (!this.tasksByUser.has(userId)) {
      this.tasksByUser.set(userId, new Set());
    }
    this.tasksByUser.get(userId)!.add(taskId);
  }

  private removeTaskFromUser(userId: string, taskId: string): void {
    const tasks = this.tasksByUser.get(userId);
    if (tasks) {
      tasks.delete(taskId);
      if (tasks.size === 0) {
        this.tasksByUser.delete(userId);
      }
    }
  }

  private generateId(): string {
    return Math.random().toString(36).substr(2, 9);
  }

  // Statistics methods
  async getStatistics(): Promise<{
    total: number;
    byStatus: Record<Task['status'], number>;
    byPriority: Record<Task['priority'], number>;
    overdue: number;
  }> {
    const tasks = Array.from(this.tasks.values());
    const now = new Date();
    
    const stats = {
      total: tasks.length,
      byStatus: {
        pending: 0,
        'in-progress': 0,
        completed: 0,
        cancelled: 0
      },
      byPriority: {
        low: 0,
        medium: 0,
        high: 0,
        critical: 0
      },
      overdue: 0
    };
    
    tasks.forEach(task => {
      stats.byStatus[task.status]++;
      stats.byPriority[task.priority]++;
      
      if (task.dueDate && task.dueDate < now && task.status !== 'completed') {
        stats.overdue++;
      }
    });
    
    return stats;
  }
}

/**
 * Notification Service - Handles all notifications
 */
@Injectable()
@Service('NotificationService@1.0.0')
export class NotificationService {
  @Inject(LoggerService)
  private logger!: LoggerService;
  
  @ConfigValue('notifications.email.enabled')
  private emailEnabled!: boolean;
  
  @ConfigValue('notifications.realtime.enabled')
  private realtimeEnabled!: boolean;

  async sendTaskAssigned(task: Task, user: User): Promise<void> {
    this.logger.info(`Sending task assigned notification to ${user.email}`);
    
    if (this.emailEnabled) {
      await this.sendEmail(user.email, 'Task Assigned', 
        `You have been assigned task: ${task.title}`);
    }
    
    if (this.realtimeEnabled) {
      await this.sendRealtimeNotification(user.id, {
        type: 'task-assigned',
        taskId: task.id,
        title: task.title
      });
    }
  }

  async sendTaskStatusChanged(task: Task, oldStatus: Task['status'], user: User): Promise<void> {
    this.logger.info(`Task ${task.id} status changed from ${oldStatus} to ${task.status}`);
    
    if (this.realtimeEnabled) {
      await this.sendRealtimeNotification(user.id, {
        type: 'task-status-changed',
        taskId: task.id,
        oldStatus,
        newStatus: task.status
      });
    }
  }

  async sendTaskDueReminder(task: Task, user: User): Promise<void> {
    if (!task.dueDate) return;
    
    const daysUntilDue = Math.ceil((task.dueDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    
    this.logger.info(`Sending due reminder for task ${task.id} to ${user.email}`);
    
    if (this.emailEnabled) {
      await this.sendEmail(user.email, 'Task Due Soon',
        `Task "${task.title}" is due in ${daysUntilDue} days`);
    }
  }

  private async sendEmail(to: string, subject: string, body: string): Promise<void> {
    // Mock email sending
    this.logger.debug(`Email sent to ${to}: ${subject}`);
  }

  private async sendRealtimeNotification(userId: string, data: any): Promise<void> {
    // Mock realtime notification
    this.logger.debug(`Realtime notification sent to user ${userId}:`, data);
  }
}

/**
 * Activity Service - Tracks all system activities
 */
@Injectable()
@Service('ActivityService@1.0.0')
export class ActivityService {
  private activities: TaskEvent[] = [];
  
  @Inject(LoggerService)
  private logger!: LoggerService;
  
  @ConfigValue('features.activityTracking')
  private trackingEnabled!: boolean;

  @EventHandler('task.created')
  async onTaskCreated(data: { task: Task; userId: string }): Promise<void> {
    if (!this.trackingEnabled) return;
    
    await this.recordActivity({
      taskId: data.task.id,
      userId: data.userId,
      action: 'created',
      timestamp: new Date(),
      metadata: { title: data.task.title }
    });
  }

  @EventHandler('task.updated')
  async onTaskUpdated(data: { task: Task; userId: string; changes: Partial<Task> }): Promise<void> {
    if (!this.trackingEnabled) return;
    
    await this.recordActivity({
      taskId: data.task.id,
      userId: data.userId,
      action: 'updated',
      timestamp: new Date(),
      metadata: { changes: data.changes }
    });
  }

  @EventHandler('task.deleted')
  async onTaskDeleted(data: { taskId: string; userId: string }): Promise<void> {
    if (!this.trackingEnabled) return;
    
    await this.recordActivity({
      taskId: data.taskId,
      userId: data.userId,
      action: 'deleted',
      timestamp: new Date()
    });
  }

  @EventHandler('task.assigned')
  async onTaskAssigned(data: { task: Task; assignedBy: string; assignedTo: string }): Promise<void> {
    if (!this.trackingEnabled) return;
    
    await this.recordActivity({
      taskId: data.task.id,
      userId: data.assignedBy,
      action: 'assigned',
      timestamp: new Date(),
      metadata: { assignedTo: data.assignedTo }
    });
  }

  private async recordActivity(event: TaskEvent): Promise<void> {
    this.activities.push(event);
    this.logger.debug(`Activity recorded: ${event.action} on task ${event.taskId} by user ${event.userId}`);
    
    // Keep only last 1000 activities in memory
    if (this.activities.length > 1000) {
      this.activities = this.activities.slice(-1000);
    }
  }

  async getActivities(filters?: {
    taskId?: string;
    userId?: string;
    from?: Date;
    to?: Date;
  }): Promise<TaskEvent[]> {
    let activities = [...this.activities];
    
    if (filters) {
      if (filters.taskId) {
        activities = activities.filter(a => a.taskId === filters.taskId);
      }
      if (filters.userId) {
        activities = activities.filter(a => a.userId === filters.userId);
      }
      if (filters.from) {
        activities = activities.filter(a => a.timestamp >= filters.from!);
      }
      if (filters.to) {
        activities = activities.filter(a => a.timestamp <= filters.to!);
      }
    }
    
    return activities.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  async getRecentActivities(limit: number = 10): Promise<TaskEvent[]> {
    return this.activities
      .slice(-limit)
      .reverse();
  }
}

/**
 * Task Orchestrator - Coordinates task operations with events
 */
@Injectable()
@Service('TaskOrchestrator@1.0.0')
export class TaskOrchestrator {
  @Inject(TaskService)
  private taskService!: TaskService;
  
  @Inject(NotificationService)
  private notificationService!: NotificationService;
  
  @Inject(UserService)
  private userService!: UserService;
  
  @Inject(LoggerService)
  private logger!: LoggerService;

  async createTask(userId: string, taskData: Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>): Promise<Task> {
    const task = await this.taskService.create({
      ...taskData,
      createdBy: userId
    });
    
    // Emit event
    await this.emitEvent('task.created', { task, userId });
    
    // Send notification if assigned
    if (task.assignedTo) {
      const assignedUser = await this.userService.findById(task.assignedTo);
      if (assignedUser) {
        await this.notificationService.sendTaskAssigned(task, assignedUser);
      }
    }
    
    return task;
  }

  async updateTask(userId: string, taskId: string, updates: Partial<Task>): Promise<Task | undefined> {
    const oldTask = await this.taskService.findById(taskId);
    if (!oldTask) return undefined;
    
    const updatedTask = await this.taskService.update(taskId, updates);
    if (!updatedTask) return undefined;
    
    // Emit event
    await this.emitEvent('task.updated', { 
      task: updatedTask, 
      userId, 
      changes: updates 
    });
    
    // Handle status change notification
    if (oldTask.status !== updatedTask.status && updatedTask.assignedTo) {
      const assignedUser = await this.userService.findById(updatedTask.assignedTo);
      if (assignedUser) {
        await this.notificationService.sendTaskStatusChanged(
          updatedTask, 
          oldTask.status, 
          assignedUser
        );
      }
    }
    
    // Handle assignment change
    if (oldTask.assignedTo !== updatedTask.assignedTo && updatedTask.assignedTo) {
      const assignedUser = await this.userService.findById(updatedTask.assignedTo);
      if (assignedUser) {
        await this.notificationService.sendTaskAssigned(updatedTask, assignedUser);
        await this.emitEvent('task.assigned', {
          task: updatedTask,
          assignedBy: userId,
          assignedTo: updatedTask.assignedTo
        });
      }
    }
    
    return updatedTask;
  }

  async deleteTask(userId: string, taskId: string): Promise<boolean> {
    const success = await this.taskService.delete(taskId);
    
    if (success) {
      await this.emitEvent('task.deleted', { taskId, userId });
    }
    
    return success;
  }

  private async emitEvent(event: string, data: any): Promise<void> {
    // In a real app, this would use the EventsService
    this.logger.debug(`Event emitted: ${event}`, data);
  }
}

// ============================
// Application Modules
// ============================

/**
 * Core Module - Basic services
 */
@Module({
  name: 'CoreModule',
  providers: [
    { provide: UserService, useClass: UserService },
    { provide: TaskService, useClass: TaskService }
  ],
  exports: [UserService, TaskService]
})
export class CoreModule {}

/**
 * Notification Module
 */
@Module({
  name: 'NotificationModule',
  imports: [CoreModule],
  providers: [
    { provide: NotificationService, useClass: NotificationService }
  ],
  exports: [NotificationService]
})
export class NotificationModule {}

/**
 * Activity Module
 */
@Module({
  name: 'ActivityModule',
  imports: [CoreModule],
  providers: [
    { provide: ActivityService, useClass: ActivityService }
  ],
  exports: [ActivityService]
})
export class ActivityModule {}

/**
 * Orchestration Module
 */
@Module({
  name: 'OrchestrationModule',
  imports: [CoreModule, NotificationModule],
  providers: [
    { provide: TaskOrchestrator, useClass: TaskOrchestrator }
  ],
  exports: [TaskOrchestrator]
})
export class OrchestrationModule {}

/**
 * Main Application Module
 */
@Module({
  name: 'AppModule',
  imports: [
    CoreModule,
    NotificationModule,
    ActivityModule,
    OrchestrationModule
  ]
})
export class AppModule {}

// ============================
// Application Bootstrap
// ============================

async function bootstrap() {
  // Create application instance
  const app = await TitanApplication.create({
    name: 'TaskManagerApp',
    config: appConfig,
    modules: [AppModule]
  });

  // Configure application
  app.configure({
    logger: {
      level: 'debug',
      pretty: true,
      timestamp: true
    },
    events: {
      wildcard: true,
      delimiter: '.',
      maxListeners: 100
    }
  });

  // Setup global error handling
  app.onError((error: Error) => {
    console.error('Application error:', error);
  });

  // Setup graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('SIGTERM received, shutting down gracefully...');
    await app.stop();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    console.log('SIGINT received, shutting down gracefully...');
    await app.stop();
    process.exit(0);
  });

  // Start the application
  await app.start();

  // Get services and demonstrate functionality
  const orchestrator = app.get(TaskOrchestrator);
  const taskService = app.get(TaskService);
  const userService = app.get(UserService);
  const activityService = app.get(ActivityService);

  console.log('\n=== Task Manager Application Started ===\n');

  // Demo: Create a new task
  console.log('Creating a new task...');
  const newTask = await orchestrator.createTask('1', {
    title: 'Implement caching layer',
    description: 'Add Redis caching for improved performance',
    status: 'pending',
    priority: 'high',
    assignedTo: '2',
    tags: ['performance', 'backend']
  });
  console.log('Task created:', newTask);

  // Demo: Update task status
  console.log('\nUpdating task status...');
  const updatedTask = await orchestrator.updateTask('2', newTask.id, {
    status: 'in-progress'
  });
  console.log('Task updated:', updatedTask);

  // Demo: Get user's tasks
  console.log('\nGetting tasks for user 2...');
  const userTasks = await taskService.findByUser('2');
  console.log(`User has ${userTasks.length} tasks:`);
  userTasks.forEach(task => {
    console.log(`  - ${task.title} (${task.status})`);
  });

  // Demo: Get statistics
  console.log('\nTask Statistics:');
  const stats = await taskService.getStatistics();
  console.log('Total tasks:', stats.total);
  console.log('By status:', stats.byStatus);
  console.log('By priority:', stats.byPriority);
  console.log('Overdue tasks:', stats.overdue);

  // Demo: Get recent activities
  console.log('\nRecent Activities:');
  const activities = await activityService.getRecentActivities(5);
  activities.forEach(activity => {
    console.log(`  - ${activity.action} on task ${activity.taskId} by user ${activity.userId}`);
  });

  // Demo: List all users
  console.log('\nAll Users:');
  const users = await userService.findAll();
  users.forEach(user => {
    console.log(`  - ${user.username} (${user.role}): ${user.email}`);
  });

  console.log('\n=== Demo Complete ===\n');
  console.log('Application is running. Press Ctrl+C to stop.\n');
}

// Run the application
if (require.main === module) {
  bootstrap().catch(error => {
    console.error('Failed to start application:', error);
    process.exit(1);
  });
}

// Export for testing
export { bootstrap, appConfig };