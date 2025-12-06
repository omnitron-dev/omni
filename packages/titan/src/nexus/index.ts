/**
 * Nexus DI Container - Next-generation dependency injection for TypeScript
 *
 * @packageDocumentation
 *
 * ## API Stability Markers
 *
 * - `@stable` - Part of the public API, follows semantic versioning
 * - `@experimental` - API may change in minor versions
 * - `@internal` - Not intended for public use
 * - `@deprecated` - Will be removed in a future version
 *
 * @since 0.1.0
 */

// Import for internal use
import { Container } from './container.js';

// ============================================================================
// Experimental Features - Service Mesh
// ============================================================================

/**
 * Service Mesh integration for service discovery, load balancing, and distributed communication.
 *
 * @experimental
 * @since 0.1.0
 */
export * from './mesh.js';

// ============================================================================
// Experimental Features - Tracing
// ============================================================================

/**
 * Distributed tracing support with OpenTelemetry integration.
 *
 * @experimental
 * @since 0.1.0
 */
export * from './tracing.js';

// ============================================================================
// Experimental Features - DevTools
// ============================================================================

/**
 * DevTools extension for debugging and visualization of dependency injection.
 *
 * @experimental
 * @since 0.1.0
 */
export * from './devtools.js';

// ============================================================================
// Experimental Features - Federation
// ============================================================================

/**
 * Module Federation support for sharing modules across applications.
 *
 * @experimental
 * @since 0.1.0
 */
export * from './federation.js';

// ============================================================================
// Core Container
// ============================================================================

/**
 * The main dependency injection container.
 * Manages registration, resolution, and lifecycle of dependencies.
 *
 * @stable
 * @since 0.1.0
 */
export { Container } from './container.js';

// Token and other types are exported below from types.js

/**
 * Alias for Container class.
 *
 * @stable
 * @since 0.1.0
 */
export { Container as NexusContainer } from './container.js';

/**
 * Testing utilities for mocking and spying on providers.
 *
 * @stable
 * @since 0.1.0
 */
export { SpyProvider, MockProvider, StubProvider } from './testing/mock-provider.js';

// ============================================================================
// Experimental Features - Plugin System
// ============================================================================

/**
 * Plugin system for extending container functionality.
 * Plugins can add middleware, hooks, and custom behaviors.
 *
 * @experimental
 * @since 0.1.0
 */
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

// ============================================================================
// Testing Utilities
// ============================================================================

/**
 * Testing utilities for creating isolated test containers and mocking dependencies.
 *
 * @stable
 * @since 0.1.0
 */
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
 * Default container instance for simple use cases.
 *
 * @stable
 * @since 0.1.0
 */
export const defaultContainer = new Container();

/**
 * Quick container creation helper.
 *
 * @stable
 * @since 0.1.0
 * @returns A new Container instance
 */
export function createContainer(): Container {
  return new Container();
}

// ============================================================================
// Lifecycle Management
// ============================================================================

/**
 * Lifecycle management utilities for tracking and observing container events.
 *
 * @stable
 * @since 0.1.0
 */
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

/**
 * Advanced testing utilities including harness and assertion helpers.
 *
 * @stable
 * @since 0.1.0
 */
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

// ============================================================================
// Provider Utilities
// ============================================================================

/**
 * Utility functions for creating and validating providers.
 *
 * @stable
 * @since 0.1.0
 */
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

// ============================================================================
// Runtime Detection
// ============================================================================

/**
 * Runtime detection utilities for cross-platform compatibility.
 * Supports Node.js, Bun, Deno, and browser environments.
 *
 * @stable
 * @since 0.1.0
 */
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

// ============================================================================
// Token System
// ============================================================================

/**
 * Token system for type-safe dependency identification.
 * Tokens provide a way to identify dependencies without coupling to concrete implementations.
 *
 * @stable
 * @since 0.1.0
 */
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

// ============================================================================
// Enhanced Module System
// ============================================================================

/**
 * Enhanced module system for organizing providers and creating dynamic modules.
 *
 * @stable
 * @since 0.1.0
 */
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

// ============================================================================
// Advanced Context System
// ============================================================================

/**
 * Advanced context system for contextual injection and multi-tenancy.
 *
 * @stable
 * @since 0.1.0
 */
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
 * Nexus DI container feature flags indicating available functionality.
 *
 * @stable
 * @since 0.1.0
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
 * Legacy alias for NEXUS_FEATURES.
 *
 * @deprecated Use `NEXUS_FEATURES` instead. Will be removed in v1.0.0.
 * @since 0.1.0
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

// ============================================================================
// Error System
// ============================================================================

/**
 * Error classes for dependency injection failures.
 * Provides detailed error information for debugging resolution issues.
 *
 * @stable
 * @since 0.1.0
 */
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

// ============================================================================
// Middleware System
// ============================================================================

/**
 * Middleware system for intercepting and modifying resolution behavior.
 *
 * @stable
 * @since 0.1.0
 */
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

// ============================================================================
// Core Types
// ============================================================================

/**
 * Core type definitions for dependency injection.
 *
 * @stable
 * @since 0.1.0
 */
export {
  Scope,
  type ScopeValue,
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
