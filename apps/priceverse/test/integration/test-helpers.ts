/**
 * Test helpers for Priceverse integration tests
 * Provides utilities to create test containers with mocked dependencies
 */

import { Container, type InjectionToken } from '@omnitron-dev/titan/nexus';

// Import tokens (static imports are fine for tokens)
import {
  STREAM_AGGREGATOR_TOKEN,
  OHLCV_AGGREGATOR_TOKEN,
  CBR_RATE_SERVICE_TOKEN,
  EXCHANGE_MANAGER_TOKEN,
  PRICES_SERVICE_TOKEN,
  CHARTS_SERVICE_TOKEN,
} from '../../src/shared/tokens.js';

// Lazy import functions to avoid loading heavy dependencies at module load time
const getStreamAggregatorService = async () =>
  (await import('../../src/modules/aggregator/services/stream-aggregator.service.js')).StreamAggregatorService;
const getOhlcvAggregatorService = async () =>
  (await import('../../src/modules/aggregator/services/ohlcv-aggregator.service.js')).OhlcvAggregatorService;
const getCbrRateService = async () =>
  (await import('../../src/modules/collector/services/cbr-rate.service.js')).CbrRateService;
const getExchangeManagerService = async () =>
  (await import('../../src/modules/collector/services/exchange-manager.service.js')).ExchangeManagerService;
const getPricesService = async () =>
  (await import('../../src/modules/prices/services/prices.service.js')).PricesService;
const getChartsService = async () =>
  (await import('../../src/modules/charts/services/charts.service.js')).ChartsService;

/**
 * Mock dependency keys - these are the string tokens used by @Inject decorators
 * Note: 'Logger' should be an ILoggerModule mock with a `logger` property
 */
const MOCK_KEYS = {
  RedisService: 'RedisService',
  DatabaseConnection: 'DatabaseConnection',
  Logger: 'Logger', // This should be { logger: { debug, info, warn, error } }
  CbrRateService: 'CbrRateService',
  EnabledExchanges: 'EnabledExchanges',
} as const;

/**
 * Create a mock ILoggerModule that wraps simple logger methods
 * Use this when creating mocks for tests
 */
export function createMockLoggerModule(mockLogger?: Partial<{ debug: any; info: any; warn: any; error: any }>): any {
  const defaultLogger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    ...mockLogger,
  };
  return { logger: defaultLogger };
}

/**
 * Service configuration for creating test instances
 */
interface ServiceConfig {
  token: InjectionToken<any>;
  getServiceClass: () => Promise<new (...args: any[]) => any>;
  dependencies: (string | InjectionToken<any>)[];
}

/**
 * Service registry mapping tokens to their configurations
 */
const SERVICE_REGISTRY: ServiceConfig[] = [
  {
    token: STREAM_AGGREGATOR_TOKEN,
    getServiceClass: getStreamAggregatorService,
    dependencies: [MOCK_KEYS.RedisService, MOCK_KEYS.DatabaseConnection, MOCK_KEYS.Logger, MOCK_KEYS.CbrRateService],
  },
  {
    token: OHLCV_AGGREGATOR_TOKEN,
    getServiceClass: getOhlcvAggregatorService,
    dependencies: [MOCK_KEYS.DatabaseConnection, MOCK_KEYS.Logger],
  },
  {
    token: CBR_RATE_SERVICE_TOKEN,
    getServiceClass: getCbrRateService,
    dependencies: [MOCK_KEYS.RedisService, MOCK_KEYS.Logger],
  },
  {
    token: EXCHANGE_MANAGER_TOKEN,
    getServiceClass: getExchangeManagerService,
    dependencies: [MOCK_KEYS.RedisService, MOCK_KEYS.Logger, MOCK_KEYS.EnabledExchanges],
  },
  {
    token: PRICES_SERVICE_TOKEN,
    getServiceClass: getPricesService,
    dependencies: [MOCK_KEYS.RedisService, MOCK_KEYS.DatabaseConnection, MOCK_KEYS.Logger],
  },
  {
    token: CHARTS_SERVICE_TOKEN,
    getServiceClass: getChartsService,
    dependencies: [OHLCV_AGGREGATOR_TOKEN, MOCK_KEYS.Logger],
  },
];

/**
 * String token registry for backward compatibility
 */
const STRING_TOKEN_REGISTRY: Record<string, ServiceConfig> = {
  PricesService: {
    token: 'PricesService' as unknown as InjectionToken<any>,
    getServiceClass: getPricesService,
    dependencies: [MOCK_KEYS.RedisService, MOCK_KEYS.DatabaseConnection, MOCK_KEYS.Logger],
  },
};

// Cache for loaded service classes
const serviceClassCache: Map<InjectionToken<any>, new (...args: any[]) => any> = new Map();

/**
 * Preload a service class into the cache
 */
async function preloadServiceClass(config: ServiceConfig): Promise<new (...args: any[]) => any> {
  if (serviceClassCache.has(config.token)) {
    return serviceClassCache.get(config.token)!;
  }
  const ServiceClass = await config.getServiceClass();
  serviceClassCache.set(config.token, ServiceClass);
  return ServiceClass;
}

/**
 * Test module wrapper that provides cleanup functionality
 */
export class TestModuleWrapper {
  private instances: Map<InjectionToken<any> | string, any> = new Map();
  private mocks: Record<string | symbol, any>;
  private container: Container;

  constructor(mocks: Record<string | symbol, any>) {
    this.mocks = mocks;
    this.container = new Container();

    // Register all mocks in the container
    for (const [key, mock] of Object.entries(mocks)) {
      this.container.register(key, { useValue: mock });
    }
  }

  /**
   * Get a service instance, creating it if needed with injected mocks.
   * Note: Service class must be preloaded first via preloadServices() or getAsync()
   */
  get<T>(token: InjectionToken<T> | string): T {
    // Check if already instantiated
    if (this.instances.has(token)) {
      return this.instances.get(token) as T;
    }

    // Find service config
    let config: ServiceConfig | undefined;

    if (typeof token === 'string') {
      // Check string token registry first
      config = STRING_TOKEN_REGISTRY[token];
      if (!config) {
        // Try to find in main registry by token name
        config = SERVICE_REGISTRY.find(
          (s) => typeof s.token === 'object' && 'name' in s.token && s.token.name === token
        );
      }
    } else {
      config = SERVICE_REGISTRY.find((s) => s.token === token);
    }

    if (!config) {
      throw new Error(`Unknown service token: ${String(token)}`);
    }

    // Get the service class from cache
    const ServiceClass = serviceClassCache.get(config.token);
    if (!ServiceClass) {
      throw new Error(
        `Service class not preloaded for token: ${String(token)}. Use getAsync() or preloadServices() first.`
      );
    }

    // Resolve dependencies from mocks
    const deps = config.dependencies.map((depKey) => {
      // Handle Token dependencies (like OHLCV_AGGREGATOR_TOKEN)
      if (typeof depKey === 'object' && depKey !== null) {
        // It's a Token object - check if there's a mock for it by name
        const tokenName = 'name' in depKey ? (depKey as any).name : String(depKey);

        // Check if mock is provided by token name
        if (tokenName in this.mocks) {
          return this.mocks[tokenName];
        }

        // Try to resolve from already created instances
        if (this.instances.has(depKey)) {
          return this.instances.get(depKey);
        }

        throw new Error(`Missing mock for token dependency: ${tokenName}`);
      }

      // Check mocks by key (string dependency)
      if (depKey in this.mocks) {
        return this.mocks[depKey];
      }

      throw new Error(`Missing mock for dependency: ${String(depKey)}`);
    });

    // Create instance
    const instance = new ServiceClass(...deps);
    this.instances.set(token, instance);

    // Also register in container for resolve() calls - use the actual token
    this.container.register(config.token, { useValue: instance });

    // If the token is different from config.token (e.g., string vs Token), register both
    if (token !== config.token) {
      this.container.register(token as InjectionToken<T>, { useValue: instance });
    }

    return instance as T;
  }

  /**
   * Async version of get that preloads the service class first
   */
  async getAsync<T>(token: InjectionToken<T> | string): Promise<T> {
    // Check if already instantiated
    if (this.instances.has(token)) {
      return this.instances.get(token) as T;
    }

    // Find service config
    let config: ServiceConfig | undefined;

    if (typeof token === 'string') {
      config = STRING_TOKEN_REGISTRY[token];
      if (!config) {
        config = SERVICE_REGISTRY.find(
          (s) => typeof s.token === 'object' && 'name' in s.token && s.token.name === token
        );
      }
    } else {
      config = SERVICE_REGISTRY.find((s) => s.token === token);
    }

    if (!config) {
      throw new Error(`Unknown service token: ${String(token)}`);
    }

    // Preload the service class
    await preloadServiceClass(config);

    // Now use the sync get method
    return this.get(token);
  }

  /**
   * Get the underlying container
   */
  getContainer(): Container {
    return this.container;
  }

  /**
   * Clean up resources
   */
  async cleanup(): Promise<void> {
    // Call stop/cleanup methods on services if they exist
    for (const instance of this.instances.values()) {
      if (instance && typeof instance.stop === 'function') {
        try {
          await instance.stop();
        } catch {
          // Ignore cleanup errors
        }
      }
    }
    this.instances.clear();
    await this.container.dispose();
  }
}

/**
 * Create a test module with mocks
 * @param _moduleClass - The module class (kept for API compatibility, not used)
 * @param mocks - Record of mock dependencies keyed by their injection token names
 */
export function createTestModule(
  _moduleClass: any,
  mocks: Record<string | symbol, any>
): TestModuleWrapper {
  return new TestModuleWrapper(mocks);
}

/**
 * Create a test container - alternative API for more control
 */
export function createTestContainer(mocks: Record<string | symbol, any>): Container {
  const container = new Container();
  for (const [key, mock] of Object.entries(mocks)) {
    container.register(key, { useValue: mock });
  }
  return container;
}

/**
 * Preload service classes for the given tokens.
 * This should be called in a beforeAll hook to load service classes before tests.
 */
export async function preloadServices(tokens: (InjectionToken<any> | string)[]): Promise<void> {
  for (const token of tokens) {
    let config: ServiceConfig | undefined;

    if (typeof token === 'string') {
      config = STRING_TOKEN_REGISTRY[token];
      if (!config) {
        config = SERVICE_REGISTRY.find(
          (s) => typeof s.token === 'object' && 'name' in s.token && s.token.name === token
        );
      }
    } else {
      config = SERVICE_REGISTRY.find((s) => s.token === token);
    }

    if (config) {
      await preloadServiceClass(config);
    }
  }
}

// Re-export tokens for convenience
export {
  STREAM_AGGREGATOR_TOKEN,
  OHLCV_AGGREGATOR_TOKEN,
  CBR_RATE_SERVICE_TOKEN,
  EXCHANGE_MANAGER_TOKEN,
  PRICES_SERVICE_TOKEN,
  CHARTS_SERVICE_TOKEN,
};
