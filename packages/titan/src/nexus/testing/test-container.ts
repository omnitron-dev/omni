/**
 * Testing utilities for Nexus DI Container
 */

import { Container } from '../container.js';
import { IModule, Provider, ProviderDefinition, Constructor, InjectionToken, RegistrationOptions } from '../types.js';

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
  providers?: Array<[InjectionToken<any>, ProviderDefinition<any>]>;
  mocks?: MockConfig[];
  autoMock?: boolean;
  isolate?: boolean;
  detectLeaks?: boolean;
  trackMemory?: boolean;
}

/**
 * Interaction record for testing
 */
export interface Interaction {
  method: string;
  args: any[];
  result?: any;
  error?: Error;
  timestamp?: number;
}

/**
 * Spy expectation interface
 */
export interface SpyExpectation {
  verify(spy: any): boolean;
  getMessage(): string;
}

/**
 * Call count expectation
 */
export class CallCountExpectation implements SpyExpectation {
  constructor(
    private expectedCount: number,
    private comparison: 'exact' | 'atleast' | 'atmost' = 'exact'
  ) {}

  verify(spy: any): boolean {
    const actualCount = spy.mock.calls.length;
    switch (this.comparison) {
      case 'exact':
        return actualCount === this.expectedCount;
      case 'atleast':
        return actualCount >= this.expectedCount;
      case 'atmost':
        return actualCount <= this.expectedCount;
      default:
        return false;
    }
  }

  getMessage(): string {
    switch (this.comparison) {
      case 'exact':
        return `Expected exactly ${this.expectedCount} calls`;
      case 'atleast':
        return `Expected at least ${this.expectedCount} calls`;
      case 'atmost':
        return `Expected at most ${this.expectedCount} calls`;
      default:
        return 'Unknown comparison';
    }
  }
}

/**
 * Call arguments expectation
 */
export class CallArgumentsExpectation implements SpyExpectation {
  constructor(
    private expectedArgs: any[],
    private callIndex: number = 0
  ) {}

  verify(spy: any): boolean {
    const calls = spy.mock.calls;
    if (calls.length <= this.callIndex) {
      return false;
    }

    const actualArgs = calls[this.callIndex];
    if (actualArgs.length !== this.expectedArgs.length) {
      return false;
    }

    return this.expectedArgs.every((expected, index) => {
      const actual = actualArgs[index];
      if (typeof expected === 'object' && expected !== null) {
        return JSON.stringify(actual) === JSON.stringify(expected);
      }
      return actual === expected;
    });
  }

  getMessage(): string {
    return `Expected call ${this.callIndex} with arguments ${JSON.stringify(this.expectedArgs)}`;
  }
}

/**
 * Never called expectation
 */
export class NeverCalledExpectation implements SpyExpectation {
  verify(spy: any): boolean {
    return spy.mock.calls.length === 0;
  }

  getMessage(): string {
    return 'Expected spy to never be called';
  }
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
  private expectations = new Map<InjectionToken<any>, Map<string, SpyExpectation[]>>();
  private autoMock: boolean;
  private originalContainer?: Container;
  private detectLeaks: boolean;
  private trackMemory: boolean;
  private resolvedTokens = new Set<InjectionToken<any>>();
  private registeredTokens = new Set<InjectionToken<any>>();
  private initialObjectCount = 0;

  constructor(options: TestContainerOptions = {}) {
    super(options.isolate ? undefined : undefined);

    this.autoMock = options.autoMock || false;
    this.detectLeaks = options.detectLeaks || false;
    this.trackMemory = options.trackMemory || false;

    // Set initial object count baseline
    if (this.trackMemory) {
      this.initialObjectCount = this.getObjectCount();
    }

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

    // Track registered token
    if (this.detectLeaks) {
      this.registeredTokens.add(token);
    }

    // Create interaction-recording wrapper
    const wrappedMock = this.wrapWithInteractionRecording(token, mock);

    // Override registration
    this.register(token, { useValue: wrappedMock }, { tags: ['override'] });

    if (spy) {
      this.setupSpies(token, wrappedMock);
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
   * Wrap mock with interaction recording
   */
  private wrapWithInteractionRecording<T>(token: InjectionToken<T>, mock: T): T {
    if (typeof mock !== 'object' || mock === null) {
      return mock;
    }

    const wrapped = { ...mock } as any;

    // Wrap functions to record interactions
    for (const key in wrapped) {
      if (typeof wrapped[key] === 'function') {
        const originalFn = wrapped[key];
        wrapped[key] = jest.fn((...args: any[]) => {
          try {
            const result = originalFn(...args);
            this.recordInteraction(token, {
              method: key,
              args,
            });
            return result;
          } catch (error) {
            this.recordInteraction(token, {
              method: key,
              args,
              error: error as Error,
            });
            throw error;
          }
        });
      }
    }

    return wrapped;
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
  stub<T>(token: InjectionToken<T>, stub: Partial<T> | T): this {
    // Create a stub object where each property returns the specified value
    const stubObject = {} as any;
    const stubAsAny = stub as any;

    for (const key in stubAsAny) {
      const value = stubAsAny[key];
      if (typeof value === 'function') {
        // If the stub value is already a function, use it directly
        stubObject[key] = value;
      } else {
        // Otherwise, create a function that returns the value
        stubObject[key] = jest.fn(() => value);
      }
    }

    this.register(token, { useValue: stubObject }, { tags: ['override'] });
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
        this.register(token, { useValue: value }, { override: true, tags: ['override'] });
        return this;
      },
      useClass: (cls: Constructor<T>) => {
        this.register(token, { useClass: cls }, { override: true, tags: ['override'] });
        return this;
      },
      useFactory: (factory: (...args: any[]) => T) => {
        this.register(token, { useFactory: factory }, { override: true, tags: ['override'] });
        return this;
      },
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
    const interactions = this.interactions.get(token) || [];
    // Return interactions - if result/error/timestamp are undefined, they will be omitted
    return interactions.map(({ method, args, result, error, timestamp }) => {
      const interaction: Interaction = { method, args };
      if (result !== undefined) interaction.result = result;
      if (error !== undefined) interaction.error = error;
      if (timestamp !== undefined) interaction.timestamp = timestamp;
      return interaction;
    });
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
   * Restore from snapshot or to original state
   */
  restore(name?: string): void {
    if (name === undefined) {
      // Restore to original state - clear all overrides
      if ('registrations' in this) {
        (this as any).registrations.clear();
        (this as any).instances.clear();
      }

      this.mocks.clear();
      this.spies.clear();
      this.interactions.clear();
      return;
    }

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
   * Reset all mocks and spies
   */
  resetMocks(): void {
    // Reset regular mocks
    for (const mock of this.mocks.values()) {
      if (mock && typeof mock === 'object') {
        for (const key in mock) {
          const value = mock[key];
          if (value && jest.isMockFunction && jest.isMockFunction(value)) {
            value.mockReset();
          }
        }
      }
    }

    // Reset spies
    for (const spyMap of this.spies.values()) {
      for (const spy of spyMap.values()) {
        if (spy && spy.mockReset) {
          spy.mockReset();
        }
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
   * Add expectation for a spy
   */
  expect<T>(token: InjectionToken<T>, method: keyof T): {
    toBeCalledTimes: (count: number) => void;
    toBeCalledWith: (...args: any[]) => void;
    toBeCalledAtLeast: (count: number) => void;
    toBeCalledAtMost: (count: number) => void;
    neverBeCalled: () => void;
  } {
    const methodName = method as string;

    return {
      toBeCalledTimes: (count: number) => {
        this.addExpectation(token, methodName, new CallCountExpectation(count, 'exact'));
      },
      toBeCalledWith: (...args: any[]) => {
        this.addExpectation(token, methodName, new CallArgumentsExpectation(args));
      },
      toBeCalledAtLeast: (count: number) => {
        this.addExpectation(token, methodName, new CallCountExpectation(count, 'atleast'));
      },
      toBeCalledAtMost: (count: number) => {
        this.addExpectation(token, methodName, new CallCountExpectation(count, 'atmost'));
      },
      neverBeCalled: () => {
        this.addExpectation(token, methodName, new NeverCalledExpectation());
      },
    };
  }

  /**
   * Add an expectation
   */
  private addExpectation(token: InjectionToken<any>, method: string, expectation: SpyExpectation): void {
    let tokenExpectations = this.expectations.get(token);
    if (!tokenExpectations) {
      tokenExpectations = new Map();
      this.expectations.set(token, tokenExpectations);
    }

    let methodExpectations = tokenExpectations.get(method);
    if (!methodExpectations) {
      methodExpectations = [];
      tokenExpectations.set(method, methodExpectations);
    }

    methodExpectations.push(expectation);
  }

  /**
   * Get expectations for a token and method
   */
  private getExpectations(token: InjectionToken<any>, method: string): SpyExpectation[] {
    const tokenExpectations = this.expectations.get(token);
    if (!tokenExpectations) {
      return [];
    }

    return tokenExpectations.get(method) || [];
  }

  /**
   * Clear all expectations
   */
  clearExpectations(token?: InjectionToken<any>): void {
    if (token) {
      this.expectations.delete(token);
    } else {
      this.expectations.clear();
    }
  }

  /**
   * Verify no unexpected calls
   */
  verifyNoUnexpectedCalls(): void {
    const violations: string[] = [];

    for (const [token, spyMap] of this.spies) {
      for (const [method, spy] of spyMap) {
        const calls = spy.mock.calls;
        const expectations = this.getExpectations(token, method as string);

        // If there are calls but no expectations set, they are unexpected
        if (calls.length > 0 && expectations.length === 0) {
          const tokenName = typeof token === 'string' ? token : String(token);
          violations.push(
            `Unexpected ${calls.length} call(s) to ${tokenName}.${method as string}. ` +
              `Expected no calls but got: ${JSON.stringify(calls)}`
          );
        }

        // Verify each expectation
        for (const expectation of expectations) {
          if (!expectation.verify(spy)) {
            const tokenName = typeof token === 'string' ? token : String(token);
            violations.push(
              `Expectation failed for ${tokenName}.${method as string}: ${expectation.getMessage()}`
            );
          }
        }
      }
    }

    if (violations.length > 0) {
      throw new Error(`Unexpected calls detected:\n${violations.join('\n')}`);
    }
  }

  /**
   * Override register to track registered tokens for leak detection
   */
  override register<T>(
    tokenOrProvider: InjectionToken<T> | Provider<T> | Constructor<T>,
    providerOrOptions?: ProviderDefinition<T> | RegistrationOptions,
    optionsArg?: RegistrationOptions
  ): this {
    // Track registered tokens for leak detection and memory tracking
    if (this.detectLeaks || this.trackMemory) {
      // Extract token from various formats
      let token: InjectionToken<T> | undefined;
      if (
        typeof tokenOrProvider === 'function' ||
        typeof tokenOrProvider === 'string' ||
        typeof tokenOrProvider === 'symbol'
      ) {
        token = tokenOrProvider as InjectionToken<T>;
      } else if (tokenOrProvider && typeof tokenOrProvider === 'object' && 'id' in tokenOrProvider) {
        token = tokenOrProvider as InjectionToken<T>;
      }

      if (token) {
        this.registeredTokens.add(token);
      }
    }

    return super.register(tokenOrProvider as any, providerOrOptions as any, optionsArg);
  }

  /**
   * Override resolve to handle auto-mocking and leak detection
   */
  override resolve<T>(token: InjectionToken<T>): T {
    try {
      // Track resolved tokens for leak detection
      if (this.detectLeaks) {
        this.resolvedTokens.add(token);
      }

      // Try to resolve from this container first (for overrides)
      const result = super.resolve(token);
      return result;
    } catch (error) {
      // If not found and we have an original container, try that
      if (this.originalContainer) {
        try {
          const result = this.originalContainer.resolve(token);
          if (this.detectLeaks) {
            this.resolvedTokens.add(token);
          }
          return result;
        } catch (originalError) {
          // Continue to auto-mock if enabled
        }
      }

      // Auto-mock if enabled
      if (this.autoMock) {
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
    const name =
      typeof token === 'string'
        ? token
        : typeof token === 'symbol'
          ? String(token)
          : (token as any).constructor?.name || 'Unknown';

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
              timestamp: Date.now(),
            });
          });
        }
        return undefined;
      },
    });
  }

  /**
   * Create test container from existing container
   */
  static from(container: Container): TestContainer {
    const testContainer = new TestContainer();
    testContainer.originalContainer = container;

    // Don't copy registrations - let resolve method handle fallback
    return testContainer;
  }

  /**
   * Get current object count
   */
  private getObjectCount(): number {
    let objectCount = 0;

    // Count instances in the container
    if ('instances' in this) {
      objectCount += (this as any).instances.size;
    }

    // Count mocks
    objectCount += this.mocks.size;

    // Count all registered tokens (including provider objects)
    objectCount += this.registeredTokens.size;

    return objectCount;
  }

  /**
   * Get memory usage
   */
  getMemoryUsage(): { heapUsed: number; heapTotal: number; objectCount: number } {
    if (!this.trackMemory) {
      return { heapUsed: 0, heapTotal: 0, objectCount: 0 };
    }

    const memUsage = process.memoryUsage();
    const currentObjectCount = this.getObjectCount();

    return {
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      objectCount: currentObjectCount,
    };
  }

  /**
   * Stub with partial mocking and proper method creation
   */
  partialStub<T>(token: InjectionToken<T>, stubs: Partial<T>): this {
    const stubObject = {} as any;

    for (const key in stubs) {
      const value = stubs[key];
      if (typeof value === 'function') {
        stubObject[key] = value;
      } else {
        // Create a function that returns the stubbed value
        stubObject[key] = jest.fn().mockReturnValue(value);
      }
    }

    this.register(token, { useValue: stubObject }, { override: true, tags: ['override'] });
    return this;
  }

  /**
   * Get leaked tokens (tokens that were registered but not resolved)
   */
  getLeakedTokens(): InjectionToken<any>[] {
    if (!this.detectLeaks) {
      return [];
    }

    const leaked: InjectionToken<any>[] = [];

    // Check registrations that were never resolved
    for (const token of this.registeredTokens) {
      if (!this.resolvedTokens.has(token)) {
        leaked.push(token);
      }
    }

    return leaked;
  }

  /**
   * Get test metadata for testing
   */
  getTestMetadata(): {
    registeredTokens: Set<InjectionToken<any>>;
    resolvedTokens: Set<InjectionToken<any>>;
    mocks: Map<InjectionToken<any>, any>;
    spies: Map<InjectionToken<any>, Map<string, any>>;
  } {
    return {
      registeredTokens: new Set(this.registeredTokens),
      resolvedTokens: new Set(this.resolvedTokens),
      mocks: new Map(this.mocks),
      spies: new Map(this.spies),
    };
  }
}

/**
 * Create a test container
 */
export function createTestContainer(moduleOrOptions?: IModule | TestContainerOptions): TestContainer {
  if (moduleOrOptions && 'name' in moduleOrOptions) {
    // It's a module
    return new TestContainer({
      modules: [moduleOrOptions],
    });
  }

  return new TestContainer(moduleOrOptions);
}

/**
 * Create an isolated test container
 */
export function createIsolatedTestContainer(options: TestContainerOptions = {}): TestContainer {
  return new TestContainer({
    ...options,
    isolate: true,
  });
}

/**
 * Test module builder for dynamic test modules
 */
export class TestModuleBuilder {
  private providers: Array<[InjectionToken<any>, ProviderDefinition<any>]> = [];
  private imports: IModule[] = [];
  private mocks: MockConfig[] = [];

  withProvider<T>(token: InjectionToken<T>, provider: ProviderDefinition<T>): this {
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
      mocks: this.mocks,
    });
  }
}
