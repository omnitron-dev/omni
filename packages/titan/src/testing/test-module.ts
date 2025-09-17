import { IModule, Provider, InjectionToken } from '@omnitron-dev/nexus';
import { TestContainer, createTestContainer } from '@omnitron-dev/nexus/testing';

import { Application } from '../application.js';
import { IApplicationConfig } from '../types.js';

/**
 * Options for creating a test module
 */
export interface TestModuleOptions {
  modules?: IModule[];
  providers?: Array<[InjectionToken<any>, Provider<any>]>;
  mocks?: Array<{
    token: InjectionToken<any>;
    mock: any;
    spy?: boolean;
  }>;
  config?: Partial<IApplicationConfig>;
  autoMock?: boolean;
}

/**
 * Test module for Titan applications
 */
export class TestModule {
  private container: TestContainer;
  private app?: Application;

  constructor(private options: TestModuleOptions = {}) {
    this.container = createTestContainer({
      modules: options.modules || [],
      providers: options.providers || [],
      mocks: options.mocks || [],
      autoMock: options.autoMock || false
    });
  }

  /**
   * Get the test container
   */
  getContainer(): TestContainer {
    return this.container;
  }

  /**
   * Create an application instance for testing
   */
  async createApplication(): Promise<Application> {
    if (this.app) {
      return this.app;
    }

    const config: IApplicationConfig = {
      name: 'test-app',
      version: '0.0.0-test',
      ...this.options.config
    };

    this.app = new Application(config);

    // Use the test container for dependency injection
    (this.app as any).container = this.container;

    // Load modules if provided
    if (this.options.modules) {
      for (const module of this.options.modules) {
        this.container.loadModule(module);
      }
    }

    return this.app;
  }

  /**
   * Mock a dependency
   */
  mock<T>(token: InjectionToken<T>, mock: T, spy = false): this {
    this.container.mock(token, mock, spy);
    return this;
  }

  /**
   * Stub a dependency with partial implementation
   */
  stub<T>(token: InjectionToken<T>, stub: Partial<T>): this {
    this.container.stub(token, stub);
    return this;
  }

  /**
   * Override a dependency
   */
  override<T>(token: InjectionToken<T>): {
    useValue: (value: T) => TestModule;
    useClass: (cls: new (...args: any[]) => T) => TestModule;
    useFactory: (factory: (...args: any[]) => T) => TestModule;
  } {
    const self = this;
    return {
      useValue: (value: T) => {
        this.container.override(token).useValue(value);
        return self;
      },
      useClass: (cls: new (...args: any[]) => T) => {
        this.container.override(token).useClass(cls);
        return self;
      },
      useFactory: (factory: (...args: any[]) => T) => {
        this.container.override(token).useFactory(factory);
        return self;
      }
    };
  }

  /**
   * Spy on a method
   */
  spy<T>(token: InjectionToken<T>, method: keyof T): any {
    return this.container.spy(token, method);
  }

  /**
   * Get a service from the container
   */
  get<T>(token: InjectionToken<T>): T {
    return this.container.resolve(token);
  }

  /**
   * Reset all mocks
   */
  resetMocks(): void {
    this.container.resetMocks();
  }

  /**
   * Clear all mocks
   */
  clearMocks(): void {
    this.container.clearMocks();
  }

  /**
   * Restore to original state
   */
  restore(): void {
    this.container.restore();
  }

  /**
   * Clean up resources
   */
  async cleanup(): Promise<void> {
    if (this.app) {
      await this.app.stop();
      this.app = undefined;
    }
    this.container.restore();
  }
}

/**
 * Create a test module
 */
export function createTestModule(options: TestModuleOptions = {}): TestModule {
  return new TestModule(options);
}

/**
 * Test module builder for fluent API
 */
export class TestModuleBuilder {
  private options: TestModuleOptions = {
    modules: [],
    providers: [],
    mocks: [],
    config: {}
  };

  /**
   * Add a module to test
   */
  withModule(module: IModule): this {
    this.options.modules!.push(module);
    return this;
  }

  /**
   * Add a provider
   */
  withProvider<T>(token: InjectionToken<T>, provider: Provider<T>): this {
    this.options.providers!.push([token, provider]);
    return this;
  }

  /**
   * Add a mock
   */
  withMock<T>(token: InjectionToken<T>, mock: T, spy = false): this {
    this.options.mocks!.push({ token, mock, spy });
    return this;
  }

  /**
   * Set application config
   */
  withConfig(config: Partial<IApplicationConfig>): this {
    this.options.config = { ...this.options.config, ...config };
    return this;
  }

  /**
   * Enable auto-mocking
   */
  withAutoMock(): this {
    this.options.autoMock = true;
    return this;
  }

  /**
   * Build the test module
   */
  build(): TestModule {
    return new TestModule(this.options);
  }
}

/**
 * Create a test module builder
 */
export function testModule(): TestModuleBuilder {
  return new TestModuleBuilder();
}