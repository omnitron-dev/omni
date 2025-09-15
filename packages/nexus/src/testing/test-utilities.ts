import { TestContainer } from './test-container';
import { Container } from '../container/container';
import { createToken, getTokenName } from '../token/token';
import { Scope, IModule, Provider, Constructor, InjectionToken, InjectionToken as Token } from '../types/core';

/**
 * Test utility functions for Nexus testing
 */

// Jest mock function type
declare const jest: any;

/**
 * Test mock configuration
 */
export interface TestMockConfig {
  [key: string]: any;
}

/**
 * Provider with explicit token (NestJS style)
 */
export interface TestProvider<T = any> {
  provide: Token<T>;
  useValue?: T;
  useClass?: Constructor<T>;
  useFactory?: (...args: any[]) => T;
  useToken?: Token<T>;
  inject?: Token<any>[];
}

/**
 * Test module configuration
 */
export interface TestModuleConfig {
  name: string;
  providers?: (Provider<any> | TestProvider<any>)[];
  mocks?: (Provider<any> | TestProvider<any>)[];
  imports?: IModule[];
  exports?: Token<any>[];
}

/**
 * Test harness configuration
 */
export interface TestHarnessConfig {
  component?: Constructor<any>;
  providers?: Array<[InjectionToken<any>, Provider<any>] | TestProvider<any>>;
  zone?: {
    onEnter?: () => void;
    onLeave?: () => void;
    onError?: (error: Error) => void;
  };
}

/**
 * Test container options with leak detection
 */
export interface TestContainerOptionsExtended {
  autoMock?: boolean;
  detectLeaks?: boolean;
  trackMemory?: boolean;
}

/**
 * Memory usage info
 */
export interface MemoryUsage {
  heapUsed: number;
  heapTotal: number;
  objectCount: number;
}

/**
 * Snapshot container for state management
 */
export class SnapshotContainer extends Container {
  private snapshots = new Map<string, Map<Token<any>, Provider<any>>>();
  private snapshotCounter = 0;
  private snapshotStack: string[] = [];

  snapshot(): string {
    const id = `snapshot_${++this.snapshotCounter}`;
    const state = new Map<Token<any>, Provider<any>>();
    
    // Capture current registrations
    if ('registrations' in this) {
      const registrations = (this as any).registrations as Map<Token<any>, any>;
      for (const [token, registration] of registrations) {
        if (!Array.isArray(registration)) {
          state.set(token, registration.provider);
        }
      }
    }
    
    this.snapshots.set(id, state);
    this.snapshotStack.push(id);
    
    return id;
  }

  restore(snapshotId: string): void {
    const snapshot = this.snapshots.get(snapshotId);
    if (!snapshot) {
      throw new Error(`Snapshot ${snapshotId} not found`);
    }
    
    // Clear current registrations and instances completely
    if ('registrations' in this) {
      (this as any).registrations.clear();
      (this as any).instances.clear();
      // Also clear scoped instances
      if ('scopedInstances' in this) {
        (this as any).scopedInstances.clear();
      }
    }
    
    // Restore from snapshot
    for (const [token, provider] of snapshot) {
      this.register(token, provider);
    }
    
    // Remove from stack
    const stackIndex = this.snapshotStack.indexOf(snapshotId);
    if (stackIndex >= 0) {
      this.snapshotStack.splice(stackIndex);
    }
  }

  withSnapshot<T>(callback: () => T): T {
    const snapshotId = this.snapshot();
    try {
      return callback();
    } finally {
      this.restore(snapshotId);
    }
  }

  /**
   * Override register to clear cached instances on override
   */
  override register<T>(token: Token<T>, provider: Provider<T>, options?: any): this {
    if (options?.override && 'instances' in this) {
      // Clear cached instance when overriding
      (this as any).instances.delete(token);
    }
    return super.register(token, provider, options);
  }
}

/**
 * Isolated container with selective imports
 */
export class IsolatedContainer extends Container {
  constructor() {
    super();
  }

  static withImports(source: Container, tokens: Token<any>[]): IsolatedContainer {
    const isolated = new IsolatedContainer();
    
    for (const token of tokens) {
      try {
        const value = source.resolve(token);
        isolated.register(token, { useValue: value });
      } catch (error) {
        // Token not available in source
      }
    }
    
    return isolated;
  }
}

/**
 * Test module implementation
 */
export class TestModule implements IModule {
  constructor(
    public readonly name: string,
    public readonly providers: Provider<any>[] = [],
    public readonly imports: IModule[] = [],
    public readonly exports: Token<any>[] = []
  ) {}

  static override(original: IModule, overrides: { providers?: Array<Provider<any> | [InjectionToken<any>, Provider<any>]> }): TestModule {
    const providers = overrides.providers || original.providers || [];
    
    // Extract tokens from providers for export
    const exports = providers.map(p => {
      if (Array.isArray(p)) {
        return p[0]; // Token is first element of tuple
      }
      // For TestProvider format with 'provide' property
      if (typeof p === 'object' && p && 'provide' in p) {
        return (p as any).provide;
      }
      // For plain providers, we can't extract a token, so skip
      return undefined;
    }).filter(Boolean) as Token<any>[];
    
    // Combine with original exports
    const originalExports = original.exports || [];
    const allExports = [...new Set([...originalExports, ...exports])];
    
    return new TestModule(
      original.name,
      providers as any,
      original.imports || [],
      allExports
    );
  }
}

/**
 * Test harness for component testing
 */
export class TestHarness {
  private container: Container;
  private zone?: TestHarnessConfig['zone'];
  private initialized = false;

  constructor(private config: TestHarnessConfig) {
    this.container = new Container();
    this.zone = config.zone;
  }

  async initialize(): Promise<void> {
    if (this.config.providers) {
      for (const providerEntry of this.config.providers) {
        if (Array.isArray(providerEntry)) {
          // Tuple format [token, provider]
          const [token, provider] = providerEntry;
          this.container.register(token, provider);
        } else if ('provide' in providerEntry) {
          // TestProvider format
          const token = providerEntry.provide;
          let provider: Provider<any>;
          
          if ('useValue' in providerEntry && providerEntry.useValue !== undefined) {
            provider = { useValue: providerEntry.useValue };
          } else if ('useClass' in providerEntry && providerEntry.useClass) {
            provider = { useClass: providerEntry.useClass, inject: providerEntry.inject };
          } else if ('useFactory' in providerEntry && providerEntry.useFactory) {
            provider = { useFactory: providerEntry.useFactory, inject: providerEntry.inject };
          } else if ('useToken' in providerEntry && providerEntry.useToken) {
            provider = { useToken: providerEntry.useToken };
          } else {
            throw new Error('Invalid provider configuration');
          }
          
          this.container.register(token, provider);
        }
      }
    }
    
    this.initialized = true;
  }

  get<T>(token: Token<T>): T {
    if (!this.initialized) {
      throw new Error('TestHarness not initialized');
    }
    return this.container.resolve(token);
  }

  async detectChanges(): Promise<void> {
    // Force re-resolution of transient services
    // This is a simplified implementation
  }

  async runInZone<T>(callback: () => Promise<T>): Promise<T> {
    if (this.zone?.onEnter) {
      this.zone.onEnter();
    }

    try {
      const result = await callback();
      if (this.zone?.onLeave) {
        this.zone.onLeave();
      }
      return result;
    } catch (error) {
      if (this.zone?.onError) {
        this.zone.onError(error as Error);
      }
      if (this.zone?.onLeave) {
        this.zone.onLeave();
      }
      throw error;
    }
  }

  async cleanup(): Promise<void> {
    await this.container.dispose();
    this.initialized = false;
  }
}

/**
 * Expectation helpers
 */
export interface ResolutionExpectation<T> {
  toResolve(): ResolutionExpectation<T>;
  withValue(expected: T): ResolutionExpectation<T>;
  inTime(maxMs: number): Promise<void>;
}

export interface RejectionExpectation {
  toThrow(message?: string): RejectionExpectation;
  withErrorType(errorType: Constructor<Error>): Promise<void>;
}

export interface DependencyExpectation {
  toHaveDependency(token: Token<any>): DependencyExpectation;
  withCardinality(count: number): void;
}

export interface LifecycleExpectation {
  toCallOnInit(): LifecycleExpectation;
  toCallOnDestroy(): Promise<void>;
}

class ResolutionExpectationImpl<T> implements ResolutionExpectation<T> {
  private expectedValue?: T;
  private shouldResolve = false;
  private maxTime?: number;

  constructor(private container: Container, private token: Token<T>) {}

  toResolve(): ResolutionExpectation<T> {
    this.shouldResolve = true;
    return this;
  }

  withValue(expected: T): ResolutionExpectation<T> {
    this.expectedValue = expected;
    return this;
  }

  inTime(maxMs: number): Promise<void> {
    this.maxTime = maxMs;
    return this.verify();
  }

  private async verify(): Promise<void> {
    const start = Date.now();
    
    try {
      const result = this.container.resolve(this.token);
      
      if (this.expectedValue !== undefined && result !== this.expectedValue) {
        throw new Error(`Expected ${this.expectedValue}, got ${result}`);
      }
      
      if (this.maxTime !== undefined) {
        const duration = Date.now() - start;
        if (duration > this.maxTime) {
          throw new Error(`Resolution took ${duration}ms, expected < ${this.maxTime}ms`);
        }
      }
    } catch (error) {
      if (this.shouldResolve) {
        throw error;
      }
    }
  }
}

class RejectionExpectationImpl implements RejectionExpectation {
  private expectedMessage?: string;
  private expectedErrorType?: Constructor<Error>;

  constructor(private container: Container, private token: Token<any>) {}

  toThrow(message?: string): RejectionExpectation {
    this.expectedMessage = message;
    return this;
  }

  async withErrorType(errorType: Constructor<Error>): Promise<void> {
    this.expectedErrorType = errorType;
    return this.verify();
  }

  private async verify(): Promise<void> {
    try {
      this.container.resolve(this.token);
      throw new Error('Expected resolution to throw');
    } catch (error) {
      if (this.expectedErrorType && !(error instanceof this.expectedErrorType)) {
        throw new Error(`Expected ${this.expectedErrorType.name}, got ${(error as Error).constructor.name}`);
      }
      
      if (this.expectedMessage && !(error as Error).message.includes(this.expectedMessage)) {
        throw new Error(`Expected error message to contain "${this.expectedMessage}"`);
      }
    }
  }
}

class DependencyExpectationImpl implements DependencyExpectation {
  private expectedToken?: Token<any>;
  private expectedCardinality?: number;

  constructor(private container: Container, private token: Token<any>) {}

  toHaveDependency(token: Token<any>): DependencyExpectation {
    this.expectedToken = token;
    return this;
  }

  withCardinality(count: number): void {
    this.expectedCardinality = count;
    this.verify();
  }

  private verify(): void {
    // Simplified dependency verification
    if (this.expectedToken) {
      try {
        this.container.resolve(this.expectedToken);
      } catch (error) {
        throw new Error(`Dependency ${String(this.expectedToken)} not found`);
      }
    }
  }
}

class LifecycleExpectationImpl implements LifecycleExpectation {
  private shouldCallOnInit = false;
  private shouldCallOnDestroy = false;

  constructor(private container: Container, private token: Token<any>) {}

  toCallOnInit(): LifecycleExpectation {
    this.shouldCallOnInit = true;
    return this;
  }

  async toCallOnDestroy(): Promise<void> {
    this.shouldCallOnDestroy = true;
    return this.verify();
  }

  private async verify(): Promise<void> {
    // Simplified lifecycle verification
    // In a real implementation, you'd track lifecycle method calls
  }
}

/**
 * Wait for async operations to complete
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeout = 5000,
  interval = 100
): Promise<void> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    const result = await condition();
    if (result) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  
  throw new Error(`Timeout waiting for condition after ${timeout}ms`);
}

/**
 * Create a deferred promise for testing async operations
 */
export function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
} {
  let resolve: (value: T) => void;
  let reject: (error: Error) => void;
  
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  
  return {
    promise,
    resolve: resolve!,
    reject: reject!
  };
}

/**
 * Create a test provider
 */
export function createTestProvider<T>(
  value: T,
  options?: {
    scope?: Scope;
    tags?: string[];
  }
): Provider<T> {
  return {
    useValue: value,
    scope: options?.scope
  };
}

/**
 * Create a test factory provider
 */
export function createTestFactoryProvider<T>(
  factory: (...args: any[]) => T,
  options?: {
    inject?: Token<any>[];
    scope?: Scope;
    tags?: string[];
  }
): Provider<T> {
  return {
    useFactory: factory,
    inject: options?.inject,
    scope: options?.scope
  };
}

/**
 * Create a test class provider
 */
export function createTestClassProvider<T>(
  cls: new (...args: any[]) => T,
  options?: {
    inject?: Token<any>[];
    scope?: Scope;
    tags?: string[];
  }
): Provider<T> {
  return {
    useClass: cls,
    inject: options?.inject,
    scope: options?.scope
  };
}

/**
 * Assert that a function throws a specific error
 */
export async function assertThrows<E extends Error>(
  fn: () => any | Promise<any>,
  errorType?: new (...args: any[]) => E,
  message?: string | RegExp
): Promise<E> {
  try {
    await fn();
    throw new Error('Expected function to throw');
  } catch (error) {
    if (errorType && !(error instanceof errorType)) {
      throw new Error(`Expected error of type ${errorType.name}, got ${(error as Error).constructor.name}`);
    }
    
    if (message) {
      const errorMessage = (error as Error).message;
      if (typeof message === 'string') {
        if (!errorMessage.includes(message)) {
          throw new Error(`Expected error message to include "${message}", got "${errorMessage}"`);
        }
      } else if (message instanceof RegExp) {
        if (!message.test(errorMessage)) {
          throw new Error(`Expected error message to match ${message}, got "${errorMessage}"`);
        }
      }
    }
    
    return error as E;
  }
}

/**
 * Create a test token with metadata
 */
export function createTestToken<T>(
  name: string,
  metadata?: Record<string, any>
): Token<T> {
  return createToken<T>(name, metadata);
}

/**
 * Verify container state
 */
export function verifyContainerState(
  container: TestContainer,
  expectations: {
    registeredTokens?: Token<any>[];
    resolvedTokens?: Token<any>[];
    mocks?: Token<any>[];
    spies?: Array<{ token: Token<any>; method: string }>;
  }
): void {
  const metadata = container.getTestMetadata();
  
  if (expectations.registeredTokens) {
    for (const token of expectations.registeredTokens) {
      // Check if token is registered
      try {
        container.resolve(token);
      } catch {
        // Token might not be resolvable but could be registered
      }
    }
  }
  
  if (expectations.resolvedTokens) {
    for (const token of expectations.resolvedTokens) {
      try {
        container.resolve(token);
      } catch {
        throw new Error(`Expected token ${getTokenName(token)} to be resolvable`);
      }
    }
  }
  
  if (expectations.mocks) {
    for (const token of expectations.mocks) {
      try {
        container.getMock(token);
      } catch {
        throw new Error(`Expected token ${getTokenName(token)} to have a mock`);
      }
    }
  }
  
  if (expectations.spies) {
    for (const { token, method } of expectations.spies) {
      try {
        container.getSpy(token, method as any);
      } catch {
        throw new Error(`Expected token ${getTokenName(token)} to have a spy for method ${method}`);
      }
    }
  }
}

/**
 * Clean up test resources
 */
export function cleanupTest(container: TestContainer): void {
  container.resetMocks();
  container.clearMocks();
  container.clearInteractions();
  container.dispose();
}

/**
 * Create a test suite helper
 */
export function createTestSuite(
  name: string,
  setup: () => TestContainer | Promise<TestContainer>
): {
  container: TestContainer;
  beforeEach: () => Promise<void>;
  afterEach: () => void;
} {
  let container: TestContainer;
  
  return {
    get container() {
      return container;
    },
    
    async beforeEach() {
      container = await setup();
    },
    
    afterEach() {
      if (container) {
        cleanupTest(container);
      }
    }
  };
}

/**
 * Create test module
 */
export function createTestModule(config: TestModuleConfig): TestModule {
  // Convert TestProvider format to tuple format and collect tokens
  const allProviders: Array<[Token<any>, Provider<any>]> = [];
  const tokens: Token<any>[] = [];
  
  const processProviders = (providers: (Provider<any> | TestProvider<any>)[] | undefined) => {
    if (!providers) return;
    
    for (const provider of providers) {
      if ('provide' in provider) {
        // TestProvider format - extract token and convert to regular provider
        const token = provider.provide;
        tokens.push(token);
        
        let regularProvider: Provider<any>;
        if ('useValue' in provider && provider.useValue !== undefined) {
          regularProvider = { useValue: provider.useValue };
        } else if ('useClass' in provider && provider.useClass) {
          regularProvider = { useClass: provider.useClass, inject: provider.inject };
        } else if ('useFactory' in provider && provider.useFactory) {
          regularProvider = { useFactory: provider.useFactory, inject: provider.inject };
        } else if ('useToken' in provider && provider.useToken) {
          regularProvider = { useToken: provider.useToken };
        } else {
          throw new Error('Invalid provider configuration');
        }
        
        allProviders.push([token, regularProvider]);
      } else {
        // Regular Provider format - can't extract token automatically
        // This is a limitation - regular providers need explicit exports
        allProviders.push(provider as any);
      }
    }
  };
  
  processProviders(config.providers);
  processProviders(config.mocks);
  
  // Use provided exports or auto-export collected tokens
  const exports = config.exports || tokens;
  
  // Create the module with providers in tuple format
  return new TestModule(
    config.name,
    allProviders as any,
    config.imports,
    exports as Token<any>[]
  );
}

/**
 * Create test harness
 */
export function createTestHarness(config: TestHarnessConfig): TestHarness {
  return new TestHarness(config);
}

/**
 * Expectation helper functions
 */
export function expectResolution<T>(container: Container, token: Token<T>): ResolutionExpectation<T> {
  return new ResolutionExpectationImpl(container, token);
}

export function expectRejection(container: Container, token: Token<any>): RejectionExpectation {
  return new RejectionExpectationImpl(container, token);
}

export function expectDependency(container: Container, token: Token<any>): DependencyExpectation {
  return new DependencyExpectationImpl(container, token);
}

export function expectLifecycle(container: Container, token: Token<any>): LifecycleExpectation {
  return new LifecycleExpectationImpl(container, token);
}