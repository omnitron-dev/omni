/**
 * Test Application Utilities
 *
 * Provides utilities for creating and managing test applications
 * in Titan framework tests.
 */

import { Application } from '../application.js';
import { Container } from '../nexus/index.js';
import type { IApplicationOptions } from '../types.js';

/**
 * Test application builder with simplified API
 */
export class TestApplication {
  private app: Application | null = null;
  private container: Container;
  private cleanupFns: (() => Promise<void> | void)[] = [];

  constructor(private options: Partial<IApplicationOptions> = {}) {
    this.container = new Container();
  }

  /**
   * Create test application with modules
   */
  static async create(
    rootModule: any,
    options: Partial<IApplicationOptions> = {}
  ): Promise<TestApplication> {
    const testApp = new TestApplication(options);
    await testApp.bootstrap(rootModule);
    return testApp;
  }

  /**
   * Bootstrap the application
   */
  async bootstrap(rootModule: any): Promise<void> {
    // Create application with test defaults
    this.app = await Application.create({
      ...this.options,
      modules: [rootModule],
      logger: (this.options as any)['logger'] ?? false, // Disable logging by default in tests
      gracefulShutdown: false,
      disableCoreModules: !(this.options as any)['registerCoreModules'],
    });

    // Store container reference - use public getter
    this.container = this.app.container;
  }

  /**
   * Get service instance from container
   */
  get<T>(token: any): T {
    if (!this.container) {
      throw new Error('Application not initialized');
    }
    return this.container.resolve<T>(token);
  }

  /**
   * Check if service exists in container
   */
  has(token: any): boolean {
    if (!this.container) {
      return false;
    }
    return this.container.has(token);
  }

  /**
   * Get the application instance
   */
  getApplication(): Application {
    if (!this.app) {
      throw new Error('Application not initialized');
    }
    return this.app;
  }

  /**
   * Get the container instance
   */
  getContainer(): Container {
    return this.container;
  }

  /**
   * Register cleanup function
   */
  addCleanup(fn: () => Promise<void> | void): void {
    this.cleanupFns.push(fn);
  }

  /**
   * Close application and cleanup
   */
  async close(): Promise<void> {
    // Run custom cleanup functions
    for (const fn of this.cleanupFns.reverse()) {
      await fn();
    }

    // Close application
    if (this.app) {
      await this.app.stop();
      this.app = null;
    }
  }

  /**
   * Create spy for service method
   */
  spyOn<T>(service: T, method: keyof T): jest.SpyInstance {
    const spy = jest.spyOn(service as any, method as any);
    this.addCleanup(() => spy.mockRestore());
    return spy;
  }

  /**
   * Mock service in container
   */
  mock<T>(token: any, mockImplementation: Partial<T>): void {
    const original = this.container.resolve<T>(token);
    Object.assign(original as any, mockImplementation);

    this.addCleanup(() => {
      // Restore original implementation
      for (const key in mockImplementation) {
        delete (original as any)[key];
      }
    });
  }

  /**
   * Override provider in container
   */
  override<T>(token: any, value: T): void {
    const originalBinding = (this.container as any).bindings.get(token);
    (this.container as any).bindings.set(token, {
      token,
      useValue: value,
      scope: 'singleton',
    });

    this.addCleanup(() => {
      if (originalBinding) {
        (this.container as any).bindings.set(token, originalBinding);
      } else {
        (this.container as any).bindings.delete(token);
      }
    });
  }
}