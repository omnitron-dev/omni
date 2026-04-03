/**
 * Decorator Metadata Constants
 *
 * Centralized metadata key definitions for all decorators in the Titan framework.
 * This ensures consistency across all decorator implementations and prevents typos.
 *
 * @module decorators/constants
 */

/**
 * Metadata keys for decorators
 *
 * All metadata keys follow the pattern: `namespace:category:subcategory`
 * - `titan:` - Titan framework namespace (preferred for new code)
 * - `nexus:` - Legacy Nexus namespace (maintained for backward compatibility)
 * - `design:` - TypeScript design-time metadata
 * - `method:` - Method-level configuration
 * - `inject:` - Injection-specific metadata
 */
export const DECORATOR_METADATA = {
  // ============================================================================
  // DI Metadata (titan:di:*)
  // ============================================================================

  /**
   * Marks a class as injectable
   * @constant {string}
   */
  INJECTABLE: 'titan:di:injectable',

  /**
   * Stores constructor parameter injection tokens
   * @constant {string}
   */
  CONSTRUCTOR_PARAMS: 'titan:di:constructor-params',

  /**
   * Stores property injection tokens
   * @constant {string}
   */
  PROPERTY_PARAMS: 'titan:di:property-params',

  /**
   * Stores method parameter injection tokens
   * @constant {string}
   */
  METHOD_PARAMS: 'titan:di:method-params',

  /**
   * Stores the scope of an injectable (singleton, transient, scoped, request)
   * @constant {string}
   */
  SCOPE: 'titan:di:scope',

  /**
   * Stores the injection token for a class
   * @constant {string}
   */
  TOKEN: 'titan:di:token',

  /**
   * Marks a dependency as optional
   * @constant {string}
   */
  OPTIONAL: 'titan:di:optional',

  /**
   * Marks a parameter for multi-provider injection
   * @constant {string}
   */
  INJECT_ALL: 'titan:di:inject-all',

  /**
   * Marks a class as a module
   * @constant {string}
   */
  MODULE: 'titan:di:module',

  /**
   * Marks a module or provider as global
   * @constant {string}
   */
  GLOBAL: 'titan:di:global',

  /**
   * Stores the service name
   * @constant {string}
   */
  SERVICE_NAME: 'titan:di:service-name',

  // ============================================================================
  // Lifecycle Metadata (titan:lifecycle:*)
  // ============================================================================

  /**
   * Marks a method to be called after construction
   * @constant {string}
   */
  POST_CONSTRUCT: 'titan:lifecycle:post-construct',

  /**
   * Marks a method to be called before destruction
   * @constant {string}
   */
  PRE_DESTROY: 'titan:lifecycle:pre-destroy',

  // ============================================================================
  // Netron/Service Metadata (titan:service:*)
  // ============================================================================

  /**
   * Stores service annotation metadata
   * @constant {string}
   */
  SERVICE_ANNOTATION: 'titan:service:annotation',

  /**
   * Marks a method as public in the service
   * @constant {string}
   */
  METHOD_ANNOTATION: 'titan:service:method',

  // ============================================================================
  // Method Configuration Metadata (titan:method:*)
  // ============================================================================

  /**
   * Stores method authentication configuration
   * @constant {string}
   */
  METHOD_AUTH: 'titan:method:auth',

  /**
   * Stores method rate limit configuration
   * @constant {string}
   */
  METHOD_RATE_LIMIT: 'titan:method:rate-limit',

  /**
   * Stores method cache configuration
   * @constant {string}
   */
  METHOD_CACHE: 'titan:method:cache',

  /**
   * Stores method prefetch configuration
   * @constant {string}
   */
  METHOD_PREFETCH: 'titan:method:prefetch',

  /**
   * Stores method audit configuration
   * @constant {string}
   */
  METHOD_AUDIT: 'titan:method:audit',

  /**
   * Stores general method options
   * @constant {string}
   */
  METHOD_OPTIONS: 'titan:method:options',

  // ============================================================================
  // Injection Metadata (titan:inject:*)
  // ============================================================================

  /**
   * Stores value injection configuration
   * @constant {string}
   */
  VALUES: 'titan:inject:values',

  /**
   * Stores environment variable injection configuration
   * @constant {string}
   */
  ENV: 'titan:inject:env',

  /**
   * Stores configuration injection paths
   * @constant {string}
   */
  CONFIG: 'titan:inject:config',

  /**
   * Stores conditional injection configuration
   * @constant {string}
   */
  CONDITIONAL: 'titan:inject:conditional',

  /**
   * Stores injection container reference
   * @constant {string}
   */
  CONTAINER: 'titan:inject:container',

  // ============================================================================
  // TypeScript Design Metadata (design:*)
  // ============================================================================

  /**
   * TypeScript design-time parameter types
   * @constant {string}
   */
  DESIGN_PARAMTYPES: 'design:paramtypes',

  /**
   * Custom parameter types (overrides design:paramtypes)
   * @constant {string}
   */
  DESIGN_PARAMTYPES_CUSTOM: 'design:paramtypes:custom',

  /**
   * TypeScript design-time return type
   * @constant {string}
   */
  DESIGN_RETURNTYPE: 'design:returntype',

  /**
   * TypeScript design-time property type
   * @constant {string}
   */
  DESIGN_TYPE: 'design:type',
} as const;

/**
 * Type for metadata key values
 */
export type DecoratorMetadataKey = (typeof DECORATOR_METADATA)[keyof typeof DECORATOR_METADATA];
