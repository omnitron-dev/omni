/**
 * Titan Decorators - Unified decorator system for dependency injection and metadata
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

// ============================================================================
// Decorator Creation Utilities
// ============================================================================

/**
 * Decorator creation and utility exports.
 *
 * @stable
 * @since 0.1.0
 */
export {
  // Decorator creation utilities
  createDecorator,
  createMethodInterceptor,
  createPropertyInterceptor,
  createParameterizedDecorator,
  combineDecorators,

  // Metadata utilities
  getCustomMetadata,
  getAllCustomMetadata,
  hasDecorator,
  getDecoratorOptions,

  // Types
  DecoratorTarget,
  type DecoratorContext,
  type DecoratorTransform,
  type MetadataTransform,
  type OptionsValidator,
  type DecoratorHook,
  type CustomDecoratorConfig,

  // Built-in interceptors
  Memoize,
  Retry,
  Deprecated,
  Validate,
} from './decorator-factory.js';

// ============================================================================
// Core DI Decorators
// ============================================================================

/**
 * Core dependency injection decorators.
 *
 * @stable
 * @since 0.1.0
 */
export {
  // Core DI
  Module, // Currently wraps Nexus Module system with decorator syntax for compatibility
  Injectable,
  Singleton,
  Transient,
  Scoped,
  Request,
  Service,
  Controller,
  Repository,
  Factory,
  Global,
  // Service/Method decorators
  Method,
  // Composable method decorators (use alongside @Method())
  Auth,
  RateLimit,
  Cache,
  Prefetch,
  Audit,
  Transports,
  Readonly,
  // Metadata keys
  METADATA_KEYS,
  SERVICE_ANNOTATION,
  PUBLIC_ANNOTATION,
  // Types
  type Scope,
  type InjectableOptions,
  type ModuleDecoratorOptions,
} from './core.js';

/**
 * Public decorator - legacy alias for Method.
 *
 * @deprecated Use `Method` instead. Will be removed in v1.0.0.
 * @since 0.1.0
 */
export { Public } from './core.js';

// ============================================================================
// Injection Decorators
// ============================================================================

/**
 * Parameter and property injection decorators.
 *
 * @stable
 * @since 0.1.0
 */
export * from './injection.js';

// ============================================================================
// Lifecycle Decorators
// ============================================================================

/**
 * Lifecycle hook decorators for initialization and cleanup.
 *
 * @stable
 * @since 0.1.0
 */
export * from './lifecycle.js';

// ============================================================================
// Utility Decorators
// ============================================================================

/**
 * Utility decorators for common patterns.
 *
 * @stable
 * @since 0.1.0
 */
export * from './utility.js';
