/**
 * Titan Decorators - Unified decorator system for dependency injection and metadata
 *
 * @packageDocumentation
 */

// Re-export decorator factories and utilities
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
  Validate
} from './decorator-factory.js';

// Export core decorators
export {
  // Core DI
  Module,  // TODO: Eventually migrate to Nexus Module
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
  // Metadata keys
  METADATA_KEYS,
  // Types
  type Scope,
  type InjectableOptions,
  type ModuleDecoratorOptions
} from './core.js';

// Export injection decorators
export * from './injection.js';

// Export lifecycle decorators
export * from './lifecycle.js';

// Export utility decorators
export * from './utility.js';