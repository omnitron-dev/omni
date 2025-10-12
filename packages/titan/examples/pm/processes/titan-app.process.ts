/**
 * Example: Process as a Full Titan Application
 *
 * This example demonstrates that a process can be a complete Titan application
 * with its own modules, dependency injection, and business logic.
 * This showcases the ultimate flexibility of the PM architecture.
 */

import { Process, Public, HealthCheck, OnShutdown } from '../../../src/modules/pm/decorators.js';
import type { IHealthStatus } from '../../../src/modules/pm/types.js';
import { Application } from '../../../src/application.js';
import { Module, Injectable } from '../../../src/decorators/index.js';
import { LoggerModule } from '../../../src/modules/logger/logger.module.js';
import { ConfigModule } from '../../../src/modules/config/config.module.js';
import { DiscoveryModule } from '../../../src/modules/discovery/discovery.module.js';
import { RedisModule } from '../../../src/modules/redis/redis.module.js';

// ============================================================================
// Business Services (part of the Titan app inside the process)
// ============================================================================

@Injectable()
class UserService {
  private users = new Map<string, any>();

  async createUser(data: any) {
    const id = `user_${Date.now()}`;
    const user = { id, ...data, createdAt: new Date() };
    this.users.set(id, user);
    return user;
  }

  async getUser(id: string) {
    return this.users.get(id);
  }

  async listUsers() {
    return Array.from(this.users.values());
  }
}

@Injectable()
class NotificationService {
  async sendEmail(to: string, subject: string, body: string) {
    console.log(`Sending email to ${to}: ${subject}`);
    // Simulate email sending
    await new Promise((resolve) => setTimeout(resolve, 100));
    return { success: true, messageId: `msg_${Date.now()}` };
  }

  async sendSMS(to: string, message: string) {
    console.log(`Sending SMS to ${to}: ${message}`);
    // Simulate SMS sending
    await new Promise((resolve) => setTimeout(resolve, 50));
    return { success: true, messageId: `sms_${Date.now()}` };
  }
}

@Injectable()
class BusinessLogicService {
  constructor(
    private readonly userService: UserService,
    private readonly notificationService: NotificationService
  ) {}

  async onboardUser(data: { name: string; email: string; phone?: string }) {
    // Create user
    const user = await this.userService.createUser(data);

    // Send welcome email
    await this.notificationService.sendEmail(data.email, 'Welcome!', `Welcome to our platform, ${data.name}!`);

    // Send SMS if phone provided
    if (data.phone) {
      await this.notificationService.sendSMS(data.phone, 'Welcome! Your account has been created.');
    }

    return user;
  }

  async getUserDashboard(userId: string) {
    const user = await this.userService.getUser(userId);
    if (!user) {
      throw new Error('User not found');
    }

    return {
      user,
      stats: {
        loginCount: Math.floor(Math.random() * 100),
        lastLogin: new Date(),
        accountAge: Math.floor((Date.now() - new Date(user.createdAt).getTime()) / (1000 * 60 * 60 * 24)),
      },
      recommendations: ['Complete your profile', 'Verify your email', 'Enable two-factor authentication'],
    };
  }
}

// ============================================================================
// Application Module
// ============================================================================

@Module({
  providers: [UserService, NotificationService, BusinessLogicService],
  exports: [BusinessLogicService],
})
class BusinessModule {}

// ============================================================================
// Process Definition
// ============================================================================

/**
 * This process is a complete Titan application with:
 * - Dependency injection
 * - Multiple modules (Logger, Config, Discovery, Redis)
 * - Business services
 * - Full application lifecycle
 */
@Process({
  name: 'titan-app-process',
  version: '1.0.0',
  description: 'A process that is itself a full Titan application',
})
export default class TitanAppProcess {
  private app?: Application;
  private businessLogic?: BusinessLogicService;
  private isReady = false;

  /**
   * Initialize the Titan application inside this process
   */
  async init(config?: { redis?: any; discovery?: any }) {
    console.log('Initializing Titan application inside process...');

    // Create a full Titan application
    this.app = await Application.create({
      name: 'ProcessInternalApp',
      imports: [
        // Core modules
        LoggerModule.forRoot({ level: 'info' }),

        // Config module with environment variables
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({
              app: {
                name: 'titan-app-process',
                version: '1.0.0',
                environment: process.env['NODE_ENV'] || 'development',
              },
            }),
          ],
        }),

        // Discovery module for service discovery
        config?.discovery &&
          DiscoveryModule.forRoot({
            serviceName: 'titan-app-process',
            serviceVersion: '1.0.0',
            healthCheck: {
              enabled: true,
              interval: 30000,
            },
          }),

        // Redis module if configured
        config?.redis &&
          RedisModule.forRoot({
            connection: config.redis,
          }),

        // Business module
        BusinessModule,
      ].filter(Boolean), // Remove undefined modules
    });

    // Start the application
    await this.app.start();

    // Get business logic service
    this.businessLogic = this.app.get(BusinessLogicService);

    this.isReady = true;
    console.log('Titan application initialized successfully');
  }

  // ============================================================================
  // Public Methods Exposed via PM/Netron
  // ============================================================================

  @Public()
  async onboardUser(data: { name: string; email: string; phone?: string }) {
    this.ensureReady();
    return this.businessLogic!.onboardUser(data);
  }

  @Public()
  async getUserDashboard(userId: string) {
    this.ensureReady();
    return this.businessLogic!.getUserDashboard(userId);
  }

  @Public()
  async listUsers() {
    this.ensureReady();
    const userService = this.app!.get(UserService);
    return userService.listUsers();
  }

  @Public()
  async sendNotification(type: 'email' | 'sms', to: string, content: any) {
    this.ensureReady();
    const notificationService = this.app!.get(NotificationService);

    if (type === 'email') {
      return notificationService.sendEmail(to, content.subject, content.body);
    } else {
      return notificationService.sendSMS(to, content.message);
    }
  }

  @Public()
  async getAppInfo() {
    return {
      isReady: this.isReady,
      appName: this.app?.name,
      modules: this.app ? Object.keys(this.app['modules'] || {}) : [],
      uptime: process.uptime(),
      memory: process.memoryUsage(),
    };
  }

  // ============================================================================
  // Lifecycle Methods
  // ============================================================================

  @HealthCheck()
  async checkHealth(): Promise<IHealthStatus> {
    const checks = [];

    // Check if app is initialized
    checks.push({
      name: 'app-initialized',
      status: this.isReady ? ('pass' as const) : ('fail' as const),
      message: this.isReady ? 'Application is ready' : 'Application not initialized',
    });

    // Check if app is running
    if (this.app) {
      checks.push({
        name: 'app-running',
        status: this.app['state'] === 'started' ? ('pass' as const) : ('warn' as const),
        message: `Application state: ${this.app['state']}`,
      });
    }

    // Memory check
    const memoryUsage = process.memoryUsage();
    const memoryMB = memoryUsage.heapUsed / 1024 / 1024;
    checks.push({
      name: 'memory',
      status: memoryMB < 200 ? ('pass' as const) : ('warn' as const),
      message: `Memory usage: ${memoryMB.toFixed(2)}MB`,
    });

    const hasFailure = checks.some((c) => c.status === 'fail');
    const hasWarning = checks.some((c) => c.status === 'warn');

    return {
      status: hasFailure ? 'unhealthy' : hasWarning ? 'degraded' : 'healthy',
      checks,
      timestamp: Date.now(),
    };
  }

  @OnShutdown()
  async cleanup(): Promise<void> {
    console.log('Shutting down Titan application inside process...');

    if (this.app) {
      await this.app.stop();
      console.log('Titan application stopped successfully');
    }

    this.isReady = false;
  }

  private ensureReady(): void {
    if (!this.isReady || !this.app || !this.businessLogic) {
      throw new Error('Process not initialized. Call init() first.');
    }
  }
}

/**
 * Key Points Demonstrated:
 *
 * 1. Process as Full Application:
 *    - The process contains a complete Titan application
 *    - Has its own dependency injection container
 *    - Can use any Titan modules (Config, Logger, Discovery, Redis, etc.)
 *
 * 2. Business Logic Encapsulation:
 *    - Business services are defined within the process
 *    - Services can have complex dependencies
 *    - Full use of DI decorators (@Injectable, @Module)
 *
 * 3. Module Integration:
 *    - Can integrate with Discovery module for service discovery
 *    - Can use Redis module for caching/pub-sub
 *    - Can use Config module for configuration management
 *
 * 4. Flexibility:
 *    - Process can be simple or complex as needed
 *    - Can scale from simple service to full microservice
 *    - PM provides orchestration, process provides business logic
 *
 * 5. Clean Architecture:
 *    - PM layer: Process orchestration, IPC, lifecycle
 *    - Process layer: Business logic, application modules
 *    - Clear separation of concerns
 *
 * Usage:
 * ```typescript
 * const appProcess = await pm.spawn<TitanAppProcess>(
 *   path.resolve(__dirname, './titan-app.process.js'),
 *   {
 *     dependencies: {
 *       config: {
 *         redis: { host: 'localhost', port: 6379 },
 *         discovery: { consul: { host: 'localhost' } }
 *       }
 *     }
 *   }
 * );
 *
 * // Use the process like a microservice
 * const user = await appProcess.onboardUser({
 *   name: 'John Doe',
 *   email: 'john@example.com'
 * });
 *
 * const dashboard = await appProcess.getUserDashboard(user.id);
 * ```
 */
