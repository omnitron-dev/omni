import { ProviderDefinition, InjectionToken as Token } from '@omnitron-dev/titan/nexus';

// Vitest type declaration (for build compatibility)
declare const vi: any;

/**
 * Mock provider configuration
 */
export interface MockProviderConfig<T = any> {
  token: Token<T>;
  value?: T;
  factory?: (...args: any[]) => T;
  spy?: boolean;
  autoMock?: boolean;
}

/**
 * Mock provider for testing (original implementation for DI)
 */
export class MockProviderDI<T> {
  private provider: ProviderDefinition<T>;

  constructor(private config: MockProviderConfig<T>) {
    if (config.value !== undefined) {
      this.provider = { useValue: config.value };
    } else if (config.factory) {
      this.provider = { useFactory: config.factory };
    } else if (config.autoMock) {
      this.provider = { useFactory: () => this.createAutoMock() };
    } else {
      this.provider = { useValue: {} as T };
    }
  }

  getProvider(): ProviderDefinition<T> {
    return this.provider;
  }

  /**
   * Create an automatic mock
   */
  private createAutoMock(): T {
    // Create a proxy that returns vi mocks for all properties
    return new Proxy({} as any, {
      get(target, prop) {
        if (typeof prop === 'string') {
          if (!(prop in target)) {
            (target as any)[prop] = vi.fn();
          }
          return (target as any)[prop];
        }
        return undefined;
      },
    });
  }

  /**
   * Create a spy wrapper around the mock
   */
  createSpy(): T {
    const provider = this.provider;
    let mock: T | undefined;

    if ('useValue' in provider) {
      mock = provider.useValue;
    } else {
      // For factories and other cases, use automock
      mock = this.createAutoMock();
    }

    if (!mock) {
      mock = this.createAutoMock();
    }

    if (typeof mock === 'object' && mock !== null) {
      // Wrap all functions with vi spies
      const spy = { ...mock } as any;

      for (const key in spy) {
        if (typeof spy[key] === 'function') {
          spy[key] = vi.fn(spy[key]);
        }
      }

      return spy;
    }

    return mock as T;
  }
}

/**
 * Create a mock provider
 */
export function createMockProvider<T>(config: MockProviderConfig<T>): MockProviderDI<T> {
  return new MockProviderDI(config);
}

/**
 * Create an auto-mock provider
 */
export function createAutoMockProvider<T>(token: Token<T>): MockProviderDI<T> {
  return new MockProviderDI({
    token,
    autoMock: true,
  });
}

/**
 * Mock provider that wraps vi mocks (for test utilities)
 */
export class MockProvider {
  constructor(private mockImplementation: Record<string, any>) {
    // Copy all mock methods to the provider instance
    for (const [key, value] of Object.entries(mockImplementation)) {
      if (typeof value === 'function' && vi.isMockFunction && vi.isMockFunction(value)) {
        (this as any)[key] = value;
      } else {
        // Wrap non-mock functions with vi.fn()
        (this as any)[key] = typeof value === 'function' ? vi.fn(value) : value;
      }
    }
  }

  [key: string]: any;
}

/**
 * Spy provider that wraps original implementation with spies
 */
export class SpyProvider {
  private calls = new Map<string, Array<{ args: any[]; result?: any; error?: Error }>>();
  private spies = new Map<string, any>();

  constructor(
    private original: any,
    methods: string[]
  ) {
    for (const method of methods) {
      if (typeof this.original[method] === 'function') {
        const spy = vi.spyOn(this.original, method);
        this.spies.set(method, spy);

        // Wrap to track calls manually too
        (this as any)[method] = (...args: any[]) => {
          try {
            const result = this.original[method](...args);
            this.recordCall(method, args, result);
            return result;
          } catch (error) {
            this.recordCall(method, args, undefined, error as Error);
            throw error;
          }
        };
      }
    }
  }

  private recordCall(method: string, args: any[], result?: any, error?: Error): void {
    if (!this.calls.has(method)) {
      this.calls.set(method, []);
    }
    this.calls.get(method)!.push({ args, result, error });
  }

  getCallCount(method: string): number {
    return this.calls.get(method)?.length || 0;
  }

  getLastCall(method: string): { args: any[]; result?: any; error?: Error } | undefined {
    const calls = this.calls.get(method);
    return calls?.[calls.length - 1];
  }

  getSpy(method: string): any {
    return this.spies.get(method);
  }
}

/**
 * Stub provider that returns fixed values
 */
export class StubProvider {
  constructor(private stubs: Record<string, any>) {
    for (const [key, value] of Object.entries(stubs)) {
      (this as any)[key] = vi.fn().mockReturnValue(value);
    }
  }
}
