/**
 * Nexus DI Container - Next-generation dependency injection for TypeScript
 * 
 * @packageDocumentation
 */

// Import for internal use
import { Container } from './container/container';

// Core Types
export {
  // Type definitions
  Constructor,
  AbstractConstructor,
  ServiceIdentifier,
  Scope,
  Factory,
  AsyncFactory,
  InjectionToken,
  
  // Interfaces
  Token,
  MultiToken,
  TokenMetadata,
  ResolutionContext,
  IContainer,
  ContainerMetadata,
  IModule,
  DynamicModule,
  Disposable,
  Initializable,
  
  // Provider types
  Provider,
  ClassProvider,
  ValueProvider,
  FactoryProvider,
  AsyncFactoryProvider,
  TokenProvider,
  ConditionalProvider,
  RegistrationOptions
} from './types/core';

// Token System
export {
  createToken,
  createMultiToken,
  createOptionalToken,
  createScopedToken,
  isToken,
  isMultiToken,
  isOptionalToken,
  getTokenName,
  tokenFromClass,
  TokenRegistry
} from './token/token';

// Container
export {
  Container
} from './container/container';

// Error System
export {
  NexusError,
  ResolutionError,
  CircularDependencyError,
  RegistrationError,
  DuplicateRegistrationError,
  DependencyNotFoundError,
  ScopeMismatchError,
  InvalidProviderError,
  AsyncResolutionError,
  DisposalError,
  ModuleError,
  InitializationError,
  ContainerDisposedError,
  NotInjectableError,
  AggregateError,
  isNexusError,
  getRootCause,
  ErrorHandler
} from './errors/errors';

// Runtime Detection
export {
  Runtime,
  RuntimeInfo,
  detectRuntime,
  getRuntimeInfo,
  isNode,
  isBun,
  isDeno,
  isBrowser,
  isServer,
  hasESMSupport,
  hasWorkerSupport,
  getGlobalObject,
  loadRuntimeModule,
  PerformanceTimer,
  getMemoryUsage
} from './utils/runtime';

// Testing Utilities
export {
  TestContainer,
  TestContainerOptions,
  MockConfig,
  Interaction,
  createTestContainer,
  createIsolatedTestContainer,
  TestModuleBuilder
} from './testing/test-container';

// Convenience exports
export { Container as NexusContainer } from './container/container';
export { createToken as token } from './token/token';
export { createMultiToken as multiToken } from './token/token';

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

// Plugin System
export {
  Plugin,
  PluginHooks,
  PluginManager,
  createPlugin,
  ValidationPlugin,
  MetricsPlugin,
  LoggingPlugin,
  PerformancePlugin,
  CachingPlugin
} from './plugins/plugin';

// Middleware System
export {
  Middleware,
  MiddlewareContext,
  MiddlewareFunction,
  MiddlewareNext,
  MiddlewareResult,
  MiddlewarePipeline,
  createMiddleware,
  LoggingMiddleware,
  CachingMiddleware,
  RetryMiddleware,
  ValidationMiddleware,
  TransactionMiddleware,
  CircuitBreakerMiddleware,
  RateLimitMiddleware,
  composeMiddleware
} from './middleware/middleware';

// Lifecycle Management
export {
  LifecycleEvent,
  LifecycleEventData,
  LifecycleHook,
  LifecycleObserver,
  LifecycleManager,
  PerformanceObserver,
  MemoryObserver,
  AuditObserver
} from './lifecycle/lifecycle';

// Advanced Context System
export {
  ContextKey,
  ContextKeys,
  ContextProvider,
  DefaultContextProvider,
  ResolutionStrategy,
  EnvironmentStrategy,
  FeatureFlagStrategy,
  TenantStrategy,
  RoleBasedStrategy,
  ContextManager,
  ContextAwareProvider,
  createContextKey,
  createContextAwareProvider,
  InjectContext
} from './context/context';

// Enhanced Module System
export {
  ModuleMetadata,
  ModuleOptions,
  ModuleFactory,
  ModuleRef,
  ModuleCompiler,
  ModuleBuilder,
  createModule,
  createDynamicModule,
  moduleBuilder,
  createConfigModule,
  createFeatureModule,
  Module
} from './modules/module';

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