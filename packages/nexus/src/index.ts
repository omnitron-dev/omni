/**
 * Nexus DI Container - Next-generation dependency injection for TypeScript
 * 
 * @packageDocumentation
 */

// Import for internal use
import { Container } from './container/container';

// Export Service Mesh
export * from './mesh';

// Export Tracing
export * from './tracing';

// Export DevTools
export * from './devtools';

// Export Federation
export * from './federation';

// Export Decorators
export * from './decorators';

// Container
export {
  Container
} from './container/container';

export { createToken as token } from './token/token';

export { createMultiToken as multiToken } from './token/token';

// Convenience exports
export { Container as NexusContainer } from './container/container';

export {
  SpyProvider,
  MockProvider,
  StubProvider
} from './testing/mock-provider';

// Export decorator utilities and creators
export {
  createDecorator,
  DecoratorContext,
  createMethodInterceptor,
  createPropertyInterceptor
} from './decorators/custom-decorators';
// Plugin System
export {
  type Plugin,
  createPlugin,
  PluginManager,
  MetricsPlugin,
  LoggingPlugin,
  CachingPlugin,
  type PluginHooks,
  ValidationPlugin,
  PerformancePlugin
} from './plugins/plugin';
// Testing Utilities
export {
  TestContainer,
  type MockConfig,
  type Interaction,
  TestModuleBuilder,
  createTestContainer,
  type TestContainerOptions,
  createIsolatedTestContainer
} from './testing/test-container';

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

// Lifecycle Management
export {
  AuditObserver,
  LifecycleEvent,
  MemoryObserver,
  LifecycleManager,
  type LifecycleHook,
  PerformanceObserver,
  type LifecycleObserver,
  type LifecycleEventData
} from './lifecycle/lifecycle';

export {
  Global,
  Inject,
  Service,
  Optional,
  Singleton,
  Injectable,
  PreDestroy,
  Controller,
  Repository,
  PostConstruct,
  ModuleDecoratorOptions,
  Module as ModuleDecorator
} from './decorators/decorators';

export {
  TestHarness,
  type TestModule,
  expectRejection,
  expectLifecycle,
  expectResolution,
  expectDependency,
  createTestModule,
  createTestHarness,
  type SnapshotContainer,
  type IsolatedContainer
} from './testing/test-utilities';

// Runtime Detection
export {
  isBun,
  isNode,
  isDeno,
  Runtime,
  isServer,
  isBrowser,
  detectRuntime,
  hasESMSupport,
  getRuntimeInfo,
  getMemoryUsage,
  getGlobalObject,
  type RuntimeInfo,
  hasWorkerSupport,
  PerformanceTimer,
  loadRuntimeModule
} from './utils/runtime';

// Token System
export {
  isToken,
  createToken,
  isMultiToken,
  getTokenName,
  tokenFromClass,
  createLazyToken,
  isOptionalToken,
  createMultiToken,
  createAsyncToken,
  createConfigToken,
  createScopedToken,
  createStreamToken,
  type TokenRegistry,
  createOptionalToken
} from './token/token';

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

// Enhanced Module System
export {
  Module,
  forwardRef,
  createModule,
  ModuleBuilder,
  moduleBuilder,
  type ModuleRef,
  type ForwardRef,
  type ModuleOptions,
  type ModuleFactory,
  createConfigModule,
  type ModuleMetadata,
  type ModuleCompiler,
  createDynamicModule,
  createFeatureModule
} from './modules/module';

// Advanced Context System
export {
  ContextKeys,
  InjectContext,
  TenantStrategy,
  ContextManager,
  type ContextKey,
  createContextKey,
  RoleBasedStrategy,
  EnvironmentStrategy,
  FeatureFlagStrategy,
  type ContextProvider,
  DefaultContextProvider,
  type ResolutionStrategy,
  type ContextAwareProvider,
  createContextAwareProvider
} from './context/context';

// Error System
export {
  NexusError,
  ModuleError,
  isNexusError,
  getRootCause,
  DisposalError,
  AggregateError,
  ResolutionError,
  type ErrorHandler,
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

// Middleware System
export {
  type Middleware,
  RetryMiddleware,
  CacheMiddleware,
  createMiddleware,
  LoggingMiddleware,
  CachingMiddleware,
  composeMiddleware,
  MiddlewarePipeline,
  type MiddlewareNext,
  RateLimitMiddleware,
  ValidationMiddleware,
  RetryMiddlewareClass,
  type MiddlewareResult,
  TransactionMiddleware,
  type MiddlewareContext,
  type MiddlewareFunction,
  CircuitBreakerMiddleware,
  ValidationMiddlewareClass
} from './middleware/middleware';

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