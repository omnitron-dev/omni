/**
 * Nexus DI Container - Next-generation dependency injection for TypeScript
 * 
 * @packageDocumentation
 */

// Import for internal use
import { Container } from './container/container.js';

// Export Service Mesh
export * from './mesh/index.js';

// Export Tracing
export * from './tracing/index.js';

// Export DevTools
export * from './devtools/index.js';

// Export Federation
export * from './federation/index.js';

// Export Decorators
export * from './decorators/index.js';

// Container
export {
  Container
} from './container/container.js';

export { createToken as token } from './token/token.js';

export { createMultiToken as multiToken } from './token/token.js';

// Convenience exports
export { Container as NexusContainer } from './container/container.js';

export {
  SpyProvider,
  MockProvider,
  StubProvider
} from './testing/mock-provider.js';

// Export decorator utilities and creators
export {
  createDecorator,
  createMethodInterceptor,
  createPropertyInterceptor
} from './decorators/custom-decorators.js';

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
} from './plugins/plugin.js';
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
  Module as ModuleDecorator
} from './decorators/decorators.js';
// Testing Utilities
export {
  TestContainer,
  type MockConfig,
  type Interaction,
  TestModuleBuilder,
  createTestContainer,
  type TestContainerOptions,
  createIsolatedTestContainer
} from './testing/test-container.js';

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
} from './lifecycle/lifecycle.js';

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
} from './testing/test-utilities.js';

// Provider Utilities
export {
  isConstructor,
  isAsyncProvider,
  createValueProvider,
  createFactoryProvider,
  createClassProvider,
  createTokenProvider,
  createMultiProvider,
  createConditionalProvider,
  hasScope,
  isMultiProvider
} from './utils/provider-utils.js';

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
} from './utils/runtime.js';

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
} from './token/token.js';

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
} from './modules/module.js';

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
} from './context/context.js';

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
} from './errors/errors.js';

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
} from './middleware/middleware.js';

// Core Types
export {
  Scope,
  // Interfaces
  type Token,
  type Factory,
  type IModule,
  // Provider types
  type Provider,
  type ProviderDefinition,
  type ProviderInput,
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
} from './types/core.js';

export type {
  ModuleDecoratorOptions
} from './decorators/decorators.js';

// Export types separately
export type {
  DecoratorContext
} from './decorators/custom-decorators.js';