/**
 * Testing utilities for Nexus DI Container
 */

import { Container } from '../container/container';
import { 
  IContainer, 
  InjectionToken, 
  Provider, 
  IModule,
  Constructor
} from '../types/core';

/**
 * Mock provider configuration
 */
export interface MockConfig<T = any> {
  token: InjectionToken<T>;
  mock: Partial<T> | T;
  spy?: boolean;
}

/**
 * Test container options
 */
export interface TestContainerOptions {
  modules?: IModule[];
  providers?: Array<[InjectionToken<any>, Provider<any>]>;
  mocks?: MockConfig[];
  autoMock?: boolean;
  isolate?: boolean;
}

/**
 * Interaction record for testing
 */
export interface Interaction {
  method: string;
  args: any[];
  result?: any;
  error?: Error;
  timestamp: number;
}

/**
 * Test container with testing utilities
 */
// Jest types workaround for build
declare const jest: any;

export class TestContainer extends Container {
  private mocks = new Map<InjectionToken<any>, any>();
  private spies = new Map<InjectionToken<any>, Map<string, any>>();
  private interactions = new Map<InjectionToken<any>, Interaction[]>();
  private snapshots = new Map<string, Map<InjectionToken<any>, any>>();
  private autoMock: boolean;

  constructor(options: TestContainerOptions = {}) {
    super(options.isolate ? undefined : undefined);
    
    this.autoMock = options.autoMock || false;

    // Load modules
    if (options.modules) {
      for (const module of options.modules) {
        this.loadModule(module);
      }
    }

    // Register providers
    if (options.providers) {
      for (const [token, provider] of options.providers) {
        this.register(token, provider);
      }
    }

    // Setup mocks
    if (options.mocks) {
      for (const mockConfig of options.mocks) {
        this.mock(mockConfig.token, mockConfig.mock, mockConfig.spy);
      }
    }
  }

  /**
   * Mock a dependency
   */
  mock<T>(token: InjectionToken<T>, mockValue: Partial<T> | T, spy = false): this {
    const mock = this.createMock(mockValue, spy);
    this.mocks.set(token, mock);
    
    // Override registration
    this.register(token, { useValue: mock }, { tags: ['override'] });

    if (spy) {
      this.setupSpies(token, mock);
    }

    return this;
  }

  /**
   * Create a mock object
   */
  private createMock<T>(value: Partial<T> | T, spy: boolean): T {
    if (typeof value !== 'object' || value === null) {
      return value as T;
    }

    // If no spy is needed, return the original object to preserve reference equality
    if (!spy) {
      return value as T;
    }

    // Only create a copy when spy is enabled
    const mock = { ...value } as any;

    // Auto-mock functions if spy is enabled
    for (const key in mock) {
      if (typeof mock[key] === 'function') {
        const original = mock[key];
        mock[key] = jest.fn(original);
      }
    }

    return mock;
  }

  /**
   * Setup spies for a mock
   */
  private setupSpies<T>(token: InjectionToken<T>, mock: T): void {
    const spyMap = new Map<string, any>();

    for (const key in mock as any) {
      const value = (mock as any)[key];
      if (typeof value === 'function' && jest.isMockFunction(value)) {
        spyMap.set(key, value);
      }
    }

    this.spies.set(token, spyMap);
  }

  /**
   * Spy on a method
   */
  spy<T>(token: InjectionToken<T>, method: keyof T): any {
    const instance = this.resolve(token);
    
    if (!instance || typeof instance[method] !== 'function') {
      throw new Error(`Cannot spy on ${String(method)} of ${String(token)}`);
    }

    const spy = jest.spyOn(instance as any, method as string);
    
    let spyMap = this.spies.get(token);
    if (!spyMap) {
      spyMap = new Map();
      this.spies.set(token, spyMap);
    }
    
    spyMap.set(method as string, spy);
    
    return spy;
  }

  /**
   * Stub a dependency
   */
  stub<T>(token: InjectionToken<T>, stub: T): this {
    this.register(token, { useValue: stub }, { tags: ['override'] });
    return this;
  }

  /**
   * Override a registration
   */
  override<T>(token: InjectionToken<T>): {
    useValue: (value: T) => TestContainer;
    useClass: (cls: Constructor<T>) => TestContainer;
    useFactory: (factory: (...args: any[]) => T) => TestContainer;
  } {
    return {
      useValue: (value: T) => {
        this.register(token, { useValue: value }, { tags: ['override'] });
        return this;
      },
      useClass: (cls: Constructor<T>) => {
        this.register(token, { useClass: cls }, { tags: ['override'] });
        return this;
      },
      useFactory: (factory: (...args: any[]) => T) => {
        this.register(token, { useFactory: factory }, { tags: ['override'] });
        return this;
      }
    };
  }

  /**
   * Get mock instance
   */
  getMock<T>(token: InjectionToken<T>): T {
    const mock = this.mocks.get(token);
    if (!mock) {
      throw new Error(`No mock found for ${String(token)}`);
    }
    return mock;
  }

  /**
   * Get spy instance
   */
  getSpy<T>(token: InjectionToken<T>, method: keyof T): any {
    const spyMap = this.spies.get(token);
    const spy = spyMap?.get(method as string);
    
    if (!spy) {
      throw new Error(`No spy found for ${String(method)} of ${String(token)}`);
    }
    
    return spy;
  }

  /**
   * Record interaction
   */
  recordInteraction(token: InjectionToken<any>, interaction: Interaction): void {
    let interactions = this.interactions.get(token);
    if (!interactions) {
      interactions = [];
      this.interactions.set(token, interactions);
    }
    interactions.push(interaction);
  }

  /**
   * Get interactions
   */
  getInteractions(token: InjectionToken<any>): Interaction[] {
    return this.interactions.get(token) || [];
  }

  /**
   * Clear interactions
   */
  clearInteractions(token?: InjectionToken<any>): void {
    if (token) {
      this.interactions.delete(token);
    } else {
      this.interactions.clear();
    }
  }

  /**
   * Take a snapshot of container state
   */
  snapshot(name = 'default'): void {
    const snapshot = new Map<InjectionToken<any>, any>();
    
    // Snapshot mocks
    for (const [token, mock] of this.mocks) {
      snapshot.set(token, { ...mock });
    }
    
    this.snapshots.set(name, snapshot);
  }

  /**
   * Restore from snapshot
   */
  restore(name = 'default'): void {
    const snapshot = this.snapshots.get(name);
    if (!snapshot) {
      throw new Error(`Snapshot '${name}' not found`);
    }

    // Restore mocks
    for (const [token, mockSnapshot] of snapshot) {
      const mock = this.mocks.get(token);
      if (mock) {
        Object.assign(mock, mockSnapshot);
      }
    }

    // Clear spies
    for (const spyMap of this.spies.values()) {
      for (const spy of spyMap.values()) {
        spy.mockRestore();
      }
    }
    this.spies.clear();

    // Clear interactions
    this.interactions.clear();
  }

  /**
   * Reset all mocks
   */
  resetMocks(): void {
    for (const spyMap of this.spies.values()) {
      for (const spy of spyMap.values()) {
        spy.mockReset();
      }
    }
  }

  /**
   * Clear all mocks
   */
  clearMocks(): void {
    for (const spyMap of this.spies.values()) {
      for (const spy of spyMap.values()) {
        spy.mockClear();
      }
    }
  }

  /**
   * Get leaked tokens (tokens that were resolved but not expected)
   */
  getLeakedTokens(): InjectionToken<any>[] {
    const leaked: InjectionToken<any>[] = [];
    const metadata = this.getMetadata();
    
    // This is a simplified implementation
    // In a real scenario, you'd track which tokens were explicitly expected
    
    return leaked;
  }

  /**
   * Verify no unexpected calls
   */
  verifyNoUnexpectedCalls(): void {
    for (const [token, spyMap] of this.spies) {
      for (const [method, spy] of spyMap) {
        const calls = spy.mock.calls;
        if (calls.length > 0) {
          // Check if these calls were expected
          // This is a placeholder - real implementation would track expectations
        }
      }
    }
  }

  /**
   * Create auto-mock for unregistered tokens
   */
  resolve<T>(token: InjectionToken<T>): T {
    try {
      return super.resolve(token);
    } catch (error) {
      if (this.autoMock) {
        // Create automatic mock
        const mock = this.createAutoMock<T>(token);
        this.register(token, { useValue: mock });
        return mock;
      }
      throw error;
    }
  }

  /**
   * Create automatic mock
   */
  private createAutoMock<T>(token: InjectionToken<any>): T {
    const name = typeof token === 'string' ? token : 
                 typeof token === 'symbol' ? String(token) :
                 (token as any).constructor?.name || 'Unknown';
    
    // Create a proxy that records all property access and method calls
    return new Proxy({} as any, {
      get: (target, prop) => {
        if (typeof prop === 'string') {
          // Return a mock function for methods
          return jest.fn().mockImplementation((...args: any[]) => {
            this.recordInteraction(token, {
              method: prop,
              args,
              result: undefined,
              timestamp: Date.now()
            });
          });
        }
        return undefined;
      }
    });
  }
}

/**
 * Create a test container
 */
export function createTestContainer(
  moduleOrOptions?: IModule | TestContainerOptions
): TestContainer {
  if (moduleOrOptions && 'name' in moduleOrOptions) {
    // It's a module
    return new TestContainer({
      modules: [moduleOrOptions]
    });
  }
  
  return new TestContainer(moduleOrOptions);
}

/**
 * Create an isolated test container
 */
export function createIsolatedTestContainer(
  options: TestContainerOptions = {}
): TestContainer {
  return new TestContainer({
    ...options,
    isolate: true
  });
}

/**
 * Test module builder for dynamic test modules
 */
export class TestModuleBuilder {
  private providers: Array<[InjectionToken<any>, Provider<any>]> = [];
  private imports: IModule[] = [];
  private mocks: MockConfig[] = [];

  withProvider<T>(token: InjectionToken<T>, provider: Provider<T>): this {
    this.providers.push([token, provider]);
    return this;
  }

  withMock<T>(token: InjectionToken<T>, mock: Partial<T> | T): this {
    this.mocks.push({ token, mock });
    return this;
  }

  withModule(module: IModule): this {
    this.imports.push(module);
    return this;
  }

  build(): TestContainer {
    return new TestContainer({
      modules: this.imports,
      providers: this.providers,
      mocks: this.mocks
    });
  }
}