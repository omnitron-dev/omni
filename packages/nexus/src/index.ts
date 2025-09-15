/**
 * Nexus DI Container - Next-generation dependency injection for TypeScript
 * 
 * @packageDocumentation
 */

// Import for internal use
import { Container } from './container/container';

// Container
export {
  Container
} from './container/container';

export { createToken as token } from './token/token';

export { createMultiToken as multiToken } from './token/token';

// Convenience exports
export { Container as NexusContainer } from './container/container';

// Plugin System
export {
  type Plugin,
  type PluginHooks,
  createPlugin,
  PluginManager,
  MetricsPlugin,
  LoggingPlugin,
  CachingPlugin,
  ValidationPlugin,
  PerformancePlugin
} from './plugins/plugin';

// Testing Utilities
export {
  type MockConfig,
  type Interaction,
  TestContainer,
  TestModuleBuilder,
  createTestContainer,
  type TestContainerOptions,
  createIsolatedTestContainer
} from './testing/test-container';

export {
  type TestModule,
  TestHarness,
  type SnapshotContainer,
  type IsolatedContainer,
  expectResolution,
  expectRejection,
  expectDependency,
  expectLifecycle,
  createTestModule,
  createTestHarness
} from './testing/test-utilities';

export {
  MockProvider,
  SpyProvider,
  StubProvider
} from './testing/mock-provider';

// Lifecycle Management
export {
  type LifecycleHook,
  AuditObserver,
  LifecycleEvent,
  MemoryObserver,
  LifecycleManager,
  type LifecycleObserver,
  type LifecycleEventData,
  PerformanceObserver
} from './lifecycle/lifecycle';
// Runtime Detection
export {
  isBun,
  isNode,
  isDeno,
  Runtime,
  isServer,
  isBrowser,
  type RuntimeInfo,
  detectRuntime,
  hasESMSupport,
  getRuntimeInfo,
  getMemoryUsage,
  getGlobalObject,
  hasWorkerSupport,
  PerformanceTimer,
  loadRuntimeModule
} from './utils/runtime';
// Enhanced Module System
export {
  Module,
  type ModuleRef,
  type ForwardRef,
  forwardRef,
  createModule,
  type ModuleOptions,
  type ModuleFactory,
  ModuleBuilder,
  moduleBuilder,
  type ModuleMetadata,
  type ModuleCompiler,
  createConfigModule,
  createDynamicModule,
  createFeatureModule
} from './modules/module';

/**
 * Default container instance for simple use cases
 */
export const defaultContainer = new Container();

/**
 * Quick container creation helper
 */
export function createContainer(): Container {
  return new Container();
}

/**
 * Version information
 */
export const VERSION = '2.0.0';

// Token System
export {
  isToken,
  createToken,
  isMultiToken,
  getTokenName,
  type TokenRegistry,
  tokenFromClass,
  createLazyToken,
  isOptionalToken,
  createMultiToken,
  createAsyncToken,
  createConfigToken,
  createScopedToken,
  createStreamToken,
  createOptionalToken
} from './token/token';

// Advanced Context System
export {
  type ContextKey,
  ContextKeys,
  InjectContext,
  TenantStrategy,
  ContextManager,
  type ContextProvider,
  createContextKey,
  RoleBasedStrategy,
  type ResolutionStrategy,
  EnvironmentStrategy,
  FeatureFlagStrategy,
  type ContextAwareProvider,
  DefaultContextProvider,
  createContextAwareProvider
} from './context/context';

// Middleware System
export {
  type Middleware,
  type MiddlewareNext,
  type MiddlewareResult,
  createMiddleware,
  type MiddlewareContext,
  LoggingMiddleware,
  CachingMiddleware,
  composeMiddleware,
  type MiddlewareFunction,
  MiddlewarePipeline,
  RateLimitMiddleware,
  ValidationMiddleware,
  TransactionMiddleware,
  CircuitBreakerMiddleware,
  RetryMiddleware,
  CacheMiddleware,
  RetryMiddlewareClass,
  ValidationMiddlewareClass
} from './middleware/middleware';

// Error System
export {
  NexusError,
  ModuleError,
  isNexusError,
  getRootCause,
  type ErrorHandler,
  DisposalError,
  AggregateError,
  ResolutionError,
  RegistrationError,
  ScopeMismatchError,
  NotInjectableError,
  InitializationError,
  InvalidProviderError,
  AsyncResolutionError,
  ContainerDisposedError,
  CircularDependencyError,
  DependencyNotFoundError,
  DuplicateRegistrationError
} from './errors/errors';

// Core Types
export {
  Scope,
  // Interfaces
  type Token,
  type Factory,
  type IModule,
  // Provider types
  type Provider,
  type MultiToken,
  type IContainer,
  
  type Disposable,
  // Type definitions
  type Constructor,
  type AsyncFactory,
  type TokenMetadata,
  type DynamicModule,
  type Initializable,
  type ClassProvider,
  type ValueProvider,
  type TokenProvider,
  type InjectionToken,
  
  type FactoryProvider,
  type ServiceIdentifier,
  type ResolutionContext,
  type ContainerMetadata,
  type AbstractConstructor,
  type ConditionalProvider,
  type RegistrationOptions,
  type AsyncFactoryProvider
} from './types/core';

/**
 * Feature flags for all phases
 */
export const FEATURES = {
  // Phase 1
  CORE: true,
  TOKEN_SYSTEM: true,
  PROVIDERS: true,
  LIFECYCLE: true,
  ERROR_HANDLING: true,
  TESTING: true,
  ASYNC: true,
  MODULES: true,
  CROSS_PLATFORM: true,
  // Phase 2
  PLUGINS: true,
  MIDDLEWARE: true,
  LIFECYCLE_HOOKS: true,
  ADVANCED_CONTEXT: true,
  ENHANCED_MODULES: true,
  CONTEXTUAL_INJECTION: true,
  // Phase 3
  DECORATORS: false, // Requires separate import from '@omnitron-dev/nexus/decorators'
  MODULE_FEDERATION: true,
  SERVICE_MESH: true,
  DISTRIBUTED_TRACING: true,
  DEVTOOLS: true
} as const;

/**
 * Phase 3 Features Notice
 * 
 * Phase 3 features are available but require separate imports:
 * 
 * - Decorators: import from '@omnitron-dev/nexus/decorators'
 * - Federation: import from '@omnitron-dev/nexus/federation'
 * - Service Mesh: import from '@omnitron-dev/nexus/mesh'
 * - Tracing: import from '@omnitron-dev/nexus/tracing'
 * - DevTools: import from '@omnitron-dev/nexus/devtools'
 */

// Export Federation
export * from './federation';

// Export Service Mesh
export * from './mesh';

// Export Tracing
export * from './tracing';

// Export DevTools
export * from './devtools';

// Export Decorators
export * from './decorators';