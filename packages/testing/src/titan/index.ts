/**
 * Titan Testing Utilities
 *
 * Re-exports all Titan-specific testing utilities
 */

// Test Module
export { TestModule, TestModuleBuilder, createTestModule, testModule } from './test-module.js';
export type { TestModuleOptions } from './test-module.js';

// Test Application
export { TestApplication } from './test-application.js';

// Test Fixtures
export { TestSchemas, TestConfigs, TestRedisConfigs, TestModules, TestData, TestTiming } from './test-fixtures.js';

// Test Mocks
export {
  createMockLogger,
  createMockConfigService,
  createMockRedisManager,
  createMockRedisClient,
  createMockSchedulerService,
  createMockEventBus,
} from './test-mocks.js';

// Redis Test Utils
export {
  createRedisTestFixture,
  cleanupRedisTestFixture,
  waitForRedis,
  createMockRedis,
  RedisPerformanceTester,
} from './redis-test-utils.js';
export type { RedisTestFixtureOptions, RedisTestFixture } from './redis-test-utils.js';

// Container Utils
export {
  registerModuleProviders,
  registerProvider,
  createTestContainer as createSimpleTestContainer,
  resolveFromModule,
  hasProvider,
  getModuleTokens,
  MockContainer,
} from './container-utils.js';

// Process Manager Testing
export {
  TestProcessManager,
  createTestProcessManager,
  MockProcessSpawner,
  AdvancedMockProcessSpawner,
  SimpleMockProcessSpawner,
  MockWorker,
  MockNetronClient,
  MockWorkerHandle,
} from './pm/index.js';
export type { ITestProcessManagerConfig, IOperationRecord } from './pm/index.js';

// Nexus DI Testing
export {
  MockProviderDI,
  createMockProvider,
  createAutoMockProvider,
  MockProvider,
  SpyProvider,
  StubProvider,
  TestContainer,
  createTestContainer,
  createTestContainer as createNexusTestContainer,
  createIsolatedTestContainer,
  TestModuleBuilder as NexusTestModuleBuilder,
  CallCountExpectation,
  CallArgumentsExpectation,
  NeverCalledExpectation,
  SnapshotContainer,
  IsolatedContainer,
  TestModule as NexusTestModule,
  TestHarness,
  waitFor,
  createDeferred,
  createTestProvider,
  createTestFactoryProvider,
  createTestClassProvider,
  assertThrows,
  createTestToken,
  verifyContainerState,
  cleanupTest,
  createTestSuite,
  createTestModule as createNexusTestModule,
  createTestHarness,
  expectResolution,
  expectRejection,
  expectDependency,
  expectLifecycle,
} from './nexus/index.js';
export type {
  MockProviderConfig,
  MockConfig,
  TestContainerOptions,
  Interaction,
  SpyExpectation,
  TestMockConfig,
  TestProvider,
  TestModuleConfig,
  TestHarnessConfig,
  TestContainerOptionsExtended,
  MemoryUsage,
  ResolutionExpectation,
  RejectionExpectation,
  DependencyExpectation,
  LifecycleExpectation,
} from './nexus/index.js';

// Database Testing
export {
  DatabaseTestingModule,
  DATABASE_TESTING_SERVICE,
  DatabaseTestingService,
  createTestDatabase,
  withTestDatabase,
  createTestDatabaseConfigs,
  cleanupTestDatabaseConfigs,
  getRecommendedTestDatabase,
  isDockerAvailable,
} from './database/index.js';
export type { DatabaseTestingOptions, DatabaseTestOptions, DatabaseTestContext } from './database/index.js';
