/**
 * Nexus DI Container - Next-generation dependency injection for TypeScript
 *
 * @packageDocumentation
 */

// Import for internal use
import { Container } from './container.js';

// Export Service Mesh
export * from './mesh.js';

// Export Tracing
export * from './tracing.js';

// Export DevTools
export * from './devtools.js';

// Export Federation
export * from './federation.js';

// Container
export { Container } from './container.js';

// Token and other types are exported below from types.js

// Convenience exports
export { Container as NexusContainer } from './container.js';

export { SpyProvider, MockProvider, StubProvider } from './testing/mock-provider.js';

// Decorator utilities already exported from main decorators module

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
  PerformancePlugin,
} from './plugin.js';
// Decorators are exported from main decorators module above
// Testing Utilities
export {
  TestContainer,
  type MockConfig,
  type Interaction,
  TestModuleBuilder,
  createTestContainer,
  type TestContainerOptions,
  createIsolatedTestContainer,
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
  type LifecycleEventData,
} from './lifecycle.js';

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
  type IsolatedContainer,
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
  isMultiProvider,
} from './provider-utils.js';

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
  loadRuntimeModule,
} from './runtime.js';

// Token System
export {
  isToken,
  createToken,
  createToken as token, // Alias for convenience
  isMultiToken,
  getTokenName,
  tokenFromClass,
  createLazyToken,
  isOptionalToken,
  createMultiToken,
  createMultiToken as multiToken, // Alias for convenience
  createAsyncToken,
  createConfigToken,
  createScopedToken,
  createStreamToken,
  type TokenRegistry,
  createOptionalToken,
} from './token.js';

// Enhanced Module System
export {
  forwardRef,
  createModule,
  ModuleBuilder,
  moduleBuilder,
  type ModuleRef,
  type ForwardRef,
  type ModuleOptions,
  type ModuleFactory,
  createConfigModule,
  type ModuleCompiler,
  createDynamicModule,
  createFeatureModule,
  // Async options helpers (reduces boilerplate in forRootAsync)
  createAsyncOptionsProvider,
  createServiceProvider,
  createAliasProvider,
  type AsyncOptionsFactory,
  type ModuleAsyncOptions,
  type ModuleProviderTuple,
  type ModuleProviderWithOptions,
  // Type-safe provider helpers (avoid 'as any' in modules)
  defineFactory,
  defineClass,
  defineValue,
  defineExisting,
  defineProviders,
  type ModuleProviders,
} from './module.js';

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
  createContextAwareProvider,
} from './context.js';

/**
 * Nexus DI container feature flags
 */
export const NEXUS_FEATURES = {
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
  DECORATORS: false, // Requires separate import from '@nexus/decorators'
  MODULE_FEDERATION: true,
  SERVICE_MESH: true,
  DISTRIBUTED_TRACING: true,
  DEVTOOLS: true,
} as const;

/**
 * @deprecated Use `NEXUS_FEATURES` instead. Will be removed in future.
 */
export const FEATURES = NEXUS_FEATURES;

/**
 * Phase 3 Features Notice
 *
 * Phase 3 features are available but require separate imports:
 *
 * - Decorators: import from '@nexus/decorators'
 * - Federation: import from '@nexus/federation'
 * - Service Mesh: import from '@nexus/mesh'
 * - Tracing: import from '@nexus/tracing'
 * - DevTools: import from '@nexus/devtools'
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
  DuplicateRegistrationError,
} from './errors.js';

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
  ValidationMiddlewareClass,
} from './middleware.js';

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
  type ModuleMetadata,
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
  type AsyncFactoryProvider,
} from './types.js';
